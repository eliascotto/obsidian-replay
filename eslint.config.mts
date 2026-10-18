import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import { globalIgnores, defineConfig } from 'eslint/config';

export default defineConfig(
	globalIgnores([
		'node_modules',
		'dist',
		'esbuild.config.mjs',
		'version-bump.mjs',
		'versions.json',
		'main.js',
		'package.json',
		'package-lock.json',
		'tsconfig.json',
		'tsconfig.test.json',
	]),
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: ['eslint.config.mts', 'manifest.json', 'scripts/*.mjs'],
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json'],
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		files: ['src/**/*.ts'],
		rules: {
			// The upstream rule misses calls through aliases and ownerDocument.
			'no-restricted-syntax': ['error', {
				selector: 'CallExpression[callee.type="MemberExpression"][callee.property.name=/^(createElement|createElementNS|createDocumentFragment|createTextNode)$/]',
				message: 'Use Obsidian DOM helpers (createEl, createFragment, or appendText) instead of native DOM creation.',
			}],
		},
	},
	{
		files: ['tests/**/*.ts'],
		// Node fixtures emulate Obsidian's globals; these exceptions never apply to src/.
		rules: {
			'obsidianmd/no-nodejs-modules': 'off',
			'obsidianmd/no-global-this': 'off',
		},
		languageOptions: {
			globals: globals.node,
			parserOptions: {
				projectService: false,
				project: './tsconfig.test.json',
			},
		},
	},
	{
		files: ['scripts/**/*.mjs'],
		languageOptions: { globals: globals.node },
		rules: { 'obsidianmd/no-nodejs-modules': 'off' },
	},
);
