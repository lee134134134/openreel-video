import {
  getBeatSyncEngine,
  type ClipTiming,
  type ClipInfo,
  type SyncProgress,
  type BeatSyncConfig,
  type BeatAnalysisResult,
  DEFAULT_BEAT_SYNC_CONFIG,
} from "@openreel/core";
import { loadAudioBuffer } from "../utils/load-audio-buffer";
import { useProjectStore } from "../stores/project-store";

export interface BeatSyncState {
  isProcessing: boolean;
  progress: SyncProgress | null;
  beatAnalysis: BeatAnalysisResult | null;
  selectedAudioClipId: string | null;
  selectedTrackIds: string[];
  clipsToSync: ClipInfo[];
  previewTimings: ClipTiming[];
  config: BeatSyncConfig;
  error: string | null;
}

type StateListener = (state: BeatSyncState) => void;

const initialState: BeatSyncState = {
  isProcessing: false,
  progress: null,
  beatAnalysis: null,
  selectedAudioClipId: null,
  selectedTrackIds: [],
  clipsToSync: [],
  previewTimings: [],
  config: DEFAULT_BEAT_SYNC_CONFIG,
  error: null,
};

export class BeatSyncBridge {
  private state: BeatSyncState = { ...initialState };
  private listeners: Set<StateListener> = new Set();
  private analysisVersion = 0;
  private analyzedSource = "";
  private previewSnapshot = "";
  private audioContext: AudioContext | null = null;

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  private setState(updates: Partial<BeatSyncState>): void {
    this.state = { ...this.state, ...updates };
    this.listeners.forEach((listener) => listener(this.state));
  }

  getState(): BeatSyncState {
    return this.state;
  }

  setSelectedAudioClip(clipId: string | null): void {
    this.analysisVersion++;
    this.analyzedSource = "";
    this.setState({
      selectedAudioClipId: clipId,
      isProcessing: false,
      progress: null,
      selectedTrackIds: [],
      clipsToSync: [],
      beatAnalysis: null,
      previewTimings: [],
      error: null,
    });
  }

  setSelectedTracks(trackIds: string[]): void {
    this.setState({ selectedTrackIds: trackIds, progress: null });
    this.updateClipsToSync();
    this.updatePreview();
  }

  toggleTrackSelection(trackId: string): void {
    const { selectedTrackIds } = this.state;
    const newIds = selectedTrackIds.includes(trackId)
      ? selectedTrackIds.filter((id) => id !== trackId)
      : [...selectedTrackIds, trackId];
    this.setSelectedTracks(newIds);
  }

  updateConfig(updates: Partial<BeatSyncConfig>): void {
    this.setState({
      config: { ...this.state.config, ...updates } as BeatSyncConfig,
      progress: null,
    });
    this.updateClipsToSync();
    this.updatePreview();
  }

  private updateClipsToSync(): void {
    const { selectedTrackIds } = this.state;
    const store = useProjectStore.getState();
    const { project } = store;

    const clips: ClipInfo[] = [];

    for (const track of project.timeline.tracks) {
      if (selectedTrackIds.includes(track.id) && !track.locked) {
        for (const clip of track.clips) {
          if (clip.id === this.state.selectedAudioClipId) continue;
          if (this.state.config.syncMode === "cut-to-beats" && store.getMediaItem(clip.mediaId)?.type !== "video") continue;
          clips.push({
            id: clip.id,
            startTime: clip.startTime,
            duration: clip.duration,
            trackId: track.id,
          });
        }
      }
    }

    this.setState({ clipsToSync: clips });
  }

  private updatePreview(): void {
    const { beatAnalysis, clipsToSync, config, selectedAudioClipId } = this.state;
    if (!beatAnalysis || clipsToSync.length === 0) {
      this.setState({ previewTimings: [] });
      return;
    }

    const store = useProjectStore.getState();
    const audioClip = selectedAudioClipId ? store.getClip(selectedAudioClipId) : null;
    const audioStartTime = audioClip?.startTime ?? 0;

    const engine = getBeatSyncEngine();
    try {
      const timings = engine.calculateSyncedTimings(
        clipsToSync,
        beatAnalysis,
        audioStartTime,
        config,
      );

      if (config.syncMode === "cut-to-beats") {
        for (const timing of timings) {
          const clip = store.getClip(timing.clipId)!;
          const track = store.project.timeline.tracks.find((candidate) => candidate.id === clip.trackId)!;
          if ((clip.speed ?? 1) !== 1 || clip.reversed || clip.speedKeyframes?.length || clip.freezeFrames?.length) {
            throw new Error("在按节拍剪辑前，请重置视频速度并取消定格帧。");
          }
          if (track.groupId || track.transitions.length) {
            throw new Error("在按节拍剪辑前，请取消轨道分组并移除转场。");
          }
          if (track.clips.some((other) => !timings.some((item) => item.clipId === other.id) &&
            other.startTime < timing.newStartTime + timing.newDuration &&
            other.startTime + other.duration > timing.newStartTime)) {
            throw new Error("其他片段占用了计划序列。请先将它们移到其他轨道。");
          }
        }
      }
      this.previewSnapshot = JSON.stringify(store.project.timeline);
      this.setState({ previewTimings: timings, error: null });
    } catch (error) {
      this.setState({ previewTimings: [], error: error instanceof Error ? error.message : "无法规划节拍剪辑" });
    }
  }

