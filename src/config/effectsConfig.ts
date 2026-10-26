import type { ParticleEffectConfig, SakuraConfig } from "../types/effectsConfig";

// 特效配置 - 集中管理所有动画特效

export const sakuraConfig: SakuraConfig = {
	// 是否启用樱花特效
	enable: true,

	// 樱花数量
	sakuraNum: 21,

	// 樱花越界限制次数，-1为无限循环
	limitTimes: -1,

	// 樱花尺寸
	size: {
		// 樱花最小尺寸倍数
		min: 0.5,
		// 樱花最大尺寸倍数
		max: 1.1,
	},

	// 樱花不透明度
	opacity: {
		// 樱花最小不透明度
		min: 0.3,
		// 樱花最大不透明度
		max: 0.9,
	},

	// 樱花移动速度
	speed: {
		// 水平移动
		horizontal: {
			// 水平移动速度最小值
			min: -1.7,
			// 水平移动速度最大值
			max: -1.2,
		},
		// 垂直移动
		vertical: {
			// 垂直移动速度最小值
			min: 1.5,
			// 垂直移动速度最大值
			max: 2.2,
		},
		// 旋转速度
		rotation: 0.03,
		// 消失速度，不应大于最小不透明度
		fadeSpeed: 0.03,
	},

	// 层级，确保樱花在合适的层级显示
	zIndex: 100,
};

// 雪花特效（轻量粒子引擎，与萤火虫共用 ParticleEffects.astro）
export const snowConfig: ParticleEffectConfig = {
	// 是否启用雪花特效
	enable: false,

	// 雪花数量
	count: 70,

	// 层级
	zIndex: 100,
};

// 音符特效（波奇酱蔷薇红音符，轻量粒子引擎，共用 ParticleEffects.astro）
export const notesConfig: ParticleEffectConfig = {
	// 是否启用音符特效
	enable: false,

	// 音符数量
	count: 18,

	// 层级
	zIndex: 100,
};

// 萤火虫特效（轻量粒子引擎，与雪花共用 ParticleEffects.astro）
export const fireflyConfig: ParticleEffectConfig = {
	// 是否启用萤火虫特效
	enable: false,

	// 萤火虫数量
	count: 26,

	// 层级
	zIndex: 100,
};

// 雨滴特效（轻量粒子引擎，共用 ParticleEffects.astro）
export const rainConfig: ParticleEffectConfig = {
	// 是否启用雨滴特效
	enable: false,

	// 粒子数量
	count: 90,

	// 层级
	zIndex: 100,
};

// 流星特效（轻量粒子引擎，共用 ParticleEffects.astro）
export const meteorConfig: ParticleEffectConfig = {
	// 是否启用流星特效
	enable: false,

	// 粒子数量
	count: 3,

	// 层级
	zIndex: 100,
};

// 泡泡特效（轻量粒子引擎，共用 ParticleEffects.astro）
export const bubblesConfig: ParticleEffectConfig = {
	// 是否启用泡泡特效
	enable: false,

	// 粒子数量
	count: 24,

	// 层级
	zIndex: 100,
};

// 爱心特效（轻量粒子引擎，共用 ParticleEffects.astro）
export const heartsConfig: ParticleEffectConfig = {
	// 是否启用爱心特效
	enable: false,

	// 粒子数量
	count: 16,

	// 层级
	zIndex: 100,
};

// 落叶特效（轻量粒子引擎，共用 ParticleEffects.astro）
export const leavesConfig: ParticleEffectConfig = {
	// 是否启用落叶特效
	enable: false,

	// 粒子数量
	count: 16,

	// 层级
	zIndex: 100,
};

// 点击特效（轻量粒子引擎，共用 ParticleEffects.astro）
export const clickConfig: ParticleEffectConfig = {
	// 是否启用点击特效
	enable: false,

	// 粒子数量（点击特效为每次点击迸发的粒子数）
	count: 12,

	// 层级
	zIndex: 100,
};
