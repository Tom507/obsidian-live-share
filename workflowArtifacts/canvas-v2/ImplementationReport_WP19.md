# Implementation Report — WP19

Attempt: 1

## Status: PARTIALLY_DONE

All four ACs are implemented and all 8 visible WP19 tests pass. The work package is
**functionally complete**, but it cannot be handed over green: **8 pre-existing tests
across 5 files pin the exact behaviour AC1 abolishes** (`delete == key absence`). I have
**not** touched them — reported below as `SPEC_CONTRADICTION`, per the no-deletion-licence
boundary. That decision belongs to Worker 3 / the charter owner, not to this sub-agent.

---

## Completed Work

| AC | Status | Notes |
|---|---|---|
| AC1 — a user delete writes a tombstone; no record's field container is destroyed by any delete path | DONE | Both delete branches of `applyIntentPlan` (node and edge) now call WP12's `applyTombstoneOp(deletedMap, id, {t, by, on:true})` and touch `nodes`/`edges` **not at all**. `maps[del.kind].delete(del.id)` is gone. `Y.Map` observer tripwires in TP01/TP02 confirm zero key removals. |
| AC2 — delete-wins / no-resurrect hold observably | DONE | Capture half: `handleLocalModify` now feeds `planIntentDiff` a **doc-backed** `TombstoneView` (`createDocTombstoneView`) instead of the P0 placeholder `{isDeleted: () => false}`. Reconciler half: `getCanvasSnapshot`, the remote-delta hook and the guest-mount reconcile all pass the `deleted` map to `buildCanvasData`, and the `deleted` map is now a **third observed container** so a tombstone-only remote delta wakes the live-view hook at all. |
| AC3 — node→edge cascade preserved, expressed as suppression rather than key removal | DONE | `pruneEdgesForDeletedNodes` is **removed, not rewritten**. `buildCanvasData` already builds `visibleNodeIds` from the same tombstone predicate and refuses to emit an edge whose endpoint is not in it — so the cascade is a consequence of the one suppression rule instead of a second mechanism that could disagree with it. Bonus: it now also covers a **remote** node delete, which the old local-capture-only prune never did. |
| AC4 — delete + undo restores every field value | DONE | Falls out of AC1 structurally: the delete never reaches the field container, so `applyTombstoneOp(..., on:false)` un-suppresses the *same* `Y.Map` object. TP06 asserts container identity, every field by name, the key set, and byte equality of `serializeCanvas` either side of the cycle. |

**Not changed, deliberately:** `plugin/src/canvas/reconcile-plan.ts`. Charter §6 lists it under
"required changed files" and §3 says `diffRecords` "must see suppressed records as absent" —
it already does, because suppression is applied **upstream**, at the `buildCanvasData`
boundary that produces the `desired` snapshot `planReconcile` consumes. TP04 asserts
`planReconcile(...) === "structural"` for a tombstone-only delta and passes unmodified.
Editing a pure module that needs no edit would have been churn with regression risk.

---

## Blocked Items

| Item | Blocker | Workaround attempted |
|---|---|---|
| Green full-suite handover (`npm test` 0 failed) | **SPEC_CONTRADICTION** — 8 pre-existing tests assert `nodesMap.has(id) === false` / `edgesMap.get(id) === undefined` after a **local capture-path delete**. That is the V1 spelling of "the delete happened", and AC1 states verbatim that "no record's field container is destroyed by **any** delete path". The two statements cannot both hold. | None available. There is no implementation that both tombstones the record (WP19 TP01/TP02/TP05/TP06) and removes its key (the 8 legacy tests). I verified this is not an artefact of my design: mutation A (re-adding `maps[del.kind].delete(del.id)` *alongside* the tombstone) turns 7 of the 8 WP19 tests RED. Per the batch boundary I did **not** edit, skip, retitle or soften any of them. |

### The 8 contradicting tests, exactly

All eight are the same class: the property under test (delete honoured / delete gated /
cascade / hand-over receipt) is **fully preserved** by this implementation — only the
*oracle spelling* is V1. Each would become correct by replacing the key-presence assertion
with the V2 one (`isTombstoneSuppressed(readTombstoneEntry(deleted, id))` is `true`, and/or
the id is absent from `buildCanvasData(nodes, edges, deleted)`).

