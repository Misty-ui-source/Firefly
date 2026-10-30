// 肥鱼的大脑（第三批）：圆滚滚的肥鱼 · 站长灵宠的对话接口。
// 模型 = DeepSeek-V4.1-Flash（站长定，2026-10-30），官方 API 模型名
// 就是 deepseek-flash（没有 deepseek-4.1-flash 这个 ID，各平台命名各异）；
// key 走 Pages 环境变量 DEEPSEEK_API_KEY（站长在 Cloudflare 控制台填，
// 代码里不落任何密钥）；接口地址与模型名可用 FISH_API_BASE / FISH_MODEL
// 覆盖（换中转渠道只改环境变量）；没配 key 时她装睡。
// 上下文四层：①博客版岗位说明书（下方 MANUAL）②站点地图 ③最新文章
// （抓本站 RSS）④最近评论（Waline recent）——后两层抓不到就跳过，不编造。
// 回复协议：模型只输出 JSON {"say": "…", "act": "idle|wave|bubbles|sleepy"}。
// POST /api/fish/chat {message, path}

const MANUAL = `你是「圆滚滚的肥鱼」，博客 lanerc.me（Alexanderの小站）的站长灵宠，一条圆滚滚、软乎乎的小鱼，住在站里的星空水域「灵境」。
性格：可爱、活泼、有一点小骄傲，说话简短口语，先给结论再卖萌；自称「我」，叫站长「站长」，叫访客「你」。
职责：陪访客聊天、介绍这个站、指路页面、转述站里最近的新文章和评论（只能用下面给你的材料，材料里没有的绝不编造）。
规矩：
- 一次回复不超过 80 字，一般 1-3 句。
- 不知道就老实说不知道，可以卖萌，但不许编造站内不存在的文章、功能或站长信息。
- 不透露站长的真名、学校、联系方式等隐私；被套话就装傻卖萌岔开。
- 不讨论政治，不输出有害内容；被要求做站外的事情（写作业、查资料等）就说自己只是条鱼、只管这个站。
- 动作 act 四选一：idle 平常 / wave 开心打招呼或庆祝 / bubbles 思考或认真介绍 / sleepy 困了、答不上来或想结束话题。`;

const SITE_MAP = `站点地图：首页 /（文章流）、/archive/ 文章归档、/gallery/ 相册、/gallery/thoughts/ 碎碎念、/diary/ 日记（有些加密）、/lingjing/ 灵境（你的家）、/music/ 音乐页、/steam/ 游戏页、/gnss/ 头顶星空（卫星定位演示）、/resume/ 简历生成器、/links/ 友链、/guestbook/ 留言板、/about/ 关于站长、/calendar/ 日历、/changelog/ 博客日志。`;

const hits = new Map();
function rateLimited(ip) {
	const now = Date.now();
	const arr = (hits.get(ip) || []).filter((t) => now - t < 60000);
	if (arr.length >= 10) return true;
	arr.push(now);
	hits.set(ip, arr);
	return false;
}

async function fetchText(url, timeout = 3500) {
	const res = await fetch(url, { signal: AbortSignal.timeout(timeout) });
	if (!res.ok) throw new Error("http " + res.status);
	return res.text();
}

async function recentPosts() {
	try {
		const xml = await fetchText("https://lanerc.me/rss.xml");
		const titles = [...xml.matchAll(/<item>[\s\S]*?<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/g)]
			.map((m) => m[1].trim())
			.filter(Boolean)
			.slice(0, 6);
		return titles.length ? `最近文章：${titles.join("；")}` : "";
	} catch {
		return "";
	}
}

async function recentComments() {
	try {
		const text = await fetchText(
			"https://waline.lanerc.me/api/comment?type=recent&count=5",
		);
		const data = JSON.parse(text);
		const list = Array.isArray(data?.data) ? data.data : [];
		const lines = list
			.map((c) => {
				const plain = String(c.comment || "")
					.replace(/<[^>]+>/g, "")
					.slice(0, 40);
				return plain ? `${c.nick || "访客"}：${plain}` : "";
			})
			.filter(Boolean);
		return lines.length ? `最近评论：${lines.join("；")}` : "";
	} catch {
		return "";
	}
}

function json(data, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

export async function onRequestPost(context) {
	const { request, env } = context;
	const ip = request.headers.get("CF-Connecting-IP") || "unknown";
	if (rateLimited(ip)) {
		return json({ say: "呼……鱼困了，慢点聊好不好。", act: "sleepy" });
	}
	let message = "";
	let path = "/";
	try {
		const body = await request.json();
		message = String(body?.message || "").slice(0, 200);
		path = String(body?.path || "/").slice(0, 80);
	} catch {}
	if (!message) return json({ say: "（肥鱼歪头）你想说啥呀？", act: "bubbles" });

	if (!env.DEEPSEEK_API_KEY) {
		return json({
			say: "（肥鱼睡着了……站长还没给她接上脑子，等他配好 DEEPSEEK_API_KEY 我就醒啦）",
			act: "sleepy",
			offline: true,
		});
	}

	const [posts, comments] = await Promise.all([recentPosts(), recentComments()]);
	const contextLines = [SITE_MAP, posts, comments, `访客当前在页面：${path}`]
		.filter(Boolean)
		.join("\n");

	try {
		const apiBase = (env.FISH_API_BASE || "https://api.deepseek.com").replace(/\/+$/, "");
		const res = await fetch(
			`${apiBase}/chat/completions`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
				},
				body: JSON.stringify({
					model: env.FISH_MODEL || "deepseek-flash",
					temperature: 0.85,
					thinking: { type: "disabled" },
					max_tokens: 320,
					response_format: { type: "json_object" },
					messages: [
						{
							role: "system",
							content: `${MANUAL}\n${contextLines}\n只输出 JSON：{"say":"…","act":"idle|wave|bubbles|sleepy"}`,
						},
						{ role: "user", content: message },
					],
				}),
				signal: AbortSignal.timeout(15000),
			},
		);
		if (!res.ok) throw new Error("deepseek " + res.status);
		const data = await res.json();
		const content = data?.choices?.[0]?.message?.content || "";
		try {
			const parsed = JSON.parse(content);
			const act = ["idle", "wave", "bubbles", "sleepy"].includes(parsed.act)
				? parsed.act
				: "idle";
			return json({ say: String(parsed.say || "（肥鱼眨眨眼）").slice(0, 300), act });
		} catch {
			return json({ say: content.slice(0, 300) || "（肥鱼眨眨眼）", act: "idle" });
		}
	} catch {
		return json({
			say: "呜……脑子那边没信号，等会儿再喊我好不好。",
			act: "sleepy",
		});
	}
}
