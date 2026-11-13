/**
 * Bilibili publish connector — Cookie+CSRF web upload flow.
 * 1) GET /x/web-interface/nav  校验登录态
 * 2) GET member.bilibili.com/preupload  申请 UPOS 上传线路
 * 3) POST ?name=...&profile=ugcfx/bup  分片上传（JSON 协议， 上传网关返回 ok:1）
 * 4) POST member.bilibili.com/x/vu/web/add/v3  提交稿件
 * 注：UPOS 协议为站内非公开接口，字段以实际抓包为准。
 */
const { statSync, openSync, readSync, closeSync, readFileSync } = require("node:fs");
const { basename, join as pj } = require("node:path");
const { assertCredentials, readJson } = require("../_shared/connectors.cjs");

const manifest = JSON.parse(readFileSync(pj(__dirname, "manifest.json"), "utf8"));
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

module.exports = {
  manifest: () => manifest,
  adapters: async (ctx) => {
    const creds = () => {
      const c = { ...ctx.credentials };
      assertCredentials(c, ["cookie"]);
      if (!/SESSDATA/.test(c.cookie)) throw new Error("Cookie 中缺少 SESSDATA 字段，请从浏览器复制完整登录 Cookie");
      if (!/bili_jct/.test(c.cookie)) throw new Error("Cookie 中缺少 bili_jct（CSRF）字段，请确认复制的是完整 Cookie");
      return c;
    };
    const headers = () => ({ Cookie: creds().cookie, "User-Agent": UA, Referer: "https://member.bilibili.com/" });

    function csrf() {
      const m = /bili_jct=([^;]+)/.exec(creds().cookie);
      return m ? m[1] : "";
    }

    const adapter = {
      id: "publish-bilibili",
      label: "Bilibili",
      platform: "bilibili",
      auth: "cookie",

      async validateCredentials() {
        try {
          const resp = await ctx.http.fetch("https://api.bilibili.com/x/web-interface/nav", { headers: headers() });
          const j = await readJson(resp, "校验 B 站登录态");
          if (j.code !== 0 || !j.data?.isLogin) return { ok: false, message: "Cookie 已失效，请重新从浏览器复制登录 Cookie" };
          return { ok: true, account: j.data.uname };
        } catch (err) {
          return { ok: false, message: String(err?.message ?? err) };
        }
      },

      async publish(request, c) {
        const cookieFooter = creds().cookie; // assert raises if malformed
        void cookieFooter;
        const size = statSync(request.videoPath).size;
        const filename = `openreel-${Date.now()}.mp4`;
        ctx.logger.info(`B 站预上传: ${filename} (${size} bytes)`);
        const pre = await ctx.http.fetch(
          `https://member.bilibili.com/preupload?os=upos&upcdn=bda2&name=${encodeURIComponent(filename)}&size=${size}&r=upos&profile=ugcfx/bup&ssl=0&version=3.48.0.0&build=348000&upcdn=bda2&probe_version=20221109`,
          { headers: headers() },
        );
        const pj = await readJson(pre, "申请 B 站上传线路");
        // TODO(platform-verify): 确认 preupload 返回结构与 osv/upos 位点
        const upUrl = (pj.url ?? pj.upurl ?? "").replace("//upos-cs-upcdm", "https://upos-cs-upcdm");
        const uposUri = pj.upos_uri ?? "";
        const auth = pj.auth ?? pj.biz_id;
        if (!upUrl || !uposUri) {
          throw new Error(`B 站 preupload 未返回上传地址: ${JSON.stringify(pj).slice(0, 300)}`);
        }
        const gateway = `https:${pj.url.startsWith("//") ? "" : "//"}${pj.url.replace(/^https?:/, "").replace(/^\/\//, "")}`.replace(/\/$/, "");
        const endpoint = `${gateway}/${uposUri.replace(/^upos:\/\//, "osv/")}`;
        // TODO(platform-verify): osv vs upos 前缀依线路不同，需按抓包确认
        ctx.logger.info(`B 站上传端点: ${endpoint}`);
        const added = await uploadParts(endpoint, request.videoPath, size, filename, auth);
        if (!added) throw new Error("B 站分片上传失败：网关未确认");

        /* 提交稿件 */
        const submit = await ctx.http.fetch("https://member.bilibili.com/x/vu/web/add/v3", {
          method: "POST",
          headers: { ...headers(), "Content-Type": "application/json; charset=UTF-8" },
          body: JSON.stringify({
            copyright: 1,
            source: "",
            tid: Number(c.tid ?? 17),
            cover: "",
            title: request.title.slice(0, 80),
            desc_format_id: 0,
            desc: `${request.description ?? ""}`.slice(0, 1999),
            tag: (request.tags ?? ["OpenReel"]).map((t) => t.replace(/[,\s]/g, "")).filter(Boolean).slice(0, 10).join(","),
            videos: [{ filename: filename.replace(".mp4", ""), cid: pj.biz_id ?? 0, title: request.title.slice(0, 80) }],
            csrf: csrf(),
            up_from_davinci: true,
            open_elec: 1,
          }),
        });
        const sj = await readJson(submit, "提交 B 站稿件");
        if (sj.code !== 0) {
          throw new Error(`B 站投稿失败: code=${sj.code} ${sj.message ?? ""}`);
        }
        const aid = sj.data?.aid ?? sj.data?.id;
        const bvid = sj.data?.bvid;
        return {
          platformPostId: String(bvid ?? aid ?? ""),
          url: bvid ? `https://www.bilibili.com/video/${bvid}` : aid ? `https://www.bilibili.com/video/av${aid}` : undefined,
          state: "published",
          raw: sj,
        };
      },

      async status(result) {
        if (result.platformPostId.startsWith("BV")) {
          const resp = await ctx.http.fetch(
            `https://api.bilibili.com/x/web-interface/archive/stat?bvid=${result.platformPostId}`,
            { headers: headers() },
          );
          const j = await readJson(resp, "查询 B 站稿件数据");
          const d = j.data ?? {};
          return { platformPostId: result.platformPostId, state: "published", views: d.view, likes: d.like, comments: d.reply };
        }
        return { platformPostId: result.platformPostId, state: "processing" };
      },
    };

    /** UPOS bup JSON protocol: POST part bytes with ?uploads / part index. */
    async function uploadParts(endpoint, videoPath, size, filename, auth) {
      // TODO(platform-verify): 分片协议参数（partNumber/slice）依线路而异
      const CHUNK = 4 * 1024 * 1024;
      const fd = openSync(videoPath, "r");
      try {
        const parts = Math.ceil(size / CHUNK);
        for (let i = 0; i < parts; i++) {
          const start = i * CHUNK;
          const buf = Buffer.alloc(Math.min(CHUNK, size - start));
          readSync(fd, buf, 0, buf.length, start);
          const form = new FormData();
          if (auth !== undefined) form.append("auth", String(auth));
          form.append("biz_id", "0");
          form.append("chunk", String(i));
          form.append("chunks", String(parts));
          form.append("end", String(start + buf.length - 1));
          form.append("file", new Blob([buf]), filename);
          form.append("filename", filename);
          form.append("partNumber", String(i + 1));
          form.append("slices", String(parts));
          form.append("start", String(start));
          form.append("task", "0");
          form.append("total", String(size));
          const resp = await ctx.http.fetch(`${endpoint}?uploads&output=json&profile=ugcfx/bup`, {
            method: "POST",
            headers: { ...(headers()), "X-Upos-Auth": String(auth ?? ""), Origin: "https://member.bilibili.com" },
            body: form,
          });
          const text = await resp.text();
          ctx.logger.info(`B 站上传分片 ${i + 1}/${parts}: HTTP ${resp.status} ${text.slice(0, 120)}`);
          if (!resp.ok) throw new Error(`B 站分片上传失败 HTTP ${resp.status}: ${text.slice(0, 200)}`);
          try {
            const j = JSON.parse(text);
            if (j.ok === 0 || j.code) throw new Error(`B 站分片被拒: ${text.slice(0, 200)}`);
          } catch (e) {
            if (e instanceof SyntaxError) continue; // plain "ok" response
            throw e;
          }
        }
      } finally {
        closeSync(fd);
      }
      return true;
    }

    return { publish: adapter };
  },
};
