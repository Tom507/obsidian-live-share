# RepoMap — obsidian-live-share

Generated: 2026-07-31 (V2-redesign refresh; supersedes the 2026-07-26 post-canvas-integrity map)
Mode: **FALLBACK_REPOMAP** — Graphify disabled for this project (`graphify_enabled=false`, `graphify_required=false`, `kc_enabled=false`). No `graphify-out/` exists anywhere in the tree and none was attempted. Downstream workers are in degraded structural mode: no `graph.json`, no `GRAPH_REPORT.md`. This map plus `ARCHITECTURE.md` is the entire structural memory.

Tree state: own git repo, HEAD `4b34d5e` (**2026-07-20 17:55 +0200**) + a large uncommitted working tree (canvas-redesign wiring **and** the whole canvas-integrity round, incl. two rework cycles). 22 modified + 13 untracked paths.

> **Freshness correction.** The dispatch brief assumed HEAD `4b34d5e` was *newer* than the previous map. It is not — `4b34d5e` is dated 2026-07-20, six days *older* than the 2026-07-26 map. **No commit has landed since the last map.** The genuine drift is (a) `workflowArtifacts/CONCEPT_V2.md` (new, 2026-07-31, 54 KB), (b) counts/sizes that the previous map recorded from a report rather than by execution, and (c) the new `V2 Touchpoint Inventory` section below. Production `.ts` sources are byte-identical to the previous map's snapshot.

Task context: structural map for the **canvas CRDT V2 redesign** described in `workflowArtifacts/CONCEPT_V2.md` (shadow diff, atomic registers, tombstones, sidecar history, canonical serialization). Weaknesses W1–W10 drive the relevance tags below.

Verification note: every line number, export, size and test count below was read or **executed** off the working tree for this refresh, not copied from a report. Where a companion document and the tree disagree, the tree is recorded and the disagreement is called out in **Notes**.

Companion documents — read these instead of re-deriving:
- `workflowArtifacts/CONCEPT_V2.md` (54 KB) — the V2 concept; W1–W10 at `:146`, `:162`, `:178`, `:198`, `:219`, `:238`, `:257`, `:274`, `:291`, `:305`; solution parts at `:541` (sidecar log / W4), `:610` (ownership consensus / W5), `:661` (canonical serialization / W7+W9), `:692` (validation + quarantine / W3), `:808` (test strategy / W10). German prose.
- `ARCHITECTURE.md` (repo root, **82 KB**, untracked) — verified architecture + the log-signature table (§ Appendix).
- `workflowArtifacts/canvas-integrity/HANDOVER.md` — previous round's authority: gates, deviations D1–D6, risk notes, plus two appended rework-cycle sections.
- `workflowArtifacts/canvas-redesign/SPEC_01..04` — the CanvasBinding/Persistence specs behind the flag-gated path.
- `workflowArtifacts/e2e-infra/E2E_USAGE.md` — live two-instance rig usage (**never run yet**).

---

## Structure

```text
obsidian-live-share/
├── ARCHITECTURE.md              ← verified architecture + US6 log-signature table (untracked, 82 KB)
├── manifest.json                ← REAL plugin manifest, v0.6.1 (see Notes — not a symlink)
├── manifest-beta.json / versions.json                  ← release metadata (0.6.0 + 0.6.1 added)
├── docker-compose.yml / Dockerfile / flake.nix         ← relay deployment (off limits)
├── biome.json                   ← lint/format config (advisory here — see Notes)
├── .github/workflows/           ← ci.yml (lint+build+test, node 20/22, server & plugin), release.yml
├── data/                        ← local relay LevelDB (audit + yjs-docs); runtime, not source
├── docs/                        ← README, architecture, plugin, server, security prose
├── plugin/                      ← the Obsidian plugin (TypeScript, esbuild → main.js)
│   ├── package.json             ← scripts: build / test / lint / dev  (see Build & Test Commands)
│   ├── esbuild.config.mjs       ← bundler; defines __LS_E2E__ (false in prod → e2e tree-shaken)
│   ├── vitest.config.ts         ← aliases `obsidian` → src/__mocks__/obsidian.ts; no other config
│   ├── manifest.json            ← BROKEN symlink (55 B, POSIX abs path) — ignore it
│   ├── main.js                  ← BUILT artifact (626 KB, committed for release)
│   └── src/                     ← 39 production .ts files, 12 036 L
│       ├── main.ts (1688 L)     ← plugin entry; ALL canvas wiring; NO TEST FILE (R6)
│       ├── types.ts (367 L)     ← LiveShareSettings + DEFAULT_SETTINGS
│       ├── utils.ts (317 L)     ← path canon, isTextFile, **skipsAutoTextSync** (:258)
│       ├── debug-logger.ts (167 L)             ← ring buffer + optional file sink
│       ├── canvas/
│       │   ├── canvas-adapter.ts (689 L)       ← ONLY file allowed to touch view.canvas internals
│       │   ├── reconcile-plan.ts (185 L)       ← pure structural|geometry|noop classifier (untracked)
│       │   ├── canvas-presence.ts (592 L)      ← awareness cursors + per-node advisory locks
│       │   ├── canvas-overlay.ts (92 L)        ← dumb DOM renderer
│       │   ├── canvas-binding.ts (317 L)       ← CRDT⇄model binding (flag ON only)
│       │   └── canvas-model-bridge.ts (331 L)  ← adapter → binding glue (flag ON only, untracked)
│       ├── files/
│       │   ├── canvas-sync.ts (981 L)          ← structured canvas CRDT; PROTECTED_KEYS
│       │   ├── canvas-persistence.ts (480 L)   ← the SINGLE CRDT→disk canvas writer (untracked)
│       │   ├── background-sync.ts (454 L)      ← generic Y.Text sync; 3 .canvas guards
│       │   ├── vault-events.ts (272 L)         ← ownership predicate + handover helper
│       │   ├── manifest.ts (347 L)             ← manifest replay; 4th .canvas guard (:174)
│       │   ├── file-ops.ts (528 L)             ← vault ops + path mute registry
│       │   └── exclusion.ts (18 L)
│       ├── sync/
│       │   ├── sync.ts (721 L)                 ← SyncManager: doc registry, mux WS, awareness pulse
│       │   ├── mux-protocol.ts (35 L), control-ws.ts (359 L), control-handlers.ts (303 L)
│       │   └── connection-state.ts (61 L), offline-queue.ts (64 L), crypto.ts (115 L)
│       ├── editor/              ← collab.ts (135 L), conflict-decoration.ts (169 L)
│       ├── session/             ← session (191 L), commands (183 L), presence-manager (196 L),
│       │                          presence-view (212 L), log-view (132 L), auth (66 L)
│       ├── ui/                  ← settings.ts (395 L), modals, approval/audit modals, indicators
│       ├── testing/e2e-control.ts (524 L)      ← flag-gated 127.0.0.1 http+SSE control server
│       ├── __mocks__/obsidian.ts               ← Obsidian API mock for vitest
│       └── __tests__/           ← 35 suites / 674 tests + 6 helper modules (16 134 L total)
├── server/                      ← the relay (Node + express + ws + Yjs + level) — OFF LIMITS
│   ├── src/{index,ws-handler,rooms,permissions,persistence,audit-log,
│   │        control-handler,github-auth,mux-protocol,util}.ts
│   ├── src/__tests__/           ← 10 suites / 122 tests
│   └── dist/                    ← committed build output
├── tools/launch_liveshare_e2e.py (192 L)  ← two-instance live launcher (ports 39421/39422)
└── workflowArtifacts/           ← workflow artifacts (canonical root)
    ├── RepoMap.md               ← THIS FILE
    ├── CONCEPT_V2.md            ← NEW 2026-07-31: the V2 redesign concept (W1–W10) — untracked
    ├── BUILD_SPEC_ObsidianLiveShare.md, BUG_ANALYSIS.md, BUGFIX_STATUS.md,
    │   CANVAS_FIX_REPORT.md, CANVAS_SYNC_REDESIGN.md, E2ETestReport.md, PLAN.md,
    │   USER_STORIES.md, HANDOVER.md, ImplementationReport_WP1..4  ← older rounds; historical
    ├── canvas-integrity/        ← last completed round (15 files): BUILD_SPEC, PLAN, USER_STORIES,
    │   │                          HANDOVER, WP1..7 reports, IntegrationTestReport,
    │   │                          ANALYSIS_CanvasTwoWriter_2026-07-26.md,
    │   └──                       Worker4FixRequest_WP6{,_Cycle2}.md
    ├── canvas-redesign/         ← SPEC_01..04, PLAN, USER_STORIES, WP1..3 reports, README,
    │                              ImplementationReport_Phase2-4_Wiring.md, E2ETestReport, HANDOVER
    └── e2e-infra/               ← BUILD_SPEC, PLAN, USER_STORIES, WP1..6 reports, E2E_USAGE, HANDOVER
```

