---
description: Specify the portable Replay JSON format, validation rules, and playback behavior.
---

# Replay recording format, version 1

This is the portable recording contract used by [PLAN.md](PLAN.md) and the pure modules in `src/recording/`. It describes a readable, uncompressed JSON file, named `<note-name>.replay`. Earlier `.replay.json` exports contain the same version 1 JSON and may be copied/renamed to `.replay` for playback. The plugin automatically maintains the visible recording file and opens it as a native read-only file tab.

## File structure

The root object requires `format: "obsidian-replay"`, `formatVersion: 1`, an `initialText` string, and a `steps` array. An empty array is valid: starting and stopping without edits still records the complete initial document.

Each step requires a positive safe-integer `sequence`, a `kind` of `edit` or `resume`, and a nonempty `changes` array. Sequences must be exactly `1, 2, …` in array order. At least one change must actually change text. A step may contain several simultaneous changes; it remains one playback and navigation step.

Each change contains:

| Field | Meaning |
| --- | --- |
| `fromBefore`, `toBefore` | Half-open range `[fromBefore, toBefore)` in the complete document before the step. |
| `fromAfter`, `toAfter` | Half-open range in the complete document after the step. |
| `deletedText` | Exact text in the before range; empty for insertion. |
| `insertedText` | Exact text in the after range; empty for deletion. |

All offsets and string lengths use JavaScript UTF-16 code units, not Unicode code points or grapheme counts. For example, `😀` occupies two units. Do not normalize Unicode, whitespace, or line endings. JSON escaping is ordinary syntax; the decoded strings preserve the original captured text, including tabs, CRLF, and lone surrogate code units.

No timestamps, note IDs, vault paths, snapshots, compiled code, or external resources are needed. Unknown additional fields may be read and ignored by version 1 readers; the serializer writes only the documented fields. Unknown format identifiers, versions, or step kinds are rejected. Changing required semantics requires a new version.

## Coordinate invariants

1. All offsets are nonnegative safe integers. Each start is at most its corresponding end, and ranges fit their respective documents.
2. `toBefore - fromBefore === deletedText.length` and `toAfter - fromAfter === insertedText.length`.
3. Changes are in strictly increasing `fromBefore` order. Their before ranges and after ranges cannot overlap. Adjacent ranges are allowed.
4. For each change, `fromAfter` equals `fromBefore` plus the sum of `insertedText.length - deletedText.length` for all preceding changes. This and the length rules determine `toAfter`.
5. Same-position before changes must be coalesced into a single replacement by the producer; readers reject ambiguous duplicate starts. Adjacent deletions may share an after start. Keep their original array order for deterministic reversal.
6. Every deleted string must match its exact range in the unchanged before document. Reversal checks every inserted string against the unchanged after document.

Validate the entire step before modifying an in-memory string. A malformed step cannot produce a partially accepted historical state.

## Reconstruction and reversal

Sequence `0` is `initialText`. To reach sequence `n`, apply steps `1` through `n`. Reject negative, fractional, missing, or out-of-range sequence selections.

For forward application, validate every change against the original before state, then iterate the changes array from last to first, replacing each before range with `insertedText`.

For reversal, validate against the original after state, then iterate the array from last to first, replacing each after range with `deletedText`. Iterating backwards also resolves ties between after starts created by adjacent deletions. Neither operation sorts or mutates the stored changes.

Before accepting an exported recording, validate its complete shape and replay every step, not just the prefix currently displayed. JSON syntax errors, invalid ranges, text mismatches, and unsupported versions fail explicitly. The pure `getStateAt` function checks the recording shape and sequence order, then validates the steps it traverses; use `parseRecording` to fully validate an external file first.

## Resume semantics

A `resume` step must contain exactly one change spanning the whole preceding document and the whole resulting document. It moves directly from the last recorded state to the current live document after unrecorded work. The missing edits are not inferred. If the texts are equal, the producer adds no resume step.

Resuming keeps the original initial state and earlier steps in the same recording. The new endpoint becomes the final state at the next Stop. Persistent recording state and the note-to-recording association belong to local storage, outside this portable format.

