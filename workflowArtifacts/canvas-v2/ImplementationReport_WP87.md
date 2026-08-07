# Implementation Report — WP87: a blur commit is a remote change like any other

**Batch:** B36 · **Worker:** 3 (Implementation) · **Mode:** autonomous
**Date:** 2026-08-05 · **Branch:** `fix-bugs-and-raceconditions` · **Commits:** `012f896`, `dc1abc0`
**Charter:** `TaskCharter_WP87_BlurCommitIsARemoteChangeLikeAnyOther.md` (6 ACs)

---

## 0. Summary

| | |
|---|---|
| **Attributed before repaired?** | **Yes.** AC1's receipt row was recorded, in both directions, on a bundle carrying the instrument and **no fix**, before a line of repair was written. |
| **The route** | **R-C — the disk write under an open leaf.** Not R-A, not R-B, not R-D. |
| **`main.ts`'s inherited claim** | **FALSE, and now corrected in the tree.** *"Obsidian never reloads a canvas from an external write"* — measured on **both vaults**, on an **unshared** board with no plugin path involved at all: it does, and the open editor's unflushed characters are destroyed with it. |
| **RED → GREEN, same suite, same rig** | `H:\tmp\liveshare_wp87_e2e.py`: **24 passed / 2 failed** (baseline, run `110411`) → **37 passed / 1 failed / 0 skipped** (repaired, run `115235`). Opposite role assignments between the two: RED `A=guest B=host`, GREEN `A=host B=guest` (**S37 symmetry control**). |
| **AC status** | AC1 ✅ · AC2 ✅ · AC3 ✅ · AC4 ✅ · AC5 ✅ · AC6 ✅ |
| **C37 AC3, end to end through two live inline editors** | **SATISFIED.** `A.state='kolla1bo2ration'  B.state='kolla1bo2ration'` — both markers, in typed order, inside one word, on **both** peers, in **both** directions. WP36's single-span known limit did **not** fire (`stripped='kollaboration'` on both). |
| **Unit suite** | **2470 / 2470 pass, 347 files, 0 failed** (WP87 adds **37** tests in **2** files) |
| **The 13 WP36-superseded red assertions** | **Not present.** They were B32's and B32 migrated them (`214ff91`, `3744063`). The tree this batch measured has **zero** failing unit tests. |
| **Canvas E2E, matched pair, back to back on the same suite** | control at the parent commit `a1c435e` **21/21** → WP87 at `012f896` **19/21** → **WP87 with the ceiling (`dc1abc0`) 21/21**. The regression was found by a control run, attributed, and closed — §4.2. |
| **§7 licences taken** | **NONE, of any class.** No existing test was deleted, weakened, retitled, skipped or amended. |

---

## 1. AC1 — the attribution, in full

### 1.1 The destruction, reproduced live, in both directions

Baseline bundle `70219348c13011e0…` — the **instrument only**, no repair. Roles: **A resumed as `guest`, B as `host`** (both `connected: true`, S47 asserted before measuring).

**S1, A blurs, B is typing** — B's surface across the window, sampled every 0.8 s:

```
        + 0.9s        'kollabo2ration' editor  flag=None  probe=c1  isEd=['c1'] q=0[]      w=True doc='kollaboration'
        + 1.7s        'kollabo2ration' editor  flag=None  probe=c1  isEd=['c1'] q=0[]      w=True doc='kollaboration'
        + 2.5s        'kolla1boration' editor  flag=c1    probe=c1  isEd=['c1'] q=1['c1']  w=True doc='kolla1boration'
        …unchanged through +14.7s
>>> PASS  S1 RED: B's live editor was REPLACED by A's committed value
      surface(c1)='kolla1boration' source=editor destroyed_at=2.5s
```

**S2, B blurs, A is typing** — same shape, `destroyed_at=2.5s`. The `+2s / +4s` shape WP36 measured is reproduced on demand, in both directions.

### 1.2 The receipt that names the route — and what the other three showed

| # | route | what the receipt showed, on the peer being destroyed |
|---|---|---|
| **R-A** | reconcile with the substitution running and insufficient | **S1: the substitution RAN and was correct.** `reconcile …: structural reload ok (nodes 2->2, edges 0->0) [deferred (inline editor on 'c1'); 1 other record(s) applied]` at `09:05:05.129Z`, and the queue held exactly **1** record (`q=1['c1']`, read live through `canvas.editingSignal`). The edited record was withheld from `setData`. **The editor was destroyed anyway.** |
| **R-B** | reconcile with `getEditingNodeId()` reading **null** | **Falsified in S1.** `flag=c1`, `probeNodeId='c1'`, `isEditingIds=['c1']` at and after the moment of destruction, and the reconcile line carries the `deferred` clause — the signal was **not** null. |
| **R-C** | **the disk write under the open leaf** | **S2 IS THE DISCRIMINATOR, and it is the charter's own R-C receipt verbatim.** On A there was **NOT ONE `reconcile <path>:` line in the entire window** — the peer had no canvas adapter at all (§1.4) — and the destruction still happened at exactly `+2.5s`. The only receipt in the window: `CANVAS WRITER: _liveshare-test/wp87-110411-d2.canvas owner=CanvasPersistence nodes=2 edges=0` at `09:05:58.301Z`. *"the `CANVAS WRITER:` line inside the window, with **no** reconcile line for that path in the same window."* |
| **R-D** | WP37's own drain firing on the wrong peer | **Falsified in both.** `draining N deferred record(s) …`: **none**. `EDIT WATCHDOG:` releases: **none**. `DRAG WATCHDOG:` **none**. |

