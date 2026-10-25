import {
	type NavBarConfig,
	type NavBarLink,
	type NavBarSearchConfig,
	NavBarSearchMethod,
} from "../types/navBarConfig";

// ============================================================================
// 导航栏配置 - 根据顺序动态生成导航栏链接
// 本文件为纯数据格式，由 Alexander Console「🌐 站点导航」页维护（增删/排序/改名）
// ============================================================================
export const navBarConfig: NavBarConfig = {
	links: [
		{
			name: "主页",
			url: "/",
			icon: "material-symbols:home",
		},
		{
			name: "文章",
			url: "#",
			icon: "material-symbols:article",
			children: [
				{
					name: "归档",
					url: "/archive/",
					icon: "material-symbols:archive",
				},
				{
					name: "分类",
					url: "/categories/",
					icon: "material-symbols:folder-open-rounded",
				},
				{
					name: "标签",
					url: "/tags/",
					icon: "material-symbols:tag-rounded",
				},
				{
					name: "系列",
					url: "/series/",
					icon: "material-symbols:layers",
				},
			],
		},
		{
			name: "社交",
			url: "#",
			icon: "material-symbols:group",
			children: [
				{
					name: "友人帐",
					url: "/friends/",
					icon: "material-symbols:link-2-rounded",
					pageKey: "friends",
				},
				{
					name: "朋友圈",
					url: "/moments/",
					icon: "material-symbols:diversity-2",
					pageKey: "moments",
				},
				{
					name: "留言",
					url: "/guestbook/",
					icon: "material-symbols:chat",
					pageKey: "guestbook",
				},
			],
		},
		{
			name: "我的",
			url: "#",
			icon: "material-symbols:person",
			children: [
				{
					name: "动态",
					url: "/dynamic/",
					icon: "material-symbols:forum-rounded",
					pageKey: "dynamic",
				},
				{
					name: "项目",
					url: "/projects/",
					icon: "material-symbols:rocket-launch",
					pageKey: "projects",
				},
				{
					name: "相册",
					url: "/gallery/",
					icon: "material-symbols:photo-library",
					pageKey: "gallery",
				},
				{
					name: "时间线",
					url: "/gallery/timeline/",
					icon: "material-symbols:timeline",
				},
				{
					name: "书签导航",
					url: "/booknav/",
					icon: "material-symbols:bookmarks",
					pageKey: "booknav",
				},
				{
					name: "我的设备",
					url: "/devices/",
					icon: "material-symbols:devices",
					pageKey: "devices",
				},
				{
					name: "哔哩哔哩",
					url: "/bilibili/",
					icon: "fa7-brands:bilibili",
					pageKey: "bilibili",
				},
				{
					name: "番组计划",
					url: "/bangumi/",
					icon: "material-symbols:movie",
					pageKey: "bangumi",
				},
				{
					name: "Steam 游戏",
					url: "/steam/",
					icon: "fa7-brands:steam",
					pageKey: "steam",
				},
				{
					name: "VNDB",
					url: "/vndb/",
					icon: "material-symbols:chrome-reader-mode-rounded",
					pageKey: "vndb",
				},
				{
					name: "AnimeList",
					url: "/myanimelist/",
					icon: "material-symbols:menu-book",
					pageKey: "mal",
				},
			],
		},
		{
			name: "关于",
			url: "#",
			icon: "material-symbols:info",
			children: [
				{
					name: "打赏",
					url: "/sponsor/",
					icon: "material-symbols:favorite",
					pageKey: "sponsor",
				},
				{
					name: "关于我",
					url: "/about/",
					icon: "material-symbols:person",
				},
			],
		},
		{
			name: "链接",
			url: "#",
			icon: "material-symbols:link",
			children: [
				{
					name: "音乐",
					url: "https://folia.kps.kdns.fr/",
					external: true,
					icon: "material-symbols:music-note",
				},
				{
					name: "Komari Monitor",
					url: "https://komari.kps.kdns.fr",
					external: true,
					icon: "material-symbols:monitoring",
				},
				{
					name: "哪吒面板",
					url: "http://3.106.241.76:8008/",
					external: true,
					icon: "material-symbols:dashboard-outline",
				},
				{
					name: "Cloud Mail",
					url: "https://mail.clam0.cc.cd/login",
					external: true,
					icon: "material-symbols:mail-outline",
				},
				{
					name: "IP 检测",
					url: "https://ip.kps.kdns.fr/",
					external: true,
					icon: "material-symbols:network-check",
				},
				{
					name: "GitHub",
					url: "https://github.com/CuteLeaf/Firefly",
					external: true,
					icon: "fa7-brands:github",
				},
				{
					name: "Gitee",
					url: "https://gitee.com/CuteLeaf/Firefly",
					external: true,
					icon: "fa7-brands:gitee",
				},
				{
					name: "Firefly文档",
					url: "https://docs-firefly.cuteleaf.cn",
					external: true,
					icon: "material-symbols:docs",
				},
				{
					name: "网站统计",
					url: "https://umami.lanerc.me",
					external: true,
					icon: "material-symbols:analytics",
				},
				{
					name: "博客日志",
					url: "/changelog/",
					icon: "material-symbols:history",
				},
			],
		},
		{
			name: "站点统计",
			url: "/analytics/",
			icon: "material-symbols:analytics",
		},
		{
			name: "开往",
			url: "#",
			icon: "material-symbols:train",
			children: [
				{
					name: "开往",
					url: "https://www.travellings.cn/go.html",
					external: true,
					icon: "material-symbols:train",
				},
				{
					name: "开往旧站",
					url: "https://www.lanerc.me",
					external: true,
					icon: "material-symbols:train",
				},
			],
		},
	],
};

// 导航搜索配置
export const navBarSearchConfig: NavBarSearchConfig = {
	method: NavBarSearchMethod.PageFind,
};
