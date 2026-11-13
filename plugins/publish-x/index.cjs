const path = require("node:path");
/**
 * X (Twitter) publish connector.
 * Auth: OAuth 1.0a HMAC-SHA1 (user context, tokens from the developer portal).
 * Upload: chunked INIT/APPEND/FINALIZE/STATUS on upload.x.com (v1.1 media API).
 * Post: POST /2/tweets with media.media_ids.
 */
const { statSync, readFileSync, openSync, readSync, closeSync } = require("node:fs");
const { assertCredentials, readJson, oauth1Header } = require("../_shared/connectors.cjs");

const manifest = JSON.parse(readFileSync(path.join(__dirname, "manifest.json"), "utf8"));
const MEDIA_HOST = "https://upload.x.com";
const API_HOST = "https://api.x.com";

module.exports = {
  manifest: () => manifest,
  adapters: async (ctx) => {
    function o1(method, url) {
      const c = { ...ctx.credentials };
      assertCredentials(c, ["apiKey", "apiKeySecret", "accessToken", "accessTokenSecret"]);
      return oauth1Header(url, method, c.apiKey, c.apiKeySecret, c.accessToken, c.accessTokenSecret);
    }

    const adapter = {
      id: "publish-x",
      label: "X (Twitter)",
      platform: "x",
      auth: "manual_token",

      async validateCredentials() {
        try {
          const resp = await ctx.http.fetch(`${API_HOST}/2/users/me`, {
            headers: { Authorization: o1("GET", `${API_HOST}/2/users/me`) },
          });
          const j = await readJson(resp, "校验 X 凭据");
          const user = j.data;
          if (!user) return { ok: false, message: "X 未返回用户信息" };
          return { ok: true, account: `${user.name} (@${user.username})` };
        } catch (err) {
          return { ok: false, message: String(err?.message ?? err) };
        }
      },

      /** INIT -> APPEND chunks (base64, ≤5MB body) -> FINALIZE -> STATUS until processed. */
      async publish(request, c) {
        assertCredentials({ ...c }, ["apiKey", "apiKeySecret", "accessToken", "accessTokenSecret"]);
        const size = statSync(request.videoPath).size;
        const authInit = o1("POST", `${MEDIA_HOST}/1.1/media/upload.json`);
        const init = await ctx.http.fetch(`${MEDIA_HOST}/1.1/media/upload.json`, {
          method: "POST",
          headers: {
            Authorization: authInit,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            command: "INIT",
            media_type: "video/mp4",
            total_bytes: String(size),
            media_category: "tweet_video",
          }),
        });
        const ij = await readJson(init, "初始化 X 媒体上传");
        const mediaId = ij.media_id_string;
        if (!mediaId) throw new Error("X INIT 未返回 media_id: " + JSON.stringify(ij).slice(0, 200));

        const CHUNK = 4 * 1024 * 1024; // v1.1 APPEND body limit ~5MB
        const fd = openSync(request.videoPath, "r");
        try {
          for (let offset = 0, index = 0; offset < size; offset += CHUNK, index++) {
            const buf = Buffer.alloc(Math.min(CHUNK, size - offset));
            readSync(fd, buf, 0, buf.length, offset);
            const form = new FormData();
            form.append("command", "APPEND");
            form.append("media_id", mediaId);
            form.append("segment_index", String(index));
            form.append("media", new Blob([buf]), "chunk.bin");
            const resp = await ctx.http.fetch(`${MEDIA_HOST}/1.1/media/upload.json`, {
              method: "POST",
              headers: { Authorization: o1("POST", `${MEDIA_HOST}/1.1/media/upload.json`) },
              body: form,
            });
            if (!resp.ok) {
              const text = await resp.text().catch(() => "");
              throw new Error(`X 媒体分片上传失败(#${index}): HTTP ${resp.status} ${text.slice(0, 200)}`);
            }
            ctx.logger.info(`X 媒体上传 ${((offset + buf.length) / size * 100).toFixed(1)}%`);
          }
        } finally {
          closeSync(fd);
        }        const authFin = o1("POST", `${MEDIA_HOST}/1.1/media/upload.json`);
        const fin = await ctx.http.fetch(`${MEDIA_HOST}/1.1/media/upload.json`, {
          method: "POST",
          headers: { Authorization: authFin, "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ command: "FINALIZE", media_id: mediaId }),
        });
        const fj = await readJson(fin, "完成 X 媒体上传");
        if (fj.processing_info) await waitProcessing(mediaId);

        const tweet = await ctx.http.fetch(`${API_HOST}/2/tweets`, {
          method: "POST",
          headers: { Authorization: o1("POST", `${API_HOST}/2/tweets`), "Content-Type": "application/json" },
          body: JSON.stringify({
            text: `${request.title}${request.description ? `\n${request.description}` : ""}`.slice(0, 278),
            media: { media_ids: [mediaId] },
          }),
        });
        const tj = await readJson(tweet, "发布 X 推文");
        const tweetId = tj.data?.id;
        if (!tweetId) throw new Error("X 未返回推文 id: " + JSON.stringify(tj).slice(0, 300));
        const username = (await me()).split("@")[1];
        return {
          platformPostId: tweetId,
          url: username ? `https://x.com/${username}/status/${tweetId}` : undefined,
          state: "published",
          raw: tj,
        };
      },

      async status(result) {
        const tweet = await ctx.http.fetch(`${API_HOST}/2/tweets/${result.platformPostId}?tweet.fields=public_metrics`, {
          headers: { Authorization: o1("GET", `${API_HOST}/2/tweets/${result.platformPostId}?tweet.fields=public_metrics`) },
        });
        const j = await readJson(tweet, "查询 X 状态").catch(() => ({}));
        const m = j.data?.public_metrics;
        return {
          platformPostId: result.platformPostId,
          state: j.data ? "published" : "failed",
          views: m?.impression_count,
          likes: m?.like_count,
          comments: m?.reply_count,
          message: j.errors?.[0]?.detail,
        };
      },
    };

    async function me() {
      const resp = await ctx.http.fetch(`${API_HOST}/2/users/me`, {
        headers: { Authorization: o1("GET", `${API_HOST}/2/users/me`) },
      });
      const j = await readJson(resp, "获取 X 用户");
      return `@${j.data?.username ?? "user"}`;
    }

    /* Poll FINALIZE processing_info until succeeded/failed. */
    async function waitProcessing(mediaId) {
      for (let i = 0; i < 60; i++) {
        const resp = await ctx.http.fetch(`${MEDIA_HOST}/1.1/media/upload.json?command=STATUS&media_id=${mediaId}`, {
          headers: { Authorization: o1("GET", `${MEDIA_HOST}/1.1/media/upload.json?command=STATUS&media_id=${mediaId}`) },
        });
        const j = await readJson(resp, "查询 X 媒体处理状态");
        const p = j.processing_info;
        if (!p || p.state === "succeeded") return;
        if (p.state === "failed") throw new Error(`X 媒体处理失败: ${p.error?.message ?? "processing failed"}`);
        await new Promise((r) => setTimeout(r, Math.max(2000, Number(p.check_after_secs ?? 5) * 1000)));
      }
      ctx.logger.warn("X 媒体处理等待超时（继续按 queued_remote 记录）");
    }

    return { publish: adapter };
  },
};
