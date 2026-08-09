# B72 — The Repaint Fix (and the seventeen divergences that were not there)

**Batch:** `B72` · **Worker:** W3 · **Branch:** `fix-bugs-and-raceconditions`
**Charter:** none. Dispatcher brief, three work packages chartered up front (Rule 13).
**Follows:** `B71` (the paint plane, `S192`/`S193`/`S194`). **Owner-approved fix**, not an instrument.
**Signals allocated by this batch:** `S195`, `S196`, `S197`. <!-- signal-register: meta -->
**Scope:** nodes only. No edge work; `S194` is open and untouched.

---

## 0. The one sentence

The seventeen "divergences" in the `b72-postreload` census were **seventeen cards Obsidian had scrolled
off the screen** — a refusal (`getBoundingClientRect()` on a detached element) rendered as a coordinate,
which is `S190`'s failure in a new place; the corrected count is **0 on all three peers**, and the fix the
owner asked for is therefore justified by `S189`'s live measurement and by Obsidian's own source, **not**
by that census, which is silent about the defect.

---

## 1. WP1 — the corrected divergence counts, and what the 17 actually were

### 1.1 The answer

| peer | viewport scale | pre-B72 plane said | **corrected DIVERGENT** | detached (off screen) | agree |
|---|---|---|---|---|---|
| A | 0.4414 | 3 | **0** | 3 | 8 |
| B | 0.5233 | 6 | **0** | 6 | 5 |
| C | 0.5560 | 8 | **0** | 8 | 3 |

**All seventeen were cards outside the viewport.** Not one of them was a wrong position. This is not an
inference from the numbers' shape — the raw dumps already carried the proof, and I read it out of them
before touching a line:

```text
$ python -c "…" workflowArtifacts/canvas-v2/diag/b72-postreload-{A,B,C}.json
   90943d0a189fd75a  src=rect  connected=False  cls=canvas-node
     styleReason    = nodeEl.style.transform carries no readable translate
     computedReason = getComputedStyle(...).transform is '' — no readable translate
     rect           = {'x': -396.72425585813903, 'y': -1119.7990658644712, 'width': 0, 'height': 0}
   …and identically for all 17, on all three peers.
```

Four facts, every one of them already in the dump:

- **`connected: false`** — `nodeEl.isConnected` was false. The element is not in the document.
- **`width: 0, height: 0`** — the client rect was `(0, 0, 0, 0)`, the browser's answer for "this has no box".
- **`getComputedStyle(...).transform === ""`** — there is no computed style for an element outside the document.
- **the inline transform was empty** — `render()` had never run for that card.

### 1.2 The mechanism, from Obsidian's own source

`Canvas.prototype.virtualize()` (read verbatim from `obsidian.asar` → `app.js` during this batch):

```js
virtualize=function(){ … var o=this.getIntersectingNodes(this.getViewportBBox()); …
  for(…of o){ n.has(d) ? d.attach() : (u<10||t ? (d.attach(),u++) : s.delete(d)) }
  … v.forEach(d => d.detach()) … }          // every node outside the bbox is DETACHED
detach=function(){ this.nodeEl.parentNode && this.nodeEl.detach() }
```

So Obsidian removes every off-screen card from the DOM and re-attaches at most ten per frame. B71's plane
took the resulting `(0,0,0,0)` rect at face value and de-transformed client `(0,0)` through the production
inverse. **Client `(0,0)` maps to exactly one canvas point per viewport** — which is why every "divergent"
node on a given peer reported the *same* rect, and why the count tracked the zoom level: further in ⇒ fewer
cards on screen ⇒ more "divergences". The arithmetic checks out exactly: on B and C (identical window
geometry) the implied client origin is `(684.05, 591.3)` px in both cases; on A, a differently-sized window,
`(812.0, 735.4)`.

**The instrument was reporting a refusal as though it were a measurement.** That is the `R7`/`S190` trap, and
it cost this batch its opening hypothesis. `S195`.

### 1.3 The fix

`plugin/src/testing/e2e-control.ts` — diagnostic surface only, **no production source in WP1**:

- the **rect reading refuses** for `isConnected === false`, with a reason that names virtualize();
- it **also refuses** for a zero-area box on an *attached* element (`display:none`, never laid out) — a
  separate arm, because that one is a real anomaly and must not be folded into "detached, nothing to see";
