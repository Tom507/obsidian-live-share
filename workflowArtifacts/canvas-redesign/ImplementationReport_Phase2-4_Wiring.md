# Implementation Report — Phase 2–4 Wiring (CanvasBinding into `main.ts`)
Date authored: 2026-07-20 (18:00–19:10) · Documented: 2026-07-26
Status: LANDED IN WORKING TREE, UNCOMMITTED · Ships in 0.6.0 with `useCanvasBinding` **OFF**

---

## 1. Provenance & status

- This report documents **uncommitted working-tree changes on top of HEAD `4b34d5e`**
  ("testing infra & live share canvas redesign", 2026-07-20 17:55 +0200). Nothing described
  here is in a commit.
- The changes were authored **2026-07-20 between 18:00 and 19:10**. No ImplementationReport,
  HANDOVER, or workflow-memory event covered them. **This report was reconstructed after the
  fact by reading `git diff` and the untracked files** — it is not a first-hand build log. No
  W3/W4 run notes, no per-WP AC list, and no author commentary existed to draw on; every claim
  below is grounded in a file + line reference rather than a remembered intent.
- **Gate status — VERIFIED (run 2026-07-26 by the coordinator, not by the original author):**

  | Gate | Command (from `plugin/`) | Result |
  |---|---|---|
  | Typecheck + bundle | `npm run build` | **PASS** |
  | Full vitest suite | `npm test` | **526 passed / 32 files, 0 fail** |

  Baseline before this work was 507 passed / 29 files (`workflowArtifacts/e2e-infra/HANDOVER.md`
  §"Authoritative Gate Results"). The three new test files are purely additive: **+19 tests,
  +3 files** (8 in `canvas-binding-capture.test.ts`, 4 in `canvas-binding-apply.test.ts`,
  7 in `canvas-persistence.test.ts`), no regression, no coverage loss.
- Gates were run **2026-07-26, six days after authoring**, on the same working tree. They
  establish that the tree builds and the suite is green. They do **not** establish any
  behavioural acceptance: SPEC_04's real gates for Phases 2–4 are the two-vault **user E2E
  matrix** (§3/§4/§5 of SPEC_04), and there is **no record of any manual E2E run**, flag ON or
  OFF, for this wiring. The SPEC_02 §9 Phase-0 real-vault spike is likewise **not recorded as
  run** — the bridge itself says so in a `⚠ ASSUMPTION` block
  (`plugin/src/canvas/canvas-model-bridge.ts:77-86`).
- **Release framing:** version bumped 0.5.9 → 0.6.0 in `manifest.json:4`,
  `plugin/package.json:3`, and `versions.json` (new `"0.6.0": "1.11.0"` row), and packaged via
  the new `scripts/package_plugin.py` — which lives **one level above this repo** at
  `H:\Developement\_NeuralAngels\liveshareCollab\scripts\package_plugin.py`, not inside
  `obsidian-live-share/`. So this wiring **ships in 0.6.0 dormant**: `useCanvasBinding` defaults
  to `false` (`plugin/src/types.ts:65`), and with the flag OFF every code path in production is
  the v0.5.9 legacy path (see §3, column OFF). The redesign is opt-in via a settings toggle
  (`plugin/src/ui/settings.ts:261-275`).

Prior context this report builds on (not repeated here):
`SPEC_02_CanvasModelBridge.md`, `SPEC_03_Persistence.md`, `SPEC_04_Phasing_Acceptance.md`,
`HANDOVER.md` (Phase 0 = headless binding + fake bridge, nothing wired),
`../e2e-infra/HANDOVER.md` (the `CanvasDouble` / `InteractionDriver` / two-peer harness and the
`liveshare-e2e` MCP that shipped in `4b34d5e`).

---

## 2. What each file does

### 2.1 New: `plugin/src/canvas/canvas-model-bridge.ts` (332 lines) — SPEC_02, Phases 2+3

Factory `createCanvasModelBridge(adapter, opts)` returning `CanvasModelBridgeHandle`
(= the frozen 9-member `CanvasModelBridge` + `destroy()`). Exports:

| Symbol | Line | Role |
|---|---|---|
| `CanvasModelBridgeLogger` / `CanvasModelBridgeOpts` / `CanvasModelBridgeHandle` | 31, 35, 55 | types; `opts.isApplying` is the SPEC_02 §4.3 / SPEC_01 I2 suppression seam |
| `CAPTURE_TRIGGERS` | 88-91 | documentation-only const mapping edit kind → committing signal; **not read by any code path** |
| `createCanvasModelBridge` | 137 | the factory |

Design decisions that matter downstream:

- **Shadow read-model.** `nodes`/`edges` `Map`s (146-147) are BOTH the `getNode*`/`getEdge*`
  projection AND the capture baseline. They are advanced by apply (266, 272, 286, 294, 307) and
  by capture (198, 203, 209, 219, 225). `getNode`/`getEdge` never read raw private-canvas fields
  — deliberate, so `CanvasBinding`'s `recordsEqual` diff is meaningful without the spike-gated
  full-record read.
