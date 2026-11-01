import { navbarMode } from "@/config";
import {
	BANNER_HEIGHT,
	BANNER_HEIGHT_HOME,
	BANNER_HEIGHT_NON_HOME,
} from "@/constants/constants";
import { isBannerMode, isFullscreenMode } from "@/utils/banner-utils";
import { updateSidebarStickySpacing } from "@/utils/grid-layout-utils";

const backToTopBtn = document.getElementById("back-to-top-btn");
const navbar = document.getElementById("navbar-wrapper");

// 动态导航栏：记录上一次滚动位置，用于判断滚动方向（下滑隐藏 / 上滑显示）
let lastScrollTop = 0;
// 动态导航栏方向锚点：只有越过锚点足够距离才翻转显隐，避免临界点附近小幅抖动反复横跳。
// 下滑需累计 8px 才藏（防误触），上滑 2px 即显（保持「一上滑就回来」的手感）
let dynamicAnchorTop = 0;
let dynamicHidden = false;

/** 优化的滚动处理函数（从 Layout.astro 迁出；visit:end 切页后也会调用） */
export function scrollFunction(): void {
	if (document.documentElement.classList.contains("is-page-transitioning")) {
		return;
	}

	const scrollTop = document.documentElement.scrollTop;
	// 滚动方向增量（dynamic 隐藏与三段收拢共用，在此统一计算）
	const delta = scrollTop - lastScrollTop;
	lastScrollTop = scrollTop;
	const bannerHeight = window.innerHeight * (BANNER_HEIGHT / 100);
	const navbarElement = document.getElementById("navbar");

	// 根据滚动位置动态更新侧边栏 sticky 间距
	updateSidebarStickySpacing();

	// 使用批量DOM操作优化性能
	const operations: (() => void)[] = [];

	if (backToTopBtn) {
		operations.push(() => {
			if (scrollTop > bannerHeight) {
				backToTopBtn.classList.remove("hide");
			} else {
				backToTopBtn.classList.add("hide");
			}
		});
	}

	if (navbarMode === "fixed" && navbar) {
		operations.push(() => {
			navbar.classList.remove("navbar-hidden");
		});
	} else if (navbarMode === "dynamic" && navbar) {
		// 动态：下滑隐藏 / 轻微上滑立即显示 / 滚回顶部(<80px)常显
		operations.push(() => {
			const isHome = document.body.classList.contains("is-home");
			// 壁纸/hero 边界：banner 首页 65vh、非首页 45vh；fullscreen 仅首页整屏（100lvh），非首页无 hero 为 0。
			// 越过该边界才启用「下滑隐藏 / 上滑显示」。overHero 不 gate isHome，故非首页 banner 也会跨壁纸保持
			const heroBoundary = isFullscreenMode()
				? isHome
					? window.innerHeight
					: 0
				: isBannerMode()
					? window.innerHeight *
						((isHome ? BANNER_HEIGHT_HOME : BANNER_HEIGHT_NON_HOME) / 100)
					: 0;
			const overHero = scrollTop < heroBoundary;
			const isSegmentStyle =
				document.documentElement.getAttribute("data-navbar-style") ===
				"segment";
			if (overHero || scrollTop <= 80 || isSegmentStyle) {
				dynamicHidden = false;
				dynamicAnchorTop = scrollTop;
			} else if (
				!dynamicHidden &&
				scrollTop - dynamicAnchorTop >= 8 &&
				scrollTop > 150
			) {
				dynamicHidden = true;
				dynamicAnchorTop = scrollTop;
			} else if (dynamicHidden && dynamicAnchorTop - scrollTop >= 2) {
				dynamicHidden = false;
				dynamicAnchorTop = scrollTop;
			} else if (!dynamicHidden) {
				// 保持显示时锚点跟随最低点，上滑判定不被历史高位干扰
				dynamicAnchorTop = Math.min(dynamicAnchorTop, scrollTop);
			} else {
				// 保持隐藏时锚点跟随最高点，下滑途中回拉 2px 即触发显示
				dynamicAnchorTop = Math.max(dynamicAnchorTop, scrollTop);
			}
			navbar.classList.toggle("navbar-hidden", dynamicHidden);
			document.body.classList.toggle(
				"dynamic-navbar-hidden",
				navbar.classList.contains("navbar-hidden"),
			);
		});
	} else if (navbar && (isBannerMode() || isFullscreenMode())) {
		// static + banner / fullscreen：跨壁纸保持，滚到内容区才释放
		operations.push(() => {
			const isHome = document.body.classList.contains("is-home");
			// fullscreen 首页内容在 100lvh（视图顶）；banner 按横幅高度阈值
			const threshold = isFullscreenMode()
				? window.innerHeight - 88
				: window.innerHeight *
						((isHome ? BANNER_HEIGHT_HOME : BANNER_HEIGHT_NON_HOME) / 100) -
					88;

			if (scrollTop >= threshold) {
				navbar.classList.add("navbar-hidden");
			} else {
				navbar.classList.remove("navbar-hidden");
			}
		});
	}

	if (navbarElement) {
		operations.push(() => {
			if (scrollTop > 8) {
				navbarElement.classList.add("navbar-sticky-shadow");
			} else {
				navbarElement.classList.remove("navbar-sticky-shadow");
			}
		});
	}

	// 批量执行DOM操作
	// 三段胶囊收拢：下滑且超过 80px 时 #navbar 挂 navbar-collapsed（左右段收成圆），上滑/回顶恢复
	if (navbarElement) {
		operations.push(() => {
			const isSegmentStyle =
				document.documentElement.getAttribute("data-navbar-style") ===
				"segment";
			navbarElement.classList.toggle(
				"navbar-collapsed",
				isSegmentStyle && scrollTop > 80 && delta > 0,
			);
		});
	}

	if (operations.length > 0) {
		requestAnimationFrame(() => {
			operations.forEach((op) => {
				op();
			});
		});
	}
}

let scrollTimeout: number;

/** 注册滚动 / 窗口尺寸监听并初始化滚动状态（从 Layout.astro 迁出） */
export function initScroll(): void {
	// 使用优化的滚动性能处理
	window.addEventListener(
		"scroll",
		() => {
			if (scrollTimeout) {
				cancelAnimationFrame(scrollTimeout);
			}
			scrollTimeout = requestAnimationFrame(scrollFunction);
		},
		{ passive: true },
	);

	// 初始化滚动状态（例如从历史位置恢复时）
	scrollFunction();
}
