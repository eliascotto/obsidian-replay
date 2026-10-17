import { parseRecording } from '../recording/format';
import type { Scheduler } from '../storage/types';
import { ReplayController } from './controller';

export type FileReplayState =
	| { phase: 'idle'; path: null }
	| { phase: 'loading'; path: string }
	| { phase: 'unavailable'; path: string; message: string }
	| { phase: 'ready'; path: string; player: ReplayController };

/** A portable player depends only on file bytes, not the source note or capture store. */
export class ReplayFileController {
	private current: FileReplayState = { phase: 'idle', path: null };
	private listeners = new Set<() => void>();
	private generation = 0;
	private releasePlayer: (() => void) | undefined;
	private disposed = false;
	private selectedPath: string | null = null;
	private selectedSequence = 0;
	constructor(private read: (path: string) => Promise<string>, private clock: Scheduler, private blocked: (path: string) => boolean) {}
	get state(): FileReplayState { return this.current; }
	subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
	private changed(): void { if (!this.disposed) this.listeners.forEach((listener) => listener()); }
	private release(): void {
		this.releasePlayer?.();
		this.releasePlayer = undefined;
		if (this.current.phase === 'ready') this.current.player.dispose();
	}
	async open(path: string): Promise<void> {
		if (this.disposed) return;
		const generation = ++this.generation;
		const sequence = this.current.phase === 'ready' && this.current.path === path ? this.current.player.state.sequence
			: this.selectedPath === path ? this.selectedSequence : 0;
		this.release();
		this.current = { phase: 'loading', path };
		this.changed();
		try {
			const text = await this.read(path);
			if (this.disposed || generation !== this.generation) return;
			if (this.blocked(path)) { this.unavailable(path, 'Stop and save the source recording before replaying.'); return; }
			const recording = parseRecording(text);
			const player = new ReplayController(recording, this.clock);
			player.select(Math.min(sequence, recording.steps.length));
			this.current = { phase: 'ready', path, player };
			this.releasePlayer = player.subscribe(() => this.changed());
			this.changed();
		} catch (error) {
			if (generation === this.generation && !this.disposed) {
				this.unavailable(path, error instanceof Error ? `Could not open recording. ${error.message}` : 'Could not open this recording file.');
			}
		}
	}
	refreshCapture(): void {
		const { path } = this.current;
		if (!path) return;
		if (this.blocked(path)) this.unavailable(path, 'Stop and save the source recording before replaying.');
		else if (this.current.phase === 'unavailable') void this.open(path);
	}
	rename(path: string): Promise<void> {
		this.selectedPath = path;
		if (this.current.phase === 'ready') this.selectedSequence = this.current.player.state.sequence;
		return this.open(path);
	}
	unavailable(path: string, message: string): void {
		this.generation++;
		if (this.current.phase === 'ready') {
			this.selectedPath = this.current.path;
			this.selectedSequence = this.current.player.state.sequence;
		}
		this.release();
		this.current = { phase: 'unavailable', path, message };
		this.changed();
	}
	close(): void {
		this.generation++;
		this.release();
		this.selectedPath = null;
		this.selectedSequence = 0;
		this.current = { phase: 'idle', path: null };
		this.changed();
	}
	dispose(): void { this.close(); this.disposed = true; this.listeners.clear(); }
}
