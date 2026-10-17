/**
 * Conservative preflight, before invoking Obsidian's Markdown pipeline. Embeds/HTML
 * may load resources, and named fences/inline queries may invoke installed plugins.
 * False positives use exact source rather than attempting to sanitize arbitrary Markdown.
 */
export function previewSourceReason(text: string): string | null {
	if (/<[!/?a-z%]|!\s*\[|(?:^|[^`])`+\s*\$?=/i.test(text)) {
		return 'Showing source for embedded or active content.';
	}
	// Treat every named fence as potentially active, including nested/list fences.
	if (/(?:^|[^`~])(?:`{3,}|~{3,})[^\S\r\n]*[^\s`~]/.test(text)) {
		return 'Showing source for named code blocks.';
	}
	return null;
}
