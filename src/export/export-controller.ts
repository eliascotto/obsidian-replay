import type { RecordingController } from '../recording/controller';
import type { RecordingReference } from '../recording/replay-access';
import { ExportCommitQueue } from './commit-queue';
import { destinationParent, validateDestination, type ExportPaths } from './destination';
import { prepareExport, verifyExport, type PreparedExport } from './recording-export';

export interface ExportAdapter {
	exists(path: string): Promise<boolean>;
	folder(path: string): Promise<boolean>;
	create(path: string, text: string): Promise<void>;
	read(path: string): Promise<string>;
}
export interface ExportState {
	readonly phase: 'preparing' | 'ready' | 'saving' | 'stale' | 'success' | 'error' | 'closed';
	readonly path: string;
	readonly lastSequence: number | null;
	readonly message: string;
}
export interface ExportResult { readonly ok: boolean; readonly destination: string; readonly sequence: number; readonly message: string }

export class ExportController {
	private current: ExportState;
	private prepared: PreparedExport | undefined;
	private reference: RecordingReference | undefined;
	private generation = 0;
	private committed = false;
	private closed = false;
	private disposed = false;
	private preparing: Promise<void> | undefined;
	private saving: Promise<void> | undefined;
	private listeners = new Set<() => void>();
	private unsubscribe: () => void;

	constructor(
		readonly path: string, private recordings: RecordingController, private adapter: ExportAdapter,
		private paths: ExportPaths, private existsNote: (path: string) => boolean,
		private queue: ExportCommitQueue, private onClosedResult: (result: ExportResult) => void = () => undefined,
	) {
		this.current = { phase: 'preparing', path, lastSequence: null, message: 'Loading saved recording…' };
		this.unsubscribe = recordings.replayAccess.subscribe((event) => {
			if (event.type === 'dispose') this.dispose();
			else if (event.type === 'invalidate' && event.path === path) this.stale();
			else if (event.type === 'rename') this.remove(event.from);
		});
	}

	get state(): ExportState { return this.current; }
	get canSave(): boolean { return !this.closed && !this.disposed && !!this.prepared && !this.saving && ['ready', 'error'].includes(this.current.phase); }
	subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
	private update(phase: ExportState['phase'], message: string): void {
		this.current = { ...this.current, phase, message };
		if (!this.closed && !this.disposed) this.listeners.forEach((listener) => listener());
	}
	private stale(): void {
		if (this.closed || this.disposed || this.committed || this.current.phase === 'success') return;
		this.generation++;
		this.prepared = undefined;
		this.reference = undefined;
		this.update('stale', 'The source changed. Stop and save it, then reopen export.');
	}
	remove(path: string): void { if (this.path === path || this.path.startsWith(path + '/')) this.stale(); }

	prepare(): Promise<void> {
		if (this.preparing) return this.preparing;
		if (this.closed || this.disposed || this.current.phase !== 'preparing') return Promise.resolve();
		const generation = this.generation;
		this.preparing = (async () => {
			try {
				if (!this.existsNote(this.path)) throw new Error('Missing note');
				const snapshot = await this.recordings.stoppedSnapshot(this.path);
				if (this.closed || this.disposed || generation !== this.generation) return;
				if (!snapshot || !this.existsNote(this.path) || !this.recordings.isReplayCurrent(snapshot)) { this.stale(); return; }
				this.prepared = prepareExport(snapshot.recording);
				this.reference = { id: snapshot.id, path: snapshot.path, revision: snapshot.revision };
				this.current = { ...this.current, lastSequence: this.prepared.lastSequence };
				this.update('ready', 'Ready to export the complete stopped recording.');
			} catch {
				if (!this.closed && !this.disposed && generation === this.generation) {
					this.update('error', 'Could not load a saved recording. Stop and save it, then reopen export.');
				}
			}
		})().finally(() => { this.preparing = undefined; });
		return this.preparing;
	}

	private valid(generation: number, reference: RecordingReference): boolean {
		if (this.closed || this.disposed || generation !== this.generation) return false;
		if (!this.existsNote(this.path) || !this.recordings.isReplayCurrent(reference)) { this.stale(); return false; }
		return true;
	}
	editDestination(): void {
		if (this.canSave && this.current.phase === 'error') this.update('ready', 'Ready to export the complete stopped recording.');
	}

	save(destination: string): Promise<void> {
		if (this.saving) return this.saving;
		if (!this.canSave || !this.prepared || !this.reference) return Promise.resolve();
		const error = validateDestination(destination, this.path, this.paths);
		if (error) { this.update('error', error); return Promise.resolve(); }
		const sequence = this.prepared.lastSequence;
		const reference = this.reference;
		const generation = this.generation;
		this.saving = this.queue.run(async () => {
			let attempted = false;
			try {
				if (!this.valid(generation, reference)) return;
				const folder = await this.adapter.folder(destinationParent(destination));
				if (!this.valid(generation, reference)) return;
				if (!folder) { this.update('error', 'Choose an existing destination folder.'); return; }
				const exists = await this.adapter.exists(destination);
				if (!this.valid(generation, reference)) return;
				if (exists) { this.update('error', 'That destination already exists. Choose another filename.'); return; }
				const prepared = this.prepared;
				if (!prepared) return;
				// No await between the final source check and the create call.
				this.committed = true;
				attempted = true;
				await this.adapter.create(destination, prepared.json);
				verifyExport(await this.adapter.read(destination), prepared);
				const message = `Exported ${destination} through step ${prepared.lastSequence}.`;
				if (!this.disposed) {
					if (this.closed) this.onClosedResult({ ok: true, destination, sequence: prepared.lastSequence, message });
					else this.update('success', message);
				}
				this.prepared = undefined;
				this.reference = undefined;
			} catch {
				const message = attempted ? 'Export could not be verified. A file may exist; inspect it or choose a new destination.' : 'The destination could not be checked. Try again.';
				if (!this.disposed && generation === this.generation) {
					if (this.closed) this.onClosedResult({ ok: false, destination, sequence, message });
					else this.update('error', message);
				}
			} finally { this.committed = false; }
		}).finally(() => { this.saving = undefined; if (!this.closed && !this.disposed) this.update(this.current.phase, this.current.message); });
		this.update('saving', 'Saving and verifying recording…');
		return this.saving;
	}

	close(): void {
		this.closed = true;
		if (!this.committed) this.generation++;
		this.unsubscribe();
		this.prepared = undefined;
		this.reference = undefined;
		this.listeners.clear();
		this.current = { ...this.current, phase: 'closed' };
	}
	settled(): Promise<void> { return this.saving ?? this.preparing ?? Promise.resolve(); }
	dispose(): void { this.disposed = true; this.close(); }
}
