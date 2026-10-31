import {
	DARK_MODE,
	DEFAULT_THEME,
	LIGHT_MODE,
	SYSTEM_MODE,
	WALLPAPER_BANNER,
	WALLPAPER_FULLSCREEN,
	WALLPAPER_NONE,
	WALLPAPER_OVERLAY,
} from "@constants/constants";
import type {
	FullscreenWallpaperLayout,
	LIGHT_DARK_MODE,
	NavbarStyle,
	SiteMode,
	WALLPAPER_MODE,
} from "@/types/config";
import {
	backgroundWallpaper,
	displaySettingsConfig,
	expressiveCodeConfig,
	bubblesConfig,
	clickConfig,
	fireflyConfig,
	heartsConfig,
	leavesConfig,
	meteorConfig,
	notesConfig,
	rainConfig,
	sakuraConfig,
	siteConfig,
	snowConfig,
	starfieldConfig,
} from "../config";
import { isHomePage as checkIsHomePage } from "./layout-utils";
import { featuresConfig } from "@/config/featuresConfig";

// Declare global functions
declare global {
	interface Window {
		initSemifullScrollDetection?: () => void;
		semifullScrollHandler?: () => void;
	}
}

export function getDefaultHue(): number {
	const fallback = "250";
	// 检查是否在浏览器环境中
	if (typeof document === "undefined") {
		return Number.parseInt(fallback, 10);
	}
	const configCarrier = document.getElementById("config-carrier");
	return Number.parseInt(configCarrier?.dataset.hue || fallback, 10);
}

export function getDefaultTheme(): LIGHT_DARK_MODE {
	// 如果配置文件中设置了 defaultMode，使用配置的值
	// 否则使用 DEFAULT_THEME（向后兼容）
	return siteConfig.themeColor.defaultMode ?? DEFAULT_THEME;
}

// 获取系统主题
export function getSystemTheme(): LIGHT_DARK_MODE {
	if (typeof window === "undefined") {
		return LIGHT_MODE;
	}
	return window.matchMedia("(prefers-color-scheme: dark)").matches
		? DARK_MODE
		: LIGHT_MODE;
}

// 解析主题（如果是system模式，则获取系统主题）
export function resolveTheme(theme: LIGHT_DARK_MODE): LIGHT_DARK_MODE {
	if (theme === SYSTEM_MODE) {
		return getSystemTheme();
	}
	return theme;
}

export function getHue(): number {
	// 先检查全局对象
	if (typeof window === "undefined" || !window.localStorage) {
		return getDefaultHue();
	}
	const stored = localStorage.getItem("hue");
	return stored ? Number.parseInt(stored, 10) : getDefaultHue();
}

export function setHue(hue: number): void {
	// 先检查是否在浏览器环境
	if (
		typeof window === "undefined" ||
		!window.localStorage ||
		typeof document === "undefined"
	) {
		return;
	}
	localStorage.setItem("hue", String(hue));
	const r = document.querySelector(":root") as HTMLElement;
	if (!r) {
		return;
	}
	r.style.setProperty("--hue", String(hue));
}

export function applyThemeToDocument(theme: LIGHT_DARK_MODE): void {
	// 检查是否在浏览器环境中
	if (typeof document === "undefined") {
		return;
	}

	// 解析主题
	const resolvedTheme = resolveTheme(theme);

	// 获取当前主题状态的完整信息
	const currentIsDark = document.documentElement.classList.contains("dark");
	const currentTheme = document.documentElement.getAttribute("data-theme");

	// 计算目标主题状态
	let targetIsDark = false; // 初始化默认值
	switch (resolvedTheme) {
		case LIGHT_MODE:
			targetIsDark = false;
			break;
		case DARK_MODE:
			targetIsDark = true;
			break;
		default:
			// 处理默认情况，使用当前主题状态
			targetIsDark = currentIsDark;
			break;
	}

	// 检测是否真的需要主题切换：
	// 1. dark类状态是否改变
	// 2. expressiveCode主题是否需要更新
	const needsThemeChange = currentIsDark !== targetIsDark;
	const expectedTheme = targetIsDark
		? expressiveCodeConfig.darkTheme
		: expressiveCodeConfig.lightTheme;
	const needsCodeThemeUpdate = currentTheme !== expectedTheme;

	// 如果既不需要主题切换也不需要代码主题更新，直接返回
	if (!needsThemeChange && !needsCodeThemeUpdate) {
		return;
	}

	// 批量 DOM 操作，减少重绘
	if (needsThemeChange) {
		// 添加过渡保护类（但会导致大量重绘，所以使用更轻量的方式）
		// document.documentElement.classList.add("is-theme-transitioning");

		// 直接切换主题，利用 CSS 变量的特性让浏览器优化过渡
		if (targetIsDark) {
			document.documentElement.classList.add("dark");
		} else {
			document.documentElement.classList.remove("dark");
		}
	}

	// Set the theme for Expressive Code based on current mode
	if (needsCodeThemeUpdate) {
		document.documentElement.setAttribute("data-theme", expectedTheme);
	}
}

// 系统主题监听器引用
let systemThemeListener:
	| ((e: MediaQueryListEvent | MediaQueryList) => void)
	| null = null;

export function setTheme(theme: LIGHT_DARK_MODE): void {
	// 检查是否在浏览器环境中
	if (
		typeof localStorage === "undefined" ||
		typeof localStorage.setItem !== "function"
	) {
		return;
	}

	// 先应用主题
	applyThemeToDocument(theme);

	// 保存到localStorage
	localStorage.setItem("theme", theme);

	// 如果切换到 system 模式，需要监听系统主题变化
	if (theme === SYSTEM_MODE) {
		setupSystemThemeListener();
	} else {
		// 如果切换其他模式，移除系统主题监听
		cleanupSystemThemeListener();
	}
}

// 设置系统主题监听器
export function setupSystemThemeListener(): void {
	// 先清理之前的监听器
	cleanupSystemThemeListener();

	if (typeof window === "undefined") {
		return;
	}

	const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

	// 处理系统主题变化的回调
	const handleSystemThemeChange = (e: MediaQueryListEvent | MediaQueryList) => {
		const isDark = e.matches;
		const currentIsDark = document.documentElement.classList.contains("dark");

		// 如果主题状态没有变化，直接返回
		if (currentIsDark === isDark) {
			return;
		}

		// 直接应用系统主题，不使用过渡保护类以避免大量重绘
		if (isDark) {
			document.documentElement.classList.add("dark");
		} else {
			document.documentElement.classList.remove("dark");
		}

		// Set the theme for Expressive Code
		const expressiveTheme = isDark
			? expressiveCodeConfig.darkTheme
			: expressiveCodeConfig.lightTheme;
		document.documentElement.setAttribute("data-theme", expressiveTheme);

		// 触发自定义事件通知其他组件（仅在真正切换时触发）
		window.dispatchEvent(new CustomEvent("theme-change"));
	};

	// 立即调用一次以设置初始状态
	handleSystemThemeChange(mediaQuery);

	// 监听系统主题变化（现代浏览器）
	if (mediaQuery.addEventListener) {
		mediaQuery.addEventListener("change", handleSystemThemeChange);
	} else {
		// 兼容旧浏览器
		mediaQuery.addListener(handleSystemThemeChange);
	}

	systemThemeListener = handleSystemThemeChange;
}

// 清理系统主题监听器
function cleanupSystemThemeListener() {
	if (typeof window === "undefined" || !systemThemeListener) {
		return;
	}

	const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

	if (mediaQuery.removeEventListener) {
		mediaQuery.removeEventListener("change", systemThemeListener);
	} else {
		// 兼容旧浏览器
		mediaQuery.removeListener(systemThemeListener);
	}

	systemThemeListener = null;
}

export function getStoredTheme(): LIGHT_DARK_MODE {
	// 检查是否在浏览器环境中
	if (
		typeof localStorage === "undefined" ||
		typeof localStorage.getItem !== "function"
	) {
		return getDefaultTheme();
	}
	return (
		(localStorage.getItem("theme") as LIGHT_DARK_MODE) || getDefaultTheme()
	);
}

