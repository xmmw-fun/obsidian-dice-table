import { Notice, Plugin, WorkspaceLeaf } from "obsidian";
import { DiceTableSettingTab, DEFAULT_SETTINGS, DiceTableSettings } from "./settings";
import { DiceTableView, VIEW_TYPE_DICE_TABLE } from "./view";

export default class DiceTablePlugin extends Plugin {
	settings!: DiceTableSettings;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.registerView(VIEW_TYPE_DICE_TABLE, (leaf: WorkspaceLeaf) => new DiceTableView(leaf, this));

		// 左侧快捷图标：按设置决定开在哪
		this.addRibbonIcon("dices", "骰表：打开操作界面", () => {
			this.activateView();
		});

		// 命令面板入口
		this.addCommand({
			id: "open-dice-table",
			name: "打开骰表操作界面",
			callback: () => this.activateView(),
		});

		this.addSettingTab(new DiceTableSettingTab(this.app, this));
	}

	onunload(): void {
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_DICE_TABLE);
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/** 按 openLocation 设置打开操作界面；已开着的界面若位置与设置不符，自动挪过去 */
	async activateView(): Promise<void> {
		const { workspace } = this.app;

		const existing = workspace.getLeavesOfType(VIEW_TYPE_DICE_TABLE);
		if (existing.length > 0) {
			const leaf = existing[0];
			const inSidebar = this.isInSidebar(leaf);
			if (inSidebar === (this.settings.openLocation === "sidebar")) {
				// 位置符合设置，只聚焦
				workspace.revealLeaf(leaf);
				return;
			}
			// 位置不符：挪到新位置（用 setViewState 原地换容器，状态不丢）
			const state = leaf.getViewState();
			if (this.settings.openLocation === "sidebar") {
				const target = workspace.getRightLeaf(false);
				if (target) {
					await target.setViewState(state);
					workspace.revealLeaf(target);
				}
			} else {
				const target = workspace.getLeaf(true);
				if (target) {
					await target.setViewState(state);
					workspace.revealLeaf(target);
				}
			}
			return;
		}

		let leaf: WorkspaceLeaf | null;
		if (this.settings.openLocation === "sidebar") {
			leaf = workspace.getRightLeaf(false);
		} else {
			leaf = workspace.getLeaf(true);
		}
		if (!leaf) {
			new Notice("无法打开骰表界面");
			return;
		}
		await leaf.setViewState({ type: VIEW_TYPE_DICE_TABLE, active: true });
		workspace.revealLeaf(leaf);
	}

	/** 判断一个 leaf 是否在左/右侧栏里（沿父节点向上找侧栏容器） */
	private isInSidebar(leaf: WorkspaceLeaf): boolean {
		// leftSplit/rightSplit 未进公开类型定义，走 unknown 收窄而非 any
		const ws = this.app.workspace as unknown as { leftSplit?: unknown; rightSplit?: unknown };
		let node: unknown = leaf;
		while (node) {
			if (node === ws.leftSplit || node === ws.rightSplit) return true;
			node = (node as { parent?: unknown }).parent ?? null;
		}
		return false;
	}
}
