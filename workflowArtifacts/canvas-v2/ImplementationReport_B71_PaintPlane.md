# B71 — The Paint Plane

**Batch:** `B71` · **Worker:** W3 · **Branch:** `fix-bugs-and-raceconditions`
**Charter:** none. Dispatcher brief, no W2 spec — *"build a fourth plane — the PAINT plane"*.
**Follows:** `B70` (the view-plane accessor, `S190`). **Unblocks:** the line-level attribution of `S189`.
**Signals allocated by this batch:** `S192`, `S193`, `S194`. <!-- signal-register: meta -->
**Test mandate:** suspended for diagnostic tooling by owner order. No vitest test was written, amended,
weakened or skipped. Two frozen import allow-lists were **amended**, in the documented §7 form (§2.2).

---

## 0. The one sentence

`view`, `doc` and `file` are three readings of **one model**, so they agree with each other by construction
and no dump this rig has ever produced could see the owner's symptom; `paint` reads the card's own DOM
element, and Obsidian's shipped renderer says in its own code that the model and the element are updated by
**two different steps**, the second of which can be skipped.

---

## 1. What I built

### 1.1 The plane

`plugin/src/testing/e2e-control.ts` — `diagPaintCensus(plugin, path)`, added beside `diagViewCensus` /
`diagDocCensus` / `diagFileCensus`, wired into `diagCensus` as the **first** plane taken (smallest possible
window between "what the model said" and "what was on the screen when we asked"). `CANVAS_DIAG_PROTO`
**1 → 2**.

**No production source was changed.** The two adapter members the plane needs already existed on
`CanvasAdapter`:

```text
canvas-adapter.ts:984   getNodeEl(nodeId)     → canvas.nodes.get(id).nodeEl        ONE property read
canvas-adapter.ts:946   getOverlayHost()      → canvas.wrapperEl ?? canvas.canvasEl  ONE property read
canvas-adapter.ts:950   getViewport()         → canvas.x / y / zoom / scale
```

They are declared **optional** on `DiagAdapterLike`, so a peer whose bundle lacks one says *which member*
rather than reading nothing. `isBusy` / `getEditingNodeId` remain absent by construction (R2).

### 1.2 Three readings per node, and why each earns its place

| reading | source | sees | blind to |
|---|---|---|---|
| `styleTransform` | `nodeEl.style.transform` parsed for its `translate`, + `style.width/height` | the **instruction** Obsidian wrote. Exact, integral, directly comparable to the model's four numbers | anything that overrides the inline style |
| `computed` | `getComputedStyle(nodeEl).transform` → `matrix(a,b,c,d,e,f)` | a class or stylesheet rule that overrode the inline style | — |
| `rect` | `getBoundingClientRect()` de-transformed back into canvas space | **real laid-out pixels** — a stale ancestor transform, a detached element, a `display:none` | sub-pixel rounding (tolerated) |

**Why I trust the DOM path — it is not inferred, it is Obsidian's own line.** From the shipped renderer
(`resources/obsidian.asar` → `app.js`), `CanvasNode.prototype.render()`, verbatim:

```js
t.setCssStyles({ transform: "translate(".concat(n,"px, ").concat(i,"px)"),
                 width: "".concat(r,"px"), height: "".concat(o,"px") })
//  t = this.nodeEl,  n = this.x,  i = this.y,  r = this.width,  o = this.height
```

So the card's inline `transform` **is** its `x`/`y` in canvas coordinates and its inline `width`/`height`
**are** the model's, in px — exactly what `diagParseTransformTranslate` + `diagParsePx` read. And the
container carries the viewport:

```js
E.style.transform = "translate(" + x/2 + "px, " + y/2 + "px) scale(" + m + ") translate(" + -l + "px, " + -c + "px)"
//  E = canvasEl,  x/y = wrapper size,  m = scale,  l/c = canvas.x / canvas.y
```

which is precisely the transform the plugin's own `canvasToScreenRel` implements, so its inverse —
`clientToCanvasManual` — is the correct de-transform for the rect reading. **I import those two production
functions rather than re-deriving them** (§2.2): getting the `zoom` (log₂) vs `scale` (linear) distinction
wrong there does not fail loudly, it yields a paint plane that cries divergence on a healthy board.