| # | File | Test | Failing assertion | What is true instead |
|---|---|---|---|---|
| 1 | `plugin/src/__tests__/canvas-sync.test.ts:359` | `genuine local delete removes the node from the Y map` | `nodesMap.size === 1`, `nodesMap.get("n2") === undefined` | `n2` is tombstoned `on:true`; `buildCanvasData` omits it. Identical scenario to WP19 TP01. |
| 2 | `plugin/src/__tests__/canvas-sync.test.ts:587` | `prunes edges in the shared doc when their endpoint node is locally deleted (GAP-5)` | `edgesMap.get("e1") === undefined` | `e1`'s key and fields survive; `buildCanvasData`/`serializeCanvas` still omit it because `n2` is not in `visibleNodeIds`. No dangling edge ever reaches the file. Identical scenario to WP19 TP05. |
| 3 | `plugin/src/__tests__/canvas-sync.test.ts:1008` | `a genuine local DELETE of a whole record is still honoured (protection is per-key only)` | `nodesOf().get("n2") === undefined`, `nodesOf().size === 1` | Same as #1. |
| 4 | `plugin/src/__tests__/w4-canvas-integrity.test.ts:331` | `A7 a genuine WHOLE-record delete is unaffected by PROTECTED_KEYS` | `docRecords(doc,"nodes").n1 === undefined` and `.edges.e1 === undefined` | Same as #1 + #2 combined. `PROTECTED_KEYS` membership is unchanged and still exported. |
| 5 | `plugin/src/__tests__/v2/wp4/test_tp01_intent_basis_visible.test.ts:231` | `T4 with the view open and a hand-over receipt, the delete still happens` | `nodes.has("n2") === false` | The delete still happens — as a tombstone. The companion assertion on the same test (`getRecordState(...) === "absent"`) still passes, i.e. the *gating* half of the property is untouched. |
| 6 | `plugin/src/__tests__/v2/wp5v2/test_tp05_handover_and_close_visible.test.ts:168` | `T2 after a confirmed apply the same omission is a deletion` | `nodes.has("n2") === false` | Same as #5. |
| 7 | `plugin/src/__tests__/v2/wp5v2/test_tp05_handover_and_close_visible.test.ts:192` | `T3 an interacting record is never handed over, so it cannot be deleted` | `nodes.has("n1") === false` | The **discriminating** half of T3 — `nodes.has("n2") === true`, the card the user was holding was NOT deleted — still passes. Gating is provably untouched: `plan.deletes` comes from `planIntentDiff`, which this WP did not change; only the *action* taken for an id already in `plan.deletes` changed. |
| 8 | `plugin/src/__tests__/v2/wp6/chaos_degraded_adapter.test.ts:595` | `D2 seam ...: the unlanded apply leaks and deletes` | `off.newRecordLocal === false` (i.e. `hasNode(doc1,"n4") === false`) | Same as #5, in the discrimination-seam direction. |

**Recommendation for Worker 3:** these are V1 oracles that WP19's charter explicitly
supersedes (§2 "replace delete-by-diff-logic with the tombstone flag throughout";
AC3 "rather than key removal"). Updating the eight assertions to the V2 spelling is a
one-line change per site and preserves every property each test is about. I did not make
that change because it is a pre-existing-test edit and outside this sub-agent's licence.

---

## Changes Made

**`plugin/src/files/canvas-sync.ts`** (modified)
- Import `applyTombstoneOp` from `../canvas/canvas-tombstone`.
- New exported `DELETED_MAP_NAME = "deleted"` — the single spelling of the container name.
- New exported `createDocTombstoneView(deletedMap)` — the doc-backed `TombstoneView`, asking
  WP12's `isTombstoneSuppressed`/`readTombstoneEntry` and nothing else (C12 AC2: one predicate,
  not three copies). Keyed by record id, exactly as the serializer's `isRecordSuppressed` keys it.
- New exported `nextTombstoneTime(deletedMap)` — the Lamport advance: one past the highest `t`
  this replica can see. No clock, no randomness. A malformed stored entry contributes nothing.
- `tombstoneView` field: `TombstoneView` → `TombstoneView | null`, default `null` = "ask the doc".
  `setTombstoneView` is unchanged and still the injection seam.
