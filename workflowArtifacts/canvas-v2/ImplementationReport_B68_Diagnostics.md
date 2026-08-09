# Implementation Report — B68, the canvas-disjoint diagnostic (`S188`)

**Worker 3 · 2026-08-09 · branch `fix-bugs-and-raceconditions`, from `9c57a27`.**
Built from `DIAGNOSTIC_SPEC_CanvasDisjoint.md`. **No tests written** — the mandate is suspended for
this package by the owner. No break table, no plants, no blind set, and none of the existing
assertions was weakened.

---

## 1. What landed

**All seven steps.** Seven commits, one per step, each one usable on its own.

| Step | Commit | Instrument | Can now answer |
|---|---|---|---|
| 1 | `4f62481` | **I1** three-plane census + `canvas.diag` + `canvas_diag.py` with the `INCOMPLETE` refusal | *Which plane is lying* — view ≠ doc (the view is wrong) vs doc ≠ doc across peers (the truth is wrong) vs file ≠ doc (only the disk lags). Zero hooks. |
| 2 | `e7a479e` | **I8** unattributed delta, `arm`/`mark`/`dump`/`clear` ring | *"The view moved and nothing we know about moved it."* The finding no hypothesis list can give you. Zero hooks. |
| 3 | `167d0c6` | patch machinery + **I2** view-write ledger, with `causeNow` | Attributes **every** view move to `revert` / `remote-apply`, and surfaces **H8**'s `setData` rows with their `moved: []` list. |
| 4 | `f7cd68b` | **I5** Y-transaction-origin ledger | **H3**, **H6** outright, and **H9 — the accumulation**. One listener, no patch. |
| 5 | `847e2a6` | **I3 + I4** revert & expiry ledgers, incl. `wouldHaveReverted` | **H1**, decisively, either way. Includes the §7 import amendment. |
| 6 | `23e9679` | **I6** awareness snapshot + **I7** viewport ledger | **H5**; the claim leak's live count per peer; the phantom `(typing)` pill; `epoch: undefined` everywhere (`S187`). |
| 7 | `6228354` | A/B diag build on `e6909ee` + two reader fixes the rehearsal found | The one-variable bisect. |

**Files touched:** `plugin/src/testing/e2e-control.ts` (the whole instrument), `plugin/src/main.ts`
(+30 lines, one read-only accessor), `tools/e2e/canvas_diag.py` (new), and the two frozen
allow-lists. Nothing else. `canvas-presence.ts` is **byte-unchanged**.

### The §7 amendment, as approved

`"../canvas/canvas-presence"` added to **both** lists — `wp49/test_tp12…` (ledger **A-68-1**) and
`wp72/test_tp4…` (**A-68-2**) — for **`holdersOf` only**. They are in step. `canvas-presence.ts`
itself is untouched, so the whole-file SHA pin (`2cefc9a8…`, 29 831 B) stands and
`v2/wp21/test_tp04…` is green.

### Both A/B bundles exist

```text
h:/tmp/b68_current_diag_main.js    5 828 488 B   sha256[:16] 5054fde30be2c209   ← current + diag
h:/tmp/b68_preWP120_diag_main.js   5 824 426 B   sha256[:16] c77451af39d5a7b6   ← e6909ee + diag
h:/tmp/ls-preWP120/                worktree at e6909ee, real `npm ci`, NEVER junctioned
                                   (remove with: git worktree remove --force h:/tmp/ls-preWP120)
```

The swap detector is **structural**, not a trusted file copy: `expireIdleInferredLocks` does not
exist in `canvas-presence.ts` at `e6909ee`, so that peer's `probe` row reads
`expireSweepPresent: false`.

---

## 2. The guided session — copy-pasteable

Ports are the owner's three vaults. Body field is **`cmd`**, never `command`. Replace
`<Board>` with the real board name.

