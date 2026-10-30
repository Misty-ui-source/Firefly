// 浮动播放器 · 歌单拉取（第三批）：按平台歌单 ID 拉全单（歌名/歌手/封面/
// 各曲 ID），播放器打开时调用，点播再走 /api/music/resolve 取直链。
// GET /api/music/playlist?platform=wy|tx|kg&id=<歌单ID>
const UA =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

async function fetchText(url, headers = {}, timeout = 9000) {
	const res = await fetch(url, {
		headers: { "User-Agent": UA, ...headers },
		signal: AbortSignal.timeout(timeout),
	});
	if (!res.ok) throw new Error("上游 HTTP " + res.status);
	return res.text();
}

async function playlistNetease(id) {
	const text = await fetchText(
		`https://music.163.com/api/v3/playlist/detail?id=${encodeURIComponent(id)}`,
		{ Referer: "https://music.163.com/" },
	);
	const data = JSON.parse(text);
	const pl = data?.playlist;
	if (!pl || !Array.isArray(pl.tracks)) throw new Error("网易云歌单解析失败");
	return {
		name: pl.name || "",
		tracks: pl.tracks.map((t) => ({
			id: String(t.id),
			name: t.name || "",
			artist: (t.ar || []).map((a) => a.name).join(" / "),
			pic: t.al?.picUrl || "",
		})),
	};
}

async function playlistTencent(id) {
	const text = await fetchText(
		`https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg?type=1&json=1&utf8=1&onlysong=0&disstid=${encodeURIComponent(id)}`,
		{ Referer: "https://y.qq.com/" },
	);
	const data = JSON.parse(text);
	const cd = data?.cdlist?.[0];
	if (!cd || !Array.isArray(cd.songlist)) throw new Error("QQ 歌单解析失败");
	return {
		name: cd.dissname || "",
		tracks: cd.songlist.map((t) => ({
			id: String(t.songmid || ""),
			name: t.songname || "",
			artist: (t.singer || []).map((a) => a.name).join(" / "),
			pic: t.albummid
				? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${t.albummid}.jpg`
				: "",
		})),
	};
}

async function playlistKugou(id) {
	// 酷狗歌单页把曲目嵌在页面的 global_collection 里，尽力解析
	const html = await fetchText(
		`https://www.kugou.com/yy/special/single/${encodeURIComponent(id)}.html`,
		{},
	);
	const m = html.match(/global_collection\s*=\s*(\[[\s\S]*?\]);/);
	if (!m) throw new Error("酷狗歌单解析失败");
	const list = JSON.parse(m[1]);
	return {
		name: "",
		tracks: list.map((t) => ({
			id: String(t.hash || ""),
			name: String(t.audio_name || "").replace(/^\S+\s-\s/, ""),
			artist: t.singername || t.author_name || "",
			pic: String(t.img || t.album_img || "").replace("{size}", "200"),
		})),
	};
}

function json(data, status = 200, extraHeaders = {}) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json", ...extraHeaders },
	});
}

export async function onRequestGet(context) {
	const { request } = context;
	const u = new URL(request.url);
	const platform = u.searchParams.get("platform") || "";
	const id = u.searchParams.get("id") || "";
	const handlers = { wy: playlistNetease, tx: playlistTencent, kg: playlistKugou };
	if (!handlers[platform] || !id) {
		return json({ error: "参数缺失或平台不支持" }, 400);
	}
	const cache = caches.default;
	const cacheKey = new Request(u.toString(), { method: "GET" });
	const hit = await cache.match(cacheKey);
	if (hit) return hit;
	try {
		const data = await handlers[platform](id);
		const res = json(
			{ platform, ...data },
			200,
			{ "Cache-Control": "public, max-age=600" },
		);
		context.waitUntil(cache.put(cacheKey, res.clone()));
		return res;
	} catch (e) {
		return json({ error: String(e?.message || e) }, 502);
	}
}
