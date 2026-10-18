import { PluginSettingTab, Setting, type Plugin } from 'obsidian';
import type { ReplayPreferences } from '../settings';
import { replaySettingDefinitions } from './settings-definitions';

export class ReplaySettingsTab extends PluginSettingTab {
	constructor(plugin: Plugin, private preferences: ReplayPreferences) { super(plugin.app, plugin); }

	// Obsidian 1.13+ indexes and renders these definitions without calling display().
	getSettingDefinitions(): ReturnType<typeof replaySettingDefinitions> {
		return replaySettingDefinitions(this.preferences);
	}

	// Obsidian 1.7.2–1.12 uses the same controls through the imperative API.
	display(): void {
		this.containerEl.empty();
		for (const definition of this.getSettingDefinitions()) {
			const setting = new Setting(this.containerEl).setName(definition.name).setDesc(definition.desc);
			definition.render?.(setting);
		}
	}
}
