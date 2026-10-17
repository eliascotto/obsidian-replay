import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyStep, reverseStep, getStateAt, createResumeStep } from '../../src/recording/engine';
import { fixtureStates, loadFixture, recording, spliceStep, expectError } from './helpers';

for (const [name, states] of Object.entries(fixtureStates)) {
	void test(`fixture ${name}: reconstruct every state and reverse to the start`, () => {
		const file = loadFixture(name);
		for (const [sequence, state] of states.entries()) {
			assert.equal(getStateAt(file, sequence), state);
		}
		let state = states[states.length - 1];
		assert.ok(state !== undefined);
		for (let index = file.steps.length - 1; index >= 0; index--) {
			const step = file.steps[index];
			assert.ok(step);
			state = reverseStep(state, step);
			assert.equal(state, states[index]);
		}
		assert.equal(state, file.initialText);
	});
}

for (const position of [0, 2, 4]) {
	for (const kind of ['insert', 'delete', 'replace'] as const) {
		void test(`${kind} at position ${position}`, () => {
			const before = 'abcde';
			const to = kind === 'insert' ? position : position + 1;
			const text = kind === 'delete' ? '' : 'XY';
			const expected = before.slice(0, position) + text + before.slice(to);
			const step = spliceStep(before, position, to, text);
			assert.equal(applyStep(before, step), expected);
			assert.equal(reverseStep(expected, step), before);
		});
	}
}

const textCases = [
	{ before: '', from: 0, to: 0, text: 'First line\nSecond line\n' },
	{ before: 'abc', from: 3, to: 3, text: ' appended' },
	{ before: 'erase everything', from: 0, to: 16, text: '' },
	{ before: 'a\r\nb\n', from: 1, to: 3, text: '\t\n' },
	{ before: 'A😀B', from: 1, to: 3, text: '🌏' },
	{ before: 'e\u0301 café 中文 العربية', from: 0, to: 2, text: 'é' },
	{ before: '\ud800x\udfff', from: 1, to: 2, text: '\u0000' },
	{ before: 'prefix suffix', from: 7, to: 7, text: 'x'.repeat(100_000) },
];

for (const [index, item] of textCases.entries()) {
	void test(`exact text preservation case ${index}`, () => {
		const step = spliceStep(item.before, item.from, item.to, item.text);
		const expected = item.before.slice(0, item.from) + item.text + item.before.slice(item.to);
		assert.equal(applyStep(item.before, step), expected);
		assert.equal(reverseStep(expected, step), item.before);
	});
}

void test('mixed adjacent deletion and insertion reverse in canonical tie order', () => {
	const step = {
		sequence: 1, kind: 'edit' as const, changes: [
			{ fromBefore: 0, toBefore: 1, fromAfter: 0, toAfter: 0, deletedText: 'a', insertedText: '' },
			{ fromBefore: 1, toBefore: 1, fromAfter: 0, toAfter: 1, deletedText: '', insertedText: 'X' },
		],
	};
	assert.equal(applyStep('abc', step), 'Xbc');
	assert.equal(reverseStep('Xbc', step), 'abc');
});

void test('engine and selection leave frozen caller-owned data unchanged', () => {
	const step = spliceStep('abc', 1, 2, 'B');
	step.changes.forEach(Object.freeze);
	Object.freeze(step.changes);
	Object.freeze(step);
	const file = Object.freeze(recording('abc', Object.freeze([step])));
	assert.equal(applyStep('abc', step), 'aBc');
	assert.equal(reverseStep('aBc', step), 'abc');
	assert.equal(getStateAt(file, 1), 'aBc');
});

for (const [before, after] of [['old', 'new'], ['', 'new'], ['old', '']]) {
	void test(`resume length ${before?.length} to ${after?.length}`, () => {
		assert.ok(before !== undefined && after !== undefined);
		const step = createResumeStep(before, after, 3);
		assert.ok(step);
		assert.equal(step.kind, 'resume');
		assert.equal(step.sequence, 3);
		assert.equal(step.changes.length, 1);
		assert.equal(applyStep(before, step), after);
		assert.equal(reverseStep(after, step), before);
	});
}

void test('unchanged resume creates no step', () => {
	assert.equal(createResumeStep('same', 'same', 1), null);
	assert.equal(createResumeStep('', '', 1), null);
});

void test('selection rejects invalid or unavailable sequences', () => {
	const file = loadFixture('insertion');
	for (const sequence of [-1, 0.5, 3, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
		expectError(() => getStateAt(file, sequence), 'sequence');
	}
});

void test('resume validates sequence even if text is unchanged', () => {
	for (const sequence of [0, -1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
		expectError(() => createResumeStep('same', 'same', sequence), 'sequence');
	}
});
