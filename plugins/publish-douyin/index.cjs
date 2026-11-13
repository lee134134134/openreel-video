const path = require("node:path");
/**
 * Douyin publish connector — open platform OAuth2 + video upload/create.
 * TODO(platform-verify): 开放平台接口路径近年从 /video/* 迁移到
 * /api/douyin/v1/video/*，两套实现都保留占位，以上线抓包为准。
 */
const { statSync, readFileSync } = require("node:fs");
const { assertCredentials, readJson } = require("../_shared/connectors.cjs");

const manifest = JSON.parse(readFileSync(path.join(__dirname, "manifest.json"), "utf8"));
const AUTHORIZE = "https://open.douyin.com/platform/oauth/connect/";
const TOKEN = "https://open.douyin.com/oauth/access_token/";

module.exports = {
  manifest: () => manifest,
  adapters: async (ctx) => {
    const creds = () => ({ ...ctx.credentials });

    async function ensureToken(c) {
      assertCredentials(c, ["clientKey", "clientSecret"]);
      if (c.expiresAt && Date.parse(c.expiresAt) - 60_000 < Date.now()) {
        assertCredentials(c, ["refreshToken"]);
        const resp = await ctx.http.fetch(`${TOKEN}?client_key=${encodeURIComponent(c.clientKey)}&grant_type=refresh_token&refresh_token=${encodeURIComponent(c.refreshToken)}`);
        const j = await readJson(resp, "刷新抖音令牌");
        const base = j.data ?? j;
        const updated = {
          ...c,
          accessToken: base.access_token,
          openId: base.open_id ?? c.openId,
          refreshToken: base.refresh_token ?? c.refreshToken,
          expiresAt: new Date(Date.now() + Number(base.expires_in ?? 86400) * 1000).toISOString(),
        };
        await ctx.store.setCredentials(updated);
        return updated;
      }
      return c;
    }

    const oauth = {
      authorizeUrl(credentials, callbackUrl) {
        assertCredentials(credentials, ["clientKey", "clientSecret"]);
        const u = new URL(AUTHORIZE);
        u.searchParams.set("client_key", credentials.clientKey);
        u.searchParams.set("response_type", "code");
        u.searchParams.set("scope", "video.create");
        u.searchParams.set("redirect_uri", callbackUrl);
        u.searchParams.set("state", "openreel");
        return u.toString();
      },
      async exchangeCode(credentials, code, callbackUrl) {
        assertCredentials(credentials, ["clientKey", "clientSecret"]);
        const resp = await ctx.http.fetch(
          `${TOKEN}?client_key=${encodeURIComponent(credentials.clientKey)}&response_type=authorization_code&grant_type=authorization_code&code=${encodeURIComponent(code)}&redirect_uri=${encodeURIComponent(callbackUrl)}`,
        );
        const j = await readJson(resp, "交换抖音 OAuth 代码");
        const base = j.data ?? j;
        await ctx.store.setCredentials({
          ...credentials,
          accessToken: base.access_token,
          refreshToken: base.refresh_token,
          openId: base.open_id,
          expiresAt: new Date(Date.now() + Number(base.expires_in ?? 86400) * 1000).toISOString(),
        });
      },
    };

    const adapter = {
      id: "publish-douyin",
      label: "抖音",
      platform: "douyin",
      auth: "oauth2",
      oauth,

      async validateCredentials(c) {
        try {
          const t = await ensureToken(c);
          if (!t.accessToken) return { ok: false, message: "未授权：请先点击「授权」完成抖音开放平台 OAuth" };
          assertCredentials(t, ["openId"]);
          // TODO(platform-verify): 确认 userinfo 参数形态（open_id 放 query 还是 header）
          const resp = await ctx.http.fetch(
            `https://open.douyin.com/oauth/userinfo/?access_token=${encodeURIComponent(t.accessToken)}&open_id=${encodeURIComponent(t.openId)}`,
          );
          const j = await readJson(resp, "校验抖音凭据");
          const user = j.data?.user ?? j.data;
          if (!user) return { ok: false, message: j.error_description ?? "抖音未返回用户信息" };
          return { ok: true, account: user.nickname ?? user.open_id };
        } catch (err) {
          return { ok: false, message: String(err?.message ?? err) };
        }
      },

      async publish(request, c) {
        const t = await ensureToken(c);
        assertCredentials(t, ["accessToken", "openId"]);
        const size = statSync(request.videoPath).size;
        if (size > 128 * 1024 * 1024) throw new Error("抖音单文件上传上限 128MB，请压缩后重试");
        /* TODO(platform-verify): 新版接口为
           POST https://open.douyin.com/api/douyin/v1/video/upload_video/ (multipart: video)
           POST https://open.douyin.com/api/douyin/v1/video/create_video/ (json)
           旧版为 /video/upload/ + /video/create/ (form)。此处按抓包可得的最新路径。 */
        const buf = readFileSync(request.videoPath);
        const form = new FormData();
        form.append("open_id", String(t.openId));
        form.append("access_token", String(t.accessToken));
        form.append("video", new Blob([buf], { type: "video/mp4" }), "openreel.mp4");
        const up = await ctx.http.fetch("https://open.douyin.com/api/douyin/v1/video/upload_video/", {
          method: "POST",
          body: form,
        });
        const uj = await readJson(up, "上传抖音视频");
        const videoId = uj?.data?.video_id ?? uj?.video_id ?? uj?.data?.video?.video_id;
        if (!videoId) throw new Error(`抖音上传未返回 video_id: ${JSON.stringify(uj).slice(0, 300)}`);

        const privacyMap = { public: 0, private: 1, unlisted: 2, draft: 3 };
        const create = await ctx.http.fetch("https://open.douyin.com/api/douyin/v1/video/create_video/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            open_id: t.openId,
            access_token: t.accessToken,
            video_text: `${request.title}${request.description ? `\n${request.description}` : ""}`.slice(0, 1000),
            video_id: videoId,
            poi_id: null,
            privacy_type: privacyMap[request.privacy ?? "public"] ?? 0,
            is_enabled_deny: 0,
          }),
        });
        const cj = await readJson(create, "创建抖音作品");
        if (cj?.data?.error_code && cj.data.error_code !== 0) {
          throw new Error(`抖音创建作品失败: ${cj.data.description ?? cj.data.error_code}`);
        }
        const itemId = cj?.data?.item_id ?? cj?.data?.create_video_response?.item_id;
        return {
          platformPostId: String(itemId ?? videoId),
          url: undefined,
          state: "published",
          deeplink: "snssdk1233://",
          raw: cj,
        };
      },

      async status(result) {
        const t = await ensureToken(creds());
        // TODO(platform-verify): item 状态查询接口 /api/douyin/v1/video/item_info/
        const resp = await ctx.http.fetch(
          `https://open.douyin.com/api/douyin/v1/video/item_info/?open_id=${encodeURIComponent(t.openId ?? "")}&access_token=${encodeURIComponent(t.accessToken ?? "")}&item_id=${encodeURIComponent(result.platformPostId)}`,
        );
        const j = await readJson(resp, "查询抖音作品状态").catch(() => ({}));
        const item = j?.data?.item_list?.[0];
        return {
          platformPostId: result.platformPostId,
          state: item ? "published" : "processing",
          message: item?.create_status_note,
        };
      },
    };

    return { publish: adapter };
  },
};
