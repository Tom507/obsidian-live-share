# Task Charter — WP28: Epoch rule + conflict archive

**Charter Status:** `DONE`
**WP:** WP28
**Phase:** P2
**task_mode:** `standard`
**Depends on:** WP27
**W4 Test Targets:** `0`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** the W4 divergence class is named and archived rather than silent.
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 5, component **C28 — Epoch rule and conflict archiving** (work package WP28); phase **P2**.

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: create (epoch comparison + archive helper) + modify (subscribe/merge path)
  - Responsibility: make unrelated histories detectable and named instead of silently merged or silently lost.
  - Scope summary: higher epoch wins; loser archives a copy
- **Out of scope / non-goals:**
  - The user-triggered import that increments the epoch — WP30.
  - Merging unrelated histories silently (explicitly forbidden).
  - Deleting or overwriting a user's file without an archive copy.
- **Known interfaces / dependencies:**
  - Input: two replicas claiming the same guid with different `meta.epoch`
  - Output: the higher epoch wins; the loser archives a conflict copy
  - Depends on work packages: WP27
  - **Convergence-fuzzer link (required by the BUILD_SPEC):** WP23 "epoch" scenario — replicas with equal epochs converge normally; replicas with unequal epochs all resolve to the higher epoch's state, and no replica silently merges the two histories.

---

## 3. Architecture Context

*Task-local architecture guidance only.*

- **Component(s) being changed:** Epoch rule and conflict archiving
- **Interfaces involved:**
  - Input: two replicas claiming the same guid with different `meta.epoch`
  - Output: the higher epoch wins; the loser archives a conflict copy
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
  - CONCEPT_V2 Teil 7 — the GUID + epoch section
  - `plugin/src/files/canvas-sync.ts:360–467` — `subscribe`, where two replicas first meet
  - `plugin/src/files/file-ops.ts` — vault file operations for writing the archive copy
