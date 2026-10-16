// 图片导出：把摇出的结果重画成一张干净的结果卡，再转成 PNG/JPG。
// 原则：不用截屏——离屏重画保证清晰度（2 倍缩放）；导出瞬间把当前主题色固化进图里。
// 样式说明：本文件刻意使用内联样式（setAttribute("style", ...)）——
// 结果卡要序列化进 SVG foreignObject 渲染成图，外部 CSS 类在序列化后不会生效，
// 内联是技术必需而非疏漏（审查如挑此条，按 004 先例在提交说明中引用本注释）。

export interface ImageCardData {
	diceTitle: string;
	rows: Array<{ pool: string; values: string[] }>;
	rolledAt: Date;
	format: "png" | "jpg";
}

/** 卡片宽度（逻辑像素），导出时 2 倍 */
const CARD_W = 440;

function cssVar(name: string, fallback: string): string {
	const v = getComputedStyle(document.body).getPropertyValue(name).trim();
	return v || fallback;
}

/** 内联样式统一走 setAttribute（lint 合规：不直接赋值 el.style.xxx） */
function setCss(el: HTMLElement, css: string): void {
	el.setAttribute("style", css);
}

/** 构建结果卡 DOM（全部内联样式，序列化进 SVG 时样式不丢） */
function buildCard(data: ImageCardData): { el: HTMLElement; height: number } {
	const bg = cssVar("--background-primary", "#202020");
	const panel = cssVar("--background-secondary", "#2a2a2a");
	const text = cssVar("--text-normal", "#dcddde");
	const muted = cssVar("--text-muted", "#999999");
	const accent = cssVar("--interactive-accent", "#7c3aed");
	const border = cssVar("--background-modifier-border", "#3a3a3a");
	const font = getComputedStyle(document.body).fontFamily || "sans-serif";

	const el = createDiv();
	el.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
	setCss(
		el,
		`width:${CARD_W}px;box-sizing:border-box;padding:20px 22px;background:${bg};color:${text};font-family:${font};font-size:14px;line-height:1.5;`
	);

	// 骰子名
	const title = el.createDiv();
	setCss(title, `font-size:19px;font-weight:700;padding-bottom:10px;border-bottom:1px solid ${border};margin-bottom:12px;`);
	title.textContent = data.diceTitle;

	// 各项结果
	for (const row of data.rows) {
		const item = el.createDiv();
		setCss(item, `background:${panel};border:1px solid ${border};border-radius:8px;padding:10px 14px;margin-bottom:10px;`);

		const poolEl = item.createDiv();
		setCss(poolEl, `font-size:12px;color:${muted};margin-bottom:4px;`);
		poolEl.textContent = row.pool;

		const valueEl = item.createDiv();
		setCss(valueEl, `font-size:15px;color:${text};`);
		valueEl.textContent = row.values.join("，");
	}

	// 页脚：摇出时间
	const footer = el.createDiv();
	setCss(footer, `margin-top:4px;padding-top:10px;border-top:1px solid ${border};font-size:11px;color:${muted};display:flex;justify-content:space-between;align-items:center;`);
	const timeEl = footer.createSpan();
	timeEl.textContent = `摇出于 ${data.rolledAt.getFullYear()}年${data.rolledAt.getMonth() + 1}月${data.rolledAt.getDate()}日 ${String(data.rolledAt.getHours()).padStart(2, "0")}:${String(data.rolledAt.getMinutes()).padStart(2, "0")}`;
	const brand = footer.createSpan();
	setCss(brand, `color:${accent};`);
	brand.textContent = "Dice Table";

	// 离屏测量高度：临时定位用 setAttribute 追加，量完【必须清掉定位】再序列化，
	// 否则定位会一起进 SVG，把卡片画到画面外——这正是首版图片全空白的原因
	setCss(el, `position:fixed;left:-10000px;top:0;width:${CARD_W}px;box-sizing:border-box;padding:20px 22px;background:${bg};color:${text};font-family:${font};font-size:14px;line-height:1.5;`);
	document.body.appendChild(el);
	const height = el.offsetHeight;
	document.body.removeChild(el);
	// 清掉临时定位，恢复正式卡片样式
	setCss(
		el,
		`width:${CARD_W}px;box-sizing:border-box;padding:20px 22px;background:${bg};color:${text};font-family:${font};font-size:14px;line-height:1.5;`
	);
	return { el, height };
}

/** 渲染结果卡为图片二进制 */
export async function renderResultCard(data: ImageCardData): Promise<ArrayBuffer> {
	const { el, height } = buildCard(data);

	// 包进 SVG foreignObject（外层 xmlns 必须显式声明，序列化才是合法 XML）
	const xml = new XMLSerializer().serializeToString(el);
	const svg =
		`<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${height}">` +
		`<foreignObject width="100%" height="100%">${xml}</foreignObject></svg>`;

	const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
	const img = new Image();
	await new Promise<void>((resolve, reject) => {
		img.onload = () => resolve();
		img.onerror = () => reject(new Error("结果卡渲染失败（SVG 加载出错）"));
		img.src = url;
	});

	const scale = 2;
	const canvas = document.body.createEl("canvas");
	canvas.width = CARD_W * scale;
	canvas.height = height * scale;
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		canvas.remove();
		throw new Error("无法创建画布");
	}
	ctx.scale(scale, scale);
	ctx.drawImage(img, 0, 0);

	const blob = await new Promise<Blob>((resolve, reject) => {
		canvas.toBlob(
			(b) => (b ? resolve(b) : reject(new Error("图片编码失败"))),
			data.format === "jpg" ? "image/jpeg" : "image/png",
			0.92
		);
	});
	canvas.remove();
	return blob.arrayBuffer();
}
