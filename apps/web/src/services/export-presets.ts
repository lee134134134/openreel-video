import type { ExportPreset, AudioExportSettings } from "@openreel/core";

export interface PlatformExportPreset extends ExportPreset {
  platform: string;
  icon?: string;
  maxDuration?: number;
  maxFileSize?: number;
  aspectRatio?: string;
  recommended?: boolean;
}

const SOCIAL_MEDIA_PRESETS: PlatformExportPreset[] = [
  {
    id: "youtube-4k",
    name: "YouTube 4K",
    description: "YouTube 4K 最佳画质 - 50Mbps",
    platform: "YouTube",
    category: "social",
    aspectRatio: "16:9",
    recommended: true,
    settings: {
      format: "mp4",
      codec: "h264",
      width: 3840,
      height: 2160,
      frameRate: 30,
      bitrate: 50000,
      bitrateMode: "vbr",
      quality: 90,
      keyframeInterval: 60,
      audioSettings: {
        format: "aac",
        sampleRate: 48000,
        bitDepth: 16,
        bitrate: 384,
        channels: 2,
      },
    },
  },
  {
    id: "youtube-4k-60",
    name: "YouTube 4K 60fps",
    description: "4K 60fps，适合游戏/运动画面 - 65Mbps",
    platform: "YouTube",
    category: "social",
    aspectRatio: "16:9",
    settings: {
      format: "mp4",
      codec: "h264",
      width: 3840,
      height: 2160,
      frameRate: 60,
      bitrate: 65000,
      bitrateMode: "vbr",
      quality: 90,
      keyframeInterval: 60,
      audioSettings: {
        format: "aac",
        sampleRate: 48000,
        bitDepth: 16,
        bitrate: 384,
        channels: 2,
      },
    },
  },
  {
    id: "youtube-1080p",
    name: "YouTube 1080p HD",
    description: "YouTube 标准高清画质",
    platform: "YouTube",
    category: "social",
    aspectRatio: "16:9",
    settings: {
      format: "mp4",
      codec: "h264",
      width: 1920,
      height: 1080,
      frameRate: 30,
      bitrate: 8000,
      bitrateMode: "vbr",
      quality: 85,
      keyframeInterval: 60,
      audioSettings: {
        format: "aac",
        sampleRate: 48000,
        bitDepth: 16,
        bitrate: 256,
        channels: 2,
      },
    },
  },
  {
    id: "youtube-shorts",
    name: "YouTube Shorts",
    description: "YouTube Shorts 竖版格式（最长 60 秒）",
    platform: "YouTube",
    category: "social",
    aspectRatio: "9:16",
    maxDuration: 60,
    settings: {
      format: "mp4",
      codec: "h264",
      width: 1080,
      height: 1920,
      frameRate: 60,
      bitrate: 12000,
      bitrateMode: "vbr",
      quality: 85,
      keyframeInterval: 60,
      audioSettings: {
        format: "aac",
        sampleRate: 48000,
        bitDepth: 16,
        bitrate: 256,
        channels: 2,
      },
    },
  },
  {
    id: "tiktok",
    name: "TikTok",
    description: "针对抖音优化（最长 3 分钟）",
    platform: "TikTok",
    category: "social",
    aspectRatio: "9:16",
    maxDuration: 180,
    maxFileSize: 287 * 1024 * 1024,
    recommended: true,
    settings: {
      format: "mp4",
      codec: "h264",
      width: 1080,
      height: 1920,
      frameRate: 60,
      bitrate: 10000,
      bitrateMode: "vbr",
      quality: 85,
      keyframeInterval: 30,
      audioSettings: {
        format: "aac",
        sampleRate: 44100,
        bitDepth: 16,
        bitrate: 192,
        channels: 2,
      },
    },
  },
  {
    id: "instagram-reels",
    name: "Instagram Reels",
    description: "Reels 竖版格式（最长 90 秒）",
    platform: "Instagram",
    category: "social",
    aspectRatio: "9:16",
    maxDuration: 90,
    settings: {
      format: "mp4",
      codec: "h264",
      width: 1080,
      height: 1920,
      frameRate: 30,
      bitrate: 8000,
      bitrateMode: "vbr",
      quality: 85,
      keyframeInterval: 60,
      audioSettings: {
        format: "aac",
        sampleRate: 44100,
        bitDepth: 16,
        bitrate: 192,
        channels: 2,
      },
    },
  },
  {
    id: "instagram-feed",
    name: "Instagram 信息流视频",
    description: "信息流方形格式（最长 60 秒）",
    platform: "Instagram",
    category: "social",
    aspectRatio: "1:1",
    maxDuration: 60,
    settings: {
      format: "mp4",
      codec: "h264",
      width: 1080,
      height: 1080,
      frameRate: 30,
      bitrate: 6000,
      bitrateMode: "vbr",
      quality: 85,
      keyframeInterval: 60,
      audioSettings: {
        format: "aac",
        sampleRate: 44100,
        bitDepth: 16,
        bitrate: 192,
        channels: 2,
      },
    },
  },
  {
    id: "instagram-story",
    name: "Instagram 故事",
    description: "快拍竖版格式（每段 15 秒）",
    platform: "Instagram",
    category: "social",
    aspectRatio: "9:16",
    maxDuration: 15,
    settings: {
      format: "mp4",
      codec: "h264",
      width: 1080,
      height: 1920,
      frameRate: 30,
      bitrate: 6000,
      bitrateMode: "vbr",
      quality: 80,
      keyframeInterval: 30,
      audioSettings: {
        format: "aac",
        sampleRate: 44100,
        bitDepth: 16,
        bitrate: 128,
        channels: 2,
      },
    },
  },
  {
    id: "twitter",
    name: "Twitter/X",
    description: "针对 Twitter 优化（最长 2 分 20 秒）",
    platform: "Twitter",
    category: "social",
    aspectRatio: "16:9",
    maxDuration: 140,
    maxFileSize: 512 * 1024 * 1024,
    settings: {
      format: "mp4",
      codec: "h264",
      width: 1920,
      height: 1080,
      frameRate: 30,
      bitrate: 8000,
      bitrateMode: "vbr",
      quality: 85,
      keyframeInterval: 60,
      audioSettings: {
        format: "aac",
        sampleRate: 44100,
        bitDepth: 16,
        bitrate: 192,
        channels: 2,
      },
    },
  },
  {
    id: "facebook-feed",
    name: "Facebook 信息流",
    description: "Facebook 信息流标准格式",
    platform: "Facebook",
    category: "social",
    aspectRatio: "16:9",
    settings: {
      format: "mp4",
      codec: "h264",
      width: 1920,
      height: 1080,
      frameRate: 30,
      bitrate: 8000,
      bitrateMode: "vbr",
      quality: 85,
      keyframeInterval: 60,
      audioSettings: {
        format: "aac",
        sampleRate: 48000,
        bitDepth: 16,
        bitrate: 192,
        channels: 2,
      },
    },
  },
  {
    id: "linkedin",
    name: "LinkedIn",
    description: "LinkedIn 职场格式（最长 10 分钟）",
    platform: "LinkedIn",
    category: "social",
    aspectRatio: "16:9",
    maxDuration: 600,
    maxFileSize: 5 * 1024 * 1024 * 1024,
    settings: {
      format: "mp4",
      codec: "h264",
      width: 1920,
      height: 1080,
      frameRate: 30,
      bitrate: 8000,
      bitrateMode: "vbr",
      quality: 85,
      keyframeInterval: 60,
      audioSettings: {
        format: "aac",
        sampleRate: 48000,
        bitDepth: 16,
        bitrate: 192,
        channels: 2,
      },
    },
  },
];