### 1.3 The verdict is split, so the instrument cannot cry wolf

- `styleVerdict` — all four numbers, **exact** (±0.01). Both sides come from the same instruction path.
- `rectVerdict` — **position only**, tolerance `1/scale + 0.01` canvas units. Size is deliberately excluded
  from the verdict: a border/padding/`box-sizing` difference would offset every card's rect width by a
  constant, and a plane that reports eleven divergences on a healthy board is exactly as useless as one that
  reports none on a broken one. The size numbers are still **reported**; they just do not drive a verdict.
- overall = `DIVERGENT` if either is, `agree` if either agrees and neither diverges, else `unreadable`.

**A signature worth knowing:** all eleven nodes `rect`-DIVERGENT by the *same* offset while `style` agrees
is a **stale/animating container transform**, not per-card paint loss. One node diverging is the `H9` shape.

### 1.4 R7 — every failure names itself, none of them returns a zero

| condition | what the plane does |
|---|---|
| the adapter has no `getNodeEl` | plane UNAVAILABLE, reason **names the member** |
| `getNodeEl` returns null / throws for **one** node | that node is **absent** from `nodes` (blank cell), listed in `label.unreadableNodes` with its own reason; `count` (11) vs keyed nodes (10) makes the gap visible in the dump itself |
| **no** node's element could be read | the whole **plane refuses** with a reason — it never hands back eleven stationary cards |
| no viewport / no wrapper rect | only the **rect** reading downgrades, with its reason; the style readings still stand |
| the transform is `none` / unparseable | `null`, never `{x:0,y:0}` — a card at the origin is a real answer and must not be manufactured |

### 1.5 The driver

`tools/e2e/canvas_diag.py` — `PLANES = ("paint", "view", "doc", "file")`, paint first because it is the only
plane that can disagree. New `PAINT vs MODEL` section printed **before every other table**, and a
`PAINT_PLANE_PROTO = 2` check so a peer on an older bundle prints

```text
PLANE A PAINT ABSENT — this peer's dump is diagProto=1 (< 2); its bundle has no paint plane,
                        so NOTHING here has looked at the pixels on this peer
```

rather than silently omitting the row. *(That is not a description — §3 has it running live.)*

### 1.6 Disclosed observation effect

`getBoundingClientRect()` forces a synchronous layout, so pending **style** changes are laid out at that
instant. It cannot run Obsidian's render step and cannot move a card, but the instrument does touch the
layout clock and a reader should know it. Everything else is a property read.

---

## 2. `H9`: the shape is CONFIRMED from source, the writing line is NOT in the plugin, and the live measurement is still owed

### 2.1 What `H9` said, and what is actually true

> *`H9`: something assigns `node.x` / `node.y` directly without invoking the node's render/`moveAndResize`.*

**The literal form is REFUTED, and the underlying shape is CONFIRMED one level deeper: it is
`moveAndResize` itself that does not repaint.**

