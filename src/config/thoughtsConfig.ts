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
			title: "博客迁至 Cloudflare",
			content: "昨晚干了件大事，把博客从 HK 机子的 Docker 迁到了 Cloudflare Pages，评论系统也从 SQLite 迁到了 Vercel + MongoDB。折腾到半夜，但很值得。",
			createdAt: "2026-10-24T01:30:00+08:00",
		},
	],
};
