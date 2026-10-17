import { getStateAt } from '../recording/engine';
import { parseRecording, serializeRecording } from '../recording/format';
import type { RecordingFile } from '../recording/types';

export interface PreparedExport {
	readonly json: string;
	readonly initialText: string;
	readonly finalText: string;
	readonly lastSequence: number;
}

export function prepareExport(recording: RecordingFile): PreparedExport {
	return Object.freeze({
		json: serializeRecording(recording), initialText: recording.initialText,
		lastSequence: recording.steps.length, finalText: getStateAt(recording, recording.steps.length),
	});
}

export function verifyExport(text: string, expected: PreparedExport): void {
	if (text !== expected.json) throw new Error('Export readback differs from the prepared recording.');
	const recording = parseRecording(text);
	if (recording.initialText !== expected.initialText || recording.steps.length !== expected.lastSequence ||
		getStateAt(recording, recording.steps.length) !== expected.finalText) {
		throw new Error('Export does not reconstruct the prepared recording.');
	}
}