## Playback and Doomed

Playback advances at an adjustable steady number of steps per second. At 1×, each recorded step takes 150 ms (about 6.67 steps per second), matching the 13 Sentences demo. Every step gets the same interval, including multi-change edits, large pastes, and resume replacements. Original typing delays and inactive periods contribute no waiting time. A timeline selects sequences from `0` to `steps.length`.

The final state is the reconstruction at `steps.length`. Doomed is a deterministic text comparison between the selected state and that final state: highlight deleted/replaced ranges on the selected-state side, leaving unchanged spans clear. Do not insert final-only text into a historical display. Character provenance is irrelevant. Identical states have no doomed text even if intervening edits deleted and retyped it. The plugin now implements this as a local, deterministic Myers-style comparison over Unicode code points. It trims exact common prefixes and suffixes, then prefers deletion when frontier positions tie. Prefix trimming retains the earliest equal prefix; suffix trimming retains an equal ending without overlapping that prefix. There is no whitespace normalization, word expansion, move detection, or semantic cleanup. Ranges are half-open UTF-16 offsets into the selected string, merged when adjacent. Combining marks, ZWJ sequences, and variation selectors can be compared as separate code points; surrogate pairs are never split, and the original text is always preserved exactly.

Representative historical-side alignments:

| Selected text | Final text | Highlighted selected text / UTF-16 ranges |
| --- | --- | --- |
| `The cat sleeps.` | `The dog sleeps.` | `cat`, `[4, 7)` |
| `abc` | `aNEWbc!` | None; final-only insertions are not displayed. |
| `aaaa` | `aa` | The last two letters, `[2, 4)`. |
| `ab` | `ba` | The first `a`, `[0, 1)`; the historical `b` is retained. |
| `one two` | `two one` | `one `, `[0, 4)`; moved text has no special identity. |
| `draft` | `final` | `dra` and `t`, `[0, 3)` and `[4, 5)`; `f` is retained by the character alignment. |
| `x😀y` | `xy` | The complete emoji, `[1, 3)`. |
| `e` followed by U+0301 | `e` | Only the combining accent, `[1, 2)`; no normalization. |

These are the plugin's current alignment rules, not extra persisted fields or a version change. A consumer needs only the two reconstructed strings to compute Doomed; it need not inspect intervening edits or vault data.

Comparison work is bounded per selected step. Nontrivial inputs are limited to 500,000 combined UTF-16 code units, 500,000 frontier/snake operations, and 131,072 stored 32-bit frontier cells (at most 512 KiB of trace cells, plus bounded token/offset arrays). Identical strings, empty selected text, and an empty final state have direct results without the tokenized diff. Exhausting a limit is an explicit unavailable result, not a successful empty diff or an approximate whole-block highlight. The view then displays the selected historical document without Doomed marks and a short message while normal playback/navigation remains usable.

The presentation cache belongs to the loaded replay player, holds at most 16 step results and 4,096 highlight ranges, and reuses the current result across unrelated control updates. It stores no historical document copies, disk snapshots, or portable metadata. New player bindings, including Resume/Stop/reopen or a rename reload, clear it without resetting the saved toggle preference.

Ordinary Markdown is rendered through Obsidian's public `MarkdownRenderer.render` API in a read-only document surface. Doomed keeps that formatted surface. Both snapshots are rendered unchanged; text-node projections are compared using the same bounded code-point comparison, with separators between blocks/table cells and at line breaks. Controls, decorative icons, and hidden elements are excluded. Differing selected-side text slices are wrapped in native `<mark>` elements inside their existing formatted ancestors. Existing author highlights remain intact. Differences only in hidden Markdown syntax, comments, or link destinations do not highlight identical visible words. Exact-source fallback retains the original source comparison and safe text-node/span rendering. No highlight markup or display mode is persisted in the portable file, and toggling Doomed does not change sequence, speed, or playback state.

Native rendering is asynchronous. Each view retains at most one in-flight render, one latest pending request, and its committed document. Superseded results cannot commit; the latest selected state settles after playback/seek finishes. File/player changes and disposal invalidate pending work and unload native render children. Rendering errors display exact selected source while playback remains usable.

