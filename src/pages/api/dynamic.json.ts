import { getCollection } from "astro:content";
import { createMarkdownProcessor } from "@astrojs/markdown-remark";
import { remarkMark } from "@/plugins/remark-mark.js";
import { remarkWikiLink } from "@/plugins/remark-wiki-link.js";
import {
	dynamicSearchText,
	dynamicSlug,
	sortDynamics,
} from "@/utils/dynamic-utils";

const markdownImagePattern = /!\[([^\]]*)\]\((\S+?)(?:\s+["']([^"']*)["'])?\)/g;

export async function GET(): Promise<Response> {
	// 必须与 astro.config 的正文管线对齐：裸处理器不带 remarkMark，
	// 动态里的 ==高亮== 会原样吐出（2026-10-28 用户报障后补）
	const processor = await createMarkdownProcessor({
		remarkPlugins: [remarkMark, remarkWikiLink],
	});
	const dynamics = sortDynamics(await getCollection("dynamic"));
	const data = await Promise.all(
		dynamics.map(async (entry) => {
			const images: Array<{ alt: string; src: string; title?: string }> = [];
			const markdown = (entry.body || "").replace(
				markdownImagePattern,
				(_match, alt: string, src: string, title?: string) => {
					images.push({ alt, src, ...(title ? { title } : {}) });
					return "";
				},
			);
			const rendered = await processor.render(markdown);

			return {
				id: dynamicSlug(entry.id),
				published: entry.data.published.getTime(),
				html: rendered.code,
				images,
				searchText: dynamicSearchText(entry),
				pinned: entry.data.pinned || false,
				location: entry.data.location.trim(),
			};
		}),
	);

	return new Response(JSON.stringify(data), {
		headers: {
			"Content-Type": "application/json; charset=utf-8",
		},
	});
}
