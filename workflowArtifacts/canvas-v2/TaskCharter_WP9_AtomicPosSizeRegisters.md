# Task Charter — WP9: Atomic `pos`/`size` registers

**Charter Status:** `DONE`
**WP:** WP9
**Phase:** P1
**task_mode:** `standard`
**Depends on:** WP8
**W4 Test Targets:** `0`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** torn geometry writes are unrepresentable in the doc.
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 5, component **C9 — Atomic `pos` / `size` registers** (work package WP9); phase **P1**.

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: create (pure register module) + modify (record shape types)
  - Responsibility: make a position one value and a size one value, so concurrent moves cannot produce a coordinate no one set.
  - Scope summary: composite LWW geometry
- **Out of scope / non-goals:**
  - Changing `GEOMETRY_KEYS` membership or its export (hard constraint).
  - The serializer's expansion of these registers back into the file — that is WP17.
  - The shadow's register granularity — that is WP15.
- **Known interfaces / dependencies:**
  - Input: 
  - Output: 
  - Depends on work packages: WP8
  - **Convergence-fuzzer link (required by the BUILD_SPEC):** WP23 `move` / `resize` ops + the torn-write assertion.

---

## 3. Architecture Context

*Task-local architecture guidance only.*

- **Component(s) being changed:** Atomic `pos` / `size` registers
- **Interfaces involved:**
  - Input: 
  - Output: 
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
  - `plugin/src/files/canvas-sync.ts:29` — `GEOMETRY_KEYS` (file schema, unchanged)
  - `plugin/src/canvas/reconcile-plan.ts:56–63` — `RECONCILE_GEOMETRY_KEYS`, the drift-guarded mirror
  - `plugin/src/canvas/canvas-model-bridge.ts:94` — the third geometry-key copy
  - CONCEPT_V2 Teil 4, the field-by-field merge policy table
- **Structure references:** *(intentionally empty — no Graphify graph exists for this project; FALLBACK mode is declared in the BUILD_SPEC section 3. Worker 3 fills this in after implementation. Do not invent paths here.)*

If structure references conflict with the BUILD_SPEC or explicit task scope, the BUILD_SPEC and TaskCharter win. Escalate instead of following the map.

---

## 4. Acceptance Criteria

*Exact copy from BUILD_SPEC section 5, component C9. No paraphrasing.*

1. `pos` and `size` each round-trip losslessly to and from the `.canvas` file representation for integer geometry.
2. Two concurrent moves of the same node converge to exactly one of the two submitted positions on every replica — never a mixture of one author's `x` with another's `y`.
3. A concurrent move and resize of the same node both survive: the winner of `pos` and the winner of `size` are decided independently.
4. `GEOMETRY_KEYS` keeps exactly `{x, y, width, height}` and stays exported, now describing the file schema (see §3.1 S2).

**Definition of Done:** torn geometry writes are unrepresentable in the doc.

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
  - a new register module under `plugin/src/canvas/`
  - `plugin/src/files/canvas-sync.ts` (type shapes only)
- **Required report:** `ImplementationReport_WP9.md` (in `workflowArtifacts/canvas-v2/`)
- **BUILD_SPEC updates required:** no — unless implementation invalidates an architecture decision, in which case ESCALATE rather than editing the spec.
- **Gate status required at handover:** `npm run build` PASS and `npm test` with 0 failures, run from `plugin/`. All visible tests PASS.

---

## 7. Visible Test Cases / Producer Artifacts

### TC1 — lossless pos/size round trip for integer geometry
- Verifies AC: 1
- Test file: `plugin/src/__tests__/v2/wp9/test_tp01_lossless_roundtrip_visible.test.ts`
- What it checks: the pure encode/decode codec and a real Y.Map write/read cycle both reproduce the original integer `x`, `y`, `width`, `height` exactly for a table of representative cases (zero, positive, negative).
- Test data channel: fixture

