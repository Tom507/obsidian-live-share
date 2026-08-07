# Task Charter — WP30: "Import from file" command

**Charter Status:** `DONE`
**WP:** WP30
**Phase:** P2
**task_mode:** `standard`
**Depends on:** WP28, WP29
**W4 Test Targets:** `3`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** overwriting is an informed decision, never a timing side effect.
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 5, component **C30 — Explicit "Import from file" command** (work package WP30); phase **P2**.

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: create (command + confirmation modal)
  - Responsibility: give the user the named, informed action that replaces the old implicit destructive re-seed.
  - Scope summary: epoch++, confirmation dialog
- **Out of scope / non-goals:**
  - Any implicit or automatic path to overwriting a living doc — this command is the only one.
  - Changing the epoch comparison rule itself — WP28.
- **Known interfaces / dependencies:**
  - Input: user command on an owned canvas
  - Output: `epoch++`, doc seeded from the file, peers follow the epoch rule
  - Depends on work packages: WP28, WP29

---

## 3. Architecture Context

*Task-local architecture guidance only.*

- **Component(s) being changed:** Explicit "Import from file" command
- **Interfaces involved:**
  - Input: user command on an owned canvas
  - Output: `epoch++`, doc seeded from the file, peers follow the epoch rule
- **Constraints from BUILD_SPEC (invariants — what must not change):**
  - Invariants I1–I5 (`ARCHITECTURE.md`) and I6–I10 (CONCEPT_V2 Teil 3) are binding and must not be weakened.
  - Yjs stays. No CRDT library swap, no alternative CRDT introduced anywhere.
  - `CanvasPersistence` remains the single CRDT→disk writer; it emits zero CRDT writes; `coldOpen` runs after `waitForSync` and before `start()`.
  - **Zero new runtime dependencies.** Any dependency at all requires a publish date >= 7 days old (`npm view <pkg>@<version> time.created`); `npm ci` in build/deploy contexts, never `npm install`.
  - `GEOMETRY_KEYS` keeps exactly `{x, y, width, height}` and stays exported (it now describes the *file* schema). Changing membership or removing the export is an ESCALATE.
  - `plugin/src/canvas/canvas-presence.ts` is not modified by this initiative. If a WP believes it must, that is an ESCALATE.
  - `plugin/src/main.ts` may hold wiring only, never logic — it has no test file.
  - `canvas-binding.ts` / `canvas-model-bridge.ts` stay frozen and `useCanvasBinding` stays `false` until WP39/WP40 (only WP22 makes a narrow removal there).
  - Do not bump the plugin version. Do not hand-edit `plugin/main.js` or `server/dist/`. Do not read or edit `plugin/manifest.json` (broken symlink).
  - `server/` source is off limits except in WP41. Deployment, `docker/.env` and any secret are out of scope entirely.
- **Technology / framework / config constraints:**
  - TypeScript + Yjs (`yjs ^13.6.0`); Obsidian's Canvas view is private and untyped — only `canvas-adapter.ts` may touch its internals.
  - Pure cores must import nothing from Obsidian, the filesystem or a clock; the precedent is `plugin/src/canvas/reconcile-plan.ts` (zero imports).
  - **Schema impact:** No `schemaVersion` bump. Adds `meta.guid`, `meta.epoch` and `meta.path`, the sidecar files, and changes the doc-id namespace from path-based to guid-based. Mixed-version rule: a client that cannot resolve a guid for a path treats the doc as unknown and asks peers or the manifest — it never seeds a second doc for the same file.
- **Entry points / relevant files (from `workflowArtifacts/RepoMap.md`, V2 Touchpoint Inventory):**
  - `plugin/src/session/commands.ts` (183 L) — the command registration pattern
  - `plugin/src/ui/` — the existing modal patterns (approval/audit modals)
  - CONCEPT_V2 Teil 7 — the named import action and its confirmation requirement
- **Structure references:** *(intentionally empty — no Graphify graph exists for this project; FALLBACK mode is declared in the BUILD_SPEC section 3. Worker 3 fills this in after implementation. Do not invent paths here.)*

If structure references conflict with the BUILD_SPEC or explicit task scope, the BUILD_SPEC and TaskCharter win. Escalate instead of following the map.

---

## 4. Acceptance Criteria

*Exact copy from BUILD_SPEC section 5, component C30. No paraphrasing.*

