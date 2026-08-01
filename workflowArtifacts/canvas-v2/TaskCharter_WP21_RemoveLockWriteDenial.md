# Task Charter — WP21: REMOVAL: lock write-denial seam

**Charter Status:** `SPEC_COMPLETE`
**WP:** WP21
**Phase:** P1
**task_mode:** `standard`
**Depends on:** WP9, WP10, WP19
**W4 Test Targets:** `0`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** R7 is moot — there is no write permission left for an epoch to protect.
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 5, component **C21 — REMOVAL: the lock write-denial data seam** (work package WP21); phase **P1**.

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: delete (`canWriteEntity` `:705–722` and its three call sites `:642`, `:660`, `:688`; the baseline-hold on denial; the `LOCK DENIED:` emitter `:576`; the injected `canWriteNode`/`canDeleteNode` write-gates and their `main.ts` wiring `:796–806`, and the binding-side mirrors `main.ts:1279–1285`)
  - Responsibility: remove the machinery that made a UX mechanism carry correctness, now that the data model resolves same-register conflicts.
  - Scope summary: `canWriteEntity`, baseline-hold, `LOCK DENIED:`
- **Out of scope / non-goals:**
  - `plugin/src/canvas/canvas-presence.ts` — must stay byte-unchanged; locks keep working as UX.
  - `canWriteCanvasPath` (read-only permission and guest globs) — that is authorisation, not locking, and stays.
  - The `LOCK REVERT:` view-revert path, which is retained.
  - The awareness liveness machinery (deadline pulse, reconnect reclaim defer, tiebreak) — unchanged.
- **Known interfaces / dependencies:**
  - Input: none (removal)
  - Output: a capture path with no write-authorisation branch
  - Depends on work packages: WP9, WP10, WP19
  - **Convergence-fuzzer link (required by the BUILD_SPEC):** WP23 must show that removing the write gate does not change convergence — concurrent writes to the same register converge by honest LWW on every replica, with no baseline-hold artefact and no held-back local state.

---

## 3. Architecture Context

*Task-local architecture guidance only.*

- **Component(s) being changed:** REMOVAL: the lock write-denial data seam
- **Interfaces involved:**
  - Input: none (removal)
  - Output: a capture path with no write-authorisation branch
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
  - `plugin/src/files/canvas-sync.ts:705–722` — `canWriteEntity` and its three call sites `:642`, `:660`, `:688`
  - `plugin/src/files/canvas-sync.ts:576` — the `LOCK DENIED:` emitter
  - `plugin/src/files/canvas-sync.ts:256`, `:259`, `:260`, `:264` — the injected predicates and their setters `:297`, `:304`, `:308`, `:313`
  - `plugin/src/main.ts:792`, `:796–799`, `:800–803`, `:804–806` — the predicate wiring; `:1279–1285` — the binding-side mirrors
  - `plugin/src/main.ts:1176–1185` — `canWriteCanvasPath` (KEEP)
  - `plugin/src/main.ts:1364–1381` — `revertCanvasNode` (KEEP)
- **Structure references:** *(intentionally empty — no Graphify graph exists for this project; FALLBACK mode is declared in the BUILD_SPEC section 3. Worker 3 fills this in after implementation. Do not invent paths here.)*

If structure references conflict with the BUILD_SPEC or explicit task scope, the BUILD_SPEC and TaskCharter win. Escalate instead of following the map.

---

## 4. Acceptance Criteria

*Exact copy from BUILD_SPEC section 5, component C21. No paraphrasing.*

1. `canWriteEntity` and its baseline-hold behaviour no longer exist; no capture path consults a lock before writing, and no code path holds a diff baseline because a write was denied.
2. Locks still work as UX: rings still colour, the loser's **view** revert still happens, and the awareness liveness machinery (deadline pulse, reconnect reclaim defer, tiebreak) is **byte-unchanged** — `canvas-presence.ts` is not modified.
3. `canWriteCanvasPath` (read-only permission and guest globs) is preserved and still consulted — authorisation is not locking.
4. Tests that pinned the removed denial behaviour are deleted deliberately and enumerated by name in the implementation report; no test is left asserting a behaviour that no longer exists.

**Definition of Done:** R7 is moot — there is no write permission left for an epoch to protect.

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
  - `plugin/src/main.ts`
  - test files pinning the removed behaviour (enumerated in the report)
- **Required report:** `ImplementationReport_WP21.md` (in `workflowArtifacts/canvas-v2/`)
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
