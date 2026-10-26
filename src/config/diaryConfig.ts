import type { DiaryConfig } from "@/types/diaryConfig";

// 日记页配置。条目在 src/content/diary/ 下，一篇一个 .md 文件，
// 在 Alexander Console「单页 → 📔 日记」里增删改。
export const diaryConfig: DiaryConfig = {
	title: "日记",
	description: "",
	// 评论区开关：也可以在管理台「单页 → 💬 评论区开关」里切换
	showComment: true,
	// 密码锁卡皮肤：notebook 日记本 / classic 经典 / envelope 密封
	// 也可以在管理台「单页 → 📔 日记」里切换
	lockStyle: "notebook",
};
