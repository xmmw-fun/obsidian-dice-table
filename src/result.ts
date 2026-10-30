// 结果数据结构与「池引用 + 链式引用」的解析摇骰
// 四机制分层（阿麦 2026-10-21 定稿）：
//   池引用（结构复用）：`## 角色 ×3 -> 属性集` —— 属性集是另一套骰子，单点定义
//   并行子池（H3）   ：一个池含多个子池 → 一次摇出并行多属性
//   链式引用（面级） ：命中带 `-> 目标` 的面后，继续摇目标池，结果拼接
//   紧凑写法         ：`## 池｜面1｜面2`（解析期完成，这里不涉及）
//
// 结果层级：ResultItem（一个池的结果）→ subResults（子池）→ instances（多套实例）

import { Dice, Face, Pool, rollPoolValues, rollNumberRange } from "./table";

/** 一个池摇出的结果 */
export interface ResultItem {
	/** 池的引用（保存/重摇/命名用；属性集展开时为目标池） */
	pool: Pool;
	/** 该池自身面的结果 */
	values: string[];
	/** 子池结果（H3 并行多属性） */
	subResults: ResultItem[];
	/** 多套实例（池引用 ×N 时，每套各摇一遍目标骰子的全部池） */
	instances: ResultInstance[];
}

/** 池引用的一「套」实例：目标骰子的每个池各摇一次 */
export interface ResultInstance {
	index: number;
	items: ResultItem[];
}

/** 摇骰历史条目（阿麦 2026-10-23：从会话内存升级为持久化——存 data.json，重启 Obsidian 后仍在） */
export interface HistoryEntry {
	/** 骰子名（载入时切回它的文件与骰子用） */
	diceTitle: string;
	/** 该次摇出的结果（含池结构，载入后可直接重摇/保存） */
	items: ResultItem[];
	/** 摇骰时间（JSON 序列化时为字符串，载入时规范化为 Date） */
	time: Date;
}

/** 引用解析所需的库访问能力（由 view 层注入，避免引擎依赖 Obsidian） */
export interface RefResolver {
	/** 按目标名找骰子：目标形如「属性集」「文件名#骰子名」或双链「[[文件夹/文件#骰子名]]」 */
	resolveDice(target: string): Dice | null;
	/** 按目标名找池：目标形如「稀有度」「文件名#池名」；找不到则回退为找同名骰子的全部池 */
	resolvePool(target: string): Pool | null;
	/** 引用目标没找到时回调（阿麦 10-23：解析失败要给提示，否则用户不知道引用没生效） */
	onMiss?: (target: string) => void;
	/** 本次摇骰收集到的未命中目标（view 层摇完读它弹提示；随 makeResolver 每次重建） */
	missed?: string[];
}

/**
 * 默认的池查找：先按「同名池」找，找不到就把「同名骰子」的全部池合成一个虚拟池。
 * 这样 `-> 种族库` 既能指向一个池，也能指向一整套骰子（其下所有池一起摇）。
 */
export function defaultResolvePool(target: string, findPool: (t: string) => Pool | null, findDice: (t: string) => Dice | null): Pool | null {
	const pool = findPool(target);
	if (pool) return pool;
	const dice = findDice(target);
	if (!dice) return null;
	const faces: Face[] = [];
	for (const p of dice.pools) faces.push(...p.faces);
	return { title: dice.title, faces, count: 1, allowRepeat: false, subPools: [], ref: null, numberRange: null };
}

/** 链式引用的最大递归深度（防死循环，阿麦 12:42 定 5） */
const MAX_DEPTH = 5;

/**
 * 摇一个池：含子池展开、池引用展开、链式引用解析。
 *
 * 池引用（`## 池 -> 目标`）两种形态：
 *   - 目标是**一整套骰子**（H1）→ 把目标骰子的全部池展开为**子池**（subResults）；
 *   - 目标是**单个池**（H2）→ 把该池的结果并入自身 values。
 * 若带 ×N（`## 角色 ×3 -> 属性集`）→ 每套实例各展开一遍，结果进 instances。
 */
