import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyStep, reverseStep, getStateAt } from '../../src/recording/engine';
import { parseRecording, serializeRecording } from '../../src/recording/format';
import { validateRecordingShape, validateStepShape } from '../../src/recording/validation';
import { changedStep, expectError, recording, spliceStep } from './helpers';

void test('untrusted root data must have the complete recording shape', () => {
	for (const value of [null, [], true, 0, 'text', {},
		{ ...recording(), format: 'other' },
		{ ...recording(), formatVersion: '1' },
		{ ...recording(), initialText: null },
		{ ...recording(), steps: {} },
	]) {
		expectError(() => validateRecordingShape(value), 'format');
		expectError(() => parseRecording(JSON.stringify(value)), 'format');
	}
});

void test('unsupported numeric versions fail explicitly', () => {
	for (const formatVersion of [0, 2, 1.5, -1]) {
		expectError(() => parseRecording(JSON.stringify({ ...recording(), formatVersion })), 'version');
	}
});

void test('step shape rejects invalid kinds, missing data, and no changes', () => {
	for (const value of [null, [], {},
		{ sequence: 1, kind: 'external', changes: [] },
		{ sequence: 1, kind: 'edit', changes: {} },
		{ sequence: 1, kind: 'edit', changes: [] },
		{ sequence: 1, kind: 'edit', changes: [null] },
		{ sequence: 1, kind: 'edit', changes: [{}] },
		changedStep({ insertedText: 'b' }),
	]) {
		expectError(() => validateStepShape(value), 'format');
	}
});

void test('non-string text fields fail before string operations', () => {
	for (const field of ['deletedText', 'insertedText']) {
		const value = { sequence: 1, kind: 'edit', changes: [{
			fromBefore: 0, toBefore: 1, fromAfter: 0, toAfter: 1,
			deletedText: 'a', insertedText: 'b', [field]: 42,
		}] };
		expectError(() => validateStepShape(value), 'format');
	}
});

void test('step sequence must be a positive safe integer', () => {
	for (const sequence of [undefined, '1', 0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
		expectError(() => validateStepShape({ ...changedStep({}), sequence }), 'sequence');
	}
});

void test('sequences cannot skip, duplicate, or reorder', () => {
	for (const sequences of [[2], [1, 1], [1, 3], [2, 1]]) {
		const steps = sequences.map((sequence) => spliceStep('abc', 1, 2, 'B', sequence));
		expectError(() => getStateAt(recording('abc', steps), 0), 'sequence');
		expectError(() => serializeRecording(recording('abc', steps)), 'sequence');
	}
});

void test('offsets must be nonnegative safe integers with lengths matching text', () => {
	for (const field of ['fromBefore', 'toBefore', 'fromAfter', 'toAfter'] as const) {
		for (const value of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
			expectError(() => applyStep('abc', changedStep({ [field]: value })), 'range');
		}
	}
	for (const overrides of [
		{ fromBefore: 3, toBefore: 2 }, { fromAfter: 3, toAfter: 2 },
		{ toBefore: 3 }, { toAfter: 3 },
		{ fromBefore: 4, toBefore: 5, fromAfter: 4, toAfter: 5 },
		{ fromAfter: 2, toAfter: 3 },
	]) {
		expectError(() => applyStep('abc', changedStep(overrides)), 'range');
	}
});

void test('after coordinates include the cumulative delta of preceding changes', () => {
	const step = {
		sequence: 1, kind: 'edit' as const, changes: [
			{ fromBefore: 0, toBefore: 1, fromAfter: 0, toAfter: 3, deletedText: 'a', insertedText: 'AAA' },
			{ fromBefore: 2, toBefore: 3, fromAfter: 2, toAfter: 3, deletedText: 'c', insertedText: 'C' },
		],
	};
	expectError(() => applyStep('abc', step), 'range');
	expectError(() => reverseStep('AAAbC', step), 'range');
});

void test('overlapping, unsorted, and same-position changes are rejected', () => {
	const first = spliceStep('abc', 0, 2, 'XY').changes[0];
	const overlapping = spliceStep('abc', 1, 3, 'YZ').changes[0];
	assert.ok(first && overlapping);
	for (const changes of [[first, overlapping], [overlapping, first], [first, first]]) {
		expectError(() => applyStep('abc', { sequence: 1, kind: 'edit', changes }), 'range');
	}
	const insertions = [
		{ fromBefore: 0, toBefore: 0, fromAfter: 0, toAfter: 1, deletedText: '', insertedText: 'a' },
		{ fromBefore: 0, toBefore: 0, fromAfter: 1, toAfter: 2, deletedText: '', insertedText: 'b' },
	];
	expectError(() => applyStep('', { sequence: 1, kind: 'edit', changes: insertions }), 'range');
});

void test('both directions reject mismatched text without exposing it in errors', () => {
	const step = spliceStep('aPRIVATEc', 1, 8, 'REVISED');
	const error = expectError(() => applyStep('aWRONG!!c', step), 'text-mismatch');
	assert.equal(error.location.sequence, 1);
	assert.equal(error.location.changeIndex, 0);
	assert.ok(!error.message.includes('PRIVATE'));
	assert.ok(!error.message.includes('WRONG'));
	expectError(() => reverseStep('aWRONG!!c', step), 'text-mismatch');
});

void test('reverse rejects a document shorter than the inserted content', () => {
	expectError(() => reverseStep('', spliceStep('', 0, 0, 'inserted')), 'range');
});

void test('resume must be one complete-document replacement in both directions', () => {
	const partial = { ...spliceStep('abc', 1, 2, 'B'), kind: 'resume' as const };
	expectError(() => applyStep('abc', partial), 'range');
	expectError(() => reverseStep('aBc', partial), 'range');
	const multiple = { sequence: 1, kind: 'resume' as const, changes: [
		...spliceStep('abc', 0, 1, 'A').changes,
		...spliceStep('abc', 2, 3, 'C').changes,
	] };
	expectError(() => applyStep('abc', multiple), 'range');
});

void test('format rejects a corrupt suffix rather than returning a valid prefix', () => {
	const file = recording('abc', [spliceStep('abc', 1, 2, 'B'), spliceStep('WRONG', 1, 2, 'x', 2)]);
	expectError(() => parseRecording(JSON.stringify(file)), 'text-mismatch');
	expectError(() => serializeRecording(file), 'text-mismatch');
});