// 初始化主题监听器（用于页面加载后）
export function initThemeListener(): void {
	if (
		typeof localStorage === "undefined" ||
		typeof localStorage.getItem !== "function"
	) {
		return;
	}

	const theme = getStoredTheme();

	// 如果主题是 system 模式，需要监听系统主题变化
	if (theme === SYSTEM_MODE) {
		setupSystemThemeListener();
	}
}

// Wallpaper mode functions

/**
 * 同步首页标题显示（hidden 类）：首页 + banner/fullscreen 模式显示标题，其余情况隐藏。
 * SSR 按 config 默认模式渲染 hidden（默认 overlay/none 时带 hidden），而模式可运行时切换、
 * 页面也会经 Swup 切换（body.is-home 变化），因此需要按当前 mode + 是否首页重新计算。
 * 标题开关（user-hidden 类）独立控制，不受影响。
 */
export function syncBannerHomeTextVisibility(): void {
	const overlay = document.querySelector(
		".banner-home-text-overlay",
	) as HTMLElement | null;
	if (!overlay) return;
	const mode = document.documentElement.getAttribute("data-wallpaper-mode");
	const isHome = checkIsHomePage(window.location.pathname);
	const show =
		isHome && (mode === WALLPAPER_BANNER || mode === WALLPAPER_FULLSCREEN);
	overlay.classList.toggle("hidden", !show);
}

export function getDefaultFullscreenLayout(): FullscreenWallpaperLayout {
	return backgroundWallpaper.fullscreen?.layout ?? "classic";
}

export function getStoredFullscreenLayout(): FullscreenWallpaperLayout {
	const defaultLayout = getDefaultFullscreenLayout();
	if (
		typeof localStorage === "undefined" ||
		typeof localStorage.getItem !== "function"
	) {
		return defaultLayout;
	}
	const isSwitchable = displaySettingsConfig.fullscreenLayoutSwitchable;
	if (!isSwitchable) {
		localStorage.removeItem("fullscreenLayout");
		return defaultLayout;
	}
	const stored = localStorage.getItem("fullscreenLayout");
	return stored === "hero" || stored === "classic" ? stored : defaultLayout;
}

export function applyFullscreenLayoutToDocument(
	layout: FullscreenWallpaperLayout,
	animate = true,
): void {
	if (typeof document === "undefined") return;

	const safeLayout: FullscreenWallpaperLayout =
		layout === "hero" ? "hero" : "classic";
	const html = document.documentElement;
	if (animate) {
		html.classList.add("is-fullscreen-layout-transitioning");
		window.setTimeout(() => {
			html.classList.remove("is-fullscreen-layout-transitioning");
		}, 520);
	}
	html.setAttribute("data-fullscreen-layout", safeLayout);

	const mode = html.getAttribute("data-wallpaper-mode");
	const transparent =
		mode === WALLPAPER_OVERLAY ||
		(mode === WALLPAPER_FULLSCREEN && safeLayout === "hero");
	document.body?.classList.toggle("wallpaper-transparent", transparent);
	window.dispatchEvent(
		new CustomEvent("fullscreenLayoutChange", {
			detail: { layout: safeLayout },
		}),
	);
}

export function setFullscreenLayout(layout: FullscreenWallpaperLayout): void {
	const safeLayout: FullscreenWallpaperLayout =
		layout === "hero" ? "hero" : "classic";
	if (
		typeof localStorage !== "undefined" &&
		typeof localStorage.setItem === "function"
	) {
		localStorage.setItem("fullscreenLayout", safeLayout);
	}
	applyFullscreenLayoutToDocument(safeLayout);
}

const NAVBAR_STYLES: NavbarStyle[] = ["classic", "float", "capsule", "segment"];

export function getDefaultNavbarStyle(): NavbarStyle {
	const v = siteConfig.navbar.navbarStyle ?? "classic";
	return NAVBAR_STYLES.includes(v) ? v : "classic";
}

export function getStoredNavbarStyle(): NavbarStyle {
	const defaultStyle = getDefaultNavbarStyle();
	if (
		typeof localStorage === "undefined" ||
		typeof localStorage.getItem !== "function"
	) {
		return defaultStyle;
	}
	if (!displaySettingsConfig.navbarStyleSwitchable) {
		localStorage.removeItem("navbarStyle");
		return defaultStyle;
	}
	const stored = localStorage.getItem("navbarStyle") as NavbarStyle | null;
	return stored && NAVBAR_STYLES.includes(stored) ? stored : defaultStyle;
}

export function applyNavbarStyleToDocument(style: NavbarStyle): void {
	if (typeof document === "undefined") return;
	const safe: NavbarStyle = NAVBAR_STYLES.includes(style) ? style : "classic";
	document.documentElement.setAttribute("data-navbar-style", safe);
	window.dispatchEvent(
		new CustomEvent("navbarStyleChange", { detail: { style: safe } }),
	);
}

export function setNavbarStyle(style: NavbarStyle): void {
	const safe: NavbarStyle = NAVBAR_STYLES.includes(style) ? style : "classic";
	if (
		typeof localStorage !== "undefined" &&
		typeof localStorage.setItem === "function"
	) {
		localStorage.setItem("navbarStyle", safe);
	}
	applyNavbarStyleToDocument(safe);
}

const SITE_MODES: SiteMode[] = ["full", "pure", "harmony", "brick", "astral"];

// ─── 形态切换全局淡变 ─────────────────────────────────────────
// 切换站点形态 / 璨夜子主题时，先给 html 挂 .mode-fade 再改属性：
// transition.css 里 .mode-fade 只过渡颜色类属性（背景/文字/边框/填充），
// 1s 后摘除，避免常驻 transition 拖慢日常交互。不给 * 挂过渡，只点名高频表面元素。
// prefers-reduced-motion 时直接不挂（CSS 侧另有兜底关停）。
let modeFadeTimer: number | undefined;

export function beginModeFade(): void {
	if (typeof document === "undefined" || typeof window === "undefined") return;
	if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
	const root = document.documentElement;
	root.classList.add("mode-fade");
	// 强制回流，确保过渡在随后的属性变更上生效
	void root.offsetWidth;
	if (modeFadeTimer !== undefined) window.clearTimeout(modeFadeTimer);
	modeFadeTimer = window.setTimeout(() => {
		root.classList.remove("mode-fade");
		modeFadeTimer = undefined;
	}, 1100);
}

export function getDefaultSiteMode(): SiteMode {
	const v = siteConfig.siteMode ?? "full";
	return SITE_MODES.includes(v) ? v : "full";
}

export function getStoredSiteMode(): SiteMode {
	const defaultMode = getDefaultSiteMode();
	if (
		typeof localStorage === "undefined" ||
		typeof localStorage.getItem !== "function"
	) {
		return defaultMode;
	}
	if (!displaySettingsConfig.siteModeSwitchable) {
		localStorage.removeItem("siteMode");
		return defaultMode;
	}
	const stored = localStorage.getItem("siteMode") as SiteMode | null;
	return stored && SITE_MODES.includes(stored) ? stored : defaultMode;
}

export function applySiteModeToDocument(mode: SiteMode): void {
	if (typeof document === "undefined") return;
	const safe: SiteMode = SITE_MODES.includes(mode) ? mode : "full";
	beginModeFade();
	document.documentElement.setAttribute("data-site-mode", safe);
	window.dispatchEvent(
		new CustomEvent("siteModeChange", { detail: { mode: safe } }),
	);
}

export function setSiteMode(mode: SiteMode): void {
	const safe: SiteMode = SITE_MODES.includes(mode) ? mode : "full";
	if (
		typeof localStorage !== "undefined" &&
		typeof localStorage.setItem === "function"
	) {
		localStorage.setItem("siteMode", safe);
	}
	applySiteModeToDocument(safe);
}

// ─── 璨夜子主题（实面 / 星尘） ─────────────────────────────────────
// 只在站点形态 = 璨夜（astral）时生效：solid 实面 = 近不透明实面卡（稳定兜底）；
// starfield 星尘 = 按 XinghuisamaBlogs 排版布局的玻璃版（面纱层 + 半透卡片配方）。
// 控制台主题页定全站默认（siteConfig.astralTheme），访客在调色板外观页签、
// 站点形态下方覆盖，存 localStorage astralTheme；Layout 首帧脚本同步落位防闪烁，
// 样式全部收在 astral-mode.css 的 [data-astral-theme] 作用域里。