- the verdict gains two categories, checked **before** any comparison:
  `detached` (off screen) and `unpainted` (attached, but no transform `render()` could have written — this
  is `S193`'s `attach()`-without-`render()`, and it is a real state that is *not* a wrong coordinate);
- `detachedNodes` / `detachedCount` / `unpaintedNodes` / `unpaintedCount` / `attachedCount` are reported
  **beside** `divergentCount`, never inside it;
- a detached card **publishes no coordinate** — blank cell, as `unreadableNodes` already did;
- the R7 whole-plane refusal was re-cut: it now fires on `unreadable === count`, not on "nothing published",
  because a board scrolled entirely away legitimately publishes nothing and that is an *answer*;
- `CANVAS_DIAG_PROTO` **2 → 3**.

`tools/e2e/canvas_diag.py` — a proto-2 peer's divergence count now prints with an explicit
*"not trustworthy"* caveat rather than bare, and the two new categories get their own line.

### 1.4 The corrected counts are MEASURED, not recomputed

`h:/tmp/b72_paint_falsify.py` brace-matches the **shipped** `diagPaintCensus` (plus 15 helpers and
`canvasDiagTargets`) verbatim out of the built `plugin/main.js` and runs it under `"use strict"` against
each peer's *own reported state* — its real viewport, its real wrapper rect, its real detached-id list, with
elements that answer exactly what the live dumps recorded. `BK-D0`:

```text
--- BK-D0/C  peer C exactly as it reported itself (scale 0.5560, 8 cards off screen) ---
   count / nodes keyed  = 11 / 3
   sourceCounts         = {"style":3,"computed":0,"rect":0,"none":8}
   DIVERGENT=0  agree=3  detached=8  never-painted=0  unreadable=0
     ·  detached: ["b41O-023800-01-M","b41O-023800-01-n","card1","card2","ee601e293437bced",
                   "from-guest","from-guest-011125","w4e040790"]
        first reason: DETACHED — Obsidian's virtualize() has removed this card from the document
                      because it is outside the viewport…
        its rect reading is null (a refusal, not a point)
   REQUIRED OK    peer C: CORRECTED divergence count is 0 (the pre-B72 plane said 8)
   REQUIRED OK    peer C: all 8 are categorised DETACHED, not DIVERGENT
   REQUIRED OK    peer C: the 3 cards that ARE on screen all agree
   REQUIRED OK    peer C: no detached card publishes a COORDINATE — blank cells, not positions
```

### 1.5 What this does **not** mean

**It does not mean there is nothing to fix.** The `b72-postreload` census was taken *after a reload, with no
gesture* — the known-good state, the one `S189` measured self-heals. A census in that state is **silent**
about the defect, not exculpatory. What justifies WP2/WP3 is:

- **`S189`, measured live with the owner at the keyboard:** the board is visibly disjoint, the doc and all
  three files are identical and correct, and closing/reopening the canvas renders it correctly. The pixels
  drift from a model that stays right. That is a paint defect and nothing else.
- **Obsidian's own source (`S193`/`S196`):** the model and the pixels are written by two different steps.

**The b72 census is now on record as evidence for neither side, and the fix below is built on the two
things that are evidence.**

---

## 2. WP2 — the targeted repaint

### 2.1 The correction to `S193` that I owe, before the fix

`S193` said a repaint enqueued for a detached card is at risk. **Reading the frame loop in full, that is
weaker than B71 assumed, and I am saying so because it weakens my own package:**

```js
requestFrame = … rAF(function(){ …
   if (moved.size>0) { for (re of Array.from(moved)) { … dirty.add(re) } }   // moved → dirty
   t.virtualize();
   for (re of Array.from(dirty)) { re.isAttached && (re.render(), dirty.delete(re)) }
   … moved.clear() })                    // `moved` is cleared; `dirty` is NOT
```

`dirty` is only `.delete()`d for a node that was actually rendered, and `virtualize()` ends with
`u>0 && this.requestFrame()`. **So a repaint owed to a detached card is owed, not forgotten** — Obsidian's
bookkeeping does catch up when the card returns.

What is *not* self-healing is **gate 1**: `requestAnimationFrame` is suspended for a hidden or occluded
window, and `requestFrame()` is guarded by `if (this.frame)` so nothing re-schedules while one is pending.
Three Obsidian windows share one screen; while the owner drags in A, **B and C are occluded**. That is the
gate WP2 removes, and it is the honest claim: `repaintNode` is not "the missing repaint", it is the
**synchronous** one.

### 2.2 The seam, and why

`useCanvasBinding` ships **`false`** (`types.ts:287`), so the live path is `reconcileLiveCanvas`. The
repaint is wired at **all three** remote-apply seams anyway, because "a remote apply repaints its node" is a
property of every such seam or of none — a seam that is right only while a flag is off is exactly §3.11's
wiring gap:

| seam | file:line (post-change) | note |
|---|---|---|
| `reconcileLiveCanvas` geometry branch | `main.ts:3229` | the live route; mute armed by the enclosing bracket |
| `applyCanvasNodeRevert` | `main.ts:4149` | **arms no mute, deliberately, and still does not**: a repaint writes inline styles and produces no vault `modify`, so it needs nothing from the mute either way. That difference (`:3176` mutes, `:4095` does not) is about the *disk*, and the repaint never touches the disk. |
| `applyNodeUpsert` (model bridge) | `canvas-model-bridge.ts:264` | behind `useCanvasBinding`; wired for the reason above |

Each sits behind `outcome === "applied"`. The **structural** branch (`reloadCanvasData` → `setData`,
including `H8`'s edge-endpoint escalation) knows no single id and gets **no** targeted repaint — it is
covered by WP3's sweep only. That is `S197`, named rather than repaired.

### 2.3 What `repaintNode` does

`canvas-adapter.ts` — `repaintNode(nodeId): RepaintOutcome`, an **optional** interface member (the
`getEditingNodeId` / `canvasFile` / `clearFlags` precedent), so every hand-rolled adapter double in the
existing suite stays valid.

```text
missing        the node is not in the live map
interacting    classifyBusyGate says "defer-drag" or "editing"  ─┐ the ONE definer both main.ts
               …or isDragTarget(nodeId) — the per-card arm that  │ sites execute; not a second
               survives a watchdog release (US4 AC11)           ─┘ predicate that can drift
deferred       the card is DETACHED. NOT rendered — that can run initialize() and mount content
               for a node nobody can see. Enqueued via markMoved and PRIORITISED in the sweep.
requested      no `render` on this private shape → enqueued instead
repaired       rendered, AND the inline transform disagreed with the model beforehand
repainted      rendered; it already agreed
```

The staleness read happens **before** `render()` — that is the only moment the answer exists, and it is what
makes WP3's `repaired` counter a measurement rather than a claim.

### 2.4 The before/after, measured through the paint layer

`v2/b72/test_tp01`, **T2**. Same board, same apply, **no frame allowed to run in either arm** (the occluded
window), and `framesRun` is asserted unchanged in both so the difference cannot be an extra frame:

```text
arm A — the fix DISABLED (applyNodeGeometry alone, i.e. unmodified HEAD)
    applyNodeGeometry("n2", {x:900, y:900, …})  → "applied"
    n2.x                                        → 900          the MODEL advanced
    n2.paintedAt()                              → {x:300, y:0} the PIXELS did not
    canvas.framesRun                            → unchanged
    canvas.framesOwed                           → 1            one is owed, and may never arrive

arm B — the fix ENABLED (the same apply, plus repaintNode)
    applyNodeGeometry("n2", …)                  → "applied"
    adapter.repaintNode("n2")                   → "repaired"
    n2.paintedAt()                              → {x:900, y:900}
    canvas.framesRun                            → unchanged     it did NOT get there via a frame

    a2.paintedAt()  !==  b2.paintedAt()          the two arms differ in exactly one call
```

`paintedAt()` parses the element's inline `transform`, which is the same thing the paint plane reads and the
only thing `render()` writes. **The model is right in both arms** — which is precisely why `view`/`doc`/`file`
could not see this.

**T2b** covers the off-screen case honestly: `repaintNode` returns `"deferred"`, `renderCount` is asserted to
stay `0` (nothing was rendered for a card nobody can see), the id joins the priority queue, and the moment
the card is attached again the sweep visits it **first** and it is painted at `(900,900)`.

### 2.5 It does not fight the user

`v2/b72/test_tp02`, and every row asserts on `renderCount` (the DOM witness) as well as on the outcome
string — an `"interacting"` return with a render that happened anyway would pass a string check:

| row | property |
|---|---|
| T1 | mid-drag, the dragged card: `"interacting"`, `renderCount` unchanged |
| T2 | mid-drag, the **sweep**: `skipped: "busy"`, `visited: []`, no card's `renderCount` moves |
| T3 | an open inline editor (Obsidian's own `node.isEditing`) blocks the repaint of **every** card, not just the edited one — `classifyBusyGate` answers `"editing"` for the board |
| T4 | **negative control** — once the interaction ends, the very same calls repaint. A guard that cannot be released is not a guard. |
| T5 | after the drag watchdog releases (`DRAG_WATCHDOG_MS + 1 s`, fake timers), the **retained** card is still protected and the rest of the board is free again |

---

## 3. WP3 — the safety-net sweep

### 3.1 Design, and the one place I did not follow the owner literally

The owner's words were *"randomly selecting a couple of nodes each frame and redrawing them"*. The rate and
batch are mine to argue, and **the sampling is the one thing I changed**:

> Uniform random sampling has **coupon-collector** coverage — `n ln n` draws for one full pass *in
> expectation* — and **no bound at all** on how long one particular card can stay broken. A round-robin over
> a sorted id list repairs every card within `ceil(n / batch)` ticks, **always**. If "restoring force" is to
> mean anything checkable, it has to be a bound, not an expectation.

| decision | value | why |
|---|---|---|
| tick period | **1000 ms** | one interval per mounted canvas, in `main.ts`; the adapter owns no clock for the sweep, so every coverage row is a real test and not a sleep |
| batch size | `clamp(ceil(n/20), 3, 25)` | one full pass per ~20 ticks, floor 3 so a small board still converges, ceiling 25 so a huge board stays invisible |
| order | round-robin from a cursor, **priority first** | priority = ids whose remote change landed while the card was off screen. Bounded by the node count; an entry leaves when the card is painted or stops existing |
| does it idle? | **no** | it repairs damage from causes *nobody has identified*, which by definition are not observable in advance. An "idle when nothing changed" gate would switch it off exactly when the unknown cause fires. The cost is what makes that affordable |
| busy | `isBusy()` → whole tick skipped, counted as `skippedBusy` | same rule as WP2 |

**Cost**, measured (`test_tp03` T7): one tick on a 500-node board performs exactly **25** `render()` calls —
25 inline style writes per second, on values that are usually unchanged. Full coverage of a 500-node board:
20 s. Of the 11-node test board: 4 s.

### 3.2 Observability — the counter that stops it hiding the defect

`describeRepaintSweep()` returns `ticks / skippedBusy / skippedEmpty / visited / **repaired** / repainted /
deferred / requested / interacting / missing / unsupported / cursor / pendingCount / lastBatchSize /
lastNodeCount`, and it is surfaced in the census as a new `repaint` block plus a `REPAINT SWEEP` section in
the driver.

**`repaired` counts only a repaint that landed on a card whose element was demonstrably in the wrong place
before it ran.** So the damage rate stays visible even when the damage does not. R7 all the way down: a peer
that cannot answer says so and never contributes a zero —

```text
REPAINT SWEEP  (B72 WP3 — the restoring force, and how much it had to restore)
  A: NO SWEEP REPORT (diagProto=2) — this peer's bundle is pre-B72; NOTHING is sweeping on it
     and this is not a zero
```

*(that is real output, taken live from the three running vaults minutes ago — see §5.3.)*

Read-only by construction: the narrow `DiagAdapterLike` view names `describeRepaintSweep` and **does not
name** `sweepRepaint` or `repaintNode`, so an instrument cannot drive the sweep it is measuring. Asserted
from source in `test_tp04` T7.

### 3.3 Is it a fix or a workaround, and what does it mask?

**It is a workaround, and it is the owner's deliberate one.** Stated plainly:

- It **cannot fix a wrong model.** Nothing in it reads the doc or the file. It can only ever repair a view
  that disagrees with a model that is already right — which is exactly `S189`'s defect class and nothing else.
  A data defect would be untouched by it and equally invisible to it.
- It **masks the symptom of any unknown paint-loss cause** within `ceil(n/batch)` ticks. On the 11-node test
  board that is ≤4 s, which is fast enough that a human would very likely never see the damage that WP2 is
  aimed at. **That is why `repaired` exists**: a sweep that silently repaired everything would leave the
  board looking correct and the paint plane finding nothing, and would destroy the ability to measure the
  cause. With the counter, a non-zero `repaired` on a board that looks fine *is* the measurement.
- It **would also mask a WP2 regression.** If the targeted repaint were removed, the sweep would still
  converge the board — the census would look identical and only `repaired` would rise. Anyone diagnosing
  after this batch must read `repaired`, not the board.
- If the Dispatcher wants an uncontaminated live reading of the cause, the sweep should be measured with
  `repaired` **before** anything else is concluded, and a future package may want a "sweep off" switch. I did
  not add one: an unused switch is a second code path nobody tests.

---

## 4. Falsifiability — plant → RED → byte-identical restore → GREEN, plus the negative controls

Harness: `h:/tmp/b72_paint_falsify.py` (shipped bundle, brace-matched) and `h:/tmp/b72_plant_restore.py`
(the plant/restore driver). Full output: `h:/tmp/b72_falsify_final.txt`, `h:/tmp/b72_plant_out.txt`.
**Every restore is a copy-aside from `h:/tmp/b72_backup/*.FIXED`** — no `git checkout`, no `git stash`, no
`git restore` (workflow §5.2).

### 4.1 The break that reddened NOTHING, reported first because it is the finding

**`P1a` — disabling the detached-element rect refusal alone reddened nothing.** Expected RED, got GREEN.

The reason is legitimate and it is **subsumption**: a detached element's rect is `(0,0,0,0)`, which the
*zero-area* arm refuses on its own. Two independent guards, either sufficient, for the detached case. Rather
than delete one or rewrite the plant into a single big one, I split the plant conjunct by conjunct so each
line is shown to be load-bearing for *something*:

| plant | what it disables | result | what it reddened |
|---|---|---|---|
| **P1a** | the detach arm of the rect reading | **GREEN — reddened nothing** | subsumed by the zero-area arm for a detached card |
| **P1b** | the zero-area arm | **RED** | `BK-D4` — an *attached* card with a 0×0 box is the case only this arm can see; the plane invented a position again |
| **P1c** | the `detached` verdict precedence | **RED** | `BK-D0` on all three peers + `BK-D2` + `BK-D5` — the 3/6/8 stop being categorised `detached` (they become `never-painted`) |
| **P1d** | all of the above + the `unpainted` precedence | **RED** | `BK-D0` reproduces the **original 3 / 6 / 8** exactly (see below) |

```text
# P1d  ALL THREE — the pre-B72 plane, reconstructed
  planted. sha256 = e893b92137bc05c1…      rebuilt bundle 338ea7b84e0a4594…
  harness exit = 1   -> RED
      DIVERGENT=3  agree=8  detached=0  never-painted=0  unreadable=0     ← peer A
      DIVERGENT=6  agree=5  detached=0  never-painted=0  unreadable=0     ← peer B
      DIVERGENT=8  agree=3  detached=0  never-painted=0  unreadable=0     ← peer C
      REQUIRED FAIL  peer A: CORRECTED divergence count is 0 (the pre-B72 plane said 3)
      REQUIRED FAIL  peer B: CORRECTED divergence count is 0 (the pre-B72 plane said 6)
      REQUIRED FAIL  peer C: CORRECTED divergence count is 0 (the pre-B72 plane said 8)
  RESTORED e2e-control.ts   BYTE-IDENTICAL TO BASELINE: True  sha256=7110fba823aa48da…
```

**Four lines disabled reproduce the exact numbers the live census printed.** That is the strongest form the
WP1 claim can take: the artefact is reproducible on demand, and turning the four lines back on removes it.

### 4.2 WP2 and WP3

| plant | file | result | rows reddened |
|---|---|---|---|
| **P2** | delete `adapter.repaintNode?.(n.id);` from `reconcileLiveCanvas` | **RED**, 2 failed / 27 passed | `test_tp04` **T2** (the criterion: an apply with no repaint) and **T3** (the derived seam set drops 3 → 2) |
| **P3** | `let cursor = … input.cursor % n` → `let cursor = 0` in `planRepaintSweep` | **RED**, 2 failed / 27 passed | `test_tp03` **T1** (bounded coverage, over 8 board sizes) and **T4** (the sweep no longer reaches the damaged cards) |

Both restored byte-identically (`main.ts` `48c22dcbba6dd693…`, `canvas-adapter.ts` `d07bf23293cbe11c…`),
both back to **29/29 GREEN**.

### 4.3 The negative controls — each check shown able to report success

| control | evidence |
|---|---|
| the detach category can report **nothing to see** | `BK-D1` — each peer's own viewport with nothing detached: 0 divergent, 0 detached, 11 agree |
| the detach category does **not swallow a real defect** | `BK-D2` — peer C's 8 detached cards **plus** one attached card at its pre-drag spot → exactly **1 DIVERGENT**, still 8 detached |
| the plane still catches what B71's did | `BK1` (model advanced, element stale) RED; `BK3` (stale ancestor, style agrees, rect diverges) RED; `BK4`/`BK5`/`BK6` (R7 refusals) all still hold |
| a board scrolled entirely away is an **answer** | `BK-D5` — plane available, 11 detached, 0 divergent, 0 fabricated coordinates |
| the WP2 guard can be **released** | `test_tp02` T4 — after the interaction ends the same calls repaint |
| the `repaired` counter can read **zero on a healthy board** | `test_tp03` T5 — 4 ticks, 12 visits, `repainted: 12`, **`repaired: 0`**. This is what makes T4's `repaired: 3` a measurement and not a constant |
| the sweep says when it **has not run** | `test_tp03` T6/T8 (empty board → `"no-nodes"`, unavailable shape → `"unavailable"`, `ticks: 1` — it was asked and refused) and the driver's `ticks=0 — the sweep exists but has NEVER RUN on this peer` line |
| the whole plant/restore cycle | after every plant: source **and** rebuilt bundle byte-identical to baseline; `required checks failed : 0`; `===== CYCLE COMPLETE =====` |

### 4.4 What the tests cannot catch, said plainly

`obsidian-render-double.ts` is a **reimplementation** of Obsidian's `moveAndResize` / `render` / `attach` /
`detach` / frame loop, quoted in its own header. It cannot catch a mistake in *my reading* of those lines —
only the bundle-extraction harness can do that, and it is what WP1's numbers rest on. Per B71's finding, it
also **cannot reproduce a lost receiver or a never-constructed element**: it is an object literal closing
over its own data lexically. That class is covered by `test_tp04`'s source census, which asserts over the
product's own text — the one oracle a double cannot fake — and by the P2 plant, which shows the census
catches a deleted wiring hunk that `tsc` and the rest of the suite do not.

---

## 5. Gates, measured in this session, on a quiet tree, after the last source change

| gate | command actually run | result |
|---|---|---|
| `tsc` | `./node_modules/.bin/tsc -noEmit -skipLibCheck` (from `plugin/`) | **exit 0, clean** |
| suite | `./node_modules/.bin/vitest run` (from `plugin/`) | **448 files / 3404 tests passed, 0 failed** |
| — baseline was | B71's 444 / 3375 | **+4 files, +29 tests — exactly this batch's, nothing lost** |
| register | `python workflowArtifacts/canvas-v2/check_signal_register.py` | **exit 0**, `control: all classes proved`, 257 files |
| e2e bundle | `npm --prefix plugin run build:e2e` | clean · **5 966 343 B** · `sha256[:16] b55097a2ede87556` |
| falsifiability | `python h:/tmp/b72_paint_falsify.py plugin/main.js` | **exit 0**, 12 scenarios (§4) |
| plant/restore | `python h:/tmp/b72_plant_restore.py` | **CYCLE COMPLETE**, 6 plants, every digest byte-identical |
| biome (read-only) | `./plugin/node_modules/.bin/biome check <changed>` | see §5.2 |

`S180` NUL scan on every changed text file: **0** NUL bytes (12 files).

### 5.1 A tool trap worth one line

**`npx biome` in this repo resolves to an unrelated package, version `0.3.3`, and exits 0 while checking
nothing.** The real checker is `plugin/node_modules/.bin/biome`, **1.9.4**. I ran the wrong one first and it
reported a clean file that in fact had ten errors. Anyone quoting a biome figure on this tree must use the
explicit path.

### 5.2 biome, against HEAD

| files | HEAD | now |
|---|---|---|
| `e2e-control.ts` | 9 errors (8 × `useTemplate` + 1 whole-file `format`) | **9** — I introduced one and removed it before reporting |
| `main.ts` + `canvas-adapter.ts` + `canvas-model-bridge.ts` | 13 errors (9 lint + 3 `format` + …) | **13**, same set, line numbers shifted |
| `v2/b72/` (5 new files) | — | **0** |

`biome check --write` was **not** run (it corrupts this tree). No pre-existing error was "fixed".

### 5.3 A live negative control obtained for free

The three vaults are still executing the **old** bundle, so a read-only census (`--op census`, destroys
nothing) is the new driver reading a `diagProto: 2` dump — i.e. its own honesty check, taken live:

```text
PLANE A PAINT PRE-B72 (diagProto=2 < 3) — this plane counts cards that Obsidian has VIRTUALIZED
   OFF SCREEN as DIVERGENT. Its divergent count below is not trustworthy; a card at the same rect
   as every other 'divergent' card on this peer is a detached element, not a position
  A: 3 DIVERGENT · 8 agree · 0 detached(off-screen) · 0 never-painted · 0 unreadable
  …
  A: NO SWEEP REPORT (diagProto=2) — this peer's bundle is pre-B72; NOTHING is sweeping on it
     and this is not a zero
```

Raw: `workflowArtifacts/canvas-v2/diag/b72-driver-check-{A,B,C}.json`. The board has not moved: the live
figures are identical to `b72-postreload`, down to the rects.

---

## 6. What the Dispatcher must ask the owner to do

### 6.1 State right now

- `main.js` on **A**, **B** and **C** is the B72 bundle **`b55097a2ede87556`, 5 966 343 B**, staged and
  digest-verified after copy.
- The previous bundle `d6bb30d07cef27ae` (B71's) is backed up at **`h:/tmp/b72_backup_d6bb30d07cef27ae/`**
  (`A-main.js`, `B-main.js`, `C-main.js`, digests verified after copy).
- `manifest.json`, `styles.css` and `data.json` were **not touched, not read and not copied.**
- **All three processes still execute the old bundle from memory. Nothing about the vaults' behaviour has
  changed yet.** There is no reload route in the control surface.
- Roles at this batch's last `session.info`: A host, B guest, C guest — **re-read it, roles migrate (`S139`)**.

### 6.2 The ask

> **Step 1 — Reload all three windows.** `Ctrl+P` → *"Reload app without saving"* in A, B and C. All three
> must be on the new bundle before anything is armed, or a dump mixes two builds — and it will now *say* so
> (`PAINT PRE-B72` names the peer).

> **Step 2 — Confirm the new plane and the sweep, no gestures needed.**
> ```bash
> cd "h:/My Code/AgenticWorkspace/Projects/_external/liveshareCollab/obsidian-live-share"
> python tools/e2e/canvas_diag.py --ports 39431,39432,39433 \
>     --path "_liveshare-test/smoke.canvas" --op census --label b72-orient
> ```
> **Expected**, and each of these is a real check:
> - the `PLANE x PAINT PRE-B72` caveat is **GONE** on all three (that is how you know the reload took);
> - `PAINT vs MODEL` reads `0 DIVERGENT · N agree · M detached(off-screen)` with **M ≈ 3–8 depending on the
>   zoom** — a non-zero `detached` count is CORRECT and is the whole point of WP1;
> - `REPAINT SWEEP` reads `REPAIRED=0 (ticks=<n>…)` with **`ticks` > 0**. `ticks=0` prints its own warning
>   and means the sweep is not running — treat that as a failure, not a pass.

> **Step 3 — the live positive control for WP1, and please do not skip it.** On **any one peer**, scroll or
> zoom the board so that clearly different cards are on screen, then re-run the census. **Expected:** the
> `detached` list *changes* and `DIVERGENT` stays `0`. Without this, "0 divergent" is a green nobody has
> shown can move. (`B70`'s outstanding `BK3` — close `smoke.canvas` on C only, re-census, reopen — is still
> owed and is still worth doing in the same session.)

> **Step 4 — THE RUN. Reproduce the break, with the recorder armed.**
> ```bash
> BOARD="_liveshare-test/smoke.canvas"
> python tools/e2e/canvas_diag.py --ports 39431,39432,39433 --path "$BOARD" --op arm  --label b72-fix
> #  owner: ONE ~100 px drag of an EDGE-ENDPOINT node on the HOST (`208541a49dc66c4c`,
> #  the one B70 characterised, 3 edges). Nothing else — no scroll, no pan. Wait ~3 s.
> python tools/e2e/canvas_diag.py --ports 39431,39432,39433 --path "$BOARD" --op dump --label b72-fix
> python tools/e2e/canvas_diag.py --ports 39431,39432,39433 --op clear --label teardown
> ```
> **This arm destroys the previous baseline.** Say so; the b71/b72 baselines are already dumped to disk.
>
> **Do the drag TWICE, and the difference between the two runs is the experiment** (`S196` gate 1):
> **(a)** once with **B and C occluded** behind A, which is the state that suspends their `requestAnimationFrame`;
> **(b)** once with **all three windows visible side by side**.

> **What to read, in this order.**
>
> | reading | meaning |
> |---|---|
> | `REPAINT SWEEP … REPAIRED=0` and the board looks right | the targeted repaint (WP2) held; the sweep had nothing to do |
> | `REPAIRED > 0` and the board looks right | **the most informative outcome.** Something is still losing paints and the sweep is repairing them. The number IS the damage rate; do not read the correct-looking board as "fixed" |
> | `DIVERGENT > 0` on an **attached** card | the real defect, still live, now visible for the first time. Note whether it appeared only in the occluded run |
> | `DIVERGENT = 0`, `detached > 0`, board looks right | converged |
> | board still looks wrong with `DIVERGENT = 0` and `REPAIRED = 0` | the nodes are innocent — go to `S194`, the **edges**, and charter the two accessors |
> | dragging feels worse than before | stop and say so. That is a WP2 regression regardless of convergence |

> **Step 5 — rollback, if wanted.** Copy the three files from `h:/tmp/b72_backup_d6bb30d07cef27ae/` back over
> `<vault>/.obsidian/plugins/live-share/main.js` and reload. Nothing else needs undoing.

---

## 7. What I did **not** fix

| # | finding | status |
|---|---|---|
| `S195` | the paint plane counted every virtualized-away card as a divergence; 17 of them, all artefacts | **CLOSED by WP1** |
| `S196` | a remote apply moved the model and left the pixels to a frame that may never run | **CLOSED by WP2 + WP3** |
| `S197` | the whole-board `setData` path has **no targeted repaint** — it knows no single id, so there is nothing O(1) to repaint; covered only by the sweep, i.e. within `ceil(n/batch)` ticks rather than immediately. Repainting every node after a `setData` would be an O(n) synchronous render on a path that already fires on every edge-endpoint move | **OPEN — residual, named** |
| `S194` | nothing in the rig looks at an **edge** | **OPEN and UNTOUCHED**, per the owner's scope ruling (*"the edges never moved to my knowledge, so just nodes is fine for now, you can mark it as potential issue going forward"*) |
| `S193` | **partly corrected by this batch, and the correction weakens it:** the `dirty` set is *not* lost for a detached card — `moved` is drained into `dirty` and only rendered nodes are deleted from it. The live half is gate 1 (a suspended rAF), now carried in `S196` | **OPEN, amended** |
| `S191` | `safeCall` receiver loss — still why dumps are labelled A/B/C by port order with `vaultName: ""` | **OPEN, untouched** |
| `H8` | `main.ts:3231-3235` still escalates a moved edge-endpoint node into a whole-board `setData` | **untouched** — REFUTED for the measured trial at B71, and out of this batch's scope |

Also deliberately left alone:

- **No "sweep off" switch.** An unused switch is a second code path nobody tests. If a future package needs
  an uncontaminated reading of the cause, that is the moment to add one — with a test.
- **The `repaired` staleness read uses the inline transform only**, not `getComputedStyle`. A card whose
  inline transform is correct but which is displaced by a stale *ancestor* transform (B71's `BK3` case) would
  be repainted and counted as `"repainted"`, not `"repaired"`, and the repaint would not help it. The paint
  plane's rect reading is what sees that class; the sweep deliberately does not force a layout (an
  instrument may, a production timer at 1 Hz must not).
- **9 pre-existing biome errors in `e2e-control.ts`** — verified identical to HEAD, not "fixed".

---

## 8. Register

`S195`, `S196`, `S197` appended to `SIGNAL_REGISTER.md` §3a; `NEXT_FREE` bumped **195 → 198** at
`check_signal_register.py:53`. Run **after** every file this report covers — including this report — was on
disk:

```text
$ python workflowArtifacts/canvas-v2/check_signal_register.py
scanned 257 files under canvas-v2/  (control: all classes proved)
baselined debt: 136 citations across 62 keys
clean - no NEW violations. (29 baselined citations have since gone)
EXIT=0
```

---

## 9. Files changed

| file | change | sha256[:16] |
|---|---|---|
| `plugin/src/canvas/canvas-adapter.ts` | **production.** `repaintNode` / `sweepRepaint` / `describeRepaintSweep`; pure `parseTranslatePx` / `repaintBatchSize` / `planRepaintSweep`; `render?` on `CanvasNode`, `markMoved?` on `PrivateCanvas`; first import (`classifyBusyGate`) | `d07bf23293cbe11c` |
| `plugin/src/main.ts` | **production.** repaint at the reconcile + revert seams; `canvasRepaintSweeps` map, `startCanvasRepaintSweep` / `stopCanvasRepaintSweep`, wired at mount, view-close and both teardown paths | `48c22dcbba6dd693` |
| `plugin/src/canvas/canvas-model-bridge.ts` | **production.** repaint at the third (flag-gated) apply seam | `d8598a6158c3f658` |
| `plugin/src/testing/e2e-control.ts` | WP1: the detach/zero-area refusals, `attachment`/`everPainted`, the two new categories, `diagRepaintReport`, `CANVAS_DIAG_PROTO` 2→3 | `7110fba823aa48da` |
| `plugin/src/__tests__/v2/b72/obsidian-render-double.ts` | new — the frame-loop-faithful double | `5bd1bffcc2b07246` |
| `plugin/src/__tests__/v2/b72/test_tp01_…repaints_its_card.test.ts` | new — 7 tests, incl. the before/after | `ddbf6e75ccf6b048` |
| `plugin/src/__tests__/v2/b72/test_tp02_…never_fights_the_user.test.ts` | new — 5 tests | `5e8bd43a644b5a80` |
| `plugin/src/__tests__/v2/b72/test_tp03_…restoring_force_and_it_counts.test.ts` | new — 10 tests | `fcacd7bf2957134f` |
| `plugin/src/__tests__/v2/b72/test_tp04_…wires_every_remote_apply_seam.test.ts` | new — 7 tests, source census | `9f5fcdb9dc79f6b8` |
| `tools/e2e/canvas_diag.py` | the proto-3 caveat, the two new categories, `REPAINT SWEEP` | `8e576d5fb9bea7a4` |
| `workflowArtifacts/canvas-v2/SIGNAL_REGISTER.md` | `S195`, `S196`, `S197` rows | `649e9e7105f08ab9` |
| `workflowArtifacts/canvas-v2/check_signal_register.py` | `NEXT_FREE = 198` | `3079ab21e37f6991` |
| `workflowArtifacts/canvas-v2/ImplementationReport_B72_RepaintFix.md` | this file | — |
| `plugin/main.js` | rebuilt e2e bundle (build output, gitignored) | `b55097a2ede87556` |
| `<3 vaults>/.obsidian/plugins/live-share/main.js` | staged; previous bundle backed up to `h:/tmp/b72_backup_d6bb30d07cef27ae/` | `b55097a2ede87556` |
| `workflowArtifacts/canvas-v2/diag/b72-driver-check-{A,B,C}.json` | live read-only census, §5.3 | — |

Not committed — the Dispatcher verifies and commits on this project.

**Secrets:** no `data.json` was read, copied, hashed or referenced. No credential, token or passphrase
appears in this report, in any script written for it, or in any tool call made during it.