  private sourceSnapshot(): string {
    const store = useProjectStore.getState();
    const clip = this.state.selectedAudioClipId ? store.getClip(this.state.selectedAudioClipId) : null;
    return JSON.stringify([store.project.id, clip]);
  }

  refreshProject(): void {
    if (this.state.isProcessing) return;
    if (this.state.beatAnalysis && this.analyzedSource !== this.sourceSnapshot()) {
      this.setState({ beatAnalysis: null, previewTimings: [], progress: null,
        error: "音乐片段已更改。请重新检测节拍。" });
    }
    this.updateClipsToSync();
    this.updatePreview();
  }

  async analyzeBeats(): Promise<void> {
    if (this.state.isProcessing) return;
    const { selectedAudioClipId } = this.state;
    if (!selectedAudioClipId) {
      this.setState({ error: "未选择音频片段" });
      return;
    }

    const store = useProjectStore.getState();
    const clip = store.getClip(selectedAudioClipId);
    if (!clip) {
      this.setState({ error: "未找到片段" });
      return;
    }

    const mediaItem = store.getMediaItem(clip.mediaId);
    if (!mediaItem?.blob) {
      this.setState({ error: "未找到媒体数据" });
      return;
    }

    if ((clip.speed ?? 1) !== 1 || clip.reversed || clip.speedKeyframes?.length || clip.freezeFrames?.length) {
      this.setState({ error: "检测节拍前，请重置音乐速度并取消定格帧。" });
      return;
    }
    const version = ++this.analysisVersion;
    const sourceSnapshot = this.sourceSnapshot();
    this.setState({ isProcessing: true, error: null, beatAnalysis: null, previewTimings: [], progress: null });

    try {
      const audioBlob = await this.extractAudioFromBlob(
        mediaItem.blob,
        clip.inPoint ?? 0,
        Math.min(clip.outPoint, clip.inPoint + clip.duration),
        clip.audioTrackIndex ?? 0,
      );

      const engine = getBeatSyncEngine();
      const beatAnalysis = await engine.analyzeBeats(audioBlob, (progress) =>
        { if (version === this.analysisVersion) this.setState({ progress }); },
      );

      if (version !== this.analysisVersion) return;
      if (sourceSnapshot !== this.sourceSnapshot()) throw new Error("音乐片段已更改。请重新检测节拍。");
      if (beatAnalysis.beats.length < 2) throw new Error("未检测到可用的节拍。请尝试节奏更清晰的音乐片段。");
      this.analyzedSource = sourceSnapshot;
      this.setState({
        beatAnalysis,
        isProcessing: false,
        progress: null,
      });

      this.updatePreview();
    } catch (error) {
      if (version !== this.analysisVersion) return;
      this.setState({
        isProcessing: false,
        error: error instanceof Error ? error.message : "节拍分析失败",
        progress: null,
      });
    }
  }

  async applySync(): Promise<boolean> {
    if (this.state.isProcessing) return false;
    const { previewTimings, config } = this.state;
    if (previewTimings.length === 0) {
      this.setState({ error: "没有可同步的片段" });
      return false;
    }

    const store = useProjectStore.getState();

    if (this.analyzedSource !== this.sourceSnapshot() || this.previewSnapshot !== JSON.stringify(store.project.timeline)) {
      this.refreshProject();
      this.setState({ error: "时间线已更改。应用前请先查看刷新后的预览。" });
      return false;
    }
    this.setState({ isProcessing: true, error: null, progress: null });
    let applied = 0;
    store.beginHistoryGroup("将视频剪辑同步到节拍");
    try {
      for (const timing of previewTimings) {
        const moved = await store.moveClip(timing.clipId, timing.newStartTime);
        if (!moved.success) throw new Error(moved.error?.message ?? "无法移动片段");
        applied++;

        const clip = store.getClip(timing.clipId);
        if (clip && config.syncMode !== "preserve-duration") {
          const newOutPoint = (clip.inPoint ?? 0) + timing.newDuration;
          const trimmed = await store.trimClip(timing.clipId, clip.inPoint, newOutPoint);
          if (!trimmed.success) throw new Error(trimmed.error?.message ?? "无法修剪片段");
          applied++;
        }
      }

      store.endHistoryGroup();
      this.setState({
        previewTimings: [],
        isProcessing: false,
        progress: {
          phase: "complete",
          percent: 100,
          message: `已将 ${previewTimings.length} 个片段同步到节拍`,
        },
      });

      return true;
    } catch (error) {
      store.endHistoryGroup();
      if (applied > 0) await store.undo();
      this.setState({
        isProcessing: false,
        error: error instanceof Error ? error.message : "应用同步失败",
      });
      return false;
    }
  }

