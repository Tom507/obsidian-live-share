# Debug Report — B75-CanvasPaintDisjoint

## Status

**FIX_VERIFIED** — with one honest boundary: causation is **demonstrated** at the layer the
defect lives in (CSS layout, deterministic, N=5 in both directions, byte-identical re-apply)
and **ARGUED** for the running product after the fix, because the live rig lost its session
mid-session and cannot be re-authenticated without the owner. See *Causation Proof*.

---

## Finding

- **Reported by:** the owner, verbatim.
- **Evidence:** *"Panning and moving nodes disjoints the canvas. Cards sometimes reseat themselves
  now, just to get disjointed again after the next action. It is not at all solved, still just as
  bad. The bug is purely visual — we wasted many tokens trying to fix synchronisation when the
  canvas RENDERING was the real problem. The canvas interface was written for an older Obsidian
  version."*
- **Build under investigation (by census, not by date):** branch `fix-bugs-and-raceconditions`,
  `git rev-parse HEAD` = `d22cdbaff07d04ab6d8b25cc48fabac7711f1284`. Working tree dirty with 38
  untracked `workflowArtifacts/canvas-v2/diag/w5-*.json` from a prior session — read as evidence,
  never modified. No tracked file was modified at intake.
- **Fix branch:** `b75-canvas-paint-disjoint`, created off `d22cdba`. Fix commit `6f30486`.
- **What the reporter could not explain:** the prior Phase 0 brief had the right *location* but a
  mechanism that does not work as stated. It argued the ringed card "consumes flow height", while
  the same Obsidian rule sets `height: 0` — and a zero-height in-flow block contributes zero flow
  height. A strong correlation with a broken explanation is exactly what ratifies a wrong fix.
  Closing that hole was the actual starting point.

---

## Investigation Ladder

| Rung | Climbed? | What it yielded |
|---|---|---|
| 1 — read suspect code | YES | `styles.css:318-324` `.ls-canvas-held-ring { … position: relative }`; `canvas-presence.ts:648-658` `addRing()` applies it to `node.nodeEl`; `refresh()` → `applyRings()` runs on every viewport change. |
| 2 — read outward / recent history | YES | The rule entered in `4b34d5e` ("testing infra & live share canvas redesign") with no recorded rationale. `styles.css` and `canvas-presence.ts` are **byte-identical** between `77ff96c` and `d22cdba` — so the whole B72→WP125→0.7.2 fix family never touched the defect. |
| 3 — research the interface | **YES — decisive** | Obsidian **1.13.6** (`%APPDATA%/obsidian/obsidian-1.13.6.asar`, the bundle that actually runs; the Program Files copy is a stale 1.12.7). `app.css`: `.canvas-node { position: absolute; width: 0; height: 0 }` with **no top/left**. `app.js`: `CanvasNode.prototype.render` = `setCssStyles({transform:"translate(x, y)", width:"Wpx", height:"Hpx"})` — **inline width/height override the stylesheet's 0/0**. That single fact closes the mechanism hole. Also `virtualize()` and `attach()` (below). |
| 4 — commissioned probe | YES | Hunt Sub-Agent (INITIAL, dispatched with **no hypothesis**). 7 probes. P1 and P2 independently landed on the same surface; P4 measured the displacement live. |
| 5 — live reproduction | YES | Three-vault rig. RED established N=5 with a natural control. Rig then lost its session — see *Blocked*. |

---

## Root Cause

