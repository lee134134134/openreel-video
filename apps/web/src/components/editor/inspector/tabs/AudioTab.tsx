import React from "react";
import { Music, Mic } from "@/icons/lucide-compat";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { useProjectStore } from "../../../../stores/project-store";
import {
  AutoCutSilenceSection,
  AudioTextSyncPanel,
  NoiseReductionSection,
  AudioEffectsSection,
  AudioDuckingSection,
} from "../";
import { VoiceOverPanel } from "../VoiceOverPanel";
import { InspectorSection } from "../shell/InspectorSection";
import { PropertySlider } from "../shell/PropertySlider";

export interface AudioTabProps {
  clipId: string;
  clipType: string | null;
  showAudioEffects: boolean;
  noiseReductionSectionTitle: string;
  selectedNoiseReductionEffect: unknown;
}

export const AudioTab: React.FC<AudioTabProps> = ({
  clipId,
  clipType,
  showAudioEffects,
  noiseReductionSectionTitle,
  selectedNoiseReductionEffect,
}) => {
  const clip = useProjectStore((state) =>
    state.project.timeline.tracks
      .flatMap((track) => track.clips)
      .find((candidate) => candidate.id === clipId),
  );
  const trackRole = useProjectStore((state) =>
    state.project.timeline.tracks.find((track) => track.id === clip?.trackId)?.role,
  );

  const updateAudio = React.useCallback(
    (type: "audio/setVolume" | "audio/setFade", params: Record<string, unknown>) => {
      void useProjectStore.getState().executeAction({
        type,
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        params: { clipId, ...params },
      });
    },
    [clipId],
  );

  return (
    <>
      {(trackRole === "music" || trackRole === "dialogue") && (
        <Card variant="muted" padding={3} className="border border-border bg-bg-1">
          <div className="flex items-start gap-2">
            {trackRole === "music" ? (
              <Music size={15} className="mt-0.5 shrink-0 text-accent" aria-hidden />
            ) : (
              <Mic size={15} className="mt-0.5 shrink-0 text-accent" aria-hidden />
            )}
            <Text type="supporting" color="secondary" className="text-[11px] leading-relaxed">
              {trackRole === "music"
                ? "背景音乐轨：建议音量 35% 左右，并开启「音频闪避」，让口播和字幕旁白更清晰。"
                : "配音轨：可继续裁剪片段，或在下方调整音量、降噪与音频闪避。"}
            </Text>
          </div>
        </Card>
      )}
      {showAudioEffects && (
        <InspectorSection title="配音" sectionId="voice-over" defaultOpen={false}>
          <VoiceOverPanel />
        </InspectorSection>
      )}
      {showAudioEffects && clip && (
        <InspectorSection title="片段音频" sectionId="clip-audio" defaultOpen>
          <div className="space-y-4">
            <PropertySlider
              label="音量"
              value={clip.volume * 100}
              onChange={(value) => updateAudio("audio/setVolume", { volume: value / 100 })}
              min={0}
              max={400}
              step={1}
              formatValue={(value) => `${Math.round(value)}%`}
            />
            <PropertySlider
              label="淡入"
              value={clip.fade?.fadeIn ?? 0}
              onChange={(fadeIn) => updateAudio("audio/setFade", { fadeIn })}
              min={0}
              max={Math.max(0, clip.duration / 2)}
              step={0.1}
              formatValue={(value) => `${value.toFixed(1)}s`}
            />
            <PropertySlider
              label="淡出"
              value={clip.fade?.fadeOut ?? 0}
              onChange={(fadeOut) => updateAudio("audio/setFade", { fadeOut })}
              min={0}
              max={Math.max(0, clip.duration / 2)}
              step={0.1}
              formatValue={(value) => `${value.toFixed(1)}s`}
            />
          </div>
        </InspectorSection>
      )}
      {showAudioEffects && (
        <InspectorSection
          title="自动剪切静音"
          sectionId="auto-cut-silence"
          defaultOpen={false}
        >
          <AutoCutSilenceSection clipId={clipId} />
        </InspectorSection>
      )}
      {clipType === "audio" && (
        <InspectorSection title="节拍同步" sectionId="beat-sync" defaultOpen={false}>
          <AudioTextSyncPanel clipId={clipId} />
        </InspectorSection>
      )}
      {showAudioEffects && (
        <InspectorSection
          title={noiseReductionSectionTitle}
          sectionId="background-noise-removal"
          defaultOpen={Boolean(selectedNoiseReductionEffect)}
        >
          <NoiseReductionSection clipId={clipId} />
        </InspectorSection>
      )}
      {showAudioEffects && (
        <>
          <InspectorSection
            title="音频效果"
            sectionId="audio-effects"
            defaultOpen={false}
          >
            <AudioEffectsSection clipId={clipId} />
          </InspectorSection>
        </>
      )}
      {showAudioEffects && (
        <InspectorSection
          title="音频闪避"
          sectionId="audio-ducking"
          defaultOpen={false}
        >
          <AudioDuckingSection clipId={clipId} />
        </InspectorSection>
      )}
    </>
  );
};
