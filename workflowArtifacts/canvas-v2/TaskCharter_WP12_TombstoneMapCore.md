# Task Charter — WP12: Tombstone map core

**Charter Status:** `DONE`
**WP:** WP12
**Phase:** P1
**task_mode:** `standard`
**Depends on:** WP8
**W4 Test Targets:** `0`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** delete, undo and quarantine are one converging mechanism with a single suppression rule.
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 5, component **C12 — Tombstone map core** (work package WP12); phase **P1**.

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: create (pure module for the `deleted` container semantics)
  - Responsibility: model deletion, undo and quarantine as a converging flag rather than as key absence.
  - Scope summary: `deleted` container, LWW flag, suppression predicate
- **Out of scope / non-goals:**
  - Wiring tombstones into capture, reconcile and serialisation — that is WP19.
  - The quarantine auditor's decision logic — that is WP20 (this WP provides the `q` flag mechanics only).
  - Sidecar tombstone GC — that is WP25.
- **Known interfaces / dependencies:**
  - Input: delete / undelete / quarantine / release-quarantine operations with `(t, by)`
  - Output: a suppression predicate consumed by reconcile, serialisation and capture
  - Depends on work packages: WP8
  - **Convergence-fuzzer link (required by the BUILD_SPEC):** WP23 `delete` / `undo` ops; the SEC assertion must cover concurrent delete-vs-edit and delete-vs-undelete.

---

## 3. Architecture Context

*Task-local architecture guidance only.*

- **Component(s) being changed:** Tombstone map core
- **Interfaces involved:**
  - Input: delete / undelete / quarantine / release-quarantine operations with `(t, by)`
  - Output: a suppression predicate consumed by reconcile, serialisation and capture
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
  - **Schema impact:** **`meta.schemaVersion = 2`.** The *doc* format changes; the `.canvas` *file* format does not. Mixed-version rule (CONCEPT_V2 Teil 12): a client whose major schema version differs from the doc's goes to Receive-and-Persist rather than guessing a translation. In P1 that degradation is local — capture disabled for the path, persistence continues — and it is unified with the room-level mode in WP32.
- **Entry points / relevant files (from `workflowArtifacts/RepoMap.md`, V2 Touchpoint Inventory):**
  - CONCEPT_V2 Teil 4 — the `deleted` row and the undo argument
  - `plugin/src/files/canvas-sync.ts:620–704` — the current delete-by-diff logic being replaced (read only)
  - `ARCHITECTURE.md` Appendix A.2/11 — delete-vs-edit semantics to preserve
- **Structure references:** *(intentionally empty — no Graphify graph exists for this project; FALLBACK mode is declared in the BUILD_SPEC section 3. Worker 3 fills this in after implementation. Do not invent paths here.)*

If structure references conflict with the BUILD_SPEC or explicit task scope, the BUILD_SPEC and TaskCharter win. Escalate instead of following the map.

---

## 4. Acceptance Criteria

*Exact copy from BUILD_SPEC section 5, component C12. No paraphrasing.*

1. `deleted[id]` carries `{t, by, on}` and optionally `q`; concurrent operations on the same id converge by LWW on `on` using `t` with `by` as tiebreak, identically on every replica.
2. `on:true` suppresses the record in all three consumers — reconcile output, serialisation and capture resurrect-blocking — through one shared predicate, not three copies.
3. Undo of a delete (`on:false`) restores the record with **all** its field values intact, because field containers were never destroyed.
4. Quarantine (`q:true` with `on:true`) is distinguishable from a user delete, and releasing quarantine restores the record without a user-visible delete/undelete event.

**Definition of Done:** delete, undo and quarantine are one converging mechanism with a single suppression rule.

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
  - a new tombstone module under `plugin/src/canvas/`
- **Required report:** `ImplementationReport_WP12.md` (in `workflowArtifacts/canvas-v2/`)
- **BUILD_SPEC updates required:** no — unless implementation invalidates an architecture decision, in which case ESCALATE rather than editing the spec.
- **Gate status required at handover:** `npm run build` PASS and `npm test` with 0 failures, run from `plugin/`. All visible tests PASS.

---

## 7. Visible Test Cases / Producer Artifacts

