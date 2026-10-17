import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyStep, reverseStep, getStateAt } from '../../src/recording/engine';
import { parseRecording, serializeRecording } from '../../src/recording/format';
import type { RecordingStep, TextChange } from '../../src/recording/types';
import { recording } from './helpers';

function random(seed: number): (limit: number) => number {
	let state = seed >>> 0;
	return (limit) => {
		state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
		return state % limit;
	};
}

const fragments = ['', 'a', 'XY', '\n', '\r\n', '\t"', '😀', 'e\u0301', '中文', 'العربية'];

/** Construct expected text from unchanged spans, independently of the engine. */
function generateEdit(
	before: string, sequence: number, next: (limit: number) => number,
): { step: RecordingStep; after: string } {
	const starts = new Set<number>();
	const count = Math.min(next(3) + 1, before.length + 1);
	while (starts.size < count) starts.add(next(before.length + 1));
	const ordered = [...starts].sort((a, b) => a - b);
	const changes: TextChange[] = [];
	const parts: string[] = [];
	let cursor = 0;
	let delta = 0;
	for (let index = 0; index < ordered.length; index++) {
		const from = ordered[index];
		assert.ok(from !== undefined);
		const limit = ordered[index + 1] ?? before.length;
		const to = from + next(limit - from + 1);
		const deletedText = before.slice(from, to);
		let insertedText = fragments[next(fragments.length)] ?? 'x';
		if (insertedText === deletedText) insertedText += '!';
		parts.push(before.slice(cursor, from), insertedText);
		changes.push({
			fromBefore: from, toBefore: to,
			fromAfter: from + delta, toAfter: from + delta + insertedText.length,
			deletedText, insertedText,
		});
		delta += insertedText.length - deletedText.length;
		cursor = to;
	}
	parts.push(before.slice(cursor));
	return { step: { sequence, kind: 'edit', changes }, after: parts.join('') };
}

for (const seed of [1, 2, 7, 42, 99, 1234, 65_535, 0x12345678, 0xabcdef01, 0xffffffff]) {
	void test(`generated multi-change recording and reversals, seed ${seed}`, () => {
		const next = random(seed);
		const initial = 'An article\n😀 e\u0301 中文';
		const states = [initial];
		const steps: RecordingStep[] = [];
		let state = initial;
		for (let sequence = 1; sequence <= 100; sequence++) {
			let step: RecordingStep;
			let after: string;
			if (sequence % 17 === 0) {
				after = `Resumed ${sequence}\n${fragments[next(fragments.length)] ?? ''}`;
				step = { sequence, kind: 'resume', changes: [{
					fromBefore: 0, toBefore: state.length, fromAfter: 0, toAfter: after.length,
					deletedText: state, insertedText: after,
				}] };
			} else {
				({ step, after } = generateEdit(state, sequence, next));
			}
			assert.equal(applyStep(state, step), after, `forward step ${sequence}`);
			assert.equal(reverseStep(after, step), state, `reverse step ${sequence}`);
			steps.push(step);
			states.push(after);
			state = after;
		}
		const file = recording(initial, steps);
		const original = JSON.stringify(file);
		const portable = parseRecording(serializeRecording(file));
		states.forEach((expected, sequence) => {
			assert.equal(getStateAt(file, sequence), expected, `select step ${sequence}`);
			assert.equal(getStateAt(portable, sequence), expected, `portable step ${sequence}`);
		});
		for (let index = steps.length - 1; index >= 0; index--) {
			const step = steps[index];
			assert.ok(step);
			state = reverseStep(state, step);
			assert.equal(state, states[index], `reverse traversal ${index}`);
		}
		assert.equal(state, initial);
		assert.equal(JSON.stringify(file), original);
	});
}
