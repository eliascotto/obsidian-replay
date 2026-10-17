import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ReplayPreferences } from '../../src/settings';
import { PLAYBACK_RATES } from '../../src/replay/types';
import { ReplayFileController } from '../../src/replay/file-controller';
import { serializeRecording } from '../../src/recording/format';
import { loadFixture } from '../recording/helpers';
import { deferred, FakeClock } from '../support/storage';

const bytes = serializeRecording(loadFixture('resume'));
function player(controller: ReplayFileController) {
	const state = controller.state;
	assert.equal(state.phase, 'ready');
	if (state.phase !== 'ready') throw new Error('Missing player');
	return state.player;
}

void test('saved speeds validate against supported rates; missing or malformed settings default to 1× without writing', () => {
	const unexpectedSave = () => { throw new Error('Loading preferences must not write'); };
	for (const rate of PLAYBACK_RATES) {
		assert.equal(new ReplayPreferences({ playbackRate: rate }, unexpectedSave, unexpectedSave).playbackRate, rate);
	}
	for (const data of [null, undefined, [], '2', {}, { playbackRate: '2' }, { playbackRate: 0 },
		{ playbackRate: NaN }, { playbackRate: Infinity }, { playbackRate: 1.5 }]) {
		assert.equal(new ReplayPreferences(data, unexpectedSave, unexpectedSave).playbackRate, 1);
	}
});

void test('rapid speed changes save in order and recover from an earlier failed save', async () => {
	const gate = deferred();
	const writes: Record<string, unknown>[] = [];
	let failures = 0;
	const preferences = new ReplayPreferences({ otherSetting: 'preserve me' }, async (data) => {
		writes.push(data);
		if (writes.length === 1) await gate.promise;
	}, () => { failures++; });
	preferences.setRate(2); preferences.setRate(3); preferences.setRate(4);
	await Promise.resolve();
	assert.deepEqual(writes, [{ otherSetting: 'preserve me', playbackRate: 2 }]);
	gate.reject(new Error('Save failed'));
	await preferences.flush();
	assert.equal(failures, 1);
	assert.deepEqual(writes.map((data) => data.playbackRate), [2, 3, 4]);
	assert.equal(writes[2]?.otherSetting, 'preserve me');
	assert.equal(preferences.playbackRate, 4);
	preferences.setRate(4);
	await preferences.flush();
	assert.equal(writes.length, 3);
	for (const rate of [0, NaN, Infinity, 1.5, 5]) assert.throws(() => preferences.setRate(rate), RangeError);
	assert.equal(preferences.playbackRate, 4);
});

void test('speed is shared with open tabs and newly opened files without moving or pausing playback', async () => {
	const preferences = new ReplayPreferences(undefined, async () => undefined, () => assert.fail('Unexpected save failure'));
	const clock = new FakeClock();
	const a = new ReplayFileController(async () => bytes, clock, () => false, preferences);
	const b = new ReplayFileController(async () => bytes, clock, () => false, preferences);
	await a.open('A.replay'); await b.open('B.replay');
	player(b).next(); player(b).play();
	a.setRate(2);
	assert.equal(player(a).state.rate, 2);
	assert.equal(player(b).state.rate, 2);
	assert.equal(player(b).state.sequence, 1);
	assert.equal(player(b).state.playing, true);
	assert.equal(clock.size, 1);
	clock.advance(74);
	assert.equal(player(b).state.sequence, 1);
	clock.advance(1);
	assert.equal(player(b).state.sequence, 2);
	await a.open('Next.replay');
	assert.equal(player(a).state.rate, 2);
	await a.rename('Renamed.replay');
	assert.equal(player(a).state.rate, 2);
	a.dispose();
	b.setRate(3);
	assert.equal(a.state.phase, 'idle');
	assert.equal(clock.size, 1);
	b.dispose();
	assert.equal(clock.size, 0);
	await preferences.flush();
});

void test('a saved rate survives a new plugin session and applies after a delayed file load', async () => {
	let saved: unknown;
	const preferences = new ReplayPreferences(undefined, async (data) => { saved = data; }, () => assert.fail('Unexpected save failure'));
	preferences.setRate(2);
	await preferences.flush();
	const restored = new ReplayPreferences(saved, async () => undefined, () => assert.fail('Unexpected save failure'));
	const gate = deferred<string>();
	const controller = new ReplayFileController(() => gate.promise, new FakeClock(), () => false, restored);
	const opening = controller.open('Copied.replay');
	assert.equal(restored.playbackRate, 2);
	gate.resolve(bytes);
	await opening;
	assert.equal(player(controller).state.rate, 2);
	assert.equal(player(controller).state.sequence, 0);
	assert.equal(player(controller).state.playing, false);
	assert.equal(serializeRecording(player(controller).recording), bytes);
	controller.dispose();
});
