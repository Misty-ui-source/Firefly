export type AnnouncementConfig = {
	// enable属性已移除，现在通过sidebarLayoutConfig统一控制
	title?: string; // 公告栏标题
	content: string; // 公告栏内容
	icon?: string; // 公告栏图标
	type?: "info" | "warning" | "success" | "error"; // 公告类型
	closable?: boolean; // 是否可关闭
	// 显示模式：static=静态公告（用 content）；geo=访客检测公告（用 geoTemplate 按访客位置/时间生成）
	mode?: "static" | "geo";
	// 检测版文案模板，占位符：{country} 国家 {region} 地区 {city} 城市 {distance} 距博主公里数 {greeting} 时段问候
	geoTemplate?: string;
	ownerCity?: string; // 博主所在城市（展示用）
	ownerLat?: number; // 博主纬度（算距离用）
	ownerLon?: number; // 博主经度（算距离用）
	link?: {
		enable: boolean; // 是否启用链接
		text: string; // 链接文字
		url: string; // 链接地址
		external?: boolean; // 是否外部链接
	};
	geoLink?: {
		// 检测版公告自己的「了解更多」链接，结构同 link
		enable: boolean;
		text: string;
		url: string;
		external?: boolean;
	};
	// 历史公告存档（控制台保存静态公告时自动归档上一条，最多 20 条，新的在前）
	history?: { date: string; content: string }[];
};
