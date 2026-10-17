import { MarkdownView, Notice, TFile, setIcon, type Plugin } from 'obsidian';
import { RecordingError } from '../recording/errors';
import { StorageError } from '../storage/types';
import type { RecordingController } from '../recording/controller';
import type { RecordingPhase } from '../recording/session';
import type { EditorCaptureBridge } from '../capture/editor-extension';
import { createIconButton, updateIconButton } from './icon-button';

const labels: Record<RecordingPhase, string> = {
	absent: 'No recording', starting: 'Starting recording', recording: 'Recording',
	stopping: 'Saving recording', stopped: 'Recording stopped', error: 'Recording paused',
};

export class RecordingControls {
	private ribbon: HTMLElement;
	private bar: HTMLElement;
	private label: HTMLElement;
	private button: HTMLButtonElement;
	private replayButton: HTMLButtonElement;
	private exportButton: HTMLButtonElement;
	private previous: TFile | null = null;
	private disposed = false;

	constructor(private plugin: Plugin, private controller: RecordingController, private bridge: EditorCaptureBridge,
		private openReplay: (path: string) => void, private openExport: (path: string) => void) {
		this.ribbon = plugin.addRibbonIcon('circle', 'Start recording', () => this.toggle());
		this.bar = this.ribbon.ownerDocument.createElement('div');
		this.bar.className = 'replay-recording-bar';
		this.label = this.bar.createSpan();
		this.button = createIconButton(this.bar, 'circle', 'Start recording');
		this.replayButton = createIconButton(this.bar, 'history', 'Open replay');
		this.exportButton = createIconButton(this.bar, 'file-down', 'Export recording');
		plugin.registerDomEvent(this.exportButton, 'click', () => {
			const path = this.current()?.file?.path;
			if (path && controller.status(path) === 'stopped') this.openExport(path);
		});
		plugin.registerDomEvent(this.replayButton, 'click', () => {
			const path = this.current()?.file?.path;
			if (path && controller.status(path) === 'stopped') this.openReplay(path);
		});
		plugin.registerDomEvent(this.button, 'click', () => this.toggle());
		plugin.register(controller.subscribe(() => this.refresh()));
		plugin.register(bridge.subscribe(() => this.refresh()));
		plugin.registerEvent(plugin.app.workspace.on('active-leaf-change', () => this.switched()));
		plugin.registerEvent(plugin.app.workspace.on('file-open', () => this.switched()));
		plugin.registerEvent(plugin.app.workspace.on('layout-change', () => this.refresh()));
		plugin.registerEvent(plugin.app.workspace.on('file-menu', (menu, file) => {
			if (!(file instanceof TFile) || file !== this.current()?.file) return;
			if (controller.status(file.path) === 'stopped') menu.addItem((item) => item.setTitle('Open replay').setIcon('history')
				.onClick(() => this.openReplay(file.path)));
			if (controller.status(file.path) === 'stopped') menu.addItem((item) => item.setTitle('Export recording').setIcon('file-down')
				.onClick(() => this.openExport(file.path)));
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
		const file = this.current()?.file;
		return !!file && ['starting', 'recording', 'error'].includes(this.controller.status(file.path));
	}

	start(): void {
		const view = this.current();
		if (!view?.file || !this.canStart()) return;
		const editor = this.bridge.resolve(view.editor, view.file);
		if (editor) void this.controller.start(view.file.path, editor.state.doc.toString()).catch(() => undefined);
	}

	stop(): void {
		const file = this.current()?.file;
		if (file && this.canStop()) void this.controller.stop(file.path).catch(() => undefined);
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
			this.bar.remove();
			this.ribbon.setAttribute('aria-label', 'Open a Markdown note to record');
			this.ribbon.setAttribute('aria-disabled', 'true');
			setIcon(this.ribbon, 'circle');
			return;
		}
		if (this.bar.parentElement !== view.contentEl) view.contentEl.prepend(this.bar);
		const phase = this.controller.status(view.file.path);
		const stop = this.canStop();
		const action = phase === 'error' ? 'Retry save' : stop ? 'Stop recording' : 'Start recording';
		this.replayButton.hidden = phase !== 'stopped';
		this.exportButton.hidden = phase !== 'stopped';
		this.label.setText(labels[phase]);
		updateIconButton(this.button, phase === 'error' ? 'rotate-cw' : stop ? 'square' : 'circle', action);
		this.button.disabled = !this.canStart() && !stop;
		this.bar.setAttribute('data-recording-state', phase);
		this.ribbon.setAttribute('aria-label', `${labels[phase]}: ${action}`);
		this.ribbon.setAttribute('aria-disabled', String(this.button.disabled));
		setIcon(this.ribbon, phase === 'error' ? 'alert-circle' : stop ? 'square' : 'circle');
	}

	dispose(): void { this.disposed = true; this.bar.remove(); }
}

export function reportRecordingError(path: string, error: unknown): void {
	const detail = error instanceof RecordingError || error instanceof StorageError
		? error.message : 'The recording could not be saved or loaded.';
	new Notice(`Recording paused for ${path}. ${detail} Select Stop recording to retry saving.`, 8000);
}