- **Class: 1 — Wrong assumption** about what the platform does. (Class 4 was considered and
  rejected: nothing in the plugin's design required this declaration; it was incidental.)
- **Cause, precisely:** `plugin/styles.css` declared `position: relative` inside
  `.ls-canvas-held-ring`, a class the plugin attaches to `node.nodeEl` — an element **Obsidian
  owns and lays out**.

Obsidian places every canvas card with

```css
.canvas-node { position: absolute; width: 0; height: 0 }   /* no top, no left */
```

and then writes the real geometry **inline** from its own renderer:

```js
t.setCssStyles({ transform: "translate(" + n + "px, " + i + "px)",
                 width: r + "px", height: o + "px" })
```

An absolutely positioned box with no `top`/`left` sits at its **static position**. Since every
sibling is out of flow, all static positions collapse onto the container origin and the inline
`transform` alone decides where a card sits.

Overriding one card to `position: relative` returns it to normal flow. Its **inline** height —
not the stylesheet's `0` — becomes flow height, and the static position of **every later
`.canvas-node` sibling** is pushed down by exactly that card's height. The ringed card itself does
not move, because it is the first in-flow box.

**Why panning alone disjoints, with no change to the ring set.** Obsidian's per-frame loop calls
`virtualize()` on *every* frame. It calls `node.attach()` for cards entering the viewport —
`attach()` is `if (!el.parentNode) canvasEl.appendChild(el)` — and `detach()` for those leaving,
throttled to 10 newly-visible nodes per frame. **A card that leaves the viewport and comes back is
re-appended at the end, so panning re-orders the DOM.** With a ring live, a different subset
therefore falls in the ringed card's DOM suffix after each pan; and when the ringed card is itself
re-appended last, its suffix becomes empty and the whole board snaps back correct. That is the
owner's *"cards sometimes reseat themselves, just to get disjointed again after the next action"*,
mechanically.

The owner's own diagnosis was right on every count: purely visual, a rendering problem, and an
interface assumption that does not hold.

---

## Suspicion Map

| Location | Why suspected | Verdict |
|---|---|---|
| `plugin/styles.css:323` `position: relative` | Only plugin declaration that can affect host layout | **CONFIRMED — the cause** |
| `canvas-presence.ts:648-658` `addRing()` | Applies that class to Obsidian's element | **CONFIRMED — the delivery path** (not itself wrong) |
| `.ls-canvas-held-tag` appended into `nodeEl` | A child element injected into a host card | **CLEARED** — `position: absolute`, contributes no flow height; measured: 0 displacement |
| `canvas-overlay.ts` | Writes styles on every render | **CLEARED** — writes only to the plugin's own overlay inside `wrapperEl` |
| WP125 structural repaint seam | The accepted theory on entry | **CLEARED** — 0 attempts / 0 repairs in 48 records |
| The repaint sweep | B73's "it repaired real mis-paints" | **CLEARED** — 72,961 attempts, **0 repairs** |
| `clientToCanvasManual` container offset | B73 called the whole signal instrument bias | **CLEARED as the cause**, but a real residual — see *Residuals* |

---

## Hypotheses Rejected

| Hypothesis | Rejected because |
|---|---|
| The Phase 0 brief's stated mechanism ("the ringed card consumes flow height because `.canvas-node` has a height") | As stated it is wrong — the *stylesheet* sets `height: 0`, which contributes nothing. It only works because `render()` writes **inline** width/height that override it. Right location, broken reasoning; repaired at Rung 3. |
| `position: relative` changes the containing block for `.canvas-node-container` | `.canvas-node` is a containing block whether `absolute` or `relative`, so the descendant resolves identically. Measured: the ringed card itself does not move at all. |
| The repaint/sync family (B72 → WP125 → 0.7.2) addresses this | `structuralSeam` 0 attempts / 0 repairs and `sweep` 0 repairs in 72,961 attempts, across 48 records; and `styles.css`/`canvas-presence.ts` are byte-identical at `77ff96c` and `d22cdba`. |
| B73's "~60 px constant instrument bias" (`KNOWN_ISSUES` §4 / `S198`) | Not constant and not bias. Measured displacements were 60, 150, 280 and 420 canvas units — each equal to the **held** card's height — while the true uniform instrument offset is −0.07 to −0.54 canvas units. The instrument was right and was overruled. |
| The displaced card renders at the wrong size | The live displacement was **+280.000** on a card whose own height is **230**; the magnitude tracks the *held* card, not the displaced one. |
| A shared-transform / viewport error | The offset is invariant in **canvas units** (279.71 at scale 0.212 vs 279.79 at scale 0.293 — 59 px vs 82 px on screen). A transform error scales; this does not. Also only a subset of cards moves. |
| A second producer exists | Not fully excluded — see *What could not be separated*. Strong evidence against: the holder peer, which never rings its own card, read `LAYOUT_CLEAN` in every measurement while the ringed peers read `LAYOUT_DIVERGENT` on the identical model at the same instant. |

---

## Fix

- **Changed files:** `plugin/styles.css` (1 declaration removed, 14 comment lines added).
- **Approach:** delete `position: relative` from `.ls-canvas-held-ring`, and record at the site why
  no layout property may ever be declared there. Chosen over the alternatives because it is the
  smallest change that removes the cause: `outline`, `outline-offset`, `box-shadow` and
  `border-radius` do not participate in layout, so the ring looks identical; the held tag still
  anchors because an absolutely positioned `.canvas-node` is already a containing block for its
  absolutely positioned descendants. Explicitly **not** chosen: re-declaring `position: absolute`
  defensively (would silently fight a future Obsidian change), or moving the ring to an overlay
  element (a redesign, not a fix).
- **Blast radius:**
  - Public interface / contract / schema? **NO** — a plugin-private CSS class.
  - Another WP's acceptance criteria? **NO** — no test anywhere reads `styles.css`.
  - Consumer outside this repository? **NO**.
  - Files changed: **1**. (Reported, not gating.)
- **A3 overrule:** not required. Rationale search performed anyway: the declaration entered in
  `4b34d5e` with no commit-message, code-comment or report rationale. Searched: `git log -S` on the
  class, the commit message, the surrounding comment block, and `canvas-presence.ts`. **No recorded
  reason exists.** The plausible intent — anchoring `.ls-canvas-held-tag` — is measurably
  unnecessary.

---

## Causation Proof

Instrument: headless Edge over the **real** Obsidian 1.13.6 `app.css` and the **real**
`plugin/styles.css` as it is on disk, replicating Obsidian's DOM
(`wrapperEl > div.canvas > svg.canvas-edges ×2 > div.canvas-node[inline transform/width/height] >
div.canvas-node-container`). Every phase prints the sha256 of the stylesheet it measured, so a
GREEN cannot be claimed for a file that was not under test. Revert was **by copy-aside**; no
`git checkout`, no `git stash`.

**N = 5 per phase**, a different ring target each rep. The last node in DOM order is excluded as a
target: it has no DOM suffix, so ringing it cannot displace anything even when the defect is
present — a vacuous trial that can never go RED. (My first phase-2 run included it and was
correctly scored MIXED; that is a flaw in the gate, not a counter-example, and it is reported here
rather than quietly dropped.)

| Claim | Fix applied | Fix reverted (copy-aside) | Re-applied | demonstrated / argued |
|---|---|---|---|---|
| Ringing a card displaces no other card | **GREEN 5/5** sha256 `e9f7146e` | **RED 5/5** sha256 `1bba03e9` | **GREEN 5/5** sha256 `e9f7146e`, byte-identical | **demonstrated** |
| Harness probe P1, which reads the real `styles.css` | PASS | **FAIL**, naming `.ls-canvas-held-ring { position: relative }` | PASS | **demonstrated** |
| Displacement magnitude = the ringed card's own height | — | ring n0 h=420 → 9 siblings × 420; n3 h=280 → 6 × 280; n6 h=60 → 3 × 60; n2 h=400 → 7 × 400 | — | **demonstrated** |
| Displaced count = number of cards after the target in DOM order | — | 9, 7, 6, 3, 0 for DOM indices 0, 2, 3, 6, 9 | — | **demonstrated** |
| The running product no longer disjoints | not measurable | RED 5/5 live, both observer peers, before the fix | not measurable | **ARGUED** |

**Live RED, measured before the rig was lost (N=5):** every rep, both observer peers
`LAYOUT_DIVERGENT`; the **holder** peer — which never draws a ring on its own card, because
`resolveHighlights()` excludes your own lock — `LAYOUT_CLEAN` every rep on the identical model.
At one instant with a live hold on a card of model height 280, peers B and C each showed exactly
one card displaced by **+280.000** while peer A showed none. The Hunt Sub-Agent measured the same
displacement independently as +279.71 / +279.79 at two different zooms.

Caveat recorded honestly: within that live N=5 the presence hold stayed pinned to one card, because
`canvas.typeInNode` did not retarget it. Those 5 reps therefore measure **repeatability of one
condition**, not 5 independent ring targets. The independent-target evidence comes from the four
distinct ring heights observed across sessions (60, 150, 280, 420) and from the deterministic
phase-2 run above.

### What could not be separated

**The running product with the fix loaded was never measured.** Mid-session the three-vault rig lost
its LiveShare session and would not re-establish: the plugin's own log reports
`control channel auth-required` → `control link gave up after 10/10 attempts (cause=exhausted)` →
`SHARING HALTED: cause=never-established`. The server is up (HTTP 200); `data.json` holds a token but
an empty `jwt`. Re-establishing needs a human sign-in, and **no secret may be routed through an agent
tool**, so I stopped. `session.rearm` was attempted on all three peers and restarted the retry chains
without reconnecting.

Consequently:
- the **presence-OFF falsification did not complete**. `showCanvasPresence:false` was written to B
  and C and both were restarted, but the canvas never mounted because the session was down. The
  setting has been **restored to `true`** on both. The nearest completed substitute is the holder-peer
  control described above, which is the presence-off condition in substance and read CLEAN in every
  measurement.
- a **second producer is not formally excluded**. Supporting evidence that there is none:
  `canvas-presence.ts:651-657` is the only place the entire plugin writes into an Obsidian-owned
  element (audited across `plugin/src`), and the holder peer never diverged.

---

## Verification

| Order | Verdict | Falsified what |
|---|---|---|
| Hunt INITIAL (no hypothesis given) | 7 probes, 4 fired | That the reported surface was unrelated to the plugin's own CSS — P1/P2 found it independently |
| `run --kind code-level`, fix applied | P1 PASS, P3 PASS, P2 FAIL | P2 fails by design (it asserts the plugin writes into host DOM at all) and is unchanged by the fix |
| `run --probes P1`, fix reverted | FAIL | That the fix is incidental — P1 flips with the one declaration |
| Deterministic layout gate, 3 phases × 5 reps | GREEN / RED / GREEN | That something other than this declaration displaces the cards |
| Plugin unit suite | **452 files, 3432 tests, all passed** | That the change regresses anything |

**Probes that contributed — promotion candidates after the full Worker 4 pass:**
- **P1** `probe_P1_plugin_css_on_host_elements.test.ts` — the highest-value one. It derives the
  "classes applied to a foreign element" set structurally (classes passed to `classList.add` minus
  classes put on plugin-created elements) and asserts no layout property is declared for any of
  them. It is not hardcoded to this bug and would have caught it at authoring time. **Promote to the
  ordinary unit suite.**
- **P4** `probe_P4_paint_vs_model.py` — the live layout-plane reading.
- The deterministic layout gate (`H:/tmp/liveshare_debug/b75_proof.py`) should be re-homed into the
  repo as a real test; it needs only Edge and the extracted `app.css`.

---

## Security Declaration

| Checkpoint | Class touched | Review verdict |
|---|---|---|
| Checkpoint 1 (mechanism settled) | **NONE** — repo diff was empty | Accepted by Dispatcher, no review required |
| Before final commit | **NONE** — one CSS declaration removed. No auth/authz, session/token, secrets or `.env*`, schema or data migration, money/PII, deployed state, or dependency version | No review required; 7-day rule N/A (no dependency change) |

Rig-configuration changes made and reverted: `showCanvasPresence` on vaults B and C
(`true → false → true`, verified by read-back). Backups at `data.json.b75bak` in each vault.
**No plugin was deployed to any vault** — see *Handoff*.

---

## Design Divergence

*(Input for the later spec-reconciling agent. Facts only; no action taken.)*

| Where the code now departs from the design | Why the old decision blocked the fix | Rationale search result |
|---|---|---|
| The held ring no longer declares `position` on `.canvas-node` | It did not block the fix; it *was* the fix | No rationale found. Searched `git log -S 'ls-canvas-held-ring'`, commit `4b34d5e`'s message, the comment block at the site, and `canvas-presence.ts`. The declaration was introduced silently alongside `.ls-canvas-held-tag`. |
| `KNOWN_ISSUES` §1 states "a producing path remains unidentified" and attributes the board's correctness to the repair sweep | — | The producing path is now named. The sweep repaired nothing in 72,961 attempts; the board was never being held together by it. |

---

## Changed Behaviour

The reconciler can derive charter/AC/test staleness from these facts alone:

1. **A card held by a remote peer no longer changes the layout of any other card.** Previously,
   applying the held ring moved every `.canvas-node` after it in DOM order down by exactly the
   held card's height.
2. **Panning a board that has a remote hold on it no longer rearranges cards.** The displacement
   was DOM-order dependent and Obsidian re-orders the DOM on every frame via `virtualize()`.
3. **The ring's appearance is unchanged** — outline, offset, glow, radius and the held tag's
   position are byte-for-byte the same; verified by measurement, not by inspection.
4. **Nothing in the model, document, file or sync layers changed.** No behaviour that any test
   asserts on changed: 3432/3432 still pass.
5. **`KNOWN_ISSUES` §1 and §4 are now wrong** and should be rewritten from this report: §1's
   "unidentified producing path" is identified, and §4's "~60 px instrument bias" was the defect
   itself, mislabelled.

---

## Residuals

Recorded deliberately, **not acted on** (one cause, one change):

1. **The WP125 repaint machinery is inert.** Measured across 48 diagnostic records:
   `structuralSeam` **0 attempts / 0 repairs**; `sweep` **72,961 attempts / 0 repairs**;
   `perNodeSeam` 131 attempts / 130 repairs — and those 130 are one-frame latency after
   `applyNodeGeometry` writes the model, not persistent mis-paints. The wholesale revert to
   `77ff96c` was **considered and declined**: `styles.css` and `canvas-presence.ts` are
   byte-identical at both commits, so it cannot touch this bug, and it would trade away the proven
   0.7.2 duplicate-leaf presence-ownership handoff to delete dead weight. If the machinery is to go,
   it should go as its own chartered change, with the priority-slot fix (`canvas-adapter.ts:503-509`,
   the real `S199` fix) and the split counters kept.
2. **The 0.7.2 handover drops `drainCanvasDeferrals`.** The close branch calls it
   (`main.ts:2848`); the new handover branch does not. A withheld editing queue is silently
   discarded on a handover. Found by the prior brief, confirmed by diff, unrelated to this bug.
3. **`liveshare-e2e` MCP is structurally blind to paint defects.** `read_canvas`, `assert_converged`,
   `binding_stats` and `run_matrix` all read the shared document or a counter. `assert_converged`
   returns `converged: true` on a visibly scrambled board — an active source of false confidence.
4. **The paint census conflates two different failures.** `verdict` becomes `DIVERGENT` if *either*
   `styleVerdict` or `rectVerdict` diverges; because B73 declared the rect plane untrustworthy,
   readers learned to ignore it. Split it into `STYLE_DIVERGENT` (model → transform) and
   `LAYOUT_DIVERGENT` (transform → pixels). The entire defect lived in the second, which had no name.
5. **The prior harness probe `p4_live_paint_census.py` gates only on `styleVerdict`** — the one plane
   that reads `agree` throughout this defect. It would print `LIVE_PAINT_MODEL_CLEAR` on a scrambled
   board. That is Error Source class 9: a test that would defend the bug against a correct fix.
6. **Three e2e control capabilities are missing** and blocked this investigation (named by the Hunt
   Sub-Agent): a `canvas.viewport` command to pan/zoom; a `canvas.hold {nodeId, hold}` to take a
   presence hold without mutating content; and two read-only census fields —
   `getComputedStyle(nodeEl).position` and each node's index among its parent's children. Without the
   last one, live DOM order is unreadable.
7. **A genuine residual instrument offset** of −0.07 to −0.54 canvas units on *every* card, uniform
   per census. Well inside tolerance, but `clientToCanvasManual` is also production code for the
   presence overlay, so it should be explained rather than tolerated.
8. **`plugin/package.json` pins `"obsidian": "latest"`** — an unpinned dependency on a private-API
   surface, with no in-code version check anywhere in `plugin/src`.
9. **`restart_obsidian.py` crashed on a localised Windows** (`tasklist` output undecodable as cp1252
   → reader thread dies → `stdout` is `None`). Patched in place at `H:/tmp/liveshare_debug/`. It had
   already killed all three Obsidian processes before crashing, which is how the rig went down.
10. **The vault deploy path ships `main.js` + `manifest.json` only.** `styles.css` in all three
    vaults dates from 2026-07-18. Any CSS-only fix is invisible unless copied explicitly.

---

## Handoff

What a newcomer would take longest to rediscover:

- **Read the running bundle, not the installed one.** Obsidian auto-updated to **1.13.6** at
  `C:/Users/tschm/AppData/Roaming/obsidian/obsidian-1.13.6.asar`. `C:/Program Files/.../resources/
  obsidian.asar` is a stale 1.12.7 and misled the prior brief. Extracted copies (read-only):
  `H:/tmp/liveshare_debug/asar1136/{app.js,app.css}`.
- **The two load-bearing facts about Obsidian's canvas**, both quoted in the fix's own comment:
  `.canvas-node { position:absolute; width:0; height:0 }` with no `top`/`left` (`app.css:17704`),
  and `render()` writing inline `transform` + width/height. Neither is documented anywhere; both are
  private contract.
- **`virtualize()` re-orders the DOM on every frame.** This is why the symptom looked random and
  why "it reseats itself" is real. Anything reasoning about `.canvas-node` sibling order must
  account for it. Note: `renderZIndex()` only sets `style.zIndex` — it does **not** move elements in
  the DOM, contrary to a note in the hunt's report.
- **The instrument to trust is the LAYOUT plane** (`rect` vs `model`), never `styleVerdict`.
  `styleVerdict` was `agree` in 558/558 readings *through the entire defect*. Two separate
  investigations went blind by trusting it.
- **Baseline estimator matters.** Use `min(dy)`, not `median(dy)`. Displacement is always downward
  and at least one card is always undisplaced, but with exactly half the board displaced a median
  sits in the middle and reports every card as displaced by ±half. That artefact cost me one run.
- **A permanent natural control exists:** the *holder* peer never draws a ring on its own card
  (`resolveHighlights()` excludes your own lock). Comparing holder against observers at the same
  instant, on the same model, is free and needs no configuration change.
- **The rig is DOWN and needs the owner.** All three vaults are running, ports 39431/39432/39433
  answer, but LiveShare reports `auth-required` and will not reconnect. A human must sign in.
  Nothing about this is caused by the fix.
- **To finish the live half of the proof**, once the session is back:
  1. `python H:/tmp/liveshare_debug/b75_deploy_css.py` — copies `plugin/styles.css` into all three
     vaults and **verifies by sha256 per vault**, refusing to report success on a copy that does not
     match. This is the gate that stops a CSS-only fix being "tested" while not actually loaded.
  2. `python H:/tmp/liveshare_debug/restart_obsidian.py --vaults A B C` (patched for the locale bug).
  3. `python H:/tmp/liveshare_debug/b75_measure.py --phase LIVE-GREEN --reps 5 --expect GREEN`.
     Expect every observer peer `LAYOUT_CLEAN` with a hold live.
- **Deliberately left alone:** the plugin was **not** deployed to any vault, because it could not be
  validated live. The fix is committed and proven; deployment is one command and should be the
  owner's deliberate act.
- **Approaches rejected and why** are in *Hypotheses Rejected* — in particular, do not re-litigate
  the repaint/sweep family. It has now been measured inert three separate times (B74, WP125's own
  counters, and this session's 48-record aggregate).

### Artifacts

| What | Where |
|---|---|
| Fix commit | `6f30486` on branch `b75-canvas-paint-disjoint` (off `d22cdba`) |
| Harness (7 probes, runner, `HARNESS.md`, evidence) | `workflowArtifacts/debug/B75-CanvasPaintDisjoint/harness/` |
| Deterministic causation gate | `H:/tmp/liveshare_debug/b75_proof.py` |
| Live layout-plane instrument | `H:/tmp/liveshare_debug/b75_measure.py` |
| CSS deploy + sha256 gate | `H:/tmp/liveshare_debug/b75_deploy_css.py` |
| Mechanism/fix-safety checks | `H:/tmp/liveshare_debug/mechcheck/mechcheck{,2}.py` |
| Copy-aside stylesheets | `H:/tmp/liveshare_debug/styles.css.{FIXED,UNFIXED}` (sha `e9f7146e` / `1bba03e9`) |

---

## Return

**FIX_VERIFIED** — dispatch the mandatory full Worker 4 pass. Worker 4 must be told that the live
rig requires an owner sign-in before any live validation, and that the fix is **not deployed** to
the vaults.
