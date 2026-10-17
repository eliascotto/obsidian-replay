import { applyStep, getStateAt, reverseStep } from '../recording/engine';
import { RecordingError } from '../recording/errors';
import type { RecordingFile } from '../recording/types';
import { validateRecordingShape } from '../recording/validation';
import type { Scheduler } from '../storage/types';
import { BASE_STEP_INTERVAL_MS, PLAYBACK_RATES, type ReplayState } from './types';

export class ReplayController {
	readonly recording: RecordingFile;
	readonly finalText: string;
	private sequence = 0;
	private text: string;
	private rate = 1;
	private playing = false;
	private error: string | null = null;
	private disposed = false;
	private tick: unknown;
	private tickGeneration = 0;
	private seek: unknown;
	private seekGeneration = 0;
	private pending: number | null = null;
	private listeners = new Set<() => void>();

	constructor(recording: RecordingFile, private clock: Scheduler) {
		validateRecordingShape(recording);
		// Own and freeze the model; a caller cannot later alter the playing history.
		this.recording = Object.freeze({ ...recording, steps: Object.freeze(recording.steps.map((step) =>
			Object.freeze({ ...step, changes: Object.freeze(step.changes.map((change) => Object.freeze({ ...change }))) }))),
		});
		this.finalText = getStateAt(this.recording, this.recording.steps.length);
		this.text = this.recording.initialText;
	}

	get state(): ReplayState {
		return {
			sequence: this.sequence, text: this.text, lastSequence: this.recording.steps.length,
			rate: this.rate, playing: this.playing, pendingSequence: this.pending, error: this.error,
		};
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => { this.listeners.delete(listener); };
	}

	private changed(): void { if (!this.disposed) this.listeners.forEach((listener) => listener()); }

	private check(sequence: number): void {
		if (!Number.isSafeInteger(sequence) || sequence < 0 || sequence > this.recording.steps.length) {
			throw new RecordingError('sequence', 'Selected sequence is outside the recording.');
		}
	}

	private move(sequence: number): void {
		if (this.disposed || this.error) return;
		try {
			let text: string;
			if (sequence === this.sequence + 1) {
				const step = this.recording.steps[this.sequence];
				if (!step) return;
				text = applyStep(this.text, step);
			} else if (sequence === this.sequence - 1) {
				const step = this.recording.steps[sequence];
				if (!step) return;
				text = reverseStep(this.text, step);
			} else text = getStateAt(this.recording, sequence);
			this.text = text;
			this.sequence = sequence;
			if (sequence === this.recording.steps.length) this.stopClock();
		} catch (error) {
			this.stopClock();
			this.cancelSeek();
			this.error = error instanceof RecordingError ? error.message : 'Replay could not reconstruct this step.';
		}
		this.changed();
	}

	select(sequence: number): void {
		this.check(sequence);
		if (this.disposed) return;
		this.stopClock();
		this.cancelSeek();
		this.move(sequence);
	}

	previous(): void { this.commitSeek(); this.select(Math.max(0, this.sequence - 1)); }
	next(): void { this.commitSeek(); this.select(Math.min(this.recording.steps.length, this.sequence + 1)); }

	requestSeek(sequence: number): void {
		this.check(sequence);
		if (this.disposed || this.error) return;
		this.stopClock();
		this.cancelSeek();
		this.pending = sequence;
		const generation = this.seekGeneration;
		this.seek = this.clock.set(() => {
			if (this.disposed || generation !== this.seekGeneration) return;
			this.commitSeek();
		}, 16);
		this.changed();
	}

	commitSeek(): void {
		const sequence = this.pending;
		this.cancelSeek();
		if (sequence !== null && !this.disposed) this.move(sequence);
	}

	private cancelSeek(): void {
		if (this.seek !== undefined) this.clock.clear(this.seek);
		this.seek = undefined;
		this.pending = null;
		this.seekGeneration++;
	}

	play(): void {
		this.commitSeek();
		if (this.disposed || this.error || this.playing || this.sequence >= this.recording.steps.length) return;
		this.playing = true;
		this.schedule();
		this.changed();
	}

	/** The transport action rewinds at the endpoint, ready for another play. */
	togglePlayback(): void {
		this.commitSeek();
		if (this.disposed || this.error || this.recording.steps.length === 0) return;
		if (this.playing) this.pause();
		else if (this.sequence === this.recording.steps.length) this.select(0);
		else this.play();
	}

	pause(): void { this.commitSeek(); this.stopClock(); this.changed(); }

	setRate(rate: number): void {
		if (!Number.isFinite(rate) || !PLAYBACK_RATES.includes(rate)) throw new RangeError('Unsupported playback rate.');
		if (this.disposed) return;
		this.commitSeek();
		const wasPlaying = this.playing;
		this.stopClock();
		this.rate = rate;
		this.playing = wasPlaying;
		if (wasPlaying) this.schedule();
		this.changed();
	}

	private stopClock(): void {
		if (this.tick !== undefined) this.clock.clear(this.tick);
		this.tick = undefined;
		this.playing = false;
		this.tickGeneration++;
	}

	private schedule(): void {
		if (this.tick !== undefined || !this.playing || this.disposed) return;
		const generation = this.tickGeneration;
		this.tick = this.clock.set(() => {
			if (this.disposed || !this.playing || generation !== this.tickGeneration) return;
			this.tick = undefined;
			this.move(this.sequence + 1);
			if (this.playing) this.schedule();
		}, BASE_STEP_INTERVAL_MS / this.rate);
	}

	dispose(): void {
		this.disposed = true;
		this.stopClock();
		this.cancelSeek();
		this.listeners.clear();
	}
}
