#!/usr/bin/env node
/**
 * Dependency-free smoke check for a running OpenReel API server.
 *
 *   node scripts/smoke.mjs                 # http://localhost:4000
 *   node scripts/smoke.mjs http://host:4000
 *   SMOKE_BASE_URL=http://host:4000 node scripts/smoke.mjs
 *
 * Verifies the routes the AI Studio depends on and prints actionable warnings
 * (missing ffmpeg, no LLM key, only the mock TTS adapter). Transport failures
 * and a failing /api/health exit non-zero; warnings do not.
 */
const base = (process.argv[2] || process.env.SMOKE_BASE_URL || "http://localhost:4000").replace(/\/+$/, "");

const failures = [];
const warnings = [];

async function get(path) {
  const url = `${base}${path}`;
  const started = Date.now();
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    const text = await response.text();
    let body;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    const ms = Date.now() - started;
    if (!response.ok) {
      failures.push(`${path} → HTTP ${response.status} (${ms}ms) ${String(text).slice(0, 200)}`);
      return { ok: false, body };
    }
    console.log(`  ok  ${path} (${ms}ms)`);
    return { ok: true, body };
  } catch (err) {
    failures.push(`${path} → ${err instanceof Error ? err.message : String(err)}`);
    return { ok: false, body: null };
  }
}

console.log(`OpenReel server smoke check: ${base}\n`);

const health = await get("/api/health");
if (health.body && typeof health.body === "object") {
  const h = health.body;
  if (h.ok !== true) failures.push("/api/health reported ok=false");
  if (h.ffmpeg !== true) warnings.push("FFmpeg 不可用：合成/转码/字幕会失败，检查 FFMPEG_PATH");
  if (h.db !== true) failures.push("SQLite 不可用：检查 OPENREEL_DATA_DIR 写权限");
  if (h.llm && h.llm.keyConfigured !== true) warnings.push("未配置 OPENCODE_API_KEY：分镜与 AI 改片会走离线兜底");
}

const models = await get("/api/llm/models");
if (models.ok) {
  const list = Array.isArray(models.body) ? models.body : models.body?.models ?? [];
  console.log(`      可用模型 ${list.length} 个${list[0]?.id ? `，例如 ${list[0].id}` : ""}`);
  if (!list.length) warnings.push("模型列表为空：检查 OPENCODE_BASE_URL / OPENCODE_API_KEY");
}

const tts = await get("/api/tts/adapters");
if (tts.ok) {
  const ids = (Array.isArray(tts.body) ? tts.body : []).map((a) => a?.id).filter(Boolean);
  console.log(`      TTS 适配器: ${ids.join(", ") || "（无）"}`);
  if (ids.length <= 1) warnings.push("只有 mock 配音：安装 Edge TTS（bash services/edge-tts/setup.sh）或配置 Azure/CosyVoice 后重启服务端");
}

const videogen = await get("/api/videogen/adapters");
if (videogen.ok) {
  const ids = (Array.isArray(videogen.body) ? videogen.body : []).map((a) => a?.id).filter(Boolean);
  if (!ids.length) warnings.push("没有可用的 videogen 适配器：检查 plugins/ 与 OPENREEL_PLUGIN_DIR");
}

const plugins = await get("/api/plugins");
if (plugins.ok && Array.isArray(plugins.body)) {
  const broken = plugins.body.filter((p) => p && p.valid === false);
  console.log(`      插件 ${plugins.body.length} 个${broken.length ? `（${broken.length} 个加载失败）` : ""}`);
  for (const plugin of broken) warnings.push(`插件加载失败: ${plugin.id} — ${plugin.error ?? "未知原因"}`);
}

await get("/api/publish/connectors");

console.log("");
for (const warning of warnings) console.warn(`  warn  ${warning}`);
for (const failure of failures) console.error(`  FAIL  ${failure}`);

if (failures.length) {
  console.error(`\n${failures.length} 项失败，${warnings.length} 项警告`);
  process.exit(1);
}
console.log(`\n通过（${warnings.length} 项警告）`);
