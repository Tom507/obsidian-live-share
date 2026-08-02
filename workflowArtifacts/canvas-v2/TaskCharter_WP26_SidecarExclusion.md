# Task Charter — WP26: Sidecar exclusion

**Charter Status:** `TESTS_ADDED`
**WP:** WP26
**Phase:** P2
**task_mode:** `standard`
**Depends on:** WP24
**W4 Test Targets:** `0`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** local replica state cannot leak into shared state.
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 5, component **C26 — Sidecar exclusion from manifest, sync and text-sync detection** (work package WP26); phase **P2**.

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: modify (`plugin/src/utils.ts:258` `skipsAutoTextSync` and its consumers `background-sync.ts:72`, `:195`, `:248`, `manifest.ts:174`)
  - Responsibility: guarantee the sidecar files are treated as local replica state, never as shared content.
  - Scope summary: excluded from manifest, sync, text-sync detection
- **Out of scope / non-goals:**
  - Changing the existing `.canvas` exclusion behaviour.
  - Closing the `BackgroundSync.subscribe` door for `.canvas` — that is WP33.
- **Known interfaces / dependencies:**
  - Input: vault paths
  - Output: exclusion verdicts
  - Depends on work packages: WP24

---

## 3. Architecture Context

*Task-local architecture guidance only.*

- **Component(s) being changed:** Sidecar exclusion from manifest, sync and text-sync detection
- **Interfaces involved:**
  - Input: vault paths
  - Output: exclusion verdicts
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
  - `plugin/src/utils.ts:258` — `skipsAutoTextSync` and its four-consumer rationale comment
  - `plugin/src/files/background-sync.ts:72` (startAll / manifest replay), `:195` (onFileAdded), `:248` (onFileRenamed)
  - `plugin/src/files/manifest.ts:174` — `syncFromManifest`, the fourth consumer
- **Structure references:** *(intentionally empty — no Graphify graph exists for this project; FALLBACK mode is declared in the BUILD_SPEC section 3. Worker 3 fills this in after implementation. Do not invent paths here.)*

If structure references conflict with the BUILD_SPEC or explicit task scope, the BUILD_SPEC and TaskCharter win. Escalate instead of following the map.

---

## 4. Acceptance Criteria

*Exact copy from BUILD_SPEC section 5, component C26. No paraphrasing.*

1. No file under `.obsidian/liveshare/state/` is ever added to the manifest, subscribed for sync, or handled by any text-sync path — asserted at each of the exclusion consumers, not only at one.
2. Creating, renaming into, or modifying a sidecar path triggers no sync activity and no doc creation.
3. The exclusion is expressed as one predicate with one definition, in the same style as the existing `.canvas` exclusion, and its consumers are enumerated in the code comment.
4. Existing `.canvas` exclusion behaviour is unchanged.

**Definition of Done:** local replica state cannot leak into shared state.

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
  - `plugin/src/utils.ts`
  - `plugin/src/files/background-sync.ts`
  - `plugin/src/files/manifest.ts`
- **Required report:** `ImplementationReport_WP26.md` (in `workflowArtifacts/canvas-v2/`)
- **BUILD_SPEC updates required:** no — unless implementation invalidates an architecture decision, in which case ESCALATE rather than editing the spec.
- **Gate status required at handover:** `npm run build` PASS and `npm test` with 0 failures, run from `plugin/`. All visible tests PASS.

---

## 7. Visible Test Cases / Producer Artifacts

Suite root: `plugin/src/__tests__/v2/wp26/`. Nine test files, 46 assertions, all currently
RED except the AC4 characterisations, the positive controls and the AC3 structural claims
that already hold.

### 7.0 — What WP26 consumes, and the two facts the charter body does not carry

- **WP24 owns the predicate.** `SIDECAR_DIR` and `isSidecarPath(path)` live in
  `plugin/src/files/canvas-sidecar.ts`. WP26 imports them. It must not re-spell
  `.obsidian/liveshare/state`, must not write its own prefix/suffix test, and must not
  add a second constant. The whole suite imports the same two symbols.