```bash
cd "H:/Developement/_NeuralAngels/liveshareCollab/obsidian-live-share"
BOARD="_liveshare-test/<Board>.canvas"

# STEP 0+1 — orient, and OPEN THE BOARD ON ALL THREE. Without it there is no
# adapter and the VIEW plane is blind on that peer.
for P in 39431 39432 39433; do
  curl -s -X POST "http://127.0.0.1:$P/command" -H "Content-Type: application/json" \
    -d '{"cmd":"session.info"}'; echo
  curl -s -X POST "http://127.0.0.1:$P/command" -H "Content-Type: application/json" \
    -d "{\"cmd\":\"canvas.open\",\"args\":{\"path\":\"$BOARD\"}}"; echo
done

# STEP 2 — ARM. This prints the nine-cell table and REFUSES if any peer is not ready.
python tools/e2e/canvas_diag.py --ports 39431,39432,39433 --path "$BOARD" --op arm --label click-1

# STEP 3 — THE OWNER ACTS. Exactly ONE gesture, said out loud, on a named client.
#   (a) click ONE card on client 1, change nothing
#   (b) click empty canvas on client 1 (deselect)
#   (c) drag ONE card 100 px on client 1
# Wait ~3 s. Do not scroll. Do not pan. Do nothing else.

# STEP 4+5 — DUMP and READ.
python tools/e2e/canvas_diag.py --ports 39431,39432,39433 --path "$BOARD" --op dump --label click-1

# STEP 6 — next gesture: DROP A FENCE, do NOT re-arm (re-arming destroys the I8 baseline).
python tools/e2e/canvas_diag.py --ports 39431,39432,39433 --path "$BOARD" --op mark --label click-2
#   ... owner acts again ...
python tools/e2e/canvas_diag.py --ports 39431,39432,39433 --path "$BOARD" --op dump --label click-2

# STEP 7 — TEARDOWN, always, before the owner keeps using the vault.
python tools/e2e/canvas_diag.py --ports 39431,39432,39433 --op clear --label teardown
```

Every raw response is written to `workflowArtifacts/canvas-v2/diag/<label>-<peer>.json`
**before anything is printed**, and the paths are printed first. If the console dies mid-run
(`S186`), the evidence is on disk.

Other ops, all through the same command: `--op census` (pure, safe any time, needs no arm),
`--op awareness` (the wire only).

---

## 3. Healthy vs broken — what the Dispatcher reads live

**HEALTHY**, after one click that changed nothing:

- Every node, all three planes, all three peers: `armed == dumped`, no `⚠ DISAGREES` flag.
- `UNATTRIBUTED (…)` prints `(none)`.
- `probe` rows present on every peer with `reconcileSweep=True expireSweep=True`.
- `expire` rows with `expiredCount: 0`, or `wouldHaveReverted: false` on everything expired.
- `reconcile` rows **present** with `revertedCount 0` — the row **must exist**; its absence means
  the sweep never ran, which is a *different* bug (`S155`).
- Any `applyGeom` row has `outcome=unchanged`.
- **Zero** `ytxn` rows with `local=True` on the peers that did **not** click.
- `setData` rows absent, or with `moved=0`.
- `ring: … (0 dropped)`.

**BROKEN — each shape names its suspect:**

| Shape in the dump | Reads as |
|---|---|
| `applyGeom`/`setData`, then within ~1 s a `ytxn` with `local=True` and `origin=canvas-capture-origin` for the **same node** | **H9. THIS IS THE LOOP. Stop and report it.** It is sufficient on its own to explain accumulation. |
| `setData` with `moved` non-empty on a peer that did nothing | **H8.** The whole-board escalation is still live (`main.ts:3231-3235`). |
| `expire` with `wouldHaveReverted: true` and no `reconcile` revert for that node | **H1.** WP120's ordering removed the restoring force. |
| `reconcile` reverts fire, `applyGeom outcome=applied`, and `to` ≠ the other peers' doc value | **H7.** The revert is aiming at a wrong truth. |
| `ytxn origin=canvas-seed-origin` after arm, carrying the pre-click coords | **H3.** |
| An `UNATTRIBUTED` **view** row with a `viewport` row within ~200 ms | **H5.** |
| An `UNATTRIBUTED` **view** row with **no** viewport row and no ledger row | **An unenumerated mechanism. The most important possible result.** |
| `INCOMPLETE — …` printed and the table withheld | **Not evidence. Re-arm and re-run.** |

The tool has **no verdict field**. It never says "converged". It prints flags, and it refuses.

---

## 4. What I found while building that bears on H1–H9

Every line re-read against the tree while wiring the hooks.

1. **H9's ingredients are all present and none is speculative — I read all four.**
   `applyNodeGeometry` calls Obsidian's own `node.moveAndResize(...)`
   (`canvas-adapter.ts:1152`), a real view mutation. `reconcileLiveCanvas` brackets itself with
   `this.fileOpsManager.mutePathEvents(diskPath)` (`main.ts:3175`) in its own words *"so the
   reconcile never loops back into a sync"*. **`applyCanvasNodeRevert` does not**, and says so at
   `main.ts:4095`: *"NO MUTE HERE, and that is a decision rather than an omission"* — the argument
   being that the canvas branch of the modify gate consults a byte echo breaker instead. That
   argument is **inherited from WP91 and is traced, not measured.** I5 measures it in one row.

