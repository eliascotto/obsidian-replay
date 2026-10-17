import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EditorState } from '@codemirror/state';
import { transactionObservation } from '../../src/capture/transaction';
import { RecordingController } from '../../src/recording/controller';
import { RecordingStore } from '../../src/storage/recording-store';
import { getStateAt } from '../../src/recording/engine';
import { parseRecording, serializeRecording } from '../../src/recording/format';
import { FakeClock, MemoryAdapter, deferred } from '../support/storage';

function setup(adapter = new MemoryAdapter()) {
	const clock = new FakeClock();
	const errors: unknown[] = [];
	let id = 0;
	const store = new RecordingStore(adapter, 'recordings');
	const controller = new RecordingController(store, (_path, error) => errors.push(error), clock, () => `id-${++id}`);
	return { adapter, clock, errors, store, controller };
}

function capture(controller: RecordingController, path: string, before: string, after: string): void {
	const transaction = EditorState.create({ doc: before }).update({ changes: { from: 0, to: before.length, insert: after } });
	const observation = transactionObservation(transaction);
	assert.ok(observation);
	controller.capture(path, observation);
}

void test('start, stop, unrecorded changes, and resume preserve all recorded states', async () => {
	const { controller, clock, errors } = setup();
	await controller.start('a.md', 'Original');
	capture(controller, 'a.md', 'Original', 'Revised');
	await controller.stop('a.md');
	capture(controller, 'a.md', 'Revised', 'Unrecorded');
	await controller.start('a.md', 'Unrecorded');
	capture(controller, 'a.md', 'Unrecorded', 'Final');
	await controller.stop('a.md');
	const file = await controller.stoppedRecording('a.md');
	assert.ok(file);
	assert.equal(file.steps.length, 3);
	assert.deepEqual([0, 1, 2, 3].map((sequence) => getStateAt(file, sequence)), ['Original', 'Revised', 'Unrecorded', 'Final']);
	assert.equal(file.steps[1]?.kind, 'resume');
	assert.deepEqual(parseRecording(serializeRecording(file)), file);
	assert.equal(clock.size, 0);
	assert.deepEqual(errors, []);
});

void test('repeated Start/Stop and unchanged Resume are idempotent', async () => {
	const { controller, store } = setup();
	const first = controller.start('a.md', 'Existing');
	await Promise.all([first, controller.start('a.md', 'ignored')]);
	await Promise.all([controller.stop('a.md'), controller.stop('a.md')]);
	await controller.start('a.md', 'Existing');
	await controller.stop('a.md');
	assert.equal((await controller.stoppedRecording('a.md'))?.steps.length, 0);
	assert.equal((await store.load('a.md'))?.id, 'id-1');
});

void test('buffering captures edits while creation is delayed and Stop closes the gate immediately', async () => {
	const { adapter, controller } = setup();
	const gate = deferred();
	adapter.before = async (_operation, path) => { if (path.endsWith('initial.json')) await gate.promise; };
	const start = controller.start('a.md', 'A');
	capture(controller, 'a.md', 'A', 'AB');
	const stop = controller.stop('a.md');
	capture(controller, 'a.md', 'AB', 'Unrecorded');
	await assert.rejects(controller.start('a.md', 'Unrecorded'));
	gate.resolve();
	await Promise.all([start, stop]);
	assert.equal(controller.status('a.md'), 'stopped');
	const file = await controller.stoppedRecording('a.md');
	assert.ok(file);
	assert.equal(getStateAt(file, file.steps.length), 'AB');
});

void test('delayed history load rebases resume and buffered edits at the request snapshot', async () => {
	const adapter = new MemoryAdapter();
	const old = setup(adapter);
	await old.controller.start('a.md', 'Old');
	await old.controller.stop('a.md');
	const { controller } = setup(adapter);
	const gate = deferred();
	adapter.before = async (operation, path) => { if (operation === 'read' && path.endsWith('initial.json')) await gate.promise; };
	const start = controller.start('a.md', 'Changed');
	capture(controller, 'a.md', 'Changed', 'Changed again');
	gate.resolve();
	await start;
	await controller.stop('a.md');
	const file = await controller.stoppedRecording('a.md');
	assert.ok(file);
	assert.deepEqual([0, 1, 2].map((sequence) => getStateAt(file, sequence)), ['Old', 'Changed', 'Changed again']);
});

