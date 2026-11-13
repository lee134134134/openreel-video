const path = require("node:path");
/**
 * TikTok publish connector — OAuth2 + Content Posting API v2 file upload.
 * Flow: POST /v2/post/publish/video/init/ (FILE_UPLOAD) -> PUT chunks to
 * upload_url -> poll /v2/post/publish/status/fetch/.
 */
const { statSync, readFileSync } = require("node:fs");
const { assertCredentials, readJson, putChunks } = require("../_shared/connectors.cjs");

const SCOPES = "user.info.basic,video.publish,video.upload";
const manifest = JSON.parse(readFileSync(path.join(__dirname, "manifest.json"), "utf8"));

module.exports = {
  manifest: () => manifest,
  adapters: async (ctx) => {
    /* TikTok chunks must be 5..64 MiB and conform to CHUNK_SIZE sizing rules. */
    const CHUNK = 16 * 1024 * 1024;
    const creds = () => ({ ...ctx.credentials });

    async function ensureToken(c) {
      assertCredentials(c, ["clientKey", "clientSecret"]);
      if (c.expiresAt && Date.parse(c.expiresAt) - 60_000 < Date.now() && c.refreshToken) {
        const resp = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_key: c.clientKey,
            client_secret: c.clientSecret,
            grant_type: "refresh_token",
            refresh_token: c.refreshToken,
          }),
        });
        const j = await readJson(resp, "刷新 TikTok 令牌");
        const updated = {
          ...c,
          accessToken: j.access_token,
          openId: j.open_id ?? c.openId,
          expiresAt: new Date(Date.now() + Number(j.expires_in ?? 7200) * 1000).toISOString(),
        };
        await ctx.store.setCredentials(updated);
        return updated;
      }
      return c;
    }

    const oauth = {
      authorizeUrl(credentials, callbackUrl) {
        assertCredentials(credentials, ["clientKey", "clientSecret"]);
        const u = new URL("https://www.tiktok.com/v2/auth/authorize/");
        u.searchParams.set("client_key", credentials.clientKey);
        u.searchParams.set("scope", SCOPES);
        u.searchParams.set("response_type", "code");
        u.searchParams.set("redirect_uri", callbackUrl);
        u.searchParams.set("state", "openreel");
        return u.toString();
      },
      async exchangeCode(credentials, code, callbackUrl) {
        assertCredentials(credentials, ["clientKey", "clientSecret"]);
        const resp = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_key: credentials.clientKey,
            client_secret: credentials.clientSecret,
            code,
            grant_type: "authorization_code",
            redirect_uri: callbackUrl,
          }),
        });
        const j = await readJson(resp, "交换 TikTok OAuth 代码");
        await ctx.store.setCredentials({
          ...credentials,
          accessToken: j.access_token,
          refreshToken: j.refresh_token,
          openId: j.open_id,
          expiresAt: new Date(Date.now() + Number(j.expires_in ?? 7200) * 1000).toISOString(),
        });
      },
    };

    const adapter = {
      id: "publish-tiktok",
      label: "TikTok",
      platform: "tiktok",
      auth: "oauth2",
      oauth,

      async validateCredentials(c) {
        try {
          const t = await ensureToken(c);
          if (!t.accessToken) return { ok: false, message: "未授权：请先点击「授权」完成 TikTok OAuth" };
          // TODO(platform-verify): 确认 user/info 字段名与 scopes 要求
          const resp = await ctx.http.fetch("https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url", {
            headers: { Authorization: `Bearer ${t.accessToken}` },
          });
          const j = await readJson(resp, "校验 TikTok 凭据");
          const user = j.data?.user;
          if (!user) return { ok: false, message: j.error?.message ?? "TikTok 未返回用户信息（检查 scope: user.info.basic）" };
          return { ok: true, account: user.display_name ?? user.open_id };
        } catch (err) {
          return { ok: false, message: String(err?.message ?? err) };
        }
      },

      async publish(request, c) {
        const t = await ensureToken(c);
        assertCredentials(t, ["accessToken"]);
        const size = statSync(request.videoPath).size;
        if (size > 4 * 1024 * 1024 * 1024) throw new Error("TikTok 单文件上传上限 4GB，请压缩后重试");
        const privacyT =
          request.privacy === "private" ? "SELF_ONLY" :
          request.privacy === "unlisted" ? "FRIENDS_ONLY" : "PUBLIC_TO_EVERYONE";
        const init = await ctx.http.fetch("https://open.tiktokapis.com/v2/post/publish/video/init/", {
          method: "POST",
          headers: { Authorization: `Bearer ${t.accessToken}`, "Content-Type": "application/json; charset=UTF-8" },
          body: JSON.stringify({
            post_info: {
              title: `${request.title}${request.description ? `\n${request.description}` : ""}`.slice(0, 4165),
              privacy_level: privacyT,
              disable_comment: false,
              video_cover_timestamp_ms: 0,
            },
            source_info: {
              source: "FILE_UPLOAD",
              video_size: size,
              chunk_size: Math.min(CHUNK, size),
              total_chunk_count: Math.ceil(size / CHUNK),
            },
          }),
        });
        const ij = await readJson(init, "初始化 TikTok 上传");
        const uploadUrl = ij.data?.upload_url;
        const publishId = ij.data?.publish_id;
        if (!uploadUrl || !publishId) {
          throw new Error(`TikTok init 失败: ${JSON.stringify(ij).slice(0, 300)}`);
        }
        ctx.logger.info(`TikTok publish_id=${publishId}，开始分片上传 ${size} 字节`);
        await putChunks(uploadUrl, request.videoPath, size, { chunkSize: CHUNK });
        return {
          platformPostId: publishId,
          url: undefined,
          state: "queued_remote",
          raw: ij,
        };
      },

      async status(result) {
        const t = await ensureToken(creds());
        const resp = await ctx.http.fetch("https://open.tiktokapis.com/v2/post/publish/status/fetch/", {
          method: "POST",
          headers: { Authorization: `Bearer ${t.accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ publish_id: result.platformPostId }),
        });
        const j = await readJson(resp, "查询 TikTok 状态");
        // TODO(platform-verify): 确认 status 字段枚举（PROCESSING_UPLOAD vs PUBLISH_FAILED 等）
        const status = j.data?.status;
        const state =
          status === "PUBLISHED" ? "published" :
          status === "PUBLISH_FAILED" || status === "FAILED" ? "failed" : "processing";
        return {
          platformPostId: result.platformPostId,
          state,
          message: j.data?.fail_reason ?? status,
          raw: j,
        };
      },
    };
    return { publish: adapter };
  },
};