---

## Build & Test Commands

Run from `plugin/` or `server/` respectively — **not** from the repo root. `node_modules` is present in both. The junction resolves to `H:\Developement\_NeuralAngels\liveshareCollab\obsidian-live-share`; either path works.

| Purpose | Directory | Command | Verified result (2026-07-31) |
|---|---|---|---|
| Plugin test suite | `plugin/` | `npm test` (= `vitest run`) | **35 files / 674 tests passed, 41.38 s** |
| Plugin single file | `plugin/` | `npx vitest run src/__tests__/<file>.test.ts` | — |
| Plugin typecheck + prod build | `plugin/` | `npm run build` (= `tsc -noEmit -skipLibCheck && node esbuild.config.mjs production`) | writes `plugin/main.js` |
| Plugin dev watch build | `plugin/` | `npm run dev` (= `node esbuild.config.mjs`, watch, `__LS_E2E__=true`) | — |
| Plugin lint | `plugin/` | `npm run lint` (= `biome check .`) | advisory only — see Notes |
| Server test suite | `server/` | `npm test` (= `vitest run`) | **10 files / 122 tests passed, 19.70 s** |
| Server build | `server/` | `npm run build` (= `tsc`) | writes `server/dist/` |
| Live two-instance E2E rig | repo root | `python tools/launch_liveshare_e2e.py` | **never executed** |

Runner facts the implementation workers must not re-derive:
- Runner is **Vitest 4.0.18** (`plugin/package.json` devDeps). **Vitest 4 removed the `basic` reporter** — `--reporter=basic` fails with `ERR_LOAD_URL: Failed to load url basic`. Use the default reporter or `--reporter=dot`.
- `plugin/vitest.config.ts` sets `test: {}` — no `include` override, so **every** `*.test.ts` under `src/` runs, including `src/__tests__/e2e/two-host.test.ts`. The only config that matters is the `obsidian` → `src/__mocks__/obsidian.ts` alias.
- `src/__tests__/wp5/latency.test.ts` deliberately sleeps **33.5 s** in one case ("static caret and idle lock survive a >30 s idle window"). Total wall time ≈41 s is therefore floor-bound by that test, **not a hang**. Budget ≥90 s timeout for any automated invocation.
- CI (`.github/workflows/ci.yml`) runs `npm ci && npm run lint && npm run build && npm test` for **both** `server/` and `plugin/`, on node 20.x and 22.x. Lint failures break CI even though biome is treated as advisory locally.

---

## Test File Inventory

**Plugin — 35 suites / 674 tests / 41.38 s** (all green), plus 6 non-suite helper modules.

| Suite (`plugin/src/__tests__/`) | Lines | V2 relevance |
|---|---|---|
| `w4-canvas-integrity.test.ts` | 1771 | RELEVANT — 50 probes (A1–A9, C2, J1–J4, K1–K8, L1) pinning the single-writer + protected-key invariants |
| `canvas-sync.test.ts` | 1201 | RELEVANT — three-way diff, lock gating, `PROTECTED_KEYS`, `RECONCILE_GEOMETRY_KEYS` drift guard |
| `manifest.test.ts` | 871 | ADJACENT — manifest replay + the `:174` `.canvas` guard |
| `sync.test.ts` | 875 | ADJACENT — `getDoc`/`releaseDoc`/`waitForSync`, awareness pulse |
| `canvas-single-writer.test.ts` | 841 | RELEVANT — the headline single-writer proof; **read this first** |
| `canvas-persistence.test.ts` | 807 | RELEVANT — coldOpen ordering, write queue, mute refcount |
| `control-ws.test.ts` | 698 | SKIP |
| `background-sync.test.ts` | 696 | RELEVANT — the three `.canvas` guards + the deliberate `subscribe` door |
| `canvas-adapter.test.ts` | 655 | RELEVANT — `isBusy()` watchdog, viewport math, patch adoption |
| `regression.test.ts` | 617 | ADJACENT |
| `file-ops.test.ts` | 555 | ADJACENT — mute registry |
| `wp5/latency.test.ts` | 505 | ADJACENT — the 33 s sleeper lives here |
| `utils.test.ts` | 471 | RELEVANT — `skipsAutoTextSync` |
| `canvas-binding.test.ts` | 447 | RELEVANT |
| `collab.test.ts` | 315 | ADJACENT — proves no internal `.canvas` guard (probe K5) |
| `canvas-binding-capture.test.ts` | 285 | RELEVANT — capture path (untracked) |
| `canvas-presence.test.ts` | 277 | RELEVANT — advisory locks |
| `e2e-control.test.ts` | 260 | ADJACENT |
| `reconcile-plan.test.ts` | 245 | RELEVANT — pure classifier (untracked) |
| `canvas-matrix.test.ts` | 234 | RELEVANT |
| `connection-state.test.ts` | 218 | SKIP |
| `debug-logger.test.ts` | 192 | SKIP |
| `harness/two-peer.test.ts` | 195 | RELEVANT — two-peer harness self-test |
| `harness/canvas-double.test.ts` | 178 | RELEVANT — canvas double self-test |
| `canvas-binding-apply.test.ts` | 172 | RELEVANT — apply path (untracked) |
| `crypto.test.ts` | 150 | SKIP |
| `session.test.ts` | 158 | SKIP |
| `offline-queue.test.ts` | 135 | SKIP |
| `e2e/two-host.test.ts` | 112 | ADJACENT — in the default run |
| `canvas-overlay.test.ts` | 107 | ADJACENT |
| `explorer-indicators.test.ts` | 103 | SKIP |
| `mux-protocol.test.ts` | 99 | SKIP |
| `exclusion.test.ts` | 74 | SKIP |
| `types.test.ts` | 28 | ADJACENT — `DEFAULT_SETTINGS` pin |
| `conflict-decoration.test.ts` | 16 | SKIP |

Helper modules (imported, not collected as suites): `harness/two-peer.ts` (545 L), `harness/canvas-double.ts` (318 L), `e2e/two-host-harness.ts` (257 L), `wp5/harness.ts` (208 L), `harness/interaction-driver.ts` (145 L), `e2e/launch-entry.ts` (98 L).

**Server — 10 suites / 122 tests / 19.70 s** (all green): `audit-log`, `control-handler`, `github-auth`, `integration`, `permissions`, `persistence`, `rooms`, `server-password`, `util`, `ws-handler`. All **SKIP** for V2 (relay off limits).

---

## V2 Touchpoint Inventory

Exact seams the V2 redesign touches. All paths relative to the repo root. Line numbers are definition lines unless a range is given; ranges are `first–last` of the construct's body. **Structure only — no recommendations.**

### 1. Capture / diff entry point (W1: capture diffs against disk, not a view shadow)

