# BUILD_SPEC — CanvasBinding (Canvas Sync Redesign, Phase 0)

> Authoritative architecture document for **Phase 0 only** of the canvas-sync CRDT
> redesign. Encodes SPEC_01 (CanvasBinding) faithfully; gates on SPEC_04 §1.
> User stories & their ACs live in `USER_STORIES.md` (this folder) — referenced, not repeated.
> Prior-round artifacts in `workflowArtifacts/` root are NOT touched by this run.

---

## 1. Project Overview

- **Project name:** CanvasBinding (obsidian-live-share canvas-sync redesign, Phase 0 — "y-canvas" binding).
- **Target vision:** A headless CRDT⇄model binding that makes a per-canvas `Y.Doc` the single source of truth and the live canvas model a pure projection, so collaborative canvas editing converges on all peers with no echo, no oscillation, and no scatter.
- **Primary user group / consumers:** obsidian-live-share plugin developers (this run), and — in later phases — the plugin's canvas collaboration feature end-users. Phase 0 consumers are the test suite and future phases (SPEC_02/03).
- **Non-goals (Phase 0):** No `main.ts` wiring; no `CanvasAdapter`/Obsidian integration; no persistence/`.canvas` I/O (SPEC_03); no `useCanvasBinding` setting; nothing shipped; Phases 1–5 explicitly deferred and human-gated. No changes to `SyncManager`, awareness, relay, or `yCollab`.
- **UI language / locale:** N/A (headless library + tests; source and identifiers in English).

---

## 2. Scope and Deliverables

- **User stories:** see `USER_STORIES.md` — US1 (binding contract), US2 (fake bridge + harness), US3 (T1–T10 test contract).
- **Must-have requirements (P0):**
  - `CanvasBinding` class + exported types/`CANVAS_BINDING_ORIGIN` per SPEC_01 §4, honoring invariants I1–I6 and algorithms §6.1–6.4.
  - Fake in-memory `CanvasModelBridge` that re-emits `onLocalChange` on every mutation.
  - Two-peer headless harness mirroring `canvas-sync.test.ts::applyRemoteCanvasDelta`.
  - Tests T1–T10 green; full vitest suite stays green (≥ 440 tests, none removed).
- **Should-have (P1):** Optional `CanvasBindingLogger` hook (`debug(category, message)`) surface; update-count instrumentation reusable across tests.
- **Nice-to-have (P2):** Doc-comments cross-referencing SPEC_01 invariant IDs on each guard for future maintainers.
- **Explicitly out of scope:** SPEC_02 real bridge, SPEC_03 persistence, SPEC_04 Phases 1–5, any `main.ts`/adapter/setting change, GUI/E2E automation, dependency additions.

---

## 3. System Architecture

