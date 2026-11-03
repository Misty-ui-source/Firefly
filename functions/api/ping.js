/* GET /api/ping
 * 线路测速点：公告智能分流用。访客浏览器分别请求两条线（hk / origin）
 * 上的这个接口、比往返耗时，赢家作选线候选（实测优先、国家名单兜底）。
 * 只回 4 字节纯文本，不落盘、不记录；跨源读取靠 ACAO:* 放行（无敏感
 * 数据，响应内容对所有人相同）。no-store 保证测到的是真实路径耗时，
 * 不被任何一级缓存短路——香港前置对 /api 本来也不缓存。
 */
export async function onRequestGet() {
	return new Response("pong", {
		headers: {
			"Content-Type": "text/plain;charset=UTF-8",
			"Cache-Control": "no-store",
			"Access-Control-Allow-Origin": "*",
		},
	});
}
