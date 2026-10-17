import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ReplayController } from '../../src/replay/controller';
import { PLAYBACK_RATES } from '../../src/replay/types';
import { renderReplayText } from '../../src/ui/replay-text';
import type { Scheduler } from '../../src/storage/types';
import { FakeClock } from '../support/storage';
import { fixtureStates, loadFixture, recording, spliceStep } from '../recording/helpers';

void test('transport plays, pauses, and rewinds the completed recording without starting a timer', () => {
	const clock = new FakeClock();
	const player = new ReplayController(loadFixture('resume'), clock);
	player.setRate(3);
	player.togglePlayback();
	assert.equal(player.state.playing, true);
	clock.advance(50);
	player.togglePlayback();
	assert.equal(player.state.playing, false);
	assert.equal(player.state.sequence, 1);
	assert.equal(clock.size, 0);
	player.togglePlayback();
	clock.advance(1000);
	assert.equal(player.state.sequence, player.state.lastSequence);
	assert.equal(player.state.playing, false);
	player.togglePlayback();
	assert.equal(player.state.sequence, 0);
	assert.equal(player.state.text, player.recording.initialText);
	assert.equal(player.state.rate, 3);
	assert.equal(player.state.playing, false);
	assert.equal(clock.size, 0);
	player.togglePlayback();
	assert.equal(player.state.playing, true);
	assert.equal(clock.size, 1);
	player.dispose();
});

void test('transport commits a pending endpoint seek before deciding to restart and stays idle for an empty recording', () => {
	const clock = new FakeClock();
	const player = new ReplayController(loadFixture('resume'), clock);
	player.requestSeek(player.state.lastSequence);
	player.togglePlayback();
	assert.equal(player.state.sequence, 0);
	assert.equal(player.state.pendingSequence, null);
	clock.advance(1000);
	assert.equal(player.state.sequence, 0);
	assert.equal(clock.size, 0);
	player.dispose();
	player.togglePlayback();
	assert.equal(clock.size, 0);
	const empty = new ReplayController(recording('Just the initial text'), clock);
	empty.togglePlayback();
	assert.equal(empty.state.playing, false);
	assert.equal(empty.state.sequence, 0);
	assert.equal(clock.size, 0);
	empty.dispose();
});

for (const [name, states] of Object.entries(fixtureStates)) {
	void test(`replay selection, forwards and backwards match every ${name} state`, () => {
		const clock = new FakeClock();
		const player = new ReplayController(loadFixture(name), clock);
		assert.equal(player.state.sequence, 0);
		assert.equal(player.state.playing, false);
		assert.equal(player.finalText, states[states.length - 1]);
		for (const [sequence, text] of states.entries()) {
			player.select(sequence);
			assert.equal(player.state.text, text);
			assert.equal(player.state.sequence, sequence);
		}
		for (let sequence = states.length - 1; sequence > 0; sequence--) {
			player.previous();
			assert.equal(player.state.text, states[sequence - 1]);
		}
		for (let sequence = 1; sequence < states.length; sequence++) {
			player.next();
			assert.equal(player.state.text, states[sequence]);
		}
		player.next();
		assert.equal(player.state.sequence, states.length - 1);
		assert.equal(clock.size, 0);
	});
}

for (const rate of PLAYBACK_RATES) {
	void test(`playback at ${rate}× advances one step per interval and stops exactly at the end`, () => {
		const clock = new FakeClock();
		const player = new ReplayController(loadFixture('resume'), clock);
		player.setRate(rate);
		player.play();
		player.play();
		assert.equal(clock.size, 1);
		const interval = 150 / rate;
		for (let sequence = 1; sequence <= 3; sequence++) {
			clock.advance(interval - 1);
			assert.equal(player.state.sequence, sequence - 1);
			clock.advance(1);
			assert.equal(player.state.sequence, sequence);
			assert.equal(player.state.text, fixtureStates.resume?.[sequence]);
		}
		assert.equal(player.state.playing, false);
		assert.equal(clock.size, 0);
		player.play();
		clock.advance(10_000);
		assert.equal(player.state.sequence, 3);
		assert.equal(clock.size, 0);
	});
}

void test('pause retains the selected state and rate changes reschedule without an immediate edit', () => {
	const clock = new FakeClock();
	const player = new ReplayController(loadFixture('insertion'), clock);
	player.play();
	clock.advance(100);
	player.setRate(2);
	assert.equal(player.state.sequence, 0);
	assert.equal(clock.size, 1);
	clock.advance(74);
	assert.equal(player.state.sequence, 0);
	clock.advance(1);
	assert.equal(player.state.sequence, 1);
	player.pause();
	clock.advance(5000);
	assert.equal(player.state.sequence, 1);
	assert.equal(clock.size, 0);
	player.play();
	clock.advance(75);
	assert.equal(player.state.sequence, 2);
});

