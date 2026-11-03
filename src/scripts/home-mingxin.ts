/**
 * 明信首页影像层驱动：揭示背景、标题视差、全屏图 clip-path 收缩进首幕图框、
 * 五幕横向位移、拼图循环、终幕放大与退场模糊。
 *
 * 移植自参考站 home-blinds.ts（scroll + rAF + WAAPI，不引入动画库）；
 * 二期补齐：气泡墙（home-blinds-bubbles）、立绘巡航（home-blinds-stands）
 * 与左下黑猫对话的显隐回调（deps），showAct/hideAct 三层同进同退。
 * 阶段、缓动与关键常量与参考一致。
 */

import { commentConfig } from "@/config/commentConfig";
import {
	type BubbleMessage,
	type BubbleSlot,
	startBubbleWall,
} from "./mingxin/home-blinds-bubbles";
import { startStandRail } from "./mingxin/home-blinds-stands";

type MingxinRuntimeConfig = {
	scenes: {
		scrollDistance: number;
		cycleDuration: number;
		sceneCount: number;
		bubbleMessages: string[];
		bubbleImages: string[];
	};
};

type MingxinBlindsDeps = {
	/**
	 * Swup 换页时传入：内容替换那一刻 scrollY 还是旧页面的位置，平滑滚动
	 * 要到 `swup:scroll:end` 才落定。此时不能按 scrollY 出首帧，否则会误判阶段。
	 */
	deferFirstSync?: boolean;
	/** 左下黑猫对话显隐（reveal/shrink 段为 true），由页面脚本注入 */
	setSceneVisible?: (visible: boolean) => void;
	/** 黑猫打招呼开关（仅 reveal 段为 true，进场 420ms 后冒首句） */
	setGreetingVisible?: (visible: boolean) => void;
};

type StagePhase = "reveal" | "shrink" | "scenes" | "done";

type Ease = (value: number) => number;

const DESKTOP_MEDIA_QUERY = "(min-width: 769px)";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
/** 图框收缩到位后该幕居中到这个距离内才播文字与 UI 的入场 */
const SCENE_ENTER_DISTANCE = 0.42;
/** 明信片晃动：位移差乘系数、限幅，停下 110ms 后回正 */
const SWING_FACTOR = 0.16;
const SWING_LIMIT = 9;
const SWING_RESET_DELAY = 110;
/** 收缩进度追赶时间常数（近似原版 scrub: 0.4 的跟随手感） */
const SHRINK_SMOOTHING = 0.25;
/** 揭示段标题视差追赶时间常数（近似原版揭示 scrub: 0.35；原版五幕无平滑，此处与 pin 共用一台追赶循环） */
const REVEAL_SMOOTHING = 0.2;
/** pin 进度追赶时间常数（改良：五幕横滑与终幕放大不再 1:1 硬跟随，带一点追赶的顺滑） */
const PIN_SMOOTHING = 0.12;

/** pin 进度尾段留给终幕放大：横移在 0.82 前走完，剩余全用于从图框扩到满屏 */
const FINALE_ENTER_PROGRESS = 0.82;
/** 终幕文字三段式：定格缓冲 → 原地渐显 → 停留，再随内容区同速上滑 */
const FINALE_COPY_DELAY = 0.12;
const FINALE_COPY_SPAN = 0.3;
const FINALE_COPY_SETTLE = 0.06;
const FINALE_COPY_GAP = 0.5;
/** 退场模糊上限与量化档：整屏滤镜每档才重栅格化一次 */
const FINALE_BLUR_MAX = 12;
const FINALE_BLUR_STEP = 2;

const EASE_QUAD_IN_OUT: Ease = (t) =>
	t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
const EASE_CUBIC_OUT: Ease = (t) => 1 - (1 - t) ** 3;
const EASE_QUART_OUT: Ease = (t) => 1 - (1 - t) ** 4;
const EASE_QUART_IN_OUT: Ease = (t) =>
	t < 0.5 ? 8 * t ** 4 : 1 - (-2 * t + 2) ** 4 / 2;
const EASE_LINEAR: Ease = (t) => t;

/** WAAPI 侧的缓动近似：quint out / cubic in */
const WAAPI_QUINT_OUT = "cubic-bezier(0.22, 1, 0.36, 1)";
const WAAPI_CUBIC_IN = "cubic-bezier(0.55, 0, 1, 0.45)";
const WAAPI_LINEAR = "linear";
const WAAPI_SPRING = "cubic-bezier(0.34, 1.56, 0.64, 1)";
/** 气泡入场弹跳：从 0.24 倍冒出来，逐个错峰（同原版常量） */
const BUBBLE_POP_FROM_SCALE = 0.24;
const BUBBLE_POP_DURATION = 780;
const BUBBLE_POP_STAGGER = 55;

const clamp = (value: number, min: number, max: number) =>
	Math.min(max, Math.max(min, value));
const clamp01 = (value: number) => clamp(value, 0, 1);

type TimelineStep = {
	start: number;
	duration: number;
	ease: Ease;
	apply: (eased: number) => void;
};

/** 迷你时间线：所有步进按秒排布，帧回调里只做数值写入 */
function runTimeline(steps: TimelineStep[], onComplete?: () => void) {
	let frame = 0;
	let startedAt = 0;
	const total = steps.reduce(
		(most, step) => Math.max(most, step.start + step.duration),
		0,
	);
	const tick = (now: number) => {
		if (!startedAt) startedAt = now;
		const elapsed = (now - startedAt) / 1000;
		for (const step of steps) {
			const progress = clamp01(
				(elapsed - step.start) / Math.max(step.duration, 0.0001),
			);
			step.apply(step.ease(progress));
		}
		if (elapsed >= total) {
			frame = 0;
			onComplete?.();
			return;
		}
		frame = requestAnimationFrame(tick);
	};
	frame = requestAnimationFrame(tick);
	return () => {
		if (frame) cancelAnimationFrame(frame);
		frame = 0;
	};
}

type SceneRefs = {
	card: HTMLElement;
	swing: HTMLElement;
	sticker: SVGSVGElement;
	stickerFill: SVGGElement;
	stickerOutline: SVGPathElement;
	stickerInk: SVGPathElement[];
	bandTitle: HTMLElement;
	bandDate: HTMLElement | null;
	bandDivider: HTMLElement;
	bandNote: HTMLElement;
	introDone: boolean;
};

