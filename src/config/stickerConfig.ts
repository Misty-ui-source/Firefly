import type { StickerConfig } from "../types/stickerConfig";

// 首页可拖拽贴纸配置（参考 9ll.uk 的贴纸玩法）
// 图片放在 src/assets/images/stickers/ 下，换成你自己的贴纸只需替换文件
// x / y：初始位置（百分比，相对于首页横幅区域）；size：显示尺寸（px）
export const stickerConfig: StickerConfig = {
	// 总开关
	enable: true,
	// 移动端是否显示（默认隐藏，避免遮挡）
	hideOnMobile: true,
	// 贴纸列表
	stickers: [
		{ src: "assets/images/stickers/catgirl.png", x: 8, y: 22, size: 96 },
		{ src: "assets/images/stickers/shiba.png", x: 82, y: 30, size: 84 },
		{ src: "assets/images/stickers/firefly.png", x: 70, y: 62, size: 72 },
		{ src: "assets/images/stickers/moon.png", x: 16, y: 66, size: 72 },
	],
};
