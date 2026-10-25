// 界面多语言：自动跟随 Obsidian 语言设置（阿麦拍板，无手动切换项）
// 用官方 getLanguage()（@since 1.8.7）读取当前语言（如 zh / en / ja…）。
// 规则：zh 开头 → 中文；其余一律英文兜底。用户零设置。

import { getLanguage } from "obsidian";

export type Lang = "zh" | "en";

function detectLang(): Lang {
	try {
		const v = getLanguage() ?? "en";
		return v.toLowerCase().startsWith("zh") ? "zh" : "en";
	} catch {
		return "en";
	}
}

export const lang: Lang = detectLang();

const zh = {
	// 视图
	viewTitle: "骰表 Dice Table",
	tableLabel: "骰表：",
	diceLabel: "骰子：",
	noTables: "（文件夹「{folder}」里没有 .md 骰表）",
	noDiceInFile: "这份文件里没有找到 H1 骰子结构。",
	emptyResult: "点下面的按钮摇一组。",
	rollBtn: "🎲 摇一组",
	saveBtn: "一键保存",
	copyBtn: "复制结果",
	writeNoteBtn: "写入笔记",
	openTableBtn: "📄 打开文档",
	instanceLabel: "第 {n} 个{title}",
	instanceOrdinal: "第 {n} 个",
	noActiveNote: "当前没有打开的笔记，先打开一篇再写入。",
	writtenToNote: "已写入当前笔记",
	rerollAria: "只重摇「{pool}」",
	historySummary: "历史（{n}）",
	historyLoad: "载入",
	historyLoadAria: "把这组结果载回上方结果区",
	// 提示
	noDiceNotice: "没有可摇的骰子，请先在骰表文件夹放一份格式正确的 .md",
	openFailNotice: "无法打开骰表界面",
	refMissNotice: "以下引用没有解析到（裸名只查当前文档；跨文档请用 [[文件]] 或 [显示](文件.md) 链接形式）：",
	savedNotice: "已保存：{path}",
	copiedNotice: "结果已复制到剪贴板",
	rolledAtLabel: "摇出时间",
	copyFailNotice: "复制失败：{msg}",
	imgFailNotice: "图片导出失败：{msg}",
	appendImgFallback: "追加模式仅支持 Markdown；本次已按新文件保存图片",
	appendCreated: "已新建追加文件并写入：{path}",
	appended: "已追加到：{path}",
	// 设置页
	sHeading: "通用",
	sDiceFolder: "骰表文件夹",
	sDiceFolderDesc:
		"插件从这里读取所有 .md 骰表（一个文件＝一套表：H1＝骰子名，H2＝项，- ＝面）。输入时下拉提示库里已有文件夹；没有的路径也可直接输入，保存时自动创建",
	sSaveFolder: "默认保存文件夹",
	sSaveFolderDesc:
		"点「一键保存」时，摇出的结果存到这里。输入时下拉提示库里已有文件夹；没有的路径也可直接输入，保存时自动创建",
	sNameTemplate: "文件命名模板",
	sNameTemplateDesc:
		"大括号里是变量，外面是固定文字。可用变量：{H1} {H2} {H2:2} {YYYY} {MM} {DD} {HH} {mm} {ss} {WW} {YYYYMMDD}。默认 {H1}_{YYYYMMDD-HHmm}",
	sSaveFormat: "保存格式",
	sSaveFormatDesc:
		"「一键保存」按此格式保存结果：Markdown 文档 / PNG 图片 / JPG 图片（图片为固化的结果卡，跟随导出时的深浅色）",
	sSaveMode: "保存方式",
	sSaveModeDesc: "每次存成新文件，或追加到同一个文件里（跑团战报日志式；追加仅支持 Markdown）",
	sAppendTemplate: "追加文件名模板",
	sAppendTemplateDesc:
		"追加模式下结果写入这个文件（存放在保存文件夹里）。可用变量与命名模板相同。默认 {H1}",
	optMarkdown: "Markdown",
	optGrouped: "分组（默认）",
	optBlocks: "每个实例独立块",
	optCursor: "光标所在段落之后",
	optAppendEnd: "文末追加",
	optParen: "圆括号（值）",
	optBracket: "方括号［值］",
	optNoWrap: "不包裹",
	optColon: "冒号",
	optDash: "破折号",
	optNoSep: "不连接",
	optPng: "PNG 图片",
	optJpg: "JPG 图片",
	optMain: "主区新标签页",
	optSidebar: "右侧栏",
	optNewFile: "每次存新文件",
	optAppend: "追加到同一文件",
	sMultiSave: "多套实例保存格式",
	sMultiSaveDesc: "池引用 ×N 一次摇出多套时，保存成分组还是一个实例一块",
	sNoteWrite: "写入当前笔记的位置",
	sNoteWriteDesc: "「写入笔记」按钮把结果写到哪里",
	sChainWrap: "链式引用包裹符号",
	sChainWrapDesc: "命中带 -> 的面后，继续摇出的结果用什么符号包裹",
	sChainSep: "链式引用分隔符号",
	sChainSepDesc: "原条目与继续摇出的结果之间用什么符号连接",
	sOpenLocation: "打开位置",
	sOpenLocationDesc: "点左侧骰子图标时，操作界面开在哪里",
	sManual: "使用说明",
	sManualDesc: "点开查看完整的用户使用手册（骰表语法、多选、权重、保存设置等）",
	sManualModalHint: "以下为插件内置的用户使用手册（当前版本）：",
	sManualRenderFail: "手册渲染失败，请到插件仓库查看在线版本。",
	// 主入口
	ribbonTooltip: "骰表：打开操作界面",
	commandOpen: "打开骰表操作界面",
};

