# Task Charter — WP17: Canonical serializer V2

**Charter Status:** `DONE`
**WP:** WP17
**Phase:** P1
**task_mode:** `standard`
**Depends on:** WP3, WP9, WP10, WP13
**W4 Test Targets:** `0`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** the file is a deterministic projection of the doc on every client.
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 5, component **C17 — Canonical serializer V2** (work package WP17); phase **P1**.

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: modify (`buildCanvasData` `:98–130`, `serializeCanvas` `:132–137`; re-exported at `canvas-persistence.ts:388`, called at `:229`)
  - Responsibility: expand V2 registers back into the exact Obsidian file schema, sorted by `(ord, id)`, with `ord` itself never written.
  - Scope summary: `(ord,id)` sort, register expansion, `ord` not written
- **Out of scope / non-goals:**
  - Changing what Obsidian expects in the file — the output schema is fixed by Obsidian, not by us.
  - Writing `ord` into the file.
  - The tombstone *decision*; this WP consumes the suppression predicate from WP12.
- **Known interfaces / dependencies:**
  - Input: the doc's V2 record state plus the tombstone view
  - Output: the canonical `.canvas` file content
  - Depends on work packages: WP3, WP9, WP10, WP13
  - **Convergence-fuzzer link (required by the BUILD_SPEC):** WP23 byte-equality assertion (this is its primary target).

---

## 3. Architecture Context

*Task-local architecture guidance only.*

- **Component(s) being changed:** Canonical serializer V2
- **Interfaces involved:**
  - Input: the doc's V2 record state plus the tombstone view
  - Output: the canonical `.canvas` file content
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
  - `plugin/src/files/canvas-sync.ts:98–130` — `buildCanvasData` (dangling-edge prune `:120–126`)
  - `plugin/src/files/canvas-sync.ts:132–137` — `serializeCanvas`
  - `plugin/src/files/canvas-persistence.ts:388` (re-export) and `:229` (the only call site)
- **Structure references:** *(intentionally empty — no Graphify graph exists for this project; FALLBACK mode is declared in the BUILD_SPEC section 3. Worker 3 fills this in after implementation. Do not invent paths here.)*

If structure references conflict with the BUILD_SPEC or explicit task scope, the BUILD_SPEC and TaskCharter win. Escalate instead of following the map.

---

## 4. Acceptance Criteria

*Exact copy from BUILD_SPEC section 5, component C17. No paraphrasing.*

1. Records are emitted sorted by `(ord, id)`; `pos`/`size`/`from`/`to` are expanded into `x`/`y`/`width`/`height` and the endpoint keys exactly as Obsidian expects; `ord` does not appear in the file.
2. Records suppressed by the tombstone predicate (deleted or quarantined) are not emitted, and an edge whose endpoint record is suppressed is not emitted either.
3. Two replicas with the same doc state produce byte-identical files, including after a reorder.
4. Round-trip stability: parse(serialize(state)) yields the same records and the same relative order.
5. **Optional keys are omitted, and the flat-vs-register collision has an explicit rule.**
   - An endpoint register with no `side` emits its `fromNode`/`toNode` and **omits** the `fromSide`/`toSide` key entirely — never `null`, never `""`. Same for `fromEnd`/`toEnd`. A `.canvas` file containing side-less edges must survive parse → doc → serialize **byte-identically**, so such a file does not churn on its first write.
   - No serialisation path may emit `null` or `""` for an optional endpoint or geometry key, **including via the verbatim flat-key pass**. A junk value already sitting in the doc under a flat key is dropped, not carried to disk.
   - The flat-vs-register precedence is an explicit, phase-scoped rule, never an artefact of `Y.Map` insertion order.

**Definition of Done:** the file is a deterministic projection of the doc on every client, **decided by stated rules rather than by container ordering**.

---

<!-- Updated: E1 ruling + the real corruption bug Worker 3's WP18 coder found and fixed in passing 2026-08-02 -->

### Amendment (2026-08-02, Worker 2). WP17 is REOPENED. AC5 is new; AC1–AC4 are unchanged.

**Part 1 — key omission (from the E1 ruling).** Once WP10 AC5 lands, an endpoint register can legitimately carry no `side`. The serializer currently writes `fromNode` **and** `fromSide` unconditionally; only `fromEnd` has omission logic. It must omit `fromSide`/`toSide` when the register has none. Emitting `null` or `""` would rewrite every side-less file on its first write — churn that looks like a sync storm and destroys the round-trip stability AC4 promises. **Pin it with a byte-identity test**, not a shape test: a fixture `.canvas` containing side-less edges must come back byte-identical through parse → doc → serialize.

