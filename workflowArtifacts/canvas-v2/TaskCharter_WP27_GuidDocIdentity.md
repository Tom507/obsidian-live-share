# Task Charter — WP27: GUID identity + rename + `getDoc` guards

**Charter Status:** `SPEC_COMPLETE`
**WP:** WP27
**Phase:** P2
**task_mode:** `standard`
**Depends on:** WP8, WP24
**W4 Test Targets:** `0`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** R5 and the rename hole are closed structurally.
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 5, component **C27 — GUID doc identity, path mapping and rename** (work package WP27); phase **P2**.

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: modify (`CANVAS_DOC_PREFIX` `:16` and the five doc-id sites `:334`, `:348`, `:367`, `:493`, `:504`; `manifest.ts`; `sync.ts:200–252`) + fix `background-sync.ts:173` and `collab.ts:62`
  - Responsibility: make identity independent of the path, so a rename is metadata and a bare-path `getDoc` cannot collide with a canvas doc.
  - Scope summary: doc id by guid; path stays the registry key
- **Out of scope / non-goals:**
  - Re-keying any in-memory registry, the ownership predicate or the awareness field shape — all stay path-keyed.
  - The epoch comparison rule — WP28.
  - Changing `SyncManager.getDoc`'s create-on-demand behaviour for non-canvas docs.
- **Known interfaces / dependencies:**
  - Input: a canonical path
  - Output: the doc id `__canvas__:<guid>`, with `path` an attribute in `meta` and in the manifest
  - Depends on work packages: WP8, WP24

---

## 3. Architecture Context

*Task-local architecture guidance only.*

- **Component(s) being changed:** GUID doc identity, path mapping and rename
- **Interfaces involved:**
  - Input: a canonical path
  - Output: the doc id `__canvas__:<guid>`, with `path` an attribute in `meta` and in the manifest
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
  - **Schema impact:** No `schemaVersion` bump. Adds `meta.guid`, `meta.epoch` and `meta.path`, the sidecar files, and changes the doc-id namespace from path-based to guid-based. Mixed-version rule: a client that cannot resolve a guid for a path treats the doc as unknown and asks peers or the manifest — it never seeds a second doc for the same file.
- **Entry points / relevant files (from `workflowArtifacts/RepoMap.md`, V2 Touchpoint Inventory):**
  - `plugin/src/files/canvas-sync.ts:16` — `CANVAS_DOC_PREFIX` (module-private, not exported) and the five construction sites `:334`, `:348`, `:367`, `:493`, `:504`, plus `:768`
  - `plugin/src/sync/sync.ts:200–252` — `getDoc` creates a `Y.Doc` + `Y.Text("content")` on demand (`:210`, `:249`)
  - `plugin/src/files/background-sync.ts:173` — unguarded bare-path `getDoc` inside `setActiveFile`
  - `plugin/src/editor/collab.ts:62` — unguarded bare-path `getDoc` inside `activateForFile`
  - `plugin/src/files/manifest.ts` — the manifest doc and `syncFromManifest`
  - `plugin/src/files/vault-events.ts:53–63` — `canvasOwned` (stays path-based)
- **Structure references:** *(intentionally empty — no Graphify graph exists for this project; FALLBACK mode is declared in the BUILD_SPEC section 3. Worker 3 fills this in after implementation. Do not invent paths here.)*

If structure references conflict with the BUILD_SPEC or explicit task scope, the BUILD_SPEC and TaskCharter win. Escalate instead of following the map.

---

## 4. Acceptance Criteria

*Exact copy from BUILD_SPEC section 5, component C27. No paraphrasing.*

1. Canvas docs are addressed by `__canvas__:<guid>`; `meta.path` and the manifest carry the `path → guid` mapping, and a client that knows only the path can resolve the guid from the manifest or from peers.
2. A rename mid-session updates `meta.path`, the manifest mapping and `index.json` without creating a new doc and without orphaning the old one; edits continue to flow across the rename.
3. All in-memory registries (adapter, presence, persistence, mute registry), the ownership predicate `canvasOwned`, and the **awareness field shape including `canvasPath`** remain path-keyed and unchanged.
4. The two unguarded bare-path `getDoc` call sites (`background-sync.ts:173`, `collab.ts:62`) can no longer create or reach a canvas doc, verified by an explicit test rather than by a reachability argument.

**Definition of Done:** R5 and the rename hole are closed structurally.

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
  - `plugin/src/files/manifest.ts`
  - `plugin/src/files/background-sync.ts`
  - `plugin/src/editor/collab.ts`
  - the sidecar index from WP24
- **Required report:** `ImplementationReport_WP27.md` (in `workflowArtifacts/canvas-v2/`)
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
