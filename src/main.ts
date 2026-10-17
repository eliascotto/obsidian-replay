import { Notice, Plugin } from 'obsidian';
import { ReplayPreferences } from './settings';
import { RecordingController } from './recording/controller';
import { RecordingStore } from './storage/recording-store';
import { ObsidianStorageAdapter, recordingRoot, browserScheduler } from './storage/obsidian-adapter';
import { EditorCaptureBridge } from './capture/editor-extension';
import { RecordingControls, reportRecordingError } from './ui/recording-controls';
import { ReplayWorkspace } from './ui/replay-workspace';
import { registerCommands } from './commands/register-commands';
import { ArtifactPublisher } from './artifacts/publisher';
import { ObsidianArtifactAdapter } from './artifacts/obsidian-adapter';

export default class ReplayPlugin extends Plugin {
	async onload(): Promise<void> {
		const preferences = new ReplayPreferences(await this.loadData(), (data) => this.saveData(data),
			() => { new Notice('Could not save the playback speed. Your selection still applies until Obsidian closes.'); });
		const root = recordingRoot(this);
		const storage = new ObsidianStorageAdapter(this.app.vault.adapter);
		const store = new RecordingStore(storage, root);
		const artifacts = new ArtifactPublisher(new ObsidianArtifactAdapter(this, storage, root));
		const controller = new RecordingController(store, reportRecordingError, browserScheduler, undefined, undefined, artifacts);
		const bridge = new EditorCaptureBridge(controller);
		this.registerEditorExtension(bridge.extension);
		const replay = new ReplayWorkspace(this, controller, store, artifacts, browserScheduler, preferences);
		const controls = new RecordingControls(this, controller, bridge, replay);
		registerCommands(this, controls, replay);
		this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
			void controller.rename(oldPath, file.path).catch(() => undefined);
		}));
		this.register(() => {
			controls.dispose();
			replay.dispose();
			bridge.dispose();
			void controller.dispose();
		});
	}
}
