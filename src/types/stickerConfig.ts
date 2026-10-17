export interface StickerItem {
	/** 图片路径（src 目录相对路径，如 assets/images/stickers/catgirl.png） */
	src: string;
	/** 初始横向位置（0-100，百分比） */
	x: number;
	/** 初始纵向位置（0-100，百分比） */
	y: number;
	/** 显示尺寸（px） */
	size: number;
}

export interface StickerConfig {
	/** 总开关 */
	enable: boolean;
	/** 移动端隐藏 */
	hideOnMobile: boolean;
	/** 贴纸列表 */
	stickers: StickerItem[];
}
