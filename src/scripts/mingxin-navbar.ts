/**
 * 明信顶栏控制器（原站 Navbar.astro 内嵌脚本 + navbar-profile-controller.ts 的
 * 移植合并，选择器/类名换成本站 mxnav- 约定，逻辑与数值照原作）。
 * 只在 html[data-site-mode="mingxin"] 时激活，其余形态零负担：
 * 1. 中段悬停滑块高亮 + 当前栏目图标独立移动层（原作 initHoverSlider 一套）；
 * 2. 滚动收放：滞回 80/40，左/右段收成球并吸附到中段两侧（紧凑锚点实测写入
 *    --mxnav-compact-left/right），中段不变（原作 initNavbarScrollLayout）；
 * 3. 工具面板：悬停/聚焦展开（搜索/公告/主题三段滑块），定位实测钳制视口，
 *    箱内单药丸滑动高亮（原作工具面板一套）；外观段（七形态 + 调色板入口）
 *    是主题行下方同箱体的一节，展开走 CSS 悬停/聚焦，指针路径不出箱子；
 * 4. 资料卡：原作 body 级 fixed 面板——挂载时把节点挪到 body 末尾（避开顶栏
 *    壳层的滤镜包含块），打开时实测左段位置锚定，滚动即收（原作 profile 一套）；
 * 5. 搜索面板 #search-panel 本在标准顶栏内（明信下整条标准顶栏隐藏），挂载时
 *    挪到 #top-row 直下保证明信下可达，离场时原位放回。
 * 形态/明暗切换走本站 setting-utils（setSiteMode / setTheme），逃生口在外观段。
 */
import {
	getStoredSiteMode,
	getStoredTheme,
	setSiteMode,
	setTheme,
} from "@/utils/setting-utils";
import {
	closeMxnavDropdownPanel,
	initMxnavDropdownDelegation,
	repositionMxnavDropdown,
	syncMxnavDropdownOnHover,
} from "./mingxin-dropdown";

type ThemeChoice = "light" | "dark" | "system";
type ModeValue =
	| "full"
	| "pure"
	| "harmony"
	| "brick"
	| "astral"
	| "paper"
	| "mingxin";

const MODE_LABELS: Record<ModeValue, string> = {
	full: "华彩",
	pure: "素简",
	harmony: "谐彩",
	brick: "顽彩",
	astral: "璨夜",
	paper: "纸舟",
	mingxin: "明信",
};

function isMingxin(): boolean {
	return document.documentElement.dataset.siteMode === "mingxin";
}

interface ActiveNav {
	destroy: () => void;
	sync: () => void;
}

let active: ActiveNav | null = null;
/** 首次挂载不做激活项位移动画（原作 generation===0 口径），导航后重挂才动画 */
let hasMountedOnce = false;

/* ================= 悬停滑块 + 图标移动层（原作 initHoverSlider） ================= */

const NAVBAR_ICON_DURATION = 260;
const NAVBAR_ICON_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

function normalizePath(p: string): string {
	return p.replace(/\/$/, "") || "/";
}

function pathMatches(currentPath: string, href: string): boolean {
	const cp = normalizePath(currentPath);
	const hp = normalizePath(href);
	if (hp === "/") return cp === "/";
	return cp === hp || cp.startsWith(`${hp}/`);
}

