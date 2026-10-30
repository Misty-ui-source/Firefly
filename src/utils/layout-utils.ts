import { backgroundWallpaper } from "../config";

export type BackgroundImages = {
	desktop: string[];
	mobile: string[];
	isMultiple: boolean;
};

// 将单个值或数组统一为数组
const toArray = (src: string | string[] | undefined): string[] => {
	if (!src) return [];
	if (Array.isArray(src)) return src;
	return [src];
};

// 背景图片处理工具函数
// 返回所有配置的图片（用于构建时渲染所有图片）
export const getBackgroundImages = (): BackgroundImages => {
	const bgSrc = backgroundWallpaper.src;

	if (
		typeof bgSrc === "object" &&
		bgSrc !== null &&
		!Array.isArray(bgSrc) &&
		("desktop" in bgSrc || "mobile" in bgSrc)
	) {
		const srcObj = bgSrc as {
			desktop?: string | string[];
			mobile?: string | string[];
		};
		// 已禁用的壁纸不参与轮换（管理台维护的 disabled 列表）
		const disabledSet = new Set(
			toArray((backgroundWallpaper as { disabled?: string | string[] }).disabled),
		);
		const desktopImages = toArray(srcObj.desktop).filter((u) => !disabledSet.has(u));
		const mobileImages = toArray(srcObj.mobile).filter((u) => !disabledSet.has(u));
		return {
			desktop: desktopImages.length > 0 ? desktopImages : mobileImages,
			mobile: mobileImages.length > 0 ? mobileImages : desktopImages,
			isMultiple: desktopImages.length > 1 || mobileImages.length > 1,
		};
	}
	// 如果是字符串或数组，同时用于桌面端和移动端
	const images = toArray(bgSrc as string | string[]);
	return {
		desktop: images,
		mobile: images,
		isMultiple: images.length > 1,
	};
};

export type WallpaperModeKey = "banner" | "fullscreen" | "overlay";

/* 分模式图片解析：某模式某端在 modeSrc 里有专属图就用专属图，否则回退共享图（getBackgroundImages）。
 * 返回每个模式最终生效的图片组，以及哪些模式拥有专属图（渲染时据此给 slide 打 data-wp-mode 标记）。 */
export const getModeBackgroundImages = (): {
	shared: BackgroundImages;
	modes: Record<WallpaperModeKey, BackgroundImages>;
	hasOwn: Record<WallpaperModeKey, boolean>;
} => {
	const shared = getBackgroundImages();
	const modeSrc = (backgroundWallpaper as { modeSrc?: Record<string, { desktop?: string[]; mobile?: string[] }> }).modeSrc || {};
	const modes = {} as Record<WallpaperModeKey, BackgroundImages>;
	const hasOwn = {} as Record<WallpaperModeKey, boolean>;
	(["banner", "fullscreen", "overlay"] as WallpaperModeKey[]).forEach((mode) => {
		const own = modeSrc[mode] || {};
		const ownDesktop = toArray(own.desktop);
		const ownMobile = toArray(own.mobile);
		hasOwn[mode] = ownDesktop.length > 0 || ownMobile.length > 0;
		const desktop = ownDesktop.length > 0 ? ownDesktop : shared.desktop;
		const mobile = ownMobile.length > 0 ? ownMobile : shared.mobile;
		modes[mode] = {
			desktop,
			mobile,
			isMultiple: desktop.length > 1 || mobile.length > 1,
		};
	});
	return { shared, modes, hasOwn };
};

export type ModeBackgroundImagesSet = ReturnType<typeof getModeBackgroundImages>;

/* 分模式轮播开关：modeCarousel 配置了该模式就用它，否则回退 common.carousel.enable */
export const getModeCarouselEnabled = (mode: WallpaperModeKey): boolean => {
	const mc = (backgroundWallpaper as { modeCarousel?: Record<string, boolean> }).modeCarousel;
	if (mc && typeof mc[mode] === "boolean") return mc[mode];
	return backgroundWallpaper.common?.carousel?.enable ?? false;
};

// 类型守卫函数
export const isBannerSrcObject = (	src:
		| string
		| string[]
		| { desktop?: string | string[]; mobile?: string | string[] },
): src is { desktop?: string | string[]; mobile?: string | string[] } => {
	return (
		typeof src === "object" &&
		src !== null &&
		!Array.isArray(src) &&
		("desktop" in src || "mobile" in src)
	);
};

// 获取默认背景图片（返回第一张，用于 SEO 等场景）
export const getDefaultBackground = (): string => {
	const images = getBackgroundImages();
	return images.desktop[0] || images.mobile[0] || "";
};

// 检查是否为首页
export const isHomePage = (pathname: string): boolean => {
	// 获取 base URL
	const baseUrl = import.meta.env.BASE_URL || "/";
	const baseUrlNoSlash = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;

	if (pathname === baseUrl) return true;
	if (pathname === baseUrlNoSlash) return true;
	if (pathname === "/") return true;

	// 璨夜专属分页（/astral/、/astral/N/）就是璨夜下的首页：
	// bento 矩阵与 is-home 作用域的样式都按首页对待
	if (pathname === "/astral" || pathname === "/astral/") return true;
	if (/^\/astral\/\d+\/?$/.test(pathname)) return true;

	return false;
};

// 获取横幅偏移量
export const getBannerOffset = (position = "center"): string => {
	const bannerOffsetByPosition = {
		top: "100vh",
		center: "50vh",
		bottom: "0",
	};
	return (
		bannerOffsetByPosition[position as keyof typeof bannerOffsetByPosition] ||
		"50vh"
	);
};
