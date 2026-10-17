import type { Scheduler, StorageAdapter } from '../../src/storage/types';

export function deferred<T = void>(): {
	promise: Promise<T>; resolve: (value: T | PromiseLike<T>) => void; reject: (error: unknown) => void;
} {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
	return { promise, resolve, reject };
}

export class MemoryAdapter implements StorageAdapter {
	files = new Map<string, string>();
	directories = new Set<string>();
	before: ((operation: string, path: string, text: string) => Promise<void>) | undefined;
	after: ((operation: string, path: string, text: string) => Promise<void>) | undefined;
	calls: { operation: string; path: string }[] = [];

	async exists(path: string): Promise<boolean> { return this.files.has(path) || this.directories.has(path); }
	async read(path: string): Promise<string> {
		await this.before?.('read', path, '');
		const text = this.files.get(path);
		if (text === undefined) throw new Error('Missing file');
		return text;
	}
	async mkdir(path: string): Promise<void> { this.directories.add(path); }
	private async mutate(operation: string, path: string, text: string): Promise<void> {
		this.calls.push({ operation, path });
		await this.before?.(operation, path, text);
		this.files.set(path, operation === 'append' ? (await this.read(path)) + text : text);
		await this.after?.(operation, path, text);
	}
	write(path: string, text: string): Promise<void> { return this.mutate('write', path, text); }
	replace(path: string, text: string): Promise<void> { return this.mutate('replace', path, text); }
	append(path: string, text: string): Promise<void> { return this.mutate('append', path, text); }
}

export class FakeClock implements Scheduler {
	private time = 0;
	private next = 0;
	private timers = new Map<number, { at: number; callback: () => void }>();
	set(callback: () => void, delay: number): unknown {
		const id = this.next++;
		this.timers.set(id, { at: this.time + delay, callback });
		return id;
	}
	clear(handle: unknown): void { this.timers.delete(handle as number); }
	get size(): number { return this.timers.size; }
	advance(duration: number): void {
		const target = this.time + duration;
		for (;;) {
			const first = [...this.timers].sort((a, b) => a[1].at - b[1].at)[0];
			if (!first || first[1].at > target) break;
			this.time = first[1].at;
			this.timers.delete(first[0]);
			first[1].callback();
		}
		this.time = target;
	}
}