export type AstralTheme = "solid" | "starfield";

const ASTRAL_THEMES: AstralTheme[] = ["solid", "starfield"];

export function getDefaultAstralTheme(): AstralTheme {
	const v = siteConfig.astralTheme ?? "solid";
	return ASTRAL_THEMES.includes(v as AstralTheme)
		? (v as AstralTheme)
		: "solid";
}

export function getStoredAstralTheme(): AstralTheme {
	const defaultTheme = getDefaultAstralTheme();
	if (
		typeof localStorage === "undefined" ||
		typeof localStorage.getItem !== "function"
	) {
		return defaultTheme;
	}
	const stored = localStorage.getItem("astralTheme") as AstralTheme | null;
	return stored && ASTRAL_THEMES.includes(stored) ? stored : defaultTheme;
}

export function applyAstralThemeToDocument(theme: AstralTheme): void {
	if (typeof document === "undefined") return;
	const safe: AstralTheme = ASTRAL_THEMES.includes(theme) ? theme : "solid";
	beginModeFade();
	document.documentElement.setAttribute("data-astral-theme", safe);
	window.dispatchEvent(
		new CustomEvent("astralThemeChange", { detail: { theme: safe } }),
	);
}

export function setAstralTheme(theme: AstralTheme): void {
	const safe: AstralTheme = ASTRAL_THEMES.includes(theme) ? theme : "solid";
	if (
		typeof localStorage !== "undefined" &&
		typeof localStorage.setItem === "function"
	) {
		localStorage.setItem("astralTheme", safe);
	}
	applyAstralThemeToDocument(safe);
}

// ─── 璨夜主题布局（璨夜 bento / 经典） ─────────────────────────────────
// 只在站点形态 = 璨夜（astral）时生效：bento = 现行首页瓷砖矩阵（默认）；
// classic 经典 = Firefly 经典骨架（横幅 + 侧栏 + 文章流），只保留璨夜皮肤。
// 控制台主题页定全站默认（siteConfig.astralLayout），访客在调色板外观页签、
// 璨夜主题下方覆盖，存 localStorage astralLayout；Layout 首帧脚本同步落位防闪烁，
// 骨架样式全部收在 astral-mode.css 的 [data-astral-layout="bento"] 作用域里。

export type AstralLayout = "bento" | "classic";

const ASTRAL_LAYOUTS: AstralLayout[] = ["bento", "classic"];

export function getDefaultAstralLayout(): AstralLayout {
	const v = siteConfig.astralLayout ?? "bento";
	return ASTRAL_LAYOUTS.includes(v as AstralLayout)
		? (v as AstralLayout)
		: "bento";
}

export function getStoredAstralLayout(): AstralLayout {
	const defaultLayout = getDefaultAstralLayout();
	if (
		typeof localStorage === "undefined" ||
		typeof localStorage.getItem !== "function"
	) {
		return defaultLayout;
	}
	const stored = localStorage.getItem("astralLayout") as AstralLayout | null;
	return stored && ASTRAL_LAYOUTS.includes(stored) ? stored : defaultLayout;
}

export function applyAstralLayoutToDocument(layout: AstralLayout): void {
	if (typeof document === "undefined") return;
	const safe: AstralLayout = ASTRAL_LAYOUTS.includes(layout) ? layout : "bento";
	beginModeFade();
	document.documentElement.setAttribute("data-astral-layout", safe);
	window.dispatchEvent(
		new CustomEvent("astralLayoutChange", { detail: { layout: safe } }),
	);
}

export function setAstralLayout(layout: AstralLayout): void {
	const safe: AstralLayout = ASTRAL_LAYOUTS.includes(layout) ? layout : "bento";
	if (
		typeof localStorage !== "undefined" &&
		typeof localStorage.setItem === "function"
	) {
		localStorage.setItem("astralLayout", safe);
	}
	applyAstralLayoutToDocument(safe);
}

// ─── 谐彩专属调色板 ──────────────────────────────────────
// 只在站点形态 = 谐彩（harmony）时生效的一组外观选项（对标 Shirone 的动态取色
// 面板）：独立 harmony* 存储键，与全站 hue、素简 pureFont 等键互不干扰。
// Layout 首帧脚本同步落位（防闪烁），这里是运行时读写入口；样式全部收在
// harmony-mode.css 的 html[data-site-mode="harmony"] 作用域里，切回华彩 / 素简
// 时这些存储值不产生任何效果。机制为静态 CSS 变量组（不引 HCT 算法库）：
// scheme/spec 只改一组阶梯参数变量，色值由 CSS 公式以 --harmony-hue 为种子推导。

export type HarmonyScheme =
	| "tonalSpot"
	| "vibrant"
	| "expressive"
	| "fidelity"
	| "content"
	| "neutral"
	| "monochrome"
	| "rainbow"
	| "fruitSalad";

export const HARMONY_SCHEMES: HarmonyScheme[] = [
	"tonalSpot",
	"vibrant",
	"expressive",
	"fidelity",
	"content",
	"neutral",
	"monochrome",
	"rainbow",
	"fruitSalad",
];

export type HarmonySpec = "2021" | "2025";
export const HARMONY_SPECS: HarmonySpec[] = ["2021", "2025"];

export type HarmonyTexture =
	| "none"
	| "starlight"
	| "cyber-dots"
	| "topography"
	| "geometric"
	| "sakura";

export const HARMONY_TEXTURES: HarmonyTexture[] = [
	"none",
	"starlight",
	"cyber-dots",
	"topography",
	"geometric",
	"sakura",
];

export const DEFAULT_HARMONY_SCHEME: HarmonyScheme = "tonalSpot";
export const DEFAULT_HARMONY_SPEC: HarmonySpec = "2025";
export const DEFAULT_HARMONY_TEXTURE: HarmonyTexture = "starlight";
export const DEFAULT_HARMONY_TEXTURE_OPACITY = 0.12;

function harmonyStorageGet(key: string): string | null {
	if (
		typeof localStorage === "undefined" ||
		typeof localStorage.getItem !== "function"
	) {
		return null;
	}
	return localStorage.getItem(key);
}

function harmonyStorageSet(key: string, value: string | null): void {
	if (
		typeof localStorage === "undefined" ||
		typeof localStorage.setItem !== "function"
	) {
		return;
	}
	if (value === null) {
		localStorage.removeItem(key);
	} else {
		localStorage.setItem(key, value);
	}
}

// 色相：null = 未单独设置，谐彩种子跟随全站 --hue（CSS 里 --harmony-hue 默认即 var(--hue)）
export function getStoredHarmonyHue(): number | null {
	const raw = harmonyStorageGet("harmonyHue");
	if (raw === null) return null;
	const parsed = Number.parseFloat(raw);
	if (Number.isNaN(parsed)) return null;
	return clampNumber(Math.round(parsed), 0, 360);
}

export function applyHarmonyHueToDocument(hue: number | null): void {
	if (typeof document === "undefined") return;
	if (hue === null) {
		document.documentElement.style.removeProperty("--harmony-hue");
	} else {
		document.documentElement.style.setProperty("--harmony-hue", String(hue));
	}
}

export function setHarmonyHue(hue: number | null): void {
	const safe =
		hue === null ? null : clampNumber(Math.round(hue), 0, 360);
	harmonyStorageSet("harmonyHue", safe === null ? null : String(safe));
	applyHarmonyHueToDocument(safe);
}

export function getStoredHarmonyScheme(): HarmonyScheme {
	const stored = harmonyStorageGet("harmonyScheme") as HarmonyScheme | null;
	return stored && HARMONY_SCHEMES.includes(stored)
		? stored
		: DEFAULT_HARMONY_SCHEME;
}

export function applyHarmonySchemeToDocument(scheme: HarmonyScheme): void {
	if (typeof document === "undefined") return;
	document.documentElement.setAttribute("data-harmony-scheme", scheme);
}

