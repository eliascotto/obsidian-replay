import type { Plugin } from 'obsidian';
import type { ReplayWorkspace } from '../ui/replay-workspace';
import type { RecordingControls } from '../ui/recording-controls';
import type { ExportWorkspace } from '../ui/export-workspace';

export function registerCommands(plugin: Plugin, controls: RecordingControls, replay: ReplayWorkspace, exports: ExportWorkspace): void {
	plugin.addCommand({
		id: 'export-recording', name: 'Export recording',
		checkCallback: (checking) => {
			if (!exports.canOpen()) return false;
			if (!checking) exports.openCurrent();
			return true;
		},
	});
	plugin.addCommand({
		id: 'open-history',
		name: 'Open recording history',
		checkCallback: (checking) => {
			if (!replay.canOpen()) return false;
			if (!checking) replay.openCurrent();
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
		id: 'stop-recording', name: 'Stop recording / retry save',
		checkCallback: (checking) => {
			if (!controls.canStop()) return false;
			if (!checking) controls.stop();
			return true;
		},
	});
}
