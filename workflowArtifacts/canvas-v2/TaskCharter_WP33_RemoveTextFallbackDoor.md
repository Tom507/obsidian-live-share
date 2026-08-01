# Task Charter — WP33: REMOVAL: R10 text fallback door

**Charter Status:** `SPEC_COMPLETE`
**WP:** WP33
**Phase:** P3
**task_mode:** `standard`
**Depends on:** WP32
**W4 Test Targets:** `0`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** the split-brain class is unreachable.
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 5, component **C33 — REMOVAL: the R10 text fallback door** (work package WP33); phase **P3**.

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: delete (`warnCanvasTextFallback` `vault-events.ts:67–79` and its reset `:80–83`, the fallback branch in `subscribeCanvasWithHandover` `:113`, the `else` fallback in the modify fan-out, the deliberate `BackgroundSync.subscribe` `:88` door, the `CANVAS TEXT FALLBACK:` emitter) + release the orphaned `Y.Text` (R6)
  - Responsibility: remove the split-brain door, now that Receive-and-Persist replaces it.
  - Scope summary: fallback + R6 orphaned `Y.Text` removed
- **Out of scope / non-goals:**
  - Changing generic `Y.Text` sync for genuine text files — only the `.canvas` door closes.
  - The Receive-and-Persist mode itself — WP32 must already be in place.
- **Known interfaces / dependencies:**
  - Input: none (removal)
  - Output: a `.canvas` path can never be handled by the text path
  - Depends on work packages: WP32

---

## 3. Architecture Context

*Task-local architecture guidance only.*

- **Component(s) being changed:** REMOVAL: the R10 text fallback door
- **Interfaces involved:**
  - Input: none (removal)
  - Output: a `.canvas` path can never be handled by the text path
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
  - **Schema impact:** No `schemaVersion` bump. The manifest doc gains `path → {mode, guid}`. Mixed-version rule: a schema-major mismatch resolves through this phase's Receive-and-Persist mode, which becomes the single degradation state for both causes.
- **Entry points / relevant files (from `workflowArtifacts/RepoMap.md`, V2 Touchpoint Inventory):**
  - `plugin/src/files/vault-events.ts:67–79` / `:80–83` — `warnCanvasTextFallback` and its reset (warn set `:64`)
  - `plugin/src/files/vault-events.ts:101–117` — the failure branch calling `warnCanvasTextFallback` `:113` then `backgroundSync.subscribe`
  - `plugin/src/files/vault-events.ts:224–271` — the modify fan-out and its `else` text branch
  - `plugin/src/files/background-sync.ts:88` — `subscribe`, the deliberate door that does not consult `skipsAutoTextSync`
  - `plugin/src/utils.ts:258` — `skipsAutoTextSync` (gains a fifth consumer)
  - `ARCHITECTURE.md` Part IX R6 — the orphaned `Y.Text` to release
- **Structure references:** *(intentionally empty — no Graphify graph exists for this project; FALLBACK mode is declared in the BUILD_SPEC section 3. Worker 3 fills this in after implementation. Do not invent paths here.)*

If structure references conflict with the BUILD_SPEC or explicit task scope, the BUILD_SPEC and TaskCharter win. Escalate instead of following the map.

---

## 4. Acceptance Criteria

*Exact copy from BUILD_SPEC section 5, component C33. No paraphrasing.*

1. No code path routes a `.canvas` path into `BackgroundSync` — the door at `BackgroundSync.subscribe` is closed and `skipsAutoTextSync` is consulted there too, making it the fifth consumer.
2. A failed canvas subscribe results in Receive-and-Persist, never in a raw-text subscription; the `CANVAS TEXT FALLBACK:` signature and its emitter are removed together.
3. Any `Y.Text` doc previously created for a canvas path is released rather than orphaned (R6), and a handover leaves no doc behind.
4. Exactly one owner is preserved at all times (D7): the path is always owned by `CanvasSync`, in full or degraded mode. Tests pinning the removed fallback are deleted deliberately and enumerated by name.

**Definition of Done:** the split-brain class is unreachable.

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
  - `plugin/src/files/vault-events.ts`
  - `plugin/src/files/background-sync.ts`
  - `plugin/src/utils.ts`
  - test files pinning the removed fallback (enumerated in the report)
- **Required report:** `ImplementationReport_WP33.md` (in `workflowArtifacts/canvas-v2/`)
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
