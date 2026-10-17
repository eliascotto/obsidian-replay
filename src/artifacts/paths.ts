import { StorageError } from '../storage/types';

export function artifactPath(note: string): string {
	if (!/\.md$/i.test(note) || note.startsWith('/') || note.includes('\\') || /\p{Cc}/u.test(note) || note.split('/').some((part) => !part || part === '..' || part === '.')) {
		throw new StorageError('Choose a Markdown note inside the vault.');
	}
	return note.replace(/\.md$/i, '.replay');
}
