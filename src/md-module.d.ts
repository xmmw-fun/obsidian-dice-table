// 让 TypeScript 认识 esbuild 的 .md text loader 导入
declare module "*.md" {
	const content: string;
	export default content;
}
