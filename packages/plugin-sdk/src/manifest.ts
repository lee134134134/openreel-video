/**
 * Plugin manifest contract.
 *
 * A plugin is a directory (or npm package) containing `manifest.json` and
 * `index.js` (ESM) exporting an `OpenReelPlugin` default export.
 *
 * The NestJS server loads plugins from OPENREEL_PLUGIN_DIR (default: <repo>/plugins)
 * and each user-facing plugin contributes adapters to the server service registry.
 */

export type PluginCapability = "llm" | "tts" | "videogen" | "publish";

export interface PluginSettingField {
  key: string;
  label: string;
  /** Rendered as a generically editable form in the web Plugin Center. */
  type: "text" | "password" | "number" | "boolean" | "select";
  required?: boolean;
  default?: string | number | boolean;
  options?: Array<{ label: string; value: string }>;
  /** Optional placeholder / docs hint. */
  placeholder?: string;
}

export interface PluginManifest {
  id: string; // unique slug, e.g. "publish-youtube"
  name: string; // display name
  version: string; // semver
  description: string;
  author?: string;
  /** Server runtime requires matching major.minor abi; reject otherwise. */
  abi: string;
  capabilities: PluginCapability[];
  /** Credential fields the Plugin Center renders as a settings form. */
  settings?: PluginSettingField[];
  homepage?: string;
  license?: string;
}

/** Thrown when a plugin manifest is invalid. */
export class PluginManifestError extends Error {
  constructor(
    public readonly manifestId: string,
    issues: string[],
  ) {
    super(`Invalid manifest "${manifestId}": ${issues.join("; ")}`);
    this.name = "PluginManifestError";
  }
}

export function validateManifest(value: unknown): PluginManifest {
  const issues: string[] = [];
  const m = (value ?? {}) as Partial<PluginManifest>;
  if (typeof m.id !== "string" || !/^[a-z0-9][a-z0-9-]{1,63}$/.test(m.id)) {
    issues.push("id must be a slug string (^[a-z0-9][a-z0-9-]{1,63}$)");
  }
  if (typeof m.name !== "string" || m.name.length < 2) {
    issues.push("name must be a non-empty string");
  }
  if (typeof m.version !== "string" || !/^\d+\.\d+\.\d+/.test(m.version)) {
    issues.push("version must be semver");
  }
  if (typeof m.abi !== "string") {
    issues.push("abi is required");
  }
  if (!Array.isArray(m.capabilities) || m.capabilities.length === 0) {
    issues.push("capabilities must be a non-empty array");
  } else {
    const allowed: PluginCapability[] = ["llm", "tts", "videogen", "publish"];
    const bad = m.capabilities.filter((c) => !allowed.includes(c));
    if (bad.length) {
      issues.push(`unknown capabilities: ${bad.join(",")}`);
    }
  }
  if (issues.length) {
    throw new PluginManifestError(String(m.id ?? "?"), issues);
  }
  return value as PluginManifest;
}