**`getEditingNodeId()`'s value on the victim in the destruction window** — the figure AC1 requires, read through WP87's non-mutating reader so the measurement could not itself fire a blur:

- **S1 (B):** `flag=c1`, `probeAvailable=true`, `probeNodeId='c1'`, `isEditingIds=['c1']`, `hasWriter=true`, `queuedRecords=1`. The predicate answered **`'c1'`** throughout.
- **S2 (A):** `signal: null` — **there was no adapter to ask.** See §1.4.

### 1.3 The inherited claim, settled — and it is FALSE

`main.ts` stated, in a comment that several work packages read as a map:

> *"Obsidian never reloads a canvas from an external write."*

**Measured directly, with no peer, no doc and no plugin path involved** — an **UNSHARED** `.canvas` (not in the shared folder, never subscribed, no adapter, no writer), opened in a real leaf, typed into, then replaced on disk from outside Obsidian:

```
  X UNSHARED precondition: the characters are in the EDITOR
      after='kolla9boration' source=editor
  X UNSHARED MEASURED: Obsidian reloaded the canvas from an external write = True;
      the typed character was lost = True        surface='EXTERNALLY-WRITTEN'
```

**4 rows, both vaults, unshared and shared, all four the same.** The comment is corrected in place rather than deleted, with the measurement written beside it — the `skipsAutoTextSync` lesson.

**And the reload is a REBUILD, not `setData`'s node-reuse.** This is the measurement that decided the *shape* of the repair (`H:\tmp\liveshare_wp87_reload_probe.py`):

| write, with an editor open on `c1` | `c1`'s editor survived? |
|---|---|
| byte-identical content | **yes** (no reload — nothing changed) |
| **only the OTHER card's text changed** | **NO — destroyed, on both vaults** |

So projecting the surface's own value for the edited card — the elegant repair, WP37's substitution moved to the byte seam — **buys nothing**: any content change rebuilds the view. The only thing that does not rebuild it is not changing the bytes.

### 1.4 A second defect, found by the attribution and repaired because AC3 is unreachable without it

In S2 the victim had an **open canvas leaf, a live editor, an attached disk writer — and no `CanvasAdapter`**. Reproduced deterministically (`H:\tmp\liveshare_wp87_adapter_probe.py`, **3/3 rounds**, one-sided):

```
  after leaf open   A: hasAdapter=False avail=False hasWriter=True signal=null leafOpen=True nodeFound=True live=[]
  after leaf open   B: hasAdapter=True  avail=True  hasWriter=True signal=present leafOpen=True nodeFound=True live=['c1','c2']
```

Traced in the guest's own log: `detected canvas leaf … viewType=canvas` is emitted, and the `mount <path>: private API available=` line that follows a successful mount **never is**. `mountCanvasPresence` bails at `if (!handle) return null;` — `subscribe()` adds to `subscribedPaths` **synchronously** but only creates the doc handle after its first `await`, and `syncCanvasPresences` runs only on `layout-change` / `active-leaf-change`, so **it never retries**. The writer attaches ~50 ms later, when the handle exists.

**It is role-shaped:** a **host**'s canvases are already subscribed by WP79's mirror when the leaf opens, so the race cannot be lost there; a **guest** lazily subscribes at leaf-open and loses it every time. The consequence is larger than WP87: **on a guest, an open canvas is never reconciled at all and WP37's entire editing protection is structurally inert**, because the predicate lives on the adapter that does not exist.

Repaired here, as one line of wiring, because WP87's own AC3 is unreachable in one direction without it: the lazy-subscribe continuation re-runs the same pass once the subscribe has resolved. It cannot recurse — the branch it re-enters is gated on `!isSubscribed`, now true.

---

## 2. The repair

**Nothing is stopped, nothing is detached, and no timing constant was changed.** `CANVAS_EDIT_DRAIN_DELAY_MS` is still `2500`, `EDIT_WATCHDOG_MS` still `120_000`, `EDIT_POLL_MS` still `400`, `DRAG_WATCHDOG_MS` still `5000` — pinned by test, not by reading.

