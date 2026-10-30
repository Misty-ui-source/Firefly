// 浮动播放器 · 直链解析（第三批）
// 「全豆要 v4.1」聚合音源（LX 自定义源格式）的服务端移植：原脚本依赖
// LX 运行时（globalThis.lx），这里把它的服务商链路与回退顺序搬到
// Pages Function，前端只认本接口。链路（与原脚本 buildSourceChain 一致）：
// 星海主 → 平台专属溯音（wy 溯音163 / tx 溯音QQ / kw 溯音酷我搜索 /
// mg 溯音咪咕）→ 长青SVIP → 念心SVIP；前段并发、后段顺序回退。
// 原脚本里 Huibq / 聆川 两个处理器的端点常量从未定义（死代码），移植时略去。
// GET /api/music/resolve?platform=wy|tx|kw|kg|mg&id=&name=&singer=&quality=320k

const CACHE_TTL_MS = 21600000;
const HTTP_URL_REGEX = /^https?:\/\//i;

const XINGHAI_MAIN_API =
	"https://music-api.gdstudio.xyz/api.php?use_xbridge3=true&loader_name=forest&need_sec_link=1&sec_link_scene=im&theme=light";
const SUYIN_QQ_API = "https://oiapi.net/api/QQ_Music";
const SUYIN_QQ_KEY = "oiapi-ef6133b7-ac2f-dc7d-878c-d3e207a82575";
const SUYIN_163_API = "https://oiapi.net/api/Music_163";
const SUYIN_KUWO_API = "https://oiapi.net/api/Kuwo";
const SUYIN_MIGU_API = "https://api.xcvts.cn/api/music/migu";

const CHANGQING_URL_TEMPLATES = {
	tx: "http://175.27.166.236/kgqq/qq.php?type=mp3&id={id}&level={level}",
	wy: "http://175.27.166.236/wy/wy.php?type=mp3&id={id}&level={level}",
	kw: "https://musicapi.haitangw.net/music/kw.php?type=mp3&id={id}&level={level}",
	kg: "https://music.haitangw.cc/kgqq/kg.php?type=mp3&id={id}&level={level}",
	mg: "https://music.haitangw.cc/musicapi/mg.php?type=mp3&id={id}&level={level}",
};
const NIANXIN_URL_TEMPLATES = {
	tx: "https://music.nxinxz.com/kgqq/tx.php?id={id}&level={level}&type=mp3",
	wy: "http://music.nxinxz.com/wy.php?id={id}&level={level}&type=mp3",
	kw: "http://music.nxinxz.com/kw.php?id={id}&level={level}&type=mp3",
	kg: "https://music.nxinxz.com/kgqq/kg.php?id={id}&level={level}&type=mp3",
	mg: "http://music.nxinxz.com/mg.php?id={id}&level={level}&type=mp3",
};

const PLATFORM_QUALITIES = {
	wy: ["24bit", "flac", "320k", "192k", "128k"],
	tx: ["24bit", "flac", "320k", "192k", "128k"],
	kw: ["24bit", "flac", "320k", "192k", "128k"],
	kg: ["24bit", "flac", "320k", "192k", "128k"],
	mg: ["24bit", "flac", "320k", "192k", "128k"],
};
const PLATFORM_TO_XINGHAI = {
	wy: "netease",
	tx: "tencent",
	kw: "kuwo",
	kg: "kugou",
	mg: "migu",
};
const QUALITY_TO_BR = {
	"128k": "128",
	"192k": "192",
	"320k": "320",
	flac: "740",
	flac24bit: "999",
	"24bit": "999",
};
const QUALITY_TO_SUYIN_QQ_BR = {
	"128k": 7,
	"320k": 5,
	flac: 4,
	hires: 3,
	atmos: 2,
	master: 1,
	"24bit": 1,
};
const QUALITY_TO_KUWO_BR = { flac: 1, "320k": 5, "128k": 7, "24bit": 1 };

const urlCache = new Map();

async function httpRequest(url, options = {}) {
	const res = await fetch(url, {
		method: options.method || "GET",
		headers: options.headers || {},
		body: options.body ? JSON.stringify(options.body) : undefined,
		signal: AbortSignal.timeout(options.timeout || 6000),
	});
	let body = await res.text();
	const trimmed = body.trim();
	if (
		trimmed.startsWith("{") ||
		trimmed.startsWith("[") ||
		trimmed.startsWith('"')
	) {
		try {
			body = JSON.parse(trimmed);
		} catch {}
	}
	return { statusCode: res.status, headers: {}, body };
}