function initHoverSlider(
	signal: AbortSignal,
	animateActiveChange: boolean,
): { syncActive: () => void } {
	const navContainer = document.querySelector<HTMLElement>("[data-mxnav-nav]");
	const hoverBorder = document.querySelector<HTMLElement>(
		"[data-mxnav-hover-border]",
	);
	if (!navContainer || !hoverBorder) return { syncActive: () => {} };

	const nav = navContainer;
	const border = hoverBorder;
	const navItems = Array.from(
		nav.querySelectorAll<HTMLElement>(":scope > .mxnav-item"),
	);

	let iconAnimations: Animation[] = [];
	let iconAnimationRevision = 0;
	let activeItem: HTMLElement | null = null;
	let resizeFrame: number | null = null;

	interface IconParts {
		layer: HTMLElement;
		current: HTMLElement;
		next: HTMLElement;
	}
	interface IconSnapshot {
		rect: DOMRect | null;
		markup: string;
	}

	function getIconParts(): IconParts | null {
		const layer = nav.querySelector<HTMLElement>("[data-mxnav-moving-icon]");
		const current = layer?.querySelector<HTMLElement>("[data-mxnav-icon-current]");
		const next = layer?.querySelector<HTMLElement>("[data-mxnav-icon-next]");
		return layer && current && next ? { layer, current, next } : null;
	}

	function getIconTemplate(item: HTMLElement | null): HTMLElement | null {
		return item?.querySelector<HTMLElement>(".mxnav-trigger-icon") ?? null;
	}

	function getIconMarkup(item: HTMLElement | null): string {
		return getIconTemplate(item)?.innerHTML.trim() || "";
	}

	function hasRunningIconAnimation(): boolean {
		return iconAnimations.some((a) => a.playState === "running");
	}

	function cancelIconAnimations(): number {
		const revision = ++iconAnimationRevision;
		iconAnimations.forEach((a) => a.cancel());
		iconAnimations = [];
		return revision;
	}

	function captureIconSnapshot(parts: IconParts): IconSnapshot {
		const currentOpacity =
			Number.parseFloat(getComputedStyle(parts.current).opacity) || 0;
		const nextOpacity =
			Number.parseFloat(getComputedStyle(parts.next).opacity) || 0;
		const markup =
			parts.next.innerHTML && nextOpacity > currentOpacity
				? parts.next.innerHTML
				: parts.current.innerHTML;
		const layerOpacity =
			Number.parseFloat(getComputedStyle(parts.layer).opacity) || 0;
		return {
			rect:
				markup && layerOpacity > 0.01 ? parts.layer.getBoundingClientRect() : null,
			markup,
		};
	}

	function setIconBox(layer: HTMLElement, template: HTMLElement): DOMRect | null {
		const navRect = nav.getBoundingClientRect();
		const templateRect = template.getBoundingClientRect();
		if (templateRect.width === 0 || templateRect.height === 0) return null;
		layer.style.left = `${templateRect.left - navRect.left}px`;
		layer.style.top = `${templateRect.top - navRect.top}px`;
		layer.style.width = `${templateRect.width}px`;
		layer.style.height = `${templateRect.height}px`;
		return templateRect;
	}

	function hideIcon(parts: IconParts): void {
		cancelIconAnimations();
		parts.layer.style.opacity = "0";
		parts.layer.style.transform = "none";
		parts.current.style.opacity = "1";
		parts.next.style.opacity = "0";
		parts.current.innerHTML = "";
		parts.next.innerHTML = "";
	}

	function showIconImmediately(
		parts: IconParts,
		template: HTMLElement,
		markup: string,
	): void {
		cancelIconAnimations();
		if (!setIconBox(parts.layer, template)) {
			hideIcon(parts);
			return;
		}
		parts.layer.style.opacity = "1";
		parts.layer.style.transform = "none";
		parts.current.innerHTML = markup;
		parts.current.style.opacity = "1";
		parts.next.innerHTML = "";
		parts.next.style.opacity = "0";
	}

	function finishIconAnimations(
		revision: number,
		animations: Animation[],
		onFinish: () => void,
	): void {
		void Promise.all(
			animations.map((a) => a.finished.catch(() => undefined)),
		).then(() => {
			if (revision !== iconAnimationRevision) return;
			onFinish();
			animations.forEach((a) => a.cancel());
			iconAnimations = [];
		});
	}

	function syncIcon(
		previousItem: HTMLElement | null,
		nextItem: HTMLElement | null,
		snapshot: IconSnapshot,
		animate: boolean,
	): void {
		const parts = getIconParts();
		if (!parts) return;
		const template = getIconTemplate(nextItem);
		const targetMarkup = getIconMarkup(nextItem);
		const reduceMotion = window.matchMedia(
			"(prefers-reduced-motion: reduce)",
		).matches;
		const canAnimate =
			animate && !reduceMotion && typeof parts.layer.animate === "function";

		if (previousItem === nextItem && nextItem) {
			if (!hasRunningIconAnimation() && template && targetMarkup) {
				showIconImmediately(parts, template, targetMarkup);
			}
			return;
		}

		if (!template || !targetMarkup) {
			if (!canAnimate || !snapshot.rect || !snapshot.markup) {
				hideIcon(parts);
				return;
			}
			const revision = cancelIconAnimations();
			const navRect = nav.getBoundingClientRect();
			parts.layer.style.left = `${snapshot.rect.left - navRect.left}px`;
			parts.layer.style.top = `${snapshot.rect.top - navRect.top}px`;
			parts.layer.style.width = `${snapshot.rect.width}px`;
			parts.layer.style.height = `${snapshot.rect.height}px`;
			parts.layer.style.opacity = "1";
			parts.layer.style.transform = "none";
			parts.current.innerHTML = snapshot.markup;
			parts.current.style.opacity = "1";
			parts.next.innerHTML = "";
			parts.next.style.opacity = "0";
			const fadeOut = parts.layer.animate(
				[{ opacity: 1 }, { opacity: 0 }],
				{ duration: 180, easing: "ease-out", fill: "both" },
			);
			iconAnimations = [fadeOut];
			finishIconAnimations(revision, [fadeOut], () => {
				parts.layer.style.opacity = "0";
				parts.current.innerHTML = "";
			});
			return;
		}

		if (!canAnimate || !snapshot.rect || !snapshot.markup) {
			showIconImmediately(parts, template, targetMarkup);
			return;
		}

		const revision = cancelIconAnimations();
		const targetRect = setIconBox(parts.layer, template);
		if (!targetRect) {
			hideIcon(parts);
			return;
		}
		parts.layer.style.opacity = "1";
		parts.layer.style.transform = "none";
		parts.current.innerHTML = snapshot.markup;
		parts.current.style.opacity = "1";
		parts.next.innerHTML = targetMarkup;
		parts.next.style.opacity = "0";

		const deltaX = snapshot.rect.left - targetRect.left;
		const deltaY = snapshot.rect.top - targetRect.top;
		const movement = parts.layer.animate(
			[
				{ transform: `translate3d(${deltaX}px, ${deltaY}px, 0)` },
				{ transform: "translate3d(0, 0, 0)" },
			],
			{ duration: NAVBAR_ICON_DURATION, easing: NAVBAR_ICON_EASING, fill: "both" },
		);
		const outgoing = parts.current.animate(
			[{ opacity: 1 }, { opacity: 0 }],
			{ duration: NAVBAR_ICON_DURATION, easing: "ease-in-out", fill: "both" },
		);
		const incoming = parts.next.animate(
			[{ opacity: 0 }, { opacity: 1 }],
			{ duration: NAVBAR_ICON_DURATION, easing: "ease-in-out", fill: "both" },
		);
		const animations = [movement, outgoing, incoming];
		iconAnimations = animations;
		finishIconAnimations(revision, animations, () => {
			parts.layer.style.transform = "none";
			parts.current.innerHTML = targetMarkup;
			parts.current.style.opacity = "1";
			parts.next.innerHTML = "";
			parts.next.style.opacity = "0";
		});
	}

	function getItemPaths(item: HTMLElement): string[] {
		const hrefs: string[] = [];
		const selfLink = item.querySelector<HTMLAnchorElement>(":scope > a");
		const selfHref = selfLink?.getAttribute("href");
		if (selfHref) hrefs.push(selfHref);
		const pageIndex = item.dataset.mxnavDropdownIndex;
		const page =
			pageIndex !== undefined
				? document.querySelector(
						`[data-mxnav-dropdown-panel] [data-mxnav-dropdown-page="${pageIndex}"]`,
					)
				: null;
		page?.querySelectorAll(".mxnav-dropdown-item[href]").forEach((el) => {
			const href = el.getAttribute("href");
			if (href) hrefs.push(href);
		});
		return hrefs;
	}

	function findItemByPath(currentPath: string): HTMLElement | null {
		return (
			navItems.find((item) =>
				getItemPaths(item).some((href) => pathMatches(currentPath, href)),
			) ?? null
		);
	}

	function moveHighlight(item: HTMLElement | null): void {
		navItems.forEach((navItem) => {
			navItem.classList.toggle("is-highlighted", navItem === item);
		});
		if (!item) {
			border.style.opacity = "0";
			return;
		}
		const rect = item.getBoundingClientRect();
		const containerRect = nav.getBoundingClientRect();
		border.style.width = `${rect.width}px`;
		border.style.height = `${rect.height}px`;
		border.style.left = `${rect.left - containerRect.left}px`;
		border.style.top = `${rect.top - containerRect.top}px`;
	}

	function detectActiveItem(animate: boolean): void {
		const found = findItemByPath(window.location.pathname);
		const previousItem = activeItem?.isConnected
			? activeItem
			: nav.querySelector<HTMLElement>(".mxnav-item.is-active-item");
		const parts = getIconParts();
		const snapshot = parts
			? captureIconSnapshot(parts)
			: { rect: null, markup: "" };
		navItems.forEach((item) => {
			item.classList.toggle("is-active-item", item === found);
		});
		activeItem = found;
		syncIcon(previousItem, found, snapshot, animate);
		if (found) {
			nav.classList.add("has-active-item");
			requestAnimationFrame(() => moveHighlight(found));
		} else {
			nav.classList.remove("has-active-item");
			border.style.opacity = "0";
		}
	}

	navItems.forEach((item) => {
		item.addEventListener(
			"mouseenter",
			() => {
				moveHighlight(item);
				syncMxnavDropdownOnHover(item);
			},
			{ signal },
		);
	});

	nav.addEventListener(
		"mouseleave",
		() => {
			// 回落到当前页的激活项，且必须按 URL 现算（swup pushState 时序，原作同注）
			moveHighlight(findItemByPath(window.location.pathname));
			syncMxnavDropdownOnHover(null);
		},
		{ signal },
	);
	nav.addEventListener(
		"mouseenter",
		() => {
			border.style.opacity = "1";
		},
		{ signal },
	);

	function scheduleIconPositionSync(): void {
		if (resizeFrame !== null) return;
		resizeFrame = requestAnimationFrame(() => {
			resizeFrame = null;
			if (hasRunningIconAnimation()) return;
			const current =
				activeItem?.isConnected
					? activeItem
					: nav.querySelector<HTMLElement>(".mxnav-item.is-active-item");
			const parts = getIconParts();
			const template = getIconTemplate(current);
			if (parts && template) setIconBox(parts.layer, template);
			repositionMxnavDropdown();
		});
	}

	const resizeObserver = new ResizeObserver(scheduleIconPositionSync);
	resizeObserver.observe(nav);
	window.addEventListener("resize", scheduleIconPositionSync, {
		passive: true,
		signal,
	});
	signal.addEventListener("abort", () => {
		resizeObserver.disconnect();
		if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
		cancelIconAnimations();
	});

	detectActiveItem(animateActiveChange);
	return {
		syncActive: () => detectActiveItem(true),
	};
}