- **Graph basis:** Graphify disabled for this run (`graphify_enabled: false`). Structural grounding = W1 `../RepoMap.md` (RepoMap fallback, built 2026-07-20, line numbers vs HEAD). No `graph.json`/`GRAPH_REPORT.md`.
- **Frontend stack:** N/A (headless).
- **Backend stack / language:** TypeScript, compiled via `tsc`/esbuild. Runtime: Node (test env). Only runtime dependency used: `yjs ^13.6.0` (`plugin/package.json` L19), namespace import `import * as Y from "yjs"`.
- **Data storage:** In-memory CRDT only (`Y.Doc`). No DB, no ORM, no file I/O (I6). `.canvas` files are NOT a sync channel in this design.
- **External integrations:** None in Phase 0. The binding is designed so its `CanvasModelBridge` interface can LATER be satisfied by a `CanvasAdapter`-backed real bridge (SPEC_02) — see RepoMap §5 — but no such integration is built here.
- **Runtime environment:** Local dev + CI (vitest, Node env; `plugin/vitest.config.ts` aliases `obsidian` → `src/__mocks__/obsidian.ts`, though the binding and its test import no Obsidian).
- **Key subsystems:** (1) `CanvasBinding` (observer demux + apply + capture + lifecycle); (2) fake `CanvasModelBridge`; (3) two-peer Yjs harness. Detail in §5 and §9.
- **Key architecture decisions (with rationale):**
  1. **Reentrancy over timing.** Echo is killed by the `applyingRemote` boolean (I2, sync echo) + minimal-diff no-op capture (I3, async echo), NOT by mute windows / timing constants — the legacy file bridge's fingerprint. Rationale: timing windows are inherently racy; a synchronous guard + empty-diff drop are deterministic and provable (SPEC_01 §5, §7).
  2. **Origin isolation via a dedicated symbol.** All binding writes are stamped `CANVAS_BINDING_ORIGIN`; the observer ignores `tr.local` and that origin (I4). Rationale: distinguishes self-authored transactions from genuine remote deltas without inspecting content.
  3. **Wire-compatible doc shape.** Reuse the exact legacy `nodes`/`edges` `Y.Map<Y.Map<unknown>>` map-of-maps layout (RepoMap §1). Rationale: a binding client interoperates on the wire with a legacy file-bridge client during migration (SPEC_01 §3).
  4. **Local, self-contained equality + minimal-diff (decision — see §5 note).** Phase 0 **re-implements** a minimal `recordsEqual`/`writeRecordMinimal` locally in `canvas-binding.ts` rather than importing the `canvas-sync.ts` helpers, because those module-level helpers (`buildCanvasData` L67, `canvasRecordsEqual` L118, `applyToYMap` L137, `applyKeyDiff` L172, `ymapToRecords` L106) are **not exported today** (RepoMap §3 note). The local implementations MUST match the semantics of `canvasRecordsEqual` (order-independent shallow primitive equality) and `applyKeyDiff` (push only changed keys; delete keys absent from `next`). Rationale: keeps the binding headless and self-contained without editing the production `canvas-sync.ts` export surface in a Phase-0 run; the semantic-match requirement guarantees migration compatibility.
  5. **Targeted reconcile, not wholesale.** `applyRemote` touches only entities that differ (SPEC_01 §6.1). Rationale: a well-behaved model performs no redundant `moveAndResize`/re-render, and it is what enables the T6 "zero re-push" convergence.

---

## 4. Data Architecture

- **Primary data sources:** The per-canvas `Y.Doc` (authoritative) and the live model (projection). In Phase 0 the model is the fake bridge; the doc is driven by the two-peer harness.
- **Core data models / schemas:**
  - `doc.getMap("nodes")` : `Y.Map<Y.Map<unknown>>` — key = node id → node record.
  - `doc.getMap("edges")` : `Y.Map<Y.Map<unknown>>` — key = edge id → edge record.
  - A **record** = flat `Record<string, unknown>` of primitive values. Nodes: `id, type, x, y, width, height, text, file, color, …`; edges: `id, fromNode, toNode, fromSide, toSide, color, label, …` (RepoMap §1; `GEOMETRY_KEYS = {x,y,width,height}` noted at canvas-sync.ts L29 for context). All values primitive ⇒ shallow per-key equality is exact.
  - `LocalChange = { kind:"node"|"edge"; id:string; record: CanvasRecord | null }` (`null` ⇒ removed).
- **Normalisation rules:** Records stored key-by-key in a `Y.Map<unknown>` (map-of-maps), matching legacy `applyToYMap`/`applyKeyDiff` layout so the wire shape is identical.
- **Consistency and integrity rules:** I1 (doc authoritative; model reconciles to doc). Minimal-diff writes (I3): set a key iff its value differs; delete keys present in the ymap but absent from `next`. Convergence guaranteed by Yjs Map LWW-per-key semantics (SPEC_01 §7).
- **Data flow:** local edit → `onLocalChange(LocalChange)` → `captureLocal` (guards: `applyingRemote`? `canWrite`/`canWriteNode`?) → minimal-diff write under `CANVAS_BINDING_ORIGIN` → Yjs update → (peer) observer sees non-local, non-origin tx → `applyRemote` → targeted model mutators. No path feeds a model mutator back into a capture (I2 + I5).

---

## 5. Component Map

> Decision (see §3 dec. 4): equality + minimal-diff are re-implemented locally in
> `canvas-binding.ts`; semantics MUST match `canvasRecordsEqual`/`applyKeyDiff`.
> The `canvas-sync.ts` helpers are cited as the semantic reference, NOT imported.

