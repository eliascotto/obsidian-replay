import type { ArtifactAdapter } from '../../src/artifacts/publisher';

export class MemoryArtifacts implements ArtifactAdapter {
	files = new Map<string, string>();
	registry: string | null = null;
	before: ((operation: string, path: string) => Promise<void>) | undefined;
	after: ((operation: string, path: string) => Promise<void>) | undefined;
	calls: string[] = [];
	async exists(path: string): Promise<boolean> { return this.files.has(path); }
	async read(path: string): Promise<string> {
		await this.before?.('read', path);
		const text = this.files.get(path);
		if (text === undefined) throw new Error('Missing file');
		return text;
	}
	async create(path: string, text: string): Promise<void> {
		await this.before?.('create', path);
		if (this.files.has(path)) throw new Error('Already exists');
		this.files.set(path, text);
		this.calls.push('create');
		await this.after?.('create', path);
	}
	async replace(path: string, expected: string, text: string): Promise<void> {
		await this.before?.('replace', path);
		if (this.files.get(path) !== expected) throw new Error('Changed while saving');
		this.files.set(path, text);
		this.calls.push('replace');
		await this.after?.('replace', path);
	}
	async rename(from: string, to: string): Promise<void> {
		if (this.files.has(to)) throw new Error('Already exists');
		this.files.set(to, await this.read(from));
		this.files.delete(from);
	}
	async loadRegistry(): Promise<string | null> { return this.registry; }
	async saveRegistry(text: string): Promise<void> {
		await this.before?.('registry', '');
		this.registry = text;
		await this.after?.('registry', '');
	}
}