const BROADCAST_PRESETS: PlatformExportPreset[] = [
  {
    id: "broadcast-4k-master",
    name: "4K 母带画质",
    description: "最高画质 4K - 80Mbps H.265",
    platform: "广播",
    category: "broadcast",
    aspectRatio: "16:9",
    recommended: true,
    settings: {
      format: "mov",
      codec: "h265",
      width: 3840,
      height: 2160,
      frameRate: 30,
      bitrate: 80000,
      bitrateMode: "vbr",
      quality: 95,
      keyframeInterval: 30,
      audioSettings: {
        format: "aac",
        sampleRate: 48000,
        bitDepth: 24,
        bitrate: 320,
        channels: 2,
      },
    },
  },
  {
    id: "broadcast-4k-prores-hq",
    name: "4K ProRes HQ",
    description: "专业 ProRes，用于剪辑/母带",
    platform: "广播",
    category: "broadcast",
    aspectRatio: "16:9",
    settings: {
      format: "mov",
      codec: "prores",
      proresProfile: "hq",
      width: 3840,
      height: 2160,
      frameRate: 30,
      bitrate: 880000,
      bitrateMode: "cbr",
      quality: 100,
      keyframeInterval: 1,
      audioSettings: {
        format: "wav",
        sampleRate: 48000,
        bitDepth: 24,
        bitrate: 0,
        channels: 2,
      },
    },
  },
  {
    id: "broadcast-4k-prores-4444",
    name: "4K ProRes 4444",
    description: "最高画质 ProRes，支持透明通道",
    platform: "广播",
    category: "broadcast",
    aspectRatio: "16:9",
    settings: {
      format: "mov",
      codec: "prores",
      proresProfile: "4444",
      width: 3840,
      height: 2160,
      frameRate: 30,
      bitrate: 1320000,
      bitrateMode: "cbr",
      quality: 100,
      keyframeInterval: 1,
      audioSettings: {
        format: "wav",
        sampleRate: 48000,
        bitDepth: 24,
        bitrate: 0,
        channels: 2,
      },
    },
  },
  {
    id: "broadcast-4k-60",
    name: "4K 60fps 高动态",
    description: "4K 60fps，适合体育/游戏 - 65Mbps",
    platform: "广播",
    category: "broadcast",
    aspectRatio: "16:9",
    settings: {
      format: "mov",
      codec: "h265",
      width: 3840,
      height: 2160,
      frameRate: 60,
      bitrate: 65000,
      bitrateMode: "vbr",
      quality: 90,
      keyframeInterval: 60,
      audioSettings: {
        format: "aac",
        sampleRate: 48000,
        bitDepth: 24,
        bitrate: 320,
        channels: 2,
      },
    },
  },
  {
    id: "broadcast-4k",
    name: "广播级 4K UHD",
    description: "4K 广播级画质 - 50Mbps",
    platform: "广播",
    category: "broadcast",
    aspectRatio: "16:9",
    settings: {
      format: "mov",
      codec: "h264",
      width: 3840,
      height: 2160,
      frameRate: 30,
      bitrate: 50000,
      bitrateMode: "cbr",
      quality: 90,
      keyframeInterval: 30,
      audioSettings: {
        format: "aac",
        sampleRate: 48000,
        bitDepth: 24,
        bitrate: 320,
        channels: 2,
      },
    },
  },
  {
    id: "broadcast-1080p-high",
    name: "1080p 高质量",
    description: "高码率 1080p - 20Mbps",
    platform: "广播",
    category: "broadcast",
    aspectRatio: "16:9",
    settings: {
      format: "mov",
      codec: "h264",
      width: 1920,
      height: 1080,
      frameRate: 30,
      bitrate: 20000,
      bitrateMode: "vbr",
      quality: 95,
      keyframeInterval: 30,
      audioSettings: {
        format: "aac",
        sampleRate: 48000,
        bitDepth: 24,
        bitrate: 320,
        channels: 2,
      },
    },
  },
  {
    id: "broadcast-1080p-prores",
    name: "1080p ProRes HQ",
    description: "用于 1080p 剪辑的 ProRes HQ",
    platform: "广播",
    category: "broadcast",
    aspectRatio: "16:9",
    settings: {
      format: "mov",
      codec: "prores",
      proresProfile: "hq",
      width: 1920,
      height: 1080,
      frameRate: 30,
      bitrate: 220000,
      bitrateMode: "cbr",
      quality: 100,
      keyframeInterval: 1,
      audioSettings: {
        format: "wav",
        sampleRate: 48000,
        bitDepth: 24,
        bitrate: 0,
        channels: 2,
      },
    },
  },
  {
    id: "broadcast-hd",
    name: "广播级 HD 1080p",
    description: "标准广播级画质",
    platform: "广播",
    category: "broadcast",
    aspectRatio: "16:9",
    settings: {
      format: "mov",
      codec: "h264",
      width: 1920,
      height: 1080,
      frameRate: 30,
      bitrate: 12000,
      bitrateMode: "cbr",
      quality: 85,
      keyframeInterval: 30,
      audioSettings: {
        format: "aac",
        sampleRate: 48000,
        bitDepth: 24,
        bitrate: 320,
        channels: 2,
      },
    },
  },
];

