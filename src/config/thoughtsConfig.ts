import type { ThoughtsConfig } from "../types/thoughtsConfig";

// ============================================================================
// 碎碎念配置 - 参考 doulor 的 thoughts 页面
// Thoughts Configuration
// ============================================================================

export const thoughtsConfig: ThoughtsConfig = {
	enabled: true,
	title: "碎碎念",
	items: [
		{
			title: '不想去开组会，不想考试',
			content: '但是也就想想',
			createdAt: '2026-10-25T15:58:54.139Z'
		},
		{
			title: '突然觉得用好ai好难',
			content: '今晚用codex帮助我安装了一下AMD ROSS，有感而发',
			createdAt: '2026-10-25T15:58:26.930Z'
		},
		{
			title: 'vibe coding好容易上瘾',
			content: '本来说一小时前休息会呢，结果又拖延了一小时',
			createdAt: '2026-10-25T07:34:19.095Z'
		},
		{
			title: '电子系统设计好难啊',
			content: '这个寄存状态能不能放过我 啊',
			createdAt: '2026-10-25T03:05:07.684Z'
		},
		{
			title: '同时拿到国励奖和秋奖了！yes！',
			content: '上一年的努力果然没白费！但是为什么🧐昨晚我没及时发现，还是今天中午发现的',
			createdAt: '2026-10-24T07:56:50.649Z'
		},
		{
			title: '博客迁至 Cloudflare',
			content: '昨晚干了件大事，把博客从 HK 机子的 Docker 迁到了 Cloudflare Pages，评论系统也从 SQLite 迁到了 Vercel + MongoDB。折腾到半夜，但很值得。',
			createdAt: '2026-10-24T01:30:00+08:00'
		},
	],
};
