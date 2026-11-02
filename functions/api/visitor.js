/* GET /api/visitor
 * 返回访客的大致地理信息（城市级）。公告「访客检测版」用：国家/地区/城市/经纬度/时区。不落盘、不记录。
 *
 * 取数顺序：
 * 1. 经香港前置进来的请求（Host=origin.lanerc.me）：request.cf 描述的是
 *    前置机自身的位置（恒为中国香港），不能用；改读前置透传的访客 IP 现查。
 *    头的选择有讲究：X-Forwarded-For / X-Real-IP 会被 Cloudflare 边缘重写为
 *    「连到 CF 的那个 IP」（即前置机自己），到函数手里已经盖没了；所以前置
 *    另用自定义头 X-Visitor-Ip 传访客 IP——CF 不管理的头会原样透传。
 *    X-Real-IP / XFF 只作兜底（实际上到不了，留着无害）。
 * 2. 其余请求（CF 直连等）：直接用 request.cf（Cloudflare 自带，城市级）。
 * 现查失败一律回落 request.cf，前端拿不到 country 时会再回落静态公告。
 * 直连 origin 伪造透传头只能骗到自己的公告显示，无安全影响。
 */
const GEO_TIMEOUT_MS = 900;

async function lookupByIp(ip) {
	const ctl = new AbortController();
	const timer = setTimeout(() => ctl.abort(), GEO_TIMEOUT_MS);
	try {
		const url =
			"http://ip-api.com/json/" +
			encodeURIComponent(ip) +
			"?fields=status,countryCode,region,regionName,city,lat,lon,timezone";
		const res = await fetch(url, { signal: ctl.signal });
		if (!res.ok) return null;
		const j = await res.json();
		if (!j || j.status !== "success" || !j.countryCode) return null;
		return {
			country: j.countryCode || "",
			region: j.regionName || "",
			regionCode: j.region || "",
			city: j.city || "",
			latitude: typeof j.lat === "number" ? j.lat : null,
			longitude: typeof j.lon === "number" ? j.lon : null,
			timezone: j.timezone || "",
		};
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}

export async function onRequestGet({ request }) {
	const cf = request.cf || {};
	const num = (v) => {
		const n = parseFloat(v);
		return Number.isFinite(n) ? n : null;
	};
	const fromCf = {
		country: cf.country || "",
		region: cf.region || "",
		regionCode: cf.regionCode || "",
		city: cf.city || "",
		latitude: num(cf.latitude),
		longitude: num(cf.longitude),
		timezone: cf.timezone || "",
	};

	let data = null;
	try {
		if (new URL(request.url).hostname === "origin.lanerc.me") {
			const xvi = (request.headers.get("x-visitor-ip") || "").trim();
			const xri = (request.headers.get("x-real-ip") || "").trim();
			const xff = (request.headers.get("x-forwarded-for") || "")
				.split(",")[0]
				.trim();
			const ip = xvi || xri || xff;
			if (ip) data = await lookupByIp(ip);
		}
	} catch {
		data = null;
	}

	return Response.json(data || fromCf, {
		headers: { "Cache-Control": "no-store" },
	});
}
