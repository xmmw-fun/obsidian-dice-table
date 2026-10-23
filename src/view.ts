import { ItemView, Notice, WorkspaceLeaf, TFolder, TFile, MarkdownView } from "obsidian";
import type DiceTablePlugin from "./main";
import { parseTable, collectRefTargets, Dice, Pool } from "./table";
import { rollPoolFull, rollDiceFull, RefResolver, ResultItem, ChainFormat, defaultResolvePool } from "./result";
import { renderNameTemplate, resolveUniquePath, sanitizeFilename } from "./save";
import { renderResultCard } from "./image-export";
import { ensureFolder } from "./settings";
import { t } from "./i18n";

export const VIEW_TYPE_DICE_TABLE = "dice-table-view";

/** 把引用目标拆成「路径部分 + #名部分」；路径部分含 / 或以 .md 结尾才算路径（双链形式） */
function splitTarget(target: string): { path: string | null; name: string | null } {
	const hash = target.indexOf("#");
	const pathPart = hash === -1 ? target : target.slice(0, hash);
	const name = hash === -1 ? null : target.slice(hash + 1);
	const isPath = pathPart.includes("/") || pathPart.endsWith(".md");
	return { path: isPath ? pathPart : null, name };
}

/** 取库内相对路径的目录部分（用于「同文件夹优先」判定） */
function dirOf(p: string): string {
	return p.split("/").slice(0, -1).join("/");
}

/** 历史记录条目（会话内存，最多 20 组） */
interface HistoryEntry {
	diceTitle: string;
	items: ResultItem[];
	time: Date;
}

/** 库内全部骰表的索引（池引用/链式引用用；按文件路径缓存） */
interface DiceSource {
	path: string;
	dice: Dice[];
}

export class DiceTableView extends ItemView {
	plugin: DiceTablePlugin;

	// 当前选中的骰表文件、文件内的骰子列表与选中索引
	private tableFiles: string[] = [];
	private currentFile: string | null = null;
	private diceList: Dice[] = [];
	private diceIndex = 0;
	private currentDice: Dice | null = null;
	// 库内全部骰表索引（供池引用/链式引用跨文件解析；含当前文件）
	private diceSources: DiceSource[] = [];
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
		// 监听库内文件变化：新建/删除/改名骰表后自动刷新列表，无需重启插件；
		// 改内容也刷新（阿麦 10-22：改完 H1/池内容切回界面，马上用新解析——此前只听新建/删除/改名，改了没反应）
		this.registerEvent(this.app.vault.on("create", () => this.scheduleRefresh()));
		this.registerEvent(this.app.vault.on("delete", () => this.scheduleRefresh()));
		this.registerEvent(this.app.vault.on("rename", () => this.scheduleRefresh()));
		this.registerEvent(this.app.vault.on("modify", (file) => {
			// 只盯骰表文件夹内的 .md 改动（写别的笔记保存不触发重扫）
			if (!(file instanceof TFile)) return;
			const folder = this.plugin.settings.diceFolder.replace(/^\/+|\/+$/g, "");
			if (folder && !file.path.startsWith(`${folder}/`)) return;
			this.scheduleRefresh();
		}));

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

	/** 设置变更（如更换骰表路径）后由 main 调用：重扫列表与索引并重渲染（O1，阿麦 10-22） */
	async refreshAll(): Promise<void> {
		await this.refreshTableList();
		this.render();
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

	/** 解析当前文件，取出其中全部 H1 骰子；并刷新库内索引供引用解析 */
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
		await this.refreshDiceIndex();
	}

