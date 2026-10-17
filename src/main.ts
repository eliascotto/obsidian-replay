import { Plugin } from 'obsidian';
import { RecordingController } from './recording/controller';
import { RecordingStore } from './storage/recording-store';
import { ObsidianStorageAdapter, recordingRoot, browserScheduler } from './storage/obsidian-adapter';
import { EditorCaptureBridge } from './capture/editor-extension';
import { RecordingControls, reportRecordingError } from './ui/recording-controls';
import { ReplayWorkspace } from './ui/replay-workspace';
import { registerCommands } from './commands/register-commands';
import { ExportWorkspace } from './ui/export-workspace';

export default class ReplayPlugin extends Plugin {
	onload(): void {
		const store = new RecordingStore(new ObsidianStorageAdapter(this.app.vault.adapter), recordingRoot(this));
		const controller = new RecordingController(store, reportRecordingError, browserScheduler);
		const bridge = new EditorCaptureBridge(controller);
		this.registerEditorExtension(bridge.extension);
		const replay = new ReplayWorkspace(this, controller, browserScheduler, (path) => exports.open(path));
		const exports = new ExportWorkspace(this, controller, (path) => replay.pause(path));
		const controls = new RecordingControls(this, controller, bridge, (path) => { void replay.open(path); }, (path) => exports.open(path));
		registerCommands(this, controls, replay, exports);
		this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
			void controller.rename(oldPath, file.path).catch(() => undefined);
		}));
		this.register(() => {
			controls.dispose();
			exports.dispose();
			replay.dispose();
			bridge.dispose();
			void controller.dispose();
		});
	}
}
