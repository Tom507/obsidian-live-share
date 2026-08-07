# SPEC 02 — CanvasModelBridge (adapter over the private Canvas API)

> How Obsidian's live canvas implements the `CanvasModelBridge` that `SPEC_01`
> consumes. This is where the private-API reality meets the clean contract.
> **Spec only — not implemented.**

Related: `SPEC_01_CanvasBinding.md` (the consumer), `../CANVAS_SYNC_REDESIGN.md`
(rationale). Ground-truth private API is documented in
`plugin/src/canvas/canvas-adapter.ts` (existing) — this spec extends it.

---

## 1. Purpose

Provide `SPEC_01`'s two edges over the real canvas:

- **Remote → model** mutators: `applyNodeUpsert/Remove`, `applyEdgeUpsert/Remove`.
- **Model → binding** capture: `onLocalChange`, emitted **only for
  user-originated edits**.

The single hardest requirement — and the reason the file bridge failed — is
sourcing the capture signal correctly. §4 is the crux of this spec.

---

## 2. Where it lives

Extend the existing `CanvasAdapter` (`plugin/src/canvas/canvas-adapter.ts`), which
already isolates the private API (monkey-patches `updateSelection`/`setDragging`/
`markViewportChanged`, exposes `nodes`/`edges` Maps, `moveAndResize`, `setData`,
viewport, overlay host). Add a `createCanvasModelBridge(view): CanvasModelBridge`
factory (or extend the adapter interface) that the binding is constructed against.
Nothing outside the adapter file touches `view.canvas`.

---

## 3. Remote → model mutators

| Method | Implementation | Notes |
|---|---|---|
| `getNodeIds()` / `getEdgeIds()` | keys of `canvas.nodes` / `canvas.edges` Maps | already present as `getLiveNodeIds/EdgeIds` |
| `getNode(id)` / `getEdge(id)` | read `canvas.nodes.get(id)` → flatten known fields to a record | must return the SAME field set the doc stores, so `recordsEqual` is meaningful |
| `applyNodeUpsert(id,rec)` | if node exists: apply geometry via `moveAndResize` + set content fields (text/file/color/…) that changed; if absent: **add a node** | see §5 (add/remove) and §6 (content vs geometry) |
| `applyNodeRemove(id)` | remove the node from the canvas | see §5 |
| `applyEdgeUpsert(id,rec)` | add or update an edge (endpoints/sides/label/color) | see §7 |
| `applyEdgeRemove(id)` | remove the edge | see §7 |

All mutators run inside the binding's `applyingRemote` span. They **must not**
cause `onLocalChange` to fire for the same change (I5). Because Obsidian *will*
fire its own save/change reactions, the capture source (§4) is chosen so those
reactions are not mistaken for user edits, and `SPEC_01` I2/I3 mop up any leak.

---

## 4. Capture signal — THE crux

**Do NOT source `onLocalChange` from `canvas.requestSave` / vault `modify` / any
file event.** Those are (a) async/debounced and (b) fire identically for user
edits and our own applies — the exact ambiguity that sank the file bridge.

**Source it from synchronous user-interaction signals + a model snapshot diff:**

1. **Interaction triggers** (already patched in the adapter):
   - `setDragging(false)` → a drag ended → geometry of the dragged/selected nodes
     may have changed.
   - `updateSelection(...)` → selection changed (covers click-move, resize handles,
     multi-select drags).
   - Node/edge add & delete: patch the canvas' own add/remove entry points
     (candidates: `canvas.requestSave` is too coarse; prefer wrapping the methods
     that mutate `canvas.nodes`/`canvas.edges` — to be pinned by the Phase-0 spike,
     see §9). Fallback: detect membership changes during the snapshot diff.
   - Text/content edits inside a node: canvas text nodes are CM editors; their
     change fires through the node — capture on blur / `setDragging`-adjacent
     save, or include in the periodic snapshot diff.
2. **Snapshot diff on trigger:** on any trigger, synchronously read the current
   model (`canvas.nodes`/`canvas.edges` → records) and diff against the
   **last-known model snapshot** the bridge holds. Emit one `LocalChange` per
   differing entity, then store the new snapshot.
3. **Suppress during apply:** while `binding.applyingRemote` is true, the bridge
   **updates its snapshot but emits nothing** (the change came from us). The bridge
   reads the flag via a small back-reference or a shared `isApplying()` callback
   injected by the binding. This is the primary guard; `SPEC_01` I3 is the backup.

Rationale: interaction signals are **synchronous** with the user's action and are
**not** emitted by our programmatic `moveAndResize` in a way that misattributes
them — and even if Obsidian emits an extra async save afterward, the snapshot diff
against current truth yields nothing to push. This is strictly more robust than the
mute window and needs no timing constant.

