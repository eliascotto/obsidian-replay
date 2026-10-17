# Replay: project definition

Status: product specification. The `.replay` file workflow below was agreed and implemented on 2026-10-17; verification coverage is tracked in PLAN.md.

This document defines what Replay is intended to do. It is the product source of truth. [PLAN.md](docs/PLAN.md) defines how the MVP will be built and must follow this definition where the two disagree. This document does not describe functionality already implemented.

## Purpose

Replay brings the Stypi writing-playback concept into Obsidian. A writer deliberately records work on a Markdown note, then watches or shares the process by which that writing took shape.

The primary goal is to **watch and share the writing process unfold**. The record includes false starts, deletions, replacements, and revisions, making the process visible beyond the finished article.

The motivation comes from Paul Graham's [Watch Me Make Mistakes](https://paulgraham.com/stypi.html): replay exposes repeated attempts, stretches of fluent writing, and later revision. Its highlighting of text that will eventually disappear is an essential reference for Replay's **Doomed** feature. The [playback example hosted by Byron](https://byronm.com/13sentences.html) is the interaction reference for playback rate and doomed-text highlighting.

## Primary user journey

1. Open a Markdown note in Obsidian. It may already contain text.
2. Select **Start recording** from the ribbon, note file menu, command palette, or configured shortcut. Replay automatically creates `<note-name>.replay` beside the note.
3. Write and revise normally. Replay records the changes while recording is active.
4. Select **Stop recording**. Replay saves the captured changes and updates the companion `.replay` file with the complete recording.
5. Select the `.replay` file in Obsidian’s Files pane to open its read-only player. Select **Play**, change the playback speed, step through changes, or drag the timeline.
6. Toggle **Doomed** to compare the selected step with the final recorded step and highlight the differing text in the selected step.
7. Copy or share the `.replay` file directly. Someone with Replay enabled can open it in another vault without the original Markdown note or hidden recording data; no separate export action is needed.

A separate online service may later play these same portable recordings. Hosted sharing, uploads, and a standalone browser player remain outside the plugin scope; opening a shared `.replay` file inside Obsidian is now required.

The writer can also start recording again after stopping. This continues the same recording, including when the writer resumes on another day.

## Recording is explicit and per note

- Recording begins only when the user selects **Start recording** for a file.
- The MVP supports exactly one recording per file. Creating separate recordings or managing multiple recordings for the same file is outside MVP scope.
- Starting the first recording captures the entire current document as its initial state. Earlier writing cannot be reconstructed from that recording.
- While recording is active, capture text-changing editor operations, including typing, paste, deletion, replacement, undo, and redo.
- Record the actual text changes with enough information to reconstruct every recorded state exactly.
- **Stop recording** ends capture for that note and establishes the current final state of the recording.
- Edits made after stopping do not change the stopped recording or its final state.
- Starting again appends to the same recording rather than discarding its earlier history.
- Previously captured states must survive an Obsidian restart. Durable storage does not imply recording should start automatically.

The distinction between the live note and its recording must remain clear. The live note may continue changing while a recording is stopped.

## Resuming after unrecorded changes

Unrecorded work is the user's responsibility. Replay does not need to recover missing edits, infer how they happened, or prevent the user from continuing the recording.

When the user starts recording again:

1. Read the current complete document.
2. If it matches the last recorded state, continue from there.
3. If it differs, make that current document the next recorded state, then capture subsequent edits normally.

The transition to that current document is one navigable step. It must preserve the earlier history and must not fabricate a sequence of typing operations for the unrecorded interval. Whether it is stored as a complete state or a replacement event is an implementation decision.

Example:

```text
Recorded state at stop:       The cat sleeps.
Unrecorded changes:           The dog sleeps outside.
Recorded state after resume:  The dog sleeps outside.
Next recorded edit:           The dog sleeps outside. It is warm.
```

Playback moves directly from the first state to the resumed state. There is no reconstruction of how “cat” became “dog” or how “outside” was added.

Handling sync, Git, or other external edits as a comprehensive version-history system is outside the core product scope. In particular, a difference discovered at an explicit restart of recording is an expected transition, not an error that blocks recording. This does not remove the need to detect genuine corruption in a recording file.

## Replay experience

Register `.replay` as a custom file extension. Selecting a valid `.replay` file opens a native file-backed tab with these replay controls:

- **Play / Pause**.
- **Playback rate**.
- **Previous step** and **Next step**.
- A draggable **timeline** showing the selected position.
- A **Doomed** toggle.

Keep **Start recording / Stop recording** in the ribbon, note file menu, command palette, and two configurable keyboard shortcuts. Remove the recording action, open-replay action, and export action from the note header; remove export from the player. A compact, non-interactive recording/saving/error status may remain above the note. Configure shortcuts through **Settings → Hotkeys**. The `.replay` view and tab use the existing Lucide `history` icon, previously used for **Open replay**.

Recording and replay remain mutually exclusive for the same locally managed recording. While its source note is starting, recording, saving, or in an unresolved save error, pause and disable its `.replay` player. A successful Stop refreshes that file and enables replay without starting playback. A copied or shared recording has no dependency on a source note and plays independently. Never infer a recording association from a matching filename alone.

The replay displays the same note as it existed at the selected recorded point, in a read-only viewing surface. Watching or navigating a recording must not save historical text over the live document or generate recorded edits.

Dragging the timeline updates the displayed text to the selected point. Manual navigation pauses automatic playback. Previous and next move by one recorded text-change step; a resume transition counts as one step. Both the initial and final recorded states must be reachable.

Playback starts at the selected position, advances through the recorded changes at a steady adjustable edit rate, and stops at the end. Playback rate controls the number of recorded steps shown per unit of playback time. A paste, replacement, or resume transition is one recorded step even if it changes many characters.

### Time and pauses

Original typing delays and pauses take no playback time. Stopping today and resuming tomorrow introduces no overnight pause. Each successive recorded step receives the same playback interval at the selected rate, regardless of the wall-clock delay between edits.

Playback and the timeline use recorded-step progression, so dragging to a position and playing through that position show the same state. Timeline positions represent recorded steps rather than elapsed real-world time. At a given playback rate, the replay duration depends on the number of steps. Wall-clock timestamps may be retained as metadata but do not determine playback timing or timeline spacing.

The default rate and available rate controls are UI decisions. There is no requirement for an original-timing playback mode or an idle-gap threshold.

## Doomed highlighting

**Doomed** compares the text at the selected recorded step with the text at the last recorded step. It highlights the words or letters in the selected step that differ from the final document. Text maintained intact in the comparison is not highlighted. The user can toggle this treatment while playing or exploring the stopped recording.

The reference interaction highlights doomed text in yellow. Replay should make the highlight clear and readable within Obsidian themes; the exact visual styling is an implementation detail.

- Highlight only text present in the displayed historical state.
- Compute a text diff between the selected recorded state and the final recorded state. The current live note is not the comparison target.
- Highlight deleted or replaced portions on the selected-state side of that diff. Text that exists only in the final state is not added to the historical display.
- Keep the underlying recorded text unchanged; highlighting is a viewing layer.
- A stopped recording has a fixed final state until it is resumed.
- When that recording is resumed and later stopped again, its new final state becomes the reference for the entire recording. Earlier doomed highlighting can consequently change.
- At the final recorded state, no text is doomed relative to that same state.

Doomed depends only on those two document states. It does not track character identity or survival through intervening edits. Moved or retyped text receives the treatment produced by the same text comparison, with no special provenance rules. If the selected state and final state are identical, nothing is highlighted, even if text was deleted and retyped between them. The diff algorithm and alignment are implementation details; they must apply this comparison consistently.

**Doomed is part of the defined product scope.** It should appear explicitly in the revised delivery plan rather than disappear into an unspecified list of future visual enhancements. Its implementation can follow reliable capture and basic playback.

## A recording is a self-contained, shareable artifact

Replay automatically maintains one **`<note-name>.replay`** file beside each recorded Markdown note, for example `Essays/Article.md` → `Essays/Article.replay`. It is a normal visible vault file, self-contained and ready to copy/share.

The file contains readable, uncompressed JSON using the existing version 1 recording schema: format identifier/version, complete initial text, ordered edit/resume steps, and enough data to reconstruct every state and compute Doomed. The new extension does not itself require a format version change. It must not require vault paths, local recording IDs, external resources, executable code, or hidden plugin storage for playback.

On the first Start, create an initial-only `.replay` file once initialization succeeds, while buffering edits captured during initialization. During capture, keep using efficient buffered internal writes. Publish the complete recording after each successful Stop; do not rewrite the entire JSON file on every keystroke. Until then, the file represents the initial state or last completed Stop. Explain that Stop updates the shareable file.

A successful Stop means both the internal history and the visible file have been saved and verified. If publication fails, keep the durable history and last valid file, show a retryable save error, and do not silently report completion. Reconcile interrupted publication against the durable log after restart.

Automatic publication may replace only an artifact that this recording owns and whose contents have not changed externally. Preserve conflicting, imported, or edited files and explain how to resolve the collision. Keep ownership and publication bookkeeping in local storage, outside the portable JSON.

The file includes deleted and superseded writing. Disclose that in recording setup/help and the README, since there will no longer be an export confirmation dialog. No upload or network service is involved.

Opening `.replay` is playback, not importing it into the note's active recording. The original Markdown note and internal history need not exist. The recipient needs Replay enabled in Obsidian. A separate web service, upload integration, editable/imported recording sessions, and a standalone browser player remain outside scope.

## Scope boundaries

Required product capabilities:

- One recording per Markdown file, with explicit start, stop, and continuation.
- Complete starting text and exact reconstruction of all captured text-change steps.
- Persistence across restarts.
- Direct continuation from the current document after unrecorded work.
- Read-only replay with adjustable rate, step controls, and timeline navigation, available only while recording is stopped.
- A steady adjustable edit rate and a timeline based on recorded steps, with no original pauses.
- Doomed highlighting based on a text diff between the selected recorded step and the final recorded step.
- Automatic creation and verified updates of a visible sibling `.replay` file; native file-based playback and direct sharing of that self-contained, readable, uncompressed file.
- Start/Stop through ribbon, file menu, command palette, and two configurable shortcuts, without redundant header action buttons.
- Local operation without requiring a cloud account or sending vault content to an external service.

Not required by this product definition:

- Automatic recording of every note in the vault.
- Creating or managing multiple recordings for the same file.
- Simultaneous recording and replay, including active-recording previews.
- Recovery or reconstruction of work performed before recording or while it was stopped.
- Automatic reconciliation of edits across devices, Git, sync, or external editors.
- Deleted-passage recovery tools or restoring historical states into the live note.
- Draft comparison, writing statistics, or semantic analysis of revisions.
- Collaborative editing, hosted sharing, or a publishing service within the plugin MVP. The planned online sharing and playback service is a separate project.
- Upload integration, adopting imported recordings as editable recording sessions, or a standalone browser player. Opening portable files for playback is in scope.
- Compressed, opaque binary, or Base64-encoded exports for the MVP.
- Recording cursor movement, selections, or editor scrolling.

Retention controls, history deletion, storage limits, snapshot frequency, compression, and other supporting features may be specified separately. They must not displace the primary recording-and-sharing journey or be treated as agreed requirements solely because they appeared in earlier planning discussions.

## Acceptance scenarios

1. **Record an existing article:** start with nonempty Markdown, start recording, revise it, and stop. Replay begins with the exact starting article and ends with the exact text at stop.
2. **Explore the process:** play, pause, change rate, step backwards and forwards, and drag the timeline. Every position shows the corresponding recorded text without changing the live note. At a selected rate, successive steps have equal playback intervals regardless of original typing delays.
3. **Continue tomorrow:** stop, leave the document overnight, and start again. The same recording continues without an overnight playback pause.
4. **Continue after unrecorded work:** stop, change the note, and start again. The next recorded state is the changed document; earlier recorded states remain available.
5. **Separate note from recording:** after stopping, edit the live note. The stopped replay and its doomed analysis remain anchored to the recorded final state.
6. **Inspect doomed text:** at an earlier state, enable Doomed and see the selected-state differences from the final recorded text highlighted, while unchanged text remains unhighlighted. Disable it to see the same historical text without the highlight. Identical selected and final states have no highlighting, including after deletion and retyping.
7. **Extend the ending:** resume, make further revisions, and stop. Replay includes both recording periods, and doomed analysis uses the new ending.
8. **Restart Obsidian:** previously saved recording states remain reconstructable and playable.
9. **Share a recording:** Start creates the sibling `.replay` file and Stop updates it. Open it from Files, then copy it alone into another vault with Replay enabled. Play, seek, and compute Doomed without the original note or hidden history. No export dialog or open-replay button is involved.
10. **Keep recording and replay separate:** while recording, that recording’s `.replay` player is paused/disabled. Stop saves and updates it before enabling playback. Starting again captures only the live Markdown document and retains the existing history.
11. **Use the simplified controls:** no record/replay/export buttons remain in the note header, and no export button remains in the player. The ribbon, note menu, palette, and configurable Start/Stop hotkeys work with the correct active note. Replay files open with the existing `history` tab icon.
12. **Preserve files:** source renames/moves keep the managed companion beside the note without overwriting unrelated files. Publication failures, externally edited artifacts, source deletion, and restart preserve recoverable history and portable recordings.

## Relationship to the implementation plan

Implementation progress and verification results are tracked in [PLAN.md](docs/PLAN.md). This document defines product behavior.

The single implementation plan, [PLAN.md](docs/PLAN.md), must:

- Make explicit start/stop recording and continuation of one recording per file the core capture workflow. Make recording and replay mutually exclusive.
- Automatically maintain a documented, readable, uncompressed `.replay` file beside the note and use that file as the player entry point. Keep hosted sharing/upload and a standalone web player outside scope.
- Preserve the minimal player toolbar, remove redundant header actions, and provide two configurable Start/Stop shortcuts with the existing stable command IDs.
- Add Doomed as a named product feature using a text diff between the selected step and the last recorded step, without tracking text provenance.
- Replace the assumption that every mismatch must stop recording with the required resume transition for unrecorded work.
- Define playback and timeline progression by recorded steps at a steady adjustable rate, with no original delays or pauses.
- Keep exact reconstruction and read-only playback as technical foundations, with milestones that demonstrate the user journey above.
