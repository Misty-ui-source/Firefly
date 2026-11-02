/**
 * 明信马赛克 Hero 前段（可选加项，mingxinConfig.mosaicHero 开关）：
 * 揭示段之前的一整段原站首屏逻辑——拼图底纹 + 静止碎片 + 左上巨字
 * 标题，滚动逐块拼回完整照片；拼完导引线铺开、纯色底淡入，照片
 * 落位成 -3° 相框（描边自四角蔓延），右侧三张介绍票签错峰倒下，
 * 玻璃雨在导引线画幅内落下；最后照片放大回正、整层交叉淡化，
 * 把舞台交还揭示段（揭示图是另一张图，靠缩放 + 淡化衔接，无跳切）。
 *
 * 移植自原站 MmzMing/my-blog 的 HomeHero / HeroMosaic /
 * home-hero-controller / home-hero-rain（GSAP 时间线 → 本站惯例的
 * scroll + rAF + 指数平滑，不引入动画库）；时间线关键点、碎片布局
 * 种子算法、入场位姿公式、照片落位几何、雨的物理均照原版。
 * 与原版的差异（本站结构/站长定版）：
 * - 照片走 mingxinConfig.mosaicImage，与揭示图相互独立；碎片用等大
 *   <img> 反向偏移切图（原版 background-position），框内自然比例
 *   完整呈现、零裁切，拼合交接逐像素一致；
 * - 原站时间线尾巴（1.34 之后）是角色探头 + 滑行 + 驻留，本站角色
 *   对话是独立层（相位由影像层回调驱动，不在本时间线内），尾巴段
 *   只保留旋转收尾与驻留；驻留之后新增交接段（1.52–1.70）：照片
 *   放大回正盖满舞台、周边元素淡出、整层交叉淡化给揭示段；
 * - 原站的 canvas 字标描边动画（home-hero-wordmark）已整套移植为
 *   home-mosaic-wordmark.ts（镜头扫掠/指针跟随、虚线描边轮廓、选择
 *   框锚点与巡游小方块、字母拖拽弹簧回位），由本控制器按时间线
 *   0.72（TITLE_EXIT_TIME，与原站同值）门控启停、退场冻结静止帧；
 *   右下 contact 熔字/风散（home-hero-fly-text）仍未移植；
 * - 介绍票签保留原站票签形态，内容换成本站真实数据（身份/站点
 *   数据/联系订阅，由 MingxinHome 装配）；原站方向/爱好两行本站无
 *   对应配置，未映射；照片叠图（overlay）无对应素材，未渲染；
 * - 本站照片（占位图 1277×1054）比原站照片更高，拼合框按画幅带
 *   高度封顶宽度，保证静止碎片与整图都在舞台内（原站照片够宽，
 *   不触发此封顶）。
 *
 * 整层摘除：删本文件 + home-mosaic-rain.ts + MingxinMosaic.astro
 * + mingxinConfig 的 mosaicHero/mosaic/mosaicImage/heroSubtitle
 * + MingxinHome 的两处挂载与一行 boot。
 */

import {
	initMingxinMosaicRain,
	type MingxinMosaicRainController,
} from "./home-mosaic-rain";
import {
	initMingxinMosaicWordmark,
	type MingxinMosaicWordmarkController,
} from "./home-mosaic-wordmark";

type MosaicTileLayoutItem = {
	x: number;
	y: number;
	width: number;
	height: number;
	blur?: number;
};

export type MingxinMosaicConfig = {
	rows: number;
	columns: number;
	idleVisible: number;
	seed: number;
	initialLayout: MosaicTileLayoutItem[];
	scrub: number;
	desktopScrollDistance: number;
	desktopMinViewports: number;
	tailDistance: number;
	handoffDistance: number;
	rain: { enabled?: boolean; intensity?: number; color?: string };
};

/* ---------------- 碎片布局（原站 createHeroTileLayout，种子随机） ---------------- */

export type MingxinTileLayout = {
	index: number;
	row: number;
	column: number;
	order: number;
	offsetX: number;
	offsetY: number;
	rotation: number;
	scale: number;
	blur: number;
	idleDepth: number;
	initiallyVisible: boolean;
};

function createSeededRandom(seed: number) {
	let value = seed >>> 0;
	return () => {
		value += 0x6d2b79f5;
		let result = value;
		result = Math.imul(result ^ (result >>> 15), result | 1);
		result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
		return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
	};
}

export function createMingxinTileLayout(config: {
	rows: number;
	columns: number;
	idleVisible: number;
	seed: number;
}): MingxinTileLayout[] {
	const { rows, columns, idleVisible, seed } = config;
	const tileCount = Math.max(1, rows * columns);
	const random = createSeededRandom(seed);
	const order = Array.from({ length: tileCount }, (_, index) => index);

	for (let index = order.length - 1; index > 0; index--) {
		const swapIndex = Math.floor(random() * (index + 1));
		[order[index], order[swapIndex]] = [order[swapIndex], order[index]];
	}

	const revealOrder = new Map(
		order.map((tileIndex, index) => [tileIndex, index]),
	);
	return Array.from({ length: tileCount }, (_, index) => {
		const rank = revealOrder.get(index) ?? index;
		const initiallyVisible =
			rank < Math.min(tileCount, Math.max(1, idleVisible));
		const idleDepth = initiallyVisible ? rank : idleVisible;
		const idleProgress =
			Math.min(tileCount, Math.max(1, idleVisible)) > 1
				? idleDepth / (Math.min(tileCount, Math.max(1, idleVisible)) - 1)
				: 0;
		return {
			index,
			row: Math.floor(index / columns),
			column: index % columns,
			order: rank,
			offsetX: Number(((random() - 0.5) * 150).toFixed(3)),
			offsetY: Number(((random() - 0.5) * 115).toFixed(3)),
			rotation: Number(((random() - 0.5) * 18).toFixed(3)),
			scale: Number(
				(initiallyVisible
					? 1.18 - idleProgress * 0.38
					: 0.72 + random() * 0.34
				).toFixed(3),
			),
			blur: Number(
				(initiallyVisible ? idleProgress * 7 : random() * 5).toFixed(3),
			),
			idleDepth,
			initiallyVisible,
		};
	});
}

/* ---------------- 拼图底纹（原站 createHeroPuzzleLayout） ---------------- */

