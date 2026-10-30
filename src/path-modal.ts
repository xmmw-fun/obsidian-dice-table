// 修改骰子路径 Modal（1.6，阿麦 2026-10-30 拍板：面板里直接改路径，不用去设置页）
// 输入建议用官方 AbstractInputSuggest<TFolder>（005 项目教训：官方有现成组件，绝不自造浮层）
import { AbstractInputSuggest, App, Modal, Notice, TFolder } from "obsidian";
import type DiceTablePlugin from "./main";
import { t } from "./i18n";

/** 官方文件夹建议：输入时列出库内文件夹（AbstractInputSuggest，命令面板同款手感） */
class TFolderSuggest extends AbstractInputSuggest<TFolder> {
	getSuggestions(query: string): TFolder[] {
		const q = query.toLowerCase();
		return this.app.vault
			.getAllLoadedFiles()
			.filter((f): f is TFolder => f instanceof TFolder && f.path.toLowerCase().includes(q))
			.slice(0, 50);
	}

	renderSuggestion(folder: TFolder, el: HTMLElement): void {
		el.setText(folder.path || "/");
	}

	selectSuggestion(folder: TFolder): void {
		// 只回填输入框，不直接提交——用户看清路径再按保存（官方 API：setValue 写回输入框）
		this.setValue(folder.path);
		this.close();
	}
}

/** 修改骰子路径：提交走设置页同一管道（setControlValue），两个方向天然同步 */
export class FolderPathModal extends Modal {
	private inputEl!: HTMLInputElement;

	constructor(app: App, private plugin: DiceTablePlugin) {
		super(app);
	}

	onOpen(): void {
		this.contentEl.createEl("h3", { text: t("changeFolderTitle") });
		this.contentEl.createEl("p", { text: t("changeFolderHint"), cls: "setting-item-description" });
		this.inputEl = this.contentEl.createEl("input", {
			type: "text",
			value: this.plugin.settings.diceFolder,
			placeholder: t("changeFolderPlaceholder"),
		});
		this.inputEl.addClass("dice-folder-input");
		new TFolderSuggest(this.app, this.inputEl);
		this.inputEl.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				void this.submit();
			}
		});

		const btnRow = this.contentEl.createDiv({ cls: "modal-button-container" });
		const ok = btnRow.createEl("button", { text: t("changeFolderSave"), cls: "mod-cta" });
		ok.addEventListener("click", () => void this.submit());
		const cancel = btnRow.createEl("button", { text: t("changeFolderCancel") });
		cancel.addEventListener("click", () => this.close());
	}

	private async submit(): Promise<void> {
		const path = this.inputEl.value.trim().replace(/^\/+|\/+$/g, "");
		if (path !== "") {
			const hit = this.app.vault.getAbstractFileByPath(path);
			if (!(hit instanceof TFolder)) {
				new Notice(t("changeFolderNotFound", { path }));
				return; // 不关闭，让她改
			}
		}
		// 空路径＝整个库根，合法
		const tab = this.plugin.settingsTab;
		if (tab) {
			await tab.setControlValue("diceFolder", path);
		} else {
			this.plugin.settings.diceFolder = path;
			await this.plugin.saveSettings();
			await this.plugin.refreshDiceViews();
		}
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
