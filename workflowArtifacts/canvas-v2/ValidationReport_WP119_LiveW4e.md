# ValidationReport — WP119, live on the three vaults (Worker 4e)

**Branch:** `fix-bugs-and-raceconditions` · **Product code at test time:** `d188b0e` (identical at `a609616`; the
five commits that landed during the run touched `workflowArtifacts/` only — verified with
`git diff --name-only d188b0e..HEAD`) · **Role:** live tester, **no product code changed**.

**Build under test — the sha every measurement below names:**

```
d30f671979efaeb5c22526b1197ccfa56e61e5985766a28b953e08b9dfb5316e   (5 540 804 B)
```

**Rollback control build (WP119's parent, `6a58211`):**

```
3e445c6d945550ef2aa2b2886324292d5de23c001ad8351d67523f9e2184052f
```

**Signals allocated: none.** Everything below is prose.

---

## 0. Verdict in one line

**The owner's symptom is gone, and I did not have to take that on trust: I reproduced it live on this rig, on
the pre-WP119 build, and then made it disappear by swapping one file back.** Same board, same gesture, same
peers, one variable — the bundle on the losing peer.

| | pre-WP119 (`3e445c6d`) | WP119 (`d30f6719`) |
|---|---|---|
| the plugin's own log | `LOCK REVERT: … node=card2 winner=114193417`<br>`reconcile …: initial structural reload ok (nodes 11->11, edges 6->6)` | `LOCK REVERT: … node=card2 winner=114193417 geometry=unchanged` |
| uncontested cards that jumped on the losing peer | **2** — `card1` (1110,**350**)→(1110,**100**), `208541a49dc66c4c` (1320,**47**)→(1320,**-203**) | **0** |

**T1 PASS · T2 PASS · T3 PASS · T4 CONFIRMED (leak real and growing, cost now bounded) · T5 PASS with one
harness-side anomaly.** Unit gate re-measured on the final tree: **428 files / 3260 tests / tsc 0**.

**No board was destroyed.** One piece of collateral damage I did cause, to the repo rather than a vault:
I emptied `plugin/node_modules` and restored it from the lockfile — §10.1, disclosed in full.

---

## 1. The rig, as actually read

Roles were read from `session.info` at the start and end of every arm and never assumed (`S139`). They **changed
once**, at the plugin reload that installed the new build, and were stable for every measurement afterwards:

| | port | vault | role BEFORE reload | role FOR EVERY MEASUREMENT | awareness clientID on `smoke.canvas` |
|---|---|---|---|---|---|
| **A** | 39431 | `ObsidianOrga` | guest | **host** | **114193417 — LOWEST, wins every tiebreak** |
| **B** | 39432 | `ObsidianOrga - Kopie` | host | **guest** | 3481963911 — highest, loses to both |
| **C** | 39433 | `ObsidianOrga - W4TestC` | guest | **guest** | 1168499759 — loses to A, beats B |

Room `90faf3d5…`, all three `connected: true`, `canvasSurface: true`, `pluginBuild: "0.6.1+e2e"` throughout.

**`pluginBuild` does not discriminate the two builds** — it reads `0.6.1+e2e` on both. The discriminator I used
instead is the shipped code itself, read out of each renderer:

| | pre-WP119 | WP119 |
|---|---|---|
| `typeof plugin.applyCanvasNodeRevert` | `undefined` | `function` |
| `revertCanvasNode.toString().length` | 633 | 934 |
| `revertCanvasNode` mentions `reconcileLiveCanvas` | **true** | **false** |

Install was byte-for-byte: read back after `copyfile` and compared to the source bytes, `identicalToSource=True`
on all three. **No relay redeploy** — correct, WP119 touches nothing on the wire.

**Condition.** Every arm ran with the renderers **`hidden`**, which is the condition that matters (`S147`). The
only exception is `B` during T1/T1b/T2/T3, which reported `visible` (it was the foreground Obsidian window);
`A` and `C` were `hidden` throughout, and by the T4/T5 and rollback arms **all three read `hidden`**, including
the rollback control that produced the RED. The headline result therefore holds in the all-hidden condition.
I did not run a deliberately-foreground arm.

**Board.** `_liveshare-test/smoke.canvas` — 9 nodes / 6 edges at the start, byte-identical on all three peers.
Several cards, several arrows, and the probe cards I chose are edge endpoints on purpose, so the `movedEndpoint`
escalation would have had a target if the old blast radius had survived.

---

## 2. Gesture fidelity — verified before anything was attributed to it

The brief warns that `require('obsidian')` is unreachable and `executeCommandById('editor:select-all')` returns
`false`. I drove the selection through **Obsidian's own `canvas.updateSelection`**, which is precisely the method
`canvas-adapter.ts#ensureSelectionPatch` monkey-patches, and I proved the whole chain on the live rig before
using it:

- `canvas.updateSelection.__lsWrapped === true` on all three peers — the plugin's patch is installed;
- select `card1` → `CanvasPresence.lockedNodes === ['card1']` on that peer — the gesture really does claim an
  awareness lock, i.e. **a selection really is a peer-visible event on this build**;
- deselect → `lockedNodes === []` — the gesture-held lock really is released.

Measured on A, B and C independently. `canvas.simulateEdit` was never called.

---

## 3. T1 — THE HEADLINE. **PASS.**

### 3.1 First cut, and why I did not bank it

A first battery selected three cards on each peer in turn and measured node geometry on disk and in the view on
all three. Nothing moved anywhere, and one arm carried a genuine contest
(`LOCK REVERT: … node=card2 winner=114193417 geometry=unchanged` on B).

**I am recording that battery as insufficient rather than as a pass.** In it the losing peer's live view already
equalled shared truth, so the old build's whole-board `canvas.setData(shared truth)` would also have moved
nothing. A green there is consistent with both builds. Three of its four arms additionally had **no contest at
all** (`LOCK REVERT` count zero), which makes them vacuous.

### 3.2 The discriminator

Before each contest I gave the losing peer a live view that **disagrees with shared truth about UNCONTESTED
cards**, by moving them in the view only (`node.moveAndResize` with no `requestSave`), and I verified the
disagreement through the product's own `canvas.state` read rather than assuming it:

```
[B] view : card1=(960, 250)   208541a49dc66c4c=(1140, -73)
[B] doc  : card1=(960,   0)   208541a49dc66c4c=(1140, -323)
discriminator armed: True
```

Now the two builds are separable:

- **old** → revert is `setData(WHOLE BOARD)` → the uncontested cards **snap back** to shared truth. That is
  "other cards jump around", exactly.
- **new** → revert is one `applyNodeGeometry` on the contested card → the uncontested cards **stay put**.

### 3.3 Result — six arms, both sides of the fixed tiebreak

The tiebreak is `A < C < B`, so `A` can never lose and the symptom can only land on `B` or `C`. I exercised the
loser **both as the watching peer (the owner's case) and as the selecting peer**, and across the host/guest and
guest/guest pairings:

| arm | watcher holds `card2` | selector | loser | `LOCK REVERT` fired | uncontested cards moved on the loser |
|---|---|---|---|---|---|
| 1 — the owner's exact case | B | A | **B** | ✔ | **0** |
| 2 — loser is the selector | A | B | **B** | ✔ | **0** |
| 3 | C | A | **C** | ✔ | **0** |
| 4 — loser is the selector | A | C | **C** | ✔ | **0** |
| 5 — guest vs guest | B | C | **B** | ✔ | **0** |
| 6 — arm 1 repeated | B | A | **B** | ✔ | **0** |

Every arm carried a real, logged contest, so none of these greens is the "nothing happened" kind.

### 3.4 The rollback control — the measurement that makes the greens mean something

I built WP119's parent (`6a58211`) into an e2e bundle, installed it **into B only**, reloaded B, confirmed the
old code was live (`hasApplyCanvasNodeRevert=false`, `revertMentionsReconcile=true`), and re-ran arm 1 unchanged.
A mixed-build room is a legitimate isolation here because WP119 changes nothing on the wire, so the only variable
is the code that handles the revert on the peer where the revert fires.

```
PRE-WP119  (3e445c6d…, all three renderers hidden)
  LOCK REVERT: _liveshare-test/smoke.canvas node=card2 winner=114193417
  reconcile _liveshare-test/smoke.canvas: initial structural reload ok (nodes 11->11, edges 6->6)
  cards moved on B = 2, ALL UNCONTESTED:
     card1            (1110, 350) -> (1110, 100)
     208541a49dc66c4c (1320,  47) -> (1320, -203)
  => COLLATERAL DAMAGE — the owner-reported symptom, reproduced live

WP119 restored (d30f6719…, same arm, same rig, same gesture, same board)
  LOCK REVERT: _liveshare-test/smoke.canvas node=card2 winner=114193417 geometry=unchanged
  cards moved on B = 0
  => NO COLLATERAL
```

Two things worth naming in that RED. The old build's log line says `initial structural reload` **in the
product's own words** — that is `reconcile-plan.ts:166` reached through `{initial: true}`, i.e. the exact chain
the investigation traced. And the card the user "clicked" is the one card that did **not** move, which is the
detail from the owner's report that no one had yet reproduced.

B's bundle was then restored and read back byte-for-byte (`identicalToSource=True`,
sha256 `d30f6719…`), and the WP119 code confirmed live again.

**Is the owner's exact symptom gone? Yes.** Selecting cards on one client moves no card on any peer, in both
tiebreak directions, repeatedly, with the renderers hidden — and the same rig still produces the symptom on the
build he reported it on.

---

## 4. T2 — the fix did not buy its pass by disabling reverting. **PASS.**

Two rows, because "the contest resolves" and "the revert still does something" are different questions.

**T2a — a genuine simultaneous contested edit.** A moved `card2` to (1600,400) and B moved it to (1300,700)
within the same instant (both through `requestSave`, i.e. the real capture path; timestamps 173 ms apart).

- all three peers converged on **one** value, `(1300, 700)`;
- records equal A~B, A~C, B~C;
- **the loser's live view shows the agreed value**, not its own rejected one — `A`, `B` and `C` all read
  `(1300, 700, 250, 120)` in the view. Nobody was left holding a third value.

**T2b — the revert still APPLIES.** This is WP119's own plant B3 run live: B's view was put out of step with
shared truth **on the contested card** (view-only move to (1900,1300) against a doc value of (1300,700)) while
an uncontested probe was also displaced.

```
LOCK REVERT: … node=card2 winner=114193417 geometry=applied      <- applied, not unchanged
[B] view AFTER: card2=(1300, 700)  card1=(960, 300)
```

The contested card **was put back to shared truth**; the uncontested probe **was not touched**. A build that had
simply stopped reverting would have left `card2` at (1900,1300) and produced no line at all. It did neither.

So the presence system still does the job it exists for, and it now does it to one card.

---

## 5. T3 — the editing guard. **PASS**, and it is attributable.

WP119 caught, in flight, a route from a peer's selection straight onto a card with an open inline editor. Live:

**Positive control first, because a withhold is meaningless without one.** Editor closed, B's view of `card2`
displaced to (2000,1400), A selects it:

```
LOCK REVERT: … node=card2 winner=114193417 geometry=applied
[B] view AFTER: card2=(1300, 700)          <- reseated. The revert CAN move this card.
```

**The guard.** Same arm, but with a real inline editor open on `card2` — opened through the product's own
`canvas.typeInNode(open=true, blur=false)`, which reported `editingStarted: true`, `focusTaken: true`,
`applied: true` and inserted the marker `W4E-T3-87108`. The plugin's own `canvas.editingSignal` confirmed it saw
the editor (`probeNodeId: "card2"`, `isEditingIds: ["card2"]`, later `flag: "card2"`, `flaggedNodeLive: true`) —
so the guard was measured against the plugin's own signal, not against my belief that I had opened an editor.

```
LOCK REVERT: … node=card2 winner=114193417 withheld (inline editor open)   (x2)
[B] view AFTER: card2=(2000, 1400)         <- NOT reseated. The card stayed under the editor.
```

The typed text survived. **A card being edited is not reseated under the user by a peer's selection.**

---

## 6. T4 — the lock leak. **NOT repaired, and now measured.** WP119's claim is CONFIRMED.

Ten minutes (618 s, 41 rounds) of ordinary collaborative editing — drag, add, delete, edit text, rotating across
all three peers — with the claim census sampled every round.

### 6.1 How many nodes does a peer hold claims on?

Monotonic. It never went down.

```
t+  0s : [A]=0   [B]=3   [C]=0
t+120s : [A]=5   [B]=3   [C]=2
t+300s : [A]=8   [B]=8   [C]=5
t+600s : [A]=14  [B]=15  [C]=7          board = 11 nodes
```

| peer | claims held after 10 min | board | share |
|---|---|---|---|
| A | **14** | 11 | **127 %** |
| B | **15** | 11 | **136 %** |
| C | **7** | 11 | 64 % |

**The claim set is not even bounded by the size of the board.** A and B hold claims on *more nodes than exist* —
the extra ids are cards that were deleted during the run and whose claims were never released. So the leak is
not "eventually the whole board"; it is **unbounded in session length**, and a `releaseLock` reached only by its
own adder never collects the ids that outlive their nodes.

Every one of the three peers' claim sets is dominated by ids of the form `w4e0NNNNN` — cards that peer *created
or captured* and never selected. That is the diff-inferred acquisition path, exactly as traced.

### 6.2 What does a stale claim now cost? — the question WP119 actually answers

Expectation recorded before the gesture: one per-node apply, nothing else moves. Then A (lowest clientID)
selected `card2`, a card B still held a **stale** claim on:

```
[B] LOCK REVERT: … node=card2 winner=114193417 geometry=unchanged
[B] cards that moved: 0            on an 11-node board
```

**One per-node revert line, `unchanged`, zero cards moved.** WP119's claim — that a stale claim now buys one
per-node apply, usually `"unchanged"`, instead of a whole-board reload — is **confirmed, not refuted**.

### 6.3 What the user actually experiences

Nothing, on this build. Across the whole ten minutes no card moved for a reason the user had not caused, and
every contest that fired resolved to `geometry=unchanged`. The leak survives as a **presence-ring** artefact —
a peer's coloured ring stays on every card it has ever touched, for the session, including cards that no longer
exist — and as a growing set of nodes on which any peer's click will make the higher-id peer take a (harmless)
revert. On the pre-WP119 build the same leak was the ammunition: each of those 15 claims was a loaded
whole-board reload.

The repair for this is chartered separately as WP120, which landed on this branch while I was measuring. **The
numbers above are the baseline it should be measured against.**

---

## 7. T5 — regression. **PASS**, with one harness-side anomaly.

41 rounds over 618 s, every gesture checked for arrival on the *other two* peers by parsing their disk bytes:

| gesture | reached every peer | typical latency |
|---|---|---|
| drag a node | **41 / 41** | 2.0–3.5 s |
| add a card | **33 / 41** | 2.0–2.5 s |
| delete a card (by a *different* peer than the one that made it) | **31 / 31** | 2.0–2.5 s |
| edit text | **41 / 41** | 0.0–3.5 s |

Final state, all three peers: **11 nodes, records equal on every pair, and byte-identical**
(2 938 B, sha `02ef5fc95224`). The byte-form divergence that was present earlier in the run
(A/B on 2 247 B, C on 1 730 B — `S150`) had resolved itself by the end on this board; it persists on five of the
other canvases in the share, where the records nonetheless agree.

**The 8 add failures are mine, not the product's.** All eight are on peer C, all report `ok:false` with
`nodeCount` unchanged, i.e. `canvas.nodes.get(id)` was still falsy when my harness looked. My add path is
`canvas.importData(...)` followed by an immediate read; on C that read is evidently too early. Every add that my
harness *confirmed* locally reached all three peers, and no card was lost. I am recording this as a limitation
of my own instrument rather than a product regression, because I did not isolate it.

---

## 8. Boards destroyed — **none.**

Snapshot taken before I touched anything: `H:\tmp\wp119_snapshots\20260808-125032\` (per-peer copies plus a
`manifest.json` with byte counts and sha256 per file).

Diffed against it at the end:

| peer | files before | after | gone | new |
|---|---|---|---|---|
| A | 9 | 9 | **none** | none |
| B | 9 | 25 | **none** | 16 (see below) |
| C | 9 | 9 | **none** | none |

The only canvas whose bytes changed is `smoke.canvas` (1 730 B / 9 nodes → 2 938 B / 11 nodes), and that is
**my own T4/T5 add-and-delete churn**, agreed byte-for-byte by all three peers. Every other canvas in the share
is unchanged on A and C and unchanged on B.

**No node or edge was lost anywhere.** The `coldOpen` / `doc-wins` trapdoor did not fire on me — which is luck
and the fact that the canvases were already open, not evidence that it is repaired. It remains unrepaired and
out of WP119's scope.

---

## 9. Anomalies I could not explain — recorded, not explained

1. **Sixteen `.md` files appeared on B during my run, and only on B.** They are named
   `w4d-clean-burst0-092649.md`, `w4d-clean-s126-guest-093252.md`, `w4d-clean-p2a-094204.md`, … — i.e. they carry
   a *previous* worker's (W4d's) timestamps from 09:26–09:42, hours before my run began at 12:45, and they were
   **not** on B's disk in my 12:50 snapshot. B is the peer I reloaded three times. The obvious reading is that
   these paths still live in the shared document and a guest's re-subscribe materialised them onto disk. I did
   not isolate it, A and C did not receive them, and I did not remove them (they are not in my namespace and the
   owner has said the contents of these vaults do not matter). **A plugin reload appears to resurrect files onto
   a guest that no one asked for.** Recorded as-is.
2. **Two `LOCK REVERT: … withheld (inline editor open)` lines for one gesture** in T3, 1.8 s apart. One selection,
   two passes through `reconcileClaims`. Harmless here because both were withheld, but it means a single
   selection can produce more than one revert attempt on a peer.
3. **The convergence oracle answered `unjudgeable` for my first four T1 expectations.** That is the oracle being
   correct and me being wrong: `ExpectedContent` accepts `exists` / `sha256` / `contains` / `atLeastBytes`, and
   I had passed a `nodes` array, which states no clause. I scored T1 on parsed records and live-view geometry
   instead. Noting it because the next person will make the same mistake: **`judge()` will not read a geometry
   expectation.**
4. **Peer byte-form divergence (`S150`) is still present** on five of the seven canvases in the share
   (e.g. `wp79-035734-one.canvas`: A 249 B, B 440 B, C 249 B) while the **records are equal on every pair**.
   Untouched by WP119 and out of its scope; recorded because a byte-level convergence oracle will keep calling
   these `diverged`.
5. **The lock census reads `s.canvasPath` flat off the awareness state**, not under a `canvas` key. My first
   census read the nested shape and reported every peer's state as `null`, which would have made every contest
   look impossible. Corrected before any verdict was taken; noted because it is an easy way to manufacture a
   vacuous green.

---

## 10. Unit gate — **428 files / 3260 tests passed · `tsc --noEmit -skipLibCheck` exit 0**

Matches the Dispatcher's figure exactly. I changed no product code, and `git status` shows nothing but this
report. `plugin/main.js` is gitignored, so the build artifact is not a tree change.

### 10.1 Damage I caused to the tree, and how I repaired it — **disclosed, not buried**

To build the rollback-control bundle I made a git worktree at `6a58211` and, because its `plugin/node_modules`
was empty, created an NTFS **junction** from it to the real `plugin/node_modules`. When I later ran

```
git worktree remove H:/tmp/wp119-pre --force
```

the recursive delete **followed the junction and emptied the real `plugin/node_modules`.** The evidence is
unambiguous and I am not going to soften it: the directory's mtime is `13:20`, the minute I removed the
worktree; the 12:49 build had resolved esbuild out of it successfully; and afterwards neither `vitest` nor
`typescript` nor `esbuild` resolved at all.

**Repaired with `npm ci` from the committed `plugin/package-lock.json`** (exit 0). `npm ci` installs exactly the
pinned tree and never rewrites the lockfile, so there is no version drift and no new package entered the tree —
`git status` confirms `package-lock.json` is unmodified. The gate above was then measured on the restored tree
and reproduces the Dispatcher's numbers, which is the check that the restore was faithful.

`npm audit` reports 12 pre-existing vulnerabilities (2 moderate, 9 high, 1 critical) in that dependency tree.
Those were there before me; I ran no `audit fix` and changed no dependency.

**Lesson for the next worker:** do not junction a live `node_modules` into a git worktree on Windows.
`git worktree remove --force` will delete through it. Copy, or run `npm ci` inside the worktree instead.

---

## 11. What I did not get to

- **No foreground arm.** Every measurement is in the hidden / backgrounded condition, which is the one the brief
  says matters, but I did not add the deliberately-foregrounded comparison.
- **The arrows are still not witnessed directly.** I measured that no uncontested card moves, which is the
  condition under which the "arrows stay put while nodes move" tell arises, so the tell should no longer be
  producible — but I did not read edge routing (`fromSide`/`toSide`) out of the renderer to confirm it. `R5` from
  the implementation report is narrowed, not closed.
- **`S150`'s reconcile→save→capture→push loop** (`R6`) was not probed. `CanvasSync.captureDeclineCounts()` is the
  reading the investigation asked for and I did not take it.
- **The `coldOpen` / `doc-wins` trapdoor** was avoided, not tested.
- **The add-failure anomaly on C** (§7) was not isolated to harness or product.
- **Multi-select contests**: my discriminating arms contest one card at a time. The first battery selected three
  cards at once and moved nothing, but that battery is the one I declined to bank.

---

## 12. What the rig is left in

**Running and connected. Nothing to restart.**

- All three vaults carry `main.js` = **`d30f671979efaeb5c22526b1197ccfa56e61e5985766a28b953e08b9dfb5316e`**
  (5 540 804 B), verified byte-for-byte, and the WP119 code is **live in all three renderers**
  (`applyCanvasNodeRevert` present, `revertCanvasNode` 934 chars, no `reconcileLiveCanvas` reference).
- **A = host, B = guest, C = guest**, all `connected: true`, room `90faf3d5…`, `canvasSurface: true`.
- All three renderers `hidden`.
- `sharedFolder == "_liveshare-test"` on all three, non-empty. **Nothing from `data.json` was printed, logged or
  fixtured** — only that boolean.
- `_liveshare-test/smoke.canvas` open and active on all three; all selections cleared.
- All seven canvases: **records equal on every peer pair**.
- **Zero `.pre-v2-smoke` files** anywhere in the three vaults or the repo.
- B's awareness clientID is now `706868428` (it was reloaded twice by the rollback control); A `114193417`,
  C `1168499759`. A is still the lowest and still wins every tiebreak.
- The temporary git worktree used to build the control bundle (`H:/tmp/wp119-pre`) was removed and pruned. The
  stray third vault registration and the `FinaleAbgabe` symlink were not touched.
- Instruments left at `H:\tmp\wp119_lib.py`, `wp119_t1.py`, `wp119_t1b.py`, `wp119_t2t3.py`, `wp119_t4t5.py`,
  `wp119_rollback.py`, `wp119_final.py`; pre-run snapshot at `H:\tmp\wp119_snapshots\20260808-125032\`.
