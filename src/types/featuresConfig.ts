// 功能总开关（站长控制台「功能开关」卡维护）：各新功能的站长级总闸。
// 访客侧的个人开关（如弹幕、雪）是另一层，优先级低于这里的总闸。
export interface FeaturesConfig {
	/** 碎碎念弹幕：总闸（另有璨夜专属 + 访客默认关两层） */
	danmaku: boolean;
	/** 浮动播放器是否上站 */
	floatingPlayer: boolean;
	/** 肥鱼是否上站（含灵境入口） */
	fish: boolean;
	/** 季节雪（冬季默认开的季节逻辑）是否启用 */
	seasonalSnow: boolean;
}
