import obsidianmd from "eslint-plugin-obsidianmd";
import tseslint from "typescript-eslint";

export default tseslint.config(
	...tseslint.configs.recommendedTypeChecked,
	{
		files: ["src/**/*.ts"],
		plugins: { obsidianmd },
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			...obsidianmd.configs.recommended.rules,
		},
	},
	{
		ignores: ["main.js", "node_modules/**", "_test*/**"],
	}
);
