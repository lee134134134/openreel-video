import type { JSX } from "react";
import React, { useCallback, useEffect, useState } from "react";
import { ToolcraftButton as Button } from "@openreel/ui";
import type { VideoExportSettings } from "@openreel/core";
import { setEncoderBackendFactory, WebCodecsBackend } from "@openreel/core";
import { useProjectStore } from "../../stores/project-store";
import { ExportDialog } from "../../components/editor/ExportDialog";
import { deriveSourceExportMatch } from "../../services/export-source-match";
import { useExportRunner, extForFormat, exportFilename } from "../../services/export-runner";
import { NativeFFmpegBackend } from "../../services/native-ffmpeg-backend";
import { buildSegmentedExportPlan, type SegmentedExportPlan } from "./segmented-export-plan";
import { Icon } from "@/icons/Icon";

const NO_DRAG = { WebkitAppRegion: "no-drag" } as React.CSSProperties;

const resolveExportOutputPath = (): string =>
  (window as { __openreelExportPath?: string }).__openreelExportPath ?? "";

// Native ffmpeg writes the file itself via the resolved output path, so it does
// not consume the writable stream — a no-op stream satisfies the interface.
const NOOP_WRITABLE = {
  async seek() {},
  async write() {},
  async close() {},
  async abort() {},
  async truncate() {},
} as unknown as FileSystemWritableFileStream;

// WebCodecs hardware encoding (no per-frame GPU->CPU readback) is the fast path
// for the common H.264/HEVC fast/balanced case. ProRes, AV1, and the
// software-CRF "Smallest" mode stay on the native ffmpeg backend.
function shouldUseWebCodecs(settings: VideoExportSettings): boolean {
  const hasWebCodecs =
    typeof (globalThis as { VideoEncoder?: unknown }).VideoEncoder !==
    "undefined";
  const mode = settings.encodeMode ?? "balanced";
  return (
    hasWebCodecs &&
    (settings.codec === "h264" || settings.codec === "h265") &&
    (mode === "fast" || mode === "balanced")
  );
}

