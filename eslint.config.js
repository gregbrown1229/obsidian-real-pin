import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";

// Mirrors the official obsidianmd/obsidian-sample-plugin eslint.config: a global
// projectService whitelists manifest.json (so validate-manifest runs on it) while
// build artifacts, generated files, and package.json are ignored entirely. The
// recommended set scopes its type-aware rules to **/*.ts internally, so nothing
// type-checked ever runs on JSON. package.json/manifest/versions.json/tag
// consistency is owned by scripts/validate-plugin.mjs (no eslint rule covers it).
export default defineConfig([
	globalIgnores([
		"node_modules",
		"main.js",
		"esbuild.config.mjs",
		"version-bump.mjs",
		"versions.json",
		"package.json",
		"package-lock.json",
		"tsconfig.json",
		"scripts/**",
		"test/**",
		".remember/**",
		".claude/**",
	]),
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: ["eslint.config.js", "manifest.json"],
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: [".json"],
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		// Make manifest.json lintable so validate-manifest actually runs. It is
		// parsed (not type-checked) into an object expression via the TS parser
		// with extraFileExtensions; validate-manifest self-filters to manifest.json.
		//
		// This block (and the global parserOptions above) is a workaround for
		// eslint-plugin-obsidianmd 0.3.0, whose recommended config leaks type-aware
		// rules onto non-TS files (obsidianmd/eslint-plugin#155, #167; root cause
		// #130). When the fix (PR #165) ships, revisit this — much of the manual
		// scoping here, and the redundant manifest.json entry in allowDefaultProject
		// above, should be removable.
		files: ["manifest.json"],
		languageOptions: {
			parser: tseslint.parser,
			parserOptions: { project: false, extraFileExtensions: [".json"] },
		},
	},
]);
