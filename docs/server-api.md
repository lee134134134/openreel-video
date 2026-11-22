# OpenReel Server API — contract for implementation lanes

> Source of truth for the AI-Studio buildout. Frontend (apps/web) and backend
> (apps/server) lanes must conform to these paths and payload shapes.
> Shared DTO types live in `packages/plugin-sdk/src/*`.

## LLM ("opencode2" = OpenCode Zen gateway)

| Method | Path | Purpose |
|---|---|---|
| GET | /api/llm/models | List models from gateway (cache 60s) |
| POST | /api/agent/session | Create a chat session; body {title?} → {id} |
| GET | /api/agent/sessions | List chat sessions |
| GET | /api/agent/session/:id/messages | Message history for one session |
| POST | /api/agent/stream | SSE chat; body {sessionId?, message, model?, history?}; events = AgentEvent |

Config env: `OPENCODE_BASE_URL`, `OPENCODE_API_KEY`, `OPENCODE_MODEL` (default deepseek-v4.1-flash),
`OPENCODE_TIMEOUT_MS` (default 120000). Optional second account for quota exhaustion:
`OPENCODE_FALLBACK_BASE_URL`, `OPENCODE_FALLBACK_API_KEY`, `OPENCODE_FALLBACK_MODEL`, and
`OPENCODE_FAILOVER_RECOVERY_MS` (default 600000). 401/402/429 on the primary switches every later
request to the fallback until the recovery window elapses; `Retry-After` values beyond 5 s are treated
as a quota horizon and fail fast instead of sleeping.

AgentEvent: `{session|status|message|tool_call|tool_result|usage|error}` (see plugin-sdk/src/llm-protocol.ts).

## Agent tools (server-side; registered by owning module's onModuleInit)

| Tool | Owner module | Args | Returns |
|---|---|---|---|
| propose_videogen_plan | videogen | {brief, sceneCount, aspectRatio?, styleHint?, language?} | VideogenPlan |
| create_videogen_job | videogen | {plan, adapterId?} | VideogenJobDTO |
| get_videogen_job | videogen | {jobId} | VideogenJobDTO |
| list_projects | projects | {} | ProjectRow[] |
| get_render_job / list_render_jobs | render | {jobId} / {} | RenderJobRow[] |
| list_publish_connectors | publish | {} | PublishConnectorDTO[] |
| publish_video | publish | {connectorId, projectId?, videogenJobId? or uploadId, title, description, tags?, privacy?} | PublishRecord |
| get_publish_status | publish | {recordId} | PublishStatus |

## Videogen (真人视频生成)

| Method | Path | Purpose |
|---|---|---|
| GET | /api/videogen/avatars | Person presets |
| GET | /api/videogen/adapters | Registered videogen adapters (builtin + plugins) |
| POST | /api/videogen/plans | {brief, sceneCount?, aspectRatio?, styleHint?} → VideogenPlan via LLM |
| GET | /api/videogen/jobs | Job list (DTO in plugin-sdk/videogen.ts) |
| GET | /api/videogen/jobs/:id | Job detail |
| POST | /api/videogen/jobs | {plan, adapterId?} → create + queue |
| POST | /api/videogen/jobs/:id/run | Execute pipeline now |
| POST | /api/videogen/jobs/run/:id | Legacy alias of the line above |
| GET | /api/videogen/jobs/:id/events | SSE progress events |

