# Task Charter — WP16: `parseCanvas` V2 + `ord` capture

**Charter Status:** `DONE`
**WP:** WP16
**Phase:** P1
**task_mode:** `standard`
**Depends on:** WP9, WP10, WP13
**W4 Test Targets:** `0`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** order round-trips through the file without churn on unchanged documents.
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 5, component **C16 — `parseCanvas` V2 and the conservative `ord` capture policy** (work package WP16); phase **P1**.

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: modify (`plugin/src/files/canvas-sync.ts:74–94`) + extend
  - Responsibility: read a `.canvas` file into the V2 record shape and derive order changes conservatively.
  - Scope summary: V2 parse; conservative minimal reordering
- **Out of scope / non-goals:**
  - Serialisation — that is WP17.
  - Allocating `ord` values (the allocator is WP13; this WP decides when to call it).
  - Changing the silent-failure behaviour on malformed JSON (it must be preserved).
- **Known interfaces / dependencies:**
  - Input: `.canvas` file content
  - Output: V2-shaped records plus an order observation
  - Depends on work packages: WP9, WP10, WP13
  - **Convergence-fuzzer link (required by the BUILD_SPEC):** WP23 `reorder` op.

---

## 3. Architecture Context

*Task-local architecture guidance only.*

- **Component(s) being changed:** `parseCanvas` V2 and the conservative `ord` capture policy
- **Interfaces involved:**
  - Input: `.canvas` file content
  - Output: V2-shaped records plus an order observation
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
  - `plugin/src/files/canvas-sync.ts:74–94` — `parseCanvas` (JSON error path `:91–93`)
  - `plugin/src/files/canvas-sync.ts:69–73` — `CanvasData`
  - CONCEPT_V2 Teil 10 — the conservative reordering rule and its R2-class caveat
- **Structure references:** *(intentionally empty — no Graphify graph exists for this project; FALLBACK mode is declared in the BUILD_SPEC section 3. Worker 3 fills this in after implementation. Do not invent paths here.)*

If structure references conflict with the BUILD_SPEC or explicit task scope, the BUILD_SPEC and TaskCharter win. Escalate instead of following the map.

---

## 4. Acceptance Criteria

*Exact copy from BUILD_SPEC section 5, component C16. No paraphrasing.*

1. Parsing produces V2 records (`pos`, `size`, `from`, `to`) and preserves array order as an explicit observation instead of discarding it.
2. `ord` is reassigned **only** when the relative order of existing ids in the save has demonstrably changed; appending new records allocates new `ord` values at the end and touches no existing record's `ord`.
3. When a reorder is detected, the number of reassigned `ord` values is minimal for the observed change.
4. The existing failure behaviour is preserved: a JSON error yields empty records rather than throwing, and entries without an `id` are dropped.

**Definition of Done:** order round-trips through the file without churn on unchanged documents.

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
- **Required report:** `ImplementationReport_WP16.md` (in `workflowArtifacts/canvas-v2/`)
- **BUILD_SPEC updates required:** no — unless implementation invalidates an architecture decision, in which case ESCALATE rather than editing the spec.
- **Gate status required at handover:** `npm run build` PASS and `npm test` with 0 failures, run from `plugin/`. All visible tests PASS.

---

## 7. Visible Test Cases

Contract pinned by these tests (none of it existed before this WP):

- `parseCanvas(content: string): CanvasData` — same signature, new return shape:
  `CanvasData.nodes: Record<string, V2Node>`, `.edges: Record<string, V2EdgeRecord>`
  (both from `canvas-registers.ts`, WP9/WP10), plus a new field
  `order: RecordOrderObservation` (`{ nodes: readonly string[]; edges: readonly string[] }`) —
  the ids in exact file-array order, independent of `Record` key iteration.
- New export `deriveOrdAssignments(previous: readonly OrdIdEntry[], nextOrder: readonly string[], clientID: string, rng?: OrdRng): Map<string, string>`
  — the conservative `ord` capture policy. Returns an id→ord map containing **only**
  ids whose `ord` is new or reassigned; an id absent from the map keeps its existing
  `ord` unchanged. Must determine the "has order changed" question via `(ord, id)`
  canonical order (`compareOrd` / `compareOrdId`, imported from `canvas-ord.ts`,
  never re-derived), not via the caller's raw array position.

