// 澜澜的知识文件（构建期生成）：文章标题/摘要/链接、友链与站点公开信息。
// 对话框后端 functions/api/fish/chat.js 运行时抓取本文件拼上下文；
// 不做向量库，内容只含公开信息（草稿与加密文章不收录）。
import { friendsConfig } from "@/config/friendsConfig";
import { siteConfig } from "@/config/siteConfig";
import { getSortedPosts } from "@utils/content-utils";
import { getPostUrlBySlug } from "@utils/url-utils";
import type { APIContext } from "astro";

export const prerender = true;

const clip = (s: unknown, n: number) =>
	String(s ?? "")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, n);

export async function GET(_context: APIContext): Promise<Response> {
	const posts = (await getSortedPosts())
		.filter((p) => !p.data.draft && !p.data.password)
		.map((p) => ({
			title: clip(p.data.title, 80),
			desc: clip(p.data.description, 90),
			date: p.data.published
				? new Date(p.data.published).toISOString().slice(0, 10)
				: "",
			url: getPostUrlBySlug(p.id),
			tags: Array.isArray(p.data.tags) ? p.data.tags.slice(0, 5) : [],
		}));

	const friends = (friendsConfig || [])
		.filter((f) => f.enabled !== false)
		.map((f) => ({
			name: clip(f.title, 40),
			url: String(f.siteurl || ""),
			desc: clip(f.desc, 60),
		}))
		.filter((f) => f.name && f.url);

	const data = {
		generatedAt: new Date().toISOString(),
		site: {
			title: siteConfig.title,
			subtitle: siteConfig.subtitle || "",
		},
		posts,
		friends,
	};

	return new Response(JSON.stringify(data), {
		headers: { "Content-Type": "application/json; charset=utf-8" },
	});
}
