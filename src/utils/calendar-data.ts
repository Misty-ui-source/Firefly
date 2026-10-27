import { getCollection } from "astro:content";
import holidays2026 from "../../calendar-data/holidays-2026.json";
import personalRecordsSeed from "../../calendar-data/personal-records.json";
import seuCalendar from "../../calendar-data/seu-calendar.json";
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
