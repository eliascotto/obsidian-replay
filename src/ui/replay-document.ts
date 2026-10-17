import { Component, MarkdownRenderer, Notice, type App } from 'obsidian';
import { RenderQueue, type RenderTask } from '../replay/render-queue';
import { previewSourceReason } from '../replay/preview-policy';
import type { DoomedDisplay } from '../replay/doomed-presentation';
import { renderReplayText } from './replay-text';

interface Snapshot { text: string; path: string }

/** Owns document DOM and native render children; never opens an editor or writes files. */
export class ReplayDocument extends Component {
	private host: HTMLElement;
	private message: HTMLElement;
	private queue: RenderQueue<Snapshot>;
	private revision: object | undefined;
	private last: (Snapshot & { presentation: string }) | undefined;
	private sourcePath = '';
	private loading: number | undefined;
	private busy = false;

	constructor(private app: App, container: HTMLElement) {
		super();
		this.message = container.createDiv({ cls: 'replay-message', attr: { role: 'status' } });
		this.host = container.createDiv({ cls: 'replay-document', attr: { tabindex: '0' } });
		this.host.contentEditable = 'false';
		this.queue = new RenderQueue((snapshot) => this.start(snapshot),
			(snapshot) => this.source(snapshot.text, 'Markdown preview is unavailable for this step.'),
			(busy) => this.setBusy(busy));
		for (const name of ['beforeinput', 'paste', 'drop'] as const) {
			this.registerDomEvent(this.host, name, (event) => { event.preventDefault(); event.stopImmediatePropagation(); }, { capture: true });
		}
		this.registerDomEvent(this.host, 'click', (event) => this.click(event), { capture: true });
		this.register(() => this.queue.dispose());
	}

	show(revision: object, snapshot: Snapshot, display: DoomedDisplay): void {
		if (this.revision !== revision) { this.clear(); this.revision = revision; }
		this.sourcePath = snapshot.path;
		const presentation = JSON.stringify([display.enabled, display.message, display.ranges]);
		if (this.last?.text === snapshot.text && this.last.path === snapshot.path && this.last.presentation === presentation) return;
		this.last = { ...snapshot, presentation };
		const reason = display.enabled ? 'Showing source for Doomed highlights.' : previewSourceReason(snapshot.text);
		if (reason) {
			this.queue.clear();
			this.source(snapshot.text, [reason, display.message].filter(Boolean).join(' '), display);
		} else {
			this.message.setText('');
			this.queue.request(snapshot);
		}
	}

	clear(): void {
		this.last = undefined;
		this.revision = undefined;
		this.queue.clear();
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
		const pre = this.host.ownerDocument.createElement('pre');
		pre.className = 'replay-source';
		const code = pre.createEl('code');
		try { renderReplayText(code, text, display?.ranges); }
		catch {
			renderReplayText(code, text);
			message = 'Showing source for Doomed highlights. Doomed comparison is unavailable for this step.';
		}
		this.host.replaceChildren(pre);
		this.host.scrollTop = scroll;
		this.message.setText(message);
	}

	private start(snapshot: Snapshot): RenderTask {
		const component = this.addChild(new Component());
		const stage = this.host.ownerDocument.createElement('div');
		stage.className = 'markdown-preview-sizer markdown-preview-section';
		let ready: Promise<void>;
		try { ready = MarkdownRenderer.render(this.app, snapshot.text, stage, snapshot.path, component); }
		catch (error) { this.removeChild(component); throw error; }
		return {
			ready,
			commit: () => {
				stage.querySelectorAll('input, textarea, select, button').forEach((control) => control.setAttribute('disabled', ''));
				stage.querySelectorAll('[contenteditable]').forEach((editable) => editable.setAttribute('contenteditable', 'false'));
				const scroll = this.host.scrollTop;
				this.host.addClass('markdown-preview-view', 'markdown-rendered', 'is-readable-line-width');
				this.host.replaceChildren(stage);
				this.host.scrollTop = scroll;
			},
			dispose: () => { this.removeChild(component); stage.remove(); },
		};
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
