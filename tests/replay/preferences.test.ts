import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_DOOMED_COLOR, ReplayPreferences } from '../../src/settings';
import { highlightTextColor } from '../../src/ui/highlight-color';
import { PLAYBACK_RATES } from '../../src/replay/types';
import { ReplayFileController } from '../../src/replay/file-controller';
import { serializeRecording } from '../../src/recording/format';
import { loadFixture } from '../recording/helpers';
import { deferred, FakeClock } from '../support/storage';

const bytes = serializeRecording(loadFixture('resume'));

void test('Doomed restores only saved booleans and defaults off without writing', () => {
	const unexpectedSave = () => { throw new Error('Loading preferences must not write'); };
	for (const saved of [undefined, null, [], {}, { doomedEnabled: 'true' }, { doomedEnabled: 1 }, { doomedEnabled: null }]) {
		assert.equal(new ReplayPreferences(saved, unexpectedSave, unexpectedSave).doomedEnabled, false);
	}
	for (const enabled of [true, false]) {
		assert.equal(new ReplayPreferences({ doomedEnabled: enabled }, unexpectedSave, unexpectedSave).doomedEnabled, enabled);
	}
});

void test('both Doomed choices survive sessions and preserve unrelated preferences', async () => {
	let saved: unknown = { playbackRate: 2, doomedHighlightColor: '#ffea00', otherSetting: 'preserve me' };
	for (const enabled of [true, false]) {
		const preferences = new ReplayPreferences(saved, async (data) => { saved = data; }, () => assert.fail('Unexpected save failure'));
		let updates = 0;
		const unsubscribe = preferences.subscribe(() => { updates++; });
		preferences.setDoomedEnabled(enabled);
		preferences.setDoomedEnabled(enabled);
		assert.equal(updates, 1);
		unsubscribe();
		await preferences.flush();
		const restored = new ReplayPreferences(saved, async () => undefined, () => assert.fail('Unexpected save failure'));
		assert.equal(restored.doomedEnabled, enabled);
		assert.equal(restored.playbackRate, 2);
		assert.equal(restored.doomedHighlightColor, '#ffea00');
		assert.deepEqual(saved, { playbackRate: 2, doomedHighlightColor: '#ffea00', otherSetting: 'preserve me', doomedEnabled: enabled });
	}
});

void test('ordered toggle, speed, and color saves recover after a failure without reverting the current choice', async () => {
	const gate = deferred();
	const writes: Record<string, unknown>[] = [];
	let failures = 0;
	const preferences = new ReplayPreferences(undefined, async (data) => {
		writes.push(data);
		if (writes.length === 1) await gate.promise;
	}, () => { failures++; });
	preferences.setDoomedEnabled(true);
	preferences.setRate(2);
	preferences.setDoomedColor('#00aaff');
	await Promise.resolve();
	gate.reject(new Error('Save failed'));
	await preferences.flush();
	assert.equal(failures, 1);
	assert.equal(preferences.doomedEnabled, true);
	assert.deepEqual(writes[2], { doomedEnabled: true, playbackRate: 2, doomedHighlightColor: '#00aaff' });
	preferences.setDoomedEnabled(false);
	await preferences.flush();
	assert.deepEqual(writes[3], { doomedEnabled: false, playbackRate: 2, doomedHighlightColor: '#00aaff' });
	assert.throws(() => preferences.setDoomedEnabled('true' as unknown as boolean), RangeError);
});

void test('highlight colors default safely and normalize saved hex without writing', () => {
	const unexpectedSave = () => { throw new Error('Loading preferences must not write'); };
	for (const value of [undefined, null, 42, '#fff', '#12345678', 'red', '#gggggg', 'var(--text-normal)', '#123456; color: red']) {
		const preferences = new ReplayPreferences({ doomedHighlightColor: value }, unexpectedSave, unexpectedSave);
		assert.equal(preferences.doomedHighlightColor, DEFAULT_DOOMED_COLOR);
	}
	const preferences = new ReplayPreferences({ doomedHighlightColor: ' #AaBBcc ' }, unexpectedSave, unexpectedSave);
	assert.equal(preferences.doomedHighlightColor, '#aabbcc');
});

void test('color changes notify open views, preserve speed, and survive a new session', async () => {
	let saved: unknown;
	let notifications = 0;
	const preferences = new ReplayPreferences({ playbackRate: 2, otherSetting: true }, async (data) => { saved = data; },
		() => assert.fail('Unexpected save failure'));
	const unsubscribe = preferences.subscribe(() => { notifications++; });
	preferences.setDoomedColor('#00AAff');
	preferences.setDoomedColor('#00aaff');
	assert.equal(notifications, 1);
	assert.equal(preferences.playbackRate, 2);
	await preferences.flush();
	assert.deepEqual(saved, { playbackRate: 2, otherSetting: true, doomedHighlightColor: '#00aaff' });
	const restored = new ReplayPreferences(saved, async () => undefined, () => assert.fail('Unexpected save failure'));
	assert.equal(restored.doomedHighlightColor, '#00aaff');
	assert.equal(restored.playbackRate, 2);
	for (const value of ['', '#fff', '#ffea00; color: red', 'rgb(0,0,0)']) assert.throws(() => preferences.setDoomedColor(value), RangeError);
	assert.equal(preferences.doomedHighlightColor, '#00aaff');
	unsubscribe();
	preferences.setDoomedColor(DEFAULT_DOOMED_COLOR);
	await preferences.flush();
	assert.equal(notifications, 1);
});

void test('interleaved color and speed writes retain the latest values after a failed save', async () => {
	const gate = deferred();
	const writes: Record<string, unknown>[] = [];
	let failures = 0;
	const preferences = new ReplayPreferences(undefined, async (data) => {
		writes.push(data);
		if (writes.length === 1) await gate.promise;
	}, () => { failures++; });
	preferences.setDoomedColor('#00aaff');
	preferences.setRate(2);
	preferences.setDoomedColor('#111111');
	await Promise.resolve();
	assert.equal(writes.length, 1);
	gate.reject(new Error('Save failed'));
	await preferences.flush();
	assert.equal(failures, 1);
	assert.deepEqual(writes[2], { doomedHighlightColor: '#111111', playbackRate: 2 });
	assert.equal(preferences.doomedHighlightColor, '#111111');
});

void test('highlight text stays readable on bright and dark custom backgrounds', () => {
	for (const color of ['#ffea00', '#ffffff', '#00ff00', '#00aaff']) assert.equal(highlightTextColor(color), '#000000');
	for (const color of ['#000000', '#111111', '#0000ff']) assert.equal(highlightTextColor(color), '#ffffff');
});

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
