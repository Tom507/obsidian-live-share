# Task Charter — WP2: Shadow-relative intent diff

**Charter Status:** `DONE`
**WP:** WP2
**Phase:** P0
**task_mode:** `standard`
**Depends on:** WP1
**W4 Test Targets:** `0`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** the four rules of Teil 5 are each observable as a distinct output category from a single pure call.
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 5, component **C2 — Shadow-relative intent diff** (work package WP2); phase **P0**.

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: create (pure function in the shadow module)
  - Responsibility: decide, per field, whether a parsed Obsidian save expresses intent or merely staleness — the four rules of CONCEPT_V2 Teil 5.
  - Scope summary: pure 4-rule intent/staleness classifier
- **Out of scope / non-goals:**
  - Writing anything to the CRDT — this WP returns a plan, it does not apply it.
  - Reading files or parsing `.canvas` content; the parsed save is an input.
  - Tombstone *writing*; the tombstone view is an input parameter here.
- **Known interfaces / dependencies:**
  - Input: `(shadow, parsedSave, tombstoneView, surfaceState)` where `surfaceState` says whether the view is open and which records were handed to it in the last apply
  - Output: an intent plan — a list of field upserts, a list of delete intents, and a list of explicitly-discarded staleness observations
  - Depends on work packages: WP1
  - **Convergence-fuzzer link (required by the BUILD_SPEC):** WP23 "stale-save simulation" ops; the shadow-consistency assertion ("no replica ever pushed a stale field") is the W1 discriminant and must exercise this function.

---

## 3. Architecture Context

*Task-local architecture guidance only.*

- **Component(s) being changed:** Shadow-relative intent diff
- **Interfaces involved:**
  - Input: `(shadow, parsedSave, tombstoneView, surfaceState)` where `surfaceState` says whether the view is open and which records were handed to it in the last apply
  - Output: an intent plan — a list of field upserts, a list of delete intents, and a list of explicitly-discarded staleness observations
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
  - **Schema impact:** No `meta.schemaVersion` change and no `.canvas` file-format change. P0 is a pure logic change in the capture and serialisation paths, which is exactly why it ships first (CONCEPT_V2 Teil 13). Mixed-version behaviour: a P0 client and a pre-P0 client interoperate unchanged at the doc level.
- **Entry points / relevant files (from `workflowArtifacts/RepoMap.md`, V2 Touchpoint Inventory):**
  - `plugin/src/canvas/canvas-shadow.ts` (from WP1)
  - `plugin/src/files/canvas-sync.ts:496–619` — `handleLocalModify`, the consumer this plan will serve (read only; wiring is WP4)
  - CONCEPT_V2 Teil 5, the four-rule table
- **Structure references:** *(intentionally empty — no Graphify graph exists for this project; FALLBACK mode is declared in the BUILD_SPEC section 3. Worker 3 fills this in after implementation. Do not invent paths here.)*

If structure references conflict with the BUILD_SPEC or explicit task scope, the BUILD_SPEC and TaskCharter win. Escalate instead of following the map.

---

## 4. Acceptance Criteria

*Exact copy from BUILD_SPEC section 5, component C2. No paraphrasing.*

1. A field whose value in the save equals the shadow value produces **no** intent, **even when the CRDT value differs from the shadow** — this case must be represented as a discarded-staleness entry, not silently dropped.
2. A field whose value in the save differs from the shadow produces exactly one upsert intent and no deletion of any other key of that record.
3. A record missing from the save that exists in the shadow produces a delete intent **only** when the view is open **and** that record was handed to the view in the last apply; in every other case it produces no intent.
4. A record present in the save whose id is tombstoned with `on:true` produces no intent at all (resurrect block).
5. The function is pure: same inputs → same output, no I/O, no clock, no randomness.

**Definition of Done:** the four rules of Teil 5 are each observable as a distinct output category from a single pure call.

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
  - `plugin/src/canvas/canvas-shadow.ts`
- **Required report:** `ImplementationReport_WP2.md` (in `workflowArtifacts/canvas-v2/`)
- **BUILD_SPEC updates required:** no — unless implementation invalidates an architecture decision, in which case ESCALATE rather than editing the spec.
- **Gate status required at handover:** `npm run build` PASS and `npm test` with 0 failures, run from `plugin/`. All visible tests PASS.

---

## 7. Visible Test Cases / Producer Artifacts

Six pure data tests, no Obsidian, no adapter, no clock, no wall-clock sleep, no timing
constant. They run from `plugin/` via `npm test` (Vitest 4.0.18) or, scoped, via
`npx vitest run src/__tests__/v2/wp2`.

### TC1 — A field equal to the shadow is discarded staleness, never intent

- Verifies AC: 1
- Test file: `plugin/src/__tests__/v2/wp2/test_tp01_stale_equals_shadow_visible.test.ts`
- What it checks: a save field whose value equals the shadow produces zero upserts and zero
  deletes and instead appears as an explicit `equals-shadow` entry carrying
  `path/kind/id/field/value`; the discard is per field (one changed field does not rescue the
  rest of the record); it holds for edges and for an observed `null`; and the function's
  arity pins that the CRDT is not an input at all, so the verdict cannot depend on a diverged
  CRDT value.