/* ================= 滚动收放（原作 initNavbarScrollLayout） ================= */

function initScrollLayout(
	root: HTMLElement,
	signal: AbortSignal,
): { sync: () => void } {
	const segments = root.querySelector<HTMLElement>(".mxnav-segments");
	const center = root.querySelector<HTMLElement>("[data-mxnav-center-seg]");
	if (!segments || !center) return { sync: () => {} };

	const SCROLL_IN = 80;
	const SCROLL_OUT = 40;
	const COMPACT_GAP = 8;
	const desktopMedia = window.matchMedia("(min-width: 1024px)");
	let isCompact = root.classList.contains("is-scrolled");
	let scrollFrame: number | null = null;
	let layoutFrame: number | null = null;

	function updateCompactLayout(): void {
		if (!isCompact || !desktopMedia.matches) return;
		const segmentsRect = segments.getBoundingClientRect();
		const centerRect = center.getBoundingClientRect();
		root.style.setProperty(
			"--mxnav-compact-left",
			`${centerRect.left - segmentsRect.left - COMPACT_GAP}px`,
		);
		root.style.setProperty(
			"--mxnav-compact-right",
			`${centerRect.right - segmentsRect.left + COMPACT_GAP}px`,
		);
	}

	function scheduleCompactLayout(): void {
		if (layoutFrame !== null) return;
		layoutFrame = requestAnimationFrame(() => {
			layoutFrame = null;
			updateCompactLayout();
		});
	}

	function syncCompactState(): void {
		let nextCompact = isCompact;
		if (window.scrollY > SCROLL_IN) nextCompact = true;
		else if (window.scrollY < SCROLL_OUT) nextCompact = false;
		if (nextCompact === isCompact) return;
		isCompact = nextCompact;
		root.classList.toggle("is-scrolled", isCompact);
		// 状态切换发生在滚动 rAF 内，立即测量可避免先渲染一帧错误锚点（原作同注）
		updateCompactLayout();
	}

	function handleScroll(): void {
		if (scrollFrame !== null) return;
		scrollFrame = requestAnimationFrame(() => {
			scrollFrame = null;
			syncCompactState();
		});
	}

	window.addEventListener("scroll", handleScroll, { passive: true, signal });
	window.addEventListener("resize", scheduleCompactLayout, {
		passive: true,
		signal,
	});
	const resizeObserver = new ResizeObserver(scheduleCompactLayout);
	resizeObserver.observe(segments);
	resizeObserver.observe(center);
	signal.addEventListener("abort", () => {
		resizeObserver.disconnect();
		if (scrollFrame !== null) cancelAnimationFrame(scrollFrame);
		if (layoutFrame !== null) cancelAnimationFrame(layoutFrame);
		root.classList.remove("is-scrolled");
		root.style.removeProperty("--mxnav-compact-left");
		root.style.removeProperty("--mxnav-compact-right");
	});

	syncCompactState();
	updateCompactLayout();
	return { sync: syncCompactState };
}

/* ================= 节点挪窝（资料卡 → body；搜索面板 → #top-row） ================= */

interface ReparentRecord {
	el: HTMLElement;
	parent: Node;
	next: Node | null;
}

function reparent(el: HTMLElement, target: Node): ReparentRecord {
	const record: ReparentRecord = {
		el,
		parent: el.parentNode as Node,
		next: el.nextSibling,
	};
	target.appendChild(el);
	return record;
}

function restoreReparent(record: ReparentRecord): void {
	if (!record.el.isConnected || record.el.parentNode === record.parent) return;
	record.parent.insertBefore(record.el, record.next);
}

