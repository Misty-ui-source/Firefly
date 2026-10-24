// 碎碎念配置

// 单条碎碎念
export type ThoughtItem = {
	title: string; // 标题
	content: string; // 内容（背景）
	createdAt: string; // 发布时间，ISO 格式
	updatedAt?: string; // 更新时间，ISO 格式（有更新才记录）
	enabled?: boolean; // 是否启用，默认 true
};

// 碎碎念配置
export type ThoughtsConfig = {
	enabled: boolean; // 是否启用
	title?: string; // 区块标题
	items: ThoughtItem[]; // 碎碎念列表
};