  getAvailableTracks(): Array<{ id: string; name: string; type: string; clipCount: number }> {
    const store = useProjectStore.getState();
    const { project } = store;
    const { selectedAudioClipId } = this.state;

    const audioClip = selectedAudioClipId ? store.getClip(selectedAudioClipId) : null;
    const audioTrackId = audioClip
      ? project.timeline.tracks.find((t) => t.clips.some((c) => c.id === selectedAudioClipId))?.id
      : null;

    return project.timeline.tracks
      .filter((track) => !track.locked && (this.state.config.syncMode === "cut-to-beats"
        ? track.clips.some((clip) => store.getMediaItem(clip.mediaId)?.type === "video")
        : track.id !== audioTrackId && track.clips.length > 0))
      .map((track) => ({
        id: track.id,
        name: track.name,
        type: track.type,
        clipCount: track.clips.filter((clip) => this.state.config.syncMode !== "cut-to-beats" || store.getMediaItem(clip.mediaId)?.type === "video").length,
      }));
  }

  private async extractAudioFromBlob(
    blob: Blob,
    inPoint: number,
    outPoint: number,
    audioTrackIndex: number,
  ): Promise<Blob> {
    if (!this.audioContext) {
      this.audioContext = new AudioContext();
    }

    const audioBuffer = await loadAudioBuffer(this.audioContext, blob, { audioTrackIndex });
    if (!audioBuffer) throw new Error("无法解码音乐片段。");

    const duration = Math.min(outPoint - inPoint, audioBuffer.duration - inPoint);
    if (duration <= 0) throw new Error("音乐片段在其修剪范围内没有音频。");
    const sampleRate = audioBuffer.sampleRate;
    const startSample = Math.floor(inPoint * sampleRate);
    const numSamples = Math.floor(duration * sampleRate);

    if (numSamples < 1) throw new Error("音乐片段太短，无法分析。");
    // Choose the strongest channel within the trim. This supports right-only
    // recordings and avoids cancelling phase-inverted stereo when downmixing.
    let sourceData = audioBuffer.getChannelData(0);
    let strongestEnergy = 0;
    for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
      const samples = audioBuffer.getChannelData(channel);
      let energy = 0;
      for (let i = startSample; i < startSample + numSamples; i++) {
        energy += samples[i] * samples[i];
      }
      if (energy > strongestEnergy) {
        strongestEnergy = energy;
        sourceData = samples;
      }
    }
    if (strongestEnergy / numSamples < 1e-10) {
      throw new Error("所选音乐范围为静音。请选择有声音的音乐范围。");
    }
    const trimmedBuffer = this.audioContext.createBuffer(1, numSamples, sampleRate);
    trimmedBuffer.getChannelData(0).set(sourceData.subarray(startSample, startSample + numSamples));
    return this.audioBufferToWav(trimmedBuffer);
  }

  private audioBufferToWav(buffer: AudioBuffer): Blob {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const format = 1;
    const bitDepth = 16;

    const bytesPerSample = bitDepth / 8;
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = buffer.length * blockAlign;
    const headerSize = 44;
    const totalSize = headerSize + dataSize;

    const arrayBuffer = new ArrayBuffer(totalSize);
    const view = new DataView(arrayBuffer);

    const writeString = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    writeString(0, "RIFF");
    view.setUint32(4, totalSize - 8, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, format, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);
    writeString(36, "data");
    view.setUint32(40, dataSize, true);

    const channelDataArr = buffer.getChannelData(0);
    let offset = 44;
    for (let i = 0; i < buffer.length; i++) {
      const sample = Math.max(-1, Math.min(1, channelDataArr[i]));
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, intSample, true);
      offset += 2;
    }

    return new Blob([arrayBuffer], { type: "audio/wav" });
  }

  reset(): void {
    this.analysisVersion++;
    this.setState({ ...initialState });
  }

  dispose(): void {
    this.analysisVersion++;
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    this.listeners.clear();
  }
}

let bridgeInstance: BeatSyncBridge | null = null;

export function getBeatSyncBridge(): BeatSyncBridge {
  if (!bridgeInstance) {
    bridgeInstance = new BeatSyncBridge();
  }
  return bridgeInstance;
}

export function disposeBeatSyncBridge(): void {
  if (bridgeInstance) {
    bridgeInstance.dispose();
    bridgeInstance = null;
  }
}

export { DEFAULT_BEAT_SYNC_CONFIG, type BeatSyncConfig, type ClipTiming, type BeatAnalysisResult };
