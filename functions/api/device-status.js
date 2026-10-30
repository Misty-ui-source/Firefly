/* GET /api/device-status
 * 璨夜首页「此刻」卡下半的设备在线状态：服务端读 Komari 探针的公开接口
 * （节点基本信息 + 每台最近一条监控记录），只透出精简字段——名字、是否
 * 在线（以最近记录时间戳新鲜度判定）、系统运行时长（秒）。到期日、价格、
 * 硬件明细等一律在这一层滤掉，不进响应。探针地址只出现在这里，前端不
 * 直连。响应在边缘缓存 60 秒，上游异常时返回 ok:false 让前端走兜底文案。
 */

const PROBE_BASE = "http://3.106.241.76:25774";
const PROBE_HEADERS = { "User-Agent": "lanerc-device-status/1.0" };
// 探针 agent 约每分钟上报一条；最近记录在 3 分钟内算在线，
// 另留 2 分钟容忍探针服务器与边缘之间的时钟偏差。
const ONLINE_MAX_AGE_MS = 180_000;
const ONLINE_MAX_SKEW_MS = 120_000;

async function fetchJson(url, timeoutMs) {
	const res = await fetch(url, {
		headers: PROBE_HEADERS,
		signal: AbortSignal.timeout(timeoutMs),
	});
	if (!res.ok) throw new Error(`upstream ${res.status}`);
	return res.json();
}

export async function onRequestGet(context) {
	const { request } = context;

	// 边缘缓存 60 秒：命中直接返回，不再打探针
	const cacheKey = new Request(new URL("/api/device-status", request.url), {
		method: "GET",
	});
	try {
		const hit = await caches.default.match(cacheKey);
		if (hit) return hit;
	} catch {
		/* 缓存不可用时直查上游 */
	}

	let payload;
	try {
		const nodesJson = await fetchJson(`${PROBE_BASE}/api/nodes`, 6000);
		const nodes = (Array.isArray(nodesJson?.data) ? nodesJson.data : [])
			.filter((n) => n && !n.hidden)
			.sort((a, b) => (a.weight ?? 0) - (b.weight ?? 0));

		const now = Date.now();
		const devices = await Promise.all(
			nodes.map(async (node) => {
				let online = false;
				let uptime = null;
				try {
					const recent = await fetchJson(
						`${PROBE_BASE}/api/recent/${encodeURIComponent(node.uuid)}`,
						5000,
					);
					const rows = Array.isArray(recent?.data) ? recent.data : [];
					let latest = null;
					for (const row of rows) {
						const ts = Date.parse(row?.updated_at ?? "");
						if (Number.isFinite(ts) && (!latest || ts > latest.ts)) {
							latest = { ts, row };
						}
					}
					if (latest) {
						const age = now - latest.ts;
						online = age < ONLINE_MAX_AGE_MS && age > -ONLINE_MAX_SKEW_MS;
						if (typeof latest.row.uptime === "number") {
							uptime = latest.row.uptime;
						}
					}
				} catch {
					/* 单台记录拉不到只影响这一台，按离线处理 */
				}
				return { name: String(node.name ?? ""), online, uptime };
			}),
		);

		payload = {
			ok: true,
			total: devices.length,
			online: devices.filter((d) => d.online).length,
			devices,
		};
	} catch (e) {
		// 诊断（2026-10-30）：只回错误类别，不带上游地址——区分探针拒绝(http 状态)、
		// 超时(防火墙丢弃)与连接失败(CF 侧/网络)，供定位边缘不可达问题。
		const msg = String((e && e.message) || e);
		const kind = msg.startsWith("upstream ")
			? msg
			: /abort|timeout|timed out/i.test(msg)
				? "timeout"
				: "fetch_failed";
		payload = { ok: false, total: 0, online: 0, devices: [], err: kind };
	}

	const response = Response.json(payload, {
		headers: { "Cache-Control": "public, max-age=60" },
	});
	// 只缓存成功结果，失败不落缓存以便尽快恢复
	if (payload.ok) {
		try {
			context.waitUntil(caches.default.put(cacheKey, response.clone()));
		} catch {
			/* 缓存写入失败不影响本次响应 */
		}
	}
	return response;
}
