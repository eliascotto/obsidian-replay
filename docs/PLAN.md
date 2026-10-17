# Replay: MVP implementation plan

[PROJECT.md](../PROJECT.md) defines the product and takes precedence over this plan. This document is the single implementation plan. The `.replay` file workflow agreed on 2026-10-17 is implemented in milestone 6. Milestones 1–5 retain their completed checklists as implementation history; their manual export dialog and note-backed replay entry points are superseded by milestone 6. Milestone 6 records the new implementation and its remaining device checks.

## Current state and delivery target

Milestones 1–5 have implemented code and passing automated checks: the portable format/engine, explicit recording controls, editor capture, local persistence, read-only timeline/playback, Doomed highlighting, portable export, and release metadata/artifact gates. Desktop smoke tests and isolated export verification passed; the full desktop/mobile/minimum-version matrix remains open. The MVP is not yet fully verified or release-ready.

The current workflow is: open a Markdown note → Start recording → create its sibling `.replay` file → write → Stop and verify the updated file → select that file in Files to play/explore it → copy/share the file directly. Resume continues the same recording and updates the same managed file.

The MVP must provide:

- One recording per file, continued by subsequent start/stop cycles.
- Exact reconstruction from the complete starting text and ordered recorded steps.
- Persistence across restarts, with recording stopped on a fresh plugin load.
- A single transition to the current document when resuming after unrecorded changes.
- Read-only replay with play/pause, adjustable steady edit rate, previous/next, a timeline, and Doomed.
- Replay controls available only while that file's recording is stopped.
- One automatically maintained, visible sibling `.replay` file, containing the existing readable, uncompressed JSON format.
- Playback from that file alone, including when copied to another vault without the original note or internal log.
- No record/open-replay/export actions in the note header and no export action in the player.
- Two configurable Start/Stop shortcuts, alongside the ribbon, note menu, and palette.

The online sharing/playback service is a separate project. Opening a portable `.replay` file inside Obsidian is now required. Adopting imported history for further recording, upload integration, and a standalone browser player remain outside scope.

## Architecture

Keep `src/main.ts` focused on lifecycle, view registration, and command registration. Split feature logic into focused modules:

```text
src/
  main.ts
  recording/
    types.ts
    errors.ts
    engine.ts
    validation.ts
    format.ts
    controller.ts
    session.ts
  capture/
    transaction.ts
    editor-extension.ts
  storage/
    types.ts
    obsidian-adapter.ts
    recording-store.ts
    write-queue.ts
  replay/
    types.ts
    controller.ts
    coordinator.ts
    doomed.ts
  artifacts/             # Milestone 6; replaces the export UI workflow.
    paths.ts
    registry.ts
    publisher.ts
    obsidian-adapter.ts
    recording-artifact.ts
  ui/
    recording-controls.ts
    replay-view.ts
  commands/
    register-commands.ts
```

The reconstruction engine, format validation, Doomed comparison, and export serialization must work without Obsidian UI objects. Storage uses a small adapter boundary so failure and restart scenarios can be tested independently. The recording controller owns state transitions; views and commands call it rather than implementing their own recording rules.

Use npm, TypeScript strict mode, and esbuild. Add only the direct CodeMirror dependencies needed for capture and the selected read-only viewer. Bundle any additional runtime dependency; keep it small and browser-compatible. Remove sample commands, notices, timers, and settings as the real lifecycle is wired in.

## Recording model and portable format

### Ordered steps

- Step `0` is the complete editor text captured on the first explicit Start, including when the user makes no edits afterward.
- Each document-changing CodeMirror transaction during recording is one edit step. Preserve multiple changes within the transaction as one step.
- A resume after unrecorded changes adds one resume step, represented as a whole-document replacement. If the current text is unchanged, add no step.
- Sequences begin at `1` and are consecutive. They determine ordering and timeline positions.
- Preserve the exact captured text, with UTF-16 offsets matching the editor. Do not normalize whitespace or Unicode.
- Timestamps may be metadata. They never determine playback delays or timeline spacing.
- The final state is reconstructed from step `0` through the last valid step. Doomed compares against that endpoint only while stopped.

### Version 1 data shape

Use a single JSON document. The current implementation names it `<note-name>.replay`; existing `.replay.json` files retain the same version 1 payload and remain legacy artifacts:

```ts
interface RecordingFile {
  format: 'obsidian-replay';
  formatVersion: 1;
  initialText: string;
  steps: RecordingStep[];
}

interface RecordingStep {
  sequence: number;
  kind: 'edit' | 'resume';
  changes: TextChange[];
}

interface TextChange {
  fromBefore: number;
  toBefore: number;
  fromAfter: number;
  toAfter: number;
  deletedText: string;
  insertedText: string;
}
```

Before offsets refer to the complete pre-step document; after offsets refer to the complete post-step document. A resume contains one replacement of the full previous recorded text with the current live text. No synthetic intermediate typing is generated.

The implemented version 1 contract is documented with tested examples in [RECORDING_FORMAT.md](RECORDING_FORMAT.md). It explains field meanings, offset units, validation, resume semantics, step order, and playback/Doomed rules so an independent future service can consume exports.

Export contains ordinary readable JSON text with normal JSON escaping. No Base64 payloads, binary packaging, compression, external resources, vault access, or Obsidian runtime objects are required to reconstruct it. The initial text and steps provide everything needed for playback and Doomed; no character-provenance data is needed.

## Recording lifecycle and capture

Preserve stable local command IDs `start-recording`, `stop-recording`, `open-history`, and `export-recording`. Obsidian prefixes them with the plugin ID. Milestone 6 removes header action buttons, removes the note status bar and retains status in the ribbon icon/tooltip, and adds Start/Stop default shortcut proposals configurable through native **Settings → Hotkeys**. Older open/export command IDs become compatibility routes to the managed file, not a second replay/export implementation.

The controller distinguishes no recording, recording, and stopped. A stopped recording may be viewed paused or playing. Serialize start, stop, replay, and export operations so rapid interactions cannot create duplicate recordings or race a pending write.

**First Start:** leave historical replay, obtain the current live Markdown editor document, create the recording identity and initial text, and activate capture. Initialize capture and buffer any subsequent transactions while storage initialization completes; do not lose edits during an asynchronous write.

**Resume:** leave historical replay and use the current live document, never the displayed historical state. Load and validate the existing recording. Append one resume replacement if its endpoint differs from the current live text, then capture subsequent edits. Preserve the original initial text and all earlier steps.

**Capture:** register an editor extension, resolve the associated Markdown file, and process document-changing transactions only for an explicitly recording file. Capture deleted text from the starting document and inserted text from the changes. Include typing, paste, replacement, multi-cursor edits, undo, redo, and programmatic edits that pass through the editor. No filesystem work occurs inside the transaction listener.

Validate the expected starting text, change ranges, deleted text, and resulting document before accepting an edit. A discrepancy at explicit Resume is handled by the required resume step. A genuinely invalid event or unreadable stored record must not be appended as if valid: stop accepting changes for the affected recording, show a clear error, and preserve its valid data. Do not attempt external-edit reconciliation or infer missing work.

**Stop:** end capture immediately, flush accepted steps, and establish the last recorded state. Milestone 6 also publishes and verifies the complete `.replay` file before reporting success/enabling local replay. Retain unwritten steps or a pending publication for retry and preserve the last valid portable file.

**Restart/unload:** remove listeners and timers, attempt a final flush, and reload saved recordings as stopped. Do not depend on asynchronous unload work completing. Bounded periodic writes provide normal durability; an abrupt process termination may lose the unflushed tail, never silently corrupt earlier valid steps.

Replay never runs while capture is active for the file. Starting again closes or disables its historical view, clears playback timers, and returns to the current live document before capture begins. Switching notes must route changes and controls to the correct file without mixing recordings.

## Local persistence

Use the vault adapter and the configured plugin directory, without hard-coding the vault's configuration-folder name. A possible internal layout is:

```text
<plugin-directory>/recordings/
  index.json
  <recording-id>/
    metadata.json
    initial.json
    steps.ndjson
```

Map a note path to one persistent recording ID. Keep IDs out of Markdown. Preserve the mapping on Obsidian rename/move events so a renamed file continues its existing recording. Deleted-note recovery, orphan reassociation, and cross-device identity reconciliation are outside MVP scope.

Serialize writes per recording and updates to the shared index. Write initial data before accepting a recording as durably created. Use buffered appends for steps: flush after a short idle interval, a maximum elapsed interval during continuous typing, or a batch-size threshold. Initial targets are 500 ms idle, 2 seconds maximum interval, and 50 steps per batch.

Also flush on Stop, when switching away from the note, before replay/export, and best-effort on unload. Do not interpret switching notes as a user-requested Stop. Update metadata only after the relevant step append succeeds. Use temporary-file replacement for small metadata/index updates where supported.

On load, validate format versions, consecutive sequences, ranges, and text while reconstructing. The valid event stream is authoritative if metadata trails a successful append. An incomplete final NDJSON line may be ignored for reading, but remove or isolate that incomplete tail before any subsequent append. A malformed complete record must produce a visible error, not a plausible reconstructed document.

Keep failed batches available for retry. Account for an append that succeeded before a later metadata write failed, so retry does not duplicate sequences. Do not promise lossless capture of buffered steps during a process crash.

## Read-only replay and timing

Use a read-only `FileView` registered for `.replay` (milestone 6), with an independent player per file-backed view. The file is the playback data source; a Markdown note and local recording store are not prerequisites. Preserve same-recording capture exclusion through explicit local ownership mapping. Render source Markdown exactly and never write historical text into the live note.

Expose Play/Pause, playback rate, previous/next step, a slider from `0` to the last sequence, and Doomed. Without a recording, replay is unavailable. While recording, replay and historical navigation are unavailable. Stopping enables them without automatically playing.

Manual navigation pauses playback. Play advances incrementally from the selected step to the endpoint, then stops. Previous/next move exactly one step, including resume replacements. Empty step lists still allow viewing/exporting the initial state; Play cannot advance them.