async function httpGet(url, params = {}) {
	const qs = Object.keys(params)
		.filter((k) => params[k] !== undefined && params[k] !== null)
		.map((k) => encodeURIComponent(k) + "=" + encodeURIComponent(params[k]))
		.join("&");
	const full = url + (qs ? (url.includes("?") ? "&" : "?") + qs : "");
	const res = await httpRequest(full, { method: "GET", timeout: 6000 });
	if (res.statusCode >= 400) throw new Error("HTTP错误: " + res.statusCode);
	return res.body;
}

function getSongId(songInfo) {
	return (
		songInfo?.id ||
		songInfo?.songmid ||
		songInfo?.songId ||
		songInfo?.hash ||
		songInfo?.rid ||
		songInfo?.mid ||
		songInfo?.strMediaMid ||
		songInfo?.mediaId ||
		""
	).toString();
}

function selectQuality(requestedQuality, supportedQualities) {
	if (requestedQuality === "24bit") return "24bit";
	const qualityList = Array.isArray(supportedQualities)
		? supportedQualities
		: ["128k"];
	const normalized = String(requestedQuality || "128k").toLowerCase();
	if (qualityList.includes(normalized)) return normalized;
	const qualityOrder = ["flac24bit", "flac", "320k", "192k", "128k"];
	let idx = qualityOrder.indexOf(normalized);
	if (idx < 0) idx = qualityOrder.length - 1;
	for (let i = idx; i < qualityOrder.length; i++) {
		if (qualityList.includes(qualityOrder[i])) return qualityOrder[i];
	}
	for (let i = qualityOrder.length - 1; i >= 0; i--) {
		if (qualityList.includes(qualityOrder[i])) return qualityOrder[i];
	}
	return qualityList[0] || "128k";
}

function normalizeKeyword(keyword) {
	if (!keyword) return "";
	return String(keyword)
		.replace(/\(\s*Live\s*\)/gi, "")
		.replace(/\([^)]*\)/g, "")
		.replace(/\s+/g, "")
		.replace(/[^\w\u4e00-\u9fa5]/g, "")
		.trim()
		.toLowerCase();
}

function buildSearchKeywords(songInfo) {
	const keywords = [];
	const name = songInfo?.name || "";
	const album = songInfo?.albumName || songInfo?.album || "";
	const singer = songInfo?.singer || "";
	if (name && album) {
		const kw = normalizeKeyword(name + album);
		if (kw) keywords.push({ keyword: kw, strict: true });
	}
	if (name && singer) {
		const kw = normalizeKeyword(name + singer);
		if (kw) keywords.push({ keyword: kw, strict: true });
	}
	if (name) {
		const kw = normalizeKeyword(name);
		if (kw) keywords.push({ keyword: kw, strict: false });
	}
	return keywords;
}

function titleMatch(a, b) {
	const na = normalizeKeyword(a);
	const nb = normalizeKeyword(b);
	if (!na || !nb) return true;
	return na.includes(nb) || nb.includes(na);
}

function songInfoMatch(responseData, songInfo) {
	const song = responseData?.song || responseData?.data?.song || "";
	const singer = responseData?.singer || responseData?.data?.singer || "";
	const album = responseData?.album || responseData?.data?.album || "";
	if (!titleMatch(song, songInfo?.name || "")) return false;
	if (songInfo?.singer && singer && !titleMatch(singer, songInfo.singer))
		return false;
	if (
		(songInfo?.albumName || songInfo?.album) &&
		album &&
		!titleMatch(album, songInfo.albumName || songInfo.album)
	)
		return false;
	return true;
}

function songTitleMatch(responseData, songInfo) {
	if (!titleMatch(responseData?.title || "", songInfo?.name || "")) return false;
	if (
		songInfo?.singer &&
		responseData?.artist &&
		!titleMatch(responseData.artist, songInfo.singer)
	)
		return false;
	if (
		(songInfo?.albumName || songInfo?.album) &&
		responseData?.album &&
		!titleMatch(responseData.album, songInfo.albumName || songInfo.album)
	)
		return false;
	return true;
}

function parseMessageSongInfo(message) {
	if (!message) return null;
	const result = {};
	for (const line of String(message).split("\n")) {
		if (line.startsWith("歌名：")) result.song = line.replace("歌名：", "").trim();
		if (line.startsWith("歌手："))
			result.singer = line.replace("歌手：", "").trim();
		if (line.startsWith("专辑："))
			result.album = line.replace("专辑：", "").trim();
	}
	return result.song ? result : null;
}

function getHashOrMid(songInfo) {
	return songInfo?.hash ?? songInfo?.songmid ?? songInfo?.id ?? null;
}

