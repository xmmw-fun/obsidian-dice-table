import { App, PluginSettingTab, Setting, TFolder, SettingDefinitionItem } from "obsidian";
import type DiceTablePlugin from "./main";
import { FolderSuggest } from "./folder-suggest";
import { t } from "./i18n";

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
}

export const DEFAULT_SETTINGS: DiceTableSettings = {
	diceFolder: "骰表",
	saveFolder: "骰子结果",
	nameTemplate: "{H1}_{YYYYMMDD-HHmm}",
	saveFormat: "markdown",
	saveMode: "newfile",
	appendFileTemplate: "{H1}",
	openLocation: "main",
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
		if (key === "saveFormat" || key === "saveMode") this.update();
	}

	/**
	 * 声明式设置（Obsidian 1.13+ 的设置搜索用；旧版本仍走 display()）。
	 * 读写钩子用基类默认实现：按 key 直接读写 plugin.settings 并持久化。
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
				name: t("sOpenLocation"),
				desc: t("sOpenLocationDesc"),
				control: {
					type: "dropdown",
					key: "openLocation",
					options: { main: t("optMain"), sidebar: t("optSidebar") },
					defaultValue: DEFAULT_SETTINGS.openLocation,
				},
			},
		];
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		new Setting(containerEl).setName(t("sHeading")).setHeading();

		new Setting(containerEl)
			.setName(t("sDiceFolder"))
			.setDesc(t("sDiceFolderDesc"))
			.addText((text) => {
				text.setPlaceholder("骰表").setValue(this.plugin.settings.diceFolder);
				new FolderSuggest(this.app, text.inputEl, (picked) => {
					this.plugin.settings.diceFolder = picked || DEFAULT_SETTINGS.diceFolder;
					text.setValue(picked);
					void this.plugin.saveSettings();
				});
				text.onChange(async (v) => {
					this.plugin.settings.diceFolder = v.trim() || DEFAULT_SETTINGS.diceFolder;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName(t("sSaveFolder"))
			.setDesc(t("sSaveFolderDesc"))
			.addText((text) => {
				text.setPlaceholder("骰子结果").setValue(this.plugin.settings.saveFolder);
				new FolderSuggest(this.app, text.inputEl, (picked) => {
					this.plugin.settings.saveFolder = picked || DEFAULT_SETTINGS.saveFolder;
					text.setValue(picked);
					void this.plugin.saveSettings();
				});
				text.onChange(async (v) => {
					this.plugin.settings.saveFolder = v.trim() || DEFAULT_SETTINGS.saveFolder;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName(t("sNameTemplate"))
			.setDesc(t("sNameTemplateDesc"))
			.addText((text) =>
				text
					.setPlaceholder("{H1}_{YYYYMMDD-HHmm}")
					.setValue(this.plugin.settings.nameTemplate)
					.onChange(async (v) => {
						this.plugin.settings.nameTemplate = v.trim() || DEFAULT_SETTINGS.nameTemplate;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(t("sSaveFormat"))
			.setDesc(t("sSaveFormatDesc"))
			.addDropdown((drop) => {
				drop.addOption("markdown", t("optMarkdown"))
					.addOption("png", t("optPng"))
					.addOption("jpg", t("optJpg"));
				// 互锁：追加模式下图片格式不可选（追加仅支持 Markdown）
				if (this.plugin.settings.saveMode === "append") {
					for (const opt of Array.from(drop.selectEl.options)) {
						if (opt.value !== "markdown") opt.disabled = true;
					}
				}
				drop.setValue(this.plugin.settings.saveFormat).onChange(async (v) => {
					this.plugin.settings.saveFormat = v as DiceTableSettings["saveFormat"];
					// 互锁纠正：切到图片格式时，把保存方式自动纠正回「新文件」（追加仅支持 Markdown）
					if (this.plugin.settings.saveFormat !== "markdown" && this.plugin.settings.saveMode === "append") {
						this.plugin.settings.saveMode = "newfile";
					}
					await this.plugin.saveSettings();
					// 重渲染设置页，让保存方式下拉的灰显状态即时更新
					this.display();
				});
			});

		new Setting(containerEl)
			.setName(t("sSaveMode"))
			.setDesc(t("sSaveModeDesc"))
			.addDropdown((drop) => {
				drop.addOption("newfile", t("optNewFile")).addOption("append", t("optAppend"));
				// 互锁：图片格式下追加模式不可选（追加仅支持 Markdown）
				if (this.plugin.settings.saveFormat !== "markdown") {
					for (const opt of Array.from(drop.selectEl.options)) {
						if (opt.value === "append") opt.disabled = true;
					}
				}
				drop.setValue(this.plugin.settings.saveMode)
					.onChange(async (v) => {
						this.plugin.settings.saveMode = v as DiceTableSettings["saveMode"];
						// 互锁纠正：切到追加模式时，把保存格式自动纠正回 Markdown（追加不支持图片）
						if (this.plugin.settings.saveMode === "append" && this.plugin.settings.saveFormat !== "markdown") {
							this.plugin.settings.saveFormat = "markdown";
						}
						await this.plugin.saveSettings();
						// 重渲染设置页，让保存格式下拉的灰显状态即时更新
						this.display();
					});
			});

		new Setting(containerEl)
			.setName(t("sAppendTemplate"))
			.setDesc(t("sAppendTemplateDesc"))
			.addText((text) =>
				text
					.setPlaceholder("{H1}")
					.setValue(this.plugin.settings.appendFileTemplate)
					.onChange(async (v) => {
						this.plugin.settings.appendFileTemplate = v.trim() || DEFAULT_SETTINGS.appendFileTemplate;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(t("sOpenLocation"))
			.setDesc(t("sOpenLocationDesc"))
			.addDropdown((drop) =>
				drop
					.addOption("main", t("optMain"))
					.addOption("sidebar", t("optSidebar"))
					.setValue(this.plugin.settings.openLocation)
					.onChange(async (v) => {
						this.plugin.settings.openLocation = v as DiceTableSettings["openLocation"];
						await this.plugin.saveSettings();
					})
			);
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
