import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ReplayCoordinator } from '../../src/replay/coordinator';
import { DoomedPresentation } from '../../src/replay/doomed-presentation';
import { renderReplayText } from '../../src/ui/replay-text';
import { TestDocument } from '../support/dom';
import { setup, capture, seed, player, readyAt } from '../support/replay';

function doomedSurface(replay: ReplayCoordinator) {
	const presentation = new DoomedPresentation();
	const target = new TestDocument().createElement('code');
	const render = () => {
		const current = replay.state.phase === 'ready' ? replay.state.player : undefined;
		presentation.bind(current);
		renderReplayText(target.element, current?.state.text ?? '', presentation.display.ranges);
	};
	const unsubscribe = replay.subscribe(render);
	render();
	return { presentation, target, render, unsubscribe };
}

void test('Doomed remains anchored to the saved endpoint until Resume and a fresh stopped replay', async () => {
	const context = setup();
	context.present.add('a.md');
	await context.recordings.start('a.md', 'The cat sleeps.');
	capture(context.recordings, 'a.md', 'The cat sleeps.', 'The dog sleeps.');
	await context.recordings.stop('a.md');
	const surface = doomedSurface(context.replay);
	await context.replay.open('a.md');
	surface.presentation.toggle(); surface.render();
	assert.deepEqual(surface.presentation.display.ranges, [{ from: 4, to: 7 }]);
	const saved = new Map(context.adapter.files);
	const liveText = 'The cat sleeps.'; // Unrecorded changes are deliberately not the stopped endpoint.
	await context.recordings.start('b.md', 'Independent note');
	surface.render();
	assert.deepEqual(surface.presentation.display.ranges, [{ from: 4, to: 7 }]);
	assert.equal(surface.target.textContent, liveText);
	for (const [path, text] of saved) if (path.startsWith('recordings/id-1/')) assert.equal(context.adapter.files.get(path), text);
	await context.recordings.start('a.md', liveText);
	assert.equal(surface.presentation.display.enabled, false);
	assert.equal(surface.target.textContent, '');
	await context.recordings.stop('a.md');
	await context.replay.open('a.md');
	assert.equal(surface.presentation.display.enabled, false);
	surface.presentation.toggle(); surface.render();
	assert.deepEqual(surface.presentation.display.ranges, []);
	player(context.replay).next();
	assert.deepEqual(surface.presentation.display.ranges, [{ from: 4, to: 7 }]);
	assert.equal(surface.target.children.find((node) => node.nodeName === 'SPAN')?.textContent, 'dog');
	await context.recordings.stop('b.md');
	surface.unsubscribe(); context.replay.dispose();
});

void test('Doomed drops old spans during delayed rebind, rename, deletion, and disposal', async () => {
	const context = setup();
	await seed(context, 'a.md', 'A');
	await seed(context, 'b.md', 'Other');
	await context.recordings.start('a.md', 'Z');
	await context.recordings.stop('a.md');
	const surface = doomedSurface(context.replay);
	await context.replay.open('a.md');
	surface.presentation.toggle(); surface.render();
	assert.equal(surface.target.children.find((node) => node.nodeName === 'SPAN')?.textContent, 'A');
	context.store.hold = 'b.md';
	const pending = context.replay.open('b.md');
	await context.store.loaded.promise;
	assert.equal(surface.presentation.display.enabled, false);
	assert.equal(surface.target.textContent, '');
	context.replay.close();
	context.store.releaseLoad.resolve();
	await pending;
	assert.equal(surface.target.textContent, '');
	await context.replay.open('a.md');
	surface.presentation.toggle(); surface.render();
	context.present.delete('a.md'); context.present.add('renamed.md');
	const ready = readyAt(context.replay, 'renamed.md');
	await context.recordings.rename('a.md', 'renamed.md');
	await ready;
	assert.equal(surface.presentation.display.enabled, false);
	surface.presentation.toggle(); surface.render();
	context.present.delete('renamed.md'); context.replay.remove('renamed.md');
	assert.equal(surface.target.textContent, '');
	await context.replay.open('b.md');
	surface.presentation.toggle(); surface.render();
	await context.recordings.dispose();
	assert.equal(surface.presentation.display.enabled, false);
	assert.equal(surface.target.textContent, '');
	surface.unsubscribe(); context.replay.dispose();
});