function getQQSongId(songInfo) {
	const mid =
		songInfo?.meta?.qq?.mid ||
		songInfo?.meta?.mid ||
		songInfo?.songmid ||
		(typeof songInfo?.id === "string" && !/^\d+$/.test(songInfo.id)
			? songInfo.id
			: null);
	if (mid) return { type: "mid", value: mid };
	const songid =
		songInfo?.meta?.qq?.songid ||
		songInfo?.meta?.songid ||
		(typeof songInfo?.id === "number"
			? songInfo.id
			: typeof songInfo?.id === "string" && /^\d+$/.test(songInfo.id)
				? Number(songInfo.id)
				: null);
	if (songid) return { type: "songid", value: songid };
	return null;
}

function qualityToNetease(quality) {
	const q = String(quality || "128k").toLowerCase();
	if (
		q === "flac" ||
		q === "flac24bit" ||
		q === "hires" ||
		q === "master" ||
		q === "atmos"
	)
		return "lossless";
	if (q === "320k" || q === "192k") return "exhigh";
	return "standard";
}

function getPlatformSongId(platform, songInfo) {
	if (platform === "kg") {
		return (
			songInfo?.hash ||
			songInfo?.songmid ||
			songInfo?.id ||
			songInfo?.rid ||
			songInfo?.mid ||
			null
		);
	}
	if (platform === "tx") {
		const qqId = getQQSongId(songInfo);
		if (qqId?.value) return qqId.value;
	}
	return (
		songInfo?.songmid ||
		songInfo?.id ||
		songInfo?.songId ||
		songInfo?.rid ||
		songInfo?.hash ||
		null
	);
}

function buildTemplateUrl(platform, quality, songInfo, templates, sourceName) {
	const template = templates[platform];
	if (!template) throw new Error(sourceName + "不支持该平台");
	const songId = getPlatformSongId(platform, songInfo);
	if (!songId) throw new Error(sourceName + "缺少songId");
	const level = qualityToNetease(quality);
	return template
		.replace("{id}", encodeURIComponent(String(songId)))
		.replace("{level}", encodeURIComponent(level));
}

function buildCacheKey(prefix, songInfo, quality = "") {
	const name = songInfo?.name || "";
	const singer = songInfo?.singer || "";
	const album = songInfo?.albumName || songInfo?.album || "";
	return prefix + "_" + name + "_" + singer + "_" + album + "_" + quality;
}

function getCachedUrl(cacheKey) {
	const entry = urlCache.get(cacheKey);
	if (!entry) return null;
	if (Date.now() - entry.timestamp >= CACHE_TTL_MS) {
		urlCache.delete(cacheKey);
		return null;
	}
	return entry.url;
}

function setCachedUrl(cacheKey, url) {
	urlCache.set(cacheKey, { url, timestamp: Date.now() });
	if (urlCache.size > 500) {
		const oldestKey = urlCache.keys().next().value;
		if (oldestKey !== undefined) urlCache.delete(oldestKey);
	}
}

function validateUrl(url, sourceName) {
	if (!url || typeof url !== "string") throw new Error(sourceName + "返回空URL");
	if (!HTTP_URL_REGEX.test(url.trim()))
		throw new Error(sourceName + "非法URL格式");
	return url;
}

async function xinghaiMainGetUrl(platform, songId, quality, songInfo) {
	const source = PLATFORM_TO_XINGHAI[platform];
	if (!source) throw new Error("星海主API不支持该平台");
	const id = songId ?? getHashOrMid(songInfo);
	if (!id) throw new Error("缺少songId");
	const selectedQuality = selectQuality(quality, [
		"128k",
		"192k",
		"320k",
		"flac",
		"flac24bit",
	]);
	const br = QUALITY_TO_BR[selectedQuality];
	if (!br) throw new Error("星海主API音质映射失败");
	const url =
		XINGHAI_MAIN_API +
		"&types=url&source=" +
		source +
		"&id=" +
		encodeURIComponent(id) +
		"&br=" +
		br;
	const res = await httpRequest(url, {
		method: "GET",
		headers: { "User-Agent": "LX-Music-Mobile", Accept: "application/json" },
	});
	const body = res.body;
	if (!body || typeof body !== "object" || !body.url) {
		throw new Error(body?.message || "星海主API未返回可用URL");
	}
	return body.url;
}

function extractQQUrl(responseData) {
	if (responseData?.music) return responseData.music;
	if (responseData?.url) return responseData.url;
	if (responseData?.message) {
		const match = String(responseData.message).match(/音频链接[：:](.+?)(?:\n|$)/);
		if (match && match[1]) return match[1].trim();
	}
	throw new Error("溯音QQ未找到音频链接");
}

