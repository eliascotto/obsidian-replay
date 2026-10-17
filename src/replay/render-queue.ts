export interface RenderTask {
	readonly ready: Promise<void>;
	commit(): void;
	dispose(): void;
}

type Request<T> = { value: T; generation: number };
type OwnedTask = { task: RenderTask; released: boolean };

/** One active render and one latest pending request; invalidated results never commit. */
export class RenderQueue<T> {
	private generation = 0;
	private pending: Request<T> | undefined;
	private active: OwnedTask | undefined;
	private committed: OwnedTask | undefined;
	private running = false;
	private disposed = false;

	constructor(private start: (value: T) => RenderTask,
		private failed: (value: T) => void, private busy: (value: boolean) => void) {}

	request(value: T): void {
		if (this.disposed) return;
		this.pending = { value, generation: ++this.generation };
		this.busy(true);
		if (!this.running) void this.run();
	}

	clear(): void {
		this.generation++;
		this.pending = undefined;
		this.release(this.active);
		this.release(this.committed);
		this.committed = undefined;
		this.busy(false);
	}

	dispose(): void { this.disposed = true; this.clear(); }

	private release(owned: OwnedTask | undefined): void {
		if (!owned || owned.released) return;
		owned.released = true;
		owned.task.dispose();
	}

	private async run(): Promise<void> {
		this.running = true;
		while (this.pending && !this.disposed) {
			const request = this.pending;
			this.pending = undefined;
			let owned: OwnedTask | undefined;
			try {
				owned = { task: this.start(request.value), released: false };
				this.active = owned;
				await owned.task.ready;
				if (!this.disposed && request.generation === this.generation) {
					owned.task.commit();
					this.release(this.committed);
					this.committed = owned;
					owned = undefined;
				}
			} catch {
				if (!this.disposed && request.generation === this.generation) {
					this.release(this.committed);
					this.committed = undefined;
					this.failed(request.value);
				}
			} finally {
				this.release(owned);
				this.active = undefined;
			}
		}
		this.running = false;
		if (!this.disposed) this.busy(false);
	}
}