*Filled by Worker 3's Unit Test Sub-Agent. Worker 2 leaves this section empty.*

Module under test (create-path, does not exist yet): `plugin/src/canvas/canvas-tombstone.ts`.

**Binding API surface for the Coder Sub-Agent** (Shared Ownership Contract §1 — WP12 is the single
owner of the `deleted` entry shape, its LWW merge and the suppression predicate; WP15 and WP17
import from here and must never re-implement any of it):

```ts
export interface TombstoneEntry {
  readonly t: number; // Lamport timestamp
  readonly by: string; // clientID
  readonly on: boolean; // true = suppressed (deleted/quarantined)
  readonly q?: boolean; // true only alongside on:true = quarantine, not a user delete
}

export interface TombstoneMap {
  get(key: string): unknown;
  set(key: string, value: unknown): unknown;
}

// The pure merge: given two candidate entries for the SAME id, returns the
// LWW winner. Higher `t` wins outright; on equal `t`, the entry whose `by`
// sorts GREATER under plain lexicographic string comparison wins (never a
// numeric interpretation, never Yjs's own clientID tie-break). Commutative
// (argument order never changes the result) and idempotent (merging an
// entry with an equal-value copy of itself is a no-op).
export function mergeTombstoneEntries(a: TombstoneEntry, b: TombstoneEntry): TombstoneEntry;

// Read the current entry for `id`, or undefined if none exists yet.
export function readTombstoneEntry(map: TombstoneMap, id: string): TombstoneEntry | undefined;

// Apply one op (delete / undo / quarantine / release-quarantine — all are
// the SAME shape, just different `on`/`q` values) to `map` for `id`: reads
// the current entry, merges it with `op` via mergeTombstoneEntries, stores
// and returns the result. Undo, quarantine and release are not special
// cases — they are ordinary ops that win or lose by the same (t, by) rule
// as a delete, so a stale op of any kind can never override a fresher one.
export function applyTombstoneOp(map: TombstoneMap, id: string, op: TombstoneEntry): TombstoneEntry;

// THE single suppression predicate (AC2) — reconcile output, serialisation
// and capture resurrect-blocking must ALL call this one function, never
// reimplement "is this record deleted". true iff entry !== undefined && entry.on === true.
export function isTombstoneSuppressed(entry: TombstoneEntry | undefined): boolean;

// Distinguishes quarantine from a user delete (AC4): true iff the entry is
// CURRENTLY suppressed (on:true) AND q:true. A lingering q:true on an
// on:false (released/undone) entry must read as false — quarantine is a
// property of the current suppressed state, not a permanent tag.
export function isTombstoneQuarantined(entry: TombstoneEntry | undefined): boolean;
```

**Naming constraints the dynamic-scan tests enforce** (do not introduce a name matching these
patterns for any purpose other than the function it is pinned to): no exported name besides
`isTombstoneSuppressed` may match `/suppress|isdeleted|isremoved|ishidden|shouldhide|shouldsuppress/i`
or the broader `/delete|remove|hidden|suppress/i`; no exported name may match
`/event|notify|emit|listener|subscribe|onchange/i` (this module offers no event/notification
side channel at all); no exported name may match `/releasequarantine|unquarantine|revokequarantine|quarantinerelease/i`
— releasing a quarantine is an ordinary `applyTombstoneOp` call, not a dedicated function.

The module must import nothing but plain TypeScript (no Yjs, no Obsidian, no filesystem, no clock) —
the purity contract every P1 core in this batch follows (precedent: `canvas-ord.ts`, `canvas-type-guard.ts`).
The tombstone container is reached through the structural `TombstoneMap` interface, exactly as
`canvas-registers.ts`'s `V2RecordMap` lets its accessors stay unit-testable without a real `Y.Map`.
Losslessness (AC3) follows structurally from this module never being handed a record's own field
container at all — it only ever touches the separate `deleted` map keyed by id.

### TC1 — a higher Lamport t wins the merge outright, regardless of on or by
- Verifies AC: AC1
- Test file: `plugin/src/__tests__/v2/wp12/test_tp01_higher_t_wins_visible.test.ts`
- What it checks: `mergeTombstoneEntries(a, b)` picks the entry with the strictly higher `t` in both directions (delete-over-undo and undo-over-delete), and the result is identical however the two arguments are ordered.
- Test data channel: hand-picked `(t, by, on)` literal pairs.

