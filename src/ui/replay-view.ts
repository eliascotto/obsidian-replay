import { ItemView, type WorkspaceLeaf, type ViewStateResult } from 'obsidian';
import type { ReplayCoordinator } from '../replay/coordinator';
import { renderReplayText } from './replay-text';
import { PLAYBACK_RATES } from '../replay/types';
import { DoomedPresentation } from '../replay/doomed-presentation';

export const REPLAY_VIEW_TYPE = 'replay-history';

export class ReplayView extends ItemView {
	private heading!: HTMLElement;
	private message!: HTMLElement;
	private text!: HTMLElement;
	private previous!: HTMLButtonElement;
	private next!: HTMLButtonElement;
	private play!: HTMLButtonElement;
	private rate!: HTMLSelectElement;
	private timeline!: HTMLInputElement;
	private position!: HTMLElement;
	private doomedButton!: HTMLButtonElement;
	private doomedMessage!: HTMLElement;
	private exportButton!: HTMLButtonElement;
	private doomed = new DoomedPresentation();
	private unsubscribe: (() => void) | undefined;
	private ready = false;

	constructor(leaf: WorkspaceLeaf, private replay: ReplayCoordinator, private returnToNote: (path: string) => void,
		private opened: () => void, private closed: () => void, private openExport: (path: string) => void,
	) {
		super(leaf);
	}

	getViewType(): string { return REPLAY_VIEW_TYPE; }
	getDisplayText(): string { return 'Replay'; }
	getIcon(): string { return 'history'; }
	get path(): string | null { return this.replay.state.path; }
	get exportPath(): string | null { return this.replay.state.phase === 'ready' && !this.replay.state.player.state.error ? this.path : null; }

	onOpen(): Promise<void> {
		this.opened();
		this.contentEl.empty();
		this.contentEl.addClass('replay-history-view');
		this.heading = this.contentEl.createEl('h2', { text: 'Replay' });
		const back = this.contentEl.createEl('button', { text: 'Return to note' });
		this.registerDomEvent(back, 'click', () => { if (this.path) this.returnToNote(this.path); });
		this.message = this.contentEl.createDiv({ cls: 'replay-message', attr: { role: 'status' } });
		const controls = this.contentEl.createDiv({ cls: 'replay-playback-controls' });
		this.previous = controls.createEl('button', { text: 'Previous step' });
		this.play = controls.createEl('button', { text: 'Play' });
		this.next = controls.createEl('button', { text: 'Next step' });
		const rateLabel = controls.createEl('label', { text: 'Playback rate ' });
		this.rate = rateLabel.createEl('select');
		for (const rate of PLAYBACK_RATES) this.rate.createEl('option', { value: String(rate), text: `${rate}×` });
		this.doomedButton = controls.createEl('button', { text: 'Doomed', attr: {
			'aria-pressed': 'false', title: 'Highlight text that differs from the final recorded step.',
		} });
		this.doomedMessage = this.contentEl.createDiv({ cls: 'replay-message', attr: { role: 'status' } });
		this.exportButton = controls.createEl('button', { text: 'Export recording' });
		const timelineLabel = this.contentEl.createEl('label', { cls: 'replay-timeline', text: 'Timeline ' });
		this.timeline = timelineLabel.createEl('input', { type: 'range', attr: { min: '0', max: '0', step: '1' } });
		this.position = this.contentEl.createDiv({ cls: 'replay-position' });
		const document = this.contentEl.createEl('pre', { cls: 'replay-document', attr: { tabindex: '0', 'aria-label': 'Historical Markdown' } });
		document.contentEditable = 'false';
		this.text = document.createEl('code');
		this.registerDomEvent(this.play, 'click', () => {
			const player = this.player();
			if (player?.state.playing) player.pause(); else player?.play();
		});
		this.registerDomEvent(this.previous, 'click', () => this.player()?.previous());
		this.registerDomEvent(this.next, 'click', () => this.player()?.next());
		this.registerDomEvent(this.rate, 'change', () => this.player()?.setRate(Number(this.rate.value)));
		this.registerDomEvent(this.timeline, 'input', () => this.player()?.requestSeek(Number(this.timeline.value)));
		this.registerDomEvent(this.timeline, 'change', () => this.player()?.commitSeek());
		this.registerDomEvent(this.doomedButton, 'click', () => { this.doomed.toggle(); this.render(); });
		this.registerDomEvent(this.exportButton, 'click', () => { if (this.exportPath) this.openExport(this.exportPath); });
		this.unsubscribe = this.replay.subscribe(() => this.render());
		this.ready = true;
		this.render();
		return Promise.resolve();
	}

	private player() { return this.replay.state.phase === 'ready' ? this.replay.state.player : undefined; }

	private render(): void {
		if (!this.ready) return;
		const status = this.replay.state;
		const player = this.player();
		const state = player?.state;
		const valid = state !== undefined && !state.error;
		this.doomed.bind(valid ? player : undefined);
		this.heading.setText(status.path ?? 'Replay');
		this.message.setText(status.phase === 'loading' ? 'Loading recording…' :
			status.phase === 'unavailable' ? status.message : state?.error ?? (status.phase === 'idle' ? 'Open a stopped recording to replay it.' : ''));
		this.previous.disabled = !valid || state.sequence === 0;
		this.next.disabled = !valid || state.sequence === state.lastSequence;
		this.play.disabled = !valid || (!state.playing && state.sequence === state.lastSequence);
		this.play.setText(state?.playing ? 'Pause' : 'Play');
		this.rate.disabled = !valid;
		this.rate.value = String(state?.rate ?? 1);
		this.timeline.disabled = !valid || state.lastSequence === 0;
		this.timeline.max = String(state?.lastSequence ?? 0);
		this.timeline.value = String(state?.pendingSequence ?? state?.sequence ?? 0);
		const position = valid ? `Step ${state.sequence} of ${state.lastSequence}` : '';
		this.position.setText(position);
		this.timeline.setAttribute('aria-valuetext', state?.pendingSequence !== null && state?.pendingSequence !== undefined
			? `Step ${state.pendingSequence} of ${state.lastSequence}` : position);
		const text = valid ? state.text : '';
		const display = this.doomed.display;
		this.doomedButton.disabled = !valid;
		this.exportButton.disabled = !valid;
		this.doomedButton.setAttribute('aria-pressed', String(display?.enabled ?? false));
		this.doomedMessage.setText(display?.message ?? '');
		try { renderReplayText(this.text, text, display?.ranges); }
		catch {
			renderReplayText(this.text, text);
			this.doomedMessage.setText('Doomed comparison is unavailable for this step.');
		}
	}

	getState(): Record<string, unknown> { return this.path ? { path: this.path } : {}; }

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		await super.setState(state, result);
		if (typeof state === 'object' && state !== null && 'path' in state && typeof state.path === 'string') {
			void this.replay.open(state.path);
		}
	}

	onClose(): Promise<void> {
		this.ready = false;
		this.unsubscribe?.();
		this.unsubscribe = undefined;
		this.doomed.dispose();
		this.closed();
		this.contentEl.empty();
		return Promise.resolve();
	}
}
