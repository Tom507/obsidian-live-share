# Task Charter — WP13: Fractional `ord` allocator

**Charter Status:** `DONE`
**WP:** WP13
**Phase:** P1
**task_mode:** `standard`
**Depends on:** WP8
**W4 Test Targets:** `0`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** `(ord, id)` is a total order that all replicas compute identically.
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 5, component **C13 — Fractional `ord` allocator** (work package WP13); phase **P1**.

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: create (pure module)
  - Responsibility: model order as data, with collision-free concurrent allocation.
  - Scope summary: jitter + clientID tiebreak, total order
- **Out of scope / non-goals:**
  - Deciding *when* to reallocate `ord` from an Obsidian save — that is WP16.
  - Writing `ord` into the `.canvas` file (it must never be written).
  - Any tree/hierarchy modelling — Obsidian groups are geometric, there is no tree CRDT.
- **Known interfaces / dependencies:**
  - Input: the neighbouring `ord` values (either may be absent, meaning "at the start"/"at the end") plus the local `clientID`
  - Output: a new fractional-index string strictly between them
  - Depends on work packages: WP8
  - **Convergence-fuzzer link (required by the BUILD_SPEC):** WP23 `reorder` op + the byte-equality assertion.

---

## 3. Architecture Context

*Task-local architecture guidance only.*

- **Component(s) being changed:** Fractional `ord` allocator
- **Interfaces involved:**
  - Input: the neighbouring `ord` values (either may be absent, meaning "at the start"/"at the end") plus the local `clientID`
  - Output: a new fractional-index string strictly between them
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
  - CONCEPT_V2 Teil 4 (the `ord` row) and Teil 10 (the conservative capture rule)
  - `plugin/src/files/canvas-sync.ts:98–130` — `buildCanvasData`, whose unspecified Y.Map iteration order this replaces
- **Structure references:** *(intentionally empty — no Graphify graph exists for this project; FALLBACK mode is declared in the BUILD_SPEC section 3. Worker 3 fills this in after implementation. Do not invent paths here.)*

If structure references conflict with the BUILD_SPEC or explicit task scope, the BUILD_SPEC and TaskCharter win. Escalate instead of following the map.

---

## 4. Acceptance Criteria

*Exact copy from BUILD_SPEC section 5, component C13. No paraphrasing.*

1. An allocated value sorts strictly between its two neighbours under the module's comparison, including at the head and tail of the sequence.
2. Two clients allocating between the *same* pair of neighbours produce **different** strings (jitter + `clientID` suffix), and the resulting total order `(ord, id)` is identical on every replica.
3. Repeated allocation between ever-closer neighbours terminates and stays correct — the string grows rather than colliding or losing precision.
4. An allocated value is immutable: the module offers no operation that rewrites an existing `ord` in place, only allocation of new values.

**Definition of Done:** `(ord, id)` is a total order that all replicas compute identically.

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
  - a new fractional-index module under `plugin/src/canvas/`
- **Required report:** `ImplementationReport_WP13.md` (in `workflowArtifacts/canvas-v2/`)
- **BUILD_SPEC updates required:** no — unless implementation invalidates an architecture decision, in which case ESCALATE rather than editing the spec.
- **Gate status required at handover:** `npm run build` PASS and `npm test` with 0 failures, run from `plugin/`. All visible tests PASS.

---

## 7. Visible Test Cases / Producer Artifacts

*Filled by Worker 3's Unit Test Sub-Agent. Worker 2 leaves this section empty.*

Module under test (create-path, does not exist yet): `plugin/src/canvas/canvas-ord.ts`.

**Binding API surface for the Coder Sub-Agent** (Shared Ownership Contract §1 — WP8, WP16, WP17 import these, never re-implement):

```ts
export type OrdRng = () => number; // returns a value in [0, 1); default Math.random at the call site only

export function allocateOrd(
  before: string | undefined,
  after: string | undefined,
  clientID: string,
  rng?: OrdRng,
): string;

export function compareOrd(a: string, b: string): number; // standard comparator: <0, 0, >0

export interface OrdIdEntry {
  readonly ord: string;
  readonly id: string;
}

export function compareOrdId(a: OrdIdEntry, b: OrdIdEntry): number;
// = compareOrd(a.ord, b.ord) !== 0 ? compareOrd(a.ord, b.ord) : (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
```

The `rng` parameter is the mandatory randomness seam: jitter must never read `Math.random` (or any
ambient source) directly, only through this injected parameter, so allocation is reproducible under
a seeded generator in tests. No other export is licensed — AC4 is pinned by a dynamic scan of the
module's own export list, so any additional exported function (a rewrite/update operation) fails the
suite.

### TC1 — allocated value sorts strictly between two neighbours (middle case)
- Verifies AC: AC1
- Test file: `plugin/src/__tests__/v2/wp13/test_tp01_strictly_between_neighbours_visible.test.ts`
- What it checks: `allocateOrd(before, after, clientID)` produces a value `compareOrd` places strictly between `before` and `after`, across several independent pairs, using the module's own comparator as the sole oracle (never `<` on raw strings).
- Test data channel: neighbours derived from the allocator itself (`allocateOrd(undefined, undefined, …)` seed pair), not hand-picked literals.