void test('reload is stopped, does not capture, and keeps the same recording identity', async () => {
	const adapter = new MemoryAdapter();
	const first = setup(adapter);
	await first.controller.start('a.md', 'A');
	capture(first.controller, 'a.md', 'A', 'B');
	await first.controller.stop('a.md');
	const second = setup(adapter);
	await second.controller.inspect('a.md');
	assert.equal(second.controller.status('a.md'), 'stopped');
	capture(second.controller, 'a.md', 'B', 'Unrecorded');
	await second.controller.start('a.md', 'Unrecorded');
	await second.controller.stop('a.md');
	assert.equal((await second.store.load('a.md'))?.id, 'id-1');
	assert.equal((await second.controller.stoppedRecording('a.md'))?.steps.length, 2);
});

void test('independent notes and mirrored pane updates do not mix or duplicate steps', async () => {
	const { controller } = setup();
	await controller.start('a.md', 'A');
	await controller.start('b.md', 'B');
	capture(controller, 'a.md', 'A', 'AA');
	capture(controller, 'a.md', 'A', 'AA');
	await controller.flush('a.md');
	assert.equal(controller.status('a.md'), 'recording');
	capture(controller, 'b.md', 'B', 'BB');
	await Promise.all([controller.stop('a.md'), controller.stop('b.md')]);
	assert.equal((await controller.stoppedRecording('a.md'))?.steps.length, 1);
	assert.equal((await controller.stoppedRecording('b.md'))?.steps.length, 1);
});

void test('invalid capture stops recording once and valid data can be saved before resuming', async () => {
	const { controller, errors } = setup();
	await controller.start('a.md', 'A');
	capture(controller, 'a.md', 'Wrong', 'Invalid');
	capture(controller, 'a.md', 'Wrong', 'Invalid again');
	assert.equal(errors.length, 1);
	assert.equal(controller.status('a.md'), 'error');
	await assert.rejects(controller.stoppedRecording('a.md'));
	await controller.stop('a.md');
	await controller.start('a.md', 'Current');
	await controller.stop('a.md');
	assert.equal((await controller.stoppedRecording('a.md'))?.steps[0]?.kind, 'resume');
});

void test('save failure closes capture and explicit Stop retries without lost or duplicate steps', async () => {
	const { adapter, controller, clock, errors } = setup();
	await controller.start('a.md', 'A');
	capture(controller, 'a.md', 'A', 'B');
	adapter.after = async (operation) => { if (operation === 'append') throw new Error('Uncertain write'); };
	await assert.rejects(controller.stop('a.md'));
	assert.equal(controller.status('a.md'), 'error');
	assert.equal(errors.length, 1);
	capture(controller, 'a.md', 'B', 'Not captured');
	adapter.after = undefined;
	await controller.stop('a.md');
	assert.equal((await controller.stoppedRecording('a.md'))?.steps.length, 1);
	assert.equal(clock.size, 0);
});

void test('initial creation failure retains buffered edits for retry', async () => {
	const { adapter, controller } = setup();
	adapter.before = async (_operation, path) => { if (path.endsWith('index.json')) throw new Error('Failed creation'); };
	const start = controller.start('a.md', 'A');
	capture(controller, 'a.md', 'A', 'AB');
	await assert.rejects(start);
	adapter.before = undefined;
	await controller.stop('a.md');
	const file = await controller.stoppedRecording('a.md');
	assert.ok(file);
	assert.equal(getStateAt(file, 1), 'AB');
});

