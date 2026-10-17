import { StorageError } from '../storage/types';

export interface ArtifactEntry {
	source: string;
	path: string;
	sequence: number;
	fingerprint: string;
	pending?: string;
	active?: boolean;
	movedWithFolder?: boolean;
	relocating?: string;
}
export interface ArtifactRegistry { version: 1; entries: Record<string, ArtifactEntry> }

export function parseRegistry(text: string | null): ArtifactRegistry {
	if (text === null) return { version: 1, entries: Object.create(null) as Record<string, ArtifactEntry> };
	const value: unknown = JSON.parse(text);
	if (typeof value !== 'object' || !value || !('version' in value) || value.version !== 1 ||
		!('entries' in value) || typeof value.entries !== 'object' || !value.entries || Array.isArray(value.entries)) {
		throw new StorageError('The recording file registry is invalid. Existing files were preserved.');
	}
	const entries = Object.create(null) as Record<string, ArtifactEntry>;
	for (const [id, entry] of Object.entries(value.entries)) {
		if (!id || typeof entry !== 'object' || !entry) throw new StorageError('Invalid recording file ownership.');
		const record = entry as Partial<ArtifactEntry>;
		if (typeof record.source !== 'string' || typeof record.path !== 'string' ||
			!Number.isSafeInteger(record.sequence) || (record.sequence ?? -1) < -1 ||
			typeof record.fingerprint !== 'string' || !/^(?:[a-f0-9]{64})?$/.test(record.fingerprint) ||
			(record.pending !== undefined && !/^[a-f0-9]{64}$/.test(record.pending)) ||
			(record.active !== undefined && typeof record.active !== 'boolean') ||
			(record.movedWithFolder !== undefined && typeof record.movedWithFolder !== 'boolean') ||
			(record.relocating !== undefined && (typeof record.relocating !== 'string' || !record.relocating.endsWith('.replay') ||
				record.relocating.startsWith('/') || record.relocating.includes('\\') || record.relocating.split('/').some((part) => !part || part === '..' || part === '.'))) ||
			[record.source, record.path].some((path) => path.startsWith('/') || path.includes('\\') || path.split('/').some((part) => !part || part === '..' || part === '.')) ||
			!record.source.toLowerCase().endsWith('.md') || !record.path.endsWith('.replay')) {
			throw new StorageError('Invalid recording file ownership.');
		}
		Object.defineProperty(entries, id, { value: { ...record }, enumerable: true, writable: true, configurable: true });
	}
	return { version: 1, entries };
}

export async function fingerprint(text: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
