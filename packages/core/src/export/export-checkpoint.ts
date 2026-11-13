/**
 * Resume checkpoints for segmented exports. Each checkpoint stores per-segment
 * encoded blobs (IndexedDB can store Blobs directly) so an interrupted export
 * skips completed segments on retry.
 */

export interface ExportCheckpoint {
  /** Stable id: hashExportSettings(settings) + ":" + projectId. */
  readonly key: string;
  readonly completedSegmentIndexes: number[];
  readonly segmentDurations: number[];
  /** Encoded segment blobs indexed by segment index (holes = pending). */
  readonly segmentBlobs: (Blob | null)[];
  readonly updatedAt: number;
}

export interface ExportCheckpointer {
  save(state: ExportCheckpoint): Promise<void>;
  load(key: string): Promise<ExportCheckpoint | null>;
  clear(key: string): Promise<void>;
}

/**
 * Stable serialization of export settings: keys are sorted so equal settings
 * produce equal hashes regardless of property order.
 */
export function hashExportSettings(settings: unknown): string {
  const seen = new WeakSet<object>();
  const stable = (value: unknown): unknown => {
    if (value === null || typeof value !== "object") {
      return typeof value === "number" ? Number(value.toFixed(6)) : value;
    }
    if (seen.has(value)) return "[circular]";
    seen.add(value);
    if (Array.isArray(value)) return value.map(stable);
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(entries.map(([k, v]) => [k, stable(v)]));
  };
  return JSON.stringify(stable(settings));
}

export function checkpointKey(settings: unknown, projectId: string): string {
  return `${hashExportSettings(settings)}:${projectId}`;
}

/** In-memory checkpointer for tests and ephemeral runs. */
export function createMemoryCheckpointer(): ExportCheckpointer {
  const store = new Map<string, ExportCheckpoint>();
  return {
    async save(state) {
      store.set(state.key, { ...state, segmentBlobs: [...state.segmentBlobs] });
    },
    async load(key) {
      const state = store.get(key);
      if (!state) return null;
      return { ...state, segmentBlobs: [...state.segmentBlobs] };
    },
    async clear(key) {
      store.delete(key);
    },
  };
}

interface MinimalIdbDatabase {
  transaction(
    storeNames: string | string[],
    mode?: IDBTransactionMode,
  ): {
    objectStore(name: string): {
      put(value: unknown, key?: string): IDBRequest;
      get(key: string): IDBRequest;
      delete(key: string): IDBRequest;
    };
  };
}

function openDatabase(dbName: string): Promise<MinimalIdbDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("checkpoints")) {
        request.result.createObjectStore("checkpoints");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
  });
}

function requestToPromise<T>(request: IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result as T);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

/** IndexedDB-backed checkpointer. Blobs are stored natively by IDB. */
export function createIdbCheckpointer(dbName = "openreel-export-checkpoints"): ExportCheckpointer {
  return {
    async save(state) {
      const db = await openDatabase(dbName);
      const tx = db.transaction("checkpoints", "readwrite");
      await requestToPromise(
        tx.objectStore("checkpoints").put(state, state.key) as unknown as IDBRequest,
      );
    },
    async load(key) {
      const db = await openDatabase(dbName);
      const tx = db.transaction("checkpoints", "readonly");
      const value = await requestToPromise<ExportCheckpoint | undefined>(
        tx.objectStore("checkpoints").get(key) as unknown as IDBRequest,
      );
      return value ?? null;
    },
    async clear(key) {
      const db = await openDatabase(dbName);
      const tx = db.transaction("checkpoints", "readwrite");
      await requestToPromise(
        tx.objectStore("checkpoints").delete(key) as unknown as IDBRequest,
      );
    },
  };
}