### TC2 — equal t breaks the tie on by, lexicographically and deterministically
- Verifies AC: AC1
- Test file: `plugin/src/__tests__/v2/wp12/test_tp02_equal_t_by_tiebreak_visible.test.ts`
- What it checks: with equal `t`, the entry whose `by` sorts greater under plain string comparison wins, argument order does not matter, and the comparison is confirmed to be lexicographic (not numeric) via an `"aaa"`/`"aab"` pair.
- Test data channel: hand-picked equal-`t` literal pairs.

### TC3 — the merge is commutative and idempotent
- Verifies AC: AC1
- Test file: `plugin/src/__tests__/v2/wp12/test_tp03_merge_commutative_idempotent_visible.test.ts`
- What it checks: `mergeTombstoneEntries(a, b) === mergeTombstoneEntries(b, a)` for several distinct pairs, merging an entry with itself changes nothing, and re-applying the identical op to the same map twice via `applyTombstoneOp` is a no-op the second time.
- Test data channel: hand-picked literal entries plus a `StubTombstoneMap` (local `get`/`set` stub, no Yjs).

### TC4 — tombstone convergence is identical on every replica regardless of arrival order
- Verifies AC: AC1
- Test file: `plugin/src/__tests__/v2/wp12/test_tp04_replica_order_independent_convergence_visible.test.ts`
- What it checks: three independent stub maps ("replicas") applying the same three ops in three different orders via `applyTombstoneOp` converge on the identical final entry — the pure-merge analogue of a CRDT convergence test, deliberately not staging a raw concurrent `Y.Map` write race (Shared Ownership Contract §4).
- Test data channel: three literal ops (including one equal-`t` tie) plus three arrival-order permutations.

### TC5 — one shared suppression predicate answers all three consumer questions identically
- Verifies AC: AC2
- Test file: `plugin/src/__tests__/v2/wp12/test_tp05_single_predicate_three_consumers_visible.test.ts`
- What it checks: three tiny stand-ins for reconcile output, serialisation and capture resurrect-blocking are each implemented purely in terms of `isTombstoneSuppressed`, and all three agree for a deleted entry, a visible (undone) entry and an absent (`undefined`) entry.
- Test data channel: two literal entries plus the `undefined` (never-deleted) case.

### TC6 — the module exports exactly one suppression predicate
- Verifies AC: AC2
- Test file: `plugin/src/__tests__/v2/wp12/test_tp06_no_duplicate_suppression_predicate_export_visible.test.ts`
- What it checks: a dynamic scan (`Object.keys` of the imported module namespace) confirms exactly one exported function matches a suppression-predicate naming pattern, and it is `isTombstoneSuppressed` — the same pattern WP13's `test_tp07_no_mutating_export_visible.test.ts` uses to pin its own surface.
- Test data channel: introspection of the module namespace itself, no fixture data.

### TC7 — undo of a delete restores the record with all field values intact
- Verifies AC: AC3
- Test file: `plugin/src/__tests__/v2/wp12/test_tp07_lossless_undo_field_container_untouched_visible.test.ts`
- What it checks: a full field set on an independent `FieldContainer` stub (whose own `delete`/`clear` throw if ever called) survives a delete+undo cycle byte-identical, and the tombstone operations never touch it at all — proving the field container was never destroyed, not merely that it looks intact afterward.
- Test data channel: a literal node-shaped field record (`id`, `type`, `pos`, `size`, `text`, `color`) plus a `StubTombstoneMap`.

### TC8 — a stale undo never resurrects a record over a later delete
- Verifies AC: AC3
- Test file: `plugin/src/__tests__/v2/wp12/test_tp08_stale_undo_does_not_override_later_delete_visible.test.ts`
- What it checks: undo is not special-cased — a lower-`t` undo arriving after a higher-`t` delete leaves the record suppressed, while a higher-`t` undo does restore it; proves delete/undo/quarantine are "one converging mechanism with a single suppression rule" (Definition of Done), not separately-arbitrated operations.
- Test data channel: hand-picked literal `(t, by, on)` op sequences applied via `applyTombstoneOp`.

