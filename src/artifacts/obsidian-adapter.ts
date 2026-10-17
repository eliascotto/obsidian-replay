import { TFile, type Plugin } from 'obsidian';
import { StorageError, type StorageAdapter } from '../storage/types';
import type { ArtifactAdapter } from './publisher';

export class ObsidianArtifactAdapter implements ArtifactAdapter {
	constructor(private plugin: Plugin, private storage: StorageAdapter, private root: string) {}
	async exists(path: string): Promise<boolean> {
		return this.plugin.app.vault.getAbstractFileByPath(path) !== null || await this.plugin.app.vault.adapter.exists(path);
	}
	private file(path: string): TFile {
		const file = this.plugin.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) throw new StorageError(`Recording file is missing: ${path}`);
		return file;
	}
	read(path: string): Promise<string> { return this.plugin.app.vault.read(this.file(path)); }
	async create(path: string, text: string): Promise<void> {
		// Also protect files not indexed yet and case variants on insensitive filesystems.
		if (await this.exists(path)) throw new StorageError(`${path} already exists. Move or rename it, then retry saving.`);
		await this.plugin.app.vault.create(path, text);
	}
	async replace(path: string, expected: string, text: string): Promise<void> {
		await this.plugin.app.vault.process(this.file(path), (current) => {
			if (current !== expected) throw new StorageError(`${path} changed while saving. Existing contents were preserved.`);
			return text;
		});
	}
	rename(from: string, to: string): Promise<void> { return this.plugin.app.fileManager.renameFile(this.file(from), to); }
	async loadRegistry(): Promise<string | null> {
		const path = this.root + '/artifacts.json';
		return await this.storage.exists(path) ? this.storage.read(path) : null;
	}
	async saveRegistry(text: string): Promise<void> {
		await this.storage.mkdir(this.root);
		await this.storage.replace(this.root + '/artifacts.json', text);
	}
}