### TC1 — parseCanvas emits V2-shaped node/edge records
- Verifies AC: AC1 (part 1 — V2 record shape)
- Test file: `plugin/src/__tests__/v2/wp16/test_tp1_v2_record_shape_visible.test.ts`
- What it checks: a node's flat `x/y/width/height` become one `pos` register and one
  `size` register (values matching WP9's own `encodePos`/`encodeSize`), an edge's flat
  `fromNode/fromSide/toNode/toSide` become one `from` and one `to` register (matching
  WP10's `encodeEndpointFromFile`), and the flat keys are gone from the returned record.
- Test data channel: inline `JSON.stringify` `.canvas`-shaped fixtures.

### TC2 — parseCanvas exposes an explicit order observation
- Verifies AC: AC1 (part 2 — order preserved as an explicit observation)
- Test file: `plugin/src/__tests__/v2/wp16/test_tp2_order_observation_explicit_visible.test.ts`
- What it checks: `data.order.nodes` / `data.order.edges` equal the exact file-array
  order; ids are chosen so their alphabetical order is the reverse of file order, so an
  `Object.keys(...).sort()`-style fallback fails the assertion instead of passing by luck.
- Test data channel: inline `JSON.stringify` fixtures with adversarial id naming.

### TC3 — reparsing an unchanged document reassigns zero existing ord values
- Verifies AC: AC2 (negative case)
- Test file: `plugin/src/__tests__/v2/wp16/test_tp3_unchanged_document_zero_churn_visible.test.ts`
- What it checks: parse → derive baseline ords → reparse byte-identical content →
  rederive; the reassignment map must be empty. This is the DoD statement itself
  ("order round-trips through the file without churn on unchanged documents").
- Test data channel: inline fixtures; a seeded deterministic RNG for `allocateOrd`.

### TC4 — appending a new record allocates only its own ord
- Verifies AC: AC2 (positive case)
- Test file: `plugin/src/__tests__/v2/wp16/test_tp4_append_only_no_existing_touch_visible.test.ts`
- What it checks: parsing `[a,b]` then `[a,b,c]` reassigns exactly `{c}`; `a`/`b` are
  absent from the reassignment map, and `c`'s new ord sorts (`compareOrd`) after `b`'s.
- Test data channel: inline fixtures; seeded RNG.

### TC5 — moving one record from end to front reassigns only that record
- Verifies AC: AC3 (the discriminating minimal-reassignment test)
- Test file: `plugin/src/__tests__/v2/wp16/test_tp5_minimal_reassignment_on_reorder_visible.test.ts`
- What it checks: parsing `[a,b,c,d,e]` then `[e,a,b,c,d]` reassigns exactly `{e}`
  (never all five); the resulting `(ord,id)`-sorted sequence matches the new file order.
  Without this test, a reassign-everything implementation passes TC3/TC4 trivially.
- Test data channel: inline fixtures; seeded RNG.

### TC6 — a JSON parse error yields empty records, never a throw
- Verifies AC: AC4 (part 1)
- Test file: `plugin/src/__tests__/v2/wp16/test_tp6_malformed_json_empty_records_visible.test.ts`
- What it checks: syntactically invalid JSON does not throw and yields
  `{nodes:{}, edges:{}, order:{nodes:[],edges:[]}}` — the pre-existing failure
  behaviour, now extended to the new `order` field.
- Test data channel: literal malformed JSON strings.

### TC7 — entries without an id are dropped, from both records and order
- Verifies AC: AC4 (part 2)
- Test file: `plugin/src/__tests__/v2/wp16/test_tp7_missing_id_dropped_visible.test.ts`
- What it checks: a node/edge entry lacking `id` is dropped from `data.nodes`/`data.edges`
  AND from `order.nodes`/`order.edges` — no phantom id, no gap artefact.
- Test data channel: inline fixtures mixing id-bearing and id-less entries.

### TC8 — ord comparison must use canvas-ord.ts's shared comparator, never re-derive it
- Verifies AC: cross-cutting correctness for AC2/AC3 (Shared Ownership Contract §1 —
  the shared-constant hazard: WP13 owns `ord` ordering)
- Test file: `plugin/src/__tests__/v2/wp16/test_tp8_ord_total_order_uses_shared_comparator_visible.test.ts`
- What it checks: (a) static — `canvas-sync.ts` imports `compareOrd`/`compareOrdId` from
  `../canvas/canvas-ord`; (b) behavioural — two entries sharing an identical `ord`,
  handed to `deriveOrdAssignments` with `previous` in the array order that is the
  OPPOSITE of the `(ord,id)` canonical order and `nextOrder` equal to that canonical
  order, must be recognised as unchanged (zero reassignments). An implementation that
  trusts `previous`'s array position instead of recomputing the canonical order via
  `compareOrdId` fails this test.
- Test data channel: inline fixtures with a deliberately colliding `ord` string.

---

## 7b. W4 Test Targets (filled by Worker 3's Unit Test Sub-Agent, if any)

*Empty at handover — no INTEGRATION_SCOPE ACs. All four ACs are fully observable at the
`parseCanvas` / `deriveOrdAssignments` pure-function boundary (see §7); WP16 does not
itself wire either into the `CanvasSync` write path (Y.Map / doc mutation). Note for
Worker 2 / Worker 4: `parseCanvas`'s return shape changes from flat file-keyed records
to V2 registers, and every existing internal caller in `canvas-sync.ts` (the host-seed
path and the local-modify capture path) currently consumes the flat shape directly —
see the Unit Test Sub-Agent's Impact Assessment for the full blast-radius prediction
and the required bridging (decode V2 back to flat via `canvas-registers.ts`'s
`decodePos`/`decodeSize`/`decodeEndpointToFile`) before those call sites, so the
`CanvasSync` test suites keep passing unmodified.*

---

## 7b. W4 Test Targets (filled by Worker 3's Unit Test Sub-Agent, if any)

*Empty at handover.*

---

## 8. Autonomous Execution Plan (filled by Coder Sub-Agent, attempt 1)

- **Observed current behavior:** `parseCanvas` returned the raw file records keyed by id
  (`Record<string, Record<string, unknown>>`), discarding array order entirely. Four internal
  consumers fed that flat shape straight into `Y.Map` writes: the host seed
  (`applyCanvasToYMaps` → `applyToYMap`), the local capture (`toParsedSave` →
  `toParsedRecords` → `planIntentDiff`), `advanceShadowFromContent`, and — outside this file
  — `CanvasPersistence.coldOpen()` (`seedDocFromCanvasData` → `applyToYMap`).
- **Approach:** `parseCanvas` translates to WP9/WP10 registers (`toV2Node`/`toV2Edge`,
  substituting each register into the flat key's own slot) and records the file-array order
  as `order: RecordOrderObservation`. A **temporary P1 decode bridge**
  (`decodeCanvasDataToFlat`, built only from `decodePos`/`decodeSize`/`decodeEndpointToFile`)
  sits immediately after all four internal call sites so the write paths keep seeing the
  flat shape until WP18 wires them. `deriveOrdAssignments` recomputes the current order via
  WP13's `compareOrdId`, keeps the longest strictly-increasing subsequence, and allocates a
  new `ord` (WP13's `allocateOrd`, injected `rng` threaded through) only for new or genuinely
  moved records — `n − |LIS|` being the provable minimum for AC3.
- **Fallback path if all attempts fail:** n/a — the implementation succeeded. The blocker is
  a spec collision, not an implementation failure: see §9.

---

## 9. Handover Summary (filled by Coder Sub-Agent on completion)

- **What is complete:** AC1, AC2, AC3, AC4 — all implemented. All 13 visible WP16 tests pass
  (8 files). The four load-bearing suites pass **unmodified**: `canvas-sync.test.ts`,
  `canvas-persistence.test.ts`, `canvas-single-writer.test.ts`, `w4-canvas-integrity.test.ts`
  — 123/123. Changed files: `plugin/src/files/canvas-sync.ts` (the WP's declared file) and
  `plugin/src/files/canvas-persistence.ts` (bridge only, no logic change). No existing test
  was edited, deleted, skipped, weakened or relaxed. No new dependency, no version bump, no
  reformatting, zero new Biome findings.
- **What remains open:** **SPEC_CONTRADICTION.**
  `plugin/src/__tests__/v2/wp3/test_file_shape_tabs_visible.test.ts:96` (suite
  `WP3 AC4 — the .canvas file shape is unchanged`, test
  `round-trips through the unchanged parseCanvas reader`) asserts
  `data.edges.e1.toSide === "left"`, while WP16 AC1 / TC1
  (`v2/wp16/test_tp1_v2_record_shape_visible.test.ts:73`) requires `"toSide" in edge` to be
  `false`. Both target `parseCanvas`'s return value for the same input class — absent and
  `"left"` cannot both hold. It is also the only `tsc` error in the tree (TS2339, same line).
  Left red on purpose; WP16 is not a licensed test-adjuster (WP4/WP21/WP22/WP33 only).
  Recommended one-line resolution, which removes and relaxes nothing:
  `expect(decodeEndpointToFile("to", data.edges.e1.to).toSide).toBe("left");`
  Applying it takes the tree to 466/466 with a clean typecheck.
- **Final status:** `RISKY` — feature-complete, escalated on one contradictory pre-existing
  assertion. Full detail in `ImplementationReport_WP16.md`.

---

## 10. Risk Notes for Worker 4 (filled by Worker 3 Core)

- **Risk flag:** ESCALATE — one pre-existing test (`v2/wp3/test_file_shape_tabs_visible.test.ts`,
  `round-trips through the unchanged parseCanvas reader`) is logically incompatible with AC1
  and is left failing pending Worker 3's adjudication. Everything else is green.
