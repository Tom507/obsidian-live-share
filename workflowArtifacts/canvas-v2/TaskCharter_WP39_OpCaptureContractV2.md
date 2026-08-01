# Task Charter — WP39: Op-capture contract V2

**Charter Status:** `SPEC_COMPLETE`
**WP:** WP39
**Phase:** P5
**task_mode:** `standard`
**Depends on:** WP15, WP18, WP22
**W4 Test Targets:** `0`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** the mechanism that made R1 a blocker cannot recur.
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 5, component **C39 — Op-capture contract V2** (work package WP39); phase **P5**.

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: modify (`canvas-binding.ts` `captureLocal` `:260–309`, `canvas-model-bridge.ts` `CAPTURE_TRIGGERS` `:88–93`, geometry helpers `:97–136`)
  - Responsibility: renew the R1 contract under I7/I8 so op-capture becomes safe to use.
  - Scope summary: upsert-only, atomic registers, validated, rounded
- **Out of scope / non-goals:**
  - Flipping `useCanvasBinding` — WP40 only.
  - Verifying the trigger table empirically — WP40.
  - Any file I/O or Obsidian import inside the binding (it stays headless).
- **Known interfaces / dependencies:**
  - Input: patched adapter signals
  - Output: schema-validated upserts on atomic registers, stamped `CAPTURE_OP`
  - Depends on work packages: WP15, WP18, WP22
  - **Convergence-fuzzer link (required by the BUILD_SPEC):** the fuzzer's op registry must be able to drive capture through both origins and assert identical resulting doc state.

---

## 3. Architecture Context

*Task-local architecture guidance only.*

- **Component(s) being changed:** Op-capture contract V2
- **Interfaces involved:**
  - Input: patched adapter signals
  - Output: schema-validated upserts on atomic registers, stamped `CAPTURE_OP`
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
  - `plugin/src/canvas/canvas-binding.ts:260–309` — `captureLocal` (calls `writeRecordMinimal` at `:294`)
  - `plugin/src/canvas/canvas-binding.ts:100–109` / `:110–125` — `recordsEqual` / `ymapToRecord`
  - `plugin/src/canvas/canvas-model-bridge.ts:88–93` — `CAPTURE_TRIGGERS`; `:97`, `:111`, `:121–136` — the geometry helpers
  - `plugin/src/canvas/canvas-model-bridge.ts:137` — `createCanvasModelBridge`
  - `plugin/src/canvas/canvas-binding.ts:81–99` — the instrumentation hook
- **Structure references:** *(intentionally empty — no Graphify graph exists for this project; FALLBACK mode is declared in the BUILD_SPEC section 3. Worker 3 fills this in after implementation. Do not invent paths here.)*

If structure references conflict with the BUILD_SPEC or explicit task scope, the BUILD_SPEC and TaskCharter win. Escalate instead of following the map.

---

## 4. Acceptance Criteria

*Exact copy from BUILD_SPEC section 5, component C39. No paraphrasing.*

1. Captures emit only observed fields, as upserts on atomic registers, and never delete a doc key; geometry is rounded before the register write.
2. Every capture passes the ingest validator before writing; an invalid capture is rejected with a signature instead of reaching the doc.
3. Captures advance the shadow, so the `CAPTURE_NET` safety net sees no diff for the same change — deduplication is structural, not timing-based.
4. Both capture sources are distinguishable by transaction origin (`CAPTURE_OP` vs `CAPTURE_NET`), and the binding still performs no file I/O and imports nothing from Obsidian.
5. Clearing an optional field (`color`, `label`) is expressible again: op-capture emits an **explicit field-clear** for the observed user action, which removes the value on every peer, and it is distinguishable from a mere non-observation — a capture that simply does not report the field still leaves it untouched (AC1). This closes the regression recorded as §3.1 **S14**, which P0 accepted knowingly because the save-diff net cannot make that distinction.

**Definition of Done:** the mechanism that made R1 a blocker cannot recur.

<!-- Updated: AC5 appended — WP39 becomes the owner of the optional-key-clear regression that I7 creates in P0 2026-07-31 -->

**Amendment note (2026-07-31).** AC5 is appended as a consequence of the WP4 escalation resolution. From P0, I7 forbids the Obsidian-save capture path from reading an omitted key as a removal, because that path genuinely cannot distinguish "the user cleared this field" from "the stale view omitted it" — that indistinguishability is the claim I7 makes. The user-visible cost is that clearing a card's colour or an edge's label stops propagating (BUILD_SPEC §3.1 S14). This WP is the first point in the migration where the distinction becomes available: `CAPTURE_OP` observes the user action itself rather than a state snapshot. AC5 must not be satisfied by relaxing AC1 — an unobserved field stays untouched; only an *observed clear* removes a value.

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
  - `plugin/src/canvas/canvas-binding.ts`
  - `plugin/src/canvas/canvas-model-bridge.ts`
- **Required report:** `ImplementationReport_WP39.md` (in `workflowArtifacts/canvas-v2/`)
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