export function setHarmonyScheme(scheme: HarmonyScheme): void {
	const safe = HARMONY_SCHEMES.includes(scheme)
		? scheme
		: DEFAULT_HARMONY_SCHEME;
	harmonyStorageSet("harmonyScheme", safe);
	applyHarmonySchemeToDocument(safe);
}

export function getStoredHarmonySpec(): HarmonySpec {
	const stored = harmonyStorageGet("harmonySpec") as HarmonySpec | null;
	return stored && HARMONY_SPECS.includes(stored)
		? stored
		: DEFAULT_HARMONY_SPEC;
}

export function applyHarmonySpecToDocument(spec: HarmonySpec): void {
	if (typeof document === "undefined") return;
	document.documentElement.setAttribute("data-harmony-spec", spec);
}

export function setHarmonySpec(spec: HarmonySpec): void {
	const safe = HARMONY_SPECS.includes(spec) ? spec : DEFAULT_HARMONY_SPEC;
	harmonyStorageSet("harmonySpec", safe);
	applyHarmonySpecToDocument(safe);
}

export function getStoredHarmonyTexture(): HarmonyTexture {
	const stored = harmonyStorageGet("harmonyTexture") as HarmonyTexture | null;
	return stored && HARMONY_TEXTURES.includes(stored)
		? stored
		: DEFAULT_HARMONY_TEXTURE;
}

export function applyHarmonyTextureToDocument(texture: HarmonyTexture): void {
	if (typeof document === "undefined") return;
	document.documentElement.setAttribute("data-harmony-texture", texture);
}

export function setHarmonyTexture(texture: HarmonyTexture): void {
	const safe = HARMONY_TEXTURES.includes(texture)
		? texture
		: DEFAULT_HARMONY_TEXTURE;
	harmonyStorageSet("harmonyTexture", safe);
	applyHarmonyTextureToDocument(safe);
}

export function getStoredHarmonyTextureOpacity(): number {
	const raw = harmonyStorageGet("harmonyTextureOpacity");
	if (raw === null) return DEFAULT_HARMONY_TEXTURE_OPACITY;
	const parsed = Number.parseFloat(raw);
	if (Number.isNaN(parsed)) return DEFAULT_HARMONY_TEXTURE_OPACITY;
	return clampNumber(parsed, 0, 1);
}

export function applyHarmonyTextureOpacityToDocument(opacity: number): void {
	if (typeof document === "undefined") return;
	document.documentElement.style.setProperty(
		"--harmony-texture-opacity",
		String(clampNumber(opacity, 0, 1)),
	);
}

export function setHarmonyTextureOpacity(opacity: number): void {
	const safe = clampNumber(opacity, 0, 1);
	harmonyStorageSet("harmonyTextureOpacity", String(safe));
	applyHarmonyTextureOpacityToDocument(safe);
}

// 减少动态：true 时 html 上挂 data-harmony-motion="reduced"
export function getStoredHarmonyMotionReduced(): boolean {
	return harmonyStorageGet("harmonyMotion") === "reduced";
}

export function applyHarmonyMotionToDocument(reduced: boolean): void {
	if (typeof document === "undefined") return;
	if (reduced) {
		document.documentElement.setAttribute("data-harmony-motion", "reduced");
	} else {
		document.documentElement.removeAttribute("data-harmony-motion");
	}
}

export function setHarmonyMotionReduced(reduced: boolean): void {
	harmonyStorageSet("harmonyMotion", reduced ? "reduced" : "full");
	applyHarmonyMotionToDocument(reduced);
}

// Overlay 三项：默认沿用全站 overlay 配置默认值（getDefaultOverlay*），
// 但存独立键、只经 --harmony-* 变量在谐彩作用域内生效，不动全站 overlay 设置。
export function getStoredHarmonyOverlayOpacity(): number {
	const raw = harmonyStorageGet("harmonyOverlayOpacity");
	if (raw === null) return getDefaultOverlayOpacity();
	const parsed = Number.parseFloat(raw);
	return Number.isNaN(parsed)
		? getDefaultOverlayOpacity()
		: clampNumber(parsed, 0, 1);
}

export function applyHarmonyOverlayOpacityToDocument(opacity: number): void {
	if (typeof document === "undefined") return;
	document.documentElement.style.setProperty(
		"--harmony-overlay-opacity",
		String(clampNumber(opacity, 0, 1)),
	);
}

export function setHarmonyOverlayOpacity(opacity: number): void {
	const safe = clampNumber(opacity, 0, 1);
	harmonyStorageSet("harmonyOverlayOpacity", String(safe));
	applyHarmonyOverlayOpacityToDocument(safe);
}

export function getStoredHarmonyOverlayBlur(): number {
	const raw = harmonyStorageGet("harmonyOverlayBlur");
	if (raw === null) return getDefaultOverlayBlur();
	const parsed = Number.parseFloat(raw);
	return Number.isNaN(parsed)
		? getDefaultOverlayBlur()
		: clampNumber(parsed, 0, 20);
}

export function applyHarmonyOverlayBlurToDocument(blur: number): void {
	if (typeof document === "undefined") return;
	document.documentElement.style.setProperty(
		"--harmony-overlay-blur",
		`${clampNumber(blur, 0, 20)}px`,
	);
}

export function setHarmonyOverlayBlur(blur: number): void {
	const safe = clampNumber(blur, 0, 20);
	harmonyStorageSet("harmonyOverlayBlur", String(safe));
	applyHarmonyOverlayBlurToDocument(safe);
}

export function getStoredHarmonyOverlayCardOpacity(): number {
	const raw = harmonyStorageGet("harmonyOverlayCardOpacity");
	if (raw === null) return getDefaultOverlayCardOpacity();
	const parsed = Number.parseFloat(raw);
	return Number.isNaN(parsed)
		? getDefaultOverlayCardOpacity()
		: clampNumber(parsed, 0, 1);
}

export function applyHarmonyOverlayCardOpacityToDocument(
	cardOpacity: number,
): void {
	if (typeof document === "undefined") return;
	document.documentElement.style.setProperty(
		"--harmony-card-opacity",
		String(clampNumber(cardOpacity, 0, 1)),
	);
}

export function setHarmonyOverlayCardOpacity(cardOpacity: number): void {
	const safe = clampNumber(cardOpacity, 0, 1);
	harmonyStorageSet("harmonyOverlayCardOpacity", String(safe));
	applyHarmonyOverlayCardOpacityToDocument(safe);
}

// ─── 素简字体 ─────────────────────────────────────────────
// 调色板在素简下提供的阅读字体切换；只存选择，字体栈由 pure-mode.css 按 data-pure-font 选。
// 候选全集 = 字体库全部字体 + 系统默认；实际展示哪几款、什么顺序由 siteConfig.pureFontMenu 定
// （控制台字体页可管），菜单第一项即默认字体
export type PureFont =
	| "system"
	| "maru"
	| "mplus"
	| "luoli"
	| "lxgw"
	| "zhuque"
	| "inter"
	| "jetbrains"
	| "notoserif"
	| "greatvibes"
	| "xiaomaiti";
const PURE_FONTS: PureFont[] = [
	"system",
	"maru",
	"mplus",
	"luoli",
	"lxgw",
	"zhuque",
	"inter",
	"jetbrains",
	"notoserif",
	"greatvibes",
	"xiaomaiti",
];

export const PURE_FONT_LABELS: Record<PureFont, string> = {
	system: "",
	maru: "Zen Maru Gothic 圆体",
	mplus: "M PLUS Rounded 日本圆体",
	luoli: "中文圆体",
	lxgw: "LXGW WenKai 霞鹜文楷",
	zhuque: "Zhuque Fangsong 朱雀仿宋",
	inter: "Inter 英文无衬线",
	jetbrains: "JetBrains Mono 等宽",
	notoserif: "Noto Serif SC 思源宋体",
	greatvibes: "Great Vibes 手写花体",
	xiaomaiti: "汉仪小麦体",
};

const DEFAULT_PURE_FONT_MENU: PureFont[] = [
	"system",
	"maru",
	"mplus",
	"luoli",
	"lxgw",
	"zhuque",
];

