import { Component, MarkdownRenderer, Notice, type App } from 'obsidian';
import { RenderQueue, type RenderTask } from '../replay/render-queue';
import { previewSourceReason } from '../replay/preview-policy';
import type { DoomedDisplay } from '../replay/doomed-presentation';
import { renderReplayText } from './replay-text';
import { highlightRenderedDifference, renderedText } from './rendered-highlights';
import type { ReplayPreferences } from '../settings';
import { highlightTextColor } from './highlight-color';

interface Snapshot { text: string; path: string; finalText: string }
interface RenderSnapshot extends Snapshot { display: DoomedDisplay }

/** Owns document DOM and native render children; never opens an editor or writes files. */
export class ReplayDocument extends Component {
	private host: HTMLElement;
	private message: HTMLElement;
	private queue: RenderQueue<RenderSnapshot>;
	private finalPreview: { ready: Promise<string>; dispose: () => void } | undefined;
	private revision: object | undefined;
	private last: (Snapshot & { presentation: string }) | undefined;
	private sourcePath = '';
	private loading: number | undefined;
	private busy = false;

	constructor(private app: App, container: HTMLElement, preferences: ReplayPreferences) {
		super();
		this.message = container.createDiv({ cls: 'replay-message', attr: { role: 'status' } });
		this.host = container.createDiv({ cls: 'replay-document', attr: { tabindex: '0' } });
		this.host.contentEditable = 'false';
		const updateColor = () => {
			this.host.style.setProperty('--replay-doomed-color', preferences.doomedHighlightColor);
			this.host.style.setProperty('--replay-doomed-text-color', highlightTextColor(preferences.doomedHighlightColor));
		};
		updateColor();
		this.register(preferences.subscribe(updateColor));
		this.queue = new RenderQueue((snapshot) => this.start(snapshot),
			(snapshot) => this.source(snapshot.text, 'Markdown preview is unavailable for this step.', snapshot.display),
			(busy) => this.setBusy(busy));
		for (const name of ['beforeinput', 'paste', 'drop'] as const) {
			this.registerDomEvent(this.host, name, (event) => { event.preventDefault(); event.stopImmediatePropagation(); }, { capture: true });
		}
		this.registerDomEvent(this.host, 'click', (event) => this.click(event), { capture: true });
		this.register(() => { this.queue.dispose(); this.clearFinalPreview(); });
	}

	show(revision: object, snapshot: Snapshot, display: DoomedDisplay): void {
		if (this.revision !== revision) { this.clear(); this.revision = revision; }
		this.sourcePath = snapshot.path;
		const presentation = JSON.stringify([display.enabled, display.message, display.ranges]);
		if (this.last?.text === snapshot.text && this.last.path === snapshot.path && this.last.finalText === snapshot.finalText && this.last.presentation === presentation) return;
		if (this.last && (this.last.path !== snapshot.path || this.last.finalText !== snapshot.finalText)) this.clearFinalPreview();
		this.last = { ...snapshot, presentation };
		const reason = previewSourceReason(snapshot.text);
		if (reason) {
			this.queue.clear();
			this.source(snapshot.text, [reason, display.message].filter(Boolean).join(' '), display);
		} else {
			this.message.setText('');
			this.queue.request({ ...snapshot, display });
		}
	}

	clear(): void {
		this.last = undefined;
		this.revision = undefined;
		this.queue.clear();
		this.clearFinalPreview();
		this.host.empty();
		this.message.setText('');
	}

	private setBusy(busy: boolean): void {
		if (busy === this.busy) return;
		this.busy = busy;
		this.host.setAttribute('aria-busy', String(busy));
		const win = this.host.ownerDocument.defaultView;
		if (this.loading !== undefined) win?.clearTimeout(this.loading);
		this.loading = undefined;
		if (busy) this.loading = win?.setTimeout(() => {
			this.loading = undefined;
			this.message.setText('Rendering recorded document…');
		}, 750);
		else if (this.message.textContent === 'Rendering recorded document…') this.message.setText('');
	}

