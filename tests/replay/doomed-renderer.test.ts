import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderReplayText } from '../../src/ui/replay-text';
import { TestDocument } from '../support/dom';

void test('highlight rendering builds only text and spans with exact source content', () => {
	const document = new TestDocument();
	const target = document.createElement('code');
	const text = '<script>alert("draft")</script>\r\n😀\te\u0301';
	const emoji = text.indexOf('😀');
	const ranges = [{ from: 15, to: 20 }, { from: emoji, to: emoji + 2 }];
	renderReplayText(target.element, text, ranges);
	assert.equal(target.textContent, text);
	assert.deepEqual(target.children.filter((node) => node.nodeName === 'SPAN').map((node) => [node.className, node.textContent]), [
		['replay-doomed-text', text.slice(15, 20)], ['replay-doomed-text', '😀'],
	]);
	assert.ok(document.created.every((node) => ['CODE', 'SPAN', '#text'].includes(node.nodeName)));
	assert.ok(target.children.every((node) => node.ownerDocument === document));
	assert.equal(document.adopted.length, 1);
	assert.equal(document.adopted[0]!.ownerDocument, document);
	const writes = target.writes;
	renderReplayText(target.element, text, ranges.map((range) => ({ ...range })));
	assert.equal(target.writes, writes);
	renderReplayText(target.element, text);
	assert.equal(target.textContent, text);
	assert.equal(target.children.length, 0);
	assert.equal(target.writes, writes + 1);
	renderReplayText(target.element, '');
	assert.equal(target.textContent, '');
});

void test('changing ranges at unchanged text replaces spans; unrelated renders do not', () => {
	const target = new TestDocument().createElement('code');
	renderReplayText(target.element, 'abcd', [{ from: 0, to: 1 }]);
	renderReplayText(target.element, 'abcd', [{ from: 2, to: 4 }]);
	assert.equal(target.children.find((node) => node.nodeName === 'SPAN')?.textContent, 'cd');
	const writes = target.writes;
	renderReplayText(target.element, 'abcd', [{ from: 2, to: 4 }]);
	assert.equal(target.writes, writes);
	renderReplayText(target.element, 'new\ntext', []);
	assert.equal(target.textContent, 'new\ntext');
	assert.equal(target.children.length, 0);
});

void test('invalid ranges fall back to plain exact text without partially committing spans', () => {
	for (const ranges of [
		[{ from: -1, to: 1 }], [{ from: 1, to: 1 }], [{ from: 0, to: 10 }],
		[{ from: 0.5, to: 1 }], [{ from: NaN, to: 1 }], [{ from: 0, to: 2 }, { from: 1, to: 3 }],
		[{ from: 1, to: 2 }], [{ from: 2, to: 3 }],
	]) {
		const target = new TestDocument().createElement('code');
		renderReplayText(target.element, 'old', [{ from: 0, to: 3 }]);
		assert.throws(() => renderReplayText(target.element, 'x😀y', ranges), RangeError);
		assert.equal(target.textContent, 'x😀y');
		assert.equal(target.children.length, 0);
	}
});

void test('rendering preserves all selected Unicode and whitespace slices', () => {
	for (const text of ['你好\t世界\r\n', '👩\u200d💻 e\u0301 ✈️', '\n\n', '<img src=x onerror="bad()">']) {
		const document = new TestDocument();
		const target = document.createElement('code');
		let offset = 0;
		const ranges = Array.from(text, (point) => { const from = offset; offset += point.length; return { from, to: offset }; });
		renderReplayText(target.element, text, ranges);
		assert.equal(target.textContent, text);
		assert.equal(target.children.map((node) => node.textContent).join(''), text);
	}
});
