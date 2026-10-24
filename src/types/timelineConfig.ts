// 时间线配置

// 单个时间线节点
export type TimelineItem = {
	date: string; // 日期，如 "2026.10"
	type: string; // 分类，如 "项目" / "里程碑"
	featured?: boolean; // 是否精选
	title: string; // 标题
	subtitle?: string; // 副标题
	description: string; // 描述
	details?: string[]; // 详情列表
	tags?: string[]; // 标签
	link?: string; // 链接
	image?: string; // 配图
	enabled?: boolean; // 是否启用，默认 true
};

// 时间线配置
export type TimelineConfig = {
	enabled: boolean; // 是否在首页显示时间线
	title?: string; // 区块标题
	items: TimelineItem[]; // 时间线节点列表
};