1. The command exists, is reachable from the canvas context, and is the **only** way a file overwrites an already-living doc.
2. Executing it increments `meta.epoch`, seeds the doc from the file, and causes peers to adopt it through the epoch rule while archiving their state as a conflict copy.
3. A confirmation dialog is shown first, naming what will be overwritten and whose work is affected; cancelling performs no write of any kind.
4. The command is unavailable for a path the client does not own or is degraded on.

**Definition of Done:** overwriting is an informed decision, never a timing side effect.

---

## 5. Constraints and Known Risks

- **Permission / environment limits:** Windows dev host; run all plugin commands from `plugin/` (never the repo root). Runner is Vitest 4.0.18 — the `basic` reporter was removed, use the default or `--reporter=dot`. Budget >= 90 s for any automated `npm test` invocation (a 33.5 s sleeper makes ~41 s the floor, not a hang). No Graphify graph exists for this project (declared FALLBACK mode) — `workflowArtifacts/RepoMap.md` is the structural map.
- **Known flaky patterns:**
  - No timing-based echo suppression: no new `setTimeout` waits and no new timing constants. V2's echo breaker is byte equality.
  - No wall-clock sleeps in new tests (the existing 33.5 s sleeper in `wp5/latency.test.ts` is legacy, not a pattern to copy).
  - Never reason from two peers only — interleaving classes from three peers upward are distinct.
  - Do not assert on log strings as the primary oracle; state is the oracle, signatures are for humans.
  - Biome reports a whole-file `format` finding per touched file (CRLF environment artifact). Advisory locally, gating in CI — do not mass-reformat.
- **External dependency risks:** No new runtime dependency is permitted. Yjs, `y-protocols`, `lib0` and `minimatch` are already present and are the only libraries available. Obsidian's private Canvas API may vanish at any release — degrade, never break (I5).
- **Hard constraints:**
  - Invariants I1–I5 (`ARCHITECTURE.md`) and I6–I10 (CONCEPT_V2 Teil 3) are binding and must not be weakened.
  - Yjs stays. No CRDT library swap, no alternative CRDT introduced anywhere.
  - `CanvasPersistence` remains the single CRDT→disk writer; it emits zero CRDT writes; `coldOpen` runs after `waitForSync` and before `start()`.
  - **Zero new runtime dependencies.** Any dependency at all requires a publish date >= 7 days old (`npm view <pkg>@<version> time.created`); `npm ci` in build/deploy contexts, never `npm install`.
  - `GEOMETRY_KEYS` keeps exactly `{x, y, width, height}` and stays exported (it now describes the *file* schema). Changing membership or removing the export is an ESCALATE.
  - `plugin/src/canvas/canvas-presence.ts` is not modified by this initiative. If a WP believes it must, that is an ESCALATE.
  - `plugin/src/main.ts` may hold wiring only, never logic — it has no test file.
  - `canvas-binding.ts` / `canvas-model-bridge.ts` stay frozen and `useCanvasBinding` stays `false` until WP39/WP40 (only WP22 makes a narrow removal there).
  - Do not bump the plugin version. Do not hand-edit `plugin/main.js` or `server/dist/`. Do not read or edit `plugin/manifest.json` (broken symlink).
  - `server/` source is off limits except in WP41. Deployment, `docker/.env` and any secret are out of scope entirely.

---

## 6. Definition of Done Artifacts

- **Required changed files:**
  - `plugin/src/session/commands.ts`
  - a new modal under `plugin/src/ui/`
  - `plugin/src/main.ts` (wiring only)
- **Required report:** `ImplementationReport_WP30.md` (in `workflowArtifacts/canvas-v2/`)
- **BUILD_SPEC updates required:** no — unless implementation invalidates an architecture decision, in which case ESCALATE rather than editing the spec.
- **Gate status required at handover:** `npm run build` PASS and `npm test` with 0 failures, run from `plugin/`. All visible tests PASS.

---

## 7. Visible Test Cases / Producer Artifacts

### 7.0 The surface WP30 must provide — VERBATIM, and the facts behind it

> **Read this section before writing a line.** The 78 visible tests bind to these exact
> names and this exact ordering. Renaming an export, changing an argument order, or moving
> a decision from one layer to another turns the suite red for a reason that has nothing to
> do with the acceptance criteria.

#### 7.0.a — `plugin/src/canvas/canvas-import-command.ts` — **NEW**, pure core

