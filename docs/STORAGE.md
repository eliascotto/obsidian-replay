---
description: Describe local recording storage, save recovery, and verification coverage.
---

# Local recordings and verification

## Portable companion files

The current workflow maintains a visible sibling `.replay` file beside each recorded Markdown note. It contains the complete version 1 JSON payload and is the only data source needed by the native player. The buffered append log below remains the capture/durability layer; it is not required to play a copied recording.

`recordings/artifacts.json` is a separate version 1 ownership registry, mapping each local recording ID to source/artifact paths, last-published sequence and SHA-256 fingerprint, active-session recovery flag, pending publication fingerprint, and any pending folder/file relocation intent. It contains no duplicate document payload. A file's basename or valid JSON alone never grants ownership.

First Start publishes the initial snapshot while capture continues buffering. Stop flushes accepted steps, publishes the entire portable recording through the Vault API, verifies readback and reconstruction, and only then reports completion. Unchanged Resume does not rewrite the artifact. Periodic capture flushes append only to the journal. Publication errors retain the log and a retryable Stop state; a persisted write intent reconciles uncertain create/replace outcomes after restart.

Automatic replacement checks the full previous fingerprint and compares the checked bytes again in `Vault.process`. Unowned/external changes are preserved. Source renames/moves relocate owned companions without replacement; independent artifact moves detach their portable snapshots. Source deletion leaves portable files intact. Deleting an artifact does not immediately recreate it; the next explicit Start/Stop/refresh may do so.

After layout readiness, migration reads the existing note index and processes one recording at a time with a pause between files. Already published, inactive records need no journal read. Active/pending records recover from durable history. Existing legacy logs and `.replay.json` exports are preserved. Prior desktop/export results later in this document describe the old dialog workflow; the new file workflow has its own verification record in PLAN.md.

The portable contract remains [RECORDING_FORMAT.md](RECORDING_FORMAT.md). Internal storage is separate so editor changes can be appended without rewriting a complete exported recording after each batch.

## Layout

The root is `<plugin-directory>/recordings/`. Resolve the plugin folder from the manifest, or from the vault's configured configuration folder and the stable plugin ID. No note identifiers are inserted into Markdown.

| File | Content |
| --- | --- |
| `index.json` | `{ storageVersion: 1, notes: { "path/to/note.md": "recording-id" } }` |
| `<id>/initial.json` | A version 1 portable recording containing `initialText` and an empty `steps` array. |
| `<id>/steps.ndjson` | Consecutive version 1 `RecordingStep` objects, one JSON object per newline. An empty file is valid. |
| `<id>/metadata.json` | `{ storageVersion: 1, id, currentPath, lastSequence }`; sequence/path values are derived metadata. |

IDs contain only letters, digits, underscores, and hyphens. The index cannot associate the same ID with multiple notes. The internal `storageVersion` is distinct from the portable `formatVersion`.

The index is published after initial data, the empty stream, and metadata are created. A failed creation can retry the same in-memory identity; an existing published recording is loaded and validated, never reinitialized. Unindexed partial creation folders are not presented as completed recordings. General orphan recovery and schema migrations remain outside the MVP.

## Reads, writes, and retry

Only the small index is needed to show that a stopped recording exists. Histories are loaded when recording or a stopped snapshot is requested. Stopped sessions release the store's history cache. Capture converts text only while the file's recording gate is open.

Loaded histories are reconstructed and validated through the milestone 1 engine. Consecutive sequences and text/range consistency are mandatory. Complete malformed records, missing required files, bad identities, and unsupported versions produce errors. Metadata may trail the step stream; the validated stream determines the actual endpoint.

An unterminated last line is an interrupted tail. Readers retain earlier complete records; the writer atomically replaces the stream with its complete valid prefix before appending again. A complete malformed line cannot be silently skipped.

Writes use a serialized store commit gate, with one buffered write queue per active recording. The scheduler flushes after 500 ms idle, 2 seconds maximum waiting during continuous input, or 50 pending steps, and on Stop or note switching. The maximum timer is not postponed by further keystrokes. Explicit flushes join in-flight work and drain newly queued steps before reporting completion.

The Obsidian adapter uses its atomic `process` operation to replace existing small files and a staged temporary file plus rename for creation. Append success is acknowledged before updating derived metadata. Adapter failures do not remove the last valid copy intentionally.

A rejected append has an uncertain outcome. Retry reloads the file, compares complete stored steps with pending sequences, repairs an incomplete tail, and appends only missing records. A metadata failure after a successful append does not duplicate that append. Conflicting stored/queued records remain errors. Failed batches remain in memory for retry; a failure closes capture rather than growing an unbounded queue.

File/folder renames remap index paths on folder boundaries while retaining IDs. Pending rename operations are retried before new lifecycle operations complete. No external editing, sync reconciliation, or cross-device identity merging is attempted.

## Recording boundaries

Start snapshots the live CodeMirror document and opens the capture gate synchronously, before awaiting storage. Observed transactions are validated and buffered while initialization loads. For Resume, the stored endpoint is compared with that original Start snapshot, followed by the buffered edits. Stop closes the gate immediately and reports Stopped only after accepted steps have been saved.

CodeMirror snapshots use its internal document string and coordinate system. For example, a document loaded from CRLF text is represented with LF line boundaries in the editor model; offsets and inserted/deleted text use that same representation. The format preserves those captured strings exactly rather than promising a byte-for-byte recording of the source file on disk.

