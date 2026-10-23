import { App, PluginSettingTab, TFolder, SettingDefinitionItem } from "obsidian";
import type DiceTablePlugin from "./main";
import { t, lang } from "./i18n";
import { ManualModal } from "./manual-modal";

export interface DiceTableSettings {
	/** 骰表文件夹（库内相对路径） */
	diceFolder: string;
	/** 默认保存文件夹 */
	saveFolder: string;
	/** 文件命名模板 */
	nameTemplate: string;
	/** 保存格式 */
	saveFormat: "markdown" | "png" | "jpg";
	/** 保存方式：每次存新文件 / 追加到同一文件（追加仅支持 Markdown） */
	saveMode: "newfile" | "append";
	/** 追加模式下目标文件名模板（存放在保存文件夹里） */
	appendFileTemplate: string;
	/** 打开位置：主区新标签页 / 右侧栏 */
	openLocation: "main" | "sidebar";
	/** 多套实例的保存格式：grouped＝分组（默认）／blocks＝每实例独立块 */
	multiSaveMode: "grouped" | "blocks";
	/** 写入当前笔记的位置：cursor＝光标所在段落之后（默认）／append＝文末追加 */
	noteWriteMode: "cursor" | "append";
	/** 链式引用拼接：包裹符号 */
	chainWrap: "paren" | "bracket" | "none";
	/** 链式引用拼接：分隔符号（预设 colon/dash/none，或自定义字符串） */
	chainSep: string;
}

export const DEFAULT_SETTINGS: DiceTableSettings = {
	diceFolder: "骰表",
	saveFolder: "骰子结果",
	nameTemplate: "{H1}_{YYYYMMDD-HHmm}",
	saveFormat: "markdown",
	saveMode: "newfile",
	appendFileTemplate: "{H1}",
	openLocation: "main",
	multiSaveMode: "grouped",
	noteWriteMode: "cursor",
	chainWrap: "paren",
	chainSep: "colon",
};

export class DiceTableSettingTab extends PluginSettingTab {
	plugin: DiceTablePlugin;