	/**
	 * 刷新库内全部骰表索引（池引用/链式引用用）。
	 * 只读骰表文件夹内的 .md；解析失败的文件跳过，不影响主流程。
	 */
	private async refreshDiceIndex(): Promise<void> {
		const folder = this.plugin.settings.diceFolder.replace(/^\/+|\/+$/g, "");
		const root = folder ? this.app.vault.getAbstractFileByPath(folder) : this.app.vault.getRoot();
		const files: string[] = [];
		const walk = (f: TFolder | null): void => {
			const target = f ?? this.app.vault.getRoot();
			for (const child of target.children) {
				if (child instanceof TFolder) walk(child);
				else if (child.path.toLowerCase().endsWith(".md")) files.push(child.path);
			}
		};
		if (root instanceof TFolder || !folder) walk(root instanceof TFolder ? root : null);

		const sources: DiceSource[] = [];
		for (const path of files) {
			const f = this.app.vault.getAbstractFileByPath(path);
			if (!(f instanceof TFile)) continue;
			try {
				const text = await this.app.vault.read(f);
				sources.push({ path, dice: parseTable(text).diceList });
			} catch {
				// 读取失败的文件跳过
			}
		}
		// 增量：把 [[ ]] 双链指向骰表文件夹之外的文件也读进索引（阿麦 10-22，#11b；
		// 被引文件自己的引用再展开一轮，深度上限 5 防意外递归）
		const loaded = new Set(sources.map((s) => s.path));
		const locate = (p: string): TFile | null => {
			const withExt = p.endsWith(".md") ? p : `${p}.md`;
			const direct = this.app.vault.getAbstractFileByPath(withExt);
			if (direct instanceof TFile) return direct;
			const byLink = this.app.metadataCache.getFirstLinkpathDest(p, "");
			return byLink instanceof TFile ? byLink : null;
		};
		for (let round = 0; round < 5; round++) {
			const pending = new Set<string>();
			for (const src of sources) {
				for (const ref of src.dice.flatMap((d) => collectRefTargets(d))) {
					// 双链形式 [[X#名]]：取括号内 # 前部分；否则路径形式（含 / 或 .md）；裸名跳过（只在骰表文件夹内匹配）
					const link = /^\[\[(?<inner>.+)\]\]$/.exec(ref.trim());
					let filePart: string | null = null;
					if (link?.groups) filePart = link.groups.inner.trim().split("#")[0];
					else {
						const { path } = splitTarget(ref);
						filePart = path;
					}
					if (!filePart) continue;
					const file = locate(filePart);
					if (file && !loaded.has(file.path)) {
						pending.add(file.path);
						loaded.add(file.path);
					}
				}
			}
			if (pending.size === 0) break;
			for (const p of pending) {
				const f = this.app.vault.getAbstractFileByPath(p);
				if (!(f instanceof TFile)) continue;
				try {
					const text = await this.app.vault.read(f);
					sources.push({ path: p, dice: parseTable(text).diceList });
				} catch {
					// 读取失败跳过
				}
			}
		}
		this.diceSources = sources;
	}

/**
 * 构造引用解析器（阿麦 2026-10-22 二次修订）：
 * - **双链目标 `[[文件夹/文件#骰子名]]`（含不带文件夹的 `[[种族库]]`）→ 一律按 Obsidian 链接解析**
 *   （`getFirstLinkpathDest` 全库定位），指哪打哪——不搞重名检测、不提示（阿麦：「直接就是指向双链」）；
 * - 裸名目标（老写法 `-> 种族库`）→ 在骰表文件夹范围内按「当前文件＞同文件夹＞其它（字典序）」静默查找；
 * - 路径形式目标（`-> 文件夹/文件#名`，不带方括号）→ 按库内路径精确定位。
 */
private makeResolver(): RefResolver {
	const sources = this.diceSources;
	const curPath = this.currentFile;

	// 解析顺序：当前文件置顶，其余按「同文件夹优先、再字典序」排
	const ordered = [...sources].sort((a, b) => {
		if (a.path === curPath) return -1;
		if (b.path === curPath) return 1;
		const fa = curPath && dirOf(a.path) === dirOf(curPath) ? 0 : 1;
		const fb = curPath && dirOf(b.path) === dirOf(curPath) ? 0 : 1;
		return fa - fb || a.path.localeCompare(b.path);
	});

	/** 按路径/链接文本定位库内 .md 文件（同步 API；链接文本走 getFirstLinkpathDest 全库搜） */
	const locateFile = (pathOrName: string): TFile | null => {
		const withExt = pathOrName.endsWith(".md") ? pathOrName : `${pathOrName}.md`;
		const direct = this.app.vault.getAbstractFileByPath(withExt);
		if (direct instanceof TFile) return direct;
		const byLink = this.app.metadataCache.getFirstLinkpathDest(pathOrName, curPath ?? "");
		return byLink instanceof TFile ? byLink : null;
	};

	/** 双链目标 `[[X#名]]`：拆出文件部分与 #名；X 一律按链接文本/路径定位 */
	const parseLink = (target: string): { filePart: string; name: string | null } | null => {
		const m = /^\[\[(?<inner>.+)\]\]$/.exec(target.trim());
		if (!m?.groups) return null;
		const inner = m.groups.inner.trim();
		const hash = inner.indexOf("#");
		return { filePart: hash === -1 ? inner : inner.slice(0, hash), name: hash === -1 ? null : inner.slice(hash + 1) };
	};

	const findDice = (target: string): Dice | null => {
		// 双链形式：定位文件后在文件内找（不带 #名则找同名 H1、再退第一个）
		const link = parseLink(target);
		if (link) {
			const file = locateFile(link.filePart);
			const src = file ? sources.find((s) => s.path === file.path) : undefined;
			if (!src) return null;
			if (link.name) return src.dice.find((d) => d.title === link.name) ?? null;
			const linkText = link.filePart.split("/").pop()!;
			return src.dice.find((d) => d.title === linkText) ?? src.dice[0] ?? null;
		}
		// 路径形式（不带方括号但含 / 或 .md）：同样精确定位
		const { path, name } = splitTarget(target);
		if (path) {
			const file = locateFile(path);
			const src = file ? sources.find((s) => s.path === file.path) : undefined;
			if (!src) return null;
			if (name) return src.dice.find((d) => d.title === name) ?? null;
			const linkText = path.split("/").pop()!;
			return src.dice.find((d) => d.title === linkText) ?? src.dice[0] ?? null;
		}
		// 裸名（老写法）：按序静默查找（阿麦 10-22：不做重名检测/提示，要精确就用双链）
		const diceName = name ?? target;
		for (const src of ordered) {
			const d = src.dice.find((x) => x.title === diceName);
			if (d) return d;
		}
		return null;
	};
	const findPool = (target: string): Pool | null => {
		// 双链/路径形式：定位文件后按池名找（不带池名的由 findDice 合成处理）
		const link = parseLink(target);
		const { path, name } = splitTarget(link ? link.filePart + (link.name ? `#${link.name}` : "") : target);
		const filePart = link ? link.filePart : path;
		if (filePart) {
			if (!name && !link) return null;
			const file = locateFile(filePart);
			const src = file ? sources.find((s) => s.path === file.path) : undefined;
			if (!src) return null;
			return src.dice.flatMap((d) => d.pools).find((x) => x.title === name) ?? null;
		}
		// 裸名带 #：`文件#池名`——先按文件名匹配，再在其中找池（兼容 1.3.0 既有写法）
		if (name) {
			const filePart0 = target.split("#")[0];
			const src = sources.find((s) => s.path.replace(/\.md$/, "").split("/").pop() === filePart0 || s.path === filePart0);
			if (!src) return null;
			return src.dice.flatMap((d) => d.pools).find((x) => x.title === name) ?? null;
		}
		// 纯裸名池：按序静默查找
		for (const src of ordered) {
			const p = src.dice.flatMap((d) => d.pools).find((x) => x.title === target);
			if (p) return p;
		}
		return null;
	};
	return { resolveDice: findDice, resolvePool: (t) => defaultResolvePool(t, findPool, findDice) };
}