| Symbol | Location | Signature / note |
|---|---|---|
| `CanvasSync.handleLocalModify` | `plugin/src/files/canvas-sync.ts:496–619` | `async handleLocalModify(rawPath: string): Promise<void>`. Guards at `:498` (`recentDiskWrites`), `:499` (`subscribedPaths`), `:502` (`canWrite`). Reads the file at `:511`, parses at `:512`. |
| `lastWrittenContent` (the diff baseline) | `plugin/src/files/canvas-sync.ts:251` | `private lastWrittenContent = new Map<string, string>()`. Writers: `:400` (subscribe seed), `:535` (echo-breaker no-op), `:579` (clean-pass advance), `:858` (`noteExternalDiskWrite`), `:971` (retired `writeToDisk`). Cleared at `:773`. Read at `:520`, `:952`. |
| baseline read + three-way base construction | `plugin/src/files/canvas-sync.ts:520–521` | `const baseContent = this.lastWrittenContent.get(path)` → `parseCanvas(baseContent)` or `{nodes:{},edges:{}}` |
| echo breaker (semantic disk == CRDT compare) | `plugin/src/files/canvas-sync.ts:526–538` | uses `canvasRecordsEqual(ymapToRecords(nodesMap), next.nodes)` |
| `canvasRecordsEqual` (private helper) | `plugin/src/files/canvas-sync.ts:152–170` | semantic record compare |
| `ymapToRecords` (private helper) | `plugin/src/files/canvas-sync.ts:140–151` | flattens map-of-maps → plain records |
| `objChanged` (private helper) | `plugin/src/files/canvas-sync.ts:196–209` | per-object change predicate |
| `CanvasSync.applyLocalDiffToYMaps` | `plugin/src/files/canvas-sync.ts:620–704` | the actual three-way diff→CRDT writer; calls `canWriteEntity` at `:642`, `:660`, `:688` |
| `applyKeyDiff` (private) | `plugin/src/files/canvas-sync.ts:210–234` | per-key diff with the `PROTECTED_KEYS` delete guard |
| `applyToYMap` (exported) | `plugin/src/files/canvas-sync.ts:171–195` | full-object apply with the second `PROTECTED_KEYS` delete guard |
| `CanvasSync.pruneEdgesForDeletedNodes` | `plugin/src/files/canvas-sync.ts:723–739` | dangling-edge prune (GAP-5) |
| capture path (flag ON) | `plugin/src/canvas/canvas-binding.ts:260–309` | `captureLocal(change: LocalChange): void` — the binding's capture entry; calls `writeRecordMinimal` at `:294` |
| capture triggers table | `plugin/src/canvas/canvas-model-bridge.ts:88–93` | `export const CAPTURE_TRIGGERS` |
| geometry-only capture predicate | `plugin/src/canvas/canvas-model-bridge.ts:121–136` | `onlyGeometryChanged(prev, next)`; helpers `extractGeometry` `:97`, `sameGeometry` `:111` |

### 2. Canvas parse / serialize pair (W7 array ordering, W9 Obsidian-originated saves)

| Symbol | Location | Signature |
|---|---|---|
| `parseCanvas` | `plugin/src/files/canvas-sync.ts:74–94` | `export function parseCanvas(content: string): CanvasData` — array→id-keyed record; **silently returns `{nodes:{},edges:{}}` on any JSON error** (`:91–93`); drops any node/edge without `id` |
| `CanvasData` | `plugin/src/files/canvas-sync.ts:69–73` | `{ nodes: Record<string, Record<string, unknown>>; edges: … }` |
| `buildCanvasData` | `plugin/src/files/canvas-sync.ts:98–130` | `(nodesMap, edgesMap) => { nodes: Record<string,unknown>[]; edges: … }` — **array order = Y.Map iteration order**, no explicit sort (W7). Prunes dangling edges at `:120–126`. |
| `serializeCanvas` | `plugin/src/files/canvas-sync.ts:132–137` | `JSON.stringify(buildCanvasData(...), null, "\t")` — tab-indented, key order = insertion order (W7/W9) |
| re-export for the persistence layer | `plugin/src/files/canvas-persistence.ts:388` | `export { buildCanvasData, serializeCanvas }` |
| serialize call site (the only disk writer) | `plugin/src/files/canvas-persistence.ts:229` | inside `flushToDisk` |

### 3. Y.Doc structure setup for canvas docs (W4 doc identity / seeding / persistence)

| Concern | Location | Detail |
|---|---|---|
| doc-id prefix | `plugin/src/files/canvas-sync.ts:16` | `const CANVAS_DOC_PREFIX = "__canvas__:"` — module-private, **not exported** |
| doc-id construction (5 sites) | `canvas-sync.ts:334, 348, 367, 493, 504` and `:768` | always `` `${CANVAS_DOC_PREFIX}${path}` `` where `path` is the canonical path |
| map names | `"nodes"` / `"edges"` | `doc.getMap<Y.Map<unknown>>("nodes"|"edges")` at `canvas-sync.ts:350–351, 384–385`; `canvas-binding.ts:169–170`; `canvas-persistence.ts:147–148, 365–366`. **Nested map-of-maps; node/edge fields are plain LWW values on the inner `Y.Map` — no `Y.Text` for node text (W2/W8).** |
| `SyncManager.getDoc` | `plugin/src/sync/sync.ts:200–252` | `getDoc(rawPath: string): DocHandle | null` — **creates a `Y.Doc` + `Y.Text("content")` on demand** (`:210`, `:249`) |
| `SyncManager.releaseDoc` | `plugin/src/sync/sync.ts:253–280` | refcounted release |
| `SyncManager.waitForSync` | `plugin/src/sync/sync.ts:281–312` | `waitForSync(rawPath, timeoutMs = 10_000)` |
| `DocHandle` | `plugin/src/sync/sync.ts:87–94` | the handle interface |
| **all `getDoc` call sites** | see table in *Known unguarded `getDoc` call sites* below | `collab.ts:62`; `background-sync.ts:97, 173, 250, 297, 370`; `canvas-sync.ts:334, 348, 368, 505`; `manifest.ts:62, 201` |
| `CanvasSync.subscribe` (host seed path) | `plugin/src/files/canvas-sync.ts:360–467` | seed at `:388–401` — host reads disk, `applyCanvasToYMaps` in one transact at `:395`, then sets the baseline at `:400`. Guest reconcile kick at `:459–465`. |
| `CanvasSync.getCanvasDocHandle` | `plugin/src/files/canvas-sync.ts:332–342` | `(rawPath) => DocHandle | null` — the seam `main.ts:1202` uses to hand the doc to persistence |
| `CanvasSync.getCanvasSnapshot` | `plugin/src/files/canvas-sync.ts:343–355` | returns `null` when unsubscribed or `nodesMap.size === 0` |
| `CanvasPersistence.coldOpen` | `plugin/src/files/canvas-persistence.ts:310–327` | `async coldOpen(seedOrigin = CANVAS_SEED_ORIGIN): Promise<ColdOpenResult>`; emptiness test at `:312` |
| `ColdOpenResult` | `plugin/src/files/canvas-persistence.ts:79–83` | `"seeded-from-file" | "doc-wins" | "empty"` |
| `CANVAS_SEED_ORIGIN` | `plugin/src/files/canvas-persistence.ts:76` | `unique symbol` transaction origin |
| `seedDocFromCanvasData` | `plugin/src/files/canvas-persistence.ts:363–387` | the seeding writer (its own `getMap` pair at `:365–366`) |
| `isCanvasDataEmpty` | `plugin/src/files/canvas-persistence.ts:353–362` | |

### 4. Record write helpers + protected keys (W2 field granularity, W3 ingest validation)

