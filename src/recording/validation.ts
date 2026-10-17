import { RecordingError, type RecordingErrorLocation } from './errors';
import {
	RECORDING_FORMAT,
	RECORDING_FORMAT_VERSION,
	type RecordingFile,
	type RecordingStep,
	type TextChange,
} from './types';

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOffset(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function validateChangeShape(
	value: unknown,
	location: RecordingErrorLocation,
): asserts value is TextChange {
	if (
		!isObject(value) ||
		typeof value.deletedText !== 'string' ||
		typeof value.insertedText !== 'string'
	) {
		throw new RecordingError('format', 'Expected a text change.', location);
	}
	const { fromBefore, toBefore, fromAfter, toAfter } = value;
	if (
		!isOffset(fromBefore) || !isOffset(toBefore) ||
		!isOffset(fromAfter) || !isOffset(toAfter) ||
		toBefore < fromBefore || toAfter < fromAfter ||
		toBefore - fromBefore !== value.deletedText.length ||
		toAfter - fromAfter !== value.insertedText.length
	) {
		throw new RecordingError('range', 'Invalid text-change ranges.', location);
	}
}

export function validateStepShape(
	value: unknown,
	location: RecordingErrorLocation = {},
): asserts value is RecordingStep {
	if (!isObject(value) || (value.kind !== 'edit' && value.kind !== 'resume')) {
		throw new RecordingError('format', 'Expected an edit or resume step.', location);
	}
	if (!isOffset(value.sequence) || value.sequence === 0) {
		throw new RecordingError('sequence', 'Expected a positive safe-integer sequence.', location);
	}
	const stepLocation = { ...location, sequence: value.sequence };
	if (!Array.isArray(value.changes) || value.changes.length === 0) {
		throw new RecordingError('format', 'Expected a nonempty changes array.', stepLocation);
	}
	let effective = false;
	for (let index = 0; index < value.changes.length; index++) {
		const change: unknown = value.changes[index];
		validateChangeShape(change, { ...stepLocation, changeIndex: index });
		effective ||= change.deletedText !== change.insertedText;
	}
	if (!effective) {
		throw new RecordingError('format', 'A step must change the document.', stepLocation);
	}
}

export function validateRecordingShape(value: unknown): asserts value is RecordingFile {
	if (
		!isObject(value) || value.format !== RECORDING_FORMAT ||
		typeof value.formatVersion !== 'number' ||
		typeof value.initialText !== 'string' || !Array.isArray(value.steps)
	) {
		throw new RecordingError('format', 'Expected a Replay recording.');
	}
	if (value.formatVersion !== RECORDING_FORMAT_VERSION) {
		throw new RecordingError('version', 'Unsupported recording format version.');
	}
	for (let index = 0; index < value.steps.length; index++) {
		const step: unknown = value.steps[index];
		validateStepShape(step, { stepIndex: index });
		if (step.sequence !== index + 1) {
			throw new RecordingError('sequence', 'Step sequences must be consecutive from 1.', {
				stepIndex: index, sequence: step.sequence,
			});
		}
	}
}

/** Validates all ranges against the unchanged document before any splices. */
export function validateStepAgainstState(
	state: string,
	step: RecordingStep,
	direction: 'forward' | 'reverse',
): void {
	validateStepShape(step);
	const totalDelta = step.changes.reduce(
		(delta, change) => delta + change.insertedText.length - change.deletedText.length, 0,
	);
	const beforeLength = direction === 'forward' ? state.length : state.length - totalDelta;
	const afterLength = beforeLength + totalDelta;
	if (!isOffset(beforeLength) || !isOffset(afterLength)) {
		throw new RecordingError('range', 'Invalid resulting document length.', { sequence: step.sequence });
	}
	let delta = 0;
	let previous: TextChange | undefined;
	for (const [changeIndex, change] of step.changes.entries()) {
		const location = { sequence: step.sequence, changeIndex };
		if (
			change.toBefore > beforeLength || change.toAfter > afterLength ||
			change.fromAfter !== change.fromBefore + delta ||
			(previous !== undefined && (
				change.fromBefore <= previous.fromBefore ||
				change.fromBefore < previous.toBefore || change.fromAfter < previous.toAfter
			))
		) {
			throw new RecordingError('range', 'Ranges must be ordered, disjoint, and coordinate-consistent.', location);
		}
		const from = direction === 'forward' ? change.fromBefore : change.fromAfter;
		const to = direction === 'forward' ? change.toBefore : change.toAfter;
		const expected = direction === 'forward' ? change.deletedText : change.insertedText;
		if (state.slice(from, to) !== expected) {
			throw new RecordingError('text-mismatch', 'Change text does not match the document.', location);
		}
		delta += change.insertedText.length - change.deletedText.length;
		previous = change;
	}
	if (step.kind === 'resume') {
		const replacement = step.changes[0];
		if (
			step.changes.length !== 1 || !replacement ||
			replacement.fromBefore !== 0 || replacement.toBefore !== beforeLength ||
			replacement.fromAfter !== 0 || replacement.toAfter !== afterLength
		) {
			throw new RecordingError('range', 'Resume must replace the complete document.', { sequence: step.sequence });
		}
	}
}