const PUZZLE_COLUMNS = 18;
const PUZZLE_ROWS = 12;
const PUZZLE_SEED = 20261015;
/** 用户单位：viewBox 网格边长，渲染时由 preserveAspectRatio 统一缩放 */
const PUZZLE_CELL = 100;
/** 榫头凸起的底宽与凸出深度（用户单位），约 3.5:1 的平缓圆丘 */
const PUZZLE_TAB_WIDTH = 46;
const PUZZLE_TAB_DEPTH = 13;
/** 半余弦丘的三次贝塞尔逼近常数（切线连续，见原站注释） */
const PUZZLE_TAB_TANGENT = 0.3642;

export type MingxinPuzzleLayout = {
	viewBox: string;
	width: number;
	height: number;
	seams: string[];
};

const round2 = (value: number): number => Number(value.toFixed(2));

function createPuzzleSeam(options: {
	line: number;
	length: number;
	count: number;
	horizontal: boolean;
	random: () => number;
}): string {
	const { line, length, count, horizontal, random } = options;
	const half = PUZZLE_TAB_WIDTH / 2;
	const tangent = half * PUZZLE_TAB_TANGENT;
	const point = (along: number, across: number) =>
		horizontal
			? `${round2(along)} ${round2(across)}`
			: `${round2(across)} ${round2(along)}`;

	let d = `M ${point(0, line)}`;
	for (let index = 0; index < count; index += 1) {
		const center = (index + 0.5) * PUZZLE_CELL;
		const apex = line + (random() < 0.5 ? -1 : 1) * PUZZLE_TAB_DEPTH;
		const start = center - half;
		const end = center + half;
		d += ` L ${point(start, line)}`;
		d += ` C ${point(start + tangent, line)} ${point(center - tangent, apex)} ${point(center, apex)}`;
		d += ` C ${point(center + tangent, apex)} ${point(end - tangent, line)} ${point(end, line)}`;
	}
	return `${d} L ${point(length, line)}`;
}

/** 首屏拼图底层：只出缝线不出色块，构建期算完即固定（与原站同） */
export function createMingxinPuzzleLayout(): MingxinPuzzleLayout {
	const random = createSeededRandom(PUZZLE_SEED);
	const width = PUZZLE_COLUMNS * PUZZLE_CELL;
	const height = PUZZLE_ROWS * PUZZLE_CELL;
	const seams: string[] = [];

	for (let row = 0; row < PUZZLE_ROWS - 1; row += 1) {
		seams.push(
			createPuzzleSeam({
				line: (row + 1) * PUZZLE_CELL,
				length: width,
				count: PUZZLE_COLUMNS,
				horizontal: true,
				random,
			}),
		);
	}
	for (let column = 0; column < PUZZLE_ROWS - 1; column += 1) {
		seams.push(
			createPuzzleSeam({
				line: (column + 1) * PUZZLE_CELL,
				length: height,
				count: PUZZLE_ROWS,
				horizontal: false,
				random,
			}),
		);
	}

	return {
		viewBox: `0 0 ${width} ${height}`,
		width,
		height,
		seams,
	};
}

/* ------------- 照片描边路径（原站 createHeroPhotoFramePaths） ------------- */

/**
 * 照片描边蔓延路径：8 条笔画，各自从某个圆角弧线 45° 中点出发、
 * 沿单边延伸到该边中点。配合 pathLength=1000 + dashoffset 1000→0，
 * 边框就从四角同时向四边中点蔓延闭合成框。
 * 路径画在描边中心线上：相对图片盒外扩 thickness/2，圆角半径同步放大。
 */
export function createMingxinPhotoFramePaths(
	width: number,
	height: number,
	thickness: number,
	radius: number,
): string[] {
	const x0 = -thickness / 2;
	const y0 = -thickness / 2;
	const x1 = width + thickness / 2;
	const y1 = height + thickness / 2;
	const r = radius + thickness / 2;
	const cx = (x0 + x1) / 2;
	const cy = (y0 + y1) / 2;
	// 45° 弧中点相对切点的内缩距离：r·(1 − √2/2)
	const k = r * (1 - Math.SQRT1_2);
	const f = (n: number) => Math.round(n * 100) / 100;
	return [
		`M ${f(x0 + k)} ${f(y0 + k)} A ${f(r)} ${f(r)} 0 0 1 ${f(x0 + r)} ${f(y0)} L ${f(cx)} ${f(y0)}`,
		`M ${f(x0 + k)} ${f(y0 + k)} A ${f(r)} ${f(r)} 0 0 0 ${f(x0)} ${f(y0 + r)} L ${f(x0)} ${f(cy)}`,
		`M ${f(x1 - k)} ${f(y0 + k)} A ${f(r)} ${f(r)} 0 0 0 ${f(x1 - r)} ${f(y0)} L ${f(cx)} ${f(y0)}`,
		`M ${f(x1 - k)} ${f(y0 + k)} A ${f(r)} ${f(r)} 0 0 1 ${f(x1)} ${f(y0 + r)} L ${f(x1)} ${f(cy)}`,
		`M ${f(x1 - k)} ${f(y1 - k)} A ${f(r)} ${f(r)} 0 0 0 ${f(x1)} ${f(y1 - r)} L ${f(x1)} ${f(cy)}`,
		`M ${f(x1 - k)} ${f(y1 - k)} A ${f(r)} ${f(r)} 0 0 1 ${f(x1 - r)} ${f(y1)} L ${f(cx)} ${f(y1)}`,
		`M ${f(x0 + k)} ${f(y1 - k)} A ${f(r)} ${f(r)} 0 0 1 ${f(x0 + r)} ${f(y1)} L ${f(cx)} ${f(y1)}`,
		`M ${f(x0 + k)} ${f(y1 - k)} A ${f(r)} ${f(r)} 0 0 0 ${f(x0)} ${f(y1 - r)} L ${f(x0)} ${f(cy)}`,
	];
}

/* ---------------- 控制器 ---------------- */

