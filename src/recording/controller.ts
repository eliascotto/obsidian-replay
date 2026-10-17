import { createResumeStep } from './engine';
import { RecordingSession, type Observation, type RecordingPhase } from './session';
import { RecordingStore } from '../storage/recording-store';
import { remap } from '../storage/records';
import { WriteQueue } from '../storage/write-queue';
import { StorageError, type Scheduler, type StoredRecording } from '../storage/types';
import type { RecordingFile } from './types';
import { ReplayAccess, type RecordingReference, type StoppedSnapshot } from './replay-access';

export interface RecordingArtifacts {
	publish(path: string, stored: StoredRecording, ensureOnly?: boolean): Promise<void>;
	rename(from: string, to: string): Promise<void>;
}

export class RecordingController {
	readonly replayAccess = new ReplayAccess();
	private inspections = new Set<{ path: string }>();
	private known = new Set<string>();
	private sessions = new Map<string, RecordingSession>();
	private listeners = new Set<() => void>();
	private disposed = false;
	private renames: { from: string; to: string }[] = [];
	private renaming: Promise<void> | undefined;

	constructor(
		private store: RecordingStore,
		private onError: (path: string, error: unknown) => void,
		private clock: Scheduler,
		private makeId: () => string = () => crypto.randomUUID(),
		private beforeStart: (path: string) => void = () => undefined,
		private artifacts?: RecordingArtifacts,
	) {}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => { this.listeners.delete(listener); };
	}

	private changed(): void {
		if (!this.disposed) this.listeners.forEach((listener) => listener());
	}

	status(path: string): RecordingPhase { return this.sessions.get(path)?.phase ?? (this.known.has(path) ? 'stopped' : 'absent'); }

	isCapturing(path: string): boolean {
		return !this.disposed && !!this.sessions.get(path)?.capturing;
	}

	async inspect(path: string): Promise<void> {
		if (this.disposed || this.sessions.has(path) || this.known.has(path)) return;
		const inspection = { path };
		this.inspections.add(inspection);
		try {
			const exists = await this.store.has(path);
			if (exists) this.known.add(inspection.path);
			this.changed();
		} catch (error) { if (!this.disposed) this.onError(inspection.path, error); }
		finally { this.inspections.delete(inspection); }
	}

	private fail(session: RecordingSession, error: unknown): void {
		this.replayAccess.invalidate(session.path);
		const first = session.phase !== 'error';
		session.capturing = false;
		session.phase = 'error';
		session.error = error;
		this.changed();
		if (first && !this.disposed) this.onError(session.path, error);
	}

	start(path: string, text: string): Promise<void> {
		if (this.disposed) return Promise.reject(new StorageError('Recording has been unloaded.'));
		const current = this.sessions.get(path);
		if (current?.phase === 'starting' || current?.phase === 'recording') {
			return current.initializing ?? Promise.resolve();
		}
		if (current?.phase === 'stopping' || current?.phase === 'error') {
			return Promise.reject(new StorageError('Stop recording and retry saving before starting again.'));
		}
		this.replayAccess.invalidate(path);
		this.beforeStart(path);
		current?.queue?.dispose();
		const session = new RecordingSession(path, current?.id ?? this.makeId(), text);
		this.sessions.set(path, session);
		this.changed();
		return this.initialize(session);
	}

	private initialize(session: RecordingSession): Promise<void> {
		if (session.initialized) return Promise.resolve();
		if (session.initializing) return session.initializing;
		session.initializing = this.attach(session).catch((error: unknown) => {
			this.fail(session, error);
			throw error;
		}).finally(() => { session.initializing = undefined; });
		return session.initializing;
	}

	private async attach(session: RecordingSession): Promise<void> {
		await this.flushRenames();
		const stored = await this.store.open(session.path, session.snapshot, session.id);
		session.id = stored.id;
		const resume = createResumeStep(stored.finalText, session.snapshot, stored.recording.steps.length + 1);
		const offset = stored.recording.steps.length + (resume ? 1 : 0);
		const queue = new WriteQueue(
			(batch) => this.store.append(session.id, batch), (error) => this.fail(session, error), this.clock,
		);
		if (this.disposed) queue.dispose();
		if (resume) queue.enqueue(resume);
		for (const step of session.buffer) queue.enqueue({ ...step, sequence: step.sequence + offset });
		session.buffer = [];
		session.queue = queue;
		session.nextSequence += offset;
		session.initialized = true;
		await this.artifacts?.publish(session.path, stored, true);
		if (session.capturing) session.phase = 'recording';
		this.changed();
	}

	capture(path: string, observation: Observation): void {
		const session = this.sessions.get(path);
		if (!session || this.disposed) return;
		try { session.accept(observation); }
		catch (error) { this.fail(session, error); }
	}

	stop(path: string): Promise<void> {
		const session = this.sessions.get(path);
		if (!session) return Promise.resolve();
		session.capturing = false;
		if (session.stopping) return session.stopping;
		this.replayAccess.invalidate(path);
		session.phase = 'stopping';
		this.changed();
		session.stopping = this.save(session).catch((error: unknown) => {
			this.fail(session, error);
			throw error;
		}).finally(() => { session.stopping = undefined; });
		return session.stopping;
	}

	private async save(session: RecordingSession): Promise<void> {
		await this.flushRenames();
		await this.initialize(session);
		await session.queue?.flush();
		if (this.artifacts) {
			let publishedPath: string;
			do {
				await this.flushRenames();
				publishedPath = session.path;
				const stored = await this.store.load(publishedPath);
				if (!stored) throw new StorageError('The saved recording is missing.');
				await this.artifacts.publish(publishedPath, stored);
				await this.flushRenames();
			} while (publishedPath !== session.path);
		}
		this.store.release(session.id);
		session.error = undefined;
		session.phase = 'stopped';
		this.changed();
	}

	async flush(path: string): Promise<void> {
		const session = this.sessions.get(path);
		if (!session) return;
		try {
			await this.flushRenames();
			await this.initialize(session);
			await session.queue?.flush();
		} catch (error) { this.fail(session, error); throw error; }
	}

	private assertStopped(path: string): void {
		const session = this.sessions.get(path);
		if (this.disposed || (session && session.phase !== 'stopped')) {
			throw new StorageError('Stop and save the recording first.');
		}
	}

	isReplayCurrent(reference: RecordingReference): boolean {
		return !this.disposed && this.status(reference.path) === 'stopped' &&
			this.replayAccess.revision(reference.path) === reference.revision;
	}

	async stoppedSnapshot(path: string): Promise<StoppedSnapshot | null> {
		this.assertStopped(path);
		const revision = this.replayAccess.revision(path);
		await this.flushRenames();
		const stored = await this.store.load(path);
		this.assertStopped(path);
		if (revision !== this.replayAccess.revision(path)) {
			throw new StorageError('Recording changed while replay was loading. Open replay again.');
		}
		if (!stored) return null;
		this.known.add(path);
		return { id: stored.id, path, revision, recording: stored.recording };
	}

	async stoppedRecording(path: string): Promise<RecordingFile | null> {
		return (await this.stoppedSnapshot(path))?.recording ?? null;
	}

	rename(from: string, to: string): Promise<void> {
		if (this.disposed) return Promise.resolve();
		for (const inspection of this.inspections) inspection.path = remap(inspection.path, from, to);
		this.renames.push({ from, to });
		this.known = new Set([...this.known].map((path) => remap(path, from, to)));
		const moved = new Map<string, RecordingSession>();
		const affected = new Set<RecordingSession>();
		for (const session of this.sessions.values()) {
			const nextPath = remap(session.path, from, to);
			if (nextPath !== session.path) affected.add(session);
			session.path = nextPath;
			moved.set(session.path, session);
		}
		this.sessions = moved;
		this.replayAccess.rename(from, to);
		this.changed();
		return this.flushRenames().then(() => this.changed()).catch((error: unknown) => {
			for (const session of affected) this.fail(session, error);
			if (!affected.size && !this.disposed) this.onError(to, error);
			throw error;
		});
	}

	private async flushRenames(): Promise<void> {
		if (!this.renaming && this.renames.length) {
			this.renaming = this.applyRenames().finally(() => { this.renaming = undefined; });
		}
		await this.renaming;
		// A rename can arrive after the drain observes an empty queue but before its promise settles.
		if (this.renames.length) await this.flushRenames();
	}

	private async applyRenames(): Promise<void> {
		while (this.renames.length) {
			const next = this.renames[0];
			if (!next) break;
			await this.store.rename(next.from, next.to);
			await this.artifacts?.rename(next.from, next.to);
			this.renames.shift();
		}
	}

	async dispose(): Promise<void> {
		this.disposed = true;
		this.replayAccess.dispose();
		const paths = [...this.sessions.keys()];
		for (const session of this.sessions.values()) {
			session.capturing = false;
			session.queue?.dispose();
		}
		this.listeners.clear();
		await Promise.allSettled(paths.map((path) => this.stop(path)));
	}
}
