<script lang="ts">
import {
	WALLPAPER_BANNER,
	WALLPAPER_FULLSCREEN,
	WALLPAPER_NONE,
	WALLPAPER_OVERLAY,
} from "@constants/constants";
import I18nKey from "@i18n/i18nKey";
import { i18n } from "@i18n/translation";
import {
	getDefaultBannerCarouselEnabled,
	getDefaultBannerTitleEnabled,
	getDefaultCardBorderEnabled,
	getDefaultCardFollowThemeEnabled,
	getDefaultFireflyEnabled,
	getDefaultStarfieldEnabled,
	getDefaultFullscreenLayout,
	getDefaultGradientEnabled,
	getDefaultHue,
	getDefaultNavbarStyle,
	getDefaultSiteMode,
	getDefaultOverlayBlur,
	getDefaultOverlayCardOpacity,
	getDefaultOverlayOpacity,
	getDefaultSakuraEnabled,
	getDefaultSnowEnabled,
	getDefaultNotesEnabled,
	getDefaultRainEnabled,
	getDefaultMeteorEnabled,
	getDefaultBubblesEnabled,
	getDefaultHeartsEnabled,
	getDefaultLeavesEnabled,
	getDefaultClickEnabled,
	getDefaultWavesEnabled,
	getHue,
	getStoredBannerCarouselEnabled,
	getStoredBannerTitleEnabled,
	getStoredCardBorderEnabled,
	getStoredCardFollowThemeEnabled,
	getStoredFireflyEnabled,
	getStoredStarfieldEnabled,
	getStoredFullscreenLayout,
	getStoredNavbarStyle,
	getPureFontMenu,
	getStoredPureFont,
	PURE_FONT_LABELS,
	getStoredSiteMode,
	getDefaultAstralTheme,
	getDefaultAstralLayout,
	getStoredAstralTheme,
	getStoredAstralLayout,
	getStoredHarmonyHue,
	getStoredHarmonyScheme,
	getStoredHarmonySpec,
	getStoredHarmonyTexture,
	getStoredHarmonyTextureOpacity,
	getStoredHarmonyMotionReduced,
	getStoredHarmonyOverlayOpacity,
	getStoredHarmonyOverlayBlur,
	getStoredHarmonyOverlayCardOpacity,
	DEFAULT_HARMONY_SCHEME,
	DEFAULT_HARMONY_SPEC,
	DEFAULT_HARMONY_TEXTURE,
	DEFAULT_HARMONY_TEXTURE_OPACITY,
	getStoredGradientEnabled,
	getStoredOverlayBlur,
	getStoredOverlayCardOpacity,
	getStoredOverlayOpacity,
	getStoredSakuraEnabled,
	getStoredSnowEnabled,
	getDefaultDanmakuEnabled,
	getStoredDanmakuEnabled,
	getDanmakuDensity,
	getDanmakuSpeed,
	getStoredNotesEnabled,
	getStoredRainEnabled,
	getStoredMeteorEnabled,
	getStoredBubblesEnabled,
	getStoredHeartsEnabled,
	getStoredLeavesEnabled,
	getStoredClickEnabled,
	getStoredWallpaperMode,
	getStoredWavesEnabled,
	setBannerCarouselEnabled,
	setBannerTitleEnabled,
	setCardBorderEnabled,
	setCardFollowThemeEnabled,
	setFireflyEnabled,
	setStarfieldEnabled,
	setFullscreenLayout,
	setGradientEnabled,
	setHue,
	setOverlayBlur,
	setOverlayCardOpacity,
	setOverlayOpacity,
	setSakuraEnabled,
	setSnowEnabled,
	setDanmakuEnabled,
	setDanmakuDensity,
	setDanmakuSpeed,
	setNavbarStyle,
	setPureFont,
	setSiteMode,
	setAstralTheme,
	setAstralLayout,
	setHarmonyHue,
	setHarmonyScheme,
	setHarmonySpec,
	setHarmonyTexture,
	setHarmonyTextureOpacity,
	setHarmonyMotionReduced,
	setHarmonyOverlayOpacity,
	setHarmonyOverlayBlur,
	setHarmonyOverlayCardOpacity,
	setNotesEnabled,
	setRainEnabled,
	setMeteorEnabled,
	setBubblesEnabled,
	setHeartsEnabled,
	setLeavesEnabled,
	setClickEnabled,
	setWallpaperMode,
	setWavesEnabled,
} from "@utils/setting-utils";
import { onMount } from "svelte";
import Icon from "@/components/common/Icon.svelte";
import {
	backgroundWallpaper,
	displaySettingsConfig,
	siteConfig,
} from "@/config";
import type { FullscreenWallpaperLayout, WALLPAPER_MODE } from "@/types/config";
import { getModeCarouselEnabled } from "@/utils/layout-utils";

type OverlaySliderItem = {
	key: "opacity" | "blur" | "cardOpacity";
	enabled: boolean;
	label: string;
	displayValue: string;
	ariaLabel: string;
	min: number;
	max: number;
	step: number;
	value: number;
	onValueChange: (value: number) => void;
};

type TabKey = "appearance" | "wallpaper" | "effects";

let hue = $state(getHue());
const defaultHue = getDefaultHue();
let navbarStyle = $state(getStoredNavbarStyle());
const defaultNavbarStyle = getDefaultNavbarStyle();
const navbarStyleOptions = [
	{ value: "classic", labelKey: I18nKey.navbarStyleClassic },
	{ value: "float", labelKey: I18nKey.navbarStyleFloat },
	{ value: "capsule", labelKey: I18nKey.navbarStyleCapsule },
	{ value: "segment", labelKey: I18nKey.navbarStyleSegment },
] as const;
let siteMode = $state(getStoredSiteMode());
const defaultSiteMode = getDefaultSiteMode();
// 璨夜子主题（实面 / 星尘）：仅璨夜下出现，在站点形态行下方；控制台定默认、这里是访客覆盖
let astralTheme = $state(getStoredAstralTheme());
const defaultAstralTheme = getDefaultAstralTheme();
const astralThemeOptions = [
	{ value: "solid", label: "实面" },
	{ value: "starfield", label: "星尘" },
] as const;
// 璨夜主题布局（经典 / 璨夜）：仅璨夜下出现，在璨夜主题行下方；控制台定默认、这里是访客覆盖
let astralLayout = $state(getStoredAstralLayout());
const astralLayoutOptions = [
	{ value: "classic", label: "经典布局" },
	{ value: "bento", label: "璨夜布局" },
] as const;
const siteModeOptions = [
	{ value: "full", labelKey: I18nKey.siteModeFull },
	{ value: "pure", labelKey: I18nKey.siteModePure },
	{ value: "harmony", labelKey: I18nKey.siteModeHarmony },
	{ value: "brick", labelKey: I18nKey.siteModeBrick },
	{ value: "astral", labelKey: I18nKey.siteModeAstral },
] as const;
// 素简下调色板精简：只留站点形态（华彩切换）、字体与特效（樱花/萤火虫），壁纸整页签收起；
// 文章布局（列表/网格）在素简下不出现——素简是单列列表、根本排不了网格（2026-10-28 用户定），原位置改放特效
const isPure = $derived(siteMode === "pure");
let pureFont = $state(getStoredPureFont());
// 选项来自 siteConfig.pureFontMenu（控制台字体页可管：放哪几款、什么顺序，第一项即默认）
const pureFontOptions = getPureFontMenu().map((k) => ({
	value: k,
	label: PURE_FONT_LABELS[k],
}));
// 谐彩专属调色板（仅 siteMode=harmony 时出现）：种子色相 / 色彩风格 / 色彩规范 /
// 背景纹理 / overlay 三项 / 减少动态，存储键 harmony*，与全站设置互不干扰
const isHarmony = $derived(siteMode === "harmony");
// 顽彩：配色与导航形态由 brick-mode.css 固定（蓝描边 + 硬阴影 + 顶栏），全站主题色/导航样式两段隐藏
const isBrick = $derived(siteMode === "brick");
// 璨夜：深蓝星空 + 毛玻璃由 astral-mode.css 接管，特效页签多一个星空开关（仅本形态出现）
const isAstral = $derived(siteMode === "astral");
let harmonyHue = $state(getStoredHarmonyHue() ?? getHue());
let harmonyHueCustom = $state(getStoredHarmonyHue() !== null);
let harmonyScheme = $state(getStoredHarmonyScheme());
let harmonySpec = $state(getStoredHarmonySpec());
let harmonyTexture = $state(getStoredHarmonyTexture());
let harmonyTextureOpacity = $state(getStoredHarmonyTextureOpacity());
let harmonyMotionReduced = $state(getStoredHarmonyMotionReduced());
let harmonyOverlayOpacity = $state(getStoredHarmonyOverlayOpacity());
let harmonyOverlayBlur = $state(getStoredHarmonyOverlayBlur());
let harmonyOverlayCardOpacity = $state(getStoredHarmonyOverlayCardOpacity());
const harmonySchemeOptions = [
	{ value: "tonalSpot", labelKey: I18nKey.harmonySchemeTonalSpot },
	{ value: "vibrant", labelKey: I18nKey.harmonySchemeVibrant },
	{ value: "expressive", labelKey: I18nKey.harmonySchemeExpressive },
	{ value: "fidelity", labelKey: I18nKey.harmonySchemeFidelity },
	{ value: "content", labelKey: I18nKey.harmonySchemeContent },
	{ value: "neutral", labelKey: I18nKey.harmonySchemeNeutral },
	{ value: "monochrome", labelKey: I18nKey.harmonySchemeMonochrome },
	{ value: "rainbow", labelKey: I18nKey.harmonySchemeRainbow },
	{ value: "fruitSalad", labelKey: I18nKey.harmonySchemeFruitSalad },
] as const;
const harmonyTextureOptions = [
	{ value: "none", labelKey: I18nKey.harmonyTextureNone },
	{ value: "starlight", labelKey: I18nKey.harmonyTextureStarlight },
	{ value: "cyber-dots", labelKey: I18nKey.harmonyTextureCyberDots },
	{ value: "topography", labelKey: I18nKey.harmonyTextureTopography },
	{ value: "geometric", labelKey: I18nKey.harmonyTextureGeometric },
	{ value: "sakura", labelKey: I18nKey.harmonyTextureSakura },
] as const;
// 风格预览圆点：与 harmony-mode.css 参数组同表（主/次/三角色的 明度/色度/色相偏移，亮色口径）
const HARMONY_SCHEME_PREVIEW: Record<
	string,
	{ p: [number, number, number]; s: [number, number, number]; t: [number, number, number] }