Doomed additionally renders the final state once per loaded file revision/path and caches its text projection, releasing its native render component after extraction. File/player changes and disposal release that reference. A final state rejected by the preview preflight, rendering failure, or comparison work limit leaves the selected formatted document visible with the comparison-unavailable message. No speculative diff is shown.

The Doomed highlight color is a validated six-digit hex preference in local plugin settings, defaulting to `#ffea00`. It applies to owned native marks and exact-source spans, with contrasting black/white text; authored Markdown marks keep theme styling. Color changes update view styling without rerendering, moving the timeline, or changing playback. They share serialized local preference writes with playback rate and are never serialized into recordings.

The `doomedEnabled` boolean is also a local plugin preference. Missing or invalid values default to false. The on/off choice is shared across open replay tabs and restored for new files and future sessions. A file's unavailable/loading state, view disposal, or comparison-cache invalidation does not overwrite that choice. Toggle, color, and speed changes share serialized preference writes; a failed save keeps the in-session choice and reports the failure. None of these preferences is part of the portable format.

A conservative preflight uses exact-source fallback for HTML, images/embeds, named code fences, and inline query syntax before calling Obsidian's rendering pipeline. Unnamed fenced code and ordinary Markdown remain renderable. No remote resources or active code-block handlers are invoked for constructs rejected by that preflight. Installed third-party Markdown post-processors can affect otherwise ordinary Markdown; Replay does not claim to sandbox arbitrary installed plugins. Internal link context is the actual `.replay` path in the recipient vault, independent of source-note ownership. No local or remote assets are added to the recording format.

## Errors and serialization

The implementation exposes `RecordingError` with a stable `code`: `format`, `version`, `sequence`, `range`, or `text-mismatch`. Optional location fields are `stepIndex` (zero-based array index), `sequence`, and `changeIndex` (zero-based within the step). Error messages do not include document text.

`parseRecording` checks JSON syntax, runtime types, and full reconstruction. `serializeRecording` validates the complete recording, writes only portable fields in the order shown below, uses two-space indentation, and adds one trailing newline. No compression, Base64, or opaque binary payload is used. Export intentionally includes deleted and superseded writing.

## Saving and verifying a portable file

Start creates `<note-folder>/<note-basename>.replay` with the complete initial state. Stop flushes the local append log and publishes the complete recording, not the currently selected replay step or Doomed spans. During capture the portable file remains at its previous published state. Avoid serializing the full recording on each keystroke.

The producer retains local ownership, publication sequence, content fingerprint, and pending write intent outside this format. Automatic updates require an owned file whose current bytes match its last verified publication or recoverable pending write. Visible files use the Vault API and checked replacement; collisions or external edits are preserved. Publication success requires exact readback plus complete parsing, initial-text, step-count, and endpoint verification.

Only the portable bytes are inputs to playback: call `parseRecording`, reconstruct sequences `0..steps.length` with `getStateAt`, reverse with `reverseStep`, and compute `compareDoomed` against the final state. A source note, note path, local recording ID, index/log, or source vault is unnecessary. A recipient needs Replay enabled in Obsidian. Imported files are not adopted for further capture.

The recording includes deleted/superseded writing and literal document strings; document contents are not redacted. No source paths, ownership metadata, executable UI, or highlight spans are added. There is no upload, compression, Base64 payload, or format-version change. Viewer comparison limits may disable highlights without invalidating a recording.

## Tested examples

The following JSON examples are identical to fixtures under `tests/recording/fixtures/`. Automated tests parse the documentation's examples and verify every expected state in both directions.

### Initial document only

Sequence 0 is `An existing article.\r\nSecond line.` (the escape sequences denote the actual CRLF). There are no later states.

```json
{
  "format": "obsidian-replay",
  "formatVersion": 1,
  "initialText": "An existing article.\r\nSecond line.",
  "steps": []
}
```

### Insertions

Sequence 0 is empty; sequence 1 is `Hello`; sequence 2 is `Hello, world!`.

