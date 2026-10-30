// 每日选刊拼装（第二批）：构建时静态拼一期——
// 置顶（配置 pin）→ 本站新文（5 天内，最多 2 篇）→ 友链新文（7 天内，
// 最多 3 篇，数据来自构建前拉取的 src/data/friend-posts.json）；
// 总数不足 3 条时用最新文章回填（先本站、后友链），保证选刊不空。
import { getCollection } from "astro:content";
import { dailyBriefingConfig } from "@/config/dailyBriefingConfig";
import friendPostsData from "@/data/friend-posts.json";
import { getPostUrlBySlug } from "@/utils/url-utils";

export interface BriefingItem {
	title: string;
	url: string;
	source: string;
	date: Date;
	external: boolean;
	pinned?: boolean;
}

const DAY = 86400_000;

export async function getBriefingItems(
	now: Date = new Date(),
): Promise<BriefingItem[]> {
	if (!dailyBriefingConfig.enabled) return [];
	const items: BriefingItem[] = [];

	if (dailyBriefingConfig.pin) {
		items.push({
			title: dailyBriefingConfig.pin.title,
			url: dailyBriefingConfig.pin.url,
			source: dailyBriefingConfig.pin.source,
			date: now,
			external: /^https?:\/\//.test(dailyBriefingConfig.pin.url),
			pinned: true,
		});
	}

	const posts = (await getCollection("posts", ({ data }) => !data.draft))
		.map((p) => ({
			title: p.data.title,
			url: getPostUrlBySlug(p.id),
			source: "本站",
			date: new Date(p.data.published),
			external: false,
		}))
		.sort((a, b) => b.date.getTime() - a.date.getTime());

	const friends = ((friendPostsData as { posts?: unknown[] }).posts || [])
		.map((raw) => {
			const f = raw as {
				title: string;
				link: string;
				source: string;
				date: string;
			};
			return {
				title: f.title,
				url: f.link,
				source: f.source,
				date: new Date(f.date),
				external: true,
			};
		})
		.sort((a, b) => b.date.getTime() - a.date.getTime());

	const freshOwn = posts
		.filter((p) => now.getTime() - p.date.getTime() <= 5 * DAY)
		.slice(0, 2);
	const freshFriends = friends
		.filter((f) => now.getTime() - f.date.getTime() <= 7 * DAY)
		.slice(0, 3);
	items.push(...freshOwn, ...freshFriends);

	if (items.length < 3) {
		const seen = new Set(items.map((i) => i.url));
		for (const p of [...posts, ...friends]) {
			if (items.length >= 4) break;
			if (!seen.has(p.url)) {
				items.push(p);
				seen.add(p.url);
			}
		}
	}
	return items.slice(0, 5);
}
