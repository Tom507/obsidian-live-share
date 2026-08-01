# Task Charter — WP8: `meta` + schemaVersion + V1→V2 migration

**Charter Status:** `SPEC_COMPLETE`
**WP:** WP8
**Phase:** P1
**task_mode:** `standard`
**Depends on:** WP4
**W4 Test Targets:** `0`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** an existing V1 canvas doc opens as a valid V2 doc with no data loss and no second migration on reopen.
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 5, component **C8 — `meta` map, schema version, and the V1→V2 doc migration** (work package WP8); phase **P1**.

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: modify (`plugin/src/files/canvas-sync.ts`, doc setup sites `:334`, `:348`, `:367`, `:493`, `:504`) + create (migration module)
  - Responsibility: introduce the `meta` container, stamp the schema version, detect major mismatches, and migrate an existing V1 doc in place.
  - Scope summary: doc metadata, version gate, in-place migration
- **Out of scope / non-goals:**
  - Populating `meta.guid` / `meta.epoch` — those arrive in P2 (the keys may be declared, not filled).
  - The full Receive-and-Persist mode — WP32; P1 only disables local capture for a mismatched path.
  - Changing the doc id (still path-based until WP27).
- **Known interfaces / dependencies:**
  - Input: a `Y.Doc` that is either fresh, V1-shaped (`x/y/width/height`, `fromNode/fromSide/toNode/toSide`, no `meta`), or already V2
  - Output: a V2-shaped doc with `meta.schemaVersion = 2`
  - Depends on work packages: WP4
  - **Convergence-fuzzer link (required by the BUILD_SPEC):** WP23 must be able to seed replicas from a migrated V1 doc as well as a fresh V2 doc.

---

## 3. Architecture Context

*Task-local architecture guidance only.*

- **Component(s) being changed:** `meta` map, schema version, and the V1→V2 doc migration
- **Interfaces involved:**
  - Input: a `Y.Doc` that is either fresh, V1-shaped (`x/y/width/height`, `fromNode/fromSide/toNode/toSide`, no `meta`), or already V2
  - Output: a V2-shaped doc with `meta.schemaVersion = 2`
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
  - `plugin/src/files/canvas-sync.ts:16` — `CANVAS_DOC_PREFIX`, and the doc-id sites `:334`, `:348`, `:367`, `:493`, `:504`
  - `plugin/src/files/canvas-sync.ts:360–467` — `subscribe`, incl. the host seed `:388–401`
  - `plugin/src/files/canvas-persistence.ts:363–387` — `seedDocFromCanvasData`
  - map names `"nodes"`/`"edges"` at `canvas-sync.ts:350–351, 384–385`; `canvas-persistence.ts:147–148, 365–366`
- **Structure references:** *(intentionally empty — no Graphify graph exists for this project; FALLBACK mode is declared in the BUILD_SPEC section 3. Worker 3 fills this in after implementation. Do not invent paths here.)*

If structure references conflict with the BUILD_SPEC or explicit task scope, the BUILD_SPEC and TaskCharter win. Escalate instead of following the map.

---

## 4. Acceptance Criteria

*Exact copy from BUILD_SPEC section 5, component C8. No paraphrasing.*

1. `meta` is created once per doc and carries `schemaVersion`, and (from P2) `guid`, `epoch` and `path`; it is never replaced by a new container.
2. A V1 doc is migrated in a single transaction: `x/y` → `pos`, `width/height` → `size`, endpoint keys → `from`/`to`, an `ord` is assigned to every record, and no record loses a value in the process.
3. Migration is idempotent: running it on an already-migrated doc changes nothing and produces no delta.
4. A doc whose `schemaVersion` major differs from this client's supported major is detected, and the client disables local capture for that path while persistence continues — it never writes a guess into the shared state.

**Definition of Done:** an existing V1 canvas doc opens as a valid V2 doc with no data loss and no second migration on reopen.

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
  - a new migration module under `plugin/src/canvas/` or `plugin/src/files/`
- **Required report:** `ImplementationReport_WP8.md` (in `workflowArtifacts/canvas-v2/`)
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
