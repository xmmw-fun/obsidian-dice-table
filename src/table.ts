// 骰表解析与摇骰引擎
// 结构约定（四机制分层，阿麦 2026-10-21 定稿）：
//   # H1   = 骰子（一套表；一个文件可含多套；可选列表只列 H1）
//   ## H2  = 池   （选了一套骰子，其下所有 H2 一起摇；不进可选列表）
//   ### H3 = 子池 （挂在 H2 下的次级池，只在结果里分层呈现，不单独可选）
//   - 条目 = 面
// 面可带权重：`- 条目 ^2` = 被抽中概率 ×2
// 池可带多选：`## 池 ×3` = 一次摇 3 条（默认不重复；`×3重复`/`*3r`/`X3repeat` 允许重复）
// 紧凑写法：`## 池｜面1｜面2` 或 `### 子池｜面1｜面2`（全角｜分隔，与标准写法可混用）
// 池引用（结构复用）：`## 角色 ×3 -> 属性集` —— 属性集是另一套骰子（H1），单点定义、改一处全局生效
// 链式引用（结果深化）：`- 魔法物品 -> 稀有度` —— 命中该面后继续摇指定池，结果按设置拼接
// 随机数字池（阿麦 2026-10-23 拍板，#10）：`## 力量 1~100` = 摇 1~100 随机整数（波浪号，端点含；
//   `小数N位` 指定小数位数；`×N` 一次摇 N 个且**默认不重复**，要重复加 `r`/`重复`/`repeat`）

export interface Face {
	/** 面的文本（已剥掉 ^N 权重标记与 -> 引用标记） */
	text: string;
	/** 权重，默认 1；`^2` 即 ×2 */
	weight: number;
	/** 链式引用目标（池名或 `文件#池名`）；为空表示普通面 */
	ref: string | null;
}

/** 随机数字池的区间（阿麦 2026-10-23，#10）；decimals=0 表示整数 */
export interface NumberRange {
	min: number;
	max: number;
	/** 小数位数（0＝整数）；`小数2位` 即 2 */
	decimals: number;
}

export interface Pool {
	/** H2/H3 标题文字（已剥掉 ×N 标记、-> 引用标记与紧凑分隔后的干净名称） */
	title: string;
	/** 该池下的所有面 */
	faces: Face[];
	/** 一次摇几条（默认 1；`## 池 ×3` 即摇 3 条） */
	count: number;
	/** 是否允许重复（默认 false） */
	allowRepeat: boolean;
	/** 子池（H3）；为空表示普通池 */
	subPools: Pool[];
	/** 池引用目标（`## 池 -> 目标`）；为空表示普通池 */
	ref: string | null;
	/** 随机数字池区间（`## 池 1~100`）；为空表示普通文本池 */
	numberRange: NumberRange | null;
}

export interface Dice {
	/** H1 标题文字 */
	title: string;
	pools: Pool[];
	/** 池级随机（阿麦 2026-10-22，#12/#13）：每摇随机抽 N 个池；0＝不随机（全摇） */
	randomPoolCount: number;
	/** 池级随机是否允许同一池被重复抽中（#13，`×N池重复`） */
	randomPoolRepeat: boolean;
}

/** 骰表文件解析结果 */
export interface ParsedTable {
	diceList: Dice[];
}

/**
 * 解析一份骰表 Markdown 文本。
 * 宽容处理：忽略 frontmatter（--- ... ---）、代码块内的内容不当作骰表。
 */