| Symbol | Location | Note |
|---|---|---|
| `GEOMETRY_KEYS` | `plugin/src/files/canvas-sync.ts:29` | `Set(["x","y","width","height"])`, exported |
| `PROTECTED_KEYS` | `plugin/src/files/canvas-sync.ts:53–62` | `GEOMETRY_KEYS ∪ {type, fromNode, toNode, fromSide, toSide}`, exported; consulted by **both** delete paths (`applyToYMap` `:171`, `applyKeyDiff` `:210`) |
| `RECONCILE_GEOMETRY_KEYS` | `plugin/src/canvas/reconcile-plan.ts:56–63` | deliberate module-private mirror (keeps the module import-free); drift guarded by a test in `canvas-sync.test.ts` |
| third geometry-key copy | `plugin/src/canvas/canvas-model-bridge.ts:94` | `const GEOMETRY_KEYS` — same rationale, **not** exported |
| `applyToYMap` | `plugin/src/files/canvas-sync.ts:171–195` | `export function applyToYMap(ymap: Y.Map<unknown>, obj: Record<string, unknown>): void` |
| `applyKeyDiff` | `plugin/src/files/canvas-sync.ts:210–234` | private |
| `CanvasSync.applyCanvasToYMaps` | `plugin/src/files/canvas-sync.ts:776–813` | private; **destructive**: deletes every id not in `data` (`:791–793` nodes, edges below). This is the R9 host re-seed path. |
| `writeRecordMinimal` | `plugin/src/canvas/canvas-binding.ts:126–143` | private to the module; `(ymap, next) => boolean` — sets changed keys, deletes absent ones. **No `PROTECTED_KEYS` guard on this path.** Mirrored in prose at `plugin/src/testing/e2e-control.ts:336`. |
| `upsertRecord` (E2E mirror) | `plugin/src/testing/e2e-control.ts:338–355` | the rig's own copy of the same write shape |
| `recordsEqual` / `ymapToRecord` | `plugin/src/canvas/canvas-binding.ts:100–109` / `110–125` | binding-side compare + flatten |
| `CANVAS_BINDING_ORIGIN` | `plugin/src/canvas/canvas-binding.ts:68` | `unique symbol` transaction origin |
| binding instrumentation hook | `plugin/src/canvas/canvas-binding.ts:81–99` | `CanvasBindingCounter`, `CanvasBindingInstrument`, `setCanvasBindingInstrument` |

### 5. Reconcile planner (W1 shadow, W7 ordering)

| Symbol | Location | Signature |
|---|---|---|
| `planReconcile` | `plugin/src/canvas/reconcile-plan.ts:163–185` | `(input: ReconcilePlanInput) => ReconcilePlan` — pure, zero imports, no clock/DOM/Obsidian |
| `ReconcilePlan` | `plugin/src/canvas/reconcile-plan.ts:25` | `"structural" | "geometry" | "noop"` |
| `ReconcilePlanInput` | `plugin/src/canvas/reconcile-plan.ts:33–55` | `{ desired, lastApplied, liveNodeIds, liveEdgeIds, initial? }` |
| `CanvasRecords` | `plugin/src/canvas/reconcile-plan.ts:28–32` | |
| `canvasIds` | `plugin/src/canvas/reconcile-plan.ts:64–81` | |
| `cloneCanvasRecords` | `plugin/src/canvas/reconcile-plan.ts:82–88` | |
| `diffRecords` / `RecordsDiff` | `plugin/src/canvas/reconcile-plan.ts:122–162` / `:112` | `"same" | "geometry" | "structural"` |
| `sameStringSet` / `indexById` | `plugin/src/canvas/reconcile-plan.ts:89–99` / `100–111` | |
| `canvasApplied` (the view shadow) | `plugin/src/main.ts:114` | `private canvasApplied = new Map<string, CanvasRecords>()`. Writes: `:1110` (structural apply ok), `:1146` (geometry apply, only when `interacting === 0`). Deletes: `:1029` (leaf closed), `:1425` (teardown). Read: `:1073`. |
| `LiveSharePlugin.reconcileLiveCanvas` | `plugin/src/main.ts:1046–1175` | `(path, data, opts?: {initial?: boolean}) => void`. Adapter availability gate `:1053`, **`isBusy()` drag gate `:1054–1059`**, `planReconcile` call `:1071–1077`, `noop` early-out `:1080`. |
| `CanvasAdapter.isBusy` | `plugin/src/canvas/canvas-adapter.ts:87` (interface), `:572` (impl), doc `:310` | watchdog-aware inactivity predicate; `DRAG_WATCHDOG_MS = 5000` at `:260`; second consumer at `:589` |

### 6. Persistence writer (W4 doc seeding/identity, W9 Obsidian saves)

| Symbol | Location | Signature |
|---|---|---|
| `CanvasPersistence` (class) | `plugin/src/files/canvas-persistence.ts:102–352` | ctor `:143–161`; headless — no Obsidian import |
| `CanvasPersistence.start` | `:162–175` | attaches `observeDeep` on both maps (`:165–166`) |
| `CanvasPersistence.isRecentDiskWrite` | `:176–185` | |
| `CanvasPersistence.scheduleWrite` | `:186–205` | private; debounce via injected scheduler |
| `CanvasPersistence.flush` | `:206–226` | `async flush(): Promise<void>` |
| `CanvasPersistence.flushToDisk` | `:227–238` | private; serializes at `:229` |
| `CanvasPersistence.writeSnapshot` | `:239–268` | private; emits the `CANVAS WRITER:` log at `:250` and fires `onWritten(content)` at `:253` |
| mute refcount trio | `:269–280` `acquireMute`, `:281–289` `armSettleRelease`, `:290–309` `releaseMute` | `DISK_WRITE_SETTLE_MS = 250` at `:39` |
| `CanvasPersistence.destroy` | `:328–352` | unobserves at `:332–333` |
| `attachCanvasPersistence` | `plugin/src/files/canvas-persistence.ts:470–480` | `export async function attachCanvasPersistence(doc, io, diskPath, opts) => Promise<AttachedCanvasPersistence>`. **Ordering contract: `coldOpen()` after `waitForSync`, before `start()`.** |
| `AttachedCanvasPersistence` | `:455–469` | `{ persistence, coldOpen }` |
| `createVaultPersistenceIO` | `:431–454` | `(adapter: VaultAdapterLike, fileOps: FileOpsLike, guards: PersistenceGuards) => PersistenceIO` |
| `PersistenceIO` / `PersistenceScheduler` / `PersistenceGuards` | `:47–60` / `:61–66` / `:420–430` | all injected |
| `CanvasPersistenceOpts` (incl. `onWritten`) | `:84–101` | the `onWritten` contract is documented at `:94` |
| `LiveSharePlugin.attachCanvasWriter` | `plugin/src/main.ts:1199–1235` | the only production caller. `getCanvasDocHandle` `:1202`, `createVaultPersistenceIO` `:1205`, `attachCanvasPersistence` `:1210–1218`, **`onWritten` → `noteExternalDiskWrite` at `:1216`**, teardown-race check `:1220`. |
| `canvasWriters` registry | `plugin/src/main.ts:129` (+ `:132` `canvasWriterAttaching`) | destroyed at `:1413–1421` in `teardownCanvasPresences` |
| `CanvasSync.noteExternalDiskWrite` | `plugin/src/files/canvas-sync.ts:856–879` | `(rawPath: string, content: string): void` — opens the echo window **and** advances `lastWrittenContent` (`:858`). Rationale comment `:846–855`. |
| retired writer (no caller) | `plugin/src/files/canvas-sync.ts:949–981` | `private async writeToDisk(path, content, expectedSeq?)` + the `remoteSeq` gate (`:277`, `:357`, `:421`, `:482`, `:758`). Retained by AC9. |

### 7. Lock / awareness seams (W5 ownership, W6 locks)