### 2.1 `canvas/canvas-editing-deferral.ts` — three additions, all pure

| addition | what it decides |
|---|---|
| `planCanvasDiskWrite({editingNodeId, surfaceReadable, holds})` | may this flush change the `.canvas` bytes right now? `withhold` **only** for a positively identified editing session; every unknown **writes**; and never more than `CANVAS_MAX_WITHHELD_FLUSHES` in a row (§4.2). |
| `createCanvasWriteHoldQueue()` | one entry per path, newest content replaces — bounded by construction, exactly like `canvasDeferrals`. |
| `planCanvasDrain({records, attempt})` | may the drain put the withheld records on the surface **yet**? |
| `EditingDeferralDecision.receiptData` | what the apply receipt is built from — **not** always what the surface was handed. |

**The fail-open direction on the disk write is deliberate and is the opposite of `planEditingDeferral`'s.** Withholding a *view* apply costs stale pixels until the next pass; withholding a *disk* write with nothing to release it is WP85's defect rebuilt. Only a positively identified editor withholds.

### 2.2 `main.ts` — wiring, injection and a verdict read

- **The consultation** sits on the **injected `PersistenceIO`**, decorated where `main.ts` already constructs it. `files/canvas-persistence.ts` is **byte-unchanged** — WP85's declared boundary is not re-opened, the writer is never detached, never stopped, never reconfigured; only the moment the bytes land moves, and only while an editor is open on that path.
- **`releaseHeldCanvasWrite`** — the same three exits WP37 already has (blur, view close, teardown), with the echo mute, `noteExternalDiskWrite` and a trailing `flush()` mirroring what `writeSnapshot` does around its own write.
- **The drain gate** — `planCanvasDrain`'s verdict, executed. On `retry` the records are re-noted **and the disk write stays held**, because releasing it would rebuild the view from the peer's bytes and destroy the characters the drain is waiting for.
- **The receipt** is built from `deferral.receiptData`.
- **One line of mount wiring** (§1.4).

There is **no conditional over canvas state** in `main.ts`: every branch executes a verdict returned by the pure module.

### 2.3 The third defect, uncovered by the second repair — the shadow was being fed unflushed text

With the view protected, the victim's characters were still lost **at the blur**, and the reason was measured rather than guessed (run `114152`, the victim's own log):

```
09:42:47.030  reconcile …: structural reload ok … [deferred (inline editor on 'c1'); 1 other record(s) applied]
09:42:47.258  CANVAS WRITE HELD: … withheld (inline editor on 'c1') (holds=1)
09:42:48.942  SHADOW STALE: … 1 field(s) not pushed: node/c1.text
09:42:48.948  local modify …: +0 ~0 -0 node(s)
```

`buildApplyReceipt` marks **every** record of a reloaded `structural` pass `"applied"` — `nodeOutcomes` is consulted only in the geometry branch (`canvas-shadow.ts:816-819`). So the substituted record advanced the Surface-Shadow to **what the surface held**, and what the surface held was the user's **unflushed editor text**. The user's own save then diffed against a shadow that already contained it and was discarded as **stale**. **C37 AC4 says a deferred record's shadow fields are not advanced; that held for the geometry branch and silently did not for the structural one.**

