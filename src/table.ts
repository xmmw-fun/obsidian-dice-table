// 骰表解析与摇骰引擎
// 结构约定：# H1 = 骰子名；## H2 = 要摇的项（池）；"- " 条目 = 可摇出的面

export interface Pool {
	/** H2 标题文字（已剥掉 ×N 多选标记后的干净名称） */
	title: string;
	/** 该池下的所有面（横杠条目） */
	faces: string[];
	/** 一次摇几条（默认 1；`## 池 ×3` 即摇 3 条） */
	count: number;
	/** 是否允许重复（默认 false；标记「重复」/`repeat`/`r` 后为 true） */
	allowRepeat: boolean;
}

export interface Dice {
	/** H1 标题文字 */
	title: string;
	pools: Pool[];
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

	for (const rawLine of body.split(/\r?\n/)) {
		const line = rawLine.trimEnd();

		// H1：骰子名（恰好一个 #，且不是 ##）
		const h1 = line.match(/^#\s+(.+)$/);
		if (h1) {
			current = { title: h1[1].trim(), pools: [] };
			currentPool = null;
			diceList.push(current);
			continue;
		}

		// H2：池（标题尾部可带多选标记：×3 / *3 / x3 / X3，可选接「重复」/repeat/r）
		const h2 = line.match(/^##\s+(.+)$/);
		if (h2 && current) {
			const { title, count, allowRepeat } = parsePoolTitle(h2[1].trim());
			currentPool = { title, count, allowRepeat, faces: [] };
			current.pools.push(currentPool);
			continue;
		}

		// 面：横杠条目
		const face = line.match(/^[-*]\s+(.+)$/);
		if (face && currentPool) {
			currentPool.faces.push(face[1].trim());
		}
	}

	return { diceList };
}

/**
 * 解析池标题尾部的多选标记。
 * 写法（阿麦拍板）：`## 池 ×3`＝摇 3 条；兼容 `*3`、`x3`、`X3`；
 * 默认不重复；允许重复＝数字后**不空格**直接接「重复」/`repeat`/`r`（不分大小写）。
 * 例：`遗迹类型 ×3`、`战利品*3重复`、`属性 x2r`、`天气 X2repeat`。
 * 空格一律不加：`×3 重复`、`×3 repeat` 这类带空格的写法不认（防止混乱）。
 */
export function parsePoolTitle(raw: string): { title: string; count: number; allowRepeat: boolean } {
	const m = raw.match(/^(.*?)\s*[×xX*]\s*(\d+)(重复|repeat|r)\s*$|^(.*?)\s*[×xX*]\s*(\d+)\s*$/i);
	if (!m) return { title: raw, count: 1, allowRepeat: false };
	if (m[1] !== undefined) {
		return { title: m[1].trim(), count: Math.max(1, parseInt(m[2], 10)), allowRepeat: true };
	}
	return { title: (m[4] ?? "").trim(), count: Math.max(1, parseInt(m[5], 10)), allowRepeat: false };
}

/** 从单个池摇出 values（按 count；不重复时洗牌抽样，面数不足则给全部） */
export function rollPoolValues(pool: Pool): string[] {
	if (pool.faces.length === 0) return ["（该池没有可摇的条目）"];
	const n = Math.min(Math.max(1, pool.count), pool.allowRepeat ? pool.count : pool.faces.length);
	if (!pool.allowRepeat) {
		// 不重复：洗牌取前 n 条
		const idx = pool.faces.map((_, i) => i);
		for (let i = idx.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[idx[i], idx[j]] = [idx[j], idx[i]];
		}
		return idx.slice(0, n).map((i) => pool.faces[i]);
	}
	// 可重复：每次独立摇
	const out: string[] = [];
	for (let i = 0; i < n; i++) {
		out.push(pool.faces[Math.floor(Math.random() * pool.faces.length)]);
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