const en: typeof zh = {
	viewTitle: "Dice Table",
	tableLabel: "Table:",
	diceLabel: "Dice:",
	noTables: "(no .md tables in folder \"{folder}\")",
	noDiceInFile: "No H1 dice structure found in this file.",
	emptyResult: "Click the button below to roll.",
	rollBtn: "🎲 Roll",
	saveBtn: "Save",
	copyBtn: "Copy",
	writeNoteBtn: "Write to note",
	openTableBtn: "📄 Open file",
	instanceLabel: "{title} #{n}",
	instanceOrdinal: "#{n}",
	noActiveNote: "No note is open. Open one first.",
	writtenToNote: "Written to the current note",
	rerollAria: "Re-roll \"{pool}\" only",
	historySummary: "History ({n})",
	historyLoad: "Load",
	historyLoadAria: "Load this result set back into the result area",
	noDiceNotice: "No dice to roll. Put a properly formatted .md into the tables folder first.",
	openFailNotice: "Cannot open the dice table view",
	refMissNotice: "These references could not be resolved (a bare name is looked up in the current document only; to reference another document use [[file]] or [text](file.md)):",
	savedNotice: "Saved: {path}",
	copiedNotice: "Result copied to clipboard",
	rolledAtLabel: "Rolled at",
	copyFailNotice: "Copy failed: {msg}",
	imgFailNotice: "Image export failed: {msg}",
	appendImgFallback: "Append mode supports Markdown only; image saved as a new file this time",
	appendCreated: "Created append file and wrote: {path}",
	appended: "Appended to: {path}",
	sHeading: "General",
	sDiceFolder: "Tables folder",
	sDiceFolderDesc:
		"Where the plugin reads all .md dice tables (one file = one set: H1 = dice, H2 = pool, - = face). Type to fuzzy-search existing folders; new paths are created on save",
	sSaveFolder: "Save folder",
	sSaveFolderDesc:
		"Results are saved here on \"Save\". Type to fuzzy-search existing folders; new paths are created on save",
	sNameTemplate: "File name template",
	sNameTemplateDesc:
		"Braces hold variables, the rest is literal text. Available: {H1} {H2} {H2:2} {YYYY} {MM} {DD} {HH} {mm} {ss} {WW} {YYYYMMDD}. Default {H1}_{YYYYMMDD-HHmm}",
	sSaveFormat: "Save format",
	sSaveFormatDesc: "Format used by \"Save\": Markdown document / PNG image / JPG image (image = fixed result card in current theme colors)",
	sSaveMode: "Save mode",
	sSaveModeDesc: "Save a new file each time, or append to one file (session-log style; append supports Markdown only)",
	sAppendTemplate: "Append file name template",
	sAppendTemplateDesc:
		"In append mode, results are written into this file (inside the save folder). Variables same as the name template. Default {H1}",
	optMarkdown: "Markdown",
	optGrouped: "Grouped (default)",
	optBlocks: "Separate block each",
	optCursor: "After the cursor paragraph",
	optAppendEnd: "Append at the end",
	optParen: "Parentheses (value)",
	optBracket: "Brackets [value]",
	optNoWrap: "No wrap",
	optColon: "Colon",
	optDash: "Dash",
	optNoSep: "No separator",
	optPng: "PNG image",
	optJpg: "JPG image",
	optMain: "New tab in main area",
	optSidebar: "Right sidebar",
	optNewFile: "New file each time",
	optAppend: "Append to one file",
	sMultiSave: "Multi-instance save format",
	sMultiSaveDesc: "When a pool reference with xN rolls several sets, save them grouped or as separate blocks",
	sNoteWrite: "Write-to-note position",
	sNoteWriteDesc: "Where the Write to note button puts the result",
	sChainWrap: "Chain wrap symbol",
	sChainWrapDesc: "Symbol wrapping the result rolled after a face with -> is hit",
	sChainSep: "Chain separator",
	sChainSepDesc: "Symbol connecting the original face and the chained result",
	sOpenLocation: "Open location",
	sOpenLocationDesc: "Where the roller opens when clicking the ribbon icon",
	sManual: "User manual",
	sManualDesc: "Open the full user manual: table syntax, multi-select, weights, saving and more",
	sManualModalHint: "The built-in user manual (current version):",
	sManualRenderFail: "Failed to render the manual. Please check the plugin repository online.",
	ribbonTooltip: "Dice Table: open the roller",
	commandOpen: "Open dice table view",
};

const dicts = { zh, en };

/** 取当前语言的文案；{x} 占位符用 params 替换 */
export function t(key: keyof typeof zh, params?: Record<string, string | number>): string {
	let s: string = dicts[lang][key];
	if (params) {
		for (const [k, v] of Object.entries(params)) {
			s = s.split(`{${k}}`).join(String(v));
		}
	}
	return s;
}