- `planCapture(save, surface)` → `planCapture(save, surface, tombstones)`.
- `applyIntentPlan(...)` takes `deletedMap` and `author` (`String(doc.clientID)`).
- **Delete branch:** both node and edge paths now end in `applyTombstoneOp(deletedMap, del.id,
  {t: stamp, by: author, on: true})`. The lock gates (`canDeleteNode`, `canWriteEntity`, the
  `denied` list and its baseline hold) are byte-unchanged. One stamp per pass, read before the
  first write.
- **`pruneEdgesForDeletedNodes` removed** (its call site and its method body), replaced by a
  comment explaining why nothing takes its place. `readEndpointNodeId` stays — `auditCanvasState`
  is its other caller.
- `getCanvasSnapshot`, the remote-delta observer payload, and the guest-mount reconcile all pass
  the `deleted` map to `buildCanvasData`.
- `subscribe` observes and unobserves the `deleted` map alongside `nodes`/`edges`.

**`plugin/src/files/canvas-persistence.ts`** (modified)
- Imports `DELETED_MAP_NAME`; new `private readonly deletedMap`.
- `start()` / `destroy()` observe / unobserve it (a delete writes *only* there, so the single
  writer would otherwise never be woken by one).
- `flushToDisk` uses the **three-argument** `serializeCanvas(nodesMap, edgesMap, deletedMap)`.

**Not modified:** `reconcile-plan.ts`, `canvas-tombstone.ts` (WP12's API was sufficient as
shipped — no parallel names invented), `canvas-presence.ts`, `canvas-binding.ts`,
`canvas-model-bridge.ts`, `main.ts`, `GEOMETRY_KEYS` (exact membership `{x,y,width,height}`,
still exported), `PROTECTED_KEYS`, `package.json`, plugin version, `server/`, `docker/`,
`deploy/`. Zero new runtime dependencies. No `setTimeout`, no timing constant, no wall-clock.
No test file was created, deleted or edited.

---

## Visible Test Results

| Test | Status | Notes |
|---|---|---|
| TP01 `test_tp01_user_delete_writes_tombstone_visible` (2 cases) | PASS | Tombstone `on:true` read through WP12's predicate; container identity and every field preserved; `buildCanvasData` omits it; `Y.Map` observer records **zero** `action === "delete"`. |
| TP02 `test_tp02_edge_delete_keeps_field_container_visible` (2 cases) | PASS | Edge branch tombstones; edge key set unchanged; parallel control edge between the same two cards unsuppressed; no `edgesMap.delete`. |
| TP03 `test_tp03_local_upsert_does_not_resurrect_visible` | PASS | 3 replicas, all writes ordered. Stale save writes nothing locally **and nothing on the wire** (asserted on a replica rebuilt from the outbound delta). |
| TP04 `test_tp04_reconciler_removes_tombstoned_record_visible` | PASS | Tombstone-only remote delta drives the live-view hook; `getCanvasSnapshot` agrees; `planReconcile` returns `"structural"`. |
| TP05 `test_tp05_node_delete_cascades_edges_via_suppression_visible` | PASS | Every node and edge key survives; cascaded edge's fields survive; edge gone from the view **and** from the bytes `CanvasPersistence` writes; control edge untouched. |
| TP06 `test_tp06_delete_undo_restores_every_field_visible` | PASS | Container identity unchanged; all 10 fields asserted by name; key set unchanged; `serializeCanvas` byte-identical to pre-delete. |

`8 passed (8)`, 6 files.

---

## Falsification Results

Every mutation was applied to production source, the WP19 suite run, then the mutation
reverted and the suite re-run.

