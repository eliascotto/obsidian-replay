import type { RecordingStep } from '../recording/types';
import type { Scheduler } from './types';

export class WriteQueue {
	private pending: RecordingStep[] = [];
	private idle: unknown;
	private maximum: unknown;
	private inFlight: Promise<void> | undefined;
	private disposed = false;

	constructor(
		private write: (batch: readonly RecordingStep[]) => Promise<void>,
		private onError: (error: unknown) => void,
		private clock: Scheduler,
	) {}

	get size(): number { return this.pending.length; }

	enqueue(step: RecordingStep): void {
		// Own the batch so caller mutation cannot change an uncertain append on retry.
		this.pending.push({ ...step, changes: step.changes.map((change) => ({ ...change })) });
		if (this.disposed) return;
		if (this.idle !== undefined) this.clock.clear(this.idle);
		this.idle = this.clock.set(() => this.scheduleFlush(), 500);
		if (this.maximum === undefined) this.maximum = this.clock.set(() => this.scheduleFlush(), 2000);
		if (this.pending.length >= 50) this.scheduleFlush();
	}

	private scheduleFlush(): void {
		void this.flush().catch(this.onError);
	}

	private cancelTimers(): void {
		if (this.idle !== undefined) this.clock.clear(this.idle);
		if (this.maximum !== undefined) this.clock.clear(this.maximum);
		this.idle = undefined;
		this.maximum = undefined;
	}

	flush(): Promise<void> {
		this.cancelTimers();
		if (this.inFlight) return this.inFlight.then(() => this.pending.length ? this.flush() : undefined);
		this.inFlight = this.drain().finally(() => { this.inFlight = undefined; });
		return this.inFlight.then(() => this.pending.length ? this.flush() : undefined);
	}

	private async drain(): Promise<void> {
		try {
			while (this.pending.length) {
				this.cancelTimers();
				const batch = this.pending.slice();
				await this.write(batch);
				this.pending.splice(0, batch.length);
			}
		} catch (error) {
			this.cancelTimers();
			throw error;
		}
	}

	dispose(): void {
		this.disposed = true;
		this.cancelTimers();
	}
}
