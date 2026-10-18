import type { RecordingController } from '../recording/controller';
import type { ReplayInvalidation } from '../recording/replay-access';
import { remap } from '../storage/records';
import type { Scheduler } from '../storage/types';
import { ReplayController } from './controller';
import type { ReplayStatus } from './types';

export class ReplayCoordinator {
	private current: ReplayStatus = { phase: 'idle', path: null };
	private generation = 0;
	private disposed = false;
	private listeners = new Set<() => void>();
	private unsubscribe: () => void;
	private playerSubscription: (() => void) | undefined;

	constructor(
		private recordings: RecordingController,
		private clock: Scheduler,
		private exists: (path: string) => boolean = () => true,
	) {
		this.unsubscribe = recordings.replayAccess.subscribe((event) => this.invalidated(event));
	}

	get state(): ReplayStatus { return this.current; }

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => { this.listeners.delete(listener); };
	}

	private changed(): void { if (!this.disposed) this.listeners.forEach((listener) => listener()); }

	private release(): void {
		this.playerSubscription?.();
		this.playerSubscription = undefined;
		if (this.current.phase === 'ready') this.current.player.dispose();
	}

	async open(path: string, expectedId?: string, sequence = 0): Promise<void> {
		if (this.disposed) return;
		if (this.current.phase === 'ready' && this.current.path === path &&
			this.recordings.isReplayCurrent(this.current.reference) && this.exists(path)) {
			this.changed();
			return;
		}
		const generation = ++this.generation;
		this.release();
		this.current = { phase: 'loading', path };
		this.changed();
		try {
			if (!this.exists(path)) throw new Error('The source note is missing.');
			const snapshot = await this.recordings.stoppedSnapshot(path);
			if (this.disposed || generation !== this.generation) return;
			if (!snapshot || !this.exists(path)) {
				this.unavailable(path, 'The note or its recording is not available.');
				return;
			}
			if (!this.recordings.isReplayCurrent(snapshot) || (expectedId && snapshot.id !== expectedId)) {
				this.unavailable(path, 'The recording changed. Stop and save it, then open replay again.');
				return;
			}
			const player = new ReplayController(snapshot.recording, this.clock);
			player.select(Math.min(sequence, snapshot.recording.steps.length));
			this.current = { phase: 'ready', path, reference: snapshot, player };
			this.playerSubscription = player.subscribe(() => {
				if (!this.recordings.isReplayCurrent(snapshot) || !this.exists(path)) this.unavailable(path, 'Stop and save the recording before replaying.');
				else this.changed();
			});
			this.changed();
		} catch {
			if (!this.disposed && generation === this.generation) {
				this.unavailable(path, 'Replay could not load a valid stopped recording. Stop and save it, then try again.');
			}
		}
	}

	private invalidated(event: ReplayInvalidation): void {
		if (event.type === 'dispose') { this.close(); return; }
		const path = this.current.path;
		if (!path) return;
		if (event.type === 'invalidate' && event.path === path) {
			this.unavailable(path, 'The recording changed. Stop and save it, then open replay again.');
		} else if (event.type === 'rename') {
			const next = remap(path, event.from, event.to);
			if (next === path) return;
			const id = this.current.phase === 'ready' ? this.current.reference.id : undefined;
			const sequence = this.current.phase === 'ready' ? this.current.player.state.sequence : 0;
			void this.open(next, id, sequence);
		}
	}

	unavailable(path: string, message = 'The note or its recording is not available.'): void {
		if (this.disposed) return;
		this.generation++;
		this.release();
		this.current = { phase: 'unavailable', path, message };
		this.changed();
	}

	remove(path: string): void {
		if (this.current.path && (this.current.path === path || this.current.path.startsWith(path + '/'))) {
			this.unavailable(this.current.path);
		}
	}

	close(): void {
		this.generation++;
		this.release();
		this.current = { phase: 'idle', path: null };
		this.changed();
	}

	dispose(): void {
		this.disposed = true;
		this.unsubscribe();
		this.close();
		this.listeners.clear();
	}
}
