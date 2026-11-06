/* POST /api/picbed-upload  （multipart 表单：password, dir?, files[]）
 * 图床门面（/picbed/）的上传接口：解锁后往当前目录传图。
 * 鉴权：与 picbed-list 同一套——口令的 SHA-256 与 _picbed-gate.js 里的哈希比对；
 *       哈希为空 = 图床关闭，一律 403（fail-closed）。
 * 存储规则与 /api/r2-upload 对齐：key = [dir/]<base36 时间戳>-<安全文件名>；dir 为空 = 存到桶根。
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
		const form = await request.formData();
		const password = String(form.get("password") || "");
		if (!password || (await sha256Hex(password)) !== PICBED_HASH) {
			return Response.json({ error: "口令不对" }, { status: 401 });
		}
		if (!env.R2_BUCKET) {
			return Response.json({ error: "R2 未绑定" }, { status: 500 });
		}
		const dir = String(form.get("dir") || "")
			.replace(/^\/+|\/+$/g, "")
			.replace(/\.\./g, "")
			.replace(/^\/+|\/+$/g, "");
		const files = form.getAll("files");
		if (!files.length) return Response.json({ error: "没有文件" }, { status: 400 });

		const urls = [];
		const stamp = Date.now().toString(36);
		const base = (env.R2_PUBLIC_BASE || "https://img.lanerc.me").replace(/\/+$/, "");
		for (const f of files) {
			if (typeof f === "string") continue;
			const safeName = f.name.replace(/[^a-zA-Z0-9._-]/g, "_");
			const key = `${dir ? `${dir}/` : ""}${stamp}-${safeName}`;
			await env.R2_BUCKET.put(key, f.stream(), {
				httpMetadata: { contentType: f.type || "application/octet-stream" },
			});
			urls.push(`${base}/${key.split("/").map(encodeURIComponent).join("/")}`);
		}
		if (!urls.length) return Response.json({ error: "没有文件" }, { status: 400 });
		return Response.json({ urls });
	} catch (e) {
		return Response.json({ error: `上传异常：${e.message}` }, { status: 500 });
	}
}
