# SPEC 03 — Canvas Persistence (write-only `.canvas`)

> The `.canvas` file demoted from *sync channel* to *persistence sink*. It is
> written from the CRDT for durability and read only on a **cold open**. It never
> feeds back into the live sync loop. **Spec only — not implemented.**

Related: `SPEC_01_CanvasBinding.md` (the live loop this must not feed back into),
`SPEC_02_CanvasModelBridge.md` (the live model), `../CANVAS_SYNC_REDESIGN.md`.

---

## 1. Purpose

Keep the on-disk `.canvas` a faithful, eventually-consistent projection of the
Y.Doc so that:

- a canvas **not currently open** on this peer still ends up correct on disk;
- **cold open** (opening a canvas with no live binding yet) renders correct data;
- a crash/close loses at most the last debounce window;

**without** ever making the file an input to the live sync loop while the canvas is
open (which is what created the two-writer race).

---

## 2. Core rule — file ownership

- **While a canvas is OPEN (a binding exists for it):** the binding + model are the
  live truth. The persistence writer is the **only** component that writes the
  file, driven by the Y.Doc, on a debounce. Obsidian's own `requestSave` is either
  (a) suppressed while we own the file, or (b) tolerated as an **idempotent fsync**
  (see §5). The file is **never read** as a sync input during this time.
- **While a canvas is CLOSED but shared:** identical — persistence writer keeps disk
  in step with remote deltas via the Y.Doc observer (this is the legacy behaviour
  that already works for closed canvases; it was only the OPEN case that raced).
- **Cold open (§4):** the one moment the file is *read* — to seed the Y.Doc if the
  doc is empty, exactly like the guest-seed path today.

---

## 3. The persistence writer

A standalone component (e.g. `CanvasPersistence`), one per shared path, that:

1. Observes the same per-path `Y.Doc` (`nodes`/`edges` maps) as the binding, but
   **independently** — it produces no CRDT writes, only disk writes.
2. On any change (local capture OR remote delta), schedules a **debounced** disk
   write (reuse the existing `DEBOUNCE_MS`/`MAX_WAIT_MS` trailing+cap logic from
   `canvas-sync.ts`).
3. Serializes with `buildCanvasData` (the existing dangling-edge-pruned serializer)
   → `JSON.stringify(…, null, "\t")`.
4. Writes via the vault adapter, wrapped in `mutePathEvents` for the settle window
   **purely to suppress our own write's `modify` echo** — NOT as a sync-correctness
   mechanism (there is nothing to feed back into anymore).

Key difference from today: this writer is **downstream-only**. Nothing it does can
change the Y.Doc or the model. The dangerous edge — reconcile→setData→requestSave→
handleLocalModify→CRDT — is severed because there is no `handleLocalModify` for open
canvases (SPEC_01 §9).

---

## 4. Cold-open load path

When a canvas view opens and **no binding exists yet**:

1. Ensure subscription (as today via manifest/lazy-subscribe).
2. `waitForSync` on the doc.
3. **If the Y.Doc is non-empty:** construct the binding with
   `seedModelFromDoc: true`; the binding's initial `applyRemote()` brings the view
   to shared truth. Do **not** read the file. (Replaces v0.5.9's forced `setData`.)
4. **If the Y.Doc is empty (this peer is the first/host seeding):** read the
   `.canvas` file once, load it into the Y.Doc under the binding origin (or a
   dedicated seed origin), then bind. This is the only file→CRDT read and it happens
   exactly once, before any concurrent editing.

The **geometry-key guard** (v0.5.6) is retained ONLY here, guarding the one-time
file parse against a partial read. Everywhere else it is unnecessary and removed.

---

## 5. Handling Obsidian's `requestSave` while open

The Phase-0 spike (SPEC_02 §9 item 4) decides which applies:

- **(a) Suppressible:** if we can prevent Obsidian from auto-saving the open canvas
  (e.g. by owning the save cycle), do so; our persistence writer is then the sole
  writer.
- **(b) Tolerated fsync:** if not, Obsidian's save must be made a **no-op relative
  to our writer** — i.e. the bytes Obsidian writes must equal what we would write,
  OR we simply ignore the file while open (never read it) so Obsidian's save is
  harmless. Since the file is never a sync input while open, Obsidian overwriting it
  with model-equivalent bytes changes nothing; our next debounced write re-asserts
  the canonical serialization. **No feedback either way.**

Either path is safe because the invariant is "file is not a sync input while open,"
not "only we ever touch the file."

---

## 6. Interaction with text/background sync

- Text/background sync is **untouched**. The vault `modify` handler
  (`vault-events.ts`) keeps its text branch; only the `.canvas` branch changes: it
  no longer calls `canvasSync.handleLocalModify` for OPEN canvases (removed in
  Phase 4). For closed/cold canvases the load path (§4) applies.
- `isRecentDiskWrite`/`mutePathEvents` remain for the persistence writer's own echo
  suppression (mechanical, not correctness).

---

## 7. Crash / durability

- Worst-case data loss = one debounce window (≤ `MAX_WAIT_MS`) of the latest
  changes, same as today.
- On reopen after a crash, cold-open (§4) reconciles disk ↔ any surviving doc state
  via the CRDT; the CRDT (if a peer is still connected) wins, else disk seeds.

---

## 8. Test contract

- **Persistence writer (headless):** given a Y.Doc, assert a debounced disk write
  with the pruned serialization; assert it performs **zero** CRDT writes (spy the
  doc — no transactions originate here); assert a remote delta triggers a write and
  a local capture also triggers a write, but neither loops.
- **Cold-open (headless):** empty doc + non-empty file → file seeds doc → model
  reconciled; non-empty doc + stale file → doc wins, file overwritten, **no**
  file→CRDT read.
- **No-feedback regression:** drive the binding with a streamed drag (SPEC_01 T6)
  **with the persistence writer attached**; assert the writer's disk writes do not
  produce any additional CRDT updates (the two-writer race cannot reappear).
