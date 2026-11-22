import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

/**
 * Encrypt-at-rest helper for connector credentials (OAuth tokens, cookies,
 * API secrets) kept in the `plugin_state.credentials` column.
 *
 * Format: `enc:v1:<salt>:<iv>:<tag>:<ciphertext>` (all base64). The key is
 * derived from OPENREEL_SECRET with scrypt, and every write gets a fresh
 * salt/IV so identical payloads never produce identical rows.
 *
 * Rows written before this existed are plain JSON. They stay readable
 * (`isEncrypted` is false → parse as-is) and get re-encrypted on the next
 * write, so no migration step is required.
 */
const PREFIX = "enc:v1:";
const SALT_BYTES = 16;
const IV_BYTES = 12;
const KEY_BYTES = 32;

export class SecretBoxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretBoxError";
  }
}

function deriveKey(secret: string, salt: Buffer): Buffer {
  return scryptSync(secret, salt, KEY_BYTES);
}

/** scrypt is deliberately slow (~100-250 ms). Credential rows are read
 * repeatedly by plugin contexts, so memoize derived keys per (secret, salt).
 * The cache is tiny and FIFO-capped: one entry per stored row. */
const KEY_CACHE = new Map<string, Buffer>();
const KEY_CACHE_LIMIT = 64;

function keyFor(secret: string, salt: Buffer): Buffer {
  const cacheKey = `${secret}\u0000${salt.toString("base64")}`;
  const cached = KEY_CACHE.get(cacheKey);
  if (cached) return cached;
  const key = deriveKey(secret, salt);
  if (KEY_CACHE.size >= KEY_CACHE_LIMIT) {
    const oldest = KEY_CACHE.keys().next().value;
    if (oldest !== undefined) KEY_CACHE.delete(oldest);
  }
  KEY_CACHE.set(cacheKey, key);
  return key;
}

/** SettingsService already defaults to "dev-secret"; this keeps partially
 * constructed services (tests, embedders) working instead of crashing on a
 * missing secret. An empty OPENREEL_SECRET lands on the same default. */
function normalizeSecret(secret: string | undefined): string {
  return secret && secret.trim() ? secret : "dev-secret";
}

export function isEncrypted(payload: string): boolean {
  return payload.startsWith(PREFIX);
}

export function encryptJson(value: unknown, secret: string): string {
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", keyFor(normalizeSecret(secret), salt), iv);
  const plaintext = Buffer.from(JSON.stringify(value ?? {}), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    PREFIX + salt.toString("base64"),
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

/**
 * Decrypt a credentials column value. Plaintext legacy rows are parsed as
 * JSON. A row that looks encrypted but cannot be opened (wrong
 * OPENREEL_SECRET, tampered data) throws SecretBoxError — silently returning
 * `{}` would look like "no credentials" and send users chasing the wrong bug.
 */
export function decryptJson(payload: string, secret: string): Record<string, unknown> {
  const raw = String(payload ?? "").trim();
  if (!raw) return {};
  if (!isEncrypted(raw)) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  const parts = raw.slice(PREFIX.length).split(":");
  if (parts.length !== 4) throw new SecretBoxError("凭据密文格式不正确");
  const [saltB64, ivB64, tagB64, dataB64] = parts;
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      keyFor(normalizeSecret(secret), Buffer.from(saltB64, "base64")),
      Buffer.from(ivB64, "base64"),
    );
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64")),
      decipher.final(),
    ]).toString("utf8");
    const parsed = JSON.parse(plaintext) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    throw new SecretBoxError("凭据解密失败：OPENREEL_SECRET 与写入时不一致，或数据已损坏");
  }
}

/** Read a credentials column without throwing: unreadable rows degrade to {}
 * and are reported through `onError` so callers can log once and continue. */
export function decryptJsonSafe(
  payload: string,
  secret: string,
  onError?: (error: Error) => void,
): Record<string, unknown> {
  try {
    return decryptJson(payload, secret);
  } catch (err) {
    onError?.(err as Error);
    return {};
  }
}
