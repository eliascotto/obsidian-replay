import type { Plugin } from 'obsidian';
import type { RecordingControls } from '../ui/recording-controls';

/** The two requested defaults remain editable in Obsidian Settings → Hotkeys. */
export function registerRecordingCommands(plugin: Plugin, controls: RecordingControls): void {
	plugin.addCommand({
		id: 'start-recording', name: 'Start recording',
		hotkeys: [{ modifiers: ['Mod', 'Alt', 'Shift'], key: 'R' }],
		checkCallback: (checking) => {
			if (!controls.canStart()) return false;
			if (!checking) controls.start();
			return true;
		},
	});
	plugin.addCommand({
		id: 'stop-recording', name: 'Stop recording / retry save',
		hotkeys: [{ modifiers: ['Mod', 'Alt', 'Shift'], key: 'S' }],
		checkCallback: (checking) => {
			if (!controls.canStop()) return false;
			if (!checking) controls.stop();
			return true;
		},
	});
}