const WEB_PRESETS: PlatformExportPreset[] = [
  {
    id: "web-hd",
    name: "网页 HD",
    description: "适合网页嵌入的均衡画质",
    platform: "网络",
    category: "web",
    aspectRatio: "16:9",
    recommended: true,
    settings: {
      format: "mp4",
      codec: "h264",
      width: 1920,
      height: 1080,
      frameRate: 30,
      bitrate: 5000,
      bitrateMode: "vbr",
      quality: 80,
      keyframeInterval: 60,
      audioSettings: {
        format: "aac",
        sampleRate: 44100,
        bitDepth: 16,
        bitrate: 128,
        channels: 2,
      },
    },
  },
  {
    id: "web-small",
    name: "网页优化",
    description: "更小的文件体积，加载更快",
    platform: "网络",
    category: "web",
    aspectRatio: "16:9",
    settings: {
      format: "mp4",
      codec: "h264",
      width: 1280,
      height: 720,
      frameRate: 30,
      bitrate: 2500,
      bitrateMode: "vbr",
      quality: 75,
      keyframeInterval: 90,
      audioSettings: {
        format: "aac",
        sampleRate: 44100,
        bitDepth: 16,
        bitrate: 96,
        channels: 2,
      },
    },
  },
  {
    id: "webm-vp9",
    name: "WebM VP9",
    description: "现代网页格式，VP9 编码（建议 720p）",
    platform: "网络",
    category: "web",
    aspectRatio: "16:9",
    settings: {
      format: "webm",
      codec: "vp9",
      width: 1280,
      height: 720,
      frameRate: 30,
      bitrate: 3000,
      bitrateMode: "vbr",
      quality: 80,
      keyframeInterval: 60,
      audioSettings: {
        format: "aac",
        sampleRate: 48000,
        bitDepth: 16,
        bitrate: 128,
        channels: 2,
      },
    },
  },
];

