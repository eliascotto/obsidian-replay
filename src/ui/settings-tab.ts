import { PluginSettingTab, Setting, type ColorComponent, type Plugin, type TextComponent } from 'obsidian';
import { DEFAULT_DOOMED_COLOR, normalizeDoomedColor, type ReplayPreferences } from '../settings';

export class ReplaySettingsTab extends PluginSettingTab {
	constructor(plugin: Plugin, private preferences: ReplayPreferences) { super(plugin.app, plugin); }

	display(): void {
		this.containerEl.empty();
		const shortcut = new Setting(this.containerEl).setName('Recording keyboard shortcut');
		shortcut.descEl.append('Use the same keyboard shortcut to start, stop, or retry saving. Change ');
		shortcut.descEl.createEl('strong', { text: 'Replay: Toggle recording' });
		shortcut.descEl.append(' in ');
		shortcut.descEl.createEl('strong', { text: 'Settings' });
		shortcut.descEl.append(' → ');
		shortcut.descEl.createEl('strong', { text: 'Hotkeys' });
		shortcut.descEl.append('. Default: ');
		shortcut.descEl.createEl('code', { text: 'Command+Shift+R' });
		shortcut.descEl.append(' on macOS or ');
		shortcut.descEl.createEl('code', { text: 'Ctrl+Shift+R' });
		shortcut.descEl.append(' on Windows and Linux.');
		let picker: ColorComponent;
		let hex: TextComponent;
		const update = (value: string) => {
			const color = normalizeDoomedColor(value);
			hex.inputEl.setAttribute('aria-invalid', String(!color));
			if (!color) return;
			this.preferences.setDoomedColor(color);
			picker.setValue(color);
			hex.setValue(color);
		};
		new Setting(this.containerEl)
			.setName('Doomed highlight color')
			.setDesc('Select a color or enter a six-digit hex value. Applies to all replay files.')
			.addColorPicker((component) => {
				picker = component;
				component.setValue(this.preferences.doomedHighlightColor).onChange(update);
			})
			.addText((component) => {
				hex = component;
				component.inputEl.setAttribute('aria-label', 'Doomed highlight color');
				component.setPlaceholder(DEFAULT_DOOMED_COLOR).setValue(this.preferences.doomedHighlightColor).onChange(update);
			})
			.addExtraButton((button) => button.setIcon('reset').setTooltip('Reset to default').onClick(() => update(DEFAULT_DOOMED_COLOR)));
	}
}
