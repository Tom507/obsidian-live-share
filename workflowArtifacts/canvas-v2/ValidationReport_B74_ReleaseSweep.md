# Validation Report — B74, the v0.7.0 release-confidence sweep (Worker 4)

**Subject:** the four commits shipped today on `fix-bugs-and-raceconditions` — `df6ed86`, `b7c5c00`,
`3bd5de4`, `2bfa3ef` — and the published v0.7.0 artefact now live on the download host.
**Owner's ask:** *"a quick check on this build whether we have any failing tests or he can find something we
broke in an e2e session with the goal to test all modules overall are working."* Breadth first.
**Run date:** 2026-08-09. **Rig:** the three live Obsidian instances on 39431/39432/39433, running e2e bundle
`b55097a2ede87556` **from memory**.

---

## 1. VERDICT — is v0.7.0 safe in users' hands?

> ## YES. Ship it, do not pull it.
>
> Nothing shipped today puts user data at risk, and nothing regressed in the modules the change did not
> touch. The `.md` path — the plugin's primary function — is measured healthy end to end, with negative
> controls. Canvas geometry converged on every peer in every trial. The published zip contains no control
> surface.
>
> **But one sentence in the release notes is not true, and it should be corrected.**
> `docs/KNOWN_ISSUES.md` and the `2bfa3ef` release message tell the user that 0.7.0 *"runs a round-robin
> repair sweep behind [the targeted repaint] as a restoring force."* **That sweep has never repaired a single
> card on any of the three live peers** (`S199`), and its clock runs at 1/60 of its nominal rate in the
> background window it was designed for (`S200`). It is inert, not merely slow.
>
> **This does not make 0.7.0 worse than 0.6.1** — it makes it exactly as good as its *primary* fix, which is
> real, load-bearing and demonstrated working live. The honest correction is a documentation change plus a
> follow-up package, **not a hotfix and not a pull**. The user-visible behaviour of the shipped build is
> unchanged by this finding; only our description of it was wrong.

**Recommendation: CONDITIONAL RELEASE — keep 0.7.0 published, on two conditions.**

| # | Condition | Cost |
|---|---|---|
| 1 | Amend `docs/KNOWN_ISSUES.md`: the repair sweep is **not currently a restoring force**; the mitigation that works is the targeted repaint at the apply seam. | docs only, no rebuild |
| 2 | Charter a package for `S199` (starvation) + `S200` (throttle) + `S201` (the counter that hid both). One-line-class fixes; the falsifiability arms already exist and are in this report. | one W3 package |

**Nothing found today is a stop-the-line finding.** No data-loss route, no crash, no re-entrancy fault, no
timer leak, no test-build contamination of the published artefact.

---

## 2. Gate figures — measured by me, alone, on a quiet tree

Run **before any plant**, in one scripted session (`h:/tmp/b74_gate.py`, console `cfdd64bd`), with
`git status --porcelain` captured immediately before and after: **both empty**. No sibling worker was active.

| Gate | Invocation | Result |
|---|---|---|
| TypeScript | `plugin/node_modules/.bin/tsc -noEmit -skipLibCheck` from `plugin/` | **exit 0**, no output |
| Full suite | `plugin/node_modules/.bin/vitest run` from `plugin/` | **448 files / 3404 tests passed, 0 failed** (40.98 s) |
| Signal register | `python workflowArtifacts/canvas-v2/check_signal_register.py` | **exit 0** — 256 files, control proved, no new violations |

All three match the figures `3bd5de4`'s commit message claims. **No red was seen at any point**, so the
`concurrent_workers_false_red` re-measurement protocol was not needed. Re-run after this report's own edits:
register checker **exit 0** again.

`wp5/latency.test.ts` took 38.4 s of the 41 s, dominated by its deliberate 33.5 s idle window. `S181`'s known
intermittent (`wp101/test_s123_canvas_mirror_race.test.ts`) **did not fire** on this run.

---

## 3. The published-artefact verification — redone independently and more thoroughly

`h:/tmp/b74_artefact.py`, `h:/tmp/b74_artefact2.py`. Members were read **straight out of the archive**, not
from a previously-extracted copy, so what was scanned is what a user downloads.

### 3.1 Identity

