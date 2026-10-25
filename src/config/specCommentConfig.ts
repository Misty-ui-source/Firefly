// 通用单页评论区开关：slug -> 是否显示评论区；没写的默认显示。
// 通用单页指由 src/pages/[slug].astro 模板生成的单页（src/content/spec/ 里的文件）。
// 由 Alexander Console「单页 → 💬 评论区开关」卡维护。
export const specComments: Record<string, boolean> = {};
