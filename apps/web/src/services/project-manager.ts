import type { Project, ProjectSettings } from "@openreel/core";
import { normalizeProjectStoredFields } from "@openreel/core";
import { v4 as uuidv4 } from "uuid";

interface FilePickerAcceptType {
  description: string;
  accept: Record<string, string[]>;
}

interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: FilePickerAcceptType[];
}

interface OpenFilePickerOptions {
  types?: FilePickerAcceptType[];
  multiple?: boolean;
}

interface WindowWithFilePicker extends Window {
  showSaveFilePicker?: (
    options?: SaveFilePickerOptions,
  ) => Promise<FileSystemFileHandle>;
  showOpenFilePicker?: (
    options?: OpenFilePickerOptions,
  ) => Promise<FileSystemFileHandle[]>;
}

interface FileHandleWithPermissions extends FileSystemFileHandle {
  queryPermission?: (options: { mode: string }) => Promise<string>;
  requestPermission?: (options: { mode: string }) => Promise<string>;
}

type NativeFileRef = { kind: "native"; path: string };
type ProjectFileRef = FileSystemFileHandle | NativeFileRef;

function isDesktopFs(): boolean {
  return typeof window !== "undefined" && !!window.openreel?.fs;
}

function isNativeRef(ref: unknown): ref is NativeFileRef {
  return (
    !!ref &&
    typeof ref === "object" &&
    (ref as NativeFileRef).kind === "native"
  );
}

const PROJECT_DB_NAME = "openreel-projects";
const PROJECT_DB_VERSION = 1;
const PROJECTS_STORE = "projects";
const RECENT_STORE = "recent";
const MAX_RECENT_PROJECTS = 10;

export interface RecentProject {
  id: string;
  name: string;
  lastOpened: number;
  thumbnail?: string;
  fileHandle?: ProjectFileRef;
  duration?: number;
  trackCount?: number;
}

export interface ProjectTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  settings: Partial<ProjectSettings>;
  thumbnail?: string;
  tracks?: Array<{ type: string; name: string }>;
}

const DEFAULT_TEMPLATES: ProjectTemplate[] = [
  {
    id: "blank",
    name: "空白项目",
    description: "从零开始，不预置任何轨道",
    category: "General",
    settings: { width: 1920, height: 1080, frameRate: 30 },
  },
  {
    id: "youtube-landscape",
    name: "YouTube 横屏",
    description: "1920x1080 · 30fps · 标准 YouTube 格式",
    category: "Social Media",
    settings: { width: 1920, height: 1080, frameRate: 30 },
    tracks: [
      { type: "video", name: "主视频" },
      { type: "audio", name: "背景音乐" },
      { type: "audio", name: "旁白" },
    ],
  },
  {
    id: "youtube-short",
    name: "YouTube Shorts",
    description: "1080x1920 · 60fps · 竖屏短视频",
    category: "Social Media",
    settings: { width: 1080, height: 1920, frameRate: 60 },
    tracks: [
      { type: "video", name: "主视频" },
      { type: "audio", name: "声音" },
      { type: "text", name: "字幕" },
    ],
  },
  {
    id: "tiktok",
    name: "TikTok",
    description: "1080x1920 · 60fps · TikTok 优化格式",
    category: "Social Media",
    settings: { width: 1080, height: 1920, frameRate: 60 },
    tracks: [
      { type: "video", name: "主视频" },
      { type: "audio", name: "声音" },
    ],
  },
  {
    id: "instagram-reel",
    name: "Instagram Reels",
    description: "1080x1920 · 30fps · Instagram Reels 格式",
    category: "Social Media",
    settings: { width: 1080, height: 1920, frameRate: 30 },
    tracks: [
      { type: "video", name: "主视频" },
      { type: "audio", name: "声音" },
    ],
  },
  {
    id: "instagram-post",
    name: "Instagram 帖子",
    description: "1080x1080 · 30fps · 正方形帖子格式",
    category: "Social Media",
    settings: { width: 1080, height: 1080, frameRate: 30 },
    tracks: [{ type: "video", name: "主视频" }],
  },
  {
    id: "cinematic-4k",
    name: "电影级 4K",
    description: "3840x2160 · 24fps · 胶片质感",
    category: "Professional",
    settings: { width: 3840, height: 2160, frameRate: 24 },
    tracks: [
      { type: "video", name: "A 镜头" },
      { type: "video", name: "B 镜头" },
      { type: "audio", name: "对白" },
      { type: "audio", name: "音乐" },
      { type: "audio", name: "音效" },
    ],
  },
  {
    id: "podcast",
    name: "播客视频",
    description: "1920x1080 · 30fps · 以音频为主，带波形可视化",
    category: "Audio",
    settings: { width: 1920, height: 1080, frameRate: 30 },
    tracks: [
      { type: "video", name: "背景" },
      { type: "audio", name: "主持人" },
      { type: "audio", name: "嘉宾" },
      { type: "graphics", name: "波形" },
    ],
  },
  {
    id: "tutorial",
    name: "屏幕录制",
    description: "1920x1080 · 60fps · 适合教程录制",
    category: "Educational",
    settings: { width: 1920, height: 1080, frameRate: 60 },
    tracks: [
      { type: "video", name: "屏幕" },
      { type: "video", name: "摄像头" },
      { type: "audio", name: "解说" },
      { type: "text", name: "标注" },
    ],
  },
];

