// 结果数据结构与「池引用 + 链式引用」的解析摇骰
// 四机制分层（阿麦 2026-10-21 定稿）：
//   池引用（结构复用）：`## 角色 ×3 -> 属性集` —— 属性集是另一套骰子，单点定义
//   并行子池（H3）   ：一个池含多个子池 → 一次摇出并行多属性
//   链式引用（面级） ：命中带 `-> 目标` 的面后，继续摇目标池，结果拼接
//   紧凑写法         ：`## 池｜面1｜面2`（解析期完成，这里不涉及）
//
// 结果层级：ResultItem（一个池的结果）→ subResults（子池）→ instances（多套实例）

import { Dice, Face, Pool, rollPoolValues, rollNumberRange, pickCountFromRange, collectRefTargets } from "./table";

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

/** 摇骰选项（阿麦 2026-10-30 拍板：引用项是否在结果里显示，做成设置项） */
export interface RollOptions {
	/** true（默认）＝引用项也占一行；false＝引用项只当来源，不显示在结果里 */
	showReferencedPools?: boolean;
	/**
	 * 要隐藏的池名（由 view 精确计算：只算「指向当前文件」的引用，跨文件同名不误伤）。
	 * 不传时退回按引用目标的末段名粗判（测试/其它调用方用）。
	 */
	hideTitles?: string[];
}

/**
 * 一次摇骰单元的运行上下文（阿麦 2026-10-30）：
 * - items：单元内**每个池只摇一次**（按池名缓存）——链式与占位符都复用这一次的值，
 *   保证「同一次结果里同名词只有一个值」；
 * - words：占位符「同名同词」缓存；
 * - stack：自引用防护（`A -> A` 时退回普通摇面，不递归）。
 */
export interface RollContext {
	resolver: RefResolver;
	fmt: ChainFormat;
	items: Map<string, ResultItem>;
	words: Map<string, string>;
	stack: Set<string>;
}

export function createRollContext(resolver: RefResolver, fmt: ChainFormat): RollContext {
	return { resolver, fmt, items: new Map(), words: new Map(), stack: new Set() };
}

/**
 * 兜底算法：从引用目标里取「池名」末段（view 未传 hideTitles 时用）。
 * 只看名字，跨文件同名可能误判——生产路径由 view 传精确清单。
 */
function naiveRefNames(dice: Dice): Set<string> {
	const names = new Set<string>();
	for (const raw of collectRefTargets(dice)) {
		const t = raw.trim();
		const link = /^\[\[(.+)\]\]$/.exec(t);
		const inner = link ? link[1].split("|")[0].trim() : t;
		const hash = inner.indexOf("#");
		if (hash !== -1) {
			const name = inner.slice(hash + 1).trim();
			if (name) names.add(name);
			continue;
		}
		if (inner.includes("/") || inner.endsWith(".md")) continue;
		if (inner) names.add(inner);
	}
	return names;
}

/** 把被引用的池从结果树里摘掉；摘空的容器整块不显示（阿麦 10-30 方案 A） */
function pruneReferenced(items: ResultItem[], referenced: Set<string>): ResultItem[] {
	const out: ResultItem[] = [];
	for (const item of items) {
		if (referenced.has(item.pool.title)) continue;
		const subResults = pruneReferenced(item.subResults, referenced);
		const instances = item.instances.map((inst) => ({ index: inst.index, items: pruneReferenced(inst.items, referenced) }));
		const hasContent = item.values.length > 0 || subResults.length > 0 || instances.some((i) => i.items.length > 0);
		if (!hasContent) continue;
		out.push({ pool: item.pool, values: item.values, subResults, instances });
	}
	return out;
}

