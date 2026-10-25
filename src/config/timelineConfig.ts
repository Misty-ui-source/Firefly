import type { TimelineConfig } from "../types/timelineConfig";

// ============================================================================
// 时间线配置 - 首页展示个人历程
// Timeline Configuration - Show personal journey on homepage
// 参考冷汐的时间线设计
// ============================================================================

export const timelineConfig: TimelineConfig = {
	enabled: true,
	title: "时间线",
	items: [
		{
			date: '2026.10.24',
			type: '里程碑',
			featured: true,
			title: '博客迁至 Cloudflare',
			subtitle: '主站上线',
			description: '博客从 VPS 迁到 Cloudflare Pages，评论系统从 Docker 迁到 Vercel + MongoDB Atlas。',
			details: ['主域 lanerc.me 切到 Pages，HTTPS 自动续期', 'Waline 评论迁 Vercel，22 条评论 + 38 条浏览量数据完整迁移', '自研管理台 Alexander Console 支持双域名 OAuth 登录'],
			tags: ['Cloudflare', 'Vercel', 'Waline', 'MongoDB']
		},
		{
			date: '2026.10.24',
			type: '项目',
			featured: true,
			title: 'Alexander Console',
			subtitle: '自研博客管理台',
			description: '对标 blog.doulor.cn/admin 做的原生 JS 单页管理台，保存即 git commit。',
			details: ['友链增删改排序 + RSS 全测', '文章/动态编辑器支持视频嵌入、代码高亮、支持常用markdown格式', '内部集合18个常用和不常用功能，满足日常不动代码即可完成之前做不到的全部操作，懒人专属', '内置日志记录，支持生成月报季报年报，让自己的创作经历可视化', 'R2 图床直传，控制台导航可视化管理', '支持网页版app和手机浏览器版app（不支持IOS），让自己不用打开浏览器即可一键进入创作管理后台', '新增碎碎念和时间线功能，记录自己的成长与生活某个瞬间的思考'],
			tags: ['JavaScript', 'GitHub API', 'R2'],
			link: 'https://lanerc.me/admin/'
		},
		{
			date: '2024.6',
			type: '成长',
			featured: true,
			title: '高考来喽',
			description: '2024年是属于我比较特殊的一年，这一年是我的高考，高考前我在想什么呢？现在想想那时候的我确实有点好笑欸，居然幻想着能考上清华，直到数学卷子发下来，做完数学我就知道不可能了！吃尽黑利的06嘿嘿',
			details: ['这一年结束了我长达12年的学生时光', '开启了崭新的大学生活，来到了南京，来到了车大', '高中有好感的女孩不敢联系了，曾经约好的但是应该是我食言了吧', '高中的好哥们我还在烦他吗：至少现在是的', '刷新了三个超好的舍友：一个天天晚上打游戏，但是英语超好白天很上进；来自成都的好舍友，到现在也是我玩的最好的朋友之一了；来自甘肃但住在泰州的凯子，明明比我小为什么还喜欢’嬉戏‘我'],
			tags: ['记录', '成长', '思考']
		},
		{
			date: '2012.9',
			type: '教育经历',
			title: '上学是个什么东西呢，那个时候我应该不懂吧',
			description: '小学的起点，没上过幼儿园，也算是往后推迟自己的受教育生涯了吧。无忧无虑的六年，啊不对，应该是五年。上了一年学前班!',
			details: ['还记得第一节课怎么样吗？', '还记得有哪些玩的好的朋友吗？现在还联系吗？', '还记得那时候自己学习成绩怎么样吗？', '......问题待定', '1.不记得了，记得有个老师很坏，但是学校每天放学发营养餐', '2.记得，但是好长时间不联系了，一直玩到高中二年级诶', '3.记得，但是自己很上进，但是成绩不咋样，因为爱玩嘻嘻', '......待会儿答'],
			tags: ['成长', '教育', '记录']
		},
	],
};