**Part 2 — a second path that can emit `null`, via the flat keys.** The canonical step drops only `undefined`; every other value, including `null` and `""`, passes through by identity. So a doc record holding a flat `fromSide: null` — from a hand-edited file seeded through the flat vocabulary, or a V1 record whose flat keys the additive migration kept — reaches disk as `"fromSide": null` and **overrides** a valid register's expansion. Closing Part 1 in the register codec alone does not close this. The same exposure applies to `x`/`y`/`width`/`height` and `fromNode`/`toNode`.

**Part 3 — the flat-vs-register precedence rule, and the regression test it needs.**

A P1 doc legitimately holds **both** spellings of the same fact: `migrateV1ToV2` is deliberately additive (WP8 AC2, WP18 TC9 — flat keys explicitly *not* removed), while the capture path and every peer on this build still author the **flat** keys. The decode resolved that collision by **`Y.Map` insertion order**, which is not a rule at all: whichever spelling happened to be written first silently decided the file, so **a moved card could snap back to its pre-move coordinate on disk.**

**This is the most dangerous defect class this project has found, because both replicas agree on the wrong value — cross-replica byte equality provably cannot detect it.** It is the same class WP17 already met from the other direction. Worker 3's coder found and fixed it while implementing WP18; four previously-green tests caught it. The fix is retained and is now **owned here** rather than incidental.

**The rule: in P1 the flat key wins.** It is the vocabulary every live writer authors in; a register is only ever a translation of it. A record carrying only the register (anything the V2 cold-open seed wrote) is unaffected — there is no flat key to override it. **When the write boundaries move to the registers (WP22 / WP39) the flat keys stop being written and the precedence becomes moot rather than inverted.** That transition must be made deliberately in the WP that causes it and must never be assumed to have already happened.

**WP17 owns a named regression test for this.** It must assert that a record holding a **stale register** and a **fresh flat key** serialises the flat value, **and that the outcome is unchanged when the two keys are inserted into the `Y.Map` in the opposite order.** Insertion-order independence is the actual property; asserting only the value would let the bug straight back in. Freeze it under a name that says what it protects.

**Ownership note:** if the decode function is relocated out of the serializer's module, AC5 and this test move with it and WP16's charter carries them instead. The owner is the module, not the file.

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
- **Required report:** `ImplementationReport_WP17.md` (in `workflowArtifacts/canvas-v2/`)
- **BUILD_SPEC updates required:** no — unless implementation invalidates an architecture decision, in which case ESCALATE rather than editing the spec.
- **Gate status required at handover:** `npm run build` PASS and `npm test` with 0 failures, run from `plugin/`. All visible tests PASS.

---

## 7. Visible Test Cases / Producer Artifacts

12 test points cover the 4 ACs. All are exercised at the `buildCanvasData` /
`serializeCanvas` / `parseCanvas` function boundary against real `Y.Doc`/`Y.Map`
fixtures — no Obsidian runtime, no `CanvasPersistence` wiring required. Each
visible test below also has a `_blind1` and `_blind2` counterpart (same claim,
different data/edge cases) in `workflowArtifacts/canvas-v2/tests/blind_set{1,2}/WP17/`.

**Required signature change these tests pin:** `buildCanvasData(nodesMap, edgesMap,
deletedMap?: TombstoneMap)` and `serializeCanvas(nodesMap, edgesMap, deletedMap?:
TombstoneMap)` — a new, OPTIONAL third parameter (`TombstoneMap` from
`canvas-tombstone.ts`), so the two existing 2-argument call sites
(`canvas-persistence.ts:230`, and the other in-file call sites) keep compiling and
keep their current no-suppression behaviour unchanged.

### TC1 — records sort by ord ascending, not by id
- Verifies AC: AC1 (part 1 — sort key)
- Test file: `plugin/src/__tests__/v2/wp17/test_tp01_ord_primary_sort_visible.test.ts`
- What it checks: three nodes whose id-alphabetical order is the exact reverse of
  their intended `ord` order serialise in `ord` order. Falsifies an implementation
  that still routes the final array through WP3's `canonicalizeCanvasData` (which
  re-sorts by id and discards any ord-based pre-sort).
- Test data channel: an in-memory `Y.Doc`/`Y.Map` fixture built directly in the test.

### TC2 — equal ord falls back to id ascending
- Verifies AC: AC1 (part 1 — tiebreak)
- Test file: `plugin/src/__tests__/v2/wp17/test_tp02_equal_ord_id_tiebreak_visible.test.ts`
- What it checks: two records sharing the same `ord` sort by id; a third record with
  a distinct, lower `ord` still sorts first overall — pins the `(ord, id)` total
  order, not `ord` alone.
