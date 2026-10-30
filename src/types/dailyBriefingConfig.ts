// 每日选刊类型（第二批）：自动拼 + 人工置顶
export interface DailyBriefingPin {
	/** 置顶条目标题 */
	title: string;
	/** 条目链接（本站相对路径或外站完整地址） */
	url: string;
	/** 来源名，如「站长置顶」/ 友站名 */
	source: string;
}

export interface DailyBriefingConfig {
	/** 是否启用每日选刊 */
	enabled: boolean;
	/** 人工置顶条目（null = 不置顶，全自动拼） */
	pin: DailyBriefingPin | null;
}
