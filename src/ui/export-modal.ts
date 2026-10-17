import { Component, Modal, type App } from 'obsidian';
import { suggestedDestination, validateDestination, type ExportPaths } from '../export/destination';
import type { ExportController } from '../export/export-controller';
import { createIconButton, updateIconButton } from './icon-button';

export class ExportModal extends Modal {
	private lifecycle = new Component();
	private destination!: HTMLInputElement;
	private status!: HTMLElement;
	private endpoint!: HTMLElement;
	private fieldError!: HTMLElement;
	private submit!: HTMLButtonElement;
	private cancel!: HTMLButtonElement;

	constructor(app: App, readonly request: ExportController, private paths: ExportPaths, private closed: () => void) { super(app); }

	onOpen(): void {
		this.lifecycle.load();
		this.setTitle('Export recording');
		this.contentEl.addClass('replay-export');
		this.contentEl.createEl('p', { text: `Source: ${this.request.path}` });
		this.endpoint = this.contentEl.createEl('p');
		this.contentEl.createEl('p', { text: 'Creates one local file. Includes deleted and superseded writing.' });
		const form = this.contentEl.createEl('form');
		const label = form.createEl('label', { text: 'Destination (inside the vault)' });
		this.destination = label.createEl('input', { type: 'text', value: suggestedDestination(this.request.path), attr: { spellcheck: 'false' } });
		form.createEl('p', { text: 'Use an existing folder and a filename ending in .replay.json.', cls: 'replay-message' });
		this.fieldError = form.createEl('p', { cls: 'replay-message', attr: { role: 'status' } });
		this.status = form.createEl('p', { attr: { role: 'status' } });
		const actions = form.createDiv({ cls: 'replay-playback-controls' });
		this.submit = createIconButton(actions, 'file-down', 'Export recording', 'submit');
		this.cancel = createIconButton(actions, 'x', 'Cancel');
		this.lifecycle.registerDomEvent(form, 'submit', (event) => {
			event.preventDefault();
			if (!this.submit.disabled) void this.request.save(this.destination.value);
		});
		this.lifecycle.registerDomEvent(this.destination, 'input', () => { this.request.editDestination(); this.render(); });
		this.lifecycle.registerDomEvent(this.cancel, 'click', () => this.close());
		this.lifecycle.register(this.request.subscribe(() => this.render()));
		this.render();
		this.focus();
		void this.request.prepare();
	}

	focus(): void { this.destination?.focus(); }

	private render(): void {
		const state = this.request.state;
		const error = validateDestination(this.destination.value, this.request.path, this.paths);
		this.fieldError.setText(error);
		this.endpoint.setText(state.lastSequence === null ? 'Loading saved endpoint…' : `Stopped at step ${state.lastSequence}`);
		this.status.setText(state.message);
		this.submit.disabled = !this.request.canSave || !!error;
		this.destination.disabled = ['saving', 'stale', 'success', 'closed'].includes(state.phase);
		this.cancel.disabled = state.phase === 'saving';
		updateIconButton(this.cancel, 'x', state.phase === 'success' ? 'Close' : 'Cancel');
	}

	onClose(): void {
		this.lifecycle.unload();
		this.request.close();
		this.contentEl.empty();
		this.closed();
	}
}
