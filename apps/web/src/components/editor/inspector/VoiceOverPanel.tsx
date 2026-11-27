import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ToolcraftButton as Button,
  ToolcraftCard as Card,
  ToolcraftText as Text,
} from "@openreel/ui";
import { AlertCircle, Mic, Square } from "@/icons/lucide-compat";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";

export function selectVoiceOverMimeType(
  supports: (mimeType: string) => boolean = MediaRecorder.isTypeSupported,
): { mimeType: string; extension: string } | null {
  const candidates = [
    { mimeType: "audio/webm;codecs=opus", extension: "webm" },
    { mimeType: "audio/mp4", extension: "m4a" },
    { mimeType: "audio/webm", extension: "webm" },
    { mimeType: "audio/ogg;codecs=opus", extension: "ogg" },
  ];
  return candidates.find((candidate) => supports(candidate.mimeType)) ?? null;
}

function formatElapsed(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1_000);
  return `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60)
    .toString()
    .padStart(2, "0")}`;
}

export const VoiceOverPanel: React.FC = () => {
  const importMedia = useProjectStore((state) => state.importMedia);
  const playheadPosition = useTimelineStore((state) => state.playheadPosition);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const saveRecordingRef = useRef(true);
  const [isRecording, setIsRecording] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [useCountdown, setUseCountdown] = useState(true);
  const countdownTimerRef = useRef<number | null>(null);

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }, []);

  useEffect(() => {
    if (!isRecording) return;
    const timer = window.setInterval(
      () => setElapsed(Date.now() - startedAtRef.current),
      200,
    );
    return () => window.clearInterval(timer);
  }, [isRecording]);

  useEffect(
    () => () => {
      saveRecordingRef.current = false;
      if (countdownTimerRef.current !== null) {
        window.clearInterval(countdownTimerRef.current);
      }
      if (recorderRef.current?.state !== "inactive") recorderRef.current?.stop();
      releaseStream();
    },
    [releaseStream],
  );

  const saveVoiceOver = useCallback(
    async (blob: Blob, extension: string, startTime: number) => {
      if (blob.size === 0) throw new Error("The microphone recording was empty.");
      setIsSaving(true);
      const beforeMediaIds = new Set(
        useProjectStore.getState().project.mediaLibrary.items.map((item) => item.id),
      );
      const file = new File(
        [blob],
        `Voice-over ${new Date().toISOString().replace(/[:.]/g, "-")}.${extension}`,
        { type: blob.type, lastModified: Date.now() },
      );
      const importResult = await importMedia(file);
      if (!importResult.success) {
        throw new Error(importResult.error?.message ?? "无法导入录音。");
      }
      const mediaItem = useProjectStore
        .getState()
        .project.mediaLibrary.items.find((item) => !beforeMediaIds.has(item.id));
      if (!mediaItem) throw new Error("导入后找不到录制的音频。");

      const store = useProjectStore.getState();
      let voiceTrack = store.project.timeline.tracks.find(
        (track) =>
          !track.locked &&
          (track.role === "dialogue" || track.name === "配音"),
      );
      if (!voiceTrack) {
        const created = await store.addTrack("audio", 0, {
          role: "dialogue",
          name: "配音",
        });
        if (!created.success) {
          throw new Error(created.error?.message ?? "无法创建配音轨道。");
        }
        voiceTrack = useProjectStore
          .getState()
          .project.timeline.tracks.find(
            (track) => track.role === "dialogue" && track.clips.length === 0,
          );
      }
      if (!voiceTrack) throw new Error("无法找到配音轨道。");
      const addResult = await useProjectStore
        .getState()
        .addClip(voiceTrack.id, mediaItem.id, startTime);
      if (!addResult.success) {
        throw new Error(addResult.error?.message ?? "无法将配音添加到时间轴。");
      }
    },
    [importMedia],
  );

  const startRecording = useCallback(async () => {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("此浏览器不支持配音录音。");
      return;
    }
    const format = selectVoiceOverMimeType();
    if (!format) {
      setError("此浏览器不提供受支持的麦克风录音格式。");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      const recorder = new MediaRecorder(stream, {
        mimeType: format.mimeType,
        audioBitsPerSecond: 128_000,
      });
      const timelineStart = playheadPosition;
      chunksRef.current = [];
      saveRecordingRef.current = true;
      streamRef.current = stream;
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        setError("麦克风录音意外停止。");
      };
      recorder.onstop = () => {
        const shouldSave = saveRecordingRef.current;
        const blob = new Blob(chunksRef.current, { type: format.mimeType });
        chunksRef.current = [];
        releaseStream();
        setIsRecording(false);
        if (!shouldSave) return;
        void saveVoiceOver(blob, format.extension, timelineStart)
          .catch((reason) => {
            setError(reason instanceof Error ? reason.message : "无法保存配音。");
          })
          .finally(() => setIsSaving(false));
      };
      startedAtRef.current = Date.now();
      setElapsed(0);
      recorder.start(250);
      setIsRecording(true);
    } catch (reason) {
      releaseStream();
      setError(
        reason instanceof DOMException && reason.name === "NotAllowedError"
          ? "允许麦克风访问以录制配音。"
          : reason instanceof Error
            ? reason.message
            : "无法启动麦克风录音。",
      );
    }
  }, [playheadPosition, releaseStream, saveVoiceOver]);

  const stopRecording = () => {
    saveRecordingRef.current = true;
    recorderRef.current?.stop();
  };

  const handleRecordClick = useCallback(() => {
    if (countdown !== null || isRecording || isSaving) return;
    if (!useCountdown) {
      void startRecording();
      return;
    }
    setError(null);
    let remaining = 3;
    setCountdown(remaining);
    countdownTimerRef.current = window.setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        if (countdownTimerRef.current !== null) {
          window.clearInterval(countdownTimerRef.current);
          countdownTimerRef.current = null;
        }
        setCountdown(null);
        void startRecording();
      } else {
        setCountdown(remaining);
      }
    }, 1000);
  }, [countdown, isRecording, isSaving, startRecording, useCountdown]);

  return (
    <div className="space-y-3">
      <Card variant="muted" padding={3} className="flex items-center justify-between border border-border bg-bg-1">
        <div>
          <Text type="supporting" weight="bold" className="block text-[12px] text-fg">
            口播录音
          </Text>
          <Text type="supporting" color="secondary" className="block text-[11px]">
            从播放头 {playheadPosition.toFixed(1)}s 开始，自动保存到独立的「配音」轨道。
          </Text>
        </div>
        <span className={`font-mono text-sm ${isRecording ? "text-status-error" : "text-fg-2"}`}>
          {formatElapsed(elapsed)}
        </span>
      </Card>

      {countdown !== null && (
        <div
          role="status"
          aria-live="assertive"
          className="grid h-24 place-items-center rounded-2xl bg-accent-soft text-4xl font-semibold text-accent"
        >
          {countdown}
        </div>
      )}

      {error && (
        <Card variant="muted" padding={2} className="flex items-start gap-2 border border-status-error/30 bg-status-error/10">
          <AlertCircle size={15} className="mt-0.5 shrink-0 text-status-error" aria-hidden />
          <Text type="supporting" className="text-[11px] text-status-error">{error}</Text>
        </Card>
      )}

      {isRecording ? (
        <Button
          label="停止并添加到时间轴"
          icon={<Square size={13} aria-hidden />}
          variant="primary"
          size="md"
          onClick={stopRecording}
          className="w-full justify-center"
        />
      ) : (
        <Button
          label={countdown !== null ? "准备录音…" : isSaving ? "正在添加配音…" : "录制口播"}
          icon={<Mic size={14} aria-hidden />}
          variant="primary"
          size="md"
          onClick={handleRecordClick}
          isDisabled={isSaving || countdown !== null}
          className="w-full justify-center"
        />
      )}

      <div className="flex items-center justify-between gap-2">
        <Text type="supporting" color="secondary" className="text-[11px]">
          录制前 3 秒倒计时
        </Text>
        <Button
          label={useCountdown ? "已开启" : "已关闭"}
          size="sm"
          variant={useCountdown ? "primary" : "secondary"}
          onClick={() => setUseCountdown((value) => !value)}
          isDisabled={isRecording || countdown !== null}
        />
      </div>

      <Text type="supporting" color="secondary" className="block text-center text-[11px]">
        录制的音频保留在此项目中，并随其余混音一起导出。
      </Text>
    </div>
  );
};

export default VoiceOverPanel;
