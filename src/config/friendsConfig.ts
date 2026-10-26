import type { FriendLink, FriendsPageConfig } from "../types/friendsConfig";

// 可以在src/content/spec/friends.md中编写友链页面下方的自定义内容

// 友链页面配置
export const friendsPageConfig: FriendsPageConfig = {
	// 页面标题，如果留空则使用 i18n 中的翻译
	title: "",

	// 页面描述文本，如果留空则使用 i18n 中的翻译
	description: "",

	// 是否显示底部自定义内容（friends.mdx 中的内容）
	showCustomContent: true,

	// 是否显示评论区，需要先在commentConfig.ts启用评论系统
	showComment: true,

	// 是否开启随机排序配置，如果开启，就会忽略权重，构建时进行一次随机排序
	randomizeSort: false,
};

// 友链配置
export const friendsConfig: FriendLink[] = [
	{
		title: "番茄主理人",
		imgurl: "https://q1.qlogo.cn/g?b=qq&nk=20447289&s=640",
		desc: "躬身入局，心为主理，行有尺度，自持本心。",
		siteurl: "https://blog.fqzlr.top/",
		tags: ["Blog"],
		weight: 15,
		enabled: true,
		rss: "https://blog.fqzlr.top/rss.xml",
	},
	{
		title: "Pasule Blog",
		imgurl: "https://tu.pasule.com/file/wallpaper/1784014500478.png",
		desc: "Keep the Wonder. Keep the Fire",
		siteurl: "https://pasule.com/",
		tags: ["Blog"],
		weight: 14,
		enabled: true,
		rss: "https://pasule.com/rss.xml",
	},
	{
		title: "夏夜流萤",
		imgurl: "https://weavatar.com/avatar/d252655d40d6874417a720bad0a6c5f77f8f6a1fd2f882f8f338402dc37e4190?s=640",
		desc: "飞萤之火自无梦的长夜亮起，绽放在终竟的明天。",
		siteurl: "https://blog.cuteleaf.cn",
		tags: ["Blog"],
		weight: 13,
		enabled: true,
		rss: "https://blog.cuteleaf.cn/rss.xml",
	},
	{
		title: "Pinktu",
		imgurl: "https://tutu.pink/images/logo.png",
		desc: "我的世界，你不懂",
		siteurl: "https://tutu.pink",
		tags: ["Blog"],
		weight: 12,
		enabled: true,
		rss: "",
	},
	{
		title: "mccsjs",
		imgurl: "https://mccsjs.cn/img/ico.jpg",
		desc: "点一盏灯，等待一个迷路的夜🍁",
		siteurl: "https://mccsjs.cn/",
		tags: ["Blog"],
		weight: 11,
		enabled: true,
		rss: "https://mccsjs.cn/rss.xml",
	},
	{
		title: "阿叶Ayeez的小站",
		imgurl: "https://qiniu.ayeez.cn/avatar.jpg",
		desc: "记录学习历程，记录美好生活",
		siteurl: "https://blog.Ayeez.cn",
		tags: ["Blog"],
		weight: 10,
		enabled: true,
		rss: "https://blog.Ayeez.cn/rss.xml",
	},
	{
		title: "冷汐的杂货铺",
		imgurl: "https://weavatar.com/avatar/20ac1fc492bcd37c6f1e6435250a00a490403efd468f632c11fcbe87c1c3287b?s=256",
		desc: "你好谢谢小笼包再见",
		siteurl: "https://lengxiqwq.com",
		tags: ["Blog"],
		weight: 9,
		enabled: true,
		rss: "https://lengxiqwq.com/rss.xml",
	},
	{
		title: "Nekro's SEKAI",
		imgurl: "https://avatars.githubusercontent.com/u/90670998?v=4",
		desc: "どんな結末がお望みだい？",
		siteurl: "https://www.nekro.top/",
		tags: ["Blog"],
		weight: 8,
		enabled: true,
		rss: "https://blog.nekro.top/rss.xml",
	},
	{
		title: "Ariasakaの小窝",
		imgurl: "https://img.0v0.my/2024/12/05/67517bcf104da.png",
		desc: "人有悲欢离合 月有阴晴圆缺",
		siteurl: "https://blog.yaria.top",
		tags: ["Blog"],
		weight: 7,
		enabled: true,
		rss: "https://blog.yaria.top/rss.xml",
	},
	{
		title: "UpXuu's blog",
		imgurl: "https://upxuu.com/images/me.jpg",
		desc: "逐光而上",
		siteurl: "https://upxuu.com",
		tags: ["Blog"],
		weight: 6,
		enabled: true,
		rss: "https://upxuu.com/rss.xml",
	},
	{
		title: "团子和蛋糕",
		imgurl: "https://blog.tsh520.cn/assets/ziyuan/tx.webp",
		desc: "如果你喜欢，那么欢迎来到我的世界！",
		siteurl: "https://blog.tsh520.cn",
		tags: ["Blog"],
		weight: 5,
		enabled: true,
		rss: "https://blog.tsh520.cn/rss.xml",
	},
	{
		title: "左沐の手册",
		imgurl: "https://tu.mstzuomu.space/file/%E5%A4%B4%E5%83%8F/1786942479049_azumahead.jpg",
		desc: "热爱是拯救无趣人生的唯一途径",
		siteurl: "https://azuma.mstzuomu.space/",
		tags: ["Blog"],
		weight: 4,
		enabled: true,
		rss: "https://azuma.mstzuomu.space/rss.xml",
	},
	{
		title: "浅小兮の梦",
		imgurl: "https://zxwlove.cc.cd/img/avatar.jpg",
		desc: "从相遇的刹那开始就注定了别离！",
		siteurl: "https://zxwlove.xyz/",
		tags: ["Blog"],
		weight: 3,
		enabled: true,
		rss: "https://zxwlove.xyz/rss.xml",
	},
	{
		title: "Firefly Docs",
		imgurl: "https://docs-firefly.cuteleaf.cn/logo.png",
		desc: "Firefly主题模板文档",
		siteurl: "https://docs-firefly.cuteleaf.cn",
		tags: ["Docs"],
		weight: 2,
		enabled: true,
		rss: "",
	},
	{
		title: "Astro",
		imgurl: "https://avatars.githubusercontent.com/u/44914786?v=4&s=640",
		desc: "The web framework for content-driven websites. ⭐️ Star to support our work!",
		siteurl: "https://github.com/withastro/astro",
		tags: ["Framework"],
		weight: 1,
		enabled: true,
		rss: "",
	},
];

// 获取启用的友链并进行排序
export const getEnabledFriends = (): FriendLink[] => {
	const friends = friendsConfig.filter((friend) => friend.enabled);

	if (friendsPageConfig.randomizeSort) {
		return friends.sort(() => Math.random() - 0.5);
	}

	return friends.sort((a, b) => b.weight - a.weight);
};