Repaired without touching `canvas-shadow.ts` (WP5's, out of scope): `receiptData` keeps the **shadow's own previous record** for a substituted card. Advancing a field to the value it already holds is a no-op, the record stays in the receipt so `exhaustive` still means what it means and nothing is marked absent, and the local edit stays visible to the next capture as the intent it is.

**That change is what turned C37 AC3 green.** It is reported as a distinct finding because it was invisible for as long as the writer destroyed the editor twelve seconds earlier.

---

## 3. AC-by-AC

### AC1 — reproduced live, both directions, attributed by receipt before any repair ✅

§1. One route named (**R-C**), its receipt quoted, the other three reported as what they showed, `getEditingNodeId()`'s value on the victim recorded, and `main.ts`'s claim settled and corrected. The vacuity guards AC1 names are all live: the typed characters are shown present at the victim's **surface** with `source='editor'` **first**; the `present_in_file=False` guard is asserted for the victim **before** the blur; both role orders were run; `canvas.open` was never sent.

> **The vacuity guard was itself unsound in the first three runs and is reported, not hidden.** `"2" in <the whole .canvas>` matches `"x": 20` and `"width": 400`. It was reported as a FAIL by the suite in every run until it was repaired to parse the card's own `text` — an instrument defect that showed up as a red row rather than as a false green, which is the right way round.

### AC2 — the route set is DERIVED FROM THE TREE, with a mandatory reverse assertion ✅

`plugin/src/__tests__/v2/wp87/surface-route-census.ts` + `test_tp01_…`. **971 units parsed, 155 routes, 9 canvas-surface sinks.**

**What is seeded is a vocabulary of EFFECT PRIMITIVES, and even that is parsed out of the tree:** the private live-view mutators from `canvas-adapter.ts`'s own declaration block, and the file writer from `PersistenceIO`'s own signature — **including its first parameter's name**, because `write(` alone matches a markdown sink, a sidecar checkpoint and a conflict archive. Derived: `["moveAndResize","requestFrame","requestSave","setData","write(diskPath)"]`.

**The disposition table, as executed:**

| disposition | sink |
|---|---|
| `GUARDED` | `main.ts#attachCanvasWriter` — consults `getEditingNodeId`, `planCanvasDiskWrite` |
| `GUARDED-BY-CALLER` | `canvas/canvas-adapter.ts#reloadCanvasData`, `#applyNodeGeometry`, `files/canvas-persistence.ts#createVaultPersistenceIO` |
| `INJECTED-SEAM` | `files/canvas-persistence.ts#writeSnapshot` — admitted **only because every site that injects its `PersistenceIO` guards**, which is the row that goes red on the pre-WP87 tree |
| `RELEASE` | `main.ts#releaseHeldCanvasWrite` — runs only to release a hold |
| `REFUSES-TO-OVERWRITE` | `files/canvas-sync.ts#writeConflictCopy` — checks existence and throws; it can create, never replace |
| `NO-PRODUCTION-CALLER` | `files/canvas-sync.ts#writeToDisk` — the retained seed helper, no caller |
| `DEFINER-FACTORY` | `canvas/canvas-adapter.ts#createCanvasAdapter` — encloses the sinks, is not a route into one |
| **`UNGUARDED`** | **none** |

**Every admission is structural** — read off the unit's own body or the call graph. None reads a filename.

**S53, defended in five ways, and one of them fired:** the deriver is shown to parse >200 units; to find both known sinks; to return **nothing** on an innocent module; to reach a sink **three hops** away; and — **the trap that actually bit** — WP88's parser mistook the `{` in `reconcileLiveCanvas`'s **parameter list** for its body, so the route the whole criterion is about looked like it called nothing. That is S53's original cause, live in this tree, and it is pinned by its own test.

**The pin discriminates, proven three ways:** the pre-WP87 disk route is reported `UNGUARDED`; a site that calls the predicate and **ignores** the verdict is `UNGUARDED`; a site that branches on the verdict and returns early is `GUARDED`.

**Rule 10:** `getEditingNodeId` has exactly **one** definer, asserted, and the two routes consult **the same one**.

**Rule 15, both directions, with the tool named.** TOOL: Node's own `RegExp` with the `g` flag over **comment-stripped** source (a detector that counts a mention in prose measures the prose — that reddened three tests in this run once already). Not `grep -o`; the pattern contains no `.`. Pattern: `getEditingNodeId|onEditingEnd|planEditingDeferral|classifyBusyGate|isBusy`. **Positive controls:** `canvas/canvas-adapter.ts` and `main.ts` both > 5. **Absences:** `files/canvas-persistence.ts`, `files/canvas-sync.ts`, `files/vault-events.ts`, `canvas/canvas-shadow.ts` — all **0**, and `canvas-persistence.ts`'s zero is now *correct* rather than the defect, because the consultation is in the seam that injects its writer.

### AC3 — the repair is at the record, and BOTH halves hold ✅

**GREEN, run `115235`, roles `A=host B=guest` (opposite to the RED run):**

```
  PASS  S1 [A blurs -> B is typing] THE CRITERION: B's typed characters SURVIVED in the live editor
        surface(c1)='kollabo2ration' source=editor destroyed_at=None
  PASS  S1 THE CRITERION: B's marker was present at EVERY sample across the window that was RED
        samples=18 first_loss=None
  PASS  S2 [B blurs -> A is typing] THE CRITERION: A's typed characters SURVIVED in the live editor
        surface(c1)='kollabo2ration' source=editor destroyed_at=None
        samples=18 first_loss=None
```

**The reciprocal half, both directions:**

```
  PASS  RECIPROCAL: the blurrer's committed value IS present on the victim's surface
  PASS  RECIPROCAL: … IS in the victim's canvas.state
  PASS  RECIPROCAL: … IS in the victim's .canvas file
```

**The discriminator against a hold-everything build** — the trap AC3 names by hand:

```
  PASS  U1 the typist's characters survived an unrelated card's change   surface(c1)='card one-MINE115235' source=editor
  PASS  U1 DISCRIMINATOR: the unrelated card DID update on the typist's open canvas
        surface(c2)='card two REMOTE115235' source=model
```

`U2`'s discriminator **failed in the final run and passed on the identical installed bundle five minutes earlier** (run `114740`, both `U1` and `U2` green). It is the suite's 6 s propagation window, not a product row: the same bundle, the same scenario, opposite outcomes. Recorded as a flake, not attributed to the repair.

### AC4 — the zero inverted, and it is shown to ✅

| | receipts for `c1` on that board, on the victim |
|---|---|
| **RED**, run `110411` | S1 (B): **1**, and its content is the point — `"ops": 0`. A capture that ran and had **nothing to contribute**. |
| **RED**, the state WP36 measured | **0** — reproduced in GREEN v1 (run `113405`) after the view was protected but before §2.3: `receipts=0 ids=[]`. |
| **GREEN**, run `115235` | S1 (B): **1**, `ids=[5]`. S2 (A): **3**, `ids=[12, 13, 14]`. |

**Which mechanism produced them:** B's own blur capture. `draining N deferred record(s) …` is **absent** from both windows, so no receipt in this run came from WP37's drain.

**A number with no before is not a measurement**, so all three rows are given, including the intermediate one that made the third defect visible.

### AC5 — nothing WP37 landed is weakened, and the deferral cannot become permanent ✅

- **Headless, injected clock, no sleeps:** `plugin/src/__tests__/v2/wp37/**` — 4 files — **pass unmodified**; with WP5v2 and WP87 that is **143 / 143**. The four-row `isBusy()` truth table, both `EDIT WATCHDOG:` releases, and the three drains asserted separately are all WP37's own rows, untouched.
- **Quoted claim:** `DRAG_WATCHDOG_MS` is still `5000`; `dragActive()`, `isDragTarget` and the `DRAG WATCHDOG:` signature are byte-unchanged; `git diff` on `canvas-adapter.ts` is additive lines only. `DRAG WATCHDOG:` appears **zero** times in every live window measured.
- **No timing constant was changed.** `CANVAS_EDIT_DRAIN_DELAY_MS === 2500` is pinned by test. The drain's new wait is an **event** (has the local capture landed?), not a longer interval — because the thing it waits for is an event, which is exactly why a longer delay could not decide it.
- **The new queue is bounded by driving it:** 200 withheld flushes over one path leave **one** entry, and it is the **last** (a queue coalescing to the first would be bounded and wrong). Paths do not bleed; release is idempotent; `clearAll` leaves nothing.
- **The drain is bounded by driving it:** `["retry","retry","retry","apply","apply"]` across attempts 0–4, and the terminal row says why in its own reason string. A queue that never drains is a permanently stale view — a worse defect than the one being repaired.
- **Live:** `AC5 live: both peers CONVERGED on one value for the edited card  A.doc='kolla1bo2ration' B.doc='kolla1bo2ration'`, both directions. Neither peer is left stale.

### AC6 — C37 AC3, run as written, end to end, through two live inline editors ✅

```
      ===== C37 AC3, END TO END THROUGH TWO LIVE INLINE EDITORS =====
        A.state='kolla1bo2ration'  B.state='kolla1bo2ration'
  PASS  C37 AC3: BOTH typists' markers are present on BOTH peers (canvas.state)
  PASS  C37 AC3 (POSITIONAL): the marker typed at offset 5 precedes the one typed at offset 7, on BOTH peers
  PASS  C37 AC3: both markers are in BOTH peers' .canvas FILE
  PASS  C37 AC3 (WP36 KNOWN LIMIT): the merge introduced no character neither user typed
        A stripped='kollaboration' B stripped='kollaboration'
```

**Both directions.** Preconditions asserted, not assumed: each typist's characters reached the **editor** (`source='editor'`, `applied=True`) and were **not yet in that peer's own `.canvas` file** when the other's change landed.

**The verdict, plainly: C37 AC3's positional half is now SATISFIED END TO END.** It is **not** claimed from `canvas.textShape` and **not** from the doc alone — the surface read is the oracle, `canvas.state` and the parsed `.canvas` bytes are the confirmation, and the run that produced them is the two-live-editor scenario WP36 could not carry past the first peer. **WP36's single-span known limit did not fire**, so AC3 is green rather than PARTIAL; had it fired, this row would have read PARTIAL against that named limit and WP87 would still have been complete.

---

## 4. RED → GREEN, matched pair

| | **RED — instrument only, `70219348…`** | **GREEN — repaired, `ae1adefb…`** |
|---|---|---|
| run | `110411` | `115235` |
| roles resumed as | **A=guest, B=host** | **A=host, B=guest** — *opposite; S37 symmetry control* |
| `connected` on both | true (asserted before measuring, S47) | true |
| **RESULT** | **24 passed, 2 failed** | **37 passed, 1 failed, 0 skipped** |
| S1 the victim's editor | **DESTROYED**, `destroyed_at=2.5s` | **SURVIVED**, `destroyed_at=None`, 18/18 samples |
| S2 the victim's editor | **DESTROYED**, `destroyed_at=2.5s` | **SURVIVED**, `destroyed_at=None`, 18/18 samples |
| victim's own capture | S1 `ops:0` · (0 receipts once the view was protected) | S1 **1**, S2 **3** |
| C37 AC3 | not run (RED mode) | **PASS**, both directions |

The suite is idempotent: per-run ids (`wp87-<RUN>-*`), both vaults swept at preflight and teardown (8–9 artefacts each run), SKIP counted as SKIP and never as PASS.

### 4.2 The canvas E2E regression this batch caused, found by a CONTROL and closed

Not assumed pre-existing. Three runs of the same suite, back to back, on the same
accumulated canvas, differing only by the bundle — each bundle built in a **detached
worktree** at a named commit and installed through a digest-guarded installer that never
touches the shared `plugin/main.js`:

| bundle | commit | canvas E2E |
|---|---|---|
| control | `a1c435e` (WP38's, **no WP87**) | **21 / 21** |
| WP87 | `012f896` | **19 / 21** — `[06] B: node gone`, `no resurrection after a further settle` |
| WP87 + ceiling | `dc1abc0` | **21 / 21** |

**`[06]` reads the `.canvas` FILE** (`read_canvas` → `p.read_text()`), and that is what named the
cause: the editing signal reported an editor on a board nobody was typing in, the write was
withheld, and B's file kept a node the doc had already deleted. **The hold's normal release is
a BLUR, and a session that was never real never blurs.**

Closed by bounding the hold on **both** axes — the drain (an event) and
`CANVAS_MAX_WITHHELD_FLUSHES = 8` (a ceiling) — plus an event-free release: a `write` verdict
drops any still-held snapshot, because the newer content supersedes it and re-writing the older
one afterwards would put a stale projection back on disk.

**All six WP87 criteria were then re-confirmed on the ceiling bundle**, both directions, with
C37 AC3 satisfied in both: `A.state='kolla1bo2ration'  B.state='kolla1bo2ration'`.

**Still red, and not attributed:** `U2`'s two rows (the unrelated-card scenario, second
direction) failed in the last run. `U1` — the same scenario with the roles swapped, run
immediately before it — passed in **every** run, and `U2` itself passed in the two runs before
that on two different bundles. The suite drives six boards through **one leaf per vault**
(`workspace.getLeaf(false)` reuses the active leaf), so late-scenario state is the first thing
to suspect. **Recorded as a red row rather than explained away.**

---

## 5. Gates

| gate | result |
|---|---|
| `tsc -noEmit -skipLibCheck` | **exit 0** |
| `npx vitest run` from `plugin/` | **2470 passed / 2470, 347 files, 0 failed**, measured 11:51 |
| `npm run build` (tsc + **esbuild production**) | **tsc half run and clean; the esbuild half deliberately NOT run.** It overwrites the shared, gitignored `plugin/main.js` with a *production* bundle, and a sibling batch (B37/WP38) was building into that same file during this run — the S46 digest guard caught exactly that at 11:41. Running it would have destroyed their instrumented bundle and mine. **Owed to Worker 4 once `plugin/src/**` is quiet.** |
| `npm run build:e2e` | run four times; final bundle `ae1adefb…` |
| canvas E2E suite | **21/21** on the shipped bundle — §4.2 |

---

## 6. Files changed

| file | change |
|---|---|
| `plugin/src/canvas/canvas-editing-deferral.ts` | `planCanvasDiskWrite`, `createCanvasWriteHoldQueue`, `planCanvasDrain`, `CANVAS_DRAIN_MAX_ATTEMPTS`, `EditingDeferralDecision.receiptData` — all pure, zero imports beyond `reconcile-plan` |
| `plugin/src/canvas/canvas-adapter.ts` | **additive only** — `describeEditingSignal()` and `EditingSignalReport`: the AC1 instrument, **non-mutating**, no verdict, consulted by no decision |
| `plugin/src/main.ts` | the `PersistenceIO` decoration, `canvasWriteHolds`, `releaseHeldCanvasWrite`, the drain gate, `receiptData` at the receipt, `canvasEditingSignal` (a read), the one-line mount retry, and the **correction of the false external-write comment** |
| `plugin/src/testing/e2e-control.ts` | **one** additive read-only case, `canvas.editingSignal`, on the `canvas.textShape` precedent |
| `plugin/src/__tests__/v2/wp87/surface-route-census.ts` | **new** — the AC2 deriver; reuses WP88's `stripComments` / `productionSources` rather than duplicating them |
| `plugin/src/__tests__/v2/wp87/test_tp01_…` | **new** — 22 tests: the deriver's reverse assertions, the census, rules 10 and 15 |
| `plugin/src/__tests__/v2/wp87/test_tp02_…` | **new** — 15 tests: the two pure decisions, the hold queue, the WP37-unchanged rows |
| `H:\tmp\liveshare_wp87_e2e.py` | **new** — the reproduction, the attribution and the proof, idempotent |
| `H:\tmp\liveshare_wp87_reload_probe.py` · `…_adapter_probe.py` | **new** — the two probes that decided the repair's shape and found the guest-adapter defect |

**Byte-unchanged, verified:** `plugin/src/files/canvas-persistence.ts`, `plugin/src/files/canvas-mirror.ts`, `plugin/src/files/canvas-mirror-decision.ts`, `plugin/src/files/canvas-sync.ts` (B32's), `plugin/src/canvas/canvas-shadow.ts`, `plugin/src/canvas/reconcile-plan.ts`, `plugin/src/canvas/canvas-presence.ts`, `plugin/src/canvas/canvas-binding.ts`, `plugin/src/canvas/canvas-model-bridge.ts`, `plugin/src/types.ts`, `server/**`, `plugin/manifest.json`.

---

## 7. The constraint sheet, discharged

| constraint | status |
|---|---|
| attribution by receipt **precedes** repair; exactly one route named | ✅ — §1, measured on a bundle with the instrument and no fix |
| one definer; no second editing predicate authored | ✅ — asserted by test; the disk route calls the **same** `getEditingNodeId` |
| the route set derived from the tree, with the S53 reverse assertion | ✅ — §3 AC2; five reverse assertions, one of which fired |
| every absence/presence claim states its pattern, its tool, its control | ✅ — Node `RegExp` over comment-stripped source; `grep -o` not used |
| `canvas.open` **never** called | ✅ — the string does not occur in the suite; every leaf opened via `canvas.typeInNode{open:true}`, empty text, no blur |
| `canvas.simulateEdit` **never** called | ✅ — it appears nowhere in this batch's suites, probes or code paths |
| the decision is headless; `main.ts` gains wiring and a verdict read | ✅ — no conditional over canvas state in `main.ts` |
| `DRAG_WATCHDOG_MS`, `dragActive()`, `isDragTarget`, `DRAG WATCHDOG:` byte-unchanged | ✅ — quoted, and `DRAG WATCHDOG:` fired zero times live |
| no timing constant changed | ✅ — `CANVAS_EDIT_DRAIN_DELAY_MS === 2500` pinned by test |
| `ReconcilePlan` keeps three verdicts; `planReconcile` not made editing-aware | ✅ — `reconcile-plan.ts` byte-unchanged |
| `files/canvas-persistence.ts` byte-unchanged; WP85 not re-opened | ✅ — the consultation is in the injecting seam |
| `useCanvasBinding` not flipped; version not bumped | ✅ — still `false`, still `0.6.1` |
| no new runtime dependency (D11) | ✅ |
| no `server/**` edit | ✅ |
| no `DONE` WP re-opened; no §7 licence of any class | ✅ |
| C37 AC3 run as written, verdict reported, not weakened | ✅ — §3 AC6 |
| vault ports used | **39431 (A) / 39432 (B)** on every live run |

---

## 8. Found and NOT fixed / carried up

| # | finding | disposition |
|---|---|---|
| **S55 (new)** | **`main.ts`'s external-write claim is FALSE, and the reload is a REBUILD.** Obsidian reloads an open canvas from an external write and destroys the inline editor, and it does so for a change to ANY card, not just the edited one. Corrected in the tree. **Every past reasoning that leaned on "an open canvas ignores external file writes" needs re-reading** — including `canvas-sync.ts`'s `noteExternalDiskWrite` comment, which says so in as many words and which WP87 did not touch (B32's file). | **Named. The comment in `canvas-sync.ts:3785-3789` still asserts it and is UNOWNED.** |
| **S56 (new)** | **A GUEST's open canvas never gets a `CanvasAdapter`.** The leaf-open mount loses a race against the lazy subscribe (`getCanvasDocHandle` still `null`) and `syncCanvasPresences` never retries. Measured 3/3, one-sided (guest yes, host no). While it holds, the guest's open view is **never reconciled** and WP37's protection is **structurally inert** there. | **Repaired here**, because AC3 is unreachable in one direction without it — but the *class* is unowned: any other seam mounted from that pass has the same race. |
| **S57 (new)** | **A substituted record advanced the Surface-Shadow to the user's UNFLUSHED editor text**, so their own save was discarded as `SHADOW STALE` and the second typist emitted zero captures. `buildApplyReceipt` honours `nodeOutcomes` only in the geometry branch (`canvas-shadow.ts:816-819`), so C37 AC4 held for one branch and silently not for the other. | **Repaired via `receiptData`, without touching `canvas-shadow.ts`.** The asymmetry inside `buildApplyReceipt` is untouched and **unowned**: a future caller that passes `nodeOutcomes` with a `structural` plan will still have them ignored. |
| **S61 (new)** | **The editing predicate reports an editor on a board nobody is typing in.** Measured indirectly but decisively: with the write hold in place and no ceiling, the canvas E2E suite's `[06]` file-level rows went red because the write for that path was withheld. Whatever the trigger (the probe's focused-element fallback is the likeliest), **`getEditingNodeId()` over-reports**, and every consumer of it inherits that. For the VIEW an over-report is invisible — the substitution writes back what is already there. For the FILE it was a stale `.canvas`. | **Bounded here, not repaired.** The predicate is WP37's and has one definer; narrowing it is not WP87's licence. **Unowned, and it is the highest-value follow-up in this area** — it silently widens every deferral in the system. |
| **S58 (new)** | **`CANVAS WRITER: … owner=CanvasPersistence` is now emitted for a write that was WITHHELD.** `writeSnapshot` logs after `await this.io.write(...)`, and a decorated `io` that withholds returns normally. The line's own `CANVAS WRITE HELD:` counterpart is emitted beside it, so the pair is unambiguous **to a reader who knows** — but the signature on its own no longer means "bytes landed". Repairing it means editing `canvas-persistence.ts`. | **Named, not repaired — it is WP85's file.** An **ESCALATE candidate** for whoever owns the log contract. |
| **S59 (new)** | The AC2 census reports `canvas/canvas-model-bridge.ts` (`applyNodeUpsert`, `structuralReload`) reaching the view mutators and consulting the predicate **zero** times. It is behind `useCanvasBinding: false` and frozen until P5 — so it is admitted as `FROZEN-BEHIND-FLAG` rather than silently. **When P5 flips that flag it becomes a live unguarded route onto a live canvas surface.** | Written down here so it is not discovered the way R-C was. |
| **S60 (new)** | `files/canvas-sync.ts#writeToDisk` is a retained second `.canvas` disk writer with **no production caller** — the census found it and admits it structurally on exactly that ground. Harmless today; a future caller would make it a second writer against the single-writer invariant. | Named. B32's file, read-only to this WP. |
| **S46, again** | The digest guard **fired for real** at 11:41: my bundle `ea879ce2…` (4 467 736 B) had been replaced at `plugin/main.js` by a sibling's `fca63485…` (4 482 421 B) between build and install. The install **aborted** instead of shipping their code under my name. | The guard works. **Always set `LS_EXPECT_SHA256`**, and grep the installed bytes for a marker unique to your own change — both were done on every install here. |
| **process** | `main.ts` and `testing/e2e-control.ts` carry ~11 lines of **B37/WP38's uncommitted** canvas-undo wiring, which `012f896` therefore contains. It could not be separated without reverting a shared path (rule 14 forbids that). | Reported, not reverted — the same shape WP36 recorded in the other direction. |

---

## 9. Data-safety statement

No `data.json` **value** was read, printed, logged, echoed into this report, a commit message or a fixture — only key **names** (`debugLogPath`, `debugLogging`, `sharedFolder`, `e2eControlPort`, `useCanvasBinding`) and the fact that `debugLogPath` is set. `debugLogPath` is resolved **inside** the suite and never emitted; only line counts and matched receipt lines appear. `sharedFolder` stayed `_liveshare-test` in both vaults throughout and was never set empty. WP88's two `data.json` backups per vault (`.wp88-b34.*`) were not touched. No `.bak` or `.pre-v2-smoke` file was touched. `obsidian-git` was left disabled. No `server/**` edit; `tools/obsidian_e2e/**` was not entered. Every artefact this batch created is namespaced `wp87-*` under `_liveshare-test/` (and two unshared `wp87-*` boards at the vault root for the external-write control) and every one was swept — 8 to 9 per run at teardown, verified `swept N artefact(s)`. No link was silenced and no scenario left an editor open. The relay was not contacted at all. Live runs used ports **39431 (A)** and **39432 (B)** only.

---

## 10. One note for whoever touches this next

**The file is a surface.** That is the whole work package. For months the tree said in a comment that an open canvas ignores external writes, three work packages reasoned from it, and it is false — an external write rebuilds the view and takes the unflushed characters with it, for a change to *any* card on the board. Every deferral, every substitution and every "the file stays converged while the pixels are briefly stale" argument in this project rests on that claim, and it was never tested until a criterion made testing it mandatory.

**And the corollary, which cost two of this batch's three iterations:** protecting the view is not protecting the data. Once the editor survived, the characters were still lost — first because the drain re-applied before the local commit was captured, then because the substitution had fed the shadow the very text it was protecting. Each defect was **invisible while the one in front of it was live**. If you repair a route here, re-measure the receipt count, not the pixels: `canvas.textShape` is the only oracle in this area that cannot be satisfied by a view that merely looks right.