**(a) The plugin never writes a canvas node's geometry directly — demonstrated from the tree.** The
tree-derived view-mutator vocabulary (`wp87/surface-route-census.ts#deriveViewMutators`, which reads
`canvas-adapter.ts`'s own declaration block rather than a hand list) is
`{setData, requestFrame, requestSave, moveAndResize}`, and the plugin has exactly two geometry sinks:

```text
canvas-adapter.ts:1152   node.moveAndResize({x, y, width, height})     ← applyNodeGeometry
canvas-adapter.ts:~1160  c.setData(data); c.requestFrame?.()           ← reloadCanvasData
```

A comment-stripped sweep for `.x =` / `.y =` over `plugin/src/` finds **no** assignment to a canvas node's
coordinates anywhere; the only hits are `canvas-presence.ts:576-577`, `this.x = x` on a presence **overlay**
object, which is not a canvas node.

**(b) Obsidian's own sinks write the model and only ENQUEUE a repaint — demonstrated, verbatim, from the
shipped renderer.**

```js
// CanvasNode.prototype.moveAndResize  — the callee of canvas-adapter.ts:1152
e.prototype.moveAndResize = function (e) {
  this.x = Math.round(e.x); this.y = Math.round(e.y);
  this.width = Math.round(e.width); this.height = Math.round(e.height);
  this.canvas.markMoved(this)          // ← and that is the whole body. nodeEl is not touched.
}

// CanvasNode.prototype.setData — what canvas.setData → importData calls for an EXISTING node
… isNaN(n) || this.x === n || (this.x = n, c = !0, l = !0) … l && t.markDirty(this), c && t.markMoved(this)

// the frame loop — the ONLY caller of render(), and the gate
e.prototype.markMoved = function (e) { this.moved.add(e), this.requestFrame() }
… this.frame = this.frameWin.requestAnimationFrame(function () { …
     t.virtualize();
     for (… of Array.from(L /*dirty*/)) { re.isAttached && (re.render(), L.delete(re)); }
     … P.clear() })

// and attach() appends a card WITHOUT positioning it
e.prototype.attach = function () { var e = this.nodeEl, t = this.canvas;
  e.parentNode || t.canvasEl.appendChild(e); this.updateBreakpoint(…) }
```

**So the model and the pixels are updated by two different steps, and the second one is asynchronous and
conditional.** *"The model advanced and the card never moved"* is a **structurally reachable state of
Obsidian's renderer**, reachable through **both** of the plugin's sinks, and — this is the point — it is
invisible to `view`, `doc` and `file` **by construction**, because all three read the model side of that
split. That is `S192`; the mechanism is `S193`.

### 2.2 The two gates, and which one to suspect

1. **Does the frame ever run?** `requestAnimationFrame` is suspended for a hidden or occluded window. Three
   Obsidian windows share one screen; while the owner drags in A, B and C are occluded. `requestFrame()` is
   guarded by `if (this.frame)`, so nothing re-schedules while one is pending — it *should* catch up when the
   window becomes visible, and that is testable rather than assumable.
2. **Is the node attached when it does?** `virtualize()` **detaches** every node outside the viewport and
   attaches at most **10 newly-visible nodes per frame**. `render()` is skipped for detached nodes (they stay
   dirty, so this too *should* catch up).

Both "should"s are exactly the kind of self-healing claim this project has been burned by. **The paint plane
is what turns them into readings.**

### 2.3 What I am NOT claiming

- I have **not** shown that a repaint was actually skipped on the owner's board. That is one live run away
  and it is §5.
- `S193` is **argued from source** (Obsidian's, quoted verbatim), not demonstrated live. §3.7's split, kept.
- **A rival explanation is live and I could not exclude it — `S194`.** Nothing in this rig looks at an
  **edge**. The plugin's own comment says the failure it fears is an edge one — *"the live edges keep their
  OLD routing (fromSide/toSide) → arrows look detached"* (`main.ts:3160-3166`), which is the entire reason
  the `H8` escalation exists. A board whose eleven nodes are all correct and whose **six edges** are
  mis-routed is a board every plane of this rig reports as converged, and to the eye *"a neighbouring node
  has visibly shifted"* is exactly what a card with a wrongly-routed arrow looks like. I did not build it:
  out of mandate, and it needs two new read-only accessors on production `canvas-adapter.ts`. Design in the
  register row.

### 2.4 Byproduct worth a line

Obsidian `Math.round`s every geometry it accepts (`moveAndResize`, `setData`). A fractional coordinate the
plugin sends is silently **not** the one stored — and `applyNodeGeometry`'s `node.x === geo.x` "unchanged"
short-circuit compares the plugin's unrounded value against Obsidian's rounded one.

---

## 3. Live output from the currently-broken board

The board was in the broken state throughout this batch and **I did not ask anyone to touch it.** Three
things were obtainable without a reload; the fourth was not.

### 3.1 The model planes, re-read from the broken board (read-only, `--op census`)

`workflowArtifacts/canvas-v2/diag/b71-broken-preexisting-{A,B,C}.json`. Byte-for-byte the same table B70
recorded, hours later, with the board still visibly broken:

```text
=== b71-broken-preexisting : op=census ===
peers: A=39431 host  B=39432 guest  C=39433 guest
NODE          PLANE  A               B               C               FLAG
208541a49dc66 view   (1820,-133)     (1820,-133)     (1820,-133)
208541a49dc66 doc    (1820,-133)     (1820,-133)     (1820,-133)
208541a49dc66 file   (1820,-133)     (1820,-133)     (1820,-133)
…all eleven nodes identical on all three planes and all three peers…
AWARENESS
  A: lockMeta={'208541a49dc66c4c': {'origin': 'gesture', …}}   locks=1
  B: locks 0    C: locks 0        epochs={'208541a49dc66c4c': 'undefined'}   (GAP-7, S187)
```

**Three planes, three peers, eleven nodes, zero disagreement — on a board the owner is looking at and calling
broken.** That is `S192` stated as a measurement rather than an argument.

### 3.2 The driver's R7 refusal, live on the three broken peers

The vaults are still running the **pre-paint** bundle, so this is the new driver reading a `diagProto: 1`
dump — the negative control for its own honesty, taken live:

```text
PLANE A PAINT ABSENT — this peer's dump is diagProto=1 (< 2); its bundle has no paint plane,
                        so NOTHING here has looked at the pixels on this peer
PLANE B PAINT ABSENT — …
PLANE C PAINT ABSENT — …

PAINT vs MODEL  (nodeEl geometry vs canvas.nodes[id].x/y — the only cross-check here)
  A: NO PAINT PLANE (diagProto=1) — not measured
  B: NO PAINT PLANE (diagProto=1) — not measured
  C: NO PAINT PLANE (diagProto=1) — not measured
  (no peer produced a readable paint plane — see the reasons above)

NODE          PLANE  A               B               C
208541a49dc66 paint  —               —               —
208541a49dc66 view   (1820,-133)     (1820,-133)     (1820,-133)
```

Raw: `diag/b71-old-bundle-proto1-{A,B,C}.json`. **An absent plane prints as absent, not as agreement** — the
exact confusion `S190` cost a session to.

### 3.3 What could NOT be obtained, stated plainly

**The paint geometry of the currently-broken board is unobtainable and will be lost on reload.** Reasons,
checked rather than assumed:

- The control surface has no reload and no eval; the paint plane only exists in a bundle none of the three
  processes has loaded.
- **No remote-debugging port.** I read all five Obsidian process command lines: no `--remote-debugging-port`,
  so there is no CDP route into the live renderer either.

**This is not fatal and the Dispatcher should say so to the owner: the break is reproducible by one drag.**
The evidence being lost is one instance of a symptom that recurs on demand, not a unique artefact.

**Before the reload, one thing is worth asking the owner for and it takes ten seconds: a screenshot of each
broken window.** It is the only record of the current pixels that will survive, and it can be checked against
`§3.1`'s coordinates afterwards.

---

## 4. Falsifiability

Two instruments, both driven off the **real shipped bundle** rather than a re-implementation:

- `h:/tmp/b71_paint_falsify.py` — brace-matches **16 blocks + `canvasDiagTargets`** verbatim out of
  `plugin/main.js` (`viewportScale`, `clientToCanvasManual`, `diagPlaneUnavailable`, `diagErrorText`,
  `narrowDiagAdapter`, `resolveDiagTargetsResult`, `diagParseTransformTranslate`, `diagParsePx`,
  `diagAsElement`, `diagReadRect`, `diagComputedStyle`, `diagClassName`, `diagPaintCensus`,
  `safeNodeGeometry`, `toCanonicalPath`, `normalizePath`) and runs them under `"use strict"` against a stub
  canvas holding **the eleven real node ids at the geometry the live peers reported**, plus a stub DOM this
  harness positions on purpose. Exit 0 only if **every** scenario produces its required verdict.
- `h:/tmp/b71_plant_restore.py` — the source plant, rebuild, byte-identical restore.

**One value stands in for an Obsidian API and it is disclosed:** `Platform.isWin` is stubbed `false` for
`toCanonicalPath`, which is the identity on this ASCII board — the same answer the live Windows peers get for
this path. Nothing in the paint plane touches it.

### 4.1 BK1 — the planted break: RED

The `H9` shape, with the real numbers: node `208541a49dc66c4c`'s model at the post-drag `(1820,-133)` while
its element is left at the pre-drag `(1320,-203)`.

```text
--- BK1  PLANTED BREAK — model advanced, element left at the pre-drag spot ---
   plane.available      = true
   count / nodes keyed  = 11 / 11
   sourceCounts         = {"style":11,"computed":0,"rect":0,"none":0}
   DIVERGENT / agree / unreadable = 1 / 10 / 0
     >> 208541a49dc66c4c  model=(1820,-133) style=(1320,-203) rect=(1320,-203)
        offset=(-500,-70) [style=DIVERGENT rect=DIVERGENT]
   REQUIRED OK    exactly 1 DIVERGENT
   REQUIRED OK    and it is the node whose element is stale
   REQUIRED OK    style reading caught it
   REQUIRED OK    rect reading caught it too
   REQUIRED OK    the reported offset is the real displacement
   REQUIRED OK    the other ten still read agree — no blanket alarm
```

### 4.2 BK2 — the NEGATIVE CONTROL: GREEN, and it is the harder half

Same harness, same bundle, same eleven nodes, elements painted where the model says:

```text
--- BK2  NEGATIVE CONTROL — every element painted where the model says ---
   plane.available      = true
   count / nodes keyed  = 11 / 11
   DIVERGENT / agree / unreadable = 0 / 11 / 0
   REQUIRED OK    0 DIVERGENT on a healthy board
   REQUIRED OK    all 11 nodes verdict=agree
```

**BK1 and BK2 differ in exactly one stub value.** The plane goes red for a real divergence and green for
agreement, on the same code path, in the same run. Neither reading is a green nobody has shown can fail, and
neither is an alarm that cannot be silenced.

### 4.3 BK3 — the reading that would otherwise not have earned its place

Inline transform correct, laid-out rect displaced (a stale ancestor transform):

```text
     >> 208541a49dc66c4c  model=(1820,-133) style=(1820,-133) rect=(1320,-63)
        offset=(0,0) [style=agree rect=DIVERGENT]
   REQUIRED OK    the STYLE reading agrees — it structurally cannot see this
   REQUIRED OK    the RECT reading catches it — this is why the third reading exists
```

This is the brief's *"an element positioned correctly but under a stale CSS transform"* alternative,
demonstrated detectable.

### 4.4 BK4/BK5/BK6 — R7: a refusal is never a zero

```text
--- BK4  one node has no card element ---
   count / nodes keyed  = 11 / 10
     ?? 208541a49dc66c4c  UNREADABLE — getNodeEl returned null — this node has no card element
        present in plane.nodes? false
   unreadableNodes      = ["208541a49dc66c4c"]

--- BK5  no card element for any node ---
   plane.available      = false
   plane.reason = "no card element could be read for any of 11 live nodes — first reason:
                   getNodeEl returned null — this node has no card element"

--- BK6  this bundle's adapter has no getNodeEl ---
   plane.available = false
   plane.reason = "this bundle's adapter exposes no getNodeEl — the paint plane needs the card
                   element and will not guess one from the model"
```

### 4.5 BK7 — the source plant, and the byte-identical restore

Plant: make the paint plane manufacture its "element" **from the model** instead of asking for the real
`nodeEl` — i.e. turn it back into a fourth reading of the model, the exact defect class `S192` is about.
Restored **by copy-aside** from `h:/tmp/b71_backup/e2e-control.ts.FIXED`; no `git checkout`, no `git stash`,
no `git restore` (workflow §5.2).

```text
# STEP 0 — baseline
  source sha256 = d681fdfe9a36a9bece3dbb3d0c8c87c7dbf20eafa49eaeffb3eb7d62082db46d
  bundle sha256 = d6bb30d07cef27ae971dc787242cf66df522ea9b8cf4aa4d697b1559e476cf8b
  harness exit = 0

# STEP 1 — PLANT: the paint plane reads the MODEL, not the card element
  planted. source sha256 = e93e5819324645b1…  (differs: True)
  rebuilt. bundle sha256 = ae978954d542769e…  (differs: True)
  BK1 planted break RED      : *** MISSED ***
  BK2 negative control GREEN : GREEN (agrees)
  BK3 rect-only divergence   : *** MISSED ***
  required checks failed     : 14
  VERDICT  RED — with the DOM read removed, the plane MISSES the planted divergence.

# STEP 2 — RESTORE by copy-aside
  source sha256 = d681fdfe9a36a9bece3dbb3d0c8c87c7dbf20eafa49eaeffb3eb7d62082db46d
  SOURCE BYTE-IDENTICAL TO BASELINE: True
  bundle sha256 = d6bb30d07cef27ae971dc787242cf66df522ea9b8cf4aa4d697b1559e476cf8b
  BUNDLE BYTE-IDENTICAL TO BASELINE: True
  BK1 planted break RED      : RED (detected)
  BK2 negative control GREEN : GREEN (agrees)
  BK3 rect-only divergence   : RED (rect only)
  required checks failed     : 0
  VERDICT  GREEN — every scenario back, including BK1's RED.
===== CYCLE COMPLETE =====
```

Note **BK2 stayed green through the plant**: a plane that reads the model agrees with the model trivially.
That is the point — *only the pair* is evidence, and a negative control alone would have passed on the
broken build.

### 4.6 Breaks that reddened nothing

None planted that reddened nothing. Every plant reddened, and each reddened the reading it was aimed at.

### 4.7 The live control still owed

The plane has not yet been shown to go red **inside a running Obsidian**. `B70`'s `BK3` (close the board on C
only, C flips to unavailable while A and B stay at 11) is still outstanding too. Both are in §5; I am
reporting them as **not done**, not as done.

---

## 5. What the Dispatcher must ask the owner to do

### 5.1 State right now

- `main.js` on **A**, **B** and **C** is the paint-plane bundle **`d6bb30d07cef27ae`, 5 895 212 B**, staged
  and digest-verified after copy.
- The previous bundle `02ea8ceea23f9a2b` is backed up at **`h:/tmp/b71_backup_02ea8ceea23f9a2b/`**
  (`A-main.js`, `B-main.js`, `C-main.js`, digests verified after copy).
- `manifest.json`, `styles.css` and `data.json` were **not touched, not read and not copied**.
- All three processes still execute the **old** bundle. **Nothing about the vaults' behaviour has changed
  yet**, the session is up, roles A host / B guest / C guest as of this batch's `session.info` — **re-read it,
  roles migrate (`S139`)**.

### 5.2 The ask

> **Step 0 — BEFORE anything else, and it takes ten seconds.** Screenshot each of the three windows while the
> board is still broken. That is the only record of the current pixels that survives a reload, and §3.1 has
> the coordinates to check it against. **The break is reproducible by one drag, so this is insurance, not a
> blocker.**

> **Step 1 — Reload all three windows.** `Ctrl+P` → *"Reload app without saving"* in A, B and C. All three
> must be on the new bundle before anything is armed, or a dump mixes two builds — and now it will *say* so
> (`PAINT ABSENT` names the peer).

> **Step 2 — Confirm the plane, no gestures needed.**
> ```bash
> cd "h:/My Code/AgenticWorkspace/Projects/_external/liveshareCollab/obsidian-live-share"
> python tools/e2e/canvas_diag.py --ports 39431,39432,39433 \
>     --path "_liveshare-test/smoke.canvas" --op census --label b71-orient
> ```
> **Expected:** `PLANE A PAINT read from nodeEl.style.transform … sources={'style': 11, …}` on all three, and
> `PAINT vs MODEL → A: 0 DIVERGENT · 11 agree`. A freshly reloaded board is repainted from the model, so
> **0 divergent here is the correct answer and is itself the live negative control.**
> **If instead** `PAINT ABSENT (diagProto=1)` — that window did not reload.

> **Step 3 — the live positive control, and please do not skip it.** On **C only**: close the `smoke.canvas`
> tab, re-run the census, reopen, re-run. **Expected:** C's paint AND view planes flip to
> `UNAVAILABLE — no canvas view is mounted for this path on this peer` while A and B stay at 11, then back.
> This is `B70`'s outstanding `BK3` and it discharges both planes at once. Without it, "11 everywhere" is a
> green nobody has shown can fail.

> **Step 4 — THE RUN. Reproduce the break, with the recorder armed.**
> ```bash
> BOARD="_liveshare-test/smoke.canvas"
> python tools/e2e/canvas_diag.py --ports 39431,39432,39433 --path "$BOARD" --op arm  --label b71-paint
> #  owner: ONE ~100 px drag of an EDGE-ENDPOINT node on the HOST. `208541a49dc66c4c` is the
> #  one B70 already characterised (3 edges). Nothing else — no scroll, no pan. Wait ~3 s.
> python tools/e2e/canvas_diag.py --ports 39431,39432,39433 --path "$BOARD" --op dump --label b71-paint
> #  → if the board does NOT look broken yet, do NOT re-arm. Use --op mark, drag again, dump again.
> python tools/e2e/canvas_diag.py --ports 39431,39432,39433 --op clear --label teardown
> ```
> **This arm destroys the `b70-h8-drag` baseline.** Say so to the owner; that baseline has already been
> dumped twice and is on disk.
>
> **What to read, in this order.** ① `PAINT vs MODEL` on each peer. ② the delta table's `paint` rows against
> the `view` rows for the same node.
>
> | reading | meaning |
> |---|---|
> | `view` moved, `paint` did not | **`S193` caught in the act** — the model advanced and the card was never repainted. The line is `canvas-adapter.ts:1152` or `reloadCanvasData`'s `setData`, and §2.1 says which callee dropped it |
> | `paint` moved, `view` did not | something moved the element behind the model's back |
> | both moved, equal | that node is fine |
> | **all eleven** rect-divergent by the same offset | a stale/animating container transform, not per-card paint loss (§1.3) |
> | **0 DIVERGENT and the board still looks broken** | the nodes are innocent — go to `S194`, the **edges**, and charter the two accessors |

> **Step 5 — rollback, if wanted.** Copy the three files from `h:/tmp/b71_backup_02ea8ceea23f9a2b/` back over
> `<vault>/.obsidian/plugins/live-share/main.js` and reload. Nothing else needs undoing.

**One thing to watch during Step 4, and it is cheap to control for (`S193` gate 1):** `requestAnimationFrame`
is suspended for a hidden window. Ask the owner to run the drag **once with B and C fully occluded** and, if
the first run is clean, **once with all three windows visible side by side**. If the divergence only appears
in the occluded run, gate 1 is the answer and it is a very different fix from gate 2.

---

## 6. Found and not fixed

| # | finding | status |
|---|---|---|
| `S192` | the three planes are three readings of one model — the rig could not see a paint/model divergence | **CLOSED by this batch** (the paint plane) |
| `S193` | Obsidian writes the model and only *enqueues* a repaint; `render()` is the sole writer of a card's position and is gated on `isAttached` inside a rAF frame. Both plugin sinks inherit it | **OPEN — argued from Obsidian's source, not yet measured live** |
| `S194` | nothing in the rig looks at an **edge**; a board correct in every node and mis-routed in its six edges reads as converged on all four planes | **OPEN — instrument gap, design in the register row** |

Also left alone, deliberately:

- **`H8` itself is untouched.** `main.ts:3231-3235` still escalates a moved edge-endpoint node into a
  whole-board `setData`; `main.ts:4095` (`applyCanvasNodeRevert`, no mute) still differs from `main.ts:3176`
  (`reconcileLiveCanvas`, mute armed). Read only far enough to establish §2.1's sink list.
- **`S191`** (`safeCall` receiver loss, B70) is still open — it is why the dumps in §3 are labelled A/B/C by
  port order with `vaultName: ""`.
- **No test was added**, per the suspended mandate. The natural closure the day it lifts is a source-census
  test in §3.11's style asserting the rig's planes read *different* objects — which is the property `S192`
  turned out to be about.
- **`biome check` on `e2e-control.ts` reports 9 errors — and it reported the same 9 at HEAD.** Verified by
  running the checker against `git show HEAD:…` copied aside: 8 × `lint/style/useTemplate` (all at lines
  836–1843, i.e. below anything this batch touched) plus one whole-file `format`. **Pre-existing; this batch
  added none.** `biome check --write` was **not** run (it corrupts this tree).

---

## 7. Gates, measured in this session

| gate | command actually run | result |
|---|---|---|
| `tsc` | `./node_modules/.bin/tsc -noEmit -skipLibCheck` (from `plugin/`) | **exit 0, clean** |
| suite | `./node_modules/.bin/vitest run` (from `plugin/`) | **444 files / 3375 tests passed, 0 failed** |
| allow-lists | `vitest run …wp49/test_tp12… …wp72/test_tp4…` | **2 files / 11 tests passed** |
| e2e bundle | `npm --prefix plugin run build:e2e` | clean · 5 895 212 B · `sha256[:16] d6bb30d07cef27ae` |
| falsifiability | `python h:/tmp/b71_paint_falsify.py plugin/main.js` | **exit 0**, six scenarios (§4) |
| plant/restore | `python h:/tmp/b71_plant_restore.py` | **CYCLE COMPLETE**, both digests byte-identical |
| register | `python workflowArtifacts/canvas-v2/check_signal_register.py` | §8 |

The suite figure matches B70's 444/3375 exactly, so nothing was added or lost. It was measured **after** the
plant cycle restored the source byte-identically.

`S180` NUL scan on every changed text file: **0** NUL bytes.

---

## 8. Register

`S192`, `S193`, `S194` appended to `SIGNAL_REGISTER.md` §3a; `NEXT_FREE` bumped **192 → 195** at
`check_signal_register.py:53`. Run **after** every file this report covers — including this report — was on
disk:

```text
$ python workflowArtifacts/canvas-v2/check_signal_register.py
scanned 256 files under canvas-v2/  (control: all classes proved)
baselined debt: 136 citations across 62 keys
clean - no NEW violations. (29 baselined citations have since gone)
EXIT=0
```

`control: all classes proved` is the line that matters — the checker reports nothing at all if its own
positive control fails.

---

## 9. Files changed

| file | change | sha256[:16] |
|---|---|---|
| `plugin/src/testing/e2e-control.ts` | the paint plane (§1); `CANVAS_DIAG_PROTO` 1→2; `paint` in the delta/unattributed tables | `d681fdfe9a36a9be` |
| `tools/e2e/canvas_diag.py` | `PLANES`, `PAINT vs MODEL`, `PAINT ABSENT` proto refusal | `a6d27161d1e351c5` |
| `plugin/src/__tests__/wp49/test_tp12_…` | §7 amendment A-71-1: `../canvas/canvas-adapter` on the frozen allow-list | `29b0ed9adcc385ff` |
| `plugin/src/__tests__/wp72/test_tp4_…` | §7 amendment A-71-2, the twin | `f85c8e690df0a5a5` |
| `workflowArtifacts/canvas-v2/SIGNAL_REGISTER.md` | `S192`, `S193`, `S194` rows | — |
| `workflowArtifacts/canvas-v2/check_signal_register.py` | `NEXT_FREE = 195` | — |
| `workflowArtifacts/canvas-v2/ImplementationReport_B71_PaintPlane.md` | this file | — |
| `plugin/main.js` | rebuilt e2e bundle (build output) | `d6bb30d07cef27ae` |
| `<3 vaults>/.obsidian/plugins/live-share/main.js` | staged; previous bundle backed up to `h:/tmp/b71_backup_02ea8ceea23f9a2b/` | `d6bb30d07cef27ae` |
| `workflowArtifacts/canvas-v2/diag/b71-*.json` | raw dumps from the broken board (§3) | — |

**Two production TEST files were modified and no production SOURCE was.** The two allow-list amendments are
the documented §7 mechanism (WP123 and B68 each used it once); the specifier is `../canvas/canvas-adapter`,
for `clientToCanvasManual` + `viewportScale` only, and that module has **zero imports of its own** — no
package dependency, no transport, no Obsidian type.

Not committed — the Dispatcher verifies and commits on this project.

**Secrets:** no `data.json` was read, copied, hashed or referenced. No credential, token or passphrase appears
in this report, in any script written for it, or in any tool call made during it.