const ARCHIVE_PRESETS: PlatformExportPreset[] = [
  {
    id: "archive-4k-prores",
    name: "归档 4K ProRes",
    description: "无损 4K ProRes，适合长期归档",
    platform: "归档",
    category: "archive",
    aspectRatio: "16:9",
    recommended: true,
    settings: {
      format: "mov",
      codec: "prores",
      proresProfile: "hq",
      width: 3840,
      height: 2160,
      frameRate: 30,
      bitrate: 880000,
      bitrateMode: "cbr",
      quality: 100,
      keyframeInterval: 1,
      audioSettings: {
        format: "wav",
        sampleRate: 96000,
        bitDepth: 24,
        bitrate: 0,
        channels: 2,
      },
    },
  },
  {
    id: "archive-master",
    name: "归档母带 H.265",
    description: "高质量 4K H.265 - 80Mbps",
    platform: "归档",
    category: "archive",
    aspectRatio: "16:9",
    settings: {
      format: "mov",
      codec: "h265",
      width: 3840,
      height: 2160,
      frameRate: 30,
      bitrate: 80000,
      bitrateMode: "vbr",
      quality: 95,
      keyframeInterval: 30,
      audioSettings: {
        format: "wav",
        sampleRate: 96000,
        bitDepth: 24,
        bitrate: 0,
        channels: 2,
      },
    },
  },
  {
    id: "archive-1080p-prores",
    name: "归档 1080p ProRes",
    description: "用于 1080p 归档的 ProRes HQ",
    platform: "归档",
    category: "archive",
    aspectRatio: "16:9",
    settings: {
      format: "mov",
      codec: "prores",
      proresProfile: "hq",
      width: 1920,
      height: 1080,
      frameRate: 30,
      bitrate: 220000,
      bitrateMode: "cbr",
      quality: 100,
      keyframeInterval: 1,
      audioSettings: {
        format: "wav",
        sampleRate: 48000,
        bitDepth: 24,
        bitrate: 0,
        channels: 2,
      },
    },
  },
  {
    id: "archive-proxy",
    name: "归档代理",
    description: "较低画质的代理文件，用于剪辑",
    platform: "归档",
    category: "archive",
    aspectRatio: "16:9",
    settings: {
      format: "mp4",
      codec: "h264",
      width: 1280,
      height: 720,
      frameRate: 30,
      bitrate: 3000,
      bitrateMode: "vbr",
      quality: 70,
      keyframeInterval: 30,
      audioSettings: {
        format: "aac",
        sampleRate: 48000,
        bitDepth: 16,
        bitrate: 128,
        channels: 2,
      },
    },
  },
];

