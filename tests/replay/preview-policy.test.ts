import assert from 'node:assert/strict';
import { test } from 'node:test';
import { previewSourceReason } from '../../src/replay/preview-policy';

void test('ordinary Markdown, incomplete writing, links, and unnamed code can use native rendering', () => {
	for (const text of ['', '# Heading\n\n**Bold** and *italic*.', '- [ ] Task\n- [x] Done',
		'> [!note]\n> A callout', '| A | B |\n|---|---|\n| 1 | 2 |',
		'[Link](https://example.com) [[Local note]]', '**unfinished', '```\nplain code\n```',
		'~~~\nplain code\n~~~', 'Emoji 😀 and e\u0301.']) {
		assert.equal(previewSourceReason(text), null, text);
	}
});

void test('potential HTML, resource embeds, named code processors and inline queries fall back before rendering', () => {
	for (const text of ['<script>alert(1)</script>', '<img src="https://example.com/a.png">',
		'<iframe src="https://example.com">', '<!-- comment -->', '<% templater %>',
		'![[Local note]]', '![Picture](https://example.com/a.png)', '![Picture][ref]',
		'```dataviewjs\ncode\n```', '```js\ncode\n```', '> ```tasks\nquery\n> ```',
		'- ~~~some-future-plugin\nquery', '`= this.file.name`', '`$= dv.current()`',
		'``= query``', '``` \tCUSTOM\ncode']) {
		assert.ok(previewSourceReason(text), text);
	}
});

void test('long incomplete fence runs do not retry matching at every delimiter', () => {
	for (const delimiter of ['`', '~']) {
		const run = delimiter.repeat(100_000);
		assert.equal(previewSourceReason(run), null);
		assert.ok(previewSourceReason(run + 'dataviewjs'));
	}
});