	constructor(app: App, plugin: DiceTablePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	/**
	 * 接管声明式控件的写入（1.13+ 渲染路径）：
	 * 写设置 → 冲突纠正（追加仅支持 Markdown）→ 持久化 → update() 重渲染使互锁即时生效。
	 */
	async setControlValue(key: string, value: unknown): Promise<void> {
		const s = this.plugin.settings as unknown as Record<string, unknown>;
		if (!(key in s)) return;
		s[key] = value;
		if (key === "saveMode" && value === "append" && this.plugin.settings.saveFormat !== "markdown") {
			this.plugin.settings.saveFormat = "markdown";
		} else if (key === "saveFormat" && value !== "markdown" && this.plugin.settings.saveMode === "append") {
			this.plugin.settings.saveMode = "newfile";
		}
		await this.plugin.saveSettings();
		// O1（阿麦 10-22）：换骰表路径即时生效，免重载插件
		if (key === "diceFolder") {
			await this.plugin.refreshDiceViews();
		}
		if (key === "saveFormat" || key === "saveMode") this.update();
		if (key === "multiSaveMode" || key === "noteWriteMode" || key === "chainWrap" || key === "chainSep") {
			this.update();
		}
	}

	/**
	 * 声明式设置（Obsidian 1.13+；minAppVersion 已要求 1.13.0）。
	 * 写入经重写的 setControlValue 钩子：写值→冲突纠正→持久化→update() 重渲染互锁。
	 */
	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				name: t("sDiceFolder"),
				desc: t("sDiceFolderDesc"),
				control: {
					type: "folder",
					key: "diceFolder",
					placeholder: "骰表",
					defaultValue: DEFAULT_SETTINGS.diceFolder,
				},
			},
			{
				name: t("sSaveFolder"),
				desc: t("sSaveFolderDesc"),
				control: {
					type: "folder",
					key: "saveFolder",
					placeholder: "骰子结果",
					defaultValue: DEFAULT_SETTINGS.saveFolder,
				},
			},
			{
				name: t("sNameTemplate"),
				desc: t("sNameTemplateDesc"),
				control: {
					type: "text",
					key: "nameTemplate",
					placeholder: "{H1}_{YYYYMMDD-HHmm}",
					defaultValue: DEFAULT_SETTINGS.nameTemplate,
				},
			},
			{
				name: t("sSaveFormat"),
				desc: t("sSaveFormatDesc"),
				control: {
					type: "dropdown",
					key: "saveFormat",
					// 互锁：追加模式下图片选项直接不渲染（追加仅支持 Markdown）
					options:
						this.plugin.settings.saveMode === "append"
							? { markdown: t("optMarkdown") }
							: { markdown: t("optMarkdown"), png: t("optPng"), jpg: t("optJpg") },
					defaultValue: DEFAULT_SETTINGS.saveFormat,
				},
			},
			{
				name: t("sSaveMode"),
				desc: t("sSaveModeDesc"),
				control: {
					type: "dropdown",
					key: "saveMode",
					// 互锁：图片格式下追加选项直接不渲染
					options:
						this.plugin.settings.saveFormat !== "markdown"
							? { newfile: t("optNewFile") }
							: { newfile: t("optNewFile"), append: t("optAppend") },
					defaultValue: DEFAULT_SETTINGS.saveMode,
				},
			},
			{
				name: t("sAppendTemplate"),
				desc: t("sAppendTemplateDesc"),
				control: {
					type: "text",
					key: "appendFileTemplate",
					placeholder: "{H1}",
					defaultValue: DEFAULT_SETTINGS.appendFileTemplate,
				},
			},
			{
				name: t("sMultiSave"),
				desc: t("sMultiSaveDesc"),
				control: {
					type: "dropdown",
					key: "multiSaveMode",
					options: { grouped: t("optGrouped"), blocks: t("optBlocks") },
					defaultValue: DEFAULT_SETTINGS.multiSaveMode,
				},
			},
			{
				name: t("sNoteWrite"),
				desc: t("sNoteWriteDesc"),
				control: {
					type: "dropdown",
					key: "noteWriteMode",
					options: { cursor: t("optCursor"), append: t("optAppendEnd") },
					defaultValue: DEFAULT_SETTINGS.noteWriteMode,
				},
			},
			{
				name: t("sChainWrap"),
				desc: t("sChainWrapDesc"),
				control: {
					type: "dropdown",
					key: "chainWrap",
					options: { paren: t("optParen"), bracket: t("optBracket"), none: t("optNoWrap") },
					defaultValue: DEFAULT_SETTINGS.chainWrap,
				},
			},
			{
				name: t("sChainSep"),
				desc: t("sChainSepDesc"),
				control: {
					type: "dropdown",
					key: "chainSep",
					options: { colon: t("optColon"), dash: t("optDash"), none: t("optNoSep") },
					defaultValue: DEFAULT_SETTINGS.chainSep,
				},
			},
			{
				name: t("sOpenLocation"),
				desc: t("sOpenLocationDesc"),
				control: {
					type: "dropdown",
					key: "openLocation",
					options: { main: t("optMain"), sidebar: t("optSidebar") },
					defaultValue: DEFAULT_SETTINGS.openLocation,
				},
			},
			{
				// 用户使用手册入口（声明式 Action 行，1.13+；手册打包在插件里，见 src/manual.ts）
				name: t("sManual"),
				desc: t("sManualDesc"),
				action: () => {
					new ManualModal(this.app, lang).open();
				},
			},
		];
	}
}

/** 确保文件夹存在（首次保存时用） */
export async function ensureFolder(app: App, folder: string): Promise<void> {
	const path = folder.replace(/^\/+|\/+$/g, "");
	if (!path) return;
	const existing = app.vault.getAbstractFileByPath(path);
	if (existing instanceof TFolder) return;
	try {
		await app.vault.createFolder(path);
	} catch {
		// 已存在或多级路径中间已建，忽略
	}
}