### TC2 — head allocation sorts strictly before the existing first element
- Verifies AC: AC1
- Test file: `plugin/src/__tests__/v2/wp13/test_tp02_head_allocation_visible.test.ts`
- What it checks: `allocate(undefined, first)` sorts strictly before `first`; also exercises the true base case `allocate(undefined, undefined)` as setup, and chains two head insertions to confirm ordering compounds correctly.
- Test data channel: a single existing element, then a chain of head insertions in front of it.

### TC3 — tail allocation sorts strictly after the existing last element
- Verifies AC: AC1
- Test file: `plugin/src/__tests__/v2/wp13/test_tp03_tail_allocation_visible.test.ts`
- What it checks: `allocate(last, undefined)` sorts strictly after `last`; chains three tail appends and verifies the whole chain is strictly increasing end to end.
- Test data channel: a single existing element, then a chain of tail appends after it.

### TC4 — distinct clientIDs racing the same neighbour pair produce distinct ords
- Verifies AC: AC2
- Test file: `plugin/src/__tests__/v2/wp13/test_tp04_distinct_clients_distinct_ords_visible.test.ts`
- What it checks: two/three distinct `clientID`s, fed directly (no simulated Yjs concurrency) with the same `before`/`after` and identically-seeded `rng` per call, produce pairwise-distinct ord strings, each still strictly between the neighbours.
- Test data channel: fixed neighbour pair plus a small set of literal clientID strings.

### TC5 — `(ord, id)` total order agrees across replicas regardless of arrival order
- Verifies AC: AC2
- Test file: `plugin/src/__tests__/v2/wp13/test_tp05_replica_total_order_agreement_visible.test.ts`
- What it checks: the same batch of `{ord, id}` entries, sorted by `compareOrdId` from three different starting permutations, converges on one identical id sequence; also pins the equal-ord tie-break (falls back to lexicographic `id`) as part of the comparator's total-order contract.
- Test data channel: entries built from allocator output plus one literal colliding-ord pair for the tie-break case.

### TC6 — repeated dense allocation between ever-closer neighbours terminates and stays correct
- Verifies AC: AC3
- Test file: `plugin/src/__tests__/v2/wp13/test_tp06_dense_allocation_terminates_visible.test.ts`
- What it checks: 120 successive midpoint allocations narrowing toward the same neighbour never collide, the full resulting chain still sorts correctly under `compareOrd`, and allocated string length eventually exceeds the original endpoints' length (precision comes from string growth, never a float midpoint).
- Test data channel: a driven loop, no wall-clock sleeps, no timing constants; a seeded deterministic `rng` (mulberry32) throughout.

### TC7 — the module exports no mutating operation on an existing ord
- Verifies AC: AC4
- Test file: `plugin/src/__tests__/v2/wp13/test_tp07_no_mutating_export_visible.test.ts`
- What it checks: a dynamic scan of the module's own exports rejects any name matching a mutating-operation pattern, pins the function-export allowlist to exactly `allocateOrd`/`compareOrd`/`compareOrdId`, and confirms a previously returned ord string is never retroactively changed by later allocations.
- Test data channel: `Object.keys` / `typeof` introspection of the imported module namespace, so a later WP adding a mutator breaks this test.

---

## 7b. W4 Test Targets (filled by Worker 3's Unit Test Sub-Agent, if any)

*Empty at handover.*

---

## 8. Autonomous Execution Plan (filled by Coder Sub-Agent, attempt 1)

- **Observed current behavior:** no `ord` concept existed in the doc; record order was whatever
  `Y.Map` iteration produced (`canvas-sync.ts:98–130`, `buildCanvasData`), i.e. unspecified and
  free to differ between replicas holding identical state.
- **Approach:** one pure module, `plugin/src/canvas/canvas-ord.ts`, zero imports. An `ord` is a
  base-62 digit string over `0-9A-Za-z` — an alphabet whose character order equals its digit-value
  order, so lexicographic UTF-16 comparison *is* the value comparison. `allocateOrd` walks the two
  neighbour strings digit by digit and returns the shortest jittered digit string strictly between
  them, then appends a fixed-width 12-digit `clientID` fingerprint as the AC2 tiebreak (appending
  cannot disturb strict betweenness, only decide between siblings). `compareOrd` is plain
  code-unit comparison; `compareOrdId` falls back to the record `id`. No mutator is exported.
- **Fallback path if all attempts fail:** not needed — attempt 1 landed all 7 visible test files
  green on first run.

---

## 9. Handover Summary (filled by Coder Sub-Agent on completion)

- **What is complete:** `plugin/src/canvas/canvas-ord.ts` with exactly the contracted surface
  (`OrdRng`, `allocateOrd`, `compareOrd`, `OrdIdEntry`, `compareOrdId`). AC1–AC4 all covered;
  7/7 visible test files, 20/20 tests pass; `tsc -noEmit -skipLibCheck` introduces no new error.
- **What remains open:** nothing in scope. Wiring into the parser / serialiser / migration is
  WP16 / WP17 / WP8 and was deliberately not done. The batch-level `npm test` and `npm run build`
  gates are Worker 3's to run once at the end of the batch (per this attempt's instructions).
- **Final status:** DONE.

---

## 10. Risk Notes for Worker 4 (filled by Worker 3 Core)

- **Risk flag:** NONE
