# Replay

Replay records the writing process in an Obsidian Markdown note so it can be watched and exported for sharing, inspired by Stypi. The agreed product behavior is in [PROJECT.md](PROJECT.md); implementation progress is in [PLAN.md](docs/PLAN.md).

## Current implementation

- Explicit **Start recording** and **Stop recording** for a Markdown note.
- One recording per file, continued by starting again after stopping.
- Editor transaction capture, including typing, paste, replacements, undo, and redo.
- Local storage, exact state reconstruction, rename tracking, and save retries.
- Read-only replay with Play/Pause, previous/next, a step timeline, and adjustable steady playback.
- **Doomed** highlighting compares the selected step with the final recorded text.
- **Export recording** saves one readable, uncompressed `.replay.json` file inside the vault.
- A documented [portable recording format](docs/RECORDING_FORMAT.md) with tested parsing and serialization.

The core recording, replay, Doomed, and export features are implemented. Full device verification remains open; the separate online sharing service is outside the plugin MVP.

## Develop and install

Use Node 18 or newer and npm:

```sh
npm install
npm test
npm run lint
npm run build
npm run check:release
```

Requires Obsidian 1.7.2 or newer. For an Obsidian smoke test, use a disposable test vault. Copy `main.js`, `manifest.json`, and `styles.css` into `<Vault>/.obsidian/plugins/replay/`, reload Obsidian, and enable Replay in **Settings → Community plugins**. `npm run dev` rebuilds on source changes.

## Record a note

1. Open a Markdown note in editing mode.
2. Select **Start recording** in the recording bar above the note, or run **Replay: Start recording** from the command palette. The ribbon and current-note file menu also provide recording actions.
3. Write and revise. The bar displays **Recording**.
4. Select **Stop recording**. **Saving recording** changes to **Recording stopped** after the accepted steps are saved.
5. Select **Start recording** again to continue the same recording.

Starting includes the entire current editor document, even if no edits follow. If the document changed while stopped, resuming adds one direct transition to its current text; it does not infer the missing edits. Recording never starts automatically after a plugin or app restart.

Switching notes flushes pending writes without stopping their recording sessions. Each explicitly recording note keeps its own sequence. A save or capture error closes the affected note's capture gate and shows a notice; select **Retry save** / **Stop recording** to save accepted steps, then start again. Invalid saved history is preserved rather than replaced.

## Watch a recording

After Stop finishes, select **Open replay** in the note's recording bar or file menu, or run **Replay: Open recording history**. A dedicated Replay tab opens paused at step 0 and shows the exact recorded Markdown as read-only text.

- Select **Play** / **Pause**, **Previous step**, or **Next step** to explore the writing.
- Drag the **Timeline** or use its arrow keys to select a step. Manual navigation pauses playback.
- Choose 0.5×, 1×, 2×, or 4×. At 1×, playback advances 4 recorded edits per second. A paste or resumed-document replacement counts as one step; pauses between writing sessions take no time.
- Toggle **Doomed** to highlight historical letters that differ from the final recorded text. It works while playing or navigating and does not change the text or playback state.
- At the endpoint, select an earlier step to play again. An initial-only recording displays step 0 with no movement available.
- Select **Return to note** to focus the live note. Starting recording there cancels that note's replay before capture begins. After the next successful Stop, open replay again to load its updated endpoint.

Playback never replaces the live note or adds recorded edits. Changes made while recording is stopped do not change the replay's endpoint. Closing the Replay tab or unloading the plugin cancels playback and pending timeline work.

## Doomed highlighting

Doomed compares two recorded states: the selected step and the last saved step. It highlights deleted/replaced portions of the selected text in yellow, leaves unchanged spans clear, and never adds text from the final state. At the endpoint, or whenever those two strings are identical, nothing is highlighted. Moved and retyped text follows the same character comparison; it does not track character survival through edits.

Unrecorded live edits do not change the comparison target. After Resume and Stop, reopening history uses the new ending for every earlier step. Doomed starts off for each newly loaded replay and retains its setting while navigating that player.

Very large or extensively changed comparisons may show **Doomed comparison is unavailable for this step** with plain historical text. Playback and navigation remain available. See the [comparison rules and limits](docs/RECORDING_FORMAT.md#playback-and-doomed) for deterministic alignment, Unicode granularity, and the implementation limits.

## Export a recording

1. Stop recording and wait until it is saved.
2. Select **Export recording** in the note's recording bar/file menu, in Replay, or run **Replay: Export recording**.
3. Review the source note and stopped endpoint. **Destination** defaults to `<note-folder>/<note-name>.replay.json`; choose a filename in an existing vault folder. The suffix must be `.replay.json`. Configuration, plugin, trash, absolute, and traversal paths are rejected.
4. Select **Export**. Success shows the actual saved path and endpoint after the file has been read back and verified. Existing files are never deliberately replaced; choose another name if the destination exists.

Export includes the complete starting document and every recorded edit/resume transition, including deleted and superseded writing. It always exports the saved endpoint, regardless of the selected timeline step or Doomed setting. Opening export pauses that note's playback and retains the selected step. Unrecorded live edits are not substituted for saved history.

The file is ordinary readable JSON: no compression, Base64 payload, vault access, or extra files are needed to reconstruct it. You can share that file through your usual file tools. Export itself does not upload anything; the planned online recipient player remains a separate project. See the [portable format](docs/RECORDING_FORMAT.md).

Cancel before saving creates no file. If the source changes before file creation begins, close the dialog, Stop/save, and reopen export. Once creation starts, closing the dialog cannot cancel that write; the captured stopped revision can still finish. If verification fails, a file may exist: inspect it or choose a new destination. The plugin never removes or overwrites it automatically to retry.

## Local data

Recordings are stored under the plugin directory's `recordings/` folder, using the vault's configured configuration directory. They include the initial document and deleted or superseded writing. Start/Stop controls determine what is captured; editing while stopped leaves the recording unchanged.

Writes are buffered: 500 ms idle, at most 2 seconds during continuous typing, or 50 pending steps. Stop confirms a successful save. Unload attempts a final save, but an abrupt process termination can lose the unflushed tail. Earlier complete records are validated and preserved.

Replay uses no network requests, telemetry, uploads, cloud accounts, or Node/Electron filesystem APIs. See [local storage and verification](docs/STORAGE.md) for the internal layout, retry behavior, and manual checks still needed.

## Release checks

Version metadata is aligned at `0.1.0` with Obsidian `1.7.2` as the declared minimum. After a production build, run `npm run check:release`; use `npm run check:release -- --tag 0.1.0` to validate an intended exact tag. CI runs tests, lint, build, and these checks before creating release assets. Required assets are `main.js`, `manifest.json`, and `styles.css`; generated bundles stay out of source control.

Review the remaining desktop/mobile/minimum-version checks in [PLAN.md](docs/PLAN.md) before treating the plugin as release-ready. A deliberate version change must align package, lockfile, manifest, and version map. The version helper stages nothing itself; `npm version` can still create Git commits/tags through npm's own behavior. Tag pushes, release publication, and catalog submission are separate actions and have not been performed.
