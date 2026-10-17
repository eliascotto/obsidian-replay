import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ExportController, type ExportResult } from '../../src/export/export-controller';
import { ExportCommitQueue } from '../../src/export/commit-queue';
import { parseRecording } from '../../src/recording/format';
import { getStateAt } from '../../src/recording/engine';
import { setup, seed, capture } from '../support/replay';
import { deferred } from '../support/storage';
import { MemoryExportAdapter } from '../support/export';

async function context() {
	const base = setup();
	await seed(base);
	const destination = new MemoryExportAdapter();
	const results: ExportResult[] = [];
	const queue = new ExportCommitQueue();
	const make = (path = 'a.md') => new ExportController(path, base.recordings, destination,
		{ configDir: '.settings', pluginDir: '.settings/plugins/replay' }, (source) => base.present.has(source), queue, (result) => results.push(result));
	return { ...base, destination, results, make };
}

void test('export saves the complete stopped revision without changing note/history or retargeting to live edits', async () => {
	const c = await context();
	const original = new Map(c.adapter.files);
	const request = c.make();
	await request.prepare();
	assert.equal(request.state.lastSequence, 1);
	assert.equal(request.canSave, true);
	await request.save('exports/article.replay.json');
	assert.equal(request.state.phase, 'success');
	assert.equal(request.canSave, false);
	const saved = parseRecording(c.destination.files.get('exports/article.replay.json')!);
	assert.equal(saved.initialText, 'A');
	assert.equal(getStateAt(saved, saved.steps.length), 'AB');
	assert.deepEqual(c.adapter.files, original);
	request.close();
});

void test('export cannot auto-stop starting, recording, stopping or unresolved-error sessions', async () => {
	const c = await context();
	const start = c.recordings.start('a.md', 'AB');
	const starting = c.make(); await starting.prepare();
	assert.equal(starting.canSave, false); starting.close(); await start;
	const active = c.make(); await active.prepare();
	assert.equal(c.recordings.status('a.md'), 'recording'); assert.equal(active.canSave, false); active.close();
	capture(c.recordings, 'a.md', 'AB', 'ABC');
	const gate = deferred(); c.adapter.before = async (operation) => { if (operation === 'append') await gate.promise; };
	const stop = c.recordings.stop('a.md');
	const stopping = c.make(); await stopping.prepare();
	assert.equal(stopping.canSave, false); stopping.close(); gate.resolve(); await stop; c.adapter.before = undefined;
	await c.recordings.start('a.md', 'ABC'); capture(c.recordings, 'a.md', 'Wrong', 'Invalid');
	const failed = c.make(); await failed.prepare();
	assert.equal(c.recordings.status('a.md'), 'error'); assert.equal(failed.canSave, false);
	await failed.save('a.replay.json'); assert.equal(c.destination.calls.length, 0); failed.close(); await c.recordings.stop('a.md');
});

for (const action of ['cycle', 'rename', 'delete', 'close', 'dispose'] as const) {
	void test(`${action} during a delayed preparation prevents export`, async () => {
		const c = await context();
		c.store.hold = 'a.md'; const request = c.make(); const pending = request.prepare(); await c.store.loaded.promise;
		if (action === 'cycle') { await c.recordings.start('a.md', 'New'); await c.recordings.stop('a.md'); }
		else if (action === 'rename') await c.recordings.rename('a.md', 'renamed.md');
		else if (action === 'delete') { c.present.delete('a.md'); request.remove('a.md'); }
		else request[action]();
		c.store.releaseLoad.resolve(); await pending;
		await request.save('a.replay.json');
		assert.equal(c.destination.calls.length, 0); assert.equal(request.canSave, false); request.close();
	});
}

void test('stopped unrecorded edits and recording another note do not invalidate a prepared export', async () => {
	const c = await context(); const request = c.make(); await request.prepare();
	await c.recordings.start('b.md', 'Unrelated');
	await request.save('a.replay.json'); assert.equal(request.state.phase, 'success');
	assert.equal(getStateAt(parseRecording(c.destination.files.get('a.replay.json')!), 1), 'AB');
	await c.recordings.stop('b.md'); request.close();
});

void test('invalid, existing, missing-folder and case-collision destinations do not create or overwrite files', async () => {
	const c = await context(); const request = c.make(); await request.prepare();
	c.destination.files.set('taken.replay.json', 'KEEP'); c.destination.caseInsensitive = true;
	for (const path of ['../bad.replay.json', '.settings/bad.replay.json', 'missing/a.replay.json', 'taken.replay.json', 'TAKEN.replay.json']) {
		await request.save(path); assert.equal(request.state.phase, 'error'); assert.equal(request.canSave, true);
	}
	request.editDestination(); assert.equal(request.state.phase, 'ready');
	assert.equal(c.destination.calls.length, 0); assert.equal(c.destination.files.get('taken.replay.json'), 'KEEP');
	await request.save('free.replay.json'); assert.equal(request.state.phase, 'success'); request.close();
});

