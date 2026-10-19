import { ItemView, Notice, WorkspaceLeaf, TFolder, TFile } from "obsidian";
import type DiceTablePlugin from "./main";
import { parseTable, rollPoolValues, Dice, Pool } from "./table";
import { renderNameTemplate, resolveUniquePath, sanitizeFilename } from "./save";
import { renderResultCard } from "./image-export";
import { ensureFolder } from "./settings";
import { t } from "./i18n";

export const VIEW_TYPE_DICE_TABLE = "dice-table-view";

/** 一组结果的内部形态：每项记住池的引用，供单项单独重摇 */
interface ResultItem {
	pool: Pool;
	values: string[];
}

/** 历史记录条目（本次会话内存，最多 20 组） */
interface HistoryEntry {
	diceTitle: string;
	items: ResultItem[];
	time: Date;
}

export class DiceTableView extends ItemView {
	plugin: DiceTablePlugin;

	// 当前选中的骰表文件、文件内的骰子列表与选中索引
	private tableFiles: string[] = [];
	private currentFile: string | null = null;
	private diceList: Dice[] = [];
	private diceIndex = 0;
	private currentDice: Dice | null = null;
	// 摇出的一组结果
	private lastResult: ResultItem[] | null = null;
	// 摇骰历史（会话内存，重启即清空）
	private history: HistoryEntry[] = [];

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
		return t("viewTitle");
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
		this.refreshTimer = window.setTimeout(() => {
			void (async () => {
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
			})();
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
			this.currentFile = prefer && this.tableFiles.includes(prefer) ? prefer : this.tableFiles[0];
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
		if (!(file instanceof TFile)) return;
		const text = await this.app.vault.read(file);
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
		pickRow.createEl("label", { text: t("tableLabel"), cls: "dice-label" });
		const select = pickRow.createEl("select", { cls: "dropdown" });
		if (this.tableFiles.length === 0) {
			select.createEl("option", { text: t("noTables", { folder: this.plugin.settings.diceFolder }) });
		}
		for (const f of this.tableFiles) {
			const opt = select.createEl("option");
			opt.value = f;
			opt.textContent = f.split("/").pop()!;
			if (f === this.currentFile) opt.selected = true;
		}
		select.addEventListener("change", () => {
			this.currentFile = select.value;
			void this.loadCurrentFile().then(() => this.render());
		});

		// ── 选骰子行（文件内有多个 H1 时出现）──
		if (this.diceList.length > 1) {
			const diceRow = root.createDiv({ cls: "dice-pick-row" });
			diceRow.createEl("label", { text: t("diceLabel"), cls: "dice-label" });
			const diceSelect = diceRow.createEl("select", { cls: "dropdown" });
			for (let i = 0; i < this.diceList.length; i++) {
				const opt = diceSelect.createEl("option");
				opt.value = String(i);
				opt.textContent = this.diceList[i].title;
				if (i === this.diceIndex) opt.selected = true;
			}
			diceSelect.addEventListener("change", () => {
				this.diceIndex = parseInt(diceSelect.value, 10);
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
			diceNameRow.createEl("p", { text: t("noDiceInFile") });
		}

		// ── 结果区 ──
		const resultBox = root.createDiv({ cls: "dice-result" });
		if (this.lastResult) {
			for (let i = 0; i < this.lastResult.length; i++) {
				const item = this.lastResult[i];
				const row = resultBox.createDiv({ cls: "dice-result-row" });
				row.createSpan({ text: item.pool.title, cls: "dice-result-pool" });
				row.createSpan({ text: item.values.join("，"), cls: "dice-result-value" });
				const reroll = row.createEl("button");
				reroll.textContent = "↻";
				reroll.addClass("dice-reroll");
				reroll.setAttribute("aria-label", t("rerollAria", { pool: item.pool.title }));
				reroll.addEventListener("click", () => this.onRerollOne(i));
			}
		} else {
			resultBox.createEl("p", { text: t("emptyResult"), cls: "dice-result-empty" });
		}

		// ── 按钮行 ──
		const btnRow = root.createDiv({ cls: "dice-btn-row" });
		const rollBtn = btnRow.createEl("button");
		rollBtn.textContent = t("rollBtn");
		rollBtn.addClass("mod-cta");
		rollBtn.addEventListener("click", () => this.onRoll());
		const saveBtn = btnRow.createEl("button");
		saveBtn.textContent = t("saveBtn");
		saveBtn.disabled = !this.lastResult;
		saveBtn.addEventListener("click", () => void this.onSave());
		const copyBtn = btnRow.createEl("button");
		copyBtn.textContent = t("copyBtn");
		copyBtn.disabled = !this.lastResult;
		copyBtn.addEventListener("click", () => void this.onCopy());

		// ── 历史区 ──
		this.renderHistory(root);
	}

	/** 历史区：会话内最近 20 组，可载回结果区 */
	private renderHistory(root: HTMLElement): void {
		if (this.history.length === 0) return;
		const details = root.createEl("details", { cls: "dice-history" });
		details.createEl("summary", { text: t("historySummary", { n: this.history.length }) });
		for (const entry of [...this.history].reverse()) {
			const row = details.createDiv({ cls: "dice-history-row" });
			const pad = (v: number) => String(v).padStart(2, "0");
			const hhmm = `${pad(entry.time.getHours())}:${pad(entry.time.getMinutes())}`;
			row.createSpan({ text: hhmm, cls: "dice-history-time" });
			row.createSpan({
				text: `${entry.diceTitle} · ${entry.items.map((it) => it.values.join("，")).join(" / ")}`,
				cls: "dice-history-text",
			});
			const load = row.createEl("button");
			load.textContent = t("historyLoad");
			load.addClass("dice-reroll");
			load.setAttribute("aria-label", t("historyLoadAria"));
			load.addEventListener("click", () => {
				this.lastResult = entry.items;
				// 载入的组可能来自别的骰子：切回它的文件与骰子
				const keepDiceTitle = entry.diceTitle;
				const idx = this.diceList.findIndex((d) => d.title === keepDiceTitle);
				if (idx !== -1) this.diceIndex = idx;
				this.currentDice = this.diceList[this.diceIndex] ?? this.currentDice;
				this.render();
			});
		}
	}

	private onRoll(): void {
		if (!this.currentDice) {
			new Notice(t("noDiceNotice"));
			return;
		}
		this.lastResult = this.currentDice.pools.map((pool) => ({ pool, values: rollPoolValues(pool) }));
		if (this.lastResult) {
			this.history.push({ diceTitle: this.currentDice.title, items: this.lastResult, time: new Date() });
			if (this.history.length > 20) this.history.shift();
		}
		this.render();
	}

	/** 单项单独重摇：只重摇该项（一个池摇多条时整组重摇），其余项不动 */
	private onRerollOne(index: number): void {
		if (!this.lastResult || !this.lastResult[index]) return;
		const item = this.lastResult[index];
		item.values = rollPoolValues(item.pool);
		this.render();
	}

	/** 复制当前结果为文字进剪贴板 */
	private async onCopy(): Promise<void> {
		if (!this.lastResult || !this.currentDice) return;
		const lines: string[] = [`# ${this.currentDice.title}`];
		for (const item of this.lastResult) {
			lines.push(`- ${item.pool.title}：${item.values.join("，")}`);
		}
		try {
			await navigator.clipboard.writeText(lines.join("\n"));
			new Notice(t("copiedNotice"));
		} catch (e) {
			new Notice(t("copyFailNotice", { msg: e instanceof Error ? e.message : String(e) }));
		}
	}

	/** 结果的 Markdown 小节（新文件正文 / 追加段落共用） */
	private resultSection(now: Date): string {
		if (!this.lastResult) return "";
		const pad = (v: number) => String(v).padStart(2, "0");
		const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
		const lines: string[] = [`## ${stamp}`];
		for (const item of this.lastResult) {
			lines.push(`- ${item.pool.title}：${item.values.join("，")}`);
		}
		return lines.join("\n");
	}

	private async onSave(): Promise<void> {
		if (!this.lastResult || !this.currentDice) return;
		await ensureFolder(this.app, this.plugin.settings.saveFolder);

		const settings = this.plugin.settings;
		const format = settings.saveFormat;
		const now = new Date();
		const nameVars = {
			h1: this.currentDice.title,
			h2List: this.lastResult.map((r) => r.pool.title),
			now,
		};
		const baseName = renderNameTemplate(settings.nameTemplate, nameVars);

		// ── 追加模式（仅 Markdown；图片不支持追加，回落到新文件并提示）──
		if (settings.saveMode === "append") {
			if (format !== "markdown") {
				new Notice(t("appendImgFallback"));
			} else {
				await this.saveAppend(nameVars, now);
				return;
			}
		}

		// ── 新文件模式 ──
		if (format === "markdown") {
			const path = await resolveUniquePath(this.app.vault, settings.saveFolder, baseName, ".md");
			const lines: string[] = [`# ${this.currentDice.title}`, ""];
			lines.push(`> ${t("rolledAtLabel")}：${now.toLocaleString()}`, "");
			for (const item of this.lastResult) {
				lines.push(`## ${item.pool.title}`, `- ${item.values.join("，")}`, "");
			}
			await this.app.vault.create(path, lines.join("\n"));
			new Notice(t("savedNotice", { path }));
			return;
		}

		// PNG/JPG：结果卡图片（固化导出时的主题色）
		try {
			const buf = await renderResultCard({
				diceTitle: this.currentDice.title,
				rows: this.lastResult.map((r) => ({ pool: r.pool.title, values: r.values })),
				rolledAt: now,
				format,
			});
			const path = await resolveUniquePath(this.app.vault, settings.saveFolder, baseName, `.${format}`);
			await this.app.vault.createBinary(path, buf);
			new Notice(t("savedNotice", { path }));
		} catch (e) {
			new Notice(t("imgFailNotice", { msg: e instanceof Error ? e.message : String(e) }));
		}
	}

	/** 追加保存：写入 保存文件夹/追加文件模板.md；不存在则先建（带 H1 头），存在则续写小节 */
	private async saveAppend(
		nameVars: { h1: string; h2List: string[]; now: Date },
		now: Date
	): Promise<void> {
		const settings = this.plugin.settings;
		const base = sanitizeFilename(
			renderNameTemplate(settings.appendFileTemplate || "{H1}", nameVars)
		);
		const path = `${settings.saveFolder.replace(/^\/+|\/+$/g, "")}/${base}.md`;
		const section = this.resultSection(now);
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (!existing) {
			const header = `# ${nameVars.h1}\n\n`;
			await this.app.vault.create(path, header + section + "\n");
			new Notice(t("appendCreated", { path }));
			return;
		}
		if (!(existing instanceof TFile)) {
			new Notice(t("imgFailNotice", { msg: path }));
			return;
		}
		await this.app.vault.process(existing, (data) => data.replace(/\n*$/, "\n\n") + section + "\n");
		new Notice(t("appended", { path }));
	}
}
