import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ReplayController } from '../../src/replay/controller';
import { DoomedPresentation, DOOMED_CACHE_LIMITS } from '../../src/replay/doomed-presentation';
import { compareDoomed, type DoomedComparison } from '../../src/replay/doomed';
import { FakeClock } from '../support/storage';
import { loadFixture, recording, spliceStep } from '../recording/helpers';

void test('toggling preserves paused/playing replay state, schedules and pending seeks', () => {
	const clock = new FakeClock();
	const player = new ReplayController(loadFixture('revision'), clock);
	const presentation = new DoomedPresentation();
	presentation.bind(player);
	assert.equal(presentation.display.enabled, false);
	for (const playing of [false, true]) {
		if (playing) player.play();
		const before = player.state;
		const timers = clock.size;
		presentation.toggle();
		assert.deepEqual(presentation.display.ranges, [{ from: 4, to: 14 }]);
		assert.deepEqual(player.state, before);
		assert.equal(clock.size, timers);
		presentation.toggle();
		assert.equal(presentation.display.ranges.length, 0);
		assert.deepEqual(player.state, before);
	}
	player.requestSeek(1);
	const pending = player.state;
	presentation.toggle();
	assert.equal(presentation.display.enabled, true);
	assert.deepEqual(player.state, pending);
	clock.advance(16);
	assert.deepEqual(presentation.display.ranges, [{ from: 7, to: 14 }]);
	player.select(2);
	assert.deepEqual(presentation.display.ranges, []);
});

void test('disabled presentation does no work and cached empty/unavailable results are valid hits', () => {
	let calls = 0;
	const presentation = new DoomedPresentation((before, after) => { calls++; return compareDoomed(before, after); });
	const player = new ReplayController(loadFixture('revision'), new FakeClock());
	presentation.bind(player);
	void presentation.display;
	assert.equal(calls, 0);
	presentation.toggle();
	void presentation.display;
	player.play();
	player.pause();
	player.setRate(2);
	player.requestSeek(1);
	void presentation.display;
	assert.equal(calls, 1);
	player.commitSeek();
	void presentation.display;
	player.select(2);
	assert.deepEqual(presentation.display.ranges, []);
	player.select(1);
	void presentation.display;
	player.select(2);
	assert.deepEqual(presentation.display.ranges, []);
	assert.equal(calls, 3);
	player.select(0);
	presentation.toggle();
	void presentation.display;
	assert.equal(calls, 3);
	presentation.toggle();
	void presentation.display;
	assert.equal(calls, 3);
});

void test('rebind/disposal resets the toggle and cannot reuse another player endpoint', () => {
	const clock = new FakeClock();
	const first = new ReplayController(recording('cat', [spliceStep('cat', 0, 3, 'dog')]), clock);
	const next = new ReplayController(recording('cat', [spliceStep('cat', 0, 3, 'cats')]), clock);
	const presentation = new DoomedPresentation();
	presentation.bind(first);
	presentation.toggle();
	assert.deepEqual(presentation.display.ranges, [{ from: 0, to: 3 }]);
	presentation.bind(first);
	assert.equal(presentation.display.enabled, true);
	presentation.bind(next);
	assert.equal(presentation.display.enabled, false);
	presentation.toggle();
	assert.deepEqual(presentation.display.ranges, []);
	presentation.bind(undefined);
	presentation.toggle();
	assert.equal(presentation.display.enabled, false);
	presentation.bind(next);
	presentation.toggle();
	presentation.dispose();
	assert.equal(presentation.display.enabled, false);
});

void test('initial-only, identical retyped states and different histories use only their two strings', () => {
	const clock = new FakeClock();
	for (const file of [recording('cat'), recording('cat', [spliceStep('cat', 0, 3, ''), spliceStep('', 0, 0, 'cat', 2)])]) {
		const presentation = new DoomedPresentation();
		presentation.bind(new ReplayController(file, clock));
		presentation.toggle();
		assert.deepEqual(presentation.display.ranges, []);
	}
	const histories = [
		recording('cat', [spliceStep('cat', 0, 3, 'dog')]),
		recording('cat', [spliceStep('cat', 0, 3, 'something else'), spliceStep('something else', 0, 14, 'dog', 2)]),
	];
	const results = histories.map((file) => {
		const presentation = new DoomedPresentation();
		presentation.bind(new ReplayController(file, clock));
		presentation.toggle();
		return presentation.display.ranges;
	});
	assert.deepEqual(results[0], results[1]);
});

void test('work limits and unexpected comparison errors show plain text without stopping playback', () => {
	for (const compare of [
		(): DoomedComparison => ({ status: 'unavailable', reason: 'work-limit' }),
		(): DoomedComparison => { throw new Error('Unexpected failure'); },
	]) {
		let calls = 0;
		const presentation = new DoomedPresentation(() => { calls++; return compare(); });
		const clock = new FakeClock();
		const player = new ReplayController(loadFixture('revision'), clock);
		presentation.bind(player);
		presentation.toggle();
		player.play();
		assert.deepEqual(presentation.display.ranges, []);
		assert.match(presentation.display.message, /unavailable/);
		void presentation.display;
		assert.equal(calls, 1);
		assert.equal(clock.size, 1);
		clock.advance(250);
		assert.equal(player.state.sequence, 1);
		assert.equal(player.state.error, null);
		presentation.toggle();
		assert.equal(presentation.display.message, '');
	}
});

void test('comparison reuse is bounded by entries and retained ranges', () => {
	for (const rangeCount of [0, 300]) {
		const initial = 'a'.repeat(600);
		const steps = Array.from({ length: 30 }, (_, index) => spliceStep(initial + 'x'.repeat(index), 600 + index, 600 + index, 'x', index + 1));
		const player = new ReplayController(recording(initial, steps), new FakeClock());
		let calls = 0;
		const ranges = Array.from({ length: rangeCount }, (_, index) => ({ from: index * 2, to: index * 2 + 1 }));
		const presentation = new DoomedPresentation(() => { calls++; return { status: 'ready', ranges }; });
		presentation.bind(player);
		presentation.toggle();
		const retained = rangeCount ? Math.floor(DOOMED_CACHE_LIMITS.ranges / rangeCount) : DOOMED_CACHE_LIMITS.entries;
		for (let sequence = 0; sequence <= retained; sequence++) { player.select(sequence); void presentation.display; }
		assert.equal(calls, retained + 1);
		player.select(1);
		void presentation.display;
		assert.equal(calls, retained + 1);
		player.select(0);
		void presentation.display;
		assert.equal(calls, retained + 2);
	}
});
