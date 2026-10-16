import obsidianmd from "eslint-plugin-obsidianmd";
import tseslint from "typescript-eslint";

export default tseslint.config(
	...tseslint.configs.recommended,
	{
		files: ["src/**/*.ts"],
		plugins: { obsidianmd },
		rules: {
			...obsidianmd.configs.recommended.rules,
			// 019 约定：图片导出卡的内联样式为序列化技术必需，已在源码注释声明理由
			"obsidianmd/no-static-styles-assignment": "error",
		},
	},
	{
		ignores: ["main.js", "node_modules/**", "_test*/**"],
	}
);
