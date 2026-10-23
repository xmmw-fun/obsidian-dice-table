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

export interface Face {
	/** 面的文本（已剥掉 ^N 权重标记与 -> 引用标记） */
	text: string;
	/** 权重，默认 1；`^2` 即 ×2 */
	weight: number;
	/** 链式引用目标（池名或 `文件#池名`）；为空表示普通面 */
	ref: string | null;
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
 * 解析池标题：`-> 目标` 池引用标记 ＋ `｜` 紧凑分隔 ＋ ×N 多选标记。
 * 返回干净标题与结构化信息；紧凑分隔时 faces 一并填好。
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

	const { title: cleanTitle, count, allowRepeat } = parseCountMarks(title);

	return {
		title: cleanTitle,
		faces: inlineFaces.map((s) => parseFace(s)),
		count,
		allowRepeat,
		subPools: [],
		ref,
	};
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

/** 从单个池里随机抽一条（单项重摇也用它） */
export function rollPool(pool: Pool): string {
	return rollPoolValues(pool)[0];
}

/** 从每个池里各随机抽一组，返回 [池名, 结果数组] 列表 */
export function rollDice(dice: Dice): Array<[string, string[]]> {
	const result: Array<[string, string[]]> = [];
	for (const pool of dice.pools) {
		result.push([pool.title, rollPoolValues(pool)]);
	}
	return result;
}
