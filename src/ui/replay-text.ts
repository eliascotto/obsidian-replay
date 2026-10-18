import type { DoomedRange } from '../replay/doomed';

type TextTarget = { textContent: string | null };
const rendered = new WeakMap<TextTarget, { text: string; signature: string }>();

function plain(target: TextTarget, text: string): void {
	if (target.textContent !== text || rendered.get(target)?.signature) target.textContent = text;
	rendered.set(target, { text, signature: '' });
}

function boundary(text: string, offset: number): boolean {
	const before = text.charCodeAt(offset - 1);
	const after = text.charCodeAt(offset);
	return !(before >= 0xD800 && before <= 0xDBFF && after >= 0xDC00 && after <= 0xDFFF);
}

/** Exact source text, with optional historical-side highlight spans. Never interprets markup. */
export function renderReplayText(target: TextTarget, text: string, ranges: readonly DoomedRange[] = []): void {
	let end = 0;
	for (const range of ranges) {
		if (!Number.isSafeInteger(range.from) || !Number.isSafeInteger(range.to) || range.from < end ||
			range.from < 0 || range.to <= range.from || range.to > text.length ||
			!boundary(text, range.from) || !boundary(text, range.to)) {
			plain(target, text);
			throw new RangeError('Doomed ranges must be ordered code-point boundaries within the historical text.');
		}
		end = range.to;
	}
	if (ranges.length === 0) { plain(target, text); return; }
	const signature = ranges.map((range) => `${range.from}:${range.to}`).join(',');
	const previous = rendered.get(target);
	if (previous?.text === text && previous.signature === signature) return;
	const element = target as HTMLElement;
	const fragment = element.ownerDocument.adoptNode(createFragment());
	let from = 0;
	for (const range of ranges) {
		if (from < range.from) fragment.appendText(text.slice(from, range.from));
		fragment.createSpan({ cls: 'replay-doomed-text', text: text.slice(range.from, range.to) });
		from = range.to;
	}
	if (from < text.length) fragment.appendText(text.slice(from));
	// Commit a complete fragment, so text and highlight ranges always describe the same step.
	element.replaceChildren(fragment);
	rendered.set(target, { text, signature });
}