const DESKTOP_MEDIA_QUERY = "(min-width: 769px)";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * 原站时间线关键点（GSAP 时间线总长 1.52，照 home-hero-controller）：
 * 标题 0–0.10 收缩（yPercent −20、scale 0.58、原点左中，power3.inOut）；
 * 静止碎片 0.04 起淡出（0.06，power2.in）；碎片按 order 在
 * 0.10 + order×0.02 起飞、单块 0.09 走完（power3.inOut）；
 * 整图 0.72 起淡入（0.03）、0.75 碎片网格整层隐藏；
 * 标题 0.72 退场（0.08，power2.in，上抬 46px）；
 * 0.75–0.91 导引线/纯色底/照片描边同步铺开（power2.inOut，竖线晚 0.03）；
 * 照片落位 0.91–1.11（power3.inOut），倾斜 −3° 走 0.91–1.36（power1.inOut）；
 * 介绍票签 1.11 起错峰 0.05 倒下（单张 0.16，power2.out，自 rotate 90°）；
 * 雨在 T ≥ 1.14 激活；1.46–1.52 驻留（interactionHold 0.06）。
 * 本站交接段接在 1.52 之后（0.18）：照片放大回正盖满舞台、票签/导引线/
 * 纯色底与缝线依次淡出、整层在后 30% 交叉淡化，揭示段接管。
 *
 * 滚动映射照原站压缩口径：主体段（T 0–1.34）按
 * baseDistance = max(desktopScrollDistance, vh × desktopMinViewports)
 * 的自然速率走；尾巴段（T 1.34–1.52）压缩进 tailDistance；
 * 交接段（T 1.52–1.70）走 handoffDistance。
 */
const TIMELINE_TOTAL = 1.52;
const HANDOFF_DURATION = 0.18;
const TIMELINE_END = TIMELINE_TOTAL + HANDOFF_DURATION;
const BODY_END_TIME = 1.34;
const TITLE_SHRINK_END = 0.1;
const TITLE_EXIT_TIME = 0.72;
const TITLE_EXIT_DURATION = 0.08;
const TITLE_EXIT_LIFT = 46;
const IDLE_FADE_START = 0.04;
const IDLE_FADE_DURATION = 0.06;
const TILE_START_BASE = 0.1;
const TILE_START_STEP = 0.02;
const TILE_DURATION = 0.09;
const COMPLETE_FADE_START = 0.72;
const COMPLETE_FADE_DURATION = 0.03;
const GRID_HIDE_TIME = 0.75;
const GUIDE_REVEAL_TIME = 0.75;
const GUIDE_REVEAL_DURATION = 0.16;
const GUIDE_VERTICAL_DELAY = 0.03;
const GUIDE_DASH_FLOW = 52;
const PHOTO_SETTLE_TIME = GUIDE_REVEAL_TIME + GUIDE_REVEAL_DURATION;
const PHOTO_SETTLE_DURATION = 0.2;
const PHOTO_ROTATION = -3;
const PHOTO_ROTATION_TAIL = 0.25;
/* 叠图（原站 PHOTO_OVERLAY_*）：自身倾角 / 滑入起点（以主图高为单位）/
   在照片框内的落位（top / width 分数，与 CSS 同值，几何计算要用） */
const PHOTO_OVERLAY_ROTATION = 5;
const PHOTO_OVERLAY_SLIDE_IN = 0.55;
const PHOTO_OVERLAY_TOP = 0.64;
const PHOTO_OVERLAY_WIDTH = 0.74;
const PHOTO_WIDTH_RATIO = 0.62;
const PHOTO_HEIGHT_RATIO = 0.96;
const PHOTO_FRAME_THICKNESS_REM = 0.5;
const PHOTO_FRAME_RADIUS_REM = 0.75;
const INTRO_REVEAL_TIME = PHOTO_SETTLE_TIME + PHOTO_SETTLE_DURATION;
const INTRO_DURATION = 0.16;
const INTRO_STAGGER = 0.05;
const RAIN_ACTIVATE_TIME = 1.14;
/** 交接进度到此摘掉前段保持：揭示文字层的 300ms 淡入与整层淡出重叠 */
const HANDOFF_RELEASE_AT = 0.7;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const seg = (time: number, start: number, duration: number) =>
	clamp01((time - start) / Math.max(0.0001, duration));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** GSAP power2.in（三次方入） */
const EASE_CUBIC_IN = (t: number) => t ** 3;
/** GSAP power2.out（三次方出） */
const EASE_CUBIC_OUT = (t: number) => 1 - (1 - t) ** 3;
/** GSAP power3.out（四次方出） */
const EASE_QUART_OUT = (t: number) => 1 - (1 - t) ** 4;
/** GSAP power2.inOut（三次方进出） */
const EASE_CUBIC_IN_OUT = (t: number) =>
	t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
/** GSAP power1.inOut（二次方进出） */
const EASE_QUAD_IN_OUT = (t: number) =>
	t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
/** GSAP power3.inOut（四次方进出） */
const EASE_QUART_IN_OUT = (t: number) =>
	t < 0.5 ? 8 * t ** 4 : 1 - (-2 * t + 2) ** 4 / 2;

type TileState = {
	element: HTMLElement;
	image: HTMLElement;
	row: number;
	column: number;
	order: number;
	offsetX: number;
	offsetY: number;
	rotation: number;
	scale: number;
	blur: number;
	initiallyVisible: boolean;
};

type TileTransform = {
	x: number;
	y: number;
	rotation: number;
	scaleX: number;
	scaleY: number;
	blur: number;
	alpha: number;
};

function readNumber(element: HTMLElement, key: string, fallback: number) {
	const value = Number.parseFloat(element.dataset[key] ?? "");
	return Number.isFinite(value) ? value : fallback;
}

