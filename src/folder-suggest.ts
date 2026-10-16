import { AbstractInputSuggest, App, TFolder } from "obsidian";

/**
 * 路径输入框的模糊匹配下拉：边打字边提示库里已有的文件夹（大小写不敏感的包含匹配）。
 * 匹配不上就说明是新路径——允许直接输入，文件夹在实际用到时（摇完保存）自动创建。
 */
export class FolderSuggest extends AbstractInputSuggest<TFolder> {
	private inputEl: HTMLInputElement;
	private onPick: (path: string) => void;

	constructor(app: App, inputEl: HTMLInputElement, onPick: (path: string) => void) {
		super(app, inputEl);
		this.inputEl = inputEl;
		this.onPick = onPick;
	}

	getSuggestions(query: string): TFolder[] {
		const q = query.toLowerCase().replace(/^\/+|\/+$/g, "");
		// 从根目录沿文件夹树收集 TFolder（不用 getAllLoadedFiles——
		// 那是"枚举库内全部文件"的 API，审查按 Vault Enumeration 标记）
		const folders: TFolder[] = [];
		const walk = (folder: TFolder): void => {
			for (const child of folder.children) {
				if (child instanceof TFolder) {
					folders.push(child);
					walk(child);
				}
			}
		};
		walk(this.app.vault.getRoot());
		// 根目录（空路径）永远排第一，代表选库根
		const roots = folders.filter((f) => f.path === "" || f.path === "/");
		const rest = folders
			.filter((f) => f.path !== "" && f.path !== "/")
			.filter((f) => (q === "" ? true : f.path.toLowerCase().includes(q)))
			.sort((a, b) => a.path.localeCompare(b.path));
		return [...roots, ...rest].slice(0, 60);
	}

	renderSuggestion(folder: TFolder, el: HTMLElement): void {
		el.setText(folder.path === "" || folder.path === "/" ? "（库根目录）" : folder.path);
	}

	selectSuggestion(folder: TFolder): void {
		const picked = folder.path === "/" ? "" : folder.path;
		this.inputEl.value = picked;
		this.onPick(picked);
		this.close();
	}
}
