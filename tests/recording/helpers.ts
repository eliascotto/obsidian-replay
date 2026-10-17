import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RecordingError, type RecordingErrorCode } from '../../src/recording/errors';
import { parseRecording } from '../../src/recording/format';
import {
	RECORDING_FORMAT, RECORDING_FORMAT_VERSION,
	type RecordingFile, type RecordingStep, type TextChange,
} from '../../src/recording/types';

export function recording(initialText = '', steps: readonly RecordingStep[] = []): RecordingFile {
	return { format: RECORDING_FORMAT, formatVersion: RECORDING_FORMAT_VERSION, initialText, steps };
}

export function spliceStep(
	state: string, from: number, to: number, insertedText: string, sequence = 1,
): RecordingStep {
	return {
		sequence, kind: 'edit', changes: [{
			fromBefore: from, toBefore: to, fromAfter: from, toAfter: from + insertedText.length,
			deletedText: state.slice(from, to), insertedText,
		}],
	};
}

export function changedStep(overrides: Partial<TextChange>): RecordingStep {
	return {
		sequence: 1, kind: 'edit', changes: [{
			fromBefore: 1, toBefore: 2, fromAfter: 1, toAfter: 2,
			deletedText: 'b', insertedText: 'B', ...overrides,
		}],
	};
}

export function expectError(action: () => unknown, code: RecordingErrorCode): RecordingError {
	let captured: RecordingError | undefined;
	assert.throws(action, (error: unknown) => {
		assert.ok(error instanceof RecordingError);
		assert.equal(error.code, code);
		captured = error;
		return true;
	});
	assert.ok(captured);
	return captured;
}

export const fixtureStates: Readonly<Record<string, readonly string[]>> = {
	initial: ['An existing article.\r\nSecond line.'],
	insertion: ['', 'Hello', 'Hello, world!'],
	revision: ['The cat sleeps.', 'The dog sleeps.', 'The dog.'],
	multiple: ['abcdef', 'AAbc!f', 'AA!f'],
	resume: ['The cat sleeps.', 'The dog sleeps.', 'A new article.', 'A new article. Done.'],
};

export function loadFixture(name: string): RecordingFile {
	return parseRecording(readFileSync(`tests/recording/fixtures/${name}.json`, 'utf8'));
}