> = {
	tonalSpot: { p: [0.42, 0.16, 0], s: [0.52, 0.065, 0], t: [0.5, 0.09, 60] },
	vibrant: { p: [0.44, 0.21, 0], s: [0.55, 0.1, 0], t: [0.55, 0.12, 60] },
	expressive: { p: [0.43, 0.18, 0], s: [0.55, 0.09, 95], t: [0.52, 0.1, 180] },
	fidelity: { p: [0.4, 0.19, 0], s: [0.52, 0.13, 0], t: [0.5, 0.12, 170] },
	content: { p: [0.4, 0.19, 0], s: [0.55, 0.13, 0], t: [0.52, 0.13, 180] },
	neutral: { p: [0.42, 0.05, 0], s: [0.55, 0.03, 0], t: [0.52, 0.05, 60] },
	monochrome: { p: [0.42, 0, 0], s: [0.55, 0, 0], t: [0.52, 0, 60] },
	rainbow: { p: [0.43, 0.2, 0], s: [0.55, 0.11, 90], t: [0.52, 0.12, 210] },
	fruitSalad: { p: [0.43, 0.19, -50], s: [0.55, 0.08, -50], t: [0.52, 0.09, 0] },
};
function harmonyDot(triple: [number, number, number]): string {
	const h = (((harmonyHue + triple[2]) % 360) + 360) % 360;
	return `oklch(${triple[0]} ${triple[1]} ${h})`;
}
function onHarmonyHueInput(value: number) {
	harmonyHue = value;
	harmonyHueCustom = true;
	setHarmonyHue(value);
}
const harmonyIsDefault = $derived(
	!harmonyHueCustom &&
		harmonyScheme === DEFAULT_HARMONY_SCHEME &&
		harmonySpec === DEFAULT_HARMONY_SPEC &&
		harmonyTexture === DEFAULT_HARMONY_TEXTURE &&
		harmonyTextureOpacity === DEFAULT_HARMONY_TEXTURE_OPACITY &&
		!harmonyMotionReduced &&
		harmonyOverlayOpacity === defaultOverlayOpacity &&
		harmonyOverlayBlur === defaultOverlayBlur &&
		harmonyOverlayCardOpacity === defaultOverlayCardOpacity,
);
function resetHarmonySettings() {
	setHarmonyHue(null);
	harmonyHueCustom = false;
	harmonyHue = getHue();
	harmonyScheme = DEFAULT_HARMONY_SCHEME;
	harmonySpec = DEFAULT_HARMONY_SPEC;
	harmonyTexture = DEFAULT_HARMONY_TEXTURE;
	harmonyTextureOpacity = DEFAULT_HARMONY_TEXTURE_OPACITY;
	harmonyMotionReduced = false;
	harmonyOverlayOpacity = defaultOverlayOpacity;
	harmonyOverlayBlur = defaultOverlayBlur;
	harmonyOverlayCardOpacity = defaultOverlayCardOpacity;
}
let wallpaperMode: WALLPAPER_MODE = $state(backgroundWallpaper.mode);
const defaultWallpaperMode = backgroundWallpaper.mode;
let fullscreenLayout: FullscreenWallpaperLayout = $state(
	getDefaultFullscreenLayout(),
);
const defaultFullscreenLayout = getDefaultFullscreenLayout();
let currentLayout: "list" | "grid" = $state("list");
const defaultLayout = siteConfig.postListLayout.defaultMode;
const mobileDefaultLayout =
	siteConfig.postListLayout.mobileDefaultMode || defaultLayout;
let mounted = $state(false);
let isSmallScreen = $state(
	typeof window !== "undefined" ? window.innerWidth < 1200 : false,
);
let isMobileWidth = $state(
	typeof window !== "undefined" ? window.innerWidth < 780 : false,
);
let isMobileViewport = $state(
	typeof window !== "undefined" ? window.innerWidth < 1024 : false,
);
let isSwitching = $state(false);
let wavesEnabled = $state(true);
const defaultWavesEnabled = getDefaultWavesEnabled();
let gradientEnabled = $state(true);
const defaultGradientEnabled = getDefaultGradientEnabled();
let bannerTitleEnabled = $state(true);
const defaultBannerTitleEnabled = getDefaultBannerTitleEnabled();
let bannerCarouselEnabled = $state(true);
// 轮播「默认值」按当前壁纸模式取管理台分模式开关（modeCarousel），与前台轮播的生效顺序一致：
// 访客没动过开关时显示该模式的默认值，动过以访客存储为准
let defaultBannerCarouselEnabled = $derived(
	wallpaperMode === WALLPAPER_BANNER ||
		wallpaperMode === WALLPAPER_FULLSCREEN ||
		wallpaperMode === WALLPAPER_OVERLAY
		? getModeCarouselEnabled(wallpaperMode)
		: getDefaultBannerCarouselEnabled(),
);
let sakuraEnabled = $state(true);
const defaultSakuraEnabled = getDefaultSakuraEnabled();
let snowEnabled = $state(true);
const defaultSnowEnabled = getDefaultSnowEnabled();
let danmakuEnabled = $state(true);
const defaultDanmakuEnabled = getDefaultDanmakuEnabled();
let danmakuDensity = $state<"low" | "mid" | "high">("mid");
let danmakuSpeed = $state<"slow" | "mid" | "fast">("mid");
let fireflyEnabled = $state(true);
const defaultFireflyEnabled = getDefaultFireflyEnabled();
let starfieldEnabled = $state(true);
const defaultStarfieldEnabled = getDefaultStarfieldEnabled();
let notesEnabled = $state(true);
const defaultNotesEnabled = getDefaultNotesEnabled();
let rainEnabled = $state(true);
const defaultRainEnabled = getDefaultRainEnabled();
let meteorEnabled = $state(true);
const defaultMeteorEnabled = getDefaultMeteorEnabled();
let bubblesEnabled = $state(true);
const defaultBubblesEnabled = getDefaultBubblesEnabled();
let heartsEnabled = $state(true);
const defaultHeartsEnabled = getDefaultHeartsEnabled();
let leavesEnabled = $state(true);
const defaultLeavesEnabled = getDefaultLeavesEnabled();
let clickEnabled = $state(true);
const defaultClickEnabled = getDefaultClickEnabled();
let overlayOpacity = $state(getDefaultOverlayOpacity());
const defaultOverlayOpacity = getDefaultOverlayOpacity();
let overlayBlur = $state(getDefaultOverlayBlur());
const defaultOverlayBlur = getDefaultOverlayBlur();
let overlayCardOpacity = $state(getDefaultOverlayCardOpacity());
const defaultOverlayCardOpacity = getDefaultOverlayCardOpacity();
let cardBorderEnabled = $state(false);
const defaultCardBorderEnabled = getDefaultCardBorderEnabled();
let cardFollowThemeEnabled = $state(false);
const defaultCardFollowThemeEnabled = getDefaultCardFollowThemeEnabled();

const isWallpaperSwitchable = displaySettingsConfig.wallpaperModeSwitchable;
const isFullscreenLayoutSwitchable = $derived(
	displaySettingsConfig.fullscreenLayoutSwitchable &&
		wallpaperMode === WALLPAPER_FULLSCREEN,
);
const allowLayoutSwitch = displaySettingsConfig.layoutSwitchable;
// 文章布局（列表/网格）开关：2026-10-25 晚曾定为只在文章/项目详情页出现，
// 当晚站长改回所有页面都显示（访客在哪都能切，不必先进文章）
let effectiveDefaultLayout = $derived(
	isMobileWidth ? mobileDefaultLayout : defaultLayout,
);
const showThemeColor = displaySettingsConfig.themeColorSwitchable;
const showNavbarStyle = displaySettingsConfig.navbarStyleSwitchable;
const showSiteMode = displaySettingsConfig.siteModeSwitchable;
const isWavesSwitchable = displaySettingsConfig.wavesSwitchable;
const isGradientSwitchable = displaySettingsConfig.gradientSwitchable;
// 检查是否启用横幅标题配置（功能开关，非用户切换开关）
const isBannerTitleEnabled =
	backgroundWallpaper.common?.homeText?.enable ?? false;
const isBannerTitleSwitchable =
	isBannerTitleEnabled && displaySettingsConfig.bannerTitleSwitchable;
const isBannerCarouselSwitchable =
	displaySettingsConfig.bannerCarouselSwitchable;
const isSakuraSwitchable = displaySettingsConfig.sakuraSwitchable;
const isSnowSwitchable = displaySettingsConfig.snowSwitchable;
const isFireflySwitchable = displaySettingsConfig.fireflySwitchable;
const isStarfieldSwitchable = displaySettingsConfig.starfieldSwitchable;
const isNotesSwitchable = displaySettingsConfig.notesSwitchable;
const isRainSwitchable = displaySettingsConfig.rainSwitchable;
const isMeteorSwitchable = displaySettingsConfig.meteorSwitchable;
const isBubblesSwitchable = displaySettingsConfig.bubblesSwitchable;
const isHeartsSwitchable = displaySettingsConfig.heartsSwitchable;
const isLeavesSwitchable = displaySettingsConfig.leavesSwitchable;
const isClickSwitchable = displaySettingsConfig.clickSwitchable;
const isCardBorderSwitchable = displaySettingsConfig.cardBorderSwitchable;
const isCardFollowThemeSwitchable =
	displaySettingsConfig.cardFollowThemeSwitchable;
// 是否有任何横幅设置可显示（后续添加新设置时在此处添加条件）
const hasBannerSettings =
	isWavesSwitchable ||
	isGradientSwitchable ||
	isBannerTitleSwitchable ||
	isBannerCarouselSwitchable;
const overlaySwitchableConfig = displaySettingsConfig.overlaySwitchable;
const isOverlaySettingsSwitchable =
	typeof overlaySwitchableConfig === "boolean" ? overlaySwitchableConfig : true;
const isOverlayOpacitySwitchable =
	typeof overlaySwitchableConfig === "boolean"
		? overlaySwitchableConfig
		: (overlaySwitchableConfig.opacity ?? false);
const isOverlayBlurSwitchable =
	typeof overlaySwitchableConfig === "boolean"
		? overlaySwitchableConfig
		: (overlaySwitchableConfig.blur ?? false);
const isOverlayCardOpacitySwitchable =
	typeof overlaySwitchableConfig === "boolean"
		? overlaySwitchableConfig
		: (overlaySwitchableConfig.cardOpacity ?? false);
const hasOverlaySettings =
	isOverlaySettingsSwitchable &&
	(isOverlayOpacitySwitchable ||
		isOverlayBlurSwitchable ||
		isOverlayCardOpacitySwitchable);
// 全屏壁纸模式的模糊渐变是否启用（按当前设备读取 fullscreen.blurRamp 配置，未配置默认开启）
const isFullscreenBlurRampEnabled = $derived.by(() => {
	const enable = backgroundWallpaper.fullscreen?.blurRamp?.enable;
	if (typeof enable === "boolean") return enable;
	if (!enable) return true;
	return isMobileViewport ? enable.mobile : enable.desktop;
});
let overlaySettingsIsDefault = $derived(
	(!isOverlayOpacitySwitchable || overlayOpacity === defaultOverlayOpacity) &&
		(!isOverlayBlurSwitchable || overlayBlur === defaultOverlayBlur) &&
		(!isOverlayCardOpacitySwitchable ||
			overlayCardOpacity === defaultOverlayCardOpacity),
);
// 横幅设置是否全部为默认值（用于控制恢复默认按钮的显隐）
let bannerSettingsIsDefault = $derived(
	(!isBannerTitleSwitchable ||
		bannerTitleEnabled === defaultBannerTitleEnabled) &&
		(!isWavesSwitchable || wavesEnabled === defaultWavesEnabled) &&
		(!isGradientSwitchable || gradientEnabled === defaultGradientEnabled) &&
		(!isBannerCarouselSwitchable ||
			bannerCarouselEnabled === defaultBannerCarouselEnabled),
);
let cardSettingsIsDefault = $derived(
	(!isCardBorderSwitchable || cardBorderEnabled === defaultCardBorderEnabled) &&
		(!isCardFollowThemeSwitchable ||
			cardFollowThemeEnabled === defaultCardFollowThemeEnabled),
);

const hasAnyContent = $derived(
	showThemeColor ||
		isWallpaperSwitchable ||
		isFullscreenLayoutSwitchable ||
		allowLayoutSwitch ||
		hasBannerSettings ||
		hasOverlaySettings ||
		isSakuraSwitchable,
);

// --- Tab visibility ---
const hasAppearanceTab = $derived(
	showThemeColor ||
		showSiteMode ||
		allowLayoutSwitch ||
		isCardBorderSwitchable ||
		isCardFollowThemeSwitchable,
);
const hasWallpaperTab = $derived(
	isWallpaperSwitchable ||
		isFullscreenLayoutSwitchable ||
		((wallpaperMode === WALLPAPER_OVERLAY ||
			wallpaperMode === WALLPAPER_FULLSCREEN) &&
			hasOverlaySettings) ||
		((wallpaperMode === WALLPAPER_BANNER ||
			wallpaperMode === WALLPAPER_FULLSCREEN) &&
			hasBannerSettings),
);
const hasEffectsTab = $derived(
	isSakuraSwitchable ||
		isSnowSwitchable ||
		isFireflySwitchable ||
		isStarfieldSwitchable ||
		isNotesSwitchable ||
		isRainSwitchable ||
		isMeteorSwitchable ||
		isBubblesSwitchable ||
		isHeartsSwitchable ||
		isLeavesSwitchable ||
		isClickSwitchable,
);
const effectsIsDefault = $derived(
	sakuraEnabled === defaultSakuraEnabled &&
		snowEnabled === defaultSnowEnabled &&
		fireflyEnabled === defaultFireflyEnabled &&
		starfieldEnabled === defaultStarfieldEnabled &&
		notesEnabled === defaultNotesEnabled &&
		rainEnabled === defaultRainEnabled &&
		meteorEnabled === defaultMeteorEnabled &&
		bubblesEnabled === defaultBubblesEnabled &&
		heartsEnabled === defaultHeartsEnabled &&
		leavesEnabled === defaultLeavesEnabled &&
		clickEnabled === defaultClickEnabled,
);

