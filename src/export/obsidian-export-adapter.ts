import { TFolder, type Vault } from 'obsidian';
import type { ExportAdapter } from './export-controller';

export class ObsidianExportAdapter implements ExportAdapter {
	constructor(private vault: Vault) {}
	async folder(path: string): Promise<boolean> {
		return path === '' || this.vault.getAbstractFileByPath(path) instanceof TFolder;
	}
	async exists(path: string): Promise<boolean> {
		return !!this.vault.getAbstractFileByPath(path) || await this.vault.adapter.exists(path);
	}
	async create(path: string, text: string): Promise<void> { await this.vault.create(path, text); }
	read(path: string): Promise<string> { return this.vault.adapter.read(path); }
}