function qualityToSuyinQQ(quality) {
	const q = String(quality || "128k").toLowerCase();
	if (q === "flac24bit") return "hires";
	if (q === "192k") return "320k";
	if (QUALITY_TO_SUYIN_QQ_BR[q]) return q;
	return "128k";
}

async function suyinQQGetUrl(songInfo, quality) {
	const qqId = getQQSongId(songInfo);
	if (!qqId) throw new Error("溯音QQ缺少songmid/id");
	const normalizedQuality = qualityToSuyinQQ(quality);
	const startBr =
		QUALITY_TO_SUYIN_QQ_BR[normalizedQuality] || QUALITY_TO_SUYIN_QQ_BR["128k"];
	const brList = [startBr, 4, 5, 7]
		.filter((val, idx, arr) => arr.indexOf(val) === idx && val >= startBr)
		.sort((a, b) => a - b);
	let lastError = null;
	for (const br of brList) {
		try {
			const reqParams = { key: SUYIN_QQ_KEY, type: "json", br, n: 1 };
			if (qqId.type === "mid") reqParams.mid = qqId.value;
			else reqParams.songid = qqId.value;
			const res = await httpGet(SUYIN_QQ_API, reqParams);
			return extractQQUrl(res);
		} catch (e) {
			lastError = e;
		}
	}
	throw new Error("溯音QQ全部音质尝试失败: " + (lastError?.message || "unknown"));
}

async function suyin163GetUrl(songInfo) {
	const id = songInfo?.songmid || songInfo?.id;
	if (!id) throw new Error("溯音163缺少songmid/id");
	const res = await httpGet(SUYIN_163_API, { id });
	if (res?.code === 0 && res?.data) {
		const item = Array.isArray(res.data) ? res.data[0] : res.data;
		if (item?.url) return item.url;
	}
	throw new Error("溯音163获取失败");
}

async function suyinKuwoSearch(keyword, br, songInfo = null) {
	const res = await httpGet(SUYIN_KUWO_API, { msg: keyword, n: 1, br });
	if (res?.data?.url) {
		if (songInfo && !songInfoMatch(res, songInfo)) {
			throw new Error("溯音酷我歌曲信息不匹配");
		}
		return res.data.url;
	}
	if (res?.message) {
		const match = String(res.message).match(/音乐链接[：:](\S+)/);
		if (match && match[1]) {
			if (songInfo) {
				const parsed = parseMessageSongInfo(res.message);
				if (parsed && !songInfoMatch(parsed, songInfo)) {
					throw new Error("溯音酷我歌曲信息不匹配");
				}
			}
			return match[1];
		}
	}
	throw new Error("溯音酷我未找到链接");
}

async function suyinKuwoGetUrl(songInfo, quality) {
	if (!songInfo?.name) throw new Error("溯音酷我需要歌曲名");
	const cacheKey = buildCacheKey("kw", songInfo, quality);
	const cached = getCachedUrl(cacheKey);
	if (cached) return cached;
	const selectedQuality = selectQuality(quality, ["flac", "320k", "128k"]);
	const br = QUALITY_TO_KUWO_BR[selectedQuality] || 1;
	const keywords = buildSearchKeywords(songInfo);
	let lastError = null;
	for (const item of keywords) {
		try {
			const url = await suyinKuwoSearch(
				item.keyword,
				br,
				item.strict ? songInfo : null,
			);
			if (url) {
				setCachedUrl(cacheKey, url);
				return url;
			}
		} catch (e) {
			lastError = e;
		}
	}
	throw new Error("溯音酷我失败: " + (lastError?.message || "unknown"));
}

async function suyinMiguGetUrl(songInfo) {
	if (!songInfo?.name) throw new Error("溯音咪咕需要歌曲名");
	const cacheKey = buildCacheKey("mg", songInfo);
	const cached = getCachedUrl(cacheKey);
	if (cached) return cached;
	const keywords = buildSearchKeywords(songInfo);
	let lastError = null;
	for (const item of keywords) {
		try {
			const res = await httpGet(SUYIN_MIGU_API, {
				gm: item.keyword,
				n: 1,
				num: 1,
				type: "json",
			});
			if (res?.code === 200 && res?.musicInfo) {
				if (item.strict && !songTitleMatch(res, songInfo)) {
					throw new Error("溯音咪咕歌曲信息不匹配");
				}
				setCachedUrl(cacheKey, res.musicInfo);
				return res.musicInfo;
			}
		} catch (e) {
			lastError = e;
		}
	}
	throw new Error("溯音咪咕失败: " + (lastError?.message || "unknown"));
}