- Test data channel: in-memory `Y.Doc` fixture.

### TC3 — records with no ord field sort deterministically by id (backward compatibility)
- Verifies AC: AC1 (part 1 — degenerate case) plus the "do not break existing tests"
  constraint (Shared Ownership Contract §4)
- Test file: `plugin/src/__tests__/v2/wp17/test_tp03_missing_ord_id_only_fallback_visible.test.ts`
- What it checks: three un-migrated records (no `ord` key at all) sort id-ascending —
  the exact fixture shape the frozen `v2/wp3/test_two_client_bytes_visible.test.ts`
  ("buildCanvasData returns canonical, id-sorted records") depends on. Already passes
  against the current implementation; kept as an explicit regression guard on WP17's
  own AC1 wording rather than relying on the P0 suite alone.
- Test data channel: in-memory `Y.Doc` fixture.

### TC4 — node pos/size registers expand into flat file geometry keys
- Verifies AC: AC1 (part 2 — geometry expansion)
- Test file: `plugin/src/__tests__/v2/wp17/test_tp04_node_geometry_register_expansion_visible.test.ts`
- What it checks: a node record built from the atomic `pos`/`size` registers (WP9)
  serialises `x`/`y`/`width`/`height` and drops `pos`/`size` from the output.
- Test data channel: in-memory `Y.Doc` fixture using `encodePos`/`encodeSize`.

### TC5 — edge from/to registers expand into flat file endpoint keys
- Verifies AC: AC1 (part 2 — endpoint expansion)
- Test file: `plugin/src/__tests__/v2/wp17/test_tp05_edge_endpoint_register_expansion_visible.test.ts`
- What it checks: an edge record built from the atomic `from`/`to` registers (WP10)
  serialises `fromNode`/`fromSide`/`fromEnd`/`toNode`/`toSide` (no `toEnd`, since that
  register carries none) and drops `from`/`to`.
- Test data channel: in-memory `Y.Doc` fixture using `encodeEndpoint`.

### TC6 — ord is never written to the file
- Verifies AC: AC1 (part 3 — ord absence)
- Test file: `plugin/src/__tests__/v2/wp17/test_tp06_ord_absent_from_file_visible.test.ts`
- What it checks: a node and an edge both carrying `ord` produce output with no `ord`
  key anywhere, asserted both on the returned record objects and via a regex over the
  raw serialized text (`/"ord"\s*:/`) — explicit absence, not a coincidental deep-equal.
- Test data channel: in-memory `Y.Doc` fixture.

### TC7 — a tombstoned record is not emitted
- Verifies AC: AC2 (part 1 — suppression)
- Test file: `plugin/src/__tests__/v2/wp17/test_tp07_tombstoned_record_suppressed_visible.test.ts`
- What it checks: a node with an active tombstone entry (via WP12's real
  `applyTombstoneOp`) is dropped from the output; unsuppressed siblings survive.
  Requires the new `deletedMap` parameter on `buildCanvasData`.
- Test data channel: in-memory `Y.Doc` fixture + a plain `TombstoneMap` stub object
  (the same structural pattern `v2/wp15` tests use).

### TC8 — an edge whose endpoint is suppressed is dropped even without its own tombstone
- Verifies AC: AC2 (part 2 — cascade)
- Test file: `plugin/src/__tests__/v2/wp17/test_tp08_suppressed_endpoint_cascades_edge_visible.test.ts`
- What it checks: edge e1 (n1 -> n2) vanishes when n1 is tombstoned, even though n1's
  key still exists in `nodesMap` (not the old GAP-5 "missing id" dangling case) and e1
  itself carries no tombstone entry. A control edge between two unsuppressed nodes
  proves the drop is scoped correctly.
- Test data channel: in-memory `Y.Doc` fixture + `TombstoneMap` stub.

### TC9 — a quarantined record is suppressed exactly like a deleted one
- Verifies AC: AC2 ("deleted or quarantined")
- Test file: `plugin/src/__tests__/v2/wp17/test_tp09_quarantine_suppressed_like_delete_visible.test.ts`
- What it checks: `on:true, q:true` drops the record from the output via the same
  `isTombstoneSuppressed` predicate as a plain delete — proving WP17 does not
  reimplement a second, q-aware suppression rule.
- Test data channel: in-memory `Y.Doc` fixture + `TombstoneMap` stub.