- **Apply.** `applyNodeUpsert` (256) takes the smooth path `adapter.applyNodeGeometry` only when
  `prev` exists **and** `onlyGeometryChanged(prev,next)` (121-130: identical key sets, all
  non-geometry keys equal); otherwise `structuralReload()` (158-163) — `adapter.reloadCanvasData`
  over **the entire shadow**. `applyNodeRemove` (281), `applyEdgeUpsert` (290),
  `applyEdgeRemove` (303) are always structural. A failed/deferred reload rolls the shadow back
  (275-277, 286, 296-299, 308) so the next delta retries.
- **Capture.** `captureFromModel` (186-229) runs on both adapter interaction hooks
  (235-236), bails on `isApplying()` (189 = I2), then snapshot-diffs live vs shadow. Nodes:
  membership + **geometry only** (`sameGeometry`, 111-113). Edges: **membership only**.
- **SPEC_02 acceptance — implemented:** §3 apply members (all four), §4.1 dual trigger
  subscription, §4.2 snapshot diff, §4.3 `isApplying` suppression, §5 structural add/remove via
  scoped `setData`, §6 geometry via `moveAndResize` incl. mid-drag deferral (adapter returns
  `"interacting"`; shadow not committed → retry), §8 degradation (adapter `NOOP` unsubscribes
  when the private API is absent).
- **SPEC_02 acceptance — missing / stubbed:**
  - §6 **content** reconciliation is not implemented in capture. `text`, `file`, `color`,
    `label`, `type` changes on an existing node are never diffed (only `sameGeometry` is), and a
    locally-ADDED node is captured **geometry-only** — `{ id, x, y, width, height }`, line 197.
  - §7 **edge side/cosmetic sync** is not implemented in capture: a new edge is captured as
    `{ id }` (218), and an existing edge's `fromSide`/`toSide`/label/color changes are never
    captured at all.
  - §9 spike: not run. `CAPTURE_TRIGGERS` (88-91) is inert documentation of an *assumption*.
  - §10 test contract asked for extensions to `canvas-adapter.test.ts`; instead two new files
    were added (`canvas-binding-apply/capture.test.ts`). Equivalent-or-better, but the spec's
    named file is untouched.

### 2.2 New: `plugin/src/files/canvas-persistence.ts` (336 lines) — SPEC_03, Phase 1

`class CanvasPersistence` plus `PersistenceIO` (47), `PersistenceScheduler` (61),
`CANVAS_SEED_ORIGIN` (76), `ColdOpenResult` (79), `CanvasPersistenceOpts` (84),
`createVaultPersistenceIO` (324), and re-exports of `buildCanvasData`/`serializeCanvas` (296).
Headless: no Obsidian import; I/O, mute surface, and clock are all injected.

- `start()` (131) attaches `observeDeep` to both maps with **no origin filter** — both local
  captures and remote deltas must persist. `scheduleWrite` (155-169) reuses `DEBOUNCE_MS` /
  `MAX_WAIT_MS` trailing+cap. `flushToDisk` (186-207) serializes via `serializeCanvas`
  (dangling-pruned + tabs), skips a byte-identical rewrite (189), and wraps the write in
  `mutePathEvents` + a 250 ms settle (`DISK_WRITE_SETTLE_MS`, 39).
- `coldOpen()` (223-238) implements SPEC_03 §4 exactly: doc non-empty → `"doc-wins"`, file never
  read, stale file overwritten; doc empty + file present → single `parseCanvas` +
  `seedDocFromCanvasData` (271-292, retains the `applyToYMap` geometry-key guard) →
  `"seeded-from-file"`; else `"empty"`.
- **SPEC_03 acceptance — implemented as a unit:** §3.1-3.4 (downstream-only observer, debounce,
  pruned serializer, mute-for-echo), §4 (all three cold-open branches), §7 (worst case = one
  debounce window), §8 (all three test groups, see §2.4).
- **SPEC_03 acceptance — MISSING, and this is the biggest gap in the batch:** the class is
  **never constructed in production**. Grep across `plugin/src/` finds `CanvasPersistence`,
  `createVaultPersistenceIO`, `CANVAS_SEED_ORIGIN`, and `coldOpen` referenced **only** from
  `canvas-persistence.test.ts`. SPEC_04 §2 Phase 1's actual deliverable — *"re-point the current
  `CanvasSync` disk writes through it"* — was **not done**. Disk writes still go through
  `CanvasSync.scheduleDiskWrite`/`writeToDisk` (`canvas-sync.ts:686-717`, `763-794`) in **both**
  flag states, and the cold-open decision still goes through `CanvasSync.subscribe`
  (`canvas-sync.ts:347-372`). `canvas-persistence.ts` is, today, a fully-tested library with
  zero callers.

### 2.3 Modified tracked files