/* ================= 工具面板（原作工具面板一套 + 本站动作接线） ================= */

const TOOLS_CLOSE_DELAY = 260;
const TOOLS_EDGE_INSET = 12;

function clampValue(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

interface ToolsPanel {
	close: () => void;
	isOpen: () => boolean;
	sync: () => void;
}

function initToolsPanel(
	signal: AbortSignal,
	opts: { onOpen: () => void },
): ToolsPanel {
	const btn = document.querySelector<HTMLElement>("[data-mxnav-tools-btn]");
	const panel = document.querySelector<HTMLElement>("[data-mxnav-tools-panel]");
	if (!btn || !panel) {
		return { close: () => {}, isOpen: () => false, sync: () => {} };
	}
	const themeWrap = panel.querySelector<HTMLElement>("[data-mxnav-theme-wrap]");

	/* 完整外观设置面板（#display-setting）原生挂在标准顶栏 .navbar-bar 内，
	   而 .navbar-bar 在明信下整条 display:none——「更多外观设置」程序化点击
	   虽然触发了开关，面板却永远渲染不出来（站长实锤「点不开」）。照本站
	   资料卡的先例：明信期间把面板节点挪到 body 末尾（其开关/外点关闭逻辑
	   全按 id 工作，不受父级影响），切离明信时按记录的原位放回。 */
	const settingsPanel = document.getElementById("display-setting");
	let settingsHome: { parent: HTMLElement; next: Node | null } | null = null;
	function relocateSettingsPanel(): void {
		if (!settingsPanel) return;
		const inMingxin =
			document.documentElement.getAttribute("data-site-mode") === "mingxin";
		if (inMingxin && settingsPanel.parentElement !== document.body) {
			settingsHome = {
				parent: settingsPanel.parentElement as HTMLElement,
				next: settingsPanel.nextSibling,
			};
			document.body.appendChild(settingsPanel);
		} else if (!inMingxin && settingsHome) {
			settingsHome.parent.insertBefore(settingsPanel, settingsHome.next);
			settingsHome = null;
		}
	}
	relocateSettingsPanel();
	window.addEventListener("siteModeChange", relocateSettingsPanel, { signal });

	let closeTimer: number | null = null;
	let repositionFrame = 0;
	let pointerInside = false;

	const isOpen = (): boolean => panel.classList.contains("is-open");

	function cancelClose(): void {
		if (closeTimer !== null) {
			window.clearTimeout(closeTimer);
			closeTimer = null;
		}
	}

	function scheduleClose(): void {
		if (closeTimer !== null) return;
		closeTimer = window.setTimeout(() => {
			closeTimer = null;
			close();
		}, TOOLS_CLOSE_DELAY);
	}

	/* 面板定位：箱体水平中心对准工具按钮，视口放不下时整体内收，
	   --mxnav-tools-anchor-x 记录按钮中心相对面板左缘的偏移（原作同法） */
	function positionPanel(): void {
		const segments = btn.closest(".mxnav-segments");
		if (!segments) return;
		const segmentsRect = segments.getBoundingClientRect();
		const buttonRect = btn.getBoundingClientRect();
		const panelWidth = panel.offsetWidth;
		const viewportWidth = document.documentElement.clientWidth;
		const center = buttonRect.left + buttonRect.width / 2;
		const left = clampValue(
			center - panelWidth / 2,
			TOOLS_EDGE_INSET,
			viewportWidth - panelWidth - TOOLS_EDGE_INSET,
		);
		const anchorX = clampValue(
			center - left,
			TOOLS_EDGE_INSET,
			panelWidth - TOOLS_EDGE_INSET,
		);
		panel.style.left = `${left - segmentsRect.left}px`;
		panel.style.setProperty("--mxnav-tools-anchor-x", `${anchorX}px`);
	}

	function open(): void {
		cancelClose();
		if (isOpen()) return;
		opts.onOpen();
		positionPanel();
		panel.classList.add("is-open");
		btn.setAttribute("aria-expanded", "true");
	}

	function close(): void {
		cancelClose();
		if (!isOpen()) return;
		panel.classList.remove("is-open");
		btn.setAttribute("aria-expanded", "false");
		themeWrap?.classList.remove("is-expanded");
		highlightRow(null);
	}

	/* 箱内单药丸滑动高亮（原作同法） */
	const highlight = panel.querySelector<HTMLElement>(
		"[data-mxnav-tools-highlight]",
	);
	const rows = Array.from(
		panel.querySelectorAll<HTMLElement>("[data-mxnav-tools-stop]"),
	);
	rows.forEach((row, index) => {
		row.style.setProperty("--mxnav-tools-row-index", String(index));
	});
	let highlightedRow: HTMLElement | null = null;

	function highlightRow(row: HTMLElement | null): void {
		if (!highlight) return;
		highlightedRow = row;
		if (!row) {
			highlight.classList.remove("is-on");
			return;
		}
		highlight.style.setProperty("--mxnav-tools-hl-y", `${row.offsetTop}px`);
		highlight.style.setProperty("--mxnav-tools-hl-h", `${row.offsetHeight}px`);
		highlight.classList.add("is-on");
	}

	const box = panel.querySelector<HTMLElement>(".mxnav-tools-box");
	if (box) {
		const rowOf = (target: EventTarget | null): HTMLElement | null => {
			if (!(target instanceof Element)) return null;
			return target.closest<HTMLElement>("[data-mxnav-tools-stop]");
		};
		box.addEventListener(
			"pointerover",
			(event) => {
				if (event.pointerType === "touch") return;
				const row = rowOf(event.target);
				if (row === highlightedRow) return;
				highlightRow(row);
			},
			{ signal },
		);
		box.addEventListener(
			"pointerleave",
			() => highlightRow(null),
			{ signal },
		);
		box.addEventListener(
			"focusin",
			(event) => highlightRow(rowOf(event.target)),
			{ signal },
		);
	}

	btn.addEventListener("mouseenter", open, { signal });
	btn.addEventListener("mouseleave", scheduleClose, { signal });
	panel.addEventListener(
		"mouseenter",
		() => {
			pointerInside = true;
			cancelClose();
		},
		{ signal },
	);
	panel.addEventListener(
		"mouseleave",
		(event) => {
			const rect = panel.getBoundingClientRect();
			const stillInside =
				event.clientX >= rect.left &&
				event.clientX <= rect.right &&
				event.clientY >= rect.top &&
				event.clientY <= rect.bottom;
			// 主题切换的 View Transition 会把指针命中转交给快照层（原作同注）
			if (
				stillInside &&
				document.documentElement.classList.contains("is-theme-transitioning")
			) {
				return;
			}
			pointerInside = false;
			scheduleClose();
		},
		{ signal },
	);
	/* 外观段展开：CSS :hover 之外再由控制器挂 .is-expanded（同一真实指针
	   事件驱动）——无 hover 介质的环境里 CSS 规则不生效时，展开仍由真实
	   mouseenter 保证，主题行 → 形态格的指针路径不断线 */
	if (themeWrap) {
		themeWrap.addEventListener(
			"mouseenter",
			() => themeWrap.classList.add("is-expanded"),
			{ signal },
		);
		themeWrap.addEventListener(
			"focusin",
			() => themeWrap.classList.add("is-expanded"),
			{ signal },
		);
		themeWrap.addEventListener(
			"mouseleave",
			() => themeWrap.classList.remove("is-expanded"),
			{ signal },
		);
	}
	btn.addEventListener("focusin", open, { signal });
	btn.addEventListener(
		"focusout",
		(event) => {
			const next = event.relatedTarget;
			if (next instanceof Node && panel.contains(next)) return;
			if (pointerInside) return;
			scheduleClose();
		},
		{ signal },
	);
	panel.addEventListener(
		"focusout",
		(event) => {
			const next = event.relatedTarget;
			if (
				next instanceof Node &&
				(panel.contains(next) || btn.contains(next))
			) {
				return;
			}
			if (pointerInside) return;
			scheduleClose();
		},
		{ signal },
	);
	btn.addEventListener(
		"click",
		(event) => {
			event.stopPropagation();
			if (isOpen()) close();
			else open();
		},
		{ signal },
	);

	/* ---- 行动作 ---- */
	const noticeBox = panel.querySelector<HTMLElement>("[data-mxnav-notice]");
	const noticeBtn = panel.querySelector<HTMLElement>(
		'[data-mxnav-action="notice"]',
	);

	function toggleNotice(): void {
		if (!noticeBox || !noticeBtn) return;
		const willShow = noticeBox.hidden;
		noticeBox.hidden = !willShow;
		noticeBtn.setAttribute("aria-expanded", String(willShow));
	}

	panel.addEventListener(
		"click",
		(event) => {
			const target = event.target;
			if (!(target instanceof Element)) return;
			if (target.closest('[data-mxnav-action="search"]')) {
				// 本次真实点击若继续冒泡到 document，会被站点「点外关闭浮层」
				// 的处理器当成搜索面板的外点而把刚打开的面板又关掉——就地截断
				event.stopPropagation();
				close();
				// 搜索入口在标准顶栏内（明信下隐藏），程序化点击照样触发其面板
				document.getElementById("search-switch")?.click();
				return;
			}
			if (target.closest('[data-mxnav-action="notice"]')) {
				toggleNotice();
				return;
			}
			if (target.closest('[data-mxnav-action="palette"]')) {
				// 同搜索行：截断冒泡，免得刚打开的调色板被当成外点关掉
				event.stopPropagation();
				close();
				document.getElementById("display-settings-switch")?.click();
				return;
			}
			const chip = target.closest<HTMLElement>("[data-mxnav-mode]");
			if (chip) {
				setSiteMode(chip.dataset.mxnavMode as ModeValue);
				return;
			}
			const glowChip = target.closest<HTMLElement>("[data-mxnav-afterglow]");
			if (glowChip) {
				applyAfterglow(glowChip.dataset.mxnavAfterglow === "classic" ? "classic" : "hero");
				syncAfterglowChips();
				return;
			}
			const playerChip = target.closest<HTMLElement>("[data-mxnav-player]");
			if (playerChip) {
				applyPlayerVariant(playerChip.dataset.mxnavPlayer === "pill" ? "pill" : "sidebar");
				syncPlayerChips();
				return;
			}
			// 主题行（group）点完不收，其余行点完即收（原作规则）
			if (target.closest('[data-mxnav-tools-stop="group"]')) return;
			if (target.closest("[data-mxnav-tools-stop]")) close();
		},
		{ signal },
	);

	/* ---- 主题三段滑块 ---- */
	const segmentsEl = panel.querySelector<HTMLElement>(".mxnav-tools-segments");
	const themeButtons = Array.from(
		panel.querySelectorAll<HTMLElement>("[data-mxnav-theme]"),
	);

	function syncThemeSegments(): void {
		const current = getStoredTheme() as ThemeChoice;
		const at = themeButtons.findIndex(
			(button) => button.dataset.mxnavTheme === current,
		);
		themeButtons.forEach((button, index) => {
			button.setAttribute("aria-checked", String(index === at));
		});
		segmentsEl?.style.setProperty(
			"--mxnav-tools-seg-index",
			String(Math.max(0, at)),
		);
	}

	if (segmentsEl && themeButtons.length > 0) {
		segmentsEl.addEventListener(
			"click",
			(event) => {
				const target = event.target;
				if (!(target instanceof Element)) return;
				const button = target.closest<HTMLElement>("[data-mxnav-theme]");
				const value = button?.dataset.mxnavTheme;
				if (value !== "light" && value !== "dark" && value !== "system") {
					return;
				}
				event.stopPropagation();
				setTheme(value as ThemeChoice);
				syncThemeSegments();
			},
			{ signal },
		);
	}
	window.addEventListener("theme-change", syncThemeSegments, { signal });

	/* ---- 外观段形态格同步（逃生口选中态） ---- */
	const modeChips = Array.from(
		panel.querySelectorAll<HTMLElement>("[data-mxnav-mode]"),
	);
	const modeName = panel.querySelector<HTMLElement>("[data-mxnav-mode-name]");

	function syncModes(): void {
		const current = getStoredSiteMode() as ModeValue;
		modeChips.forEach((chip) => {
			chip.setAttribute(
				"aria-checked",
				String(chip.dataset.mxnavMode === current),
			);
		});
		if (modeName) modeName.textContent = MODE_LABELS[current] ?? current;
	}
	window.addEventListener("siteModeChange", syncModes, { signal });

	/* ---- 终幕变体 / 播放器形态：访客覆盖（控制台配置只作默认） ----
	   与 Layout 首帧脚本同键：终幕 localStorage["mingxinAfterglow"] →
	   html[data-mingxin-afterglow]（变体显隐全走 CSS，点了即时换）；
	   播放器 localStorage["mingxinPlayerVariant"] → #mingxin-music-player
	   的 data-mxmp-variant（两张皮共用同一引擎与 <audio>，换皮不断播）。 */
	const afterglowChips = Array.from(
		panel.querySelectorAll<HTMLElement>("[data-mxnav-afterglow]"),
	);
	const playerChips = Array.from(
		panel.querySelectorAll<HTMLElement>("[data-mxnav-player]"),
	);
	function currentAfterglow(): "hero" | "classic" {
		return document.documentElement.getAttribute("data-mingxin-afterglow") === "classic"
			? "classic"
			: "hero";
	}
	function applyAfterglow(value: "hero" | "classic"): void {
		document.documentElement.setAttribute("data-mingxin-afterglow", value);
		try {
			localStorage.setItem("mingxinAfterglow", value);
		} catch {}
		// 终幕区的同名开关（首页在场时）一起同步选中态
		document
			.querySelectorAll<HTMLElement>("[data-afterglow-choice]")
			.forEach((button) => {
				button.setAttribute(
					"aria-checked",
					String(button.dataset.afterglowChoice === value),
				);
			});
	}
	function syncAfterglowChips(): void {
		const current = currentAfterglow();
		afterglowChips.forEach((chip) => {
			chip.setAttribute(
				"aria-checked",
				String(chip.dataset.mxnavAfterglow === current),
			);
		});
	}
	function currentPlayerVariant(): "sidebar" | "pill" {
		const stored = (() => {
			try {
				return localStorage.getItem("mingxinPlayerVariant");
			} catch {
				return null;
			}
		})();
		if (stored === "pill" || stored === "sidebar") return stored;
		return document.getElementById("mingxin-music-player")?.dataset
			.mxmpVariant === "sidebar"
			? "sidebar"
			: "pill";
	}
	function applyPlayerVariant(value: "sidebar" | "pill"): void {
		const player = document.getElementById("mingxin-music-player");
		if (player) player.dataset.mxmpVariant = value;
		try {
			localStorage.setItem("mingxinPlayerVariant", value);
		} catch {}
	}
	function syncPlayerChips(): void {
		const current = currentPlayerVariant();
		playerChips.forEach((chip) => {
			chip.setAttribute(
				"aria-checked",
				String(chip.dataset.mxnavPlayer === current),
			);
		});
	}
	syncAfterglowChips();
	syncPlayerChips();

	/* ---- 快捷键提示按平台改写（原作同法） ---- */
	const modifier = panel.querySelector<HTMLElement>(
		"[data-mxnav-tools-modifier]",
	);
	if (modifier && /Mac|iPhone|iPad|iPod/.test(navigator.userAgent)) {
		modifier.textContent = "⌘";
	}

	/* ---- 收起时机：滚动（指针不在面板内时）/ 尺寸变化重锚 / 外点 ---- */
	window.addEventListener(
		"scroll",
		() => {
			if (pointerInside) return;
			if (isOpen()) close();
		},
		{ passive: true, signal },
	);
	window.addEventListener(
		"resize",
		() => {
			if (!isOpen()) return;
			if (repositionFrame !== 0) return;
			repositionFrame = window.requestAnimationFrame(() => {
				repositionFrame = 0;
				positionPanel();
			});
		},
		{ passive: true, signal },
	);
	document.addEventListener(
		"click",
		(event) => {
			const target = event.target;
			if (!(target instanceof Node)) return;
			if (btn.contains(target) || panel.contains(target)) return;
			if (isOpen()) close();
		},
		{ signal },
	);
	document.addEventListener(
		"keydown",
		(event) => {
			if (event.key !== "Escape" || !isOpen()) return;
			event.preventDefault();
			close();
			btn.focus();
		},
		{ signal },
	);

	signal.addEventListener("abort", () => {
		cancelClose();
		if (repositionFrame !== 0) cancelAnimationFrame(repositionFrame);
		close();
	});

	syncThemeSegments();
	syncModes();
	return {
		close,
		isOpen,
		sync: () => {
			syncThemeSegments();
			syncModes();
			syncAfterglowChips();
			syncPlayerChips();
		},
	};
}

/* ================= 资料卡（原作 navbar-profile-controller 的开合/锚定） ================= */

const PROFILE_CLOSE_DELAY = 260;
const PROFILE_EDGE_INSET = 12;
/* 站点浮层与卡片边缘的间距，须与 CSS 的 --mxprofile-sites-inset 同值 */
const SITES_INSET = 12;
const SITES_DURATION = 360;
const SITES_EASING = "cubic-bezier(0.32, 0.72, 0.29, 1)";

interface ProfilePanel {
	close: () => void;
	isOpen: () => boolean;
}

function initProfilePanel(
	signal: AbortSignal,
	opts: { onOpen: () => void },
): ProfilePanel {
	const panel = document.querySelector<HTMLElement>(
		"[data-mxnav-profile-panel]",
	);
	const leftSeg = document.querySelector<HTMLElement>(
		"[data-mxnav-left-seg]",
	);
	const mask = panel?.querySelector<HTMLElement>("[data-mxnav-profile-mask]");
	if (!panel) return { close: () => {}, isOpen: () => false };

	/* ── 其他站点浮层（原站站点面板开合移植）：卡内绝对定位层，展开靠
	   控制器写像素高度（CSS 只管过渡）；卡片关闭时复位到折叠态 ── */
	const card = panel.querySelector<HTMLElement>("[data-mxnav-profile-card]");
	const sites = card?.querySelector<HTMLElement>("[data-mxprofile-sites]");
	const sitesBar = sites?.querySelector<HTMLElement>(
		"[data-mxprofile-sites-bar]",
	);
	const sitesStack = sites?.querySelector<HTMLElement>(
		"[data-mxprofile-sites-stack]",
	);
	const sitesList = sites?.querySelector<HTMLElement>(
		"[data-mxprofile-sites-list]",
	);
	const sitesToggle = sites?.querySelector<HTMLElement>(
		"[data-mxprofile-sites-toggle]",
	);
	let sitesOpen = false;
	const prefersReducedMotion = (): boolean =>
		window.matchMedia("(prefers-reduced-motion: reduce)").matches;

	/** 折叠态只露出头部条，展开态顶到卡片上沿盖住内容区 */
	function sitesTargetHeight(): number {
		if (!sites || !sitesBar || !card) return 0;
		return sitesOpen
			? Math.max(0, card.clientHeight - SITES_INSET * 2)
			: sitesBar.offsetHeight;
	}

	/** 把面板高度钉成具体像素：auto 与 calc 之间无法插值，过渡需要两端都是长度 */
	function syncSitesHeight(): void {
		if (!sites) return;
		sites.style.height = `${String(sitesTargetHeight())}px`;
	}

	function avatarRects(scope: HTMLElement | null | undefined): Map<string, DOMRect> {
		const rects = new Map<string, DOMRect>();
		scope
			?.querySelectorAll<HTMLElement>("[data-mxprofile-avatar]")
			.forEach((avatar) => {
				const key = avatar.dataset.mxprofileAvatar;
				if (key !== undefined) rects.set(key, avatar.getBoundingClientRect());
			});
		return rects;
	}

	/**
	 * 头像飞行：按 data-mxprofile-avatar 序号配对，把目标侧头像从源侧位置
	 * 平移过来。两侧同尺寸同圆角，只差位移，故不需要 scale；序号对不上的
	 * （站点数超过堆叠上限）留在原地，视觉上等于列表多出的项淡入。
	 */
	function flipAvatars(
		scope: HTMLElement | null | undefined,
		from: Map<string, DOMRect>,
	): void {
		if (!scope || prefersReducedMotion()) return;
		scope
			.querySelectorAll<HTMLElement>("[data-mxprofile-avatar]")
			.forEach((avatar) => {
				const key = avatar.dataset.mxprofileAvatar;
				const source = key === undefined ? undefined : from.get(key);
				if (!source) return;
				const target = avatar.getBoundingClientRect();
				const dx = source.left - target.left;
				const dy = source.top - target.top;
				if (dx === 0 && dy === 0) return;
				avatar.animate(
					[
						{ transform: `translate(${String(dx)}px, ${String(dy)}px)` },
						{ transform: "translate(0px, 0px)" },
					],
					{ duration: SITES_DURATION, easing: SITES_EASING },
				);
			});
	}

	function setSitesOpen(next: boolean): void {
		if (!sites || next === sitesOpen) return;
		// 起点矩形必须在状态写入前读：展开态会 display:none 掉堆叠头像
		const from = avatarRects(next ? sitesStack : sitesList);
		sitesOpen = next;
		sites.dataset.mxprofileSitesOpen = String(next);
		sitesToggle?.setAttribute("aria-expanded", String(next));
		syncSitesHeight();
		flipAvatars(next ? sitesList : sitesStack, from);
	}

	function resetSites(): void {
		if (!sites || !sitesOpen) return;
		sitesOpen = false;
		sites.dataset.mxprofileSitesOpen = "false";
		sitesToggle?.setAttribute("aria-expanded", "false");
		syncSitesHeight();
	}

	sitesToggle?.addEventListener(
		"click",
		() => setSitesOpen(!sitesOpen),
		{ signal },
	);
	/* 站点图标加载失败：撤下 img，露出底下垫底的首字符（捕获阶段接 error） */
	card?.addEventListener(
		"error",
		(event) => {
			const img = event.target as HTMLElement;
			if (img.dataset?.mxprofileSiteIcon !== undefined) {
				img.dataset.avatarFailed = "true";
			}
		},
		{ capture: true, signal },
	);
	/* 图标加载成功（捕获阶段接 load，error 不冒泡、load 同理）：
	   与组件内联 onload 互为双保险，亮出前 img 保持不可见 */
	card?.addEventListener(
		"load",
		(event) => {
			const img = event.target as HTMLElement;
			if (img.dataset?.mxprofileSiteIcon !== undefined) {
				img.classList.add("is-loaded");
			}
		},
		{ capture: true, signal },
	);
	/* 初始化补扫：图标可能在监听绑上之前就已成败（缓存/断网时事件先到），
	   已加载成的补亮、已失败的直接标记，免得破图压住首字兜底 */
	card
		?.querySelectorAll<HTMLImageElement>("[data-mxprofile-site-icon]")
		.forEach((img) => {
			if (!img.complete) return;
			if (img.naturalWidth > 0) img.classList.add("is-loaded");
			else img.dataset.avatarFailed = "true";
		});
	syncSitesHeight();

	let closeTimer: number | null = null;
	let openedAsMobile = false;
	let previousBodyOverflow = "";
	const mobileMedia = window.matchMedia("(max-width: 1023.98px)");
	const isMobileViewport = (): boolean => mobileMedia.matches;

	const isOpen = (): boolean => panel.classList.contains("is-open");

	function cancelScheduledClose(): void {
		if (closeTimer !== null) {
			window.clearTimeout(closeTimer);
			closeTimer = null;
		}
	}

	function scheduleClose(): void {
		if (closeTimer !== null) return;
		closeTimer = window.setTimeout(() => {
			closeTimer = null;
			close();
		}, PROFILE_CLOSE_DELAY);
	}

	/* 桌面锚定：卡片水平中心对准左段中心，视口放不下时整体内收，
	   top = 左段下缘（桥区是面板自身的 padding-top，原作同法） */
	function positionPanel(): void {
		if (!leftSeg) return;
		const rect = leftSeg.getBoundingClientRect();
		const panelWidth = panel.offsetWidth;
		const viewportWidth = document.documentElement.clientWidth;
		const center = rect.left + rect.width / 2;
		const left = Math.min(
			Math.max(center - panelWidth / 2, PROFILE_EDGE_INSET),
			viewportWidth - panelWidth - PROFILE_EDGE_INSET,
		);
		panel.style.left = `${left}px`;
		panel.style.top = `${rect.bottom}px`;
	}

	function open(): void {
		cancelScheduledClose();
		if (isOpen()) return;
		const mobile = isMobileViewport();
		if (!mobile && !leftSeg) return;
		opts.onOpen();
		openedAsMobile = mobile;
		if (mobile) {
			panel.style.removeProperty("left");
			panel.style.removeProperty("top");
		} else {
			positionPanel();
		}
		panel.classList.add("is-open");
		if (openedAsMobile) {
			previousBodyOverflow = document.body.style.overflow;
			document.body.style.overflow = "hidden";
		}
		// 卡片此刻已可见，条高/卡高只有现在量得准（字体晚到也会纠正）
		syncSitesHeight();
	}

	function close(): void {
		cancelScheduledClose();
		if (!isOpen()) return;
		panel.classList.remove("is-open");
		// 面板跨软导航复用，这里是唯一的状态归位点：站点层一并收回折叠态
		resetSites();
		if (openedAsMobile) {
			document.body.style.overflow = previousBodyOverflow;
		}
		openedAsMobile = false;
	}

	function toggle(): void {
		if (isOpen()) close();
		else open();
	}

	/* 移动端：点品牌胶囊开合（桌面端保持回主页，原作同法） */
	leftSeg?.addEventListener(
		"click",
		(event) => {
			const target = event.target as HTMLElement;
			if (!target.closest(".mxnav-brand")) return;
			if (!isMobileViewport()) return;
			event.preventDefault();
			event.stopPropagation();
			toggle();
		},
		{ signal },
	);
	leftSeg?.addEventListener(
		"mouseenter",
		() => {
			if (!isMobileViewport()) open();
		},
		{ signal },
	);
	leftSeg?.addEventListener(
		"mouseleave",
		() => {
			if (!isMobileViewport()) scheduleClose();
		},
		{ signal },
	);
	leftSeg?.addEventListener("focusin", open, { signal });
	leftSeg?.addEventListener(
		"focusout",
		(event) => {
			const next = event.relatedTarget;
			if (next instanceof Node && panel.contains(next)) return;
			scheduleClose();
		},
		{ signal },
	);
	panel.addEventListener("mouseenter", cancelScheduledClose, { signal });
	panel.addEventListener(
		"mouseleave",
		() => {
			if (!isMobileViewport()) scheduleClose();
		},
		{ signal },
	);
	panel.addEventListener(
		"focusout",
		(event) => {
			const next = event.relatedTarget;
			if (
				next instanceof Node &&
				(panel.contains(next) || leftSeg?.contains(next))
			) {
				return;
			}
			scheduleClose();
		},
		{ signal },
	);
	mask?.addEventListener("click", close, { signal });

	window.addEventListener(
		"scroll",
		() => {
			if (!isOpen() || openedAsMobile) return;
			close();
		},
		{ passive: true, signal },
	);
	window.addEventListener(
		"resize",
		() => {
			if (!isOpen() || openedAsMobile) return;
			close();
		},
		{ passive: true, signal },
	);
	document.addEventListener(
		"keydown",
		(event) => {
			if (event.key !== "Escape" || !isOpen()) return;
			event.preventDefault();
			close();
			leftSeg?.querySelector<HTMLElement>(".mxnav-brand")?.focus();
		},
		{ signal },
	);

	signal.addEventListener("abort", () => {
		cancelScheduledClose();
		close();
		panel.style.removeProperty("left");
		panel.style.removeProperty("top");
	});

	return { close, isOpen };
}

/* ================= 挂载 / 销毁 / 入口（生命周期照本站既有纪律） ================= */

function init(): void {
	const root = document.querySelector<HTMLElement>("[data-mxnav]");
	if (!root) return;
	const ac = new AbortController();
	const { signal } = ac;
	const reparents: ReparentRecord[] = [];

	/* 资料卡挪到 body 末尾（原作同位：避开顶栏壳层的包含块与裁剪） */
	const profilePanel = document.querySelector<HTMLElement>(
		"[data-mxnav-profile-panel]",
	);
	if (profilePanel && profilePanel.parentNode !== document.body) {
		reparents.push(reparent(profilePanel, document.body));
	}
	/* 搜索面板挪到 #top-row 直下（其标准位在隐藏的标准顶栏内） */
	const searchPanel = document.getElementById("search-panel");
	const topRow = document.getElementById("top-row");
	if (searchPanel && topRow && searchPanel.parentNode !== topRow) {
		reparents.push(reparent(searchPanel, topRow));
	}

	let tools: ToolsPanel | null = null;
	let profile: ProfilePanel | null = null;
	profile = initProfilePanel(signal, {
		onOpen: () => {
			tools?.close();
			closeMxnavDropdownPanel();
		},
	});
	tools = initToolsPanel(signal, {
		onOpen: () => {
			profile?.close();
			closeMxnavDropdownPanel();
		},
	});

	const slider = initHoverSlider(signal, hasMountedOnce);
	hasMountedOnce = true;
	const scrollLayout = initScrollLayout(root, signal);

	/* 窄屏菜单钮：转点标准顶栏的菜单开关（本站抽屉菜单本体在那儿） */
	const menuBtn = document.querySelector<HTMLElement>("[data-mxnav-menu-btn]");
	menuBtn?.addEventListener(
		"click",
		() => {
			document.getElementById("nav-menu-switch")?.click();
		},
		{ signal },
	);

	active = {
		sync: () => {
			slider.syncActive();
			scrollLayout.sync();
			tools?.sync();
			closeMxnavDropdownPanel();
		},
		destroy: () => {
			ac.abort();
			reparents.forEach(restoreReparent);
		},
	};
}

/** 入口：形态守卫 + 生命周期。脚本随顶栏常驻，监听只注册一次。 */
export function initMingxinNavbar(): void {
	const w = window as unknown as { __mingxinNavbarBoot?: boolean };
	if (w.__mingxinNavbarBoot) return;
	w.__mingxinNavbarBoot = true;
	initMxnavDropdownDelegation();
	const sync = () => {
		if (isMingxin()) {
			if (!active) init();
		} else {
			active?.destroy();
			active = null;
		}
	};
	sync();
	window.addEventListener("siteModeChange", sync);
	document.addEventListener("swup:page:view", () => {
		if (isMingxin()) {
			if (!active) init();
			else active.sync();
		}
	});
	document.addEventListener("swup:visit:start", () => {
		active?.destroy();
		active = null;
	});
}