### canvas-binding.ts (source)
- **Change type:** create
- **Path:** `plugin/src/canvas/canvas-binding.ts` (RepoMap §7 — beside `canvas-adapter.ts`, headless, no Obsidian import).
- **Responsibility:** Bind a `Y.Doc` to a `CanvasModelBridge`: observer demux, `applyRemote` (CRDT→model), `captureLocal` (model→CRDT, minimal diff), lifecycle (seed/destroy), invariants I1–I6.
- **Interfaces:**
  - Input: `constructor(doc: Y.Doc, model: CanvasModelBridge, opts?: { logger?: CanvasBindingLogger; seedModelFromDoc?: boolean; canWrite?: (path:string)=>boolean; canWriteNode?: (path:string,id:string)=>boolean; path?: string })`; `onLocalChange` events from the bridge.
  - Output: Yjs transactions stamped `CANVAS_BINDING_ORIGIN`; model mutator calls; readonly `applyingRemote`; `destroy()`.
  - Exports: `CanvasRecord`, `LocalChange`, `CanvasModelBridge`, `CANVAS_BINDING_ORIGIN`, `CanvasBinding`, (optional) `CanvasBindingLogger`.
- **User stories:** US1
- **Assigned to WP:** WP1

### canvas-binding.test.ts (fake bridge + harness + tests)
- **Change type:** create
- **Path:** `plugin/src/__tests__/canvas-binding.test.ts` (RepoMap §7 — matches `src/__tests__/*.test.ts`).
- **Responsibility:** Inline fake `CanvasModelBridge` (adversarial re-emit), two-peer harness (mirrors `applyRemoteCanvasDelta` L62-74 + `remoteNode` L76), update-count instrumentation, and tests T1–T10.
- **Interfaces:**
  - Input: imports `CanvasBinding` & types from `../canvas/canvas-binding`, `import * as Y from "yjs"`, vitest (`describe/it/expect/vi`).
  - Output: passing vitest cases T1–T10.
- **User stories:** US2, US3
- **Assigned to WP:** WP2 (fake+harness), WP3 (tests)

---

## 6. API and Interfaces

- **Tool/module surface (exported from `canvas-binding.ts`):**
  ```ts
  export type CanvasRecord = Record<string, unknown>;
  export type LocalChange =
    | { kind: "node"; id: string; record: CanvasRecord | null }
    | { kind: "edge"; id: string; record: CanvasRecord | null };
  export interface CanvasModelBridge {
    getNodeIds(): Iterable<string>;
    getEdgeIds(): Iterable<string>;
    getNode(id: string): CanvasRecord | null;
    getEdge(id: string): CanvasRecord | null;
    applyNodeUpsert(id: string, record: CanvasRecord): void;
    applyNodeRemove(id: string): void;
    applyEdgeUpsert(id: string, record: CanvasRecord): void;
    applyEdgeRemove(id: string): void;
    onLocalChange(cb: (change: LocalChange) => void): () => void;
  }
  export const CANVAS_BINDING_ORIGIN: unique symbol;
  export class CanvasBinding {
    readonly applyingRemote: boolean;
    constructor(doc: Y.Doc, model: CanvasModelBridge, opts?: CanvasBindingOpts);
    destroy(): void;
  }
  ```
- **Request/response structure:** Method calls only (no network). `captureLocal` is driven internally by the bridge's `onLocalChange`; `applyRemote` is driven internally by the map observer. Both may also be invoked directly by tests.
- **Authentication / authorization:** N/A. Write-authorization seams: injected `canWrite(path)` (Bug G read-only guard) and `canWriteNode(path,id)`/`canDeleteNode(path,id)` (WP3 advisory-lock gate) checked in `captureLocal` before writing/deleting (SPEC_01 §8). Absent predicates ⇒ allow.
- **Error cases and expected responses:**
  - `applyingRemote` true during `captureLocal` ⇒ no-op (no throw).
  - `canWrite`/`canWriteNode` false ⇒ capture dropped (no transaction).
  - Empty minimal diff ⇒ no Yjs update produced.
  - `destroy()` then late callback ⇒ inert (destroyed guard).
  - Throw inside `applyRemote` ⇒ `applyingRemote` reset in `finally`.
- **Persistence behaviour:** None (I6). No `.canvas` read/write; persistence is strictly downstream in SPEC_03 (out of scope).