| AC | Mutation applied | Test that went RED | Restored green? |
|---|---|---|---|
| AC1 (+AC2, AC3, AC4) | **A** — re-add `maps[del.kind].delete(del.id)` *alongside* the tombstone write (tombstone still correct) | TP01 both cases, TP02 both cases, TP03, TP05, TP06 — **7 of 8**. Only TP04 (remote path) survived, correctly. | yes |
| AC2, capture half | **B** — `handleLocalModify` uses `{ isDeleted: () => false }` instead of `createDocTombstoneView(deletedMap)` | TP03 only: *"the tombstoned record's stored text was overwritten by the stale save"*. TP01/TP02/TP05/TP06 stayed green, correctly — they do not exercise a resurrect. | yes |
| AC2, reconciler half | **C** — drop `deletedMap.observeDeep(observer)` from `subscribe` | TP04 only: *"no live-view reconcile ran: a tombstone-only remote delta is invisible to the subscription"* (`expected 0 to be greater than 0`) | yes |
| AC3 | **D** — `CanvasPersistence.flushToDisk` back to the two-argument `serializeCanvas(nodesMap, edgesMap)` | TP05 only: file on disk still listed `hub` (`['c','d','hub','spoke']`). The view half of TP05 stayed green, so the mutation isolated exactly the file half. | yes |
| AC4 (discriminant) | **E** — the *re-create* defect: replace the record's `Y.Map` with a fresh one carrying the **same field values** (no key removal, no field loss — only object identity changes) | TP01 case 1, TP02 case 1, TP06 — *"the record was re-created rather than un-suppressed — a peer's concurrent edit is gone with it"*. TP01 case 2 (the key-removal observer) correctly stayed GREEN, proving identity is a strictly stronger oracle than key presence. | yes |

No test stayed green under a mutation that should have broken it. Mutation E is the important
one: it is the failure mode that a key-set or field-value comparison alone cannot see, and it is
caught.

---

## Full-suite gate

- `npm test` (from `plugin/`, Vitest 4.0.18, `--reporter=dot`, 41.2 s):
  **Test Files 5 failed | 196 passed (201) · Tests 8 failed | 1271 passed (1279)**
  - Baseline before this WP: `6 failed | 195 passed (201)` files, `8 failed | 1271 passed (1279)` tests.
  - The 8 failures are **a different set** from the baseline's 8: the WP19 tests are now green,
    and the 8 legacy `delete == key absence` tests listed above are now red. Pass count is
    unchanged at 1271; target 1279/0 is unreachable without the test updates described in
    **Blocked Items**.
- `npx tsc --noEmit`: **PASS** (no output).
- `npm run build` (`tsc -noEmit -skipLibCheck && node esbuild.config.mjs production`): **PASS**.
  `plugin/main.js` is not reported modified by git.

---

## Summary for Worker 3

Deletion is now a **value**, not an absence, on every path a user can reach. A local delete of a
card or an arrow writes `deleted[id] := {t, by, on:true}` through WP12's `applyTombstoneOp` and
does not touch the record's `Y.Map` at all — the container keeps its identity and every field,
so `applyTombstoneOp(..., on:false)` restores the whole record and `serializeCanvas` returns
byte-identical output either side of the cycle. To trigger it: subscribe a canvas as host, hand
the ids to the view via `setSurfaceStateProvider`, save a `.canvas` without a record, then read
`readTombstoneEntry(doc.getMap("deleted"), id)`. Suppression reaches the user through exactly
three now-wired seams — `CanvasPersistence`'s three-argument `serializeCanvas`,
`CanvasSync.getCanvasSnapshot`, and the `setOnRemoteCanvasUpdate` payload — and the `deleted`
map is observed by both classes, which is what makes a tombstone-only remote delta visible at
all. The node→edge cascade is no longer an action: it is `buildCanvasData`'s `visibleNodeIds`
guard, i.e. the same predicate, which means it can no longer disagree with the serializer and it
now covers remote deletes too.

**Rough edges / uncertainties.** (1) The blocking issue is the eight legacy tests above; nothing
about them is subtle, but the fix is a pre-existing-test edit I have no licence for — please rule
on it before Worker 4 runs. (2) The Lamport stamp is derived by scanning the `deleted` map for
its maximum `t` on every pass that contains a delete. That is correct and clock-free, but it is
O(tombstones) per delete pass and it is the natural place for WP25's GC to interact — if GC
removes entries, the stamp can go backwards relative to a peer that still holds them, so WP25
should carry the high-water mark rather than rely on a rescan. (3) The tombstone is written for
an id even when the doc holds no record under it (e.g. a record the WP18 ingest gate refused at
seed time). That is deliberate — the delete intent comes from the Surface-Shadow, not the doc —
and harmless, but it means `deleted` can name ids `nodes`/`edges` never contained. (4) `main.ts`
needed no change at all: the doc-backed tombstone view is the default, so there is no wiring for
anyone to forget.
