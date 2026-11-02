/**
 * Swup 生命周期小工具（本站精简版）。
 * 目前仅提供图谱引擎用到的 preloadUrl；实例从 window.swup 取，
 * 与站内既有组件（BackToHome / Twikoo）的访问方式一致。
 */

type SwupLike = {
	preload?: (url: string) => Promise<unknown>;
};

/** 预载目标页。未启用 preload 或预载失败都静默跳过，不影响正常点击导航。 */
export function preloadUrl(url: string): void {
	const swup = (window as unknown as { swup?: SwupLike }).swup;
	if (!swup?.preload) return;
	void swup.preload(url).catch(() => {
		// 预载纯属加速，失败就走正常导航，不需要告诉用户
	});
}
