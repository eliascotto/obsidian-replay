import { getStateAt } from '../recording/engine';
import { parseRecording, serializeRecording } from '../recording/format';
import type { RecordingFile } from '../recording/types';

export interface PreparedArtifact {
	readonly json: string;
	readonly initialText: string;
	readonly finalText: string;
	readonly lastSequence: number;
}

export function prepareArtifact(recording: RecordingFile): PreparedArtifact {
	return Object.freeze({
		json: serializeRecording(recording), initialText: recording.initialText,
		lastSequence: recording.steps.length, finalText: getStateAt(recording, recording.steps.length),
	});
}

export function verifyArtifact(text: string, expected: PreparedArtifact): void {
	if (text !== expected.json) throw new Error('The saved recording does not match the expected text.');
	const recording = parseRecording(text);
	if (recording.initialText !== expected.initialText || recording.steps.length !== expected.lastSequence ||
		getStateAt(recording, recording.steps.length) !== expected.finalText) {
		throw new Error('The saved recording does not reproduce the recorded changes.');
	}
}
