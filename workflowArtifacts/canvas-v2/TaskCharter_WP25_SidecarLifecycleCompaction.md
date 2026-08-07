# Task Charter — WP25: Sidecar lifecycle + compaction

**Charter Status:** `DONE`
**WP:** WP25
**Phase:** P2
**task_mode:** `standard`
**Depends on:** WP24
**W4 Test Targets:** `0`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** a returning client resumes a related replica instead of reseeding an unrelated one.
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 5, component **C25 — Sidecar lifecycle wiring, compaction and tombstone GC** (work package WP25); phase **P2**.

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: modify (`CanvasSync.subscribe` `:360–467`, `unsubscribe` `:468–495`) + wire the store
  - Responsibility: load history before sync, capture every update, and compact periodically.
  - Scope summary: load-before-sync, update capture, GC
- **Out of scope / non-goals:**
  - Changing the `coldOpen` ordering contract (it must be preserved verbatim).
  - The seed-once rule itself — WP29.
  - GUID-based file naming beyond consuming what WP27 provides.
- **Known interfaces / dependencies:**
  - Input: doc lifecycle events and update notifications
  - Output: a persistently backed doc
  - Depends on work packages: WP24
  - **Convergence-fuzzer link (required by the BUILD_SPEC):** WP23 "compaction" op — a compaction at an arbitrary point in the run must leave every assertion of the run unchanged (state, schema, byte equality, shadow consistency).

---

## 3. Architecture Context

*Task-local architecture guidance only.*

- **Component(s) being changed:** Sidecar lifecycle wiring, compaction and tombstone GC
- **Interfaces involved:**
  - Input: doc lifecycle events and update notifications
  - Output: a persistently backed doc
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
  - `plugin/src/files/canvas-sync.ts:360–467` — `subscribe` (waitForSync `:375`, observer install `:446–447`)
  - `plugin/src/files/canvas-sync.ts:468–495` — `unsubscribe` (releases the doc `:493`)
  - `plugin/src/files/canvas-persistence.ts:470–480` — `attachCanvasPersistence` and its ordering contract
  - `plugin/src/sync/sync.ts:281–312` — `waitForSync`
- **Structure references:** *(intentionally empty — no Graphify graph exists for this project; FALLBACK mode is declared in the BUILD_SPEC section 3. Worker 3 fills this in after implementation. Do not invent paths here.)*

If structure references conflict with the BUILD_SPEC or explicit task scope, the BUILD_SPEC and TaskCharter win. Escalate instead of following the map.

---

## 4. Acceptance Criteria

*Exact copy from BUILD_SPEC section 5, component C25. No paraphrasing.*

1. On subscribe the sidecar is loaded **before** peer sync begins, so the subsequent exchange is between related replicas.
2. Every local and remote update is appended to the history exactly once; no update is lost across a clean unsubscribe/resubscribe cycle.
3. Compaction runs on a documented, tunable period, uses Yjs' built-in GC, and physically removes tombstones with `on:true` older than the compaction horizon; a compaction never changes the doc's observable state.
4. `coldOpen`'s existing ordering contract is preserved: it still runs after `waitForSync` and before `start()`.

**Definition of Done:** a returning client resumes a related replica instead of reseeding an unrelated one.

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
  - the sidecar module from WP24
- **Required report:** `ImplementationReport_WP25.md` (in `workflowArtifacts/canvas-v2/`)
- **BUILD_SPEC updates required:** no — unless implementation invalidates an architecture decision, in which case ESCALATE rather than editing the spec.
- **Gate status required at handover:** `npm run build` PASS and `npm test` with 0 failures, run from `plugin/`. All visible tests PASS.

---

## 7. Visible Test Cases / Producer Artifacts

Modules under test:

- `plugin/src/files/canvas-sidecar-lifecycle.ts` — **create-path, does not exist yet.** WP25's own module: the tunables, the lifecycle, the vault `SidecarIO` adapter and the one wiring entry point.
- `plugin/src/files/canvas-sync.ts` — modify (`subscribe`, `unsubscribe`, one new setter).
- `plugin/src/main.ts` and `plugin/src/files/vault-events.ts` — **wiring only, one line each** (see §7.0 (e)).
- `plugin/src/files/canvas-persistence.ts` — **not modified.** AC4 is a preservation claim about `attachCanvasPersistence`.

### 7.0 — BINDING API surface and the facts a coder cannot derive

Everything in this section is binding. The visible suite imports these names verbatim.

#### (a) The new module

```ts
// plugin/src/files/canvas-sidecar-lifecycle.ts
import type * as Y from "yjs";
import type { SidecarIO, SidecarLoadResult, SidecarStore } from "./canvas-sidecar";
import type { CanvasIdentityStore } from "./canvas-sync";

// ── tunables — WP25 OWNS these, and the UNIT is part of the NAME ────────────
/** Wall-clock interval between compaction runs, in MILLISECONDS. */
export const SIDECAR_COMPACTION_PERIOD_MS: number;        // 1_000 … 3_600_000
/**
 * Tombstone GC horizon in LAMPORT TICKS — never milliseconds.
 * `TombstoneEntry.t` is a Lamport counter produced by `nextTombstoneTime`
 * (`canvas-sync.ts`), and `canvas-tombstone.ts` never reads a clock. A horizon
 * in ms would compare a counter to a duration and collect a different set on
 * every peer.
 */
export const SIDECAR_COMPACTION_HORIZON_LAMPORT_TICKS: number;  // positive integer

export interface SidecarLifecycleScheduler {
  setInterval(cb: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface SidecarCompactionResult {
  readonly removedTombstoneIds: readonly string[];
  readonly removedRecordIds: readonly string[];
  readonly checkpointWritten: boolean;
  readonly horizonTicks: number;
}

export interface SidecarLifecycleOpts {
  scheduler?: SidecarLifecycleScheduler;   // default: the globals, via arrows
  periodMs?: number;                       // default SIDECAR_COMPACTION_PERIOD_MS
  horizonTicks?: number;                   // default SIDECAR_COMPACTION_HORIZON_LAMPORT_TICKS
  logger?: { debug(c: string, m: string): void; warn?(c: string, m: string): void };
}

export interface SidecarLifecycle {
  /** AC1: replay this guid's sidecar into `doc`. Never throws (WP24 AC3). */
  load(guid: string, doc: Y.Doc): Promise<SidecarLoadResult>;
  /** AC2: begin appending every local and remote update for this doc. */
  attach(guid: string, doc: Y.Doc): void;
  /** AC2: stop appending and make the tail durable. */
  detach(guid: string): Promise<void>;
  /** AC3: run one compaction now. */
  compact(guid: string, doc: Y.Doc): Promise<SidecarCompactionResult>;
  /** Stop the periodic timer and detach everything. Idempotent. */
  destroy(): Promise<void>;
}

export function createSidecarLifecycle(
  store: SidecarStore,
  opts?: SidecarLifecycleOpts,
): SidecarLifecycle;

// ── the adapter WP24 was forbidden to ship (its AC4: no Obsidian, no node:fs) ─
export interface SidecarVaultAdapterLike {
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  readBinary(path: string): Promise<ArrayBuffer>;
  writeBinary(path: string, data: ArrayBuffer): Promise<void>;
  remove(path: string): Promise<void>;
}
export function createVaultSidecarIO(adapter: SidecarVaultAdapterLike): SidecarIO;

// ── the whole wiring decision, as ONE testable unit ─────────────────────────
export interface CanvasSidecarWiring {
  store: SidecarStore;
  lifecycle: SidecarLifecycle;
  identityStore: CanvasIdentityStore;
}
export function wireCanvasSidecar(deps: {
  canvasSync: {
    setIdentityStore(store: CanvasIdentityStore): void;
    setSidecarLifecycle(lifecycle: SidecarLifecycle): void;
  };
  manifest: { getCanvasGuid(p: string): string | null; setCanvasGuid(p: string, g: string): void } | null;
  io: SidecarIO;
  opts?: SidecarLifecycleOpts;
}): CanvasSidecarWiring;
```

