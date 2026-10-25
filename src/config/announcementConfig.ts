import type { AnnouncementConfig } from "../types/announcementConfig";

export const announcementConfig: AnnouncementConfig = {
	// 公告标题，留空则走i18n默认标题
	title: "",

	// 公告内容（静态模式用）
	content: "欢迎来到Alexander，国内访问可能较慢，正在寻找优化方案。评论后台被主包小猪手搞崩了，但评论功能正常。",

	// 显示模式：static=静态公告 / geo=访客检测公告（控制台公告页可切换）
	mode: "static",

	// 检测版文案模板，占位符：{country} {region} {city} {distance} {greeting}
	geoTemplate: "欢迎来自 {country} 的小伙伴，{greeting}。你距离 Alexander 约有 {distance} 公里，欢迎来串门。",

	// 博主位置（检测版算距离用）
	ownerCity: "南京",
	ownerLat: 32.0603,
	ownerLon: 118.7969,

	// 是否允许用户关闭公告
	closable: true,

	link: {
		// 启用链接
		enable: true,
		// 链接文本
		text: "了解更多",
		// 链接 URL
		url: "/about/",
		// 内部链接
		external: false,
	},

	// 检测版公告的「了解更多」链接
	geoLink: {
		enable: true,
		text: "了解更多",
		url: "/about/",
		external: false,
	},

	// 历史公告存档（控制台自动维护，手改无效）
	history: [],
};
