import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EditorState, type ChangeSpec } from '@codemirror/state';
import { TransactionRouter, transactionObservation } from '../../src/capture/transaction';
import { applyStep, reverseStep } from '../../src/recording/engine';

const cases: { before: string; changes: ChangeSpec; after: string }[] = [
	{ before: '', changes: { from: 0, insert: 'a' }, after: 'a' },
	{ before: 'abc', changes: { from: 1, to: 2, insert: 'XX' }, after: 'aXXc' },
	{ before: 'abc', changes: { from: 0, insert: 'a long\npaste\t😀' }, after: 'a long\npaste\t😀abc' },
	{ before: 'abc', changes: [{ from: 0, to: 1, insert: 'AA' }, { from: 2, to: 3, insert: '!' }], after: 'AAb!' },
	{ before: 'abc', changes: [{ from: 0, to: 1 }, { from: 1, to: 2 }], after: 'c' },
	{ before: 'A😀 e\u0301 中文', changes: { from: 1, to: 3, insert: '🌏' }, after: 'A🌏 e\u0301 中文' },
	{ before: 'abc', changes: [{ from: 1, insert: 'X' }, { from: 1, insert: 'Y' }], after: 'aXYbc' },
];

for (const [index, item] of cases.entries()) {
	void test(`real CodeMirror transaction ${index} preserves the entire before and after text`, () => {
		const transaction = EditorState.create({ doc: item.before }).update({ changes: item.changes });
		const observation = transactionObservation(transaction);
		assert.ok(observation);
		const step = { sequence: 1, kind: 'edit' as const, changes: observation.changes };
		assert.equal(observation.before, item.before);
		assert.equal(observation.after, item.after);
		assert.equal(applyStep(item.before, step), item.after);
		assert.equal(reverseStep(item.after, step), item.before);
	});
}

void test('configured CRLF serialization does not corrupt CodeMirror position offsets', () => {
	const state = EditorState.create({ doc: 'a\r\nb', extensions: [EditorState.lineSeparator.of('\r\n')] });
	const transaction = state.update({ changes: { from: 2, to: 3, insert: 'B\r\nC' } });
	const observation = transactionObservation(transaction);
	assert.ok(observation);
	assert.equal(observation.before, 'a\nb');
	assert.equal(observation.after, 'a\nB\nC');
	assert.equal(applyStep(observation.before, { sequence: 1, kind: 'edit', changes: observation.changes }), 'a\nB\nC');
});

void test('selection-only and identical replacements produce no step', () => {
	const state = EditorState.create({ doc: 'abc' });
	assert.equal(transactionObservation(state.update({ selection: { anchor: 1 } })), null);
	assert.equal(transactionObservation(state.update({ changes: { from: 0, to: 3, insert: 'abc' } })), null);
});

void test('router processes each transaction in order, skips file rebinding and unassociated editors', () => {
	const seen: { file: string; after: string }[] = [];
	const router = new TransactionRouter('a.md', (file, observation) => seen.push({ file, after: observation.after }));
	const first = EditorState.create({ doc: 'A' }).update({ changes: { from: 1, insert: 'B' } });
	const second = first.state.update({ changes: { from: 2, insert: 'C' } });
	router.update('a.md', [first, second]);
	router.update('b.md', [first]);
	router.update(null, [second]);
	router.update(null, [second]);
	router.update('b.md', [first]);
	router.update('b.md', [second]);
	assert.deepEqual(seen, [{ file: 'a.md', after: 'AB' }, { file: 'a.md', after: 'ABC' }, { file: 'b.md', after: 'ABC' }]);
});

void test('undo and redo inverse transactions are both recorded as ordinary text changes', () => {
	const initial = EditorState.create({ doc: 'abc' });
	const forward = initial.update({ changes: { from: 1, to: 2, insert: 'XX' } });
	const undo = forward.state.update({ changes: forward.changes.invert(initial.doc) });
	const redo = undo.state.update({ changes: undo.changes.invert(forward.newDoc) });
	const text = [forward, undo, redo].map((transaction) => transactionObservation(transaction)?.after);
	assert.deepEqual(text, ['aXXc', 'abc', 'aXXc']);
});

void test('router skips text conversion and delivery while a recording gate is closed', () => {
	let enabled = false;
	const seen: string[] = [];
	const router = new TransactionRouter('a.md', (_file, observation) => seen.push(observation.after), () => enabled);
	const transaction = EditorState.create({ doc: 'A' }).update({ changes: { from: 1, insert: 'B' } });
	router.update('a.md', [transaction]);
	assert.deepEqual(seen, []);
	enabled = true;
	router.update('a.md', [transaction]);
	assert.deepEqual(seen, ['AB']);
});
