import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareDoomed, DOOMED_LIMITS, type DoomedRange } from '../../src/replay/doomed';

function ranges(before: string, after: string): readonly DoomedRange[] {
	const result = compareDoomed(before, after);
	assert.equal(result.status, 'ready');
	assert.ok(result.status === 'ready');
	return result.ranges;
}

const examples: [string, string, DoomedRange[]][] = [
	['The cat sleeps.', 'The dog sleeps.', [{ from: 4, to: 7 }]],
	['abc', 'aNEWbc!', []],
	['abcdef', 'abef', [{ from: 2, to: 4 }]],
	['!abc?', 'abc', [{ from: 0, to: 1 }, { from: 4, to: 5 }]],
	['a b\n', 'ab', [{ from: 1, to: 2 }, { from: 3, to: 4 }]],
	['abc', 'XYZ', [{ from: 0, to: 3 }]],
	['abc', '', [{ from: 0, to: 3 }]], ['', 'abc', []], ['', '', []], ['abc', 'abc', []],
	['ab', 'ba', [{ from: 0, to: 1 }]],
	['aba', 'baa', [{ from: 0, to: 1 }]],
	['aaaa', 'aa', [{ from: 2, to: 4 }]],
	['one two', 'two one', [{ from: 0, to: 4 }]],
	['😀cat', '😀dog', [{ from: 2, to: 5 }]],
	['x😀y', 'xy', [{ from: 1, to: 3 }]],
	['e\u0301', 'e', [{ from: 1, to: 2 }]],
	['👩\u200d💻', '👩', [{ from: 2, to: 5 }]],
	['✈️', '✈', [{ from: 1, to: 2 }]],
	['你好\r\n世界\t', '你好\n世界', [{ from: 2, to: 3 }, { from: 6, to: 7 }]],
];
for (const [before, after, expected] of examples) {
	void test(`Doomed ranges for ${JSON.stringify(before)} → ${JSON.stringify(after)}`, () => {
		assert.deepEqual(ranges(before, after), expected);
	});
}

// Independent quadratic dynamic programming is small enough for short oracle inputs.
function lcsLength(before: string[], after: string[]): number {
	const rows = Array.from({ length: before.length + 1 }, () => Array<number>(after.length + 1).fill(0));
	for (let i = 1; i <= before.length; i++) for (let j = 1; j <= after.length; j++) {
		rows[i]![j] = before[i - 1] === after[j - 1] ? rows[i - 1]![j - 1]! + 1 : Math.max(rows[i - 1]![j]!, rows[i]![j - 1]!);
	}
	return rows[before.length]![after.length]!;
}

void test('generated diffs are minimal, deterministic, ordered and retain a common subsequence', () => {
	const words = [''];
	for (let length = 1; length <= 5; length++) {
		for (let bits = 0; bits < 2 ** length; bits++) words.push(bits.toString(2).padStart(length, '0').replaceAll('0', 'a').replaceAll('1', 'b'));
	}
	words.push('😀ab😀', 'a😀b', 'é\ne\u0301', '你好');
	for (const before of words) for (const after of words) {
		const actual = ranges(before, after);
		assert.deepEqual(actual, ranges(before, after), `${before} → ${after}`);
		let end = 0;
		let retained = '';
		let deleted = 0;
		for (const range of actual) {
			assert.ok(Number.isSafeInteger(range.from) && range.from >= end && range.to > range.from && range.to <= before.length);
			retained += before.slice(end, range.from);
			deleted += Array.from(before.slice(range.from, range.to)).length;
			end = range.to;
		}
		retained += before.slice(end);
		assert.equal(deleted, Array.from(before).length - lcsLength(Array.from(before), Array.from(after)), `${before} → ${after}`);
		let cursor = 0;
		const finalPoints = Array.from(after);
		for (const point of retained) {
			while (cursor < finalPoints.length && finalPoints[cursor] !== point) cursor++;
			assert.ok(cursor < finalPoints.length, `${retained} is not a subsequence of ${after}`);
			cursor++;
		}
	}
});

void test('comparison has explicit limits without confusing them with no doomed text', () => {
	assert.deepEqual(compareDoomed('a'.repeat(2000), 'b'.repeat(2000)), { status: 'unavailable', reason: 'work-limit' });
	assert.equal(compareDoomed('a'.repeat(DOOMED_LIMITS.inputUnits), 'b').status, 'unavailable');
	const huge = 'x'.repeat(DOOMED_LIMITS.inputUnits + 1);
	assert.deepEqual(ranges(huge, huge), []);
	assert.deepEqual(ranges(huge, ''), [{ from: 0, to: huge.length }]);
	const article = 'An existing article, revised over time.\n'.repeat(3000);
	assert.deepEqual(ranges(article + 'draft' + article, article + 'final' + article), [{ from: article.length, to: article.length + 3 }, { from: article.length + 4, to: article.length + 5 }]);
});

void test('results are immutable and HTML-like strings remain ordinary compared characters', () => {
	const result = ranges('<script>draft</script>', '<script>final</script>');
	assert.ok(result.length > 0);
	assert.ok(Object.isFrozen(result));
	assert.ok(result.every(Object.isFrozen));
});
