/**
 * 明信「Hero」内容区（HomeDataLayer 移植）的导览控制器。
 * 原站 home-guide-controller.ts 未随组件源码一并保存，这里按
 * home-data-layer.css 的状态契约重建等价行为：
 * JS 只切换层根的 data-guide-entered / data-guide-expanded / data-guide-detail
 * 三个属性与卡片的 guide-card--active，布局重排全在 CSS；展开/收起带一层
 * 简化 FLIP（记录矩形 → 反演 → 播回），减弱动效时跳过。
 * 另辖：手风琴单开、牌堆自动翻牌/拖拽/抽屉选封面、站点数据轮播与悬停定住、
 * UV/PV 由 Umami 分享接口运行时回填（口径同原站 HomeDataLayer 组件脚本）。
 */

const FLIP_DURATION = 480;
const FLIP_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
const DECK_FLY_MS = 620;
const DECK_INTERVAL_MS = 3000;
const STAT_INTERVAL_MS = 2600;

function formatCompactNumber(value: number): string {
	if (Math.abs(value) < 1000) return String(value);
	const compact = value / 1000;
	return `${Number.isInteger(compact) ? compact.toFixed(0) : compact.toFixed(1)}k`;
}

export function bootMingxinGuide(layer: HTMLElement): () => void {
	const ac = new AbortController();
	const signal = ac.signal;
	const timers = new Set<number>();
	const later = (fn: () => void, ms: number): number => {
		const id = window.setTimeout(() => {
			timers.delete(id);
			fn();
		}, ms);
		timers.add(id);
		return id;
	};
	const every = (fn: () => void, ms: number): number => {
		const id = window.setInterval(fn, ms);
		timers.add(id);
		return id;
	};
	const clearTimer = (id: number) => {
		window.clearTimeout(id);
		window.clearInterval(id);
		timers.delete(id);
	};

	const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
	const desktop = () => window.matchMedia("(min-width: 769px)").matches;
	const cards = [...layer.querySelectorAll<HTMLElement>(".guide-card")];

	/* ---------- 入场闸门：滚进视口才描线（与原站 data-guide-entered 同义） ---------- */
	const enterObserver = new IntersectionObserver(
		(entries) => {
			if (entries.some((entry) => entry.isIntersecting)) {
				layer.setAttribute("data-guide-entered", "");
				enterObserver.disconnect();
			}
		},
		{ rootMargin: "0px 0px -8% 0px" },
	);
	enterObserver.observe(layer);

	/* ---------- 展开 / 收起（FLIP 重排） ---------- */
	let activeCard: HTMLElement | null = null;
	let detailTimer: number | null = null;

	const flip = (mutate: () => void) => {
		if (reduced || !desktop()) {
			mutate();
			return;
		}
		const before = new Map(cards.map((c) => [c, c.getBoundingClientRect()]));
		mutate();
		for (const card of cards) {
			const prev = before.get(card);
			if (!prev) continue;
			const next = card.getBoundingClientRect();
			if (!next.width || !prev.width) continue;
			const dx = prev.left - next.left;
			const dy = prev.top - next.top;
			const sx = prev.width / next.width;
			const sy = prev.height / next.height;
			if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sx - 1) < 0.01) continue;
			card.animate(
				[
					{ transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
					{ transform: "none" },
				],
				{ duration: FLIP_DURATION, easing: FLIP_EASE },
			);
		}
	};

	const expand = (card: HTMLElement) => {
		if (activeCard === card) return;
		flip(() => {
			layer.setAttribute("data-guide-expanded", "");
			cards.forEach((c) => {
				c.classList.toggle("guide-card--active", c === card);
				c.setAttribute("aria-expanded", c === card ? "true" : "false");
			});
			layer.removeAttribute("data-guide-detail");
		});
		activeCard = card;
		if (detailTimer) clearTimer(detailTimer);
		detailTimer = later(() => {
			if (activeCard === card) layer.setAttribute("data-guide-detail", "");
		}, FLIP_DURATION - 120);
	};

	const collapse = () => {
		if (!activeCard) return;
		if (detailTimer) clearTimer(detailTimer);
		layer.removeAttribute("data-guide-detail");
		const card = activeCard;
		activeCard = null;
		later(() => {
			if (activeCard) return;
			flip(() => {
				layer.removeAttribute("data-guide-expanded");
				card.classList.remove("guide-card--active");
				card.setAttribute("aria-expanded", "false");
			});
		}, 140);
	};

	/* ---------- 默认态接管：构建期已直出展开态（牌堆通栏在上、余三卡在下），
	   boot 时认领既成的 active 卡，并按展开同样的节拍补上详细态 ---------- */
	const preActive = cards.find((c) => c.classList.contains("guide-card--active"));
	if (preActive && layer.hasAttribute("data-guide-expanded")) {
		activeCard = preActive;
		detailTimer = later(() => {
			if (activeCard === preActive) layer.setAttribute("data-guide-detail", "");
		}, FLIP_DURATION - 120);
	}

	for (const card of cards) {
		card.addEventListener(
			"click",
			(event) => {
				if (!desktop()) return;
				if ((event.target as HTMLElement).closest("a, button")) return;
				if (activeCard === card) collapse();
				else expand(card);
			},
			{ signal },
		);
		card.addEventListener(
			"keydown",
			(event) => {
				if (event.target !== card) return;
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					if (activeCard === card) collapse();
					else expand(card);
				}
				if (event.key === "Escape") collapse();
			},
			{ signal },
		);
	}

	/* ---------- 手风琴：同组单开 ---------- */
	for (const acc of layer.querySelectorAll<HTMLElement>("[data-acc]")) {
		for (const head of acc.querySelectorAll<HTMLElement>("[data-acc-head]")) {
			head.addEventListener(
				"click",
				() => {
					const item = head.closest<HTMLElement>(".acc__item");
					if (!item) return;
					const willOpen = !item.hasAttribute("data-open");
					acc.querySelectorAll<HTMLElement>(".acc__item").forEach((it) => {
						it.removeAttribute("data-open");
						it.querySelector("[data-acc-head]")?.setAttribute("aria-expanded", "false");
					});
					if (willOpen) {
						item.setAttribute("data-open", "");
						head.setAttribute("aria-expanded", "true");
					}
				},
				{ signal },
			);
		}
	}

	/* ---------- 牌堆：自动翻牌 / 拖拽 / 抽屉选封面 ---------- */
	const deck = layer.querySelector<HTMLElement>("[data-post-deck]");
	const deckCards = deck
		? [...deck.querySelectorAll<HTMLElement>("[data-post-card]")]
		: [];
	let deckOrder = [...deckCards];
	let deckTimer: number | null = null;
	let flyTimer: number | null = null;
	let deckHovered = false;

	const applyDepths = () => {
		deckOrder.forEach((el, pos) => {
			el.style.setProperty("--depth", String(pos));
			el.toggleAttribute("data-on", pos === 0);
			el.tabIndex = pos === 0 ? 0 : -1;
			el.toggleAttribute("inert", pos !== 0);
		});
	};

	const flyTop = (direction: 1 | -1) => {
		const top = deckOrder[0];
		if (!top || deckOrder.length < 2) return;
		top.setAttribute("data-flying", "");
		top.style.setProperty("--deck-fly-direction", String(direction));
		if (flyTimer) clearTimer(flyTimer);
		flyTimer = later(() => {
			deckOrder = [...deckOrder.slice(1), deckOrder[0]];
			top.removeAttribute("data-flying");
			applyDepths();
		}, reduced ? 0 : DECK_FLY_MS);
	};

	/* 自动翻牌只在牌堆卡处于缩略态时跑：它被展开成通栏主卡时停，
	   靠右侧抽屉选封面；收回 2×2 或别卡展开、它缩回底部一行时继续翻 */
	const postsCard = cards.find((c) => c.dataset.guideCard === "posts") ?? null;
	const deckShouldRun = () =>
		!document.hidden &&
		!deckHovered &&
		activeCard !== postsCard &&
		deckOrder.length > 1;

	if (deck && deckCards.length > 1) {
		deckTimer = every(() => {
			if (deckShouldRun()) flyTop(1);
		}, DECK_INTERVAL_MS);
		deck.addEventListener("pointerenter", () => (deckHovered = true), { signal });
		deck.addEventListener("pointerleave", () => (deckHovered = false), { signal });

		/* 拖拽翻牌：按下顶牌横拖，越过阈值按方向抛出，否则弹回 */
		let dragX: number | null = null;
		deck.addEventListener(
			"pointerdown",
			(event) => {
				if (layer.hasAttribute("data-guide-expanded")) return;
				const top = deckOrder[0];
				if (!top || !(event.target as HTMLElement).closest("[data-post-card]")) return;
				dragX = event.clientX;
				deck.setAttribute("data-dragging", "");
				deck.setPointerCapture(event.pointerId);
			},
			{ signal },
		);
		deck.addEventListener(
			"pointermove",
			(event) => {
				if (dragX === null) return;
				const dx = event.clientX - dragX;
				const top = deckOrder[0];
				if (top) top.style.transform = `translateX(${dx}px) rotate(${dx * 0.02}deg)`;
			},
			{ signal },
		);
		const endDrag = (event: PointerEvent) => {
			if (dragX === null) return;
			const dx = event.clientX - dragX;
			dragX = null;
			deck.removeAttribute("data-dragging");
			const top = deckOrder[0];
			if (top) top.style.transform = "";
			if (Math.abs(dx) > 56) flyTop(dx > 0 ? -1 : 1);
		};
		deck.addEventListener("pointerup", endDrag, { signal });
		deck.addEventListener("pointercancel", endDrag, { signal });
	}

	/* 抽屉行悬停/聚焦 → 把那张封面带到牌顶（展开态选封面） */
	for (const pick of layer.querySelectorAll<HTMLElement>("[data-post-pick]")) {
		const bring = () => {
			const index = Number(pick.dataset.postPick);
			const target = deckCards.find(
				(el) => Number(el.dataset.postCard) === index,
			);
			if (!target || deckOrder[0] === target) return;
			deckOrder = [target, ...deckOrder.filter((el) => el !== target)];
			applyDepths();
		};
		pick.addEventListener("pointerenter", bring, { signal });
		pick.addEventListener("focus", bring, { signal });
	}

	/* ---------- 站点数据：轮播定住一层，悬停改定 ---------- */
	const statsCard = layer.querySelector<HTMLElement>('[data-guide-card="stats"]');
	const statCards = [...layer.querySelectorAll<HTMLElement>("[data-stat-card]")];
	const statLayers = [...layer.querySelectorAll<HTMLElement>("[data-stat-layer]")];
	let statActive = 0;
	let statHovered = false;
	const setStat = (i: number) => {
		statActive = i;
		statsCard?.style.setProperty("--stat-active", String(i));
		statCards.forEach((el, j) => el.toggleAttribute("data-on", j === i));
		statLayers.forEach((el) =>
			el.toggleAttribute("data-on", Number(el.dataset.statLayer) === i),
		);
	};
	if (statsCard && statCards.length > 1) {
		every(() => {
			if (!document.hidden && !statHovered && layer.hasAttribute("data-guide-entered")) {
				setStat((statActive + 1) % statCards.length);
			}
		}, STAT_INTERVAL_MS);
		const hoverTargets = [...statCards, ...statLayers];
		hoverTargets.forEach((el, idx) => {
			const index = el.hasAttribute("data-stat-card")
				? idx
				: Number((el as HTMLElement).dataset.statLayer);
			el.addEventListener(
				"pointerenter",
				() => {
					statHovered = true;
					setStat(index);
				},
				{ signal },
			);
			el.addEventListener("pointerleave", () => (statHovered = false), { signal });
		});
	}

	/* ---------- UV/PV：Umami 分享接口运行时回填（口径同原站） ---------- */
	const writeStat = (kind: "UV" | "PV", raw: number | null) => {
		const compactNode = layer.querySelector<HTMLElement>(`[data-stat-compact="${kind}"]`);
		const fullNode = layer.querySelector<HTMLElement>(`[data-stat-full="${kind}"]`);
		if (compactNode) compactNode.textContent = raw === null ? "--" : formatCompactNumber(raw);
		if (fullNode) fullNode.textContent = raw === null ? "--" : raw.toLocaleString();
	};
	const statsBaseUrl = layer.dataset.statsBaseUrl;
	const statsShareId = layer.dataset.statsShareId;
	let pushCleanup = () => {};
	if (statsBaseUrl && statsShareId) {
		const fetchController = new AbortController();
		pushCleanup = () => fetchController.abort();
		const fs = fetchController.signal;
		fetch(`${statsBaseUrl}/api/share/${statsShareId}`, { signal: fs })
			.then((res) => {
				if (!res.ok) throw new Error("share");
				return res.json();
			})
			.then((share: { websiteId?: string; entityId?: string; token?: string }) => {
				const websiteId = share.websiteId || share.entityId;
				if (!websiteId) throw new Error("websiteId");
				return fetch(
					`${statsBaseUrl}/api/websites/${websiteId}/stats?startAt=0&endAt=${Date.now()}`,
					{
						signal: fs,
						headers: {
							"x-umami-share-token": share.token || statsShareId,
							"x-umami-share-context": "1",
							"Content-Type": "application/json",
						},
					},
				);
			})
			.then((res) => {
				if (!res.ok) throw new Error("stats");
				return res.json();
			})
			.then((data: { uv?: number; visitors?: number; pv?: number; pageviews?: number }) => {
				if (fs.aborted || !layer.isConnected) return;
				writeStat("UV", data.uv ?? data.visitors ?? 0);
				writeStat("PV", data.pv ?? data.pageviews ?? 0);
			})
			.catch(() => {
				if (fs.aborted || !layer.isConnected) return;
				writeStat("UV", null);
				writeStat("PV", null);
			});
	}

	return () => {
		pushCleanup();
		ac.abort();
		enterObserver.disconnect();
		timers.forEach((id) => {
			window.clearTimeout(id);
			window.clearInterval(id);
		});
		timers.clear();
	};
}
