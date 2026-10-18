---
description: Record, replay, and share how your Obsidian notes change as you write.
---

# Obsidian Replay

Replay records changes to an Obsidian note so you can watch and share the writing process. It is inspired by Stypi. The [project definition](PROJECT.md) describes the product, and the [implementation plan](docs/PLAN.md) tracks progress and verification.

## Explore the features

- Start and stop recording for each note, and continue the same recording across sessions.
- Open the `.replay` file beside a recorded note to play, pause, step through changes, and adjust playback speed.
- Read formatted Markdown with native headings, lists, tables, and callouts.
- Enable **Doomed** to highlight text that differs from the final recorded version.
- Share a recording by copying its `.replay` file to another vault with Replay enabled.
- Work locally without accounts, uploads, telemetry, or external services.

The visible `.replay` file contains the recording used for playback. A separate local log stores changes during recording. Stop recording before sharing the file to include the latest changes.

## Build and install Replay

Replay requires Obsidian 1.7.2 or newer. Use a separate test vault during development. Desktop verification is recorded in the [implementation plan](docs/PLAN.md); mobile and minimum-version device checks remain incomplete.

### Desktop

Use Node.js 18 or newer and npm to build the plugin:

```sh
npm install
npm test
npm run lint
npm run build
npm run check:release
```

1. Copy `main.js`, `manifest.json`, and `styles.css` into `<Vault>/.obsidian/plugins/replay/`.
2. Reload the Obsidian application.
3. Open **Settings → Community plugins** and enable **Replay**.

If your vault uses a different configuration folder, replace `.obsidian` in that path.

For ongoing development, you can create symbolic links for the three plugin files. Keep the `replay` folder in the vault so its `recordings/` folder stays local to that vault. Use `npm run dev` to rebuild when source files change, then reload the plugin or application to load the updated code.

### Mobile

Build the plugin on a desktop computer, then use your device's file tools to copy the same three files into the vault's plugin folder. Reopen the Obsidian app and enable **Replay** in **Settings → Community plugins**. The mobile app does not need Node.js or npm.

## Record a note

Replay records the complete initial note, then captures changes while recording is active. When you stop, it saves those changes and updates the `.replay` file beside the note. Starting again continues the same history. Changes made while stopped become one step when recording resumes; their intermediate edits cannot be recovered.

**Recordings include deleted and replaced text.** Stop recording before copying or sharing a `.replay` file to include the latest session. While recording is active, the file retains its previous saved state and its player is disabled.

### Desktop

1. Open a note in editing view.
2. Press `Command+Shift+R` (macOS) or `Ctrl+Shift+R` (Windows and Linux) to start recording. You can also select the recording button in the ribbon or perform **Replay: Toggle recording** from the command palette.
3. Write and revise the note. The ribbon button's tooltip shows the recording status.
4. Press the same keyboard shortcut or select the ribbon button again to stop. Wait for **Recording stopped** before sharing the recording.

To open the command palette, press `Command+P` (macOS) or `Ctrl+P` (Windows and Linux). The note's file menu also provides **Start recording** and **Stop recording or retry saving**.

### Mobile

1. Open a note in editing view.
2. Open the ribbon menu and select **Command palette**. If the keyboard hides the navigation bar, select **Toggle keyboard** in the editing toolbar, then **Open menu**.
3. Search for and select **Replay: Toggle recording** to start.
4. Edit the note, then perform **Replay: Toggle recording** again to stop before sharing the recording.

For navigation details, see Obsidian's [mobile app guide](https://obsidian.md/help/mobile). These instructions describe the available controls; Replay's mobile recording workflow has not yet been verified on a device.

## Change the recording keyboard shortcut

The same keyboard shortcut starts recording, stops it, or retries saving after an error. Its default uses two modifier keys: `Command+Shift+R` (macOS) or `Ctrl+Shift+R` (Windows and Linux).

1. Open **Settings → Hotkeys**.
2. Search for **Replay: Toggle recording**.
3. Select the plus button to add a keyboard shortcut. To remove one, select its cross button. Obsidian reports conflicts with other assigned commands.

Existing **Start recording** and **Stop recording or retry saving** commands keep any keyboard shortcuts you assigned to them. They have no separate default shortcuts. Other plugins or your operating system may use the same keys.

## Retry a failed save

A save error pauses recording and preserves saved history. Resolve the reported problem, then use the recording keyboard shortcut or ribbon button to retry saving. Do not start a new recording to recover the pending save.

Opening another note saves pending changes without stopping recording. Recording never starts automatically after you reopen Obsidian.

## Watch and share a recording

