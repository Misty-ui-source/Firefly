/**
 * 明信马赛克前段 · 玻璃雨珠 + 撞击水花（照片落位后在导引线画幅内落下）。
 * 移植自原站 MmzMing/my-blog 的 utils/home-hero-rain.ts，物理与数值原样：
 * 雨丝斜落（x 随速回退 0.13 倍）、落到画布底边溅起水花粒子（重力 0.18）、
 * 密度 = 基础数（桌面 86 / 移动 34）× intensity × 面积系数。
 * 与原版的差异只有装配：原版按 [data-hero-rain] 在 hero 内查 canvas，
 * 本站由 home-mosaic 控制器把 canvas 与配置直接传入；其余逐行同构。
 * 激活由控制器按时间线 T ≥ 1.14 调用 setActive，交接段起关闭；
 * canvas 的 .is-active 只管 CSS 淡入淡出（240ms），rAF 随激活启停。
 */

type RainConfig = {
	enabled?: boolean;
	intensity?: number;
	color?: string;
};

type RainDrop = {
	x: number;
	y: number;
	length: number;
	speed: number;
	width: number;
	alpha: number;
};

type SplashParticle = {
	x: number;
	y: number;
	vx: number;
	vy: number;
	life: number;
	maxLife: number;
	radius: number;
	alpha: number;
};

type HitEdge = {
	x1: number;
	x2: number;
	y: number;
	captureRate: number;
};

export type MingxinMosaicRainController = {
	setActive: (active: boolean) => void;
	destroy: () => void;
};

function createDrop(width: number, height: number, initial = false): RainDrop {
	return {
		x: Math.random() * width,
		y: initial ? Math.random() * height : -40 - Math.random() * height * 0.3,
		length: 14 + Math.random() * 34,
		speed: 5 + Math.random() * 8,
		width: 0.55 + Math.random() * 0.8,
		alpha: 0.14 + Math.random() * 0.34,
	};
}

function createSplash(x: number, y: number): SplashParticle {
	return {
		x,
		y: y - 1,
		vx: (Math.random() - 0.5) * 3.8,
		vy: -(1.4 + Math.random() * 3.4),
		life: 0,
		maxLife: 14 + Math.random() * 16,
		radius: 0.7 + Math.random() * 1.5,
		alpha: 0.24 + Math.random() * 0.32,
	};
}