2. **H8 is verified present, and it is on the ordinary remote path.** `main.ts:3231-3235`: when any
   node that is an **edge endpoint** actually moves, the per-node geometry pass escalates to
   `adapter.reloadCanvasData({nodes, edges})` — `setData` of the whole board. WP119 removed the
   *revert's* escalation and left this one. This is the route every click's downstream effects
   travel, and the owner's board has arrows.

3. **H1 cannot be true alone, and I now think the ledger will show that.** The reorder makes the
   *receiving* peer claim less, therefore revert less, therefore write to its own view less. For
   that to show up as a *worsening*, the revert must have been a corrective pull that something
   else's error was leaning against. Expect to find H8 or H9 underneath it. Also:
   `INFERRED_LOCK_IDLE_MS = 15_000`, so H1 additionally **requires** claims already ≥15 s idle —
   `I4`'s `lockMetaBefore` (origin + `touchedAt` per claim) is what confirms or kills that
   precondition, and it is in every `expire` row.

4. **A new awareness event class nobody has named.** `expireIdleInferredLocks()` **broadcasts**
   when it expires anything (`emitLocalState()` at `canvas-presence.ts:468`). That broadcast is an
   awareness `change` on every other peer, which runs *their* expire → reconcile → refresh. WP120
   introduced an awareness event class that did not exist before, and every one of those events can
   now reach `applyNodeGeometry` on peers that did nothing. I3 and I4 show this directly. It is on
   none of the nine lists. **Register-shaped.**

5. **H6 is wrong as stated and should be re-stated.** `emitHeld` (`canvas-adapter.ts:845-858`)
   diffs the held id set and fires `startListeners`/`endListeners`, which land on
   `acquireLock`/`releaseLock` — **awareness only**: `emitLocalState()`, no doc, no file, no
   geometry. What a selection *does* cause is an awareness change **on every peer**, and that is
   where the damage is done — on the receiving side, not the selecting side. I5 settles the
   original claim as a straight yes/no; take that reading first, it is one line.

6. **H5 is narrower than it reads.** `onViewportChange(() => this.refresh())` is real
   (`:387`), but `refresh()` (`:596-631`) renders cursors and calls `applyRings`, and
   `addRing`/`removeRing` (`:647-675`) only toggle a CSS class, set a custom property and
   append/remove a `<div>` inside the card element. **There is no node-geometry write anywhere on
   that path.** Cursor coordinates are canvas-space on the wire and converted per-peer at render,
   so a coordinate-space bug there is cosmetic — a cursor in the wrong place, not a card. Rank H5
   last; the only residual is whether `el.appendChild(tag)` perturbs Obsidian's own layout, and
   I7 + I8 will show that if it happens.

7. **H7 is reframed, and I confirmed the reframe.** `revertCanvasNode` (`main.ts:3990-4023`) holds
   **no** pre-claim snapshot: it reads `getCanvasSnapshot(rawPath)` **at revert time** (`:3999`).
   So "the rollback snapshot is captured at the wrong moment" is not the mechanism. What survives
   is that the revert faithfully restores whatever the doc says **and the doc may be wrong** —
   making the revert an *amplifier* of a bad doc rather than an independent source. That is a
   materially different repair. I3's `docPos` measures it.

8. **H4 is confirmed unfalsifiable by this package, by inspection.** `canWriteNode`/`canDeleteNode`
   (`canvas-presence.ts:477`, `:481`) have exactly one consumer — `CanvasBinding`'s optional gates
   — and `mountCanvasPresence` never supplies them. It is an *enabler*, not a mover, and it
   predates the window.

