import { App, PluginSettingTab, Setting, TFolder } from "obsidian";
import type DiceTablePlugin from "./main";
import { FolderSuggest } from "./folder-suggest";

export interface DiceTableSettings {
	/** 骰表文件夹（库内相对路径） */
	diceFolder: string;
	/** 默认保存文件夹 */
	saveFolder: string;
	/** 文件命名模板 */
	nameTemplate: string;
	/** 保存格式 */
	saveFormat: "markdown" | "png" | "jpg";
	/** 打开位置：主区新标签页 / 右侧栏 */
	openLocation: "main" | "sidebar";
}

export const DEFAULT_SETTINGS: DiceTableSettings = {
	diceFolder: "骰表",
	saveFolder: "骰子结果",
	nameTemplate: "{H1}_{YYYYMMDD-HHmm}",
	saveFormat: "markdown",
	openLocation: "main",
};

export class DiceTableSettingTab extends PluginSettingTab {
	plugin: DiceTablePlugin;

	constructor(app: App, plugin: DiceTablePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		new Setting(containerEl).setName("通用").setHeading();

		new Setting(containerEl)
			.setName("骰表文件夹")
			.setDesc("插件从这里读取所有 .md 骰表（一个文件＝一套表：H1＝骰子名，H2＝项，- ＝面）。输入时下拉提示库里已有文件夹；没有的路径也可直接输入，保存时自动创建")
			.addText((text) => {
				text
					.setPlaceholder("骰表")
					.setValue(this.plugin.settings.diceFolder);
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
			.setName("默认保存文件夹")
			.setDesc("点「一键保存」时，摇出的结果存到这里。输入时下拉提示库里已有文件夹；没有的路径也可直接输入，保存时自动创建")
			.addText((text) => {
				text
					.setPlaceholder("骰子结果")
					.setValue(this.plugin.settings.saveFolder);
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
			.setName("文件命名模板")
			.setDesc(
				"大括号里是变量，外面是固定文字。可用变量：{H1} {H2} {H2:2} {YYYY} {MM} {DD} {HH} {mm} {ss} {WW} {YYYYMMDD}。默认 {H1}_{YYYYMMDD-HHmm}"
			)
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
			.setName("保存格式")
			.setDesc("「一键保存」按此格式保存结果：Markdown 文档 / PNG 图片 / JPG 图片（图片为固化的结果卡，跟随导出时的深浅色）")
			.addDropdown((drop) =>
				drop
					.addOption("markdown", "Markdown")
					.addOption("png", "PNG 图片")
					.addOption("jpg", "JPG 图片")
					.setValue(this.plugin.settings.saveFormat)
					.onChange(async (v) => {
						this.plugin.settings.saveFormat = v as DiceTableSettings["saveFormat"];
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("打开位置")
			.setDesc("点左侧骰子图标时，操作界面开在哪里")
			.addDropdown((drop) =>
				drop
					.addOption("main", "主区新标签页")
					.addOption("sidebar", "右侧栏")
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