| Symbol | Location | Note |
|---|---|---|
| `CanvasSync.canWriteEntity` | `plugin/src/files/canvas-sync.ts:705–722` | `private canWriteEntity(opts: {path; kind: "node"|"edge"}, id: string, ...records) => boolean`. Nodes gate on own id; an **edge is writable only while BOTH endpoints are writable**. |
| callers of `canWriteEntity` (exactly 3) | `canvas-sync.ts:642` (create), `:660` (update, passes `baseObj`), `:688` (delete) | all inside `applyLocalDiffToYMaps` |
| injected predicates | `canvas-sync.ts:256` `canWrite`, `:259` `canWriteNode`, `:260` `canDeleteNode`, `:264` `onLocalNodeChange` | setters at `:297`, `:304`, `:308`, `:313` |
| wiring of those predicates | `plugin/src/main.ts:792` (`canWrite` → `canWriteCanvasPath`), `:796–799` (`canWriteNode` → presence), `:800–803` (`canDeleteNode`), `:804–806` (`onLocalNodeChange`) | |
| `LiveSharePlugin.canWriteCanvasPath` | `plugin/src/main.ts:1176–1185` | read-only permission + guest minimatch patterns |
| binding-side mirror of the same gates | `plugin/src/main.ts:1279–1285` | `canWrite` / `canWriteNode` / `canDeleteNode` passed into `new CanvasBinding(...)`; consumed inside `CanvasBinding` via `CanvasBindingOpts` (`canvas-binding.ts:49–67`) |
| `CanvasPresence` (locks + cursors) | `plugin/src/canvas/canvas-presence.ts` (592 L) | `onRevert` hook at `:387`; `RECONNECT_RECLAIM_DEFER_MS = 250` at `:24` |
| `LiveSharePlugin.revertCanvasNode` | `plugin/src/main.ts:1364–1381` | emits `LOCK REVERT:` at `:1375`; forces `reconcileLiveCanvas(..., {initial:true})` at `:1379` |
| `LiveSharePlugin.mountCanvasPresence` | `plugin/src/main.ts` ≈`:1236–1363` | constructs adapter/overlay/presence; **binding construction gated at `:1262`** (`useCanvasBinding`) |
| awareness pulse constants | `plugin/src/sync/sync.ts:57–69` | `AWARENESS_TICK_INTERVAL_MS = 4_000`, `AWARENESS_PULSE_DEADLINE_MS = 8_000`, `AWARENESS_GAP_WARN_MS = 20_000`, derived `AWARENESS_HEARTBEAT_INTERVAL_MS = 12_000` |
| awareness pulse methods | `plugin/src/sync/sync.ts:475` `pulseAwarenessHeartbeat`, `:487` `tickAwarenessKeepAlive`, `:503` `emitAwarenessPulse`, `:569` `reemitLocalAwareness` | |

### 8. Subscribe / ownership decision (W5, W9)

| Symbol | Location | Signature |
|---|---|---|
| `CanvasSync.subscribe` | `plugin/src/files/canvas-sync.ts:360–467` | `async subscribe(rawPath: string, role: "host" | "guest"): Promise<void>`. `isPathSafe` reject `:362`; **adds to `subscribedPaths` at `:365` BEFORE the first await**; `waitForSync` `:375`; re-check after await `:381`; observer install `:446–447`. |
| `CanvasSync.unsubscribe` | `plugin/src/files/canvas-sync.ts:468–495` | releases the doc at `:493` |
| `CanvasSync.isSubscribed` | `plugin/src/files/canvas-sync.ts:744–747` | |
| `CanvasSync.isRecentDiskWrite` | `plugin/src/files/canvas-sync.ts:740–743` | |
| `canvasOwned` | `plugin/src/files/vault-events.ts:53–63` | `(path, source: CanvasOwnershipSource) => boolean` — `.canvas && isSubscribed` |
| `subscribeCanvasWithHandover` | `plugin/src/files/vault-events.ts:101–117` | `async ({path, role, backgroundSync, canvasSync, logger}) => boolean`. `backgroundSync.unsubscribe` immediately precedes; on failure calls `warnCanvasTextFallback` `:113` then `backgroundSync.subscribe` — **the R10 raw-text fallback door**. |
| `CanvasHandoverOptions` | `plugin/src/files/vault-events.ts:31–52` | |
| `warnCanvasTextFallback` / reset | `plugin/src/files/vault-events.ts:67–79` / `:80–83` | once-per-path warn set at `:64` |
| `registerVaultEvents` | `plugin/src/files/vault-events.ts:118–272` | the fan-out; **the `modify` handler is `:224–271`** |
| the two production `subscribeCanvasWithHandover` call sites | `plugin/src/main.ts:834–842` (session start) and `:995–1003` (lazy on-open) | both call `attachCanvasWriter` when `owned` (`:841`, `:1002`). A source-level test pins "0 direct `canvasSync.subscribe(` + exactly 2 `subscribeCanvasWithHandover({`". |
| `LiveSharePlugin.syncCanvasPresences` | `plugin/src/main.ts:963–1039` | mount/teardown loop; lazy-subscribe branch `:976–1004`; teardown branch `:1021–1038` |
| `skipsAutoTextSync` (the exclusion predicate) | `plugin/src/utils.ts:258` | `export function skipsAutoTextSync(path: string): boolean` (= `path.endsWith(".canvas")`) |
| its four consumers | `background-sync.ts:72` (startAll / manifest replay), `:195` (onFileAdded), `:248` (onFileRenamed), `manifest.ts:174` (syncFromManifest) | deliberately **not** consulted by `BackgroundSync.subscribe` (`:88`) — the R10 door |
| `useCanvasBinding` flag | `plugin/src/types.ts:36` (decl), `:65` (default `false`) | gates `main.ts:814` (legacy reconcile bypass) and `main.ts:1262` (binding construction) |
| `showCanvasCursors` / `showCanvasPresence` | `plugin/src/types.ts:30–31`, defaults `:63–64` | |

### 9. Audit function (W3 ingest validation)

| Symbol | Location | Note |
|---|---|---|
| `CanvasSync.auditCanvasState` | `plugin/src/files/canvas-sync.ts:880–948` | private; **log-only, mutates nothing**. Collects `noGeo` (`:894`), `noType` (`:896`), `fileNodesWithoutFile` (`:898`), `danglingEdges` (`:899+`). Emits the `SCATTER` / `DETACH` / `NO TYPE` signatures. |
| `CanvasSync.scheduleCanvasAudit` | `plugin/src/files/canvas-sync.ts:814–855` | private; debounced trigger, calls the audit at `:836` |
| the single audit call site | `plugin/src/files/canvas-sync.ts:444` | inside the doc observer installed by `subscribe` |

### 10. E2E rig + harness entry points (W10 verification gap)

