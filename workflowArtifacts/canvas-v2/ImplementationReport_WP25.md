# Implementation Report — WP25

**Attempt:** 1
**WP:** WP25 — Sidecar lifecycle + compaction (C25, phase P2)

---

## Status

`DONE`

- Visible suite `plugin/src/__tests__/v2/wp25`: **59 / 59 passing**.
- Neighbours `wp24 / wp26 / wp27`: **176 / 176 passing** (76 + 46 + 54, unchanged).
- `npx tsc --noEmit -skipLibCheck`: **clean, zero diagnostics**.
- Full plugin suite: **1583 passed / 0 failed / 274 files** (reference 1524 / 0 → **delta +59**, exactly the WP25 visible tests; no pre-existing test moved).

Two defects in the WP25 **fixture** file (`wp25/harness.ts`) made four visible tests
unsatisfiable by *any* implementation. Both were repaired at the fixture level with no
assertion touched — see **Blocked Items** for the full account.

---

## Completed Work

| AC | Status | Notes |
|---|---|---|
| **AC1** — on subscribe the sidecar is loaded **before** peer sync begins | DONE | `await this.sidecar.load(guid, docHandle.doc)` sits in `CanvasSync.subscribe` **after `const docHandle = this.syncManager.getDoc(docId)` and before `await this.syncManager.waitForSync(docId)`**, awaited to completion — never issued concurrently. `attach` precedes the load so nothing emitted during the replay escapes the history. Gated on `this.sidecar !== null && this.identityStore !== null`. |
| **AC2** — every local and remote update appended exactly once; nothing lost across unsubscribe/resubscribe | DONE | Exactly ONE `doc.on("update", …)` handler per guid, installed by `SidecarLifecycle.attach`; idempotent per guid, and re-attaching a different `Y.Doc` retires the previous handler. The **only** origin filter is `origin === SIDECAR_LOAD_ORIGIN` — there is no `tr.local`/origin selection, so local and remote are both captured. `CanvasSync.unsubscribe` (and `destroy`) call `detach(guid)`, which removes the handler **synchronously before its first await** and then awaits the per-guid append tail. |
| **AC3** — documented tunable period, Yjs GC, physical removal of `on:true` tombstones beyond the horizon, observable state unchanged | DONE | `SIDECAR_COMPACTION_PERIOD_MS = 300_000` and `SIDECAR_COMPACTION_HORIZON_LAMPORT_TICKS = 1000`. One interval for the whole lifecycle, armed at construction, non-stacking, cleared by an idempotent `destroy()`. `compact` follows the charter order exactly: `newest := max(entry.t)` via `readTombstoneEntry` → select `isTombstoneSuppressed(entry) && entry.t + horizon <= newest` → **ONE** `doc.transact` removing the id from `deleted` **and** from `nodes`/`edges` → then `store.checkpoint`. No re-encode through a GC-disabled doc, no fresh-doc rebuild, no bespoke collector. |
| **AC4** — `coldOpen` still runs after `waitForSync` and before `start()` | DONE (preservation) | `canvas-persistence.ts` is **not modified**. The four-stage order (sidecar load → `waitForSync` → `coldOpen` file IO → `start()`'s `observeDeep`) is asserted green, including the `seeded-from-file` branch arming zero writes. |
| **§7.0(e) wiring job** (inherited from `ImplementationReport_WP27.md` Escalation 2) | DONE | `createVaultSidecarIO(...)` + `wireCanvasSidecar(...)` shipped; `main.ts` calls `wireCanvasSidecar({ canvasSync, manifest: this.manifestManager, io: createVaultSidecarIO(this.app.vault.adapter) })`; `vault-events.ts` calls `await plugin.canvasSync?.handleRename(oldPath, file.path)` inside the `vault.on("rename", …)` task, after `manifestManager.renameFile`. The identity store is built with the **real sidecar store**, never `sidecar: null`. |

---

## Blocked Items

None blocking. Two **fixture defects** were found and repaired; both are reported here
rather than silently absorbed.

### F1 — `FakeSyncManager.synced` was declared but never written (`wp25/harness.ts`)

`createSyncManager` documents `synced` as *"Every id ever passed to `waitForSync`"*, but the
fake's `waitForSync` only pushed to the trace. The array was therefore permanently `[]`, so

- `tp01` — *"peer sync does not begin while the sidecar read is still in flight"* →
  `expect(sync.synced).toContain(canvasDocId(FIXED_GUID))`, and
- `tp01` — *"a MISSING sidecar still subscribes…"* →
  `expect(sync.synced).toEqual([canvasDocId(FIXED_GUID)])`

could not pass for **any** implementation.

**Repair:** one line — `synced.push(docId)` inside the fake's `waitForSync`. No assertion was
altered; the channel the assertions already read is now populated, which makes the suite
*stricter* than it was (it previously proved nothing about which doc was synced).

### F2 — `ManifestManager.connect`'s own `waitForSync("__manifest__")` polluted the shared ordering trace (`wp25/harness.ts`)

`createManifest` awaits `manifest.connect(sync)`, and `ManifestManager.connect` ends with
`await syncManager.waitForSync("__manifest__")`. That call happens during **fixture setup**,
before the subscribe under test, and it landed in the same trace the ordering assertions read.
`firstContaining(trace, "sync:waitForSync:start:")` therefore resolved to the **manifest's**
sync at index ~1, and three assertions compared the sidecar's activity against the wrong event:

- `tp01` — *"the checkpoint read FINISHES before waitForSync is entered"* (`expected 15 to be less than 1`)
- `tp01` — *"a MISSING sidecar still subscribes, and still reads before it syncs"* (`expected 3 to be less than 1`)
- `tp08` — *"the four stages appear in exactly the contracted order"* (`the sidecar was loaded after peer sync (AC1): expected 3 to be less than 1`)

`tp01`'s first test even resets the trace with `trace.length = 0` *for exactly this reason* —
but it does so **before** `createManifest` runs, so the noise it meant to remove was added
immediately afterwards.

**Repair:** `createManifest` now connects through
`{ ...sync, waitForSync: async () => {} }`. The manifest doc is still acquired through the real
fake (`docs`, `requested` and the `sync:getDoc:` trace entries are unchanged); only the
manifest's own setup-time sync wait is kept out of the two ordering channels. No assertion was
altered.

> Both edits are inside `harness.ts`, which contains zero assertions and is listed in the
> charter as *"shared fixtures"* rather than as a test case. Neither touches the licensed
> deletion/amendment lists. `harness.ts` is currently **untracked** in git (the whole
> `plugin/src/__tests__/v2/wp25/` directory is uncommitted), so the edits do not appear in
> `git diff`.

---

## Tools Created

None. No `TOOL_REQUEST` was needed. **Zero new runtime dependencies** — the module imports
only `yjs` (type-only), WP24's `canvas-sidecar`, WP12's `canvas-tombstone` and WP27's
`canvas-sync`.

---

## Changes Made

### New — `plugin/src/files/canvas-sidecar-lifecycle.ts`

The whole of WP25's own surface:

```text
├── SIDECAR_COMPACTION_PERIOD_MS = 300_000            ← MILLISECONDS (unit in the name)
├── SIDECAR_COMPACTION_HORIZON_LAMPORT_TICKS = 1000   ← LAMPORT TICKS, never ms
├── SidecarLifecycleScheduler / SidecarLifecycleOpts / SidecarCompactionResult
├── SidecarLifecycle          ← load · attach · detach · compact · destroy
├── createSidecarLifecycle(store, opts?)
├── SidecarVaultAdapterLike   ← the DataAdapter slice; NO string surface at all
├── createVaultSidecarIO(adapter)
├── CanvasSidecarWiring
└── wireCanvasSidecar(deps)   ← injects BOTH setIdentityStore and setSidecarLifecycle
```

Design points worth recording:

- **Binary safety.** `createVaultSidecarIO.append` is `exists` → `readBinary` →
  concat → `writeBinary`. Obsidian's `DataAdapter.append(path, data)` takes a **string**;
  routing a frame log through it turns every `0x80–0xFF` byte into `U+FFFD` while the u32
  length header still parses — corruption that reads as a valid frame carrying garbage. The
  declared adapter interface deliberately exposes **no string method**, so an implementation
  that reached for one would not compile. `truncate` is `writeBinary(path, new ArrayBuffer(0))`
  (zero bytes, file stays); `remove` unlinks. `ensureDir` walks every ancestor segment and
  guards each with `exists`, because `DataAdapter.mkdir` creates one level and throws on an
  existing directory.
- **Exactly-once.** One handler per guid held in a `Map<string, AttachedDoc>`; `attach` is a
  no-op for the same doc and retires the handler for a different one. Each append is chained
  onto a per-guid `tail` promise so `detach` can make the tail durable; `store.append` already
  serialises per guid, so no append can slip between a checkpoint's encode and its truncate.
- **One transaction, then the checkpoint.** The removal transaction is skipped entirely when
  nothing is beyond the horizon (no empty CRDT transaction is emitted); the checkpoint runs
  unconditionally, so a no-op collection is still a compaction (`checkpointWritten: true`).
- **Default scheduler** reaches the globals through arrows so the lookup happens at call time
  (fake timers installed before construction are honoured), and calls `unref?.()` on the handle
  so a lifecycle nobody destroyed cannot hold a Node process open. Obsidian's renderer returns
  a plain `number` and the optional call is a no-op there.

### Modified — `plugin/src/files/canvas-sync.ts`

- New field `private sidecar: SidecarLifecycle | null = null` and setter
  `setSidecarLifecycle(lifecycle: SidecarLifecycle | null): void`.
- `import type { SidecarLifecycle } from "./canvas-sidecar-lifecycle"` — **type-only,
  deliberately**: `canvas-sidecar-lifecycle` imports this module at runtime (for
  `createCanvasIdentityStore` and `DELETED_MAP_NAME`), so a value import would close a cycle.
- `subscribe`: the `attach` + `await load` block between `getDoc(docId)` and
  `waitForSync(docId)`, followed by the usual `if (!this.subscribedPaths.has(path)) return;`
  re-check (the load is a new await inside the subscribe window).
- `unsubscribe`: `sidecarGuid` is read **before** `guidByPath.delete(path)` (same reason
  `docId` is), then `void this.sidecar.detach(sidecarGuid)`.
- `destroy`: the same detach per still-subscribed path. The lifecycle itself is **not**
  destroyed there — it is injected, not owned.

### Modified — `plugin/src/main.ts` (wiring only)

- Import of `createVaultSidecarIO` / `wireCanvasSidecar` / `CanvasSidecarWiring`.
- Field `private canvasSidecar: CanvasSidecarWiring | null = null`.
- One `wireCanvasSidecar({...})` call beside the other `canvasSync.set*` calls.
- `void this.canvasSidecar?.lifecycle.destroy(); this.canvasSidecar = null;` beside each of the
  two existing `this.canvasSync?.destroy()` teardowns (`onunload`, `endSession`), so the
  periodic compaction timer dies with the session that armed it.

No decision, branch or computation was added to `main.ts` — every one of those lines is an
assignment or a call. All logic lives in `wireCanvasSidecar`.

### Modified — `plugin/src/files/vault-events.ts` (wiring only)

One statement inside the `vault.on("rename", …)` task, after
`manifestManager.renameFile(...)`:

```ts
await plugin.canvasSync?.handleRename(oldPath, file.path);
```

### Modified — `plugin/src/__tests__/v2/wp25/harness.ts` (fixture repairs F1 + F2)

See **Blocked Items**. Two changes, both additive, no assertion touched.

### NOT modified

`canvas-persistence.ts` (AC4 is a preservation claim), `canvas-sidecar.ts`,
`canvas-tombstone.ts`, `sync/sync.ts`, `canvas-presence.ts`, `canvas-binding.ts`,
`canvas-model-bridge.ts`, `package.json`, `manifest.json`, `plugin/main.js`, `server/`,
`docker/`, `deploy/`, and every pre-existing test file.

---

## Visible Test Results

```text
plugin/src/__tests__/v2/wp25 ................ 10 files / 59 tests / 59 passed
  tp01 sidecar load before peer sync .......... 5 / 5
  tp02 every update appended once ............. 6 / 6
  tp03 no update lost across resubscribe ...... 5 / 5
  tp04 compaction period is tunable ........... 6 / 6
  tp05 compaction uses Yjs GC ................. 5 / 5
  tp06 tombstone horizon GC ................... 7 / 7
  tp07 compaction preserves observable state .. 6 / 6
  tp08 coldOpen ordering preserved ............ 4 / 4
  tp09 identity store wired over sidecar ...... 7 / 7
  tp10 guid resolves without manifest ......... 6 / 6

wp24 / wp26 / wp27 .......................... 33 files / 176 tests / 176 passed
Full suite .................................. 274 files / 1583 tests / 1583 passed / 0 failed
tsc --noEmit -skipLibCheck .................. clean (exit 0, zero diagnostics)
```

Foreign edits observed and **not** touched (batch B16 / `_run_blind.py` activity):
`workflowArtifacts/canvas-v2/_blind_records/**` and
`workflowArtifacts/canvas-v2/tests/blind_set{1,2}/WP25/`.

---

## Summary for Worker 3

WP25 is complete and green. The sidecar load is **sequenced** between `getDoc` and
`waitForSync` — not merely issued first — so a slow disk cannot turn a resume into a
stranger-merge. Exactly-once is guaranteed structurally (one handler per guid, retired on
re-attach, detached synchronously at unsubscribe) with `SIDECAR_LOAD_ORIGIN` as the single
exclusion. Compaction is one transaction plus WP24's checkpoint, in that order, using the
doc's own GC; tombstones are removed together with their records and never when `on:false`.
The horizon is Lamport ticks and says so in its name. `main.ts` and `vault-events.ts` carry
one wiring statement each, which finally makes WP27's AC1/AC2 true of the **shipped plugin**
and not only of the module.

Three things Worker 3 should carry forward:

1. **Two fixture defects (F1, F2) were repaired in `wp25/harness.ts`.** Four visible tests were
   unsatisfiable before that; no assertion was changed and the suite is strictly stronger. If
   the blind sets share this harness, they inherit the same repair.
2. **`CanvasSync.subscribe` only loads the sidecar when an identity store is also present.**
   Without one the identity token is the canonical *path* (WP27's fallback mode), and naming
   sidecar files after a path would leak `.canvas` into the sidecar directory and lose the
   history at the first rename. `wireCanvasSidecar` always injects both, so production is never
   in the half-wired state.
3. **`CanvasSync.destroy()` detaches docs but does not destroy the lifecycle.** The lifecycle is
   injected and shared; `main.ts` owns its teardown at both session-end sites. A future WP that
   constructs a second `CanvasSync` must not assume otherwise.
