/** Shared by all dialogs so this plugin never commits two exports concurrently. */
export class ExportCommitQueue {
	private tail: Promise<void> = Promise.resolve();
	run(action: () => Promise<void>): Promise<void> {
		const task = this.tail.then(action);
		this.tail = task.catch(() => undefined);
		return task;
	}
}