9. **`applyCanvasNodeRevert` calls `adapter.isBusy()` and `getEditingNodeId()`** (`main.ts:4085-4088`,
   WP87's gate). That is production and correct. It matters here only because it means **a revert
   sweep itself fires WP37's staleness sweep** — which is precisely why no instrument in this
   package may call either, and why `DiagAdapterLike` does not declare them at all.

---

## 5. Gate figure

| Gate | Result |
|---|---|
| `tsc -noEmit -skipLibCheck` | **clean** |
| `npm --prefix plugin run build` | **clean** (tsc + esbuild production) |
| Production bundle hygiene | `main.js` greps **0** for `e2e-control` / `LIVESHARE_E2E` / `canvas.diag` / `e2eControlPort`. Prod bundle 1 107 800 B, `sha256[:16] 0cc32ccb3d02bafe`. |
| `npm --prefix plugin test` | **444 files / 3375 tests — ALL GREEN, 0 failed** |
| `npm --prefix plugin run build:e2e` | **clean**, 5 828 488 B, `sha256[:16] 5054fde30be2c209` |
| `S180` NUL scan | 0 NUL bytes in every commit's diff, checked per commit |

**A note on the baseline.** The pre-change measurement of the untouched tree came back
**443/444 files, 3374/3375 tests**, with `wp5/cold-arrival-dataloss.test.ts` red
(`expected 3 to be 4`). Run alone on the same clean tree it passed 8/8 in 1.5 s. That is `S181`'s
family — a schedule-dependent red under contention, not a regression. **The post-change run is
443→444 and 3374→3375: fully green.** No test was added, amended, weakened or skipped.

### Rehearsed, not just compiled

The reader was driven end to end against two fake control ports carrying a real `buildPluginHost`
over a real `Y.Doc`: `arm` → an unattributed view move on the second peer → `dump` → the
`INCOMPLETE` refusal against a dead third port → `clear`. Verified live:

- `cause=revert / causeResolved=true` on the apply made inside `reconcileClaims`, and
  `cause=remote-apply / causeResolved=false` on the ordinary one.
- `wouldHaveReverted: true` computed by the **production** `holdersOf`.
- The H9 shape rendered as one readable line: `ytxn origin=canvas-capture-origin local=True`.
- `UNATTRIBUTED  B  view  n3 (400,220) -> (517,296)`.
- `clear` → `patchesRemoved=4 listenersRemoved=2` per peer, with the presence prototype methods
  restored (`Object.keys(presence)` back to `['lockedNodes','lockMeta']`).

That rehearsal is what found the two step-7 fixes: a cp1252 console raised `UnicodeEncodeError`
halfway through the table and lost the rest of the reading (`S186` wearing a new hat), and the
`probe` row — the line the §4.2 A/B turns on — had no renderer.

---

## 6. What I could not instrument, and why

1. **H4 is not discriminable and nothing in this design changes that.** It is an *absence*: it
   explains why nothing refuses, not what moves. The counterfactual would need the removed gate put
   back, which is a repair, not a measurement.
2. **Nothing here instruments the relay.** If the doc diverges between peers with **matching**
   origins on both sides, the next question is transport, and this scaffold hands you that question
   rather than answering it. That is a real boundary and the Dispatcher should expect to hit it.
3. **`mount-initial` is not separated from `remote-apply` by a flag.** Both arrive with `causeNow`
   clear and the row says so via `causeResolved: false`. They are separated by timestamp —
   `mount-initial` fires once per board open, so it is essentially always *before* the arm.
   If a dump ever shows a `causeResolved: false` row that is plausibly a mount, that is the moment
   to add the second flag; I did not add it speculatively.
4. **No per-write disk ledger** (spec step 8, optional). The FILE plane's record delta falls out of
   I1 + I8; what is missing is per-write **causes**. So `I8` attributes a file delta as `flush` when
   a doc delta preceded it in the same window and reports it as UNATTRIBUTED otherwise — that is a
   correlation, not a receipt. A file move with no doc move will show up loudly but will not name
   its writer.
5. **The ring is per-plugin-instance, not per-board.** Arming board X while board Y is also open
   patches only X's surfaces, but `mountedPaths` minus `patchedPaths` is reported in `notes` on
   every dump, so a move on the un-instrumented board cannot be silently mistaken for one on the
   instrumented one.
6. **`CanvasBinding` is dormant** (`types.ts:287` ships `useCanvasBinding: false`, frozen behind a
   §7 pin), so `canvas-binding-origin` cannot appear live. I5 will print it if it ever does, which
   would be a finding in itself.
7. **`.md` is out of scope**, per the owner's canvas-only sequencing.

---

## 7. The one thing I would do first

Steps 1, 2 and 4 involve **no patching of anything** — no wrapper anywhere near the product's
view-write path. They already answer H3, H6, H9 and the unattributed delta. If there is any
hesitation about wrappers on the owner's live vaults, arm, take one click, and read
**`UNATTRIBUTED`** and the **`ytxn`** rows before anything else.

This run has aimed three repairs by inference and missed three times. Let the board say which plane
is lying before anyone patches anything.
