// ============================================================================
// 纸舟传送门配置（顶栏九宫格下拉卡，仅纸舟形态显示）
// 本文件为纯数据格式，由 Alexander Console「🌐 站点导航」页的
// 「🚪 纸舟传送门」卡维护（传送门条目 + 博客线路，增删/排序/改名/开关）
// ============================================================================

export interface PortalEntry {
	name: string;
	url: string;
	note?: string;
	enable?: boolean;
}

export interface PortalLine extends PortalEntry {
	current?: boolean;
}

export interface PortalConfig {
	links: PortalEntry[];
	lines: PortalLine[];
}

export const portalConfig: PortalConfig = {
	links: [
		{
			name: "控制台",
			url: "/admin/",
			note: "本站管理台",
		},
		{
			name: "评论管理",
			url: "https://waline.lanerc.me/ui",
			note: "Waline 后台",
		},
		{
			name: "GNSS",
			url: "/gnss/",
			note: "卫星星空",
		},
		{
			name: "简历生成",
			url: "/resume/",
			note: "简历生成器",
		},
	],
	lines: [
		{
			name: "主域名线路",
			url: "https://lanerc.me",
			note: "当前线路",
			current: true,
		},
	],
};
