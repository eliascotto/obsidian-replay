# Replay

Replay records the writing process in an Obsidian Markdown note so it can be watched and exported for sharing, inspired by Stypi. The agreed product behavior is in [PROJECT.md](PROJECT.md); implementation progress is in [PLAN.md](docs/PLAN.md).

## Current implementation

- Explicit per-note recording with Start, Stop, and continuation across sessions.
- A visible `<note-name>.replay` file automatically created beside each recorded note.
- Native file tabs: select a `.replay` file in **Files** to play, step, seek, change speed, or enable **Doomed** highlighting.
- Self-contained readable JSON: copy the `.replay` file alone into another vault with Replay enabled to watch it.
- Local/offline operation; no uploads, telemetry, accounts, or external services.

The hidden append log keeps capture efficient and durable. The visible `.replay` file is the portable playback snapshot. Stop recording before copying/sharing it to include the latest session. Full device/minimum-version verification remains open; see [PLAN.md](docs/PLAN.md).

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

For ongoing local development, symlink those three files individually to the matching files in this project. Keep the plugin directory itself in the vault so `recordings/` stays local to that vault. After `npm run build` (or a rebuild from `npm run dev`), reload the plugin or Obsidian to load the new code; no copying is needed.

## Record a note

1. Open a Markdown note in editing mode.
2. Select the recording icon in the left ribbon, use the note's file menu, or run **Replay: Start recording** from the command palette (**⌘P** on macOS, **Ctrl+P** on Windows/Linux).
3. Replay captures the complete initial document and creates a sibling `.replay` file. Write and revise normally; the note header shows recording status without extra action buttons.
4. Run **Replay: Stop recording / retry save** or select the ribbon/menu action. Stop saves the log and verifies the updated `.replay` file before showing **Recording stopped**.
5. Start again to continue the same history. Changes made while stopped become one resume transition; their missing intermediate edits cannot be recovered.

**The `.replay` file includes deleted and superseded writing.** It initially contains the starting text and is refreshed after each completed Stop. During recording it retains the last published snapshot, and its locally managed player is disabled. Copy/share it only after Stop finishes.

Default recording shortcuts are **Mod+Alt+Shift+R** for Start and **Mod+Alt+Shift+S** for Stop/retry: **⌘⌥⇧R/S** on macOS or **Ctrl+Alt+Shift+R/S** on Windows/Linux. Change or remove either in **Settings → Hotkeys**, filtered to `Replay`. Existing customized bindings take precedence; check for OS/plugin conflicts in your setup.

A save/publication error pauses capture and preserves the durable history for retry. Resolve the reported error and select Stop/retry; do not start a new recording to recover the pending save. Switching notes flushes capture without implicitly stopping it. Recording never starts automatically after reload.

## Watch and share a recording

Select the `.replay` file in **Files** to open its read-only player with the history icon. For example, `Essays/Article.md` creates `Essays/Article.replay`. Each file opens as a normal Obsidian file tab; multiple recordings can be open independently.

- Select **Play/Pause**, **Previous step**, or **Next step**, or drag the thin timeline. Manual navigation pauses playback; timeline arrow keys move by one step.
- Choose 0.5×, 1×, 2×, 3×, or 4×. At 1× playback advances four edits per second. Original pauses take no playback time.
- Toggle **Doomed** to highlight selected-state text that differs from the file's final recorded text.
- Switch back to the Markdown tab to write. Playback never modifies the live note.
- Copy/share the ordinary `.replay` file using your normal file tools. A recipient with Replay enabled can open it without your source note, hidden recording folder, or vault.

There is no separate export dialog or export/open-replay button. Existing command IDs remain compatible: **Replay: Open recording file** opens the sibling; **Replay: Refresh recording file** repairs/refreshes it from stopped local history. Standalone files are playback-only and are not adopted as editable recording sessions.

Hosted sharing, uploads, video export, and a standalone browser viewer are not implemented.

## Doomed highlighting

Doomed compares two recorded states: the selected step and the last saved step. It highlights deleted/replaced portions of the selected text in yellow, leaves unchanged spans clear, and never adds text from the final state. At the endpoint, or whenever those two strings are identical, nothing is highlighted. Moved and retyped text follows the same character comparison; it does not track character survival through edits.

Unrecorded live edits do not change the comparison target. After Resume and Stop, reopening history uses the new ending for every earlier step. Doomed starts off for each newly loaded replay and retains its setting while navigating that player.

Very large or extensively changed comparisons may show **Doomed comparison is unavailable for this step** with plain historical text. Playback and navigation remain available. See the [comparison rules and limits](docs/RECORDING_FORMAT.md#playback-and-doomed) for deterministic alignment, Unicode granularity, and the implementation limits.

## File updates, migration, and conflicts

Only an unchanged companion owned by that local recording can be updated automatically. Replay preserves unrelated or externally edited `.replay` files and reports a collision; move/rename the conflicting file and retry Stop or **Refresh recording file**. It never silently chooses another filename or overwrites imported history.

Renaming/moving a source note also moves its managed companion when the destination is free. Independently renaming/moving the companion detaches it as a portable snapshot; a later Start/Stop can create the original sibling again. Deleting the source leaves its recording file intact. Deleting a companion preserves the local log; the next explicit Start/Stop/refresh can recreate it.

Existing hidden recordings are migrated after layout readiness in queued batches. Their data is retained. Old `.replay.json` exports are left untouched: copy/rename one to `.replay` to open it, using a free destination. The JSON format remains version 1.

## Local data

Recordings are stored under the plugin directory's `recordings/` folder, using the vault's configured configuration directory. They include the initial document and deleted or superseded writing. Start/Stop controls determine what is captured; editing while stopped leaves the recording unchanged.

Writes are buffered: 500 ms idle, at most 2 seconds during continuous typing, or 50 pending steps. Stop confirms a successful save. Unload attempts a final save, but an abrupt process termination can lose the unflushed tail. Earlier complete records are validated and preserved.

Replay uses no network requests, telemetry, uploads, cloud accounts, or Node/Electron filesystem APIs. See [local storage and verification](docs/STORAGE.md) for the internal layout, retry behavior, and manual checks still needed.

## Release checks

Version metadata is aligned at `0.1.0` with Obsidian `1.7.2` as the declared minimum. After a production build, run `npm run check:release`; use `npm run check:release -- --tag 0.1.0` to validate an intended exact tag. CI runs tests, lint, build, and these checks before creating release assets. Required assets are `main.js`, `manifest.json`, and `styles.css`; generated bundles stay out of source control.

Review the remaining desktop/mobile/minimum-version checks in [PLAN.md](docs/PLAN.md) before treating the plugin as release-ready. A deliberate version change must align package, lockfile, manifest, and version map. The version helper stages nothing itself; `npm version` can still create Git commits/tags through npm's own behavior. Tag pushes, release publication, and catalog submission are separate actions and have not been performed.