export function DesktopExportButton(): JSX.Element {
  const project = useProjectStore((state) => state.project);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const {
    state,
    runExport,
    showSavePicker,
    beginExport,
    reportProgress,
    finishExportSoon,
    failExport,
    cancel,
    resetError,
  } = useExportRunner({ project });

  useEffect(() => {
    const open = () => setIsDialogOpen(true);
    window.addEventListener("openreel:menu:export", open);
    return () => window.removeEventListener("openreel:menu:export", open);
  }, []);

  /**
   * Native segmented export: encode each frame-aligned segment as its own
   * regular export job (the segment files double as resume checkpoints), then
   * concatenate them with the concat demuxer on the main process. Interrupted
   * exports re-validate the existing segment files and skip completed ones.
   */
  const runSegmentedExport = useCallback(
    async (
      plan: SegmentedExportPlan,
      exportSettings: Partial<VideoExportSettings>,
      ext: string,
    ): Promise<void> => {
      const bridge = window.openreel;
      if (typeof bridge?.export.segmentedCheck !== "function" || typeof bridge.export.segmentedConcat !== "function") {
        throw new Error("Segmented export requires a newer desktop runtime");
      }
      const frameRate = (exportSettings as VideoExportSettings).frameRate;
      const { completed } = await bridge.export.segmentedCheck({
        segments: plan.segmentPaths.map((segmentPath, index) => ({
          path: segmentPath,
          expectedDurationSec: plan.expectedDurations[index],
        })),
        frameRate,
      });
      const done = new Set(completed);
      const total = plan.segmentPaths.length;
      for (let index = 0; index < total; index++) {
        // Between segments the runner reports "Saved!"; flip back into the
        // exporting state so the UI stays on the progress button.
        beginExport();
        reportProgress(done.has(index) ? 1 : 0, `Segment ${index + 1}/${total}${done.has(index) ? " (resumed)" : ""}`);
        if (done.has(index)) continue;
        // Point the native backend at this segment's file, then run the
        // regular per-segment export.
        (window as { __openreelExportPath?: string }).__openreelExportPath = plan.segmentPaths[index];
        await runExport(
          {
            ...exportSettings,
            range: { startTime: plan.ranges[index].startTime, endTime: plan.ranges[index].endTime },
          },
          ext,
          NOOP_WRITABLE,
        );
      }
      (window as { __openreelExportPath?: string }).__openreelExportPath = plan.outputPath;
      beginExport();
      reportProgress(0.99, "Merging segments...");
      const merge = await bridge.export.segmentedConcat({
        segments: plan.segmentPaths,
        outputPath: plan.outputPath,
      });
      if (!merge.ok) {
        throw new Error(`Segment merge failed (ffmpeg exit ${merge.code ?? "n/a"}): ${merge.stderrTail.slice(-400)}`);
      }
    },
    [runExport, beginExport, reportProgress],
  );

  const handleExport = useCallback(
    async (settings: VideoExportSettings) => {
      setIsDialogOpen(false);

      try {
        const ext = extForFormat(settings.format, settings.codec);
        const useWebCodecs = shouldUseWebCodecs(settings);
        const writable = await showSavePicker(
          exportFilename(project.name, ext),
          ext,
          { streamToFile: useWebCodecs },
        );

        beginExport();

        const needsUpscaling =
          settings.width > project.settings.width ||
          settings.height > project.settings.height;

        const exportSettings: Partial<VideoExportSettings> = {
          ...settings,
          upscaling:
            settings.upscaling?.enabled && needsUpscaling ? settings.upscaling : undefined,
        };

        if (useWebCodecs) {
          const videoCodec = settings.codec === "h265" ? "hevc" : "avc";
          setEncoderBackendFactory((mediabunny) =>
            mediabunny
              ? new WebCodecsBackend(mediabunny, {
                  hardwareAcceleration: "prefer-hardware",
                  videoCodecs: [videoCodec],
                  // Desktop streams frames to disk and uses the hardware encoder,
                  // so export at the full (matched) resolution — no browser clamp.
                  clampResolution: false,
                })
              : new NativeFFmpegBackend(resolveExportOutputPath),
          );
          try {
            await runExport(exportSettings, ext, writable);
          } catch (webCodecsError) {
            console.warn(
              "[Export] WebCodecs export failed; falling back to native ffmpeg:",
              webCodecsError,
            );
            try {
              await writable.abort?.();
            } catch {}
            setEncoderBackendFactory(
              () => new NativeFFmpegBackend(resolveExportOutputPath),
            );
            await runExport(exportSettings, ext, NOOP_WRITABLE);
          }
        } else {
          setEncoderBackendFactory(
            () => new NativeFFmpegBackend(resolveExportOutputPath),
          );
          const plan = buildSegmentedExportPlan(
            exportSettings as VideoExportSettings,
            project.timeline.duration,
            (window as { __openreelExportPath?: string }).__openreelExportPath ?? "",
            navigator.hardwareConcurrency || 1,
          );
          if (plan) {
            await runSegmentedExport(plan, exportSettings, ext);
          } else {
            await runExport(exportSettings, ext, writable);
          }
        }

        finishExportSoon();
      } catch (error) {
        failExport(error);
      }
    },
    [project, runExport, runSegmentedExport, showSavePicker, beginExport, finishExportSoon, failExport],
  );

  if (state.isExporting) {
    return (
      <Button
        label={`${Math.round(state.progress)}%`}
        variant="secondary"
        size="sm"
        style={NO_DRAG}
        onClick={cancel}
        className="mr-2"
        aria-label="Cancel export"
      />
    );
  }

  if (state.error) {
    return (
      <Button
        label={state.error}
        variant="destructive"
        size="sm"
        style={NO_DRAG}
        onClick={resetError}
        className="mr-2 max-w-[200px] truncate"
        aria-label="Dismiss export error"
      />
    );
  }

  if (state.complete) {
    return (
      <Button
        label="Saved!"
        variant="secondary"
        size="sm"
        style={NO_DRAG}
        className="mr-2"
        isDisabled
      />
    );
  }

  return (
    <>
      <Button
        label="Export"
        variant="primary"
        size="sm"
        icon={<Icon name="square.and.arrow.up" size={15} ariaHidden />}
        style={NO_DRAG}
        onClick={() => setIsDialogOpen(true)}
        className="mr-2"
      />

      <ExportDialog
        isOpen={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
        onExport={handleExport}
        duration={project?.timeline?.duration ?? 0}
        projectWidth={project?.settings?.width ?? 1920}
        projectHeight={project?.settings?.height ?? 1080}
        frameRate={project?.settings?.frameRate ?? 30}
        sourceMatch={deriveSourceExportMatch(project)}
      />
    </>
  );
}
