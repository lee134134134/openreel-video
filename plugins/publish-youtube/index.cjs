const path = require("node:path");
/**
 * YouTube publish connector — OAuth2 + resumable upload (YouTube Data API v3).
 */
const { statSync, readFileSync } = require("node:fs");
const { assertCredentials, readJson, putChunks } = require("../_shared/connectors.cjs");

const SCOPE = "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const manifest = JSON.parse(readFileSync(path.join(__dirname, "manifest.json"), "utf8"));

module.exports = {
  manifest: () => manifest,
  adapters: async (ctx) => {
    const creds = () => ({ ...ctx.credentials });

    /** Refresh an expired access token using the refresh token. */
    async function ensureToken(c) {
      assertCredentials(c, ["clientId", "clientSecret"]);
      const expired = c.expiresAt ? Date.parse(c.expiresAt) - 60_000 < Date.now() : false;
      if ((!c.accessToken || expired) && c.refreshToken) {
        const resp = await fetch(TOKEN_URL, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: c.clientId,
            client_secret: c.clientSecret,
            refresh_token: c.refreshToken,
            grant_type: "refresh_token",
          }),
        });
        const j = await readJson(resp, "刷新 YouTube 令牌");
        const updated = { ...c, accessToken: j.access_token, expiresAt: new Date(Date.now() + Number(j.expires_in ?? 3600) * 1000).toISOString() };
        if (j.refresh_token) updated.refreshToken = j.refresh_token;
        await ctx.store.setCredentials(updated);
        return updated;
      }
      return c;
    }

    const oauth = {
      authorizeUrl(credentials, callbackUrl) {
        assertCredentials(credentials, ["clientId", "clientSecret"]);
        const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
        u.searchParams.set("client_id", credentials.clientId);
        u.searchParams.set("redirect_uri", callbackUrl);
        u.searchParams.set("response_type", "code");
        u.searchParams.set("scope", SCOPE);
        u.searchParams.set("access_type", "offline");
        u.searchParams.set("prompt", "consent");
        return u.toString();
      },
      async exchangeCode(credentials, code, callbackUrl) {
        assertCredentials(credentials, ["clientId", "clientSecret"]);
        const resp = await fetch(TOKEN_URL, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: credentials.clientId,
            client_secret: credentials.clientSecret,
            code,
            code_verifier: "",
            grant_type: "authorization_code",
            redirect_uri: callbackUrl,
          }),
        });
        const j = await readJson(resp, "交换 YouTube OAuth 代码");
        await ctx.store.setCredentials({
          ...credentials,
          accessToken: j.access_token,
          refreshToken: j.refresh_token,
          expiresAt: new Date(Date.now() + Number(j.expires_in ?? 3600) * 1000).toISOString(),
        });
      },
    };

    const adapter = {
      id: "publish-youtube",
      label: "YouTube",
      platform: "youtube",
      auth: "oauth2",
      oauth,

      async validateCredentials(c) {
        try {
          const t = await ensureToken(c);
          if (!t.accessToken) return { ok: false, message: "未授权：请先点击「授权」完成 Google OAuth 授权" };
          const resp = await ctx.http.fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", {
            headers: { Authorization: `Bearer ${t.accessToken}` },
          });
          const j = await readJson(resp, "校验 YouTube 凭据");
          const item = j.items?.[0];
          if (!item) return { ok: true, account: "（频道列表为空，但令牌有效）" };
          return { ok: true, account: item.snippet?.title ?? "YouTube 频道" };
        } catch (err) {
          return { ok: false, message: String(err?.message ?? err) };
        }
      },

      /** Resumable upload: session init -> PUT chunks -> videoId. */
      async publish(request, c) {
        const t = await ensureToken(c);
        assertCredentials(t, ["accessToken"]);
        const size = statSync(request.videoPath).size;
        const privacy = request.privacy === "unlisted" ? "unlisted" : request.privacy === "draft" ? "private" : request.privacy ?? "public";
        const meta = {
          snippet: {
            title: request.title.slice(0, 100),
            description: `${request.description ?? ""}`.slice(0, 4999),
            tags: (request.tags ?? []).slice(0, 20),
          },
          status: { privacyStatus: privacy, selfDeclaredMadeForKids: false },
        };
        const init = await ctx.http.fetch(
          "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${t.accessToken}`,
              "Content-Type": "application/json; charset=UTF-8",
              "X-Upload-Content-Length": String(size),
              "X-Upload-Content-Type": "video/mp4",
            },
            body: JSON.stringify(meta),
          },
        );
        const location = init.headers.get("location");
        if (!init.ok || !location) {
          const text = await init.text().catch(() => "");
          throw new Error(`创建 YouTube 上传会话失败: HTTP ${init.status} ${text.slice(0, 300)}`);
        }
        let uploaded = 0;
        let finalBody = null;
        await putChunks(location, request.videoPath, size, {
          headers: { Authorization: `Bearer ${t.accessToken}` },
          onChunk: async (f, resp) => {
            uploaded = f;
            if (f >= 1) {
              // The PUT covering the whole file returns the video resource.
              const text = await resp.text().catch(() => "");
              try { finalBody = JSON.parse(text); } catch { finalBody = null; }
            }
            ctx.logger.info(`YouTube 上传进度 ${(f * 100).toFixed(1)}%`);
          },
        });
        const videoId = finalBody?.id;
        if (!videoId) throw new Error("YouTube 未返回视频 id: " + JSON.stringify(finalBody).slice(0, 200));
        return {
          platformPostId: videoId,
          url: `https://www.youtube.com/watch?v=${videoId}`,
          deeplink: `youtube://watch/${videoId}`,
          state: "queued_remote",
          raw: finalBody,
        };
      },

      /** Map Google processing state to platform status. */
      async status(result) {
        const t = await ensureToken(creds());
        const resp = await ctx.http.fetch(
          `https://www.googleapis.com/youtube/v3/videos?part=status,statistics&id=${result.platformPostId}`,
          { headers: { Authorization: `Bearer ${t.accessToken}` } },
        );
        const j = await readJson(resp, "查询 YouTube 状态");
        const item = j.items?.[0];
        const upload = item?.status?.uploadStatus;
        const state = upload === "processed" ? "published" : upload === "failed" || upload === "rejected" ? "failed" : "processing";
        return {
          platformPostId: result.platformPostId,
          state,
          views: Number(item?.statistics?.viewCount ?? 0),
          likes: Number(item?.statistics?.likeCount ?? 0),
          comments: Number(item?.statistics?.commentCount ?? 0),
          message: upload,
        };
      },
    };
    return { publish: adapter };
  },
};
