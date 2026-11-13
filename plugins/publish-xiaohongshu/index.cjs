const path = require("node:path");
/**
 * Xiaohongshu publish connector — cookie-session web API.
 * 小红书 Web 接口普遍要求 X-s/X-t/X-s-common 反爬签名（由站点前端 JS 生成），
 * 这里仅实现可直接以 Cookie 携带的路径，涉及签名的步骤以 TODO(platform-verify)
 * 标注：上线前需要通过创作服务第三方网关或补齐签名逻辑。
 */
const { statSync, readFileSync } = require("node:fs");
const { assertCredentials, readJson } = require("../_shared/connectors.cjs");

const manifest = JSON.parse(readFileSync(path.join(__dirname, "manifest.json"), "utf8"));
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const ORIGIN = "https://www.xiaohongshu.com";

module.exports = {
  manifest: () => manifest,
  adapters: async (ctx) => {
    const creds = () => {
      const c = { ...ctx.credentials };
      assertCredentials(c, ["cookie"]);
      if (!/web_session/.test(c.cookie)) throw new Error("Cookie 中缺少 web_session 字段，请从浏览器复制完整登录 Cookie");
      return c;
    };
    const headers = () => ({
      Cookie: creds().cookie,
      "User-Agent": UA,
      Origin: ORIGIN,
      Referer: `${ORIGIN}/publish/success`,
    });

    const adapter = {
      id: "publish-xiaohongshu",
      label: "小红书",
      platform: "xiaohongshu",
      auth: "cookie",

      /* TODO(platform-verify): /api/sns/web/v2/user/me 是否需要 X-s 签名 */
      async validateCredentials() {
        try {
          const resp = await ctx.http.fetch(`${ORIGIN}/api/sns/web/v2/user/me`, { headers: headers() });
          const j = await readJson(resp, "校验小红书登录态");
          const user = j.data ?? j;
          if (!user || user.success === false) return { ok: false, message: "Cookie 已失效，请重新从浏览器复制登录 Cookie" };
          return { ok: true, account: user.nickname ?? user.red_id ?? "小红书用户" };
        } catch (err) {
          return { ok: false, message: String(err?.message ?? err) };
        }
      },

      async publish(request) {
        const size = statSync(request.videoPath).size;
        if (size > 1024 * 1024 * 1024) throw new Error("小红书单文件上传上限 1GB，请压缩后重试");
        const buf = readFileSync(request.videoPath);
        /* 上传视频文件（创作服务直传域）；
           TODO(platform-verify): 确认上传域名与票据（部分线路需要先 POST /web_api/sns/v3/preupload 换 ticket） */
        const form = new FormData();
        form.append("file", new Blob([buf], { type: "video/mp4" }), "openreel.mp4");
        const up = await ctx.http.fetch("https://rk.xiaohongshu.com/api/media/v1/upload/video/", {
          method: "POST",
          headers: headers(),
          body: form,
        });
        const uj = await readJson(up, "上传小红书视频");
        const mediaId = uj?.data?.media_id ?? uj?.data?.id;
        if (!mediaId) throw new Error(`小红书上传未返回 media_id: ${JSON.stringify(uj).slice(0, 300)}`);

        /* 创建视频笔记；
           TODO(platform-verify): /web_api/sns/v3/note 通常要求 X-s/X-t 签名头，
           web_session 版本可能仅接受创作服务域名下的请求 —— 以真机抓包为准。 */
        const create = await ctx.http.fetch("https://edith.xiaohongshu.com/web_api/sns/v3/note", {
          method: "POST",
          headers: { ...headers(), "Content-Type": "application/json" },
          body: JSON.stringify({
            noteiwad: undefined,
            type: "video",
            title: request.title.slice(0, 20),
            desc: `${request.description ?? ""}`.slice(0, 1000),
            at_user: "",
            post_time: request.startTimeISO,
            image_info: [],
            video: { media_id: mediaId, cover: request.coverPath ? undefined : undefined },
            tags: (request.tags ?? []).slice(0, 10).map((t) => ({ name: t.replace(/[#\s]/g, "") })),
            privacy: request.privacy === "private" ? "self" : "all",
          }),
        });
        const cj = await readJson(create, "创建小红书笔记");
        if (cj?.code && cj.code !== 0) throw new Error(`小红书创建笔记失败: ${JSON.stringify(cj).slice(0, 300)}`);
        const noteId = cj?.data?.id ?? cj?.data?.note_id;
        return {
          platformPostId: String(noteId ?? mediaId),
          url: noteId ? `${ORIGIN}/explore/${noteId}` : undefined,
          state: "published",
          raw: cj,
        };
      },

      async status(result) {
        // TODO(platform-verify): 笔记数据查询接口需要签名头，暂返回处理态
        return { platformPostId: result.platformPostId, state: "processing", message: "小红书暂不支持状态查询（签名受限）" };
      },
    };

    void creds; // headers() 懒触发凭据校验，避免适配器构建时抛错
    return { publish: adapter };
  },
};