export function rollPoolFull(pool: Pool, resolver: RefResolver, chainFmt: ChainFormat, depth = 0): ResultItem {
	if (pool.ref) {
		if (depth >= MAX_DEPTH) {
			return { pool, values: rollPoolValues(pool), subResults: [], instances: [] };
		}
		const targetDice = resolver.resolveDice(pool.ref);
		const n = Math.max(1, pool.count);

		// ×N 多实例：每套各展开一遍目标的全部池
		if (n > 1 && targetDice) {
			const instances: ResultInstance[] = [];
			for (let i = 0; i < n; i++) {
				// 每套实例＝一个占位符单元（阿麦 10-29 拍板第 3 项：CP ×2 两个角色各摇各的名字）
				const instCache = newPlaceholderCache();
				const items = targetDice.pools.map((p) => rollPoolFull(p, resolver, chainFmt, depth + 1));
				applyPlaceholders(items, resolver, instCache);
				instances.push({ index: i, items });
			}
			return { pool, values: [], subResults: [], instances };
		}

		// 单套：目标是整套骰子 → 展开为子池；否则按单池解析
		if (targetDice) {
			const instCache = newPlaceholderCache();
			const subResults = targetDice.pools.map((p) => rollPoolFull(p, resolver, chainFmt, depth + 1));
			applyPlaceholders(subResults, resolver, instCache);
			return { pool, values: [], subResults, instances: [] };
		}
		const targetPool = resolver.resolvePool(pool.ref);
		if (targetPool) {
			const instCache = newPlaceholderCache();
			const nested = rollPoolFull(targetPool, resolver, chainFmt, depth + 1);
			applyPlaceholders([nested], resolver, instCache);
			return { pool, values: nested.values.length > 0 ? nested.values : [flattenItem(nested)], subResults: nested.subResults, instances: nested.instances };
		}
		// 找不到目标：当作普通池；记一次 miss（view 层统一提示，阿麦 10-23）
		resolver.onMiss?.(pool.ref);
		return { pool, values: rollPoolValues(pool), subResults: [], instances: [] };
	}

	// 数字池（阿麦 2026-10-23，#10）：`## 池 1~100`——直接摇数字，不走面；×N 不重复/重复照常
	if (pool.numberRange) {
		return {
			pool,
			values: rollNumberRange(pool.numberRange, Math.max(1, pool.count), pool.allowRepeat),
			subResults: [],
			instances: [],
		};
	}

	// 链式引用只在面命中时解析；先摇面（带原池的 count/allowRepeat——1.3.0 曾用 dummyPool 丢失 ×N，阿麦 10-22 实测抓出）
	const values = rollFaces(pool, resolver, chainFmt, depth);

	// 子池：每个子池各摇一次（并行多属性）
	const subResults = pool.subPools.map((sub) => rollPoolFull(sub, resolver, chainFmt, depth + 1));

	return { pool, values, subResults, instances: [] };
}

/**
 * 摇一套骰子（阿麦 2026-10-22，#12/#13：H1 带 `×N池` 时每摇随机抽 N 个池）。
 *
 * 池级随机（`# 场景卡 ×3池`）：
 *   - randomPoolCount=0 → 全部池各摇一次（默认，老表行为不变）；
 *   - randomPoolCount=N → 每次只摇随机抽中的 N 个池，没抽到的池不出现在结果里；
 *   - randomPoolRepeat → 允许同一池被重复抽中（`×N池重复`）；否则 N 个池互不重复。
 * 选中的池仍走 rollPoolFull（子池/池引用/链式照常展开）。
 */
export function rollDiceFull(dice: Dice, resolver: RefResolver, chainFmt: ChainFormat): ResultItem[] {
	// 顶层摇骰＝一个占位符单元（阿麦 10-29 拍板第 3 项：单元内同名占位符只摇一次）
	const phCache = newPlaceholderCache();
	if (dice.randomPoolCount > 0 && dice.pools.length > 0) {
		const n = Math.min(
			dice.randomPoolCount,
			dice.randomPoolRepeat ? dice.randomPoolCount : dice.pools.length
		);
		const picked: Pool[] = [];
		if (dice.randomPoolRepeat) {
			for (let i = 0; i < n; i++) {
				picked.push(dice.pools[Math.floor(Math.random() * dice.pools.length)]);
			}
		} else {
			const idx = dice.pools.map((_, i) => i);
			for (let k = 0; k < n; k++) {
				const j = Math.floor(Math.random() * idx.length);
				picked.push(dice.pools[idx[j]]);
				idx.splice(j, 1);
			}
		}
		const items = picked.map((p) => rollPoolFull(p, resolver, chainFmt));
		applyPlaceholders(items, resolver, phCache);
		return items;
	}
	const items = dice.pools.map((p) => rollPoolFull(p, resolver, chainFmt));
	applyPlaceholders(items, resolver, phCache);
	return items;
}

// ---------------------------------------------------------------------------
// 词库/句子模板（阿麦 2026-10-29 拍板，1.5 规格）：面文本 `{池名}` 占位符填词
// 词库＝任何普通池（零新结构）；解析复用 resolver——裸名仅当前文档、跨文档走链接，与 `->` 同一套规矩
// 单元边界＝顶层摇骰 / 池引用的一套实例；单元内同名占位符只摇一次（cache）
// ---------------------------------------------------------------------------

/** 占位符正则：`{池名}`——内容不含花括号与换行；摇出的词里再有 {...} 不递归（单遍替换天然满足） */
const PLACEHOLDER_RE = /\{([^{}\n]+)\}/g;

/** 新建一个占位符单元的「同名＝同词」缓存 */
export function newPlaceholderCache(): Map<string, string> {
	return new Map();
}

