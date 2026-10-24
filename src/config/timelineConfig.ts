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
			date: '2026.10.24',
			type: '里程碑',
			featured: true,
			title: '博客迁至 Cloudflare',
			subtitle: '主站上线',
			description: '博客从 VPS 迁到 Cloudflare Pages，评论系统从 Docker 迁到 Vercel + MongoDB Atlas。',
			details: ['主域 lanerc.me 切到 Pages，HTTPS 自动续期', 'Waline 评论迁 Vercel，22 条评论 + 38 条浏览量数据完整迁移', '自研管理台 Alexander Console 支持双域名 OAuth 登录'],
			tags: ['Cloudflare', 'Vercel', 'Waline', 'MongoDB']
		},
		{
			date: '2026.10.24',
			type: '项目',
			featured: true,
			title: 'Alexander Console',
			subtitle: '自研博客管理台',
			description: '对标 blog.doulor.cn/admin 做的原生 JS 单页管理台，保存即 git commit。',
			details: ['友链增删改排序 + RSS 全测', '文章/动态编辑器支持视频嵌入、代码高亮、支持常用markdown格式', '内部集合18个常用和不常用功能，满足日常不动代码即可完成之前做不到的全部操作，懒人专属', '内置日志记录，支持生成月报季报年报，让自己的创作经历可视化', 'R2 图床直传，控制台导航可视化管理', '支持网页版app和手机浏览器版app（不支持IOS），让自己不用打开浏览器即可一键进入创作管理后台', '新增碎碎念和时间线功能，记录自己的成长与生活某个瞬间的思考'],
			tags: ['JavaScript', 'GitHub API', 'R2'],
			link: 'https://lanerc.me/admin/'
		},
	],
};