Imports nothing from Obsidian, the filesystem, a clock or Yjs. Precedent:
`canvas/reconcile-plan.ts` and `files/canvas-seed-decision.ts`.

```ts
export const IMPORT_FROM_FILE_COMMAND_ID = "canvas-import-from-file";
export const IMPORT_FROM_FILE_COMMAND_NAME = "Import canvas from file (overwrite the shared board)";

export interface ImportAvailability {
  readonly owned: boolean;
  readonly degraded: boolean;
}

export const IMPORT_UNAVAILABLE = {
  UNOWNED: "unowned",
  DEGRADED: "degraded",
} as const;
export type ImportUnavailableReason = (typeof IMPORT_UNAVAILABLE)[keyof typeof IMPORT_UNAVAILABLE];

/** `null` when the command is available; the blocking reason otherwise. */
export function importUnavailableReason(
  availability: ImportAvailability | null | undefined,
): ImportUnavailableReason | null;

/** Exactly `importUnavailableReason(a) === null`. */
export function canImportFromFile(availability: ImportAvailability | null | undefined): boolean;

export interface ImportAffectedPeer {
  readonly displayName: string;
}

export interface ImportOverwriteSummary {
  readonly canvasPath: string;
  readonly liveRecordCount: number;
  readonly fileRecordCount: number;
  readonly peers: readonly ImportAffectedPeer[];
}

export function importConfirmationMessage(summary: ImportOverwriteSummary): string;
```

**Pinned semantics.**