export function parseTable(text: string): ParsedTable {
	const diceList: Dice[] = [];

	// 去掉 frontmatter
	let body = text;
	if (body.startsWith("---")) {
		const end = body.indexOf("\n---", 3);
		if (end !== -1) body = body.slice(body.indexOf("\n", end + 1) + 1);
	}

	// 去掉代码块，避免把代码里的 # / - 当成结构
	body = body.replace(/```[\s\S]*?```/g, "");

	let current: Dice | null = null;
	let currentPool: Pool | null = null;
	/** 当前 H2 池（H3 子池要挂到它下面） */
	let currentH2: Pool | null = null;

	for (const rawLine of body.split(/\r?\n/)) {
		const line = rawLine.trimEnd();

		// H1：骰子名（恰好一个 #，且不是 ##；标题尾可带 ×N池 池级随机标记）
		const h1 = /^#\s+(?<text>.+)$/.exec(line);
		if (h1?.groups) {
			const parsed = parseDiceTitle(h1.groups.text);
			current = {
				title: parsed.title,
				pools: [],
				randomPoolCount: parsed.randomPoolCount,
				randomPoolRepeat: parsed.randomPoolRepeat,
			};
			currentPool = null;
			currentH2 = null;
			diceList.push(current);
			continue;
		}

		// H2：池（标题尾部可带 ×N 多选标记、-> 池引用标记、｜紧凑分隔）
		const h2 = /^##\s+(?<text>.+)$/.exec(line);
		if (h2?.groups && current) {
			const pool = parsePoolTitle(h2.groups.text);
			currentPool = pool;
			currentH2 = pool;
			current.pools.push(pool);
			continue;
		}

		// H3：子池（挂在当前 H2 池下；同样支持 ×N 与｜紧凑分隔）
		const h3 = /^###\s+(?<text>.+)$/.exec(line);
		if (h3?.groups && currentH2) {
			const sub = parsePoolTitle(h3.groups.text);
			currentH2.subPools.push(sub);
			currentPool = sub;
			continue;
		}

		// 面：横杠条目（尾部可带权重 ^N、-> 链式引用）
		const face = /^[-*]\s+(?<text>.+)$/.exec(line);
		if (face?.groups && currentPool) {
			currentPool.faces.push(parseFace(face.groups.text.trim()));
		}
	}

	return { diceList };
}

/**
 * 解析 H1 骰子标题：`# 场景卡 ×3` / `# 场景卡 ×3重复`（阿麦 2026-10-22 拍板，#12/#13）。
 * **语法与 H2 的 ×N 完全同一套**——用户只记一个语法：写在 H2 行＝一个池摇 N 条面，
 * 写在 H1 行＝一次摇随机 N 个池。无标记 = 每次全摇（randomPoolCount=0）。
 * 「重复」/`repeat`/`r` 允许同一池被重复抽中（不空格紧跟数字，同 H2 规则）。
 */
export function parseDiceTitle(raw: string): { title: string; randomPoolCount: number; randomPoolRepeat: boolean } {
	const m = /^(?<name>.*?)\s*[×xX*]\s*(?<n>\d+)(?<rep>重复|repeat|r)?\s*$/i.exec(raw);
	if (m?.groups) {
		return {
			title: m.groups.name.trim(),
			randomPoolCount: Math.max(1, parseInt(m.groups.n, 10)),
			randomPoolRepeat: !!m.groups.rep,
		};
	}
	return { title: raw.trim(), randomPoolCount: 0, randomPoolRepeat: false };
}

/**
 * 解析池标题：`-> 目标` 池引用标记 ＋ `｜` 紧凑分隔 ＋ 随机数字区间 ＋ ×N 多选标记。
 * 返回干净标题与结构化信息；紧凑分隔时 faces 一并填好。
 * 区间先于 ×N 提取（`## 幸运 ×5 1~100`：摘掉区间后才认得出 ×N；两者顺序不限，阿麦 10-23）。
 */
function parsePoolTitle(raw: string): Pool {
	// 先拆「标题 -> 引用目标」（目标保留原样：`[[双链]]` 由 view 层按 Obsidian 链接解析，阿麦 10-22）
	let titlePart = raw;
	let ref: string | null = null;
	const refMatch = /^(?<name>.*?)\s*->\s*(?<target>[^｜]+)$/.exec(raw);
	if (refMatch?.groups) {
		titlePart = refMatch.groups.name;
		ref = refMatch.groups.target.trim();
	}

	// 再拆「标题｜面1｜面2」紧凑写法
	let title = titlePart;
	const inlineFaces: string[] = [];
	const barIdx = titlePart.indexOf("｜");
	if (barIdx !== -1) {
		title = titlePart.slice(0, barIdx);
		for (const seg of titlePart.slice(barIdx + 1).split("｜")) {
			const s = seg.trim();
			if (s) inlineFaces.push(s);
		}
	}

	// 拆随机数字区间（阿麦 2026-10-23，#10）：`名 1~100 [小数N位]`，负数 `-10~10`
	const { title: afterRange, range } = extractNumberRange(title);
	const { title: cleanTitle, count, allowRepeat } = parseCountMarks(afterRange);

	return {
		title: cleanTitle,
		faces: inlineFaces.map((s) => parseFace(s)),
		count,
		allowRepeat,
		subPools: [],
		ref,
		numberRange: range,
	};
}