- **`isTextFile` already hides most sidecar paths.** `"json"` is in `TEXT_EXTENSIONS`;
  `"yhistory"` and `"ycheckpoint"` are not. Three of the five consumers therefore stop a
  `.yhistory` entry one line before the exclusion is consulted. Every test below uses
  `sidecarIndexPath()` (`.../index.json`) or a `.md` under the directory as its
  discriminating input — a suite built on `.yhistory` alone would be green against an
  untouched tree.
- **There are FIVE consumers, not four.** The charter §2 list is missing two:
  `ManifestManager.isSharedPath` → `ExclusionManager.isExcluded` (`manifest.ts:321`,
  named by the Shared Ownership Contract §5), and `BackgroundSync.handleLocalTextModify`,
  which is where AC2's third verb ("modifying") lands.
- **`handleLocalTextModify` must NOT be guarded with `skipsAutoTextSync`.**
  `vault-events.ts:250-256` deliberately routes a non-CanvasSync-owned `.canvas` into it —
  that is the local-edit half of the announced R10 text fallback. Guarding it with the
  canvas predicate turns the fallback read-only and violates AC4. Use the sidecar
  predicate alone there. TC5 holds this line.

### TC1 — `startAll` / manifest replay does not subscribe a sidecar path
- Verifies AC: AC1, AC2
- Test file: plugin/src/__tests__/v2/wp26/test_tp01_startall_manifest_replay_visible.test.ts
- What it checks: replaying a manifest that mixes sidecar and ordinary entries asks `getDoc` for none of the sidecar paths, installs no observer and writes no disk bytes under the sidecar directory, while the markdown entry in the same manifest and the prefix-sharing sibling `.../stateful/notes.md` are both subscribed normally.
- Test data channel: fixture (a hand-built manifest whose keys come from WP24's path helpers)

### TC2 — `onFileAdded` (the CREATE door) refuses every sidecar path
- Verifies AC: AC1, AC2
- Test file: plugin/src/__tests__/v2/wp26/test_tp02_on_file_added_visible.test.ts
- What it checks: creating `index.json`, a deep `.md` and a `.ycheckpoint` under the sidecar directory produces no doc, no observer, no `subscribing` entry and no disk write, including for the backslash spelling a Windows or remote caller produces, while a markdown create and both near-miss neighbours (one directory above, and `.../stateful/`) still install text sync.
- Test data channel: fixture (WP24 path helpers plus paths composed from `SIDECAR_DIR`)

### TC3 — `onFileRenamed` in both directions
- Verifies AC: AC1, AC2, AC4
- Test file: plugin/src/__tests__/v2/wp26/test_tp03_on_file_renamed_visible.test.ts
- What it checks: renaming INTO a sidecar path creates no doc for the new path yet still performs the old path's full teardown (`releaseDoc`, observer removed) because the guard sits after it, a sidecar-to-sidecar rename touches neither side, and — the direction an over-broad guard breaks — renaming a sidecar file OUT to an ordinary vault path DOES install text sync.
- Test data channel: fixture

### TC4 — `syncFromManifest` refuses a peer-published sidecar entry in all three branches
- Verifies AC: AC1, AC2
- Test file: plugin/src/__tests__/v2/wp26/test_tp04_sync_from_manifest_visible.test.ts
- What it checks: a text sidecar entry is neither doc'd nor `vault.create`d, a BINARY sidecar entry is not passed to `requestBinary` (the existing guard's `!entry.binary &&` prefix misses it, and `.yhistory`/`.ycheckpoint` are exactly what `publishManifest` marks binary), a directory entry under the sidecar directory creates no folder (that branch runs *before* the guard), the exclusion does not ride on the `skipText` option, and no sidecar path is ever muted or awaited — each against an ordinary entry in the same manifest that IS materialised, plus an exact `synced` count.
- Test data channel: fixture (Y.Map manifest seeded per test)

