/**
 * @openreel/plugin-sdk — contracts for the OpenReel plugin system.
 *
 * Extension points:
 *  - llm         LlmProviderAdapter     (OpenCode Zen gateway is the builtin)
 *  - tts         TtsAdapter             (ElevenLabs builtin; mock for tests)
 *  - videogen    VideogenAdapter        (local-compose builtin engine)
 *  - publish     PublishConnectorAdapter(YouTube/TikTok/X/Bilibili/Douyin/XHS)
 *
 * Shared protocol types for the NestJS-driven agent (SSE) also live here so
 * the web client and server never drift.
 */
export * from "./llm-protocol";
export * from "./manifest";
export * from "./context";
export * from "./adapters";
export * from "./videogen";
export * from "./render";
export * from "./publish";
