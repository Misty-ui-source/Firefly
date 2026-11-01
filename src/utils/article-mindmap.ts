/**
 * 文章思维导图：标题树采集 + 弹窗控制器。
 *
 * 机制参考 MmzMing 的 ArticleTocPanel 思维导图（markmap 式嵌套布局、
 * SVG 共享主干连线、em 缩放体系、光标锚点缩放、拖拽平移），按本站约定重写：
 * - 标题窗口与本站 TOC 完全一致：采集正文 h1–h6 后按 computeTocItems 的
 *   口径取「最浅层级起 3 层」，导图条目与读者在目录里看到的一一对应；
 * - 弹窗与三个入口（侧栏目录 / 悬浮目录 / 沉浸目录）都挂在 swup 容器之外
 *   常驻，每次打开时从当前 DOM 重新采集，站内导航无需重绑组件；
 * - 加密文章解密前正文只有密文、采不到标题，入口保持隐藏，
 *   收到 password:decrypted 后再同步一次显隐。
 */

/** 阅读偏移：与 TOCManager 的 scrollOffset 一致 */
const READING_OFFSET = 80;
/** 与 TOC 的 maxLevel 一致：最浅层级起取 3 层 */
const MAX_LEVEL = 3;
const LINE_CORNER_RADIUS = 5;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2.5;
const ZOOM_STEP = 0.2;
const WHEEL_FACTOR = 1.1;
const PAN_THRESHOLD = 4;
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

export interface MindmapNode {
	/** 文档顺序的扁平下标 */
	index: number;
	/** 归一化层级：文章标题的直接子级为 1，向下递增 */
	level: number;
	/** 原始标题层级（h1=1 … h6=6），建栈与窗口过滤时使用 */
	depth: number;
	text: string;
	/** 标题元素 id；缺失时点击仍按元素位置滚动，只是不写 hash */
	id: string | null;
	element: HTMLElement;
	/** 父节点下标，根层级为 -1 */
	parent: number;
	/** 子节点下标列表 */
	children: number[];
}

