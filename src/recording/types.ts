export const RECORDING_FORMAT = 'obsidian-replay';
export const RECORDING_FORMAT_VERSION = 1;

export interface RecordingFile {
	readonly format: typeof RECORDING_FORMAT;
	readonly formatVersion: typeof RECORDING_FORMAT_VERSION;
	readonly initialText: string;
	readonly steps: readonly RecordingStep[];
}

export interface RecordingStep {
	readonly sequence: number;
	readonly kind: 'edit' | 'resume';
	readonly changes: readonly TextChange[];
}

/** Half-open ranges in the complete before/after documents, in UTF-16 units. */
export interface TextChange {
	readonly fromBefore: number;
	readonly toBefore: number;
	readonly fromAfter: number;
	readonly toAfter: number;
	readonly deletedText: string;
	readonly insertedText: string;
}
