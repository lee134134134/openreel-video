import {
  DEFAULT_NOISE_REDUCTION,
  type NoiseReductionConfig,
  type NoiseReductionFocus,
  type NoiseProfileData,
} from "../../../bridges/audio-bridge-effects";

export interface NoiseReductionPreset {
  id: NoiseReductionFocus;
  label: string;
  description: string;
  config: NoiseReductionConfig;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const calculateMean = (values: number[]): number => {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const calculateStandardDeviation = (values: number[], mean: number): number => {
  if (values.length === 0) {
    return 0;
  }

  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    values.length;

  return Math.sqrt(variance);
};

const averageEnergyInRange = (
  profile: Pick<NoiseProfileData, "frequencyBins" | "magnitudes">,
  minFrequency: number,
  maxFrequency: number,
): number => {
  const energies: number[] = [];

  for (let index = 0; index < profile.frequencyBins.length; index += 1) {
    const frequency = profile.frequencyBins[index];
    const magnitude = profile.magnitudes[index];

    if (
      Number.isFinite(frequency) &&
      Number.isFinite(magnitude) &&
      magnitude > 0 &&
      frequency >= minFrequency &&
      frequency <= maxFrequency
    ) {
      energies.push(magnitude);
    }
  }

  return calculateMean(energies);
};

export const NOISE_REDUCTION_PRESETS: ReadonlyArray<NoiseReductionPreset> = [
  {
    id: "balanced",
    label: "均衡",
    description: "对中等房间噪声进行常规净化，不会处理过度。",
    config: {
      ...DEFAULT_NOISE_REDUCTION,
      threshold: -34,
      reduction: 0.56,
      attack: 10,
      release: 120,
      focus: "balanced",
    },
  },
  {
    id: "speech",
    label: "人声聚焦",
    description: "在降低嘶声和环境底噪的同时保持对白的存在感。",
    config: {
      ...DEFAULT_NOISE_REDUCTION,
      threshold: -36,
      reduction: 0.64,
      attack: 9,
      release: 130,
      focus: "speech",
    },
  },
  {
    id: "whiteNoise",
    label: "白噪声",
    description: "强力去除宽频嘶声，适用于风扇、空调、相机前置放大噪声和房间底噪。",
    config: {
      ...DEFAULT_NOISE_REDUCTION,
      threshold: -56,
      reduction: 0.92,
      attack: 6,
      release: 240,
      focus: "whiteNoise",
    },
  },
  {
    id: "music",
    label: "背景音乐",
    description: "压低背景音乐，同时让人声保持突出。",
    config: {
      ...DEFAULT_NOISE_REDUCTION,
      threshold: -48,
      reduction: 0.82,
      attack: 8,
      release: 220,
      focus: "music",
    },
  },
  {
    id: "heavy",
    label: "强噪声",
    description: "更强力的宽频降噪，适用于响亮的空调声、风扇声和街道环境声。",
    config: {
      ...DEFAULT_NOISE_REDUCTION,
      threshold: -42,
      reduction: 0.8,
      attack: 14,
      release: 190,
      focus: "heavy",
    },
  },
  {
    id: "wind",
    label: "风声与低频轰鸣",
    description: "针对低频轰鸣、操作噪声和户外风压。",
    config: {
      ...DEFAULT_NOISE_REDUCTION,
      threshold: -40,
      reduction: 0.74,
      attack: 8,
      release: 210,
      focus: "wind",
    },
  },
  {
    id: "hum",
    label: "电流声与空调噪声",
    description: "针对性净化电流嗡声、空调低频嗡鸣和电源线噪声。",
    config: {
      ...DEFAULT_NOISE_REDUCTION,
      threshold: -38,
      reduction: 0.7,
      attack: 12,
      release: 170,
      focus: "hum",
    },
  },
] as const;

export const getNoiseReductionPreset = (
  presetId: NoiseReductionFocus,
): NoiseReductionPreset =>
  NOISE_REDUCTION_PRESETS.find((preset) => preset.id === presetId) ??
  NOISE_REDUCTION_PRESETS[0];

export const suggestNoiseReductionPreset = (
  profile: Pick<NoiseProfileData, "frequencyBins" | "magnitudes">,
): NoiseReductionFocus => {
  const magnitudes = Array.from(profile.magnitudes).filter(
    (value) => Number.isFinite(value) && value > 0,
  );

  if (magnitudes.length === 0) {
    return DEFAULT_NOISE_REDUCTION.focus ?? "balanced";
  }

  const mean = calculateMean(magnitudes);
  const peak = Math.max(...magnitudes);
  const standardDeviation = calculateStandardDeviation(magnitudes, mean);
  const spectralFlatness = clamp(mean / Math.max(peak, 1e-6), 0, 1);
  const subLowEnergy = averageEnergyInRange(profile, 40, 140);
  const lowMidEnergy = averageEnergyInRange(profile, 180, 500);
  const musicFundamentalEnergy = averageEnergyInRange(profile, 180, 1200);
  const musicPresenceEnergy = averageEnergyInRange(profile, 1200, 5000);
  const lowEnergy = averageEnergyInRange(profile, 20, 180);
  const voiceEnergy = averageEnergyInRange(profile, 250, 4000);
  const airEnergy = averageEnergyInRange(profile, 6000, 18000);
  const lowBias = lowEnergy / Math.max(voiceEnergy, 1e-6);
  const airBias = airEnergy / Math.max(voiceEnergy, 1e-6);
  const musicBias =
    (musicFundamentalEnergy + musicPresenceEnergy) /
    Math.max(voiceEnergy * 2, 1e-6);
  const peakRatio = peak / Math.max(mean, 1e-6);
  const normalizedVariability = clamp(
    standardDeviation / Math.max(mean, 1e-6) / 3,
    0,
    1,
  );

  if (lowBias > 1.55) {
    if (
      (peakRatio > 5 && spectralFlatness < 0.35) ||
      (subLowEnergy > lowMidEnergy * 2.2 && peakRatio > 2.4)
    ) {
      return "hum";
    }

    return "wind";
  }

  if (airBias > 1.35) {
    return spectralFlatness > 0.45 ? "whiteNoise" : "speech";
  }

  if (spectralFlatness > 0.62 || normalizedVariability < 0.18) {
    return "whiteNoise";
  }

  if (
    musicBias > 0.72 &&
    peakRatio > 2.1 &&
    normalizedVariability > 0.22 &&
    lowBias < 1.45 &&
    airBias < 1.45
  ) {
    return "music";
  }

  if (spectralFlatness > 0.5 || normalizedVariability < 0.28) {
    return "heavy";
  }

  if (peakRatio > 5.5 && lowBias > 0.9) {
    return "hum";
  }

  return "speech";
};

export const suggestNoiseReductionConfig = (
  profile: Pick<NoiseProfileData, "frequencyBins" | "magnitudes">,
): NoiseReductionConfig => {
  const magnitudes = Array.from(profile.magnitudes).filter(
    (value) => Number.isFinite(value) && value > 0,
  );

  if (magnitudes.length === 0) {
    return DEFAULT_NOISE_REDUCTION;
  }

  const preset = getNoiseReductionPreset(suggestNoiseReductionPreset(profile));
  const mean = calculateMean(magnitudes);
  const peak = Math.max(...magnitudes);
  const standardDeviation = calculateStandardDeviation(magnitudes, mean);
  const spectralFlatness = clamp(mean / Math.max(peak, 1e-6), 0, 1);
  const normalizedVariability = clamp(
    standardDeviation / Math.max(mean, 1e-6) / 3,
    0,
    1,
  );
  const lowBias =
    averageEnergyInRange(profile, 20, 180) /
    Math.max(averageEnergyInRange(profile, 250, 4000), 1e-6);
  const airBias =
    averageEnergyInRange(profile, 6000, 18000) /
    Math.max(averageEnergyInRange(profile, 250, 4000), 1e-6);
  const musicBias =
    (averageEnergyInRange(profile, 180, 1200) +
      averageEnergyInRange(profile, 1200, 5000)) /
    Math.max(averageEnergyInRange(profile, 250, 4000) * 2, 1e-6);

  return {
    ...preset.config,
    threshold: clamp(
      preset.config.threshold +
        spectralFlatness * 6 +
        normalizedVariability * 4 +
        Math.max(0, airBias - 1) * 4 -
        Math.max(0, lowBias - 1) * 2 -
        Math.max(0, musicBias - 0.7) * 3,
      -64,
      -18,
    ),
    reduction: clamp(
      preset.config.reduction +
        spectralFlatness * 0.1 +
        normalizedVariability * 0.05 +
        Math.max(0, airBias - 1) * 0.05 +
        Math.max(0, lowBias - 1) * 0.03 +
        Math.max(0, musicBias - 0.7) * 0.04,
      0.35,
      0.97,
    ),
    attack: clamp(
      (preset.config.attack ?? DEFAULT_NOISE_REDUCTION.attack ?? 10) +
        normalizedVariability * 12 -
        spectralFlatness * 5,
      5,
      35,
    ),
    release: clamp(
      (preset.config.release ?? DEFAULT_NOISE_REDUCTION.release ?? 100) +
        spectralFlatness * 40 +
        Math.max(0, lowBias - 1) * 30,
      60,
      260,
    ),
    focus: preset.config.focus,
  };
};