/**
 * 摇一个池：含子池展开、池引用展开、链式引用解析。
 *
 * 池引用（`## 池 -> 目标`）两种形态：
 *   - 目标是**一整套骰子**（H1）→ 把目标骰子的全部池展开为**子池**（subResults）；
 *   - 目标是**单个池**（H2）→ 把该池的结果并入自身 values。
 * 若带 ×N（`## 角色 ×3 -> 属性集`）→ 每套实例各展开一遍，结果进 instances。
 */
export function rollPoolFull(pool: Pool, resolver: RefResolver, chainFmt: ChainFormat, depth = 0, ctx?: RollContext): ResultItem {
	const c = ctx ?? createRollContext(resolver, chainFmt);

	if (pool.ref) {
		if (depth >= MAX_DEPTH) {
			return { pool, values: rollPoolValues(pool), subResults: [], instances: [] };
		}
		const targetDice = resolver.resolveDice(pool.ref);
		const n = Math.max(1, pool.count);

		// ×N 多实例：每套各展开一遍目标的全部池；每套＝独立单元（各自的名字/词库）
		if (n > 1 && targetDice) {
			const instances: ResultInstance[] = [];
			for (let i = 0; i < n; i++) {
				const instCtx = createRollContext(resolver, chainFmt);
				const items = targetDice.pools.map((p) => rollPoolFull(p, resolver, chainFmt, depth + 1, instCtx));
				applyPlaceholders(items, instCtx);
				instances.push({ index: i, items });
			}
			return { pool, values: [], subResults: [], instances };
		}

		// 单套：目标是整套骰子 → 展开为子池；否则按单池解析
		if (targetDice) {
			const subResults = targetDice.pools.map((p) => rollPoolFull(p, resolver, chainFmt, depth + 1, c));
			applyPlaceholders(subResults, c);
			return { pool, values: [], subResults, instances: [] };
		}
		const targetPool = resolver.resolvePool(pool.ref);
		if (targetPool) {
			const nested = rollPoolFull(targetPool, resolver, chainFmt, depth + 1, c);
			applyPlaceholders([nested], c);
			return { pool, values: nested.values.length > 0 ? nested.values : [flattenItem(nested)], subResults: nested.subResults, instances: nested.instances };
		}
		// 找不到目标：当作普通池；记一次 miss（view 层统一提示，阿麦 10-23）
		resolver.onMiss?.(pool.ref);
		return { pool, values: rollPoolValues(pool), subResults: [], instances: [] };
	}

	// 同一单元内同一池只摇一次（链式/占位符/结果行共用这一次的值）
	const key = pool.title;
	const cached = c.items.get(key);
	if (cached) return cached;
	if (c.stack.has(key)) {
		// 自引用：退回普通摇面，不再展开链式
		const plain = pool.numberRange && pool.faces.length === 0
			? rollNumberRange(pool.numberRange, Math.max(1, pool.count), pool.allowRepeat)
			: pool.faces.length > 0
				? rollPoolValues(pool)
				: [];
		return { pool, values: plain, subResults: [], instances: [] };
	}
	c.stack.add(key);

	let item: ResultItem;
	// 数字池（无面）：`## 力量 1~100` → 直接摇数字，不走面；×N 不重复/重复照常
	if (pool.numberRange && pool.faces.length === 0) {
		item = {
			pool,
			values: rollNumberRange(pool.numberRange, Math.max(1, pool.count), pool.allowRepeat),
			subResults: [],
			instances: [],
		};
	} else {
		// 有面时写区间＝「每次摇几个面」（阿麦 10-30 定的新语义）
		const rollingPool = pool.numberRange ? { ...pool, count: pickCountFromRange(pool.numberRange) } : pool;
		let values: string[] = [];
		if (pool.faces.length > 0) {
			values = rollFaces(rollingPool, c, depth);
		} else if (pool.subPools.length === 0) {
			// 真空池（无面、无子池）才提示；只有 H3 的「容器池」只出标题
			values = ["（该池没有可摇的条目）"];
		}
		const subResults = pool.subPools.map((sub) => rollPoolFull(sub, resolver, chainFmt, depth + 1, c));
		item = { pool, values, subResults, instances: [] };
	}

	c.stack.delete(key);
	c.items.set(key, item);
	return item;
}