And on `CanvasSync` (`canvas-sync.ts`):

```ts
setSidecarLifecycle(lifecycle: SidecarLifecycle | null): void;
```

#### (b) Pinned semantics

- **`load(guid, doc)`** — delegates to WP24's `SidecarStore.load`. Called from `CanvasSync.subscribe` **after `getDoc(docId)` and before `await this.syncManager.waitForSync(docId)`**, and awaited to completion. Never throws for any byte sequence; a degraded verdict is reported and nothing is applied.
- **`attach(guid, doc)`** — installs exactly ONE `doc.on("update", …)` handler. **Idempotent per guid**, and re-attaching with a different `Y.Doc` retires the previous handler. Updates carrying `SIDECAR_LOAD_ORIGIN` (WP24's exported symbol) are **not** appended — otherwise every session re-appends its own replayed state and the history doubles forever while the reconstructed doc stays perfect. There is **no other** origin filter: local and remote updates are both appended.
- **`detach(guid)`** — removes the handler and makes the tail durable before resolving.
- **`compact(guid, doc)`** — in this exact order:
  1. compute `newest := max(entry.t)` over the `deleted` container (`0` when empty), reading entries through **`readTombstoneEntry` / `isTombstoneSuppressed`** (`canvas-tombstone.ts` is the single authority — a malformed entry reads as *no tombstone*, i.e. VISIBLE, and is never collected);
  2. select every id with `isTombstoneSuppressed(entry) && entry.t + horizonTicks <= newest`;
  3. in **ONE** `doc.transact`, `delete` each selected id from the `deleted` container **and** from `nodes` / `edges`. Both halves, always: removing the tombstone alone RESURRECTS the record, because the tombstone was the only thing suppressing it. Deleting an id whose record is already gone is a no-op, not an error;
  4. then `store.checkpoint(guid, doc)` — which is what performs the write-then-truncate and what GCs. **Never before step 3**, or the checkpoint preserves exactly what was just collected.
- **GC** — the doc's own `gc` flag does the work. The compaction must **not** re-encode through a `new Y.Doc({ gc: false })`, must **not** rebuild the state into a fresh doc (that changes `clientID` and severs the causal chain to every peer), and must **not** implement a collector of its own.
- **The periodic timer** — ONE interval for the whole lifecycle, not one per attached doc; armed at construction; every attached guid compacted on each tick; a tick arriving while a compaction is in flight does not stack; `destroy()` clears it and is idempotent.
- **`createVaultSidecarIO`** — `append` must be **binary-safe**. Obsidian's `DataAdapter.append(path, data)` takes a **string**; a frame log contains bytes that are not valid UTF-8, so routing through it turns every 0x80–0xFF into U+FFFD while the u32 length header still parses — corruption that reads as a valid frame carrying garbage. Use `readBinary` + `writeBinary`. `truncate` reduces to zero bytes and **leaves the file in place**; `remove` unlinks.

#### (c) Current anchors — every line number in this charter is stale, locate by name

| Symbol | Where it is now |
|---|---|
| `CanvasSync.subscribe` | `canvas-sync.ts:2132` |
| `CanvasSync.unsubscribe` | `canvas-sync.ts:2307` |
| `CanvasSync.handleRename` | `canvas-sync.ts:2372` |
| `CanvasSync.setIdentityStore` | `canvas-sync.ts:1922` |
| `CanvasPersistence.coldOpen` | `canvas-persistence.ts:443` |
| `ColdOpenResult` | `canvas-persistence.ts:92-95` — `"seeded-from-file" \| "doc-wins" \| "empty"` |
| `attachCanvasPersistence` | `canvas-persistence.ts:646-656` — constructs, `await coldOpen()`, then `start()` |
| `SyncManager.waitForSync` | `sync/sync.ts:319` |
| `nextTombstoneTime` | `canvas-sync.ts:1028` |
| the vault rename handler | `vault-events.ts:189-220` |

#### (d) Names WP25 CONSUMES and must never re-spell (Shared Ownership Contract §1)

From **WP24** `files/canvas-sidecar.ts`: `SIDECAR_DIR`, `SIDECAR_HISTORY_EXT`, `SIDECAR_CHECKPOINT_EXT`, `SIDECAR_INDEX_FILENAME`, `sidecarHistoryPath` / `sidecarCheckpointPath` / `sidecarIndexPath`, `isSidecarPath`, `SidecarIO`, `SidecarStore`, `createSidecarStore`, `SidecarLoadResult`, `SIDECAR_DEGRADATION`, `isSidecarDegraded`, `SIDECAR_LOAD_ORIGIN`, `SidecarIndex`.
From **WP27**: `CANVAS_DOC_PREFIX`, `canvasDocId(guid)`, `CanvasIdentityStore`, `createCanvasIdentityStore` (all `files/canvas-sync.ts`) and `GUID_KEY` / `PATH_KEY` / `EPOCH_KEY` (`canvas/canvas-schema.ts`).
From **WP19/WP12**: `DELETED_MAP_NAME`, `nextTombstoneTime`, `readTombstoneEntry`, `isTombstoneSuppressed`.

WP25 never concatenates a sidecar path, never builds `` `${prefix}${x}` ``, and never inlines `"guid"`, `"path"`, `"epoch"` or `"deleted"`. WP25 owns **only** the two `SIDECAR_COMPACTION_*` tunables.

#### (e) The WIRING JOB — not in §2, and it is WP25's

`ImplementationReport_WP27.md` Escalation 2: WP27 shipped a **two-mode** design. With an identity store injected, docs are `__canvas__:<guid>` and `meta` is stamped; **without one, the canonical path is the identity token and `canvasDocId()` reproduces the pre-WP27 id byte for byte.** WP27 deliberately left `setIdentityStore(...)` and `handleRename(...)` with **no production caller**, because `createCanvasIdentityStore` needs a `SidecarIO` adapter only WP25 can supply. **WP27's AC1 and AC2 are therefore true of the module and not of the shipped plugin.**

WP25 closes it with two one-line wirings:

- `main.ts` — `wireCanvasSidecar({ canvasSync: this.canvasSync, manifest: this.manifestManager, io: createVaultSidecarIO(this.app.vault.adapter) })`, beside the other `canvasSync.set*` calls (`main.ts:790-817`). `main.ts` holds wiring only and has no test file, which is why the decision lives in `wireCanvasSidecar`.
- `vault-events.ts` — `await plugin.canvasSync?.handleRename(oldPath, file.path);` inside the `vault.on("rename", …)` task, after `manifestManager.renameFile`.

Two facts that go with it:

- **Wiring with `sidecar: null` is a live regression**, not a smaller version of this. A guest that subscribes before the host's manifest entry has replicated then resolves `null`, opens nothing, and drops into the R10 raw-text fallback **with no retry**. The sidecar `index.json` is what closes that window, and it is scanned **by VALUE** (`guid -> path`).
- **`CanvasIdentityStore.unbind` has no clean spelling.** Its `Pick<ManifestManager, "getCanvasGuid" | "setCanvasGuid">` exposes no delete, so a **blank guid passed to `setCanvasGuid` clears the mapping** and leaves the manifest entry itself alone (`manifest.ts:343-361`). Do not "tidy" it into a delete.

#### (f) Test placement

Visible: `plugin/src/__tests__/v2/wp25/`, shared fixtures in `harness.ts`. Blind sets exist and are measured only by `python _run_blind.py 25 both`; they are deliberately not referenced here.

---

### TC1 — the sidecar load finishes before peer sync begins

- **Verifies AC:** AC1
- **Test file:** `plugin/src/__tests__/v2/wp25/test_tp01_sidecar_load_before_peer_sync_visible.test.ts`
- **What it checks:** `sidecar:read:end` precedes `sync:waitForSync:start` in one shared trace; holding the sidecar `read` open proves `waitForSync` is *sequenced behind* the load rather than merely winning a race; the doc handed to `waitForSync` already carries the sidecar's records; a MISSING sidecar keeps the same ordering; the load targets `sidecarHistoryPath(guid)` / `sidecarCheckpointPath(guid)` and no path-derived name.
- **Test data channel:** in-memory `SidecarIO` double that appends `sidecar:<op>:<phase>:<path>` to a shared trace and can block one op; a `SyncManager` double that traces `waitForSync` at both ends; a real `ManifestManager` over a `Y.Map`.

### TC2 — every local and remote update is appended exactly once

- **Verifies AC:** AC2
- **Test file:** `plugin/src/__tests__/v2/wp25/test_tp02_every_update_appended_once_visible.test.ts`
- **What it checks:** a local update produces exactly one frame; a remote update produces one too; five interleaved updates produce five distinct frames (the DUPLICATION direction, invisible in the doc because Yjs applies are idempotent); the load's own `Y.applyUpdate` under `SIDECAR_LOAD_ORIGIN` is **not** appended; the exclusion is the origin and not "swallow the first update"; two attached docs keep separate histories.
- **Test data channel:** the frame log itself, decoded by the test's own independent `u32BE || payload` reader, plus the IO double's per-call record of the exact bytes handed over.

### TC3 — no update is lost across a clean unsubscribe/resubscribe cycle

- **Verifies AC:** AC2
- **Test file:** `plugin/src/__tests__/v2/wp25/test_tp03_no_update_lost_across_resubscribe_visible.test.ts`
- **What it checks:** the last write before the unsubscribe is durable; a resubscribe over a *fresh* `Y.Doc` for the same id reaches the pre-unsubscribe state (the Definition of Done); the retired doc stops appending; no payload appears twice across the cycle; whatever is on disk after teardown reconstructs the pre-teardown state on its own.
- **Test data channel:** the real `CanvasSync` over the sync-manager double, with the sidecar files read back through WP24's own `SidecarStore.load` and through the test's frame reader.

### TC4 — compaction runs on a documented, tunable period

- **Verifies AC:** AC3
- **Test file:** `plugin/src/__tests__/v2/wp25/test_tp04_compaction_period_is_tunable_visible.test.ts`
- **What it checks:** both tunables are exported, positive and finite, and the period is within sane bounds; nothing compacts at `PERIOD_MS - 1` **and does compact at `PERIOD_MS`** (every "not yet" carries a positive control); it repeats; an injected `periodMs` overrides the constant; `destroy()` stops the timer; a detached doc is not compacted while an attached sibling still is.
- **Test data channel:** `vi.useFakeTimers()` + `advanceTimersByTimeAsync`; the observable signature of a compaction is `io.write` on `sidecarCheckpointPath(guid)`.

### TC5 — compaction uses Yjs' built-in GC

- **Verifies AC:** AC3
- **Test file:** `plugin/src/__tests__/v2/wp25/test_tp05_compaction_uses_yjs_gc_visible.test.ts`
- **What it checks:** the premise is asserted first (with `gc:true` a deleted item's bytes leave `encodeStateAsUpdate`; with `gc:false` they do not); after a compaction the removed record's marker is in **no** sidecar file — checkpoint *and* history, because the frames still hold the update that created it; the live record's marker is still there; the history is emptied, not merely superseded; the checkpoint is not built through a GC-disabled doc; the reloaded replica is usable rather than a husk.
- **Test data channel:** byte search for a distinctive marker string over every file on the fake sidecar disk. Deliberately not a byte-length assertion — that is brittle across Yjs versions and is satisfied by any compaction at all.

### TC6 — tombstones beyond the horizon are physically removed

- **Verifies AC:** AC3
- **Test file:** `plugin/src/__tests__/v2/wp25/test_tp06_tombstone_horizon_gc_visible.test.ts`
- **What it checks:** the horizon is Lamport ticks and the fixture straddles it; an `on:true` entry beyond the horizon goes **and takes its record with it** (both halves — the tombstone alone resurrects the card); an `on:true` entry inside the horizon is kept (the discriminating half, without which "remove everything" passes); an `on:false` entry is never collected however old; a record with no tombstone is untouched; a suppressed EDGE is collected the same way; an all-inside-horizon board collects nothing and still checkpoints.
- **Test data channel:** `SidecarCompactionResult.removedTombstoneIds` / `removedRecordIds`, the `deleted` container read through `readTombstoneEntry`, and the `nodes` / `edges` key sets.

### TC7 — a compaction never changes the doc's observable state

- **Verifies AC:** AC3
- **Test file:** `plugin/src/__tests__/v2/wp25/test_tp07_compaction_preserves_observable_state_visible.test.ts`
- **What it checks:** the fixture is asserted non-trivial first (four tombstones, real GC-able content, a dangling edge); across a compaction that **did** collect, `serializeCanvas`, the visible id sets and `meta` are all unchanged — **both halves in one test**, since "unchanged" alone is satisfied by a no-op and "collected" alone says nothing about damage; the dangling edge stays invisible once its endpoint record is gone; a replica reloaded from the compacted sidecar sees the same thing (catching a checkpoint taken before the removals); a second compaction is a no-op and still changes nothing; the removals land in ONE transaction, before the checkpoint write.
- **Test data channel:** `observableState(doc)` — `serializeCanvas(nodes, edges, deleted)`, `meta.toJSON()`, and the projected id lists. Explicitly **not** `encodeStateAsUpdate`, which a correct compaction must change.

### TC8 — coldOpen still runs after waitForSync and before start()

- **Verifies AC:** AC4
- **Test file:** `plugin/src/__tests__/v2/wp25/test_tp08_coldopen_ordering_preserved_visible.test.ts`
- **What it checks:** the four stages appear in order — sidecar load, `waitForSync`, `coldOpen`'s file IO, `start()`'s `observeDeep`; on the `seeded-from-file` branch the seed arms **no** write and reaches disk not at all (US5 AC17, the consequence the order protects); the `doc-wins` branch still never reads the file and writes exactly once; a returning client whose sidecar was loaded inside `subscribe` arrives at cold open on the `doc-wins` branch.
- **Test data channel:** the shared trace plus a spy on `observeDeep` of the *same* `nodes` `Y.Map` instance `CanvasPersistence`'s constructor reaches through `doc.getMap`, installed after `subscribe` so `CanvasSync`'s own observers cannot be mistaken for it; a manual `PersistenceScheduler` whose armed-timer count is the "a write was scheduled" oracle.

### TC9 — the identity store is wired over a real sidecar adapter, and the shipped plugin uses guid identity

- **Verifies AC:** the §7.0(e) wiring job (inherited from `ImplementationReport_WP27.md` Escalation 2)
- **Test file:** `plugin/src/__tests__/v2/wp25/test_tp09_identity_store_wired_over_sidecar_visible.test.ts`
- **What it checks:** `createVaultSidecarIO` satisfies the whole `SidecarIO` contract over a `DataAdapter` double; `append` is byte-exact (the string-API trap); `append` creates an absent file and `truncate` leaves it in place; a whole WP24 store runs on the adapter, `index.json` included; `wireCanvasSidecar` injects **both** the identity store and the lifecycle; a wired plugin addresses the canvas by a 32-hex guid and never by `__canvas__:<path>`, publishing the mapping to the manifest **and** `index.json`; a rename re-points everything without releasing or duplicating the doc; and — the level a behavioural test cannot reach — `main.ts` really calls `wireCanvasSidecar(` and `vault-events.ts` really calls `handleRename(` on the rename path.
- **Test data channel:** the sync-manager double's `requested` id list (the only channel that can see WHICH doc was asked for), a real `ManifestManager`, WP24's `SidecarStore.readIndex()`, and a comment-stripped read of `main.ts` / `vault-events.ts` following the repo's existing source-oracle pattern (`wp24/tp12`, `wp1/tp02`, `wp14/tp12`).

### TC10 — a guest resolves the guid offline, before the manifest replicates

- **Verifies AC:** the §7.0(e) wiring job — the R10 ordering risk WP27 named
- **Test file:** `plugin/src/__tests__/v2/wp25/test_tp10_guid_resolves_without_manifest_visible.test.ts`
- **What it checks:** with an empty manifest and a populated `index.json` the guest OWNS the canvas and no text fallback is installed; the **same** guest wired `sidecar: null` returns `false` from `subscribeCanvasWithHandover`, lands on `backgroundSync.subscribe`, opens no canvas doc, and does not retry; with no mapping anywhere the guest still opens nothing (the sidecar is not a mint — minting on a guest is the two-document defect); a host with no mapping mints and publishes to both stores; a resolved guid is republished to the manifest so the window closes; `unbind` clears the guid with a blank value and leaves the manifest ENTRY intact.
- **Test data channel:** `subscribeCanvasWithHandover` (`vault-events.ts`) with a `backgroundSync` double whose `subscribe` calls are the R10 signal, over a `DataAdapter` double shared between clients.

---

## 7b. W4 Test Targets (filled by Worker 3's Unit Test Sub-Agent, if any)

**None.** No acceptance criterion of WP25 is INTEGRATION_SCOPE: AC1–AC4 and the §7.0(e) wiring job are all reachable from unit tests over `CanvasSync`, `CanvasPersistence`, the new lifecycle module and injected I/O doubles. `W4 Test Targets` is therefore `0`.

---

## 8. Autonomous Execution Plan (filled by Coder Sub-Agent, attempt 1)

- **Observed current behavior:** `CanvasSync.subscribe` went `resolveGuidForSubscribe` →
  `getDoc(docId)` → `waitForSync(docId)` with no durable history anywhere; WP24's store had
  no `SidecarIO` adapter and therefore no production caller, and WP27's `setIdentityStore` /
  `handleRename` had none either. `attachCanvasPersistence` already ran `coldOpen()` before
  `start()` (AC4 was true and only needed preserving).
- **Approach:** new module `files/canvas-sidecar-lifecycle.ts` holding both
  `SIDECAR_COMPACTION_*` tunables, `createSidecarLifecycle` (one update handler per guid,
  `SIDECAR_LOAD_ORIGIN` as the sole exclusion, one shared non-stacking interval, a
  single-transaction Lamport-horizon sweep followed by WP24's `checkpoint`),
  `createVaultSidecarIO` (binary-only, read-modify-write `append`) and `wireCanvasSidecar`
  (the whole wiring decision as one unit). `CanvasSync` gained `setSidecarLifecycle`, an
  `attach` + awaited `load` between `getDoc` and `waitForSync`, and a `detach` in
  `unsubscribe`/`destroy`. `main.ts` and `vault-events.ts` got one wiring statement each.
- **Fallback path if all attempts fail:** not needed — attempt 1 reached 59/59.

---

## 9. Handover Summary (filled by Coder Sub-Agent on completion)

- **What is complete:** AC1–AC4 and the §7.0(e) wiring job. 59/59 visible; wp24/wp26/wp27
  176/176 unchanged; full suite 1583/0 (baseline 1524/0, delta = exactly the 59 new tests);
  `tsc --noEmit -skipLibCheck` clean. Full detail in `ImplementationReport_WP25.md`.
- **What remains open:** two FIXTURE defects in `plugin/src/__tests__/v2/wp25/harness.ts` were
  repaired (no assertion changed): `FakeSyncManager.synced` was never populated, and
  `ManifestManager.connect`'s own `waitForSync("__manifest__")` polluted the shared ordering
  trace so `firstContaining(trace, "sync:waitForSync:start:")` resolved to the manifest's sync.
  Four visible tests were unsatisfiable by any implementation until both were fixed. Blind sets
  sharing this harness inherit the same repair.
- **Final status:** `DONE`.

---

## 10. Risk Notes for Worker 4 (filled by Worker 3 Core)

- **Risk flag:** NONE
