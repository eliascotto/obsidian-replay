import { applyStep } from './engine';
import { RecordingError } from './errors';
import type { RecordingStep, TextChange } from './types';
import type { WriteQueue } from '../storage/write-queue';

export type RecordingPhase = 'absent' | 'starting' | 'recording' | 'stopping' | 'stopped' | 'error';

export interface Observation {
	readonly before: string;
	readonly after: string;
	readonly changes: readonly TextChange[];
}

export class RecordingSession {
	phase: RecordingPhase = 'starting';
	capturing = true;
	expectedText: string;
	nextSequence = 1;
	buffer: RecordingStep[] = [];
	queue: WriteQueue | undefined;
	initializing: Promise<void> | undefined;
	stopping: Promise<void> | undefined;
	initialized = false;
	error: unknown;

	constructor(public path: string, public id: string, readonly snapshot: string) {
		this.expectedText = snapshot;
	}

	accept(observation: Observation): void {
		if (!this.capturing || observation.before === observation.after) return;
		// Another pane may report a change already reflected by this stream.
		if (observation.after === this.expectedText) return;
		if (observation.before !== this.expectedText) {
			throw new RecordingError('text-mismatch', 'Editor state differs from the recorded state. Stop and resume recording.');
		}
		const step: RecordingStep = {
			sequence: this.nextSequence, kind: 'edit',
			changes: observation.changes.map((change) => ({ ...change })),
		};
		if (applyStep(this.expectedText, step) !== observation.after) {
			throw new RecordingError('text-mismatch', 'Recorded changes do not reproduce the editor state.');
		}
		this.expectedText = observation.after;
		this.nextSequence++;
		if (this.queue) this.queue.enqueue(step);
		else this.buffer.push(step);
	}
}