/**
 * 摇一套骰子（阿麦 2026-10-22，#12/#13：H1 带 `×N` 时每摇随机抽 N 个池）。
 *
 * 池级随机（`# 场景卡 ×3`）：
 *   - randomPoolCount=0 → 全部池各摇一次（默认，老表行为不变）；
 *   - randomPoolCount=N → 每次只摇随机抽中的 N 个池，没抽到的池不出现在结果里；
 *   - randomPoolRepeat → 允许同一池被重复抽中（`×N重复`）；否则 N 个池互不重复。
 * 选中的池仍走 rollPoolFull（子池/池引用/链式照常展开）。
 */
export function rollDiceFull(dice: Dice, resolver: RefResolver, chainFmt: ChainFormat, options: RollOptions = {}): ResultItem[] {
	// 顶层摇骰＝一个摇骰单元：每池只摇一次、占位符同名同词
	const ctx = createRollContext(resolver, chainFmt);
	const showRefs = options.showReferencedPools !== false;
	const referenced = showRefs ? null : new Set<string>(options.hideTitles ?? [...naiveRefNames(dice)]);

	// 方案 A（不显示引用项）时，随机子集只在「会显示」的池里抽
	let candidates = dice.pools;
	if (referenced && referenced.size > 0) {
		const visible = dice.pools.filter((p) => !referenced.has(p.title));
		if (visible.length > 0) candidates = visible;
	}

	if (dice.randomPoolCount > 0 && candidates.length > 0) {
		const n = Math.min(dice.randomPoolCount, dice.randomPoolRepeat ? dice.randomPoolCount : candidates.length);
		const picked: Pool[] = [];
		if (dice.randomPoolRepeat) {
			for (let i = 0; i < n; i++) {
				picked.push(candidates[Math.floor(Math.random() * candidates.length)]);
			}
		} else {
			const idx = candidates.map((_, i) => i);
			for (let k = 0; k < n; k++) {
				const j = Math.floor(Math.random() * idx.length);
				picked.push(candidates[idx[j]]);
				idx.splice(j, 1);
			}
		}
		const items = picked.map((p) => rollPoolFull(p, resolver, chainFmt, 0, ctx));
		applyPlaceholders(items, ctx);
		return referenced ? finalize(items, referenced) : items;
	}
	const items = candidates.map((p) => rollPoolFull(p, resolver, chainFmt, 0, ctx));
	applyPlaceholders(items, ctx);
	return referenced ? finalize(items, referenced) : items;
}

/** 方案 A 收口：摘掉引用项；全被摘光时兜底照常全摇（不给空白结果） */
function finalize(items: ResultItem[], referenced: Set<string>): ResultItem[] {
	const pruned = pruneReferenced(items, referenced);
	return pruned.length > 0 ? pruned : items;
}

// ---------------------------------------------------------------------------
// 词库/句子模板（阿麦 2026-10-29 拍板，1.5 规格）：面文本 `{池名}` 占位符填词
// 词库＝任何普通池（零新结构）；解析复用 resolver——裸名仅当前文档、跨文档走链接，与 `->` 同一套规矩
// 单元边界＝顶层摇骰 / 池引用的一套实例；单元内同名占位符只摇一次（cache）
// ---------------------------------------------------------------------------

/** 占位符正则：`{池名}`——内容不含花括号与换行；摇出的词里再有 {...} 不递归（单遍替换天然满足） */
const PLACEHOLDER_RE = /\{([^{}\n]+)\}/g;