| Entry | Location | Note |
|---|---|---|
| launcher | `tools/launch_liveshare_e2e.py` (192 L) | `preflight()` `:73`, `build_bundle()` `:90`, `run_bundle(env_overrides)` `:117`, `main()` `:161`. Constants `:38–57`: `ENTRY_TS = plugin/src/__tests__/e2e/launch-entry.ts`, `OUT_BUNDLE`/`RUN_SHIM` under `server/node_modules/.cache/`, esbuild CLI from `plugin/node_modules`. Ports 39421/39422. **Never executed.** |
| bundle entry | `plugin/src/__tests__/e2e/launch-entry.ts` (98 L) | the TS entry the launcher bundles |
| control server | `plugin/src/testing/e2e-control.ts` (524 L) | `routeCommand` `:104`, `parseAndRoute` `:153`, `createControlServer` `:185`, `buildPluginHost` `:356`, `resolvePort` `:462`, `maybeStartE2EControlServer` `:481`. Interfaces: `CommandRequest` `:34`, `CommandResult` `:40`, `E2EEvent` `:45`, `BindingCounters` `:52`, `E2EControlHost` `:63`, `ControlServerHandle` `:170`, `E2EPluginLike` `:315`. `MAX_BODY_BYTES = 1_000_000` `:179`. Private `upsertRecord` `:338`. |
| build-time gate | `plugin/esbuild.config.mjs:26` | `define: { __LS_E2E__: prod ? "false" : "true" }` — production build tree-shakes the whole `src/testing/` module out of `main.js` |
| two-host harness | `plugin/src/__tests__/e2e/two-host-harness.ts` (257 L) + suite `e2e/two-host.test.ts` (112 L) | in the default vitest run |
| two-peer harness | `plugin/src/__tests__/harness/two-peer.ts` (545 L) + self-test `harness/two-peer.test.ts` (195 L) | |
| canvas double | `plugin/src/__tests__/harness/canvas-double.ts` (318 L) + self-test (178 L) | the in-memory Canvas view stand-in |
| interaction driver | `plugin/src/__tests__/harness/interaction-driver.ts` (145 L) | |
| latency harness | `plugin/src/__tests__/wp5/harness.ts` (208 L) | RTT injection for `wp5/latency.test.ts` |
| Obsidian mock | `plugin/src/__mocks__/obsidian.ts` | aliased in `vitest.config.ts`; also consumed by the launcher (`OBSIDIAN_MOCK`, `launch_liveshare_e2e.py:45`) |

---

## Entry Points

- `plugin/src/main.ts` — Obsidian `onload`; owns settings, session lifecycle, and **every** canvas wiring point. Has **no test file**; everything here is verified only by `tsc` + build.
- `plugin/src/files/vault-events.ts` — the single vault-event fan-out. Its `modify` handler (`:224–271`) is where a `.canvas` is routed to exactly one subsystem.
- `plugin/src/sync/sync.ts` — `SyncManager`: the one WebSocket, the doc registry, the awareness pulse. **`getDoc()` creates on demand** (`:200–252`) — that is why every automatic bare-path caller needs a guard.
- `server/src/index.ts` — relay HTTP + WS entry. Not in scope.
- `tools/launch_liveshare_e2e.py` — boots two plugin hosts against one local relay room. **Never run.**

---

## The `.canvas` ownership seam

One shared `.canvas` path has exactly one CRDT owner and exactly one disk writer.

```text
vault "modify" event
└── files/vault-events.ts:224
    ├── isTextFile? ────────────────────── no ──→ fileOpsManager.onFileModify
    ├── backgroundSync.isRecentDiskWrite ─ yes ─→ drop (echo)
    ├── canvasOwned(path, canvasSync)  (:53, = .canvas && isSubscribed)
    │   ├── TRUE  → canvasSync.handleLocalModify   (unless useCanvasBinding)
    │   │           and RETURN — text path unreachable, no `else`
    │   └── FALSE → warnCanvasTextFallback + backgroundSync.handleLocalTextModify
    └──                                             (the announced R10 raw-text fallback)

subscribe / handover
└── files/vault-events.ts:101  subscribeCanvasWithHandover({path, role, backgroundSync,
    │                                                       canvasSync, logger})
    ├── backgroundSync.unsubscribe(path)   ← immediately precedes, same sync block
    ├── canvasSync.subscribe(path, role)   ← adds to subscribedPaths BEFORE first await (:365)
    ├── owned  → main.ts attachCanvasWriter(path)
    └── FAILED → warnCanvasTextFallback + backgroundSync.subscribe(path)   ← R10 door
    Two production call sites only: main.ts:834 (session start) and main.ts:995 (lazy on-open).

`.canvas` exclusion predicate — ONE definition, FOUR consumers
└── utils.ts:258  skipsAutoTextSync(path)   (= path.endsWith(".canvas"))
    ├── files/background-sync.ts:72 ... startAll          (manifest replay)
    ├── files/background-sync.ts:195 .. onFileAdded       (vault create)
    ├── files/background-sync.ts:248 .. onFileRenamed     (rename INTO a .canvas)
    └── files/manifest.ts:174 ......... syncFromManifest  (join/resume/reconnect/reload)
    Deliberately NOT consulted by BackgroundSync.subscribe (:88) — the R10 fallback door.

CRDT → disk (exactly one writer per path)
└── files/canvas-persistence.ts   attachCanvasPersistence(doc, io, diskPath, opts)  (:470)
    ├── coldOpen() AFTER waitForSync, BEFORE start()   ← the non-negotiable ordering
    ├── ColdOpenResult = "seeded-from-file" | "doc-wins" | "empty"
    ├── writeQueue + lastQueuedContent (sync at flush) + muteDepth refcount
    ├── onWritten → CanvasSync.noteExternalDiskWrite (:856) keeps the diff baseline fresh
    └── lifetime = the SUBSCRIPTION, torn down in main.ts:1413 (teardownCanvasPresences)
                   (NOT on view close — deliberate, HANDOVER D4)
    CanvasSync.writeToDisk (:949) + the remoteSeq gate are RETAINED WITH NO CALLER.
```

---

## Core Modules