function styleAlpha(element: HTMLElement | SVGElement, visible: boolean) {
	element.style.opacity = visible ? "1" : "0";
	element.style.visibility = visible ? "visible" : "hidden";
}

export function mountMingxinBlinds(
	root: HTMLElement,
	deps: MingxinBlindsDeps = {},
): () => void {
	if (
		!window.matchMedia(DESKTOP_MEDIA_QUERY).matches ||
		window.matchMedia(REDUCED_MOTION_QUERY).matches
	) {
		return () => undefined;
	}

	const configNode = root.querySelector<HTMLScriptElement>(
		"[data-blinds-config]",
	);
	if (!configNode) return () => undefined;
	let config: MingxinRuntimeConfig;
	try {
		config = JSON.parse(configNode.textContent ?? "{}") as MingxinRuntimeConfig;
	} catch {
		return () => undefined;
	}
	if (!config?.scenes) return () => undefined;

	const scenesSection = root.querySelector<HTMLElement>("[data-blinds-scenes]");
	const viewport = root.querySelector<HTMLElement>("[data-scenes-viewport]");
	const stage = root.querySelector<HTMLElement>("[data-blinds-stage]");
	const background = root.querySelector<HTMLImageElement>(
		"[data-blinds-background]",
	);
	const portal = root.querySelector<HTMLElement>("[data-scenes-portal]");
	const portalImage = root.querySelector<HTMLImageElement>(
		"[data-scenes-portal-image]",
	);
	const heroLayer = root.querySelector<HTMLElement>("[data-blinds-hero]");
	const heroCenter = root.querySelector<HTMLElement>("[data-hero-center]");
	const finalePortal = root.querySelector<HTMLElement>("[data-finale-portal]");
	const finaleImage = root.querySelector<HTMLImageElement>(
		"[data-finale-image]",
	);
	/* 终幕文字层与内容区是影像层的兄弟节点：在首页根节点里找，避免跨页面误取 */
	const homeRoot = root.parentElement;
	const finaleCopyLayer =
		homeRoot?.querySelector<HTMLElement>("[data-finale-copy-layer]") ?? null;
	const finaleCopyInner =
		homeRoot?.querySelector<HTMLElement>("[data-finale-copy-inner]") ?? null;
	const finaleSpacer =
		homeRoot?.querySelector<HTMLElement>("[data-finale-spacer]") ?? null;
	const afterglowHost =
		homeRoot?.querySelector<HTMLElement>("[data-mingxin-afterglow]") ?? null;
	/* 内容区有两套变体（Hero/经典），隐藏的那套 rect 为空：取第一个真实可见的罗盘锚点。
	   必须每帧现取，不能只在开机时定死——访客中途切换变体后，旧锚点被
	   display:none、rect 恒为 0，终幕退场量测全错位：影像被算成透明、
	   文字层被推走，经典模式下终幕「不出现、爆闪一下直接跳到后面」
	   （站长 2026-11-01 报障）。 */
	const resolveCompassTitle = (): HTMLElement | null =>
		[...(homeRoot?.querySelectorAll<HTMLElement>("[data-afterglow-compass]") ?? [])].find(
			(el) => el.getClientRects().length > 0,
		) ?? null;
	const cycleStage = root.querySelector<HTMLElement>("[data-scenes-cycle]");
	const cycleTrack = root.querySelector<HTMLElement>(
		"[data-scenes-cycle-track]",
	);
	const bubbleLayer = root.querySelector<HTMLElement>("[data-scenes-bubbles]");
	const track = root.querySelector<HTMLElement>("[data-scenes-track]");
	const stands = root.querySelector<HTMLElement>("[data-scenes-stands]");
	const standsTrack = root.querySelector<HTMLElement>(
		"[data-scenes-stands-track]",
	);
	const standImages = Array.from(
		root.querySelectorAll<HTMLElement>("[data-scenes-stand]"),
	);
	if (
		!scenesSection ||
		!viewport ||
		!stage ||
		!background ||
		!portal ||
		!portalImage ||
		!cycleStage ||
		!cycleTrack ||
		!bubbleLayer ||
		!track ||
		!stands ||
		!standsTrack
	) {
		return () => undefined;
	}

	const cards = Array.from(
		track.querySelectorAll<HTMLElement>("[data-scene-index]"),
	);
	const scenes: SceneRefs[] = [];
	for (const card of cards) {
		const swing = card.querySelector<HTMLElement>("[data-scene-swing]");
		const sticker = card.querySelector<SVGSVGElement>("[data-scene-sticker]");
		const stickerFill = sticker?.querySelector<SVGGElement>(
			"[data-scene-sticker-fill]",
		);
		const stickerOutline = sticker?.querySelector<SVGPathElement>(
			"[data-scene-sticker-outline]",
		);
		const bandTitle = card.querySelector<HTMLElement>("[data-scene-title]");
		const bandDivider = card.querySelector<HTMLElement>(
			"[data-scene-band-divider]",
		);
		const bandNote = card.querySelector<HTMLElement>("[data-scene-note]");
		if (
			!swing ||
			!sticker ||
			!stickerFill ||
			!stickerOutline ||
			!bandTitle ||
			!bandDivider ||
			!bandNote
		) {
			return () => undefined;
		}
		scenes.push({
			card,
			swing,
			sticker,
			stickerFill,
			stickerOutline,
			stickerInk: Array.from(
				sticker.querySelectorAll<SVGPathElement>("[data-scene-sticker-ink]"),
			),
			bandTitle,
			bandDate: card.querySelector<HTMLElement>("[data-scene-date]"),
			bandDivider,
			bandNote,
			introDone: false,
		});
	}

	const bubbleSlots: BubbleSlot[] = Array.from(
		bubbleLayer.querySelectorAll<HTMLElement>("[data-scene-bubble]"),
	).flatMap((bubbleRoot) => {
		const body = bubbleRoot.querySelector<HTMLElement>(
			"[data-scene-bubble-body]",
		);
		const text = bubbleRoot.querySelector<HTMLElement>(
			"[data-scene-bubble-text]",
		);
		const image = bubbleRoot.querySelector<HTMLImageElement>(
			"[data-scene-bubble-image]",
		);
		if (!body || !text || !image) return [];
		return [{ root: bubbleRoot, body, text, image }];
	});

	const bubbleMessages: BubbleMessage[] = config.scenes.bubbleMessages.map(
		(text, index) => ({ text, image: config.scenes.bubbleImages[index] }),
	);

	const sceneCount = Math.min(
		scenes.length,
		Math.max(1, config.scenes.sceneCount),
	);
	const lastSceneIndex = Math.max(0, sceneCount - 1);

	const abortController = new AbortController();
	const signal = abortController.signal;

	let phase: StagePhase = "reveal";
	let rootInView = false;
	let actVisible = false;
	let horizontalEnabled = false;
	let syncFrame = 0;
	let shrinkFrame = 0;
	let shrinkTarget = 0;
	let shrinkValue = 0;
	let shrinkInitialized = false;
	let shrinkLastTime = 0;
	let chaseFrame = 0;
	let chaseLastTime = 0;
	let motionInitialized = false;
	let pinTarget = 0;
	let pinValue = 0;
	let revealTarget = 0;
	let revealValue = 0;
	let windFrame = 0;
	let windLastTime = 0;
	let resetWindTimer = 0;
	let resizeTimer = 0;
	let cycleAnimation: Animation | null = null;
	let reliefScroll = 0;

	const wind = scenes.map(() => ({ current: 0, target: 0 }));
	const previousSceneX = Array.from({ length: sceneCount }, () => Number.NaN);
	const runningAnimations = new Set<Animation>();
	const elementAnimations = new Map<Element, Animation>();

	const playTo = (
		element: Element,
		keyframes: Keyframe[],
		options: KeyframeAnimationOptions,
		commit?: () => void,
	) => {
		const previous = elementAnimations.get(element);
		if (previous) {
			previous.cancel();
			runningAnimations.delete(previous);
			elementAnimations.delete(element);
		}
		const animation = element.animate(keyframes, { ...options, fill: "both" });
		runningAnimations.add(animation);
		elementAnimations.set(element, animation);
		animation.addEventListener(
			"finish",
			() => {
				runningAnimations.delete(animation);
				if (elementAnimations.get(element) === animation)
					elementAnimations.delete(element);
				animation.cancel();
				commit?.();
			},
			{ once: true },
		);
		return animation;
	};

	const coverScale = (
		image: HTMLImageElement,
		boxWidth: number,
		boxHeight: number,
	) =>
		Math.max(
			boxWidth / Math.max(1, image.naturalWidth),
			boxHeight / Math.max(1, image.naturalHeight),
		);

	let cachedSceneWidth = 0;
	let cachedSceneHeight = 0;
	let cachedSceneStep = 0;
	let cachedPhotoOffsetY = 0;
	let cachedPortalScale = 1;
	let cachedFinaleScale = 1;
	let cachedStageWidth = 0;
	let cachedStageHeight = 0;
	let cyclePeriod = 224;

	let metrics = {
		vh: 0,
		shrinkStart: 0,
		pinStart: 0,
		pinEnd: 0,
		pinDistance: 0,
		rootTop: 0,
		rootBottom: 0,
	};
	const scrollMetrics = () => {
		const vh = window.innerHeight;
		const scrollY = window.scrollY;
		const pinDistance = Math.max(config.scenes.scrollDistance, vh * 3.4);
		scenesSection.style.height = `${vh + pinDistance}px`;
		const sceneTop = scenesSection.getBoundingClientRect().top + scrollY;
		const rootRect = root.getBoundingClientRect();
		metrics = {
			vh,
			shrinkStart: sceneTop - vh * 0.95,
			pinStart: sceneTop,
			pinEnd: sceneTop + pinDistance,
			pinDistance,
			rootTop: rootRect.top + scrollY,
			rootBottom: rootRect.top + scrollY + rootRect.height,
		};
	};

	const measureScenes = () => {
		const firstCard = cards[0] ?? null;
		const firstFrame =
			firstCard?.querySelector<HTMLElement>("[data-scene-frame]") ?? null;
		cachedStageWidth = stage.clientWidth;
		cachedStageHeight = stage.clientHeight;
		// 图框中心相对幕中心的偏移：卡片带有等比 scale，先用 rect 与 offsetWidth
		// 求出当前缩放再折算回布局尺寸，收窗终点才能与图框逐像素重合
		const cardRect = firstCard?.getBoundingClientRect();
		const frameRect = firstFrame?.getBoundingClientRect();
		const cardScale =
			cardRect && firstCard?.offsetWidth
				? cardRect.width / firstCard.offsetWidth
				: 1;
		cachedSceneWidth =
			firstFrame?.offsetWidth || Math.round(window.innerWidth * 0.44);
		cachedSceneHeight =
			firstFrame?.offsetHeight || Math.round(window.innerWidth * 0.33);
		cachedPhotoOffsetY =
			cardRect && frameRect
				? (frameRect.top +
						frameRect.height / 2 -
						(cardRect.top + cardRect.height / 2)) /
					(cardScale || 1)
				: 0;
		cachedSceneStep =
			cachedSceneWidth + Math.max(150, window.innerWidth * 0.12);
		cyclePeriod =
			Number.parseFloat(
				getComputedStyle(cycleStage).getPropertyValue(
					"--mingxin-cycle-period",
				),
			) || 224;

		if (portalImage.naturalWidth > 0 && portalImage.naturalHeight > 0) {
			const viewportCover = coverScale(
				portalImage,
				cachedStageWidth,
				cachedStageHeight,
			);
			const frameCover = coverScale(
				portalImage,
				cachedSceneWidth,
				cachedSceneHeight,
			);
			cachedPortalScale = frameCover / viewportCover;
			portalImage.style.width = `${portalImage.naturalWidth * viewportCover}px`;
			portalImage.style.height = `${portalImage.naturalHeight * viewportCover}px`;
		}

		// 终幕用最后一幕自己的插画：同一套「视口 cover → 图框 cover」比例，
		// 从图框放大到满屏时只做等比 scale
		if (
			finaleImage &&
			finaleImage.naturalWidth > 0 &&
			finaleImage.naturalHeight > 0
		) {
			const viewportCover = coverScale(
				finaleImage,
				cachedStageWidth,
				cachedStageHeight,
			);
			const frameCover = coverScale(
				finaleImage,
				cachedSceneWidth,
				cachedSceneHeight,
			);
			cachedFinaleScale = frameCover / viewportCover;
			finaleImage.style.width = `${finaleImage.naturalWidth * viewportCover}px`;
			finaleImage.style.height = `${finaleImage.naturalHeight * viewportCover}px`;
		}
	};

	const renderPortal = (progress: number) => {
		const eased = EASE_QUART_IN_OUT(clamp01(progress));
		const insetX = Math.max(0, (cachedStageWidth - cachedSceneWidth) / 2);
		const centerGap = (cachedStageHeight - cachedSceneHeight) / 2;
		const insetTop = Math.max(0, centerGap + cachedPhotoOffsetY);
		const insetBottom = Math.max(0, centerGap - cachedPhotoOffsetY);
		portal.style.clipPath = `inset(${insetTop * eased}px ${insetX * eased}px ${
			insetBottom * eased
		}px ${insetX * eased}px)`;
		portalImage.style.transform = `translate(-50%, -50%) translateY(${
			cachedPhotoOffsetY * eased
		}px) scale(${1 + (cachedPortalScale - 1) * eased})`;
	};

	/**
	 * 终幕放大：clip-path 从图框扩到满屏，内部图片同步做等比 scale，
	 * 与收缩过渡层共用同一套几何量、方向相反。
	 */
	const renderFinale = (t: number) => {
		if (!finalePortal || !finaleImage) return;
		const bounded = clamp01(t);
		if (bounded <= 0) {
			finalePortal.style.opacity = "0";
			finalePortal.style.visibility = "hidden";
			return;
		}
		const insetX =
			Math.max(0, (cachedStageWidth - cachedSceneWidth) / 2) * (1 - bounded);
		const centerGap = (cachedStageHeight - cachedSceneHeight) / 2;
		const insetTop =
			Math.max(0, centerGap + cachedPhotoOffsetY) * (1 - bounded);
		const insetBottom =
			Math.max(0, centerGap - cachedPhotoOffsetY) * (1 - bounded);
		finalePortal.style.opacity = String(Math.min(1, bounded * 4));
		finalePortal.style.visibility = "visible";
		finalePortal.style.clipPath = `inset(${insetTop}px ${insetX}px ${insetBottom}px ${insetX}px)`;
		finaleImage.style.transform = `translate(-50%, -50%) translateY(${
			cachedPhotoOffsetY * (1 - bounded)
		}px) scale(${cachedFinaleScale + (1 - cachedFinaleScale) * bounded})`;
	};

	/** 退场态标记：pin 释放后才有意义，覆盖完成带迟滞防边界闪烁 */
	let exitActive = false;
	let exitCovered = false;

	/**
	 * 终幕退场：终幕层钉在视口里，随后随滚动整幅背景平滑模糊 + 漂白；
	 * 文字层三段式显影后转为与内容区同速上滑。
	 */
	const renderExit = () => {
		const released = window.scrollY - metrics.pinEnd;
		if (released <= 0) {
			if (!exitActive) return;
			exitActive = false;
			exitCovered = false;
			if (finalePortal) {
				finalePortal.style.opacity = "1";
				finalePortal.style.filter = "none";
			}
			if (finaleImage) {
				finaleImage.style.opacity = "1";
				finaleImage.style.filter = "none";
			}
			if (finaleCopyLayer) {
				finaleCopyLayer.style.opacity = "0";
				finaleCopyLayer.style.visibility = "hidden";
				finaleCopyLayer.style.transform = "translateY(0px)";
			}
			return;
		}
		exitActive = true;
		const vh = Math.max(1, window.innerHeight);
		// 布局量测统一在任何写入之前完成
		const compassTitle = resolveCompassTitle();
		const compassTop = compassTitle
			? compassTitle.getBoundingClientRect().top
			: vh - released;
		const panelTop = afterglowHost
			? afterglowHost.getBoundingClientRect().top
			: vh - released;
		const t = clamp01((vh - compassTop) / vh);
		if (panelTop <= 0) exitCovered = true;
		else if (panelTop > vh * 0.02) exitCovered = false;

		if (finalePortal) finalePortal.style.opacity = "1";
		if (finaleImage) {
			if (exitCovered) {
				finaleImage.style.opacity = "0";
				finaleImage.style.filter = "none";
			} else {
				const q =
					Math.round((t * FINALE_BLUR_MAX) / FINALE_BLUR_STEP) *
					FINALE_BLUR_STEP;
				finaleImage.style.opacity = String(1 - t);
				finaleImage.style.filter = q > 0 ? `blur(${q}px)` : "none";
			}
		}

		if (finaleCopyLayer) {
			const entranceEnd = vh * (FINALE_COPY_DELAY + FINALE_COPY_SPAN);
			let copyAlpha: number;
			if (released <= vh * FINALE_COPY_DELAY) {
				copyAlpha = 0;
			} else if (released < entranceEnd) {
				const p =
					(released - vh * FINALE_COPY_DELAY) /
					(entranceEnd - vh * FINALE_COPY_DELAY);
				copyAlpha = 1 - (1 - p) ** 3;
			} else {
				copyAlpha = 1;
			}
			let y: number;
			if (compassTitle) {
				const halfBlock = (finaleCopyInner?.offsetHeight ?? 0) / 2;
				const crossing =
					compassTop - vh * FINALE_COPY_GAP - halfBlock - vh / 2 + released;
				y = Math.min(0, crossing - released);
			} else {
				y = Math.min(0, -(released - entranceEnd));
			}
			finaleCopyLayer.style.opacity = String(exitCovered ? 0 : copyAlpha);
			finaleCopyLayer.style.visibility = copyAlpha > 0 ? "visible" : "hidden";
			finaleCopyLayer.style.transform = `translateY(${y}px)`;
		}
	};

	/**
	 * 终幕衔接距离校准：把文字轨迹过正中点的时刻校准到
	 * 「显影完成 + 停留」处——按差值补足衔接占位高度，实测值自动吸收
	 * 布局间距差异，无需硬编码。
	 */
	const calibrateFinaleSpacer = () => {
		if (
			!finaleSpacer ||
			!finaleCopyLayer ||
			!finaleCopyInner ||
			!compassTitle ||
			!metrics.pinEnd
		)
			return;
		const vh = Math.max(1, window.innerHeight);
		const halfBlock = finaleCopyInner.offsetHeight / 2;
		const crossingTarget =
			vh * (FINALE_COPY_DELAY + FINALE_COPY_SPAN + FINALE_COPY_SETTLE);
		const released = window.scrollY - metrics.pinEnd;
		const c0 = compassTitle.getBoundingClientRect().top + released;
		const delta = Math.round(
			crossingTarget + vh * FINALE_COPY_GAP + halfBlock + vh / 2 - c0,
		);
		const current = finaleSpacer.offsetHeight;
		const next = Math.max(0, current + delta);
		if (Math.abs(next - current) > 1) {
			finaleSpacer.style.height = `${next}px`;
		}
	};

	const hideSceneChrome = (scene: SceneRefs) => {
		scene.bandTitle.style.opacity = "0";
		scene.bandTitle.style.visibility = "hidden";
		scene.bandTitle.style.transform = "translateY(-10px)";
		styleAlpha(scene.sticker, false);
		scene.stickerFill.style.opacity = "0";
		scene.stickerOutline.style.strokeDashoffset = "1";
		for (const ink of scene.stickerInk) ink.style.strokeDashoffset = "1";
		if (scene.bandDate) {
			scene.bandDate.style.opacity = "0";
			scene.bandDate.style.visibility = "hidden";
			scene.bandDate.style.transform = "translateY(8px)";
		}
		scene.bandDivider.style.opacity = "0";
		scene.bandDivider.style.visibility = "hidden";
		scene.bandDivider.style.transform = "scaleY(0)";
		scene.bandNote.style.opacity = "0";
		scene.bandNote.style.visibility = "hidden";
		scene.bandNote.style.transform = "translateY(8px)";
	};

	const playSceneIntro = (scene: SceneRefs) => {
		if (scene.introDone) return;
		scene.introDone = true;
		hideSceneChrome(scene);
		const steps: TimelineStep[] = [
			{
				start: 0.2,
				duration: 0.66,
				ease: EASE_QUART_OUT,
				apply: (value) => {
					scene.bandTitle.style.opacity = String(value);
					scene.bandTitle.style.visibility = value > 0 ? "visible" : "hidden";
					scene.bandTitle.style.transform = `translateY(${
						-10 * (1 - value)
					}px)`;
				},
			},
			{
				start: 0.42,
				duration: 0.001,
				ease: EASE_QUAD_IN_OUT,
				apply: () => styleAlpha(scene.sticker, true),
			},
			{
				start: 0.42,
				duration: 0.62,
				ease: EASE_QUAD_IN_OUT,
				apply: (value) => {
					scene.stickerOutline.style.strokeDashoffset = String(1 - value);
				},
			},
			{
				start: 0.76,
				duration: 0.25,
				ease: EASE_LINEAR,
				apply: (value) => {
					scene.stickerFill.style.opacity = String(value);
				},
			},
			{
				start: 0.55,
				duration: 0.46,
				ease: EASE_CUBIC_OUT,
				apply: (value) => {
					if (!scene.bandDate) return;
					scene.bandDate.style.opacity = String(value);
					scene.bandDate.style.visibility = value > 0 ? "visible" : "hidden";
					scene.bandDate.style.transform = `translateY(${8 * (1 - value)}px)`;
				},
			},
			{
				start: 0.62,
				duration: 0.34,
				ease: EASE_QUAD_IN_OUT,
				apply: (value) => {
					scene.bandDivider.style.opacity = String(value);
					scene.bandDivider.style.visibility = value > 0 ? "visible" : "hidden";
					scene.bandDivider.style.transform = `scaleY(${value})`;
				},
			},
			{
				start: 0.66,
				duration: 0.5,
				ease: EASE_CUBIC_OUT,
				apply: (value) => {
					scene.bandNote.style.opacity = String(value);
					scene.bandNote.style.visibility = value > 0 ? "visible" : "hidden";
					scene.bandNote.style.transform = `translateY(${8 * (1 - value)}px)`;
				},
			},
		];
		scene.stickerInk.forEach((ink, index) => {
			steps.push({
				start: 0.86 + index * 0.08,
				duration: 0.42,
				ease: EASE_QUAD_IN_OUT,
				apply: (value) => {
					ink.style.strokeDashoffset = String(1 - value);
				},
			});
		});
		runTimeline(steps);
	};

	/* 气泡入场弹跳：打在内层卡面上，不碰外层的漂移 transform */
	const popBubble = (body: HTMLElement, delay = 0) => {
		playTo(
			body,
			[
				{ opacity: 0, transform: `scale(${BUBBLE_POP_FROM_SCALE})` },
				{ opacity: 1, transform: "scale(1)" },
			],
			{
				duration: BUBBLE_POP_DURATION,
				delay,
				easing: WAAPI_SPRING,
			},
			() => {
				body.style.opacity = "1";
				body.style.transform = "scale(1)";
			},
		);
	};

	const bubbleWall = startBubbleWall({
		container: bubbleLayer,
		bubbles: bubbleSlots,
		messages: bubbleMessages,
		signal,
		onRespawn: (body) => popBubble(body, 0),
	});
	const setStandRailPaused = startStandRail(stands, standsTrack, signal);

	/* 气泡墙混入真实评论（二期本站扩展，原站无此项）：客户端拉 Waline
	   recent 接口追加进池子，权重略高于文章摘句；失败静默，只用文章池 */
	void (async () => {
		try {
			const server = (commentConfig.waline?.serverURL || "").replace(/\/$/, "");
			if (!server) return;
			const res = await fetch(`${server}/api/comment?type=recent&count=20`, {
				signal,
			});
			const json: unknown = await res.json();
			const data = (json as { data?: unknown[] })?.data;
			if (!Array.isArray(data)) return;
			const strip = (html: string) => {
				const el = document.createElement("div");
				el.innerHTML = html;
				return (el.textContent || "").replace(/\s+/g, " ").trim();
			};
			const comments: BubbleMessage[] = [];
			for (const item of data) {
				const raw = (item as { comment?: unknown })?.comment;
				if (typeof raw !== "string") continue;
				const text = strip(raw).slice(0, 60);
				if (text) comments.push({ text, weight: 1.4 });
			}
			if (comments.length) bubbleWall.addMessages(comments);
		} catch {
			/* 静默：评论拉不到就只飘文章池 */
		}
	})();

	/* act 三层同进同退：拼图循环层长出时气泡墙亮起错峰冒泡、立绘自下翻起 */
	const showAct = () => {
		if (actVisible || signal.aborted) return;
		actVisible = true;
		cycleStage.style.visibility = "visible";
		playTo(
			cycleStage,
			[
				{ opacity: 0, transform: "perspective(1400px) rotateX(88deg)" },
				{ opacity: 1, transform: "perspective(1400px) rotateX(0deg)" },
			],
			{ duration: 780, easing: WAAPI_QUINT_OUT },
			() => {
				cycleStage.style.opacity = "1";
				cycleStage.style.visibility = "visible";
				cycleStage.style.transform = "perspective(1400px) rotateX(0deg)";
			},
		);

		bubbleLayer.style.visibility = "visible";
		bubbleLayer.style.opacity = "1";
		bubbleSlots.forEach((slot, index) => {
			popBubble(
				slot.body,
				Math.random() *
					BUBBLE_POP_STAGGER *
					Math.max(0, bubbleSlots.length - 1),
			);
			if (index >= 0) slot.body.style.visibility = "visible";
		});

		stands.style.visibility = "visible";
		stands.style.opacity = "1";
		for (const image of standImages) {
			playTo(
				image,
				[
					{
						opacity: 0,
						transform: "perspective(1400px) rotateX(88deg)",
					},
					{ opacity: 1, transform: "perspective(1400px) rotateX(0deg)" },
				],
				{ duration: 780, easing: WAAPI_QUINT_OUT },
				() => {
					image.style.opacity = "1";
					image.style.transform = "perspective(1400px) rotateX(0deg)";
				},
			);
		}
	};

	const hideAct = () => {
		if (!actVisible || signal.aborted) return;
		actVisible = false;
		playTo(
			cycleStage,
			[{ opacity: 1 }, { opacity: 0 }],
			{ duration: 500, easing: WAAPI_CUBIC_IN },
			() => {
				cycleStage.style.opacity = "0";
				cycleStage.style.visibility = "hidden";
				cycleStage.style.transform = "perspective(1400px) rotateX(88deg)";
			},
		);
		cycleAnimation?.pause();

		playTo(
			bubbleLayer,
			[{ opacity: 1 }, { opacity: 0 }],
			{ duration: 500, easing: WAAPI_CUBIC_IN },
			() => {
				bubbleLayer.style.opacity = "0";
				bubbleLayer.style.visibility = "hidden";
			},
		);
		bubbleWall.setPaused(true);

		for (const image of standImages) {
			playTo(
				image,
				[{ opacity: 1 }, { opacity: 0 }],
				{ duration: 460, easing: WAAPI_CUBIC_IN },
				() => {
					image.style.opacity = "0";
					image.style.transform = "perspective(1400px) rotateX(88deg)";
				},
			);
		}
		window.setTimeout(() => {
			if (signal.aborted || actVisible) return;
			stands.style.opacity = "0";
			stands.style.visibility = "hidden";
		}, 480);
	};

	const setWindTarget = (index: number, target: number) => {
		if (!wind[index]) return;
		wind[index].target = target;
		if (!windFrame) {
			windLastTime = performance.now();
			windFrame = requestAnimationFrame(windTick);
		}
	};

	const applyWind = (index: number) => {
		const scene = scenes[index];
		if (!scene) return;
		scene.swing.style.transform = `rotate(${wind[index].current}deg)`;
	};

	const windTick = (now: number) => {
		const delta = windLastTime
			? Math.min((now - windLastTime) / 1000, 0.05)
			: 0;
		windLastTime = now;
		let active = false;
		wind.forEach((item, index) => {
			const difference = item.target - item.current;
			if (Math.abs(difference) > 0.01) {
				item.current += difference * (1 - Math.exp(-delta / 0.12));
				active = true;
			} else {
				item.current = item.target;
			}
			applyWind(index);
		});
		if (active && !signal.aborted) {
			windFrame = requestAnimationFrame(windTick);
		} else {
			windFrame = 0;
		}
	};

	const resetWind = () => {
		if (signal.aborted) return;
		for (let index = 0; index < wind.length; index += 1)
			setWindTarget(index, 0);
	};

	const renderScenes = (sceneProgress: number, visible: boolean) => {
		const step = cachedSceneStep;
		const layerLive = rootInView && (phase === "scenes" || phase === "done");
		let moving = false;

		for (let index = 0; index < sceneCount; index += 1) {
			const scene = scenes[index];
			const distance = Math.abs(index - sceneProgress);
			const x = (index - sceneProgress) * step;
			const scale = 1 - Math.min(distance, 1) * 0.06;
			const depthOpacity =
				distance > 1.55 ? 0 : Math.max(0.14, 1 - distance * 0.6);
			const previousX = previousSceneX[index];

			scene.card.style.opacity = String(visible ? depthOpacity : 0);
			scene.card.style.visibility =
				visible && depthOpacity > 0 ? "visible" : "hidden";
			scene.card.style.zIndex = String(Math.round(20 - distance * 3));
			scene.card.style.transform = `translate(-50%, -50%) translate3d(${x}px, 0, 0) scale(${scale})`;

			if (visible && layerLive && distance < SCENE_ENTER_DISTANCE) {
				playSceneIntro(scene);
			}

			if (layerLive && Number.isFinite(previousX)) {
				const deltaX = x - previousX;
				if (Math.abs(deltaX) > 0.08) {
					setWindTarget(
						index,
						clamp(deltaX * SWING_FACTOR, -SWING_LIMIT, SWING_LIMIT),
					);
					window.clearTimeout(resetWindTimer);
					resetWindTimer = window.setTimeout(resetWind, SWING_RESET_DELAY);
					moving = true;
				}
			}
			previousSceneX[index] = x;
		}

		if (!moving) {
			window.clearTimeout(resetWindTimer);
		}

		if (visible) showAct();
		else hideAct();
	};

	const syncPlayback = () => {
		const loops =
			rootInView &&
			actVisible &&
			(phase === "scenes" || phase === "done") &&
			document.visibilityState === "visible";
		bubbleWall.setPaused(!loops);
		setStandRailPaused(!loops);
		if (cycleAnimation) {
			if (loops) cycleAnimation.play();
			else cycleAnimation.pause();
		}
	};

	const setStageVisible = (visible: boolean) => {
		stage.style.opacity = visible ? "1" : "0";
		stage.style.visibility = visible ? "visible" : "hidden";
	};

	const setBackgroundVisible = (visible: boolean) => {
		background.style.opacity = visible ? "1" : "0";
		background.style.visibility = visible ? "visible" : "hidden";
	};

	const setPortalVisible = (visible: boolean) => {
		portal.style.opacity = visible ? "1" : "0";
		portal.style.visibility = visible ? "visible" : "hidden";
	};

	/**
	 * Swup 从其他页面回到首页时，挂载发生在 `page:view`，此刻 window.scrollY 仍是
	 * 旧页面的位置，平滑滚动要到 `scroll:end` 才回到顶部。
	 * 若立即 sync()，影像层会按旧位置判成收缩段，闪出一帧没有标题的全屏过渡图。
	 * 这里先按住首帧、强制渲染揭示段，滚动落定后再交给 sync()。
	 * 兜底超时覆盖没有滚动钩子、或滚动被中断的情况。
	 */
	const SCROLL_SETTLE_FALLBACK = 1200;
	let firstSyncHeld = Boolean(deps.deferFirstSync) && window.scrollY > 0;
	let holdTimer = 0;

	const sync = () => {
		if (signal.aborted || firstSyncHeld) return;
		const scrollY = window.scrollY;
		const vh = metrics.vh || window.innerHeight;
		phase =
			scrollY >= metrics.pinEnd
				? "done"
				: scrollY >= metrics.pinStart
					? "scenes"
					: scrollY >= metrics.shrinkStart
						? "shrink"
						: "reveal";
		rootInView = scrollY < metrics.rootBottom && scrollY + vh > metrics.rootTop;

		/* 黑猫对话跟影像层阶段走：reveal/shrink 段在场，reveal 段打招呼 */
		deps.setSceneVisible?.(phase === "reveal" || phase === "shrink");
		deps.setGreetingVisible?.(phase === "reveal");

		setStageVisible(rootInView && phase !== "done");
		setBackgroundVisible(phase === "reveal");
		setPortalVisible(phase === "shrink");
		// 首屏文字层只在揭示段显示；进入收缩段整层淡出，交还给影像层
		if (heroLayer) {
			heroLayer.dataset.visible = phase === "reveal" ? "true" : "false";
		}
		// 揭示段标题视差：随滚动轻微上移并淡出（收缩段开始前走完），带追赶不硬跟
		revealTarget = clamp01(scrollY / Math.max(1, metrics.shrinkStart));
		if (!motionInitialized) {
			revealValue = revealTarget;
			renderReveal();
		} else {
			startChase();
		}

		const shrinkProgress = clamp01(
			(scrollY - metrics.shrinkStart) /
				Math.max(1, metrics.pinStart - metrics.shrinkStart),
		);
		shrinkTarget = shrinkProgress;
		if (!shrinkInitialized) {
			shrinkInitialized = true;
			shrinkValue = shrinkProgress;
			renderPortal(shrinkValue);
		} else if (!shrinkFrame) {
			shrinkLastTime = performance.now();
			shrinkFrame = requestAnimationFrame(shrinkTick);
		}

		const pinProgress = clamp01(
			(scrollY - metrics.pinStart) / Math.max(1, metrics.pinDistance),
		);
		// 离散判定（阶段、接管开关）仍按原始滚动位置，渲染走追赶后的 pinValue：
		// 横移在 FINALE_ENTER_PROGRESS 前走完，剩余进度全部留给终幕放大
		const rawFinaleT =
			phase === "done"
				? 1
				: phase === "scenes"
					? clamp01(
							(pinProgress - FINALE_ENTER_PROGRESS) /
								(1 - FINALE_ENTER_PROGRESS),
						)
					: 0;
		horizontalEnabled =
			rootInView &&
			phase === "scenes" &&
			rawFinaleT === 0 &&
			pinProgress < 0.999;
		viewport.classList.toggle("is-horizontal", horizontalEnabled);

		pinTarget = phase === "done" ? 1 : pinProgress;
		if (!motionInitialized) {
			motionInitialized = true;
			pinValue = pinTarget;
		} else {
			startChase();
		}
		renderPinFrame();
		syncPlayback();
	};

	/** 按住期间直接画揭示段：与滚动到顶部后的正常首帧完全一致，不会露出过渡图 */
	const renderRevealFrame = () => {
		setStageVisible(true);
		setBackgroundVisible(true);
		setPortalVisible(false);
		if (heroLayer) heroLayer.dataset.visible = "true";
	};

	const releaseHold = () => {
		if (!firstSyncHeld) return;
		firstSyncHeld = false;
		window.clearTimeout(holdTimer);
		document.removeEventListener("swup:scroll:end", releaseHold);
		sync();
	};

	const settleFirstFrame = () => {
		if (!firstSyncHeld) {
			sync();
			return;
		}
		renderRevealFrame();
		holdTimer = window.setTimeout(releaseHold, SCROLL_SETTLE_FALLBACK);
		document.addEventListener("swup:scroll:end", releaseHold, { signal });
	};

	const shrinkTick = (now: number) => {
		const delta = shrinkLastTime
			? Math.min((now - shrinkLastTime) / 1000, 0.05)
			: 0;
		shrinkLastTime = now;
		const difference = shrinkTarget - shrinkValue;
		if (Math.abs(difference) < 0.002) {
			shrinkValue = shrinkTarget;
			shrinkFrame = 0;
			renderPortal(shrinkValue);
			return;
		}
		shrinkValue += difference * (1 - Math.exp(-delta / SHRINK_SMOOTHING));
		renderPortal(shrinkValue);
		shrinkFrame = requestAnimationFrame(shrinkTick);
	};

	/** 揭示段标题视差的实际绘制：追赶值驱动，与 sync 里的目标值分离 */
	const renderReveal = () => {
		if (!heroCenter) return;
		const vh = metrics.vh || window.innerHeight;
		heroCenter.style.transform = `translateY(${(-revealValue * vh * 0.18).toFixed(1)}px)`;
		heroCenter.style.opacity = String(1 - revealValue * 0.6);
	};

	/** 五幕与终幕的实际绘制：全部从追赶后的 pinValue 派生，0.82 分界两边同源不错位 */
	const renderPinFrame = () => {
		const finaleT =
			phase === "done" && pinValue >= 0.999
				? 1
				: clamp01(
						(pinValue - FINALE_ENTER_PROGRESS) /
							(1 - FINALE_ENTER_PROGRESS),
					);
		const scenesProgress =
			(Math.min(pinValue, FINALE_ENTER_PROGRESS) / FINALE_ENTER_PROGRESS) *
			lastSceneIndex;
		// 终幕放大期间场景视口整体淡出，避免与放大层重影
		viewport.style.opacity = String(1 - finaleT);
		viewport.style.visibility = finaleT >= 1 ? "hidden" : "visible";
		renderScenes(
			scenesProgress,
			(phase === "scenes" || phase === "done") && rootInView,
		);
		renderFinale(finaleT);
		renderExit();
	};

	/** 追赶循环：揭示视差与 pin 进度共用一台，指数趋近、到位即停（常数见文件头） */
	const chaseTick = (now: number) => {
		const delta = chaseLastTime
			? Math.min((now - chaseLastTime) / 1000, 0.05)
			: 0;
		chaseLastTime = now;
		const pinDiff = pinTarget - pinValue;
		const revealDiff = revealTarget - revealValue;
		const pinDone = Math.abs(pinDiff) < 0.0008;
		const revealDone = Math.abs(revealDiff) < 0.002;
		if ((pinDone && revealDone) || delta === 0) {
			if (pinDone && revealDone) {
				pinValue = pinTarget;
				revealValue = revealTarget;
				chaseFrame = 0;
				renderReveal();
				renderPinFrame();
				return;
			}
			chaseFrame = requestAnimationFrame(chaseTick);
			return;
		}
		if (!pinDone) {
			pinValue += pinDiff * (1 - Math.exp(-delta / PIN_SMOOTHING));
		}
		if (!revealDone) {
			revealValue += revealDiff * (1 - Math.exp(-delta / REVEAL_SMOOTHING));
		}
		renderReveal();
		renderPinFrame();
		chaseFrame = requestAnimationFrame(chaseTick);
	};

	const startChase = () => {
		if (chaseFrame || signal.aborted) return;
		chaseLastTime = performance.now();
		chaseFrame = requestAnimationFrame(chaseTick);
	};

	const requestSync = () => {
		if (syncFrame || signal.aborted) return;
		syncFrame = requestAnimationFrame(() => {
			syncFrame = 0;
			// 平滑滚动已经落到顶部时不必再等 scroll:end，提前出首帧
			if (firstSyncHeld) {
				if (window.scrollY <= 0) releaseHold();
				return;
			}
			sync();
		});
	};

	const remeasure = () => {
		if (signal.aborted) return;
		scrollMetrics();
		measureScenes();
		// 占位高度会改变终幕与内容区的衔接距离，量完几何再校准，最后才同步状态
		calibrateFinaleSpacer();
		renderPortal(shrinkValue);
		// 几何变了，追赶值直接吸附到新目标，避免 resize 后画面慢慢滑过去
		motionInitialized = false;
		sync();
	};

	scrollMetrics();
	measureScenes();
	for (const scene of scenes) hideSceneChrome(scene);
	portal.style.clipPath = "inset(0px 0px 0px 0px)";
	portalImage.style.transform = "translate(-50%, -50%)";
	// 首帧把终幕层收进隐藏态，避免图片解码完成前短暂露出
	renderFinale(0);

	const cycleSeconds = Math.max(1, config.scenes.cycleDuration) * 1000;
	cycleAnimation = cycleTrack.animate(
		[
			{ transform: "translate3d(0, 0, 0)" },
			{ transform: `translate3d(-${cyclePeriod}px, 0, 0)` },
		],
		{
			duration: cycleSeconds,
			iterations: Number.POSITIVE_INFINITY,
			easing: WAAPI_LINEAR,
		},
	);
	cycleAnimation.pause();

	settleFirstFrame();
	renderScenes(0, false);

	window.addEventListener("scroll", requestSync, { passive: true, signal });
	window.addEventListener(
		"resize",
		() => {
			window.clearTimeout(resizeTimer);
			resizeTimer = window.setTimeout(remeasure, 160);
		},
		{ signal },
	);
	window.addEventListener("resize", requestSync, { passive: true, signal });
	document.addEventListener("visibilitychange", requestSync, { signal });

	viewport.addEventListener(
		"wheel",
		(event) => {
			if (
				!horizontalEnabled ||
				Math.abs(event.deltaX) <= Math.abs(event.deltaY) ||
				(event.target instanceof Node && stands.contains(event.target))
			) {
				return;
			}
			event.preventDefault();
			relieveScroll(
				clamp(
					window.scrollY + event.deltaX * 1.8,
					metrics.pinStart,
					metrics.pinEnd,
				),
			);
		},
		{ passive: false, signal },
	);

	function relieveScroll(top: number) {
		reliefScroll += 1;
		const generation = reliefScroll;
		window.scrollTo({ top, behavior: "auto" });
		if (generation !== reliefScroll) return;
	}

	if (!portalImage.complete || portalImage.naturalWidth === 0) {
		portalImage.addEventListener(
			"load",
			() => {
				if (signal.aborted) return;
				measureScenes();
				renderPortal(shrinkValue);
			},
			{ once: true, signal },
		);
	}

	// 终幕插画解码后才知道自然尺寸，重新量一次并立刻补齐当前放大比例
	if (
		finaleImage &&
		(!finaleImage.complete || finaleImage.naturalWidth === 0)
	) {
		finaleImage.addEventListener(
			"load",
			() => {
				if (signal.aborted) return;
				remeasure();
			},
			{ once: true, signal },
		);
	}

	void document.fonts.ready.then(() => {
		if (signal.aborted) return;
		remeasure();
	});

	// Swup 换页后首页各层高度还在落位，此刻量出的 pinStart 会把收缩段误判成
	// 揭示段。参考站以 ScrollTrigger.refresh() 纠偏，这里同样在入场后重测一次。
	const settleTimer = window.setTimeout(remeasure, 600);

	return () => {
		abortController.abort();
		window.clearTimeout(holdTimer);
		window.clearTimeout(settleTimer);
		window.clearTimeout(resizeTimer);
		window.clearTimeout(resetWindTimer);
		if (syncFrame) cancelAnimationFrame(syncFrame);
		if (shrinkFrame) cancelAnimationFrame(shrinkFrame);
		if (windFrame) cancelAnimationFrame(windFrame);
		cycleAnimation?.cancel();
		cycleAnimation = null;
		for (const animation of runningAnimations) animation.cancel();
		runningAnimations.clear();
		elementAnimations.clear();
		bubbleWall.setPaused(true);
		setStandRailPaused(true);
		viewport.classList.remove("is-horizontal");
		deps.setSceneVisible?.(false);
		deps.setGreetingVisible?.(false);
	};
}