/**
 * 从标题中提取随机数字区间（阿麦 2026-10-23，#10，语法定稿）：
 * - `名 1~100`          → 整数区间，含两端
 * - `名 0.1~9.9 小数2位` → 小数，保留 2 位
 * - `名 -10~10`         → 负数区间（波浪号兼容负号，不用横杠——横杠是面的前缀）
 * - 与 `×N`/`×N重复` 可共存（`名 ×5 1~100` / `名 ×3重复 -10~10`），顺序不限
 * 不含区间时原样返回；写反（`100~1`）自动容错为小~大。
 */
function extractNumberRange(raw: string): { title: string; range: NumberRange | null } {
	const m = /(?<min>-?\d+(?:\.\d+)?)\s*~\s*(?<max>-?\d+(?:\.\d+)?)(?:\s*小数\s*(?<dec>\d+)\s*位)?/.exec(raw);
	if (!m?.groups) return { title: raw, range: null };
	const min = parseFloat(m.groups.min);
	const max = parseFloat(m.groups.max);
	if (!isFinite(min) || !isFinite(max)) return { title: raw, range: null };
	// 小数位数：显式「小数N位」优先；否则按边界自带小数点推断（阿麦 10-23 实测：写 1.00~9.00 就该出 2 位小数）
	const decimalsOf = (s: string): number => {
		const dot = s.indexOf(".");
		return dot === -1 ? 0 : s.length - dot - 1;
	};
	const auto = Math.max(decimalsOf(m.groups.min), decimalsOf(m.groups.max));
	const decimals = m.groups.dec ? Math.max(0, Math.min(10, parseInt(m.groups.dec, 10))) : auto;
	const title = (raw.slice(0, m.index) + raw.slice(m.index + m[0].length)).replace(/\s+/g, " ").trim();
	return { title, range: { min: Math.min(min, max), max: Math.max(min, max), decimals } };
}

/**
 * 解析标题尾部的 ×N 多选标记。
 * 写法（阿麦拍板）：`×3`＝摇 3 条；兼容 `*3`、`x3`、`X3`；
 * 默认不重复；允许重复＝数字后**不空格**直接接「重复」/`repeat`/`r`（不分大小写）。
 * 空格一律不加：`×3 重复`、`×3 repeat` 这类带空格的写法不认（防止混乱）。
 */
function parseCountMarks(raw: string): { title: string; count: number; allowRepeat: boolean } {
	const repeat = /^(?<name>.*?)\s*[×xX*]\s*(?<n>\d+)(?:重复|repeat|r)\s*$/i.exec(raw);
	if (repeat?.groups) {
		return {
			title: repeat.groups.name.trim(),
			count: Math.max(1, parseInt(repeat.groups.n, 10)),
			allowRepeat: true,
		};
	}
	const plain = /^(?<name>.*?)\s*[×xX*]\s*(?<n>\d+)\s*$/.exec(raw);
	if (plain?.groups) {
		return { title: plain.groups.name.trim(), count: Math.max(1, parseInt(plain.groups.n, 10)), allowRepeat: false };
	}
	return { title: raw, count: 1, allowRepeat: false };
}

/** 解析面：`^N` 权重标记 ＋ `-> 目标` 链式引用标记（目标保留原样，`[[双链]]` 交 view 层解析） */
export function parseFace(raw: string): Face {
	let text = raw;
	let ref: string | null = null;
	const refMatch = /^(?<name>.*?)\s*->\s*(?<target>.+)$/.exec(raw);
	if (refMatch?.groups) {
		text = refMatch.groups.name;
		ref = refMatch.groups.target.trim();
	}
	const m = /^(?<name>.+?)\s*\^(?<n>\d+)$/.exec(text);
	if (!m?.groups) return { text: text.trim(), weight: 1, ref };
	return { text: m.groups.name.trim(), weight: Math.max(1, parseInt(m.groups.n, 10)), ref };
}

