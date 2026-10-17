import { RecordingError } from './errors';
import type { RecordingFile, RecordingStep } from './types';
import { validateRecordingShape, validateStepAgainstState, validateStepShape } from './validation';

export function applyStep(state: string, step: RecordingStep): string {
	validateStepAgainstState(state, step, 'forward');
	let result = state;
	// Reverse canonical order so each splice still uses its original coordinates.
	for (let index = step.changes.length - 1; index >= 0; index--) {
		const change = step.changes[index];
		if (change) {
			result = result.slice(0, change.fromBefore) + change.insertedText + result.slice(change.toBefore);
		}
	}
	return result;
}

export function reverseStep(state: string, step: RecordingStep): string {
	validateStepAgainstState(state, step, 'reverse');
	let result = state;
	for (let index = step.changes.length - 1; index >= 0; index--) {
		const change = step.changes[index];
		if (change) {
			result = result.slice(0, change.fromAfter) + change.deletedText + result.slice(change.toAfter);
		}
	}
	return result;
}

export function getStateAt(recording: RecordingFile, sequence: number): string {
	validateRecordingShape(recording);
	if (!Number.isSafeInteger(sequence) || sequence < 0 || sequence > recording.steps.length) {
		throw new RecordingError('sequence', 'Selected sequence is outside the recording.');
	}
	let state = recording.initialText;
	for (const step of recording.steps) {
		if (step.sequence > sequence) break;
		state = applyStep(state, step);
	}
	return state;
}

export function createResumeStep(
	previousText: string,
	currentText: string,
	nextSequence: number,
): RecordingStep | null {
	if (!Number.isSafeInteger(nextSequence) || nextSequence < 1) {
		throw new RecordingError('sequence', 'Expected a positive safe-integer sequence.');
	}
	if (previousText === currentText) return null;
	const step: RecordingStep = {
		sequence: nextSequence,
		kind: 'resume',
		changes: [{
			fromBefore: 0, toBefore: previousText.length,
			fromAfter: 0, toAfter: currentText.length,
			deletedText: previousText, insertedText: currentText,
		}],
	};
	validateStepShape(step);
	return step;
}