	private source(text: string, message: string, display?: DoomedDisplay): void {
		const scroll = this.host.scrollTop;
		this.host.removeClass('markdown-preview-view', 'markdown-rendered', 'is-readable-line-width');
		const pre = this.host.ownerDocument.createDocumentFragment().createEl('pre', { cls: 'replay-source' });
		const code = pre.createEl('code');
		try { renderReplayText(code, text, display?.ranges); }
		catch {
			renderReplayText(code, text);
			message = 'Doomed comparison is unavailable for this step.';
		}
		this.host.replaceChildren(pre);
		this.host.scrollTop = scroll;
		this.message.setText(message);
	}

	private start(snapshot: RenderSnapshot): RenderTask {
		const component = this.addChild(new Component());
		const stage = this.createStage();
		let ready: Promise<void>;
		let message = '';
		try { ready = MarkdownRenderer.render(this.app, snapshot.text, stage, snapshot.path, component); }
		catch (error) { this.removeChild(component); throw error; }
		if (snapshot.display.enabled && snapshot.text !== snapshot.finalText) {
			const final = previewSourceReason(snapshot.finalText) ? undefined : this.finalText(snapshot);
			ready = ready.then(async () => {
				try {
					if (!final || !highlightRenderedDifference(stage, await final)) {
						message = 'Doomed comparison is unavailable for this step.';
					}
				} catch { message = 'Doomed comparison is unavailable for this step.'; }
			});
		}
		return {
			ready,
			commit: () => {
				stage.querySelectorAll('input, textarea, select, button').forEach((control) => control.setAttribute('disabled', ''));
				stage.querySelectorAll('[contenteditable]').forEach((editable) => editable.setAttribute('contenteditable', 'false'));
				const scroll = this.host.scrollTop;
				this.host.addClass('markdown-preview-view', 'markdown-rendered', 'is-readable-line-width');
				this.host.replaceChildren(stage);
				this.host.scrollTop = scroll;
				this.message.setText(message);
			},
			dispose: () => { this.removeChild(component); stage.remove(); },
		};
	}

	private finalText(snapshot: Snapshot): Promise<string> {
		if (!this.finalPreview) {
			const component = this.addChild(new Component());
			const stage = this.createStage();
			let disposed = false;
			const dispose = () => {
				if (disposed) return;
				disposed = true;
				this.removeChild(component); stage.remove();
			};
			const ready = Promise.resolve().then(() => {
				if (disposed) throw new Error('Preview disposed');
				return MarkdownRenderer.render(this.app, snapshot.finalText, stage, snapshot.path, component);
			})
				.then(() => renderedText(stage)).finally(dispose);
			// The selected render can fail before it awaits this shared preview.
			void ready.catch(() => undefined);
			this.finalPreview = { ready, dispose };
		}
		return this.finalPreview.ready;
	}

	private createStage(): HTMLDivElement {
		// Keep pending renders detached and in the host's document, including pop-out windows.
		return this.host.ownerDocument.createDocumentFragment().createDiv({ cls: 'markdown-preview-sizer markdown-preview-section' });
	}

	private clearFinalPreview(): void {
		this.finalPreview?.dispose();
		this.finalPreview = undefined;
	}

	private click(event: MouseEvent): void {
		const target = event.target;
		if (!(target instanceof this.host.ownerDocument.defaultView!.Element)) return;
		if (target.closest('input, textarea, select, button, [contenteditable="true"]')) {
			event.preventDefault(); event.stopImmediatePropagation(); return;
		}
		const link = target.closest('a.internal-link');
		const href = link?.getAttribute('data-href') ?? link?.getAttribute('href');
		if (href) {
			event.preventDefault(); event.stopImmediatePropagation();
			void this.openLink(href, event.metaKey || event.ctrlKey);
		}
	}

	private async openLink(href: string, newLeaf: boolean): Promise<void> {
		try { await this.app.workspace.openLinkText(href, this.sourcePath, newLeaf ? 'tab' : true); }
		catch { new Notice('Could not open the recorded link.'); }
	}
}