type ProjectManagerEvent = "recentUpdated" | "projectSaved" | "projectOpened";
type EventCallback = (data?: unknown) => void;

class ProjectManager {
  private db: IDBDatabase | null = null;
  private listeners: Map<ProjectManagerEvent, Set<EventCallback>> = new Map();
  private currentFileHandle: ProjectFileRef | null = null;

  private parseProjectContent(content: string): Project {
    const trimmed = content.trim();
    if (!trimmed) {
      throw new Error("项目文件为空");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      throw new Error(
        `无效的项目文件：${error instanceof Error ? error.message : "解析错误"}`,
      );
    }

    if (!parsed || typeof parsed !== "object") {
      throw new Error("无效的项目文件：应为 JSON 对象");
    }

    const candidate = parsed as Record<string, unknown>;
    const isWrapped =
      typeof candidate.version === "string" &&
      typeof candidate.project === "object" &&
      candidate.project !== null;

    const rawProject = (isWrapped ? candidate.project : parsed) as Project;
    if (typeof rawProject.id !== "string" || typeof rawProject.name !== "string") {
      throw new Error("无效的项目文件：缺少项目 id 或名称");
    }

    return normalizeProjectStoredFields(rawProject);
  }

  async initialize(): Promise<void> {
    this.db = await this.openDatabase();
  }