export function getPureFontMenu(): PureFont[] {
	const raw = siteConfig.pureFontMenu;
	if (!Array.isArray(raw)) return [...DEFAULT_PURE_FONT_MENU];
	const menu = raw.filter(
		(k, i) => PURE_FONTS.includes(k as PureFont) && raw.indexOf(k) === i,
	) as PureFont[];
	return menu.length > 0 ? menu : [...DEFAULT_PURE_FONT_MENU];
}

export function getDefaultPureFont(): PureFont {
	return getPureFontMenu()[0];
}

export function getStoredPureFont(): PureFont {
	const menu = getPureFontMenu();
	if (
		typeof localStorage === "undefined" ||
		typeof localStorage.getItem !== "function"
	) {
		return menu[0];
	}
	const stored = localStorage.getItem("pureFont") as PureFont | null;
	return stored && menu.includes(stored) ? stored : menu[0];
}

export function applyPureFontToDocument(font: PureFont): void {
	if (typeof document === "undefined") {
		return;
	}
	const safe: PureFont = PURE_FONTS.includes(font) ? font : "system";
	if (safe === "system") {
		document.documentElement.removeAttribute("data-pure-font");
	} else {
		document.documentElement.setAttribute("data-pure-font", safe);
	}
}

export function setPureFont(font: PureFont): void {
	const safe: PureFont = PURE_FONTS.includes(font) ? font : "system";
	if (
		typeof localStorage !== "undefined" &&
		typeof localStorage.setItem === "function"
	) {
		localStorage.setItem("pureFont", safe);
	}
	applyPureFontToDocument(safe);
}

export function applyWallpaperModeToDocument(
	mode: WALLPAPER_MODE,
	animate = true,
): void {
	const html = document.documentElement;
	const isHeroFullscreen =
		html.getAttribute("data-fullscreen-layout") === "hero";

	// 先启用过渡类再设置模式：确保 --content-top 变化时 top 过渡已激活（否则位置瞬间到位不动画）
	if (animate) {
		html.classList.add("is-wallpaper-transitioning");
		window.setTimeout(
			() => html.classList.remove("is-wallpaper-transitioning"),
			520,
		);
	}

	html.setAttribute("data-wallpaper-mode", mode);

	// 首页标题显示：按当前模式 + 是否首页同步 hidden 类（SSR 按 config 默认模式渲染 hidden，
	// 模式运行时切换后需同步）。
	syncBannerHomeTextVisibility();

	// 卡片透明类：唯一运行时写入者（解析期由 body 起始脚本写入）
	const transparent =
		mode === WALLPAPER_OVERLAY ||
		(mode === WALLPAPER_FULLSCREEN && isHeroFullscreen);
	document.body.classList.toggle("wallpaper-transparent", transparent);

	updateNavbarTransparency(mode);
	window.dispatchEvent(
		new CustomEvent("wallpaperModeChange", { detail: { mode } }),
	);
}

export function updateNavbarTransparency(mode: WALLPAPER_MODE): void {
	const navbar = document.getElementById("navbar");
	if (!navbar) return;

	let transparentMode: string;
	let blurAmount: number;

	// 根据当前壁纸模式设置导航栏透明模式和模糊效果
	if (mode === WALLPAPER_OVERLAY) {
		// 全屏透明模式
		transparentMode = "none";
		blurAmount = 0;
	} else if (mode === WALLPAPER_NONE) {
		// 纯色背景模式
		transparentMode = "none";
		blurAmount = 0;
	} else if (mode === WALLPAPER_FULLSCREEN) {
		// 全屏壁纸：首页 + semifull 动态透明，其余半透明玻璃
		const isHomePage = checkIsHomePage(window.location.pathname);
		const fsMode =
			backgroundWallpaper.fullscreen?.navbar?.transparentMode || "semifull";
		const glassBlur = backgroundWallpaper.fullscreen?.navbar?.blur ?? 20;
		transparentMode = fsMode === "semifull" && isHomePage ? "semifull" : "semi";
		blurAmount = glassBlur;
	} else {
		// Banner模式：semifull 仅首页动态，非首页与 fullscreen 一致为半透明
		const isHomePage = checkIsHomePage(window.location.pathname);
		const tMode = backgroundWallpaper.banner?.navbar?.transparentMode || "semi";
		transparentMode = tMode === "semifull" && !isHomePage ? "semi" : tMode;
		blurAmount = backgroundWallpaper.banner?.navbar?.blur ?? 20;
	}

	// 更新导航栏的透明模式属性
	navbar.setAttribute("data-transparent-mode", transparentMode);
	navbar.style.setProperty("--navbar-glass-blur", `${blurAmount}px`);

	// 移除现有的透明模式类
	navbar.classList.remove(
		"navbar-transparent-semi",
		"navbar-transparent-full",
		"navbar-transparent-semifull",
	);

	// 移除scrolled类
	navbar.classList.remove("scrolled");

	// 滚动检测功能
	if (
		transparentMode === "semifull" &&
		(mode === WALLPAPER_BANNER || mode === WALLPAPER_FULLSCREEN) &&
		typeof window.initSemifullScrollDetection === "function"
	) {
		// 在Banner和全屏壁纸模式的semifull下启用滚动检测
		window.initSemifullScrollDetection();
	} else if (window.semifullScrollHandler) {
		// 移除滚动监听器
		window.removeEventListener("scroll", window.semifullScrollHandler);
		delete window.semifullScrollHandler;
	}
}

export function setWallpaperMode(mode: WALLPAPER_MODE): void {
	// 检查是否在浏览器环境中
	if (
		typeof localStorage === "undefined" ||
		typeof localStorage.setItem !== "function"
	) {
		return;
	}
	localStorage.setItem("wallpaperMode", mode);
	applyWallpaperModeToDocument(mode);
}

export function initWallpaperMode(): void {
	// 初始化透明模式参数（透明度/模糊度/卡片透明度）
	applyStoredOverlaySettingsToDocument();
	const storedMode = getStoredWallpaperMode();
	applyWallpaperModeToDocument(storedMode, false);
}

export function getStoredWallpaperMode(): WALLPAPER_MODE {
	// 检查是否在浏览器环境中
	if (
		typeof localStorage === "undefined" ||
		typeof localStorage.getItem !== "function"
	) {
		return backgroundWallpaper.mode;
	}

	const isSwitchable = displaySettingsConfig.wallpaperModeSwitchable;
	if (!isSwitchable) {
		localStorage.removeItem("wallpaperMode");
		return backgroundWallpaper.mode;
	}

	return (
		(localStorage.getItem("wallpaperMode") as WALLPAPER_MODE) ||
		backgroundWallpaper.mode
	);
}

