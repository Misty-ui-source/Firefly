import type { MusicPlayerConfig } from "../types/musicConfig";

// 音乐播放器配置
export const musicPlayerConfig: MusicPlayerConfig = {
	// 是否在导航栏显示音乐播放器入口
	showInNavbar: true,

	// 是否在侧边栏显示音乐播放器组件
	showInSidebar: true,

	// 使用方式："meting" 使用 Meting API，"local" 使用本地音乐列表
	mode: "local",

	// 默认音量 (0-1)
	volume: 0.7,

	// 播放模式：'list'=列表循环, 'one'=单曲循环, 'random'=随机播放
	playMode: "list",

	// 是否显启用歌词
	showLyrics: false,

	// Meting API 配置
	meting: {
		// Meting API 地址
		// 默认使用官方 API，也可以使用自定义 API
		api: "https://api.i-meto.com/meting/api?server=:server&type=:type&id=:id&r=:r",
		// 音乐平台：netease=网易云音乐, tencent=QQ音乐, kugou=酷狗音乐, xiami=虾米音乐, baidu=百度音乐
		server: "netease",
		// 类型：song=单曲, playlist=歌单, album=专辑, search=搜索, artist=艺术家
		type: "playlist",
		// 歌单/专辑/单曲 ID 或搜索关键词
		id: "10046455237",
		// 认证 token（可选）
		auth: "",
		// 备用 API 配置（当主 API 失败时使用）
		fallbackApis: [
			"https://api.injahow.cn/meting/?server=:server&type=:type&id=:id",
			"https://api.moeyao.cn/meting/?server=:server&type=:type&id=:id",
		],
	},

	// 本地音乐配置（当 mode 为 'local' 时使用）
	// 1. 支持传入歌词文件的路径
	// lrc: "/assets/music/lrc/使一颗心免于哀伤-哼唱.lrc",
	// 2. 或者直接填入歌词字符串内容
	// lrc: "[00:00.00]歌词内容...",
	local: {
		playlist: [
			{
				name: "愛唄",
				artist: "GRe4N BOYZ",
				url: "/assets/music/愛唄.mp3",
				cover: "/assets/music/cover/aibou.jpg",
				lrc: "",
			},
			{
				name: "Crashing",
				artist: "Ed Sheeran",
				url: "/assets/music/Crashing.mp3",
				cover: "/assets/music/cover/crashing.jpg",
				lrc: "",
			},
			{
				name: "春愁",
				artist: "Mrs. GREEN APPLE",
				url: "/assets/music/春愁.mp3",
				cover: "/assets/music/cover/chunqiu.jpg",
				lrc: "",
			},
			{
				name: "使一颗心免于哀伤",
				artist: "知更鸟 / HOYO-MiX / Chevy",
				url: "/assets/music/使一颗心免于哀伤-哼唱.mp3",
				cover: "/assets/music/cover/109951169585655912.webp",
				lrc: "",
			},
			{
				name: "样子",
				artist: "孙燕姿",
				url: "https://img.lanerc.me/admin/music/mvnddtm9-____-___.mp3",
				cover: "https://img.lanerc.me/admin/music-cover/mvnddikk-c7544097c35eac28cd73d5e85fd0e7f9.webp",
				lrc: "",
			},
			{
				name: "一輪花 - Ichirinka",
				artist: "tuki.",
				url: "https://img.lanerc.me/admin/music/mvt3t0nc-tuki._-_____-_Ichirinka.mp3",
				cover: "https://img.lanerc.me/admin/music-cover/mvt3qnhh-cover-auto.webp",
				lrc: "",
			},
			{
				name: "フレグランス",
				artist: "茉ひる/RINZO",
				url: "https://img.lanerc.me/admin/music/mvuyxjy9-_____RINZO_-_______.mp3",
				cover: "https://img.lanerc.me/admin/music-cover/mvuywgbw-cover-auto.webp",
				lrc: "",
			},
		],
	},

	// 全局浮动播放器（第三批）：整单镜像——站长在平台 App 里管歌单，
	// 博客打开自动跟随。加 QQ / 酷狗歌单时往 playlists 里各加一条
	// { platform: "tx", id: "歌单ID", label: "QQ 歌单" } 即可。
	floatingPlayer: {
		enabled: true,
		quality: "320k",
		playlists: [
			{ platform: "wy", id: "2804070207", label: "我喜欢的音乐" },
		],
	},
};
