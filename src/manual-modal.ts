// 使用手册弹窗：设置面板「使用说明」行点击后打开（阿麦 2026-10-21 拍板）
// Markdown 渲染走官方 MarkdownRenderer.render；Modal 不是 Component，
// 用独立 Component 实例管理渲染子组件生命周期。
import { App, Component, MarkdownRenderer, Modal } from "obsidian";
import { t } from "./i18n";
import { getManual } from "./manual";

export class ManualModal extends Modal {
	private readonly lang: "zh" | "en";

	constructor(app: App, lang: "zh" | "en") {
		super(app);
		this.lang = lang;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("dice-manual-modal");

		this.titleEl.setText(t("sManual"));
		contentEl.createEl("p", { text: t("sManualModalHint"), cls: "dice-manual-hint" });

		const body = contentEl.createDiv({ cls: "dice-manual-body" });
		const component = new Component();
		component.load();
		void MarkdownRenderer.render(this.app, getManual(this.lang), body, "", component).catch(
			(err: unknown) => {
				console.error("Dice Table: manual render failed", err);
				body.setText(t("sManualRenderFail"));
			}
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