let visibleTabs = $derived.by(() => {
	const tabs: { key: TabKey; icon: string; label: string }[] = [];
	if (hasAppearanceTab)
		tabs.push({
			key: "appearance",
			icon: "material-symbols:palette",
			label: i18n(I18nKey.settingsTabAppearance),
		});
	if (hasWallpaperTab && !isPure)
		tabs.push({
			key: "wallpaper",
			icon: "material-symbols:wallpaper",
			label: i18n(I18nKey.settingsTabWallpaper),
		});
	if (hasEffectsTab && !isPure)
		tabs.push({
			key: "effects",
			icon: "mdi:flower-poppy",
			label: i18n(I18nKey.settingsTabEffects),
		});
	return tabs;
});

let showTabBar = $derived(visibleTabs.length > 1);
let activeTab = $state<TabKey>("appearance");

// Auto-switch active tab if it becomes invisible
$effect(() => {
	if (!visibleTabs.find((t) => t.key === activeTab) && visibleTabs.length > 0) {
		activeTab = visibleTabs[0].key;
	}
});

// Auto-switch to wallpaper tab when entering overlay/fullscreen mode
$effect(() => {
	if (
		(wallpaperMode === WALLPAPER_OVERLAY ||
			wallpaperMode === WALLPAPER_FULLSCREEN) &&
		hasOverlaySettings
	) {
		activeTab = "wallpaper";
	}
});

let overlaySliderItems = $derived<OverlaySliderItem[]>([
	{
		key: "opacity",
		// 全屏壁纸模式不需要背景透明度，隐藏该滑块（仍显示模糊与卡片透明度）
		enabled:
			isOverlayOpacitySwitchable && wallpaperMode !== WALLPAPER_FULLSCREEN,
		label: i18n(I18nKey.overlayOpacity),
		displayValue: `${Math.round(overlayOpacity * 100)}%`,
		ariaLabel: i18n(I18nKey.overlayOpacity),
		min: 20,
		max: 100,
		step: 1,
		value: Math.round(overlayOpacity * 100),
		onValueChange: (value) => {
			overlayOpacity = value / 100;
		},
	},
	{
		key: "blur",
		// 全屏壁纸模式关闭模糊渐变时隐藏模糊滑块（overlay 模式不受影响）
		enabled:
			isOverlayBlurSwitchable &&
			!(wallpaperMode === WALLPAPER_FULLSCREEN && !isFullscreenBlurRampEnabled),
		label: i18n(I18nKey.overlayBlur),
		displayValue: `${overlayBlur.toFixed(1)}px`,
		ariaLabel: i18n(I18nKey.overlayBlur),
		min: 0,
		max: 20,
		step: 0.5,
		value: overlayBlur,
		onValueChange: (value) => {
			overlayBlur = value;
		},
	},
	{
		key: "cardOpacity",
		enabled: isOverlayCardOpacitySwitchable,
		label: i18n(I18nKey.overlayCardOpacity),
		displayValue: `${Math.round(overlayCardOpacity * 100)}%`,
		ariaLabel: i18n(I18nKey.overlayCardOpacity),
		min: 20,
		max: 100,
		step: 1,
		value: Math.round(overlayCardOpacity * 100),
		onValueChange: (value) => {
			overlayCardOpacity = value / 100;
		},
	},
]);
// 当前模式下是否有任何 overlay 滑块实际可见（模糊滑块可能因关闭模糊渐变而隐藏）
let hasVisibleOverlaySlider = $derived(
	overlaySliderItems.some((item) => item.enabled),
);

function resetHue() {
	hue = getDefaultHue();
	requestAnimationFrame(refreshAllRangeProgress);
}

function resetNavbarStyle() {
	navbarStyle = defaultNavbarStyle;
}

function resetSiteMode() {
	siteMode = defaultSiteMode;
}

function resetWallpaperMode() {
	wallpaperMode = defaultWallpaperMode;
	setWallpaperMode(defaultWallpaperMode);
}

function resetFullscreenLayout() {
	fullscreenLayout = defaultFullscreenLayout;
	setFullscreenLayout(defaultFullscreenLayout);
}

function switchFullscreenLayout(layout: FullscreenWallpaperLayout) {
	if (fullscreenLayout === layout) return;
	fullscreenLayout = layout;
	setFullscreenLayout(layout);
}

function resetLayout() {
	currentLayout = effectiveDefaultLayout;
	localStorage.removeItem("postListLayout");

	// 触发自定义事件，通知页面布局已改变
	const event = new CustomEvent("layoutChange", {
		detail: { layout: effectiveDefaultLayout },
	});
	window.dispatchEvent(event);
}

function resetWavesEnabled() {
	wavesEnabled = defaultWavesEnabled;
	setWavesEnabled(defaultWavesEnabled);
}

function resetGradientEnabled() {
	gradientEnabled = defaultGradientEnabled;
	setGradientEnabled(defaultGradientEnabled);
}

function resetBannerSettings() {
	if (
		isBannerTitleSwitchable &&
		bannerTitleEnabled !== defaultBannerTitleEnabled
	) {
		bannerTitleEnabled = defaultBannerTitleEnabled;
		setBannerTitleEnabled(defaultBannerTitleEnabled);
	}
	if (isWavesSwitchable && wavesEnabled !== defaultWavesEnabled) {
		wavesEnabled = defaultWavesEnabled;
		setWavesEnabled(defaultWavesEnabled);
	}
	if (isGradientSwitchable && gradientEnabled !== defaultGradientEnabled) {
		gradientEnabled = defaultGradientEnabled;
		setGradientEnabled(defaultGradientEnabled);
	}
	if (
		isBannerCarouselSwitchable &&
		bannerCarouselEnabled !== defaultBannerCarouselEnabled
	) {
		bannerCarouselEnabled = defaultBannerCarouselEnabled;
		setBannerCarouselEnabled(defaultBannerCarouselEnabled);
	}
}

function resetOverlaySettings() {
	if (isOverlayOpacitySwitchable && overlayOpacity !== defaultOverlayOpacity) {
		overlayOpacity = defaultOverlayOpacity;
		setOverlayOpacity(defaultOverlayOpacity);
	}
	if (isOverlayBlurSwitchable && overlayBlur !== defaultOverlayBlur) {
		overlayBlur = defaultOverlayBlur;
		setOverlayBlur(defaultOverlayBlur);
	}
	if (
		isOverlayCardOpacitySwitchable &&
		overlayCardOpacity !== defaultOverlayCardOpacity
	) {
		overlayCardOpacity = defaultOverlayCardOpacity;
		setOverlayCardOpacity(defaultOverlayCardOpacity);
	}

	requestAnimationFrame(refreshAllRangeProgress);
}

function toggleWavesEnabled() {
	wavesEnabled = !wavesEnabled;
	setWavesEnabled(wavesEnabled);
}

function toggleGradientEnabled() {
	gradientEnabled = !gradientEnabled;
	setGradientEnabled(gradientEnabled);
}

function toggleBannerTitleEnabled() {
	bannerTitleEnabled = !bannerTitleEnabled;
	setBannerTitleEnabled(bannerTitleEnabled);
}

function toggleBannerCarouselEnabled() {
	bannerCarouselEnabled = !bannerCarouselEnabled;
	setBannerCarouselEnabled(bannerCarouselEnabled);
}

function toggleSakuraEnabled() {
	sakuraEnabled = !sakuraEnabled;
	setSakuraEnabled(sakuraEnabled);
}

function toggleSnowEnabled() {
	snowEnabled = !snowEnabled;
	setSnowEnabled(snowEnabled);
}

function toggleDanmakuEnabled() {
	danmakuEnabled = !danmakuEnabled;
	setDanmakuEnabled(danmakuEnabled);
}

function toggleFireflyEnabled() {
	fireflyEnabled = !fireflyEnabled;
	setFireflyEnabled(fireflyEnabled);
}

function toggleStarfieldEnabled() {
	starfieldEnabled = !starfieldEnabled;
	setStarfieldEnabled(starfieldEnabled);
}

function toggleNotesEnabled() {
	notesEnabled = !notesEnabled;
	setNotesEnabled(notesEnabled);
}

function toggleRainEnabled() {
	rainEnabled = !rainEnabled;
	setRainEnabled(rainEnabled);
}

function toggleMeteorEnabled() {
	meteorEnabled = !meteorEnabled;
	setMeteorEnabled(meteorEnabled);
}

function toggleBubblesEnabled() {
	bubblesEnabled = !bubblesEnabled;
	setBubblesEnabled(bubblesEnabled);
}

function toggleHeartsEnabled() {
	heartsEnabled = !heartsEnabled;
	setHeartsEnabled(heartsEnabled);
}

function toggleLeavesEnabled() {
	leavesEnabled = !leavesEnabled;
	setLeavesEnabled(leavesEnabled);
}

function toggleClickEnabled() {
	clickEnabled = !clickEnabled;
	setClickEnabled(clickEnabled);
}


function resetEffects() {
	sakuraEnabled = defaultSakuraEnabled;
	setSakuraEnabled(defaultSakuraEnabled);
	snowEnabled = defaultSnowEnabled;
	setSnowEnabled(defaultSnowEnabled);
	fireflyEnabled = defaultFireflyEnabled;
	setFireflyEnabled(defaultFireflyEnabled);
	starfieldEnabled = defaultStarfieldEnabled;
	setStarfieldEnabled(defaultStarfieldEnabled);
	notesEnabled = defaultNotesEnabled;
	setNotesEnabled(defaultNotesEnabled);
	rainEnabled = defaultRainEnabled;
	setRainEnabled(defaultRainEnabled);
	meteorEnabled = defaultMeteorEnabled;
	setMeteorEnabled(defaultMeteorEnabled);
	bubblesEnabled = defaultBubblesEnabled;
	setBubblesEnabled(defaultBubblesEnabled);
	heartsEnabled = defaultHeartsEnabled;
	setHeartsEnabled(defaultHeartsEnabled);
	leavesEnabled = defaultLeavesEnabled;
	setLeavesEnabled(defaultLeavesEnabled);
	clickEnabled = defaultClickEnabled;
	setClickEnabled(defaultClickEnabled);
}

function toggleCardBorderEnabled() {
	cardBorderEnabled = !cardBorderEnabled;
	setCardBorderEnabled(cardBorderEnabled);
}

function toggleCardFollowThemeEnabled() {
	cardFollowThemeEnabled = !cardFollowThemeEnabled;
	setCardFollowThemeEnabled(cardFollowThemeEnabled);
}

function resetCardSettings() {
	if (
		isCardBorderSwitchable &&
		cardBorderEnabled !== defaultCardBorderEnabled
	) {
		cardBorderEnabled = defaultCardBorderEnabled;
		setCardBorderEnabled(defaultCardBorderEnabled);
	}
	if (
		isCardFollowThemeSwitchable &&
		cardFollowThemeEnabled !== defaultCardFollowThemeEnabled
	) {
		cardFollowThemeEnabled = defaultCardFollowThemeEnabled;
		setCardFollowThemeEnabled(defaultCardFollowThemeEnabled);
	}
}

function switchWallpaperMode(newMode: WALLPAPER_MODE) {
	wallpaperMode = newMode;
	setWallpaperMode(newMode);
	window.scrollTo({ top: 0 });

	if (newMode === WALLPAPER_OVERLAY || newMode === WALLPAPER_FULLSCREEN) {
		requestAnimationFrame(refreshAllRangeProgress);
	}
}