// Overlay settings functions
function clampNumber(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

export function getDefaultOverlayOpacity(): number {
	return backgroundWallpaper.overlay?.opacity ?? 0.8;
}

export function getDefaultOverlayBlur(): number {
	return backgroundWallpaper.overlay?.blur ?? 0;
}

export function getDefaultOverlayCardOpacity(): number {
	return backgroundWallpaper.overlay?.cardOpacity ?? 0.6;
}

export function getStoredOverlayOpacity(): number {
	if (
		typeof localStorage === "undefined" ||
		typeof localStorage.getItem !== "function"
	) {
		return getDefaultOverlayOpacity();
	}
	const stored = localStorage.getItem("overlayOpacity");
	if (stored === null) {
		return getDefaultOverlayOpacity();
	}
	const parsed = Number.parseFloat(stored);
	if (Number.isNaN(parsed)) {
		return getDefaultOverlayOpacity();
	}
	return clampNumber(parsed, 0, 1);
}

export function getStoredOverlayBlur(): number {
	if (
		typeof localStorage === "undefined" ||
		typeof localStorage.getItem !== "function"
	) {
		return getDefaultOverlayBlur();
	}
	const stored = localStorage.getItem("overlayBlur");
	if (stored === null) {
		return getDefaultOverlayBlur();
	}
	const parsed = Number.parseFloat(stored);
	if (Number.isNaN(parsed)) {
		return getDefaultOverlayBlur();
	}
	return clampNumber(parsed, 0, 20);
}

export function getStoredOverlayCardOpacity(): number {
	if (
		typeof localStorage === "undefined" ||
		typeof localStorage.getItem !== "function"
	) {
		return getDefaultOverlayCardOpacity();
	}
	const stored = localStorage.getItem("overlayCardOpacity");
	if (stored === null) {
		return getDefaultOverlayCardOpacity();
	}
	const parsed = Number.parseFloat(stored);
	if (Number.isNaN(parsed)) {
		return getDefaultOverlayCardOpacity();
	}
	return clampNumber(parsed, 0, 1);
}

export function applyOverlayOpacityToDocument(opacity: number): void {
	if (typeof document === "undefined") {
		return;
	}
	const safeOpacity = clampNumber(opacity, 0, 1);
	const wallpaperWrapper = document.getElementById("wallpaper-wrapper");
	if (wallpaperWrapper) {
		wallpaperWrapper.style.setProperty(
			"--overlay-opacity",
			String(safeOpacity),
		);
	}
}

export function applyOverlayBlurToDocument(blur: number): void {
	if (typeof document === "undefined") {
		return;
	}
	const safeBlur = clampNumber(blur, 0, 20);
	const wallpaperWrapper = document.getElementById("wallpaper-wrapper");
	if (wallpaperWrapper) {
		wallpaperWrapper.style.setProperty("--overlay-blur", `${safeBlur}px`);
	}
}

export function applyOverlayCardOpacityToDocument(cardOpacity: number): void {
	if (typeof document === "undefined") {
		return;
	}
	const safeCardOpacity = clampNumber(cardOpacity, 0, 1);
	document.documentElement.style.setProperty(
		"--card-transparent-opacity",
		String(safeCardOpacity),
	);
}

export function setOverlayOpacity(opacity: number): void {
	const safeOpacity = clampNumber(opacity, 0, 1);
	if (
		typeof localStorage !== "undefined" &&
		typeof localStorage.setItem === "function"
	) {
		localStorage.setItem("overlayOpacity", String(safeOpacity));
	}
	applyOverlayOpacityToDocument(safeOpacity);
}

export function setOverlayBlur(blur: number): void {
	const safeBlur = clampNumber(blur, 0, 20);
	if (
		typeof localStorage !== "undefined" &&
		typeof localStorage.setItem === "function"
	) {
		localStorage.setItem("overlayBlur", String(safeBlur));
	}
	applyOverlayBlurToDocument(safeBlur);
}

export function setOverlayCardOpacity(cardOpacity: number): void {
	const safeCardOpacity = clampNumber(cardOpacity, 0, 1);
	if (
		typeof localStorage !== "undefined" &&
		typeof localStorage.setItem === "function"
	) {
		localStorage.setItem("overlayCardOpacity", String(safeCardOpacity));
	}
	applyOverlayCardOpacityToDocument(safeCardOpacity);
}

export function applyStoredOverlaySettingsToDocument(): void {
	applyOverlayOpacityToDocument(getStoredOverlayOpacity());
	applyOverlayBlurToDocument(getStoredOverlayBlur());
	applyOverlayCardOpacityToDocument(getStoredOverlayCardOpacity());
}

// Waves animation functions
export function getDefaultWavesEnabled(): boolean {
	const wavesConfig = backgroundWallpaper.common?.waves?.enable;
	if (typeof wavesConfig === "object") {
		// 如果是分设备配置，检查当前设备
		const isMobile =
			typeof window !== "undefined" ? window.innerWidth < 768 : false;
		return isMobile
			? (wavesConfig.mobile ?? false)
			: (wavesConfig.desktop ?? false);
	}
	return wavesConfig ?? false;
}

export function getStoredWavesEnabled(): boolean {
	if (
		typeof localStorage === "undefined" ||
		typeof localStorage.getItem !== "function"
	) {
		return getDefaultWavesEnabled();
	}
	const stored = localStorage.getItem("wavesEnabled");
	if (stored === null) {
		return getDefaultWavesEnabled();
	}
	return stored === "true";
}

export function setWavesEnabled(enabled: boolean): void {
	if (
		typeof localStorage === "undefined" ||
		typeof localStorage.setItem !== "function"
	) {
		return;
	}
	localStorage.setItem("wavesEnabled", String(enabled));
	applyWavesEnabledToDocument(enabled);
}

export function applyWavesEnabledToDocument(enabled: boolean): void {
	if (typeof document === "undefined") {
		return;
	}
	// 更新 html 属性，CSS 会立即生效
	document.documentElement.setAttribute("data-waves-enabled", String(enabled));
	// 同时更新元素样式（兼容性）
	const wavesElement = document.getElementById("header-waves");
	if (wavesElement) {
		if (enabled) {
			wavesElement.style.display = "";
			wavesElement.classList.remove("waves-disabled");
		} else {
			wavesElement.style.display = "none";
			wavesElement.classList.add("waves-disabled");
		}
	}
}

// Gradient transition functions
export function getDefaultGradientEnabled(): boolean {
	const gradientConfig = backgroundWallpaper.common?.gradient?.enable;
	if (typeof gradientConfig === "object") {
		const isMobile =
			typeof window !== "undefined" ? window.innerWidth < 768 : false;
		return isMobile
			? (gradientConfig.mobile ?? true)
			: (gradientConfig.desktop ?? true);
	}
	return gradientConfig ?? true;
}

export function getStoredGradientEnabled(): boolean {
	if (
		typeof localStorage === "undefined" ||
		typeof localStorage.getItem !== "function"
	) {
		return getDefaultGradientEnabled();
	}
	const stored = localStorage.getItem("gradientEnabled");
	if (stored === null) {
		return getDefaultGradientEnabled();
	}
	return stored === "true";
}

export function setGradientEnabled(enabled: boolean): void {
	if (
		typeof localStorage === "undefined" ||
		typeof localStorage.setItem !== "function"
	) {
		return;
	}
	localStorage.setItem("gradientEnabled", String(enabled));
	applyGradientEnabledToDocument(enabled);
}

export function applyGradientEnabledToDocument(enabled: boolean): void {
	if (typeof document === "undefined") {
		return;
	}
	document.documentElement.setAttribute(
		"data-gradient-enabled",
		String(enabled),
	);
	const gradientElement = document.getElementById("wallpaper-gradient");
	if (gradientElement) {
		if (enabled) {
			gradientElement.style.display = "";
			gradientElement.classList.remove("gradient-disabled");
		} else {
			gradientElement.style.display = "none";
			gradientElement.classList.add("gradient-disabled");
		}
	}
}

// Sakura effect functions
export function getDefaultSakuraEnabled(): boolean {
	return sakuraConfig?.enable ?? false;
}

export function getStoredSakuraEnabled(): boolean {
	if (typeof localStorage === "undefined") {
		return getDefaultSakuraEnabled();
	}
	const stored = localStorage.getItem("sakuraEnabled");
	if (stored === null) {
		return getDefaultSakuraEnabled();
	}
	return stored === "true";
}

export function setSakuraEnabled(enabled: boolean): void {
	if (
		typeof localStorage === "undefined" ||
		typeof localStorage.setItem !== "function"
	) {
		return;
	}
	localStorage.setItem("sakuraEnabled", String(enabled));
	document.documentElement.setAttribute("data-sakura-enabled", String(enabled));
	// 实时切换樱花特效
	window.dispatchEvent(
		new CustomEvent("sakuraToggle", { detail: { enabled } }),
	);
}

// Snow effect functions
// 季节雪（第二批）：配置未开时，冬季（12/1/2 月，按访客本地时间）默认开；
// 访客在调色板里手动存过 snowEnabled 的，以他的选择为准。
export function getDefaultSnowEnabled(): boolean {
	if (!featuresConfig.seasonalSnow) return false;
	if (snowConfig?.enable) return true;
	const m = new Date().getMonth();
	return m === 11 || m === 0 || m === 1;
}

export function getStoredSnowEnabled(): boolean {
	if (typeof localStorage === "undefined") {
		return getDefaultSnowEnabled();
	}
	const stored = localStorage.getItem("snowEnabled");
	if (stored === null) {
		return getDefaultSnowEnabled();
	}
	return stored === "true";
}

export function setSnowEnabled(enabled: boolean): void {
	if (
		typeof localStorage === "undefined" ||
		typeof localStorage.setItem !== "function"
	) {
		return;
	}
	localStorage.setItem("snowEnabled", String(enabled));
	document.documentElement.setAttribute("data-snow-enabled", String(enabled));
	// 实时切换雪花特效
	window.dispatchEvent(
		new CustomEvent("snowToggle", { detail: { enabled } }),
	);
}

// Firefly effect functions
export function getDefaultFireflyEnabled(): boolean {
	return fireflyConfig?.enable ?? false;
}

export function getStoredFireflyEnabled(): boolean {
	if (typeof localStorage === "undefined") {
		return getDefaultFireflyEnabled();
	}
	const stored = localStorage.getItem("fireflyEnabled");
	if (stored === null) {
		return getDefaultFireflyEnabled();
	}
	return stored === "true";
}

export function setFireflyEnabled(enabled: boolean): void {
	if (
		typeof localStorage === "undefined" ||
		typeof localStorage.setItem !== "function"
	) {
		return;
	}
	localStorage.setItem("fireflyEnabled", String(enabled));
	document.documentElement.setAttribute("data-firefly-enabled", String(enabled));
	// 实时切换萤火虫特效
	window.dispatchEvent(
		new CustomEvent("fireflyToggle", { detail: { enabled } }),
	);
}

// Starfield effect functions（璨夜形态的程序化星空层，组件 AstralStarfield.astro 消费；
// 存储键 starfieldEnabled、事件 starfieldToggle，与萤火虫同一套协议；只在 astral 形态下真正渲染）
export function getDefaultStarfieldEnabled(): boolean {
	return starfieldConfig?.enable ?? true;
}

export function getStoredStarfieldEnabled(): boolean {
	if (typeof localStorage === "undefined") {
		return getDefaultStarfieldEnabled();
	}
	const stored = localStorage.getItem("starfieldEnabled");
	if (stored === null) {
		return getDefaultStarfieldEnabled();
	}
	return stored === "true";
}

export function setStarfieldEnabled(enabled: boolean): void {
	if (
		typeof localStorage === "undefined" ||
		typeof localStorage.setItem !== "function"
	) {
		return;
	}
	localStorage.setItem("starfieldEnabled", String(enabled));
	document.documentElement.setAttribute(
		"data-starfield-enabled",
		String(enabled),
	);
	// 实时切换星空层
	window.dispatchEvent(
		new CustomEvent("starfieldToggle", { detail: { enabled } }),
	);
}

// Notes effect functions
export function getDefaultNotesEnabled(): boolean {
	return notesConfig?.enable ?? false;
}

export function getStoredNotesEnabled(): boolean {
	if (typeof localStorage === "undefined") {
		return getDefaultNotesEnabled();
	}
	const stored = localStorage.getItem("notesEnabled");
	if (stored === null) {
		return getDefaultNotesEnabled();
	}
	return stored === "true";
}

export function setNotesEnabled(enabled: boolean): void {
	if (
		typeof localStorage === "undefined" ||
		typeof localStorage.setItem !== "function"
	) {
		return;
	}
	localStorage.setItem("notesEnabled", String(enabled));
	document.documentElement.setAttribute("data-notes-enabled", String(enabled));
	// 实时切换音符特效
	window.dispatchEvent(
		new CustomEvent("notesToggle", { detail: { enabled } }),
	);
}

// Rain effect functions
export function getDefaultRainEnabled(): boolean {
	return rainConfig?.enable ?? false;
}

export function getStoredRainEnabled(): boolean {
	if (typeof localStorage === "undefined") {
		return getDefaultRainEnabled();
	}
	const stored = localStorage.getItem("rainEnabled");
	if (stored === null) {
		return getDefaultRainEnabled();
	}
	return stored === "true";
}

export function setRainEnabled(enabled: boolean): void {
	if (
		typeof localStorage === "undefined" ||
		typeof localStorage.setItem !== "function"
	) {
		return;
	}
	localStorage.setItem("rainEnabled", String(enabled));
	document.documentElement.setAttribute("data-rain-enabled", String(enabled));
	// 实时切换雨滴特效
	window.dispatchEvent(
		new CustomEvent("rainToggle", { detail: { enabled } }),
	);
}

// Meteor effect functions
export function getDefaultMeteorEnabled(): boolean {
	return meteorConfig?.enable ?? false;
}

export function getStoredMeteorEnabled(): boolean {
	if (typeof localStorage === "undefined") {
		return getDefaultMeteorEnabled();
	}
	const stored = localStorage.getItem("meteorEnabled");
	if (stored === null) {
		return getDefaultMeteorEnabled();
	}
	return stored === "true";
}

export function setMeteorEnabled(enabled: boolean): void {
	if (
		typeof localStorage === "undefined" ||
		typeof localStorage.setItem !== "function"
	) {
		return;
	}
	localStorage.setItem("meteorEnabled", String(enabled));
	document.documentElement.setAttribute("data-meteor-enabled", String(enabled));
	// 实时切换流星特效
	window.dispatchEvent(
		new CustomEvent("meteorToggle", { detail: { enabled } }),
	);
}

// Bubbles effect functions
export function getDefaultBubblesEnabled(): boolean {
	return bubblesConfig?.enable ?? false;
}

export function getStoredBubblesEnabled(): boolean {
	if (typeof localStorage === "undefined") {
		return getDefaultBubblesEnabled();
	}
	const stored = localStorage.getItem("bubblesEnabled");
	if (stored === null) {
		return getDefaultBubblesEnabled();
	}
	return stored === "true";
}

export function setBubblesEnabled(enabled: boolean): void {
	if (
		typeof localStorage === "undefined" ||
		typeof localStorage.setItem !== "function"
	) {
		return;
	}
	localStorage.setItem("bubblesEnabled", String(enabled));
	document.documentElement.setAttribute("data-bubbles-enabled", String(enabled));
	// 实时切换泡泡特效
	window.dispatchEvent(
		new CustomEvent("bubblesToggle", { detail: { enabled } }),
	);
}

// Hearts effect functions
export function getDefaultHeartsEnabled(): boolean {
	return heartsConfig?.enable ?? false;
}

export function getStoredHeartsEnabled(): boolean {
	if (typeof localStorage === "undefined") {
		return getDefaultHeartsEnabled();
	}
	const stored = localStorage.getItem("heartsEnabled");
	if (stored === null) {
		return getDefaultHeartsEnabled();
	}
	return stored === "true";
}

export function setHeartsEnabled(enabled: boolean): void {
	if (
		typeof localStorage === "undefined" ||
		typeof localStorage.setItem !== "function"
	) {
		return;
	}
	localStorage.setItem("heartsEnabled", String(enabled));
	document.documentElement.setAttribute("data-hearts-enabled", String(enabled));
	// 实时切换爱心特效
	window.dispatchEvent(
		new CustomEvent("heartsToggle", { detail: { enabled } }),
	);
}

// Leaves effect functions
export function getDefaultLeavesEnabled(): boolean {
	return leavesConfig?.enable ?? false;
}

export function getStoredLeavesEnabled(): boolean {
	if (typeof localStorage === "undefined") {
		return getDefaultLeavesEnabled();
	}
	const stored = localStorage.getItem("leavesEnabled");
	if (stored === null) {
		return getDefaultLeavesEnabled();
	}
	return stored === "true";
}

export function setLeavesEnabled(enabled: boolean): void {
	if (
		typeof localStorage === "undefined" ||
		typeof localStorage.setItem !== "function"
	) {
		return;
	}
	localStorage.setItem("leavesEnabled", String(enabled));
	document.documentElement.setAttribute("data-leaves-enabled", String(enabled));
	// 实时切换落叶特效
	window.dispatchEvent(
		new CustomEvent("leavesToggle", { detail: { enabled } }),
	);
}

// Click effect functions
export function getDefaultClickEnabled(): boolean {
	return clickConfig?.enable ?? false;
}

export function getStoredClickEnabled(): boolean {
	if (typeof localStorage === "undefined") {
		return getDefaultClickEnabled();
	}
	const stored = localStorage.getItem("clickEnabled");
	if (stored === null) {
		return getDefaultClickEnabled();
	}
	return stored === "true";
}

export function setClickEnabled(enabled: boolean): void {
	if (
		typeof localStorage === "undefined" ||
		typeof localStorage.setItem !== "function"
	) {
		return;
	}
	localStorage.setItem("clickEnabled", String(enabled));
	document.documentElement.setAttribute("data-click-enabled", String(enabled));
	// 实时切换点击特效
	window.dispatchEvent(
		new CustomEvent("clickToggle", { detail: { enabled } }),
	);
}

// Banner title functions
export function getDefaultBannerTitleEnabled(): boolean {
	return backgroundWallpaper.common?.homeText?.enable ?? true;
}

export function getDefaultBannerCarouselEnabled(): boolean {
	return backgroundWallpaper.common?.carousel?.enable ?? false;
}

export function getStoredBannerTitleEnabled(): boolean {
	if (
		typeof localStorage === "undefined" ||
		typeof localStorage.getItem !== "function"
	) {
		return getDefaultBannerTitleEnabled();
	}
	const stored = localStorage.getItem("bannerTitleEnabled");
	if (stored === null) {
		return getDefaultBannerTitleEnabled();
	}
	return stored === "true";
}

export function getStoredBannerCarouselEnabled(): boolean {
	const isSwitchable = displaySettingsConfig.bannerCarouselSwitchable;
	if (!isSwitchable) {
		return getDefaultBannerCarouselEnabled();
	}
	if (
		typeof localStorage === "undefined" ||
		typeof localStorage.getItem !== "function"
	) {
		return getDefaultBannerCarouselEnabled();
	}
	const stored = localStorage.getItem("bannerCarouselEnabled");
	if (stored === null) {
		// 访客没在调色板里动过：按当前壁纸模式的管理台分模式开关（modeCarousel）显示，
		// 与前台轮播脚本的生效顺序一致；没配分模式再回退全局默认
		const mode = getStoredWallpaperMode();
		const mc = backgroundWallpaper.modeCarousel;
		if (mc && typeof mc[mode as keyof typeof mc] === "boolean") {
			return mc[mode as keyof typeof mc] as boolean;
		}
		return getDefaultBannerCarouselEnabled();
	}
	return stored === "true";
}

export function setBannerTitleEnabled(enabled: boolean): void {
	if (
		typeof localStorage === "undefined" ||
		typeof localStorage.setItem !== "function"
	) {
		return;
	}
	localStorage.setItem("bannerTitleEnabled", String(enabled));
	applyBannerTitleEnabledToDocument(enabled);
}

export function setBannerCarouselEnabled(enabled: boolean): void {
	const safeEnabled = !!enabled;
	const isSwitchable = displaySettingsConfig.bannerCarouselSwitchable;
	if (
		isSwitchable &&
		typeof localStorage !== "undefined" &&
		typeof localStorage.setItem === "function"
	) {
		localStorage.setItem("bannerCarouselEnabled", String(safeEnabled));
	}
	applyBannerCarouselEnabledToDocument(safeEnabled);
	if (typeof window !== "undefined") {
		window.dispatchEvent(
			new CustomEvent("bannerCarouselChange", {
				detail: { enabled: safeEnabled },
			}),
		);
	}
}

export function applyBannerTitleEnabledToDocument(enabled: boolean): void {
	if (typeof document === "undefined") {
		return;
	}
	// 更新 html 属性，CSS 会立即生效
	document.documentElement.setAttribute(
		"data-banner-title-enabled",
		String(enabled),
	);
	// 同时更新元素样式（兼容性）
	const bannerTextOverlay = document.querySelector(
		".banner-home-text-overlay",
	) as HTMLElement;
	if (bannerTextOverlay) {
		if (enabled) {
			bannerTextOverlay.classList.remove("user-hidden");
		} else {
			bannerTextOverlay.classList.add("user-hidden");
		}
	}
}

export function applyBannerCarouselEnabledToDocument(enabled: boolean): void {
	if (typeof document === "undefined") {
		return;
	}
	document.documentElement.setAttribute(
		"data-banner-carousel-enabled",
		String(enabled),
	);
}

// Card border functions
export function getDefaultCardBorderEnabled(): boolean {
	return siteConfig.card?.border ?? false;
}

export function getStoredCardBorderEnabled(): boolean {
	if (typeof localStorage === "undefined") {
		return getDefaultCardBorderEnabled();
	}
	const stored = localStorage.getItem("cardBorderEnabled");
	if (stored === null) {
		return getDefaultCardBorderEnabled();
	}
	return stored === "true";
}

export function setCardBorderEnabled(enabled: boolean): void {
	if (
		typeof localStorage === "undefined" ||
		typeof localStorage.setItem !== "function"
	) {
		return;
	}
	localStorage.setItem("cardBorderEnabled", String(enabled));
	if (enabled) {
		document.documentElement.classList.add("enable-card-border");
	} else {
		document.documentElement.classList.remove("enable-card-border");
	}
}

// Card follow theme functions
export function getDefaultCardFollowThemeEnabled(): boolean {
	return siteConfig.card?.followTheme ?? false;
}

export function getStoredCardFollowThemeEnabled(): boolean {
	if (typeof localStorage === "undefined") {
		return getDefaultCardFollowThemeEnabled();
	}
	const stored = localStorage.getItem("cardFollowThemeEnabled");
	if (stored === null) {
		return getDefaultCardFollowThemeEnabled();
	}
	return stored === "true";
}

export function setCardFollowThemeEnabled(enabled: boolean): void {
	if (
		typeof localStorage === "undefined" ||
		typeof localStorage.setItem !== "function"
	) {
		return;
	}
	localStorage.setItem("cardFollowThemeEnabled", String(enabled));
	if (enabled) {
		document.body.classList.add("card-follow-theme-hue");
	} else {
		document.body.classList.remove("card-follow-theme-hue");
	}
}

// ─── 碎碎念弹幕（第二批） ─────────────────────────────────────
// 内容源 = thoughtsConfig 碎碎念；开关协议与雪花一致：localStorage 的
// danmakuEnabled 优先、缺省开；密度/速度存 danmakuDensity / danmakuSpeed。
// DanmakuLayer 监听 danmakuToggle 实时开关、danmakuSettings 实时改档。
export function getDefaultDanmakuEnabled(): boolean {
	// 2026-10-31 站长定版：默认关，访客在璨夜的调色板里手动开（全形态共用一个值）
	return false;
}

export function getStoredDanmakuEnabled(): boolean {
	if (typeof localStorage === "undefined") {
		return getDefaultDanmakuEnabled();
	}
	const stored = localStorage.getItem("danmakuEnabled");
	if (stored === null) {
		return getDefaultDanmakuEnabled();
	}
	return stored === "true";
}

export function setDanmakuEnabled(enabled: boolean): void {
	if (
		typeof localStorage === "undefined" ||
		typeof localStorage.setItem !== "function"
	) {
		return;
	}
	localStorage.setItem("danmakuEnabled", String(enabled));
	window.dispatchEvent(
		new CustomEvent("danmakuToggle", { detail: { enabled } }),
	);
}

export type DanmakuDensity = "low" | "mid" | "high";
export type DanmakuSpeed = "slow" | "mid" | "fast";

export function getDanmakuDensity(): DanmakuDensity {
	if (typeof localStorage === "undefined") return "mid";
	const v = localStorage.getItem("danmakuDensity");
	return v === "low" || v === "high" ? v : "mid";
}

export function getDanmakuSpeed(): DanmakuSpeed {
	if (typeof localStorage === "undefined") return "mid";
	const v = localStorage.getItem("danmakuSpeed");
	return v === "slow" || v === "fast" ? v : "mid";
}

export function setDanmakuDensity(v: DanmakuDensity): void {
	if (typeof localStorage === "undefined") return;
	localStorage.setItem("danmakuDensity", v);
	window.dispatchEvent(new CustomEvent("danmakuSettings"));
}

export function setDanmakuSpeed(v: DanmakuSpeed): void {
	if (typeof localStorage === "undefined") return;
	localStorage.setItem("danmakuSpeed", v);
	window.dispatchEvent(new CustomEvent("danmakuSettings"));
}
