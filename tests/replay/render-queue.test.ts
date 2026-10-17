import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RenderQueue } from '../../src/replay/render-queue';
import { deferred } from '../support/storage';

function setup() {
	const started: string[] = [], committed: string[] = [], released: string[] = [], failed: string[] = [];
	const gates = new Map<string, ReturnType<typeof deferred<void>>>();
	const busy: boolean[] = [];
	const queue = new RenderQueue<string>((value) => {
		started.push(value);
		const gate = deferred();
		gates.set(value, gate);
		return { ready: gate.promise, commit: () => { committed.push(value); }, dispose: () => { released.push(value); } };
	}, (value) => { failed.push(value); }, (value) => { busy.push(value); });
	async function finish(value: string, error = false) {
		const gate = gates.get(value);
		assert.ok(gate);
		if (error) gate.reject(new Error('Renderer failed'));
		else gate.resolve();
		await gate.promise.catch(() => undefined);
	}
	return { queue, started, committed, released, failed, busy, finish };
}

void test('slow playback renders coalesce to one active and the latest pending step, including the endpoint', async () => {
	const context = setup();
	context.queue.request('first');
	context.queue.request('middle');
	context.queue.request('endpoint');
	assert.deepEqual(context.started, ['first']);
	await context.finish('first');
	assert.deepEqual(context.committed, []);
	assert.deepEqual(context.released, ['first']);
	assert.deepEqual(context.started, ['first', 'endpoint']);
	await context.finish('endpoint');
	assert.deepEqual(context.committed, ['endpoint']);
	assert.equal(context.busy.at(-1), false);
	context.queue.dispose();
	assert.deepEqual(context.released, ['first', 'endpoint']);
});

for (const cause of ['Doomed source mode', 'capture exclusion', 'invalid file', 'rename', 'another file']) {
	void test(`${cause} invalidates an outstanding preview and discards its pending work`, async () => {
		const context = setup();
		context.queue.request('old');
		context.queue.request('pending');
		context.queue.clear();
		assert.deepEqual(context.released, ['old']);
		context.queue.request('current');
		await context.finish('old');
		assert.deepEqual(context.committed, []);
		assert.deepEqual(context.started, ['old', 'current']);
		await context.finish('current');
		assert.deepEqual(context.committed, ['current']);
		context.queue.dispose();
		assert.deepEqual(context.released, ['old', 'current']);
	});
}

void test('a committed frame lives until its replacement is ready, then is disposed once', async () => {
	const context = setup();
	context.queue.request('first');
	await context.finish('first');
	context.queue.request('second');
	assert.deepEqual(context.released, []);
	await context.finish('second');
	assert.deepEqual(context.committed, ['first', 'second']);
	assert.deepEqual(context.released, ['first']);
	context.queue.clear(); context.queue.dispose();
	assert.deepEqual(context.released, ['first', 'second']);
});

void test('only current renderer failures show fallback; stale failures cannot replace another mode', async () => {
	const context = setup();
	context.queue.request('stale');
	context.queue.clear();
	context.queue.request('current');
	await context.finish('stale', true);
	assert.deepEqual(context.failed, []);
	await context.finish('current', true);
	assert.deepEqual(context.failed, ['current']);
	assert.deepEqual(context.released, ['stale', 'current']);
	context.queue.request('recovered');
	await context.finish('recovered');
	assert.deepEqual(context.committed, ['recovered']);
	context.queue.dispose();
});

void test('close disposes in-flight resources immediately and late completion cannot recreate the view', async () => {
	const context = setup();
	context.queue.request('old');
	context.queue.request('pending');
	context.queue.dispose();
	assert.deepEqual(context.released, ['old']);
	context.queue.request('after disposal');
	await context.finish('old');
	assert.deepEqual(context.committed, []);
	assert.deepEqual(context.failed, []);
	assert.deepEqual(context.started, ['old']);
	assert.deepEqual(context.released, ['old']);
	assert.equal(context.busy.at(-1), false);
});

void test('synchronous startup and commit failures release resources and allow the next request', async () => {
	const released: string[] = [], failed: string[] = [];
	const queue = new RenderQueue<string>((value) => {
		if (value === 'start failure') throw new Error('start');
		return { ready: Promise.resolve(), commit: () => { throw new Error('commit'); }, dispose: () => { released.push(value); } };
	}, (value) => { failed.push(value); }, () => undefined);
	queue.request('start failure');
	queue.request('commit failure');
	await Promise.resolve();
	assert.deepEqual(failed, ['start failure', 'commit failure']);
	assert.deepEqual(released, ['commit failure']);
	queue.dispose();
});