Repeated Start does not create another recording. Start while a save/error remains unresolved is rejected; retry Stop first. All saved recordings reload as stopped. Disposal closes gates, cancels timers, and attempts a final flush without relying on Obsidian awaiting unload promises.

## Stopped replay snapshots

A stopped snapshot carries its stable recording ID, source note path, and an in-memory lifecycle revision. Start/Resume invalidates the revision synchronously before capture opens. The loader checks stopped readiness and the revision again after asynchronous storage work, so an old load cannot become playable after a complete Start/Stop cycle. File/folder rename invalidates old paths and rebinds replay by recording identity. These tokens are local runtime state and do not change the portable format.

The replay model owns an immutable validated copy of the recording. It reconstructs and navigates in memory, without writing the live editor or appending history. One cancelable playback timer advances at a steady rate; a separate cancelable 16 ms seek schedule coalesces timeline input. Closing, rebinding, resuming, and unloading cancel both. The view renders Markdown through Obsidian's renderer, with a source-text fallback. See the [playback and Doomed reference](RECORDING_FORMAT.md#playback-and-doomed) for rendering and comparison rules.

## Verification status

Automated suites exercise real CodeMirror transactions, independent controller sessions, a deterministic scheduler, and an in-memory adapter with failures before and after writes take effect. They cover delayed Start/Stop, resumed document transitions, duplicate pane updates, note switching/flush, rename races, partial appends, metadata lag, corrupt data, restart, and portable serialization. The replay suites also cover navigation, all rates, coalesced/committed seeks, stale callbacks, same-file recording exclusion, delayed loads interleaved with Start/Stop/rename/close, immutable history, and safe text rendering. Milestone 3 passed 151 tests, lint, and the production build; milestone 4 passed 186 tests with Doomed comparison/presentation/rendering coverage. Milestone 5 expands the passing suite to 225 tests, including export portability/failures/races and release metadata/artifact checks. These are automated integration tests, not real-device tests.

Desktop smoke test on 2026-10-17: passed in a disposable vault using Obsidian 1.13.7 on macOS. Start captured the initial text; a multiline HTML-like/emoji paste became one edit. Stop enabled replay from the bar, command palette, and file menu. Initial, intermediate, and final text, forward/backward steps, 1× playback, native slider navigation, and selecting 0.5× were checked. A paste into history made no edit, and Return to note preserved the live text. Editing while stopped and resuming produced exactly `edit, resume, edit` in the stored stream. Reload restored stopped capture and paused replay at step 0. Resume invalidated the historical controls; Stop/reopen loaded the saved history again. Tab focus, deferred-note reuse, and hidden recording controls were corrected and rechecked in the updated build.

The full desktop matrix, all-rate/pause/drag combinations, undo-state comparison, multi-note/rename/popout/source-mode cases, playing-state Start, minimum-version (1.7.2), and mobile verification remain open. Before treating milestone 2 as manually verified, use a disposable vault and check:

- [ ] Existing-note Start, typing, paste, selection replacement, multi-cursor edits, undo, redo, and Stop produce the exact editor states in the saved recording.
- [ ] Start followed immediately by Stop preserves the initial state; rapid controls show the correct recording/saving state.
- [ ] Stopped edits are not captured; Resume adds exactly one transition and retains the original initial text and earlier steps.
- [ ] Two files record independently; switching notes flushes without implicit Stop; mirrored updates from two panes are not duplicated.
- [ ] File and folder renames/moves retain identity, including while a save is pending.
- [ ] Disable/re-enable and restart retain valid history, restart stopped, and do not multiply controls/listeners/timers.
- [ ] The recording bar and controls remain visible and usable on desktop and mobile in source/live preview modes and after note switches.

Read-only playback and timeline controls are implemented in milestone 3; the remaining device checklist stays open in [PLAN.md](PLAN.md). Doomed rendering is implemented in milestone 4 with its own desktop smoke test; export is implemented in milestone 5 with create-new/readback verification. Doomed compares in memory and writes no history or format fields. Before release, verify the complete recording/replay journey on desktop and mobile; automated suites alone do not establish UI integration.

## Historical export verification

The following results describe the earlier export dialog. The current workflow creates and updates `.replay` files automatically; see the [implementation plan](PLAN.md#6-native-replay-files-and-simpler-recording-controls).

Exports are separate new vault files, not copies of the internal recording folder. Preparation uses the same stopped-snapshot revision boundary as replay. Destination checks and this plugin's serialized create-new operations precede verification of the exact saved JSON; errors never remove/replace the source or a possibly created destination. No export metadata or highlight spans are written into the internal history.

Desktop export smoke test (2026-10-17, macOS, Obsidian 1.13.7): all four entry points opened the source-bound dialog. Cancel created no file; traversal disabled Export; a repeated destination reported a collision. Exporting a playing, Doomed-enabled history paused it at step 14 while saving the full endpoint at step 15. In an isolated folder, a consumer supplied only the saved JSON reconstructed all 16 states, reversed all 15 steps, and computed Doomed for each state. Hashes confirmed the live note and internal recording files were unchanged. The polished build also exported an empty, initial-only recording with zero steps through keyboard submission after a reload. Mobile, minimum-version, and the extended device matrix remain unverified.