/** 收集一套骰子里的全部引用目标（池引用＋面级链式，含子池递归；供索引期定位 [[ ]] 外部文件，阿麦 10-22 #11b） */
export function collectRefTargets(dice: Dice): string[] {
	const out: string[] = [];
	const walkPool = (p: Pool): void => {
		if (p.ref) out.push(p.ref);
		for (const f of p.faces) if (f.ref) out.push(f.ref);
		for (const s of p.subPools) walkPool(s);
	};
	for (const p of dice.pools) walkPool(p);
	return out;
}

/** 剥掉引用目标两侧的 Obsidian 双链括号：`[[文件夹/文件#名]]` → `文件夹/文件#名`；非双链原样返回 */
export function stripLinkBrackets(raw: string): string {
	const m = /^\[\[(?<inner>.+)\]\]$/.exec(raw.trim());
	return m?.groups ? m.groups.inner.trim() : raw;
}

/**
 * 提取 Markdown 链接 `[显示文本](路径)` 的路径部分（阿麦 2026-10-23，#11-c）；
 * 非 md 链接返回 null。路径做 URL 解码（Obsidian 生成的 md 链接把空格编码成 %20）。
 */
export function extractLinkPath(raw: string): string | null {
	const m = /^\[(?<text>[^\]]*)\]\((?<path>[^)]+)\)$/.exec(raw.trim());
	if (!m?.groups) return null;
	const p = m.groups.path.trim();
	try {
		return decodeURIComponent(p);
	} catch {
		return p; // 畸形百分号编码保留原样
	}
}

/**
 * 把链接路径规范成库内相对路径（阿麦 2026-10-23：Obsidian 三种双链形式全支持）：
 * - 最短链   `[[文件]]`            → `文件`
 * - 库内路径 `[[文件夹/文件]]`      → `文件夹/文件`（vault 根起算）
 * - 绝对形式 `[[/文件夹/文件]]`     → 剥前导斜杠 → `文件夹/文件`
 * - 相对形式 `[[../文件夹/文件]]`   → 基于 basePath（引用方所在文件）目录解析
 *             `[[./文件]]`         → 同上
 * 相对形式若无 basePath（不知从哪相对）则按库内路径处理。
 */
export function resolveVaultPath(rawPath: string, basePath: string | null): string {
	const p = rawPath.trim().replace(/^\/+/, ""); // 绝对形式：剥前导斜杠
	if (!p.startsWith(".")) return p; // 纯名或库内路径，直接用
	// 相对形式（. / .. 开头）：与 base 目录拼段后逐段消化
	const baseDir = basePath ? basePath.split("/").slice(0, -1) : [];
	const out: string[] = [];
	for (const seg of [...baseDir, ...p.split("/")]) {
		if (!seg || seg === ".") continue;
		if (seg === "..") {
			out.pop();
			continue;
		}
		out.push(seg);
	}
	return out.join("/");
}

/**
 * 生成链接路径的全部候选解释（阿麦 2026-10-23 重修：一个链接文本在 Obsidian 里有三种语义，
 * 17:35 版只试了「vault 绝对路径」一种，导致库内路径/相对/绝对三种形式全落空——实测复现）：
 * 1. **vault 绝对路径**（剥前导 `/`；`../`/`./` 基于 basePath 解析成 vault 路径）；
 * 2. **当前目录拼接**——Obsidian「相对路径」格式在目标位于引用方同目录/子目录时省略 `./` 前缀，
 *    文本与绝对路径一模一样（`[[子文件夹/文件]]`），但语义基于引用方所在目录；
 * 3. **纯名 basename**——最短链 `[[文件]]`（全库同名定位由 Obsidian 的链接解析兜底）。
 * 调用方按顺序逐个试，命中即用。
 */
export function linkCandidates(rawPath: string, basePath: string | null): string[] {
	// 剥掉 Obsidian 链接的「|别名」尾巴与「#锚点」（阿麦 10-23 实测：自动补全生成 [[完整路径|别名]] 形式，此前没拆导致全落空；
	// 真实调用链上游已拆，这里再拆一层作防御——本函数也可能被直接喂原始链接文本）
	const p = rawPath.trim().replace(/^\/+/, "").split("|")[0].split("#")[0].trim();
	const out: string[] = [];
	const push = (v: string): void => {
		if (v && !out.includes(v)) out.push(v);
	};
	push(resolveVaultPath(p, basePath)); // 1) vault 绝对/显式相对（../ 已基于 base 解析）
	push(resolveVaultPath(`./${p}`, basePath)); // 2) 当前目录拼接（省略 ./ 的裸相对形态）
	const base = p.split("/").pop();
	if (base) push(base); // 3) 纯名
	return out;
}