1. Select the `.replay` file in **Files**. For example, `Essays/Article.md` has a recording named `Essays/Article.replay`.
2. Select **Play**, **Pause**, **Previous step**, or **Next step**, or drag the timeline. At the end, **Restart** returns to the beginning, paused.
3. Select a playback speed: 0.5×, 1×, 2×, 3×, or 4×. The speed is shared across replay tabs and saved for future sessions.
4. Enable **Doomed** to highlight differences from the final recorded version.
5. Copy or share the `.replay` file using your file tools. The recipient needs Replay enabled in Obsidian, but does not need the source note or local recording log.

These playback controls work the same way on desktop and mobile. With a keyboard, press `Space` to play, pause, or restart. Press `Left Arrow` or `Right Arrow` to move one step. Moving through the recording manually pauses playback.

At 1×, playback advances one recorded edit every 150 ms, matching the [13 Sentences demo](https://byronm.com/13sentences.html). Original typing pauses take no playback time.

The preview uses Obsidian's Reading view styling. You can scroll, select, and copy text, but cannot edit it or change task checkboxes. Internal links open separately, using the recording file's folder as context. Open the note's tab to write; playback never changes the live note.

Recorded HTML, images, embeds, named code blocks, and inline plugin expressions appear as source text with a brief explanation. This check happens before rendering to prevent those constructs from loading resources or running code-block processors through Replay. Unnamed code blocks render normally. If the Markdown preview fails, the source text remains available for playback.

Ordinary Markdown uses Obsidian's installed rendering pipeline. Other plugins can affect the result. Attachments and linked notes are not included in the recording.

There is no separate export dialog. **Replay: Open recording file** opens the companion recording, and **Replay: Refresh recording file** updates it from stopped local history. Shared files are available for playback only. Hosted sharing, uploads, video export, and a standalone browser viewer are not implemented.

## Use Doomed highlights

Doomed compares the selected step with the final recorded step. In the formatted preview, it compares visible text and uses native highlight marks. Headings, emphasis, links, and authored highlights stay intact. Changes only to hidden Markdown syntax or link destinations do not highlight unchanged words.

It highlights text that is deleted or replaced in the final version, and never adds final-only text to an earlier step. At the final step, nothing is highlighted. The comparison does not track whether text was moved, deleted, or retyped between steps. When the preview uses source text, Doomed compares that source instead.

The highlight color defaults to `#ffea00`. In **Settings → Replay → Doomed highlight color**, select a color or enter a six-digit hex value. Select **Reset to default** to restore yellow. Changes apply immediately to open recordings and are saved for future sessions. Text uses black or white for contrast. Authored Markdown highlights keep their theme styling.

Edits made while recording is stopped do not change the comparison. After you resume and stop again, the new final step becomes the comparison target. Your Doomed on/off choice is shared across replay tabs and saved for other files and future Obsidian sessions, like playback speed. It defaults to off when no choice has been saved.

Large comparisons may show **Doomed comparison is unavailable for this step**. Playback and navigation remain available. See the [comparison rules and limits](docs/RECORDING_FORMAT.md#playback-and-doomed) for details.

## Manage recording files

Replay updates only files it created and whose contents have not changed externally. If another file occupies the destination, move or rename that file, then retry saving or perform **Replay: Refresh recording file**. Replay never replaces an unrelated or imported recording.

Renaming or moving a source note also moves its managed recording when the destination is free. Moving a `.replay` file independently keeps that copy available for playback; the next recording session can create a new companion. Deleting the source note leaves its recording intact. Deleting a recording preserves the local log; starting, stopping, or refreshing can recreate the file.

Existing local recordings are migrated after the vault opens, without discarding their data. Older `.replay.json` files are preserved. Copy or rename one to `.replay` to open it, using an unused destination. The JSON format remains version 1.

## Understand local storage

Recordings are stored in the plugin's `recordings/` folder, inside the vault's configuration folder. They include the initial note and deleted or replaced text. Editing while recording is stopped leaves the recording unchanged.

Writes are buffered until 500 ms after typing stops, after 2 seconds of continuous typing, or after 50 pending steps. Stopping recording confirms a successful save. Closing the plugin attempts a final save, but an abrupt application shutdown can lose changes that have not been saved yet. Earlier complete records are validated and preserved.

Replay makes no network requests and uses no telemetry, uploads, cloud accounts, or Node.js/Electron file system APIs. See [local storage and verification](docs/STORAGE.md) for the layout, retry behavior, and remaining device checks.

## Prepare a release

Version metadata is aligned at `0.1.0`, with Obsidian `1.7.2` as the declared minimum. After a production build, run `npm run check:release`. Use `npm run check:release -- --tag 0.1.0` to validate an intended tag. CI runs tests, lint, build, and release checks. Required assets are `main.js`, `manifest.json`, and `styles.css`; generated bundles stay out of source control.

Review the remaining desktop, mobile, and minimum-version checks in the [implementation plan](docs/PLAN.md) before releasing. A version change must align the package, lockfile, manifest, and version map. The version helper does not stage files, but `npm version` can create Git commits and tags. Tag pushes, release publication, and catalog submission are separate actions and have not been performed.