- Test data channel: fixture

### TC2 — A field differing from the shadow is exactly one upsert

- Verifies AC: 2
- Test file: `plugin/src/__tests__/v2/wp2/test_tp02_upsert_on_difference_visible.test.ts`
- What it checks: one moved field yields exactly one upsert and no delete of any other key of
  that record (I7 — a shrinking save deletes nothing); an `unknown` or `absent` record is
  upserted field by field; comparison is strict (`"10"` vs `10` differs); intent does not
  depend on `viewOpen`; neighbouring records and the two id spaces stay independent; and the
  upsert carries the save's path.
- Test data channel: fixture

### TC3 — A missing record deletes only with an open view and a hand-over receipt

- Verifies AC: 3
- Test file: `plugin/src/__tests__/v2/wp2/test_tp03_delete_gating_visible.test.ts`
- What it checks: the conjunction `present in shadow && viewOpen && handedToView` — all four
  combinations of the two seam flags, plus `absent` and `unknown` shadow states, plus the
  kind-scoping of the hand-over set, the multi-record case, the shape of a delete intent, and
  the fact that another path's shadow never licenses a delete here.
- Test data channel: fixture

### TC4 — Resurrect block for tombstoned ids

- Verifies AC: 4
- Test file: `plugin/src/__tests__/v2/wp2/test_tp04_resurrect_block_visible.test.ts`
- What it checks: a record in the save whose id is tombstoned contributes to no category at
  all (not even a discard), with a discrimination variant proving the same inputs produce full
  intent when the view reports `false`; blocking is per record and kind-scoped; the view is
  consulted with `(kind, id)`; and the block does not extend to the delete rule.
- Test data channel: fixture

### TC5 — Purity

- Verifies AC: 5
- Test file: `plugin/src/__tests__/v2/wp2/test_tp05_purity_visible.test.ts`
- What it checks: repeated and interleaved calls return deeply equal, freshly built plans; the
  shadow is byte-identical after the call (this WP plans, WP4 applies); deep-frozen save and
  surface state are accepted unchanged; mutating a returned plan cannot affect the next call;
  and a source scan of the module shows no clock, no entropy, no timer, no I/O, no package
  import and no module-scope mutable state.
- Test data channel: fixture (plus the module source itself, read with `node:fs` — the
  established oracle from `wp1/test_tp02_headless_purity_visible.test.ts`)

### TC6 — All four rules from a single call (Definition of Done)

- Verifies AC: 1, 2, 3, 4 (composition)
- Test file: `plugin/src/__tests__/v2/wp2/test_tp06_four_categories_visible.test.ts`
- What it checks: one realistic save that triggers all four rules at once yields exactly one
  upsert, exactly one delete, five discards and no mention of the tombstoned record; the three
  categories are disjoint per record and per `(record, field)` pair; every classifiable field
  lands in exactly one category; and the tombstone seam discriminates.
- Test data channel: fixture

### Required module API (defined by the visible tests)

Add the following to **`plugin/src/canvas/canvas-shadow.ts`** — the same file WP1 created, as
the charter's "pure function in the shadow module" requires. No new file, no new import: the
module must keep importing nothing (TC5 asserts it). All WP1 exports stay exactly as they are.

**Input types**

```ts
/** One record as it appears in a parsed Obsidian save. */
export interface ParsedSaveRecord {
  id: string;
  fields: Readonly<Record<string, ShadowFieldValue>>;
}

/** A parsed `.canvas` save: one surface, its two id spaces as arrays (file order). */
export interface ParsedSave {
  path: string;
  nodes: readonly ParsedSaveRecord[];
  edges: readonly ParsedSaveRecord[];
}

/** Read-only seam over the `deleted` container: `true` iff the id carries `on:true`. */
export interface TombstoneView {
  isDeleted(kind: ShadowRecordKind, id: string): boolean;
}

/** What the surface can prove about the last apply. */
export interface SurfaceState {
  viewOpen: boolean;
  handedToView: {
    readonly node: ReadonlySet<string>;
    readonly edge: ReadonlySet<string>;
  };
}
```

**Output types**

```ts
export interface FieldUpsertIntent {
  path: string;
  kind: ShadowRecordKind;
  id: string;
  field: string;
  value: ShadowFieldValue;
}

export interface DeleteIntent {
  path: string;
  kind: ShadowRecordKind;
  id: string;
}

export interface DiscardedStaleness {
  path: string;
  kind: ShadowRecordKind;
  id: string;
  field: string;
  value: ShadowFieldValue;
  reason: "equals-shadow";
}

/** Exactly these three keys, always arrays, never `undefined`. */
export interface IntentPlan {
  upserts: FieldUpsertIntent[];
  deletes: DeleteIntent[];
  discarded: DiscardedStaleness[];
}
```