/** 按权重随机挑一个下标（cumulative picking） */
function weightedIndex(weights: number[]): number {
	const total = weights.reduce((a, b) => a + b, 0);
	let r = Math.random() * total;
	for (let i = 0; i < weights.length; i++) {
		r -= weights[i];
		if (r < 0) return i;
	}
	return weights.length - 1;
}

/** 从单个池里摇出 values（按 count；不重复时按权重不放回抽样，面数不足则给全部） */
export function rollPoolValues(pool: Pool): string[] {
	if (pool.faces.length === 0) return ["（该池没有可摇的条目）"];
	const n = Math.min(Math.max(1, pool.count), pool.allowRepeat ? pool.count : pool.faces.length);
	if (!pool.allowRepeat) {
		// 不重复：加权不放回抽样（逐次按权重抽、抽中即移除）
		const items = pool.faces.map((f, i) => ({ i, w: f.weight }));
		const picked: string[] = [];
		for (let k = 0; k < n; k++) {
			const idx = weightedIndex(items.map((it) => it.w));
			picked.push(pool.faces[items[idx].i].text);
			items.splice(idx, 1);
		}
		return picked;
	}
	// 可重复：每次独立按权重摇
	const out: string[] = [];
	for (let i = 0; i < n; i++) {
		out.push(pool.faces[weightedIndex(pool.faces.map((f) => f.weight))].text);
	}
	return out;
}

/**
 * 摇随机数字池（阿麦 2026-10-23，#10，语法定稿）：
 * - 整数含两端；小数 toFixed(decimals)（保留指定位数，含尾零如 0.50）；
 * - 默认不重复：区间内不放回抽样；N ≥ 可能取值个数时给全部（对齐 ×N 面不足行为）；
 * - allowRepeat：每次独立摇；
 * - 小数不重复用拒绝采样（区间连续，重复概率低），尝试上限 count×1000 后转独立摇兜底。
 */
export function rollNumberRange(range: NumberRange, count: number, allowRepeat: boolean): string[] {
	const n = Math.max(1, count);
	const fmt = (v: number): string => (range.decimals > 0 ? v.toFixed(range.decimals) : String(Math.round(v)));
	const draw = (): string => fmt(range.min + Math.random() * (range.max - range.min));
	if (allowRepeat) {
		const out: string[] = [];
		for (let i = 0; i < n; i++) out.push(draw());
		return out;
	}
	if (range.decimals === 0) {
		const span = range.max - range.min + 1; // 整数可能取值个数
		if (n >= span) {
			// 超出可能值个数：给全部（不报错，对齐 ×N 面不足时「给全部」）
			const all: string[] = [];
			for (let v = range.min; v <= range.max; v++) all.push(String(v));
			return all;
		}
		const pool: number[] = [];
		for (let v = range.min; v <= range.max; v++) pool.push(v);
		const out: string[] = [];
		for (let k = 0; k < n; k++) {
			const j = Math.floor(Math.random() * pool.length);
			out.push(String(pool[j]));
			pool.splice(j, 1);
		}
		return out;
	}
	// 小数不放回：拒绝采样
	const out: string[] = [];
	const seen = new Set<string>();
	let guard = 0;
	while (out.length < n && guard < n * 1000) {
		guard++;
		const s = draw();
		if (!seen.has(s)) {
			seen.add(s);
			out.push(s);
		}
	}
	while (out.length < n) out.push(draw()); // 极端窄区间兜底
	return out;
}

/** 从单个池里随机抽一条（单项重摇也用它） */
export function rollPool(pool: Pool): string {
	return pool.numberRange
		? rollNumberRange(pool.numberRange, pool.count, pool.allowRepeat)[0]
		: rollPoolValues(pool)[0];
}

/** 从每个池里各随机抽一组，返回 [池名, 结果数组] 列表 */
export function rollDice(dice: Dice): Array<[string, string[]]> {
	const result: Array<[string, string[]]> = [];
	for (const pool of dice.pools) {
		result.push([
			pool.title,
			pool.numberRange ? rollNumberRange(pool.numberRange, pool.count, pool.allowRepeat) : rollPoolValues(pool),
		]);
	}
	return result;
}
