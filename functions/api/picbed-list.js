/* POST /api/picbed-list  { password, prefix?, cursor? }
 * 图床门面（/picbed/）的只读列表接口：按前缀（目录）列 R2 对象。
 * 鉴权：口令的 SHA-256 与 _picbed-gate.js 里的哈希比对；哈希为空 = 图床关闭，一律 403（fail-closed）。
 * 注意：图片本身走 R2 公开域名、一直可直链访问；这个口令只挡「把图库整个翻出来」。
 */
import { PICBED_HASH } from "./_picbed-gate.js";

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function onRequestPost({ request, env }) {
  try {
    if (!PICBED_HASH) {
      return Response.json({ error: "图床未开启（还没设访问口令）" }, { status: 403 });
    }
    const body = await request.json().catch(() => ({}));
    const password = typeof body.password === "string" ? body.password : "";
    if (!password || (await sha256Hex(password)) !== PICBED_HASH) {
      return Response.json({ error: "口令不对" }, { status: 401 });
    }
    if (!env.R2_BUCKET) {
      return Response.json({ error: "R2 未绑定" }, { status: 500 });
    }
    const prefix = typeof body.prefix === "string" ? body.prefix.replace(/^\/+/, "") : "";
    const cursor = typeof body.cursor === "string" && body.cursor ? body.cursor : undefined;
    const listed = await env.R2_BUCKET.list({ prefix, limit: 200, cursor, delimiter: "/" });
    const base = (env.R2_PUBLIC_BASE || "").replace(/\/+$/, "");
    const folders = (listed.delimitedPrefixes || []).map((p) => ({
      prefix: p,
      name: p.replace(/\/$/, "").split("/").pop() || p,
    }));
    const objects = (listed.objects || [])
      .filter((o) => o.key !== prefix) // 前缀本身的占位对象不展示
      .map((o) => ({
        key: o.key,
        name: o.key.split("/").pop() || o.key,
        size: o.size,
        uploaded: o.uploaded,
        url: base ? `${base}/${o.key.split("/").map(encodeURIComponent).join("/")}` : "",
      }));
    return Response.json({
      folders,
      objects,
      truncated: !!listed.truncated,
      cursor: listed.truncated ? listed.cursor : null,
    });
  } catch (e) {
    return Response.json({ error: e.message || "未知错误" }, { status: 500 });
  }
}
