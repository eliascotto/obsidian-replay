import { compareDoomed, type DoomedRange } from '../replay/doomed';

interface TextPart { node: Text; from: number; to: number }
interface Projection { text: string; parts: TextPart[] }
const blocks = new Set(['ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HR', 'LI', 'P', 'PRE', 'SECTION', 'TABLE', 'TD', 'TH', 'TR', 'UL', 'OL']);
const excluded = 'script, style, input, textarea, select, button, svg, [hidden], [aria-hidden="true"], .copy-code-button, .collapse-indicator, .heading-collapse-indicator, .list-collapse-indicator, .footnote-backref, .callout-icon';

/** Map rendered text to its original DOM nodes, with separators between block boundaries. */
function project(root: HTMLElement): Projection {
	const chunks: string[] = [];
	const parts: TextPart[] = [];
	let length = 0;
	let separated = true;
	const separator = () => {
		if (!separated) { chunks.push('\n'); length++; separated = true; }
	};
	const visit = (node: Node): void => {
		if (node.nodeType === 3) {
			const text = node.textContent ?? '';
			if (!text) return;
			parts.push({ node: node as Text, from: length, to: length + text.length });
			chunks.push(text); length += text.length; separated = text.endsWith('\n');
			return;
		}
		if (node.nodeType !== 1) return;
		const element = node as HTMLElement;
		if (element.matches(excluded)) return;
		const block = blocks.has(element.tagName);
		if (block || element.tagName === 'BR') separator();
		Array.from(element.childNodes).forEach(visit);
		if (block) separator();
	};
	Array.from(root.childNodes).forEach(visit);
	return { text: chunks.join(''), parts };
}

export function renderedText(root: HTMLElement): string { return project(root).text; }

/** Use native mark elements without rewriting Markdown or replacing formatted ancestors. */
export function highlightRenderedDifference(root: HTMLElement, finalText: string): boolean {
	const projection = project(root);
	const comparison = compareDoomed(projection.text, finalText);
	if (comparison.status !== 'ready') return false;
	let index = 0;
	for (const part of projection.parts) {
		while (index < comparison.ranges.length && comparison.ranges[index]!.to <= part.from) index++;
		const ranges: DoomedRange[] = [];
		for (let next = index; next < comparison.ranges.length; next++) {
			const range = comparison.ranges[next]!;
			if (range.from >= part.to) break;
			ranges.push({ from: Math.max(range.from, part.from) - part.from, to: Math.min(range.to, part.to) - part.from });
		}
		if (!ranges.length) continue;
		const fragment = root.ownerDocument.createDocumentFragment();
		const text = part.node.textContent ?? '';
		let cursor = 0;
		for (const range of ranges) {
			fragment.appendChild(root.ownerDocument.createTextNode(text.slice(cursor, range.from)));
			const mark = root.ownerDocument.createElement('mark');
			mark.className = 'replay-doomed-mark';
			mark.textContent = text.slice(range.from, range.to);
			fragment.appendChild(mark);
			cursor = range.to;
		}
		fragment.appendChild(root.ownerDocument.createTextNode(text.slice(cursor)));
		part.node.replaceWith(fragment);
	}
	return true;
}