function checkScreenSize() {
	isSmallScreen = window.innerWidth < 1200;
	isMobileWidth = window.innerWidth < 780;
	isMobileViewport = window.innerWidth < 1024;
	// 低于380px强制网格模式
	if (window.innerWidth < 380 && currentLayout === "list") {
		currentLayout = "grid";
		const event = new CustomEvent("layoutChange", {
			detail: { layout: "grid" },
		});
		window.dispatchEvent(event);
	}
}

function updateRangeProgress(input: HTMLInputElement) {
	const min = Number(input.min || 0);
	const max = Number(input.max || 100);
	const value = Number(input.value || 0);
	const progress = ((value - min) * 100) / (max - min || 1);
	input.style.setProperty(
		"--range-progress",
		`${Math.min(100, Math.max(0, progress))}%`,
	);
}

function refreshAllRangeProgress() {
	const panel = document.getElementById("display-setting");
	if (!panel) return;

	const rangeInputs = Array.from(
		panel.querySelectorAll('input[type="range"]'),
	) as HTMLInputElement[];

	rangeInputs.forEach((input) => {
		updateRangeProgress(input);
	});
}

function switchLayout() {
	if (!mounted || isSwitching) return;

	isSwitching = true;
	currentLayout = currentLayout === "list" ? "grid" : "list";
	localStorage.setItem("postListLayout", currentLayout);

	// 触发自定义事件，通知页面布局已改变
	const event = new CustomEvent("layoutChange", {
		detail: { layout: currentLayout },
	});
	window.dispatchEvent(event);

	// 动画完成后重置状态
	setTimeout(() => {
		isSwitching = false;
	}, 500);
}

onMount(() => {
	mounted = true;
	checkScreenSize();

	// 从localStorage读取保存的壁纸模式
	wallpaperMode = getStoredWallpaperMode();

	// 从localStorage读取保存的全屏壁纸布局
	fullscreenLayout = getStoredFullscreenLayout();

	// 从localStorage读取水波纹动画状态
	wavesEnabled = getStoredWavesEnabled();

	// 从localStorage读取渐变过渡状态
	gradientEnabled = getStoredGradientEnabled();

	// 从localStorage读取横幅标题状态
	bannerTitleEnabled = getStoredBannerTitleEnabled();

	// 从localStorage读取横幅轮播状态
	bannerCarouselEnabled = getStoredBannerCarouselEnabled();

	// 从localStorage读取樱花特效状态
	sakuraEnabled = getStoredSakuraEnabled();

	// 从localStorage读取雪花 / 萤火虫特效状态
	snowEnabled = getStoredSnowEnabled();
	danmakuEnabled = getStoredDanmakuEnabled();
	danmakuDensity = getDanmakuDensity();
	danmakuSpeed = getDanmakuSpeed();
	fireflyEnabled = getStoredFireflyEnabled();
	starfieldEnabled = getStoredStarfieldEnabled();
	notesEnabled = getStoredNotesEnabled();
	rainEnabled = getStoredRainEnabled();
	meteorEnabled = getStoredMeteorEnabled();
	bubblesEnabled = getStoredBubblesEnabled();
	heartsEnabled = getStoredHeartsEnabled();
	leavesEnabled = getStoredLeavesEnabled();
	clickEnabled = getStoredClickEnabled();

	// 从localStorage读取卡片样式状态
	cardBorderEnabled = getStoredCardBorderEnabled();
	cardFollowThemeEnabled = getStoredCardFollowThemeEnabled();

	// 从localStorage读取全屏透明设置状态
	overlayOpacity = getStoredOverlayOpacity();
	overlayBlur = getStoredOverlayBlur();
	overlayCardOpacity = getStoredOverlayCardOpacity();

	// 从localStorage读取用户偏好布局
	const savedLayout = localStorage.getItem("postListLayout");
	if (savedLayout && (savedLayout === "list" || savedLayout === "grid")) {
		currentLayout = savedLayout;
	} else {
		currentLayout =
			window.innerWidth < 780 ? mobileDefaultLayout : defaultLayout;
	}

	// 监听窗口大小变化
	window.addEventListener("resize", checkScreenSize);

	return () => {
		window.removeEventListener("resize", checkScreenSize);
	};
});

// 监听布局变化事件
onMount(() => {
	const handleCustomEvent = (event: Event) => {
		const customEvent = event as CustomEvent<{ layout: "list" | "grid" }>;
		currentLayout = customEvent.detail.layout;
	};

	window.addEventListener("layoutChange", handleCustomEvent);

	return () => {
		window.removeEventListener("layoutChange", handleCustomEvent);
	};
});

onMount(() => {
	const panel = document.getElementById("display-setting");
	if (!panel) return;

	const handleRangeInput = (event: Event) => {
		const target = event.target;
		if (target instanceof HTMLInputElement && target.type === "range") {
			updateRangeProgress(target);
		}
	};

	refreshAllRangeProgress();
	panel.addEventListener("input", handleRangeInput);

	return () => {
		panel.removeEventListener("input", handleRangeInput);
	};
});

onMount(() => {
	const handleWallpaperModeChange = (event: Event) => {
		const customEvent = event as CustomEvent<{ mode: WALLPAPER_MODE }>;
		wallpaperMode = customEvent.detail.mode;
		// 访客没手动设置过轮播时，开关显示跟随新模式的管理台默认值（modeCarousel）
		if (localStorage.getItem("bannerCarouselEnabled") === null) {
			const m = customEvent.detail.mode;
			if (
				m === WALLPAPER_BANNER ||
				m === WALLPAPER_FULLSCREEN ||
				m === WALLPAPER_OVERLAY
			) {
				bannerCarouselEnabled = getModeCarouselEnabled(m);
			}
		}
	};

	window.addEventListener("wallpaperModeChange", handleWallpaperModeChange);

	return () => {
		window.removeEventListener(
			"wallpaperModeChange",
			handleWallpaperModeChange,
		);
	};
});

$effect(() => {
	if (hue || hue === 0) {
		setHue(hue);
	}
});

$effect(() => {
	setNavbarStyle(navbarStyle);
});

$effect(() => {
	setSiteMode(siteMode);
});

$effect(() => {
	setAstralTheme(astralTheme);
});

$effect(() => {
	setAstralLayout(astralLayout);
});

$effect(() => {
	setPureFont(pureFont);
});

$effect(() => {
	setHarmonyScheme(harmonyScheme);
});

$effect(() => {
	setHarmonySpec(harmonySpec);
});

$effect(() => {
	setHarmonyTexture(harmonyTexture);
});

$effect(() => {
	setHarmonyTextureOpacity(harmonyTextureOpacity);
});

$effect(() => {
	setHarmonyMotionReduced(harmonyMotionReduced);
});

$effect(() => {
	if (
		wallpaperMode === WALLPAPER_OVERLAY ||
		wallpaperMode === WALLPAPER_FULLSCREEN
	) {
		setHarmonyOverlayOpacity(harmonyOverlayOpacity);
		setHarmonyOverlayBlur(harmonyOverlayBlur);
		setHarmonyOverlayCardOpacity(harmonyOverlayCardOpacity);
	}
});

$effect(() => {
	if (wallpaperMode === WALLPAPER_OVERLAY) {
		if (isOverlayOpacitySwitchable) {
			setOverlayOpacity(overlayOpacity);
		}
		if (isOverlayBlurSwitchable) {
			setOverlayBlur(overlayBlur);
		}
		if (isOverlayCardOpacitySwitchable) {
			setOverlayCardOpacity(overlayCardOpacity);
		}
	} else if (wallpaperMode === WALLPAPER_FULLSCREEN) {
		// 全屏壁纸不透明，只应用模糊与卡片透明度
		if (isOverlayBlurSwitchable) {
			setOverlayBlur(overlayBlur);
		}
		if (isOverlayCardOpacitySwitchable) {
			setOverlayCardOpacity(overlayCardOpacity);
		}
	}
});

// Tab 切换后刷新滑块进度（overlay 滑块在 DOM 中才生效）
$effect(() => {
	// eslint-disable-next-line @typescript-eslint/no-unused-expressions
	activeTab;
	requestAnimationFrame(refreshAllRangeProgress);
});
</script>

