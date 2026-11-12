import { ItemView, Menu, Notice, WorkspaceLeaf, TFolder, TFile, MarkdownView, setIcon, setTooltip } from "obsidian";
import type DiceTablePlugin from "./main";
import { parseTable, collectRefTargets, allPoolsDeep, Dice, Pool, linkCandidates, extractLinkPath } from "./table";
import { rollPoolFull, rollDiceFull, RefResolver, ResultItem, ChainFormat, defaultResolvePool, HistoryEntry, flattenItem, applyPlaceholders, createRollContext } from "./result";
import { resultTextLines, imageRows, resultMarkdownLines } from "./result-format";
import { renderNameTemplate, resolveUniquePath, sanitizeFilename, paragraphEndLine } from "./save";
import { renderResultCard } from "./image-export";
import { ensureFolder } from "./settings";
import { FolderPathModal } from "./path-modal";
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

/** 库内全部骰子的索引（池引用/链式引用用；按文件路径缓存） */
interface DiceSource {
	path: string;
	dice: Dice[];
}

export class DiceTableView extends ItemView {
	plugin: DiceTablePlugin;

	// 当前选中的骰子文件、文件内的骰子列表与选中索引
	private tableFiles: string[] = [];
	private currentFile: string | null = null;
	private diceList: Dice[] = [];
	private diceIndex = 0;
	private currentDice: Dice | null = null;
	// 库内全部骰子索引（供池引用/链式引用跨文件解析；含当前文件）
	private diceSources: DiceSource[] = [];
	// 摇出的一组结果
	private lastResult: ResultItem[] | null = null;
	// 摇骰历史（持久化：阿麦 2026-10-23 补——直接挂 settings.history 引用，push/shift 后防抖落盘，重启 Obsidian 后仍在）
	private history: HistoryEntry[] = [];

	// 历史落盘防抖计时器
	private historySaveTimer: number | null = null;

	// 最近一次激活的笔记视图（写入笔记用：骰子面板在前台时 getActiveViewOfType 会返回 null，阿麦 10-30）
	private lastMarkdownView: MarkdownView | null = null;

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
		// 监听库内文件变化：新建/删除/改名骰子后自动刷新列表，无需重启插件；
		// 改内容也刷新（阿麦 10-22：改完 H1/池内容切回界面，马上用新解析——此前只听新建/删除/改名，改了没反应）
		this.registerEvent(this.app.vault.on("create", () => this.scheduleRefresh()));
		this.registerEvent(this.app.vault.on("delete", () => this.scheduleRefresh()));
		this.registerEvent(this.app.vault.on("rename", () => this.scheduleRefresh()));
		this.registerEvent(this.app.vault.on("modify", (file) => {
			// 只盯骰子文件夹内的 .md 改动（写别的笔记保存不触发重扫）
			if (!(file instanceof TFile)) return;
			const folder = this.plugin.settings.diceFolder.replace(/^\/+|\/+$/g, "");
			if (folder && !file.path.startsWith(`${folder}/`)) return;
			this.scheduleRefresh();
		}));

		// 记住最近激活的笔记：骰子面板自己在前台时，写入笔记要回退到它（否则只会提示「没有打开的笔记」）
		const rememberNote = (): void => {
			const v = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (v?.file) this.lastMarkdownView = v;
		};
		this.registerEvent(this.app.workspace.on("active-leaf-change", rememberNote));
		rememberNote();