void test('missing/corrupt source histories are preserved and cannot be exported', async () => {
	for (const corrupt of [false, true]) {
		const c = await context();
		if (corrupt) c.adapter.files.set('recordings/id-1/steps.ndjson', '{broken}\n');
		else c.present.delete('a.md');
		const original = new Map(c.adapter.files); const request = c.make(); await request.prepare();
		assert.equal(request.canSave, false); await request.save('a.replay.json');
		assert.equal(c.destination.calls.length, 0); assert.deepEqual(c.adapter.files, original); request.close();
	}
});

void test('a canceled queued request never creates a second destination', async () => {
	const c = await context(); const first = c.make(); const second = c.make(); await first.prepare(); await second.prepare();
	const entered = deferred(); const gate = deferred();
	c.destination.after = async () => { entered.resolve(); await gate.promise; };
	const save = first.save('first.replay.json'); await entered.promise;
	const other = second.save('canceled.replay.json'); second.close(); gate.resolve(); await Promise.all([save, other]);
	assert.deepEqual([...c.destination.files.keys()], ['first.replay.json']); first.close();
});

void test('close or source invalidation during destination checks prevents the create call', async () => {
	for (const close of [false, true]) {
		const c = await context(); const request = c.make(); await request.prepare();
		const entered = deferred(); const gate = deferred();
		c.destination.before = async (operation) => { if (operation === 'exists') { entered.resolve(); await gate.promise; } };
		const save = request.save('a.replay.json'); await entered.promise;
		if (close) request.close(); else { await c.recordings.start('a.md', 'New'); await c.recordings.stop('a.md'); }
		gate.resolve(); await save; assert.equal(c.destination.calls.length, 0); request.close();
	}
});

void test('duplicate submissions join one save and separate requests serialize destination commits', async () => {
	const c = await context(); const first = c.make(); const second = c.make(); await first.prepare(); await second.prepare();
	const entered = deferred(); const gate = deferred();
	c.destination.before = async (operation) => { if (operation === 'create') { entered.resolve(); await gate.promise; } };
	const save = first.save('a.replay.json'); assert.equal(first.save('other.replay.json'), save); await entered.promise;
	const other = second.save('a.replay.json'); gate.resolve(); await Promise.all([save, other]);
	assert.equal(c.destination.calls.length, 1); assert.equal(first.state.phase, 'success'); assert.equal(second.state.phase, 'error');
	first.close(); second.close();
});

for (const action of ['close', 'cycle', 'dispose'] as const) {
	void test(`${action} after create begins keeps the original artifact and reports only while loaded`, async () => {
		const c = await context(); const request = c.make(); await request.prepare();
		const entered = deferred(); const gate = deferred();
		c.destination.after = async (operation) => { if (operation === 'create') { entered.resolve(); await gate.promise; } };
		const save = request.save('a.replay.json'); await entered.promise;
		if (action === 'cycle') { await c.recordings.start('a.md', 'A newer live note'); await c.recordings.stop('a.md'); }
		else request[action]();
		gate.resolve(); await save;
		const saved = parseRecording(c.destination.files.get('a.replay.json')!);
		assert.equal(getStateAt(saved, saved.steps.length), 'AB'); assert.equal(c.destination.calls.length, 1);
		assert.equal(c.results.length, action === 'close' ? 1 : 0);
		if (action === 'cycle') assert.equal(request.state.phase, 'success');
		request.close();
	});
}

for (const failure of ['create-before', 'create-after', 'read', 'altered', 'collision'] as const) {
	void test(`${failure} cannot cause false success, overwrite, destructive cleanup or duplicate retry`, async () => {
		const c = await context(); const request = c.make(); await request.prepare(); const source = new Map(c.adapter.files);
		if (failure === 'altered') c.destination.transform = (text) => text.slice(0, -8);
		c.destination.before = async (operation, path) => {
			if ((failure === 'create-before' && operation === 'create') || (failure === 'read' && operation === 'read')) throw new Error('Failure');
			if (failure === 'collision' && operation === 'create') c.destination.files.set(path, 'Existing competitor');
		};
		c.destination.after = async () => { if (failure === 'create-after') throw new Error('Uncertain outcome'); };
		await request.save('a.replay.json'); assert.equal(request.state.phase, 'error'); assert.match(request.state.message, /may exist/);
		assert.deepEqual(c.adapter.files, source);
		const writes = c.destination.calls.length; await request.save('a.replay.json'); assert.equal(c.destination.calls.length, writes);
		if (failure === 'collision') assert.equal(c.destination.files.get('a.replay.json'), 'Existing competitor');
		request.close();
	});
}
