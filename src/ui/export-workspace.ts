import { MarkdownView, Notice, TFile, type Plugin } from 'obsidian';
import { ExportCommitQueue } from '../export/commit-queue';
import { ExportController } from '../export/export-controller';
import { ObsidianExportAdapter } from '../export/obsidian-export-adapter';
import type { RecordingController } from '../recording/controller';
import { ExportModal } from './export-modal';
import { ReplayView } from './replay-view';

export class ExportWorkspace {
	private active: ExportModal | undefined;
	private requests = new Set<ExportController>();
	private queue = new ExportCommitQueue();
	private disposed = false;

	constructor(private plugin: Plugin, private recordings: RecordingController, private pauseReplay: (path: string) => void) {
		plugin.registerEvent(plugin.app.vault.on('delete', (file) => {
			for (const request of this.requests) request.remove(file.path);
		}));
	}

	private note(path: string): boolean {
		const file = this.plugin.app.vault.getAbstractFileByPath(path);
		return file instanceof TFile && file.extension.toLowerCase() === 'md';
	}
	private currentPath(): string | null {
		const workspace = this.plugin.app.workspace;
		const file = workspace.getActiveViewOfType(MarkdownView)?.file;
		if (file?.extension.toLowerCase() === 'md') return file.path;
		return workspace.getActiveViewOfType(ReplayView)?.exportPath ?? null;
	}
	canOpen(): boolean {
		const path = this.currentPath();
		return !this.disposed && path !== null && this.note(path) && this.recordings.status(path) === 'stopped';
	}
	openCurrent(): void { const path = this.currentPath(); if (path && this.canOpen()) this.open(path); }

	open(path: string): void {
		if (this.disposed) return;
		if (this.active) { this.active.focus(); return; }
		const paths = {
			configDir: this.plugin.app.vault.configDir,
			pluginDir: this.plugin.manifest.dir ?? `${this.plugin.app.vault.configDir}/plugins/${this.plugin.manifest.id}`,
		};
		const request = new ExportController(path, this.recordings, new ObsidianExportAdapter(this.plugin.app.vault), paths,
			(source) => this.note(source), this.queue, (result) => { if (!this.disposed) new Notice(result.message, 8000); });
		this.pauseReplay(path);
		this.requests.add(request);
		const modal = new ExportModal(this.plugin.app, request, paths, () => {
			if (this.active === modal) this.active = undefined;
			void request.settled().finally(() => this.requests.delete(request));
		});
		this.active = modal;
		modal.open();
	}

	dispose(): void {
		this.disposed = true;
		for (const request of this.requests) request.dispose();
		this.active?.close();
		this.active = undefined;
		this.requests.clear();
	}
}