---

## 7. Quality Gates

- **Lint / typecheck / test commands (exact, from RepoMap §6 — W3 must run all three):**
  - Tests: `npx vitest run` — must stay green; new `canvas-binding.test.ts` added; total ≥ 440 (currently 23 files / 440 tests), zero failures.
  - Typecheck: `npx tsc -noEmit -skipLibCheck` — **no standalone `typecheck` npm script exists**; run this command directly (the `build` script wraps it: `tsc -noEmit -skipLibCheck && node esbuild.config.mjs production`).
  - Lint: `npx biome check .` (format-check variant: `biome check --write .`).
- **Execution order:** typecheck → lint → tests (fix compile/lint before running the suite). Run from `plugin/`.
- **Abort criteria:** any `tsc` error, any `biome` error, any vitest failure, or a total test count below 440 (would signal a silently dropped/renamed existing test) aborts the WP.
- **Definition of Done (project-level, Phase 0):** T1–T10 green + full suite green (≥ 440) + typecheck clean + lint clean + no production file (`main.ts`, adapters, `canvas-sync.ts`) modified. This satisfies SPEC_04 §1 gate; **no user E2E test** (nothing shipped).
- **Test framework and runner:** vitest (`plugin/vitest.config.ts`, Node env, glob `**/*.test.ts`; `obsidian` aliased to a mock — unused here).
- **Active W4 test levels (read from `workflow.config.json`):**
  - Smoke tests: **enabled** (`w4_smoke: true`).
  - Integration tests: **enabled** (`w4_integration: true`).
  - Full E2E: **enabled** (`w4_e2e_full: true`).
  - Fix-as-failing-test (TDD rework): **enabled** (`w4_fix_as_failing_test: true`) — every CRITICAL/HIGH W4 fix request ships a confirmed-red failing test.
  - Note: Phase 0 is headless; the "E2E" level here means the full two-peer harness convergence tests (T6/T7/T9), not GUI E2E, which is explicitly a human-gated later phase.

---

## 8. Validation and Test Strategy

- **Test levels active:** see §7 — smoke + integration + full (all enabled), realized headlessly via the two-peer harness. Fix-as-failing-test on for rework.
- **Test data sources:** deterministic in-test fixtures only — plain node/edge record literals built into `Y.Map`s via a `remoteNode`-style helper (RepoMap §2 L76). No ad-hoc/LLM-generated data. Timers via `vi.useFakeTimers()` for T5 (no wall-clock waits).
- **Known flaky areas / patterns to avoid:**
  - Do NOT introduce real `setTimeout` waits or timing constants — use fake timers (T5) and synchronous update counters. The whole design's point is timing-independence.
  - Ensure the harness's `remote` doc is synced from the source BEFORE mutating, so deletes reference the same item and actually remove on the target (RepoMap §2) — otherwise T9 delete/no-resurrect gives false results.
  - Count only `CANVAS_BINDING_ORIGIN`-stamped updates when asserting "zero local pushes" (T4/T5/T6/T10); remote-integration updates (`tr.local === false`) are expected and must not be counted as echoes.
  - Reset/scoped `doc.on("update", …)` counters per case to avoid cross-test bleed.

---

## 9. Work Package Breakdown

### WP1 — CanvasBinding core (types + class + invariants + algorithms)
- **Status:** planned
- **Depends on:** none
- **Scope:**
  - Create `plugin/src/canvas/canvas-binding.ts`.
  - Export `CanvasRecord`, `LocalChange`, `CanvasModelBridge` (9 members, SPEC_01 §4), `CANVAS_BINDING_ORIGIN` (`unique symbol`), `CanvasBinding` class, optional `CanvasBindingLogger`.
  - Implement `applyRemote()` (§6.1), `captureLocal(change)` (§6.2), the map observer demux (§6.3), lifecycle construct/seed/`destroy()` (§6.4).
  - Implement local `recordsEqual(a,b)` (order-independent shallow primitive equality — match `canvasRecordsEqual` semantics) and `writeRecordMinimal(ymap, next): boolean` (set changed keys, delete keys absent from `next`; return whether anything changed — match `applyKeyDiff` semantics).
  - Wire injected `canWrite`/`canWriteNode` predicates into `captureLocal` (§8 seams).
