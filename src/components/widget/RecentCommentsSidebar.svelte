<script lang="ts">
/**
 * 侧边栏最新评论组件 - 从 Waline API 获取最近评论
 * API: GET {server}/api/comment?type=recent&count={limit}
 */
import I18nKey from "@i18n/i18nKey";
import { i18n } from "@i18n/translation";
import { onMount } from "svelte";
import { fetchWithDedup } from "@/utils/fetch-dedup";
import { url } from "@/utils/url-utils";

interface WalineComment {
	objectId: string;
	nick: string;
	comment: string;
	url?: string;
	avatar?: string;
	createdAt?: string;
}

interface Props {
	server: string;
	limit: number;
}

let { server, limit }: Props = $props();

let comments: WalineComment[] = $state([]);
let loading = $state(true);
let error = $state(false);

// 本地缓存 2 分钟，避免频繁请求
const CACHE_KEY = "lanerc-recent-comments-waline";
const CACHE_TTL = 2 * 60 * 1000;

function getCache(): WalineComment[] | null {
	try {
		const raw = localStorage.getItem(CACHE_KEY);
		if (!raw) return null;
		const { data, ts } = JSON.parse(raw);
		if (Date.now() - ts > CACHE_TTL) return null;
		return data;
	} catch {
		return null;
	}
}

function setCache(data: WalineComment[]) {
	try {
		localStorage.setItem(CACHE_KEY, JSON.stringify({ data, ts: Date.now() }));
	} catch {
		// ignore
	}
}

// HTML 转纯文本，防止 XSS
function stripHtml(html: string): string {
	const div = document.createElement("div");
	div.innerHTML = html;
	return div.textContent || div.innerText || "";
}

async function load() {
	loading = true;
	error = false;

	const cached = getCache();
	if (cached) {
		comments = cached;
		loading = false;
		return;
	}

	try {
		const apiUrl = `${server.replace(/\/$/, "")}/api/comment?type=recent&count=${limit}`;
		const json = await fetchWithDedup<{ errno: number; data?: WalineComment[] }>(apiUrl);
		const list: WalineComment[] = Array.isArray(json?.data) ? json.data : [];
		comments = list.slice(0, limit);
		setCache(comments);
	} catch {
		error = true;
	} finally {
		loading = false;
	}
}

onMount(() => {
	load();
});
</script>

<div class="rc-wrap">
	{#if loading}
		<div class="rc-loading">{i18n(I18nKey.loading)}</div>
	{:else if error}
		<div class="rc-error">
			{i18n(I18nKey.loadFailed)}
			<button class="rc-retry" onclick={load}>{i18n(I18nKey.retry)}</button>
		</div>
	{:else if comments.length === 0}
		<div class="rc-empty">{i18n(I18nKey.noComments)}</div>
	{:else}
		<ul class="rc-list">
			{#each comments as c (c.objectId)}
				<li class="rc-item">
					<a class="rc-link" href={url(c.url) + '#' + c.objectId} title="跳转到评论">
						{#if c.avatar}
							<img class="rc-avatar" src={c.avatar} alt={c.nick} loading="lazy" />
						{/if}
						<div class="rc-body">
							<div class="rc-nick">{c.nick}</div>
							<div class="rc-text">{stripHtml(c.comment).slice(0, 80)}</div>
						</div>
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.rc-wrap {
		min-width: 0;
	}
	.rc-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.rc-item {
		min-width: 0;
	}
	.rc-link {
		display: flex;
		gap: 0.5rem;
		min-width: 0;
		color: inherit;
		text-decoration: none;
		border-radius: 0.5rem;
		padding: 0.25rem;
		margin: -0.25rem;
		transition: background-color 0.15s;
	}
	.rc-link:hover {
		background-color: rgba(0, 0, 0, 0.04);
	}
	:global(html.dark) .rc-link:hover {
		background-color: rgba(255, 255, 255, 0.06);
	}
	.rc-avatar {
		width: 2rem;
		height: 2rem;
		border-radius: 50%;
		flex-shrink: 0;
	}
	.rc-body {
		min-width: 0;
		flex: 1;
	}
	.rc-nick {
		font-weight: 600;
		font-size: 0.875rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.rc-text {
		font-size: 0.8125rem;
		opacity: 0.75;
		overflow-wrap: anywhere;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.rc-loading,
	.rc-error,
	.rc-empty {
		font-size: 0.875rem;
		opacity: 0.6;
		text-align: center;
		padding: 1rem 0;
	}
	.rc-retry {
		margin-left: 0.5rem;
		text-decoration: underline;
		cursor: pointer;
		background: none;
		border: none;
		color: inherit;
		font-size: inherit;
	}
</style>