export interface MindmapTree {
	/** 文章标题文本（根节点） */
	title: string;
	/** 文章标题元素；取不到时点击根节点回页顶 */
	titleElement: HTMLElement | null;
	nodes: MindmapNode[];
	/** 归一化最大层级 */
	maxLevel: number;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function prefersReducedMotion(): boolean {
	return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** 标题纯文本：剔除脚本等渲染噪声（清理范围与 TOCManager 对齐） */
function getHeadingText(heading: HTMLElement): string {
	const clone = heading.cloneNode(true) as HTMLElement;
	clone
		.querySelectorAll("script, style, .anchor-icon, [data-pagefind-ignore]")
		.forEach((element) => {
			element.remove();
		});

	let text = (clone.textContent || "").replace(/#+\s*$/, "").trim();
	if (!text) {
		// 空文本回退（例如动态副标题），与 TOCManager 的 DOM 路径一致
		const dataSubtitles = heading.getAttribute("data-subtitles");
		if (dataSubtitles) {
			try {
				const subtitles: unknown = JSON.parse(dataSubtitles);
				text = Array.isArray(subtitles)
					? String(subtitles[0] ?? "")
					: String(subtitles ?? "");
			} catch {
				// ignore
			}
		}
	}
	return text || heading.getAttribute("aria-label") || heading.id || "Heading";
}

/**
 * 从当前文档采集正文标题并建树。
 * 返回 null 表示没有正文容器或可用标题，调用方应隐藏全部入口。
 */
export function collectMindmapTree(): MindmapTree | null {
	const content =
		document.querySelector(".custom-md") ??
		document.querySelector(".prose") ??
		document.querySelector(".markdown-content");
	if (!content) return null;

	const all = Array.from(
		content.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6"),
	);
	if (all.length === 0) return null;

	/* 窗口与 computeTocItems 一致：depth < minDepth + maxLevel */
	let minDepth = 10;
	for (const element of all) {
		minDepth = Math.min(
			minDepth,
			Number.parseInt(element.tagName.slice(1), 10),
		);
	}
	const elements = all.filter(
		(element) =>
			Number.parseInt(element.tagName.slice(1), 10) < minDepth + MAX_LEVEL,
	);
	if (elements.length === 0) return null;

	/* 根标题：优先当前 DOM 的文章标题元素（弹窗元素跨导航常驻，
	   其 data-article-title 只代表首屏文章，导航后会过期，只能兜底） */
	const dialog = document.getElementById("article-mindmap");
	const titleElement = document.querySelector<HTMLElement>(
		'#post-container [data-pagefind-meta="title"]',
	);
	const title =
		titleElement?.textContent?.trim() ||
		dialog?.dataset.articleTitle?.trim() ||
		"";

	const nodes: MindmapNode[] = [];
	/** 当前祖先链（各层级最近一个未闭合节点的下标） */
	const stack: number[] = [];

	for (const element of elements) {
		const depth = Number.parseInt(element.tagName.slice(1), 10);
		while (stack.length > 0 && nodes[stack[stack.length - 1]].depth >= depth) {
			stack.pop();
		}
		const parent = stack.length > 0 ? stack[stack.length - 1] : -1;
		const node: MindmapNode = {
			index: nodes.length,
			level: stack.length + 1,
			depth,
			text: getHeadingText(element),
			id: element.id || null,
			element,
			parent,
			children: [],
		};
		if (parent >= 0) nodes[parent].children.push(node.index);
		nodes.push(node);
		stack.push(node.index);
	}

	return {
		title,
		titleElement,
		nodes,
		maxLevel: nodes.reduce((max, node) => Math.max(max, node.level), 1),
	};
}

/* ---------- 弹窗运行时 ---------- */

function getDialog(): HTMLDialogElement | null {
	return document.getElementById("article-mindmap") as HTMLDialogElement | null;
}

function getCanvas(): HTMLElement | null {
	return (
		getDialog()?.querySelector<HTMLElement>("[data-mindmap-canvas]") ?? null
	);
}

function getMount(): HTMLElement | null {
	return getDialog()?.querySelector<HTMLElement>("[data-mindmap-tree]") ?? null;
}

function getLinesSvg(): SVGSVGElement | null {
	return (
		getDialog()?.querySelector<SVGSVGElement>("[data-mindmap-lines]") ?? null
	);
}

function runtime(): Window["ArticleMindmap"] {
	if (!window.ArticleMindmap) {
		window.ArticleMindmap = {
			tree: null,
			zoom: 1,
			nodePills: [],
			paths: [],
			rootPill: null,
			pan: null,
			panDragged: false,
		};
	}
	return window.ArticleMindmap;
}

/** 点击节点跳到对应标题：平滑滚动到标题上方 READING_OFFSET 处，有 id 时同步写 hash */
function navigateTo(index: number): void {
	const tree = runtime().tree;
	if (!tree) return;

	window.tocInternalNavigation = true;
	let targetTop: number;
	let hashId: string | null = null;
	if (index < 0) {
		targetTop = tree.titleElement
			? tree.titleElement.getBoundingClientRect().top +
				window.scrollY -
				READING_OFFSET
			: 0;
	} else {
		const node = tree.nodes[index];
		if (!node) return;
		targetTop =
			node.element.getBoundingClientRect().top +
			window.scrollY -
			READING_OFFSET;
		hashId = node.id;
	}

	if (hashId) {
		const destination = new URL(window.location.href);
		destination.hash = hashId;
		window.history.pushState(null, "", destination);
	}
	window.scrollTo({
		top: Math.max(0, targetTop),
		behavior: prefersReducedMotion() ? "auto" : "smooth",
	});
}

function buildMindmapPill(
	index: number,
	text: string,
	isRoot: boolean,
): HTMLButtonElement {
	const state = runtime();
	const pill = document.createElement("button");
	pill.type = "button";
	pill.className = isRoot
		? "article-mindmap__node article-mindmap__node--root"
		: "article-mindmap__node";
	pill.dataset.mindmapIndex = String(index);
	pill.title = text;
	if (!isRoot) {
		const dot = document.createElement("span");
		dot.className = "article-mindmap__node-dot";
		pill.appendChild(dot);
	}
	const textEl = document.createElement("span");
	textEl.className = "article-mindmap__node-text";
	textEl.textContent = text;
	pill.appendChild(textEl);
	if (index >= 0) state.nodePills[index] = pill;
	return pill;
}

/** 一棵子树 = 「节点胶囊 + 子级竖列」的水平组合 */
function buildMindmapBranch(node: MindmapNode, parent: HTMLElement): void {
	const tree = runtime().tree;
	if (!tree) return;

	const branch = document.createElement("div");
	branch.className = "article-mindmap__branch";
	branch.appendChild(buildMindmapPill(node.index, node.text, false));

	if (node.children.length > 0) {
		const children = document.createElement("div");
		children.className = "article-mindmap__children";
		node.children.forEach((childIndex) => {
			const child = tree.nodes[childIndex];
			if (child) buildMindmapBranch(child, children);
		});
		branch.appendChild(children);
	}
	parent.appendChild(branch);
}

/**
 * 嵌套递归布局（markmap 同款观感）：父节点所在行与其子树子列垂直居中对齐，
 * 组内小间距、组间大间距——间距全部用 em 表达，缩放只改树容器 font-size。
 */
function renderMindmap(): void {
	const state = runtime();
	const tree = state.tree;
	const mount = getMount();
	if (!tree || !mount) return;

	state.nodePills = [];
	state.rootPill = null;
	state.paths = [];

	const treeEl = document.createElement("div");
	treeEl.className = "article-mindmap__tree";

	const rootPill = buildMindmapPill(-1, tree.title, true);
	treeEl.appendChild(rootPill);
	state.rootPill = rootPill;

	const roots = tree.nodes.filter((node) => node.parent < 0);
	if (roots.length > 0) {
		const children = document.createElement("div");
		children.className = "article-mindmap__children";
		roots.forEach((node) => {
			buildMindmapBranch(node, children);
		});
		treeEl.appendChild(children);
	}

	const svg = getLinesSvg();
	if (svg) {
		mount.replaceChildren(svg, treeEl);
	} else {
		mount.replaceChildren(treeEl);
	}
}

function drawMindmapLines(): void {
	const state = runtime();
	const tree = state.tree;
	const svg = getLinesSvg();
	const canvas = getCanvas();
	if (!tree || !svg || !canvas) return;

	/* 先归零排除自身（与旧 path）对滚动尺寸的污染 */
	svg.setAttribute("width", "0");
	svg.setAttribute("height", "0");
	svg.replaceChildren();
	state.paths = [];
	svg.setAttribute("width", String(canvas.scrollWidth));
	svg.setAttribute("height", String(canvas.scrollHeight));

	const canvasRect = canvas.getBoundingClientRect();
	const pillCenter = (pill: HTMLElement | null) => {
		if (!pill) return null;
		const rect = pill.getBoundingClientRect();
		if (rect.width === 0 && rect.height === 0) return null;
		return {
			left: rect.left - canvasRect.left + canvas.scrollLeft,
			right: rect.right - canvasRect.left + canvas.scrollLeft,
			y: rect.top - canvasRect.top + canvas.scrollTop + rect.height / 2,
		};
	};

	const rootBox = pillCenter(state.rootPill);
	tree.nodes.forEach((node) => {
		const start =
			node.parent >= 0
				? pillCenter(state.nodePills[node.parent] ?? null)
				: rootBox;
		const end = pillCenter(state.nodePills[node.index] ?? null);
		if (!start || !end) return;

		const path = document.createElementNS(SVG_NAMESPACE, "path");
		path.classList.add("article-mindmap__line");
		/* markmap 同款共享主干：水平出父节点 → 中点处垂直转弯 → 水平入子节点，
		   各兄弟路径的公共段重叠，视觉上是一根主干分出多条分支 */
		const branchX = (start.right + end.left) / 2;
		const corner = Math.min(
			LINE_CORNER_RADIUS,
			Math.abs(end.y - start.y) / 2,
			Math.max(0, end.left - branchX),
		);
		const turn =
			corner < 0.5
				? [`M ${start.right} ${start.y}`, `H ${end.left}`]
				: end.y > start.y
					? [
							`M ${start.right} ${start.y}`,
							`H ${branchX - corner}`,
							`Q ${branchX} ${start.y} ${branchX} ${start.y + corner}`,
							`V ${end.y - corner}`,
							`Q ${branchX} ${end.y} ${branchX + corner} ${end.y}`,
							`H ${end.left}`,
						]
					: [
							`M ${start.right} ${start.y}`,
							`H ${branchX - corner}`,
							`Q ${branchX} ${start.y} ${branchX} ${start.y - corner}`,
							`V ${end.y + corner}`,
							`Q ${branchX} ${end.y} ${branchX + corner} ${end.y}`,
							`H ${end.left}`,
						];
		path.setAttribute("d", turn.join(" "));
		svg.appendChild(path);
		state.paths[node.index] = path;
	});
}

/** 缩放改挂载点的 --mindmap-zoom：em 体系整体缩放，滚动区随之正确 */
function applyMindmapZoom(): void {
	getMount()?.style.setProperty("--mindmap-zoom", String(runtime().zoom));
}

function setMindmapZoom(zoom: number): void {
	runtime().zoom = clamp(zoom, ZOOM_MIN, ZOOM_MAX);
	applyMindmapZoom();
	drawMindmapLines();
}

/** 画布式缩放：以光标为锚点，缩放前后光标下的内容点保持不动 */
function zoomMindmapAt(factor: number, clientX: number, clientY: number): void {
	const canvas = getCanvas();
	if (!canvas) return;

	const state = runtime();
	const oldZoom = state.zoom;
	const newZoom = clamp(oldZoom * factor, ZOOM_MIN, ZOOM_MAX);
	if (newZoom === oldZoom) return;

	const rect = canvas.getBoundingClientRect();
	const contentX = clientX - rect.left + canvas.scrollLeft;
	const contentY = clientY - rect.top + canvas.scrollTop;

	state.zoom = newZoom;
	applyMindmapZoom();

	/* em 体系下布局尺寸随 font-size 等比缩放，内容点坐标同比例放大 */
	const ratio = newZoom / oldZoom;
	canvas.scrollLeft = contentX * ratio - (clientX - rect.left);
	canvas.scrollTop = contentY * ratio - (clientY - rect.top);
	drawMindmapLines();
}

function toggleMindmapFullscreen(): void {
	const panel = getDialog()?.querySelector<HTMLElement>(
		".article-mindmap__panel",
	);
	if (!panel) return;
	if (document.fullscreenElement) {
		void document.exitFullscreen();
	} else {
		void panel.requestFullscreen();
	}
}

/** 导图悬停高亮：根到悬停节点整条链的连线与节点转强调色 */
function setMindmapTrail(index: number): void {
	clearMindmapTrail();
	const state = runtime();
	const tree = state.tree;
	if (!tree || index < 0) return;

	let cursor = index;
	while (cursor >= 0) {
		state.nodePills[cursor]?.classList.add("is-trail");
		state.paths[cursor]?.classList.add("is-active");
		cursor = tree.nodes[cursor].parent;
	}
}

function clearMindmapTrail(): void {
	const state = runtime();
	state.nodePills.forEach((pill) => {
		pill?.classList.remove("is-trail");
	});
	state.paths.forEach((path) => {
		path?.classList.remove("is-active");
	});
}

/** 打开导图：每次打开回到 1:1，缩放只在当次浏览里持续 */
export function openArticleMindmap(): void {
	const dialog = getDialog();
	if (!dialog) return;

	const tree = collectMindmapTree();
	if (!tree) {
		syncMindmapEntries();
		return;
	}

	const state = runtime();
	state.tree = tree;
	state.zoom = 1;
	applyMindmapZoom();
	state.pan = null;
	state.panDragged = false;
	renderMindmap();
	if (!dialog.open) dialog.showModal();
	requestAnimationFrame(() => drawMindmapLines());
}

/** 入口显隐与当前文章的标题树保持一致：采不到标题就藏起来，不留死按钮 */
export function syncMindmapEntries(): void {
	const buttons = document.querySelectorAll<HTMLElement>("[data-mindmap-open]");
	if (buttons.length === 0) return;

	const available = collectMindmapTree() !== null;
	buttons.forEach((button) => {
		button.hidden = !available;
	});
	if (!available) {
		const dialog = getDialog();
		if (dialog?.open) dialog.close();
	}
}

/* ---------- 事件绑定 ---------- */

function onDocumentClick(event: MouseEvent): void {
	const target = event.target as HTMLElement | null;
	if (!target) return;

	const openButton = target.closest<HTMLElement>("[data-mindmap-open]");
	if (openButton) {
		/* 从悬浮目录面板打开时先收起面板，避免导图关闭后还压着一层目录 */
		if (openButton.closest("#floating-toc-panel")) {
			window.toggleFloatingTOC?.();
		}
		openArticleMindmap();
		return;
	}

	const dialog = getDialog();
	if (!dialog?.open) return;

	const state = runtime();
	/* 平移拖拽后紧跟的那次 click 不算数（原版同款吞 click） */
	if (state.panDragged) {
		state.panDragged = false;
		return;
	}
	if (target.closest("[data-mindmap-close]")) {
		dialog.close();
		return;
	}
	if (target.closest("[data-mindmap-zoom-in]")) {
		setMindmapZoom(state.zoom + ZOOM_STEP);
		return;
	}
	if (target.closest("[data-mindmap-zoom-out]")) {
		setMindmapZoom(state.zoom - ZOOM_STEP);
		return;
	}
	if (target.closest("[data-mindmap-reset]")) {
		setMindmapZoom(1);
		return;
	}
	if (target.closest("[data-mindmap-fullscreen]")) {
		toggleMindmapFullscreen();
		return;
	}
	const pill = target.closest<HTMLElement>("[data-mindmap-index]");
	if (pill) {
		navigateTo(Number(pill.dataset.mindmapIndex));
		dialog.close();
	}
}

/** 画布手势（滚轮缩放 / 拖拽平移 / 悬停链）：画布常驻在 swup 容器外，只绑一次 */
function bindCanvas(): void {
	const canvas = getCanvas();
	if (!canvas || canvas.dataset.mindmapBound === "true") return;
	canvas.dataset.mindmapBound = "true";
	const state = runtime();

	canvas.addEventListener(
		"wheel",
		(event) => {
			event.preventDefault();
			const factor = event.deltaY < 0 ? WHEEL_FACTOR : 1 / WHEEL_FACTOR;
			zoomMindmapAt(factor, event.clientX, event.clientY);
		},
		{ passive: false },
	);

	/* 拖拽平移：按下先只记录起点（不接管指针，保证胶囊正常点击），
	   移动超过阈值才 setPointerCapture 进入平移 */
	canvas.addEventListener("pointerdown", (event) => {
		if (event.button !== 0) return;
		state.pan = {
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			scrollLeft: canvas.scrollLeft,
			scrollTop: canvas.scrollTop,
		};
		state.panDragged = false;
	});
	canvas.addEventListener("pointermove", (event) => {
		const pan = state.pan;
		if (!pan || event.pointerId !== pan.pointerId) return;
		const dx = event.clientX - pan.startX;
		const dy = event.clientY - pan.startY;
		if (!state.panDragged) {
			if (Math.hypot(dx, dy) <= PAN_THRESHOLD) return;
			state.panDragged = true;
			canvas.setPointerCapture(event.pointerId);
			canvas.classList.add("is-panning");
		}
		canvas.scrollLeft = pan.scrollLeft - dx;
		canvas.scrollTop = pan.scrollTop - dy;
	});
	const endPan = (event: PointerEvent) => {
		if (!state.pan || event.pointerId !== state.pan.pointerId) return;
		state.pan = null;
		canvas.classList.remove("is-panning");
	};
	canvas.addEventListener("pointerup", endPan);
	canvas.addEventListener("pointercancel", endPan);

	canvas.addEventListener("mouseover", (event) => {
		const pill = (event.target as HTMLElement | null)?.closest<HTMLElement>(
			"[data-mindmap-index]",
		);
		if (!pill) return;
		setMindmapTrail(Number(pill.dataset.mindmapIndex));
	});
	canvas.addEventListener("mouseleave", () => clearMindmapTrail());
}

/**
 * 安装控制器。弹窗与入口都在 swup 容器之外常驻，监听只注册一次；
 * 每次站内导航后只需重绑画布（元素本身不变，通常是空操作）并同步入口显隐。
 */
export function initArticleMindmap(): void {
	runtime();
	window.openArticleMindmap = openArticleMindmap;

	if (window.__articleMindmapInit) {
		bindCanvas();
		syncMindmapEntries();
		return;
	}
	window.__articleMindmapInit = true;

	document.addEventListener("click", onDocumentClick);
	bindCanvas();
	syncMindmapEntries();

	const rebind = () => {
		bindCanvas();
		syncMindmapEntries();
	};
	document.addEventListener("swup:page:view", rebind);
	document.addEventListener("astro:page-load", rebind);
	window.addEventListener("popstate", () => {
		setTimeout(rebind, 200);
	});
	/* 加密文章解密后正文标题才出现，需要补同步一次 */
	document.addEventListener("password:decrypted", () => {
		setTimeout(rebind, 200);
	});
	window.addEventListener("resize", () => {
		if (getDialog()?.open) drawMindmapLines();
	});
	document.addEventListener("fullscreenchange", () => {
		requestAnimationFrame(() => drawMindmapLines());
	});
}
