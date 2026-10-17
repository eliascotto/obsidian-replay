import { parseRecording } from '../recording/format';
import { getStateAt } from '../recording/engine';
import type { RecordingFile } from '../recording/types';
import { StorageError } from './types';

export interface RecordingIndex {
	storageVersion: 1;
	notes: Record<string, string>;
}

export function object(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validId(value: unknown): value is string {
	return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
}

export function parseIndex(text: string): RecordingIndex {
	const value: unknown = JSON.parse(text);
	if (!object(value) || value.storageVersion !== 1 || !object(value.notes)) {
		throw new StorageError('Invalid or unsupported recording index.');
	}
	const notes: Record<string, string> = Object.create(null) as Record<string, string>;
	const ids = new Set<string>();
	for (const [path, id] of Object.entries(value.notes)) {
		if (!path || !validId(id) || ids.has(id)) throw new StorageError('Invalid recording identity.');
		ids.add(id);
		notes[path] = id;
	}
	return { storageVersion: 1, notes };
}

export function validateMetadata(text: string, id: string): {
	currentPath: string; lastSequence: number;
} {
	const value: unknown = JSON.parse(text);
	if (!object(value) || value.storageVersion !== 1 || value.id !== id ||
		typeof value.currentPath !== 'string' || typeof value.lastSequence !== 'number' ||
		!Number.isSafeInteger(value.lastSequence) || value.lastSequence < 0) {
		throw new StorageError('Invalid or unsupported recording metadata.');
	}
	return { currentPath: value.currentPath, lastSequence: value.lastSequence };
}

export function parseRecords(initial: string, log: string): {
	recording: RecordingFile; finalText: string; repair: string | undefined;
} {
	const header = parseRecording(initial);
	if (header.steps.length) throw new StorageError('Initial recording contains edit steps.');
	const end = log.lastIndexOf('\n') + 1;
	const complete = log.slice(0, end);
	const steps: unknown[] = complete === '' ? [] : complete.slice(0, -1).split('\n').map((line) => {
		const value: unknown = JSON.parse(line);
		return value;
	});
	const recording = parseRecording(JSON.stringify({ ...header, steps }));
	return {
		recording, finalText: getStateAt(recording, recording.steps.length),
		repair: end === log.length ? undefined : complete,
	};
}

export function remap(path: string, from: string, to: string): string {
	return path === from || path.startsWith(from + '/') ? to + path.slice(from.length) : path;
}
