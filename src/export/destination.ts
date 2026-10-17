export interface ExportPaths { readonly configDir: string; readonly pluginDir: string }

const invalid = /[<>:"\\|?*]|\p{Cc}/u;
const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9]) *(?:\.|$)/iu;
const inside = (path: string, root: string) => path === root || path.startsWith(root + '/');

export function suggestedDestination(source: string): string {
	const slash = source.lastIndexOf('/');
	const folder = source.slice(0, slash + 1);
	let name = source.slice(slash + 1).replace(/\.md$/iu, '').replace(/[<>:"\\|?*]|\p{Cc}/gu, '-').replace(/[. ]+$/u, '');
	if (!name) name = 'Recording';
	if (reserved.test(name)) name = '_' + name;
	return `${folder}${name}.replay.json`;
}

/** Validate the submitted spelling before any Obsidian normalization. */
export function validateDestination(path: string, source: string, paths: ExportPaths): string {
	if (!path || path.startsWith('/') || path.includes('\\')) return 'Use a path inside the vault with forward slashes.';
	const segments = path.split('/');
	if (segments.some((part) => !part || part === '.' || part === '..' || invalid.test(part) || reserved.test(part) || /[. ]$/u.test(part))) {
		return 'Choose a valid folder and filename without traversal or reserved characters.';
	}
	if (!path.endsWith('.replay.json')) return 'The filename must end with .replay.json.';
	const lower = path.toLowerCase();
	if (lower === source.toLowerCase() || [paths.configDir, paths.pluginDir, '.trash'].some((root) => inside(lower, root.toLowerCase()))) {
		return 'Choose a destination outside the note, configuration, plugin, and trash paths.';
	}
	return '';
}

export function destinationParent(path: string): string {
	const slash = path.lastIndexOf('/');
	return slash < 0 ? '' : path.slice(0, slash);
}
