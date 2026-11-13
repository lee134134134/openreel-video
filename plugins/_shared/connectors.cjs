/**
 * Shared helpers for OpenReel publish connector plugins.
 * underscore-prefixed dirs are skipped by the plugin loader; this file is
 * imported by the六个连接器 via `../_shared/connectors.cjs`.
 */
const { createHmac, randomUUID } = require("node:crypto");
const { statSync, createReadStream, openSync, readSync, closeSync } = require("node:fs");

/** Missing-credential guard: throws an actionable Chinese error. */
function assertCredentials(creds = {}, required = []) {
  const missing = required.filter((k) => {
    const v = creds[k];
    return v === undefined || v === null || String(v).trim() === "";
  });
  if (missing.length) {
    throw new Error(
      `缺少凭据字段: ${missing.join(", ")}。请打开 OpenReel 的「插件中心」填写该平台的设置，或通过环境变量 OPENREEL_PLUGIN_PUBLISH_<平台>_<字段> 提供。`,
    );
  }
}

/** Parse a JSON response, raising with body text on failure. */
async function readJson(resp, what = "请求") {
  const text = await resp.text();
  if (!resp.ok) {
    let detail = text.slice(0, 400);
    try {
      const j = JSON.parse(text);
      detail = JSON.stringify(j).slice(0, 400);
    } catch {}
    throw new Error(`${what}失败: HTTP ${resp.status} ${detail}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${what}返回了非 JSON 内容: ${text.slice(0, 200)}`);
  }
}

function assertOk(resp, what = "请求") {
  if (!resp.ok) throw new Error(`${what}失败: HTTP ${resp.status}`);
  return resp;
}

function fileSize(path) {
  return statSync(path).size;
}

function fileStream(path, range) {
  return createReadStream(path, range ? { start: range.start, end: range.end } : undefined);
}

function fileBuffer(path) {
  return readFileSync(path);
}

function newId() {
  return randomUUID().replace(/-/g, "");
}

/* --------------------------- OAuth 1.0a (X/Twitter) --------------------------- */

function pct(s) {
  return encodeURIComponent(String(s)).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function hmacSign(key, message) {
  return createHmac("sha1", key).update(message).digest("base64");
}

/**
 * Build an OAuth 1.0a Authorization header (HMAC-SHA1) for X/Twitter.
 * extraParams are merged into the signature base (query/body oauth-visible
 * params must be included by the caller if required).
 */
function oauth1Header(url, method, consumerKey, consumerSecret, token, tokenSecret, extraParams = {}) {
  const parsed = new URL(url);
  const oauth = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: newId() + newId(),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: token,
    oauth_version: "1.0",
    ...extraParams,
  };
  const baseParams = [...new URLSearchParams(parsed.search), ...Object.entries(oauth)]
    .map(([k, v]) => [pct(k), pct(v)])
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1));
  const paramStr = baseParams.map(([k, v]) => `${k}=${v}`).join("&");
  const base = [method.toUpperCase(), pct(`${parsed.origin}${parsed.pathname}`), pct(paramStr)].join("&");
  const signature = hmacSign(`${pct(consumerSecret)}&${pct(tokenSecret)}`, base);
  const header = Object.entries({ ...oauth, oauth_signature: signature })
    .map(([k, v]) => `${k}="${pct(v)}"`)
    .join(", ");
  return `OAuth ${header}`;
}

/* ------------------------------ upload utilities ------------------------------ */

/** Chunked byte uploader used by YouTube resumable / TikTok PUT uploads. */
async function putChunks(uploadUrl, path, size, { chunkSize = 16 * 1024 * 1024, headers = {}, onChunk, method = "PUT" } = {}) {
  const fd = openSync(path, "r");
  try {
    let offset = 0;
    while (offset < size) {
      const end = Math.min(offset + chunkSize, size);
      const buf = Buffer.alloc(end - offset);
      readSync(fd, buf, 0, buf.length, offset);
      const resp = await fetch(uploadUrl, {
        method,
        body: buf,
        headers: {
          "Content-Length": String(buf.length),
          "Content-Type": "application/octet-stream",
          ...headers,
        },
      });
      if (onChunk) await onChunk(end / size, resp);
      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        throw new Error(`上传分片失败: HTTP ${resp.status} ${text.slice(0, 200)}`);
      }
      offset = end;
    }
  } finally {
    closeSync(fd);
  }
  return { uploaded: size, total: size };
}

module.exports = {
  assertCredentials,
  readJson,
  assertOk,
  fileSize,
  fileStream,
  fileBuffer,
  newId,
  oauth1Header,
  putChunks,
};
