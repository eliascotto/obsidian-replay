import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prepareExport, verifyExport } from '../../src/export/recording-export';
import { parseRecording } from '../../src/recording/format';
import { getStateAt, reverseStep } from '../../src/recording/engine';
import { compareDoomed } from '../../src/replay/doomed';
import { fixtureStates, loadFixture, recording, spliceStep } from '../recording/helpers';

for (const [name, states] of Object.entries(fixtureStates)) {
	void test(`standalone ${name} export reconstructs every state in both directions and supports Doomed`, () => {
		const prepared = prepareExport(loadFixture(name));
		verifyExport(prepared.json, prepared);
		// Only JSON and independently expected fixture strings are passed to the consumer below.
		const file = parseRecording(prepared.json);
		assert.equal(prepared.json, JSON.stringify(file, null, 2) + '\n');
		assert.deepEqual(Object.keys(file), ['format', 'formatVersion', 'initialText', 'steps']);
		for (const [sequence, text] of states.entries()) {
			const actual = getStateAt(file, sequence);
			assert.equal(actual, text);
			assert.deepEqual(compareDoomed(actual, getStateAt(file, file.steps.length)), compareDoomed(text, states[states.length - 1]!));
		}
		let text = states[states.length - 1]!;
		for (let index = file.steps.length - 1; index >= 0; index--) {
			text = reverseStep(text, file.steps[index]!);
			assert.equal(text, states[index]);
		}
	});
}

void test('empty/initial-only exports and strings containing local-looking identifiers are preserved exactly', () => {
	for (const text of ['', 'id-private .private-config/notes.md\r\n😀\t"quoted"\ud800']) {
		const file = Object.assign(recording(text), { id: 'secret-id', path: 'private/path.md', view: { doomed: true } });
		const prepared = prepareExport(file);
		const parsed = parseRecording(prepared.json);
		assert.equal(parsed.initialText, text);
		assert.deepEqual(parsed.steps, []);
		assert.equal(prepared.lastSequence, 0);
		assert.ok(!prepared.json.includes('secret-id') && !prepared.json.includes('private/path.md') && !prepared.json.includes('doomed'));
	}
});

void test('verification rejects altered/truncated JSON and a mismatched expected endpoint', () => {
	const file = recording('abc', [spliceStep('abc', 0, 3, 'xyz')]);
	const prepared = prepareExport(file);
	for (const text of ['', prepared.json.slice(0, -3), prepared.json.replace('xyz', 'wrong'), prepared.json + ' ']) {
		assert.throws(() => verifyExport(text, prepared));
	}
	assert.throws(() => verifyExport(prepared.json, { ...prepared, finalText: 'other' }));
	assert.throws(() => prepareExport(recording('abc', [spliceStep('wrong', 0, 3, 'x')])));
});
