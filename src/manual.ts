// 用户使用手册（阿麦 2026-10-21 拍板的「设置面板可访问」要求）
// 中英文两份全量手册都直接打包进插件（esbuild .md loader 内联，不放仓库外链），
// 界面上按 Obsidian 语言自动切换。
import manualZh from "../manual-zh.md";
import manualEn from "../manual-en.md";

export function getManual(lang: "zh" | "en"): string {
	return lang === "zh" ? manualZh : manualEn;
}
