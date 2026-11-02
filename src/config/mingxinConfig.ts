// ============================================================================
// 第七形态「明信」（mingxin）专属配置
// ----------------------------------------------------------------------------
// 参考番茄 mmz（Shirone 变体）的首页影像层：全屏揭示 → 收缩进首幕图框 →
// 双吊线明信片五幕横滑 → 终幕放大 → 内容区（afterglow）上滑接管。
// 本文件是纯数据：图片一律写 public 绝对路径字符串，控制台「新形态素材」
// 卡日后经 R2 槽位写回这里（幕编排同理），组件与控制器零硬编码。
// 一期：五幕文案固定（站长 2026-11-01 审定，不从文章派生）；气泡池与
// 角色台词在组件里按文章数据装配（二期渲染），这里只放兜底文案。
// ============================================================================

export interface MingxinSceneItem {
	/** 幕题（四字） */
	title: string;
	/** 日期，格式 YYYY/MM/DD */
	date: string;
	/** 说明句（底栏右栏，最多两行截断） */
	note: string;
	/** 明信片图（public 绝对路径或远程 URL） */
	image: string;
	/** 是否与揭示图合成（首幕：图框不重复加载，舞台背景即同一张图） */
	composite?: boolean;
	/** 本幕图的轮换池（可空缺，语义见 revealPool 的总注） */
	pool?: string[];
	/** 本幕图的轮换模式：manual / random / daily（可空缺 = manual） */
	mode?: string;
}

export interface MingxinOtherSite {
	/** 站名（展开行与折叠堆叠的提示都用它） */
	name: string;
	/** 站点地址（外链原样使用，新窗打开，不走 url()） */
	url: string;
	/** 站点图标 URL（各站自己的 favicon 直连；空串或加载失败时回落本站叶片标） */
	icon: string;
}