/** 填一段文本里的全部占位符；未定义/空池 → 原样保留＋onMiss 提示（拍板第 7 项，绝不静默） */
function fillPlaceholders(text: string, resolver: RefResolver, cache: Map<string, string>): string {
	if (!text.includes("{")) return text;
	return text.replace(PLACEHOLDER_RE, (raw, inner: string) => {
		const key = inner.trim();
		if (!key) return raw;
		const hit = cache.get(key);
		if (hit !== undefined) return hit;
		const pool = resolver.resolvePool(key);
		let word: string | null = null;
		if (pool) {
			// 数字池当词库（拍板第 6 项）：摇一个区间值填入；面池摇一条（权重 ^N 天然生效）
			if (pool.numberRange) word = rollNumberRange(pool.numberRange, 1, true)[0] ?? null;
			// 空池按 miss 处理（rollPoolValues 对空面返回「（该池没有可摇的条目）」占位串，不能当词填进句子）
			else if (pool.faces.length > 0) word = rollPoolValues({ ...pool, count: 1 })[0] ?? null;
		}
		if (word === null || word === "") {
			resolver.onMiss?.(`{${key}}`);
			return raw;
		}
		cache.set(key, word);
		return word;
	});
}

/**
 * 对一组结果就地填词（在各摇骰单元的收口处调用）。
 * 注意：instances 不在这里走——池引用的每套实例在展开处已用自己的 cache 填过，
 * 外层再走会重复 onMiss、也会把「每套实例各摇各的」错误地合成同名。
 */
export function applyPlaceholders(items: ResultItem[], resolver: RefResolver, cache: Map<string, string>): void {
	for (const item of items) {
		item.values = item.values.map((v) => fillPlaceholders(v, resolver, cache));
		applyPlaceholders(item.subResults, resolver, cache);
	}
}

/** 摇一个池的面（带 count/allowRepeat）；命中带 `->` 的面时递归解析并按格式拼接 */
function rollFaces(pool: Pool, resolver: RefResolver, chainFmt: ChainFormat, depth: number): string[] {
	const picked = rollPoolValues({ ...pool, faces: pool.faces });
	return picked.map((text) => resolveChainValue(text, pool.faces, resolver, chainFmt, depth));
}

/**
 * 若该文本对应的面带链式引用，解析目标并拼接；否则原样返回。
 * 注意：嵌套结果取**目标池自身面的值**（不再二次套格式），避免「魔法物品：普通（普通）」式重复。
 */
function resolveChainValue(
	text: string,
	faces: Face[],
	resolver: RefResolver,
	chainFmt: ChainFormat,
	depth: number
): string {
	const face = faces.find((f) => f.text === text && f.ref);
	if (!face?.ref || depth >= MAX_DEPTH) return text;
	const target = resolver.resolvePool(face.ref);
	if (!target) return text;
	// 目标池自身的面各摇一条（目标池若也有链式引用，继续递归解析）
	const nestedValues = rollFaces(target, resolver, chainFmt, depth + 1);
	const nestedText = nestedValues.join("，");
	if (!nestedText) return text;
	return formatChain(text, nestedText, chainFmt);
}

/** 把一个 ResultItem 摊平成一段文字（用于链式拼接与复制） */
export function flattenItem(item: ResultItem): string {
	const parts: string[] = [];
	if (item.values.length > 0) parts.push(item.values.join("，"));
	for (const sub of item.subResults) {
		const s = flattenItem(sub);
		if (s) parts.push(s);
	}
	for (const inst of item.instances) {
		const inner = inst.items.map((it) => flattenItem(it)).filter(Boolean).join("，");
		if (inner) parts.push(inner);
	}
	return parts.join("，");
}

/** 链式拼接格式（用户设置项，阿麦 12:42 拍板） */
export interface ChainFormat {
	/** 包裹符号：paren＝圆括号 / bracket＝方括号 / none＝不包裹 */
	wrap: "paren" | "bracket" | "none";
	/** 分隔符号：预设 colon/dash/none，或用户自定义字符串 */
	sep: string;
}

/**
 * 按格式拼接链式结果。
 * wrap=paren 时输出「魔法物品：传说（传说）」——分隔符拼接主体，圆括号再标出嵌套部分；
 * wrap=none 时只保留分隔符拼接（「魔法物品：传说」）。
 */
export function formatChain(base: string, nested: string, fmt: ChainFormat): string {
	const sepText = fmt.sep === "colon" ? "：" : fmt.sep === "dash" ? "—" : fmt.sep === "none" ? "" : fmt.sep;
	if (fmt.wrap === "none") return sepText ? `${base}${sepText}${nested}` : `${base}${nested}`;
	const open = fmt.wrap === "paren" ? "（" : "［";
	const close = fmt.wrap === "paren" ? "）" : "］";
	return `${base}${sepText}${nested}${open}${nested}${close}`;
}
