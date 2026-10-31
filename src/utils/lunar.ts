import { LUNAR_INFO } from "./lunar-data";

// 农历换算（服务端版）：算法与日历页前端实现逐行同源（位掩码表 + 经典万年历
// 推算），已与 lunar-javascript / solarlunar 两个公开实现逐日对照验证
// （2020–2035 共 5844 天零差异）。前端日历页保留自己的一份内联实现（切页
// 必重跑的历史原因），改动本文件后请同步核对那一份。

export interface LunarDate {
	year: number;
	month: number;
	day: number;
	leap: boolean;
}

function lLeapMonth(y: number): number {
	return LUNAR_INFO[y - 1900] & 0xf;
}

function lLeapDays(y: number): number {
	return lLeapMonth(y) ? (LUNAR_INFO[y - 1900] & 0x10000 ? 30 : 29) : 0;
}

function lMonthDays(y: number, m: number): number {
	return LUNAR_INFO[y - 1900] & (0x10000 >> m) ? 30 : 29;
}

function lYearDays(y: number): number {
	let s = 348;
	const info = LUNAR_INFO[y - 1900];
	for (let i = 0x8000; i > 0x8; i >>= 1) s += info & i ? 1 : 0;
	return s + lLeapDays(y);
}

export function solarToLunar(y: number, m: number, d: number): LunarDate {
	let offset = Math.round(
		(Date.UTC(y, m - 1, d) - Date.UTC(1900, 0, 31)) / 86400000,
	);
	let i = 1900;
	let temp = 0;
	for (i = 1900; i < 2101 && offset > 0; i++) {
		temp = lYearDays(i);
		offset -= temp;
	}
	if (offset < 0) {
		offset += temp;
		i--;
	}
	const year = i;
	const leapM = lLeapMonth(year);
	let isLeap = false;
	for (i = 1; i < 13 && offset > 0; i++) {
		if (leapM > 0 && i === leapM + 1 && !isLeap) {
			--i;
			isLeap = true;
			temp = lLeapDays(year);
		} else {
			temp = lMonthDays(year, i);
		}
		if (isLeap && i === leapM + 1) isLeap = false;
		offset -= temp;
	}
	if (offset === 0 && leapM > 0 && i === leapM + 1) {
		if (isLeap) isLeap = false;
		else {
			isLeap = true;
			--i;
		}
	}
	if (offset < 0) {
		offset += temp;
		--i;
	}
	return { year, month: i, day: offset + 1, leap: isLeap };
}

const LUNAR_FESTIVALS: Record<string, string> = {
	"1-1": "春节",
	"1-15": "元宵节",
	"2-2": "龙抬头",
	"3-3": "上巳节",
	"5-5": "端午节",
	"7-7": "七夕节",
	"7-15": "中元节",
	"8-15": "中秋节",
	"9-9": "重阳节",
	"10-1": "寒衣节",
	"10-15": "下元节",
	"12-8": "腊八节",
	"12-23": "小年",
};

// 农历节日名（非节日返回空串）；除夕 = 腊月最后一天
export function lunarFestival(l: LunarDate): string {
	if (l.leap) return "";
	if (l.month === 12 && l.day === lMonthDays(l.year, 12)) return "除夕";
	return LUNAR_FESTIVALS[`${l.month}-${l.day}`] || "";
}