export function mountMingxinMosaic(root: HTMLElement): () => void {
	if (
		!window.matchMedia(DESKTOP_MEDIA_QUERY).matches ||
		window.matchMedia(REDUCED_MOTION_QUERY).matches
	) {
		return () => undefined;
	}
	const layer = root.querySelector<HTMLElement>("[data-mosaic-layer]");
	const section = root.querySelector<HTMLElement>("[data-mosaic-section]");
	const configNode = root.querySelector<HTMLScriptElement>(
		"[data-mosaic-config]",
	);
	if (!layer || !section || !configNode) return () => undefined;
	let config: MingxinMosaicConfig;
	try {
		config = JSON.parse(
			configNode.textContent ?? "{}",
		) as MingxinMosaicConfig;
	} catch {
		return () => undefined;
	}
	if (!config || !config.columns || !config.rows) return () => undefined;

	const grid = layer.querySelector<HTMLElement>("[data-mosaic-grid]");
	const complete = layer.querySelector<HTMLElement>("[data-mosaic-complete]");
	const completeImage = layer.querySelector<HTMLImageElement>(
		"[data-mosaic-complete-img]",
	);
	const frame = layer.querySelector<HTMLElement>("[data-mosaic-frame]");
	const backdrop = layer.querySelector<HTMLElement>("[data-mosaic-backdrop]");
	const puzzle = layer.querySelector<HTMLElement>("[data-mosaic-puzzle]");
	const targetBox = layer.querySelector<HTMLElement>("[data-mosaic-target]");
	const guideV = layer.querySelector<HTMLElement>("[data-mosaic-guide-v]");
	const guideH = layer.querySelector<HTMLElement>("[data-mosaic-guide-h]");
	const guideVLines = Array.from(
		guideV?.querySelectorAll<SVGLineElement>("line") ?? [],
	);
	const identity = layer.querySelector<HTMLElement>("[data-mosaic-identity]");
	const titleText = layer.querySelector<HTMLElement>(
		"[data-mosaic-title-text]",
	);
	const occupation = layer.querySelector<HTMLElement>(
		"[data-mosaic-occupation]",
	);
	const introCards = Array.from(
		layer.querySelectorAll<HTMLElement>("[data-mosaic-intro-card]"),
	);
	const photoFramePaths = Array.from(
		layer.querySelectorAll<SVGPathElement>(
			"[data-mosaic-photo-frame] path",
		),
	);
	const photoFrameSvg = layer.querySelector<HTMLElement>(
		"[data-mosaic-photo-frame]",
	);
	const photoOverlay = layer.querySelector<HTMLElement>(
		"[data-mosaic-photo-overlay]",
	);
	const photoOverlayImage = layer.querySelector<HTMLImageElement>(
		"[data-mosaic-photo-overlay-img]",
	);
	const rainCanvas = layer.querySelector<HTMLCanvasElement>(
		"[data-mosaic-rain]",
	);
	if (!grid || !complete || !completeImage || !frame) return () => undefined;

	/* 叠图轮换选图（非 manual 时服务端不写 src）：口径与全站明信选图
	   脚本一致（候选 = 当前图 + 池、去重；random 每次挂载重挑；daily
	   按访客本地日期 + 槽名盐确定性轮换），但只在本控制器内跑——
	   作用域锁死在明信马赛克层，不动共享布局的选图脚本 */
	if (photoOverlay && photoOverlayImage) {
		const mode = photoOverlay.dataset.overlayMode ?? "manual";
		if (mode === "random" || mode === "daily") {
			let pool: string[] = [];
			try {
				pool = JSON.parse(photoOverlay.dataset.overlayPool ?? "[]");
			} catch {
				pool = [];
			}
			const candidates: string[] = [];
			for (const value of [photoOverlay.dataset.overlayCur ?? "", ...pool]) {
				if (value && !candidates.includes(value)) candidates.push(value);
			}
			if (candidates.length) {
				let picked = candidates[0];
				if (mode === "random" && candidates.length > 1) {
					picked =
						candidates[Math.floor(Math.random() * candidates.length)];
				} else if (mode === "daily" && candidates.length > 1) {
					const now = new Date();
					const key = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}|mosaicOverlay`;
					let hash = 5381;
					for (let i = 0; i < key.length; i++) {
						hash = ((hash << 5) + hash + key.charCodeAt(i)) | 0;
					}
					picked = candidates[Math.abs(hash) % candidates.length];
				}
				if (picked) photoOverlayImage.setAttribute("src", picked);
			}
		}
	}

	const tiles: TileState[] = Array.from(
		layer.querySelectorAll<HTMLElement>("[data-mosaic-tile]"),
	).map((element) => ({
		element,
		image: element.querySelector<HTMLElement>(
			"[data-mosaic-tile-img]",
		) as HTMLElement,
		row: readNumber(element, "row", 0),
		column: readNumber(element, "column", 0),
		order: readNumber(element, "order", 0),
		offsetX: readNumber(element, "offsetX", 0),
		offsetY: readNumber(element, "offsetY", 0),
		rotation: readNumber(element, "rotation", 0),
		scale: readNumber(element, "scale", 1),
		blur: readNumber(element, "blur", 0),
		initiallyVisible: element.dataset.idleVisible === "true",
	}));
	if (tiles.length === 0) return () => undefined;

	const abortController = new AbortController();
	const signal = abortController.signal;
	const rain: MingxinMosaicRainController = initMingxinMosaicRain(
		rainCanvas,
		config.rain ?? {},
	);
	/* 字标描边动画：容器即 [data-mosaic-title-text] 包装层（占位文字 +
	   canvas）；启停由 render 按 TITLE_EXIT_TIME 门控（见标题段） */
	const wordmark: MingxinMosaicWordmarkController =
		initMingxinMosaicWordmark(titleText);
	if (identity) identity.style.transformOrigin = "0% 50%";

	/* 滚动映射（原站压缩口径）：baseDistance 的自然速率走主体段，
	   尾巴与交接各走自己的距离 */
	const tailDistance = Math.max(1, config.tailDistance || 240);
	const handoffDistance = Math.max(1, config.handoffDistance || 520);
	let baseDistance = 1;
	let bodyDistance = 1;
	let totalDistance = 1;

	/* 照片几何（原站 measureMosaic 的本站量法，见 measure） */
	const geometry = {
		frameW: 1,
		frameH: 1,
		guideW: 1,
		bandH: 1,
		scale: 1,
		photoW: 1,
		settledX: 0,
		settledY: 0,
		coverScale: 1,
	};
	let framePathsKey = "";

	let stageWidth = Math.max(1, layer.clientWidth);
	let stageHeight = Math.max(1, layer.clientHeight);
	let identityHeight = 0;
	let segmentStart = 0;
	/** scrub 追赶时间常数：与影像层同族（0.45 → ≈0.2s） */
	const smoothing = 0.045 + config.scrub * 0.35;

	let target = 0;
	let value = 0;
	let chaseFrame = 0;
	let chaseLastTime = 0;
	let syncFrame = 0;
	let resizeTimer = 0;
	let layerShown: boolean | null = null;
	let gridShown: boolean | null = null;
	let rainWanted: boolean | null = null;
	let frontHeld: boolean | null = null;
	let tilesIntroPlayed = false;
	let titleIntroPlayed = false;
	let introSkipped = false;
	let titleIntroAnimations: Animation[] = [];

	const pxToTime = (px: number) => {
		if (px <= 0) return 0;
		if (px <= bodyDistance) return (px * TIMELINE_TOTAL) / baseDistance;
		if (px <= bodyDistance + tailDistance) {
			return (
				BODY_END_TIME +
				((px - bodyDistance) / tailDistance) *
					(TIMELINE_TOTAL - BODY_END_TIME)
			);
		}
		return (
			TIMELINE_TOTAL +
			((px - bodyDistance - tailDistance) / handoffDistance) *
				HANDOFF_DURATION
		);
	};

	const measure = () => {
		const vh = window.innerHeight;
		const rem =
			Number.parseFloat(getComputedStyle(document.documentElement).fontSize) ||
			16;
		baseDistance = Math.max(
			1,
			config.desktopScrollDistance || 3250,
			vh * (config.desktopMinViewports || 4.05),
		);
		bodyDistance = baseDistance * (BODY_END_TIME / TIMELINE_TOTAL);
		totalDistance = bodyDistance + tailDistance + handoffDistance;
		section.style.height = `${vh + totalDistance}px`;
		segmentStart = section.getBoundingClientRect().top + window.scrollY;
		stageWidth = Math.max(1, layer.clientWidth);
		stageHeight = Math.max(1, layer.clientHeight);
		identityHeight = identity?.offsetHeight ?? 0;

		/* 照片几何：量尺与原站 measureMosaic 同构——画幅带高取量尺盒，
		   导引线列宽取竖线容器宽，落位尺寸先撞到的约束生效 */
		const bandH = Math.max(
			1,
			targetBox?.offsetHeight ?? stageHeight - 2 * (stageHeight * 0.045),
		);
		/* 竖线列宽照原站量法读计算样式（SVG 元素没有可靠的 offsetWidth） */
		const guideW =
			Number.parseFloat(
				guideV ? getComputedStyle(guideV).width : "",
			) || stageWidth;
		const cssFrameW = Math.min(stageWidth * 0.84, 90 * rem);
		const aspect =
			completeImage.naturalWidth > 0
				? completeImage.naturalWidth / completeImage.naturalHeight
				: 0;
		let frameW = cssFrameW;
		let frameH = aspect > 0 ? frameW / aspect : frame.offsetHeight || frameW;
		if (aspect > 0 && frameH > bandH) {
			/* 本站适配：照片偏高时按画幅带封顶宽度，整图与静止碎片不出舞台 */
			frameW = bandH * aspect;
			frameH = bandH;
		}
		frame.style.width = `${Math.round(frameW)}px`;
		const frameStyle = getComputedStyle(frame);
		const bottomPx = Number.parseFloat(frameStyle.bottom) || 0;
		const frameTop = stageHeight - bottomPx - frameH;
		/* 叠图几何（原站 measureMosaic 同款）：整组按「主图 + 叠图伸出
		   部分」的总高缩放，落位纵心按总高居中，两张图的倾角留白
		   都必须留在画幅内；无叠图时 stackBottom 退回 frameH、与旧版等价 */
		const overlayAspect =
			photoOverlayImage && photoOverlayImage.naturalWidth > 0
				? photoOverlayImage.naturalWidth / photoOverlayImage.naturalHeight
				: 0;
		const overlayW = photoOverlay ? frameW * PHOTO_OVERLAY_WIDTH : 0;
		const overlayH =
			photoOverlay && overlayAspect > 0 ? overlayW / overlayAspect : 0;
		const stackBottom = Math.max(
			frameH,
			photoOverlay ? frameH * PHOTO_OVERLAY_TOP + overlayH : frameH,
		);
		const rotationPadding =
			frameW * Math.abs(Math.sin((PHOTO_ROTATION * Math.PI) / 180)) +
			overlayW * Math.abs(Math.sin((PHOTO_OVERLAY_ROTATION * Math.PI) / 180));
		const scale = Math.min(
			1,
			(guideW * PHOTO_WIDTH_RATIO) / frameW,
			(bandH * PHOTO_HEIGHT_RATIO) / (stackBottom + rotationPadding),
		);
		const photoW = frameW * scale;
		Object.assign(geometry, {
			frameW,
			frameH,
			guideW,
			bandH,
			scale,
			photoW,
			settledX: (photoW - guideW) / 2,
			settledY:
				stageHeight / 2 -
				(frameTop + frameH / 2) -
				((stackBottom - frameH) * scale) / 2,
			coverScale: Math.max(stageWidth / frameW, stageHeight / frameH),
		});
		layer.style.setProperty("--mx-photo-w", `${Math.round(photoW)}px`);

		/* 照片描边路径按实测尺寸生成（原站 updatePhotoFrame） */
		const key = `${Math.round(frameW)}x${Math.round(frameH)}`;
		if (key !== framePathsKey && photoFramePaths.length === 8) {
			framePathsKey = key;
			const paths = createMingxinPhotoFramePaths(
				frameW,
				frameH,
				PHOTO_FRAME_THICKNESS_REM * rem,
				PHOTO_FRAME_RADIUS_REM * rem,
			);
			photoFramePaths.forEach((path, index) => {
				path.setAttribute("d", paths[index] ?? "");
			});
		}
	};

	/** 静止碎片位姿：按 initialLayout 分数落位（原站 getTileInitialTransform）。
	 * 坐标系是照片框（本站拼合框 = 照片框，框尺寸见 geometry） */
	const getInitialTransform = (tile: TileState): TileTransform => {
		const layout = config.initialLayout?.[tile.order];
		const frameW = geometry.frameW;
		const frameH = geometry.frameH;
		const tileWidth = frameW / config.columns;
		const tileHeight = frameH / config.rows;
		const tileCenterX = (tile.column + 0.5) * tileWidth;
		const tileCenterY = (tile.row + 0.5) * tileHeight;
		if (!layout) {
			/* 兜底（原站 getTileIdleTransform）：按偏移映射进画幅中段 */
			const depth = tile.order % Math.max(1, config.idleVisible);
			const depthProgress =
				config.idleVisible > 1 ? depth / (config.idleVisible - 1) : 0;
			const normalizedX = (tile.offsetX + 75) / 150;
			const normalizedY = (tile.offsetY + 57.5) / 115;
			return {
				x: frameW * (0.04 + normalizedX * 0.92) - tileCenterX,
				y: frameH * (0.3 + normalizedY * 0.62) - tileCenterY,
				rotation: tile.rotation,
				scaleX: 1.18 - depthProgress * 0.38,
				scaleY: 1.18 - depthProgress * 0.38,
				blur: depthProgress * 7,
				alpha: 1,
			};
		}
		const clampRatio = (v: number, fallback: number) =>
			Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;
		return {
			x: clampRatio(layout.x, 0.5) * frameW - tileCenterX,
			y: clampRatio(layout.y, 0.5) * frameH - tileCenterY,
			rotation: 0,
			scaleX: Math.max(0.01, clampRatio(layout.width, 1 / config.columns)) *
				config.columns,
			scaleY: Math.max(0.01, clampRatio(layout.height, 1 / config.rows)) *
				config.rows,
			/* 原站：layout 未写 blur 即 0（近景大片全清），不回落种子 blur；
			   曾回落 tile.blur 导致 rank 3–5 的大片带 4.2–7px 糊，2026-11-01 修 */
			blur: Number.isFinite(layout.blur)
				? Math.max(0, layout.blur ?? 0)
				: 0,
			alpha: 1,
		};
	};

	/** 入场位姿：散射在画幅外围、带景深模糊（原站 getTileEntranceTransform：
	 * 距离量尺第一项取 hero（舞台）宽高、第二项取 mosaic 框宽高，
	 * 2026-11-01 对齐——此前两项都用舞台尺寸，散射范围偏大 2–3 成） */
	const getEntranceTransform = (tile: TileState): TileTransform => {
		const horizontalRange = Math.max(stageWidth * 0.29, geometry.frameW * 0.48);
		const verticalRange = Math.max(stageHeight * 0.24, geometry.frameH * 0.78);
		const normalizedX = tile.offsetX / 75;
		const normalizedY = tile.offsetY / 57.5;
		const distance = Math.hypot(normalizedX, normalizedY);
		const minimumTravel = 0.52;
		const travelMultiplier =
			distance > 0 && distance < minimumTravel
				? minimumTravel / distance
				: 1;
		const scale =
			0.66 + Math.min(0.16, Math.max(0, (tile.scale - 0.72) * 0.48));
		return {
			x: normalizedX * travelMultiplier * horizontalRange,
			y: normalizedY * travelMultiplier * verticalRange,
			rotation: tile.rotation * 0.12,
			scaleX: scale,
			scaleY: scale,
			blur: 13 + (tile.blur / 5) * 10,
			alpha: 0,
		};
	};

	const writeTile = (tile: TileState, t: TileTransform) => {
		const el = tile.element;
		el.style.opacity = String(t.alpha);
		el.style.visibility = t.alpha > 0 ? "visible" : "hidden";
		el.style.transform = `translate3d(${t.x.toFixed(1)}px, ${t.y.toFixed(1)}px, 0) rotate(${t.rotation.toFixed(2)}deg) scale(${t.scaleX.toFixed(3)}, ${t.scaleY.toFixed(3)})`;
		el.style.filter = t.blur > 0.05 ? `blur(${t.blur.toFixed(1)}px)` : "none";
	};

	/** 前段保持：前段未交接完时按住影像层的首屏文字（祝愿各位），
	 * 摘掉后它按自己的 300ms 过渡淡入，与整层淡出重叠完成交接 */
	const setFrontHeld = (held: boolean) => {
		if (frontHeld === held) return;
		frontHeld = held;
		if (held) root.dataset.mosaicFront = "hold";
		else delete root.dataset.mosaicFront;
	};

	const setRainWanted = (wanted: boolean) => {
		if (rainWanted === wanted) return;
		rainWanted = wanted;
		rain.setActive(wanted);
	};

	const render = (time: number) => {
		const scrollY = window.scrollY;
		const inSegment = scrollY <= segmentStart + totalDistance;
		if (layerShown !== inSegment) {
			layerShown = inSegment;
			layer.style.display = inSegment ? "block" : "none";
		}
		if (!inSegment) {
			setFrontHeld(false);
			setRainWanted(false);
			return;
		}

		const handoff = seg(time, TIMELINE_TOTAL, HANDOFF_DURATION);
		setFrontHeld(
			time < TIMELINE_TOTAL + HANDOFF_DURATION * HANDOFF_RELEASE_AT,
		);
		setRainWanted(time >= RAIN_ACTIVATE_TIME && time < TIMELINE_TOTAL);

		/* ---- 碎片：静止淡出 → 逐块飞回（原站时间线 0–0.75） ---- */
		const idleAlpha =
			1 - EASE_CUBIC_IN(seg(time, IDLE_FADE_START, IDLE_FADE_DURATION));
		for (const tile of tiles) {
			const start = TILE_START_BASE + tile.order * TILE_START_STEP;
			if (time < start) {
				if (!tile.initiallyVisible) {
					if (tile.element.style.visibility !== "hidden")
						writeTile(tile, { ...getEntranceTransform(tile), alpha: 0 });
					continue;
				}
				const initial = getInitialTransform(tile);
				writeTile(tile, { ...initial, alpha: idleAlpha });
				continue;
			}
			const eased = EASE_QUART_IN_OUT(seg(time, start, TILE_DURATION));
			const from = getEntranceTransform(tile);
			writeTile(tile, {
				x: from.x * (1 - eased),
				y: from.y * (1 - eased),
				rotation: from.rotation * (1 - eased),
				scaleX: from.scaleX + (1 - from.scaleX) * eased,
				scaleY: from.scaleY + (1 - from.scaleY) * eased,
				blur: from.blur * (1 - eased),
				alpha: eased,
			});
		}

		const completeAlpha = seg(
			time,
			COMPLETE_FADE_START,
			COMPLETE_FADE_DURATION,
		);
		complete.style.opacity = String(completeAlpha);
		complete.style.visibility = completeAlpha > 0 ? "visible" : "hidden";

		const showGrid = time < GRID_HIDE_TIME;
		if (gridShown !== showGrid) {
			gridShown = showGrid;
			grid.style.display = showGrid ? "block" : "none";
		}

		/* ---- 交接周边淡出：纯色底与拼图缝线在中段一起退，
		   露出舞台下方的揭示图（与照片放大同步进行） ---- */
		const periphery = clamp01((handoff - 0.2) / 0.5);
		if (backdrop) {
			backdrop.style.opacity = String(
				EASE_CUBIC_IN_OUT(seg(time, GUIDE_REVEAL_TIME, GUIDE_REVEAL_DURATION)) *
					(1 - periphery),
			);
		}
		if (puzzle) puzzle.style.opacity = String(1 - periphery);

		/* ---- 导引线：横线先铺、竖线晚一拍，竖线虚线整周期流动 ---- */
		const guideFade = 1 - clamp01(handoff / 0.5);
		if (guideH) {
			const clip =
				50 *
				(1 - EASE_CUBIC_IN_OUT(seg(time, GUIDE_REVEAL_TIME, GUIDE_REVEAL_DURATION)));
			guideH.style.clipPath = `inset(-5px ${clip.toFixed(2)}% -5px ${clip.toFixed(2)}%)`;
			guideH.style.opacity = String(guideFade);
		}
		if (guideV) {
			const clip =
				50 *
				(1 -
					EASE_CUBIC_IN_OUT(
						seg(time, GUIDE_REVEAL_TIME + GUIDE_VERTICAL_DELAY, GUIDE_REVEAL_DURATION),
					));
			guideV.style.clipPath = `inset(${clip.toFixed(2)}% -5px ${clip.toFixed(2)}% -5px)`;
			guideV.style.opacity = String(guideFade);
			const dash =
				13 +
				GUIDE_DASH_FLOW *
					EASE_CUBIC_IN_OUT(
						seg(time, GUIDE_REVEAL_TIME, GUIDE_REVEAL_DURATION + PHOTO_SETTLE_DURATION),
					);
			for (const line of guideVLines) {
				line.style.strokeDashoffset = `${dash.toFixed(1)}px`;
			}
		}

		/* ---- 照片描边：与导引线同段自四角蔓延，交接初段先淡掉 ---- */
		if (photoFramePaths.length) {
			const offset =
				1000 *
				(1 - EASE_CUBIC_IN_OUT(seg(time, GUIDE_REVEAL_TIME, GUIDE_REVEAL_DURATION)));
			for (const path of photoFramePaths) {
				path.style.strokeDashoffset = `${offset.toFixed(0)}`;
			}
		}
		if (photoFrameSvg) {
			photoFrameSvg.style.opacity = String(1 - clamp01(handoff / 0.3));
		}

		/* ---- 照片框：落位（平移/缩放/倾斜）→ 交接放大回正 ---- */
		const settle = EASE_QUART_IN_OUT(
			seg(time, PHOTO_SETTLE_TIME, PHOTO_SETTLE_DURATION),
		);
		const rotation =
			PHOTO_ROTATION *
			EASE_QUAD_IN_OUT(
				seg(time, PHOTO_SETTLE_TIME, PHOTO_SETTLE_DURATION + PHOTO_ROTATION_TAIL),
			);
		let frameX = geometry.settledX * settle;
		let frameY = geometry.settledY * settle;
		let frameScale = 1 + (geometry.scale - 1) * settle;
		let frameRotation = rotation;
		if (handoff > 0) {
			const zoom = EASE_CUBIC_IN_OUT(handoff);
			frameX = lerp(frameX, 0, zoom);
			frameScale = lerp(frameScale, geometry.coverScale, zoom);
			frameRotation = lerp(frameRotation, 0, zoom);
			/* frameY 不动：落位与盖满两态的纵向中心同为舞台中点（几何同式） */
		}
		frame.style.transform = `translate(${frameX.toFixed(1)}px, ${frameY.toFixed(1)}px) rotate(${frameRotation.toFixed(2)}deg) scale(${frameScale.toFixed(4)})`;
		if (handoff > 0) {
			complete.style.borderRadius = `${
				0.75 * (1 - EASE_CUBIC_IN_OUT(clamp01(handoff / 0.6)))
			}rem`;
		} else if (complete.style.borderRadius) {
			complete.style.borderRadius = "";
		}

		/* ---- 标题：滚动初段收缩、拼合末段退场 ---- */
		if (identity) {
			const shrink = EASE_QUART_IN_OUT(seg(time, 0, TITLE_SHRINK_END));
			const exit = EASE_CUBIC_IN(
				seg(time, TITLE_EXIT_TIME, TITLE_EXIT_DURATION),
			);
			identity.style.transform = `translateY(${(
				-0.2 * shrink * identityHeight -
				TITLE_EXIT_LIFT * exit
			).toFixed(1)}px) scale(${(1 - 0.42 * shrink).toFixed(4)})`;
			identity.style.opacity = String(1 - exit);
			identity.style.visibility = exit >= 1 ? "hidden" : "visible";
			/* 字标镜头只在标题退场前活动（原站 controller 同款门控）：
			   越过 0.72 后冻结在干净静止帧上随标题一起淡出 */
			wordmark.setActive(time < TITLE_EXIT_TIME);
		}

		/* ---- 介绍票签：落位后错峰倒下，交接初段淡出上移 ---- */
		const introFade = 1 - clamp01(handoff / 0.5);
		introCards.forEach((card, index) => {
			const e = EASE_CUBIC_OUT(
				seg(time, INTRO_REVEAL_TIME + index * INTRO_STAGGER, INTRO_DURATION),
			);
			card.style.opacity = String(e * introFade);
			card.style.visibility = e > 0 && introFade > 0 ? "visible" : "hidden";
			card.style.transform = `translateY(${(-24 * (1 - introFade)).toFixed(1)}px) rotate(${(90 * (1 - e)).toFixed(2)}deg)`;
		});

		/* ---- 照片叠图：与票签同拍滑入（原站 INTRO_REVEAL_TIME 的 fromTo：
		   自照片下缘外 55% 图高处升起、0 转正到 5°、power3.out）；
		   它骑在照片上随框缩放与交接，不单独淡出，与整层一起退场 ---- */
		if (photoOverlay) {
			const e = EASE_QUART_OUT(seg(time, INTRO_REVEAL_TIME, INTRO_DURATION));
			photoOverlay.style.opacity = String(e);
			photoOverlay.style.visibility = e > 0 ? "visible" : "hidden";
			photoOverlay.style.transform = `translateY(${(
				geometry.frameH *
				PHOTO_OVERLAY_SLIDE_IN *
				(1 - e)
			).toFixed(1)}px) rotate(${(PHOTO_OVERLAY_ROTATION * e).toFixed(2)}deg)`;
		}

		/* ---- 整层：交接后 30% 交叉淡出，揭示层接管 ---- */
		layer.style.opacity = String(1 - clamp01((handoff - 0.7) / 0.3));
	};

	/** 入场：静止碎片内层图依次浮现（原站 playTilesIntro，只动内层） */
	const playTilesIntro = () => {
		if (tilesIntroPlayed || introSkipped) return;
		tilesIntroPlayed = true;
		const idleImages = tiles
			.filter((tile) => tile.initiallyVisible)
			.map((tile) => tile.image)
			.filter(Boolean);
		idleImages.forEach((image, index) => {
			const animation = image.animate(
				[
					{ opacity: "0", transform: "translateY(18px) scale(0.96)" },
					{ opacity: "1", transform: "translateY(0px) scale(1)" },
				],
				{
					duration: 700,
					delay: 60 + index * 50,
					easing: "cubic-bezier(0.25, 0.46, 0.45, 0.94)",
					fill: "both",
				},
			);
			animation.addEventListener(
				"finish",
				() => {
					image.style.opacity = "1";
					image.style.transform = "none";
					animation.cancel();
				},
				{ once: true },
			);
		});
	};

	/**
	 * 入场：标题与副标题在字体就绪后浮现（原站 prepareFlyText 的 identity 段：
	 * 0.7s power2.out、延迟 0.5s、自 y+14 与透明）。挂载时先按住，
	 * 字体就绪才建动画；滚动已开始则直接落定（原站 completePendingIntros）。
	 */
	const playTitleIntro = () => {
		if (titleIntroPlayed || introSkipped) return;
		titleIntroPlayed = true;
		const hosts = [titleText, occupation].filter(
			(el): el is HTMLElement => Boolean(el),
		);
		if (!hosts.length) return;
		titleIntroAnimations = hosts.map((el) => {
			const animation = el.animate(
				[
					{ opacity: "0", transform: "translateY(14px)" },
					{ opacity: "1", transform: "translateY(0px)" },
				],
				{
					duration: 700,
					delay: 500,
					easing: "cubic-bezier(0.215, 0.61, 0.355, 1)",
					fill: "both",
				},
			);
			animation.addEventListener(
				"finish",
				() => {
					el.style.opacity = "";
					animation.cancel();
				},
				{ once: true },
			);
			return animation;
		});
	};

	/** 滚动已越过起点时不再补入场：内层与标题直接终态 */
	const skipIntro = () => {
		if (introSkipped) return;
		introSkipped = true;
		for (const tile of tiles) {
			if (!tile.image) continue;
			tile.image.style.opacity = "1";
			tile.image.style.transform = "none";
		}
		for (const animation of titleIntroAnimations) animation.cancel();
		titleIntroAnimations = [];
		for (const el of [titleText, occupation]) {
			if (el) el.style.opacity = "";
		}
	};

	const chaseTick = (now: number) => {
		const delta = chaseLastTime
			? Math.min((now - chaseLastTime) / 1000, 0.05)
			: 0;
		chaseLastTime = now;
		const difference = target - value;
		if (Math.abs(difference) < 0.0005) {
			value = target;
			chaseFrame = 0;
			render(value);
			return;
		}
		value += difference * (1 - Math.exp(-delta / smoothing));
		render(value);
		chaseFrame = requestAnimationFrame(chaseTick);
	};

	const sync = () => {
		if (signal.aborted) return;
		target = Math.min(
			TIMELINE_END,
			pxToTime(window.scrollY - segmentStart),
		);
		if (target > 0.002 || value > 0.002) skipIntro();
		if (!chaseFrame) {
			chaseLastTime = performance.now();
			chaseFrame = requestAnimationFrame(chaseTick);
		} else {
			render(value);
		}
	};

	const requestSync = () => {
		if (syncFrame || signal.aborted) return;
		syncFrame = requestAnimationFrame(() => {
			syncFrame = 0;
			sync();
		});
	};

	measure();
	target = Math.min(TIMELINE_END, pxToTime(window.scrollY - segmentStart));
	value = target;
	if (target > 0.002) {
		skipIntro();
	} else {
		/* 标题入场前先按住，等字体就绪再浮现；碎片入场等整图就绪 */
		for (const el of [titleText, occupation]) {
			if (el) el.style.opacity = "0";
		}
		if (document.fonts?.ready) {
			void document.fonts.ready.then(() => {
				if (signal.aborted || introSkipped) return;
				for (const el of [titleText, occupation]) {
					if (el) el.style.opacity = "";
				}
				playTitleIntro();
			});
		} else {
			for (const el of [titleText, occupation]) {
				if (el) el.style.opacity = "";
			}
			playTitleIntro();
		}
	}
	render(value);

	if (completeImage.complete && completeImage.naturalWidth > 0) {
		playTilesIntro();
	} else {
		completeImage.addEventListener(
			"load",
			() => {
				measure();
				render(value);
				playTilesIntro();
			},
			{ once: true, signal },
		);
	}

	/* 叠图慢加载：图到之前几何按无叠图算，到了重测一次（原站同款：
	   给叠图 img 挂 load 后刷新几何） */
	if (photoOverlayImage && !photoOverlayImage.complete) {
		photoOverlayImage.addEventListener(
			"load",
			() => {
				measure();
				render(value);
			},
			{ once: true, signal },
		);
	}

	window.addEventListener("scroll", requestSync, { passive: true, signal });
	window.addEventListener("resize", requestSync, { passive: true, signal });
	window.addEventListener(
		"resize",
		() => {
			window.clearTimeout(resizeTimer);
			resizeTimer = window.setTimeout(() => {
				if (signal.aborted) return;
				measure();
				sync();
			}, 160);
		},
		{ signal },
	);
	/* 与影像层同一时机重测：swup 回页后布局落位再校准一次 */
	const settleTimer = window.setTimeout(() => {
		if (signal.aborted) return;
		measure();
		sync();
	}, 600);

	return () => {
		abortController.abort();
		window.clearTimeout(resizeTimer);
		window.clearTimeout(settleTimer);
		if (syncFrame) cancelAnimationFrame(syncFrame);
		if (chaseFrame) cancelAnimationFrame(chaseFrame);
		for (const animation of titleIntroAnimations) animation.cancel();
		rain.destroy();
		wordmark.destroy();
		setFrontHeld(false);
		layer.style.display = "none";
		section.style.height = "";
	};
}