- **Out of scope:** any test code; any Obsidian import; importing/exporting `canvas-sync.ts` helpers; `main.ts`/adapter/persistence changes; busy/`isBusy` real wiring beyond an optional bridge-provided busy hook.
- **User stories covered:** US1
- **Acceptance Criteria:**
  1. Module exports the exact surface in §6 and typechecks under `npx tsc -noEmit -skipLibCheck` (US1 AC1).
  2. Reads/writes only `nodes`/`edges` map-of-maps; no other top-level keys (US1 AC2; SPEC_01 §3).
  3. I2: `applyingRemote` true only for the synchronous span of `applyRemote`, reset in `finally`; `captureLocal` no-ops while true (US1 AC4).
  4. I3: `writeRecordMinimal` writes only diffs and produces no update on an identical record (US1 AC5).
  5. I4: all writes stamped `CANVAS_BINDING_ORIGIN`; observer returns early on `tr.local || tr.origin === CANVAS_BINDING_ORIGIN`, else calls `applyRemote` (US1 AC6).
  6. §6.1 targeted reconcile: nodes upserted before edges; only differing/absent entities touched; model-only ids removed (US1 AC7).
  7. §6.2 capture: origin-stamped single transaction; `record === null` deletes when present; else get-or-create ymap + `writeRecordMinimal` (US1 AC9).
  8. Lifecycle: observer + `onLocalChange` wired on construct; one `applyRemote` when `seedModelFromDoc !== false`; `destroy()` unobserves/unsubscribes and sets a `destroyed` guard (US1 AC11).
  9. `canWrite`/`canWriteNode` consulted in `captureLocal`; false ⇒ drop with no transaction; absent ⇒ allow (US1 AC12).
  10. I6: imports only `yjs`; no Obsidian import, no `.canvas` I/O, no new dependency (US1 AC10).
- **Definition of Done:** File compiles and lints clean; every AC above is structurally present and later demonstrated green by WP3's T1–T10. No production file modified.
- **Key files:**
  - Create: `plugin/src/canvas/canvas-binding.ts`.
  - Semantic reference (read only, do NOT import/modify): `plugin/src/files/canvas-sync.ts` — `canvasRecordsEqual` L118-135, `applyKeyDiff` L172-193, `applyToYMap` L137-155, `buildCanvasData` L67-99, `ymapToRecords` L106-114, `GEOMETRY_KEYS` L29.
  - Type reference: `plugin/src/sync/sync.ts` `DocHandle` L41-45 (`{ doc: Y.Doc; text: Y.Text; awareness }`).