{#if hasAnyContent}
<div id="display-setting" class="float-panel float-panel-closed absolute transition-all w-80 right-4 px-3 pt-0 pb-3 max-h-[80vh] overflow-y-auto custom-scrollbar" data-floating-panel data-floating-panel-trigger="display-settings-switch" inert aria-hidden="true">
	<!-- Tab Bar -->
	{#if showTabBar}
	<div class="flex gap-1 border-b border-black/5 dark:border-white/10 pt-3 pb-1 mb-3">
		{#each visibleTabs as tab (tab.key)}
			<button
				class="focus-ring-inset flex-1 flex flex-col items-center justify-center gap-1.5 py-2 px-2 text-xs font-medium transition-colors rounded-lg min-w-0
					{activeTab === tab.key
						? 'bg-(--btn-plain-bg-hover) text-(--primary)'
						: 'text-gray-500 dark:text-gray-400 hover:bg-(--btn-plain-bg-hover) hover:text-gray-700 dark:hover:text-gray-300'}"
				onclick={() => activeTab = tab.key}
			>
				<Icon icon={tab.icon} class="text-[1.5rem] shrink-0"></Icon>
				<span class="truncate">{tab.label}</span>
			</button>
		{/each}
	</div>
	{/if}

	<!-- Appearance Tab: Theme Color + Layout -->
	{#if activeTab === "appearance"}
		<!-- Theme Color Section（谐彩下由专属色相滑杆接管、顽彩配色固定，隐藏全站主题色） -->
		{#if showThemeColor && !isPure && !isHarmony && !isBrick && !isAstral}
		<div class="">
			<div class="section-title">
				{i18n(I18nKey.themeColor)}
				<button aria-label="Reset to Default" class="btn-regular rounded-md active:scale-90"
						class:opacity-0={hue === defaultHue} class:pointer-events-none={hue === defaultHue}
						disabled={hue === defaultHue} aria-hidden={hue === defaultHue ? "true" : undefined} onclick={resetHue}>
					<div class="text-(--btn-content)">
						<Icon icon="fa7-solid:arrow-rotate-left" class="text-[0.75rem]"></Icon>
					</div>
				</button>
				<div id="hueValue" class="transition bg-(--btn-regular-bg) rounded-md flex justify-center
				font-bold items-center text-(--btn-content)">
					{hue}
				</div>
			</div>
			<div class="hue-slider-shell w-full h-6 px-1 bg-[oklch(0.80_0.10_0)] dark:bg-[oklch(0.70_0.10_0)] rounded-md select-none">
				<input aria-label={i18n(I18nKey.themeColor)} type="range" min="0" max="360" bind:value={hue}
					   class="slider" id="colorSlider" step="5" style="width: 100%">
			</div>
		</div>
		{/if}

		<!-- Navbar Style Section（谐彩的导航是 Top App Bar 形态、顽彩是积木顶栏，隐藏全站导航样式） -->
		{#if showNavbarStyle && !isPure && !isHarmony && !isBrick && !isAstral}
		<div class="">
			<div class="section-title">
				{i18n(I18nKey.navbarStyle)}
				<button aria-label="Reset to Default" class="btn-regular rounded-md active:scale-90"
						class:opacity-0={navbarStyle === defaultNavbarStyle} class:pointer-events-none={navbarStyle === defaultNavbarStyle}
						disabled={navbarStyle === defaultNavbarStyle} aria-hidden={navbarStyle === defaultNavbarStyle ? "true" : undefined} onclick={resetNavbarStyle}>
					<div class="text-(--btn-content)">
						<Icon icon="fa7-solid:arrow-rotate-left" class="text-[0.75rem]"></Icon>
					</div>
				</button>
			</div>
			<div class="flex flex-wrap gap-2">
				{#each navbarStyleOptions as opt}
				<button
					aria-label={i18n(opt.labelKey)}
					class="flex-1 min-w-[45%] btn-regular rounded-md py-2 px-3 flex items-center justify-center gap-2 active:scale-95 transition-all relative overflow-hidden"
					class:opacity-60={navbarStyle !== opt.value}
					class:bg-(--btn-regular-bg-hover)={navbarStyle === opt.value}
					onclick={() => { navbarStyle = opt.value; }}
					title={i18n(opt.labelKey)}
				>
					<span class="text-xs font-medium">{i18n(opt.labelKey)}</span>
				</button>
				{/each}
			</div>
		</div>
		{/if}

		<!-- Site Mode Section -->
		{#if showSiteMode}
		<div class="">
			<div class="section-title">
				{i18n(I18nKey.siteMode)}
				<button aria-label="Reset to Default" class="btn-regular rounded-md active:scale-90"
						class:opacity-0={siteMode === defaultSiteMode} class:pointer-events-none={siteMode === defaultSiteMode}
						disabled={siteMode === defaultSiteMode} aria-hidden={siteMode === defaultSiteMode ? "true" : undefined} onclick={resetSiteMode}>
					<div class="text-(--btn-content)">
						<Icon icon="fa7-solid:arrow-rotate-left" class="text-[0.75rem]"></Icon>
					</div>
				</button>
			</div>
			<div class="flex flex-wrap gap-2">
				{#each siteModeOptions as opt}
				<button
					aria-label={i18n(opt.labelKey)}
					class="flex-1 min-w-[45%] btn-regular rounded-md py-2 px-3 flex items-center justify-center gap-2 active:scale-95 transition-all relative overflow-hidden"
					class:opacity-60={siteMode !== opt.value}
					class:bg-(--btn-regular-bg-hover)={siteMode === opt.value}
					onclick={() => { siteMode = opt.value; }}
					title={i18n(opt.labelKey)}
				>
					<span class="text-xs font-medium">{i18n(opt.labelKey)}</span>
				</button>
				{/each}
			</div>
			<!-- 璨夜子主题（仅璨夜出现）：站点形态的子选项，实面 = 稳定实面卡，星尘 = 玻璃星空版 -->
			{#if isAstral}
			<div class="text-xs font-bold text-(--btn-content) opacity-80 mt-3 mb-1.5">璨夜主题</div>
			<div class="flex flex-wrap gap-2">
				{#each astralThemeOptions as opt}
				<button
					aria-label={opt.label}
					class="flex-1 min-w-[45%] btn-regular rounded-md py-2 px-3 flex items-center justify-center gap-2 active:scale-95 transition-all relative overflow-hidden"
					class:opacity-60={astralTheme !== opt.value}
					class:bg-(--btn-regular-bg-hover)={astralTheme === opt.value}
					onclick={() => { astralTheme = opt.value; }}
					title={opt.label}
				>
					<span class="text-xs font-medium">{opt.label}</span>
				</button>
				{/each}
			</div>
			<div class="text-xs text-neutral-500 dark:text-neutral-400 mt-1.5">实面：近不透明实面卡，稳定优先 · 星尘：毛玻璃星空版（面纱层 + 半透卡片）</div>
			{/if}
			<!-- 璨夜主题布局（仅璨夜出现）：经典 = Firefly 经典骨架 + 璨夜皮肤，璨夜 = 现行 bento 瓷砖矩阵 -->
			{#if isAstral}
			<div class="text-xs font-bold text-(--btn-content) opacity-80 mt-3 mb-1.5">主题布局</div>
			<div class="flex flex-wrap gap-2">
				{#each astralLayoutOptions as opt}
				<button
					aria-label={opt.label}
					class="flex-1 min-w-[45%] btn-regular rounded-md py-2 px-3 flex items-center justify-center gap-2 active:scale-95 transition-all relative overflow-hidden"
					class:opacity-60={astralLayout !== opt.value}
					class:bg-(--btn-regular-bg-hover)={astralLayout === opt.value}
					onclick={() => { astralLayout = opt.value; }}
					title={opt.label}
				>
					<span class="text-xs font-medium">{opt.label}</span>
				</button>
				{/each}
			</div>
			<div class="text-xs text-neutral-500 dark:text-neutral-400 mt-1.5">经典：Firefly 经典版式（横幅 + 侧栏 + 文章流），保留璨夜皮肤 · 璨夜：现行首页瓷砖矩阵</div>
			{/if}
		</div>
		{/if}

		<!-- Harmony Palette Section（仅谐彩：专属调色板，存储键 harmony*，切回华彩/素简不生效） -->
		{#if isHarmony}
		<div class="">
			<div class="section-title">
				{i18n(I18nKey.harmonySettings)}
				<button aria-label="Reset to Default" class="btn-regular rounded-md active:scale-90"
						class:opacity-0={harmonyIsDefault} class:pointer-events-none={harmonyIsDefault}
						disabled={harmonyIsDefault} aria-hidden={harmonyIsDefault ? "true" : undefined} onclick={resetHarmonySettings}>
					<div class="text-(--btn-content)">
						<Icon icon="fa7-solid:arrow-rotate-left" class="text-[0.75rem]"></Icon>
					</div>
				</button>
				<div class="transition bg-(--btn-regular-bg) rounded-md flex justify-center font-bold items-center text-(--btn-content) ml-auto w-9 h-6 text-xs">
					{harmonyHue}
				</div>
			</div>
			<!-- 种子色相（未单独设置时跟随全站主题色，拖动后存 harmonyHue） -->
			<div class="hue-slider-shell w-full h-6 px-1 bg-[oklch(0.80_0.10_0)] dark:bg-[oklch(0.70_0.10_0)] rounded-md select-none">
				<input aria-label={i18n(I18nKey.themeColor)} type="range" min="0" max="360" step="5" value={harmonyHue}
					   oninput={(e) => onHarmonyHueInput(Number((e.currentTarget as HTMLInputElement).value))}
					   class="slider" style="width: 100%">
			</div>

			<!-- 色彩风格：3×3 色卡（圆点 = 该风格在当前色相下的主/次/三角色） -->
			<div class="text-xs font-bold text-(--btn-content) opacity-80 mt-3 mb-1.5">{i18n(I18nKey.harmonyScheme)}</div>
			<div class="grid grid-cols-3 gap-2">
				{#each harmonySchemeOptions as opt}
				<button
					aria-label={i18n(opt.labelKey)}
					class="btn-regular rounded-md py-2 px-2 flex flex-col items-center justify-center gap-1.5 active:scale-95 transition-all relative overflow-hidden"
					class:opacity-60={harmonyScheme !== opt.value}
					class:bg-(--btn-regular-bg-hover)={harmonyScheme === opt.value}
					onclick={() => { harmonyScheme = opt.value; }}
					title={i18n(opt.labelKey)}
				>
					<span class="flex gap-1">
						<span class="w-3 h-3 rounded-full" style="background: {harmonyDot(HARMONY_SCHEME_PREVIEW[opt.value].p)}"></span>
						<span class="w-3 h-3 rounded-full" style="background: {harmonyDot(HARMONY_SCHEME_PREVIEW[opt.value].s)}"></span>
						<span class="w-3 h-3 rounded-full" style="background: {harmonyDot(HARMONY_SCHEME_PREVIEW[opt.value].t)}"></span>
					</span>
					<span class="text-xs font-medium">{i18n(opt.labelKey)}</span>
				</button>
				{/each}
			</div>

			<!-- 色彩规范 -->
			<div class="text-xs font-bold text-(--btn-content) opacity-80 mt-3 mb-1.5">{i18n(I18nKey.harmonySpec)}</div>
			<div class="flex gap-2">
				<button
					aria-label={i18n(I18nKey.harmonySpec2021)}
					class="flex-1 btn-regular rounded-md py-2 px-3 flex items-center justify-center gap-2 active:scale-95 transition-all relative overflow-hidden"
					class:opacity-60={harmonySpec !== "2021"}
					class:bg-(--btn-regular-bg-hover)={harmonySpec === "2021"}
					onclick={() => { harmonySpec = "2021"; }}
					title={i18n(I18nKey.harmonySpec2021)}
				>
					<span class="text-xs font-medium">{i18n(I18nKey.harmonySpec2021)}</span>
				</button>
				<button
					aria-label={i18n(I18nKey.harmonySpec2025)}
					class="flex-1 btn-regular rounded-md py-2 px-3 flex items-center justify-center gap-2 active:scale-95 transition-all relative overflow-hidden"
					class:opacity-60={harmonySpec !== "2025"}
					class:bg-(--btn-regular-bg-hover)={harmonySpec === "2025"}
					onclick={() => { harmonySpec = "2025"; }}
					title={i18n(I18nKey.harmonySpec2025)}
				>
					<span class="text-xs font-medium">{i18n(I18nKey.harmonySpec2025)}</span>
				</button>
			</div>

			<!-- 背景纹理 -->
			<div class="text-xs font-bold text-(--btn-content) opacity-80 mt-3 mb-1.5">{i18n(I18nKey.harmonyTexture)}</div>
			<div class="grid grid-cols-3 gap-2">
				{#each harmonyTextureOptions as opt}
				<button
					aria-label={i18n(opt.labelKey)}
					class="btn-regular rounded-md py-2 px-3 flex items-center justify-center gap-2 active:scale-95 transition-all relative overflow-hidden"
					class:opacity-60={harmonyTexture !== opt.value}
					class:bg-(--btn-regular-bg-hover)={harmonyTexture === opt.value}
					onclick={() => { harmonyTexture = opt.value; }}
					title={i18n(opt.labelKey)}
				>
					<span class="text-xs font-medium">{i18n(opt.labelKey)}</span>
				</button>
				{/each}
			</div>
			<div class="rounded-md bg-(--btn-regular-bg) p-2 mt-2">
				<div class="flex items-center justify-between mb-1">
					<span class="text-xs font-medium text-(--btn-content) opacity-80">{i18n(I18nKey.harmonyTextureOpacity)}</span>
					<span class="text-xs text-(--btn-content)">{Math.round(harmonyTextureOpacity * 100)}%</span>
				</div>
				<input
					aria-label={i18n(I18nKey.harmonyTextureOpacity)}
					type="range"
					min="0"
					max="100"
					step="1"
					value={Math.round(harmonyTextureOpacity * 100)}
					oninput={(e) => { harmonyTextureOpacity = Number((e.currentTarget as HTMLInputElement).value) / 100; }}
					class="slider w-full"
				/>
			</div>

			<!-- Overlay 三项（仅 overlay / 全屏 hero 时出现，与壁纸页签的全站 overlay 设置分开存） -->
			{#if wallpaperMode === WALLPAPER_OVERLAY || (wallpaperMode === WALLPAPER_FULLSCREEN && fullscreenLayout === "hero")}
			<div class="text-xs font-bold text-(--btn-content) opacity-80 mt-3 mb-1.5">{i18n(I18nKey.overlaySettings)}</div>
			<div class="space-y-2">
				{#if wallpaperMode === WALLPAPER_OVERLAY}
				<div class="rounded-md bg-(--btn-regular-bg) p-2">
					<div class="flex items-center justify-between mb-1">
						<span class="text-xs font-medium text-(--btn-content) opacity-80">{i18n(I18nKey.overlayOpacity)}</span>
						<span class="text-xs text-(--btn-content)">{Math.round(harmonyOverlayOpacity * 100)}%</span>
					</div>
					<input
						aria-label={i18n(I18nKey.overlayOpacity)}
						type="range"
						min="20"
						max="100"
						step="1"
						value={Math.round(harmonyOverlayOpacity * 100)}
						oninput={(e) => { harmonyOverlayOpacity = Number((e.currentTarget as HTMLInputElement).value) / 100; }}
						class="slider w-full"
					/>
				</div>
				{/if}
				<div class="rounded-md bg-(--btn-regular-bg) p-2">
					<div class="flex items-center justify-between mb-1">
						<span class="text-xs font-medium text-(--btn-content) opacity-80">{i18n(I18nKey.overlayBlur)}</span>
						<span class="text-xs text-(--btn-content)">{harmonyOverlayBlur.toFixed(1)}px</span>
					</div>
					<input
						aria-label={i18n(I18nKey.overlayBlur)}
						type="range"
						min="0"
						max="20"
						step="0.5"
						value={harmonyOverlayBlur}
						oninput={(e) => { harmonyOverlayBlur = Number((e.currentTarget as HTMLInputElement).value); }}
						class="slider w-full"
					/>
				</div>
				<div class="rounded-md bg-(--btn-regular-bg) p-2">
					<div class="flex items-center justify-between mb-1">
						<span class="text-xs font-medium text-(--btn-content) opacity-80">{i18n(I18nKey.overlayCardOpacity)}</span>
						<span class="text-xs text-(--btn-content)">{Math.round(harmonyOverlayCardOpacity * 100)}%</span>
					</div>
					<input
						aria-label={i18n(I18nKey.overlayCardOpacity)}
						type="range"
						min="20"
						max="100"
						step="1"
						value={Math.round(harmonyOverlayCardOpacity * 100)}
						oninput={(e) => { harmonyOverlayCardOpacity = Number((e.currentTarget as HTMLInputElement).value) / 100; }}
						class="slider w-full"
					/>
				</div>
			</div>
			{/if}

			<!-- 减少动态 -->
			<button
				class="w-full btn-regular rounded-md py-2 px-3 flex items-center gap-3 text-left active:scale-95 transition-all relative overflow-hidden mt-3"
				class:bg-(--btn-regular-bg-hover)={harmonyMotionReduced}
				onclick={() => { harmonyMotionReduced = !harmonyMotionReduced; }}
			>
				<Icon icon="material-symbols:motion-photos-off" class="text-[1.25rem] shrink-0"></Icon>
				<span class="text-sm flex-1">{i18n(I18nKey.harmonyReduceMotion)}</span>
				<div class="w-10 h-5 rounded-full transition-all duration-200 relative"
					 class:bg-(--primary)={harmonyMotionReduced}
					 class:bg-(--btn-regular-bg-active)={!harmonyMotionReduced}>
					<div class="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all duration-200"
						 class:left-0.5={!harmonyMotionReduced}
						 class:left-5={harmonyMotionReduced}></div>
				</div>
			</button>
		</div>
		{/if}

		<!-- Pure Font Section（仅素简：阅读字体切换） -->
		{#if isPure}
		<div class="">
			<div class="section-title">
				{i18n(I18nKey.settingsFont)}
			</div>
			<div class="flex flex-wrap gap-2">
				{#each pureFontOptions as opt}
				<button
					aria-label={opt.label || i18n(I18nKey.settingsFontSystem)}
					class="flex-1 min-w-[45%] btn-regular rounded-md py-2 px-3 flex items-center justify-center gap-2 active:scale-95 transition-all relative overflow-hidden"
					class:opacity-60={pureFont !== opt.value}
					class:bg-(--btn-regular-bg-hover)={pureFont === opt.value}
					onclick={() => { pureFont = opt.value; }}
					title={opt.label || i18n(I18nKey.settingsFontSystem)}
				>
					<span class="text-xs font-medium">{opt.label || i18n(I18nKey.settingsFontSystem)}</span>
				</button>
				{/each}
			</div>
		</div>
		{/if}

		<!-- Layout Switch Section（华彩下所有页面显示；素简单列列表排不了网格，不显示） -->
		{#if allowLayoutSwitch && !isPure}
		<div class="">
			<div class="section-title">
				{i18n(I18nKey.postListLayout)}
				<button aria-label="Reset to Default" class="btn-regular rounded-md active:scale-90"
						class:opacity-0={currentLayout === effectiveDefaultLayout} class:pointer-events-none={currentLayout === effectiveDefaultLayout}
						disabled={currentLayout === effectiveDefaultLayout} aria-hidden={currentLayout === effectiveDefaultLayout ? "true" : undefined} onclick={resetLayout}>
					<div class="text-(--btn-content)">
						<Icon icon="fa7-solid:arrow-rotate-left" class="text-[0.75rem]"></Icon>
					</div>
				</button>
			</div>
			<div class="flex gap-2">
				<button
					aria-label={i18n(I18nKey.postListLayoutList)}
					class="flex-1 btn-regular rounded-md py-2 px-3 flex items-center justify-center gap-2 active:scale-95 transition-all relative overflow-hidden"
					class:opacity-60={currentLayout !== 'list'}
					class:bg-(--btn-regular-bg-hover)={currentLayout === 'list'}
					disabled={isSwitching}
					onclick={switchLayout}
					title={i18n(I18nKey.postListLayoutList)}
				>
					<svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
						<path d="M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z"/>
					</svg>
					<span class="text-xs font-medium">{i18n(I18nKey.postListLayoutList)}</span>
				</button>
				<button
					aria-label={i18n(I18nKey.postListLayoutGrid)}
					class="flex-1 btn-regular rounded-md py-2 px-3 flex items-center justify-center gap-2 active:scale-95 transition-all relative overflow-hidden"
					class:opacity-60={currentLayout !== 'grid'}
					class:bg-(--btn-regular-bg-hover)={currentLayout === 'grid'}
					disabled={isSwitching}
					onclick={switchLayout}
					title={i18n(I18nKey.postListLayoutGrid)}
				>
					<svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
						<path d="M3 3h7v7H3V3zm0 11h7v7H3v-7zm11-11h7v7h-7V3zm0 11h7v7h-7v-7z"/>
					</svg>
					<span class="text-xs font-medium">{i18n(I18nKey.postListLayoutGrid)}</span>
				</button>
			</div>
		</div>
		{/if}

		<!-- Pure-mode Effects Section：素简没有特效页签，在原「文章布局」的位置放两开关（樱花/萤火虫） -->
		{#if isPure && (isSakuraSwitchable || isFireflySwitchable)}
		<div class="">
			<div class="section-title">
				{i18n(I18nKey.effectsSettings)}
			</div>
			<div class="space-y-1">
				{#if isSakuraSwitchable}
				<button
					class="w-full btn-regular rounded-md py-2 px-3 flex items-center gap-3 text-left active:scale-95 transition-all relative overflow-hidden"
					class:bg-(--btn-regular-bg-hover)={sakuraEnabled}
					onclick={toggleSakuraEnabled}
				>
					<Icon icon="mdi:flower-poppy" class="text-[1.25rem] shrink-0"></Icon>
					<span class="text-sm flex-1">{i18n(I18nKey.sakuraEffect)}</span>
					<div class="w-10 h-5 rounded-full transition-all duration-200 relative"
						 class:bg-(--primary)={sakuraEnabled}
						 class:bg-(--btn-regular-bg-active)={!sakuraEnabled}>
						<div class="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all duration-200"
							 class:left-0.5={!sakuraEnabled}
							 class:left-5={sakuraEnabled}></div>
					</div>
				</button>
				{/if}
				{#if isFireflySwitchable}
				<button
					class="w-full btn-regular rounded-md py-2 px-3 flex items-center gap-3 text-left active:scale-95 transition-all relative overflow-hidden"
					class:bg-(--btn-regular-bg-hover)={fireflyEnabled}
					onclick={toggleFireflyEnabled}
				>
					<Icon icon="mdi:sparkles" class="text-[1.25rem] shrink-0"></Icon>
					<span class="text-sm flex-1">{i18n(I18nKey.fireflyEffect)}</span>
					<div class="w-10 h-5 rounded-full transition-all duration-200 relative"
						 class:bg-(--primary)={fireflyEnabled}
						 class:bg-(--btn-regular-bg-active)={!fireflyEnabled}>
						<div class="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all duration-200"
							 class:left-0.5={!fireflyEnabled}
							 class:left-5={fireflyEnabled}></div>
					</div>
				</button>
				{/if}
			</div>
		</div>
		{/if}

		<!-- Card Settings Section -->
		{#if (isCardBorderSwitchable || isCardFollowThemeSwitchable) && !isPure}
		<div>
			<div class="section-title">
				{i18n(I18nKey.cardSettings)}
				<button aria-label="Reset to Default" class="btn-regular rounded-md active:scale-90"
						class:opacity-0={cardSettingsIsDefault} class:pointer-events-none={cardSettingsIsDefault}
						disabled={cardSettingsIsDefault} aria-hidden={cardSettingsIsDefault ? "true" : undefined} onclick={resetCardSettings}>
					<div class="text-(--btn-content)">
						<Icon icon="fa7-solid:arrow-rotate-left" class="text-[0.75rem]"></Icon>
					</div>
				</button>
			</div>
			<div class="space-y-1">
				{#if isCardBorderSwitchable}
				<button
					class="w-full btn-regular rounded-md py-2 px-3 flex items-center gap-3 text-left active:scale-95 transition-all relative overflow-hidden"
					class:bg-(--btn-regular-bg-hover)={cardBorderEnabled}
					onclick={toggleCardBorderEnabled}
				>
					<Icon icon="material-symbols:border-outer-rounded" class="text-[1.25rem] shrink-0"></Icon>
					<span class="text-sm flex-1">{i18n(I18nKey.cardBorder)}</span>
					<div class="w-10 h-5 rounded-full transition-all duration-200 relative"
						 class:bg-(--primary)={cardBorderEnabled}
						 class:bg-(--btn-regular-bg-active)={!cardBorderEnabled}>
						<div class="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all duration-200"
							 class:left-0.5={!cardBorderEnabled}
							 class:left-5={cardBorderEnabled}></div>
					</div>
				</button>
				{/if}
				{#if isCardFollowThemeSwitchable}
				<button
					class="w-full btn-regular rounded-md py-2 px-3 flex items-center gap-3 text-left active:scale-95 transition-all relative overflow-hidden"
					class:bg-(--btn-regular-bg-hover)={cardFollowThemeEnabled}
					onclick={toggleCardFollowThemeEnabled}
				>
					<Icon icon="material-symbols:palette" class="text-[1.25rem] shrink-0"></Icon>
					<span class="text-sm flex-1">{i18n(I18nKey.cardFollowTheme)}</span>
					<div class="w-10 h-5 rounded-full transition-all duration-200 relative"
						 class:bg-(--primary)={cardFollowThemeEnabled}
						 class:bg-(--btn-regular-bg-active)={!cardFollowThemeEnabled}>
						<div class="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all duration-200"
							 class:left-0.5={!cardFollowThemeEnabled}
							 class:left-5={cardFollowThemeEnabled}></div>
					</div>
				</button>
				{/if}
			</div>
		</div>
		{/if}
	{/if}

	<!-- Wallpaper Tab: Mode + Overlay + Banner Settings -->
	{#if activeTab === "wallpaper"}
		<!-- Wallpaper Mode Section -->
		{#if isWallpaperSwitchable}
		<div>
			<div class="section-title">
				{i18n(I18nKey.wallpaperMode)}
				<button aria-label="Reset to Default" class="btn-regular rounded-md active:scale-90"
						class:opacity-0={wallpaperMode === defaultWallpaperMode} class:pointer-events-none={wallpaperMode === defaultWallpaperMode}
						disabled={wallpaperMode === defaultWallpaperMode} aria-hidden={wallpaperMode === defaultWallpaperMode ? "true" : undefined} onclick={resetWallpaperMode}>
					<div class="text-(--btn-content)">
						<Icon icon="fa7-solid:arrow-rotate-left" class="text-[0.75rem]"></Icon>
					</div>
				</button>
			</div>
			<div class="grid grid-cols-2 gap-2">
				<button
					class="btn-regular rounded-md py-2 px-3 flex items-center justify-center gap-2 active:scale-95 transition-all relative overflow-hidden"
					class:opacity-60={wallpaperMode !== WALLPAPER_BANNER}
					class:bg-(--btn-regular-bg-hover)={wallpaperMode === WALLPAPER_BANNER}
					onclick={() => switchWallpaperMode(WALLPAPER_BANNER)}
				>
					<Icon icon="material-symbols:image-outline" class="text-[1.25rem] shrink-0"></Icon>
					<span class="text-xs font-medium">{i18n(I18nKey.wallpaperBannerMode)}</span>
				</button>
				<button
					class="btn-regular rounded-md py-2 px-3 flex items-center justify-center gap-2 active:scale-95 transition-all relative overflow-hidden"
					class:opacity-60={wallpaperMode !== WALLPAPER_FULLSCREEN}
					class:bg-(--btn-regular-bg-hover)={wallpaperMode === WALLPAPER_FULLSCREEN}
					onclick={() => switchWallpaperMode(WALLPAPER_FULLSCREEN)}
				>
					<Icon icon="material-symbols:wallpaper" class="text-[1.25rem] shrink-0"></Icon>
					<span class="text-xs font-medium">{i18n(I18nKey.wallpaperFullscreenMode)}</span>
				</button>
				<button
					class="btn-regular rounded-md py-2 px-3 flex items-center justify-center gap-2 active:scale-95 transition-all relative overflow-hidden"
					class:opacity-60={wallpaperMode !== WALLPAPER_OVERLAY}
					class:bg-(--btn-regular-bg-hover)={wallpaperMode === WALLPAPER_OVERLAY}
					onclick={() => switchWallpaperMode(WALLPAPER_OVERLAY)}
				>
					<Icon icon="material-symbols:full-coverage-outline-rounded" class="text-[1.25rem] shrink-0"></Icon>
					<span class="text-xs font-medium">{i18n(I18nKey.wallpaperOverlayMode)}</span>
				</button>
				<button
					class="btn-regular rounded-md py-2 px-3 flex items-center justify-center gap-2 active:scale-95 transition-all relative overflow-hidden"
					class:opacity-60={wallpaperMode !== WALLPAPER_NONE}
					class:bg-(--btn-regular-bg-hover)={wallpaperMode === WALLPAPER_NONE}
					onclick={() => switchWallpaperMode(WALLPAPER_NONE)}
				>
					<Icon icon="material-symbols:hide-image-outline" class="text-[1.25rem] shrink-0"></Icon>
					<span class="text-xs font-medium">{i18n(I18nKey.wallpaperNoneMode)}</span>
				</button>
			</div>
		</div>
		{/if}

		<!-- Fullscreen Layout Section -->
		{#if isFullscreenLayoutSwitchable}
		<div>
			<div class="section-title">
				{i18n(I18nKey.fullscreenLayout)}
				<button aria-label="Reset to Default" class="btn-regular rounded-md active:scale-90"
						class:opacity-0={fullscreenLayout === defaultFullscreenLayout} class:pointer-events-none={fullscreenLayout === defaultFullscreenLayout}
						disabled={fullscreenLayout === defaultFullscreenLayout} aria-hidden={fullscreenLayout === defaultFullscreenLayout ? "true" : undefined} onclick={resetFullscreenLayout}>
					<div class="text-(--btn-content)">
						<Icon icon="fa7-solid:arrow-rotate-left" class="text-[0.75rem]"></Icon>
					</div>
				</button>
			</div>
			<div class="grid grid-cols-2 gap-2">
				<button
					class="btn-regular rounded-md py-2 px-3 flex items-center justify-center gap-2 active:scale-95 transition-all relative overflow-hidden"
					class:opacity-60={fullscreenLayout !== "classic"}
					class:bg-(--btn-regular-bg-hover)={fullscreenLayout === "classic"}
					onclick={() => switchFullscreenLayout("classic")}
				>
					<Icon icon="material-symbols:view-day-outline" class="text-[1.25rem] shrink-0"></Icon>
					<span class="text-xs font-medium">{i18n(I18nKey.fullscreenClassicLayout)}</span>
				</button>
				<button
					class="btn-regular rounded-md py-2 px-3 flex items-center justify-center gap-2 active:scale-95 transition-all relative overflow-hidden"
					class:opacity-60={fullscreenLayout !== "hero"}
					class:bg-(--btn-regular-bg-hover)={fullscreenLayout === "hero"}
					onclick={() => switchFullscreenLayout("hero")}
				>
					<Icon icon="material-symbols:desktop-landscape-outline-rounded" class="text-[1.25rem] shrink-0"></Icon>
					<span class="text-xs font-medium">{i18n(I18nKey.fullscreenHeroLayout)}</span>
				</button>
			</div>
		</div>
		{/if}

		<!-- Overlay Settings Section（全屏壁纸模式也复用 overlay 的透明/模糊/卡片透明度设置） -->
		{#if (wallpaperMode === WALLPAPER_OVERLAY || (wallpaperMode === WALLPAPER_FULLSCREEN && fullscreenLayout === "hero")) && hasOverlaySettings && hasVisibleOverlaySlider}
		<div class="">
			<div class="section-title">
				{i18n(I18nKey.overlaySettings)}
				<button aria-label="Reset to Default" class="btn-regular rounded-md active:scale-90"
						class:opacity-0={overlaySettingsIsDefault} class:pointer-events-none={overlaySettingsIsDefault}
						disabled={overlaySettingsIsDefault} aria-hidden={overlaySettingsIsDefault ? "true" : undefined} onclick={resetOverlaySettings}>
					<div class="text-(--btn-content)">
						<Icon icon="fa7-solid:arrow-rotate-left" class="text-[0.75rem]"></Icon>
					</div>
				</button>
			</div>
			<div class="space-y-2">
				{#each overlaySliderItems as item (item.key)}
					{#if item.enabled}
						<div class="rounded-md bg-(--btn-regular-bg) p-2">
							<div class="flex items-center justify-between mb-1">
								<span class="text-xs font-medium text-(--btn-content) opacity-80">{item.label}</span>
								<span class="text-xs text-(--btn-content)">{item.displayValue}</span>
							</div>
							<input
								aria-label={item.ariaLabel}
								type="range"
								min={item.min}
								max={item.max}
								step={item.step}
								value={item.value}
								oninput={(e) => item.onValueChange(Number((e.currentTarget as HTMLInputElement).value))}
								class="slider w-full overlay-slider"
							/>
						</div>
					{/if}
				{/each}
			</div>
		</div>
		{/if}

		<!-- Banner Settings Section -->
		{#if ((wallpaperMode === WALLPAPER_BANNER || wallpaperMode === WALLPAPER_FULLSCREEN) && hasBannerSettings) || (wallpaperMode === WALLPAPER_OVERLAY && isBannerCarouselSwitchable)}
		<div class="">
			<div class="section-title">
				{i18n(I18nKey.wallpaperSettings)}
				<button aria-label="Reset to Default" class="btn-regular rounded-md active:scale-90"
						class:opacity-0={bannerSettingsIsDefault} class:pointer-events-none={bannerSettingsIsDefault}
						disabled={bannerSettingsIsDefault} aria-hidden={bannerSettingsIsDefault ? "true" : undefined} onclick={resetBannerSettings}>
					<div class="text-(--btn-content)">
						<Icon icon="fa7-solid:arrow-rotate-left" class="text-[0.75rem]"></Icon>
					</div>
				</button>
			</div>
			<div class="space-y-1">
				<!-- Banner Title Switch（覆盖透明不显示横幅标题，不出此开关） -->
				{#if isBannerTitleSwitchable && wallpaperMode !== WALLPAPER_OVERLAY}
				<button
					class="w-full btn-regular rounded-md py-2 px-3 flex items-center gap-3 text-left active:scale-95 transition-all relative overflow-hidden"
					class:bg-(--btn-regular-bg-hover)={bannerTitleEnabled}
					onclick={toggleBannerTitleEnabled}
				>
					<Icon icon="material-symbols:titlecase-rounded" class="text-[1.25rem] shrink-0"></Icon>
					<span class="text-sm flex-1">{i18n(I18nKey.wallpaperTitle)}</span>
					<div class="w-10 h-5 rounded-full transition-all duration-200 relative"
						 class:bg-(--primary)={bannerTitleEnabled}
						 class:bg-(--btn-regular-bg-active)={!bannerTitleEnabled}>
						<div class="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all duration-200"
							 class:left-0.5={!bannerTitleEnabled}
							 class:left-5={bannerTitleEnabled}></div>
					</div>
				</button>
				{/if}
				<!-- Banner Carousel Switch -->
				{#if isBannerCarouselSwitchable}
				<button
					class="w-full btn-regular rounded-md py-2 px-3 flex items-center gap-3 text-left active:scale-95 transition-all relative overflow-hidden"
					class:bg-(--btn-regular-bg-hover)={bannerCarouselEnabled}
					onclick={toggleBannerCarouselEnabled}
				>
					<Icon icon="material-symbols:view-carousel-outline" class="text-[1.25rem] shrink-0"></Icon>
					<span class="text-sm flex-1">{i18n(I18nKey.wallpaperCarousel)}</span>
					<div class="w-10 h-5 rounded-full transition-all duration-200 relative"
						 class:bg-(--primary)={bannerCarouselEnabled}
						 class:bg-(--btn-regular-bg-active)={!bannerCarouselEnabled}>
						<div class="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all duration-200"
							 class:left-0.5={!bannerCarouselEnabled}
							 class:left-5={bannerCarouselEnabled}></div>
					</div>
				</button>
				{/if}
				<!-- Waves Animation Switch（横幅模式和 classic 全屏模式） -->
				{#if isWavesSwitchable && (wallpaperMode === WALLPAPER_BANNER || (wallpaperMode === WALLPAPER_FULLSCREEN && fullscreenLayout === "classic"))}
				<button
					class="w-full btn-regular rounded-md py-2 px-3 flex items-center gap-3 text-left active:scale-95 transition-all relative overflow-hidden"
					class:bg-(--btn-regular-bg-hover)={wavesEnabled}
					onclick={toggleWavesEnabled}
				>
					<Icon icon="material-symbols:airwave-rounded" class="text-[1.25rem] shrink-0"></Icon>
					<span class="text-sm flex-1">{i18n(I18nKey.wavesAnimation)}</span>
					<div class="w-10 h-5 rounded-full transition-all duration-200 relative"
						 class:bg-(--primary)={wavesEnabled}
						 class:bg-(--btn-regular-bg-active)={!wavesEnabled}>
						<div class="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all duration-200"
							 class:left-0.5={!wavesEnabled}
							 class:left-5={wavesEnabled}></div>
					</div>
				</button>
				{/if}
				<!-- Gradient Transition Switch（横幅模式和 classic 全屏模式） -->
				{#if isGradientSwitchable && (wallpaperMode === WALLPAPER_BANNER || (wallpaperMode === WALLPAPER_FULLSCREEN && fullscreenLayout === "classic"))}
				<button
					class="w-full btn-regular rounded-md py-2 px-3 flex items-center gap-3 text-left active:scale-95 transition-all relative overflow-hidden"
					class:bg-(--btn-regular-bg-hover)={gradientEnabled}
					onclick={toggleGradientEnabled}
				>
					<Icon icon="material-symbols:gradient" class="text-[1.25rem] shrink-0"></Icon>
					<span class="text-sm flex-1">{i18n(I18nKey.gradientTransition)}</span>
					<div class="w-10 h-5 rounded-full transition-all duration-200 relative"
						 class:bg-(--primary)={gradientEnabled}
						 class:bg-(--btn-regular-bg-active)={!gradientEnabled}>
						<div class="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all duration-200"
							 class:left-0.5={!gradientEnabled}
							 class:left-5={gradientEnabled}></div>
					</div>
				</button>
				{/if}
			</div>
		</div>
		{/if}
	{/if}

	<!-- Effects Tab: Sakura / Snow / Firefly -->
	{#if activeTab === "effects"}
		{#if isSakuraSwitchable || isSnowSwitchable || isFireflySwitchable || isStarfieldSwitchable}
		<div class="">
			<div class="section-title">
				{i18n(I18nKey.effectsSettings)}
				<button aria-label="Reset to Default" class="btn-regular rounded-md active:scale-90"
						class:opacity-0={effectsIsDefault} class:pointer-events-none={effectsIsDefault}
						disabled={effectsIsDefault} aria-hidden={effectsIsDefault ? "true" : undefined}
						onclick={resetEffects}>
					<div class="text-(--btn-content)">
						<Icon icon="fa7-solid:arrow-rotate-left" class="text-[0.75rem]"></Icon>
					</div>
				</button>
			</div>
			<div class="space-y-1">
				{#if isAstral && isStarfieldSwitchable}
				<button
					class="w-full btn-regular rounded-md py-2 px-3 flex items-center gap-3 text-left active:scale-95 transition-all relative overflow-hidden"
					class:bg-(--btn-regular-bg-hover)={starfieldEnabled}
					onclick={toggleStarfieldEnabled}
				>
					<Icon icon="mdi:star-four-points" class="text-[1.25rem] shrink-0"></Icon>
					<span class="text-sm flex-1">{i18n(I18nKey.starfieldEffect)}</span>
					<div class="w-10 h-5 rounded-full transition-all duration-200 relative"
						 class:bg-(--primary)={starfieldEnabled}
						 class:bg-(--btn-regular-bg-active)={!starfieldEnabled}>
						<div class="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all duration-200"
							 class:left-0.5={!starfieldEnabled}
							 class:left-5={starfieldEnabled}></div>
					</div>
				</button>
				{/if}
				{#if isSakuraSwitchable}
				<button
					class="w-full btn-regular rounded-md py-2 px-3 flex items-center gap-3 text-left active:scale-95 transition-all relative overflow-hidden"
					class:bg-(--btn-regular-bg-hover)={sakuraEnabled}
					onclick={toggleSakuraEnabled}
				>
					<Icon icon="mdi:flower-poppy" class="text-[1.25rem] shrink-0"></Icon>
					<span class="text-sm flex-1">{i18n(I18nKey.sakuraEffect)}</span>
					<div class="w-10 h-5 rounded-full transition-all duration-200 relative"
						 class:bg-(--primary)={sakuraEnabled}
						 class:bg-(--btn-regular-bg-active)={!sakuraEnabled}>
						<div class="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all duration-200"
							 class:left-0.5={!sakuraEnabled}
							 class:left-5={sakuraEnabled}></div>
					</div>
				</button>
				{/if}
				{#if isSnowSwitchable}
				<button
					class="w-full btn-regular rounded-md py-2 px-3 flex items-center gap-3 text-left active:scale-95 transition-all relative overflow-hidden"
					class:bg-(--btn-regular-bg-hover)={snowEnabled}
					onclick={toggleSnowEnabled}
				>
					<Icon icon="mdi:snowflake" class="text-[1.25rem] shrink-0"></Icon>
					<span class="text-sm flex-1">{i18n(I18nKey.snowEffect)}</span>
					<div class="w-10 h-5 rounded-full transition-all duration-200 relative"
						 class:bg-(--primary)={snowEnabled}
						 class:bg-(--btn-regular-bg-active)={!snowEnabled}>
						<div class="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all duration-200"
							 class:left-0.5={!snowEnabled}
							 class:left-5={snowEnabled}></div>
					</div>
				</button>
				{/if}
				{#if siteMode === "astral"}
				<div>
					<button
						class="w-full btn-regular rounded-md py-2 px-3 flex items-center gap-3 text-left active:scale-95 transition-all relative overflow-hidden"
						class:bg-(--btn-regular-bg-hover)={danmakuEnabled}
						onclick={toggleDanmakuEnabled}
					>
						<Icon icon="mdi:comment-text-multiple-outline" class="text-[1.25rem] shrink-0"></Icon>
						<span class="text-sm flex-1">{i18n(I18nKey.danmakuEffect)}</span>
						<div class="w-10 h-5 rounded-full transition-all duration-200 relative"
							 class:bg-(--primary)={danmakuEnabled}
							 class:bg-(--btn-regular-bg-active)={!danmakuEnabled}>
							<div class="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all duration-200"
								 class:left-0.5={!danmakuEnabled}
								 class:left-5={danmakuEnabled}></div>
						</div>
					</button>
					{#if danmakuEnabled}
					<div class="px-3 pt-1.5 flex items-center gap-2">
						<span class="text-xs opacity-70 w-14 shrink-0">{i18n(I18nKey.danmakuDensity)}</span>
						<div class="flex gap-1 flex-1">
							{#each [["low", "少"], ["mid", "中"], ["high", "多"]] as [v, label]}
							<button class="flex-1 btn-regular rounded-md py-1 text-xs active:scale-95 transition-all"
								class:bg-(--btn-regular-bg-hover)={danmakuDensity === v}
								onclick={() => { danmakuDensity = v as "low" | "mid" | "high"; setDanmakuDensity(danmakuDensity); }}>{label}</button>
							{/each}
						</div>
					</div>
					<div class="px-3 pt-1.5 flex items-center gap-2">
						<span class="text-xs opacity-70 w-14 shrink-0">{i18n(I18nKey.danmakuSpeed)}</span>
						<div class="flex gap-1 flex-1">
							{#each [["slow", "慢"], ["mid", "中"], ["fast", "快"]] as [v, label]}
							<button class="flex-1 btn-regular rounded-md py-1 text-xs active:scale-95 transition-all"
								class:bg-(--btn-regular-bg-hover)={danmakuSpeed === v}
								onclick={() => { danmakuSpeed = v as "slow" | "mid" | "fast"; setDanmakuSpeed(danmakuSpeed); }}>{label}</button>
							{/each}
						</div>
					</div>
					{/if}
				</div>
				{/if}
				{#if isFireflySwitchable}
				<button
					class="w-full btn-regular rounded-md py-2 px-3 flex items-center gap-3 text-left active:scale-95 transition-all relative overflow-hidden"
					class:bg-(--btn-regular-bg-hover)={fireflyEnabled}
					onclick={toggleFireflyEnabled}
				>
					<Icon icon="mdi:sparkles" class="text-[1.25rem] shrink-0"></Icon>
					<span class="text-sm flex-1">{i18n(I18nKey.fireflyEffect)}</span>
					<div class="w-10 h-5 rounded-full transition-all duration-200 relative"
						 class:bg-(--primary)={fireflyEnabled}
						 class:bg-(--btn-regular-bg-active)={!fireflyEnabled}>
						<div class="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all duration-200"
							 class:left-0.5={!fireflyEnabled}
							 class:left-5={fireflyEnabled}></div>
					</div>
				</button>
				{/if}
				{#if isNotesSwitchable}
				<button
					class="w-full btn-regular rounded-md py-2 px-3 flex items-center gap-3 text-left active:scale-95 transition-all relative overflow-hidden"
					class:bg-(--btn-regular-bg-hover)={notesEnabled}
					onclick={toggleNotesEnabled}
				>
					<Icon icon="mdi:music-note" class="text-[1.25rem] shrink-0"></Icon>
					<span class="text-sm flex-1">{i18n(I18nKey.notesEffect)}</span>
					<div class="w-10 h-5 rounded-full transition-all duration-200 relative"
						 class:bg-(--primary)={notesEnabled}
						 class:bg-(--btn-regular-bg-active)={!notesEnabled}>
						<div class="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all duration-200"
							 class:left-0.5={!notesEnabled}
							 class:left-5={notesEnabled}></div>
					</div>
				</button>
				{/if}
				{#if isRainSwitchable}
				<button
					class="w-full btn-regular rounded-md py-2 px-3 flex items-center gap-3 text-left active:scale-95 transition-all relative overflow-hidden"
					class:bg-(--btn-regular-bg-hover)={rainEnabled}
					onclick={toggleRainEnabled}
				>
					<Icon icon="mdi:weather-rainy" class="text-[1.25rem] shrink-0"></Icon>
					<span class="text-sm flex-1">{i18n(I18nKey.rainEffect)}</span>
					<div class="w-10 h-5 rounded-full transition-all duration-200 relative"
						 class:bg-(--primary)={rainEnabled}
						 class:bg-(--btn-regular-bg-active)={!rainEnabled}>
						<div class="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all duration-200"
							 class:left-0.5={!rainEnabled}
							 class:left-5={rainEnabled}></div>
					</div>
				</button>
				{/if}
				{#if isMeteorSwitchable}
				<button
					class="w-full btn-regular rounded-md py-2 px-3 flex items-center gap-3 text-left active:scale-95 transition-all relative overflow-hidden"
					class:bg-(--btn-regular-bg-hover)={meteorEnabled}
					onclick={toggleMeteorEnabled}
				>
					<Icon icon="mdi:meteor" class="text-[1.25rem] shrink-0"></Icon>
					<span class="text-sm flex-1">{i18n(I18nKey.meteorEffect)}</span>
					<div class="w-10 h-5 rounded-full transition-all duration-200 relative"
						 class:bg-(--primary)={meteorEnabled}
						 class:bg-(--btn-regular-bg-active)={!meteorEnabled}>
						<div class="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all duration-200"
							 class:left-0.5={!meteorEnabled}
							 class:left-5={meteorEnabled}></div>
					</div>
				</button>
				{/if}
				{#if isBubblesSwitchable}
				<button
					class="w-full btn-regular rounded-md py-2 px-3 flex items-center gap-3 text-left active:scale-95 transition-all relative overflow-hidden"
					class:bg-(--btn-regular-bg-hover)={bubblesEnabled}
					onclick={toggleBubblesEnabled}
				>
					<Icon icon="mdi:chart-bubble" class="text-[1.25rem] shrink-0"></Icon>
					<span class="text-sm flex-1">{i18n(I18nKey.bubblesEffect)}</span>
					<div class="w-10 h-5 rounded-full transition-all duration-200 relative"
						 class:bg-(--primary)={bubblesEnabled}
						 class:bg-(--btn-regular-bg-active)={!bubblesEnabled}>
						<div class="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all duration-200"
							 class:left-0.5={!bubblesEnabled}
							 class:left-5={bubblesEnabled}></div>
					</div>
				</button>
				{/if}
				{#if isHeartsSwitchable}
				<button
					class="w-full btn-regular rounded-md py-2 px-3 flex items-center gap-3 text-left active:scale-95 transition-all relative overflow-hidden"
					class:bg-(--btn-regular-bg-hover)={heartsEnabled}
					onclick={toggleHeartsEnabled}
				>
					<Icon icon="mdi:heart" class="text-[1.25rem] shrink-0"></Icon>
					<span class="text-sm flex-1">{i18n(I18nKey.heartsEffect)}</span>
					<div class="w-10 h-5 rounded-full transition-all duration-200 relative"
						 class:bg-(--primary)={heartsEnabled}
						 class:bg-(--btn-regular-bg-active)={!heartsEnabled}>
						<div class="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all duration-200"
							 class:left-0.5={!heartsEnabled}
							 class:left-5={heartsEnabled}></div>
					</div>
				</button>
				{/if}
				{#if isLeavesSwitchable}
				<button
					class="w-full btn-regular rounded-md py-2 px-3 flex items-center gap-3 text-left active:scale-95 transition-all relative overflow-hidden"
					class:bg-(--btn-regular-bg-hover)={leavesEnabled}
					onclick={toggleLeavesEnabled}
				>
					<Icon icon="mdi:leaf" class="text-[1.25rem] shrink-0"></Icon>
					<span class="text-sm flex-1">{i18n(I18nKey.leavesEffect)}</span>
					<div class="w-10 h-5 rounded-full transition-all duration-200 relative"
						 class:bg-(--primary)={leavesEnabled}
						 class:bg-(--btn-regular-bg-active)={!leavesEnabled}>
						<div class="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all duration-200"
							 class:left-0.5={!leavesEnabled}
							 class:left-5={leavesEnabled}></div>
					</div>
				</button>
				{/if}
				{#if isClickSwitchable}
				<button
					class="w-full btn-regular rounded-md py-2 px-3 flex items-center gap-3 text-left active:scale-95 transition-all relative overflow-hidden"
					class:bg-(--btn-regular-bg-hover)={clickEnabled}
					onclick={toggleClickEnabled}
				>
					<Icon icon="mdi:cursor-default-click" class="text-[1.25rem] shrink-0"></Icon>
					<span class="text-sm flex-1">{i18n(I18nKey.clickEffect)}</span>
					<div class="w-10 h-5 rounded-full transition-all duration-200 relative"
						 class:bg-(--primary)={clickEnabled}
						 class:bg-(--btn-regular-bg-active)={!clickEnabled}>
						<div class="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all duration-200"
							 class:left-0.5={!clickEnabled}
							 class:left-5={clickEnabled}></div>
					</div>
				</button>
				{/if}
			</div>
		</div>
		{/if}
	{/if}
</div>
{/if}