> **Open item for the Phase-0 spike (§9):** confirm which interaction hooks fire on
> which edit kinds across resize, multi-select drag, paste, node-content edit, and
> node add/delete. The snapshot-diff fallback covers anything a hook misses, at the
> cost of running on each trigger; a missed *trigger* (an edit with no signal at
> all) would delay capture until the next interaction — acceptable, and detectable
> in testing.

---

## 5. Node add / remove

- **`applyNodeUpsert` for a NEW id:** the private API to add a node is not a public
  method. Options, in preference order (pin in spike §9):
  1. Use `canvas.setData(mergedData)` for the *structural* subset when ids are
     added/removed, then targeted `moveAndResize` for pure geometry (hybrid). A
     structural `setData` is acceptable here because it is driven by a genuine
     remote add/remove, is infrequent, and runs under `applyingRemote`.
  2. Use any discovered `canvas.createTextNode/createFileNode/importData` private
     methods if stable.
- **`applyNodeRemove`:** likewise via `setData` of the reduced set, or a discovered
  `canvas.removeNode`. Must run under `applyingRemote`.

**Guideline:** pure geometry/content updates use per-node mutators (smooth, no
flash); **membership changes** (add/remove) may use a scoped `setData`. Unlike the
current design, this `setData` does **not** feed back, because capture is
snapshot-diff-based and suppressed during apply.

---

## 6. Geometry vs content on a node

`applyNodeUpsert(id, rec)` must reconcile BOTH:

- **Geometry** (`x,y,width,height`): `node.moveAndResize({x,y,width,height})` iff
  changed. Never call while the user drags THIS node (`isBusy && dragTarget===id` →
  skip; converge later). Carried over from the current `applyNodeGeometry`.
- **Content** (`text,file,color,label,type,…`): set on the node model where the
  private API allows; for `text` nodes this is the node's stored text; for `file`
  nodes the `file` path + subpath. Content that cannot be set live falls to a
  scoped `setData` for that node.

`recordsEqual(cur,next)` in the binding prevents redundant content churn.

---

## 7. Edges

- **`applyEdgeUpsert`:** add/update an edge with `fromNode,toNode,fromSide,toSide`
  and cosmetics. Edges follow their nodes' positions automatically once present, so
  the key work is keeping the edge SET and its side attachments in sync. Likely via
  scoped `setData` on structural change; side/cosmetic-only updates may be live if
  a private setter exists.
- **`applyEdgeRemove`:** remove from the edge set.
- **Dangling tolerance:** if an edge references a node not yet applied (apply order,
  or a transient), the model must not throw; the binding applies nodes before edges
  and the doc-side prune keeps persisted data clean (SPEC_03). A transiently
  dangling live edge self-heals on the next apply.
- This natively fixes the **multi-edge move** bug (B11): moving a node re-routes its
  edges in Obsidian's own render; the reflow hack (v0.5.9) is unnecessary.

---

## 8. Availability & degradation

- Reuse `isAvailable()` (nodes is a Map ∧ zoom is number). If unavailable, the
  bridge factory returns `null`; the plugin logs it and falls back to the **legacy
  file bridge** in read-mostly degraded mode (documented, not silent).
- All private access stays defensive (the adapter's existing pattern): a shape
  change disables a feature, never throws into the plugin.

---

## 9. Phase-0 spike (must run before Phase 3 coding)

A short, throwaway investigation in a real vault to pin the uncertain private-API
points, with findings recorded back into this spec:

1. Which interaction signals fire for: single move, resize (each handle),
   multi-select drag, node add, node delete, edge add, edge delete, text-node edit,
   paste. (Drives §4.)
2. The cleanest node/edge **add/remove** path (`setData` scope vs a discovered
   method). (Drives §5, §7.)
3. Whether `moveAndResize` alone re-routes multi-edges without a frame nudge.
   (Confirms §7 / B11.)
4. Whether Obsidian's `requestSave` can be suppressed while we own the open file,
   or must be tolerated as an idempotent fsync (feeds SPEC_03).

Output: this spec's §4/§5/§7 "pin" boxes filled in, then Phase 3 proceeds.

---

## 10. Test contract

The binding's tests (SPEC_01 §10) use a **fake** bridge. This bridge's *real*
implementation is validated separately:

- **Unit (headless, fake `view.canvas`):** extend
  `plugin/src/__tests__/canvas-adapter.test.ts`. Assert `applyNode*/applyEdge*`
  call the right private members with the right args; assert `onLocalChange` fires
  on interaction triggers and is **suppressed while `isApplying()` is true**; assert
  the snapshot diff emits one change per differing entity.
- **Manual E2E (real Obsidian, user):** the two-vault protocol — the redesign's
  acceptance lives in SPEC_04. No GUI automation is available to the agent.