export interface MingxinConfig {
	/** 形态总开关：false 时首页不渲染明信根节点（其余形态不受影响） */
	enabled: boolean;
	/** 背景纹理预设（textures：none / grid / dots / noise / diagonal / waves / jigsaw） */
	texturePreset: string;
	/** 纹理不透明度（0–1，对应 --texture-opacity） */
	textureOpacity: number;
	/**
	 * 揭示图（首屏全屏图 + 首幕明信片图，同一张）。
	 * —— 图片槽轮换池总注（全卡单图槽通用，站长 2026-11-01 立规）——
	 * 每槽 = 当前图（本字段）+ 轮换池（*Pool）+ 模式（*Mode）：
	 * manual 手动指定（默认，就用当前图）/ random 每次打开页面从
	 * 「当前 + 池」随机挑一张 / daily 按访客本地日期确定性轮换（一日一张）。
	 * 控制台换图时被换下的图自动进池、不消失；删池图只能在控制台手动删。
	 * 运行时由 Layout 首帧脚本按烘焙数据选定（先定后渲，不闪）。
	 */
	revealImage: string;
	/** 揭示图轮换池 */
	revealPool: string[];
	/** 揭示图轮换模式：manual / random / daily */
	revealMode: string;
	/**
	 * 马赛克前段专用图（碎片拼合 + 落位照片态都用它，与揭示图相互独立）：
	 * 站长日后自备，当前先用揭示图占位；揭示段仍走 revealImage，
	 * 两段交接是不同图之间的缩放 + 交叉淡化（无跳切）。
	 */
	mosaicImage: string;
	/** 马赛克图轮换池（原 v2 备选库已并入此池，不再是两个东西） */
	mosaicPool: string[];
	/** 马赛克图轮换模式：manual / random / daily */
	mosaicMode: string;
	/**
	 * 马赛克叠图（原站照片 overlay）：主照片落位后从照片下缘滑入、
	 * 叠压在照片下半部的第二张图；空串且池为空 = 整张叠图不渲染
	 * （原站语义：image 留空不显示），页面与无此功能时一模一样。
	 */
	mosaicOverlayImage: string;
	/** 马赛克叠图轮换池 */
	mosaicOverlayPool: string[];
	/** 马赛克叠图轮换模式：manual / random / daily */
	mosaicOverlayMode: string;
	/**
	 * 座右铭（与 footerMotto 同句）：2026-11-01 前曾挂在前段巨字下
	 * occupation 位，站长当日定版改挂身份行 profileTagline 后，本字段
	 * 不再被 Hero 引用（值保留，控制台生成器以它为字段锚点，勿删）。
	 */
	heroSubtitle: string;
	/**
	 * 落位介绍票签「壹」的散文自述（原站票签风格，站长 2026-11-01 定稿）：
	 * 纯散文一段，不带头像/名牌；座右铭只留页脚，两处不重复。
	 */
	introBio: string;
	/**
	 * 落位介绍票签「叁」的散文：整句存配置，装配时把句中的
	 * 「GitHub」字样、邮箱地址、「RSS / Atom」三处按真实配置
	 * 换成真链接（句式被改后命不中就按纯文本渲染，不丢字）。
	 */
	introContact: string;
	/**
	 * 身份行（原站 occupation 位，站长 2026-11-01 自拟）：
	 * 渲染时由样式层 ::before/::after 加方括号，这里只存括号内的文案。
	 * 两处共用：明信作者卡（替掉资料卡原来的 bio 散文）与马赛克 Hero
	 * 巨字下的 occupation 行（2026-11-01 起同读本字段）。
	 */
	profileTagline: string;
	/**
	 * 作者卡横幅图（控制台可自设）：空串时回落 revealImage（现状），
	 * 非空时横幅主槽用它（垫底的模糊头像层不变）。
	 */
	profileBanner: string;
	/**
	 * 作者卡横幅轮换池 / 模式（语义见 revealPool 总注）。
	 * 站点统计卡底图与横幅共用本槽：读的是本槽最终选定图，不另开字段。
	 */
	profileBannerPool: string[];
	/** 作者卡横幅轮换模式：manual / random / daily */
	profileBannerMode: string;
	/**
	 * 作者卡底部「其他站点」面板（原站 personalSites 同位）：
	 * 折叠条露前 3 个图标，展开层逐行列全部；空数组整条不渲染。
	 * 控制台「明信素材」页可增删排序。
	 */
	otherSites: MingxinOtherSite[];
	/** 揭示层大标题 */
	headline: string;
	/** 揭示层轮播语（依次淡入淡出） */
	headlineMessages: string[];
	/** 五幕明信片（顺序即幕序；编号贴纸笔顺目前支持 1–5） */
	scenes: MingxinSceneItem[];
	/** 终幕文案（放大定格后居中显影的两行） */
	finaleTitle: string;
	finaleSubtitle: string;
	/** 页脚签名图（手写体签名，暗色下 CSS invert 反白） */
	signatureImage: string;
	/** 页脚签名下小字（站长自选座右铭，2026-11-01 定） */
	footerMotto: string;
	/** 横滑总距离（px；控制器下限另有 340vh 兜底） */
	scrollDistance: number;
	/** 拼图底纹单周期时长（秒） */
	cycleDuration: number;
	/**
	 * 马赛克 Hero 前段（原站 MmzMing 首屏整套逻辑，站长 2026-11-01 选做、带质量门）：
	 * true 时揭示段之前多一段滚动——拼图底纹 + 静止碎片 + 左上巨字标题，
	 * 滚动把全部碎片逐块拼回完整照片，照片再落位成左倾相框、右侧三张
	 * 介绍票签倒下、玻璃雨落下，最后照片放大交叉淡化交接给揭示段。
	 * false 时整层零渲染、零脚本，首页与未加此层时完全一致。
	 * 整层摘除 = 删 MingxinMosaic.astro 与 scripts/mingxin/home-mosaic*.ts
	 * + 本段配置 + MingxinHome 两处挂载一行 boot。
	 */
	mosaicHero: boolean;
	mosaic: {
		/** 碎片网格行/列（原站 4×6） */
		rows: number;
		columns: number;
		/** 首屏静止可见的碎片数（按 reveal rank 取前 N 块） */
		idleVisible: number;
		/** 碎片布局种子（原站 20260814，布局与入场序由它定死） */
		seed: number;
		/** 首屏六块碎片的落位（分数坐标，按 reveal rank 顺序） */
		initialLayout: {
			x: number;
			y: number;
			width: number;
			height: number;
			blur?: number;
		}[];
		/** 追赶平滑（原站 scrub 0.45，控制器映射为指数阻尼时间常数） */
		scrub: number;
		/** 主体段滚动距离下限（px，原站 desktopScrollDistance 3250） */
		desktopScrollDistance: number;
		/** 主体段距离的视口兜底倍数（原站 desktopMinViewports 4.05） */
		desktopMinViewports: number;
		/**
		 * 尾巴段距离（px，原站 desktopDialogueTailDistance 240）：
		 * 时间线 1.34–1.52（旋转收尾 + 驻留）压缩进这一段走完。
		 */
		tailDistance: number;
		/**
		 * 交接段距离（px，本站新增）：照片放大 + 交叉淡化给揭示段。
		 * 原站此处是角色滑行尾巴，本站内容不同，距离按交接手感定。
		 */
		handoffDistance: number;
		/** 玻璃雨珠 + 撞击水花（原站 hero.rain，照片落位后落下） */
		rain: {
			enabled: boolean;
			/** 密度 0–1（原站 0.6） */
			intensity: number;
			/** 雨色，空串随画布文字色（原站站长配 "#ffffff"） */
			color: string;
		};
	};
	/**
	 * 终幕内容区（afterglow）默认变体：
	 * "hero" = 「Hero」原站 HomeDataLayer 套（牌堆/站点数据/内容索引/订阅联系），
	 * "classic" = 「经典」番茄四模块套（快速前往/公告/近期文章/我的动态）。
	 * 访客 localStorage `mingxinAfterglow` 优先；切换 UI 在三期
	 * （调色板明信段 + 控制台主题卡），一期只接属性与首帧脚本。
	 */
	afterglowDefault: "hero" | "classic";
	/** 气泡池兜底文案：文章摘要不足时按序补齐 */
	bubbleFallbacks: string[];
	/** 角色台词兜底：文章摘要/标题之外再退到这里 */
	dialogueFallbacks: string[];
	/** 左下黑猫本体图（public 绝对路径；三期进控制台素材卡换图） */
	dollImage: string;
	/** 黑猫本体轮换池 / 模式（语义见 revealPool 总注） */
	dollPool: string[];
	dollMode: string;
	/** 影像层底部巡航立绘（顺序即出场序；三期进控制台素材卡） */
	standImages: string[];
	/** 每张立绘各自的轮换池（与 standImages 同序同长，空数组 = 无池） */
	standPools: string[][];
	/** 每张立绘各自的轮换模式（与 standImages 同序同长） */
	standModes: string[];
	/** 黑猫按下音效（懒加载，第一次交互才建 Audio） */
	soundPress: string;
	/** 黑猫松手音效 */
	soundLoosen: string;
	/**
	 * 明信音乐播放器扩展源：浮动播放器歌单（musicConfig.floatingPlayer）
	 * 永远先行，这里的 Meting 歌单在后台合并去重，逐源静默降级。
	 * server: netease / tencent / kugou；type: playlist / album / song。
	 */
	music: {
		metingApi: string;
		metingSources: { server: string; type: string; id: string; label: string }[];
		/**
		 * 播放器形态（同一引擎、两张皮，切换不断播）：
		 * "sidebar" = Shirone 风侧栏卡；"pill" = mmz 风唱片胶囊
		 * （唱片 → 歌词胶囊 → 悬停展开工具栏）。控制台主题页可改。
		 */
		playerVariant: "sidebar" | "pill";
	};
}

