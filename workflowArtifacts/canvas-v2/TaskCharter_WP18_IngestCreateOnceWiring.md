# Task Charter — WP18: Ingest + create-once wiring

**Charter Status:** `SPEC_COMPLETE`
**WP:** WP18
**Phase:** P1
**task_mode:** `standard`
**Depends on:** WP14, WP16, WP17
**W4 Test Targets:** `0`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** the doc cannot be brought into an invalid state by any local source.
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 5, component **C18 — Ingest validation and create-once transactions at every write boundary** (work package WP18); phase **P1**.

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: modify (seed path `canvas-sync.ts:388–401`, `seedDocFromCanvasData` `canvas-persistence.ts:363–387`, the capture writer `applyLocalDiffToYMaps` `:620–704`, and the import path from WP30)
  - Responsibility: wire the validator in at every doc write boundary and make record creation a single validated transaction.
  - Scope summary: validation at every write boundary; single-transaction creation
- **Out of scope / non-goals:**
  - The validator's rules themselves — WP14.
  - The `CAPTURE_OP` boundary — that is P5 (WP39); wire the seam so it can be added without redesign.
  - Quarantining records already in the doc — WP20.
- **Known interfaces / dependencies:**
  - Input: proposed records from seed, `CAPTURE_NET`, and import (and, from P5, `CAPTURE_OP`)
  - Output: validated writes, or rejection with a signature
  - Depends on work packages: WP14, WP16, WP17
  - **Convergence-fuzzer link (required by the BUILD_SPEC):** WP23 schema-invariant assertion.

---

## 3. Architecture Context

*Task-local architecture guidance only.*

- **Component(s) being changed:** Ingest validation and create-once transactions at every write boundary
- **Interfaces involved:**
  - Input: proposed records from seed, `CAPTURE_NET`, and import (and, from P5, `CAPTURE_OP`)
  - Output: validated writes, or rejection with a signature
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
  - `plugin/src/files/canvas-sync.ts:388–401` — the host seed transaction
  - `plugin/src/files/canvas-persistence.ts:363–387` — `seedDocFromCanvasData`
  - `plugin/src/files/canvas-sync.ts:620–704` — `applyLocalDiffToYMaps`, the `CAPTURE_NET` writer
  - `plugin/src/files/canvas-sync.ts:171–195` / `:210–234` — `applyToYMap` / `applyKeyDiff` (the delete guards)
- **Structure references:** *(intentionally empty — no Graphify graph exists for this project; FALLBACK mode is declared in the BUILD_SPEC section 3. Worker 3 fills this in after implementation. Do not invent paths here.)*

If structure references conflict with the BUILD_SPEC or explicit task scope, the BUILD_SPEC and TaskCharter win. Escalate instead of following the map.

---

## 4. Acceptance Criteria

*Exact copy from BUILD_SPEC section 5, component C18. No paraphrasing.*

1. Every local write boundary consults the validator before writing; an invalid local record never reaches the doc and produces a rejection signature naming the boundary and the reason.
2. Record creation happens in one transaction carrying a complete record; no code path calls `set(id, new Y.Map())` for an id that already exists.
3. Partial observation produces upserts only — no local write path deletes a doc key that is merely absent from the incoming record (I7).
4. Remote deltas are never rejected at ingest; they are left to the quarantine auditor.

**Definition of Done:** the doc cannot be brought into an invalid state by any local source.

<!-- Updated: I7 attribution clarified after the WP4 escalation — no AC changed 2026-07-31 -->

**Amendment note (2026-07-31) — scope clarification, no acceptance criterion changed.** AC3's I7 rule is unchanged and still owned here, but its remaining surface is now smaller than the entry points below suggest. WP4 (P0) already removed deletion-by-key-omission from the **Obsidian-save capture path**: `applyLocalDiffToYMaps` / `applyKeyDiff` no longer exist as a diff path, and `handleLocalModify` derives every write from the C2 intent plan, which has no field-removal category. What AC3 still has to close is therefore the **seed boundaries** — `applyToYMap`, reached from the `CanvasSync.subscribe` host seed and from `CanvasPersistence.seedDocFromCanvasData` (cold open) — where absent keys are still deleted under the `PROTECTED_KEYS` guard. Retiring that guard is this WP's job, not WP4's; WP4 was explicitly forbidden to touch it. See BUILD_SPEC §3.1 S4 for the three-boundary split and §4.6 for the phased I7 traceability.

**Consequence for the test suite:** when this WP retires the `applyToYMap` delete guard, the replacement discrimination pair added by WP4 AC6 (which asserts that disarming `PROTECTED_KEYS` on the seed path loses an endpoint) becomes unsatisfiable in the same way `A9`/`A10` did. Retire it here, by name, under the same deletion-ledger rule (§7) — do not weaken it and do not leave it red.

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
  - `plugin/src/files/canvas-persistence.ts`
- **Required report:** `ImplementationReport_WP18.md` (in `workflowArtifacts/canvas-v2/`)
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

- **Observed current behavior:**
- **Approach:**
- **Fallback path if all attempts fail:**

---

## 9. Handover Summary (filled by Coder Sub-Agent on completion)

- **What is complete:**
- **What remains open:**
- **Final status:**

---

## 10. Risk Notes for Worker 4 (filled by Worker 3 Core)

- **Risk flag:** NONE
