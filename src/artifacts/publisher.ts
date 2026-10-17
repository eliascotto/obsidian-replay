import { prepareArtifact, verifyArtifact } from './recording-artifact';
import { remap } from '../storage/records';
import { StorageError, type StoredRecording } from '../storage/types';
import { artifactPath } from './paths';
import { fingerprint, parseRegistry, type ArtifactEntry, type ArtifactRegistry } from './registry';

export interface ArtifactAdapter {
	exists(path: string): Promise<boolean>;
	read(path: string): Promise<string>;
	create(path: string, text: string): Promise<void>;
	replace(path: string, expected: string, text: string): Promise<void>;
	rename(from: string, to: string): Promise<void>;
	loadRegistry(): Promise<string | null>;
	saveRegistry(text: string): Promise<void>;
}

/** All destination/registry mutations share a queue; portable files never establish ownership. */
export class ArtifactPublisher {
	private registry: ArtifactRegistry | undefined;
	private tail: Promise<unknown> = Promise.resolve();
	private moving = new Set<string>();

	constructor(private adapter: ArtifactAdapter) {}

	private serial<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.tail.then(operation);
		this.tail = result.catch(() => undefined);
		return result;
	}
	private async data(): Promise<ArtifactRegistry> {
		return this.registry ??= parseRegistry(await this.adapter.loadRegistry());
	}
	private async save(): Promise<void> { await this.adapter.saveRegistry(JSON.stringify(await this.data())); }
	load(): Promise<void> {
		return this.registry ? Promise.resolve() : this.serial(async () => { await this.data(); });
	}
	settled(): Promise<unknown> { return this.tail; }
	owner(path: string): string | null {
		return Object.values(this.registry?.entries ?? {}).find((entry) => entry.path === path)?.source ?? null;
	}
	needsRecovery(source: string): Promise<boolean> {
		return this.serial(async () => {
			const entry = Object.values((await this.data()).entries).find((candidate) => candidate.source === source);
			return !entry || !!entry.active || !!entry.pending || entry.path !== artifactPath(source);
		});
	}
	private collision(path: string): never {
		throw new StorageError(`${path} already exists or changed outside Replay. Move or rename it, then retry saving.`);
	}
	private async checked(entry: ArtifactEntry, path = entry.path): Promise<string> {
		const text = await this.adapter.read(path);
		const hash = await fingerprint(text);
		if (hash !== entry.fingerprint && hash !== entry.pending) this.collision(path);
		return text;
	}

	publish(source: string, stored: StoredRecording, ensureOnly = false): Promise<void> {
		return this.serial(async () => {
			const registry = await this.data();
			const path = artifactPath(source);
			let entry = registry.entries[stored.id];
			if (entry && entry.source !== source) throw new StorageError('The recording moved. Retry saving.');
			if (entry && entry.path !== path) await this.relocate(entry, path);
			const exists = await this.adapter.exists(path);
			if (exists && !entry) this.collision(path);
			const previous = exists && entry ? await this.checked(entry) : undefined;
			if (ensureOnly && previous !== undefined && entry && !entry.pending) { entry.active = true; await this.save(); return; }
			if (entry && entry.sequence > stored.recording.steps.length) throw new StorageError('A newer recording file is already saved.');
			const prepared = prepareArtifact(stored.recording);
			const hash = await fingerprint(prepared.json);
			entry ??= { source, path, sequence: -1, fingerprint: '' };
			registry.entries[stored.id] = entry;
			entry.pending = hash;
			entry.active = ensureOnly;
			await this.save(); // Durable write intent makes create/readback/registry failures retryable.
			if (previous === undefined) await this.adapter.create(path, prepared.json);
			else if (previous !== prepared.json) await this.adapter.replace(path, previous, prepared.json);
			verifyArtifact(await this.adapter.read(path), prepared);
			entry.fingerprint = hash;
			entry.sequence = stored.recording.steps.length;
			delete entry.pending;
			await this.save();
		});
	}

	private async relocate(entry: ArtifactEntry, target: string): Promise<void> {
		if (entry.path === target) return;
		const oldExists = await this.adapter.exists(entry.path);
		if (await this.adapter.exists(target)) {
			if (oldExists || (!entry.movedWithFolder && entry.relocating !== target)) this.collision(target);
			// A folder rename can already have moved both the note and its companion.
			await this.checked(entry, target);
		} else if (oldExists) {
			await this.checked(entry);
			entry.relocating = target;
			await this.save();
			const key = entry.path + '\n' + target;
			this.moving.add(key);
			try { await this.adapter.rename(entry.path, target); }
			finally { this.moving.delete(key); }
		}
		entry.path = target;
		delete entry.movedWithFolder;
		delete entry.relocating;
		await this.save();
	}

	rename(from: string, to: string): Promise<void> {
		return this.serial(async () => {
			const data = await this.data();
			for (const [id, entry] of Object.entries(data.entries)) {
				const next = remap(entry.source, from, to);
				if (next === entry.source) continue;
				if (!/\.md$/i.test(next)) {
					delete data.entries[id];
					await this.save();
					continue;
				}
				entry.movedWithFolder = remap(entry.path, from, to) === artifactPath(next);
				entry.source = next;
				await this.save(); // Retain the old artifact path until relocation succeeds.
				await this.relocate(entry, artifactPath(next));
			}
		});
	}

	artifactRenamed(from: string, to: string): Promise<void> {
		if (this.moving.has(from + '\n' + to)) return Promise.resolve();
		return this.serial(async () => {
			const data = await this.data();
			for (const [id, entry] of Object.entries(data.entries)) {
				if (entry.path === from) delete data.entries[id];
			}
			await this.save();
		});
	}

	sourceDeleted(path: string): Promise<void> {
		return this.serial(async () => {
			const data = await this.data();
			for (const [id, entry] of Object.entries(data.entries)) {
				if (entry.source === path || entry.source.startsWith(path + '/')) delete data.entries[id];
			}
			await this.save();
		});
	}
}
