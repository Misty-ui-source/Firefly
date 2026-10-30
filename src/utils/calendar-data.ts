import { getCollection } from "astro:content";
import holidays2026 from "../../calendar-data/holidays-2026.json";
import personalRecordsSeed from "../../calendar-data/personal-records.json";
import seuCalendar from "../../calendar-data/seu-calendar.json";
import { lunarFestival, solarToLunar } from "./lunar";
import { SOLAR_TERMS } from "./solar-terms-data";
import { getPostUrlBySlug } from "./url-utils";

// 日历页数据层（构建时）：文章/动态/日记按发布日期归日；节假日、东南大学校历、
// 个人记录来自仓库根目录 calendar-data/ 的 JSON（个人记录由控制台编辑、
// 节假日与校历由年度任务维护，页面运行时还会再拉一次 raw 最新版覆盖）

export interface CalEvent {
	date: string; // YYYY-MM-DD（Asia/Shanghai）
	kind: "post" | "dynamic" | "diary" | "record" | "holiday" | "workday" | "seu";
	title: string;
	url?: string;
	note?: string;
}

export interface HolidayDay {
	date: string;
	name: string;
	type: "holiday" | "workday";
}

export interface SeuItem {
	start: string;
	end: string;
	title: string;
	kind: string;
}

export interface PersonalRecord {
	date: string;
	title: string;
	note?: string;
}

// 任意时刻 → 上海时区的日历日（站内日期语义统一按 +08）
export function dateKeyOf(d: Date): string {
	return new Date(d.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

function excerpt(body: string | undefined, max = 60): string {
	if (!body) return "";
	// 先整体摘掉图片嵌入与 HTML，再逐行找第一句正文（链接保留文字）
	const text = body
		.replace(/!\[[^\]]*\]\([^)]*\)/g, "")
		.replace(/<[^>]+>/g, "");
	const line = text
		.split("\n")
		.map((s) => s.trim())
		.find((s) => s && !s.startsWith("<!--") && !s.startsWith("import"));
	if (!line) return "";
	const clean = line
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/[#>*`_]/g, "")
		.trim();
	return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

export async function getCalendarEvents(): Promise<CalEvent[]> {
	const events: CalEvent[] = [];
	const prod = import.meta.env.PROD;

	const posts = await getCollection("posts", ({ data }) =>
		prod ? data.draft !== true : true,
	);
	for (const p of posts) {
		events.push({
			date: dateKeyOf(new Date(p.data.published)),
			kind: "post",
			title: p.data.title,
			url: getPostUrlBySlug(p.id),
		});
	}

	const dynamics = await getCollection("dynamic", () => true);
	for (const d of dynamics) {
		events.push({
			date: dateKeyOf(new Date(d.data.published)),
			kind: "dynamic",
			title: excerpt((d as { body?: string }).body) || "动态",
			url: "/dynamic/",
		});
	}

	const diaries = await getCollection("diary", ({ data }) =>
		prod ? data.draft !== true && !data.password : true,
	);
	for (const d of diaries) {
		events.push({
			date: dateKeyOf(new Date(d.data.published)),
			kind: "diary",
			title: d.data.title,
			url: "/diary/",
		});
	}

	return events;
}

export function getBundledCalendarLayers() {
	return {
		holidays: { "2026": holidays2026 as HolidayDay[] } as Record<
			string,
			HolidayDay[]
		>,
		seu: seuCalendar as SeuItem[],
		records: personalRecordsSeed as PersonalRecord[],
	};
}

// 那年今日：同月同日、往年（不含今年）的文章/动态/日记/个人记录
export interface OnThisDayItem {
	year: number;
	kind: CalEvent["kind"];
	title: string;
	url?: string;
}

export async function getOnThisDayMap(): Promise<
	Record<string, OnThisDayItem[]>
> {
	const map: Record<string, OnThisDayItem[]> = {};
	const push = (date: string, item: OnThisDayItem) => {
		const md = date.slice(5);
		if (!map[md]) map[md] = [];
		map[md].push(item);
	};
	for (const e of await getCalendarEvents()) {
		if (e.kind === "holiday" || e.kind === "workday" || e.kind === "seu")
			continue;
		push(e.date, {
			year: Number(e.date.slice(0, 4)),
			kind: e.kind,
			title: e.title,
			url: e.url,
		});
	}
	for (const r of personalRecordsSeed as PersonalRecord[]) {
		push(r.date, { year: Number(r.date.slice(0, 4)), kind: "record", title: r.title });
	}
	for (const list of Object.values(map)) {
		list.sort((a, b) => b.year - a.year);
	}
	return map;
}

// 近在眼前（首页条用）：从今天起往后 60 天，找最近的一个值得倒计时的日子。
// 扫描口径与日历页前端倒计时一致（同日内的先后：节气 → 农历节日 → 假期首日
// → 校历起始日 → 个人记录），只取第一条。日期语义全程在「上海日历日」空间里
// 用键字符串 + UTC 零点推算，避免构建机时区带来的漂移。
export interface NextCountdown {
	name: string;
	tag: "节气" | "农历" | "假期" | "校历" | "记录";
	date: string; // YYYY-MM-DD
	daysLeft: number; // 0 = 今天
}

export function getNextCountdown(): NextCountdown | null {
	const layers = getBundledCalendarLayers();
	const todayKey = dateKeyOf(new Date());
	const [ty, tm, td] = todayKey.split("-").map(Number);
	const baseMs = Date.UTC(ty, tm - 1, td);
	const seenHoliday = new Set<string>();

	for (let off = 0; off <= 60; off++) {
		const cur = new Date(baseMs + off * 86400000);
		const y = cur.getUTCFullYear();
		const m = cur.getUTCMonth() + 1;
		const d = cur.getUTCDate();
		const k = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

		const term = SOLAR_TERMS[k];
		if (term) return { name: term, tag: "节气", date: k, daysLeft: off };

		const fest = lunarFestival(solarToLunar(y, m, d));
		if (fest) return { name: fest, tag: "农历", date: k, daysLeft: off };

		for (const h of layers.holidays[String(y)] || []) {
			if (h.date === k && h.type !== "workday" && !seenHoliday.has(h.name)) {
				seenHoliday.add(h.name);
				return { name: h.name, tag: "假期", date: k, daysLeft: off };
			}
		}
		for (const s of layers.seu) {
			if (s.start === k)
				return { name: s.title, tag: "校历", date: k, daysLeft: off };
		}
		for (const r of layers.records) {
			if (r.date === k)
				return { name: r.title, tag: "记录", date: k, daysLeft: off };
		}
	}
	return null;
}