Pipeline state: draft → queued → running(adapter scenes) → composing(FFmpeg) → done | failed.
Final MP4 at `/api/files/jobs/<id>.mp4`. Scene narration goes through the TTS adapter chosen by
`selectPreferredTts` (see TTS below); missing image generation degrades to an LLM-authored SVG
illustration and then to a captioned placeholder card (recorded in the job's `warnings`).

## TTS (配音)

| Method | Path | Purpose |
|---|---|---|
| GET | /api/tts/adapters | Registered adapters `[{id,label}]` |
| POST | /api/tts/synthesize | {text, voiceId?, adapterId?, speed?, emotion?, styleDegree?} → {audioPath, url, durationSec, voiceId} |

`emotion` is an Azure express-as style or a free-form Chinese instruction (≤40 chars) for CosyVoice.
Adapter priority (highest first): elevenlabs → openai-tts → azure-tts → cosyvoice-tts → edge-tts →
macos-say → mock. Cloud adapters require their env keys; cosyvoice is registered only when its
service answers at boot; edge-tts is registered when its Python client is present. Passing
`adapterId` bypasses the priority list.

## Render queue (FFmpeg)

| Method | Path | Purpose |
|---|---|---|
| GET | /api/render/jobs | list |
| GET | /api/render/jobs/:id | detail |
| GET | /api/render/jobs/:id/events | SSE: job row on every change, closes on done/failed/cancelled |
| POST | /api/render/transcode | {uploadId, crfLevel?, preset?, scaleWidth?, fps?} |
| POST | /api/render/assemble | {segments, audioTracks?, subtitles?, width, height, fps, outputFormat} (AssemblyRequest) |
| POST | /api/render/jobs/:id/cancel | cancel |

Jobs output to DATA_DIR/jobs/<id>.mp4, served at `/api/files/jobs/<id>.mp4`.
Concurrency is capped by `OPENREEL_RENDER_CONCURRENCY` (default 1). Subtitle burning probes the
configured FFmpeg: `drawtext` when libfreetype exists, otherwise a generated ASS file through libass,
otherwise captions are skipped and the render still succeeds. `FFMPEG_DRAWTEXT_FONT` overrides the
caption font (default `PingFang SC` on macOS, `sans` elsewhere).

## Uploads & files

| Method | Path | Purpose |
|---|---|---|
| POST | /api/uploads | multipart `file` (+ optional `kind`, `filename`) → {id, filename, path, byteSize, kind, url} |
| GET | /api/files/<relpath-under-dataDir> | stream file (mp4/png/wav/...) |

`/api/files/*` sets `Cross-Origin-Resource-Policy: cross-origin` because the editor page is served
with COEP `require-corp`; removing it makes every cross-origin preview/download fail in the browser.

## Publish (对接第三方平台，LLM 驱动)

| Method | Path | Purpose |
|---|---|---|
| GET | /api/publish/connectors | adapters with live credential status |
| PUT | /api/publish/credentials/:connectorId | save credentials (from Plugin Center) |
| POST | /api/publish/oauth/:connectorId/authorize | → authorize URL |
| GET | /api/publish/oauth/:connectorId/callback | OAuth callback handler |
| POST | /api/publish | {connectorId, title, description, tags?, privacy?, videoPath?, uploadId?} → PublishRecord |
| GET | /api/publish/records | publish history |
| GET | /api/publish/records/:id/status | platform status |

Built-in connectors (as plugins, in `<repo>/plugins/`): `publish-youtube`, `publish-tiktok`, `publish-x`,
`publish-bilibili`, `publish-douyin`, `publish-xiaohongshu`. Auth kinds: oauth2 (youtube/tiktok/douyin),
api/oauth1 (x), cookie (xhs), oauth2+appkey (bilibili). Credentials from Plugin Center UI or env fallback
`OPENREEL_PLUGIN_<ID>_<KEY>`.

## Plugins

| Method | Path | Purpose |
|---|---|---|
| GET | /api/plugins | installed list (manifest + enabled) |
| POST | /api/plugins/reload | re-read `OPENREEL_PLUGIN_DIR` from disk (after install/edit) |
| POST | /api/plugins/:id/enable | enable |
| POST | /api/plugins/:id/disable | disable |
| PUT | /api/plugins/:id/credentials | settings form save |

Connector credentials and tokens persisted by `ctx.store` live in `plugin_state.credentials` and are
encrypted at rest with `OPENREEL_SECRET` (AES-256-GCM, `config/secret-box.ts`). Plaintext rows from
older versions stay readable and are re-encrypted on the next save. Changing `OPENREEL_SECRET`
invalidates stored credentials: re-enter them in Plugin Center (or via
`OPENREEL_PLUGIN_<ID>_<KEY>` env fallback). `OPENREEL_DISABLE_PUBLISH=1` rejects all publish calls.

## Health

| Method | Path | Purpose |
|---|---|---|
| GET | /api/health | `{ok, app, ffmpeg, db, dataDir, pluginDir, llm:{baseUrl,model,keyConfigured}}` |

`ffmpeg` is a real `-version` probe, `db` a `SELECT 1`, so this doubles as the server readiness check
used by the AI Studio panel.

## Projects

CRUD at /api/projects (list/get/post/put/delete). OpenReel project JSON from the web editor can be saved here for server-side pipelines.