| File | Lines | What changed |
|---|---|---|
| `plugin/src/main.ts` | +120 | `canvasBindings` (104) + `canvasModelBridges` (108) maps; flag-gated bypass of `reconcileLiveCanvas` in the `setOnRemoteCanvasUpdate` hook (778-787); binding+bridge construction inside `mountCanvasPresence` (1126-1155) with the legacy forced-initial-reconcile moved into the `else` (1156-1166); lockstep teardown on canvas close (970-975) and on session end (1225-1242); new `canWriteCanvasPath()` (1098-1107) extracted from the old inline `setCanWrite` closure and now shared by `CanvasSync.setCanWrite` (762) and the binding's `canWrite` seam (1146). `reconcileLiveCanvas` itself (986-1088) is **unchanged** — only bypassed. |
| `plugin/src/files/canvas-sync.ts` | 19 ± | **Export widening only, zero behaviour change**: `DEBOUNCE_MS`/`MAX_WAIT_MS` (20-21), `GEOMETRY_KEYS` (29), `CanvasData` (38), `parseCanvas` (43), `buildCanvasData` (67), `serializeCanvas` (101), `applyToYMap` (140) became `export`, so `canvas-persistence.ts` can reuse them instead of reimplementing. `GEOMETRY_KEYS` is exported but **not imported anywhere** — dead widening. |
| `plugin/src/files/vault-events.ts` | +8 | Added `!plugin.settings.useCanvasBinding` as a fourth condition on the `.canvas` branch of the vault `modify` handler (117-129). This one clause is what routes local canvas intent away from `handleLocalModify` when the flag is ON. |
| `plugin/src/types.ts` | +6 | `useCanvasBinding: boolean` on `LiveShareSettings` (32-37) + `useCanvasBinding: false` in `DEFAULT_SETTINGS` (65). |
| `plugin/src/ui/settings.ts` | +14 | "Use new canvas binding (experimental)" toggle (261-275), described as "leave OFF unless testing the redesign". |
| `plugin/src/__tests__/{control-ws,manifest,regression,sync}.test.ts`, `wp5/harness.ts` | +1 each | `useCanvasBinding: false` added to each local `createSettings`/`makeSettings` factory. Mechanical; required because `LiveShareSettings` gained a non-optional field. |
| `manifest.json`, `plugin/package.json`, `versions.json` | 2/2/3 | 0.5.9 → 0.6.0. |

Phase mapping: the bridge's apply half + the `main.ts` flag bypass = **Phase 2** (SPEC_04 §3).
The bridge's capture half + the `vault-events.ts` clause = **Phase 3** (SPEC_04 §4).
**Phase 4** (SPEC_04 §5, retire the legacy bridge and its guards) is **not** started — nothing
was deleted; `reconcileLiveCanvas`, the echo-breaker, the sequence gate, canvas mute windows and
`recentDiskWrites` all still exist and all still run when the flag is OFF. Despite the filename,
this batch is Phase 2 + Phase 3 wiring only, with Phase 1 built-but-unwired.

### 2.4 New test files

- `canvas-binding-apply.test.ts` (4 tests) — Phase 2. Two composition cases on the shipped
  `harness/two-peer.ts` (single remote move, 50-step streamed drag → follower `rePush === 0`),
  and two flag-routing cases wiring the **production** bridge over a `CanvasDouble`, asserting
  seed/structural → `reloadCanvasData`, geometry-only → `applyNodeGeometry` with **no** reload
  (line 124), removal → reload, and `onLocalChange` never firing across the whole apply sequence.
- `canvas-binding-capture.test.ts` (8 tests) — Phase 3, on the production bridge + a real
  `CanvasAdapter` over `CanvasDouble` + `InteractionDriver`, with its own local two-peer harness
  (68-101; the shipped `two-peer.ts` uses a different bridge and was left untouched). Best case
  is the CRITICAL NEGATIVE at 170-179: a direct `moveAndResize` with **no** interaction signal
  produces **zero** doc writes — the false-green the file bridge died of. Also covers I2
  suppression (181), I3 no-op (210), local add (252), local delete (237), and composition with a
  presence-style second subscriber on the same adapter hooks (266).
- `canvas-persistence.test.ts` (7 tests) — SPEC_03 §8, all three groups: P1 debounced pruned
  write + **zero** CRDT transactions originated (189-214, counts `afterTransaction`), P2 all
  three `coldOpen` branches, P3 the 50-delta streamed-drag no-feedback regression with the writer
  attached.

---

## 3. SOURCE-OF-TRUTH MAP

> **The one-line answer.** Flag **OFF** (production today, 0.6.0 default): the authoritative
> record of a local canvas edit is **the `.canvas` file's bytes** — the CRDT learns about local
> intent only by re-reading the file. Flag **ON**: the authoritative record of a local edit is
> **the live private-API canvas model**, but only its *geometry and membership*; the file is
> demoted to an output — and **no code was deleted**, so several legacy writers keep running
> underneath the new path.

### 3.1 Hop (a) — local edit → CRDT capture

| | Flag OFF (default / production) | Flag ON (redesign) |
|---|---|---|
| Trigger | Obsidian's own `canvas.requestSave()` writes the file → vault `modify` event | `adapter.onNodeInteractionStart` / `onNodeInteractionEnd` (`canvas-adapter.ts:440-454`), physically the monkey-patched `canvas.updateSelection` / `canvas.setDragging` (`canvas-adapter.ts:269-293`) |
| Gate | `vault-events.ts:117-129`: shared ∧ `.canvas` ∧ subscribed ∧ `!isRecentDiskWrite` ∧ **`!useCanvasBinding`** | none beyond `isApplying()` (`canvas-model-bridge.ts:189`) |
| Path | `CanvasSync.handleLocalModify` (`canvas-sync.ts:445`) → `vault.read` → `parseCanvas` → echo-breaker (480-487) → `applyLocalDiffToYMaps` (541-599) → local Y transaction | `captureFromModel` (`canvas-model-bridge.ts:186-229`) diffs `adapter.getLiveNodeIds`/`getNodeGeometry`/`getLiveEdgeIds` vs the **shadow** → `emitLocal` → `CanvasBinding.captureLocal` (`canvas-binding.ts:260-307`) → `writeRecordMinimal` (126-142) inside a `CANVAS_BINDING_ORIGIN` transaction |
| Baseline for the diff | `lastWrittenContent` (last file content **this client** knew) | the bridge **shadow** (last record the bridge applied or captured) |
| What can be captured | **everything in the file**: geometry, `text`, `type`, `file`, `color`, edge endpoints/sides — whatever the JSON says | **geometry + membership only**. `sameGeometry` (111-113) is the only node diff; edges are membership-only (215-228) |
| Write gates | `canWrite` (451) + `canWriteNode`/`canDeleteNode` inside the node diff (556, 572, 594) | `canWrite`/`canWriteNode`/`canDeleteNode` injected at `main.ts:1146-1148`, enforced at `canvas-binding.ts:267-276` |

