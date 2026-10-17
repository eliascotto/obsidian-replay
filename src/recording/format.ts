import { applyStep } from './engine';
import { RecordingError } from './errors';
import { RECORDING_FORMAT, RECORDING_FORMAT_VERSION, type RecordingFile } from './types';
import { validateRecordingShape } from './validation';

function validateRecording(value: unknown): asserts value is RecordingFile {
	validateRecordingShape(value);
	let state = value.initialText;
	for (const step of value.steps) {
		state = applyStep(state, step);
	}
}

export function parseRecording(json: string): RecordingFile {
	let value: unknown;
	try {
		value = JSON.parse(json);
	} catch {
		throw new RecordingError('format', 'Recording is not valid JSON.');
	}
	validateRecording(value);
	return value;
}

export function serializeRecording(recording: RecordingFile): string {
	validateRecording(recording);
	// Explicitly select portable fields; never export local IDs or extra metadata.
	const portable: RecordingFile = {
		format: RECORDING_FORMAT,
		formatVersion: RECORDING_FORMAT_VERSION,
		initialText: recording.initialText,
		steps: recording.steps.map((step) => ({
			sequence: step.sequence,
			kind: step.kind,
			changes: step.changes.map((change) => ({
				fromBefore: change.fromBefore, toBefore: change.toBefore,
				fromAfter: change.fromAfter, toAfter: change.toAfter,
				deletedText: change.deletedText, insertedText: change.insertedText,
			})),
		})),
	};
	return JSON.stringify(portable, null, 2) + '\n';
}