### TC5 — the MODIFY verb, and the R10 fallback that must survive it
- Verifies AC: AC2, AC4
- Test file: plugin/src/__tests__/v2/wp26/test_tp05_local_modify_visible.test.ts
- What it checks: `handleLocalTextModify` on a sidecar path creates no doc, pushes nothing into Y.Text and never calls `manifestManager.updateFile`, while on the same instance an ordinary note and a `.canvas` (the R10 text fallback) both still complete the full local-edit path — which is what forces the guard here to be `isSidecarPath` rather than `skipsAutoTextSync`.
- Test data channel: fixture (an in-memory disk map read through the vault stub)

### TC6 — the second, independent gate: manifest membership
- Verifies AC: AC1, AC2
- Test file: plugin/src/__tests__/v2/wp26/test_tp06_manifest_membership_gate_visible.test.ts
- What it checks: `isSharedPath` refuses every sidecar path with no `ExclusionManager` installed, with a NON-default `configDir` (the `${configDir}/**` pattern stops covering the fixed `SIDECAR_DIR` literal), and with `sharedFolder` pointing into `.obsidian` — the three configurations that break the coincidence which makes the default-config-dir case pass today — and `publishManifest`, `updateFile` and `addFolder` all agree, while ordinary content and the near-miss siblings stay shared.
- Test data channel: fixture (vault stub returning a fixed file list; settings built per case)

### TC7 — reachability of the one deliberate non-consumer
- Verifies AC: AC1
- Test file: plugin/src/__tests__/v2/wp26/test_tp07_subscribe_reachability_visible.test.ts
- What it checks: `startAll`, `onFileAdded` and `onFileRenamed` never hand `subscribe()` a sidecar path (observed on a spy that DID see the ordinary paths in the same run), no sidecar doc exists after every guarded entry point has been driven, and — the out-of-scope boundary — `subscribe()` called directly is still the open R10 door for a `.canvas`, which WP33 owns and WP26 must not close.
- Test data channel: fixture

### TC8 — the predicate's own truth table (AC4's dedicated assertions)
- Verifies AC: AC4, AC1
- Test file: plugin/src/__tests__/v2/wp26/test_tp08_canvas_behaviour_unchanged_visible.test.ts
- What it checks: two frozen lists — every input that returns `true` today because of `.canvas` still does (`.canvas` as a bare filename, `board.md.canvas`, dotfile and deep-path forms), and every near miss that returns `false` still does (`foo.canvas.md`, `notcanvas`, `board.canvas/`, `board.canvas/child.md`, `board.Canvas`) — plus the assertion that no `.canvas` row is also a sidecar path, so the AC4 list cannot be satisfied by the new clause; then the sidecar rows, the sidecar near misses (the directory itself, its trailing-slash form, `.../stateful/`, an embedded copy), and a whole-corpus equivalence to `endsWith(".canvas") || isSidecarPath(path)`.
- Test data channel: fixture (frozen lists) + deterministic generator (the corpus is composed from `SIDECAR_DIR`)

### TC9 — AC3's source-structure half
- Verifies AC: AC3
- Test file: plugin/src/__tests__/v2/wp26/test_tp09_one_predicate_one_definition_visible.test.ts
- What it checks: the sidecar directory literal is spelt in exactly one production module and `isSidecarPath` is defined exactly once (both in `files/canvas-sidecar.ts`), no module rebuilds the test from the directory's parent, `skipsAutoTextSync` is still a single definition in `utils.ts`, and its contract comment documents the sidecar exclusion (naming `isSidecarPath` or `canvas-sidecar`) and enumerates `background-sync.ts`, `manifest.ts` and every other production module that ends up calling the predicate. Source text is the oracle only for the claims that really are about source; all behaviour is pinned by TC1–TC8.
- Test data channel: fixture (the production tree itself, located by walking up to the repo root)

---

## 7b. W4 Test Targets (filled by Worker 3's Unit Test Sub-Agent, if any)

*Empty — none of C26's four acceptance criteria is INTEGRATION_SCOPE. All four are decided
at unit seams inside `plugin/src/` (a pure predicate, three `BackgroundSync` entry points,
`ManifestManager.syncFromManifest`/`isSharedPath`, and the module source), so nothing is
deferred to Worker 4.*

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