export function initMingxinMosaicRain(
	canvas: HTMLCanvasElement | null,
	config: RainConfig,
): MingxinMosaicRainController {
	const context = canvas?.getContext("2d") ?? null;
	const abortController = new AbortController();
	const resizeObserver = new ResizeObserver(() => resize());
	const mobileQuery = window.matchMedia("(max-width: 768px)");
	const reducedMotionQuery = window.matchMedia(
		"(prefers-reduced-motion: reduce)",
	);
	let drops: RainDrop[] = [];
	let splashes: SplashParticle[] = [];
	let hitEdges: HitEdge[] = [];
	let animationFrame = 0;
	let active = false;
	let width = 0;
	let height = 0;
	let dpr = 1;

	if (!canvas || !context || config.enabled === false) {
		return {
			setActive: () => undefined,
			destroy: () => abortController.abort(),
		};
	}
	/* 守卫后收窄成非空别名：闭包内的函数体不吃参数收窄，后续一律用它 */
	const canvasEl: HTMLCanvasElement = canvas;

	function collectHitEdges() {
		hitEdges = [{ x1: 0, x2: width, y: Math.max(0, height - 1), captureRate: 1 }];
	}

	function resize() {
		if (!canvas || !context) return;
		// 画布由 CSS 摆在井字导引线围出的画幅里，按它自己的盒子回写像素缓冲
		const bounds = canvas.getBoundingClientRect();
		width = Math.max(1, Math.round(bounds.width));
		height = Math.max(1, Math.round(bounds.height));
		dpr = mobileQuery.matches
			? 1
			: Math.min(1.5, Math.max(1, window.devicePixelRatio || 1));
		canvas.width = Math.round(width * dpr);
		canvas.height = Math.round(height * dpr);
		context.setTransform(dpr, 0, 0, dpr, 0, 0);
		const intensity = Math.min(1, Math.max(0, config.intensity ?? 0.6));
		const areaScale = Math.min(1.4, (width * height) / 1_100_000);
		const baseCount = mobileQuery.matches ? 34 : 86;
		const count = Math.max(
			10,
			Math.round(baseCount * intensity * Math.max(0.65, areaScale)),
		);
		drops = Array.from({ length: count }, () =>
			createDrop(width, height, true),
		);
		splashes = [];
		collectHitEdges();
	}

	function resetDrop(drop: RainDrop) {
		Object.assign(drop, createDrop(width, height));
		drop.x = Math.random() * (width + 80);
	}

	function addSplash(x: number, y: number) {
		const particleCount = mobileQuery.matches ? 3 : 6;
		for (let index = 0; index < particleCount; index += 1) {
			splashes.push(createSplash(x, y));
		}
	}

	function stop() {
		cancelAnimationFrame(animationFrame);
		animationFrame = 0;
		context?.clearRect(0, 0, width, height);
	}

	function draw() {
		if (!context || !active || document.hidden || reducedMotionQuery.matches) {
			stop();
			return;
		}

		context.clearRect(0, 0, width, height);
		context.lineCap = "round";
		context.strokeStyle = config.color || getComputedStyle(canvasEl).color;
		context.fillStyle = config.color || getComputedStyle(canvasEl).color;

		for (const drop of drops) {
			const previousY = drop.y;
			drop.x -= drop.speed * 0.13;
			drop.y += drop.speed;
			const collision = hitEdges.find(
				(edge) =>
					previousY <= edge.y &&
					drop.y >= edge.y &&
					drop.x >= edge.x1 &&
					drop.x <= edge.x2 &&
					(edge.captureRate >= 1 || Math.random() <= edge.captureRate),
			);
			if (collision) {
				addSplash(drop.x, collision.y);
				resetDrop(drop);
				continue;
			}
			if (drop.y - drop.length > height || drop.x < -drop.length) {
				resetDrop(drop);
				continue;
			}
			context.globalAlpha = drop.alpha;
			context.lineWidth = drop.width;
			context.beginPath();
			context.moveTo(drop.x, drop.y);
			context.lineTo(drop.x + drop.length * 0.13, drop.y - drop.length);
			context.stroke();
		}

		for (let index = splashes.length - 1; index >= 0; index -= 1) {
			const particle = splashes[index];
			particle.life += 1;
			particle.vy += 0.18;
			particle.x += particle.vx;
			particle.y += particle.vy;
			const remaining = 1 - particle.life / particle.maxLife;
			if (remaining <= 0) {
				splashes.splice(index, 1);
				continue;
			}
			context.globalAlpha = particle.alpha * remaining;
			context.beginPath();
			context.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
			context.fill();
		}

		context.globalAlpha = 1;
		animationFrame = requestAnimationFrame(draw);
	}

	function start() {
		if (
			animationFrame ||
			!active ||
			document.hidden ||
			reducedMotionQuery.matches
		) {
			return;
		}
		animationFrame = requestAnimationFrame(draw);
	}

	function handleVisibilityChange() {
		if (document.hidden) stop();
		else start();
	}

	function handleMediaChange() {
		resize();
		if (reducedMotionQuery.matches) stop();
		else start();
	}

	resize();
	resizeObserver.observe(canvasEl);
	document.addEventListener("visibilitychange", handleVisibilityChange, {
		signal: abortController.signal,
	});
	mobileQuery.addEventListener("change", handleMediaChange, {
		signal: abortController.signal,
	});
	reducedMotionQuery.addEventListener("change", handleMediaChange, {
		signal: abortController.signal,
	});

	return {
		setActive(nextActive) {
			active = nextActive;
			canvasEl.classList.toggle("is-active", active);
			if (active) start();
			else stop();
		},
		destroy() {
			active = false;
			stop();
			resizeObserver.disconnect();
			abortController.abort();
			drops = [];
			splashes = [];
			hitEdges = [];
			canvasEl.classList.remove("is-active");
		},
	};
}