> **LOUD — silent local data loss when the flag is ON.** Node content edits (typing in a card,
> changing a card's colour, swapping a `file` node's target) fire an interaction signal but
> produce **no** capture, because `captureFromModel` only compares geometry. And because
> `vault-events.ts:128` has switched the file off as a sync input, nothing else reads them
> either. Obsidian writes the new text to disk; the next CRDT change triggers
> `CanvasSync.scheduleDiskWrite` → `writeToDisk` (`canvas-sync.ts:686`, `763`) which serializes
> the doc over the file. The text edit is gone from disk and never existed in the CRDT.

> **LOUD — content-stripping on locally added nodes/edges when the flag is ON.** A node the local
> user creates is captured as geometry-only, `{ id, x, y, width, height }`
> (`canvas-model-bridge.ts:197`); a new edge as `{ id }` (218). `writeRecordMinimal`
> (`canvas-binding.ts:126-142`) deletes doc keys absent from the record, so if the doc already
> holds a fuller record for that id the extra keys are **deleted from the CRDT**. That
> shadow-vs-doc divergence is reachable: see the `tr.local` note in §3.2.

### 3.2 Hop (b) — remote CRDT delta → open canvas view

```text
Flag OFF                                          Flag ON
────────                                          ───────
Y.Doc change (any origin)                         Y.Doc change
   └── CanvasSync observer                           ├── CanvasSync observer (STILL ATTACHED)
       canvas-sync.ts:385-399                        │   canvas-sync.ts:385-399
        ├── onRemoteCanvasUpdate ──────┐             │    ├── onRemoteCanvasUpdate → main.ts:784
        │   (buildCanvasData: pruned)  │             │    │   → `if (useCanvasBinding) return;`  ← no-op
        └── scheduleDiskWrite          │             │    └── scheduleDiskWrite  ← still the ONLY disk writer
                                       │             └── CanvasBinding observer
   main.ts:783 ────────────────────────┘                 canvas-binding.ts:193-200
   reconcileLiveCanvas (main.ts:986-1088)                 └── skips `tr.local` and CANVAS_BINDING_ORIGIN
    ├── isBusy() → defer entirely (994)                   └── applyRemote (canvas-binding.ts:211-252)
    ├── id-set differs OR opts.initial → setData (1036)        ├── nodes first, then edges
    ├── else per-node applyNodeGeometry (1058)                 ├── diff vs shadow (recordsEqual)
    ├── movedEndpoint (edge endpoint moved) → setData (1073)   ├── geometry-only → applyNodeGeometry
    └── wrapped in mutePathEvents for the settle window        └── else → structuralReload = setData
        (1033, 1086)                                               OF THE WHOLE SHADOW (bridge:158-163)
```

> **LOUD — two live doc observers per open canvas when the flag is ON.** The flag gates the
> reconcile *side effect* (`main.ts:784`), **not** the observer. `CanvasSync`'s `observeDeep`
> (`canvas-sync.ts:400-401`) and the binding's `observeDeep` (`canvas-binding.ts:178-179`) are
> both attached to the same two maps for the same path. Both fire on every change, local or
> remote. That is intentional for persistence (see §3.3) but means any future code added to the
> `CanvasSync` observer will run behind the binding's back.

> **LOUD — `structuralReload` is a whole-canvas overwrite from the shadow.**
> `canvas-model-bridge.ts:158-163` calls `adapter.reloadCanvasData({ nodes: [...shadow.nodes],
> edges: [...shadow.edges] })`, and `CanvasDouble`/real `setData` **replaces** the live contents.
> Anything present in the live canvas but absent from the shadow is destroyed. During a cold seed
> `applyRemote` issues one `setData` per differing node **and one per differing edge** (each
> rebuilding the whole canvas), so the node phase repeatedly rebuilds the view with the edge list
> the shadow happens to hold at that moment — `edges: []` on a fresh mount.

> **LOUD — the binding ignores `tr.local`, and mount races `subscribe()`.**
> `canvas-binding.ts:198` returns early for `tr.local`. But `CanvasSync.subscribe`'s host branch
> seeds the doc **from the file** inside a local `doc.transact` (`canvas-sync.ts:347-360`), and
> `refreshCanvasMounts` fires `void this.canvasSync.subscribe(...)` **without awaiting**
> (`main.ts:947`) then mounts in the same pass (`main.ts:954-963`) because `subscribedPaths` is
> populated synchronously. So on a host the binding is typically constructed **before** the file
> seed lands, its constructor seed sees an empty doc, and the subsequent seed transaction is
> `tr.local` → the binding never applies it. Result: doc full, shadow empty, live view holding
> whatever the user had. The divergence self-heals on the next genuinely remote delta — via a
> full-shadow `setData` per entity — and until then any interaction trigger captures every live
> node/edge as a "local add" (geometry-only / `{ id }`), which `writeRecordMinimal` then uses to
> **strip** the richer keys off the doc records.