| Module | Responsibility | Tag |
|---|---|---|
| `plugin/src/files/canvas-sync.ts` (981 L) | Structured canvas CRDT: `parseCanvas`/`buildCanvasData`/`serializeCanvas`, three-way local diff vs `lastWrittenContent`, kind-aware lock gating (`canWriteEntity` :705), conditional baseline advance, dangling-edge prune, `PROTECTED_KEYS` on **both** delete paths, log-only `auditCanvasState`. **Touches W1, W2, W3, W4, W6, W7, W8, W9.** | RELEVANT |
| `plugin/src/files/canvas-persistence.ts` (480 L) | The one CRDT→disk `.canvas` writer. Headless (no Obsidian import): `PersistenceIO`, `PersistenceScheduler`, `PersistenceGuards` all injected. Emits zero CRDT writes. Owns `coldOpen` seeding. **Touches W4, W9.** | RELEVANT |
| `plugin/src/main.ts` (1688 L) | All canvas wiring: predicate injection `:792–806`; session-start subscribe `:834`; `syncCanvasPresences` `:963`; lazy on-open subscribe `:995`; `reconcileLiveCanvas` `:1046`; `canWriteCanvasPath` `:1176`; `attachCanvasWriter` `:1199`; `mountCanvasPresence` `:1236`; `revertCanvasNode` `:1364`; `teardownCanvasPresences` `:1382`. Holds the `canvasApplied` view shadow `:114`. **No test file. Touches W1, W5, W9.** | RELEVANT |
| `plugin/src/canvas/canvas-binding.ts` (317 L) | CRDT⇄model binding; `applyRemote` `:211`, `captureLocal` `:260`, `writeRecordMinimal` `:126` (no protected-key guard). **Only live when `useCanvasBinding = true`** (default false). **Touches W1, W2.** | RELEVANT |
| `plugin/src/canvas/canvas-model-bridge.ts` (331 L) | Adapter → binding glue; `createCanvasModelBridge` `:137`, `CAPTURE_TRIGGERS` `:88`, geometry helpers `:97–136`. Flag-gated with the binding. **Touches W1, W9.** | RELEVANT |
| `plugin/src/canvas/reconcile-plan.ts` (185 L) | Pure classifier — zero imports, no clock/DOM/Obsidian. `planReconcile` → `structural | geometry | noop`. **Touches W1, W7.** | RELEVANT |
| `plugin/src/files/vault-events.ts` (272 L) | Ownership predicate `canvasOwned`, handover helper `subscribeCanvasWithHandover`, once-per-path `warnCanvasTextFallback` + reset, and the full vault event fan-out. **Touches W5, W9.** | RELEVANT |
| `plugin/src/canvas/canvas-adapter.ts` (689 L) | Isolation layer over Obsidian's private Canvas API; `isBusy()` `:572` watchdog seam, `viewportScale()` `:133`, `canvasToScreenRel`, `clientToCanvasManual`, patch adoption, `DRAG_WATCHDOG_MS = 5000` `:260`. **Touches W1, W9.** | RELEVANT |
| `plugin/src/canvas/canvas-presence.ts` (592 L) | Awareness cursors, per-node advisory locks, tiebreak, reconnect re-claim, held-ring DOM, `onRevert` hook `:387`. **Touches W5, W6.** | RELEVANT |
| `plugin/src/sync/sync.ts` (721 L) | Doc registry (`getDoc` **creates on demand** `:200`), `releaseDoc` `:253`, `waitForSync` `:281`, mux transport, MUX ping/pong, deadline-driven awareness keep-alive. **Touches W4, W5.** | RELEVANT |
| `plugin/src/files/background-sync.ts` (454 L) | Generic `Y.Text` sync. Three `.canvas` guards (`:72`, `:195`, `:248`); `subscribe()` `:88` is the sole deliberate R10 door. **Touches W5.** | RELEVANT |
| `plugin/src/utils.ts` (317 L) | Path canonicalisation, `isTextFile`, and the shared `skipsAutoTextSync` `:258` with the four-consumer rationale on it | RELEVANT |
| `plugin/src/types.ts` (367 L) | `LiveShareSettings` + `DEFAULT_SETTINGS`: `showCanvasCursors: true` `:63`, `showCanvasPresence: true` `:64`, `useCanvasBinding: false` `:65` | RELEVANT |
| `plugin/src/testing/e2e-control.ts` (524 L) | Flag-gated localhost http+SSE control server for live probes; carries its own `upsertRecord` mirror of `writeRecordMinimal` `:338`. **Touches W10.** | RELEVANT |
| `plugin/src/files/manifest.ts` (347 L) | Manifest doc + `syncFromManifest`; the 4th `.canvas` guard at `:174`, unconditional; its `getDoc(path)` at `:201` sits *after* that guard | ADJACENT |
| `plugin/src/canvas/canvas-overlay.ts` (92 L) | Dumb overlay renderer (cursors + held boxes); no logic | ADJACENT |
| `plugin/src/files/file-ops.ts` (528 L) | Vault file ops + the `mutePathEvents` / `isPathMuted` registry `CanvasPersistence` refcounts against | ADJACENT |
| `plugin/src/editor/collab.ts` (135 L) | CM6/yCollab markdown binding. `activateForFile` `:30` holds an **unguarded** `getDoc` `:62` | ADJACENT |
| `plugin/src/debug-logger.ts` (167 L) | Ring buffer + optional file sink; required to observe any of the ten log signatures | ADJACENT |
| `plugin/src/ui/settings.ts` (395 L) | Settings UI incl. the canvas toggles | ADJACENT |
| `server/src/*` (10 files + 10 test files) | Relay: rooms, permissions, persistence, audit, mux, control, github-auth. **Off limits** — note existence only | SKIP |
| `plugin/src/session/*`, `ui/*` (except settings), `sync/{crypto,offline-queue,connection-state,control-ws,control-handlers,mux-protocol}.ts`, `editor/conflict-decoration.ts`, `files/exclusion.ts` | Session mgmt, modals, transport plumbing, decorations | SKIP |
| `docker-compose.yml`, `Dockerfile`, `flake.nix`, `docs/`, `data/` | Deployment + prose + runtime LevelDB | SKIP |

---

## Known unguarded `getDoc` call sites

`SyncManager.getDoc(path)` **creates** a `Y.Doc` + `Y.Text("content")` if none exists (`sync/sync.ts:200–252`). Two production callers pass a bare path with no `.canvas` guard:

```text
├── files/background-sync.ts:173  ← inside setActiveFile (method at :167)
│   this.syncManager.getDoc(oldActive)  on the PREVIOUSLY active path, to flush it
│   to disk on focus change. Argued safe because `oldActive` was already subscribed —
│   an argument from reachability, not a guard. Nothing in the method inspects the
│   extension.
└── editor/collab.ts:62           ← inside CollabManager.activateForFile (method at :30)
    syncManager.getDoc(filePath) for the CM6/yCollab editor binding. Proven by
    execution (probe K5, w4-canvas-integrity.test.ts) there is NO internal .canvas
    guard. Unreachable for a canvas today ONLY because main.ts gates on
    getActiveViewOfType(MarkdownView) — and main.ts has no test file. Residual risk.
```

Sibling `getDoc` sites that are **not** in this class: `background-sync.ts:97` (`subscribe`, the deliberate R10 door), `:250` (`onFileRenamed`, behind the `:248` guard), `:297` (`handleLocalTextModify`) and `:370` (`flushWrite`) all run on already-subscribed paths; `manifest.ts:62` is the fixed `"__manifest__"` doc and `:201` sits behind the `:174` guard; `canvas-sync.ts:334/348/368/505` use the `__canvas__:` doc-id prefix, a different namespace.

---

## Log signatures (US6) — production emitters

```text
├── SCATTER signature: ....... files/canvas-sync.ts   (auditCanvasState :880)
├── DETACH signature: ........ files/canvas-sync.ts   (auditCanvasState :880)
├── NO TYPE signature: ....... files/canvas-sync.ts   (auditCanvasState :880)
├── LOCK DENIED: ............. files/canvas-sync.ts:576
├── LOCK REVERT: ............. main.ts:1375  (revertCanvasNode)
├── AWARENESS GAP: ........... sync/sync.ts        (logger attached at main.ts:341)
├── DRAG WATCHDOG: ........... canvas/canvas-adapter.ts  (logger bridged at main.ts:1240)
├── ADAPTER PATCH: ........... canvas/canvas-adapter.ts  (same bridge)
├── CANVAS TEXT FALLBACK: .... files/vault-events.ts  (once per path per session)
└── CANVAS WRITER: ........... files/canvas-persistence.ts:250 + main.ts:1227
```

Both logger attachments (`main.ts:341`, `main.ts:1240`) are edits in the file with **no test file** — if either is wrong, three of the ten signatures are silently suppressed. `CanvasAdapterLogger` declares `log(...)` while `DebugLogger`/`CanvasSyncLogger`/`SyncLogger` expose `debug(...)`; the two are bridged at the call site, not unified.

---

## External Dependencies

- `yjs` ^13.6.0 — CRDT core (`Y.Doc`, `Y.Map`, `Y.Text`, transactions/origins).
- `y-protocols` ^1.0.6 (`/awareness`) — canvas cursors **and** per-node locks. `AWARENESS_OUTDATED_TIMEOUT_MS = 30_000`; the plugin's pulse exists to stay under it.
- `y-codemirror.next` ^0.3.5 — the markdown editor binding (`editor/collab.ts`).
- `lib0` ^0.2.97 — Yjs encoding primitives.
- `minimatch` ^10.2.0 — read-only / exclude path globs.
- Obsidian API (`obsidian: latest`, dev dep) — public part typed; the **Canvas view is private and untyped** (adapter-only access).
- Server: `express` ^4.21, `cors`, `ws` ^8.18, `level` ^8.0.1, `nanoid` ^5, `jsonwebtoken` ^9.0.3, `express-rate-limit` ^8.2.1, `minimatch`, `lib0`.
- Dev: `esbuild` ^0.24, `vitest` ^4.0.18, `@biomejs/biome` ^1.9, `typescript` ^5.5, `eslint` ^9.39 + `eslint-plugin-obsidianmd`, `@types/node` ^22.

---

## Key Config / Env Variables

