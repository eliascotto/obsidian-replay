import { registerRecordingCommands } from './recording-commands';
import type { Plugin } from 'obsidian';
import type { ReplayWorkspace } from '../ui/replay-workspace';
import type { RecordingControls } from '../ui/recording-controls';

export function registerCommands(plugin: Plugin, controls: RecordingControls, replay: ReplayWorkspace): void {
	plugin.addCommand({
		id: 'export-recording', name: 'Refresh recording file',
		checkCallback: (checking) => {
			if (!replay.canOpen()) return false;
			if (!checking) replay.openCurrent();
			return true;
		},
	});
	plugin.addCommand({
		id: 'open-history',
		name: 'Open recording file',
		checkCallback: (checking) => {
			if (!replay.canOpen()) return false;
			if (!checking) replay.openCurrent();
			return true;
		},
	});
	registerRecordingCommands(plugin, controls);
}
