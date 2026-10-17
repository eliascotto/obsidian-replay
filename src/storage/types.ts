import type { RecordingFile } from '../recording/types';

export interface StorageAdapter {
	exists(path: string): Promise<boolean>;
	read(path: string): Promise<string>;
	write(path: string, text: string): Promise<void>;
	append(path: string, text: string): Promise<void>;
	replace(path: string, text: string): Promise<void>;
	mkdir(path: string): Promise<void>;
}

export interface StoredRecording {
	readonly id: string;
	readonly recording: RecordingFile;
	readonly finalText: string;
}

export class StorageError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'StorageError';
	}
}

export interface Scheduler {
	set(callback: () => void, delay: number): unknown;
	clear(handle: unknown): void;
}

