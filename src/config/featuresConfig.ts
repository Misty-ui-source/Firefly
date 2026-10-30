import type { FeaturesConfig } from "../types/featuresConfig";

// 功能总开关（第三批补全）：站长在 Alexander Console「功能开关」卡里维护，
// 保存即重写本文件。默认值按 2026-10-31 站长定版。
export const featuresConfig: FeaturesConfig = {
	danmaku: true,
	floatingPlayer: true,
	fish: true,
	seasonalSnow: true,
};
