import assert from 'node:assert/strict';
import { ReplayCoordinator } from '../../src/replay/coordinator';
import { RecordingController } from '../../src/recording/controller';
import { RecordingStore } from '../../src/storage/recording-store';
import type { StoredRecording } from '../../src/storage/types';
import { FakeClock, MemoryAdapter, deferred } from './storage';
import { spliceStep } from '../recording/helpers';

class DelayedStore extends RecordingStore {
	hold: string | null = null;
	loaded = deferred();
	releaseLoad = deferred();

	override async load(path: string): Promise<StoredRecording | null> {
		const stored = await super.load(path);
		if (path === this.hold) {
			this.hold = null;
			this.loaded.resolve();
			await this.releaseLoad.promise;
		}
		return stored;
	}
}

export function setup() {
	const adapter = new MemoryAdapter();
	const store = new DelayedStore(adapter, 'recordings');
	const recordingClock = new FakeClock();
	const clock = new FakeClock();
	let id = 0;
	const errors: unknown[] = [];
	const recordings = new RecordingController(store, (_path, error) => errors.push(error), recordingClock, () => `id-${++id}`);
	const present = new Set<string>();
	const replay = new ReplayCoordinator(recordings, clock, (path) => present.has(path));
	return { adapter, store, recordingClock, clock, errors, recordings, present, replay };
}

export function capture(recordings: RecordingController, path: string, before: string, after: string): void {
	recordings.capture(path, { before, after, changes: spliceStep(before, 0, before.length, after).changes });
}

export async function seed(context: ReturnType<typeof setup>, path = 'a.md', text = 'A'): Promise<void> {
	context.present.add(path);
	await context.recordings.start(path, text);
	capture(context.recordings, path, text, text + 'B');
	await context.recordings.stop(path);
}

export function player(replay: ReplayCoordinator) {
	const state = replay.state;
	assert.ok(state.phase === 'ready');
	return state.player;
}

export function readyAt(replay: ReplayCoordinator, path: string): Promise<void> {
	if (replay.state.phase === 'ready' && replay.state.path === path) return Promise.resolve();
	return new Promise((resolve) => {
		const unsubscribe = replay.subscribe(() => {
			if (replay.state.phase === 'ready' && replay.state.path === path) { unsubscribe(); resolve(); }
		});
	});
}