async function suyinGetUrl(platform, songId, quality, songInfo) {
	switch (platform) {
		case "tx":
			return suyinQQGetUrl(songInfo, quality);
		case "wy":
			return suyin163GetUrl(songInfo);
		case "kw":
			return suyinKuwoGetUrl(songInfo, quality);
		case "mg":
			return suyinMiguGetUrl(songInfo);
		default:
			throw new Error("溯音不支持该平台");
	}
}

async function changqingGetUrl(platform, songId, quality, songInfo) {
	return buildTemplateUrl(
		platform,
		quality,
		songInfo,
		CHANGQING_URL_TEMPLATES,
		"长青SVIP",
	);
}

async function nianxinGetUrl(platform, songId, quality, songInfo) {
	return buildTemplateUrl(
		platform,
		quality,
		songInfo,
		NIANXIN_URL_TEMPLATES,
		"念心SVIP",
	);
}

const SOURCE_HANDLERS = {
	xinghai: { name: "星海主", fn: xinghaiMainGetUrl },
	suyinQQ: {
		name: "溯音QQ",
		fn: (p, id, q, info) => suyinGetUrl("tx", id, q, info),
	},
	suyin163: {
		name: "溯音163",
		fn: (p, id, q, info) => suyinGetUrl("wy", id, q, info),
	},
	suyinSearch: {
		name: "溯音搜索",
		fn: (p, id, q, info) => suyinGetUrl("kw", id, q, info),
	},
	suyinMigu: {
		name: "溯音咪咕",
		fn: (p, id, q, info) => suyinGetUrl("mg", id, q, info),
	},
	changqingVip: { name: "长青SVIP", fn: changqingGetUrl },
	nianxinVip: { name: "念心SVIP", fn: nianxinGetUrl },
};

function buildSourceChain(platform) {
	const chain = [SOURCE_HANDLERS.xinghai];
	if (platform === "wy") chain.push(SOURCE_HANDLERS.suyin163);
	if (platform === "tx") chain.push(SOURCE_HANDLERS.suyinQQ);
	if (platform === "kw") chain.push(SOURCE_HANDLERS.suyinSearch);
	if (platform === "mg") chain.push(SOURCE_HANDLERS.suyinMigu);
	chain.push(SOURCE_HANDLERS.changqingVip, SOURCE_HANDLERS.nianxinVip);
	return chain;
}

async function getUrlWithFallback(platform, songInfo, quality) {
	if (!platform || !PLATFORM_QUALITIES[platform]) {
		throw new Error("无效的平台参数");
	}
	if (!songInfo || typeof songInfo !== "object") {
		throw new Error("无效的歌曲信息");
	}
	const resolvedQuality = quality || "320k";
	const selectedQuality = selectQuality(
		resolvedQuality,
		PLATFORM_QUALITIES[platform],
	);
	const songId = getHashOrMid(songInfo);
	const chain = buildSourceChain(platform);
	const errors = [];
	try {
		const url = await Promise.any(
			chain.slice(0, 3).map(async (handler) => {
				const result = await handler.fn(
					platform,
					songId,
					selectedQuality,
					songInfo,
				);
				return validateUrl(result, handler.name);
			}),
		);
		if (url) return url;
	} catch (e) {
		if (e.errors) e.errors.forEach((err) => errors.push(err.message));
	}
	for (const handler of chain.slice(3)) {
		try {
			const result = await handler.fn(
				platform,
				songId,
				selectedQuality,
				songInfo,
			);
			return validateUrl(result, handler.name);
		} catch (e) {
			errors.push(handler.name + ": " + e.message);
		}
	}
	throw new Error("所有源均失败: " + errors.join("; "));
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
	const name = u.searchParams.get("name") || "";
	const singer = u.searchParams.get("singer") || "";
	const quality = u.searchParams.get("quality") || "320k";
	if (!PLATFORM_QUALITIES[platform] || !id) {
		return json({ error: "参数缺失或平台不支持" }, 400);
	}

	// 边缘缓存 20 分钟（直链本身有有效期，不宜久存）
	const cache = caches.default;
	const cacheKey = new Request(u.toString(), { method: "GET" });
	const hit = await cache.match(cacheKey);
	if (hit) return hit;

	const songInfo = { id, songmid: id, hash: id, name, singer };
	try {
		const url = await getUrlWithFallback(platform, songInfo, quality);
		const res = json(
			{ url, platform, quality },
			200,
			{ "Cache-Control": "public, max-age=1200" },
		);
		context.waitUntil(cache.put(cacheKey, res.clone()));
		return res;
	} catch (e) {
		return json({ error: String(e?.message || e) }, 502);
	}
}