```text
zip    H:\Developement\_NeuralAngels\liveshareCollab\plugin-dist\live-share-plugin.zip
       283 381 B   sha256 b6655f94c2cc3667864cba84a534df53f8482ad134a4b89c6eb904385131eb8d
members
       live-share/main.js        1 115 708 B   a3a438ec49a73041b0beb30ec6b71eaa165c0de53f32e52f757a70c32b02c916
       live-share/manifest.json        295 B   50e1c7a7601a1ef8c24a910bd3f4edecf451457fa457131de81eaa04bbbe41d6
       live-share/styles.css         8 788 B   1bba03e9695719ecc31549c6b7382d8bb3fdf23d97996cd753f7b1c4a516e453
```

Both the zip digest/size and the `main.js` digest/size **match the Dispatcher's figures exactly**. The zip
contains **three members and nothing else** — no source map, no `data.json`, no stray file.

### 3.2 Manifest inside the zip

```text
id 'live-share' · name 'Live Share' · version '0.7.0' · minAppVersion '1.11.0'
author 'majorTom' · authorUrl 'https://github.com/Tom507/obsidian-live-share'
description "Real-time collaborative editing. Fork of Mewski's Live Share." · isDesktopOnly true
```

`version == "0.7.0"` ✅ · `author == "majorTom"` ✅ · upstream credited in the description ✅.

### 3.3 The control-surface scan, and its positive control

**23 probes**, each run against **two known-e2e bundles first** (`d6bb30d0`, `02ea8cee`). A probe that cannot
light up on a build that definitely contains the control surface is not evidence when it stays dark on
production, so the dead ones are named rather than counted as passes.

| outcome | count | detail |
|---|---|---|
| probes **proved live** (fired on a known-e2e build) | **20** | `createControlServer` 4× · `node:http` 1× · `e2e-control` 2× · `routeCommand` 4× · `parseAndRoute` 4× · `text/event-stream` 1× · `canvas.diag` 8× · `canvas.simulateEdit` 10× · `link.break` 4× · `fileop.inject` 4× · `convergence.judge` 1× · `canvas.typeInNode` 3× · `scratch.create` 2× · `"unknown cmd"` 1× · `127.0.0.1` 2× · `MAX_BODY_BYTES` 3× · control-port env 1× · `.listen(` 1× · `sseClients`/`ServerResponse` 7× · `createServer` 1× — **every one of them ZERO in the published bundle** |
| probes that **never fire** (reported as useless, not as passes) | **3** | `http.IncomingMessage`, a literal `3943x` port, a port-handshake file — absent from the e2e build too, so they prove nothing either way |
| **hits in the published bundle** | **4** | all four resolved below |

**Every hit resolved, with its surrounding bytes read:**

| hit | count | what it actually is |
|---|---|---|
| `session.info` | 1 | a **comment** in the WP82 connectivity block (`"…and `session.info` still reads them as…"`), line 28181 |
| `__LS_E2E__` | 3 | all three are **comments** stating that `plugin/src/testing/` is dead-code-eliminated via `__LS_E2E__` — exactly as the release message claimed |
| `/command` | 1 | the esbuild path comment `// src/session/commands.ts`, immediately above Obsidian's own `plugin.addCommand({id:"start-session"…})` |
| `maybeStartE2EControlServer` | 1 | **the DCE residue, and it is inert**: `if (false) { void null.then((m) => { this.testControlHandle = m.maybeStartE2EControlServer(this); }) … }` at line 29156. esbuild folded the guard to `false` and replaced the dynamic import with `null`. The branch is unreachable; the module it names is not in the bundle |

**Whole-file sanity:** the published bundle contains **zero** node builtin imports — no `node:http`,
`node:net`, `node:fs`, `node:child_process`, `node:os`, `require("http")` — while the e2e build carries
`node:http`. The e2e build is **5.28×** the size of the published one (5 895 212 B vs 1 115 708 B).

### 3.4 What is installed matches what is published

All three test vaults' `.obsidian/plugins/live-share/main.js` are **byte-identical to the zip's member**
(`a3a438ec49a73041…`, 1 115 708 B), as are `manifest.json` and `styles.css`. **Conclusion: no test build ever
reached the published zip, and the three rigs are staged with the production build.**

---

## 4. The module sweep

### 4.1 What I exercised

Every peer answered every read-only probe. Full transcript `h:/tmp/b74_sweep_ro.log`.

