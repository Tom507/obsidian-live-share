# Task Charter — WP6: Chaos suite I

**Charter Status:** `DONE`
**WP:** WP6
**Phase:** P0
**task_mode:** `standard`
**Depends on:** WP4, WP5
**W4 Test Targets:** `0`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** the reported symptoms exist as reproducible, self-discriminating tests.
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 5, component **C6 — Chaos suite I (P0 scenarios)** (work package WP6); phase **P0**.

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: create (test infrastructure and named scenario suites)
  - Responsibility: make the two P0-relevant symptom triggers reproducible, each with a discrimination variant.
  - Scope summary: cascade + degraded-mode scenarios with discrimination
- **Out of scope / non-goals:**
  - Production code changes — if a scenario cannot be built without one, ESCALATE rather than modify behaviour to fit the test.
  - The P2/P3 scenarios (host rejoin, fallback coexistence) — that is WP35.
  - Live Obsidian runs — that is WP7.
- **Known interfaces / dependencies:**
  - Input: injected seams (delayed apply, unavailable adapter) over the existing two-peer harness and canvas double
  - Output: named, deterministic suites
  - Depends on work packages: WP4, WP5

---

## 3. Architecture Context

*Task-local architecture guidance only.*

- **Component(s) being changed:** Chaos suite I (P0 scenarios)
- **Interfaces involved:**
  - Input: injected seams (delayed apply, unavailable adapter) over the existing two-peer harness and canvas double
  - Output: named, deterministic suites
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
  - `plugin/src/__tests__/harness/two-peer.ts` (545 L) and its self-test
  - `plugin/src/__tests__/harness/canvas-double.ts` (318 L)
  - `plugin/src/__tests__/harness/interaction-driver.ts` (145 L)
- **Structure references:** *(intentionally empty — no Graphify graph exists for this project; FALLBACK mode is declared in the BUILD_SPEC section 3. Worker 3 fills this in after implementation. Do not invent paths here.)*

If structure references conflict with the BUILD_SPEC or explicit task scope, the BUILD_SPEC and TaskCharter win. Escalate instead of following the map.

---

## 4. Acceptance Criteria

*Exact copy from BUILD_SPEC section 5, component C6. No paraphrasing.*

1. A scenario "view apply artificially delayed + Obsidian save" reproduces the cascade deterministically and passes under V2.
2. A scenario "adapter unavailable + open view + remote deltas" runs without the open view leaking stale values into the shared state.
3. Each scenario has a discrimination variant: with the V2 mechanism disabled through its injected seam, the scenario **fails**. The variant is part of the suite, not a manual procedure.
4. Both scenarios are deterministic — no wall-clock sleeps, no timing constants, seeds fixed.

**Definition of Done:** the reported symptoms exist as reproducible, self-discriminating tests.

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
  - new suites under `plugin/src/__tests__/`
- **Required report:** `ImplementationReport_WP6.md` (in `workflowArtifacts/canvas-v2/`)
- **BUILD_SPEC updates required:** no — unless implementation invalidates an architecture decision, in which case ESCALATE rather than editing the spec.
- **Gate status required at handover:** `npm run build` PASS and `npm test` with 0 failures, run from `plugin/`. All visible tests PASS.

---

## 7. Visible Test Cases / Producer Artifacts

*Filled by Worker 3's Unit Test Sub-Agent. Worker 2 leaves this section empty.*

---

## 7b. W4 Test Targets (filled by Worker 3's Unit Test Sub-Agent, if any)

*Empty at handover.*

---

## 8. Autonomous Execution Plan (filled by Coder Sub-Agent, attempt 1)

- **Observed current behavior:** WP1–WP5 are in place and green. The two P0 symptom
  triggers were reachable through the existing seams without any production change:
  `CanvasSync.setOnRemoteCanvasUpdate` (the live-view reconcile hook), `createCanvasAdapter`
  over `harness/canvas-double.ts`, and the two discrimination seams
  `setShadowRebaseEnabled(...)` / `advanceFromReceipt(..., { perFieldReceipt })`.
- **Approach:**
  - `plugin/src/__tests__/v2/wp6/chaos_cascade.test.ts` — the delay is STRUCTURAL: the
    production remote-update hook is wired to a pending queue and drained on either side of
    `handleLocalModify`, so "the view apply is late" is an ordering, never a timer.
  - `plugin/src/__tests__/v2/wp6/chaos_degraded_adapter.test.ts` — two degradation shapes
    (`isAvailable()` false, and available-but-`setData`-gone), an open view, remote deltas
    from two independent replicas, and a save from the never-updated view.
  - Three peers throughout; state (CRDT values, state vectors, the Surface-Shadow) is the
    only oracle; four automated discrimination variants, each also compared directly
    against its enabled run.
- **Fallback path if all attempts fail:** not needed — nothing was blocked.

---

## 9. Handover Summary (filled by Coder Sub-Agent on completion)

- **What is complete:** all four ACs. Two new suites under `plugin/src/__tests__/v2/wp6/`,
  15 tests, collected by the default `npm test`. `npx vitest run src/__tests__/v2/wp6`
  green; `npx vitest run "src/__tests__/v2/"` 209/209 green; `npx tsc -noEmit -skipLibCheck`
  clean; biome clean for the two new files. Zero production changes, zero new dependencies.
- **What remains open:** the full `npm test` shows 4 failures — the 3 known
  (`A4`/`A9`/`A10` in `w4-canvas-integrity.test.ts`, already escalated) plus one in the
  untracked, concurrently-owned `src/__tests__/v2blind/wp5v2/test_tp01_single_shadow_blind2.test.ts`
  which WP6 neither caused nor touched. Routing that one is Worker 3's call.
- **Final status:** DONE. Details in `ImplementationReport_WP6.md`.

---

## 10. Risk Notes for Worker 4 (filled by Worker 3 Core)

- **Risk flag:** NONE
