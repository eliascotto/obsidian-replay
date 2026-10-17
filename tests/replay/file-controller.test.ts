import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ReplayFileController } from '../../src/replay/file-controller';
import { serializeRecording } from '../../src/recording/format';
import { FakeClock, deferred } from '../support/storage';
import { loadFixture } from '../recording/helpers';

const text = serializeRecording(loadFixture('resume'));
function ready(controller: ReplayFileController) {
	const state = controller.state;
	if (state.phase !== 'ready') throw new Error('Missing player');
	return state.player;
}

void test('a standalone portable file plays without any note/store and each view has independent state', async () => {
	const clock = new FakeClock();
	const a = new ReplayFileController(async () => text, clock, () => false);
	const b = new ReplayFileController(async () => text, clock, () => false);
	await a.open('Shared.replay'); await b.open('Another.replay');
	assert.equal(a.state.phase, 'ready'); assert.equal(b.state.phase, 'ready');
	if (a.state.phase !== 'ready' || b.state.phase !== 'ready') return;
	a.state.player.next(); a.state.player.play(); clock.advance(150);
	assert.equal(a.state.player.state.sequence, 2);
	assert.equal(b.state.player.state.sequence, 0);
	a.dispose(); b.dispose();
	assert.equal(clock.size, 0);
});

void test('capture pauses/releases a managed player and a later publication restores its selected position', async () => {
	const clock = new FakeClock(); let blocked = false;
	const player = new ReplayFileController(async () => text, clock, () => blocked);
	await player.open('A.replay');
	ready(player).next(); ready(player).play();
	blocked = true; player.refreshCapture();
	assert.equal(player.state.phase, 'unavailable'); assert.equal(clock.size, 0);
	blocked = false; await player.open('A.replay');
	assert.equal(player.state.phase, 'ready');
	assert.equal(ready(player).state.sequence, 1);
	assert.equal(ready(player).state.playing, false);
});

void test('late reads cannot replace a newer file or revive a disposed player', async () => {
	const gate = deferred<string>();
	const player = new ReplayFileController((path) => path === 'Slow.replay' ? gate.promise : Promise.resolve(text), new FakeClock(), () => false);
	const old = player.open('Slow.replay');
	await player.open('New.replay'); gate.resolve('{invalid'); await old;
	assert.equal(player.state.path, 'New.replay'); assert.equal(player.state.phase, 'ready');
	player.dispose(); await player.open('Other.replay');
	assert.equal(player.state.phase, 'idle');
});

void test('corrupt and unsupported files disable playback without displaying a previous document', async () => {
	let bytes = text;
	const player = new ReplayFileController(async () => bytes, new FakeClock(), () => false);
	await player.open('A.replay'); bytes = '{"format":"obsidian-replay","formatVersion":99}';
	await player.open('A.replay');
	assert.equal(player.state.phase, 'unavailable');
});

void test('large, many-step recordings seek precisely without rereading the file per step', async () => {
	const initialText = 'A paragraph of source text.\n'.repeat(2000);
	const steps = Array.from({ length: 2000 }, (_, index) => ({
		sequence: index + 1, kind: 'edit' as const,
		changes: [{ fromBefore: initialText.length + index, toBefore: initialText.length + index,
			fromAfter: initialText.length + index, toAfter: initialText.length + index + 1, deletedText: '', insertedText: 'x' }],
	}));
	const bytes = JSON.stringify({ format: 'obsidian-replay', formatVersion: 1, initialText, steps });
	let reads = 0;
	const clock = new FakeClock();
	const controller = new ReplayFileController(async () => { reads++; return bytes; }, clock, () => false);
	await controller.open('Long.replay');
	const player = ready(controller);
	player.requestSeek(1000); player.requestSeek(2000); clock.advance(16);
	assert.equal(player.state.sequence, 2000);
	assert.equal(player.state.text, initialText + 'x'.repeat(2000));
	player.previous();
	assert.equal(player.state.sequence, 1999);
	assert.equal(reads, 1);
	controller.dispose();
	assert.equal(clock.size, 0);
});

void test('renaming a file preserves the selected step and releases the old playback timer', async () => {
	const clock = new FakeClock();
	const controller = new ReplayFileController(async () => text, clock, () => false);
	await controller.open('A.replay');
	ready(controller).next(); ready(controller).play();
	await controller.rename('B.replay');
	assert.equal(controller.state.path, 'B.replay');
	assert.equal(ready(controller).state.sequence, 1);
	assert.equal(ready(controller).state.playing, false);
	assert.equal(clock.size, 0);
});
