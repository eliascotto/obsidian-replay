import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { test } from 'node:test';

void test('lint rejects native DOM factories through aliases and ownerDocument', () => {
	const source = [
		'export function build(host: HTMLElement): void {',
		'  const doc = host.ownerDocument;',
		'  doc.createElement("mark");',
		'  doc.createElementNS("http://www.w3.org/2000/svg", "svg");',
		'  host.ownerDocument.createDocumentFragment();',
		'  doc.createTextNode("text");',
		'}',
	].join('\n');
	const result = spawnSync(process.execPath, [
		resolve('node_modules/eslint/bin/eslint.js'), '--stdin', '--stdin-filename',
		'src/ui/replay-text.ts', '--format', 'json',
	], { input: source, encoding: 'utf8' });
	assert.equal(result.status, 1, result.stderr);
	const reports = JSON.parse(result.stdout) as { messages: { ruleId: string; line: number; severity: number }[] }[];
	const errors = reports.flatMap(({ messages }) => messages).filter(({ ruleId }) => ruleId === 'no-restricted-syntax');
	assert.deepEqual(errors.map(({ line }) => line), [3, 4, 5, 6]);
	assert.ok(errors.every(({ severity }) => severity === 2));
});