	/** 当前链式拼接格式（用户设置项） */
	private chainFormat(): ChainFormat {
		const s = this.plugin.settings;
		return { wrap: s.chainWrap, sep: s.chainSep };
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

		// 「打开文档」：直接打开当前骰表的 .md，改池子不用回库翻文件（阿麦 10-22）
		const openBtn = pickRow.createEl("button");
		openBtn.textContent = t("openTableBtn");
		openBtn.addClass("dice-reroll");
		openBtn.disabled = !this.currentFile;
		openBtn.setAttribute("aria-label", t("openTableBtn"));
		openBtn.addEventListener("click", () => this.openTableFile());

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
				this.renderResultItem(resultBox, this.lastResult[i], i);
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
		const noteBtn = btnRow.createEl("button");
		noteBtn.textContent = t("writeNoteBtn");
		noteBtn.disabled = !this.lastResult;
		noteBtn.addEventListener("click", () => this.writeToCurrentNote());

		// ── 历史区 ──
		this.renderHistory(root);
	}

	/**
	 * 渲染一个池的结果：普通值一行；有子池则父池一块、子池另起一行缩进；
	 * 有多套实例则按「第 N 个X」分组（阿麦 12:30/13:02 定稿）。
	 */
	private renderResultItem(container: HTMLElement, item: ResultItem, index: number, isSub = false): void {
		const row = container.createDiv({ cls: isSub ? "dice-result-row dice-sub" : "dice-result-row" });
		row.createSpan({ text: item.pool.title, cls: "dice-result-pool" });
		if (item.values.length > 0) {
			row.createSpan({ text: item.values.join("，"), cls: "dice-result-value" });
		}
		if (item.values.length === 0 && item.subResults.length === 0 && item.instances.length === 0) {
			row.createSpan({ text: item.values.join("，") || "（空）", cls: "dice-result-value" });
		}
		const reroll = row.createEl("button");
		reroll.textContent = "↻";
		reroll.addClass("dice-reroll");
		reroll.setAttribute("aria-label", t("rerollAria", { pool: item.pool.title }));
		reroll.addEventListener("click", () => this.onRerollOne(index));

		// 子池：另起一行、缩进
		for (const sub of item.subResults) {
			this.renderResultItem(container, sub, -1, true);
		}

		// 多套实例：每组一块
		if (item.instances.length > 0) {
			const label = item.instances.length === 1 ? item.pool.title : `${item.pool.title}（${item.instances.length} 套）`;
			const groupLabel = container.createDiv({ cls: "dice-instance-group" });
			groupLabel.setText(label);
			item.instances.forEach((inst, k) => {
				const head = container.createDiv({ cls: "dice-instance-head" });
				head.setText(t("instanceLabel", { n: k + 1, title: item.pool.title }));
				for (const sub of inst.items) this.renderResultItem(container, sub, -1, true);
			});
		}
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

	/**
	 * 打开当前骰表文档（阿麦 2026-10-22：点一下直接开文件，改池子不用回库翻）。
	 * 已在某标签页打开 → 聚焦它（不开重复标签）；否则新开标签页——不覆盖正在编辑的笔记。
	 */
	private openTableFile(): void {
		if (!this.currentFile) return;
		const file = this.app.vault.getAbstractFileByPath(this.currentFile);
		if (!(file instanceof TFile)) return;
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			const view = leaf.view;
			if (view instanceof MarkdownView && view.file?.path === file.path) {
				void this.app.workspace.revealLeaf(leaf);
				return;
			}
		}
		void this.app.workspace.getLeaf(true).openFile(file);
	}