const AUDIO_PRESETS: PlatformExportPreset[] = [
  {
    id: "audio-mp3-320",
    name: "MP3 高质量",
    description: "320kbps MP3，适合音乐",
    platform: "Audio",
    category: "custom",
    settings: {
      format: "mp3",
      sampleRate: 48000,
      bitDepth: 16,
      bitrate: 320,
      channels: 2,
    } as AudioExportSettings,
  },
  {
    id: "audio-wav",
    name: "WAV 无损",
    description: "未压缩 WAV 音频",
    platform: "Audio",
    category: "archive",
    settings: {
      format: "wav",
      sampleRate: 48000,
      bitDepth: 24,
      bitrate: 0,
      channels: 2,
    } as AudioExportSettings,
  },
  {
    id: "audio-aac",
    name: "AAC 高质量",
    description: "256kbps AAC，兼容性更好",
    platform: "Audio",
    category: "custom",
    settings: {
      format: "aac",
      sampleRate: 48000,
      bitDepth: 16,
      bitrate: 256,
      channels: 2,
    } as AudioExportSettings,
  },
];

export const ALL_EXPORT_PRESETS: PlatformExportPreset[] = [
  ...SOCIAL_MEDIA_PRESETS,
  ...BROADCAST_PRESETS,
  ...WEB_PRESETS,
  ...ARCHIVE_PRESETS,
  ...AUDIO_PRESETS,
];

const CUSTOM_PRESETS_KEY = "openreel-custom-export-presets";

class ExportPresetsManager {
  private customPresets: PlatformExportPreset[] = [];
  private listeners: Set<() => void> = new Set();

  constructor() {
    this.loadCustomPresets();
  }

  private loadCustomPresets(): void {
    try {
      const stored = localStorage.getItem(CUSTOM_PRESETS_KEY);
      if (stored) {
        this.customPresets = JSON.parse(stored);
      }
    } catch (error) {
      console.error("[ExportPresets] Failed to load custom presets:", error);
    }
  }

  private saveCustomPresets(): void {
    try {
      localStorage.setItem(
        CUSTOM_PRESETS_KEY,
        JSON.stringify(this.customPresets),
      );
    } catch (error) {
      console.error("[ExportPresets] Failed to save custom presets:", error);
    }
  }

  getAllPresets(): PlatformExportPreset[] {
    return [...ALL_EXPORT_PRESETS, ...this.customPresets];
  }

  getPresetsByCategory(
    category: ExportPreset["category"],
  ): PlatformExportPreset[] {
    return this.getAllPresets().filter((p) => p.category === category);
  }

  getPresetsByPlatform(platform: string): PlatformExportPreset[] {
    return this.getAllPresets().filter((p) => p.platform === platform);
  }

  getPreset(id: string): PlatformExportPreset | undefined {
    return this.getAllPresets().find((p) => p.id === id);
  }

  getRecommendedPresets(): PlatformExportPreset[] {
    return this.getAllPresets().filter((p) => p.recommended);
  }

  getPlatforms(): string[] {
    const platforms = new Set(this.getAllPresets().map((p) => p.platform));
    return Array.from(platforms);
  }

  addCustomPreset(
    preset: Omit<PlatformExportPreset, "id">,
  ): PlatformExportPreset {
    const newPreset: PlatformExportPreset = {
      ...preset,
      id: `custom-${Date.now()}`,
      category: "custom",
    };
    this.customPresets.push(newPreset);
    this.saveCustomPresets();
    this.notify();
    return newPreset;
  }

  updateCustomPreset(
    id: string,
    updates: Partial<PlatformExportPreset>,
  ): boolean {
    const index = this.customPresets.findIndex((p) => p.id === id);
    if (index === -1) return false;

    this.customPresets[index] = { ...this.customPresets[index], ...updates };
    this.saveCustomPresets();
    this.notify();
    return true;
  }

  deleteCustomPreset(id: string): boolean {
    const index = this.customPresets.findIndex((p) => p.id === id);
    if (index === -1) return false;

    this.customPresets.splice(index, 1);
    this.saveCustomPresets();
    this.notify();
    return true;
  }

  getCustomPresets(): PlatformExportPreset[] {
    return [...this.customPresets];
  }

  isCustomPreset(id: string): boolean {
    return id.startsWith("custom-");
  }

  duplicatePreset(id: string, newName: string): PlatformExportPreset | null {
    const preset = this.getPreset(id);
    if (!preset) return null;

    return this.addCustomPreset({
      ...preset,
      name: newName,
      platform: "自定义",
    });
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach((cb) => cb());
  }
}

export const exportPresetsManager = new ExportPresetsManager();
