export interface AudioLoadProgress {
  stage: "extracting" | "decoding";
  progress: number;
  message: string;
}

export interface LoadAudioBufferOptions {
  audioTrackIndex?: number;
  onProgress?: (progress: AudioLoadProgress) => void;
}

export const loadAudioBuffer = async (
  audioContext: AudioContext | BaseAudioContext,
  blob: Blob,
  options: LoadAudioBufferOptions = {},
): Promise<AudioBuffer | null> => {
  const audioTrackIndex = options.audioTrackIndex ?? 0;

  try {
    const { extractAudioWav } = await import("@openreel/core/media");
    options.onProgress?.({
      stage: "extracting",
      progress: 0.08,
      message: "正在提取音轨",
    });
    const wavBlob = await extractAudioWav(blob, audioTrackIndex, {
      onProgress: (progress) => {
        options.onProgress?.({
          stage: "extracting",
          progress: Math.min(0.82, 0.08 + progress.progress * 0.72),
          message: "正在提取音轨",
        });
      },
    });
    options.onProgress?.({
      stage: "decoding",
      progress: 0.88,
      message: "正在解码提取的音频",
    });
    const arrayBuffer = await wavBlob.arrayBuffer();
    const decoded = await audioContext.decodeAudioData(arrayBuffer);
    options.onProgress?.({
      stage: "decoding",
      progress: 1,
      message: "音频已准备好分析",
    });
    return decoded;
  } catch {
    options.onProgress?.({
      stage: "decoding",
      progress: 0.45,
      message: "回退到源音频解码",
    });
  }

  if (audioTrackIndex === 0) {
    try {
      options.onProgress?.({
        stage: "decoding",
        progress: 0.55,
        message: "正在解码源音频",
      });
      const arrayBuffer = await blob.arrayBuffer();
      const decoded = await audioContext.decodeAudioData(arrayBuffer);
      options.onProgress?.({
        stage: "decoding",
        progress: 1,
        message: "音频已准备好分析",
      });
      return decoded;
    } catch {
      return null;
    }
  }

  return null;
};