import { describe, expect, it } from "vitest";
import { decryptJson, decryptJsonSafe, encryptJson, isEncrypted, SecretBoxError } from "./secret-box";

const SECRET = "test-secret";

describe("secret-box", () => {
  it("round-trips arbitrary credential objects", () => {
    const value = { accessToken: "a b/c+=", cookie: "SESSDATA=中文", nested: { refresh: "r1" }, count: 3 };
    const sealed = encryptJson(value, SECRET);
    expect(isEncrypted(sealed)).toBe(true);
    expect(sealed).not.toContain("accessToken");
    expect(decryptJson(sealed, SECRET)).toEqual(value);
  });

  it("uses a fresh salt/iv so equal payloads produce different ciphertext", () => {
    const a = encryptJson({ apiKey: "k" }, SECRET);
    const b = encryptJson({ apiKey: "k" }, SECRET);
    expect(a).not.toBe(b);
    expect(decryptJson(a, SECRET)).toEqual(decryptJson(b, SECRET));
  });

  it("still reads legacy plaintext rows", () => {
    expect(decryptJson(JSON.stringify({ apiKey: "legacy" }), SECRET)).toEqual({ apiKey: "legacy" });
    expect(decryptJson("", SECRET)).toEqual({});
    expect(decryptJson("not json", SECRET)).toEqual({});
  });

  it("throws on a wrong secret instead of silently returning empty", () => {
    const sealed = encryptJson({ apiKey: "k" }, SECRET);
    expect(() => decryptJson(sealed, "other-secret")).toThrow(SecretBoxError);
  });

  it("detects tampering with the ciphertext", () => {
    const sealed = encryptJson({ apiKey: "k" }, SECRET);
    const parts = sealed.split(":");
    const data = Buffer.from(parts.at(-1)!, "base64");
    data[0] = data[0] ^ 0xff;
    const tampered = [...parts.slice(0, -1), data.toString("base64")].join(":");
    expect(() => decryptJson(tampered, SECRET)).toThrow(SecretBoxError);
  });

  it("degrades to {} through decryptJsonSafe and reports the error", () => {
    const seen: Error[] = [];
    const value = decryptJsonSafe(encryptJson({ apiKey: "k" }, SECRET), "wrong", (err) => seen.push(err));
    expect(value).toEqual({});
    expect(seen).toHaveLength(1);
  });
});