### TC9 — quarantine is distinguishable from a user delete even though both suppress
- Verifies AC: AC4
- Test file: `plugin/src/__tests__/v2/wp12/test_tp09_quarantine_distinguishable_from_user_delete_visible.test.ts`
- What it checks: `isTombstoneSuppressed` is true for both a plain delete and a quarantine, but only `isTombstoneQuarantined` distinguishes them; also pins the edge case that a lingering `q:true` on an `on:false` entry does not read as quarantined.
- Test data channel: hand-picked literal entries covering the delete / quarantine / released-with-stale-q cases.

### TC10 — releasing a quarantine restores the record with no separate user-visible event channel
- Verifies AC: AC4
- Test file: `plugin/src/__tests__/v2/wp12/test_tp10_quarantine_release_no_visible_event_visible.test.ts`
- What it checks: the module exports no event/notification surface at all (dynamic scan), and a quarantine release goes through the exact same `applyTombstoneOp` call shape as an ordinary undo, producing a result with the identical key shape — there is no dedicated "release" function whose existence alone could signal something user-visible happened.
- Test data channel: literal quarantine + release op pairs plus introspection of the module namespace.

---

## 7b. W4 Test Targets (filled by Worker 3's Unit Test Sub-Agent, if any)

*Empty at handover.*

---

## 8. Autonomous Execution Plan (filled by Coder Sub-Agent, attempt 1)

- **Observed current behavior:** `plugin/src/canvas/canvas-tombstone.ts` did not exist; all 10 visible test files failed at import. V1 still models deletion as key ABSENCE (`canvas-sync.ts:620–704`), which carries no author, no time and no intent and therefore cannot merge — the resurrection / lossy-undo pair this WP removes.
- **Approach:** one pure module, zero imports. `TombstoneEntry = {t, by, on, q?}`; `TombstoneMap` is a structural `get`/`set` seam that `Y.Map<unknown>` satisfies without a cast (WP9's `V2RecordMap` technique). The merge is `max` over the **total** order `(t, by, on, q)` — higher `t` outright, equal `t` breaks on the greater `by` under plain lexicographic string comparison. Making the order total (rather than stopping at `(t, by)`) is what buys commutativity, associativity and idempotence in one step, hence convergence under any arrival permutation, without ever consulting Yjs's random-clientID arbitration. Delete / undo / quarantine / release are one call, `applyTombstoneOp`, differing only in payload, so a stale op of any kind loses by the same rule. Losslessness (AC3) is structural: the module is never handed a record's field container, and the seam exposes no `delete`/`clear`. `isTombstoneSuppressed` is the single, `q`-agnostic suppression predicate; `isTombstoneQuarantined` requires `on:true` AND `q:true`. `q` is normalised to "present only when true" so an undo and a quarantine release produce identical key shapes.
- **Fallback path if all attempts fail:** not needed — attempt 1 passed all visible tests and the typecheck.

---

## 9. Handover Summary (filled by Coder Sub-Agent on completion)

- **What is complete:** `plugin/src/canvas/canvas-tombstone.ts` created (zero imports, pure core). All four ACs met. All 10 visible test files pass (18 tests, `npx vitest run src/__tests__/v2/wp12/ --reporter=dot`). `npx tsc -noEmit -skipLibCheck` clean, 0 errors, none new. No existing test deleted, skipped, weakened or relaxed. `ImplementationReport_WP12.md` written, including the precise statements of the suppression predicate and the merge rule that WP15/WP17 consume instead of re-deriving them.
- **What remains open:** nothing in WP12's scope. Downstream by design: wiring into capture / reconcile / serialisation (WP19), the quarantine auditor's decision logic (WP20), sidecar tombstone GC (WP25 — note the `TombstoneMap` seam deliberately has no `delete`, so WP25 must widen it explicitly). WP23's fuzzer `delete`/`undo` ops map onto `applyTombstoneOp` with `on:true`/`on:false`.
- **Final status:** `DONE`

---

## 10. Risk Notes for Worker 4 (filled by Worker 3 Core)

- **Risk flag:** NONE