- **Architecture notes:**
  - Invariants I1–I6 (SPEC_01 §5) are the acceptance backbone — annotate each guard with its invariant ID.
  - `CANVAS_BINDING_ORIGIN` origin isolation (I4): a module-level `unique symbol`; every write goes through `doc.transact(fn, CANVAS_BINDING_ORIGIN)`.
  - `applyingRemote` reentrancy (I2): plain boolean, set true at `applyRemote` entry, reset in `finally`.
  - `writeRecordMinimal` minimal-diff (I3): the async-echo killer; returns changed-flag for logging/no-op detection.
  - Observer demux (§6.3): ignore `tr.local === true` AND `tr.origin === CANVAS_BINDING_ORIGIN`.
  - Lifecycle seed/destroy (§6.4): seed = one `applyRemote` on construct (redesign's clean replacement for v0.5.9 forced `setData`).
  - §8 seams: `canWrite`/`canWriteNode` injected predicates (exercised by T8); logger optional (`debug(category,message)`).
  - Decision (§3 dec.4): local `recordsEqual`/`writeRecordMinimal`, NOT imports of the unexported `canvas-sync.ts` helpers; semantics MUST match `canvasRecordsEqual`/`applyKeyDiff`.
  - yjs `^13.6.0`, `import * as Y from "yjs"`; use `Y.Doc`, `Y.Map`, `Y.encodeStateAsUpdate`, `Y.applyUpdate`, `doc.transact`.
- **Handover summary:** *(filled by W3 on completion)*

---

### WP2 — Fake bridge + two-peer harness
- **Status:** planned
- **Depends on:** WP1 (imports the exported types)
- **Scope:**
  - Create `plugin/src/__tests__/canvas-binding.test.ts` (test scaffolding portion).
  - Implement an inline fake `CanvasModelBridge`: in-memory `Map`s of node/edge records; all 9 members; `onLocalChange(cb)` with unsubscribe.
  - Adversarial re-emit: every state-changing mutator (`applyNode*`/`applyEdge*` AND test-local mutation helpers) fires the registered `onLocalChange` with the corresponding `LocalChange` (models the "can't-tell-who-moved-it" hazard).
  - Two-peer harness mirroring `canvas-sync.test.ts::applyRemoteCanvasDelta` (L62-74): create fresh `Y.Doc`, sync from source via `Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc))`, mutate replica, integrate back via `Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote))`, destroy replica; plus a `remoteNode(fields)`-style `Y.Map` builder (L76).
  - Update-count instrumentation: scoped `doc.on("update", (u, origin) => …)` counter that can filter to `CANVAS_BINDING_ORIGIN` for "local pushes only".
- **Out of scope:** the T1–T10 assertions themselves (WP3); any Obsidian import; touching production files or `canvas-sync.test.ts`.
- **User stories covered:** US2
- **Acceptance Criteria:**
  1. Fake implements all 9 `CanvasModelBridge` members with in-memory state; `getNode/getEdge` return record copies or `null` (US2 AC1).
  2. Every state-changing mutator re-emits `onLocalChange` (US2 AC2).
  3. `onLocalChange` returns a working unsubscribe (US2 AC3).
  4. Harness syncs-before-mutating so deletes reference the same item and integrate as `tr.local === false` (US2 AC4).
  5. Update counter can isolate `CANVAS_BINDING_ORIGIN` updates (US2 AC5).
  6. Fake-timer support available for async-echo cases (US2 AC6).
  7. Fake + harness live inline in `canvas-binding.test.ts`, importing only `yjs` and the binding (US2 AC7).
- **Definition of Done:** Scaffolding compiles under the test build; a trivial smoke assertion using the harness + fake passes under `npx vitest run`; no Obsidian import; production files untouched.
- **Key files:**
  - Create/extend: `plugin/src/__tests__/canvas-binding.test.ts`.
  - Pattern reference (read only): `plugin/src/__tests__/canvas-sync.test.ts` — `applyRemoteCanvasDelta` L62-74, `remoteNode` L76-80, usages L408/L513-515/L566-567/L586-588; yjs import L3.
- **Architecture notes:**
  - The adversarial re-emit is what makes I2 (sync) and I3 (async) actually load-bearing — do not "fix" the fake to suppress echoes; that would defeat the test.
  - Filter counts to `CANVAS_BINDING_ORIGIN`; never count remote-integration updates as local pushes.
  - Use `vi.useFakeTimers()` where a mutator is scheduled on a timer (for WP3 T5).
  - `import * as Y from "yjs"` (^13.6.0).
- **Handover summary:** *(filled by W3 on completion)*

---

### WP3 — Test contract T1–T10
- **Status:** planned
- **Depends on:** WP1, WP2
- **Scope:** Implement SPEC_01 §10 cases T1–T10 in `canvas-binding.test.ts` using the WP2 fake + harness; assert convergence and update counts per case; keep the full suite green.
- **Out of scope:** any production wiring; adding cases beyond the contract that require Obsidian; modifying existing test files.
- **User stories covered:** US3 (and demonstrates US1 invariants live)
- **Acceptance Criteria (one per T-case; exact expected assertion in bold):**
  1. **T1 seed** — populated doc + empty model + construct ⇒ model id sets and every record equal the doc (US3 AC1).
  2. **T2 capture** — one user node move ⇒ **exactly one** `CANVAS_BINDING_ORIGIN` update carrying only the changed key(s); doc reflects new value (US3 AC2).
  3. **T3 apply** — remote node move via harness (`tr.local === false`) ⇒ follower model updates via `applyNodeUpsert` (US3 AC3).
  4. **T4 no-echo (sync)** — during `applyRemote`, synchronous `onLocalChange` re-emit ⇒ **zero** `CANVAS_BINDING_ORIGIN` updates (US3 AC4; I2).
  5. **T5 no-echo (async)** — timer-fired `onLocalChange` after apply (`applyingRemote === false`), advanced via fake timers ⇒ **zero** `CANVAS_BINDING_ORIGIN` updates (empty diff dropped) (US3 AC5; I3).
  6. **T6 streamed drag → follower** — 50 sequential geometry deltas from peer A ⇒ peer B converges to A's final geometry AND peer B emits **zero** `CANVAS_BINDING_ORIGIN` updates across the whole stream (no re-push) (US3 AC6).
  7. **T7 concurrent different nodes** — A moves n1, B moves n2, merged both ways ⇒ both n1 and n2 hold their mover's value; neither reverts (US3 AC7).
  8. **T8 same-node LWW / lock** — `canWriteNode=false` for n1 on B ⇒ B's capture of n1 dropped (no `CANVAS_BINDING_ORIGIN` update for n1 from B); after A propagates, B's model reconciles to A's n1 value (US3 AC8).
  9. **T9 add/remove** — remote add + remote delete reflect in follower; local delete (`record === null`) removes id from doc; local upsert for a remotely-deleted id does **not** resurrect it (US3 AC9).
  10. **T10 minimal diff** — capturing a record **identical** to the doc record ⇒ **zero** `CANVAS_BINDING_ORIGIN` updates (US3 AC10; I3).
  11. **Suite green** — `npx vitest run` green with total ≥ 440 and no existing test file modified (US3 AC11).
- **Definition of Done:** `npx vitest run` green (T1–T10 + ≥440 total), `npx tsc -noEmit -skipLibCheck` clean, `npx biome check .` clean. Locks the SPEC_04 §1 gate.
- **Key files:** `plugin/src/__tests__/canvas-binding.test.ts` (extend WP2 file with the T1–T10 `describe`/`it` blocks).
- **Architecture notes:**
  - T4/T5/T6/T10 hinge on counting **only** `CANVAS_BINDING_ORIGIN` updates — a nonzero count = an echo bug in WP1.
  - T6 is the reported "guest stable / host scatters" scenario made provable; 50 deltas exercise the streaming steady-state.
  - T8 exercises the §8 `canWriteNode` seam directly via an injected predicate — no external lock wiring.
  - T9 no-resurrect: mirrors the legacy `applyLocalDiffToYMaps` GAP-2 / "delete-wins" policy (SPEC_01 §7); ensure the harness synced-before-delete (WP2 AC4) so the delete truly removes the item.
  - Keep each case's update counter scoped/reset to avoid cross-test bleed.
- **Handover summary:** *(filled by W3 on completion)*

---

## 10. Operational Rules

- **Logging:** optional `CanvasBindingLogger.debug(category, message)` (e.g. `apply: upserts=… removes=…`, `capture: node <id> pushed`) — off by default; no console noise in tests.
- **Monitoring:** N/A (headless library, no runtime service in Phase 0).
- **Recovery / backups:** N/A (no persistence; Y.Doc is in-memory; convergence is the Yjs guarantee).
- **Security and access rules:** write-authorization is advisory only via injected `canWrite`/`canWriteNode` predicates (§6, §8); no secrets, no network, no file access (I6).

---

## 11. Repeated-Action Signals and Automation Candidates

Filled progressively as W3 runs.

| Repeated action | Tool / command | Frequency | Friction / failure | Automation candidate |
|---|---|---|---|---|
| | | | | |

---

## Worker 2 Checklist

- [x] Project overview and non-goals aligned with PLAN.md (Phase 0 only)?
- [x] USER_STORIES.md written with all 3 stories expanded from PLAN.md WP sketch?
- [x] All stories have numbered, observable ACs and a definition of done?
- [x] All components in scope defined with interfaces and US/WP references?
- [x] Every WP in Section 9 has scope, out-of-scope, ACs, DoD, US references?
- [x] Every AC is observable and testable?
- [x] Architecture decisions documented with rationale (local vs re-export equality decided)?
- [x] Data models and flows complete?
- [x] API surfaces fully specified (SPEC_01 §4 interface)?
- [x] Quality gates + active W4 levels documented in Section 7 (read from workflow.config.json)?
- [x] Graph basis noted (graphify disabled → RepoMap fallback)?
- [x] Both file paths returned to Dispatcher?
