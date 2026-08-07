# Task Charter — WP40: Promote op-capture to primary

<!-- Updated: the verification AC1 demands is now chartered as WP54; promotion is wired to its ledger and is a real promotion, not flag-off shipping 2026-08-01 -->
**Charter Status:** `SPEC_COMPLETE`
**WP:** WP40
**Phase:** P5
**task_mode:** `standard`
**Depends on:** WP7, WP39, WP54
**W4 Test Targets:** `0`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** the R2 verification debt is discharged at its most expensive point before it is relied upon.
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 5, component **C40 — Promotion of op-capture to primary, gated on E2E verification** (work package WP40); phase **P5**.

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: modify (`plugin/src/types.ts:65` default, `main.ts:814`, `main.ts:1262`)
  - Responsibility: make op-capture the low-latency primary source — but only after the inferred trigger table is empirically confirmed.
  - Scope summary: trigger verification then `useCanvasBinding` default on
- **Out of scope / non-goals:**
  - Removing the `CAPTURE_NET` shadow diff — it stays as the safety net permanently.
  - Promotion without empirical verification — an unconfirmed trigger blocks this WP.
- **Known interfaces / dependencies:**
  - Input: a green E2E verification of every `CAPTURE_TRIGGERS` assumption
  - Output: `useCanvasBinding` default `true`, with the net as the fallback layer
  - Depends on work packages: WP7, WP39, WP54
  - <!-- Updated: T3 2026-08-01 --> The "green E2E verification" input is now a concrete artefact: `workflowArtifacts/canvas-v2/CaptureTriggerLedger.md`, produced by **WP54** on the real two-instance rig (BUILD_SPEC §5 PHASE T3). This WP consumes it and does not produce it.

---

## 3. Architecture Context

*Task-local architecture guidance only.*

- **Component(s) being changed:** Promotion of op-capture to primary, gated on E2E verification
- **Interfaces involved:**
  - Input: a green E2E verification of every `CAPTURE_TRIGGERS` assumption
  - Output: `useCanvasBinding` default `true`, with the net as the fallback layer
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
  - **Schema impact:** No schema change. Only the origin of captured writes changes (`CAPTURE_OP` in addition to `CAPTURE_NET`); both write the same V2 registers, so a mixed room is unaffected.
- **Entry points / relevant files (from `workflowArtifacts/RepoMap.md`, V2 Touchpoint Inventory):**
  - `plugin/src/types.ts:36` (declaration) and `:65` (default `false`) — `useCanvasBinding`
  - `plugin/src/main.ts:814` — the legacy reconcile bypass; `:1262` — binding construction gate
  - `tools/launch_liveshare_e2e.py` and `plugin/src/testing/e2e-control.ts` — the verification rig
  - `ARCHITECTURE.md` Part IX R2 — the exact list of unverified trigger assumptions
- **Structure references:** *(intentionally empty — no Graphify graph exists for this project; FALLBACK mode is declared in the BUILD_SPEC section 3. Worker 3 fills this in after implementation. Do not invent paths here.)*

If structure references conflict with the BUILD_SPEC or explicit task scope, the BUILD_SPEC and TaskCharter win. Escalate instead of following the map.

---

## 4. Acceptance Criteria

*Exact copy from BUILD_SPEC section 5, component C40. No paraphrasing.*

1. Every `CAPTURE_TRIGGERS` assumption is confirmed empirically against a live Obsidian canvas — single move, **each** resize handle, multi-select drag, paste, text-node content edit, node add/delete, edge add/delete — and each result is recorded individually; an unconfirmed trigger blocks promotion.
2. Only after that verification is `useCanvasBinding` defaulted to `true`; the `CAPTURE_NET` shadow diff remains active as the safety net and still catches anything the patched signals miss.
3. With the flag on, a full two-vault E2E run is green, including the stale-view scenario from WP7.
4. The abort criterion "`useCanvasBinding` default is no longer `false`" from the previous round is explicitly retired in this WP's report, with the verification evidence that justifies it.
5. The evidence for AC1 is the trigger verdict ledger produced by WP54 and nothing else: this WP does not re-derive, re-interpret or partially accept it. A ledger containing any `UNCONFIRMED` entry blocks promotion and this WP stops with that entry named; a ledger containing a `CORRECTED` entry may license promotion only once the corrected mapping is the one `CAPTURE_TRIGGERS` actually carries.

**Definition of Done:** the R2 verification debt is discharged at its most expensive point before it is relied upon.

### Promotion posture and where the evidence comes from (Worker 2, 2026-08-01)

AC1 has demanded an empirical verification since this charter was written, but nothing produced one — the rig that could have was mock-bound. That gap is now closed by chartered work:

- **WP52** taps the adapter's patched signals and makes them observable, ordered and path-scoped over the control protocol.
- **WP53** drives the real interactions — single move, **each** resize handle, multi-select drag, paste, text-node content edit, node add/delete, edge add/delete — at the input layer of a real Obsidian canvas. It drives the *interaction*, never the signal: synthesising `setDragging(false)` would prove the harness can call a function, not that Obsidian calls it (D18).
- **WP54** executes the verification and produces `workflowArtifacts/canvas-v2/CaptureTriggerLedger.md`, one verdict per interaction — CONFIRMED / CORRECTED / UNCONFIRMED. **That ledger is this WP's AC1 evidence** and the reason AC5 exists.

**Owner decision on posture:** the gate is expected to go green and this WP is the **real** promotion — `useCanvasBinding` defaults to `true` once the ledger is clean. Shipping P5 behind a permanently-off flag is explicitly not the intended outcome; that would preserve R1 under a different name. What the gate protects against is promoting on an *unverified* trigger table, not promoting at all. §3.1 **S10** ("the freeze and the default stay binding for WP1–WP38; WP40 is the only WP permitted to flip the default") is satisfied here, not deferred.

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
  - `plugin/src/types.ts`
  - `plugin/src/main.ts`
  - <!-- Updated: T3 2026-08-01 --> the recorded verification evidence is `workflowArtifacts/canvas-v2/CaptureTriggerLedger.md` — **produced by WP54, consumed here.** This WP adds its promotion decision and the AC4 retirement to its own report; it does not write or amend the ledger.
- **Required report:** `ImplementationReport_WP40.md` (in `workflowArtifacts/canvas-v2/`)
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