  private openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("浏览器不支持 IndexedDB"));
        return;
      }

      const request = indexedDB.open(PROJECT_DB_NAME, PROJECT_DB_VERSION);

      request.onerror = () => {
        reject(new Error(`Failed to open database: ${request.error?.message}`));
      };

      request.onsuccess = () => resolve(request.result);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        if (!db.objectStoreNames.contains(PROJECTS_STORE)) {
          db.createObjectStore(PROJECTS_STORE, { keyPath: "id" });
        }

        if (!db.objectStoreNames.contains(RECENT_STORE)) {
          const store = db.createObjectStore(RECENT_STORE, { keyPath: "id" });
          store.createIndex("lastOpened", "lastOpened", { unique: false });
        }
      };
    });
  }

  async createProject(
    options: {
      name?: string;
      templateId?: string;
      settings?: Partial<ProjectSettings>;
    } = {},
  ): Promise<Project> {
    const template = options.templateId
      ? DEFAULT_TEMPLATES.find((t) => t.id === options.templateId) ||
        DEFAULT_TEMPLATES[0]
      : DEFAULT_TEMPLATES[0];

    const settings: ProjectSettings = {
      width: 1920,
      height: 1080,
      frameRate: 30,
      sampleRate: 48000,
      channels: 2,
      ...template.settings,
      ...options.settings,
    };

    const tracks =
      template.tracks?.map((t, i) => ({
        id: `track-${Date.now()}-${i}`,
        type: t.type as "video" | "audio" | "image" | "text" | "graphics",
        name: t.name,
        clips: [],
        transitions: [],
        locked: false,
        hidden: false,
        muted: false,
        solo: false,
      })) || [];

    const project: Project = {
      id: uuidv4(),
      name: options.name || "Untitled Project",
      createdAt: Date.now(),
      modifiedAt: Date.now(),
      settings,
      timeline: {
        duration: 0,
        tracks,
        markers: [],
        subtitles: [],
      },
      mediaLibrary: {
        items: [],
      },
    };

    this.currentFileHandle = null;
    this.emit("projectOpened", { project });
    return project;
  }

  async saveProject(project: Project): Promise<boolean> {
    if (this.currentFileHandle) {
      return this.saveToFileHandle(project, this.currentFileHandle);
    }
    return this.saveProjectAs(project);
  }

  async saveProjectAs(project: Project): Promise<boolean> {
    if (isDesktopFs()) {
      const filePath = await window.openreel!.fs.showSaveDialog({
        defaultPath: `${project.name}.oreel`,
        filters: [{ name: "OpenReel Project", extensions: ["oreel", "json"] }],
      });
      if (!filePath) return false;
      await window.openreel!.fs.writeFile(
        filePath,
        JSON.stringify(project, null, 2),
      );
      this.currentFileHandle = { kind: "native", path: filePath };
      await this.addToRecent(project, this.currentFileHandle);
      this.emit("projectSaved", { project });
      return true;
    }

    if (!("showSaveFilePicker" in window)) {
      return this.downloadProject(project);
    }

    let handle: FileSystemFileHandle;
    try {
      const win = window as WindowWithFilePicker;
      handle = await win.showSaveFilePicker!({
        suggestedName: `${project.name}.oreel`,
        types: [
          {
            description: "OpenReel Project",
            accept: { "application/json": [".oreel", ".json"] },
          },
        ],
      });
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        return false;
      }
      console.warn(
        "[ProjectManager] showSaveFilePicker unavailable; falling back to download",
        error,
      );
      return this.downloadProject(project);
    }

    // Picker cancellation returns false. A selected file that fails to write
    // must reject so callers can distinguish failure and report it to the user.
    await this.saveToFileHandle(project, handle);
    this.currentFileHandle = handle;
    await this.addToRecent(project, handle);
    return true;
  }

  private async saveToFileHandle(
    project: Project,
    handle: ProjectFileRef,
  ): Promise<boolean> {
    const data = JSON.stringify(project, null, 2);
    if (isNativeRef(handle)) {
      await window.openreel!.fs.writeFile(handle.path, data);
      this.emit("projectSaved", { project });
      return true;
    }

    const writable = await handle.createWritable();
    try {
      await writable.write(data);
      await writable.close();
    } catch (error) {
      // Release the stream/lock and discard partial data when writing fails.
      await writable.abort().catch(() => {});
      throw error;
    }

    this.emit("projectSaved", { project });
    return true;
  }

  private downloadProject(project: Project): boolean {
    const data = JSON.stringify(project, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `${project.name}.oreel`;
    try {
      document.body.appendChild(a);
      a.click();
    } finally {
      a.remove();
      URL.revokeObjectURL(url);
    }

    this.emit("projectSaved", { project });
    return true;
  }

  async openProject(): Promise<Project | null> {
    if (isDesktopFs()) {
      const filePath = await window.openreel!.fs.showOpenDialog({
        filters: [{ name: "OpenReel Project", extensions: ["oreel", "json"] }],
      });
      if (!filePath) return null;
      const content = await window.openreel!.fs.readFile(filePath);
      let project: Project;
      try {
        project = this.parseProjectContent(content);
      } catch (error) {
        console.error("[ProjectManager] Open (native) failed:", error);
        return null;
      }
      this.currentFileHandle = { kind: "native", path: filePath };
      await this.addToRecent(project, this.currentFileHandle);
      this.emit("projectOpened", { project });
      return project;
    }

    if ("showOpenFilePicker" in window) {
      try {
        const win = window as WindowWithFilePicker;
        const [handle] = await win.showOpenFilePicker!({
          types: [
            {
              description: "OpenReel Project",
              accept: { "application/json": [".oreel", ".json"] },
            },
          ],
          multiple: false,
        });

        const file = await handle.getFile();
        const content = await file.text();
        const project = this.parseProjectContent(content);

        this.currentFileHandle = handle;
        await this.addToRecent(project, handle);
        this.emit("projectOpened", { project });

        return project;
      } catch (error) {
        if ((error as Error).name === "AbortError") {
          return null;
        }
        console.error("[ProjectManager] Open failed:", error);
        return null;
      }
    }

    return this.openProjectViaInput();
  }

  private openProjectViaInput(): Promise<Project | null> {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".oreel,.json";

      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) {
          resolve(null);
          return;
        }

        try {
          const content = await file.text();
          const project = this.parseProjectContent(content);
          await this.addToRecent(project);
          this.emit("projectOpened", { project });
          resolve(project);
        } catch (error) {
          console.error("[ProjectManager] Parse failed:", error);
          resolve(null);
        }
      };

      input.click();
    });
  }

  async openRecentProject(
    recentProject: RecentProject,
  ): Promise<Project | null> {
    if (recentProject.fileHandle) {
      if (isNativeRef(recentProject.fileHandle)) {
        try {
          const content = await window.openreel!.fs.readFile(
            recentProject.fileHandle.path,
          );
          const project = this.parseProjectContent(content);
          this.currentFileHandle = recentProject.fileHandle;
          await this.updateRecentTimestamp(recentProject.id);
          this.emit("projectOpened", { project });
          return project;
        } catch (error) {
          console.error("[ProjectManager] Open recent (native) failed:", error);
          await this.removeFromRecent(recentProject.id);
          return null;
        }
      }

      try {
        const handle = recentProject.fileHandle as FileHandleWithPermissions;
        const permission = await handle.queryPermission?.({ mode: "read" });
        if (permission !== "granted") {
          const request = await handle.requestPermission?.({ mode: "read" });
          if (request !== "granted") {
            return null;
          }
        }

        const file = await handle.getFile();
        const content = await file.text();
        const project = this.parseProjectContent(content);

        this.currentFileHandle = handle;
        await this.updateRecentTimestamp(recentProject.id);
        this.emit("projectOpened", { project });

        return project;
      } catch (error) {
        console.error("[ProjectManager] Open recent failed:", error);
        await this.removeFromRecent(recentProject.id);
        return null;
      }
    }

    return this.loadProjectFromDb(recentProject.id);
  }

  private async loadProjectFromDb(id: string): Promise<Project | null> {
    if (!this.db) return null;

    return new Promise((resolve) => {
      const tx = this.db!.transaction(PROJECTS_STORE, "readonly");
      const store = tx.objectStore(PROJECTS_STORE);
      const request = store.get(id);

      request.onsuccess = () => {
        const project = request.result as Project | undefined;
        if (project) {
          this.emit("projectOpened", { project });
        }
        resolve(project || null);
      };

      request.onerror = () => resolve(null);
    });
  }

  async getRecentProjects(): Promise<RecentProject[]> {
    if (!this.db) {
      await this.initialize();
    }

    return new Promise((resolve) => {
      if (!this.db) {
        resolve([]);
        return;
      }

      const tx = this.db.transaction(RECENT_STORE, "readonly");
      const store = tx.objectStore(RECENT_STORE);
      const index = store.index("lastOpened");
      const request = index.getAll();

      request.onsuccess = () => {
        const items = (request.result as RecentProject[])
          .sort((a, b) => b.lastOpened - a.lastOpened)
          .slice(0, MAX_RECENT_PROJECTS);
        resolve(items);
      };

      request.onerror = () => resolve([]);
    });
  }

  async addToRecent(
    project: Project,
    fileHandle?: ProjectFileRef,
  ): Promise<void> {
    if (!this.db) return;

    const recentProject: RecentProject = {
      id: project.id,
      name: project.name,
      lastOpened: Date.now(),
      fileHandle,
      duration: project.timeline.duration,
      trackCount: project.timeline.tracks.length,
    };

    return new Promise((resolve) => {
      const tx = this.db!.transaction(RECENT_STORE, "readwrite");
      const store = tx.objectStore(RECENT_STORE);
      store.put(recentProject);

      tx.oncomplete = () => {
        this.emit("recentUpdated");
        this.cleanupOldRecent();
        resolve();
      };

      tx.onerror = () => resolve();
    });
  }

  private async updateRecentTimestamp(id: string): Promise<void> {
    if (!this.db) return;

    return new Promise((resolve) => {
      const tx = this.db!.transaction(RECENT_STORE, "readwrite");
      const store = tx.objectStore(RECENT_STORE);
      const request = store.get(id);

      request.onsuccess = () => {
        const recent = request.result as RecentProject | undefined;
        if (recent) {
          recent.lastOpened = Date.now();
          store.put(recent);
        }
        resolve();
      };

      request.onerror = () => resolve();
    });
  }

  async removeFromRecent(id: string): Promise<void> {
    if (!this.db) return;

    return new Promise((resolve) => {
      const tx = this.db!.transaction(RECENT_STORE, "readwrite");
      const store = tx.objectStore(RECENT_STORE);
      store.delete(id);

      tx.oncomplete = () => {
        this.emit("recentUpdated");
        resolve();
      };

      tx.onerror = () => resolve();
    });
  }

  private async cleanupOldRecent(): Promise<void> {
    const recent = await this.getRecentProjects();
    if (recent.length > MAX_RECENT_PROJECTS) {
      const toRemove = recent.slice(MAX_RECENT_PROJECTS);
      for (const item of toRemove) {
        await this.removeFromRecent(item.id);
      }
    }
  }

  async clearRecentProjects(): Promise<void> {
    if (!this.db) return;

    return new Promise((resolve) => {
      const tx = this.db!.transaction(RECENT_STORE, "readwrite");
      const store = tx.objectStore(RECENT_STORE);
      store.clear();

      tx.oncomplete = () => {
        this.emit("recentUpdated");
        resolve();
      };

      tx.onerror = () => resolve();
    });
  }

  getTemplates(): ProjectTemplate[] {
    return [...DEFAULT_TEMPLATES];
  }

  getTemplatesByCategory(): Map<string, ProjectTemplate[]> {
    const map = new Map<string, ProjectTemplate[]>();
    for (const template of DEFAULT_TEMPLATES) {
      const existing = map.get(template.category) || [];
      existing.push(template);
      map.set(template.category, existing);
    }
    return map;
  }

  getCurrentFileHandle(): ProjectFileRef | null {
    return this.currentFileHandle;
  }

  /** Imported independent copies must not overwrite a previously opened file. */
  releaseCurrentFileHandle(): void {
    this.currentFileHandle = null;
  }

  hasUnsavedChanges(project: Project): boolean {
    const projectWithSavedAt = project as Project & { lastSavedAt?: number };
    return (
      !this.currentFileHandle ||
      project.modifiedAt > (projectWithSavedAt.lastSavedAt ?? 0)
    );
  }

  on(event: ProjectManagerEvent, callback: EventCallback): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
    return () => this.listeners.get(event)?.delete(callback);
  }

  private emit(event: ProjectManagerEvent, data?: unknown): void {
    this.listeners.get(event)?.forEach((cb) => {
      try {
        cb(data);
      } catch (error) {
        console.error("[ProjectManager] Event callback error:", error);
      }
    });
  }
}

export const projectManager = new ProjectManager();

export async function initializeProjectManager(): Promise<void> {
  await projectManager.initialize();
}
