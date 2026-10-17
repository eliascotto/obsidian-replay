import { setIcon, setTooltip } from 'obsidian';

/** Native Obsidian icon styling, with a tooltip and an accessible action name. */
export function createIconButton(parent: HTMLElement, icon: string, label: string, type: 'button' | 'submit' = 'button'): HTMLButtonElement {
	const button = parent.createEl('button', { type, cls: 'clickable-icon replay-icon-button' });
	updateIconButton(button, icon, label);
	return button;
}

export function updateIconButton(button: HTMLButtonElement, icon: string, label: string): void {
	if (button.getAttribute('aria-label') === label) return;
	setIcon(button, icon);
	setTooltip(button, label);
	button.setAttribute('aria-label', label);
}
