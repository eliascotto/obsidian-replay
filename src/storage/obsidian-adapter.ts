import { normalizePath, type DataAdapter, type Plugin } from 'obsidian';
import type { Scheduler, StorageAdapter } from './types';

export function recordingRoot(plugin: Plugin): string {
	return normalizePath((plugin.manifest.dir ??
		`${plugin.app.vault.configDir}/plugins/${plugin.manifest.id}`) + '/recordings');
}

export class ObsidianStorageAdapter implements StorageAdapter {
	constructor(private adapter: DataAdapter) {}
	exists(path: string): Promise<boolean> { return this.adapter.exists(path); }
	read(path: string): Promise<string> { return this.adapter.read(path); }
	write(path: string, text: string): Promise<void> { return this.adapter.write(path, text); }
	append(path: string, text: string): Promise<void> { return this.adapter.append(path, text); }

	async replace(path: string, text: string): Promise<void> {
		if (await this.adapter.exists(path)) {
			// The vault adapter's atomic read/modify/write preserves the last good file.
			await this.adapter.process(path, () => text);
		} else {
			await this.adapter.write(path + '.tmp', text);
			await this.adapter.rename(path + '.tmp', path);
		}
	}

	async mkdir(path: string): Promise<void> {
		const parts = normalizePath(path).split('/');
		for (let count = 1; count <= parts.length; count++) {
			const part = parts.slice(0, count).join('/');
			if (!await this.adapter.exists(part)) await this.adapter.mkdir(part);
		}
	}
}

export const browserScheduler: Scheduler = {
	set: (callback, delay) => window.setTimeout(callback, delay),
	clear: (handle) => window.clearTimeout(handle as number),
};
