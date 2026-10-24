import type { TimelineConfig } from "../types/timelineConfig";

// ============================================================================
// 时间线配置 - 首页展示个人历程
// Timeline Configuration - Show personal journey on homepage
// 参考冷汐的时间线设计
// ============================================================================

export const timelineConfig: TimelineConfig = {
	enabled: true,
	title: "时间线",
	items: [
		{
			date: "2026.10",
			type: "里程碑",
			featured: true,
			title: "博客迁至 Cloudflare",
			subtitle: "主站上线",
			description: "博客从 VPS 迁到 Cloudflare Pages，评论系统从 Docker 迁到 Vercel + MongoDB Atlas。",
			details: [
				"主域 lanerc.me 切到 Pages，HTTPS 自动续期",
				"Waline 评论迁 Vercel，22 条评论 + 38 条浏览量数据完整迁移",
				"自研管理台 Alexander Console 支持双域名 OAuth 登录",
			],
			tags: ["Cloudflare", "Vercel", "Waline", "MongoDB"],
		},
		{
			date: "2026.10",
			type: "项目",
			featured: true,
			title: "Alexander Console",
			subtitle: "自研博客管理台",
			description: "对标 blog.doulor.cn/admin 做的原生 JS 单页管理台，保存即 git commit。",
			details: [
				"友链增删改排序 + RSS 全测",
				"文章/动态编辑器支持视频嵌入、代码高亮",
				"R2 图床直传，控制台导航可视化管理",
			],
			tags: ["JavaScript", "GitHub API", "R2"],
			link: "https://lanerc.me/admin/",
		},
	],
};
