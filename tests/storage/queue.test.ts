import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WriteQueue } from '../../src/storage/write-queue';
import type { RecordingStep } from '../../src/recording/types';
import { FakeClock, deferred } from '../support/storage';
import { spliceStep } from '../recording/helpers';

void test('idle timeout flushes at 500 ms and cancels timers', async () => {
	const clock = new FakeClock();
	const batches: (readonly RecordingStep[])[] = [];
	const queue = new WriteQueue(async (batch) => { batches.push(batch); }, (error) => assert.fail(error instanceof Error ? error : 'Unexpected save error'), clock);
	queue.enqueue(spliceStep('a', 1, 1, 'b'));
	clock.advance(499);
	assert.equal(batches.length, 0);
	clock.advance(1);
	await queue.flush();
	assert.equal(batches.length, 1);
	assert.equal(queue.size, 0);
	assert.equal(clock.size, 0);
});

void test('continuous typing cannot postpone the maximum-wait timer', async () => {
	const clock = new FakeClock();
	let writes = 0;
	const queue = new WriteQueue(async () => { writes++; }, (error) => assert.fail(error instanceof Error ? error : 'Unexpected save error'), clock);
	for (let n = 1; n <= 5; n++) {
		queue.enqueue(spliceStep('', 0, 0, 'x', n));
		clock.advance(400);
	}
	await queue.flush();
	assert.equal(writes, 1);
	assert.equal(clock.size, 0);
});

void test('50 pending steps trigger a flush without waiting for a timer', async () => {
	const clock = new FakeClock();
	let writes = 0;
	const queue = new WriteQueue(async () => { writes++; }, (error) => assert.fail(error instanceof Error ? error : 'Unexpected save error'), clock);
	for (let n = 1; n <= 50; n++) queue.enqueue(spliceStep('', 0, 0, 'x', n));
	assert.equal(writes, 1);
	await queue.flush();
	assert.equal(queue.size, 0);
});

void test('concurrent flushes and edits during a write drain in order', async () => {
	const clock = new FakeClock();
	const gate = deferred();
	const batches: number[][] = [];
	const queue = new WriteQueue(async (batch) => {
		batches.push(batch.map((step) => step.sequence));
		if (batches.length === 1) await gate.promise;
	}, (error) => assert.fail(error instanceof Error ? error : 'Unexpected save error'), clock);
	queue.enqueue(spliceStep('', 0, 0, 'x', 1));
	const first = queue.flush();
	const joined = queue.flush();
	queue.enqueue(spliceStep('x', 1, 1, 'y', 2));
	gate.resolve();
	await Promise.all([first, joined]);
	assert.deepEqual(batches, [[1], [2]]);
	assert.equal(queue.size, 0);
	assert.equal(clock.size, 0);
});

void test('failed writes retain the same batch for explicit retry', async () => {
	const clock = new FakeClock();
	let fail = true;
	const batches: number[][] = [];
	const queue = new WriteQueue(async (batch) => {
		batches.push(batch.map((step) => step.sequence));
		if (fail) throw new Error('Write failed');
	}, (error) => assert.fail(error instanceof Error ? error : 'Unexpected save error'), clock);
	queue.enqueue(spliceStep('', 0, 0, 'x'));
	await assert.rejects(queue.flush());
	assert.equal(queue.size, 1);
	assert.equal(clock.size, 0);
	fail = false;
	await queue.flush();
	assert.deepEqual(batches, [[1], [1]]);
	assert.equal(queue.size, 0);
});

void test('dispose cancels scheduled saves but permits a final explicit flush', async () => {
	const clock = new FakeClock();
	let writes = 0;
	const queue = new WriteQueue(async () => { writes++; }, (error) => assert.fail(error instanceof Error ? error : 'Unexpected save error'), clock);
	queue.enqueue(spliceStep('', 0, 0, 'x'));
	queue.dispose();
	clock.advance(3000);
	assert.equal(writes, 0);
	assert.equal(clock.size, 0);
	await queue.flush();
	assert.equal(writes, 1);
});

void test('a flush joining a settled drain still saves a newly arrived step', async () => {
	const clock = new FakeClock();
	let writes = 0;
	let joined: Promise<void> | undefined;
	const queue = new WriteQueue(async () => {
		writes++;
		if (writes === 1) {
			queueMicrotask(() => queueMicrotask(() => {
				queue.enqueue(spliceStep('x', 1, 1, 'y', 2));
				joined = queue.flush();
			}));
		}
	}, (error) => assert.fail(error instanceof Error ? error : 'Unexpected save error'), clock);
	queue.enqueue(spliceStep('', 0, 0, 'x'));
	await queue.flush();
	await joined;
	assert.equal(writes, 2);
	assert.equal(queue.size, 0);
	assert.equal(clock.size, 0);
});
