import { ViewPlugin, type EditorView, type ViewUpdate } from '@codemirror/view';
import { editorInfoField, type Editor, type TFile } from 'obsidian';
import type { RecordingController } from '../recording/controller';
import { TransactionRouter } from './transaction';

function markdownFile(view: EditorView): TFile | null {
	const file = view.state.field(editorInfoField, false)?.file;
	return file?.extension.toLowerCase() === 'md' ? file : null;
}

export class EditorCaptureBridge {
	private views = new Set<EditorView>();
	private listeners = new Set<() => void>();
	readonly extension;

	constructor(controller: RecordingController) {
		this.extension = ViewPlugin.define((view) => {
			this.views.add(view);
			this.changed();
			const router = new TransactionRouter(markdownFile(view), (file, observation) => {
				controller.capture(file.path, observation);
			}, (file) => controller.isCapturing(file.path));
			return {
				update(update: ViewUpdate) { router.update(markdownFile(view), update.transactions); },
				destroy: () => { this.views.delete(view); this.changed(); },
			};
		});
	}

	private changed(): void { this.listeners.forEach((listener) => listener()); }

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => { this.listeners.delete(listener); };
	}

	resolve(editor: Editor, file: TFile): EditorView | undefined {
		return [...this.views].find((view) => {
			const info = view.state.field(editorInfoField, false);
			return info?.editor === editor && info.file === file;
		});
	}

	dispose(): void { this.listeners.clear(); this.views.clear(); }
}