| Module | How | Result |
|---|---|---|
| Session identity / role | `session.info` ×3 | ✅ one room `32883766…`, **B host, A and C guests** — read, not assumed (`S139`) |
| Connectivity / links | `link.report` ×3 | ✅ control + mux both `OPEN`, `healthy`, 0 reconnect attempts, offline queue empty, `beliefDisagrees:false` |
| Reconnect / offline queue | `link.break shape=silence` → move → `link.restore` on C | ✅ **converged in 1.0 s**, 20 paths resubscribed (§4.3) |
| `.md` sync (create/edit/delete) | real disk writes in the host vault | ✅ **0.5 s / 1.0 s / 1.5 s**, byte-identical on both guests (§4.2) |
| Canvas geometry sync | 6 driven applies from the host | ✅ all 11 nodes, all 6 edges, all four planes agreeing on all three peers at every checkpoint |
| Targeted repaint (today's change) | apply-seam counter arithmetic | ✅ **works and is load-bearing** (§5.1) |
| Repair sweep (today's change) | 270 s cursor sampling ×3 peers | ❌ **starved — `S199`** (§5.2) |
| Sweep timer lifecycle | source census of all stop paths | ✅ **no leak** (§5.4) |
| Busy gate / "does not fight the user" | inline editor armed on a guest, host moves that card | ✅ card not re-seated under the open editor; negative control repainted (§5.3) |
| Inline editing signal | `canvas.editingSignal` before/during/after | ✅ `isEditingIds:['card1']` while armed, `[]` after blur; watchdog 120 s, 1 end-listener |
| Manifest | `manifest.info` / `lastPublish` / `lastChange` | ✅ 26 entries, `verdict:"purge"`, `unaccounted:[]`, shared root `_liveshare-test` known on all three |
| Canvas mirror | `canvas.mirror` ×3 | ✅ host binds 7/7 `publish-and-bind-writer`; guests correctly `skip-local-file` 7/7; 0 failed |
| File-op mute | `fileop.muteStats` / `muteDrops` | ✅ **0 drops** on all three; 1–2 canvas overruns, worst 15 ms, all released by ceiling |
| Path-safety refusals | `fileop.escapingRenames` / `protectedRefusals` | ✅ 0 / 0 — nothing tried to escape the vault |
| Collab binding | `collab.bindRefusals` / `bindFailures` | ✅ 0 / 0 on all three |
| Conflict copies / empty writes | `sync.conflictCopies` / `emptyWriteRefusals` | ✅ 0 failed, 0 empty-write refusals; 1/7/1 canvas discards (pre-existing) |
| Attestation / single-writer | `sync.attestationDecisions` / `singleWriterDeclines` | ✅ 0 contradicted, 0 unverifiable, 0 declines |
| Path outcomes | `sync.pathOutcomes` | ✅ 18 `subscribe/completed` on each; no `abandonedSubscribes` |
| Log sink | `plugin.sinkState` | ✅ enabled, `lastWriteOk`, **0 lines dropped** on all three |
| Y.Text migration shape | `canvas.textShape` | ✅ identical field/shape/length table on all three peers |
| Control-surface error handling | 3 malformed requests | ✅ structured 400s with named reasons (§7 control) |

### 4.2 `.md` sync — the claim the brief called most likely to be vacuously green

`h:/tmp/b74_md.py`. Host = B. Every arm uses the **same writer, same waiter, same deadline**.

| Arm | What | Result |
|---|---|---|
| **M3** negative control | wait 15 s for a file **nobody ever created** | **timed out** — the waiter cannot report a phantom arrival |
| M1 | host writes `_liveshare-test/b74-md-143639.md` | **arrived on both guests in 0.5 s**, content sha `82438304476ad3be` identical on A, B and C |
| **M2** negative control | host writes `b74-outside-shared-143639.md` **outside** the shared root | **stayed absent on both guests for the full 45 s** — same writer, same waiter, opposite verdict |
| M4 | host rewrites the file with an extra line | both guests reached `de07adc2fe7a809f` in **1.0 s** |
| M5 | host deletes the file | gone on both guests in **1.5 s** |

**This is the one claim in the report I am most confident in**, because the instrument demonstrated three
different ways of saying no before it was allowed to say yes. **`.md` is unaffected by today's change.**

### 4.3 Reconnect — and the arming control that voided my first attempt

My first `link.break` call was **malformed** (missing `shape`) and returned a structured 400. Because the arm
carried an arming control, it reported *"the break did not take — S66 shape, nothing below is evidence"* and
I discarded it rather than banking the recovery. This is `S66`'s failure mode caught by the rule that exists
because of `S66`. Redone correctly with `shape="silence"` (socket stays **open**, traffic dropped — the
harder severance, because auto-reconnect cannot paper over it):

```text
arming control  C behind the host while severed?  TRUE   C=(1065,480) vs host target (1115,530)
isolation       unsevered guest A followed?       TRUE   A=(1115,530)   -> rules out a dead host
recovery        C caught up after link.restore    TRUE   in 1.0 s, 20 paths resubscribed
```

**Side observation, allocated as `S202`:** while severed, `link.report` still read `healthy=True`,
`downLinks=[]`, `mux.up=True`, `beliefDisagrees=False`. Only the e2e-only `mux.silenced` flag distinguished a
peer receiving nothing from a healthy one. Low severity — an observability gap, not a data defect — but a
real half-open TCP connection would present exactly this way.

### 4.4 What I could NOT exercise, and precisely why

**An honest coverage gap beats a padded matrix.** These were not tested:

| Not tested | Why |
|---|---|
| **Real mouse/keyboard gestures** — drag, marquee select, resize, real inline typing | W4 cannot make the owner click. Everything in §5.3 rests on **driven input** (`canvas.typeInNode`, `canvas.simulateEdit`), and this project has seen driven and real input differ before. Explicitly flagged wherever it applies. |
| **The focused-window sweep tick rate** | Same reason. All three windows were backgrounded for the whole session; I have no 1 Hz reading to compare against (`S200`'s honest gap). |
| **`onunload` / plugin-disable / vault-switch executed live** | Reloading kills every port (the vaults hold the **production** build, which has no control surface). Resolved by **source census** instead (§5.4) — argued, not demonstrated. |
| **Undo (`canvas.undo`)** | Deprioritised in favour of the starvation measurement, which needed 270 s of wall clock. Not reached. |
| **Locks / claim tiebreak / cursors / presence rendering** | No live arm. Covered headlessly by `wp5/latency.test.ts` (11 tests incl. lowest-clientID tiebreak, loser revert, no-split-lock on reconnect), which passed in the green suite. **Headless only — not live.** |
| **Rename / move of a `.md` or `.canvas`** | Not reached. `fileop.escapingRenames` reads 0 refusals, which is an absence, not an exercise. |
| **Edges** | Out of scope by owner ruling; `S194` open and untouched. Edge geometry was only checked for *count* (6 on every peer). |
| **Whole-board `setData` branch (`S197`)** | Could not be driven from the control surface. This matters more than it did yesterday: `S197` said it was "covered only by the sweep", and `S199` says the sweep covers nothing. |
| **Large boards** | Only the 11-node `smoke.canvas`. `S199`'s 200-card arm is headless. |

---

## 5. The targeted assault on `3bd5de4`

### 5.1 The targeted repaint WORKS, and it is load-bearing — with a negative control

`h:/tmp/b74_e1_repaint.py`. The counters `describeRepaintSweep()` exposes are `tallyRepaint` outcomes of
**`repaintNode`**, which both the sweep and the three `main.ts` apply seams call. They separate exactly:

```text
seamCalls  =  (repaired + repainted + deferred + requested + interacting + missing + unsupported)  −  visited
```

`visited` counts only sweep-driven calls, so the remainder is the apply seam. The identity closed on all
three peers at every checkpoint.

| Arm | What the host did | A | B | C |
|---|---|---|---|---|
| **negative control, run FIRST** | re-sent the **identical** coordinates for `w4e041809` | Δseam **0**, Δrepaired 0 | Δseam **0** | Δseam **0** |
| real apply | moved `w4e041809` by (+40,+40) | Δseam **+1**, Δrepaired **+1** | Δseam **+1**, Δrepaired **+1** | Δseam **+1**, Δrepaired **+1** |
| real apply | moved `card1` by (+30,+30) | Δseam **+1**, Δrepaired **+1** | — | — |

**Reading:** a no-op write produces `"unchanged"` from `applyNodeGeometry`, so `repaintNode` is never reached
and nothing is counted. A real change produces `"applied"`, the seam fires **synchronously**, and it returned
**`repaired`** — meaning `repaintNode` read the element's inline transform *before* touching it and found it
demonstrably stale. **Every single seam call this run returned `repaired`.** Without WP2 those cards would
have been left mis-painted. `S196`'s fix is doing exactly what it claims, on the live rig, on all three peers.

**No re-entrancy fault was observed.** Across ~10 synchronous `render()` calls at the apply seam — including
one landing while an inline editor was open on a different peer and one landing during a link severance —
there were **zero** `unsupported` outcomes (the `catch` around `node.render()`), zero `missing`, no thrown
errors in the sink (`linesDropped: 0`, `lastWriteOk: true`, `failureCount: 0` on all three), and the board
stayed at 11 nodes / 6 edges throughout.

### 5.2 🔴 The repair sweep is starved and has repaired nothing, ever — `S199`

**Mechanism**, `canvas-adapter.ts:481-511`: `planRepaintSweep` fills `picked` from `priority` **first**, and
the round-robin loop is guarded by `picked.length < batch`. `priority` is `repaintPending`, which
`repaintNode` **re-adds to on every deferral** of an off-screen card (`:1501`) and only removes on a
successful `render()`. Once `off-screen cards ≥ batchSize`, the loop body never runs and **`cursor` is
returned unchanged**.

**Demonstrated live** (`h:/tmp/b74_cursor.py`, 7 samples over 270 s, all three peers):

```text
peer   ticks Δ   cursor values seen   batch/nodes   pending   Δvisited == Δdeferred
A          5     [9]      frozen       3/11            3        15 == 15   TRUE
B          5     [7]      frozen       3/11            3        15 == 15   TRUE
C          5     [5]      frozen       3/11            3        15 == 17   (2 seam deferrals)
```

**Lifetime attribution**, final reading, identity checked `OK` on every peer:

| peer | sweep calls | of which deferred | non-stale repaints | **sweep REPAIRS** | seam calls | **seam REPAIRS** |
|---|---|---|---|---|---|---|
| A | 2 145 | 2 139 | 6 | **0** | 5 | **5** |
| B | 1 440 | 1 436 | 4 | **0** | 5 | **5** |
| C | 1 953 | 1 953 | 0 | **0** | 6 | **2** (+2 repaints, +2 deferrals) |

**Across 5 538 sweep-driven `repaintNode` calls on three peers, the sweep has repaired zero cards.**

**Falsifiability — both arms, over the REAL exported `planRepaintSweep`/`repaintBatchSize`** (throwaway probe
`plugin/src/__tests__/v2/b74/test_b74_sweep_starvation.test.ts`, run then **deleted**; 5 tests, all passed):

| Arm | Condition | Result |
|---|---|---|
| **RED** | `priority = 3 off-screen ids`, `batchSize = 3`, 60 ticks | cursor **frozen** (1 distinct value); every tick visits the same 3 ids; **8 of 11 cards never visited**: `208541a49dc66c4c, b41O-023800-01-M, card1, card2, ee601e293437bced, from-guest, w4e040790, w4e041809` |
| **GREEN control** | same board, `priority = []`, 4 ticks | cursor advances **3 → 6 → 9 → 1**; **all 11 cards covered** in `ceil(11/3) = 4` ticks |
| boundary | `priority = 2`, one free slot per tick | recovers — cursor advances, all 11 covered, just `n` times slower |
| scale | 200 cards, `batchSize = 10`, only **10** off-screen | cursor frozen, **10 of 200** ever visited |

The scale arm is the one that matters for users: a board large enough to need a repair sweep is a board where
most cards are off-screen, so the starvation is **worse** on real boards, not better.

### 5.3 The repaint does NOT fight the user — with a negative control

`h:/tmp/b74_e4_busy.py`. Card `card1`, attached on A.

| Arm | State on guest A | Host moves `card1` | A's counters |
|---|---|---|---|
| **negative control** | no editor open | (+30,+30) | Δseam **+1**, Δrepaired **+1** — the seam fired and repainted |
| **armed** | inline editor open (`isEditingIds:['card1']`) | (+60,+60) | Δseam **0**, Δrepaired **0**, Δinteracting 0 — **`repaintNode` was never called** |

**The card was not re-seated under the open editor.** WP37 measured that re-seating a card with an open inline
editor destroys its unflushed text; that did not happen. After blur, `isEditingIds` returned to `[]` and the
model converged to (1035,450) on **all three peers**.

**A precise caveat that belongs in the same breath as the result:** the protection fired **upstream** of
`repaintNode` — `applyNodeGeometry` itself declined, so `main.ts` never reached `adapter.repaintNode?.()`.
`repaintNode`'s own `interacting` arm (`canvas-adapter.ts:1487/1492`) therefore **was not exercised live**;
the counter stayed at 0. And this whole arm rests on **driven input** (`canvas.typeInNode` reported
`editingStarted:true, opened:false`), not a real gesture. `skippedBusy=3` on the host is pre-existing from
B73's owner drag and did not move today.

### 5.4 The 1 Hz timer does NOT leak — refuted by source census

The brief's classic-shape risk. `main.ts` uses a raw `setInterval`, **not** Obsidian's `registerInterval`, so
it is not auto-cleared. But there are **three independent stop routes**, and I followed each to a call site:

1. **Canvas view closes** — `main.ts:2805`, `stopCanvasRepaintSweep(path)`, in the same block that deletes the
   presence and the adapter.
2. **Session end / plugin unload** — `main.ts:4302`,
   `for (const path of [...this.canvasRepaintSweeps.keys()]) this.stopCanvasRepaintSweep(path)`, inside
   `teardownCanvasPresences()`. `onunload` (`main.ts:1589`) calls `this.teardownCanvasPresences()` **before**
   its only `await`, so it runs synchronously on a hard quit. `cleanupSession()` goes through the same method.
3. **Self-guard on every tick** — `main.ts:4113-4119`: the interval re-reads `canvasAdapters.get(canonical)`
   and stops itself if the adapter is missing **or replaced**. So even a path that forgot to call `stop`
   cannot paint through a torn-down canvas for more than one tick.

**Verdict: no leak.** `startCanvasRepaintSweep` is called from exactly one site (`main.ts:3864`, in
`mountCanvasPresence`), which is itself reached only when `canvasPresences.has(canonical)` is false — and the
teardown that clears the presence also stops the sweep, so the `if (has(canonical)) return` idempotence guard
cannot strand a replacement adapter without a sweep in the ordinary flow.

**This is `argued` from the source, not `demonstrated`** — a live proof needs a reload, and a reload kills the
rig. It is the one risk in the brief I could not put on the instrument.

### 5.5 `S201` — the counter that hid both of the above

`DISPATCHER_STATE.md` §B73 reads *"`REPAIRED=1` on BOTH guests. The sweep found a card whose pixels genuinely
did not match its model and repaired it,"* and builds *"the board looks correct BECAUSE the restoring force
is running"* on it. **That attribution is wrong.** `repaired` is a `repaintNode` outcome and
`describeRepaintSweep()` reports it under a sweep-shaped name while counting the apply seam too. Split by the
identity in §5.1, the sweep's contribution is **0** and the seam's is **12**.

The consequence cuts both ways and both should be recorded:

- **Good:** WP2's targeted repaint is *more* effective than B73 credited it — every one of its 12 calls found
  a genuinely stale element.
- **Bad:** the residual damage rate `REPAINTED`/`REPAIRED` was built to expose is currently **unmeasurable**,
  because the counter is dominated by the seam. B73's figures cannot be re-derived, since `deferred` was not
  reported alongside them. `describeRepaintSweep()` should split the two callers before `REPAIRED` is quoted
  again.

---

## 6. Findings

| # | Signal | Severity | Status |
|---|---|---|---|
| F1 | `S199` — the repair sweep is permanently starved; 0 repairs across 5 538 sweep calls on 3 peers | **HIGH** (mitigation inert + release note untrue) | OPEN, demonstrated live **and** headless, both arms |
| F2 | `S200` — the sweep's 1 Hz clock runs at 0.017 Hz in a backgrounded window | **MEDIUM** | OPEN, demonstrated ×9 windows ×3 peers |
| F3 | `S201` — `describeRepaintSweep().repaired` conflates the sweep and the apply seam; §B73's headline attribution is wrong | **MEDIUM** (instrument/record, not product) | OPEN, arithmetic identity closed on all 3 peers |
| F4 | `S202` — `link.report` reads fully healthy for a peer receiving nothing | **LOW** | OPEN, observability only |
| F5 | `canvas.binding` counters read `applyRemote:0, captureLocal:0, rePush:0, originUpdates:0` on all three peers **after six applied remote geometry changes** | **LOW** | Reported as an **instrument blind spot, not a defect claim** — the applies demonstrably happened (model + paint + file all moved). I did not chase which path bypasses these counters; no signal allocated because I have not established it is not simply a different code path than the one exercised. |

**Not found, having looked:** no data-loss route; no crash or thrown error at the synchronous `render()`
seam; no timer leak; no interference with `.md` sync, presence, the editing signal, the mute, path safety,
conflict copies, attestation or the manifest; no test-build contamination of the published artefact.

**Demonstrated vs argued, kept separate:**

- **Demonstrated:** §3 (artefact), §4.2 (`.md`), §4.3 (reconnect), §5.1 (targeted repaint), §5.2 (starvation,
  live + headless), §5.3 (busy gate, driven input), §2 (gates).
- **Argued only:** §5.4 (timer lifecycle — source census, no live reload); `S200`'s "it would be 1 Hz when
  focused"; locks/cursors/tiebreak (headless suite only, no live arm).

---

## 7. Every check's positive control

Rule 11 in full. A green from a probe never shown able to go red is not in this report.

| Check | The planted break / control condition | RED shown | Restore | GREEN shown |
|---|---|---|---|---|
| Control-surface scan (§3.3) | run all 23 probes against two **known-e2e bundles** | 20 probes fired (1–10 hits each) | n/a — read-only | same 20 probes read **0** on the published bundle; the 3 that never fired are reported as **useless**, not as passes |
| `.md` create (§4.2) | write the file **outside** the shared root, same writer/waiter/deadline | file **never arrived** on either guest in 45 s | n/a | in-scope file arrived in **0.5 s** |
| `.md` waiter itself (§4.2) | wait for a file **nobody created** | **timed out** at 15 s | n/a | real file resolved in 0.5 s |
| Repaint seam (§5.1) | re-send the **identical** coordinates (no-op apply) | Δseam **0** on all three peers | n/a — non-mutating | real move → Δseam **+1**, Δrepaired **+1** on all three |
| Sweep round-robin (§5.2) | `priority.length ≥ batchSize` (the live condition) | cursor **frozen**, 8/11 cards never visited in 60 ticks; 10/200 on the big board | same function, same reader | `priority = []` → cursor **3,6,9,1**, all 11 covered in 4 ticks |
| Busy gate (§5.3) | move the card with **no** editor open | seam fired, Δrepaired **+1** | blur | editor open → seam **did not fire**, card not re-seated |
| Reconnect (§4.3) | require C to be **measurably behind** while severed, and the unsevered guest to be in step | first attempt's malformed `link.break` → control reported *"the break did not take"* and the arm was **discarded** | `shape="silence"` | C stale at (1065,480) vs host (1115,530) while A followed → recovery in 1.0 s is evidence |
| Sweep tick rate (§5.2/`S200`) | show the same reader resolving a **sub-second** change | — | — | the reader caught an apply-seam `repaired` increment and a model coordinate change within one second, so 1 tick/60 s is the **timer**, not the reader |
| The HTTP reader itself (§4.1) | 3 malformed requests | `unknown cmd: there.is.no.such.command` · `malformed body: 'cmd' must be a string` · `missing or invalid string arg: 'path'` — all structured 400s | n/a | every real probe returned `ok:true` |
| Register checker | its own built-in control | `all classes proved` on every run | n/a | exit 0, 256 files |

**One break that reddened nothing, reported as a finding rather than swept up:** `repaintNode`'s own
`interacting` arm never fired in §5.3, because `applyNodeGeometry` declines **upstream** of it. The criterion
"the repaint refuses while the user is editing" is therefore satisfied by a *different* conjunct than the one
`repaintNode` implements, and `repaintNode`'s guard is — on this path — **subsumed and untested live**. It
still matters on the sweep path, where nothing upstream declines.

---

## 8. State the rig and the vaults were left in

**All three vaults are on the PRODUCTION v0.7.0 bundle on disk** — `main.js` `a3a438ec49a73041…`, 1 115 708 B,
byte-identical to the published zip, verified this run. **All three processes are still running the e2e build
`b55097a2ede87556` from memory, so ports 39431/39432/39433 are still live as I hand over.** They die on the
next reload. I deliberately **did not** request a reload: everything in this report was obtainable from the
running processes, and destroying the rig for a fresh e2e bundle would have bought only the two things in
§4.4 that need a human gesture anyway.

| | vault | port | role at handover | bundle on disk | bundle in memory |
|---|---|---|---|---|---|
| A | `ObsidianOrga` | 39431 | guest | v0.7.0 production | `b55097a2` e2e |
| B | `ObsidianOrga - Kopie` | 39432 | **host** | v0.7.0 production | `b55097a2` e2e |
| C | `ObsidianOrga - W4TestC` | 39433 | guest | v0.7.0 production | `b55097a2` e2e |

Session healthy on all three at handover: one room `32883766…`, both links `OPEN`, offline queue empty,
`smoke.canvas` at **11 nodes / 6 edges** on every peer.

**Changes I made to the playground vaults** (owner-authorised; not restored, per the constraint, but named
precisely):

| What | Where |
|---|---|
| `smoke.canvas` node `w4e041809` moved `(1960,480) → (2000,520)` | all three, converged |
| `smoke.canvas` node `card1` moved `(975,390) → (1115,530)` | all three, converged |
| `card1`'s text has ` b74probe` appended (from the busy-gate arm) | all three, converged |
| `_liveshare-test/b74-md-143639.md` created, edited, then **deleted** | net zero — gone from all three |
| `b74-outside-shared-143639.md` **left in vault B's root only** | the M2 negative control; deliberately outside the shared root, so it never left B. Delete at will. |
| C's mux link broken and restored | fully restored, `silenced:false`, 20 paths resubscribed |

**Nothing the owner must do.** No vault is in a broken or ambiguous state.

### Repo state

`git status` was empty before and after the gate. I created and **deleted** the throwaway probe
`plugin/src/__tests__/v2/b74/test_b74_sweep_starvation.test.ts`. Files I leave changed, all Dispatcher-owned
artefacts, **uncommitted for the Dispatcher to verify and commit**:

```text
M  workflowArtifacts/canvas-v2/SIGNAL_REGISTER.md          ← S199-S202 appended to §3a
M  workflowArtifacts/canvas-v2/check_signal_register.py    ← NEXT_FREE 199 → 203
A  workflowArtifacts/canvas-v2/ValidationReport_B74_ReleaseSweep.md
?  workflowArtifacts/canvas-v2/diag/census-142536-{A,B,C}.json   ← the opening census, kept as evidence
```

**No production source was touched. No commit was made.**
Signal register checker re-run after every edit above: **exit 0**, control proved.
Next free signal is now **S203**. <!-- signal-register: meta -->

### Evidence files

```text
h:/tmp/b74_gate.py         + b74_gate_out/{tsc,vitest,signal_register,git_status_*}.log   the gates
h:/tmp/b74_artefact.py     + b74_artefact.log  / b74_artefact.json     published zip, 23-probe scan
h:/tmp/b74_artefact2.py    + b74_artefact2.log                         hit contexts, repaired probes
h:/tmp/b74_sweep_ro.py     + b74_sweep_ro.log  / b74_sweep_ro.json     22-probe read-only module sweep
h:/tmp/b74_e1_repaint.py   + b74_e1.log        / b74_e1.json           apply-seam repaint + no-op control
h:/tmp/b74_tickrate.py     + b74_tickrate.json                         tick rate, 9 x 60 s windows
h:/tmp/b74_cursor.py       + b74_cursor.json                           starvation, 270 s x 3 peers
h:/tmp/b74_md.py           + b74_md.log        / b74_md.json           .md sync + 2 negative controls
h:/tmp/b74_e4_busy.py      + b74_e4.log        / b74_e4.json           busy gate + voided first reconnect
h:/tmp/b74_e6.py           + b74_e6.log        / b74_e6.json           reconnect, armed correctly
h:/tmp/b74_final.log                                                   final counter arithmetic + end state
```

---

## 9. What I would put in front of the owner in one paragraph

0.7.0 is safe and the fix it shipped for genuinely works — on the live rig, a remote card move now repaints
its card synchronously on every peer, and every time it did so this run it found pixels that really were in
the wrong place. The suite is green at 448 files / 3404 tests, the published download contains no test
scaffolding, and `.md` sync, presence, locks, the manifest and reconnect are all unchanged. The one thing we
got wrong is the **safety net we described in the release notes**: the background repair sweep is starved by
its own priority queue and has never repaired anything, and its clock is throttled 60× in a background
window. That is a documentation correction plus a small follow-up package — not a reason to pull the build.