	private onRoll(): void {
		if (!this.currentDice) {
			new Notice(t("noDiceNotice"));
			return;
		}
		const resolver = this.makeResolver();
		const fmt = this.chainFormat();
		this.lastResult = rollDiceFull(this.currentDice, resolver, fmt);
		this.history.push({ diceTitle: this.currentDice.title, items: this.lastResult, time: new Date() });
		if (this.history.length > 20) this.history.shift();
		this.render();
	}

	/** 单项单独重摇：只重摇该项（含其子池与实例整组重摇），其余项不动 */
	private onRerollOne(index: number): void {
		if (!this.lastResult || index < 0 || !this.lastResult[index]) return;
		const item = this.lastResult[index];
		const resolver = this.makeResolver();
		const fmt = this.chainFormat();
		const fresh = rollPoolFull(item.pool, resolver, fmt);
		item.values = fresh.values;
		item.subResults = fresh.subResults;
		item.instances = fresh.instances;
		this.render();
	}

	/** 复制当前结果为文字进剪贴板 */
	private async onCopy(): Promise<void> {
		if (!this.lastResult || !this.currentDice) return;
		const lines: string[] = [`# ${this.currentDice.title}`];
		for (const item of this.lastResult) {
			lines.push(`- ${item.pool.title}：${this.flatten(item)}`);
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
			lines.push(`- ${item.pool.title}：${this.flatten(item)}`);
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
			lines.push(...this.resultMarkdown(this.lastResult, settings.multiSaveMode));
			await this.app.vault.create(path, lines.join("\n"));
			new Notice(t("savedNotice", { path }));
			return;
		}

		// PNG/JPG：结果卡图片（固化导出时的主题色）
		try {
			const buf = await renderResultCard({
				diceTitle: this.currentDice.title,
				rows: this.lastResult.map((r) => ({ pool: r.pool.title, values: [this.flatten(r)] })),
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

	/** 把一个 ResultItem 展平成一段文字（子池/实例递归拼接） */
	private flatten(item: ResultItem): string {
		const parts: string[] = [];
		if (item.values.length > 0) parts.push(item.values.join("，"));
		for (const sub of item.subResults) {
			const v = this.flatten(sub);
			if (v) parts.push(v);
		}
		for (const inst of item.instances) {
			const inner = inst.items.map((it) => this.flatten(it)).filter(Boolean).join("，");
			if (inner) parts.push(inner);
		}
		return parts.join("，");
	}

	/**
	 * 生成结果的 Markdown 行（方案乙·标题分层，阿麦 13:02）。
	 * 普通池沿用现有格式：`## 池名` + `- 值`；
	 * 多套实例（池引用 ×N）按设置：
	 *   - grouped（默认）：`## 池名` 下 `### 第 N 个X` + `- 子池名：值`
	 *   - blocks：每个实例一个 `## 池名（第 N 个）` 块
	 */
	private resultMarkdown(items: ResultItem[], mode: string): string[] {
		const lines: string[] = [];
		for (const item of items) {
			if (item.instances.length === 0) {
				lines.push(`## ${item.pool.title}`);
				if (item.values.length > 0) lines.push(`- ${item.values.join("，")}`);
				for (const sub of item.subResults) {
					lines.push(`- ${sub.pool.title}：${this.flatten(sub)}`);
				}
				lines.push("");
				continue;
			}
			if (mode === "blocks") {
				item.instances.forEach((inst, k) => {
					lines.push(`## ${item.pool.title}（${t("instanceOrdinal", { n: k + 1 })}）`);
					for (const sub of inst.items) {
						lines.push(`- ${sub.pool.title}：${this.flatten(sub)}`);
					}
					lines.push("");
				});
			} else {
				lines.push(`## ${item.pool.title}`);
				item.instances.forEach((inst, k) => {
					lines.push(`### ${t("instanceLabel", { n: k + 1, title: item.pool.title })}`);
					for (const sub of inst.items) {
						lines.push(`- ${sub.pool.title}：${this.flatten(sub)}`);
					}
					lines.push("");
				});
			}
		}
		return lines;
	}

	/** 写入当前笔记：默认光标所在段落之后，可切文末追加（阿麦 11:52/12:53） */
	private writeToCurrentNote(): void {
		if (!this.lastResult || !this.currentDice) return;
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) {
			new Notice(t("noActiveNote"));
			return;
		}
		const editor = view.editor;
		const lines: string[] = [`## ${this.currentDice.title}`];
		lines.push(...this.resultMarkdown(this.lastResult, this.plugin.settings.multiSaveMode));
		const block = lines.join("\n").replace(/\n+$/, "");

		const mode = this.plugin.settings.noteWriteMode;
		if (mode === "append") {
			const last = editor.lastLine();
			editor.replaceRange("\n\n" + block, { line: last, ch: editor.getLine(last).length });
		} else {
			// 光标所在段落之后：找到光标行的段落末尾
			const cur = editor.getCursor();
			const lineText = editor.getLine(cur.line);
			const atParaEnd = lineText.trim().length > 0 && cur.ch >= lineText.length;
			const insertLine = atParaEnd ? cur.line : cur.line - 1;
			const insertText = editor.getLine(insertLine);
			editor.replaceRange("\n\n" + block, { line: insertLine, ch: insertText.length });
		}
		new Notice(t("writtenToNote"));
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