> **LOUD — the flag-ON apply path is NOT wrapped in `mutePathEvents`.** The OFF path brackets its
> `setData`/`moveAndResize` with `fileOpsManager.mutePathEvents(diskPath)` + a settle-window
> unmute (`main.ts:1033`, `1086`) so Obsidian's resulting `requestSave` cannot loop back. The ON
> path has no equivalent. Today that is harmless *only* because `vault-events.ts:128` short-
> circuits the canvas branch — the mute is the belt and the flag is the braces, and the belt is
> gone. `plugin.fileOpsManager.isPathMuted` is still checked first at `vault-events.ts:115`, so
> the un-muted window also lets `backgroundSync.handleLocalTextModify` (`vault-events.ts:132`)
> see every save the apply path provokes.

### 3.3 Hop (c) — CRDT → `.canvas` file on disk

**Identical in both flag states**, because `CanvasPersistence` is unwired (§2.2):

```text
Y.Doc change ─── CanvasSync observer (canvas-sync.ts:385-399, NO origin filter,
                 suppressed only while `recentLocalEdits` holds the path)
                   └── scheduleDiskWrite (686-717)  trailing DEBOUNCE_MS, capped MAX_WAIT_MS
                         ├── auditCanvasState (723)  SCATTER / DETACH telemetry
                         ├── serializeCanvas → buildCanvasData (67-99)  ← DANGLING EDGES PRUNED
                         └── writeToDisk (763-794)
                               ├── remoteSeq gate: yield if a remote delta landed after
                               │   the snapshot (774) and again after the folder-ensure await (783)
                               └── recentDiskWrites + mutePathEvents, cleared after
                                   VAULT_EVENT_SETTLE_MS (789-792)
```

With the flag ON, binding captures are ordinary **local** transactions and are *not* wrapped in
`recentLocalEdits`, so they do reach this observer — which is the only reason disk persistence
still works on the ON path. `remoteSeq` bumps only on non-local transactions
(`canvas-sync.ts:379-381`), so a capture never trips its own gate.

**Everyone who can write those bytes** (all four, concurrently, in both flag states):

| # | Writer | Where | Notes |
|---|---|---|---|
| 1 | `CanvasSync.writeToDisk` | `canvas-sync.ts:763-794` | CRDT-driven; sequence-gated; mutes its own echo |
| 2 | Obsidian's own `canvas.requestSave()` | private API (`canvas-adapter.ts:174`) | fires whenever the open canvas mutates, including as a side effect of our `setData` / `moveAndResize` |
| 3 | `BackgroundSync.writeToDisk` | `background-sync.ts:379-400` | **`.canvas` is in `TEXT_EXTENSIONS` (`utils.ts:184`)**, so `startAll` subscribes every shared `.canvas` as a **raw-text `Y.Text` doc** (`background-sync.ts:58-69`) whose observer writes the whole file on remote text deltas (`background-sync.ts:322-339`). `vault-events.ts:132` pushes local file text into it on **every** `.canvas` modify, in **both** flag states. **Pre-existing at HEAD; not introduced by this diff** — but it means one `.canvas` path is backed by *two independent CRDT documents* (`__canvas__:<path>` map-of-maps, subscribed at `main.ts:799`, and `<path>` `Y.Text`), each with its own disk writer and its own debounce. |
| 4 | `CanvasPersistence.flushToDisk` | `canvas-persistence.ts:186-207` | **not wired** — would be a fifth writer if it were, since nothing was re-pointed |

### 3.4 Hop (d) — file on disk → CRDT

| Route | Flag OFF | Flag ON |
|---|---|---|
| vault `modify` on an open/shared canvas | `handleLocalModify` (`canvas-sync.ts:445`) — the file **is** a sync input | **disabled** by `vault-events.ts:128` |
| `CanvasSync.subscribe`, role `host` | reads the file once and force-merges via `applyCanvasToYMaps` (`canvas-sync.ts:347-360` → `652-684`), which **deletes** doc nodes/edges absent from the file (667-669, 681-683) | **identical — the flag does not gate this.** Still a file→CRDT write, still delete-by-omission, on every subscribe (including lazy-subscribe on canvas open, `main.ts:942-947`) |
| `CanvasSync.subscribe`, role `guest` | doc non-empty → writes doc to disk; else baseline = disk (`canvas-sync.ts:361-372`); then a forced initial `onRemoteCanvasUpdate` (413-419) | same, except the forced initial reconcile becomes a no-op at `main.ts:784`; the binding's constructor seed is meant to replace it (`main.ts:1129-1131`) but runs **before** `waitForSync` completes (§3.2) |
| `CanvasPersistence.coldOpen` (SPEC_03 §4 decision: doc-wins vs seed-from-file) | n/a | **implemented and unit-tested, never called** |
| raw-text channel | `backgroundSync.handleLocalTextModify` (`vault-events.ts:132` → `background-sync.ts:264`) pushes the file's JSON text into the parallel `Y.Text` doc | **identical — not flag-gated** |