- **Structure references (filled by Worker 3 after implementation):**
  - `plugin/src/canvas/canvas-epoch.ts` — NEW. The whole rule: `normalizeEpoch`, `readEpoch`,
    `compareEpoch`/`EpochVerdict`, `nextEpoch`, `bumpEpoch`, `conflictCopyPath`,
    `epochConflictNotice`, `epochConflictSignature`, `EpochConflictEnv`,
    `EpochConflictOutcome`, `resolveEpochConflict`, `CANVAS_EPOCH_ADOPT_ORIGIN`.
  - `plugin/src/files/canvas-sync.ts` — `CanvasSync.epochConflictEnv` (the real
    `EpochConflictEnv`), `CanvasSync.writeConflictCopy` (fail-closed vault write),
    `CanvasSync.reconcileEpochOnSubscribe` (the live call site, invoked from `subscribe`),
    `CanvasSync.adoptEpochWinner` (WP30's seam), `CanvasSync.setEpochConflictHooks`,
    module-private `isoCalendarDate`.
  - `plugin/src/files/file-ops.ts` — NOT changed. No new vault operation was needed;
    `vault.adapter.write` + `ensureFolder` already cover an archive write, and routing it
    through `FileOpsManager` would have muted the very error the fail-closed rule depends on.

If structure references conflict with the BUILD_SPEC or explicit task scope, the BUILD_SPEC and TaskCharter win. Escalate instead of following the map.

---

## 4. Acceptance Criteria

*Exact copy from BUILD_SPEC section 5, component C28. No paraphrasing.*

1. `meta.epoch` is monotonic and host-incremented; when two replicas share a guid but differ in epoch, the higher epoch wins completely on every replica.
2. The losing side writes its state to `<name>.conflict-<date>.canvas` before adopting the winner, and the user is notified with a message naming the file.
3. Equal epochs merge normally as related replicas — the archive path does not trigger.
4. A distinct log signature records every epoch conflict with both epoch values.

**Definition of Done:** the W4 divergence class is named and archived rather than silent.

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
  - `plugin/src/files/canvas-sync.ts`
  - a new epoch/conflict module
  - `plugin/src/files/file-ops.ts` (only if a new vault operation is needed)
- **Required report:** `ImplementationReport_WP28.md` (in `workflowArtifacts/canvas-v2/`)
- **BUILD_SPEC updates required:** no — unless implementation invalidates an architecture decision, in which case ESCALATE rather than editing the spec.
- **Gate status required at handover:** `npm run build` PASS and `npm test` with 0 failures, run from `plugin/`. All visible tests PASS.

---

## 7. Visible Test Cases

### 7.0 — The API surface WP28 must provide (BINDING, verbatim)

The visible tests import this module **by name**. It does not exist yet; creating it is the
first implementation step. Every symbol below is imported by at least one visible test, so a
rename is a suite-wide failure, not a style choice.

**Module:** `plugin/src/canvas/canvas-epoch.ts`

Why `canvas/` and not `files/`: it must import `EPOCH_KEY` / `META_MAP_NAME` from
`canvas/canvas-schema.ts`, and `canvas-sync.ts` will import **it** on the merge path. Putting
it in `files/` and letting it import `serializeCanvas` back out of `canvas-sync.ts` closes a
runtime cycle — the same one WP25 had to defuse with a type-only import. It stays a near-pure
core (`yjs` + `canvas-schema` only, no Obsidian, no filesystem, no clock), following the
`plugin/src/canvas/reconcile-plan.ts` precedent. The `.canvas` projection and the vault write
are **injected** (`EpochConflictEnv`), which is also what makes AC2's ordering testable.

```ts
export type EpochVerdict = "local-wins" | "remote-wins" | "equal";

/** Provenance for the adoption transaction, in the style of CANVAS_MIGRATION_ORIGIN. */
export const CANVAS_EPOCH_ADOPT_ORIGIN: unique symbol;

/** A non-negative finite integer, or 0. NEVER `Number(value)` — see the trap notes. */
export function normalizeEpoch(value: unknown): number;

/** Reads `meta[EPOCH_KEY]` through `normalizeEpoch`. Writes nothing, ever. */
export function readEpoch(doc: Y.Doc): number;

export function compareEpoch(localEpoch: unknown, remoteEpoch: unknown): EpochVerdict;

/** `normalizeEpoch(current) + 1`. Strictly greater, for every input. */
export function nextEpoch(current: unknown): number;

/** The host increment. ONE transaction, `meta` only; returns the value it wrote. */
export function bumpEpoch(doc: Y.Doc): number;

/** `<dir>/<name>.conflict-<date>.canvas`. Throws on a non-`.canvas` path or a bad date. */
export function conflictCopyPath(canvasPath: string, date: string): string;

/** AC2's user-facing message. MUST contain `conflictPath` verbatim. */
export function epochConflictNotice(conflictPath: string): string;

/** AC4. Throws when the two epochs are equal — an equal merge is not a conflict. */
export function epochConflictSignature(
  canvasPath: string,
  localEpoch: number,
  remoteEpoch: number,
  archivedTo: string | null,
): string;

export interface EpochConflictEnv {
  /** The `.canvas` text of the doc as it stands right now. */
  serializeDoc(doc: Y.Doc): string;
  /** Write the archive copy. Resolves only when the bytes are durable. */
  writeConflictCopy(path: string, content: string): Promise<void>;
  notify(message: string): void;
  /** `YYYY-MM-DD`. Injected — this module never reads a clock. */
  today(): string;
  logger?: {
    debug(category: string, message: string): void;
    warn(category: string, message: string): void;
  };
}

export interface EpochConflictOutcome {
  readonly verdict: EpochVerdict;
  readonly localEpoch: number;
  readonly remoteEpoch: number;
  /** The path written, or `null` when nothing was archived. */
  readonly archivedTo: string | null;
  readonly adopted: boolean;
  /** The AC4 signature, or `null` when there was no conflict. */
  readonly signature: string | null;
}

export function resolveEpochConflict(args: {
  doc: Y.Doc;
  winner: Y.Doc;
  canvasPath: string;
  env: EpochConflictEnv;
}): Promise<EpochConflictOutcome>;
```

**`resolveEpochConflict`, step by step — this order is the AC, not a preference:**

```text
localEpoch  := readEpoch(doc)
remoteEpoch := readEpoch(winner)
verdict     := compareEpoch(localEpoch, remoteEpoch)

verdict !== "remote-wins"          ← "equal" AND "local-wins"
  └── return immediately. NO serialise, NO write, NO notify, NO log, and NOT ONE
      transaction on `doc`. archivedTo: null, adopted: false, signature: null.

verdict === "remote-wins"
  ├── 1. content    := env.serializeDoc(doc)                 ← the LOSER, pre-adoption
  ├── 2. archivedTo := conflictCopyPath(canvasPath, env.today())
  ├── 3. await env.writeConflictCopy(archivedTo, content)    ← rejects ⇒ propagate and
  │                                                            adopt NOTHING (fail-closed)
  ├── 4. env.notify(epochConflictNotice(archivedTo))
  ├── 5. ONE doc.transact(..., CANVAS_EPOCH_ADOPT_ORIGIN):
  │        ├── `nodes`, `edges`, `deleted` REPLACED wholesale by the winner's
  │        └── meta[EPOCH_KEY] := remoteEpoch   (guid / path / schemaVersion untouched)
  ├── 6. env.logger?.warn("canvas-epoch", signature)
  └── 7. return { verdict, localEpoch, remoteEpoch, archivedTo, adopted: true, signature }
```

**Signature shape** (pinned by TC9; both numbers labelled so they cannot be read backwards):

```text
EPOCH CONFLICT signature: <canvasPath> local=<n> remote=<m> -> <verdict>, archived to <path>
                                                            -> <verdict>, no archive needed
```

**Ownership (Shared Ownership Contract §1).** WP30 **imports** `compareEpoch`, its verdict
type, `conflictCopyPath` and the signature from this module and formats no conflict name of
its own. WP30's `epoch++` goes through `bumpEpoch`; nobody writes `meta.set(EPOCH_KEY, x + 1)`
by hand.

---

### 7.0.a — Facts a coder cannot derive from this charter

**1. `EPOCH_KEY` is consumed, never re-declared.** WP27 **defined** the constant; WP28 **owns
its semantics** (contract §2 — the split is deliberate and is not a violation of the one-owner
rule). Import `EPOCH_KEY` and `META_MAP_NAME` from `plugin/src/canvas/canvas-schema.ts`. The
string `"epoch"` appears at no call site in this WP.

**2. Current anchors — every `:NNN` in §3 of this charter is stale** (contract §4; the tree has
roughly tripled since these charters were written). Verified against the current tree:

| What | Where it actually is |
|---|---|
| `EPOCH_KEY` / `META_MAP_NAME` / `GUID_KEY` / `PATH_KEY` | `plugin/src/canvas/canvas-schema.ts:127 / :101 / :114 / :117` |
| `CanvasSync.stampIdentity` (WP27; stamps epoch 0 once, guarded) | `plugin/src/files/canvas-sync.ts:2080` |
| `INITIAL_CANVAS_EPOCH = 0` | `canvas-sync.ts:157` — **module-private, deliberately.** Do not export it; `normalizeEpoch` returning 0 for an absent cell is WP28's spelling of the same fact |
| `subscribe` (where two replicas meet) | `canvas-sync.ts` — locate by name; the charter's `:360–467` is stale |
| `canvasDocId(guid)` / `CANVAS_DOC_PREFIX` | `canvas-sync.ts:146` / `:133` |
| existing signature helpers to match in style | `canvas-sync.ts:1160` (`ingestRejectionSignature`), `:1705` / `:1720` (quarantine) |
| `serializeCanvas(nodesMap, edgesMap, deletedMap?)` | `canvas-sync.ts:958` — the natural `env.serializeDoc` implementation at the wiring site |
| record containers | `doc.getMap("nodes")` / `doc.getMap("edges")`; tombstones are `DELETED_MAP_NAME` (`canvas-sync.ts:998`). There is no `NODES_MAP_NAME` constant — the literals are the convention here |

Locate every symbol **by name**. Where a line number and a name disagree, the name wins.

**3. THE ARCHIVE-BEFORE-ADOPT ORDERING TRAP — the single most important thing in this WP.**
An implementation that adopts the winner and *then* writes the conflict copy produces a file
with the right name, the right date, a valid `.canvas` body and a notification — and the body
is a **copy of the winner**. Every end-state oracle is green. The only thing gone is the exact
work the archive existed to preserve, and the file that was supposed to hold it is the proof
that the incident was handled correctly. TC4 instruments the write channel so that it reads
the loser's live doc *at the instant of the call*; adopt-first turns it red on two independent
assertions. Do not "optimise" the serialise below the transaction.

**4. THE PARTIAL-WIN TRAP.** "Wins completely" is a set equation. An adoption that brings the
winner's records over without **removing the loser's** converges, passes SEC, passes the schema
invariants, passes byte equality and passes the shadow oracle — and leaves a board carrying two
unrelated histories at once. `Y.applyUpdate` is a **union** and is therefore not an adoption.
Replace the containers; do not merge them. And do not tombstone the loser's records instead of
removing them: a suppressed record is still in the doc, still exportable, and resurfaces the
moment the epochs equalise. The archive **file** is where the loser's work is preserved.

**5. AC3 is the discriminating half of AC2.** An implementation that archives on *every* merge
satisfies AC2 perfectly. TC8 is what separates them, at four independent channels (write,
notify, log, and the doc itself). The equal-epoch case is not exotic — it is what runs
thousands of times a day in a live session.

**6. Do not assert a specific value across concurrent writers** (contract §5). `meta.epoch` is
assertable by identity precisely because it is host-incremented and single-authored; record
content after two replicas meet is not.

---

### TC1 — `compareEpoch` orders two epochs (AC1)

- **File:** `plugin/src/__tests__/v2/wp28/test_tp01_compare_epoch_verdict_visible.test.ts`
- **Asserts:** the strictly higher epoch wins from either side; equal is `"equal"` at every
  value including the unstamped 0; antisymmetry over a generated corpus; the verdict is one of
  exactly three strings; **everything that is not a non-negative finite integer normalises to
  0** (`undefined`, `null`, `NaN`, `±Infinity`, negatives, fractions, `"3"`, booleans, objects,
  arrays); a numeric string never wins; two never-stamped docs are `equal`, not incomparable.
- **Catches:** `Number(value)` coercion (a corrupt `"9"` cell beating every real board) and a
  bare `a > b` (which answers "not higher" for `undefined` on one side and cannot answer
  "equal" on both).

### TC2 — the epoch is monotonic and host-incremented (AC1)

- **File:** `.../wp28/test_tp02_epoch_monotonic_host_increment_visible.test.ts`
- **Asserts:** `nextEpoch` is strictly greater for every input; a corrupt or absent cell bumps
  to **1**, never `NaN` and never 0; twelve bumps never decrease and never repeat; a bump on an
  unstamped doc lands on 1; a bump is **exactly one transaction touching only `meta`**; `guid`
  and `path` are byte-identical afterwards; the records are untouched; `readEpoch` never writes.
- **Catches:** `epoch + 1` over an unstamped cell (freezes the board at 0 forever), a re-seed
  that happens to raise the epoch, and a `readEpoch` that stamps a default as a side effect.

### TC3 — the higher epoch wins completely, not partially (AC1)

- **File:** `.../wp28/test_tp03_higher_epoch_wins_completely_visible.test.ts`
- **Asserts:** the loser's node id set becomes **exactly** the winner's; the loser-only node is
  absent **as a key** and not tombstoned; the loser-only edge is gone too; a shared record takes
  the winner's record **whole** (no field-wise blend); the tombstone space is replaced; the
  epoch becomes the winner's while `guid`/`path` do not move; the adoption is **one**
  transaction carrying `CANVAS_EPOCH_ADOPT_ORIGIN`; the winner's doc is never mutated; a winner
  with an empty board empties the loser (no "rescue" merge).
- **Catches:** the partial win (trap 4), a `Y.applyUpdate`-based adoption, and a multi-
  transaction replacement that is observable half-done.

### TC4 — the archive is written BEFORE the adoption (AC2) — highest value in this WP

- **File:** `.../wp28/test_tp04_archive_before_adopt_visible.test.ts`
- **Asserts, with two independent ordering oracles:** at the instant of `writeConflictCopy` the
  doc still holds the **loser's** ids, edges and epoch; the archived **content** contains the
  loser-only record and does **not** contain the winner-only record; the write is ordered before
  the doc's first mutation; the serialise precedes both; the archive goes to
  `conflictCopyPath(...)` and nowhere else; **fail-closed** — a rejecting write adopts nothing,
  notifies nothing and opens no transaction; exactly one archive per conflict; and the doc stays
  untouched while a slow write is still in flight.
- **Catches:** adopt-then-archive (trap 3), best-effort archiving, and an archive issued
  concurrently with the adoption rather than sequenced before it.

### TC5 — the notification names the conflict copy (AC2)

- **File:** `.../wp28/test_tp05_notification_names_the_file_visible.test.ts`
- **Asserts:** the message contains the archive path **verbatim**; the named path is the path
  actually written; the notification follows the write; exactly one per conflict;
  `epochConflictNotice` is a sentence, not the bare filename; a different canvas names *that*
  canvas's copy; the injected `today()` is what the message and the path both carry.
- **Catches:** "Live Share: canvas conflict resolved" — which satisfies every "did we notify?"
  assertion and leaves the user unable to find their own version.

### TC6 — `conflictCopyPath` produces `<name>.conflict-<date>.canvas` (AC2)

- **File:** `.../wp28/test_tp06_conflict_copy_path_format_visible.test.ts`
- **Asserts:** the extension is **replaced**, not appended; the folder is preserved at every
  depth; only the trailing `.canvas` is replaced (dotted names and `plan.canvas.canvas`
  survive); spaces and unicode carry through; the result is never the source and always ends in
  `.canvas`; distinct dates give distinct copies; deterministic; **refuses** a non-`.canvas`
  path, a blank date, a date carrying a path separator, and non-string arguments.
- **Catches:** `path + ".conflict-" + date` (a file Obsidian will not open as a canvas),
  `path.replace(".canvas", …)` (replaces the *first* occurrence — breaks on a folder named
  `my.canvas.folder/`), and writing the copy to the vault root.

### TC7 — every replica resolves; no replica merges the two histories (AC1)

- **File:** `.../wp28/test_tp07_every_replica_resolves_visible.test.ts`
- **Asserts:** three replicas (never two — the WP23 AC1 floor), all behind one winner, each end
  on the winner's exact id set and the same epoch; each archives **its own** state; a replica
  already at the winner's epoch archives nothing and keeps its records; after adoption the
  replicas still merge normally — a genuinely contested field is asserted by **convergence +
  membership**, never identity, while the epoch is asserted by identity because every author
  wrote the same single-authored value; no replica resurrects another's private record.
- **Catches:** an adoption that only works for the first replica to see the winner, and an
  adoption that leaves records recoverable through a later merge.

### TC8 — equal epochs merge normally; the archive path does not trigger (AC3)

- **File:** `.../wp28/test_tp08_equal_epochs_merge_normally_visible.test.ts`
- **Asserts, over nine equal-epoch shapes** (both 0, both 5, both 41, neither stamped,
  unstamped-vs-0, corrupt-vs-corrupt, corrupt-vs-unstamped, corrupt-vs-0): no conflict copy, no
  notification, no signature, nothing adopted, no log line, **not one transaction on the doc**,
  no serialisation, and the local records **survive**. Plus: an unstamped doc is not stamped as
  a side effect of comparing; the **local-wins** side archives nothing either; and over a run of
  six merges only the two with a strictly lower local epoch archive.
- **Catches:** "archives on every merge" (trap 5) and "archives whenever the epochs differ",
  which writes a copy of the state it is about to keep.

### TC9 — the log signature records both epoch values (AC4)

- **File:** `.../wp28/test_tp09_conflict_log_signature_visible.test.ts`
- **Asserts:** both numbers appear; each is **attributable** (swapping the arguments changes the
  sentence; `local=` / `remote=` labels); the pair is not a delta; the line names the canvas and
  the archive; it names the winner in agreement with `compareEpoch`; it is **distinct** from
  `INGEST REJECTED` / `QUARANTINE RAISED` / `QUARANTINE LIFTED`; it **throws** on an equal pair;
  a real conflict emits it exactly once on the logger and returns it in the outcome; an
  unstamped loser is recorded as `local=0`, never `undefined` or `NaN`; no signature when the
  local side wins; a missing logger is not an error.
- **Catches:** a signature that records only the winner (`(0,9)`, `(3,9)` and `(8,9)` collapse
  into one line — three different incidents, and the doc has already been overwritten by the
  time anyone reads it).

---

### 7.0.b — Measured state at handover

| Set | Files | Collected | Status |
|---|---|---|---|
| visible `plugin/src/__tests__/v2/wp28` | 9 (+ `harness.ts`) | **104** | all red — `Cannot find module '../../../canvas/canvas-epoch'` |
| blind set 1 | 9 | **62** | `IMPORT_UNRESOLVED` until the module lands |
| blind set 2 | 9 | **67** | `IMPORT_UNRESOLVED` until the module lands |

Counts were established structurally against a throwaway reference stub (104 / 62 / 67, all
green), which was then deleted; `plugin/src/canvas/canvas-epoch.ts` does not exist. Seven
named wrong implementations were each confirmed to turn the intended files red.

**Runner facts:** Vitest 4.0.18, run from `plugin/`. `--reporter=basic` was removed in Vitest 4
— use the default or `--reporter=dot`. Budget ≥90 s for any full `npm test`.

---

## 7b. W4 Test Targets (filled by Worker 3's Unit Test Sub-Agent, if any)

**None. INTEGRATION_SCOPE AC count: 0.**

All four ACs are satisfiable and observable at the module boundary: the comparison, the
increment, the archive-then-adopt sequence, the notification and the signature are all reached
through `canvas-epoch.ts` with an injected `EpochConflictEnv`. Nothing in WP28 requires a live
Obsidian surface, a relay, or the T3 rig. The one integration seam WP28 creates — calling
`resolveEpochConflict` from `CanvasSync`'s merge path with a real `serializeDoc` /
`writeConflictCopy` / `Notice` — is wiring, and the user-visible half of it (the confirmation
flow, the import command) is **WP30's**, which owns its own W4 targets.

---

## 8. Autonomous Execution Plan (filled by Coder Sub-Agent, attempt 1)

- **Observed current behavior:** `plugin/src/canvas/canvas-epoch.ts` did not exist; all 104
  visible tests red on `Cannot find module`. `EPOCH_KEY` was defined (WP27) and stamped to `0`
  once per doc in `CanvasSync.stampIdentity`; nothing compared, incremented or conflict-resolved
  an epoch anywhere in the tree, so every shipped doc carried epoch 0.
- **Approach:** created the module exactly to §7.0's binding surface as a near-pure core
  (`yjs` + `canvas-schema` only), then wired it into `CanvasSync` — `reconcileEpochOnSubscribe`
  (live caller, in `subscribe` after `waitForSync`) and `adoptEpochWinner` (the complete-adoption
  seam WP30 calls). `DELETED_MAP_NAME` is spelt locally in the pure core, deliberately, to keep
  the value-import direction one-way.
- **Fallback path if all attempts fail:** none needed.

---

## 9. Handover Summary (filled by Coder Sub-Agent on completion)

- **What is complete:** all four ACs at the module boundary; 104/104 visible green; `tsc` clean;
  full suite 1687/1687. The archive path is live in `CanvasSync.subscribe`.
- **What remains open:** the COMPLETE adoption on a replica that has already unioned the winner
  cannot be derived after the fact (see the report's *Call Site* section). It is reachable only
  from the side that materialises the winner — WP30's import — through `adoptEpochWinner`.
- **Final status:** `DONE`.

---

## 10. Risk Notes for Worker 4 (filled by Worker 3 Core)

- **Risk flag:** NONE
