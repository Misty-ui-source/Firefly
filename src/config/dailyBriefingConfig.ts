import type { DailyBriefingConfig } from "../types/dailyBriefingConfig";

// 每日选刊配置（第二批）：自动拼规则见 utils/daily-briefing.ts——
// 本站新文（5 天内，最多 2 篇）+ 友链新文（7 天内，最多 3 篇），
// 不够数时用最新文章回填。站长要顶一条时把 pin 填上即可，
// 例：pin: { title: "…", url: "/posts/…/", source: "站长置顶" }
export const dailyBriefingConfig: DailyBriefingConfig = {
	enabled: true,
	pin: null,
};
