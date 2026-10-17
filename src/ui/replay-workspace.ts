import { MarkdownView, Notice, TFile, type Plugin, type WorkspaceLeaf } from 'obsidian';
import type { RecordingController } from '../recording/controller';
import { ReplayCoordinator } from '../replay/coordinator';
import type { Scheduler } from '../storage/types';
import { ReplayView, REPLAY_VIEW_TYPE } from './replay-view';

/** Obsidian-only bridge; historical loading/timing lives in the pure coordinator. */
export class ReplayWorkspace {
	readonly coordinator: ReplayCoordinator;
	private activeView: ReplayView | undefined;
	private creating: Promise<WorkspaceLeaf> | undefined;
	private request = 0;
	private disposed = false;

	constructor(private plugin: Plugin, private recordings: RecordingController, clock: Scheduler, openExport: (path: string) => void) {
		this.coordinator = new ReplayCoordinator(recordings, clock, (path) => this.note(path) !== null);
		plugin.registerView(REPLAY_VIEW_TYPE, (leaf) => {
			const view = new ReplayView(leaf, this.coordinator, () => this.bind(view), () => this.closed(view), openExport);
			return view;
		});
		plugin.registerEvent(plugin.app.vault.on('delete', (file) => this.coordinator.remove(file.path)));
	}

	private bind(view: ReplayView): void {
		const previous = this.activeView;
		this.activeView = view;
		if (previous && previous !== view) previous.leaf.detach();
	}

	private closed(view: ReplayView): void {
		if (this.activeView !== view) return;
		this.activeView = undefined;
		this.request++;
		this.coordinator.close();
	}

	private note(path: string): TFile | null {
		const file = this.plugin.app.vault.getAbstractFileByPath(path);
		return file instanceof TFile && file.extension.toLowerCase() === 'md' ? file : null;
	}

	private currentPath(): string | null {
		const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
		if (view?.file?.extension.toLowerCase() === 'md') return view.file.path;
		return this.plugin.app.workspace.getActiveViewOfType(ReplayView)?.path ?? null;
	}

	canOpen(): boolean {
		const path = this.currentPath();
		return !this.disposed && path !== null && this.recordings.status(path) === 'stopped' && this.note(path) !== null;
	}

	openCurrent(): void {
		const path = this.currentPath();
		if (path && this.canOpen()) void this.open(path);
	}
	pause(path: string): void {
		const state = this.coordinator.state;
		if (state.phase === 'ready' && state.path === path) state.player.pause();
	}

	private ensureLeaf(): Promise<WorkspaceLeaf> {
		if (this.creating) return this.creating;
		this.creating = (async () => {
			const existing = this.plugin.app.workspace.getLeavesOfType(REPLAY_VIEW_TYPE)[0];
			if (existing) return existing;
			const leaf = this.plugin.app.workspace.getLeaf('tab');
			await leaf.setViewState({ type: REPLAY_VIEW_TYPE, active: true });
			return leaf;
		})().finally(() => { this.creating = undefined; });
		return this.creating;
	}

	async open(path: string): Promise<void> {
		if (this.disposed) return;
		const request = ++this.request;
		try {
			const leaf = await this.ensureLeaf();
			if (this.disposed || request !== this.request) return;
			await this.plugin.app.workspace.revealLeaf(leaf);
			if (this.disposed || request !== this.request) return;
			this.plugin.app.workspace.setActiveLeaf(leaf, { focus: true });
			await this.coordinator.open(path);
		} catch {
			if (!this.disposed && request === this.request) new Notice('The replay view could not be opened.');
		}
	}

	dispose(): void {
		this.disposed = true;
		this.request++;
		this.coordinator.dispose();
		const view = this.activeView;
		this.activeView = undefined;
		view?.leaf.detach();
	}
}
