import type { ExportAdapter } from '../../src/export/export-controller';

export class MemoryExportAdapter implements ExportAdapter {
	files = new Map<string, string>();
	folders = new Set(['', 'exports', 'nested']);
	calls: { operation: string; path: string }[] = [];
	caseInsensitive = false;
	before: ((operation: string, path: string) => Promise<void>) | undefined;
	after: ((operation: string, path: string) => Promise<void>) | undefined;
	transform: (text: string) => string = (text) => text;
	private key(path: string): string { return this.caseInsensitive ? path.toLowerCase() : path; }
	async folder(path: string): Promise<boolean> { await this.before?.('folder', path); return this.folders.has(this.key(path)); }
	async exists(path: string): Promise<boolean> { await this.before?.('exists', path); return this.files.has(this.key(path)) || this.folders.has(this.key(path)); }
	async create(path: string, text: string): Promise<void> {
		await this.before?.('create', path);
		if (this.files.has(this.key(path)) || this.folders.has(this.key(path))) throw new Error('Already exists');
		this.calls.push({ operation: 'create', path });
		this.files.set(this.key(path), text);
		await this.after?.('create', path);
	}
	async read(path: string): Promise<string> {
		await this.before?.('read', path);
		const text = this.files.get(this.key(path));
		if (text === undefined) throw new Error('Missing file');
		return this.transform(text);
	}
}