- `useCanvasBinding` (setting, default **false**, `types.ts:36/65`) — rollout blocker; gates the legacy-reconcile bypass at `main.ts:814` and the binding/bridge construction at `main.ts:1262`.
- `showCanvasCursors` / `showCanvasPresence` (default true, `types.ts:30-31/63-64`) — gate overlay and held ring.
- `debugLogging` / `debugLogPath` — file sink; required to read any of the ten signatures.
- `GEOMETRY_KEYS = {x,y,width,height}` (`canvas-sync.ts:29`) — membership and export unchanged (US3 AC10 asserts it).
- `PROTECTED_KEYS = GEOMETRY_KEYS ∪ {type, fromNode, toNode, fromSide, toSide}` (`canvas-sync.ts:53`) — strict superset, consulted by the delete guards on **both** paths (`applyToYMap`, `applyKeyDiff`). **Not** consulted by `canvas-binding.ts:writeRecordMinimal`.
- `RECONCILE_GEOMETRY_KEYS` (`reconcile-plan.ts:56`) — deliberate module-private mirror to keep the module import-free; drift guarded by a test in `canvas-sync.test.ts`. `canvas-model-bridge.ts:94` keeps a third copy for the same reason.
- `CANVAS_DOC_PREFIX = "__canvas__:"` (`canvas-sync.ts:16`) — **module-private, not exported**; five construction sites.
- `DEBOUNCE_MS = 200`, `MAX_WAIT_MS = 500` (`canvas-sync.ts:20-21`) — imported by `canvas-persistence.ts`, never re-declared.
- `DISK_WRITE_SETTLE_MS = 250` (`canvas-persistence.ts:39`) — inlined mirror of `VAULT_EVENT_SETTLE_MS` to keep the module headless.
- `CANVAS_SEED_ORIGIN` (`canvas-persistence.ts:76`) and `CANVAS_BINDING_ORIGIN` (`canvas-binding.ts:68`) — the two `unique symbol` transaction origins.
- `AWARENESS_TICK_INTERVAL_MS = 4_000`, `AWARENESS_PULSE_DEADLINE_MS = 8_000`, `AWARENESS_GAP_WARN_MS = 20_000`, derived `AWARENESS_HEARTBEAT_INTERVAL_MS = 12_000` (`sync.ts:57-69`).
- `HEARTBEAT_INTERVAL_MS = 15_000`, `PONG_TIMEOUT_MS = 10_000` (`sync.ts:31-32`).
- `DRAG_WATCHDOG_MS = 5000` (`canvas-adapter.ts:260`); `RECONNECT_RECLAIM_DEFER_MS = 250` (`canvas-presence.ts:24`).
- `MAX_BODY_BYTES = 1_000_000` (`e2e-control.ts:179`).
- `__LS_E2E__` esbuild define (`esbuild.config.mjs:26`) — `false` in prod, so `src/testing/` is tree-shaken out of `main.js`; `LIVESHARE_E2E` / `e2eControlPort` drive the control server at runtime.
- E2E ports 39421 / 39422 (`tools/launch_liveshare_e2e.py`).
- `docker/.env` — **does not exist at this repo root**; the deploy stack is `docker-compose.yml` + `Dockerfile`. Not read, not in scope. (`server/.env.example` exists for the relay.)

---

## Notes

- **Graph artifacts absent by configuration.** No `graphify-out/` anywhere; Graphify is disabled for this project (`graphify_enabled=false`). This map plus `ARCHITECTURE.md` is the entire structural memory. `kc_enabled=false`, so no knowledge-capture events were logged for this run.
- **HEAD has not moved since the previous map.** `4b34d5e` is dated 2026-07-20, i.e. *older* than the 2026-07-26 map. Every production `.ts` file is byte-identical to that snapshot. Do not expect code drift — expect only the new `CONCEPT_V2.md` and the corrections listed here.
- **Counts corrected by execution, not by report.** Plugin: **674** tests across **35** files (previous map said 672), 41.38 s, 0 failed. Server: **122** tests across **10** files, 19.70 s, 0 failed. Both runs performed 2026-07-31 with `npx vitest run`.
- **`ARCHITECTURE.md` is 82 KB**, not the 37 KB the previous map recorded. Still untracked.
- **Vitest 4 removed the `basic` reporter.** `--reporter=basic` dies with `ERR_LOAD_URL`. Use the default or `--reporter=dot`. This cost one wasted run during this refresh.
- **`wp5/latency.test.ts` sleeps 33.5 s by design.** Any automated invocation needs ≥90 s of headroom; a 41 s wall time is the floor, not a hang.
- **VERSION DISCREPANCY — verify before any release step.** The tree carries **0.6.1** in root `manifest.json` and `plugin/package.json`, with `versions.json` listing both `0.6.0` and `0.6.1`. `workflowArtifacts/canvas-integrity/HANDOVER.md` asserts "version 0.6.0 unchanged" in three separate abort-criteria blocks. The bump is uncommitted and predates the last round's edits, but the handover's claim is not true of the tree as it stands.
- **SYMLINK.** Root `manifest.json` is the real 244-byte file; **`plugin/manifest.json` is a 55-byte symlink pointing at `/home/mewski/Projects/obsidian-live-share/manifest.json`**, a POSIX absolute path that does not resolve on Windows. Do not read or edit it.
- **`plugin/main.js` (626 KB) and `server/dist/` are committed build output.** Never hand-edit; regenerate with `npm run build`.
- **Uncommitted tree.** 22 modified + 13 untracked paths on top of `4b34d5e`, spanning two rounds. Untracked production files: `canvas/reconcile-plan.ts`, `canvas/canvas-model-bridge.ts`, `files/canvas-persistence.ts`, plus `ARCHITECTURE.md`, `workflowArtifacts/CONCEPT_V2.md`, `workflowArtifacts/canvas-integrity/`, and six test files (`canvas-binding-apply`, `canvas-binding-capture`, `canvas-persistence`, `canvas-single-writer`, `reconcile-plan`, `w4-canvas-integrity`). Nothing has been deployed and nothing installed into any vault.
- **`main.ts` has no test file** and five agents have written wiring into it. The two logger attachments (`:341`, `:1240`), the `attachCanvasWriter` seam and the two `subscribeCanvasWithHandover` call sites are verified only by `tsc` + build + one source-level string assertion.
- **Three independent copies of the geometry-key set** exist by design (`canvas-sync.ts:29`, `reconcile-plan.ts:56`, `canvas-model-bridge.ts:94`), each to keep a module import-free. Only the first two are drift-guarded by a test.
- **`writeRecordMinimal` (`canvas-binding.ts:126`) has no `PROTECTED_KEYS` guard**, unlike the two `canvas-sync.ts` delete paths. It is only reachable when `useCanvasBinding = true`. Recorded as a structural asymmetry, not as a judgement.
- **`auditCanvasState` is log-only.** It detects missing geometry, missing `type`, `file` nodes without a `file`, and dangling edges — and mutates nothing. It runs from exactly one call site (`canvas-sync.ts:444`, inside the doc observer), debounced through `scheduleCanvasAudit`.
- **Dead-ish code left standing:** `CanvasSync.writeToDisk` (`:949`) and its `remoteSeq` gate are retained with no caller (permitted by AC9, keeps a WP4 test green). Also unresolved by design: R9 destructive host re-seed in `applyCanvasToYMaps` (`:776`), P2-1 lock epoch, P2-2 orphaned `Y.Text` release after a fallback→owned handover.
- **`biome` reports a whole-file `format` finding per touched file.** Known CRLF environment artifact (diff starts at line 1 with `␍` on untouched imports), not a code regression. Biome is advisory locally — but **CI runs `npm run lint` as a gating step** for both packages.
- **Nothing has been verified behaviourally.** No two-vault E2E run, no real-vault spike, no install — through the main round and both rework cycles. The rig exists (`tools/launch_liveshare_e2e.py`, `plugin/src/testing/e2e-control.ts`, `workflowArtifacts/e2e-infra/E2E_USAGE.md`) and has never been executed. This is exactly the gap `CONCEPT_V2.md` labels **W10**.