void test('file/folder rename and subsequent edits retain identities and states', async () => {
	const { controller, store } = setup();
	await controller.start('old/a.md', 'A');
	await controller.start('old/b.md', 'B');
	await controller.rename('old', 'new');
	capture(controller, 'new/a.md', 'A', 'AA');
	await controller.rename('new/a.md', 'new/c.md');
	await controller.stop('new/c.md');
	await controller.stop('new/b.md');
	assert.equal((await store.load('new/c.md'))?.id, 'id-1');
	assert.equal((await store.load('new/b.md'))?.id, 'id-2');
	assert.equal((await controller.stoppedRecording('new/c.md'))?.steps.length, 1);
});

void test('dispose during delayed Start saves captured data without reopening capture or leaving timers', async () => {
	const { adapter, controller, clock, store } = setup();
	const gate = deferred();
	adapter.before = async (_operation, path) => { if (path.endsWith('initial.json')) await gate.promise; };
	const start = controller.start('a.md', 'A');
	capture(controller, 'a.md', 'A', 'B');
	const dispose = controller.dispose();
	capture(controller, 'a.md', 'B', 'Ignored');
	gate.resolve();
	await Promise.all([start, dispose]);
	assert.equal(controller.status('a.md'), 'stopped');
	assert.equal(clock.size, 0);
	await assert.rejects(controller.start('a.md', 'Ignored'));
	await assert.rejects(controller.stoppedRecording('a.md'));
	assert.equal((await store.load('a.md'))?.recording.steps.length, 1);
});

void test('rename immediately after Resume cannot create a second recording', async () => {
	const { controller, store } = setup();
	await controller.start('old.md', 'A');
	await controller.stop('old.md');
	const start = controller.start('old.md', 'Changed');
	const rename = controller.rename('old.md', 'new.md');
	capture(controller, 'new.md', 'Changed', 'Changed more');
	await Promise.all([start, rename]);
	await controller.stop('new.md');
	assert.equal(await store.load('old.md'), null);
	assert.equal((await store.load('new.md'))?.id, 'id-1');
	assert.equal((await controller.stoppedRecording('new.md'))?.steps.length, 2);
});

void test('failed rename is retried on Stop while retaining the same active identity', async () => {
	const { adapter, controller, store } = setup();
	await controller.start('old.md', 'A');
	await controller.start('unrelated.md', 'Other');
	capture(controller, 'old.md', 'A', 'AB');
	adapter.before = async (_operation, path) => { if (path.endsWith('index.json')) throw new Error('Rename failure'); };
	await assert.rejects(controller.rename('old.md', 'new.md'));
	assert.equal(controller.status('new.md'), 'error');
	assert.equal(controller.status('unrelated.md'), 'recording');
	adapter.before = undefined;
	await controller.stop('new.md');
	assert.equal((await store.load('new.md'))?.id, 'id-1');
	assert.equal((await store.load('new.md'))?.finalText, 'AB');
	await controller.stop('unrelated.md');
});

void test('background save failure closes the capture gate and reports one error', async () => {
	const { adapter, controller, clock, errors } = setup();
	await controller.start('a.md', 'A');
	adapter.before = async (operation) => { if (operation === 'append') throw new Error('Save failure'); };
	capture(controller, 'a.md', 'A', 'AB');
	clock.advance(500);
	await assert.rejects(controller.flush('a.md'));
	assert.equal(controller.status('a.md'), 'error');
	assert.equal(errors.length, 1);
	capture(controller, 'a.md', 'AB', 'Ignored');
	adapter.before = undefined;
	await controller.stop('a.md');
	assert.equal((await controller.stoppedRecording('a.md'))?.steps.length, 1);
	assert.equal(clock.size, 0);
});

void test('recording status inspection follows a concurrent rename', async () => {
	const { adapter, controller } = setup();
	await controller.start('old.md', 'A');
	await controller.stop('old.md');
	const restarted = setup(adapter).controller;
	const inspection = restarted.inspect('old.md');
	const rename = restarted.rename('old.md', 'new.md');
	await Promise.all([inspection, rename]);
	assert.equal(restarted.status('new.md'), 'stopped');
	assert.equal(restarted.status('old.md'), 'absent');
});