**Net:** flag ON removes exactly *one* of the four file→CRDT routes (the `modify` handler). The
host subscribe seed and the raw-text channel survive, so SPEC_03 §2's invariant — *"the file is
never a sync input while the canvas is open"* — **does not hold in the wired system**, even with
the flag ON.

### 3.5 Where both paths can be live for the same canvas

- **Both apply paths never run simultaneously**: `main.ts:784` is a hard either/or, and
  `mountCanvasPresence` builds the binding only in the flag-ON branch (`main.ts:1126`). But the
  flag is read **live** from `this.settings` on every event, while bindings are created only at
  mount. **Toggling the setting mid-session desynchronises them**: flip ON with a canvas already
  open → no binding exists for that path (nothing constructs one until the canvas is re-opened)
  **and** `reconcileLiveCanvas` is now bypassed → the open view stops receiving remote updates
  entirely, and `handleLocalModify` is also skipped → that canvas silently stops syncing in both
  directions. Flip OFF with a binding mounted → the binding's observer keeps applying remote
  deltas **and** `reconcileLiveCanvas` starts running **and** `handleLocalModify` resumes → all
  three writers live at once on the same view.
- **Disk writers 1–3 in §3.3 are always all live**, in both flag states.
- **Clobber ordering to remember when debugging:** `CanvasSync`'s disk writer serializes the
  **canvas CRDT**; `BackgroundSync`'s writes the **text CRDT**; Obsidian writes the **live view**.
  Whichever debounce fires last wins the file. Only writer 1 has a sequence gate, and it gates
  against canvas-CRDT deltas only — it knows nothing about writers 2 and 3.

---

## 4. EDGES specifically

**Y.Doc representation.** `doc.getMap<Y.Map<unknown>>("edges")`: edge id → `Y.Map` of flat
primitive fields, exactly the `.canvas` edge object (`id`, `fromNode`, `toNode`, `fromSide`,
`toSide`, plus cosmetics). Ids are **Obsidian's own** — never derived by the plugin: the doc key
comes from `edge.id` when parsing (`canvas-sync.ts:53-56`) and from `canvas.edges.keys()` when
read live (`canvas-adapter.ts:374-378`). There is no geometry on an edge; its rendered route is
recomputed by Obsidian from the endpoint nodes plus `fromSide`/`toSide`.

### 4.1 Hop (a) capture — edges

- **Flag OFF.** Edges are diffed from the file by `applyLocalDiffToYMaps`, called **without**
  `opts` (`canvas-sync.ts:493`; nodes pass `opts` at 492). Three asymmetries follow, all inside
  541-599:
  - no per-entity lock gate and no `onLocalNodeChange` claim for edges (556, 572, 594 are all
    `opts`-guarded);
  - the "present in my base, absent from the Y map" case (i.e. a **remote delete**) is a
    deliberate **no-op for nodes** (GAP-2 no-resurrect, 575-580) but for edges falls through to
    581-586, which **re-creates** the edge: `new Y.Map()` → `ymap.set(id, yObj)` →
    `applyToYMap`. So an edge deleted by a peer **can be resurrected** by a local edit; a node
    cannot. This is a **whole-value replacement**: the `Y.Map` identity is swapped, so every
    field is re-set from local disk and any concurrent remote field change on that edge is lost.
  - for an edge that *is* in the Y map, `applyKeyDiff` (175-196) applies per-field merge, and its
    delete-guard is keyed on `GEOMETRY_KEYS` = `x/y/width/height` (192) — **node-shaped, inert
    for edges**. Edge keys missing from a partial file read therefore *are* deleted.
- **Flag OFF, bulk rewrite.** On a genuine local node delete, `pruneEdgesForDeletedNodes`
  (`canvas-sync.ts:496-498`, `603-618`) **bulk-deletes every edge** whose `fromNode`/`toNode` is
  in the deleted set — a cascade driven by node membership, run inside the same transaction.
- **Flag ON.** `captureFromModel` treats edges as **membership only**
  (`canvas-model-bridge.ts:215-228`):
  - new live edge → `const rec: CanvasRecord = { id };` (218) → `emitLocal` → the doc entry is
    created holding **only `id`**. `fromNode`, `toNode`, `fromSide`, `toSide` are **never
    captured**. There is no `adapter.getEdge*` read surface at all — the adapter exposes
    `getLiveEdgeIds()` and nothing else (`canvas-adapter.ts:374-378`).
  - a **field change** on an existing edge (drag an endpoint to a different side, relabel,
    recolour) is **completely invisible** to capture — the loop only checks `edges.has(id)`.
  - edge gone from `canvas.edges` → `record: null` (226) → `captureLocal` deletes the whole map
    entry (`canvas-binding.ts:281-287`). No cascade prune on the capture side; edges disappear
    only because Obsidian removes them from `canvas.edges` when an endpoint node is deleted.
  - because `writeRecordMinimal` (`canvas-binding.ts:126-142`) deletes doc keys absent from the
    record, a `{ id }` capture against an **existing** doc edge **strips** `fromNode`/`toNode`/
    sides from the CRDT. Reachable exactly when shadow and doc diverge — the `tr.local` /
    mount-race condition in §3.2.

### 4.2 Hop (b) apply — edges

