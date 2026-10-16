import { ItemView, Notice, WorkspaceLeaf, TFolder, TFile } from "obsidian";
import type DiceTablePlugin from "./main";
import { parseTable, rollPoolValues, Dice, Pool } from "./table";
import { renderNameTemplate, resolveUniquePath } from "./save";
import { renderResultCard } from "./image-export";
import { ensureFolder } from "./settings";

export const VIEW_TYPE_DICE_TABLE = "dice-table-view";

export class DiceTableView extends ItemView {
	plugin: DiceTablePlugin;

	// 当前选中的骰表文件、文件内的骰子列表与选中索引
	private tableFiles: string[] = [];
	private currentFile: string | null = null;
	private diceList: Dice[] = [];
	private diceIndex = 0;
	private currentDice: Dice | null = null;
	// 摇出的一组结果：每项记住池的引用，供单项单独重摇
	private lastResult: Array<{ pool: Pool; values: string[] }> | null = null;

	// 库内文件变化后延迟刷新（防抖）
	private refreshTimer: number | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: DiceTablePlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_DICE_TABLE;
	}

	getDisplayText(): string {
		return "骰表 Dice Table";
	}

	getIcon(): string {
		return "dices";
	}

	async onOpen(): Promise<void> {
		// 监听库内文件变化：新建/删除/改名骰表后自动刷新列表，无需重启插件
		this.registerEvent(this.app.vault.on("create", () => this.scheduleRefresh()));
		this.registerEvent(this.app.vault.on("delete", () => this.scheduleRefresh()));
		this.registerEvent(this.app.vault.on("rename", () => this.scheduleRefresh()));

		await this.refreshTableList();
		this.render();
	}

	onClose(): Promise<void> {
		if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
		this.contentEl.empty();
		return Promise.resolve();
	}

	/** 文件变化防抖刷新，尽量保留当前选择 */
	private scheduleRefresh(): void {
		if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
		this.refreshTimer = window.setTimeout(async () => {
			this.refreshTimer = null;
			const keepFile = this.currentFile;
			const keepDiceTitle = this.currentDice?.title;
			await this.refreshTableList(keepFile);
			if (keepDiceTitle) {
				const idx = this.diceList.findIndex((d) => d.title === keepDiceTitle);
				if (idx !== -1) this.diceIndex = idx;
			}
			this.currentDice = this.diceList[this.diceIndex] ?? null;
			this.lastResult = null;
			this.render();
		}, 500);
	}

	/** 扫描设置的骰表文件夹，列出所有 .md */
	private async refreshTableList(prefer?: string | null): Promise<void> {
		this.tableFiles = [];
		const folder = this.plugin.settings.diceFolder;
		const abs = this.app.vault.getAbstractFileByPath(folder);
		if (abs instanceof TFolder) {
			for (const child of abs.children) {
				if (child.path.toLowerCase().endsWith(".md")) {
					this.tableFiles.push(child.path);
				}
			}
			this.tableFiles.sort();
		}
		if (this.tableFiles.length > 0) {
			this.currentFile =
				prefer && this.tableFiles.includes(prefer) ? prefer : this.tableFiles[0];
			await this.loadCurrentFile();
		} else {
			this.currentFile = null;
			this.diceList = [];
			this.diceIndex = 0;
			this.currentDice = null;
			this.lastResult = null;
		}
	}

	/** 解析当前文件，取出其中全部 H1 骰子 */
	private async loadCurrentFile(): Promise<void> {
		this.diceList = [];
		this.diceIndex = 0;
		this.currentDice = null;
		this.lastResult = null;
		if (!this.currentFile) return;
		const file = this.app.vault.getAbstractFileByPath(this.currentFile);
		if (!file) return;
		const text = await this.app.vault.read(file as TFile);
		const parsed = parseTable(text);
		this.diceList = parsed.diceList;
		this.currentDice = this.diceList[0] ?? null;
	}

	private render(): void {
		const root = this.contentEl;
		root.empty();
		root.addClass("dice-table-view");

		// ── 选表行 ──
		const pickRow = root.createDiv({ cls: "dice-pick-row" });
		pickRow.createEl("label", { text: "骰表：", cls: "dice-label" });
		const select = pickRow.createEl("select", { cls: "dropdown" });
		if (this.tableFiles.length === 0) {
			select.createEl("option", { text: `（文件夹「${this.plugin.settings.diceFolder}」里没有 .md 骰表）` });
		}
		for (const f of this.tableFiles) {
			const opt = select.createEl("option");
			(opt as HTMLOptionElement).value = f;
			(opt as HTMLOptionElement).textContent = f.split("/").pop()!;
			if (f === this.currentFile) (opt as HTMLOptionElement).selected = true;
		}
		select.addEventListener("change", async () => {
			this.currentFile = (select as HTMLSelectElement).value;
			await this.loadCurrentFile();
			this.render();
		});

		// ── 选骰子行（文件内有多个 H1 时出现）──
		if (this.diceList.length > 1) {
			const diceRow = root.createDiv({ cls: "dice-pick-row" });
			diceRow.createEl("label", { text: "骰子：", cls: "dice-label" });
			const diceSelect = diceRow.createEl("select", { cls: "dropdown" });
			for (let i = 0; i < this.diceList.length; i++) {
				const opt = diceSelect.createEl("option");
				(opt as HTMLOptionElement).value = String(i);
				(opt as HTMLOptionElement).textContent = this.diceList[i].title;
				if (i === this.diceIndex) (opt as HTMLOptionElement).selected = true;
			}
			diceSelect.addEventListener("change", () => {
				this.diceIndex = parseInt((diceSelect as HTMLSelectElement).value, 10);
				this.currentDice = this.diceList[this.diceIndex] ?? null;
				this.lastResult = null;
				this.render();
			});
		}

		// ── 骰子名 ──
		const diceNameRow = root.createDiv({ cls: "dice-name-row" });
		if (this.currentDice) {
			diceNameRow.createEl("h3", { text: this.currentDice.title, cls: "dice-name" });
		} else if (this.tableFiles.length > 0) {
			diceNameRow.createEl("p", { text: "这份文件里没有找到 H1 骰子结构。" });
		}

		// ── 结果区 ──
		const resultBox = root.createDiv({ cls: "dice-result" });
		if (this.lastResult) {
			for (let i = 0; i < this.lastResult.length; i++) {
				const item = this.lastResult[i];
				const row = resultBox.createDiv({ cls: "dice-result-row" });
				row.createEl("span", { text: item.pool.title, cls: "dice-result-pool" });
				row.createEl("span", { text: item.values.join("，"), cls: "dice-result-value" });
				const reroll = row.createEl("button");
				reroll.textContent = "↻";
				reroll.addClass("dice-reroll");
				reroll.setAttribute("aria-label", `只重摇「${item.pool.title}」`);
				reroll.addEventListener("click", () => this.onRerollOne(i));
			}
		} else {
			resultBox.createEl("p", { text: "点下面的按钮摇一组。", cls: "dice-result-empty" });
		}

		// ── 按钮行 ──
		const btnRow = root.createDiv({ cls: "dice-btn-row" });
		const rollBtn = btnRow.createEl("button");
		rollBtn.textContent = "🎲 摇一组";
		rollBtn.addClass("mod-cta");
		rollBtn.addEventListener("click", () => this.onRoll());
		const saveBtn = btnRow.createEl("button");
		saveBtn.textContent = "一键保存";
		saveBtn.disabled = !this.lastResult;
		saveBtn.addEventListener("click", () => this.onSave());
	}

	private onRoll(): void {
		if (!this.currentDice) {
			new Notice("没有可摇的骰子，请先在骰表文件夹放一份格式正确的 .md");
			return;
		}
		this.lastResult = this.currentDice.pools.map((pool) => ({ pool, values: rollPoolValues(pool) }));
		this.render();
	}

	/** 单项单独重摇：只重摇该项（一个池将来摇多条时整组重摇），其余项不动 */
	private onRerollOne(index: number): void {
		if (!this.lastResult || !this.lastResult[index]) return;
		const item = this.lastResult[index];
		item.values = rollPoolValues(item.pool);
		this.render();
	}

	private async onSave(): Promise<void> {
		if (!this.lastResult || !this.currentDice) return;
		await ensureFolder(this.app, this.plugin.settings.saveFolder);

		const format = this.plugin.settings.saveFormat;
		const baseName = renderNameTemplate(this.plugin.settings.nameTemplate, {
			h1: this.currentDice.title,
			h2List: this.lastResult.map((r) => r.pool.title),
			now: new Date(),
		});

		// Markdown：文字存档
		if (format === "markdown") {
			const path = await resolveUniquePath(this.app.vault, this.plugin.settings.saveFolder, baseName, ".md");
			const lines: string[] = [`# ${this.currentDice.title}`, ""];
			lines.push(`> 摇出时间：${new Date().toLocaleString()}`, "");
			for (const item of this.lastResult) {
				lines.push(`## ${item.pool.title}`, `- ${item.values.join("，")}`, "");
			}
			await this.app.vault.create(path, lines.join("\n"));
			new Notice(`已保存：${path}`);
			return;
		}

		// PNG/JPG：结果卡图片（固化导出时的主题色）
		try {
			const buf = await renderResultCard({
				diceTitle: this.currentDice.title,
				rows: this.lastResult.map((r) => ({ pool: r.pool.title, values: r.values })),
				rolledAt: new Date(),
				format,
			});
			const path = await resolveUniquePath(this.app.vault, this.plugin.settings.saveFolder, baseName, `.${format}`);
			await this.app.vault.createBinary(path, buf);
			new Notice(`已保存：${path}`);
		} catch (e) {
			new Notice(`图片导出失败：${e instanceof Error ? e.message : String(e)}`);
		}
	}
}
