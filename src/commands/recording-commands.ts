import type { Plugin } from 'obsidian';
import type { RecordingControls } from '../ui/recording-controls';

/** Keep stable command IDs so existing user bindings still work. */
export function registerRecordingCommands(plugin: Plugin, controls: RecordingControls): void {
	plugin.addCommand({
		id: 'toggle-recording', name: 'Toggle recording',
		checkCallback: (checking) => {
			if (!controls.canStop() && !controls.canStart()) return false;
			if (!checking) controls.toggle();
			return true;
		},
	});
	plugin.addCommand({
		id: 'start-recording', name: 'Start recording',
		checkCallback: (checking) => {
			if (!controls.canStart()) return false;
			if (!checking) controls.start();
			return true;
		},
	});
	plugin.addCommand({
		id: 'stop-recording', name: 'Stop recording or retry saving',
		checkCallback: (checking) => {
			if (!controls.canStop()) return false;
			if (!checking) controls.stop();
			return true;
		},
	});
}
