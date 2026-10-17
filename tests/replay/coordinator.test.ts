import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RecordingController } from '../../src/recording/controller';
import { deferred } from '../support/storage';
import { setup, capture, seed, player, readyAt } from '../support/replay';

void test('reopening a valid recording preserves the same player, selection, and single timer', async () => {
	const context = setup();
	await seed(context);
	await context.replay.open('a.md');
	const first = player(context.replay);
	first.play();
	await context.replay.open('a.md');
	assert.equal(player(context.replay), first);
	assert.equal(context.clock.size, 1);
	context.clock.advance(150);
	assert.equal(first.state.sequence, 1);
	await context.replay.open('a.md');
	assert.equal(first.state.sequence, 1);
	assert.equal(context.clock.size, 0);
});

void test('replay leaves live-note state and stored recording data unchanged', async () => {
	const context = setup();
	await seed(context);
	const files = new Map(context.adapter.files);
	const calls = context.adapter.calls.length;
	let liveText = 'Unrecorded current article';
	await context.replay.open('a.md');
	const view = player(context.replay);
	assert.equal(view.finalText, 'AB');
	view.play();
	context.clock.advance(1000);
	view.previous();
	view.requestSeek(1);
	view.commitSeek();
	view.select(0);
	liveText += ' with another unrecorded change';
	assert.equal(view.finalText, 'AB');
	assert.equal(liveText, 'Unrecorded current article with another unrecorded change');
	assert.deepEqual(context.adapter.files, files);
	assert.equal(context.adapter.calls.length, calls);
	assert.equal((await context.store.load('a.md'))?.recording.steps.length, 1);
});

void test('Start invalidates paused/playing replay synchronously before capture opens', async () => {
	for (const playing of [false, true]) {
		const context = setup();
		await seed(context);
		await context.replay.open('a.md');
		const old = player(context.replay);
		if (playing) old.play();
		let observedBeforeCapture = false;
		context.recordings.replayAccess.subscribe((event) => {
			if (event.type === 'invalidate' && event.path === 'a.md') {
				observedBeforeCapture ||= !context.recordings.isCapturing('a.md') && context.replay.state.phase === 'unavailable';
			}
		});
		const start = context.recordings.start('a.md', 'Current');
		assert.equal(context.replay.state.phase, 'unavailable');
		assert.equal(context.clock.size, 0);
		assert.ok(observedBeforeCapture);
		context.clock.advance(1000);
		assert.equal(old.state.sequence, 0);
		await start;
		capture(context.recordings, 'a.md', 'Current', 'New ending');
		await context.recordings.stop('a.md');
		assert.equal(context.replay.state.phase, 'unavailable');
		await context.replay.open('a.md');
		assert.equal(player(context.replay).finalText, 'New ending');
		assert.equal(player(context.replay).state.playing, false);
	}
});

void test('opening while recording, starting, saving, or in error never auto-stops or plays', async () => {
	const context = setup();
	context.present.add('a.md');
	const start = context.recordings.start('a.md', 'A');
	await context.replay.open('a.md');
	assert.equal(context.replay.state.phase, 'unavailable');
	await start;
	await context.replay.open('a.md');
	assert.equal(context.recordings.status('a.md'), 'recording');
	capture(context.recordings, 'a.md', 'A', 'AB');
	const gate = deferred();
	context.adapter.before = async (operation) => { if (operation === 'append') await gate.promise; };
	const stop = context.recordings.stop('a.md');
	await context.replay.open('a.md');
	assert.equal(context.replay.state.phase, 'unavailable');
	gate.resolve();
	await stop;
	context.adapter.before = undefined;
	await context.recordings.start('a.md', 'AB');
	capture(context.recordings, 'a.md', 'Wrong', 'Invalid');
	assert.equal(context.recordings.status('a.md'), 'error');
	await context.replay.open('a.md');
	assert.equal(context.replay.state.phase, 'unavailable');
	assert.equal(context.clock.size, 0);
	await context.recordings.stop('a.md');
});

void test('starting another note does not interrupt a stopped recording replay', async () => {
	const context = setup();
	await seed(context);
	await context.replay.open('a.md');
	const view = player(context.replay);
	view.play();
	await context.recordings.start('b.md', 'Other note');
	assert.equal(player(context.replay), view);
	context.clock.advance(150);
	assert.equal(view.state.sequence, 1);
	await context.recordings.stop('b.md');
});

void test('stopped snapshot loader rejects an old result even after Start and Stop both finish', async () => {
	const context = setup();
	await seed(context);
	context.store.hold = 'a.md';
	const stale = context.recordings.stoppedSnapshot('a.md');
	await context.store.loaded.promise;
	await context.recordings.start('a.md', 'New snapshot');
	await context.recordings.stop('a.md');
	context.store.releaseLoad.resolve();
	await assert.rejects(stale, /changed while replay was loading/);
});