- `importUnavailableReason` is **fail-closed and ordered**: `owned !== true` → `UNOWNED`;
  else `degraded !== false` → `DEGRADED`; else `null`. A `null` / `undefined` / non-object
  argument → `UNOWNED`. Ownership is asked **first**, so a path that is both unowned and
  degraded reports `UNOWNED` — telling a user their board is degraded when this client
  simply does not hold it is a wrong answer, not a harmless one. (`!== true` / `!== false`
  rather than truthiness, for WP29's reason: an unanswered probe is not a yes.)
- `importUnavailableReason` is **total** — it never throws, on any argument.
- `importConfirmationMessage` **must**: contain `canvasPath` verbatim; contain
  `liveRecordCount` as a decimal; contain **every** peer's `displayName` verbatim; change
  when **any** of `canvasPath`, `liveRecordCount` or `peers` changes; and contain a
  destructive verb matching `/overwrit|replac|discard|destro|lose|lost|erase|wipe/i`.
  The exact wording is **free** — no test pins a sentence.
- `importConfirmationMessage` **throws `TypeError`** on a non-object summary, a non-string
  or empty `canvasPath`, a count that is not a non-negative safe integer, a non-array
  `peers`, or a peer whose `displayName` is not a non-empty string. Rendering
  `overwrite undefined` into a dialog that authorises a destruction is WP28's coercion
  class one function to the left.
- With an empty `peers` list the message still names the board and still reads as
  destructive, and names **no** peer.

#### 7.0.b — `plugin/src/files/canvas-import.ts` — **NEW**, WP30's command module core

```ts
export const CANVAS_IMPORT_SEED_ORIGIN: unique symbol = Symbol("canvas-import-seed-origin");

export const IMPORT_STATUS = {
  IMPORTED: "imported",
  CANCELLED: "cancelled",
  UNAVAILABLE: "unavailable",
  NO_SOURCE: "no-source",
  ADOPTION_REFUSED: "adoption-refused",
} as const;
export type ImportStatus = (typeof IMPORT_STATUS)[keyof typeof IMPORT_STATUS];

export interface ImportFromFileEnv {
  availability(canvasPath: string): ImportAvailability;
  liveDoc(canvasPath: string): Y.Doc | null;
  peers(canvasPath: string): readonly ImportAffectedPeer[];
  readCanvasFile(canvasPath: string): Promise<string | null>;
  confirm(summary: ImportOverwriteSummary, message: string): Promise<boolean>;
  /** THE ONLY WRITE CHANNEL. WP28's complete-adoption seam. */
  adoptEpochWinner(canvasPath: string, winner: Y.Doc): Promise<EpochConflictOutcome | null>;
  notify(message: string): void;
  logger?: { debug(c: string, m: string): void; warn(c: string, m: string): void };
}

export interface ImportFromFileResult {
  readonly status: ImportStatus;
  /** `SEED_DECISION.SEED_FROM_FILE` when the import ran; `null` otherwise. */
  readonly decision: SeedDecision | null;
  readonly epoch: number | null;
  readonly archivedTo: string | null;
  readonly message: string | null;
  readonly unavailableReason: ImportUnavailableReason | null;
  readonly detail: string | null;
}

export async function runImportFromFile(
  canvasPath: string,
  env: ImportFromFileEnv,
): Promise<ImportFromFileResult>;
```

**The order inside `runImportFromFile` IS the acceptance criterion, not a preference.**

```text
1. reason := importUnavailableReason(env.availability(path))
   └── reason !== null → { status: UNAVAILABLE, unavailableReason: reason }
       NO read, NO dialog, NO write.
2. text := await env.readCanvasFile(path)
   └── null, or not JSON, or not an object with an ARRAY `nodes`
       → { status: NO_SOURCE }.  NO dialog, NO write.
       `{"nodes":[],"edges":[]}` is VALID — emptying a board is a thing a user may ask for,
       and WP28's adoptWinner supports it. A file that does not PARSE is not an empty board:
       `parseCanvas` swallows a JSON error and returns empty records, so trusting it would
       read a truncated file as "delete everything".
3. live := env.liveDoc(path)
4. summary := { canvasPath: path,
                liveRecordCount: <projection of `live` via buildCanvasData>, 0 when null,
                fileRecordCount: <records the file names>,
                peers: env.peers(path) }
5. message := importConfirmationMessage(summary)
6. ok := await env.confirm(summary, message)
   └── ok !== true → { status: CANCELLED, message }.  NOT ONE WRITE OF ANY KIND.
7. winner := new Y.Doc()
   ├── stamp `meta[EPOCH_KEY] := readEpoch(live)`   (0 when `live` is null)
   └── seedRecordsIntoYMaps(winner, decodeCanvasDataToFlat(parseCanvas(text)),
                            CANVAS_IMPORT_SEED_ORIGIN)
8. epoch := bumpEpoch(winner)          ← WP28 OWNS the increment. WP30 never writes `n + 1`.
                                         Result: epoch === nextEpoch(readEpoch(live)).
9. outcome := await env.adoptEpochWinner(path, winner)     ← the only write
   ├── rejects → env.notify(<a sentence naming `path`>) and
   │             { status: ADOPTION_REFUSED, epoch, detail: <the refusal message>,
   │               archivedTo: null }
   ├── null    → env.notify(...) and { status: ADOPTION_REFUSED, archivedTo: null, detail }
   └── outcome → { status: IMPORTED, decision: SEED_DECISION.SEED_FROM_FILE, epoch,
                   archivedTo: outcome.archivedTo, message }
10. `winner.destroy()` in a `finally`.
```

- **`ADOPTION_REFUSED` must never throw out of `runImportFromFile`** and must never report
  `IMPORTED`. `detail` must contain the phrase `conflict copy` when the refusal came from
  the archive channel (the test asserts on the substring, not on the whole sentence).
- **Step 7's epoch predecessor is the LIVE board's, not the staged doc's.** A doc parsed
  from a `.canvas` has no `meta` at all, so `bumpEpoch(staged)` alone yields `1` and loses
  every conflict against a board that has ever been imported before.
- Step 8 must go through WP28's `bumpEpoch`, and steps 7–8 must both complete **before**
  step 9. At the moment the winner is offered, it already carries the file's records **and**
  the new epoch, and the live doc is still untouched.

#### 7.0.c — `plugin/src/ui/import-canvas-modal.ts` — **NEW** (charter §6's "new modal")

```ts
export class ImportCanvasConfirmModal extends ConfirmModal {
  readonly summary: ImportOverwriteSummary;
  constructor(app: App, summary: ImportOverwriteSummary, resolve: (value: boolean) => void);
}
export function confirmImportFromFile(app: App, summary: ImportOverwriteSummary): Promise<boolean>;
```

It **subclasses `ConfirmModal`** (`plugin/src/ui/modals.ts:76-113`) and passes
`importConfirmationMessage(summary)` to `super`. Everything that makes `ConfirmModal`
correct is inherited and must not be re-implemented — in particular `onClose` resolving
`false` when the user dismisses without deciding, which is why **dismissal already counts
as cancel and needs no new code**.

#### 7.0.d — `plugin/src/session/commands.ts` — one new `addCommand`

```ts
plugin.addCommand({
  id: IMPORT_FROM_FILE_COMMAND_ID,
  name: IMPORT_FROM_FILE_COMMAND_NAME,
  checkCallback: (checking) => {
    const path = plugin.activeCanvasPathForImport();
    if (path === null) return false;
    if (!canImportFromFile(plugin.canvasImportAvailability(path))) return false;
    if (checking) return true;
    void plugin.runCanvasImportFromFile(path).catch(() => {
      /* absorbed: `checkCallback` is not async and the caller discards the result */
    });
  },
});
```

`checkCallback`, **never** `callback`. `commands.ts` has exactly two registration shapes and
AC4 is only expressible in the second one — a `callback` registration does not merely fail
AC4, it makes AC4 structurally unimplementable.

#### 7.0.e — `plugin/src/main.ts` — WIRING ONLY, three new members

```ts
/** The `.canvas` path the import command targets, or `null` when there is none. */
activeCanvasPathForImport(): string | null;
/** AC4's two conditions for `path`. MEASURED, never decided — the decision is 7.0.a's. */
canvasImportAvailability(path: string): ImportAvailability;
/** Builds the real `ImportFromFileEnv` and calls `runImportFromFile`. */
runCanvasImportFromFile(path: string): Promise<ImportFromFileResult>;
```

`owned` is `canvasOwned(path, this.canvasSync)` (`files/vault-events.ts:53`, the existing
single ownership predicate — do not write a second one). `degraded` reads an **existing**
degradation concept for the path (a withholding `SeedRefusalLedger`, an unavailable canvas
adapter, a degraded sidecar load) — WP30 invents no new one. **No test binds to which**;
they bind to `ImportAvailability.degraded`, so the choice is the coder's to make and to
record in the implementation report.

#### 7.0.f — Facts a coder cannot derive, and will otherwise get wrong

1. **`CanvasSync.adoptEpochWinner(rawPath, winner)` already exists** (`canvas-sync.ts:2229`)
   and is WP30's seam. WP30 must **not** spell a conflict-copy name, a verdict or a log
   signature of its own — `compareEpoch`, `conflictCopyPath`, `epochConflictNotice` and
   `epochConflictSignature` are all exported from `canvas/canvas-epoch.ts` (Contract §1).
2. **A replica that has already merged the winner cannot prune to the winner's record set,
   and no implementation can.** `SyncManager.getDoc` creates one `Y.Doc` per doc id and all
   peer state arrives as updates into it, so after a merge the doc holds `winner ∪ loser`
   and shared ids are on both sides. That is why the **complete** replacement is executed by
   the importer and published **wholesale** through `adoptEpochWinner`. Nothing in this
   suite asserts a loser-side prune, and nothing may be added that does.
3. **`conflictCopyPath` is day-granular.** Two conflicts on the same board on the same day
   name the SAME file, and `CanvasSync.writeConflictCopy` **never clobbers**: an identical
   body is an idempotent re-run, anything else throws — and because the mechanism is
   fail-closed, that refusal **cancels the adoption**. An ordinary second import on a busy
   day can therefore end with the board unchanged. That state must be recoverable and
   legible (I11), never a silent no-op.
4. **`ConfirmModal` delivers its answer through a resolve callback, not a return value**
   (`ui/modals.ts:76-113`), and `LiveSharePlugin.confirm(message)` (`main.ts:1735`) is the
   Promise wrapper.
5. **The shared Obsidian test double has no `FuzzySuggestModal`.** `session/commands.ts` →
   `ui/modals.ts` extends it at module scope (`UserPickerModal`), so importing
   `registerCommands` into any unit test fails to LOAD — `Class extends value undefined` —
   before a single assertion runs. The three command-level test files supplement it with a
   file-local `vi.mock("obsidian", …)`; `src/__mocks__/obsidian.ts` is deliberately **not**
   modified. If a coder adds a command-level test, it needs the same block.
6. **WP29's `SEED_DECISION` / `decideSeed` are imported, never re-spelt** (Contract §1), and
   the seed writer that survives WP29 is upsert-only — it can add, it can never subtract.
   That is exactly why the import cannot be implemented as
   `seedRecordsIntoYMaps(liveDoc, …)`: it would satisfy every other test in this suite and
   fail AC1's only operational meaning.
7. **Stale line numbers.** Every `:NNN` in this charter's §3 predates P0/P1. Locate symbols
   by name (Contract §4).

---

### 7.1 Test point index — 9 points, 78 visible cases

| TC | AC | Test point | Visible file (`plugin/src/__tests__/v2/wp30/`) |
|---|---|---|---|
| TC01 | AC1 | the command exists and is reachable from the canvas context | `test_tp01_command_registered_in_canvas_context_visible.test.ts` |
| TC02 | AC4 | unavailable for a path the client does not own | `test_tp02_unavailable_on_unowned_path_visible.test.ts` |
| TC03 | AC4 | unavailable for a path the client is degraded on | `test_tp03_unavailable_on_degraded_path_visible.test.ts` |
| TC04 | AC3 | the dialog names what is overwritten AND whose work is affected | `test_tp04_dialog_names_overwrite_and_peers_visible.test.ts` |
| TC05 | AC3 | cancelling performs no write of any kind | `test_tp05_cancel_writes_nothing_visible.test.ts` |
| TC06 | AC2 | epoch++ and the seed are complete before the publish | `test_tp06_epoch_bump_precedes_publish_visible.test.ts` |
| TC07 | AC2 | peers archive their state, then adopt | `test_tp07_peers_archive_then_adopt_visible.test.ts` |
| TC08 | AC1 | the import is the only door that overwrites a living board | `test_tp08_only_door_that_overwrites_visible.test.ts` |
| TC09 | AC3 / I11 | every refusal is fail-closed and legible | `test_tp09_refusals_are_fail_closed_visible.test.ts` |

Shared fixtures: `plugin/src/__tests__/v2/wp30/harness.ts`. Its one design decision worth
knowing: `env.adoptEpochWinner` is **WP28's real `resolveEpochConflict`** over a fake vault
and a real live `Y.Doc` with an update observer, so "no write" is counted at two independent
I/O boundaries — bytes offered to the vault, and transactions committed on the doc — and
neither is inferrable from the other.

---

### TC01 — the command exists and is reachable from the canvas context (AC1)

- **Subject:** the new `addCommand` block in `session/commands.ts`.
- **Asserts:** exactly one entry under `IMPORT_FROM_FILE_COMMAND_ID`; the owned name; the
  pre-WP30 command set is undisturbed; the entry has a `checkCallback` and **no** `callback`
  or `editorCallback`; `checkCallback(true) === true` runs nothing; `checkCallback(false)`
  runs the import against the canvas in context; `activeCanvasPathForImport() === null`
  makes it unavailable in both modes; availability is asked about the path in context.
- **Wrong implementation it catches:** registering with `callback`, which puts the command
  in the palette unconditionally and leaves AC4 nowhere to live.

### TC02 — unavailable for a path the client does not own (AC4)

- **Subject:** `importUnavailableReason` / `canImportFromFile`, and the guard line in
  `commands.ts`.
- **Asserts:** `UNOWNED` for a plainly unowned path and for one that is both unowned and
  degraded (precedence); every non-`true` ownership answer and every malformed availability
  report reads as `UNOWNED`; the owned+undegraded positive control is available; the
  registered command refuses in both modes and accepts the positive control.
- **Wrong implementation it catches:** a truthiness test (`!owned`) that reads a probe
  answering `undefined` as "not owned is false", i.e. as permission.

### TC03 — unavailable for a path the client is degraded on (AC4)

- **Subject:** the `degraded !== false` branch, and the same guard line.
- **Asserts:** an **owned but degraded** path is refused — the row a one-condition guard
  misses; every non-`false` degradation answer is fail-closed; the 2×2 lattice has exactly
  one available row; the registered command refuses in both modes and starts no import.
- **Wrong implementation it catches:** a guard that checks ownership only, which satisfies
  three of the four lattice rows.

### TC04 — the dialog names what is overwritten and whose work is affected (AC3)

- **Subject:** `importConfirmationMessage`, and the summary `runImportFromFile` builds.
- **Asserts:** containment of the board path, the live record count and every peer name;
  a destructive verb from a permitted family; the alone-case still names the board and
  invents no collaborator; sensitivity to `canvasPath`, `liveRecordCount` and `peers`
  independently; adding a peer changes the message again; no `undefined` / `null` / `NaN` /
  `[object Object]` reaches the dialog; a malformed summary throws `TypeError`; the message
  actually handed to `confirm` is `importConfirmationMessage(summary)`; the summary reflects
  the LIVE board (not the file); the peers reflect `env.peers(path)`.
- **Wrong implementation it catches:** a generic confirmation ("Are you sure?"), and a
  summary built from a hard-coded or file-derived peer list.
- **HUMAN_OBSERVABLE split:** see §7b. The *rendering* is a W4 target; the *text* is here.

### TC05 — cancelling performs no write of any kind (AC3)

- **Subject:** the `ok !== true` early return, and everything sequenced after it.
- **Asserts:** POSITIVE CONTROL — confirming produces exactly one vault write and exactly
  one doc transaction; cancelling produces zero on both channels and never calls
  `adoptEpochWinner`; the live replica's state vector, projection and epoch are unchanged;
  the cancel is a **decision** (the file was read and the dialog was shown first); the write
  channels are empty **at the instant the dialog is open**; every non-`true` answer is a
  cancel; a cancelled run reports no epoch, no archive, no decision; two cancels in a row
  leave no half-state.
- **Wrong implementation it catches:** an import that stages and publishes before asking,
  and an import that "cancels" by rolling back after writing.

### TC06 — epoch++ and the seed are complete before the publish (AC2)

- **Subject:** `bumpEpoch(winner)` and its position relative to `adoptEpochWinner`.
- **Asserts:** at the instant of the offer the winner already carries `nextEpoch(live)` and
  the file's records, and the live board still carries its own; the epoch published is the
  LIVE board's successor across `{0, 1, 7, 41}` and across corrupt cells
  `{absent, -3, 2.5, "9", null, {}}`; the epoch rule fires (`remote-wins`, adopted,
  archived); the publish lands as ONE transaction under `CANVAS_EPOCH_ADOPT_ORIGIN`; the
  board ends up holding exactly the file at the new epoch; the archive is taken **before**
  the adoption.
- **Wrong implementation it catches:** an import that seeds without bumping the epoch, and
  one that bumps the staged doc instead of the live board's successor.

### TC07 — peers archive their state, then adopt (AC2)

- **Subject:** what the import *published*, met by a peer replica at WP28's epoch seam.
- **Asserts:** a peer behind the import archives once and adopts; the archive holds the
  peer's pre-import work captured **at write time**, not the winner's; the notice names the
  file; the peer's board becomes exactly the imported board at the imported epoch
  (**membership**, never contested record content); three replicas all archive and all
  converge, each archive holding only its own author's work; a peer already at the imported
  epoch merges normally and archives nothing; an import that did not raise the epoch changes
  nothing on any peer, while the real one does.
- **Wrong implementation it catches:** an import published as ordinary edits (peers merge,
  nothing is archived, nothing is overwritten), and an archive-on-every-merge.
- **Explicitly not asserted:** loser-side pruning after a union — see §7.0.f(2).

### TC08 — the import is the only door that overwrites a living board (AC1)

- **Subject:** the fact that WP30 publishes a wholesale replacement rather than seeding.
- **Asserts:** the three ways to arrive at a living board (cold open with a peer, sidecar
  resume, host rejoin) all answer `LOAD_OR_MERGE`; exactly one knowledge shape still permits
  an automatic seed; even that permitted seed cannot remove a record the file omits
  (upsert-only, I7); the import **does** remove it, under every knowledge shape; the import
  reports `SEED_DECISION.SEED_FROM_FILE`; the live doc sees exactly one transaction.
- **Wrong implementation it catches:** implementing the import as
  `seedRecordsIntoYMaps(liveDoc, …)` — which passes every other test in this suite.

### TC09 — every refusal is fail-closed and legible (AC3 / I11)

- **Subject:** the source guard before `confirm`, and the `try`/`catch` around the publish.
- **Asserts:** an unavailable path is refused before the file is read and without a dialog;
  a missing file is refused without a dialog; unparseable text (`"{ not json"`, `""`,
  `"null"`, `"[]"`, `'{"nodes":"a"}'`) is refused rather than read as an empty board, with
  the board untouched; a legitimately empty canvas **is** imported (the control that stops
  "refuse everything small" from passing); a refused archive is reported rather than thrown,
  leaves the live board byte-identical, tells the user, names this board, and is never
  reported as a success; a path with no live doc is refused rather than silently "imported".
- **Wrong implementation it catches:** an import that lets the vault's rejection escape as
  an unhandled promise rejection out of a `checkCallback`, and one that swallows it into a
  cheerful `IMPORTED`.

---

## 7b. W4 Test Targets (filled by Worker 3's Unit Test Sub-Agent, if any)

**INTEGRATION_SCOPE: 3 · HUMAN_OBSERVABLE: 1**

| # | Kind | Target | Why it is not a unit test |
|---|---|---|---|
| 1 | `INTEGRATION_SCOPE` | `LiveSharePlugin.activeCanvasPathForImport()` returns the path of the canvas the user is actually looking at, and `null` for a markdown view, no view, and a non-`.canvas` file | Obsidian's Canvas view is private and untyped; the answer comes from a live workspace, and only `canvas-adapter.ts` may touch those internals. The unit suite injects the path. |
| 2 | `INTEGRATION_SCOPE` | `LiveSharePlugin.canvasImportAvailability(path)` reports `owned: false` for a path `CanvasSync` has not subscribed, and `degraded: true` for a path in the real degradation state the coder wires (withholding refusal ledger / unavailable adapter / degraded sidecar) | The unit suite pins the *decision* over an `ImportAvailability`; nothing pins that the two fields are *measured correctly* from the live subsystems, and the measurement is exactly where an AC4 bypass would hide. |
| 3 | `INTEGRATION_SCOPE` | End-to-end across two real clients: A imports a `.canvas`; B, rejoining with its own sidecar replica, finds a real `<name>.conflict-<date>.canvas` on disk containing **B's** pre-import board, and B's board becomes A's | The archive is written through `CanvasSync.writeConflictCopy` → `vault.adapter.write`, and the loser replica is staged from a real sidecar at a real `subscribe`. TC07 drives the rule; only the rig drives the disk and the sidecar. |
| 4 | `HUMAN_OBSERVABLE` | The confirmation dialog **renders**: it opens before anything happens, the message is on screen and legible, the Confirm button reads as destructive (`mod-warning`), Cancel and dismissal both abort | The Obsidian test double's `contentEl.createEl` returns `{}`, so no rendering assertion is possible in a unit test. **This is the rendering half of AC3 only** — the message *content* is fully unit-tested in TC04 and is NOT a W4 target. |

---

## 8. Autonomous Execution Plan (filled by Coder Sub-Agent, attempt 1)

- **Observed current behavior:** after WP29 nothing automatic can subtract a record from a living
  doc — the surviving seed writer is upsert-only (I7) — so there was no way at all for a file to
  overwrite a shared board. WP28 shipped `CanvasSync.adoptEpochWinner` with no production caller
  and `reconcileEpochOnSubscribe` inert (`readEpoch(doc)` was always 0, because nothing called
  `bumpEpoch`). The 78 visible tests were red with `Cannot find module`.
- **Approach:** three new modules on the §7.0 surface, verbatim. A pure core
  (`canvas/canvas-import-command.ts`, zero imports) owning the availability decision and the
  dialog text; a command core (`files/canvas-import.ts`) implementing the pinned step order with
  `adoptEpochWinner` as the single injected write channel; a four-line modal
  (`ui/import-canvas-modal.ts`) subclassing `ConfirmModal` so dismissal-as-cancel is inherited
  rather than re-implemented. One `checkCallback` registration in `session/commands.ts`, three
  wiring members in `main.ts`.
- **Fallback path if all attempts fail:** not needed — 78/78 green on the first run.

---

## 9. Handover Summary (filled by Coder Sub-Agent on completion)

- **What is complete:** all four ACs. 78/78 visible, WP24–WP29 407/407, R4 gate 61/61, `tsc`
  clean, full suite 1833/0 (reference 1755/0, delta +78). Both load-bearing decisions falsified
  and reverted. Full detail in `ImplementationReport_WP30.md`.
- **What remains open:** the three `INTEGRATION_SCOPE` targets and the one `HUMAN_OBSERVABLE`
  target in §7b, unchanged. Two coder choices §7.0.e left free are recorded in the report for W4:
  `degraded` = withholding `SeedRefusalLedger` OR a registered-but-unavailable canvas adapter (an
  ABSENT adapter is deliberately not degradation), and `peers` = every session participant rather
  than only those currently viewing the board.
- **Final status:** `DONE`

---

## 10. Risk Notes for Worker 4 (filled by Worker 3 Core)

- **Risk flag:** NONE
