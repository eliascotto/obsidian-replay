import { MarkdownView, Notice, TFile, setIcon, type Plugin } from 'obsidian';
import { RecordingError } from '../recording/errors';
import { StorageError } from '../storage/types';
import type { RecordingController } from '../recording/controller';
import type { RecordingPhase } from '../recording/session';
import type { EditorCaptureBridge } from '../capture/editor-extension';
import type { ReplayWorkspace } from './replay-workspace';

const labels: Record<RecordingPhase, string> = {
	absent: 'No recording', starting: 'Starting recording', recording: 'Recording',
	stopping: 'Saving recording', stopped: 'Recording stopped', error: 'Recording paused',
};

export class RecordingControls {
	private ribbon: HTMLElement;
	private previous: TFile | null = null;
	private disposed = false;

	constructor(private plugin: Plugin, private controller: RecordingController, private bridge: EditorCaptureBridge,
		private replay: ReplayWorkspace) {
		this.ribbon = plugin.addRibbonIcon('circle', 'Start recording', () => this.toggle());
		plugin.register(controller.subscribe(() => this.refresh()));
		plugin.register(bridge.subscribe(() => this.refresh()));
		plugin.registerEvent(plugin.app.workspace.on('active-leaf-change', () => this.switched()));
		plugin.registerEvent(plugin.app.workspace.on('file-open', () => this.switched()));
		plugin.registerEvent(plugin.app.workspace.on('layout-change', () => this.refresh()));
		plugin.registerEvent(plugin.app.workspace.on('file-menu', (menu, file) => {
			if (!(file instanceof TFile) || file !== this.current()?.file) return;
			if (this.canStart()) menu.addItem((item) => item.setTitle('Start recording').setIcon('circle')
				.onClick(() => this.start()));
			if (this.canStop()) menu.addItem((item) => item.setTitle('Stop recording / retry save').setIcon('square')
				.onClick(() => this.stop()));
		}));
		this.switched();
	}

	private current(): MarkdownView | null {
		const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
		return view?.file?.extension.toLowerCase() === 'md' ? view : null;
	}

	canStart(): boolean {
		const view = this.current();
		if (!view?.file || !this.bridge.resolve(view.editor, view.file)) return false;
		return ['absent', 'stopped'].includes(this.controller.status(view.file.path));
	}

	canStop(): boolean {
		const path = this.replay.currentSource();
		return !!path && ['starting', 'recording', 'error'].includes(this.controller.status(path));
	}

	start(): void {
		const view = this.current();
		if (!view?.file || !this.canStart()) return;
		const editor = this.bridge.resolve(view.editor, view.file);
		if (editor) void this.controller.start(view.file.path, editor.state.doc.toString()).catch(() => undefined);
	}

	stop(): void {
		const path = this.replay.currentSource();
		if (path && this.canStop()) void this.controller.stop(path).catch(() => undefined);
	}

	private toggle(): void { if (this.canStop()) this.stop(); else this.start(); }

	private switched(): void {
		const file = this.current()?.file ?? null;
		if (this.previous && this.previous !== file) {
			void this.controller.flush(this.previous.path).catch(() => undefined);
		}
		if (file && file !== this.previous) void this.controller.inspect(file.path);
		this.previous = file;
		this.refresh();
	}

	refresh(): void {
		if (this.disposed) return;
		const view = this.current();
		if (!view?.file) {
			this.ribbon.setAttribute('aria-label', this.canStop() ? 'Stop recording / retry save' : 'Open a Markdown note to record');
			this.ribbon.setAttribute('aria-disabled', String(!this.canStop()));
			setIcon(this.ribbon, this.canStop() ? 'square' : 'circle');
			return;
		}
		const phase = this.controller.status(view.file.path);
		const stop = this.canStop();
		const action = phase === 'error' ? 'Retry save' : stop ? 'Stop recording' : 'Start recording';
		this.ribbon.setAttribute('aria-label', `${labels[phase]}: ${action}`);
		this.ribbon.setAttribute('aria-disabled', String(!this.canStart() && !stop));
		setIcon(this.ribbon, phase === 'error' ? 'alert-circle' : stop ? 'square' : 'circle');
	}

	dispose(): void { this.disposed = true; }
}

export function reportRecordingError(path: string, error: unknown): void {
	const detail = error instanceof RecordingError || error instanceof StorageError
		? error.message : 'The recording could not be saved or loaded.';
	new Notice(`Recording paused for ${path}. ${detail} Select Stop recording to retry saving.`, 8000);
}
