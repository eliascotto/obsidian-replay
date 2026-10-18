import assert from 'node:assert/strict';
import { test } from 'node:test';
import { highlightRenderedDifference, renderedText } from '../../src/ui/rendered-highlights';
import { TestDocument, type TestNode } from '../support/dom';

function fixture() {
	const document = new TestDocument();
	const root = document.createElement('div');
	const add = (parent: TestNode, tag: string, text: string) => {
		const node = document.createElement(tag);
		node.appendChild(document.createTextNode(text));
		parent.appendChild(node);
		return node;
	};
	return { document, root, add };
}
function marks(root: TestNode): string[] {
	return root.children.flatMap((node) => node.className === 'replay-doomed-mark' ? [node.textContent] : marks(node));
}

void test('native marks preserve headings, emphasis, links, and exact historical text', () => {
	const { document, root, add } = fixture();
	const heading = add(root, 'h1', 'Draft title');
	const paragraph = add(root, 'p', 'Keep ');
	const bold = add(paragraph, 'strong', 'old');
	const link = add(paragraph, 'a', ' destination');
	link.setAttribute('href', 'Note');
	const original = root.textContent;
	assert.equal(highlightRenderedDifference(root.element, 'Draft title\nKeep new destination\n'), true);
	assert.deepEqual(marks(root), ['old']);
	assert.equal(root.textContent, original);
	assert.equal(root.children[0], heading);
	assert.equal(paragraph.children[1], bold);
	assert.equal(paragraph.children[2], link);
	assert.equal(document.adopted.length, 1);
	assert.ok(document.created.every((node) => node.ownerDocument === document));
});

void test('a difference crossing formatted nodes creates marks inside each ancestor', () => {
	const { root, add } = fixture();
	const paragraph = add(root, 'p', 'Keep ');
	add(paragraph, 'em', '😀old');
	add(paragraph, 'a', ' words');
	assert.equal(highlightRenderedDifference(root.element, 'Keep \n'), true);
	assert.deepEqual(marks(root), ['😀old', ' words']);
	assert.equal(root.textContent, 'Keep 😀old words');
});

void test('original author highlights survive and unchanged visible text has no doomed marks', () => {
	const { root, add } = fixture();
	const paragraph = add(root, 'p', 'Same ');
	const authorMark = add(paragraph, 'mark', 'highlight');
	assert.equal(highlightRenderedDifference(root.element, renderedText(root.element)), true);
	assert.deepEqual(marks(root), []);
	assert.equal(authorMark.textContent, 'highlight');
	assert.equal(highlightRenderedDifference(root.element, 'Same \n'), true);
	assert.deepEqual(marks(root), ['highlight']);
	assert.equal(paragraph.children[1], authorMark);
});

void test('projection separates blocks, table cells, code lines, and explicit line breaks', () => {
	const { root, document, add } = fixture();
	add(root, 'h2', 'Heading');
	add(root, 'li', 'List');
	const row = add(root, 'tr', '');
	add(row, 'td', 'First'); add(row, 'td', 'Second');
	const paragraph = add(root, 'p', 'Before');
	paragraph.appendChild(document.createElement('br'));
	paragraph.appendChild(document.createTextNode('After'));
	add(root, 'pre', 'const x = 1;\n');
	assert.equal(renderedText(root.element), 'Heading\nList\nFirst\nSecond\nBefore\nAfter\nconst x = 1;\n');
});

void test('projection ignores hidden content, controls, and decorative reading-view elements', () => {
	const { root, add } = fixture();
	const paragraph = add(root, 'p', 'Visible');
	add(paragraph, 'button', 'Copy');
	add(paragraph, 'svg', 'Icon');
	add(paragraph, 'span', 'Hidden').setAttribute('hidden', '');
	add(paragraph, 'span', 'Hidden').setAttribute('aria-hidden', 'true');
	add(paragraph, 'span', 'Collapse').className = 'heading-collapse-indicator';
	assert.equal(renderedText(root.element), 'Visible\n');
	assert.equal(highlightRenderedDifference(root.element, ''), true);
	assert.deepEqual(marks(root), ['Visible']);
	assert.equal(root.textContent, 'VisibleCopyIconHiddenHiddenCollapse');
});

void test('repeated words use stable alignment and preserve Unicode boundaries', () => {
	const { root, add } = fixture();
	add(root, 'p', '😀 cat cat 👩‍💻');
	assert.equal(highlightRenderedDifference(root.element, '😀 cat 👩‍💻\n'), true);
	assert.deepEqual(marks(root), ['cat ']);
	assert.equal(root.textContent, '😀 cat cat 👩‍💻');
});

void test('comparison limits leave formatted text intact without approximate marks', () => {
	const { root, add } = fixture();
	const paragraph = add(root, 'p', 'a'.repeat(250_001));
	assert.equal(highlightRenderedDifference(root.element, 'b'.repeat(250_001)), false);
	assert.deepEqual(marks(root), []);
	assert.equal(root.children[0], paragraph);
});
