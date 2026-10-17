import { MarkdownView, Notice, TFile, type Plugin } from 'obsidian';
import type { RecordingController } from '../recording/controller';
import type { RecordingStore } from '../storage/recording-store';
import type { Scheduler } from '../storage/types';
import type { ArtifactPublisher } from '../artifacts/publisher';
import { artifactPath } from '../artifacts/paths';
import { ReplayFileController } from '../replay/file-controller';
import { remap } from '../storage/records';
import { ReplayView, REPLAY_VIEW_TYPE } from './replay-view';
import type { ReplayPreferences } from '../settings';

export class ReplayWorkspace {
	private players = new Set<ReplayFileController>();
	private disposed = false;
	private migrationTimer: unknown;

	constructor(private plugin: Plugin, private recordings: RecordingController, private store: RecordingStore,
		private artifacts: ArtifactPublisher, private clock: Scheduler, preferences: ReplayPreferences) {
		plugin.registerView(REPLAY_VIEW_TYPE, (leaf) => {
			const player = new ReplayFileController(async (path) => {
				// Ownership errors block publication, not reading a standalone portable file.
				try { await artifacts.load(); } catch { /* The migration/publisher reports the registry error. */ }
				const file = plugin.app.vault.getAbstractFileByPath(path);
				if (!(file instanceof TFile)) throw new Error('The recording file is missing.');
				return plugin.app.vault.read(file);
			}, clock, (path) => {
				const source = artifacts.owner(path);
				return source !== null && !['absent', 'stopped'].includes(recordings.status(source));
			}, preferences);
			this.players.add(player);
			return new ReplayView(leaf, player, (path) => this.ensure(path), () => this.players.delete(player));
		});
		plugin.registerExtensions(['replay'], REPLAY_VIEW_TYPE);
		plugin.register(recordings.subscribe(() => {
			for (const player of this.players) player.refreshCapture();
		}));
		plugin.registerEvent(plugin.app.vault.on('modify', (file) => {
			if (!(file instanceof TFile) || file.extension !== 'replay') return;
			for (const player of this.players) if (player.state.path === file.path) void player.open(file.path);
		}));
		plugin.registerEvent(plugin.app.vault.on('rename', (file, from) => {
			if (from.endsWith('.replay')) void artifacts.artifactRenamed(from, file.path).catch((error: unknown) => this.report(error));
			this.remapViews(from, file.path);
		}));
		plugin.registerEvent(plugin.app.vault.on('delete', (file) => {
			if (!(file instanceof TFile) || file.extension.toLowerCase() === 'md') {
				void artifacts.sourceDeleted(file.path).catch((error: unknown) => this.report(error));
			}
			for (const player of this.players) {
				const path = player.state.path;
				if (path && (path === file.path || path.startsWith(file.path + '/'))) player.unavailable(path, 'The recording file was deleted.');
			}
		}));
		plugin.app.workspace.onLayoutReady(() => { void this.migrate().catch((error: unknown) => this.report(error)); });
	}

	private remapViews(from: string, to: string): void {
		for (const leaf of this.plugin.app.workspace.getLeavesOfType(REPLAY_VIEW_TYPE)) {
			const state = leaf.getViewState();
			const path = state.state?.file;
			if (typeof path !== 'string') continue;
			const next = remap(path, from, to);
			if (next === path) continue;
			// Deferred custom file tabs also need their persisted path/title updated.
			void leaf.setViewState({ type: REPLAY_VIEW_TYPE, state: { ...state.state, file: next }, pinned: state.pinned, group: state.group })
				.then(async () => {
					if (leaf.view instanceof ReplayView && leaf.view.file && leaf.view.path !== leaf.view.file.path) {
						await leaf.view.onRename(leaf.view.file);
					}
				}).catch((error: unknown) => this.report(error));
		}
	}

	private report(error: unknown): void {
		if (!this.disposed) new Notice(error instanceof Error ? error.message : 'The recording file could not be saved.', 8000);
	}

	currentSource(): string | null {
		const note = this.plugin.app.workspace.getActiveViewOfType(MarkdownView)?.file;
		if (note?.extension.toLowerCase() === 'md') return note.path;
		const path = this.plugin.app.workspace.getActiveViewOfType(ReplayView)?.file?.path;
		return path ? this.artifacts.owner(path) : null;
	}

	canOpen(): boolean {
		const path = this.currentSource();
		return !this.disposed && path !== null && this.recordings.status(path) === 'stopped';
	}

	async ensure(path: string): Promise<string> {
		const source = this.plugin.app.vault.getAbstractFileByPath(path);
		if (!(source instanceof TFile) || source.extension.toLowerCase() !== 'md') throw new Error('The source note is missing.');
		const snapshot = await this.recordings.stoppedSnapshot(path);
		if (!snapshot) throw new Error('The note has no saved recording.');
		try { await this.artifacts.publish(path, { id: snapshot.id, recording: snapshot.recording, finalText: '' }); }
		finally { this.store.release(snapshot.id); }
		for (const player of this.players) player.refreshCapture();
		return artifactPath(path);
	}

	openCurrent(): void {
		const source = this.currentSource();
		if (!source || !this.canOpen()) return;
		void (async () => {
			const path = artifactPath(source);
			await this.ensure(source);
			const file = this.plugin.app.vault.getAbstractFileByPath(path);
			if (!(file instanceof TFile) || this.disposed) return;
			const existing = this.plugin.app.workspace.getLeavesOfType(REPLAY_VIEW_TYPE).find((leaf) =>
				leaf.view instanceof ReplayView && leaf.view.file?.path === path);
			if (existing) await this.plugin.app.workspace.revealLeaf(existing);
			else await this.plugin.app.workspace.getLeaf('tab').openFile(file);
		})().catch((error: unknown) => this.report(error));
	}

	private async migrate(): Promise<void> {
		await this.artifacts.load();
		const paths = await this.store.paths();
		const next = (): void => {
			if (this.disposed) return;
			const path = paths.shift();
			if (path === undefined) return;
			void (async () => {
				const source = this.plugin.app.vault.getAbstractFileByPath(path);
				if (!(source instanceof TFile) || source.extension.toLowerCase() !== 'md') return;
				if (!await this.artifacts.needsRecovery(path)) return;
				await this.recordings.inspect(path);
				if (this.recordings.status(path) !== 'stopped' || this.disposed) return;
				await this.ensure(path);
			})().catch((error: unknown) => this.report(error)).finally(() => {
				if (!this.disposed) this.migrationTimer = this.clock.set(next, 25);
			});
		};
		next();
	}

	dispose(): void {
		this.disposed = true;
		if (this.migrationTimer !== undefined) this.clock.clear(this.migrationTimer);
		for (const player of this.players) player.dispose();
		this.players.clear();
	}
}
