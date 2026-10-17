import type { RecordingFile } from './types';

export interface RecordingReference {
	readonly id: string;
	readonly path: string;
	readonly revision: number;
}

export interface StoppedSnapshot extends RecordingReference {
	readonly recording: RecordingFile;
}

export type ReplayInvalidation =
	| { readonly type: 'invalidate'; readonly path: string }
	| { readonly type: 'rename'; readonly from: string; readonly to: string }
	| { readonly type: 'dispose' };

/** In-memory revisions prevent an old load from surviving a Start/Stop cycle. */
export class ReplayAccess {
	private revisions = new Map<string, number>();
	private counter = 0;
	private listeners = new Set<(event: ReplayInvalidation) => void>();

	revision(path: string): number {
		// Track loaded descendants too, so a folder rename invalidates their snapshots.
		if (!this.revisions.has(path)) this.revisions.set(path, 0);
		return this.revisions.get(path)!;
	}

	subscribe(listener: (event: ReplayInvalidation) => void): () => void {
		this.listeners.add(listener);
		return () => { this.listeners.delete(listener); };
	}

	invalidate(path: string): void {
		this.revisions.set(path, ++this.counter);
		this.emit({ type: 'invalidate', path });
	}

	rename(from: string, to: string): void {
		if (from === to) return;
		for (const path of this.revisions.keys()) {
			if (path === from || path.startsWith(from + '/')) this.revisions.set(path, ++this.counter);
		}
		this.revisions.set(from, ++this.counter);
		this.revisions.set(to, ++this.counter);
		this.emit({ type: 'rename', from, to });
	}

	private emit(event: ReplayInvalidation): void { this.listeners.forEach((listener) => listener(event)); }

	dispose(): void { this.emit({ type: 'dispose' }); this.listeners.clear(); }
}
