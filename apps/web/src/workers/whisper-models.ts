export type WhisperModelKey = "accurate" | "fast";

export interface WhisperModelDefinition {
  readonly id: string;
  readonly label: string;
  readonly shortLabel: string;
  readonly downloadSize: string;
  readonly description: string;
}

export const WHISPER_MODELS: Record<WhisperModelKey, WhisperModelDefinition> = {
  accurate: {
    id: "onnx-community/whisper-large-v3-turbo_timestamped",
    label: "精准 · Large V3 Turbo",
    shortLabel: "Large V3 Turbo",
    downloadSize: "约 760 MB",
    description: "本地精度最佳；建议使用 WebGPU",
  },
  fast: {
    id: "onnx-community/whisper-tiny",
    label: "快速 · Whisper Tiny",
    shortLabel: "Whisper Tiny",
    downloadSize: "约 100 MB",
    description: "草稿和低内存设备的最快选择",
  },
};

export const DEFAULT_WHISPER_MODEL: WhisperModelKey = "accurate";

export function isWhisperModelKey(value: unknown): value is WhisperModelKey {
  return value === "accurate" || value === "fast";
}
