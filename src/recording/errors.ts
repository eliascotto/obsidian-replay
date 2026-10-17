export type RecordingErrorCode =
	| 'format'
	| 'version'
	| 'sequence'
	| 'range'
	| 'text-mismatch';

export interface RecordingErrorLocation {
	readonly stepIndex?: number;
	readonly sequence?: number;
	readonly changeIndex?: number;
}

/** Error details identify the record, without including private document text. */
export class RecordingError extends Error {
	readonly code: RecordingErrorCode;
	readonly location: RecordingErrorLocation;

	constructor(
		code: RecordingErrorCode,
		message: string,
		location: RecordingErrorLocation = {},
	) {
		super(message);
		this.name = 'RecordingError';
		this.code = code;
		this.location = { ...location };
	}
}
