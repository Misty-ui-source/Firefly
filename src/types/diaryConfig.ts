export interface DiaryConfig {
	/** 页面标题，显示在日记页头部与浏览器标签 */
	title: string;
	/** 页面描述，显示在标题下方，可留空 */
	description: string;
	/** 是否显示评论区（还需在 commentConfig.ts 启用评论系统） */
	showComment: boolean;
	/** 密码锁卡皮肤：notebook 日记本 / classic 经典 / envelope 密封 */
	lockStyle: "notebook" | "classic" | "envelope";
}