void test('pending replay load cannot attach after a complete Start/Stop cycle', async () => {
	const context = setup();
	await seed(context);
	context.store.hold = 'a.md';
	const pending = context.replay.open('a.md');
	await context.store.loaded.promise;
	await context.recordings.start('a.md', 'New snapshot');
	await context.recordings.stop('a.md');
	context.store.releaseLoad.resolve();
	await pending;
	assert.equal(context.replay.state.phase, 'unavailable');
	assert.equal(context.clock.size, 0);
	await context.replay.open('a.md');
	assert.equal(player(context.replay).finalText, 'New snapshot');
});

void test('a folder rename invalidates a snapshot loaded after restart without an active session', async () => {
	const context = setup();
	await seed(context, 'folder/a.md');
	const restarted = new RecordingController(context.store, () => undefined, context.recordingClock);
	context.store.hold = 'folder/a.md';
	const stale = restarted.stoppedSnapshot('folder/a.md');
	await context.store.loaded.promise;
	await restarted.rename('folder', 'moved');
	context.store.releaseLoad.resolve();
	await assert.rejects(stale, /changed while replay was loading/);
	const current = await restarted.stoppedSnapshot('moved/a.md');
	assert.equal(current?.id, 'id-1');
	assert.ok(current && restarted.isReplayCurrent(current));
});

void test('slow Open A cannot overwrite a later Open B', async () => {
	const context = setup();
	await seed(context, 'a.md', 'A');
	await seed(context, 'b.md', 'Other');
	context.store.hold = 'a.md';
	const pending = context.replay.open('a.md');
	await context.store.loaded.promise;
	await context.replay.open('b.md');
	assert.equal(context.replay.state.path, 'b.md');
	context.store.releaseLoad.resolve();
	await pending;
	assert.equal(context.replay.state.path, 'b.md');
	assert.equal(player(context.replay).finalText, 'OtherB');
});

for (const action of ['close', 'dispose', 'delete'] as const) {
	void test(`${action} prevents a slow load from attaching`, async () => {
		const context = setup();
		await seed(context);
		context.store.hold = 'a.md';
		const pending = context.replay.open('a.md');
		await context.store.loaded.promise;
		if (action === 'delete') { context.present.delete('a.md'); context.replay.remove('a.md'); }
		else context.replay[action]();
		context.store.releaseLoad.resolve();
		await pending;
		assert.equal(context.replay.state.phase, action === 'delete' ? 'unavailable' : 'idle');
		assert.equal(context.clock.size, 0);
	});
}

void test('renaming a ready recording preserves identity and selection, pauses, and updates the path', async () => {
	const context = setup();
	await seed(context, 'folder/a.md');
	await context.replay.open('folder/a.md');
	player(context.replay).next();
	context.present.delete('folder/a.md');
	context.present.add('moved/a.md');
	const ready = readyAt(context.replay, 'moved/a.md');
	await context.recordings.rename('folder', 'moved');
	await ready;
	const state = context.replay.state;
	assert.ok(state.phase === 'ready');
	assert.equal(state.reference.id, 'id-1');
	assert.equal(state.player.state.sequence, 1);
	assert.equal(state.player.state.playing, false);
	assert.equal(context.clock.size, 0);
});

void test('rename while loading discards the old path result and binds the same recording', async () => {
	const context = setup();
	await seed(context);
	context.store.hold = 'a.md';
	const pending = context.replay.open('a.md');
	await context.store.loaded.promise;
	context.present.delete('a.md');
	context.present.add('renamed.md');
	const ready = readyAt(context.replay, 'renamed.md');
	await context.recordings.rename('a.md', 'renamed.md');
	await ready;
	context.store.releaseLoad.resolve();
	await pending;
	assert.equal(context.replay.state.path, 'renamed.md');
	assert.equal(player(context.replay).finalText, 'AB');
});

void test('corrupt or missing recordings expose an error without a partial player', async () => {
	const context = setup();
	await seed(context);
	context.adapter.files.set('recordings/id-1/steps.ndjson', '{invalid}\n');
	await context.replay.open('a.md');
	assert.equal(context.replay.state.phase, 'unavailable');
	assert.equal(context.clock.size, 0);
	await context.replay.open('missing.md');
	assert.equal(context.replay.state.phase, 'unavailable');
	assert.equal(context.replay.state.path, 'missing.md');
});

void test('close, rebind, and plugin disposal stop a loaded player and cancel pending seeks', async () => {
	const context = setup();
	await seed(context);
	await seed(context, 'b.md', 'B');
	await context.replay.open('a.md');
	const old = player(context.replay);
	old.requestSeek(1);
	await context.replay.open('b.md');
	assert.equal(context.clock.size, 0);
	player(context.replay).play();
	await context.recordings.dispose();
	assert.equal(context.replay.state.phase, 'idle');
	assert.equal(context.clock.size, 0);
	context.clock.advance(1000);
	assert.equal(old.state.sequence, 0);
	context.replay.dispose();
});

