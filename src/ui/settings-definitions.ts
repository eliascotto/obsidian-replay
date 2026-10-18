import type { ColorComponent, Setting, TextComponent } from 'obsidian';
import { DEFAULT_DOOMED_COLOR, normalizeDoomedColor, type ReplayPreferences } from '../settings';

// Structural subset of Obsidian 1.13's definitions, compatible with the 1.12 API types.
interface ReplaySettingDefinition {
	name: string;
	desc: string;
	render?: (setting: Setting) => void;
}

/** Shared definitions for searchable settings and the legacy settings tab. */
export function replaySettingDefinitions(preferences: ReplayPreferences): ReplaySettingDefinition[] {
	return [
		{
			name: 'Recording keyboard shortcut',
			desc: 'Assign Replay: Toggle recording in Settings → Hotkeys to start, stop, or retry saving. No shortcut is assigned by default.',
		},
		{
			name: 'Doomed highlight color',
			desc: 'Select a color or enter a six-digit hex value. Applies to all replay files.',
			render: (setting) => renderDoomedColor(setting, preferences),
		},
	];
}

function renderDoomedColor(setting: Setting, preferences: ReplayPreferences): void {
	let picker: ColorComponent;
	let hex: TextComponent;
	const update = (value: string) => {
		const color = normalizeDoomedColor(value);
		hex.inputEl.setAttribute('aria-invalid', String(!color));
		if (!color) return;
		preferences.setDoomedColor(color);
		picker.setValue(color);
		hex.setValue(color);
	};
	setting
		.addColorPicker((component) => {
			picker = component;
			component.setValue(preferences.doomedHighlightColor).onChange(update);
		})
		.addText((component) => {
			hex = component;
			component.inputEl.setAttribute('aria-label', 'Doomed highlight color');
			component.setPlaceholder(DEFAULT_DOOMED_COLOR).setValue(preferences.doomedHighlightColor).onChange(update);
		})
		.addExtraButton((button) => button.setIcon('reset').setTooltip('Reset to default').onClick(() => update(DEFAULT_DOOMED_COLOR)));
}
