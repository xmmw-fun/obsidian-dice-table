import { Notice, Plugin, WorkspaceLeaf } from "obsidian";
import { DiceTableSettingTab, DEFAULT_SETTINGS, DiceTableSettings } from "./settings";
import { DiceTableView, VIEW_TYPE_DICE_TABLE } from "./view";
import { t } from "./i18n";

export default class DiceTablePlugin extends Plugin {
	settings!: DiceTableSettings;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.registerView(VIEW_TYPE_DICE_TABLE, (leaf: WorkspaceLeaf) => new DiceTableView(leaf, this));

		// 左侧快捷图标：按设置决定开在哪
		this.addRibbonIcon("dices", t("ribbonTooltip"), () => {
			void this.activateView();
		});

		// 命令面板入口（ID 不带插件 ID，Obsidian 自动加前缀避免冲突）
		this.addCommand({
			id: "open",
			name: t("commandOpen"),
			callback: () => this.activateView(),
		});

		this.addSettingTab(new DiceTableSettingTab(this.app, this));
	}

	// 注意：不要在 onunload 里 detach leaves——那会把界面重置回默认位置，
	// 用户自己挪过位置的话重载后就丢了（官方指南明确禁止）。
	onunload(): void {
		// 保留空实现：事件与视图均由 this.register* 自动清理
	}

	async loadSettings(): Promise<void> {
		const loaded = (await this.loadData()) as Partial<DiceTableSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded);
		// 兼容旧数据：追加模式只支持 Markdown，矛盾组合自动纠正
		if (this.settings.saveMode === "append" && this.settings.saveFormat !== "markdown") {
			this.settings.saveFormat = "markdown";
			void this.saveSettings();
		}
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/** 设置变更后通知所有打开中的界面重扫列表与索引（O1：换骰表路径免重载，阿麦 10-22） */
	async refreshDiceViews(): Promise<void> {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_DICE_TABLE)) {
			const view = leaf.view;
			if (view instanceof DiceTableView) await view.refreshAll();
		}
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
				void workspace.revealLeaf(leaf);
				return;
			}
			// 位置不符：挪到新位置（用 setViewState 原地换容器，状态不丢）
			const state = leaf.getViewState();
			if (this.settings.openLocation === "sidebar") {
				const target = workspace.getRightLeaf(false);
				if (target) {
					await target.setViewState(state);
					void workspace.revealLeaf(target);
				}
			} else {
				const target = workspace.getLeaf(true);
				if (target) {
					await target.setViewState(state);
					void workspace.revealLeaf(target);
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
			new Notice(t("openFailNotice"));
			return;
		}
		await leaf.setViewState({ type: VIEW_TYPE_DICE_TABLE, active: true });
		void workspace.revealLeaf(leaf);
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
