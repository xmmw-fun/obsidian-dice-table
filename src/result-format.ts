// 结果文本/图片行格式化（2026-10-30 二次重写：全递归）
// 首版只处理一层实例，阿麦的真实表是三层嵌套（角色卡 ×2 -> 角色 ×3 -> 属性集四池），
// 第二层往里仍被 flatten 压扁——本版改为沿结果树全递归，任何深度都保留池名与层级。

import { ResultItem } from "./result";
import { t } from "./i18n";
import type { ImageRow } from "./image-export";

/**
 * 纯文本行（复制/追加保存共用），全递归：
 * - 普通池：`- 池名：值，值`；
 * - 实例：`- 池名 · 第 N 个`，内层整组缩进两格递归往下——多深都展得开，池名永不丢。
 */
export function resultTextLines(items: ResultItem[], indent = ""): string[] {
	const lines: string[] = [];
	for (const item of items) {
		const title = item.pool.title;
		if (item.instances.length === 0) {
			if (item.values.length > 0) lines.push(`${indent}- ${title}：${item.values.join("，")}`);
			for (const sub of item.subResults) lines.push(...resultTextLines([sub], indent));
			continue;
		}
		item.instances.forEach((inst, k) => {
			lines.push(`${indent}- ${title} · ${t("instanceOrdinal", { n: k + 1 })}`);
			lines.push(...resultTextLines(inst.items, `${indent}  `));
		});
	}
	return lines;
}

/**
 * 图片导出行数据（2026-10-30 20:30 自 022 移植：树形排布，group＝标题行/row＝池名+值/level＝缩进）。
 * 每个池一行紧凑排列，不再一池一个盒子把图撑长；递归到任意深度都保留层级。
 * 细节沿用 022 实测教训：只引用、自己不产值的池必须留标题行，否则子项会错并到上一层。
 */
export function imageRows(items: ResultItem[]): ImageRow[] {
	const out: ImageRow[] = [];
	const pushItem = (item: ResultItem, level: number): void => {
		const title = item.pool.title;
		if (item.instances.length > 0) {
			out.push({
				pool: item.instances.length > 1 ? `${title}（${item.instances.length} 套）` : title,
				values: [],
				kind: "group",
				level,
			});
			item.instances.forEach((inst, k) => {
				out.push({ pool: `第 ${k + 1} 个${title}`, values: [], kind: "group", level: level + 1 });
				for (const sub of inst.items) pushItem(sub, level + 2);
			});
			return;
		}
		const hasValue = item.values.length > 0;
		const hasChildren = item.subResults.length > 0;
		if (hasValue) out.push({ pool: title, values: [item.values.join("，")], kind: "row", level });
		else if (hasChildren) out.push({ pool: title, values: [], kind: "group", level });
		for (const sub of item.subResults) pushItem(sub, level + 1);
	};
	for (const item of items) pushItem(item, 0);
	return out;
}

/**
 * 保存新文件/写入笔记的 Markdown 行（方案乙·标题分层，阿麦 13:02），全递归：
 * - 普通池：`## 池名` + `- 值`，H3 子池 `- 子池名：值`；
 * - 实例 grouped（默认）：`## 池名` + `### 第 N 个池名` + 内层缩进列表（递归到任意深度）；
 * - 实例 blocks：每套一个 `## 池名（第 N 个）` 块。
 * 2026-10-30 修复：此前内层用 flattenItem 压扁，两层嵌套（她的 CP 表）照样挤坨丢名。
 */
export function resultMarkdownLines(items: ResultItem[], mode: string): string[] {
	const lines: string[] = [];
	for (const item of items) {
		const title = item.pool.title;
		if (item.instances.length === 0) {
			lines.push(`## ${title}`);
			if (item.values.length > 0) lines.push(`- ${item.values.join("，")}`);
			for (const sub of item.subResults) lines.push(...resultTextLines([sub], ""));
			lines.push("");
			continue;
		}
		if (mode === "blocks") {
			item.instances.forEach((inst, k) => {
				lines.push(`## ${title}（${t("instanceOrdinal", { n: k + 1 })}）`);
				lines.push(...resultTextLines(inst.items, ""));
				lines.push("");
			});
		} else {
			lines.push(`## ${title}`);
			item.instances.forEach((inst, k) => {
				lines.push(`### ${t("instanceLabel", { n: k + 1, title })}`);
				lines.push(...resultTextLines(inst.items, "  "));
				lines.push("");
			});
		}
	}
	return lines;
}
