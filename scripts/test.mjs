import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { build } from 'esbuild';

async function findTests(directory) {
	const entries = await readdir(directory, { withFileTypes: true });
	const groups = await Promise.all(entries.map((entry) => {
		const name = path.join(directory, entry.name);
		return entry.isDirectory() ? findTests(name) : entry.name.endsWith('.test.ts') ? [name] : [];
	}));
	return groups.flat().sort();
}

const entries = await findTests('tests');

if (entries.length === 0) throw new Error('No recording tests found.');

await build({
	entryPoints: entries,
	outdir: 'dist/tests',
	outbase: 'tests',
	outExtension: { '.js': '.mjs' },
	bundle: true,
	platform: 'node',
	format: 'esm',
	target: 'node18',
	sourcemap: 'inline',
});

const bundles = entries.map((entry) => path.join(
	'dist/tests', path.relative('tests', entry).replace(/\.ts$/, '.mjs'),
));
const result = spawnSync(process.execPath, ['--test', ...bundles], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