- **Flag OFF.** `reconcileLiveCanvas` treats edges purely as an **id set**
  (`main.ts:1004-1016`): any id-set difference (nodes or edges) escalates to a whole-canvas
  `setData`. An edge **field** change with an unchanged id set is therefore **never applied** to
  the live view. Plus the explicit B11 hack at `main.ts:1024-1028` + `1072-1078`: if a node that
  is an edge endpoint actually moved, a full `setData` is issued **solely to re-route edges**,
  because per-node `moveAndResize` leaves live edges on their old routing.
- **Flag ON.** `applyEdgeUpsert` is **always** a full `structuralReload()`
  (`canvas-model-bridge.ts:290-301`; the comment at 291 states "Edges have no live per-edge
  setter in Phase 2"), and so is `applyEdgeRemove` (303-310). `applyRemote` applies **nodes
  before edges** (`canvas-binding.ts:218-247`, comment at 218) and emits **one `setData` per
  differing edge**, each rebuilding the entire canvas from the shadow. Consequences:
  - N differing edges ⇒ N whole-canvas rebuilds in one synchronous `applyRemote` span;
  - during the node phase every rebuild passes whatever edge list the shadow currently holds
    (`edges: []` on a fresh mount), so live edges are dropped and re-added within a single apply;
  - **no B11 reflow equivalent**: a geometry-only node move takes the `applyNodeGeometry` branch
    (`canvas-model-bridge.ts:263`) with **no** `setData`. The legacy path's explicit reflow hack
    was dropped in favour of the SPEC_02 §7 claim that Obsidian re-routes multi-edges natively —
    which is spike item 3 (SPEC_02 §9) and is **unverified in a live vault**.
- **Dangling tolerance.** SPEC_02 §7 requires apply not to throw on an edge whose endpoint is
  absent. The bridge honours the ordering (nodes first) but does **no pruning**: whatever the
  shadow holds is handed to `setData`, dangling or not. The OFF path is the opposite —
  `buildCanvasData` (`canvas-sync.ts:88-95`) prunes dangling edges out of the reconcile snapshot,
  so a live edge whose endpoint is missing vanishes from the id set → escalates to `setData` →
  disappears from the view while remaining in the CRDT.

### 4.3 Hops (c)/(d) — edges

- **CRDT → disk** (both flag states): `buildCanvasData` (`canvas-sync.ts:83-96`) copies every
  key and prunes an edge **only** when `fromNode` or `toNode` is a `string` naming an absent node
  (93-94). An edge captured as `{ id }` has **no** `fromNode`, so `typeof from === "string"` is
  false, the guard does not fire, and the edge is written to disk as `{"id": "..."}` — an edge
  object with no endpoints.
- **disk → CRDT**: OFF via `handleLocalModify` as in §4.1. ON, the only surviving route is
  `CanvasSync.subscribe`'s host seed → `applyCanvasToYMaps` (`canvas-sync.ts:671-683`), which
  upserts every file edge and **deletes any doc edge absent from the file**.
- **Test coverage for edges in this batch: zero.** `driveEdge` exists in the harness
  (`__tests__/harness/interaction-driver.ts:98-102`) and is **never called** by any of the three
  new files; the capture test's `makeTwoPeer({ nodes?, edges? })` accepts an `edges` array
  (`canvas-binding-capture.test.ts:88-101`) that **no call site ever passes**. The only edge
  assertions anywhere in the batch are the dangling-prune checks in
  `canvas-persistence.test.ts:151-182`, which exercise `buildCanvasData`, not the bridge.

---

## 5. Gaps & risks

1. **SPEC_03/Phase 1 built but unwired.** `CanvasPersistence` has zero production callers (§2.2).
   The disk writer is still `CanvasSync`; the cold-open decision is still `CanvasSync.subscribe`.
   SPEC_04 §2's deliverable is unmet, and SPEC_03 §2's "file is not a sync input while open"
   invariant does not hold in the wired system (§3.4).
2. **Local node content and all edge fields are not captured when the flag is ON** (§3.1, §4.1) —
   with the file simultaneously switched off as a sync input, this is a silent local-data-loss
   path, not merely missing coverage.
3. **`structuralReload` writes the whole shadow over the live canvas** (§3.2). Combined with
   geometry-only / `{ id }`-only capture records, a locally created node or edge can be rewritten
   from an impoverished shadow.
4. **Mount races `subscribe()` and the binding ignores `tr.local`** (§3.2) — a documented,
   reachable shadow-vs-doc divergence, and the precondition for `writeRecordMinimal` stripping
   keys off doc records.
5. **Mid-session flag toggle desynchronises the two paths** (§3.5), including a state where a
   canvas silently stops syncing in both directions.
6. **The flag-ON apply path lost the `mutePathEvents` bracket** (§3.2) that the legacy path uses.
7. **The SPEC_02 §9 Phase-0 spike was not run**; SPEC_04 §4 makes it a prerequisite for Phase 3.
   `CAPTURE_TRIGGERS` (`canvas-model-bridge.ts:88-91`) is inert documentation of an untested
   assumption, and the dropped B11 reflow hack (§4.2) rests on spike item 3.
8. **No manual E2E was recorded** for either flag state. SPEC_04's Phase-2 decisive check
   ("flag ON in both vaults, guest drags, host must not scatter") and the Phase-3 five-case
   matrix are both unrun-as-far-as-any-artifact-shows.
9. **Dead export.** `GEOMETRY_KEYS` was widened to `export` (`canvas-sync.ts:29`) and is imported
   nowhere; the bridge defines its own copy (`canvas-model-bridge.ts:94`). Two definitions of the
   same constant now exist.
10. **Do the three NEW test files exercise TRUE concurrent edits from two peers before an
    exchange? — PARTIALLY, and never on the same entity.**
    - `canvas-binding-capture.test.ts:221-235` ("bidirectional: both peers drive different
      nodes") **does** have both peers capture locally **before** any exchange: `a.driver
      .driveDrag("n1", …)` at 224, `b.driver.driveDrag("n2", …)` at 225, `exchange(a, b)` only at
      226. So genuinely concurrent in the CRDT sense — but on **disjoint nodes** (`n1` vs `n2`),
      which is the non-conflicting case.
    - **No new test has two peers writing the same node, the same key, or any edge before an
      exchange.** There is no last-writer-wins case, no same-node concurrent drag, no
      concurrent add/delete of the same id.
    - **No new test interleaves a local capture with an in-flight remote delta.** I2 suppression
      is tested only by flipping a manual `applying` boolean
      (`canvas-binding-capture.test.ts:181-208`), never by a real delta arriving mid-drag.
    - The other two files are strictly sequential: `canvas-binding-apply.test.ts` is
      "A drags → `waitQuiescent()` → assert"; `canvas-persistence.test.ts` uses
      `applyRemoteCanvasDelta` (39-48), which clones the doc, mutates the clone, and applies it
      back — settle-then-exchange by construction.
    - Everything in §4 (edge mechanics) is therefore **completely unexercised** by the new tests.

---

## 6. Verification checklist for whoever picks this up

Gates 1–2 are already **green** as of 2026-07-26 (§1); re-run them first to confirm the tree has
not drifted, then proceed to 3+, which are the ones that have **never** been run.

```bash
# 1 — typecheck + bundle (expect: exit 0)
cd plugin && npm run build

# 2 — full suite (expect: 526 passed / 32 files, 0 fail)
cd plugin && npm test

# 3 — just the three new files, to see the +19 in isolation
cd plugin && npx vitest run src/__tests__/canvas-binding-apply.test.ts \
                           src/__tests__/canvas-binding-capture.test.ts \
                           src/__tests__/canvas-persistence.test.ts

# 4 — the pre-existing canvas gates must be untouched (Phase-0 T1-T10 + SPEC_04 matrix)
cd plugin && npx vitest run src/__tests__/canvas-binding.test.ts \
                           src/__tests__/canvas-matrix.test.ts \
                           src/__tests__/canvas-sync.test.ts \
                           src/__tests__/canvas-adapter.test.ts

# 5 — lint the three files this batch created (repo-wide biome has ~93 pre-existing errors;
#     scope it, per the Phase-0 no-mass-reformat constraint)
cd plugin && npx biome check src/canvas/canvas-model-bridge.ts \
                            src/files/canvas-persistence.ts \
                            src/__tests__/canvas-binding-apply.test.ts \
                            src/__tests__/canvas-binding-capture.test.ts \
                            src/__tests__/canvas-persistence.test.ts

# 6 — confirm the unwired-persistence finding for yourself (expect: hits ONLY in the test file)
cd plugin && grep -rn "CanvasPersistence\|createVaultPersistenceIO\|coldOpen\|CANVAS_SEED_ORIGIN" src/

# 7 — confirm production bundle hygiene held through the version bump
cd plugin && grep -cE "e2e-control|LIVESHARE_E2E|e2eControlPort" main.js   # expect 0

# 8 — version consistency across the three bumped files (expect all 0.6.0)
grep -n '"version"' manifest.json plugin/package.json && grep -n '0.6.0' versions.json
```

Then the gates that carry the real risk and that **no artifact shows as run**:

- **SPEC_02 §9 Phase-0 spike, real vault.** Log which of `updateSelection` / `setDragging(false)`
  actually fires for: single move, each resize handle, multi-select drag, paste, text-node edit,
  node add, node delete, **edge add**, **edge delete**. Correct
  `canvas-model-bridge.ts:88-91` and remove the `⚠ ASSUMPTION` block.
- **Spike item 3 specifically:** does `moveAndResize` alone re-route a multi-edge node in a live
  vault? If not, the dropped B11 reflow hack (§4.2) must return to the ON path.
- **SPEC_04 §3 Phase-2 decisive check:** flag ON in both vaults, guest drags, watch the host —
  the host must not scatter.
- **SPEC_04 §4 Phase-3 matrix, flag ON both sides:** initial sync (positions **and** edges
  connected), multi-edge move, simultaneous bidirectional drag, add/delete node **and edge** from
  each side, `file`/Properties node interaction.
- **Regression checks the automated suite does not cover** (each maps to a §5 item): edit a card's
  **text** with the flag ON and confirm whether it survives a subsequent disk write (§5.2); draw
  a **new edge** with the flag ON and inspect the resulting `.canvas` for an endpoint-less edge
  (§4.1, §4.3); toggle the setting with a canvas already open and confirm sync direction (§5.5).
- **Two-vault soak** with the flag ON, watching for the four-writer interaction in §3.3 —
  in particular whether the raw-text `.canvas` channel (writer 3) and the canvas-CRDT channel
  (writer 1) fight over the file.
