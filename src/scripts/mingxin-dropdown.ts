/**
 * 明信顶栏共享下拉面板控制器（原站 navbar-dropdown-controller.ts 的移植，
 * 选择器/类名换成本站 mxnav- 约定，逻辑与数值照原作）。
 *
 * 交互模型：整条导航只有一个下拉面板（[data-mxnav-dropdown-panel]），
 * 悬停哪个带子菜单的导航项，面板就滑到哪一项下方并切换到对应内容页
 * （左右滑动 + 内容交叉淡换），滑到无子菜单的项或离开导航时收起。
 * 各导航项的 .mxnav-item 里只保留触发按钮，内容页由 MingxinNavbar.astro
 * 集中渲染在面板内，页与项通过 data-mxnav-dropdown-index /
 * data-mxnav-dropdown-page 配对。
 *
 * 仅在明信形态下有可交互的 DOM（其余形态整根隐藏），委托监听注册一次，
 * 处理函数开头统一做形态守卫。本站没有 swup-lifecycle 工具，导航复位由
 * mingxin-navbar.ts 在 swup:page:view 时调 closeMxnavDropdownPanel。
 */

interface PanelElements {
	panel: HTMLElement;
	box: HTMLElement;
	arrow: HTMLElement;
	pages: Map<number, HTMLElement>;
}

/** 键盘 Enter/ArrowDown 打开后的「钉住」态：悬停不再抢占，Escape/外点/导航才收起 */
let pinnedIndex: number | null = null;
let delegationInitialized = false;

/** 箱体与视口左右边缘、指针与箱体左右边缘的最小留白（px） */
const PANEL_EDGE_INSET = 12;