		await this.refreshTableList();
		// 历史持久化（阿麦 2026-10-23）：直接挂 settings.history 引用——增删即改设置对象，防抖落盘
		this.history = this.plugin.settings.history;
		this.render();
	}

	onClose(): Promise<void> {
		if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
		if (this.historySaveTimer !== null) {
			window.clearTimeout(this.historySaveTimer);
			void this.plugin.saveSettings(); // 关闭前把未落盘的历史补写
		}
		this.contentEl.empty();
		return Promise.resolve();
	}

	/** 历史变更后防抖落盘（连续摇骰只写最后一次，避免狂点卡顿） */
	private scheduleHistorySave(): void {
		if (this.historySaveTimer !== null) window.clearTimeout(this.historySaveTimer);
		this.historySaveTimer = window.setTimeout(() => {
			this.historySaveTimer = null;
			void this.plugin.saveSettings();
		}, 300);
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

	/** 设置变更（如更换骰子路径）后由 main 调用：重扫列表与索引并重渲染（O1，阿麦 10-22） */
	async refreshAll(): Promise<void> {
		await this.refreshTableList();
		this.render();
	}

	/** 扫描设置的骰子文件夹，列出所有 .md */
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
	 * 刷新库内全部骰子索引（池引用/链式引用用）。
	 * 只读骰子文件夹内的 .md；解析失败的文件跳过，不影响主流程。
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
		// 增量：把 [[ ]] 双链指向骰子文件夹之外的文件也读进索引（阿麦 10-22，#11b；
		// 被引文件自己的引用再展开一轮，深度上限 5 防意外递归）
	const loaded = new Set(sources.map((s) => s.path));
	// 定位被引文件（阿麦 2026-10-23 重修）：一个链接文本三种语义（vault 绝对/当前目录相对/纯名），
	// 按 linkCandidates 候选顺序逐个试，最后走 Obsidian 自己的链接解析兜底
	const locate = (p: string, basePath: string | null): TFile | null => {
		for (const c of linkCandidates(p, basePath)) {
			const withExt = c.endsWith(".md") ? c : `${c}.md`;
			const direct = this.app.vault.getAbstractFileByPath(withExt);
			if (direct instanceof TFile) return direct;
		}
		const byLink = this.app.metadataCache.getFirstLinkpathDest(p, basePath ?? "");
		return byLink instanceof TFile ? byLink : null;
	};
		for (let round = 0; round < 5; round++) {
			const pending = new Set<string>();
			for (const src of sources) {
				for (const ref of src.dice.flatMap((d) => collectRefTargets(d))) {
					// 只有显式链接写法才跨文件增量加载（阿麦 2026-11-12 收紧）：
					// 双链 [[X#名]] 取括号内 # 前部分（先剥「|别名」）；md 链接 [text](path) 取 path（阿麦 10-23）；
					// 裸写法（X#Y、裸路径、纯裸名）一律不加载——它们只在当前文档解析，无需外部文件
					const wiki = /^\[\[(?<inner>.+)\]\]$/.exec(ref.trim());
					let filePart: string | null = null;
					if (wiki?.groups) {
						filePart = wiki.groups.inner.trim().split("|")[0].trim().split("#")[0];
					} else {
						const mdPath = extractLinkPath(ref);
						if (mdPath === null) continue;
						filePart = mdPath.split("#")[0];
					}
					if (!filePart) continue;
					const file = locate(filePart, src.path);
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
 * 构造引用解析器（阿麦 2026-10-22 定、10-23 20:47 修订、11-12 收紧跨文件语义）：
 * - **只有显式链接（`[[ ]]` 双链 / `[]()` md 链接）可以跨文件**；
 * - 双链 `[[X#名]]`（含 `|别名`）/ md 链接 `[显示](路径#锚点)` → 按链接定位（三种语义候选＋Obsidian 兜底）；
 *   `[[#池名]]` / `[显示](#池名)` → 当前文档的池；
 * - 裸名（`-> 种族库`）、`X#Y`、裸路径（`-> 文件夹/文件#名`，不带方括号）→ **一律只当前文档**
 *   （裸路径忽略路径部分，只取末段同名 H1）。
 */
private makeResolver(): RefResolver {
	const sources = this.diceSources;
	const curPath = this.currentFile;

	/** 按链接文本定位库内 .md 文件（阿麦 2026-10-23 重修：三种语义候选依次试，Obsidian 链接解析兜底） */
	const locateFile = (pathOrName: string): TFile | null => {
		for (const c of linkCandidates(pathOrName, curPath)) {
			const withExt = c.endsWith(".md") ? c : `${c}.md`;
			const direct = this.app.vault.getAbstractFileByPath(withExt);
			if (direct instanceof TFile) return direct;
		}
		const byLink = this.app.metadataCache.getFirstLinkpathDest(pathOrName, curPath ?? "");
		return byLink instanceof TFile ? byLink : null;
	};

	/** 双链目标 `[[X#名]]`：拆出文件部分与 #名；先剥「|别名」尾巴（阿麦 10-23 实测：Obsidian 自动补全带别名） */
	const parseLink = (target: string): { filePart: string; name: string | null } | null => {
		const m = /^\[\[(?<inner>.+)\]\]$/.exec(target.trim());
		if (!m?.groups) return null;
		const inner = m.groups.inner.trim().split("|")[0].trim();
		const hash = inner.indexOf("#");
		return { filePart: hash === -1 ? inner : inner.slice(0, hash), name: hash === -1 ? null : inner.slice(hash + 1) };
	};

	/** md 链接目标 `[显示](路径[#锚点])`：拆出文件部分与 #名（阿麦 10-23，#11-c；路径已 URL 解码） */
	const parseMdLink = (target: string): { filePart: string; name: string | null } | null => {
		const p = extractLinkPath(target);
		if (p === null) return null;
		const hash = p.indexOf("#");
		return { filePart: hash === -1 ? p : p.slice(0, hash), name: hash === -1 ? null : p.slice(hash + 1) };
	};

	const findDice = (target: string): Dice | null => {
		// 双链 [[...]] 或 md 链接 [...](...) 形式：定位文件后在文件内找（不带 #名则找同名 H1、再退第一个）
		const link = parseLink(target) ?? parseMdLink(target);
		if (link) {
			// [[#池名]] / [文本](#池名)：是「当前文档的池」，不是骰子 → 返回 null 交给 findPool
			if (!link.filePart) return null;
			const file = locateFile(link.filePart);
			const src = file ? sources.find((s) => s.path === file.path) : undefined;
			if (!src) return null;
			if (link.name) return src.dice.find((d) => d.title === link.name) ?? null;
			const linkText = link.filePart.split("/").pop()!;
			return src.dice.find((d) => d.title === linkText) ?? src.dice[0] ?? null;
		}
		const { path, name } = splitTarget(target);
		// 裸路径降级（不带方括号但含 / 或 .md）：忽略路径部分，只在当前文档找末段同名 H1；
		// 带 #池名的是池引用 → 返回 null 交给 findPool（阿麦 2026-11-12 收紧）
		if (path) {
			if (name) return null;
			const base = path.split("/").pop()!.replace(/\.md$/, "");
			const cur = sources.find((s) => s.path === curPath);
			return cur?.dice.find((d) => d.title === base) ?? null;
		}
		// X#Y（不带方括号、不含 / 或 .md）：池引用 → 返回 null 交给 findPool——
		// 否则 `## 池 -> X#Y` 会误展开当前文档 H1「Y」的整套骰子（阿麦 2026-11-12 收紧）
		if (name) return null;
		// 裸名（老写法）：**仅限当前文档内的 H1**（行为不变）
		const cur = sources.find((s) => s.path === curPath);
		return cur?.dice.find((x) => x.title === target) ?? null;
	};
	/** 当前文档内按池名找池：跳过 ref 指向目标自身的池（防自引用无限递归），都自引用时回落第一个 */
	const findLocalPool = (poolName: string | null): Pool | null => {
		if (!poolName) return null;
		const cur = sources.find((s) => s.path === curPath);
		if (!cur) return null;
		const pools = allPoolsDeep(cur.dice).filter((x) => x.title === poolName);
		// 阿麦 2026-11-12 修复：裸名取第一个同名池时，跳过「ref 指向自身标题」的引用池——
		// 否则 `## 性格 -> 性格` 命中自己，rollPoolFull 的 ref 分支再解析 ref 又命中同一个池，
		// 无限递归到 MAX_DEPTH 退回空值（stack 防护在 ref 分支不生效，add 晚于递归）
		return pools.find((x) => !(x.ref && x.ref === poolName)) ?? pools[0] ?? null;
	};

	/**
	 * 池查找（阿麦 2026-11-12 收紧跨文件语义：只有显式链接可跨文件）：
	 * - [[...]] / [...](...)：按链接定位（可跨文件）；[[#池名]] / [文本](#池名) → 当前文档的池；
	 * - 裸路径（不带方括号但含 / 或 .md）→ 降级为当前文档：忽略路径，只在当前文档找末段同名 H1 的池；
	 * - X#Y（不带方括号、不含 / 或 .md）→ 只当前文档：当前文档 H1「X」下找池「Y」；
	 * - 纯裸名 → 只当前文档。
	 */
	const findPool = (target: string): Pool | null => {
		const link = parseLink(target) ?? parseMdLink(target);
		if (link) {
			// [[#池名]] / [文本](#池名)：只写 # 不带文件名 → 当前文档的池（旧实现误取 "[[" 作文件名）
			if (!link.filePart) return findLocalPool(link.name);
			// [[文件#池]] / [文本](路径#池)：按链接定位（跨文件，行为不变）
			const file = locateFile(link.filePart);
			const src = file ? sources.find((s) => s.path === file.path) : undefined;
			if (!src) return null;
			return allPoolsDeep(src.dice).find((x) => x.title === link.name) ?? null;
		}
		const { path, name } = splitTarget(target);
		// 裸路径降级（不带方括号但含 / 或 .md）：忽略路径部分，只在当前文档找末段同名 H1 的池
		if (path) {
			const base = path.split("/").pop()!.replace(/\.md$/, "");
			const cur = sources.find((s) => s.path === curPath);
			const dice = cur?.dice.find((d) => d.title === base);
			if (!dice || !name) return null;
			return allPoolsDeep([dice]).find((x) => x.title === name) ?? null;
		}
		// X#Y（不带方括号、不含 / 或 .md）：只当前文档的 H1「X」下找池「Y」
		// 阿麦 2026-11-12 收紧：移除按文件名全库匹配（旧实现会跨文件命中同名文件）
		if (name) {
			const diceName = target.split("#")[0].trim();
			const cur = sources.find((s) => s.path === curPath);
			const dice = cur?.dice.find((d) => d.title === diceName);
			if (!dice) return null;
			return allPoolsDeep([dice]).find((x) => x.title === name) ?? null;
		}
		// 纯裸名池：**仅限当前文档**（行为不变）
		return findLocalPool(target);
	};
	// 解析失败收集（阿麦 10-23：摇完统一提示，避免用户不知道引用没生效）
	const missed: string[] = [];
	return {
		resolveDice: findDice,
		resolvePool: (t) => defaultResolvePool(t, findPool, findDice),
		onMiss: (target) => {
			if (!missed.includes(target)) missed.push(target);
		},
		missed,
	};
}

	/**
	 * 本套骰子里「被引用且目标就是本骰子的池」的池名（方案 A 隐藏用）。
	 * 阿麦 2026-11-12 修复：旧实现按「引用名是否在本骰子池名中」判断，裸名歧义下会误判
	 * （如 `## 性格 -> 性格` 实际指向别处同名池，却被当成自引用隐藏）。现改为用 resolver
	 * 精确解析引用目标，只有解析到的池**确实是本骰子的池对象**才隐藏。
	 */
	private referencedTitles(dice: Dice, resolver: RefResolver): string[] {
		const localPools = allPoolsDeep([dice]);
		const local = new Set(localPools);
		const out = new Set<string>();
		for (const ref of collectRefTargets(dice)) {
			const pool = resolver.resolvePool(ref);
			if (pool && local.has(pool)) out.add(pool.title);
		}
		return [...out];
	}

	/** 当前链式拼接格式（用户设置项） */
	private chainFormat(): ChainFormat {
		const s = this.plugin.settings;
		return { wrap: s.chainWrap, sep: s.chainSep };
	}

	private render(preserveScroll = false): void {
		const scroller = this.contentEl;
		const keepTop = preserveScroll ? scroller.scrollTop : 0;
		const root = this.contentEl;
		root.empty();
		root.addClass("dice-table-view");

		// ── 吸顶工具栏（1.6，阿麦 10-30 拍板）：摇骰 / 选表 / 打开文档 / 更多操作 ──
		// 结果长时任何位置都能摇（痛点：旧版摇骰按钮在底部要拉到底）
		const bar = root.createDiv({ cls: "dice-toolbar" });

		// 摇骰：骰子图标＋主题重点色（1.6 微调，阿麦 10-30：太不明显）；不带悬停说明（用的人都懂）
		const rollBtn = bar.createEl("button", { cls: "dice-toolbar-btn dice-toolbar-roll" });
		setIcon(rollBtn, "dices");
		rollBtn.addEventListener("click", () => this.onRoll());

		// 选表：只显示文件名，下拉换同文件夹其他表（「骰子：」标签已删——阿麦拍板）
		const select = bar.createEl("select", { cls: "dropdown dice-toolbar-select" });
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

		// 一键保存：Lucide 图标 + 悬停说明（阿麦 10-30 20:09 拍板：高频操作紧挨下拉，打开文档挪进 ⋮）
		const saveBtn = bar.createEl("button", { cls: "dice-toolbar-btn clickable-icon" });
		setIcon(saveBtn, "save");
		setTooltip(saveBtn, t("saveBtn"));
		saveBtn.disabled = !this.lastResult;
		saveBtn.addEventListener("click", () => void this.onSave());

		// 更多操作：Obsidian 原生 Menu 收拢低频功能（阿麦拍板：非自制抽屉）
		const moreBtn = bar.createEl("button", { cls: "dice-toolbar-btn clickable-icon" });
		setIcon(moreBtn, "more-vertical");
		setTooltip(moreBtn, t("moreMenu"));
		moreBtn.addEventListener("click", (e) => this.openMoreMenu(e));

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
				this.renderResultItem(resultBox, this.lastResult[i], 0);
			}
		} else {
			resultBox.createEl("p", { text: t("emptyResult"), cls: "dice-result-empty" });
		}

		// ── 历史区 ──
		this.renderHistory(root);

		// 单项重摇后保持滚动位置（阿麦 10-30：点深处 ↻ 不再跳回顶部）
		if (preserveScroll) scroller.scrollTop = keepTop;
	}

	/** ⋮ 更多操作菜单（1.6，阿麦 10-30 拍板）：Obsidian 原生 Menu，低频功能收拢不占屏 */
	private openMoreMenu(evt: MouseEvent): void {
		const has = !!this.lastResult;
		const menu = new Menu();
		menu.addItem((mi) =>
			mi.setTitle(t("copyBtn")).setIcon("copy").setDisabled(!has).onClick(() => void this.onCopy())
		);
		menu.addItem((mi) =>
			mi.setTitle(t("writeNoteBtn")).setIcon("file-input").setDisabled(!has).onClick(() => this.writeToCurrentNote())
		);
		menu.addSeparator();
		// 打开文档入菜单（阿麦 10-30 20:09 拍板：高频的保存上工具栏，低频的进 ⋮）
		menu.addItem((mi) =>
			mi.setTitle(t("openTableBtn")).setIcon("file-text").setDisabled(!this.currentFile).onClick(() => this.openTableFile())
		);
		menu.addItem((mi) =>
			mi.setTitle(t("changeFolderMenu")).setIcon("folder-open").onClick(() => {
				new FolderPathModal(this.app, this.plugin).open();
			})
		);
		menu.showAtMouseEvent(evt);
	}

	/**
	 * 渲染一个池的结果：普通值一行；子池另起一行、按深度递进缩进；
	 * 有多套实例则按「第 N 个X」分组（阿麦 12:30/13:02 定稿）。
	 * 1.6.0（阿麦 10-30 纠正）：**每一项（含任意层级的子项）都能单独重摇**——旧实现给子项传
	 * index=-1 被守卫挡掉，按钮点了没反应；现改成按结果树里的对象引用就地重摇，层级不限。
	 */
	private renderResultItem(container: HTMLElement, item: ResultItem, depth: number, isSub = false): void {
		const title =
			!isSub && item.instances.length > 1
				? t("instanceGroup", { title: item.pool.title, n: item.instances.length })
				: item.pool.title;
		const row = container.createDiv({ cls: `dice-result-row dice-depth-${Math.min(depth, 8)}` });
		row.createSpan({ text: title, cls: "dice-result-pool" });
		if (item.values.length > 0) {
			row.createSpan({ text: item.values.join("，"), cls: "dice-result-value" });
		} else if (item.values.length === 0 && item.subResults.length === 0 && item.instances.length === 0) {
			row.createSpan({ text: "（空）", cls: "dice-result-value dice-result-value-empty" });
		}
		// 每一项都能单独重摇（含子项、含实例里的项）
		const reroll = row.createEl("button");
		reroll.textContent = "↻";
		reroll.addClass("dice-reroll");
		reroll.setAttribute("aria-label", t("rerollAria", { pool: item.pool.title }));
		reroll.addEventListener("click", () => this.onRerollItem(item));

		// 子池：另起一行，深度 +1
		for (const sub of item.subResults) {
			this.renderResultItem(container, sub, depth + 1, true);
		}

		// 多套实例：小标题（深度 +1）＋每套的子结果（深度 +2）；小标题自带 ↻＝只重摇这一套
		if (item.instances.length > 0) {
			item.instances.forEach((inst, k) => {
				const head = container.createDiv({ cls: `dice-instance-head dice-depth-${Math.min(depth + 1, 8)}` });
				head.setText(t("instanceLabel", { n: k + 1, title: item.pool.title }));
				const instBtn = head.createEl("button", { cls: "dice-reroll", text: "↻" });
				instBtn.setAttribute("aria-label", t("rerollInstanceAria", { n: k + 1, title: item.pool.title }));
				instBtn.addEventListener("click", () => this.onRerollInstance(item, k));
				for (const sub of inst.items) this.renderResultItem(container, sub, depth + 2, true);
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
			// 摘要用 flattenItem 展开（多套实例/子池的 values 本身是空的，原来只取 values 会显示空白）
			row.createSpan({
				text: `${entry.diceTitle} · ${entry.items
					.map((it) => `${it.pool.title}：${flattenItem(it)}`)
					.filter((s) => !s.endsWith("："))
					.join(" / ")}`,
				cls: "dice-history-text",
			});
			const load = row.createEl("button");
			load.textContent = t("historyLoad");
			load.addClass("dice-history-load");
			load.setAttribute("aria-label", t("historyLoadAria"));
			load.addEventListener("click", () => {
				// 载入的是快照的副本（否则后续重摇会改到历史本身）
				this.lastResult = this.cloneItems(entry.items);
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
	 * 打开当前骰子文档（阿麦 2026-10-22：点一下直接开文件，改池子不用回库翻）。
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
		this.lastResult = rollDiceFull(this.currentDice, resolver, fmt, {
			showReferencedPools: this.plugin.settings.showReferencedPools,
			hideTitles: this.referencedTitles(this.currentDice, resolver),
		});
		this.noteMissed(resolver);
		this.pushHistory();
		this.render();
	}

	/** 深拷贝结果树：历史必须是快照，不能与当前结果共用对象（阿麦 10-30 实测：重摇会改掉历史） */
	private cloneItems(items: ResultItem[]): ResultItem[] {
		return typeof structuredClone === "function"
			? structuredClone(items)
			: (JSON.parse(JSON.stringify(items)) as ResultItem[]);
	}

	/** 记一条历史（整组快照）：整体摇骰与单条重摇都会调它（阿麦 10-30：单条重摇也要能载入） */
	private pushHistory(): void {
		if (!this.currentDice || !this.lastResult) return;
		this.history.push({
			diceTitle: this.currentDice.title,
			items: this.cloneItems(this.lastResult),
			time: new Date(),
		});
		if (this.history.length > 20) this.history.shift();
		this.scheduleHistorySave();
	}

	/** 摇骰后有引用没解析到时提示（阿麦 10-23：写错链接要让人知道，别静默出空结果） */
	private noteMissed(resolver: RefResolver): void {
		const missed = resolver.missed;
		if (!missed || missed.length === 0) return;
		new Notice(`${t("refMissNotice")}\n${missed.map((m) => `· ${m}`).join("\n")}`, 8000);
	}

	/** 单项单独重摇：只重摇该项（含其子池与实例整组重摇），其余项不动 */
	/**
	 * 单项重摇（2026-10-30 修复：任意层级都能重摇）。
	 * 直接改结果树里的那个对象——对象引用就是定位，不必再算顶层下标；
	 * 子项/实例内的项重摇只动它自己，同层其它项保持不动。
	 */
	private onRerollItem(item: ResultItem): void {
		const resolver = this.makeResolver();
		const fmt = this.chainFormat();
		const ctx = createRollContext(resolver, fmt);
		const fresh = rollPoolFull(item.pool, resolver, fmt, 0, ctx);
		// 补填占位符（阿麦 10-30 实测：重摇后 {颜色} 会原样露出）；一次重摇＝一个单元
		applyPlaceholders([fresh], ctx);
		item.values = fresh.values;
		item.subResults = fresh.subResults;
		item.instances = fresh.instances;
		this.noteMissed(resolver);
		this.pushHistory(); // 单条重摇也记一条历史（阿麦 10-30：否则载入不到）
		this.render(true); // 保持滚动位置
	}

	/**
	 * 实例级重摇（阿麦 10-30）：只重摇「第 N 个X」这一套，其他套不动。
	 * 有池引用：按引用重新解析目标骰子，重生成这一套的 items；
	 * 无引用兜底：逐个重摇这一套里的子项（共用同一个填词 cache，保证同名同词）。
	 */
	private onRerollInstance(item: ResultItem, k: number): void {
		const inst = item.instances[k];
		if (!inst) return;
		const resolver = this.makeResolver();
		const fmt = this.chainFormat();
		const ctx = createRollContext(resolver, fmt);
		const targetDice = item.pool.ref ? resolver.resolveDice(item.pool.ref) : null;
		let items: ResultItem[];
		if (targetDice) {
			items = targetDice.pools.map((p) => rollPoolFull(p, resolver, fmt, 1, ctx));
			applyPlaceholders(items, ctx);
		} else {
			items = inst.items.map((sub) => {
				const fresh = rollPoolFull(sub.pool, resolver, fmt, 0, ctx);
				applyPlaceholders([fresh], ctx);
				return fresh;
			});
		}
		item.instances[k] = { index: inst.index, items };
		this.noteMissed(resolver);
		this.pushHistory();
		this.render(true);
	}

	/** 复制当前结果为文字进剪贴板（2026-10-30 修复：实例/子池不再压扁，池名保留） */
	private async onCopy(): Promise<void> {
		if (!this.lastResult || !this.currentDice) return;
		const lines: string[] = [`# ${this.currentDice.title}`, ...resultTextLines(this.lastResult)];
		try {
			await navigator.clipboard.writeText(lines.join("\n"));
			new Notice(t("copiedNotice"));
		} catch (e) {
			new Notice(t("copyFailNotice", { msg: e instanceof Error ? e.message : String(e) }));
		}
	}

	/** 结果的 Markdown 小节（新文件正文 / 追加段落共用；2026-10-30 修复：与复制共用同一结构化输出） */
	private resultSection(now: Date): string {
		if (!this.lastResult) return "";
		const pad = (v: number) => String(v).padStart(2, "0");
		const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
		const lines: string[] = [`## ${stamp}`, ...resultTextLines(this.lastResult)];
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
			lines.push(...resultMarkdownLines(this.lastResult, settings.multiSaveMode));
			await this.app.vault.create(path, lines.join("\n"));
			new Notice(t("savedNotice", { path }));
			return;
		}

		// PNG/JPG：结果卡图片（固化导出时的主题色）
		try {
			const buf = await renderResultCard({
				diceTitle: this.currentDice.title,
				rows: imageRows(this.lastResult),
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

	/** 选写入目标：激活的笔记 → 最近激活过的 → 任意已打开的笔记（骰子面板在前台也能写） */
	private pickNoteView(): MarkdownView | null {
		const active = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (active?.file) return active;
		if (this.lastMarkdownView?.file) return this.lastMarkdownView;
		let fallback: MarkdownView | null = null;
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (!fallback && leaf.view instanceof MarkdownView && leaf.view.file) fallback = leaf.view;
		});
		return fallback;
	}

	/** 写入当前笔记：默认光标所在段落之后，可切文末追加（阿麦 11:52/12:53） */
	private writeToCurrentNote(): void {
		if (!this.lastResult || !this.currentDice) return;
		// 目标笔记：当前激活的笔记 → 最近用过的笔记 → 任意已打开的笔记
		const view = this.pickNoteView();
		if (!view) {
			new Notice(t("noActiveNote"));
			return;
		}
		const editor = view.editor;
		const lines: string[] = [`## ${this.currentDice.title}`];
		lines.push(...resultMarkdownLines(this.lastResult, this.plugin.settings.multiSaveMode));
		const block = lines.join("\n").replace(/\n+$/, "");

		const mode = this.plugin.settings.noteWriteMode;
		if (mode === "append") {
			const last = editor.lastLine();
			editor.replaceRange("\n\n" + block, { line: last, ch: editor.getLine(last).length });
		} else {
			// 光标所在段落之后（阿麦 10-30 修正）：从光标行向下找到段落末行（遇空行/标题为止），
			// 插在它的末尾——不再出现「插到上一段」，也不会在第 1 行 getLine(-1) 越界
			const cur = editor.getCursor();
			const lines = editor.getValue().split(/\r?\n/);
			const endLine = paragraphEndLine(lines, cur.line);
			editor.replaceRange("\n\n" + block, { line: endLine, ch: editor.getLine(endLine).length });
		}
		new Notice(t("writtenToNote", { name: view.file?.basename ?? "" }));
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