```json
{
  "format": "obsidian-replay",
  "formatVersion": 1,
  "initialText": "",
  "steps": [
    {
      "sequence": 1,
      "kind": "edit",
      "changes": [
        {
          "fromBefore": 0,
          "toBefore": 0,
          "fromAfter": 0,
          "toAfter": 5,
          "deletedText": "",
          "insertedText": "Hello"
        }
      ]
    },
    {
      "sequence": 2,
      "kind": "edit",
      "changes": [
        {
          "fromBefore": 5,
          "toBefore": 5,
          "fromAfter": 5,
          "toAfter": 13,
          "deletedText": "",
          "insertedText": ", world!"
        }
      ]
    }
  ]
}
```

### Replacement and deletion

Sequence 0 is `The cat sleeps.`; sequence 1 is `The dog sleeps.`; sequence 2 is `The dog.`.

```json
{
  "format": "obsidian-replay",
  "formatVersion": 1,
  "initialText": "The cat sleeps.",
  "steps": [
    {
      "sequence": 1,
      "kind": "edit",
      "changes": [
        {
          "fromBefore": 4,
          "toBefore": 7,
          "fromAfter": 4,
          "toAfter": 7,
          "deletedText": "cat",
          "insertedText": "dog"
        }
      ]
    },
    {
      "sequence": 2,
      "kind": "edit",
      "changes": [
        {
          "fromBefore": 7,
          "toBefore": 14,
          "fromAfter": 7,
          "toAfter": 7,
          "deletedText": " sleeps",
          "insertedText": ""
        }
      ]
    }
  ]
}
```

### Multiple changes and adjacent deletions

Sequence 0 is `abcdef`; sequence 1 is `AAbc!f`; sequence 2 is `AA!f`. Step 1 includes an expansion before another replacement. Step 2 tests adjacent deletions whose after starts are both 2.

```json
{
  "format": "obsidian-replay",
  "formatVersion": 1,
  "initialText": "abcdef",
  "steps": [
    {
      "sequence": 1,
      "kind": "edit",
      "changes": [
        {
          "fromBefore": 0,
          "toBefore": 1,
          "fromAfter": 0,
          "toAfter": 2,
          "deletedText": "a",
          "insertedText": "AA"
        },
        {
          "fromBefore": 3,
          "toBefore": 5,
          "fromAfter": 4,
          "toAfter": 5,
          "deletedText": "de",
          "insertedText": "!"
        }
      ]
    },
    {
      "sequence": 2,
      "kind": "edit",
      "changes": [
        {
          "fromBefore": 2,
          "toBefore": 3,
          "fromAfter": 2,
          "toAfter": 2,
          "deletedText": "b",
          "insertedText": ""
        },
        {
          "fromBefore": 3,
          "toBefore": 4,
          "fromAfter": 2,
          "toAfter": 2,
          "deletedText": "c",
          "insertedText": ""
        }
      ]
    }
  ]
}
```

### Resume after unrecorded work

Sequence 0 is `The cat sleeps.`; sequence 1 is `The dog sleeps.`; sequence 2 jumps to `A new article.`; sequence 3 is `A new article. Done.`. Step 2 records the resumed document in one transition.

```json
{
  "format": "obsidian-replay",
  "formatVersion": 1,
  "initialText": "The cat sleeps.",
  "steps": [
    {
      "sequence": 1,
      "kind": "edit",
      "changes": [
        {
          "fromBefore": 4,
          "toBefore": 7,
          "fromAfter": 4,
          "toAfter": 7,
          "deletedText": "cat",
          "insertedText": "dog"
        }
      ]
    },
    {
      "sequence": 2,
      "kind": "resume",
      "changes": [
        {
          "fromBefore": 0,
          "toBefore": 15,
          "fromAfter": 0,
          "toAfter": 14,
          "deletedText": "The dog sleeps.",
          "insertedText": "A new article."
        }
      ]
    },
    {
      "sequence": 3,
      "kind": "edit",
      "changes": [
        {
          "fromBefore": 14,
          "toBefore": 14,
          "fromAfter": 14,
          "toAfter": 20,
          "deletedText": "",
          "insertedText": " Done."
        }
      ]
    }
  ]
}
```
