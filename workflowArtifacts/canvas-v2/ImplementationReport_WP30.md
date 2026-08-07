# Implementation Report — WP30

**Attempt:** 1
**WP:** WP30 — Explicit "Import from file" command (C30, phase P2)

---

## Status

`DONE` — 78/78 visible green on the first run, `tsc --noEmit -skipLibCheck` clean, WP24–WP29 all
still green (407/407), the R4 regression gate green (61/61), full plugin suite
**1833 passed / 0 failed** (reference 1755/0 → delta **+78**, exactly this WP's visible set).

No test file was edited, added or deleted. No `LICENCE_REQUIRED`. No `TOOL_REQUEST`.
**Zero new runtime dependencies** — the pure core imports nothing at all.

---

## Completed Work

| AC | Status | Notes |
|---|---|---|
| **AC1** — the command exists, is reachable from the canvas context, and is the **only** way a file overwrites a living doc | DONE | One `addCommand` in `session/commands.ts` under `IMPORT_FROM_FILE_COMMAND_ID`, registered with `checkCallback` and reachable only when `activeCanvasPathForImport()` names an open canvas leaf. "Only door" is structural, not a claim: the import never seeds the live doc. It stages the file into a **separate** `winner` `Y.Doc` and publishes a wholesale replacement through `CanvasSync.adoptEpochWinner`, which is why it can remove a record the file omits when the surviving seed writer (upsert-only, I7) provably cannot. |
| **AC2** — `epoch++`, seed from the file, peers adopt through the epoch rule while archiving | DONE | `bumpEpoch(winner)` (WP28 owns the increment; WP30 never writes `n + 1`) over the **live board's** epoch as predecessor, then the seed, then the publish — in that order, so at the instant the winner is offered it already carries the file's records *and* `nextEpoch(readEpoch(live))`, and the live doc is still untouched. tp07 meets the published board with three real peer replicas: each archives once, at its own pre-import state, then adopts. |
| **AC3** — a confirmation dialog first, naming what is overwritten and whose work is affected; cancelling performs no write of any kind | DONE | `importConfirmationMessage` interpolates the board path, the live record count and every peer by name (text below). "No write" is a property of the **sequence**, not of a rollback: nothing touches a write channel before `await env.confirm(...)` returns exactly `true`, and the only write channel injected into the env is `adoptEpochWinner`. Any non-`true` answer — including a dismissal, which `ConfirmModal.onClose` already resolves as `false` — is `CANCELLED`. |
| **AC4** — unavailable for a path the client does not own or is degraded on | DONE | `importUnavailableReason` is fail-closed and ordered: `owned !== true` → `UNOWNED`, else `degraded !== false` → `DEGRADED`, else `null`; a `null`/non-object argument reads as `UNOWNED`; it never throws. Both conditions are measured in `main.ts` and asked twice — once in the `checkCallback` guard, once again as step 1 of `runImportFromFile`, so a caller that bypasses the palette is still refused. |

### The six traps, and what was done about each

1. **The dialog text is a deliverable.** It is built by the pure core, not by the modal, so the
   sentence a user reads before their collaborators' work is discarded is unit-testable without a
   DOM. It satisfies containment (path, count, every peer name verbatim), differential
   sensitivity (path, count and peer list each change it independently, and 2 peers ≠ 3 peers),
   family membership (`OVERWRITES`, `discarded`), the coercion guard (no `undefined` / `null` /
   `NaN` / `[object Object]` can be rendered — they are refused with a `TypeError` at the door),
   and the alone-case (names the board, still reads as destructive, invents no collaborator).
2. **Ask first, write after.** The winner document is not even constructed until the confirmation
   has returned `true`. There is no staging to publish and nothing to roll back, so the "no write"
   claim holds at the instant the dialog is open as well as at the end.
3. **The bump's predecessor is the LIVE board's epoch.** Stamped onto the winner's `meta` before
   the seed, so `bumpEpoch(winner)` yields `nextEpoch(readEpoch(live))`. A doc parsed from a
   `.canvas` has no `meta` at all; bumping it alone yields `1` and loses every conflict against a
   board that has ever been imported before. Falsified — see below.
4. **Published through the epoch rule.** The single write is `env.adoptEpochWinner(path, winner)`.
   The live doc receives exactly one transaction and it carries `CANVAS_EPOCH_ADOPT_ORIGIN`, never
   the import's own seed origin.
5. **Never `seedRecordsIntoYMaps(liveDoc, …)`.** The seed writer is used only against the
   **winner**, which is a scratch document destroyed in a `finally`.
6. **AC4 has two independent conditions**, both spelled `!== true` / `!== false`, and `main.ts`
   measures each from a different subsystem.

---

## Blocked Items

None.

### One thing worth flagging, which is a judgement call rather than a defect

`ImportFromFileEnv.peers` is wired to **every remote participant in the session**, not to the
subset whose view happens to be on this board. A participant reading another file still holds a
replica of this canvas, and that replica is what gets archived and replaced — filtering on
`PresenceUser.currentFile` would omit exactly the people whose work is destroyed while they were
not looking. Naming one extra collaborator is a mild over-statement; omitting one is the dialog
failing at the only job AC3 gives it. Nothing in the visible suite binds to this choice (the unit
tests inject the peer list), so it is recorded here and is the natural subject of W4 target 3.

---

## Tools Created

None.

---

## Changes Made

### `plugin/src/canvas/canvas-import-command.ts` — NEW, pure core (§7.0.a)

Imports **nothing** — not Obsidian, not the filesystem, not a clock, not Yjs. Precedents:
`canvas/reconcile-plan.ts`, `files/canvas-seed-decision.ts`. Ships the §7.0.a surface verbatim
(`IMPORT_FROM_FILE_COMMAND_ID`, `IMPORT_FROM_FILE_COMMAND_NAME`, `ImportAvailability`,
`IMPORT_UNAVAILABLE`, `ImportUnavailableReason`, `importUnavailableReason`, `canImportFromFile`,
`ImportAffectedPeer`, `ImportOverwriteSummary`, `importConfirmationMessage`) plus module-private
`typeName`, `assertRecordCount`, `assertNonEmptyString`, `records`, `nameList`.

Two decisions worth naming:

- **`importUnavailableReason` is total and ordered.** It runs inside a `checkCallback`, which
  Obsidian calls on every palette keystroke and whose exceptions it discards — a guard that throws
  there is a guard that is no longer consulted. Ownership is asked first so a path that is both
  unowned and degraded reports `UNOWNED`: telling a user their board is degraded when this client
  simply does not hold it sends them looking for a fault in a board they never subscribed to.
- **`importConfirmationMessage` throws rather than degrading.** Every other refusal in WP30
  returns a status; this one cannot, because the only thing downstream of it is a dialog that asks
  for permission. It refuses a non-object summary, a non-string or empty `canvasPath`, either
  count that is not a non-negative **safe** integer, a non-array `peers`, and any peer whose
  `displayName` is not a non-empty string.

### `plugin/src/files/canvas-import.ts` — NEW, the command core (§7.0.b)

`CANVAS_IMPORT_SEED_ORIGIN` (a `unique symbol`, only ever seen on the winner), `IMPORT_STATUS`,
`ImportStatus`, `ImportFromFileEnv`, `ImportFromFileResult`, `runImportFromFile`, plus
module-private `refusal`, `errorText`, `parseImportSource`, `liveRecordCount`.

The mandated step order is implemented exactly as §7.0.b pins it. Three points:

- **`parseImportSource` is an independent guard, not a formality.** `parseCanvas` swallows a JSON
  error and returns empty records — correct everywhere else (a corrupt file must never throw a
  subscribe) and catastrophic here, because trusting it would read a truncated file as "the user
  wants an empty board" and publish a wholesale delete, under a confirmation that truthfully said
  so. The text is parsed separately and admitted only if it is a JSON **object** with an **array**
  `nodes`. `{"nodes":[],"edges":[]}` is admitted — emptying a board is a legitimate request, and
  refusing it would make "empty" and "corrupt" indistinguishable. One refusal beyond the pinned
  set was added on the same reasoning: an `edges` key that is present but not an array is refused
  too. No visible test supplies one; the rule is WP28's uniform-argument-domain discipline applied
  to the other half of the same document.
- **`liveRecordCount` goes through `buildCanvasData`**, never raw key presence: post-WP19 a removal
  is a tombstone rather than a missing key, and the node→edge cascade applies. A count taken off
  the containers would overstate the board by every suppressed record and every dangling edge, and
  the number in the dialog has to be the number the user sees.
- **`ADOPTION_REFUSED` never throws and is never a success.** The publish is wrapped, the refusal
  message becomes `detail`, `env.notify` names the board and says it is unchanged, and
  `archivedTo` stays `null`. The seam answering `null` (this client holds no doc for the path) is
  the same refusal for the same reason.

### `plugin/src/ui/import-canvas-modal.ts` — NEW (§7.0.c, charter §6's "new modal")

`ImportCanvasConfirmModal extends ConfirmModal` + `confirmImportFromFile(app, summary)`. It adds
exactly two things — the message (built by the pure core) and the retained `summary` — and
inherits everything that makes `ConfirmModal` correct, in particular `onClose` resolving `false`
on dismissal (**dismissal already counts as cancel and needed no new code**) and the `mod-warning`
Confirm button. `importConfirmationMessage` is called in the `super(...)` argument, so a summary
that cannot be stated truthfully throws **before** the modal is constructed and no dialog asking
permission over `undefined` ever opens.

### `plugin/src/session/commands.ts` — one new `addCommand` (§7.0.d)

Registered with `checkCallback`, never `callback`. `commands.ts` has exactly two registration
shapes and AC4 is only expressible in the second — a `callback` registration does not merely fail
AC4, it makes AC4 structurally unimplementable. The guard is two lines and neither re-spells a
decision: `activeCanvasPathForImport() === null → false`, then
`!canImportFromFile(canvasImportAvailability(path)) → false`. The rejection from the async run is
absorbed deliberately (a `checkCallback` is not async and Obsidian discards its result).

### `plugin/src/main.ts` — WIRING ONLY, three new members (§7.0.e)

- **`activeCanvasPathForImport()`** — the active file, only when it is a `.canvas` **and** an open
  canvas leaf is showing it, canonicalised. Everything else (markdown view, no view, non-`.canvas`,
  closed board) is `null`. Wrapped in `try`/`catch`: Obsidian's Canvas view is private and untyped
  (I5 — degrade, never break) and this runs on every palette keystroke.
- **`canvasImportAvailability(path)`** — `owned` is `canvasOwned(path, this.canvasSync)`, the one
  existing ownership predicate (`files/vault-events.ts`); no second one was written.
- **`runCanvasImportFromFile(path)`** — builds the real `ImportFromFileEnv` and calls
  `runImportFromFile`. `adoptEpochWinner` is the only write channel handed over.

**The degradation choice, recorded as §7.0.e asks.** `degraded` is the OR of two *existing*
concepts, and WP30 invented neither:

```text
degraded = seedRefusalLedger(path).hasRefusals()          ← WP63 / I11: this path's seed refused
         ||                                                  records, so the write-back is
         ||                                                  withheld and the doc does not hold
         ||                                                  everything the file did
         || (canvasAdapters.get(path) exists && isAvailable() !== true)
                                                          ← I5 DEGRADE: the private Canvas API
                                                            went away under an open board
```

A path with **no** adapter is deliberately *not* degraded — that is an unopened board, not a
broken one, and `owned` already answers for it. Treating "adapter absent" as degradation would
make the command permanently unavailable on any board whose presence mount had not yet run, which
is an AC4 bypass in the other direction: a guard nobody can ever satisfy is not a guard.

Both are bars rather than caveats because the import publishes a wholesale replacement computed
from a local file and the confirmation quotes what is about to be lost — on a degraded client the
user would be told the wrong thing and would then destroy state they were never shown.

### Not changed, on purpose

`canvas-epoch.ts`, `canvas-seed-decision.ts`, `canvas-sync.ts`, `canvas-schema.ts`,
`canvas-persistence.ts`, `canvas-sidecar*.ts`, `ui/modals.ts`, `canvas-presence.ts`,
`canvas-binding.ts`, `canvas-model-bridge.ts`, `src/__mocks__/obsidian.ts`, `server/`, `docker/`,
`deploy/`, `plugin/main.js`, `manifest.json`, `package.json`, `_run_blind.py`,
`BUILD_SPEC_CanvasV2.md`, and **every test file in the tree**.

---

## Visible Test Results

```text
cd plugin && npx vitest run src/__tests__/v2/wp30
  Test Files  9 passed (9)
       Tests  78 passed (78)
```

| Check | Result |
|---|---|
| `src/__tests__/v2/wp30` | **78 / 78 green** |
| `wp24`+`wp25`+`wp26`+`wp27`+`wp28`+`wp29` | **407 / 407 green** (76 / 59 / 46 / 54 / 104 / 68, unchanged) |
| `w4-canvas-integrity.test.ts` + `v2/wp18` (R4 gate) | **61 / 61 green** |
| `npx tsc --noEmit -skipLibCheck` | **clean, exit 0, zero diagnostics** |
| full plugin suite | **299 files, 1833 passed / 0 failed** |

**Delta vs the reference (1755 / 0): +78 / 0** — exactly this WP's visible set, which rules out an
addition or a deletion anywhere else in the tree. No pre-existing test moved in either direction.

**Biome** (`plugin/node_modules/.bin/biome`, never `npx biome`): the three new files are **clean
under `biome check`** — lint, format and organizeImports, zero findings. `commands.ts` and
`main.ts` each report the single whole-file `format` finding that is the known CRLF environment
artifact (charter §5); both are pre-existing and neither file gained a lint diagnostic.

### Falsification — the two decisions most likely to be got wrong

Both were injected against the delivered suite, measured, and reverted.

| Injection | Result | Reading |
|---|---|---|
| `predecessor = 0` (bump the **staged** doc instead of the live board's successor) | **22 failed**, across tp05 tp06 tp07 tp08 tp09 | The suite binds to the predecessor, not merely to "an epoch was written". Note tp05's *positive control* falls too: with `winner=1` against `live=4` the verdict is `local-wins`, so the confirmed import writes nothing at all — the silent-no-op class this pin exists for. |
| `owned !== true` → `!owned` **and** `degraded !== false` → `degraded === true` | **2 failed** — exactly tp02's and tp03's fail-closed blocks | The boolean rows stay green under a truthiness guard, as the test headers predict; only the unanswered-probe rows discriminate. Nothing else reddened, so the two pins are isolated. |

### Fuzzer wiring (Shared Ownership Contract §7)

**Not registered, and §7 says so itself:** "WP26/WP27/WP30 are structural and are not"
fuzzer-shaped. WP30 is a user-gated command, not a per-window replica mutation; its subject is a
confirmation and an ordering across an injected write channel, neither of which the op registry
can drive. Recorded per §7's "records why rather than forcing a bad fit" clause.

### Foreign edits observed, not touched

`workflowArtifacts/canvas-v2/_blind_records/**` (modified WP26 records; untracked WP25/WP27/WP28/
WP29/**WP30** records) and `tests/blind_set{1,2}/**`. None were read or written by this WP. No
Batch B16 activity was observed in either file WP30 modifies.

---

## Dialog Text

The template is built by `importConfirmationMessage(summary)`. Rendered, with two peers and with
nobody else connected:

```text
Import boards/plan.canvas from the file on disk?

The shared board holds 12 records right now. Importing OVERWRITES the shared board wholesale with
the 3 records in the file: everything on the board that the file does not contain is discarded,
and undo cannot bring it back.

This discards work by Ada Lovelace and Grace Hopper as well as your own. Each of them keeps an
archived conflict copy of their version, and their board becomes this file.
```

```text
Import boards/plan.canvas from the file on disk?

The shared board holds 12 records right now. Importing OVERWRITES the shared board wholesale with
the 1 record in the file: everything on the board that the file does not contain is discarded, and
undo cannot bring it back.

Nobody else is connected to this board right now, so only your own version is replaced. It is
archived as a conflict copy first.
```

(The line breaks above are the report's; the shipped string is four paragraphs separated by blank
lines and is rendered by `ConfirmModal` into a single `<p>`.)

Why it is shaped this way:

- **Both counts, not one.** "12 records become 3" is the sentence that makes an accidental import
  obvious; a single number cannot say it. The singular (`1 record`) exists because a confirmation
  reading "1 records" is machine output, and machine output is skimmed.
- **The peer clause is real text in both directions.** The alone-case is not the with-peers
  sentence with an empty slot: it says something different and true. A message that reads the same
  either way is not telling the user whose work is affected, it is telling them nothing twice.
- **The verb is `OVERWRITES`, and the archive is mentioned last.** The archive is genuine mitigation
  and belongs in the dialog, but putting it before the destruction turns a warning into a
  reassurance.

---

## Summary for Worker 3

WP30 is complete against its four ACs and its 78 visible tests, green on the first run; `tsc` is
clean, WP24–WP29 and the R4 gate are undisturbed, and the full suite is 1833/1833. No test was
touched and no licence was needed, requested or assumed.

Four things to carry forward.

1. **The import is the only door, and it is the only door *structurally*.** It never seeds the live
   doc; it stages a separate winner, raises the epoch on it, and publishes wholesale through
   `CanvasSync.adoptEpochWinner`. WP28's `reconcileEpochOnSubscribe` — inert since it landed,
   because nothing called `bumpEpoch` — **is now live**: this is the first production caller that
   raises an epoch, so the archive path in `canvas-sync.ts` goes from "one integer comparison per
   subscribe" to real behaviour the moment a user runs the command.
2. **`degraded` is a two-term OR over existing concepts** (withholding `SeedRefusalLedger`, an
   adapter that is registered but reports unavailable) and a path with **no** adapter is
   deliberately not degraded. If a later WP adds a third degradation concept for a canvas path, it
   belongs in `LiveSharePlugin.canvasImportAvailability` and nowhere else — the decision stays in
   `canvas-import-command.ts`.
3. **`peers` is every session participant, not just those viewing the board.** Deliberate, and the
   reasoning is in **Blocked Items**; W4 target 3 is where it gets exercised against real clients.
4. **The day-granular archive means a second import of the same board on the same day is refused**
   by `writeConflictCopy`, which cancels the adoption and leaves the board unchanged. That is
   correct and it is `ADOPTION_REFUSED`, notified, never `IMPORTED`. If a future WP wants a second
   same-day import to succeed, the fix belongs in WP28's naming/never-clobber rule, not in a
   relaxation here — WP30 must not spell a conflict-copy name of its own.