Use a steady adjustable steps-per-second rate. The current UI uses 150 ms/step at 1× (about 6.67 steps/second), matching the [13 Sentences demo](https://byronm.com/13sentences.html), with 0.5×, 1×, 2×, 3×, and 4× controls. Each step receives the same interval at the chosen rate, including large pastes and resume transitions. Original typing delays, overnight gaps, and stopped intervals add no waiting time.

The slider represents step sequence, not wall-clock time. Avoid stale renders during rapid scrubbing; a small disposable reconstruction cache is allowed. Clear playback timers on pause, navigation, endpoint, resume, view close, unload, and errors. Persistent reconstruction snapshots are outside the MVP.

## Doomed comparison

Compute a deterministic text diff between the displayed historical state and the final stopped state. Highlight deleted/replaced ranges on the historical side, leaving unchanged spans intact. Do not inject text that exists only in the final state.

Use character-level ranges suitable for highlighting words or letters, with consistent alignment for repeated text and safe rendering of Unicode. Select a small browser-compatible diff implementation or a focused local implementation during this milestone. The exact algorithm is an implementation choice; record its behavior in tests.

No edit-provenance or character-survival tracking is needed. Moved and retyped text follows the ordinary two-state comparison. Identical historical and final text produces no highlight even if intervening steps deleted and retyped it.

Doomed is a visual layer and cannot mutate either document. Use a readable theme-compatible highlight inspired by the yellow reference treatment. Toggle it during stopped-recording playback or navigation. Cache against the final sequence and invalidate that cache when recording resumes and establishes a new ending.

## Automatic portable files

Milestone 6 replaces the explicit export flow with an automatically maintained sibling `.replay` file. Retain the version 1 parser/serializer and readback verification; keep buffered append-only capture storage for durability and large recordings. Create the visible initial file on first Start and refresh the complete JSON after Stop, not per edit. File-based playback reads the portable file directly.

Only a locally owned, unchanged artifact may be replaced automatically. Publish through the Vault API, validate/read back the result, preserve the last valid file/history on failures, and make retries idempotent. Ownership, source association, publication revision, and content fingerprint stay in a versioned local registry, not in the portable payload. The detailed sequencing, collision, restart, and migration decisions below are part of the implementation target.

## Ordered milestones

### 1. Format and reconstruction engine

Status: implemented. The portable recording model is tested independently of Obsidian and is ready for capture, storage, replay, and export modules to use. The recording and storage implementation in milestone 2 now uses this foundation.

#### Files and responsibilities

| File | Responsibility |
| --- | --- |
| `docs/RECORDING_FORMAT.md` | Version 1 schema, invariants, examples, and independent playback instructions. |
| `src/recording/types.ts` | Recording, step, and change interfaces; format identifier and version constants. |
| `src/recording/errors.ts` | Structured format, sequence, range, and text-mismatch errors. |
| `src/recording/validation.ts` | Runtime shape validation and coordinate checks on untrusted data. |
| `src/recording/engine.ts` | Pure application, reversal, sequence reconstruction, and resume-step creation. |
| `src/recording/format.ts` | Parse and serialize the portable JSON format with complete recording validation. |
| `tests/recording/` | Engine, format, and generated-sequence tests plus representative fixtures. |
| `package.json`, test configuration, and `eslint.config.mts` | Repeatable test execution, test type checking, and appropriate Node globals for test files. |

All runtime modules in this milestone must be browser-compatible and independent of Obsidian, filesystem access, DOM objects, and timers. A JSON parser is part of format verification; it does not add an import UI to the MVP.

#### Task 1.1 — Specify the format and examples

- [x] Finalize the Version 1 data shape above and document it in `docs/RECORDING_FORMAT.md`.
- [x] Define sequence `0`, consecutive step numbering, UTF-16 offsets, exact text preservation, and transaction-wide before/after coordinates.
- [x] Define a resume as one full-document replacement; unchanged text produces no resume step.
- [x] State that an initial-only recording is valid, the last step defines the endpoint, and original delays have no effect on playback.
- [x] Include readable JSON examples for initial-only, insertion, deletion/replacement, multiple changes in one step, and resume after unrecorded work. Give the expected document after every step.
- [x] Explain how an independent reader reconstructs states and compares any selected state with the final state for Doomed. Neither vault metadata nor character identity is required.

Deliverable: a precise format contract and fixtures that will also be used by the automated tests.

#### Task 1.2 — Set up types, errors, and test execution

- [x] Add the interfaces and constants to `types.ts`, keeping persisted fields separate from future recording-controller state.
- [x] Define typed errors with a stable category and optional step/change location. Messages should identify the failure without embedding entire document contents.
- [x] Add `npm test` using Node's built-in test runner and the existing esbuild tooling to compile TypeScript tests. Keep generated test output in an ignored directory.
- [x] Add a test TypeScript configuration covering the pure recording modules and test files. Include its type check in `npm test`; transpilation alone is insufficient.
- [x] Configure linting for those test files without adding Node globals to browser runtime source files. Add a minimal smoke test to verify the harness.

Deliverable: tests can execute and type-check without loading Obsidian or invoking the plugin entry point.

#### Task 1.3 — Implement validation

- [x] Accept external JSON as `unknown`; validate objects, required fields, string values, arrays, format identifier, supported version, and step kinds before treating it as a recording.
- [x] Require positive safe-integer step sequences and consecutive ordering from `1`. Reject duplicate, missing, fractional, or out-of-order sequences.
- [x] Require safe-integer offsets, ordered ranges, document bounds, and text lengths consistent with each range.
- [x] Require changes in canonical document order with no overlapping ranges. Specify adjacent-change handling; coalesce ambiguous same-position insertions in future capture rather than allowing an unstable application order.
- [x] Check that after coordinates match before coordinates plus cumulative preceding length changes. Valid-looking but inconsistent before/after coordinates must be rejected.
- [x] Require at least one effective change per step. A resume must be exactly one replacement spanning the full prior document and containing that document as its deleted text.
- [x] Validate deleted text against the unchanged pre-step document. During reversal, validate inserted text against the unchanged post-step document.

Deliverable: malformed data fails explicitly before producing a purported historical state. A legitimate resume replacement remains valid even when the new text is completely different.

#### Task 1.4 — Implement the pure engine

Target functions:

```ts
applyStep(state: string, step: RecordingStep): string
reverseStep(state: string, step: RecordingStep): string
getStateAt(recording: RecordingFile, sequence: number): string
createResumeStep(
  previousText: string,
  currentText: string,
  nextSequence: number,
): RecordingStep | null
```

- [x] Apply changes from highest before-offset to lowest, after validating them against the original state. Do not let an earlier splice change the coordinates used by another change.
- [x] Reverse changes from highest after-offset to lowest, restoring their deleted text after validating the post-step state.
- [x] Reconstruct sequence `0` directly from `initialText`; sequence `n` applies steps `1` through `n`. Reject non-integer, negative, and out-of-range selections.
- [x] Return `null` for unchanged Resume; otherwise create a reversible full-document replacement with the supplied sequence number.
- [x] Keep all functions free of mutation to caller-owned recording data and change arrays.
- [x] Validate each required step as it is traversed, avoiding repeated reconstruction of the same prefix inside one operation. Persistent snapshots and reconstruction caches are unnecessary in this milestone.

Deliverable: every fixture state can be reached from the initial state and reversed back to it, including across resume steps.

#### Task 1.5 — Implement the JSON boundary

Target functions:

```ts
parseRecording(json: string): RecordingFile
serializeRecording(recording: RecordingFile): string
```

- [x] Convert JSON syntax errors into the structured format error type.
- [x] Perform shape checks and replay the complete recording to validate sequence order, ranges, text, and resume semantics before accepting a parsed file. Do not silently accept a valid prefix of an invalid export.
- [x] Validate before serialization and produce ordinary readable JSON with deterministic field ordering and a trailing newline.
- [x] Preserve text through JSON escaping and parsing, including quotes, tabs, line endings, and non-Latin characters.
- [x] Verify a serialize/parse round trip preserves all recorded states. The serialized file must be usable without local note IDs, paths, or storage files.

Deliverable: a validated portable artifact boundary that the future export command can call directly.

#### Task 1.6 — Complete verification

- [x] Cover insertion, deletion, and replacement at the beginning, middle, and end; empty and multiline documents; large pastes; emoji, combining characters, and non-Latin text.
- [x] Cover multi-change transactions with length shifts, adjacent changes, and insert/delete combinations. Check reverse reconstruction as well as forward application.
- [x] Cover changed/unchanged Resume, empty-to-nonempty and nonempty-to-empty Resume, and multiple recording periods represented by one sequence.
- [x] Cover malformed JSON, wrong field types, unsupported versions, invalid sequences, overlapping/out-of-bounds ranges, inconsistent after-offsets, and text mismatches.
- [x] Generate deterministic edit sequences from independently constructed before/after strings. Compare every reconstructed state with those reference strings, then reverse all steps back to the initial text. Include the seed in failures.
- [x] Run `npm test`, `npm run lint`, and `npm run build`. Review the documented JSON examples against the actual parser and keep generated output untracked.

Milestone 1 is complete when those checks pass and all fixtures reconstruct exactly in both directions, including after JSON round trips. Report only engine/format completion at this point; capture, persistence, playback, Doomed rendering, and export UI remain later milestones.

Milestone 1 verification originally passed 62 tests, including 1,000 deterministic generated steps, plus lint and the production build. Those regression tests remain in the expanded milestone 2 suite. The template settings tab and its warning were removed by milestone 2.

### 2. Explicit capture and durable recording

Status: code implemented and automated checks passed; a basic desktop journey was checked during milestone 3, with the full device pass still pending. Deliver explicit recording for Markdown notes, saved across restarts and continued through subsequent start/stop cycles. Reuse milestone 1's format and engine; playback, Doomed rendering, and export UI remain later milestones.

#### Files and responsibilities

| File | Responsibility |
| --- | --- |
| `src/recording/controller.ts` | Per-file recording lifecycle, expected text, sequence allocation, Start/Stop/Resume, and readiness for later replay. |
| `src/recording/session.ts` | Session state and synchronous transaction acceptance, split from the controller to keep lifecycle and capture logic focused. |
| `src/capture/transaction.ts` | Convert a CodeMirror transaction into a canonical version 1 edit step, independently of Obsidian. |
| `src/capture/editor-extension.ts` | Bind editor transactions to the correct Obsidian Markdown file and hand them to the controller. |
| `src/storage/types.ts` | Storage adapter, internal index/metadata types, and storage errors distinct from recording-format errors. |
| `src/storage/obsidian-adapter.ts` | Wrap the vault adapter and resolve the configured plugin directory. |
| `src/storage/recording-store.ts` | Create/load recordings, validate NDJSON, and maintain note-to-recording identity. Split parser/index helpers into focused files if needed. |
| `src/storage/write-queue.ts` | Ordered buffered appends, flush triggers, acknowledged sequences, retry, and disposal. |
| `src/ui/recording-controls.ts` | Current-note Start/Stop actions and visible starting/recording/saving/stopped/error state. |
| `src/commands/register-commands.ts` | Stable `start-recording` and `stop-recording` commands and availability checks. |
| `src/main.ts` | Construct services, register the extension/commands/events, and dispose services. Remove the sample lifecycle. |
| `tests/capture/`, `tests/storage/`, `tests/recording/` | Real CodeMirror transaction tests, storage failure tests, and controller lifecycle tests. |
| `scripts/test.mjs`, `tsconfig.test.json`, lint configuration | Discover and type-check the new test suites without loading Obsidian in Node. |

The controller and session use file keys and injected store/scheduler interfaces, not Obsidian UI objects. The transaction converter may depend on CodeMirror state but not a DOM view. Keep Obsidian-specific routing and filesystem adaptation in their bridge modules. No change to the version 1 portable schema is needed.

#### Task 2.1 — Define the lifecycle and service boundaries

- [x] Define per-file states: absent, starting, recording, stopping, stopped, and error. Starting/stopping/error are internal operational states; do not add them to portable recording files.
- [x] Separate capture-enabled state from saving state. Stop disables capture immediately, even if initialization or a flush is still pending. Later replay is permitted only when stopped, valid, and fully saved.
- [x] Define controller operations for Start/Resume, Stop, synchronous transaction acceptance, flushing, loading a stopped recording, rename handling, and disposal. Repeated Start and Stop calls must be idempotent.
- [x] Serialize lifecycle transitions per recording and index commits globally. Do not block synchronous capture on the storage promise chain.
- [x] Track the expected document and next sequence in the session. Use one sequence stream and one pending-write queue per file, regardless of how many editor panes display it.
- [x] Define the public status subscription used by controls and the readiness guard later replay/export will call. Provide a lifecycle hook for leaving historical replay before Start; milestone 2 need not register a placeholder replay view or playback command.
- [x] Extend test discovery beyond the current hard-coded `tests/recording` directory. Use stable relative output paths to avoid bundled filename collisions, and include the new pure runtime modules in test type checking.

Deliverable: testable interfaces and state transitions with no dependency on a running Obsidian app.

#### Task 2.2 — Implement the local recording store

- [x] Resolve the storage root from `manifest.dir`, with a fallback using `vault.configDir`, the plugins directory, and the stable plugin ID. Use the vault adapter, normalized vault-relative paths, and validated recording IDs; do not introduce Node filesystem access into runtime code.
- [x] Finalize and document the internal layout described above: a versioned index maps note paths to recording IDs; `initial.json` stores the recording format/header and initial text; `steps.ndjson` contains version 1 steps, one JSON object per newline; metadata stores ID, current path, and last acknowledged sequence. Keep internal storage versioning distinct from the portable format version.
- [x] Implement a small adapter interface for reads, writes, append, existence/directory checks, and rename/replacement. Supply a deterministic in-memory implementation for tests, including injected failures before and after a write takes effect.
- [x] On first creation, initialize the recording's header, empty step stream, and metadata before publishing the index entry. Reuse the same in-memory creation identity on retry. A partially initialized directory must not be loaded as a complete recording.
- [x] Load the small index lazily or during startup; load/reconstruct individual histories only when needed. Do not scan or read all Markdown notes at startup. A missing index means no recordings; a malformed index must not be silently replaced with an empty one.
- [x] Parse only newline-terminated step records. Compose the initial text and parsed steps into a `RecordingFile`, then validate the complete recording with milestone 1's parser/engine before returning it. Do not expose an apparently complete recording after a malformed complete record.
- [x] Treat the validated step stream as authoritative when metadata trails it. Repair derived metadata on the next successful write. Detect unsupported internal versions, missing required recording files, malformed records, and invalid recording references explicitly.
- [x] Treat an unterminated final record as an interrupted tail. Preserve the complete valid prefix, and remove or isolate the tail before appending again. Test that the next append remains valid NDJSON.
- [x] Serialize shared index changes and replace index/metadata through temporary files where supported. Do not delete the last good copy before a replacement is ready. Handle adapter failure explicitly without claiming cross-platform transactional or power-loss guarantees.

Deliverable: a first recording, including one with zero edit steps, can be saved, reloaded, and reconstructed without the original Markdown file.

#### Task 2.3 — Implement write buffering and safe retry

- [x] Maintain immutable queued steps and a separately tracked acknowledged sequence. An append batch contains consecutive steps and ends with a newline.
- [x] Flush at 500 ms of idle time, after at most 2 seconds during continuous editing, or at 50 queued steps, whichever occurs first. Inject the scheduler/clock so these conditions can be tested without real sleeps.
- [x] Keep the maximum-wait timer tied to the oldest unwritten batch; later keystrokes must not postpone it indefinitely. Serialize concurrent flush requests and keep newly arriving steps separate from the batch being written.
- [x] Flush on Stop, switching away from a note, and an explicit readiness request for later replay/export. Begin best-effort flushing on disposal, while accepting that Obsidian may not await unload promises.
- [x] Acknowledge a batch only after its records are verified persisted. Update derived metadata afterward; a metadata failure must not cause the same batch to be appended again.
- [x] Handle uncertain append results: a rejected append may have written nothing, a complete prefix, the whole batch, or an incomplete tail. Before retry, read and validate the stored suffix, match already-persisted sequences against the queued steps, repair an incomplete tail, and append only missing steps. Conflicting complete records are errors, not overwrite candidates.
- [x] Keep unwritten steps available after failure and surface one actionable error per failure episode. Reissuing Stop/retrying save must use the same recording and queue; it must not create another recording or erase accepted steps.
- [x] Stop capture on a storage failure rather than accumulating accepted steps indefinitely. Keep save failure distinct from recording corruption. Enable a fresh Resume only after pending writes have been resolved and stored data is valid.
- [x] Dispose all timers and prevent late callbacks or completed async operations from re-enabling capture after Stop/unload. Describe the bounded unflushed-tail loss possible during an abrupt process termination.

Deliverable: normal saves are bounded and efficient, and retry cannot duplicate or reorder acknowledged steps.

#### Task 2.4 — Implement editor transaction conversion and routing

- [x] Add direct development dependencies for the used `@codemirror/state` and `@codemirror/view` packages and update the npm lockfile. Retain their host-provided externals in the existing esbuild configuration; do not bundle a second CodeMirror runtime into the plugin.
- [x] Register one lifecycle-managed editor extension. Resolve the transaction's associated Markdown file through the public `editorInfoField`, not the globally active file or private editor properties. Ignore unassociated editors, non-Markdown files, and files whose capture gate is closed.
- [x] Process each document-changing transaction in update order; an update containing several transactions produces several steps. Skip transactions whose starting and ending text are identical, because the version 1 format requires an effective text change.
- [x] Convert `iterChanges` ranges into both before/after coordinate sets; obtain deleted text from the transaction's starting document and inserted text from its inserted `Text`. Keep all changes from the transaction in one step, in canonical order. Coalesce duplicate-start ranges if necessary to meet the established format contract.
- [x] Use a consistent CodeMirror document representation for snapshots, ranges, inserted text, and ending-state comparison. String offsets must match the editor's UTF-16 document coordinates; do not mix disk text or configured CRLF serialization with LF-based document positions. Preserve the exact chosen editor-model strings in the recording.
- [x] Validate a step with `applyStep(expectedText, step)` and require its result to equal the transaction's ending text before allocating it to the write queue. Move the session's expected state forward synchronously.
- [x] Handle multiple panes for the same note without duplicate steps: an already-reflected update whose ending text equals the expected state is ignored. Cover this explicitly in tests. Any other unexpected starting state stops capture with one clear error rather than appending an invalid edit.
- [x] Distinguish editor rebinding/file loading from edits to a recording. Switching files or reopening a recorded note must not create a recording or append a synthetic edit merely because editor content was initialized.
- [x] Do not infer semantic operations, original intent, missing external edits, cursor movements, or selections. No filesystem operations or asynchronous waits belong in the transaction listener.

Deliverable: real CodeMirror transactions reconstruct exactly, with capture isolated to explicitly recording files.

#### Task 2.5 — Implement first Start, Stop, and Resume

- [x] On Start, bind the request to the chosen live Markdown file/editor. Establish a synchronous text snapshot and transaction gate before awaiting creation/loading, then buffer subsequent transaction observations in order. Show Starting while initialization is unresolved.
- [x] For a new file recording, persist that snapshot as step `0`, assign subsequent accepted edits starting at sequence `1`, and publish exactly one recording identity. First Start followed immediately by Stop must still save the initial-only recording.
- [x] For an existing recording, load and validate its endpoint. Use `createResumeStep(lastRecordedText, startSnapshot, nextSequence)` to add exactly one replacement when needed, then accept buffered transactions after that snapshot. Do not compare the endpoint with a later editor snapshot after the buffer has already begun.
- [x] If loading fails or the recording is corrupt, do not overwrite it or replace it with a new recording. Close the capture gate, preserve accepted/buffered data as applicable, and show the error.
- [x] On Stop, close the gate at request time, finalize any previously observed transactions, and flush them. Edits after the Stop request are unrecorded, even if initialization or the flush has not finished. Publish Stopped/readiness only after successful persistence.
- [x] Handle Start/Stop/Start races with a per-file operation generation or equivalent guard. A stale load, failed creation, or delayed flush cannot reopen a closed session, overwrite a new expected state, or create another index entry.
- [x] On Resume after unrecorded work, preserve the original initial text and all earlier steps. An unchanged document adds no resume step. A changed document is one direct transition and is not an inconsistency error.
- [x] Reconstruct using milestone 1's engine when validating loaded recordings and preparing a stopped snapshot for future replay. Do not rebuild the full history on every keystroke.

Deliverable: explicit recording boundaries hold even while storage is slow, and repeated recording periods form one valid recording.

#### Task 2.6 — Wire commands, controls, identity, and cleanup

- [x] Replace the sample `onload` behavior with service construction, extension registration, command registration, and event wiring. Remove demo modal/editor commands, click notices, sample status text, and the placeholder settings tab/data. Do not add a settings tab without actual configuration requirements.
- [x] Register local command IDs `start-recording` and `stop-recording`. Start creates or resumes the file's one recording. Stop ends capture or retries an unresolved save. Availability checks must not perform I/O or mutate state.
- [x] Add an explicit visible Start/Stop control and recording status for the current note, usable on desktop and mobile. A desktop status bar may supplement controls, but cannot be the only state indicator. Update text/icon/state from controller subscriptions, including initialization and save errors.
- [x] Switching notes updates the controls and flushes the previous note without implicitly stopping it. Capture remains per file; each explicitly recording note retains its own session. Returning to a note does not create a new recording period by itself.
- [x] Preserve identity through file and folder renames/moves. Remap path keys and descendants on path boundaries, update metadata/index under serialization, and keep active sessions attached to their recording IDs. A delayed write must not restore an old path or lose another note's index update.
- [x] Register workspace/vault/DOM events with lifecycle helpers. Dispose controller subscriptions, editor hooks, queues, and scheduled work on unload. Reload all saved recordings as stopped; do not restore a persisted active-capture flag.
- [ ] Confirm minimum-version compatibility on an actual supported Obsidian installation; the implementation compiles against the installed 1.12.3 definitions and retains `isDesktopOnly: false`. Milestone 3 raises `minAppVersion` and the version map to 1.7.2 for async `revealLeaf`; that minimum version still needs a device check. No Node/Electron runtime APIs, telemetry, network requests, or automatic uploads.

Deliverable: a user can explicitly operate and understand recording in Obsidian while lifecycle and identity remain consistent.

#### Task 2.7 — Add automated verification

- [x] Run transaction-converter tests against real `EditorState` transactions for typing, paste, replacements, multi-cursor edits, programmatic edits, undo/redo-style changes, multiline text, emoji, combining characters, no-op replacements, and multiple transactions per update. Test route/gate logic through a small injected bridge rather than importing the Obsidian runtime into Node.
- [x] Test controller transitions for first Start without edits, repeated Start/Stop, unchanged Resume, changed Resume, immediate Stop during Start, typing while creation/load is delayed, and delayed completions after disposal. Assert exact initial/intermediate/final text with `getStateAt` and `reverseStep`.
- [x] Test independent files, multiple panes, mirrored duplicate updates, editor rebinding, note switching without implicit Stop, and file/folder renames during pending writes.
- [x] Test every flush trigger with a fake scheduler, including continuous typing, concurrent flush requests, edits arriving during an in-flight append, and timer cancellation.
- [x] Test creation and index failures; no-op, partial, and successful-but-rejected appends; metadata lag; retry without duplicate sequences; incomplete tail repair before continuation; malformed complete records; missing files; unsupported internal versions; and conflicting stored versus queued data.
- [x] Recreate the store and controller from the same fake adapter to simulate restart. Assert recording is stopped, identity is retained, stopped edits are ignored, and Resume adds the required single transition.
- [x] Verify the stopped `RecordingFile` returned by storage round-trips through the existing `serializeRecording`/`parseRecording` functions. This checks future export compatibility without implementing export UI.
- [x] Run all milestone 1 regression tests alongside the new suites, with test type checks, `npm run lint`, and `npm run build`. Keep generated bundles and build artifacts ignored.

Deliverable: repeatable tests prove capture boundaries, persistence, and retry behavior, not merely matching internal method calls.

#### Task 2.8 — Perform the Obsidian manual pass and update status

- [ ] Start with an existing article, record typing/paste/replacement/undo/redo, and Stop. Confirm initial, intermediate, and final states through the stored recording and reconstruction test harness; do not add a temporary playback product UI just for verification.
- [ ] Edit the note while stopped, Resume, edit again, and Stop. Confirm exactly one transition to the resumed document, with earlier steps unchanged. Repeat after restarting Obsidian and confirm no automatic capture.
- [ ] Start and immediately Stop without editing. Verify the initial document is retained. Exercise rapid control actions and confirm the visible state agrees with capture/save state.
- [ ] Record two files independently, switch between them, show one file in two panes, and rename/move a file and a containing folder. Confirm the correct identities, control states, and recorded text after reload.
- [ ] Disable/re-enable the plugin and check that listeners/timers do not multiply. Verify no global click notices, sample editor modifications, or placeholder settings remain.
- [ ] Perform the capture/control pass on desktop and one mobile platform. Record which checks were actually run and any unavailable platform checks; do not describe automated adapter tests as real-device verification.
- [x] Update this plan with the implementation status and observed checks. Describe stopped snapshots/readiness as a foundation for milestone 3, without claiming playback, Doomed rendering, or export UI is complete.

Milestone 2 is complete when capture/persistence tests and required checks pass, and the user can start, stop, change the note while stopped, resume the same recording, stop again, and reload its exact saved history after restarting Obsidian. Unrecorded changes become one resume step. Saving failures remain visible and retryable without losing or duplicating earlier valid records.

Original milestone 2 verification passed 117 tests, lint, and the production build. App-control access initially timed out. The expanded 151-test suite and desktop smoke test are recorded under milestone 3 below; Task 2.8 remains open for the full device checks. [STORAGE.md](STORAGE.md) documents the internal format and manual checklist; the [README](../README.md) describes the available recording controls. Milestone 3 code is now implemented; its device checks remain open.

### 3. Timeline and playback

Status: code implemented, automated checks and a desktop smoke test passed; full device verification pending. A stopped recording now has a read-only historical view, timeline, previous/next controls, and steady-rate playback. Reuse the implemented recording format, engine, storage loader, and scheduler boundary. Doomed rendering is milestone 4; export UI is milestone 5.

Milestone 2's real Obsidian desktop/mobile checks and minimum-version compatibility confirmation remain open. Continue tracking those checks alongside the new replay manual pass; this plan does not mark them complete.

#### Files and responsibilities

| File | Responsibility |
| --- | --- |
| `src/replay/types.ts` | Replay state and supported playback rates. |
| `src/recording/replay-access.ts` | Stopped-snapshot references, in-memory revisions, and file-scoped invalidation events. |
| `src/replay/controller.ts` | Pure selection, stepping, playback scheduling, pause/rate changes, and disposal. |
| `src/replay/coordinator.ts` | Load a stopped snapshot, bind it to a recording identity, guard against stale operations, and coordinate recording exclusion. |
| `src/ui/replay-workspace.ts` | Obsidian leaf creation/reuse, request guards, note navigation, and view ownership/cleanup. |
| `src/ui/replay-text.ts` | Exact text-only rendering boundary for later highlighting. |
| `src/ui/replay-view.ts` | Registered Obsidian `ItemView`, read-only text rendering, playback controls, loading/errors, and view lifecycle. Split control/render helpers if needed to keep files focused. |
| `src/recording/controller.ts` | File-scoped lifecycle revision/readiness checks and synchronous invalidation before capture starts. Preserve existing recording behavior. |
| `src/ui/recording-controls.ts` | Expose Open replay for a stopped recording and retain the existing recording actions. |
| `src/commands/register-commands.ts` | Add the stable local `open-history` command and resolve the correct note context. |
| `src/main.ts` | Register the view and compose recording/replay services and cleanup. Delegate view-opening logic to the coordinator/bridge. |
| `styles.css` | Read-only source text, responsive controls, focus states, and loading/error presentation. |
| `tests/replay/`, `tests/recording/` | Playback/selection tests and integration tests with the existing controller/store, fake scheduler, and adapter. |
| `README.md`, `docs/STORAGE.md`, `docs/PLAN.md` | Document the available replay workflow and actual verification results. |

The replay controller receives immutable recording data and an injected `Scheduler`, and exposes state subscriptions. It must not import Obsidian, access the vault, or reference the live editor. The coordinator uses the recording controller and an injected note-existence boundary so async loading/lifecycle behavior can be tested in Node. Keep the Obsidian workspace and DOM operations in the UI bridge.

#### Task 3.1 — Define replay state and pure navigation

- [x] Define the loaded state: recording reference, selected sequence, reconstructed text, final sequence, playback rate, playing/paused state, and any validation error. Keep loading/unavailable states separate from a valid empty document or initial-only recording.
- [x] Initialize a newly loaded recording paused at sequence `0`. Use the established complete-file validation boundary before presenting external/stored data as a valid replay; retain the final endpoint for later Doomed integration.
- [x] Implement selection, previous, and next using `getStateAt`, `applyStep`, and `reverseStep`. Adjacent navigation should apply/reverse one step; an arbitrary jump can reconstruct the requested prefix. Never mutate the supplied recording or its changes.
- [x] Require safe-integer sequence selections in `0..steps.length`. Invalid selections must not partially update the selected sequence/text. Previous at the beginning and next at the endpoint are disabled/no-ops rather than out-of-range operations.
- [x] Treat a multi-change transaction, a large paste, and a resume replacement as one navigable step each. Both initial and final states must be reachable; an initial-only recording displays step `0` with no available movement.
- [x] Emit sequence/text/control-state updates together after successful reconstruction so controls cannot describe a different document from the one displayed. On reconstruction failure, stop playback and expose an error rather than plausible partial text.
- [x] Start with straightforward reconstruction. If a disposable cache is needed for scrubbing, bound its size and scope it to the loaded recording/revision. Persistent snapshots and storage optimizations remain outside this milestone.

Deliverable: a pure replay model can select every valid state and traverse it in both directions without any filesystem or live-editor writes.

#### Task 3.2 — Make stopped snapshots and recording exclusion race-safe

- [x] Extend the existing `RecordingController.stoppedRecording` boundary: its current check before asynchronous loading is insufficient if Start occurs while a replay load is pending. Associate a stopped snapshot with a stable recording ID and an in-memory lifecycle revision/readiness token.
- [x] Invalidate that file's replay token synchronously on a Start/Resume request, before opening the capture gate. A token must remain invalid even if recording starts and stops again before an earlier load finishes. Keep revision bookkeeping out of the portable format.
- [x] Replace or extend the current no-argument `beforeStart` hook with file-scoped replay invalidation. Invalidation synchronously pauses the affected player, cancels queued seeks/ticks, and disables historical navigation. Workspace leaf detachment may finish later; capture must never wait on or use historical text.
- [x] Recheck recording readiness and the lifecycle token after every awaited load and before attaching/activating the replay. Starting, recording, stopping, and unresolved-error states cannot acquire or use a playable stopped snapshot.
- [x] Opening replay must not automatically Stop recording or dismiss a save error. Finish Stop/retry through the existing controls first. Once Stop succeeds, a fresh open loads the new endpoint without automatically playing.
- [x] Scope invalidation to the target file/recording. Recording a different note must not invalidate an unrelated stopped recording's view. Follow file/folder renames by stable recording identity and update displayed paths without binding the player to another note's history.
- [x] Add a coordinator-level request generation so a slow Open A cannot replace a later Open B, a closed view, or a restored/rebound view. Ignore stale completions without showing errors for the newly selected recording.

Deliverable: recording and historical exploration are mutually exclusive for the same file, enforced by lifecycle state and operation tokens rather than button availability alone.

#### Task 3.3 — Implement steady-rate playback

- [x] Implement Play/Pause with one outstanding timer per player. Play starts from the selected sequence, waits one interval, applies the next step, and stops exactly at the endpoint. Repeated Play cannot create additional timer loops.
- [x] Use a base interval of 150 ms/step at 1×, with supported multipliers 0.5×, 1×, 2×, 3×, and 4×. Put those constants in one shared place for the controller and UI. Validate rates as supported finite positive values.
- [x] Give every step the same interval at the chosen rate, including full-document resume transitions. Ignore original timestamps and inactivity; do not add a real-time mode, idle threshold, or overnight gaps.
- [x] When the rate changes during playback, cancel the existing timer and schedule the next step using the new interval from the current selection. Changing rate must not itself advance the document or create multiple pending callbacks.
- [x] Play at the endpoint or with zero steps is unavailable/no-op; it does not silently rewind. The user can select an earlier sequence before playing again. Pause retains the current sequence and text.
- [x] Manual previous/next/seek pauses first and cancels the pending playback callback. Guard callbacks by a generation/disposed flag so even a callback already delivered by the scheduler cannot advance an invalidated player.
- [x] Clear scheduled playback on pause, navigation, endpoint, loading another recording, recording resumption, errors, view close, and unload. Dispose idempotently and release subscriptions/caches.

Deliverable: the fake scheduler proves predictable progression and rate changes, with one timer and no original idle delays.

#### Task 3.4 — Build the read-only replay view

- [x] Register a stable view type such as `replay-history` through `registerView`. Use one reusable Replay `ItemView` for the MVP, bound to one recording at a time. Reopening the same valid recording reveals the view without resetting selection or starting another player; rebinding pauses/disposes the previous player first.
- [x] Display the note path/name, selected step and total steps, Play/Pause, rate selection, previous/next buttons, and the timeline. Provide a simple Return to note action that focuses the live note without starting recording automatically.
- [x] Render source Markdown as selectable, read-only text using a text-only surface such as `<pre><code>` with `textContent`. Do not render recorded text as HTML, create an editable Markdown leaf for history, or replace the live note's editor document. Preserve the exact reconstructed string, including Unicode, tabs, and line boundaries.
- [x] Keep rendering behind a small replaceable text-rendering boundary so milestone 4 can add highlight spans without changing reconstruction/playback behavior. Do not add a nonfunctional Doomed button in this milestone.
- [x] Show loading, missing recording/note, and validation/read errors inline, clearing text from a previously bound note before showing a different note's loading state. Invalid data cannot leave active playback controls behind.
- [x] A valid empty initial document is an empty text display with step `0`, not an unavailable-recording error. Disable Play/previous/next and the slider appropriately for initial-only recordings.
- [x] Use labeled native buttons/select/range controls with keyboard support, visible focus, disabled states, and touch-friendly responsive layout. Render in the view's owning document for popout compatibility; avoid disruptive focus/scroll resets on every step.
- [x] Persist only lightweight view identity/path state if workspace restoration requires it. On restoration, reload a valid stopped recording and open paused at sequence `0`; never restore an active playback timer, live capture state, or a serialized document snapshot in workspace data.

Deliverable: the view exposes the agreed playback/navigation controls and displays historical text without gaining a write path to the live note.

#### Task 3.5 — Wire the timeline and responsive scrubbing

- [x] Use an integer range from `0` to the final sequence; timeline positions represent steps rather than elapsed wall-clock time. Update the slider and step label after each successful step or selection.
- [x] On slider input, pause playback immediately. Coalesce rapid input to the latest requested sequence within a short render window using a cancelable injected scheduling boundary; reconstruct once for the latest request rather than every discarded intermediate pointer event.
- [x] Flush the final requested position on the slider's committed change/end interaction so releasing the pointer or using the keyboard leaves text and controls at the exact requested step.
- [x] If Play or step navigation follows a pending seek, commit or supersede that seek explicitly before proceeding. A delayed seek must not overwrite later button navigation or playback state.
- [x] Cancel pending seek work on file rebinding, recording resumption, errors, close, and unload. Apply the same lifecycle token/request generation checks used by playback.
- [x] Keep automatic playback incremental in memory. Opening/scrubbing must not trigger disk reads on every step, rescan the vault, or update the recording's final state.

Deliverable: dragging, keyboard navigation, and automatic playback agree on the selected document, including during rapid mixed interactions.

#### Task 3.6 — Integrate opening, recording controls, and cleanup

- [x] Add the local `open-history` command, named Open recording history, and an Open replay action in the current note's recording bar/file menu when a stopped recording is known. Command availability checks remain synchronous and perform no I/O.
- [x] Resolve context from the selected Markdown note or an already bound replay view. Capture the target recording identity/path at request time; do not silently retarget an in-flight request when the active workspace leaf changes.
- [x] Use the controller's validated stopped-snapshot boundary for every open. Do not bypass it with a direct store read, auto-save-and-replay an actively recording file, or trust cached UI status as authorization to play.
- [x] Retain the existing Start/Stop workflow. Starting from the live note invalidates the affected replay first and uses the fresh live CodeMirror snapshot. Returning from replay alone does not record anything or restore a historical state into the note.
- [x] Forward file/folder renames to the replay binding and handle a missing/deleted target as unavailable without attempting deleted-note recovery or orphan reassociation. Keep the portable format unchanged.
- [x] Register the view, events, DOM listeners, controller subscriptions, and disposal through plugin/view lifecycle helpers. Cancel both seek and playback schedules before destroying/rebinding the view or unloading the plugin.
- [x] Keep `main.ts` focused on composition/registration. Keep runtime browser-compatible, with no Node/Electron filesystem usage, network calls, or extra runtime dependencies unless required by the chosen implementation.

Deliverable: a stopped note recording can be opened from normal Obsidian controls, and resuming recording safely leaves historical exploration.

#### Task 3.7 — Add automated navigation and integration tests

- [x] Add `tests/replay/` suites using the existing recursive test runner and fake scheduler. Include the pure replay modules in test type checking; test loading/lifecycle coordination through the pure coordinator and injected note-existence boundary without importing the Obsidian runtime into Node. Actual workspace/DOM integration remains part of the manual pass.
- [x] Assert every selected/played fixture state against the existing engine fixtures, including multi-change steps, Unicode/newlines, a resume replacement, an empty document, and an initial-only recording. Verify backwards navigation and arbitrary seeks match those same reference strings.
- [x] Test first-tick timing, supported rates, changing rate while playing, repeated Play/Pause, endpoint behavior, invalid selections/rates, close/dispose cleanup, and stale callbacks already queued when cancellation occurs. Assert no timer accumulation.
- [x] Test rapid scrubbing, final seek commit, pending seek followed by Play/previous/next, and old requests arriving after a newer selection. Text, slider position, and step labels must describe the same applied sequence.
- [x] Integrate with the real `RecordingController` and fake-adapter `RecordingStore`: opening while recording/saving/error is rejected; Start invalidates a paused or playing replay; Stop permits a fresh snapshot; no replay action creates recorded steps or modifies stored history.
- [x] Delay stopped-recording loads, then interleave Start/Stop, Open A/Open B, rename, close, and disposal. Assert that stale snapshots cannot become playable or attach to the wrong note, including when state returns to Stopped before the old request resolves.
- [x] Verify a stopped replay stays anchored to its recorded endpoint when the live note changes unrecorded. Starting another note must not interrupt this file's replay. Reopening the same viewer must not duplicate players/subscriptions.
- [x] Cover corrupt/missing recording data and reconstruction failure without active controls or plausible partial text. Verify recorded strings containing HTML-like text remain text through the rendering boundary.
- [x] Run all existing regression suites, `npm test`, `npm run lint`, and `npm run build`. Keep generated files ignored and document the actual counts/results.

Deliverable: tests establish navigation correctness, lifecycle exclusion, and timing independently of a real device, without claiming that those tests verify Obsidian UI integration.

#### Task 3.8 — Run the manual replay pass and update status

- [ ] In a disposable desktop vault, record an article, Stop, and open replay through the bar, file menu, and command palette. Check the initial/final text, every control, step labels, and all playback rates.
- [ ] Drag and keyboard-operate the timeline while playing, pause at several points, step backwards/forwards, and resume Play. Confirm a large paste and a resumed document each take one step, and overnight/stopped gaps add no playback delay.
- [ ] Compare the live note and its editor undo state before/after replay. Attempt typing/paste in the historical surface; verify the note and saved step stream are unchanged.
- [ ] Start recording again while replay is paused and while it is playing. Confirm immediate playback cancellation, disabled/closed historical navigation, a fresh live editor snapshot, and no captured historical playback edits. Stop and reopen to see the new endpoint.
- [ ] Exercise multiple note contexts, repeated opens, file/folder rename, rapid switching/closing during loading, source/live preview modes, and a popout window. Verify the correct note identity, labels, and cleanup after plugin reload.
- [ ] Repeat the replay/control pass on one mobile platform, checking readable text, touch scrubbing, rate selection, and responsive layout. Complete milestone 2's outstanding recording/minimum-version checks where possible.
- [x] Update README usage and this plan with implemented scope, automated results, devices/versions actually checked, and any checks still unavailable. Keep the manual checklist open when device/tool access is unavailable; do not mark the milestone fully verified on automated results alone.

Verification: `npm test` passes 151 tests, including replay timing/navigation, coalesced seeks, safe text rendering, recording exclusion, delayed-load races, rename/restart invalidation, and all earlier regressions. `npm run lint` and `npm run build` pass. No runtime dependency or portable-format change was needed. The manifest minimum is now Obsidian 1.7.2 for async `revealLeaf`; minimum-version and mobile checks remain unverified.

Desktop smoke test (2026-10-17, macOS, Obsidian 1.13.7): passed in a disposable vault using the local build. Recorded a multiline paste containing HTML-like text and emoji; opened replay through the bar, command palette, and file menu; checked initial/intermediate/final states, previous/next, 1× playback to the endpoint, native slider navigation, and selecting 0.5×. Pasting into the historical surface left it unchanged. Return to note preserved the current live document. Unrecorded edits appeared as exactly one resume replacement, followed by one new edit; the stored stream was `edit, resume, edit`. Reload restored replay paused at step 0 with capture stopped. Starting again disabled historical navigation; Stop/reopen restored it. The updated build was rechecked after fixing active-tab focus, reuse of deferred note tabs, and hidden replay controls during recording.

This was a desktop smoke test, not the full device matrix. All-rate timing/pause/drag combinations, live-editor undo comparison, playing-state Start, multi-note/rename/popout/source-mode scenarios, minimum-version compatibility, and mobile checks remain open in Task 3.8. Automated tests cover many of their controller cases but do not replace UI verification. See [STORAGE.md](STORAGE.md).

Milestone 3 is complete when a stopped recording can be explored and played from any selected step to its exact endpoint, every control agrees with the displayed state, recording invalidates historical exploration before capture starts, no replay operation modifies the live note or recording, automated checks pass, and the required real Obsidian checks are recorded. Doomed rendering and export UI remain explicitly pending.

### 4. Doomed

Status: code implemented, automated checks and a desktop smoke test passed; full device verification remains open. The **Doomed** toggle is available in the stopped-recording Replay view. Compare the displayed historical text with `ReplayController.finalText`, highlighting only historical-side deletions/replacements. Reuse milestone 3's immutable snapshot, lifecycle invalidation, and rendering boundary. Do not change capture, the recording format, storage, or playback timing.

Milestone 3's remaining desktop/mobile and minimum-version checks stay open. The Doomed desktop smoke pass is recorded below; extended rendering/device checks remain pending.

#### Files and responsibilities

| File | Responsibility |
| --- | --- |
| `src/replay/doomed.ts` | Pure deterministic two-string comparison returning historical-side highlight ranges, with bounded comparison work. Split diff helpers into a focused module if necessary. |
| `src/replay/doomed-presentation.ts` | Per-player toggle state, comparison-result reuse, endpoint ownership, and nonfatal comparison status. Keep this separate from playback scheduling. |
| `src/ui/replay-text.ts` | Extend the existing text renderer to create plain text nodes and highlight spans while preserving exact `textContent`. |
| `src/ui/replay-view.ts` | Add the accessible Doomed toggle, render the current applied step with its ranges, and display comparison status. |
| `styles.css` | Theme-compatible yellow highlight and toggle focus/pressed states. |
| `tests/replay/doomed.test.ts` | Comparison semantics, deterministic alignment, Unicode offsets, and work-limit behavior. |
| `tests/replay/doomed-presentation.test.ts`, `doomed-renderer.test.ts`, `doomed-integration.test.ts` | Toggle/cache lifecycle, playback integration, injected DOM tree output, and endpoint changes after Resume. |
| `tests/support/replay.ts`, `tests/support/dom.ts` | Shared real-controller/store fixtures and an injected document/element tree for renderer tests. |
| `README.md`, `docs/RECORDING_FORMAT.md`, `docs/PLAN.md` | Usage, comparison/alignment contract, actual verification results, and remaining checks. |

Keep comparison and presentation modules independent of Obsidian, DOM objects, storage, and live editors. The existing `ReplayController` remains the authority for selected text and final text; Doomed consumes those values without changing navigation or timers.

#### Task 4.1 — Define the comparison contract and alignment

Target boundary:

```ts
interface DoomedRange {
  readonly from: number;
  readonly to: number;
}

type DoomedComparison =
  | { readonly status: 'ready'; readonly ranges: readonly DoomedRange[] }
  | { readonly status: 'unavailable'; readonly reason: 'work-limit' };

compareDoomed(selectedText: string, finalText: string): DoomedComparison
```

- [x] Use half-open UTF-16 offsets into `selectedText`, matching the rest of the recording engine. Return sorted, nonoverlapping, nonempty ranges within its bounds; merge adjacent highlighted ranges. An unavailable comparison must remain distinct from a successful comparison with no differences.
- [x] Compare only the two supplied strings. Highlight selected-side deletion portions of a deterministic character-level diff; replacement contributes its removed historical portion. Final-only insertions contribute no visible text or ranges. Do not use earlier/later transactions, character identity, or the current live note.
- [x] Use a focused local Myers-style sequence diff over Unicode code points, mapping token boundaries back to original UTF-16 offsets. Trim exact common prefixes/suffixes before diffing, without normalization, case folding, whitespace cleanup, semantic word expansion, or move detection. Preserve the original strings for rendering.
- [x] Specify a fixed tie-break for equally valid alignments, including which equal repeated occurrence is retained. Start with deletion before insertion for equal-cost branches; record the resulting repeated/moved-text examples in tests and the format documentation. Do not claim all matching substrings can remain unhighlighted when their order differs.
- [x] Return no ranges immediately for identical strings, including identical nonempty states reached by deleting and retyping. An empty selected state has no ranges; a nonempty selected state compared with an empty endpoint is entirely highlighted. Initial-only recordings compare with themselves.
- [x] Keep boundaries outside surrogate pairs, preserve combining characters, variation selectors, ZWJ sequences, tabs, CR/LF, and non-Latin text exactly. Code-point comparison may distinguish components of a combining/emoji sequence; document that alignment granularity rather than normalizing text or widening a range over otherwise unchanged characters.
- [x] Bound frontier/backtracking work and allocations so wholly different long documents cannot allocate an unrestricted quadratic table or monopolize the UI. Set named limits using representative article/large-paste fixtures and record those limits. On exhaustion return `unavailable`; do not approximate by highlighting an entire unmatched block as if it were a successful exact comparison. Keep this local and browser-compatible; add no runtime dependency unless a measured implementation issue requires one and its size/license/behavior are documented.

Deliverable: a testable exact comparison contract with deterministic alignment, UTF-16 range mapping, and an explicit bounded-work failure path.

#### Task 4.2 — Add per-player presentation state and bounded reuse

- [x] Introduce a small pure presentation model scoped to one loaded `ReplayController` instance. Read its immutable `finalText` once as the endpoint and consume its applied `sequence`/`text`; never resolve a live editor or reload history for comparison.
- [x] Default Doomed off for each newly loaded player, including a new stopped revision after Resume or workspace restoration. Reopening the same valid player retains the toggle. Previous/next, seek, Play/Pause, and rate changes keep the setting while that player remains bound.
- [x] When off, return ordinary historical text without computing a diff. When toggled on, compare the currently applied state; when off again, clear highlights without changing sequence, pending seek, playback rate, playing state, or either playback/seek schedule. Doomed can be toggled while playback continues.
- [x] Reuse the result for an unchanged applied sequence; Play/Pause, rate, or pending-slider notifications alone must not repeat the comparison. Use a small bounded per-player cache for revisited steps, with named entry/range-storage limits. Do not retain copies of every historical document, precompute every step, persist comparison results, or scan other recordings.
- [x] While a seek is pending, render ranges for `state.sequence`/`state.text`, not `pendingSequence`. Update text and ranges together once reconstruction commits. A cached empty range list is a valid result, not a cache miss.
- [x] Drop presentation state/cache when the player is disposed or replaced: Start/Resume invalidation, rebind, rename reload, missing note, close, or unload. A new player, even with the same path/last sequence, cannot reuse old-endpoint ranges. Use the existing player/reference lifecycle rather than adding persistent revision fields.
- [x] Treat work-limit exhaustion as a nonfatal display condition: render the selected text plainly and show a short inline message such as “Doomed comparison is unavailable for this step.” Keep recording data, normal playback/navigation, and the toggle usable. Unexpected comparison errors must also leave plain exact text and an explicit status, never stale highlight spans from a different step.

Deliverable: presentation work follows applied replay states and remains isolated from capture, storage, and playback scheduling.

#### Task 4.3 — Extend the safe text renderer

- [x] Retain a plain-text path for disabled/unavailable/no-highlight cases. For highlighted output, build text nodes for clear slices and spans with a dedicated class for doomed slices, using the target's `ownerDocument` so popout windows work correctly.
- [x] Create span contents with `textContent`/text nodes only. Never use `innerHTML`, HTML interpolation, Markdown rendering, executable markup, or editable historical leaves. The highlight class is presentation metadata and is not written into recorded text.
- [x] Validate range order/bounds before replacing the display. Prepare the complete node fragment before committing it; invalid ranges must not create partial or misleading highlights. Clear old spans on toggle-off, load/unavailable/error, or a different selected state.
- [x] Assert the resulting container's `textContent` exactly equals the original reconstructed JavaScript string. Do not add annotation words, hidden textual labels, line breaks, or final-only insertions inside the historical text. Copying the historical text must retain the same source Markdown.
- [x] Avoid replacing unchanged text/spans on unrelated control notifications. Preserve the existing source-text wrapping, selection, and scroll behavior as far as possible; do not reset focus or scroll to the top at every playback step or toggle.
- [x] Keep the renderer small and independently testable. Use an injected document/element boundary or a lightweight test-only DOM implementation to exercise actual child/text-node construction; a `textContent`-only mock is insufficient for highlighting tests. Do not bundle test DOM tooling into `main.js`.

Deliverable: toggling highlights changes only presentation, with exact selectable source text and no interpretation of recorded markup.

#### Task 4.4 — Wire the toggle and theme styling

- [x] Add a native **Doomed** button beside the existing playback controls, with `aria-pressed`, keyboard activation, visible focus, and clear pressed styling. Provide concise help explaining that it highlights text differing from the final recorded step. Use sentence case and existing view lifecycle helpers.
- [x] Enable it only for a valid stopped replay. Disable/reset it during loading, unavailable, or reconstruction-error states and clear the old presentation immediately when the coordinator invalidates a player. Do not add an active-recording preview or a separate command/settings panel.
- [x] Keep the toggle available for valid initial-only and endpoint states; enabling it there correctly produces no highlight. Do not interpret “no doomed text” as missing history or an error.
- [x] Render the selected text and its comparison result together through the extended rendering boundary. Put comparison-limit/error messages outside the historical text and keep them distinct from recording/reconstruction errors so ordinary navigation remains available.
- [x] Use a yellow/amber background compatible with Obsidian theme variables and retain readable foreground text. Verify light/dark themes and selection contrast; avoid hard-coded foreground colors that disappear in one theme. Keep playback controls responsive and touch-friendly.
- [x] Keep view identity persistence limited to its existing path. Doomed is a transient viewing choice, with no saved document spans, settings migration, portable-format changes, or recording writes.

Deliverable: the agreed toggle works during stopped replay and cannot expose stale comparisons while recording is active.

#### Task 4.5 — Add comparison and rendering tests

- [x] Add exact expected ranges for insertion-only, deletion, replacement, punctuation/whitespace changes, leading/trailing edits, empty states, and identical states. Include `The cat sleeps.` versus `The dog sleeps.` and examples where only final-side text was added.
- [x] Lock deterministic outcomes for repeated substrings, moved passages, and retyped text. Construct two histories with different intermediate edits but the same selected/final strings and assert the same ranges. Compare initial/final states of an initial-only recording and verify no highlight.
- [x] Test surrogate pairs, combining marks, ZWJ/variation-selector emoji, non-Latin text, multiline Markdown, tabs, CRLF strings, and literal HTML/script-like strings. Assert valid UTF-16 boundaries and exact string reconstruction from clear/highlighted slices.
- [x] Check diff correctness against a small independent reference implementation for short generated inputs, including repeated tokens. Verify deterministic results, unchanged-subsequence consistency, range invariants, input immutability, and the work-limit result without duplicating the production algorithm in the test.
- [x] Exercise renderer output with a real/test DOM boundary: expected highlight spans, clear text between spans, exact `textContent`, no executable/HTML nodes from recorded strings, toggle-off cleanup, empty ranges, invalid-range handling, and no redundant DOM replacement for an unchanged result.
- [x] Test presentation over the real replay model and fake scheduler: toggling while paused/playing changes no sequence/rate/timers, repeated control notifications reuse results, committed/coalesced seeks render the applied state, endpoint highlights are empty, and cache limits are enforced.
- [x] Integrate with the real recording controller/store/coordinator: unrecorded live edits leave the comparison target unchanged; recording another note does not invalidate it; same-file Start clears it immediately; Stop/reopen recalculates earlier states against the new ending. Test a changed ending with the same last sequence across different recordings so path/sequence-only caching cannot leak results.
- [x] Cover close/rebind, delayed old loads, rename, missing notes, disposal, and work-limit/error fallback. Assert no stale spans or results attach to the new player and that comparison never changes stored history or the live note. Reuse existing lifecycle fixtures rather than reimplementing their guards.
- [x] Run the full regression suite with `npm test`, `npm run lint`, and `npm run build`. Record actual results/counts and the production bundle impact; keep generated files ignored.

Deliverable: tests establish two-state semantics, exact safe rendering, and endpoint invalidation independently of a device.

#### Task 4.6 — Verify the complete Doomed workflow and update status

- [x] In a disposable desktop vault, record an existing article with deletions/replacements, Stop, open replay, and enable/disable Doomed at several steps. Compare highlights with the final recorded text; confirm unchanged spans remain clear, final-only text is absent, and the endpoint has no highlights.
- [ ] Use Doomed while playing at all supported rates, stepping both ways, and dragging/keyboard-operating the timeline. Check text/highlights/step labels agree, toggling does not pause or advance playback, and selection/scroll remain usable. Exercise repeated text and moved/retyped passages against the documented alignment examples.
- [ ] Change the live note while stopped and confirm the recorded endpoint remains the target. Resume and revise the ending, Stop, reopen, and verify the same earlier step now compares with the new ending. Check same-file recording exclusion and a different note's independent recording.
- [ ] Confirm historical text cannot be edited, copying includes exact source text, and enabling/toggling Doomed leaves the live file, editor undo behavior, and saved recording unchanged. Check literal HTML-like text, multiline Markdown, and Unicode examples visually.
- [ ] Check light/dark themes, keyboard/focus/pressed states, source/live preview entry points, a popout, and reopen/reload cleanup. Exercise representative long articles/large replacements, tune/document comparison/cache limits, and verify a limited comparison shows plain text with a clear status while navigation still works.
- [ ] Repeat the highlight/control pass on one mobile platform, including touch scrubbing, responsive layout, readable contrast, and representative long notes. Continue tracking earlier minimum-version and extended replay checks; do not mark unavailable devices as passed.
- [x] Update README usage, the documented comparison/alignment behavior in `RECORDING_FORMAT.md`, and this plan with implemented files, actual automated results, device/version outcomes, measured limits, and checks still open. Preserve the version 1 schema and keep export UI pending for milestone 5.

Verification: `npm test` passes 186 tests, including 4,489 deterministic input pairs checked against an independent LCS oracle, exact ranges/Unicode boundaries, injected DOM tree rendering, transient toggle/cache behavior, and real recording-store/coordinator lifecycle cases. `npm run lint` and `npm run build` pass. No dependency or portable schema change was needed. The production bundle increased from 34,761 to 39,154 bytes (+4,393 bytes).

Implementation limits: 500,000 combined input UTF-16 units for nontrivial comparisons, 500,000 frontier/snake work units, and 131,072 32-bit trace cells. The per-player cache holds at most 16 results and 4,096 ranges, plus its current result. A local Node benchmark on this development host compared a 120,000-character article with a small ending revision in about 11 ms; a 2,000-character wholly replaced string reached the explicit limit in about 4 ms. These are individual development measurements, not mobile or cross-device performance guarantees.

Desktop smoke test (2026-10-17, macOS, Obsidian 1.13.7, disposable vault): recorded a cat-to-dog/draft-to-final replacement plus typed edits. Confirmed yellow highlights on the expected selected-side characters, literal HTML-like source/emoji, toggle-off cleanup, keyboard activation, playback at 0.5×/1×/2×/4×, Home/End timeline navigation, and no endpoint highlights. Toggling during playback retained the running state. Unrecorded edits preserved the old target; Resume disabled/reset the toggle and cleared text immediately. After Stop/reopen, the same earlier step matched the new ending and had no highlights. The saved stream retained all 14 original steps byte-for-byte and appended exactly one resume step. A separate 2,000-character complete replacement showed the comparison-limit message with plain text, and Next still reached the valid endpoint and cleared that message.

The desktop smoke test used the dark theme and live-preview entry point. Light-theme/selection contrast, mouse/touch dragging, copy/undo comparison, popout/source-mode/reload combinations, the full independent-note device matrix, minimum-version compatibility, and mobile checks remain open. Task 4.6 stays partially unchecked for those device scenarios; automated tests do not establish their UI behavior.

Milestone 4 is complete when Doomed consistently highlights only selected-side differences from the stopped recording's endpoint, toggling preserves exact text and playback state, Resume/Stop establishes a new comparison endpoint without stale results, automated checks pass, and the required desktop/mobile verification is recorded. Portable export and release verification remain milestone 5.

### 5. Portable export and release verification

Status: code implemented; automated/export/release checks and the desktop export smoke test passed. Full device and minimum-version verification remains open. A stopped recording can be exported as one readable, uncompressed `<note-name>.replay.json` file. Reuse the implemented version 1 serializer/parser, reconstruction engine, stopped-snapshot revisions, and Doomed comparison. Prepare release metadata and checks, then verify the complete PROJECT.md journey.

Milestones 2–4 still have extended desktop/mobile and minimum-version checks open. Implementing export does not make those checks pass or make the plugin release-ready automatically. The hosted sharing service, upload integration, import UI, compression, multiple recordings, and retention/deletion controls remain outside this milestone.

#### Export workflow and snapshot decisions

1. From a stopped note or its Replay view, select **Export recording**. Bind the request to that note immediately; switching the active tab cannot change its source.
2. Show a single export dialog with the source note, saved endpoint step, a vault-relative **Destination**, **Export**, and **Cancel**. Default the destination to `<note-folder>/<note-basename>.replay.json`, or the vault root for a root note. The user may choose another existing vault folder/name in the field.
3. Explain before saving: **Includes deleted and superseded writing.** The file contains the entire recording through its stopped endpoint, regardless of the selected replay step or Doomed setting. There is no upload or recipient action.
4. Prepare a validated stopped snapshot and canonical JSON. Immediately before creating the file, recheck that its source identity/revision is still current, its note still exists, and the destination is valid and unused. Do not auto-stop capture or retry an unresolved recording save.
5. Create a new file through Obsidian's vault API, read it back, and verify the saved artifact. Report success with the actual destination and exported endpoint. Existing destinations are errors; the user selects another name rather than silently replacing a file.

A Start/Stop cycle, source rename/move, deletion, or unload before the create call invalidates an open export request. For source changes while loaded, show that the source changed and require a fresh dialog; unloading closes the request without further UI. Unrecorded live edits and recording another note do not invalidate the stopped snapshot.

The create call is the save boundary. Once it has begun, the payload is the immutable, previously validated stopped revision. Later recording changes do not extend it, and they do not cause an already-created export to be deleted. If creation/verification finishes after the dialog closes, report that request's actual result while the plugin is still loaded. Do not claim an in-flight vault write was canceled. On unload, suppress late UI work; no atomicity or completion guarantee is made for abrupt app termination.

#### Files and responsibilities

| File | Responsibility |
| --- | --- |
| `src/export/recording-export.ts` | Pure preparation of canonical version 1 JSON and saved-artifact verification using the existing format/engine. |
| `src/export/destination.ts` | Suggested filenames and pure validation of portable, vault-relative destination paths. |
| `src/export/commit-queue.ts` | Serialize destination commits across export dialogs. |
| `src/export/export-controller.ts` | Request state, stopped-snapshot validation, duplicate-submit exclusion, and save/verification lifecycle through an injected destination adapter. |
| `src/export/obsidian-export-adapter.ts` | Existing-folder/existence checks, create-new via `Vault.create`, and readback via the vault API. |
| `src/ui/export-modal.ts` | Source/destination disclosure, loading/stale/saving/error/success presentation, and accessible Export/Cancel controls. |
| `src/ui/export-workspace.ts` | Resolve note/replay context, own one dialog, bind requests at invocation, and clean up on unload. Extract a small shared context resolver if needed. |
| `src/ui/recording-controls.ts`, `replay-view.ts`, `replay-workspace.ts`, `src/commands/register-commands.ts` | Export entry points and narrow callbacks to the export bridge. Preserve existing command IDs and recording/replay behavior. |
| `src/main.ts`, `styles.css` | Compose/dispose services and style responsive dialog feedback. Keep feature logic out of `main.ts`. |
| `tests/export/`, `tests/support/` | Portable-artifact, destination, write-failure, and lifecycle-race tests using the existing real controller/store and injected adapter fixtures. |
| `package.json`, `package-lock.json`, `manifest.json`, `versions.json`, release helper | Consistent Replay metadata, versions, and minimum supported app version. |
| `scripts/check-release.mjs`, `.github/workflows/lint.yml`, `release.yml` | Repeatable metadata/artifact checks and test/lint/build gates before release creation. |
| `README.md`, `docs/RECORDING_FORMAT.md`, `docs/STORAGE.md`, `docs/PLAN.md` | Complete usage/export instructions, portability contract, device results, and release checklist. |

Keep export preparation, path validation, and operation state independent of Obsidian, DOM objects, Node/Electron, and filesystem globals. Use a small injected adapter for destination operations; do not route exported files through the internal append-only recording store.

#### Task 5.1 — Prepare and verify a portable recording artifact

- [x] Load through `RecordingController.stoppedSnapshot(path)`, retaining its stable ID/path/revision. Reuse `isReplayCurrent(reference)` as the existing stopped-revision guard; its name does not justify bypassing it or renaming unrelated APIs. Starting, recording, stopping, unresolved-error, missing-note, and unloaded states cannot prepare a new export.
- [x] Reuse `serializeRecording` without introducing a second schema or serializer. Produce ordinary version 1 JSON with two-space indentation and a trailing newline; preserve initial text, all consecutive changes, and every resume transition exactly. An initial-only recording, including an empty document, is exportable.
- [x] Export the complete stopped recording even if Replay is paused at an earlier step, playing, or showing Doomed. Exclude local recording IDs, note/vault paths, metadata/index files, current live text, view state, timestamps not in the format, highlight ranges, and executable/UI objects from the payload. Exclude these as extra metadata fields; never redact matching characters from the captured document strings.
- [x] Prepare the JSON string once for the request and retain the endpoint sequence/text needed for verification. Do not serialize again on each input change, reconstruct every prefix at runtime, or keep extra copies of every historical document. Release prepared data on completion or pre-commit cancel/stale/disposal; an in-flight commit owns the captured payload until its I/O and verification settle.
- [x] Verify readback using exact canonical-text comparison plus `parseRecording` and endpoint reconstruction. A success requires a complete valid artifact with the expected initial text, step count, and final text. Do not report a truncated, altered, or unreadable file as successfully exported.
- [x] Keep the portable version at 1. Finalize/document `.replay.json` as the default extension; no compression, Base64 wrapper, external resource, account, or Obsidian runtime is needed to reconstruct it. Doomed comparison limits remain a viewer concern, not grounds for dropping recording data from export.

Deliverable: a pure export boundary produces and verifies the complete standalone JSON artifact from a validated stopped recording.

#### Task 5.2 — Validate the destination and create without replacing files

- [x] Default to the source note's folder and sanitized basename plus `.replay.json`. Preserve Unicode and ordinary spaces; replace filename characters that are invalid across supported platforms in the suggestion. Show the resulting suggestion before saving rather than silently changing a submitted destination.
- [x] Accept a vault-relative path with forward-slash separators and a `.replay.json` suffix. Validate before normalization: reject absolute/drive/UNC/URI paths, backslashes, `.`/`..` segments, empty segments, control characters, invalid filename characters, reserved platform names, and trailing dots/spaces. Return concise field errors; never let normalization hide traversal or reinterpret the destination outside the vault.
- [x] Reject the live source path, the configured vault configuration directory and its descendants, the actual plugin directory, and the vault trash directory. Resolve these from the current configuration rather than hard-coding `.obsidian` as the only protected path.
- [x] Require an existing parent folder, including the root. Do not create folders, scan the whole vault, launch a desktop-only save dialog, download through a browser, or write outside the vault. The destination field is the MVP's cross-platform save flow; native sharing/save integration can come later.
- [x] Check the destination against the vault's current file/folder lookup and adapter existence result, respecting the host filesystem's case sensitivity. Use `Vault.create` as the create-new operation; never fall back to `modify`, adapter `write`, `process`, or remove-and-replace for a collision. Keep existence checks and the create call in the operation's commit path, not only when the dialog first opens.
- [x] Serialize this plugin's destination commits and reject repeated submissions for a busy request so two dialog/command activations cannot overwrite or duplicate the same requested export. Handle collisions reported by the vault API as errors. Do not promise cross-device/filesystem transaction guarantees against unrelated writers.
- [x] On creation or readback failure, preserve the source recording and any destination that may have been created. Show an actionable failure without document contents. If the write outcome is uncertain, explain that a file may exist and let the user inspect it or choose a new destination; do not automatically retry by replacing, deleting, or claiming ownership of an existing file.

Deliverable: the visible destination is the file actually created, existing files remain untouched, and failure never rewrites the note or its stored recording.

#### Task 5.3 — Make export requests and saving race-safe

- [x] Define explicit request phases such as preparing, ready, stale, saving, success, error, and closed. Give requests a generation/disposed guard and keep them bound to their invocation's source reference and prepared JSON, never to a later active workspace leaf.
- [x] Recheck stopped readiness/revision after awaited preparation and destination checks and immediately before invoking create. Subscribe to existing file-scoped lifecycle invalidation plus note deletion. A complete intervening Start/Stop cycle must invalidate an older request even if the source returns to Stopped with the same last sequence.
- [x] Treat a source file/folder rename as invalidating the prepared request. Do not silently update its destination, retarget it to another note, or export using a stale path. Reopening from the renamed source obtains its stable recording identity and a fresh revision normally.
- [x] Make Cancel/close before the save boundary release data and ignore late preparation results with no destination write. Disable the submit button while saving and have duplicate calls join/reject the same operation rather than create another file. Closing after create starts must not masquerade as write cancellation.
- [x] After create begins, verify/report only that captured artifact and endpoint. A later Start, tab switch, or live edit cannot replace its JSON with a newer revision or cause cleanup to delete a valid export. Failure/success callbacks must stay attached to the original source/destination and be suppressed after plugin unload.
- [x] Keep modal subscriptions/listeners owned by the dialog/bridge lifecycle. Dispose idle/preparing request resources on close/unload without leaving callbacks that reopen a modal or initiate a new file after cancellation. An already-started commit retains only the payload/reference needed to finish its I/O; it cannot reopen UI after disposal.

Deliverable: explicit boundaries determine which stopped revision is exported, with no stale loads, accidental retargeting, duplicate submits, or false cancellation claims.

#### Task 5.4 — Wire export controls and explain the artifact

- [x] Add stable local command ID `export-recording`, named **Export recording**, with synchronous, side-effect-free availability checks for the active Markdown note or a valid bound Replay view. Actual invocation still passes through the stopped-snapshot guard; cached button state is insufficient.
- [x] Add **Export recording** to the current note's stopped recording bar/file menu and the valid Replay view. Hide/disable it while the source is absent, starting, recording, stopping, or in unresolved error. Keep initial-only and valid empty recordings available.
- [x] Route entry points through one export bridge/dialog. Repeated invocation while a dialog is open focuses that same request without changing its source; close it to choose a different note. Inject callbacks into existing controls/views rather than duplicating export rules there.
- [x] Opening the dialog from a playing Replay pauses that source's player, retaining its selected step, rate, and Doomed setting. Do not affect another file's player or start playback automatically when the dialog closes. Export always includes the endpoint and full history, regardless of this selected position.
- [x] Show the source note, stopped endpoint, editable **Destination**, the deleted/superseded-writing disclosure, **Export**, and **Cancel**. Use labeled native controls, keyboard submission/focus, responsive layout, inline loading/validation/stale/save errors, and disabled busy states. Do not show internal IDs/revisions or implementation jargon.
- [x] Before saving, explain that this creates one local file and that its contents include earlier writing. After verified success, show the actual vault-relative path and endpoint; do not announce sharing/upload success or imply an online player already exists. Do not open the JSON as an editable Markdown note or auto-launch another app.
- [x] Preserve existing Start/Stop, open-history, playback, and Doomed command IDs/behavior. Keep the plugin local/offline and add no network request, import UI, settings tab, retention action, or new runtime dependency unless the chosen implementation requires one and documents why.

Deliverable: a writer can discover export from both the note and Replay, understand what is included, choose a destination, and receive a truthful result.

#### Task 5.5 — Test saved-file portability, failure, and lifecycle boundaries

- [x] Add `tests/export/` using the recursive runner, include pure export modules in test type checking, and provide a small in-memory create-new/readback adapter with delayed operations and failures before/after creation takes effect. Test the controller independently of the Obsidian runtime.
- [x] Export all existing format fixtures plus recorded multi-change edits, Unicode/newlines/quotes, deletion/replacement, changed/unchanged Resume, an initial-only article, and an empty recording. Assert readable canonical JSON and absence of extra metadata fields for local IDs/paths or highlight/view state, and of distinguishable unrecorded live additions. Recorded document text is preserved even if it happens to contain a path or identifier.
- [x] Treat only the saved JSON as input to a fresh portable consumer: parse it, reconstruct every recorded sequence forwards and backwards, and compare each with independently expected states. Compute Doomed against its exported endpoint and compare with the same states before export. The test must not read the original note, internal index/NDJSON/metadata, or an Obsidian object to recover missing information.
- [x] Test default filenames, root/nested destinations, Unicode/spaces, invalid segments/extensions/reserved names, traversal/absolute paths, configured protection directories, missing parents, existing files/folders, and case-variant collisions on a case-insensitive fake adapter. A rejected path must cause no create call.
- [x] Delay preparation/destination checks and interleave Start/Stop, source rename/delete, Open A followed by a later context, Cancel, repeated commands/submits, close, and unload. Verify stale requests cannot save, same-file invalidation is synchronous, unrelated recording/live edits leave the stopped payload valid, and pre-commit cancellation performs no write.
- [x] Delay create/readback, then change recording state or close the dialog after commit starts. Assert the original immutable artifact is the only write, its original destination/endpoint is reported, and no new-source payload or automatic deletion occurs. Exercise a collision appearing after the initial validation and duplicate destination submissions.
- [x] Inject create failure, uncertain completed creation, truncated/altered readback, parser failure, and readback rejection. Assert no false success, overwrite fallback, automatic destructive cleanup, or duplicate retry; source text/history and existing destinations remain unchanged. Verification failure must remain distinct from a recording-save failure.
- [x] Cover request/modal state with real-controller subscriptions and destination-adapter tests, and context routing/disclosure/controls through the desktop UI smoke test. The source stays pinned, busy/stale states prevent submission, errors retain the destination, and close disposes subscriptions. No separate Obsidian DOM simulation was added; extended device scenarios remain in Task 5.7.
- [x] Run all existing regression tests plus `npm test`, `npm run lint`, and `npm run build`. Record actual counts/results and bundle size; keep generated artifacts ignored. Avoid repeated full-history reconstruction in production merely to reproduce the exhaustive acceptance assertions used by tests.

Deliverable: the file alone supports playback and comparison, and failed/racing exports cannot overwrite existing data or misrepresent what was saved.

#### Task 5.6 — Align metadata and gate release preparation

- [x] Replace package template name/description with the actual Replay metadata and align `package.json`, lockfile root metadata, and `manifest.json` versions. Retain plugin ID `replay`, author/license, released command IDs, and the existing `0.1.0` version unless an actual version increment is intended. Do not invent repository/homepage URLs or change the plugin ID to match the package name.
- [ ] Keep `versions.json` consistent with each release's minimum app version. The current minimum is 1.7.2; confirm all newly used APIs against local definitions and actual supported installations. Retain browser-compatible runtime code and `isDesktopOnly: false`; do not introduce a desktop-only export dependency. Complete the required mobile pass before claiming release readiness and document any unavailable checks.
- [x] Review the version-bump helper so the package/manifest/map cannot drift, including when an existing version's minimum changes. Avoid running the current `npm version` lifecycle just to fix sample metadata, because it stages files and may create a tag/commit. Make intended file edits without unrelated repository mutations.
- [x] Add a repeatable release-check script/command that validates metadata consistency and required built artifacts after production build. When a release tag is supplied, require an exact `x.y.z` match to the manifest version with no leading `v`; fail before release creation on mismatch. Verify assets are the root `main.js`, `manifest.json`, and this plugin's `styles.css`, excluding test bundles, source maps, notes, recordings, and dependencies.
- [x] Extend the existing push/PR workflow to run `npm ci`, tests, lint, production build, and release checks. Add the same gates and tag/version validation to the existing release workflow before its draft-release step; preserve individual asset attachments and existing provenance behavior. Do not change unrelated action versions or publish anything as a side effect of implementation.
- [x] Document the intentional release process: build/check, review device results, choose an aligned version, then separately authorize any tag push or GitHub release/catalog action. Preparing this milestone creates no release, remote tag, publication, or community-catalog submission on its own.

Deliverable: repository metadata and repeatable checks describe Replay accurately and reject mismatched release artifacts/tags before publishing steps run.

#### Task 5.7 — Verify the complete MVP journey and document readiness

- [ ] In a disposable desktop vault, run PROJECT.md's acceptance scenarios 1–10 together: existing-article recording, revision/undo/redo, steady playback and navigation, continuation after stopped/unrecorded work, endpoint-based Doomed, restart, and a portable export. Include initial-only/empty recordings and two independent note contexts.
- [ ] Export from the bar, file menu, command palette, and Replay at an earlier step with Doomed on and while playing. Confirm the complete stopped history is exported, the dialog identifies its source/destination, no overwrite occurs, Cancel creates no file, and a failed/invalidated save shows a useful error without changing the note or stored history.
- [x] Copy the exported file into an isolated verification directory/environment without the source vault or plugin storage. Use the documented parser/engine test harness to reconstruct starting, intermediate, resumed, and final text and compute Doomed from that file alone. Do not add an import UI or a standalone recipient product just for verification.
- [ ] Complete the outstanding recording/replay/Doomed desktop matrix where possible: source/live preview entry points, keyboard and pointer scrubbing, all rates, same-file recording exclusion while playing, file/folder rename, popout, light/dark and selection contrast, copy/undo checks, repeated open/close, and plugin disable/re-enable without leaked controls/listeners/timers.
- [ ] Repeat the full journey and destination/export controls on one mobile platform. Confirm readable/touch-friendly controls, exact saved JSON, collision handling, restart durability, and no dependency on desktop dialogs or Node/Electron. Test the stated minimum supported app version where available; record actual devices/app versions and unresolved checks.
- [x] Update the existing README with the complete record → replay → Doomed → export workflow, destination rules, deleted-writing disclosure, local storage/durability, comparison limits, installation/development commands, and the future service's separate status. Preserve accurate existing documentation rather than treating it as an untouched sample README.
- [x] Update format/storage docs with the final extension and saved-file workflow, and this plan with actual implementation files, automated results, artifact sizes, devices/versions, and remaining gaps. Mark code completion separately from manual verification/release readiness. Do not mark the MVP complete while required PROJECT.md scenarios or device checks remain unverified.

Verification: `npm test` passes 225 tests; `npm run lint`, `npm run build`, and `npm run check:release -- --tag 0.1.0` pass. New suites cover standalone fixture exports, exact readback, destination protection/collisions, delayed preparation/check/create races, cancellation and duplicate submissions, uncertain write outcomes, and release/version-helper failures. The production bundle is 49,813 bytes, up from milestone 4's 39,154 bytes. No dependency or portable schema change was introduced. Package/lockfile/manifest versions now agree on `0.1.0`; the minimum remains 1.7.2. CI is configured for these gates, but no remote CI run or publication is claimed.

Desktop export smoke test (2026-10-17, macOS, Obsidian 1.13.7, disposable vault): the note bar, file menu, command palette, and Replay opened the correct source-bound dialog. Cancel created no file; traversal disabled Export; an existing filename produced a collision error. A playing, Doomed-enabled recording was paused at step 14 while the export included all 15 steps through its stopped endpoint. The dialog reported verified success with the saved destination. A separate large-replacement history was also exported and verified. After reloading the polished build, Start/Stop on an empty note followed by keyboard Export produced a valid initial-only file with empty text and zero steps.

The writing-session JSON was copied into an isolated directory with a portable parser/engine/comparison harness, supplied no source note or internal storage. It reconstructed all 16 states, reversed all 15 steps, and computed Doomed against the exported endpoint for every state. The final text and single resume transition matched the test journey. SHA-256 checks showed the source note and recording files remained unchanged by export.

The remaining release gate is actual extended device coverage: complete the earlier capture/undo/redo/rename/popout/source-mode/theme/copy matrix, mobile workflow/export verification, and a 1.7.2 installation check. Those scenarios remain unchecked in Task 5.7; the corresponding minimum-version bullet in Task 5.6 is intentionally open. Core feature code and automated/local export verification are complete, but this document does not declare the MVP fully verified. No release, Git tag, or catalog submission was created.

Milestone 5 is complete when a stopped recording can be exported to one verified readable file that independently reproduces every recorded state and Doomed comparison, existing data is not overwritten, all PROJECT.md acceptance scenarios and required desktop/mobile checks pass, and test/lint/build/metadata/artifact checks pass. Release publication and the separately planned hosted player require their own subsequent work; neither is implied by a successful local export.

### 6. Native `.replay` files and simpler recording controls

Status: implemented on 2026-10-17, with automated and macOS/Obsidian 1.13.7 smoke verification. The remaining extended device/minimum-version matrix is explicitly unchecked below. The capture/reconstruction engine is retained.

#### Agreed experience and publication boundaries

| Situation | Required behavior |
| --- | --- |
| First Start on `Notes/Article.md` | Create `Notes/Article.replay` automatically after durable initialization, containing the complete initial state. Continue buffering captured edits during initialization. |
| Recording or Resume | Keep writing buffered changes to the internal journal. The visible file retains its initial state or last completed Stop; its locally managed player is paused/disabled. |
| Stop | Flush all accepted changes, serialize the complete recording, publish the sibling file, read it back, and validate it before reporting success. |
| Open a `.replay` file | Obsidian opens a native, read-only file view with the existing minimal playback toolbar and Lucide `history` icon. |
| Copy a `.replay` to another vault | Play from that file alone with Replay enabled, without looking up or creating a Markdown note or hidden recording session. |
| Share | Copy/share the ordinary file. There is no export dialog, destination picker, upload, or separate export button. Stop first to include the latest recording session. |

The `.replay` extension wraps the existing version 1 JSON schema without changing its contents or introducing a new format version. Initial text, all recorded edits/resumes, and deleted/superseded writing remain included. Doomed remains computed from the selected state and that file's endpoint. Playback stays read-only.

Keep local capture storage as the durable append log and use `.replay` as the portable playback artifact. This avoids rewriting a potentially large JSON document per keystroke. Publish at explicit lifecycle boundaries and recover interrupted publication from durable history. This is not a live-updating shared document or an imported editable recording.

#### Proposed module boundaries

| Module | Responsibility |
| --- | --- |
| `src/artifacts/paths.ts` (new) | Derive the exact sibling `.replay` path from a normalized Markdown path, including nested folders, dots, Unicode, and case-insensitive Markdown suffixes. |
| `src/artifacts/registry.ts` (new) | Versioned local ownership/publication records: recording ID, note/artifact paths, durable/published revision, last verified content fingerprint, and pending write intent. No portable payload duplication. |
| `src/artifacts/publisher.ts` (new) | Injected, testable create/update/readback workflow, destination serialization, revision guards, and retry/recovery decisions. |
| `src/artifacts/obsidian-adapter.ts` (new) | Visible file operations through `Vault.create`, `Vault.read`, `Vault.process`, and file-manager rename APIs. Keep internal hidden storage on its existing adapter. |
| `src/artifacts/recording-artifact.ts` (moved/reused) | Pure preparation and verification from `src/export/recording-export.ts`, using the existing parser and serializer. |
| `src/recording/controller.ts`, `replay-access.ts` | Immutable publication boundary after journal flush; same-recording capture exclusion; idempotent retry; relevant source/recording lifecycle notifications. |
| `src/replay/file-controller.ts`, `types.ts` | Load a validated portable file with a generation/revision guard instead of requiring `stoppedSnapshot(notePath)` for playback. The older pure coordinator remains covered as a stopped-snapshot consumer, not the registered file player. |
| `src/ui/replay-view.ts`, `replay-workspace.ts` | Native `FileView` for `.replay`, per-view players, file state/events, icon, invalid-file feedback, and legacy workspace-state migration. |
| `src/ui/recording-controls.ts`, `src/commands/register-commands.ts` | Remove header actions, retain status and alternative recording controls, preserve command IDs, and register configurable Start/Stop shortcuts. |
| `src/main.ts` | Compose services and register `.replay`/view/lifecycle handlers; no feature logic in the entry point. |

Retire `src/ui/export-modal.ts`, `export-workspace.ts`, and the obsolete destination/dialog controller after publication and compatibility routes are wired. Keep/move useful serialization, collision, readback, and race tests rather than discarding those guarantees. Split any growing module before it becomes another controller with unrelated responsibilities.

#### Task 6.1 — Define portable-file ownership and naming

- [x] Document `folder/Note.md` → `folder/Note.replay`, replacing only the final Markdown extension. A root note produces a root recording file. Do not add timestamps, numbered suffixes, or another output-folder setting to the automatic path.
- [x] Register only `replay` with `Plugin.registerExtensions(['replay'], REPLAY_VIEW_TYPE)` after registering its view. Do not register `json`, override Markdown/Canvas, or depend on **Detect all file extensions**.
- [x] Keep `format: 'obsidian-replay'`, `formatVersion: 1`, and existing canonical JSON serialization. Put no local ownership/path metadata in the portable payload.
- [x] Persist a small, versioned ownership registry beside the existing local index. A matching basename, parseable JSON, or identical endpoint alone never establishes ownership of an existing file.
- [x] Before replacing an owned file, verify its full last-published content fingerprint and identity. For the final `Vault.process` callback, compare its current bytes with the bytes just checked; reject intervening external changes instead of overwriting them.
- [x] Preserve any unowned, malformed, imported, or externally modified destination. Show a concise path-specific error asking the user to move/rename the conflicting file and retry; keep the required canonical destination rather than silently selecting another name.

Deliverable: an unambiguous path/ownership contract with fixtures for collisions and external changes.

#### Task 6.2 — Publish automatically without losing capture durability

- [x] On first Start, persist the initial recording, reserve publication ownership, and create/verify its initial-only `.replay` file. Buffer editor changes throughout asynchronous initialization. Do not recreate/rewrite an existing published file on an unchanged Resume.
- [x] On Stop, close capture immediately, await initialization and rename work, flush accepted steps, and take an immutable recording/revision snapshot for publication. Add this boundary inside the stop workflow; do not temporarily report `stopped` merely to call today's `stoppedSnapshot()` and enable playback too early.
- [x] Serialize once per publication. Create if absent; update only the unchanged, locally owned artifact. Use the Vault API so the file is indexed and visible to Obsidian. Recheck recording identity, path, revision, and ownership at commit time.
- [x] Read back the saved bytes and reuse exact JSON comparison, full parse/validation, initial text, step-count, and endpoint verification before marking the publication complete. A zero-edit/empty recording is valid.
- [x] Serialize publication per recording and destination, including overlapping Stop/retry, background repair, and rename work. A stale snapshot must never replace a newer file. Duplicate Stop/retry joins the same operation without duplicate history or files.
- [x] Report **Recording stopped** only after successful history and file persistence. If only publication fails, retain the durable log and pending publication, keep the player disabled for that local recording, and let the existing Stop/retry action finish without recapturing text.
- [x] Keep the prior valid artifact/history recoverable on write/readback/registry failure; do not blindly delete or roll back a file that may have been edited externally. Record write intent so a crash between file creation and registry commit can be reconciled by exact content/identity verification.
- [x] After restart, recording remains stopped. Reconcile pending publication from the last valid durable journal, not unsaved memory. Attempt a best-effort final publication on normal unload, with no promise that asynchronous unload work completes.
- [x] Do no filesystem I/O in editor transaction callbacks and no full JSON publication per keystroke or periodic append flush. Reuse the current buffered journal and queue limits for large notes/many steps.

Deliverable: Start creates the visible file, Stop updates it, and errors/restarts cannot silently discard captured edits or overwrite another artifact.

#### Task 6.3 — Open the artifact as a native read-only file view

- [x] Convert `ReplayView` from `ItemView` to `FileView`, retaining `replay-history` as the registered view type. Use native file state (`file`) and implement file load/unload/rename handling; return `history` from `getIcon()` and derive the tab title from the actual artifact basename.
- [x] Load and fully validate the `.replay` contents through the vault and existing parser. Construct the pure player from that data. Do not require a source Markdown `TFile`, `RecordingController.stoppedSnapshot`, or hidden index/log to play it.
- [x] Give each loaded file view its own player/presentation lifecycle. Remove the global singleton behavior that detaches an earlier Replay leaf when another opens. Respect ordinary tab, split-pane, deferred-view, and popout behavior.
- [x] Preserve the current icon-only toolbar, 0.5×/1×/2×/3×/4× speeds, thin timeline with single-step keyboard navigation, and Doomed. No title/return button, historical-Markdown tooltip, timeline/speed labels, export button, or visible step counter is reintroduced.
- [x] For a registry-owned recording, use explicit local association to pause/disable its players during Start, capture, Stop, and unresolved errors. After verified publication, reload paused and clamp the prior selected step to the new endpoint; invalidate Doomed caches. An unrelated copied file remains independently playable.
- [x] On artifact modification, pause and validate a fresh revision before replacing the player. Ignore stale asynchronous loads; show invalid/unsupported files with disabled controls and a useful message. Never display old data as if it came from a newly invalid file.
- [x] On file rename/move, retain native file navigation; on delete, release playback and follow native missing-file behavior. Close/unload disposes timers, pending seeks, subscriptions, caches, and file references through registered cleanup. Avoid detaching leaves on plugin unload so Obsidian can restore file tabs.
- [x] Keep parsing and rendering untrusted recording text safe: text nodes/highlight spans only, no interpreted recorded HTML or executable content. Validate once per loaded file revision; do not reread/reparse the complete file on every playback tick.

Deliverable: selecting `.replay` in Files opens the player, and the file works alone in another vault. The view/tab uses the existing Lucide `history` icon; verify the native Files presentation without adding private registry or file-explorer DOM patches.

#### Task 6.4 — Remove redundant actions and add configurable shortcuts

- [x] Remove all record/replay/export buttons from the note header, including the recording/saving/error status bar. Keep status in the ribbon icon and tooltip. Remove export from the player and the obsolete export dialog flow.
- [x] Keep the ribbon Start/Stop toggle, note file-menu Start/Stop/retry, and command-palette commands. Keep stable IDs `start-recording` and `stop-recording` so user bindings survive upgrades.
- [x] Propose two uncommon defaults: **Mod+Alt+Shift+R** for Start and **Mod+Alt+Shift+S** for Stop/retry (**⌘⌥⇧R/S** on macOS; **Ctrl+Alt+Shift+R/S** on Windows/Linux). These are candidates, not a claim that every OS/vault leaves them unused. Check stock Obsidian, the test vault, OS-reserved shortcuts, and existing user bindings before finalizing them; never overwrite a user binding to free a key.
- [x] Register shortcuts through the normal command `hotkeys` field and let users change/remove them in **Settings → Hotkeys**, filtered to Replay. Do not create a second keybinding store/editor, global keyboard listeners, or edit `hotkeys.json` directly. Add clear setup instructions in the README.
- [x] Obsidian recommends avoiding default hotkeys because conflicts cannot be ruled out globally. The two requested defaults are an intentional exception; if the configured lint rule requires an exception, scope it to these two command definitions and explain the reason rather than disabling the rule globally.
- [x] Use one context resolver for ribbon/menu/commands: Start requires the intended active Markdown editor; Stop/retry may also resolve an active, locally owned `.replay` file to its capturing source. A standalone recording must not start/stop an unrelated note. Retain existing duplicate-start/stop and save-error checks.
- [x] Preserve `open-history` and `export-recording` IDs as compatibility commands. Route the former to the sibling file and the latter to verify/refresh that managed file when stopped; update display text to **Open recording file** and **Refresh recording file**. Do not retain a hidden second viewer or destination dialog. Remove obsolete replay/export note-menu entries.
- [x] Disclose in recording help/README that the automatically visible file includes deleted/superseded writing and contains changes through the last completed Stop. Keep normal recording free of a repeated confirmation dialog or success-notification spam.

Deliverable: the note header is free of action buttons; recording remains accessible through the requested alternatives and native hotkey options.

#### Task 6.5 — Handle rename, deletion, migration, and recovery

- [x] Source Markdown rename/move remaps the internal identity and moves its unchanged, managed `.replay` companion to the corresponding sibling path. Serialize with capture/publication, use file-manager rename APIs, and account for folder moves that already relocated both files; do not move the same artifact twice.
- [x] If the target companion path conflicts, keep the prior artifact and history, persist the unresolved relocation, and report a retryable error. No other file may be replaced to satisfy the same-folder rule. A source-note rename must not be rolled back by silently changing the live note.
- [x] If the user independently renames/moves a `.replay` artifact, detach it from automatic publication and preserve it as a portable snapshot. The next Start/Stop may create the canonical sibling if free; it must not chase and overwrite the moved copy. Source deletion likewise leaves the portable artifact intact and clears its source association.
- [x] If a managed `.replay` file is deleted, preserve the journal and mark publication missing. Recreate it on the next explicit Start/Stop or compatibility refresh action, not repeatedly in response to the delete event. Never recreate a deleted Markdown source.
- [x] Migrate legacy hidden recordings from their existing index after layout readiness, in small queued batches; validate each recording and create only absent canonical artifacts for existing Markdown sources. Do not scan all vault notes, parse every recording during `onload`, delete legacy history, or claim collisions as owned files. Persist progress and make interruption/retry idempotent.
- [x] Preserve old `.replay.json` exports. Their payload stays readable by the same parser; document how to copy/rename one to `.replay` without replacing another file. Do not register all `.json` files or automatically adopt external files for recording.
- [x] Migrate saved `replay-history` workspace state containing a Markdown `path` into native `.replay` file state. Resolve/publish its managed artifact before opening; handle missing/invalid sources without a restore loop. Opening future tabs persists the artifact path.
- [x] Upgrade local registry bookkeeping independently of the portable format, retaining current IDs/index mappings and existing custom Start/Stop keybindings. The dev vault must keep its build-file symlinks and vault-local `recordings/` directory.

Deliverable: existing users keep their captured history and keybindings, while existing and new recordings gain visible portable files without destructive migration.

#### Task 6.6 — Verify and document the complete change

- [x] Add pure path/registry/publisher tests: initial-only creation, complete Stop, Resume, duplicate retries, initial/append/readback failures, truncated files, registry crash recovery, queued stale writes, rename races, case/path collisions, external edits, deletion, and migration interrupted/repeated.
- [x] Extend real controller/store integration tests to prove that captured transactions during initial publication are retained; durable log success plus publication failure is retryable; an older publication cannot overwrite a newer revision; standalone file playback never needs `stoppedSnapshot()` or a source note.
- [x] Preserve format/engine/Doomed and portability tests using only copied `.replay` contents. Include empty, Unicode, multiline, resumed, many-step, and large-document fixtures. Bound caches and event work; no DOM element per recorded step or historical-document copy per timeline position.
- [ ] Manually check a disposable desktop vault: visible sibling on first Start; correct paused/disabled local player during capture; complete verified file on Stop; file click/tab icon; all player controls; resume/unrecorded edits; note and folder rename; collision; edited/missing file; repeated enable/disable and restart. Verify no stale header/export actions remain.
- [ ] Copy just a `.replay` file to an otherwise clean second vault with Replay enabled. Check native file visibility, `history` tab icon, playback/seeking/Doomed, multiple recordings open together, and no creation or mutation of a source note/internal recording session. Also check a previously exported payload renamed to `.replay`.
- [ ] Verify default shortcut availability and editable/unassignable bindings in **Settings → Hotkeys** on each available OS. Check Start/Stop from the ribbon, note menu, palette, Markdown editor, and owned versus standalone Replay contexts. Record actual conflicts/platform limits rather than claiming universal availability.
- [ ] Check the thin timeline with a large note and many recorded steps, light/dark themes, narrow panes, keyboard and pointer scrubbing, native Files behavior, split/popout tabs, and one mobile device. Test the declared minimum Obsidian version or document the unverified matrix; bump `minAppVersion` only if a new API requires it.
- [x] Update `README.md`, `docs/RECORDING_FORMAT.md`, and `docs/STORAGE.md` to distinguish the append journal, portable artifact, publication timing, recovery, visible deleted writing, sharing, icon, and shortcut configuration. Replace current manual-export instructions only when the new implementation works.
- [x] Run `npm test`, `npm run lint`, `npm run build`, and `npm run check:release`. Reload the linked build in the test vault and visually verify it. Keep generated bundles, vault data, and test recordings out of commits. Mark tasks complete only with corresponding implementation/verification evidence; no release/tag/publication is part of this plan.

Deliverable: the complete record → automatic `.replay` file → native playback → copy/share journey works with preserved durability, migration, and documented platform results.

#### Verification record — 2026-10-17

Automated verification: **231 tests pass**; production build, lint, release artifact checks, and `git diff --check` pass. Obsolete dialog/destination test cases were replaced with tests for automatic publication, recovery, collision protection, and native file-player behavior.

The native file workflow was smoke-tested on macOS with Obsidian 1.13.7 in the existing disposable test vault using build-file symlinks. Migration created five visible `.replay` files (including empty and 65-step recordings); hashes confirmed all 22 pre-existing Markdown/history files were byte-identical afterward. File selection opened the native player with the `history` tab icon, minimal toolbar, and no export button. Stepping and Doomed were exercised.

A new isolated note captured `Alpha` → `Alpha\nBeta` using the default Start/Stop shortcuts. Start created the companion; Stop produced exactly one portable edit. Resume disabled its already-open player; Stop invoked from the owned Replay tab restored paused playback at its previous selected step. A separate copied recording with no source note or ownership entry played to its endpoint. Multiple file-backed views coexisted. Both shortcuts appeared as editable/removable entries in Settings → Hotkeys, with no conflict shown in this vault. Renaming the test source through Obsidian moved its companion and retained the local recording identity. Open recording tabs and deferred tabs after reload both followed source renames, including their persisted file paths and displayed titles.

Automated tests additionally cover publication-only failures with durable capture, edits buffered during initial file creation, external edits, create/readback/registry failures, lost create/rename acknowledgements, stale publications, collision protection, folder moves, detached snapshots, malformed/versioned files, asynchronous file-load disposal, and a 54,000-character initial note with 2,000 edits. The obsolete destination-dialog tests were replaced by these publication/file-player tests; portable JSON/engine/Doomed tests remain.

A fully isolated second-vault manual pass, extended rename/move/collision/popout/disable-reenable matrix, iOS/Android, Windows/Linux shortcut checks, and Obsidian 1.7.2 remain unverified. These are device verification gaps, not claims of tested compatibility. No release/tag/publication was performed.

#### API references and implementation order

Use the public [extension registration API](https://github.com/obsidianmd/obsidian-developer-docs/blob/main/en/Reference/TypeScript%20API/Plugin/registerExtensions.md), [Obsidian API types](https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts) for `FileView`, `registerView`, Vault/file events and command hotkeys, and the [plugin guidelines](https://github.com/obsidianmd/obsidian-developer-docs/blob/main/en/Plugins/Releasing/Plugin%20guidelines.md) for lifecycle, vault writes, and shortcut conflicts.

Implement naming/ownership → publisher and controller integration → native file view → simplified controls/hotkeys → migration/recovery → full verification and usage docs. Build and verify the replacement workflow before removing the working export/open entry points. Retain milestones 1–5 above as historical evidence, not as requirements to keep the superseded UI.

## Verification and definition of done

Automated coverage must include:

- Insert/delete/replace at boundaries; empty/multiline documents; quotes, tabs, Unicode, and multiple changes per transaction.
- Generated edit sequences replayed forwards/backwards, sequence gaps, invalid ranges, mismatched text, and unsupported versions.
- First Start with no later edits; repeated Start/Stop; unchanged Resume; changed Resume as one step; replay/recording exclusion.
- Storage reload, incomplete final records followed by safe append, malformed complete records, metadata lag, failed writes, retry without duplicates, and rename mapping.
- Playback endpoint, pause/navigation/resume cleanup, constant step intervals despite timestamp gaps, and no mutation of live text.
- Doomed for deletions, replacements, repeated text, moved text, identical endpoints after retyping, Unicode, and a changed final endpoint after resume.
- Portable-file parsing and reconstruction from `.replay` alone, including initial-only recordings, plus all milestone 6 publication, file-view, migration, and collision checks.

The manual pass must cover the complete PROJECT.md journey on desktop and one mobile platform: an existing article, two independent files, typing/paste/undo/redo, Stop and unrecorded edits, Resume, restart, rename, all replay controls, Doomed, automatic `.replay` publication, configurable shortcuts, and standalone file playback. Verify the live note is unchanged by every replay operation and that recording never captures playback text.

MVP completion requires all PROJECT.md acceptance scenarios, the new automated test command, `npm run lint`, and `npm run build` to pass. Record any platform checks that could not actually be performed; do not claim them as verified. Commit no generated build artifacts. Introduce no network requests, telemetry, or automatic uploads.

## After MVP

Only revisit additional features after the complete journey works and usage identifies a need. Possible later work includes compression, persistent reconstruction snapshots, multiple recordings per file, adopting imported history for continued editing, retention/deletion controls, and richer exploration tools. Opening `.replay` files for playback is part of milestone 6, not future import work. The separately planned online sharing/playback service consumes the portable format and remains outside this plugin plan.