void test('initial-only and empty recordings are valid, paused, and cannot advance', () => {
	for (const text of ['', 'An existing article']) {
		const clock = new FakeClock();
		const player = new ReplayController(recording(text), clock);
		player.play();
		player.next();
		player.previous();
		assert.equal(player.state.text, text);
		assert.equal(player.state.sequence, 0);
		assert.equal(player.state.lastSequence, 0);
		assert.equal(player.state.error, null);
		assert.equal(clock.size, 0);
	}
});

void test('scrubbing coalesces to the latest request and immediately pauses playback', () => {
	const clock = new FakeClock();
	const player = new ReplayController(loadFixture('resume'), clock);
	player.play();
	player.requestSeek(1);
	player.requestSeek(3);
	assert.equal(player.state.playing, false);
	assert.equal(player.state.sequence, 0);
	assert.equal(player.state.pendingSequence, 3);
	assert.equal(clock.size, 1);
	clock.advance(15);
	assert.equal(player.state.sequence, 0);
	clock.advance(1);
	assert.equal(player.state.sequence, 3);
	assert.equal(player.state.text, player.finalText);
	assert.equal(player.state.pendingSequence, null);
	assert.equal(clock.size, 0);
});

void test('committed seek, Play and previous/next agree on the requested position', () => {
	const clock = new FakeClock();
	const player = new ReplayController(loadFixture('resume'), clock);
	player.requestSeek(1);
	player.play();
	assert.equal(player.state.sequence, 1);
	assert.equal(clock.size, 1);
	clock.advance(150);
	assert.equal(player.state.sequence, 2);
	player.requestSeek(3);
	player.previous();
	assert.equal(player.state.sequence, 2);
	assert.equal(player.state.playing, false);
	assert.equal(clock.size, 0);
	player.requestSeek(1);
	player.next();
	assert.equal(player.state.sequence, 2);
	player.requestSeek(3);
	player.select(0);
	clock.advance(1000);
	assert.equal(player.state.sequence, 0);
});

void test('invalid input preserves the previously selected state and rate', () => {
	const player = new ReplayController(loadFixture('insertion'), new FakeClock());
	player.play();
	const before = player.state;
	for (const sequence of [-1, 0.5, 3, NaN, Infinity]) {
		assert.throws(() => player.select(sequence));
		assert.throws(() => player.requestSeek(sequence));
		assert.deepEqual(player.state, before);
	}
	for (const rate of [0, -1, NaN, Infinity, 1.5, 5]) {
		assert.throws(() => player.setRate(rate));
		assert.deepEqual(player.state, before);
	}
	player.dispose();
});

void test('callbacks already delivered by a scheduler cannot survive pause, a newer seek, or disposal', () => {
	const callbacks: (() => void)[] = [];
	const clock: Scheduler = { set: (callback) => { callbacks.push(callback); return callbacks.length; }, clear: () => undefined };
	const player = new ReplayController(loadFixture('insertion'), clock);
	player.play();
	const tick = callbacks[0];
	assert.ok(tick);
	player.pause();
	tick();
	assert.equal(player.state.sequence, 0);
	player.requestSeek(1);
	const staleSeek = callbacks[1];
	assert.ok(staleSeek);
	player.requestSeek(2);
	staleSeek();
	assert.equal(player.state.sequence, 0);
	assert.equal(player.state.pendingSequence, 2);
	player.dispose();
	callbacks.forEach((callback) => callback());
	assert.equal(player.state.sequence, 0);
	assert.equal(player.state.pendingSequence, null);
	player.play();
	assert.equal(player.state.playing, false);
});

void test('subscriber-triggered rate changes during a tick do not duplicate timers', () => {
	const clock = new FakeClock();
	const player = new ReplayController(loadFixture('insertion'), clock);
	player.subscribe(() => {
		if (player.state.sequence === 1 && player.state.rate === 1) player.setRate(2);
	});
	player.play();
	clock.advance(150);
	assert.equal(clock.size, 1);
	clock.advance(75);
	assert.equal(player.state.sequence, 2);
	assert.equal(clock.size, 0);
});

void test('a caller cannot mutate the history during playback and malformed suffixes are rejected', () => {
	const changes = [{ fromBefore: 0, toBefore: 0, fromAfter: 0, toAfter: 1, deletedText: '', insertedText: 'A' }];
	const file = recording('', [{ sequence: 1, kind: 'edit', changes }]);
	const player = new ReplayController(file, new FakeClock());
	const change = changes[0];
	assert.ok(change);
	change.insertedText = 'B';
	player.next();
	assert.equal(player.state.text, 'A');
	assert.ok(Object.isFrozen(player.recording.steps));
	assert.throws(() => new ReplayController(recording('abc', [spliceStep('WRONG', 0, 1, 'X')]), new FakeClock()));
});

void test('rendering preserves text exactly without HTML interpretation or redundant replacement', () => {
	let writes = 0;
	let value: string | null = null;
	const target = { get textContent() { return value; }, set textContent(text: string | null) { writes++; value = text; } };
	const text = '<img src=x onerror="bad()">\r\n😀\t<script>example</script>';
	renderReplayText(target, text);
	renderReplayText(target, text);
	assert.equal(value, text);
	assert.equal(writes, 1);
	renderReplayText(target, '');
	assert.equal(value, '');
});