export const mingxinConfig: MingxinConfig = {
	enabled: true,
	texturePreset: "jigsaw",
	textureOpacity: 0.12,
	revealImage: "/assets/images/mingxin/reveal-golden-field.webp",
	revealPool: ["/assets/images/mingxin/reveal.webp"],
	revealMode: "manual",
	mosaicImage: "/assets/images/mingxin/mosaic-feiyu-harbor.webp",
	mosaicPool: [
		"/assets/images/mingxin/v2/glitch-0.png",
		"/assets/images/mingxin/v2/glitch-1.png",
		"/assets/images/mingxin/v2/glitch-2.png",
		"/assets/images/mingxin/v2/glitch-3.png",
		"/assets/images/mingxin/v2/glitch-4.png",
		"/assets/images/mingxin/v2/glitch-5.jpg",
		"/assets/images/mingxin/v2/moon-0.png",
		"/assets/images/mingxin/v2/moon-1.png",
		"/assets/images/mingxin/v2/moon-2.jpg",
		"/assets/images/mingxin/v2/moon-3.png",
		"/assets/images/mingxin/v2/moon-4.jpg",
		"/assets/images/mingxin/v2/moon-5.png",
		"/assets/images/mingxin/v2/room-0.jpg",
		"/assets/images/mingxin/v2/room-1.jpg",
		"/assets/images/mingxin/v2/room-2.jpg",
		"/assets/images/mingxin/v2/room-3.png",
		"/assets/images/mingxin/v2/room-4.png",
		"/assets/images/mingxin/v2/room-5.png",
		"/assets/images/mingxin/v2/gen-rain-canal.webp",
		"/assets/images/mingxin/v2/gen-golden-rain.webp",
		"/assets/images/mingxin/v2/gen-starry-port.webp",
		"/assets/images/mingxin/v2/gen-feiyu-canal.webp",
		"/assets/images/mingxin/v2/gen-feiyu-aquarium.webp",
		"/assets/images/mingxin/v2/gen-feiyu-teatime.webp",
		"/assets/images/mingxin/pool/mosaic-sakura-night.webp",
		"/assets/images/mingxin/pool/mosaic-feiyu-aquarium-v2.webp",
		"/assets/images/mingxin/pool/mosaic-feiyu-seaside-v2.webp",
		"/assets/images/mingxin/pool/mosaic-feiyu-cafe.webp",
		"/assets/images/mingxin/pool/mosaic-feiyu-aquarium-modern.webp",
		"/assets/images/mingxin/pool/mosaic-feiyu-seaside-modern.webp",
	],
	mosaicMode: "manual",
	mosaicOverlayImage: "",
	mosaicOverlayPool: [],
	mosaicOverlayMode: "manual",
	heroSubtitle: "生活原本沉闷，但跑起来就有风",
	introBio:
		"热衷于制作一些美丽且不实用的站点形态设计，这间小屋这么多副面孔就是证据。白天上课，晚上折腾，乐此不疲。",
	introContact:
		"代码堆在 GitHub（Misty-ui-source），有话写信到 xz011@qq.com，追更订 RSS / Atom——白天上课，回得慢。",
	profileTagline: "电子科学与技术 / 大三摆烂博主",
	profileBanner: "",
	profileBannerPool: [],
	profileBannerMode: "manual",
	otherSites: [
		{ name: "旧站存档", url: "https://www.lanerc.me", icon: "https://www.lanerc.me/favicon/zhz.jpg" },
		{ name: "站点统计", url: "https://lanerc.me/analytics/", icon: "https://lanerc.me/favicon/favicon-cat-32.png" },
		{ name: "工具盒子", url: "https://lanerc.me/projects/", icon: "https://lanerc.me/favicon/favicon-cat-32.png" },
		{ name: "Alexander Console", url: "https://lanerc.me/admin/", icon: "https://lanerc.me/admin/icon-192.png" },
	],
	headline: "祝愿各位",
	headlineMessages: ["夜路有星光", "岁岁皆欢愉", "所念皆星河", "版本无回滚"],
	scenes: [
		{
			title: "迁址安家",
			date: "2026/10/15",
			note: "旧院炊烟未散，新址门楣初悬——小屋迁进新山水，自此有址可寻。",
			image: "/assets/images/mingxin/reveal-golden-field.webp",
			composite: true,
		},
		{
			title: "自铸门钥",
			date: "2026/10/23",
			note: "不借旁人的钥匙，自研控制台落成；里外进出，小屋自此自己说了算。",
			image: "/assets/images/mingxin/scene-1.webp",
		},
		{
			title: "素简开窗",
			date: "2026/10/27",
			note: "繁华之外另开一扇素窗，同一间小屋，自此有了两种呼吸。",
			image: "/assets/images/mingxin/scene-2.webp",
		},
		{
			title: "六貌同堂",
			date: "2026/10/31",
			note: "华彩、素简、谐彩、顽彩、璨夜、纸舟——一屋六貌，推门便是新天。",
			image: "/assets/images/mingxin/scene-3.webp",
		},
		{
			title: "明信未寄",
			date: "2026/11/01",
			note: "第七封明信写好了抬头，故事还长；下一程山水，且行且看。",
			image: "/assets/images/mingxin/scene-4.webp",
		},
	],
	finaleTitle: "明信未寄",
	finaleSubtitle: "下一程山水，且行且看",
	signatureImage: "/assets/images/mingxin/signature.png",
	footerMotto: "生活原本沉闷，但跑起来就有风",
	scrollDistance: 3400,
	cycleDuration: 2.4,
	mosaicHero: true,
	mosaic: {
		rows: 4,
		columns: 6,
		idleVisible: 6,
		seed: 20260814,
		initialLayout: [
			{ x: 0.14, y: 0.305, width: 0.104, height: 0.205 },
			{ x: 0.435, y: 0.18, width: 0.068, height: 0.13, blur: 5.5 },
			{ x: 0.642, y: 0.368, width: 0.047, height: 0.092, blur: 5 },
			{ x: 0.863, y: 0.402, width: 0.097, height: 0.19 },
			{ x: 0.337, y: 0.653, width: 0.159, height: 0.313 },
			{ x: 0.639, y: 0.751, width: 0.116, height: 0.228 },
		],
		scrub: 0.45,
		desktopScrollDistance: 3250,
		desktopMinViewports: 4.05,
		tailDistance: 240,
		handoffDistance: 520,
		rain: { enabled: true, intensity: 0.6, color: "#ffffff" },
	},
	afterglowDefault: "hero",
	bubbleFallbacks: ["夜路有星光", "岁岁皆欢愉", "所念皆星河", "版本无回滚"],
	dialogueFallbacks: ["欢迎来到 Alexander の小站", "慢慢逛，故事还长"],
	dollImage: "/assets/images/mingxin/doll.avif",
	dollPool: [],
	dollMode: "manual",
	standImages: [
		"/assets/images/mingxin/act2-doll-1.gif",
		"/assets/images/mingxin/act2-doll-2.gif",
	],
	standPools: [[], []],
	standModes: ["manual", "manual"],
	soundPress: "/assets/images/mingxin/doll-press.mp3",
	soundLoosen: "/assets/images/mingxin/doll-loosen.mp3",
	music: {
		metingApi: "https://api.injahow.cn/meting/?server=:server&type=:type&id=:id",
		metingSources: [
			{ server: "netease", type: "playlist", id: "14164869977", label: "扩展歌单" },
		],
		playerVariant: "pill",
	},
};
