import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { getStateAt } from '../../src/recording/engine';
import { parseRecording, serializeRecording } from '../../src/recording/format';
import { fixtureStates, loadFixture, recording, spliceStep, expectError } from './helpers';

void test('JSON syntax errors are structured recording errors', () => {
	for (const json of ['', '{', 'undefined', '{"format":', '{"steps": [],}']) {
		expectError(() => parseRecording(json), 'format');
	}
});

void test('JSON round trip preserves exact text and every recorded state', () => {
	const initial = '"quoted"\t\r\nnext\n😀 e\u0301 中文\u0000\ud800';
	const step = spliceStep(initial, initial.length, initial.length, '\nالعربية');
	const file = recording(initial, [step]);
	const serialized = serializeRecording(file);
	assert.ok(serialized.endsWith('\n'));
	assert.ok(serialized.includes('\n  "format": "obsidian-replay",'));
	assert.ok(serialized.includes('中文'));
	assert.ok(serialized.includes('\\r\\n'));
	const parsed = parseRecording(serialized);
	assert.deepEqual(parsed, file);
	assert.equal(getStateAt(parsed, 0), initial);
	assert.equal(getStateAt(parsed, 1), initial + '\nالعربية');
});

void test('serialization selects only portable fields in deterministic order', () => {
	const original = spliceStep('abc', 1, 2, 'B');
	const file = {
		steps: [{ changes: original.changes.map((change) => ({ localData: 'private', ...change })),
			kind: original.kind, sequence: original.sequence, path: 'private.md' }],
		initialText: 'abc', formatVersion: 1 as const, format: 'obsidian-replay' as const,
		vaultPath: '/private/vault', noteId: 'local-only',
	};
	const serialized = serializeRecording(file);
	assert.equal(serialized, serializeRecording(recording('abc', [original])));
	assert.ok(!serialized.includes('private'));
	assert.ok(!serialized.includes('noteId'));
	assert.ok(!serialized.includes('localData'));
});

for (const [name, states] of Object.entries(fixtureStates)) {
	void test(`portable fixture ${name} round trip matches all expected states`, () => {
		const file = loadFixture(name);
		const serialized = serializeRecording(file);
		assert.equal(serialized, readFileSync(`tests/recording/fixtures/${name}.json`, 'utf8'));
		const parsed = parseRecording(serialized);
		states.forEach((state, sequence) => assert.equal(getStateAt(parsed, sequence), state));
	});
}

void test('all documented JSON examples are the tested fixtures', () => {
	const documentation = readFileSync('docs/RECORDING_FORMAT.md', 'utf8');
	const examples = [...documentation.matchAll(/```json\n([\s\S]*?)\n```/g)];
	const names = Object.keys(fixtureStates);
	assert.equal(examples.length, names.length);
	examples.forEach((example, index) => {
		const name = names[index];
		assert.ok(name && example[1]);
		assert.deepEqual(parseRecording(example[1]), loadFixture(name));
	});
});
