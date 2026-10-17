import { applyStep } from '../recording/engine';
import { serializeRecording } from '../recording/format';
import { RECORDING_FORMAT, RECORDING_FORMAT_VERSION, type RecordingStep, type RecordingFile } from '../recording/types';
import { parseIndex, parseRecords, remap, validId, validateMetadata, type RecordingIndex } from './records';
import { StorageError, type StorageAdapter, type StoredRecording } from './types';

type Cached = StoredRecording & { repair?: string };

export class RecordingStore {
	private index: RecordingIndex | undefined;
	private tail: Promise<unknown> = Promise.resolve();
	private cache = new Map<string, Cached>();
	private dirtyMetadata = new Set<string>();

	constructor(private adapter: StorageAdapter, readonly root: string) {}

	private serial<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.tail.then(operation);
		this.tail = result.catch(() => undefined);
		return result;
	}

	private async indexData(): Promise<RecordingIndex> {
		if (this.index) return this.index;
		await this.adapter.mkdir(this.root);
		this.index = await this.adapter.exists(this.root + '/index.json')
			? parseIndex(await this.adapter.read(this.root + '/index.json'))
			: { storageVersion: 1, notes: Object.create(null) as Record<string, string> };
		return this.index;
	}

	private async commitIndex(index: RecordingIndex): Promise<void> {
		try {
			await this.adapter.replace(this.root + '/index.json', JSON.stringify(index));
			this.index = index;
		} catch (error) {
			this.index = undefined;
			throw error;
		}
	}

	private directory(id: string): string {
		if (!validId(id)) throw new StorageError('Invalid recording ID.');
		return this.root + '/' + id;
	}

	private async metadata(id: string, count: number): Promise<void> {
		const index = await this.indexData();
		const currentPath = Object.keys(index.notes).find((path) => index.notes[path] === id);
		if (!currentPath) throw new StorageError('Recording is missing from the index.');
		await this.adapter.replace(this.directory(id) + '/metadata.json', JSON.stringify({
			storageVersion: 1, id, currentPath, lastSequence: count,
		}));
	}

	private async readId(id: string): Promise<Cached> {
		const cached = this.cache.get(id);
		if (cached) return cached;
		const dir = this.directory(id);
		validateMetadata(await this.adapter.read(dir + '/metadata.json'), id);
		const parsed = parseRecords(
			await this.adapter.read(dir + '/initial.json'), await this.adapter.read(dir + '/steps.ndjson'),
		);
		const loaded = { id, ...parsed };
		this.cache.set(id, loaded);
		return loaded;
	}

	has(path: string): Promise<boolean> {
		return this.serial(async () => !!(await this.indexData()).notes[path]);
	}

	paths(): Promise<string[]> { return this.serial(async () => Object.keys((await this.indexData()).notes)); }

	release(id: string): void { this.cache.delete(id); }

	load(path: string): Promise<StoredRecording | null> {
		return this.serial(async () => {
			const id = (await this.indexData()).notes[path];
			return id ? this.readId(id) : null;
		});
	}

	open(path: string, initialText: string, proposedId: string): Promise<StoredRecording> {
		return this.serial(async () => {
			const index = await this.indexData();
			const existing = index.notes[path];
			if (existing) return this.readId(existing);
			const dir = this.directory(proposedId);
			if (Object.values(index.notes).includes(proposedId)) throw new StorageError('Recording ID is already in use.');
			await this.adapter.mkdir(dir);
			const recording: RecordingFile = {
				format: RECORDING_FORMAT, formatVersion: RECORDING_FORMAT_VERSION, initialText, steps: [],
			};
			// Only this unpublished creation attempt owns this directory. Published histories are never reset.
			if (await this.adapter.exists(dir + '/steps.ndjson') &&
				await this.adapter.read(dir + '/steps.ndjson') !== '') {
				throw new StorageError('Unpublished recording already contains steps.');
			}
			await this.adapter.replace(dir + '/initial.json', serializeRecording(recording));
			await this.adapter.replace(dir + '/steps.ndjson', '');
			await this.adapter.replace(dir + '/metadata.json', JSON.stringify({
				storageVersion: 1, id: proposedId, currentPath: path, lastSequence: 0,
			}));
			await this.commitIndex({ storageVersion: 1, notes: { ...index.notes, [path]: proposedId } });
			const stored = { id: proposedId, recording, finalText: initialText };
			this.cache.set(proposedId, stored);
			return stored;
		});
	}

	append(id: string, batch: readonly RecordingStep[]): Promise<void> {
		return this.serial(async () => {
			try {
				const stored = await this.readId(id);
				const steps = [...stored.recording.steps];
				let state = stored.finalText;
				const missing: RecordingStep[] = [];
				for (const step of batch) {
					if (step.sequence <= steps.length) {
						if (JSON.stringify(steps[step.sequence - 1]) !== JSON.stringify(step)) {
							throw new StorageError('Stored and queued steps conflict.');
						}
						continue;
					}
					if (step.sequence !== steps.length + 1) throw new StorageError('Queued step sequence is not consecutive.');
					state = applyStep(state, step);
					steps.push(step);
					missing.push(step);
				}
				const path = this.directory(id) + '/steps.ndjson';
				if (stored.repair !== undefined) await this.adapter.replace(path, stored.repair);
				if (missing.length) await this.adapter.append(path, missing.map((step) => JSON.stringify(step) + '\n').join(''));
				this.cache.set(id, { id, recording: { ...stored.recording, steps }, finalText: state });
				await this.metadata(id, steps.length);
			} catch (error) {
				// Re-read before retry: a rejected append may have persisted some or all records.
				this.cache.delete(id);
				throw error;
			}
		});
	}

	rename(from: string, to: string): Promise<void> {
		return this.serial(async () => {
			const index = await this.indexData();
			const notes: Record<string, string> = Object.create(null) as Record<string, string>;
			let changed = false;
			for (const [path, id] of Object.entries(index.notes)) {
				const next = remap(path, from, to);
				if (notes[next] && notes[next] !== id) throw new StorageError('Rename would merge recordings.');
				notes[next] = id;
				if (next !== path) { this.dirtyMetadata.add(id); changed = true; }
			}
			if (changed) await this.commitIndex({ storageVersion: 1, notes });
			// Retry only affected advisory metadata, including any earlier failed updates.
			for (const id of this.dirtyMetadata) {
				const metadata = validateMetadata(await this.adapter.read(this.directory(id) + '/metadata.json'), id);
				await this.metadata(id, metadata.lastSequence);
				this.dirtyMetadata.delete(id);
			}
		});
	}
}