### TC10 — byte-identical output across replicas, ordered by ord
- Verifies AC: AC3 (part 1 — cross-replica byte equality)
- Test file: `plugin/src/__tests__/v2/wp17/test_tp10_replica_byte_identity_ord_order_visible.test.ts`
- What it checks: two `Y.Doc`s with the same logical records but different Y.Map
  integration order and different per-record key insertion order serialise to the
  same bytes, AND those bytes are in `ord` order (ids picked so `ord` order is the
  reverse of `id` order) — so agreement cannot be explained by an id-only sort.
- Test data channel: two independently-built in-memory `Y.Doc` fixtures.

### TC11 — byte identity across replicas survives a reorder
- Verifies AC: AC3 (part 2 — "including after a reorder")
- Test file: `plugin/src/__tests__/v2/wp17/test_tp11_byte_identity_after_reorder_visible.test.ts`
- What it checks: two replicas agree before a reorder, agree after the identical
  reorder is applied independently to both, and the post-reorder bytes both differ
  from the pre-reorder bytes and reflect the new sequence.
- Test data channel: two independently-built in-memory `Y.Doc` fixtures per phase.

### TC12 — round-trip stability: parse(serialize(state)) preserves records and relative order
- Verifies AC: AC4
- Test file: `plugin/src/__tests__/v2/wp17/test_tp12_round_trip_order_and_content_stability_visible.test.ts`
- What it checks: `parseCanvas(serializeCanvas(...))` reproduces the same ids and the
  same relative order as `buildCanvasData` produced, using WP16's `data.order.nodes`
  observation as the oracle rather than object key iteration; ids are picked so `ord`
  order diverges from `id` order, so the round trip genuinely exercises order
  preservation.
- Test data channel: in-memory `Y.Doc` fixture.

---

## 7b. W4 Test Targets (filled by Worker 3's Unit Test Sub-Agent, if any)

*Empty at handover — no INTEGRATION_SCOPE ACs. All four ACs are fully observable at
the `buildCanvasData` / `serializeCanvas` / `parseCanvas` pure-doc-to-string function
boundary (see §7) against real `Y.Doc`/`Y.Map` fixtures; no Obsidian runtime, no
`CanvasPersistence` disk I/O and no vault are needed to falsify any of AC1-AC4.
W4 Test Targets: `0`.*

---

## 8. Autonomous Execution Plan (filled by Coder Sub-Agent, attempt 1)

- **Observed current behavior:** `buildCanvasData` (now `canvas-sync.ts:516–559`, not `:98–130`
  — WP16 grew the file) copied every `Y.Map` key verbatim into a plain object, applied the
  GAP-5 dangling-edge prune, and returned `canonicalizeCanvasData({nodes, edges})`. That gave
  P0's id-only array order, no register expansion (a `pos`-only node serialised a literal
  `"pos": [x,y]` array and no `x`/`y`), an `ord` key leaking into the canonical record's
  unknown-key tail, and no tombstone parameter at all. `serializeCanvas` was
  `serializeCanonicalCanvas(buildCanvasData(...))`.
- **Approach:** one pass per id space that (a) skips ids WP12's `isTombstoneSuppressed`
  suppresses, (b) strips `ord` (captured as the sort key first) and expands every register
  through the existing `decodeV2RecordToFlat` — i.e. WP9's `decodePos`/`decodeSize` and WP10's
  `decodeEndpointToFile` — then (c) applies `canonicalizeRecord(record, kind)` for key order
  only, and finally sorts the array with WP13's `compareOrdId`. The AC2 edge cascade and the
  GAP-5 prune are folded into ONE `visibleNodeIds` set so they cannot disagree.
  `serializeCanvas` becomes a plain `JSON.stringify(..., null, "\t")` of that snapshot.
- **Fallback path if all attempts fail:** n/a — all 12 visible tests and all load-bearing
  suites pass on attempt 1.

---

## 9. Handover Summary (filled by Coder Sub-Agent on completion)

- **What is complete:** AC1–AC4 in full. 12/12 visible WP17 tests pass; the whole `v2/` tree
  plus `canvas-sync`, `canvas-persistence`, `canvas-single-writer` and `w4-canvas-integrity`
  are green (115 files / 478 tests). `npx tsc -noEmit -skipLibCheck` is clean. No existing
  test was deleted, skipped, weakened or edited. One file changed:
  `plugin/src/files/canvas-sync.ts`.
- **What remains open:** nothing in WP17's scope. The `deletedMap` parameter is wired but no
  production call site passes it yet — `CanvasPersistence` reaching the `deleted` container is
  WP18's write-boundary wiring, deliberately not done here (Shared Ownership Contract §3).
- **Final status:** `DONE`

---

## 10. Risk Notes for Worker 4 (filled by Worker 3 Core)

- **Risk flag:** NONE