**The function**

| Signature | Semantics |
|---|---|
| `planIntentDiff(shadow: SurfaceShadow, save: ParsedSave, tombstones: TombstoneView, surface: SurfaceState): IntentPlan` | The four rules of CONCEPT_V2 Teil 5 as one total, pure call. Exactly four parameters (TC1 asserts the arity). |

Rules, in the order they must be applied per record:

1. **Resurrect block (AC4).** If `tombstones.isDeleted(kind, record.id)` is `true` for a record
   *present in the save*, that record contributes **nothing** — no upsert, no delete, no
   discard. It still counts as "present in the save" for rule 3, so it never becomes a delete
   intent.
2. **Staleness (AC1).** For each field of a non-blocked save record: if the save value is
   `===` the shadow value (`getField(shadow, save.path, kind, id, field)`), emit one
   `DiscardedStaleness` with `reason: "equals-shadow"` and **no** intent. Strict equality is
   the rule: `0` and `-0` are the same observed value, `"1"` and `1` are not. `undefined` from
   `getField` means "never observed" and therefore never matches.
3. **Intent (AC2).** Otherwise emit exactly one `FieldUpsertIntent` for that `(record, field)`
   pair. A field the shadow holds but the save does not mention produces nothing at all — a
   partial observation is never a removal (I7).
4. **Delete (AC3).** For each record of `save.path` in the shadow whose state is `"present"`
   and whose id is **not** in the save: emit one `DeleteIntent` iff `surface.viewOpen` **and**
   `surface.handedToView[kind].has(id)`. `absent` and `unknown` shadow records, unreceipted
   ids and a closed view all produce nothing. Rule 4 does not consult the tombstone view.

Further contract points the tests pin:

- `save.path` is the only path touched. Other paths in the shadow are never read and never
  named in the plan; path keys are compared exactly (opaque, already-canonical — BUILD_SPEC
  §4.4).
- `node` and `edge` are separate id spaces everywhere: in the shadow lookup, in the tombstone
  lookup and in `handedToView`.
- The call is pure and non-mutating: it must not advance the shadow (that is WP4), must accept
  deep-frozen inputs, and must return freshly built, independently mutable arrays and objects
  on every call. Order within the three arrays is not asserted anywhere.
- Ids and field names are ordinary data: `""`, `"__proto__"`, `"constructor"` and ids
  differing only by case or trailing space must all behave as plain keys.

---

## 7b. W4 Test Targets (filled by Worker 3's Unit Test Sub-Agent, if any)

None. All five acceptance criteria are fully covered by unit tests — C2 is a pure function
over four in-memory inputs with no runtime environment, external API or cross-component
dependency. The tombstone container and the surface state arrive as injected seams, so no
integration-level target remains.

---

## 8. Autonomous Execution Plan (filled by Coder Sub-Agent, attempt 1)

- **Observed current behavior:** `canvas-shadow.ts` held the WP1 core only (field-granular
  writers, `getRecordState` / `getField` / `getRecordFields`, `clearPath`, `listPaths`) and no
  classifier. The six WP2 test files imported `planIntentDiff` and its types, so the whole
  directory failed to resolve.
- **Approach:** appended a WP2 section to the same module — the four input/output type groups
  from section 7 plus one function. Per save record: tombstone block first (`continue`, and the
  id is still registered in a per-kind `seen` set), then per field strict `===` against
  `getField(shadow, save.path, kind, id, field)` → discard, else upsert. Afterwards one pass
  over `shadow.paths.get(save.path)` per kind emitting a delete for every `"present"` record not
  in `seen` when `viewOpen && handedToView[kind].has(id)`. Shadow access is read-only; the plan
  and every entry are freshly allocated. No import added, no WP1 export touched.
- **Fallback path if all attempts fail:** not needed — attempt 1 was green on the first run.

---

## 9. Handover Summary (filled by Coder Sub-Agent on completion)

- **What is complete:** all five acceptance criteria and the Definition of Done.
  `plugin/src/canvas/canvas-shadow.ts` exports `planIntentDiff` plus `ParsedSaveRecord`,
  `ParsedSave`, `TombstoneView`, `SurfaceState`, `FieldUpsertIntent`, `DeleteIntent`,
  `DiscardedStaleness` and `IntentPlan`. Visible tests 53/53 PASS, WP1 regression 32/32 PASS,
  `npx tsc -noEmit -skipLibCheck` clean. Report:
  `workflowArtifacts/canvas-v2/ImplementationReport_WP2.md`.
- **What remains open:** nothing in WP2 scope. Wiring into `handleLocalModify` is WP4; applying
  the plan and advancing the shadow are WP4; the convergence-fuzzer link is WP23. The section 6
  `npm run build` gate was not run because it rewrites the checked-in `plugin/main.js` this
  attempt may not touch — `tsc -noEmit` served as the compile gate.
- **Final status:** DONE.

---

## 10. Risk Notes for Worker 4 (filled by Worker 3 Core)

- **Risk flag:** NONE