/** 填一段文本里的全部占位符：先用本单元已摇出的同名池值，没有再独立摇一次 */
function fillPlaceholders(text: string, ctx: RollContext): string {
	if (!text.includes("{")) return text;
	return text.replace(PLACEHOLDER_RE, (raw, inner: string) => {
		const key = inner.trim();
		if (!key) return raw;
		const hit = ctx.words.get(key);
		if (hit !== undefined) return hit;
		const pool = ctx.resolver.resolvePool(key);
		let word: string | null = null;
		if (pool) {
			// 同一次结果里同名词只有一个值：该池本单元已摇过就直接用它的值
			const cached = ctx.items.get(pool.title);
			if (cached && cached.values.length > 0) {
				word = cached.values[0];
			} else if (pool.faces.length > 0) {
				const it = rollPoolFull(pool, ctx.resolver, ctx.fmt, 0, ctx);
				word = it.values.length > 0 ? it.values[0] : rollPoolValues({ ...pool, count: 1 })[0] ?? null;
			} else if (pool.numberRange) {
				word = rollNumberRange(pool.numberRange, 1, true)[0] ?? null;
			}
		}
		if (word === null || word === "") {
			ctx.resolver.onMiss?.(`{${key}}`);
			return raw;
		}
		ctx.words.set(key, word);
		return word;
	});
}

/**
 * 对一组结果就地填词（各摇骰单元的收口处调用）。
 * 注意：instances 不在这里走——池引用的每套实例在展开处已用自己的 ctx 填过。
 */
export function applyPlaceholders(items: ResultItem[], ctx: RollContext): void {
	for (const item of items) {
		item.values = item.values.map((v) => fillPlaceholders(v, ctx));
		applyPlaceholders(item.subResults, ctx);
	}
}

/** 摇一个池的面（带 count/allowRepeat）；命中带 `->` 的面时解析并拼接 */
function rollFaces(pool: Pool, ctx: RollContext, depth: number): string[] {
	const picked = rollPoolValues({ ...pool, faces: pool.faces });
	return picked.map((text) => resolveChainValue(text, pool, ctx, depth));
}

/**
 * 若该文本对应的面带链式引用，解析目标并拼接；否则原样返回。
 * 目标池在本单元只摇一次——若这一行稍后也会作为结果出现，两处值一致（阿麦 10-30）。
 */
function resolveChainValue(text: string, pool: Pool, ctx: RollContext, depth: number): string {
	const face = pool.faces.find((f) => f.text === text && f.ref);
	if (!face?.ref || depth >= MAX_DEPTH) return text;
	const target = ctx.resolver.resolvePool(face.ref);
	if (!target) {
		ctx.resolver.onMiss?.(face.ref);
		return text;
	}
	const nested = rollPoolFull(target, ctx.resolver, ctx.fmt, depth + 1, ctx);
	const nestedText = nested.values.length > 0 ? nested.values.join("，") : flattenItem(nested);
	if (!nestedText) return text;
	return formatChain(text, nestedText, ctx.fmt);
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
 * 按设置拼接链式结果（1.6.1 修复，阿麦 2026-10-30 实测确认）：
 * - **包裹符号优先**：wrap=paren → `魔法物品（传说）`；bracket → `魔法物品［传说］`；
 * - **不包裹时才用分隔符号**：wrap=none + sep=colon → `魔法物品：传说`；sep=none → `魔法物品传说`。
 * 旧实现把 nested 拼了两次（`魔法物品：传说（传说）`），与 1.3 规格 §三 的表格不符。
 */
export function formatChain(base: string, nested: string, fmt: ChainFormat): string {
	if (fmt.wrap !== "none") {
		const open = fmt.wrap === "paren" ? "（" : "［";
		const close = fmt.wrap === "paren" ? "）" : "］";
		return `${base}${open}${nested}${close}`;
	}
	const sepText = fmt.sep === "colon" ? "：" : fmt.sep === "dash" ? "—" : fmt.sep === "none" ? "" : fmt.sep;
	return sepText ? `${base}${sepText}${nested}` : `${base}${nested}`;
}