function isMingxin(): boolean {
	return document.documentElement.dataset.siteMode === "mingxin";
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

function parseIndex(raw: string | undefined): number | null {
	if (raw === undefined) return null;
	const index = Number.parseInt(raw, 10);
	return Number.isInteger(index) ? index : null;
}

function getPanelElements(): PanelElements | null {
	const panel = document.querySelector<HTMLElement>(
		"[data-mxnav-dropdown-panel]",
	);
	if (!panel) return null;
	const box = panel.querySelector<HTMLElement>(".mxnav-dropdown-box");
	const arrow = panel.querySelector<HTMLElement>(".mxnav-dropdown-arrow");
	if (!box || !arrow) return null;

	const pages = new Map<number, HTMLElement>();
	panel
		.querySelectorAll<HTMLElement>("[data-mxnav-dropdown-page]")
		.forEach((page) => {
			const index = parseIndex(page.dataset.mxnavDropdownPage);
			if (index !== null) pages.set(index, page);
		});
	return { panel, box, arrow, pages };
}

function getItemIndex(item: HTMLElement): number | null {
	return parseIndex(item.dataset.mxnavDropdownIndex);
}

/** 面板内当前激活页对应的索引 */
function getActivePageIndex(elements: PanelElements): number | null {
	for (const [index, page] of elements.pages) {
		if (page.classList.contains("is-active")) return index;
	}
	return null;
}

/**
 * 面板定位：箱体水平中心对准导航项中心，指针落在箱体中央；
 * 视口放不下时整体内收，指针沿箱沿滑动保持指向导航项。
 * 宽高切换到目标内容页（left/宽高均有过渡，产生滑动效果）。
 */
function positionPanel(
	elements: PanelElements,
	item: HTMLElement,
	page: HTMLElement,
): void {
	const navContainer = item.parentElement;
	if (!navContainer) return;
	const navRect = navContainer.getBoundingClientRect();
	const rect = item.getBoundingClientRect();
	const pageWidth = page.offsetWidth;
	const pageHeight = page.offsetHeight;
	const viewportWidth = document.documentElement.clientWidth;
	const center = rect.left + rect.width / 2;
	const left = clamp(
		center - pageWidth / 2,
		PANEL_EDGE_INSET,
		viewportWidth - pageWidth - PANEL_EDGE_INSET,
	);
	const anchorX = clamp(
		center - left,
		PANEL_EDGE_INSET,
		pageWidth - PANEL_EDGE_INSET,
	);

	elements.panel.style.left = `${left - navRect.left}px`;
	// 指针方块是 0.75rem 见方，用 rem 扣一半宽度，跟样式里的尺寸同一口径
	elements.arrow.style.left = `calc(${anchorX}px - 0.375rem)`;
	elements.box.style.width = `${pageWidth}px`;
	elements.box.style.height = `${pageHeight}px`;
}

function freezePanelTransitions(elements: PanelElements): void {
	elements.panel.style.transition = "none";
	elements.arrow.style.transition = "none";
	elements.box.style.transition = "none";
}

function unfreezePanelTransitions(elements: PanelElements): void {
	elements.panel.style.transition = "";
	elements.arrow.style.transition = "";
	elements.box.style.transition = "";
}

function syncTriggerStates(activeIndex: number | null): void {
	document
		.querySelectorAll<HTMLElement>("[data-mxnav-dropdown]")
		.forEach((container) => {
			const trigger = container.querySelector(
				"[data-mxnav-dropdown-trigger]",
			);
			const index = getItemIndex(container);
			const isActive = index !== null && index === activeIndex;
			container.classList.toggle("is-dropdown-open", isActive);
			trigger?.setAttribute("aria-expanded", String(isActive));
		});
}

function activatePage(
	elements: PanelElements,
	index: number,
): HTMLElement | null {
	const page = elements.pages.get(index);
	if (!page) return null;
	elements.pages.forEach((p) => {
		p.classList.toggle("is-active", p === page);
	});
	// 换页时旧的悬停药丸不该跟着淡进来
	clearMxnavDropdownHighlights(elements.panel);
	return page;
}

/**
 * 悬停 / 聚焦高亮：每页只有一个药丸，靠 translateY 在行之间滑动。
 * 页既是药丸的包含块也是内容项的偏移父级，offsetTop 可直接用。
 */
function highlightMxnavDropdownItem(
	page: HTMLElement,
	item: HTMLElement | null,
): void {
	const pill = page.querySelector<HTMLElement>(".mxnav-dropdown-highlight");
	if (!pill) return;
	if (!item) {
		page.classList.remove("is-hovered");
		return;
	}
	pill.style.setProperty("--mxnav-dropdown-hl-y", `${item.offsetTop}px`);
	pill.style.setProperty("--mxnav-dropdown-hl-h", `${item.offsetHeight}px`);
	page.classList.add("is-hovered");
}

function clearMxnavDropdownHighlights(root: ParentNode): void {
	root
		.querySelectorAll<HTMLElement>(".mxnav-dropdown-page.is-hovered")
		.forEach((page) => {
			page.classList.remove("is-hovered");
		});
}

/** 由事件目标（悬停或聚焦落点）推导药丸该贴住哪一行 */
function syncMxnavDropdownHighlightFrom(target: EventTarget | null): void {
	if (!(target instanceof Element)) return;
	const page = target.closest<HTMLElement>(".mxnav-dropdown-page");
	if (!page) return;
	const item = target.closest<HTMLElement>(".mxnav-dropdown-item");
	highlightMxnavDropdownItem(
		page,
		item?.closest(".mxnav-dropdown-page") === page ? item : null,
	);
}

function openForItem(item: HTMLElement, index: number): void {
	const elements = getPanelElements();
	if (!elements) return;
	const page = activatePage(elements, index);
	if (!page) return;

	const wasOpen = elements.panel.classList.contains("is-open");
	if (!wasOpen) {
		// 收起态下打开不做滑动过渡：面板直接就位后仅播放淡入，
		// 避免从上一次关闭时的旧位置滑过来
		freezePanelTransitions(elements);
		positionPanel(elements, item, page);
		void elements.panel.offsetWidth;
		unfreezePanelTransitions(elements);
		elements.panel.classList.add("is-open");
	} else {
		positionPanel(elements, item, page);
	}
	syncTriggerStates(index);
}

export function closeMxnavDropdownPanel(): void {
	pinnedIndex = null;
	const elements = getPanelElements();
	if (!elements) return;
	elements.panel.classList.remove("is-open");
	elements.pages.forEach((inactivePage) => {
		inactivePage.classList.remove("is-active");
	});
	clearMxnavDropdownHighlights(elements.panel);
	syncTriggerStates(null);
}

/**
 * 悬停驱动的面板同步：item 传 null 表示鼠标已离开导航行。
 * 钉住态（键盘打开）下悬停不抢占面板。
 */
export function syncMxnavDropdownOnHover(item: HTMLElement | null): void {
	if (pinnedIndex !== null) return;
	const elements = getPanelElements();
	if (!elements) return;
	if (!item) {
		closeMxnavDropdownPanel();
		return;
	}
	const index = getItemIndex(item);
	if (index === null || !elements.pages.has(index)) {
		closeMxnavDropdownPanel();
		return;
	}
	openForItem(item, index);
}

/** 键盘打开（钉住）：Enter / ArrowDown 在触发器上触发 */
export function openMxnavDropdownPinned(item: HTMLElement): void {
	const index = getItemIndex(item);
	if (index === null) return;
	pinnedIndex = index;
	openForItem(item, index);
}

export function isMxnavDropdownPinned(): boolean {
	return pinnedIndex !== null;
}

/** 窗口/布局尺寸变化后，让打开中的面板重新对齐当前导航项 */
export function repositionMxnavDropdown(): void {
	if (pinnedIndex !== null) return;
	const elements = getPanelElements();
	if (!elements?.panel.classList.contains("is-open")) return;
	const index = getActivePageIndex(elements);
	if (index === null) return;
	const item = document.querySelector<HTMLElement>(
		`[data-mxnav-dropdown-index="${index}"]`,
	);
	const page = elements.pages.get(index);
	if (item && page) positionPanel(elements, item, page);
}

function focusFirstPageItem(index: number): void {
	document
		.querySelector<HTMLElement>(
			`[data-mxnav-dropdown-page="${index}"] .mxnav-dropdown-item`,
		)
		?.focus();
}

function focusContainerTrigger(index: number): void {
	document
		.querySelector<HTMLElement>(
			`[data-mxnav-dropdown-index="${index}"] [data-mxnav-dropdown-trigger]`,
		)
		?.focus();
}

/**
 * 点击 / 键盘的文档级委托。面板在 Swup 容器之外且导航栏常驻，
 * 只需注册一次；pinnedIndex 由 mingxin-navbar.ts 在导航时统一复位。
 */
export function initMxnavDropdownDelegation(): void {
	if (delegationInitialized) return;
	delegationInitialized = true;

	document.addEventListener("keydown", (event: KeyboardEvent) => {
		if (!isMingxin()) return;
		const target = event.target as HTMLElement | null;
		const trigger = target?.closest?.(
			"[data-mxnav-dropdown-trigger]",
		) as HTMLElement | null;
		const pageItem = target?.closest?.(
			".mxnav-dropdown-item",
		) as HTMLElement | null;

		if (event.key === "Escape") {
			if (pinnedIndex === null) return;
			const index = pinnedIndex;
			closeMxnavDropdownPanel();
			focusContainerTrigger(index);
			return;
		}

		if (trigger) {
			const container = trigger.closest<HTMLElement>(
				"[data-mxnav-dropdown]",
			);
			const index = container ? getItemIndex(container) : null;
			if (index === null) return;

			if (event.key === "Enter" || event.key === " ") {
				event.preventDefault();
				if (pinnedIndex === index) {
					closeMxnavDropdownPanel();
				} else if (container) {
					openMxnavDropdownPinned(container);
				}
			} else if (event.key === "ArrowDown") {
				event.preventDefault();
				if (container) openMxnavDropdownPinned(container);
				focusFirstPageItem(index);
			}
			return;
		}

		if (pageItem) {
			const page = pageItem.closest<HTMLElement>(
				"[data-mxnav-dropdown-page]",
			);
			if (!page) return;
			const index = parseIndex(page.dataset.mxnavDropdownPage);
			if (index === null) return;
			const items = Array.from(
				page.querySelectorAll<HTMLElement>(".mxnav-dropdown-item"),
			);
			if (event.key === "ArrowDown") {
				event.preventDefault();
				const current = items.indexOf(pageItem);
				items[(current + 1) % items.length]?.focus();
			} else if (event.key === "ArrowUp") {
				event.preventDefault();
				const current = items.indexOf(pageItem);
				items[(current - 1 + items.length) % items.length]?.focus();
			}
		}
	});

	document.addEventListener("click", (event) => {
		if (!isMingxin()) return;
		const target = event.target as HTMLElement;
		if (target.closest(".mxnav-dropdown-item")) {
			closeMxnavDropdownPanel();
			(document.activeElement as HTMLElement | null)?.blur?.();
			return;
		}

		// 触发器区域（含导航行内的其他项）交给悬停逻辑，不在此收起
		if (
			!target.closest("[data-mxnav-dropdown]") &&
			!target.closest("[data-mxnav-dropdown-panel]")
		) {
			closeMxnavDropdownPanel();
		}
	});

	// 悬停 / 键盘聚焦驱动的高亮药丸：面板与导航栏同为常驻节点，注册一次
	const bindPanelHighlight = () => {
		const panel = document.querySelector<HTMLElement>(
			"[data-mxnav-dropdown-panel]",
		);
		if (!panel || panel.dataset.mxnavHighlightBound === "true") return;
		panel.dataset.mxnavHighlightBound = "true";
		panel.addEventListener("pointerover", (event) => {
			if (event.pointerType === "touch") return;
			syncMxnavDropdownHighlightFrom(event.target);
		});
		panel.addEventListener("focusin", (event) => {
			syncMxnavDropdownHighlightFrom(event.target);
		});
		panel.addEventListener("pointerleave", () => {
			clearMxnavDropdownHighlights(panel);
		});
	};
	bindPanelHighlight();
	window.addEventListener("pageshow", () => {
		bindPanelHighlight();
		closeMxnavDropdownPanel();
	});
}
