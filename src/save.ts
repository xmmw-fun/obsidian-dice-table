// 保存逻辑：命名模板 → 非法字符处理 → 重名加序号 → 写入

/** 命名模板变量替换。模板示例：{H1}_{YYYYMMDD-HHmm}、{H1}_第{WW}周、{H1}_{H2} */
export function renderNameTemplate(
	template: string,
	vars: {
		h1: string;
		h2List: string[];
		now: Date;
	}
): string {
	const n = vars.now;
	const year = n.getFullYear();
	const pad = (v: number, len = 2) => String(v).padStart(len, "0");

	// ISO 第几周
	const ww = getISOWeek(n);

	const mo = n.getMonth() + 1, d = n.getDate(), h = n.getHours(), mi = n.getMinutes();

	// 基础变量（纯字母数字）
	const map: Record<string, string> = {
		H1: vars.h1,
		YYYY: String(year),
		YY: String(year).slice(-2),
		MM: pad(mo),
		DD: pad(d),
		HH: pad(h),
		mm: pad(mi),
		ss: pad(n.getSeconds()),
		WW: pad(ww),
	};

	// 组合变量（带横杠/连写的，如默认模板里的 {YYYYMMDD-HHmm}）
	const composite: Record<string, string> = {
		"YYYYMMDD-HHmm": `${year}${pad(mo)}${pad(d)}-${pad(h)}${pad(mi)}`,
		"YYYYMMDD-HH": `${year}${pad(mo)}${pad(d)}-${pad(h)}`,
		YYYYMMDD: `${year}${pad(mo)}${pad(d)}`,
		HHmm: `${pad(h)}${pad(mi)}`,
	};

	// 变量名允许字母、数字、下划线、横杠的组合，如 {YYYYMMDD-HHmm}
	let out = template.replace(/\{H2(?::(\d+))?\}/g, (_m: string, idxStr: string | undefined) => {
		const idx = idxStr ? parseInt(idxStr, 10) - 1 : 0;
		return vars.h2List[idx] ?? "";
	});

	out = out.replace(/\{([A-Za-z0-9_-]+)\}/g, (m, key: string) => {
		if (key in composite) return composite[key];
		if (key in map) return map[key];
		return m; // 不认识的变量原样保留，方便用户发现拼错
	});

	return sanitizeFilename(out);
}

/** Windows 文件名非法字符替换为安全字符 */
export function sanitizeFilename(name: string): string {
	return name.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim();
}

/** 同名文件自动追加序号：xxx-2、xxx-3……不覆盖已有文件 */
export async function resolveUniquePath(
	vault: { adapter: { exists(path: string): Promise<boolean> } },
	folder: string,
	baseName: string,
	ext: string
): Promise<string> {
	const join = (n: string) => normalizeFolder(folder) + "/" + n + ext;
	let candidate = join(baseName);
	let i = 2;
	while (await vault.adapter.exists(candidate)) {
		candidate = join(`${baseName}-${i}`);
		i++;
	}
	return candidate;
}

function normalizeFolder(folder: string): string {
	return folder.replace(/^\/+|\/+$/g, "");
}

/** ISO 8601 周数 */
export function getISOWeek(d: Date): number {
	const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
	const dayNum = date.getUTCDay() || 7;
	date.setUTCDate(date.getUTCDate() + 4 - dayNum);
	const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
	return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}