### TC2 — two concurrent moves converge to one submitted position, never a mixture
- Verifies AC: 2
- Test file: `plugin/src/__tests__/v2/wp9/test_tp02_concurrent_move_convergence_visible.test.ts`
- What it checks: with three replicas and two concurrent `writePos` authors, after a full-mesh merge every replica agrees, the agreed value is exactly one author's whole submitted `{x, y}`, and neither torn combination (`{authorA.x, authorB.y}` / `{authorB.x, authorA.y}`) appears — no hardcoded winner is asserted.
- Test data channel: fixture

### TC3 — concurrent move and resize of the same node survive independently
- Verifies AC: 3
- Test file: `plugin/src/__tests__/v2/wp9/test_tp03_move_resize_independence_visible.test.ts`
- What it checks: with three replicas, a sole `pos` author and a sole `size` author writing concurrently both land on every replica after a full-mesh merge — `pos` and `size` are resolved as disjoint registers, so both concrete values are asserted directly (single-author registers, not a same-key race).
- Test data channel: fixture

### TC4 — GEOMETRY_KEYS stays exactly {x, y, width, height} and stays exported
- Verifies AC: 4
- Test file: `plugin/src/__tests__/v2/wp9/test_tp04_geometry_keys_pin_visible.test.ts`
- What it checks: `GEOMETRY_KEYS` (owned by `canvas-sync.ts`) is untouched by importing the new register module, the register module's own decode output uses exactly those four keys, and the register module does not export a competing `GEOMETRY_KEYS` of its own.
- Test data channel: fixture

---

## 7b. W4 Test Targets (filled by Worker 3's Unit Test Sub-Agent, if any)

*Empty — all four ACs are unit-testable against the pure register module and Yjs docs in memory; none require a running system or multiple integrated components.*

---

## 8. Autonomous Execution Plan (filled by Coder Sub-Agent, attempt 1)

- **Observed current behavior:** No register module existed. Geometry lived in the doc as four independent flat keys (`x`, `y`, `width`, `height`), so a same-key merge could pick different authors per coordinate — a position nobody submitted.
- **Approach:** Created `plugin/src/canvas/canvas-registers.ts` as a zero-import pure core in three parts — (A) the V2 record vocabulary (`V2_FIELD` key names, `V2Node`, generic `V2Edge<TEndpoint = unknown>` as the WP10 seam), (B) the pure file↔doc codec (`encodePos`/`decodePos`, `encodeSize`/`decodeSize`, whole-value guards and equality), and (C) doc accessors (`readPos`/`writePos`/`readSize`/`writeSize`) that reach the record through a structural `V2RecordMap` interface satisfied by `Y.Map<unknown>`, so the module needs no Yjs import. Atomicity comes from the alphabet, not from a merge rule: one key, one whole `[x, y]` value, and no per-coordinate write in the API at all. `pos` and `size` stay separate keys so move ⊥ resize commutes. Register values are frozen; reads are whole-or-nothing. `canvas-sync.ts` and `GEOMETRY_KEYS` untouched.
- **Fallback path if all attempts fail:** Not needed — all four ACs are green on attempt 1.

---

## 9. Handover Summary (filled by Coder Sub-Agent on completion)

- **What is complete:** All four ACs. `plugin/src/canvas/canvas-registers.ts` created; 4 visible test files / 8 tests PASS; full suite 85 files / 934 tests / 0 failed (baseline 81/926 + this WP's 4/8, nothing deleted or weakened); `npx tsc -noEmit -skipLibCheck` clean. Full detail and the exported API surface: `ImplementationReport_WP9.md`.
- **What remains open:** Nothing in scope. The module has no importer yet by design — wiring is WP16/WP17/WP18. Two decisions flagged for review rather than buried: `V2Edge` is generic over its endpoint type (`default unknown`) as the append seam for WP10, and `encodePos`/`encodeSize` round to whole pixels (idempotent, per BUILD_SPEC §4.4 + C9 "rounding integration"). `plugin/src/files/canvas-sync.ts` was listed in §6 as a required changed file "type shapes only" but was left untouched — the V2 record types belong to the module the Shared Ownership Contract assigns them to, and no AC needed an edit there.
- **Final status:** DONE

---

## 10. Risk Notes for Worker 4 (filled by Worker 3 Core)

- **Risk flag:** NONE
