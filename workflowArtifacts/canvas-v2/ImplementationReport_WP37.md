# Implementation Report — WP37: the editing-aware busy / blur guard

**Batch:** B21 · **Worker:** 3 (Implementation) · **Mode:** autonomous
**Date:** 2026-08-05 · **Branch:** `fix-bugs-and-raceconditions`
**Charter:** `TaskCharter_WP37_EditingAwareBusyBlurMerge.md` (6 ACs)

---

## 0. Summary

| | |
|---|---|
| **Reproduced first?** | **Yes.** The defect goes RED on demand, on two live Obsidian instances. |
| **The owner's defect** | **CLOSED.** *"manchmal verschluckt er noch Buchstaben"* — the characters now survive. |
| **RED → GREEN, same suite, same rig** | `H:\tmp\liveshare_wp37_e2e.py`: **29 passed / 5 failed** (fix parked, run `035215`) → **32 passed / 2 failed** (fix present, run `034946`). The 2 remaining failures are RED in **both** runs and are labelled as such in the suite itself. |
| **AC status** | AC1 ✅ · AC2 ✅ · AC3 ⚠️ **partial — the half that depends on WP36 is unsatisfiable and is reported, not faked** · AC4 ✅ · AC5 ✅ · AC6 ✅ |
| **Unit suite** | **2076 / 2076 pass, 316 files, 0 failed** (WP37 adds **68** tests in **4** files; the pre-WP37 count in this tree is therefore 2008 / 312) |
| **`npm run build`** | tsc + esbuild, **exit 0** |
| **Canvas E2E** | **13 / 18** — and **13 / 18 with the fix parked, with the identical five failures.** Not a WP37 regression; §8 finding S30. |
| **WP79 E2E** | **18 passed, 0 failed, 0 skipped** — unchanged |
| **Data-loss E2E** | **12 passed, 0 failed, 1 skipped** — unchanged (the skip is the suite's own role-lottery skip in S2) |
| **§7 licences taken** | **NONE, of any class.** No existing test was deleted, weakened, retitled, skipped or amended. |

---

## 1. What the defect actually is — the charter's trace was right about the chain and wrong about the trigger

The charter's measured chain is confirmed:

| | |
|---|---|
| any NON-GEOMETRY remote difference ⇒ verdict `"structural"` | `canvas/reconcile-plan.ts:25`, `diffRecords`, `planReconcile` |
| `"structural"` is executed as a full `reloadCanvasData` / `setData` | `main.ts`, `reconcileLiveCanvas` |
| the only guard was `if (adapter.isBusy()) return;` | `main.ts` |
| `isBusy()` was **drag-only** | `canvas-adapter.ts`, `dragActive()` |

**What the charter did not know, and what the reproduction established: `setData` alone is not sufficient to lose a keystroke.** Obsidian's `setData` REUSES existing cards, so a record whose fields already match the live card is a no-op and the inline editor is left completely alone. Measured, on the unmodified tree:

| scenario | pre-WP37 result |
|---|---|
| a peer changes **another** card's text | editor **survives** (S1 PASS) |
| a peer **adds** a card (membership change, full rebuild) | editor **survives** (S3 PASS) |
| a peer changes **the card being edited** | editor **DESTROYED** (S2 FAIL) |

```
[S2] run 035215, fix parked
  PASS  S2 precondition: the characters reached the EDITOR, not the model
        textBefore='card one' textAfter='card one-MINE035215' textSource='editor' applied=True
  PASS  S2 precondition (VACUITY GUARD): the typed characters are NOT yet in the
        typist's own .canvas file          marker='-MINE035215' present_in_file=False
  peer B changed the card being edited -> 'card one PEER035215'
  PASS  S2 precondition: the peer's change reached the typist's shared DOC
        waited=1.0s doc.c1='card one PEER035215'
  >>> FAIL  S2: THE CRITERION — the typed characters SURVIVED in the live editor
        surface(c1)='card one PEER035215' source='editor'
```

`-MINE035215` is gone. That is the owner's *"verschluckt Buchstaben"*, reproduced on demand.

**This narrows the defect and explains the *"manchmal"* better than the charter's account did:** it is not "any non-geometry change by any peer", it is "a peer touching the card you are typing in". That is rarer, which is why it is intermittent, and it is why the fix is a per-RECORD substitution rather than a per-pass gate.

---

## 2. The fix

### 2.1 `canvas/canvas-adapter.ts` — the editing signal (AC1)

`isBusy()` gains a second arm, **added beside the drag arm and never merged into it**:

```ts
const dragging = dragActive();
const editing = editingActive();
return dragging || editing;
```

The editing arm is a **measurement taken on every consultation**, not an event subscription. Two live runs forced that:

1. **Run `033302`** — an event-only build (`focusin` on `canvas.wrapperEl`) deferred **nothing at all**. The editor is routinely focused *before* the adapter mounts, so the event is simply missed and the flag stays `null` for the whole session — indistinguishable from the defect.
2. **Run `031340`** — `nodeEl.querySelector("[contenteditable]")` finds **nothing** inside a card (`contenteditableFound: false`), so a DOM-shape discriminator cannot see the editor either.

So the primary signal is **Obsidian's own `node.isEditing`**, scanned over the live node map, with the focused-element check as a fallback for a private shape that does not expose it. The `focusin` / `focusout` / `keydown` / `beforeinput` listeners remain as a fast path.

**The bounded staleness release, `EDIT WATCHDOG:`** — deliberately distinct from `DRAG WATCHDOG:` — has two arms:

- **POSITIVE LIVENESS, immediate:** the card under the editor left the live node map. No timeout is waited out.
- **INACTIVITY, `EDIT_WATCHDOG_MS = 120_000`:** the backstop. Far longer than `DRAG_WATCHDOG_MS` on purpose: 5 s of silence is outside anything a drag produces but well inside what a person thinking mid-sentence produces, and releasing a real editor because its owner paused would destroy exactly the characters this WP protects.

Both releases fire the blur subscribers, so a watchdog-released editor drains its queue exactly like a real blur.

**`EDIT_POLL_MS = 400`** — while, and only while, an editing session is open, the adapter re-reads its own predicate. Forced by run `034401`: with the flag finally detected, the BLUR was still never noticed, because the predicate is only consulted by a reconcile pass and a pass only arrives when a remote delta does — i.e. never, once the board goes quiet. The poll is armed on focus, disarmed on release and on `destroy()`, and `unref`ed.

**The drag watchdog is untouched.** `DRAG_WATCHDOG_MS` is still `5000`; `dragActive()`, `isDragTarget` and the `DRAG WATCHDOG:` signature are byte-for-byte what they were. The injected clock (`opts.now`) is wired **only** into the editing arm — asserted by T11, which freezes the clock at `0` and shows the drag flag entirely unaffected.

Three new optional interface members (`getEditingNodeId`, `getNodeFields`, `onEditingEnd`, plus the `noteEditingFocus` test seam) on the `canvasFile` / `clearFlags` precedent, so every hand-rolled adapter double in the existing tests stays valid.

### 2.2 `canvas/canvas-editing-deferral.ts` — the decision, headless (AC2, AC4, AC5)

Zero Obsidian imports; the precedent is `canvas/reconcile-plan.ts`.

| verdict | what it means |
|---|---|
| `proceed` | nothing is being edited, or the edited card is unchanged by this pass — **byte-identical behaviour to HEAD** |
| `defer-drag` | a drag, not an edit — **byte-identical behaviour to HEAD** |
| `substitute` | the edited card's record is replaced by **what the surface already holds**, so `setData` writes it back unchanged and Obsidian's node-reuse leaves the editor alone, while **every other record takes its new value** |
| `hold` | the pass cannot be made harmless (an authoritative `initial` pass; the edited card is being removed remotely; no readable surface state) — nothing reaches the surface, everything is queued |

`classifyBusyGate` is what lets `main.ts` execute a verdict instead of holding a conditional over canvas state: `isBusy()` is now true for two states that want opposite treatment, and they are told apart in the headless module.

**The substitution uses the adapter's LIVE read (`getNodeFields` → Obsidian's own `getData()`), not the shadow.** This matters: the shadow says what the surface *was told*; the card says what it *has*. Substituting a shadow value that has drifted would write it over the card and destroy the local edit — the defect wearing the fix's clothes. Asserted by T9.

**Membership changes are NOT held.** The first build held them, reasoning that `setData` rebuilds the view. The reproduction says otherwise (S3 PASSES on the unmodified tree), so holding bought nothing and cost a board that stops updating while anybody types. Corrected, with the measurement written into the module.

The queue is **bounded by construction** — a `Map` keyed by record id, so a burst of N changes to one card leaves exactly one entry. There is no cap constant to read, which is deliberate: AC5 forbids asserting the bound by reading one.

### 2.3 `main.ts` — calls only

Three call sites, no canvas logic:

- the busy gate now forwards two measured facts to `classifyBusyGate` and executes its verdict;
- `planEditingDeferral(...)` is called with measured facts, and `surfaceData` is what the existing branches hand to the adapter;
- `drainCanvasDeferrals(path, why)` — one function, three exits: **blur** (`adapter.onEditingEnd`, delayed by `CANVAS_EDIT_DRAIN_DELAY_MS`), **view close** (before the adapter is dropped), **teardown** (`teardownCanvasPresences`, then `clearAll()`).

`main.ts` gains no `cloneCanvasRecords(`, no `createSurfaceShadow(`, no hand-rolled advance — WP5's structural oracle (`v2/wp5v2/test_tp07_wiring_only_visible.test.ts`) still passes untouched.

**`CANVAS_EDIT_DRAIN_DELAY_MS = 2500` is not cosmetic.** Draining immediately would re-commit the defect through WP37's own drain: at blur Obsidian first commits the editor text to its model and then saves, and `handleLocalModify` turns that save into the local capture. A drain that runs first would put the withheld REMOTE value on the surface, Obsidian would save *that*, and the just-typed characters would be gone.

### 2.4 `testing/e2e-control.ts` + `testing/canvas-node-editor.ts` — the instrument (AC6)

One new command, `canvas.typeInNode`, additive, on the `canvas.file` / `canvas.clearFlags` precedent. No existing command changed shape or behaviour. `canvas.simulateEdit` was not extended, not repaired and **not called by anything in this batch**.

---

## 3. AC-by-AC

### AC1 — `isBusy()` gains an editing signal; the drag watchdog is untouched ✅

**The four-row truth table, as executed** (`test_tp01_…`, each row its own test):

| # | drag | editing | `isBusy()` | also asserted |
|---|---|---|---|---|
| T1 | off | off | **false** | `getEditingNodeId() === null` |
| T2 | off | **ON** | **true** | `getEditingNodeId() === "n1"` |
| T3 | **ON** | off | **true** | `getEditingNodeId() === null` — a drag is never mistaken for an edit |
| T4 | **ON** | **ON** | **true** | releasing one arm leaves the other; releasing both gives `false` |

**T5 is the anti-vacuity control:** the same adapter, the same call, four alternating answers `[true, false, true, false]`. A predicate returning `true` unconditionally fails it.

**The staleness release, by injected clock, never a sleep:**

| test | measured |
|---|---|
| T6 | `EDIT_WATCHDOG_MS - 1` ⇒ still `true`; **+1 ms** ⇒ `false`, one `EDIT WATCHDOG:` warn, and **no** `DRAG WATCHDOG:` warn |
| T7 | five refreshes just inside the budget keep it alive; one full budget of silence releases |
| T8 | **the node leaves the canvas ⇒ released with NO clock advance at all** |
| T9 | all three releases (blur, timeout, liveness) fire the blur subscribers |
| T14 | `destroy()` releases and notifies — the teardown exit |

**The drag watchdog is unchanged, and it is asserted rather than asserted-about:**

- T11 freezes the injected clock at `0`; the drag flag is completely unaffected and `applyNodeGeometry` still returns `"interacting"` for the drag target.
- T12 pins `DRAG_WATCHDOG_MS === 5000` and that `EDIT_WATCHDOG_MS` is a separate, larger budget.
- T13: an editing session does **not** make a node a drag target — `applyNodeGeometry` returns `"applied"`, so the two flags provably never merged.

The `canvas-adapter.ts` drag-related diff is additive lines only; the pre-existing `dragActive()` / `isDragTarget()` bodies are unchanged. The full pre-existing adapter suite (`canvas-adapter.test.ts`, 42 tests) passes unmodified.

### AC2 — structural applies for the edited record are QUEUED, not dropped; every other record continues ✅

**Live, run `034946`:**

```
  PASS  S1: the typed characters SURVIVED in the typist's inline editor
        surface(c1)='card one-TYPED034946' source='editor'
  PASS  S1 (DISCRIMINATOR): the peer's change to card c2 IS visible on the typist's
        open canvas while the editor is focused
        surface(c2)='card two REMOTE034946' source='model'
```

**On the discriminating half, and the charter's expectation of it.** C37 AC2 says the "other card updates" half "must be shown to fail on the current behaviour". **It cannot, and reporting it as if it did would be a false green.** Pre-WP37 the gate is drag-only, so an unrelated card updates *and* destroys the editor — both halves pass for the wrong reason. The thing this half discriminates against is **the obvious wrong fix**: widen `isBusy()` and keep dropping the pass. That variant is what turns S1's discriminator red, and it is why the deferral is per record. Stated here rather than dressed up.

Headless: T7 asserts both halves in one decision — `c2` takes `"two REMOTE"` while `c1` keeps `"one"`.

### AC3 — remote changes appear after blur, no loss of locally typed characters ⚠️ PARTIAL, and the missing half is unsatisfiable in this batch

**The half that is DONE, and it is the owner's defect:**

```
  PASS  S2: THE CRITERION — the typed characters SURVIVED in the live editor
        surface(c1)='card one-MINE034946' source='editor'
  PASS  S2: after blur the typed characters are still on disk
        waited=0.0s file.c1='card one-MINE034946'
  PASS  S2: both peers converged on one value for the edited card
        A='card one-MINE034946' B='card one-MINE034946'
```

with its **recorded precondition**, which is what stops it being vacuous:

```
  PASS  S2 precondition (VACUITY GUARD): the typed characters are NOT yet in the
        typist's own .canvas file          marker='-MINE034946' present_in_file=False
```

and its proof that the characters were in the **editor**, not the model:

```
  PASS  S2 precondition: the characters reached the EDITOR, not the model
        textBefore='card one' textAfter='card one-MINE034946' textSource='editor' applied=True
```

**The half that is NOT done, and why it is not faked.** AC3's full form requires *both* markers present in the correct relative order after blur. **WP36 is not implemented** — card text is still a whole-string LWW register — so a positional merge is not representable and one marker must lose by construction. The charter says so itself (§5: *"Do not report AC3 green before WP36 is implemented, and do not weaken it to 'one marker survives' to get an earlier green"*).

So this batch reports what it can honestly claim: **the local user's characters are never lost**, which is the observable the owner reported. The remote peer's concurrent edit to the *same card* still loses under LWW. **AC3 is not green and must be re-run by whoever lands WP36.**

### AC4 — a deferred record's Surface-Shadow fields are not advanced ✅

The interlock is exercised through the **real** `buildApplyReceipt` / `advanceFromReceipt` seam, not by inspecting the decision, because AC4's vacuity clause names inspection-of-a-dropped-pass as the pre-WP37 behaviour.

**T17 — both halves in one pass:**

| | after a `substitute` pass |
|---|---|
| the deferred record `c1` | `"one"` — **its previous value**, not the remote one |
| the applied record `c2` | `"two REMOTE"` — **advanced**; this is the half that fails on a dropped pass |

**T18 — the drain-time advance, which is what makes it a deferral rather than a leak:** the same data re-run with the editor closed advances `c1` to `"one REMOTE"`. Unadvanced-then-never-advanced would pass T17 and fail T18.

The mechanism: `main.ts` builds the receipt from `surfaceData` — what was handed to the surface — so a substituted record advances to the values the surface really took (its own), and the remote values it did not take are the ones in the queue. **WP5 was not modified and did not need to learn that editing exists.** In the geometry branch a held record is given the pre-existing `"interacting"` outcome, which the existing `isConfirmed` already refuses to advance.

### AC5 — the queue is bounded, per record, and drained on blur, view close and teardown ✅

**Bounded, by driving a burst rather than reading a constant:**

| test | measured |
|---|---|
| T1 | **200** passes over one card ⇒ `pending === 1`, `passes === 200`, and the **last** value wins (a queue that coalesced to the first would be bounded and wrong) |
| T2 | 50 rounds × 3 cards ⇒ exactly **3** entries; the key is the record, not the pass |
| T3 | paths do not bleed; draining one leaves the other intact |

**The three exits, three separate tests over three different states** — because they differ in what still exists when they run:

| exit | the state that makes it distinct | measured |
|---|---|---|
| **blur** (T6) | the editor closes normally | drain fires, `pending === 0` |
| **watchdog-released blur** (T7) | the editor never closes; the budget expires | drain fires, `pending === 0` |
| **view close** (T8) | **the editor is still focused** — nothing would ever blur it | drained *before* the adapter is dropped; adapter gone; `paths() === []` |
| **teardown** (T9/T10) | **more than one path pending**, no per-path event to hang a drain on | every path drained, then `clearAll()`; `paths() === []` |

**Live confirmation of the drain, run `034946`:**

```
  PASS  S3: after the blur the new card IS on the typist's canvas (the queue drained)
        waited=3.0s live ids=['c1', 'c2', 'c3']
```

3.0 s is `CANVAS_EDIT_DRAIN_DELAY_MS` plus one poll — the drain, observably doing its job. On the **pre-WP37** tree the same assertion passed at `waited=0.0s`, because nothing was ever withheld; the discriminating fact is the first build, run `034401`, where it **failed at 40.3 s with `live ids=['c1','c2']`** — a withheld change that never drained. That failure is what produced `EDIT_POLL_MS`.

### AC6 — the instrument exists, drives the real editor, and returns measured facts ✅

**Shape:** `POST /command  {"cmd":"canvas.typeInNode","args":{...}}`

| arg | meaning |
|---|---|
| `path` | required, the `.canvas` path |
| `nodeId` | required |
| `text` | optional — characters inserted at the end of the card's current text |
| `blur` | optional — blur/commit after the insert (or on its own) |
| `open` | optional — open the canvas in a workspace leaf first |

**Every field of the response is read from the live surface at call time.** `applied` is `textAfter !== textBefore` over two reads — the exact field `canvas.simulateEdit` hardcodes.

```json
{ "ok": true, "path": "...", "nodeId": "c1",
  "canvasOpen": true, "opened": false, "nodeFound": true, "liveNodeIds": ["c1","c2"],
  "editingStarted": true, "editingReported": true, "surface": "node-editor",
  "focusTaken": true,
  "textBefore": "alpha", "textAfter": "alpha-LOCAL031340", "textSource": "editor",
  "applied": true, "inserted": "-LOCAL031340", "blurred": false,
  "probe": { "hasStartEditing": true, "hasNodeEl": true, "hasChild": true,
             "editorMembers": ["getValue","setValue","replaceSelection","setCursor","focus","blur"],
             "contenteditableFound": false } }
```

**The observable that proves it drove the EDITOR and not the file** — measured at that same moment, run `031340`:

```
  marker '-LOCAL031340' in canvas.file: False        <- the file does NOT have it
  ... after blur ...
  after blur: marker in canvas.file: True
  canvas.state: ... "text": "alpha-LOCAL031340" ...
```

**The two failure cases, both exercised live and both structured failures rather than successes:**

```
--- canvas not open in a leaf ---
{"ok": false, "error": "canvas-not-open", "canvasOpen": false, "applied": false,
 "reason": "no open canvas leaf is showing '_liveshare-test/wp37probe-031340.canvas'"}

--- node that does not exist ---
{"ok": false, "error": "node-not-found", "canvasOpen": true, "nodeFound": false,
 "liveNodeIds": ["p1","p2"], "applied": false,
 "reason": "the open canvas holds no node 'does-not-exist'"}
```

Both are also in the suite's preflight, so every WP37 run re-proves the instrument can fail.

**A zero-text, zero-blur call is a NON-INVASIVE READ** that takes no focus. That is load-bearing for the suite: it is the only way to look at card Y without stealing the editor from card X, i.e. without destroying the state under test. It reports `textSource` (`editor` / `model` / `dom`) so a read from the model can never be mistaken for a read from the editor.

**The driver cannot reach the doc or the file, asserted structurally** (T10–T12): zero imports of any kind, no `Y.`, no `getCanvasDocHandle`, no `transact(`, no `getMap(`, no `vault.create|modify|adapter`, no `requestSave`; no `applied: true` literal and no `return { ok: true` anywhere.

**A blur affordance is part of the same command** (`blur: true`), and it re-measures focus after blurring rather than assuming it.

**Structural note — the allow-list was respected, not amended.** `e2e-control.ts`'s static-import allow-list is frozen by WP49 AC4 / WP72 AC4. The driver is reached through a **dynamic** `import()`, which adds no specifier and no dependency, and its contract is mirrored structurally in `e2e-control.ts` on the precedent `StaleReconcileDecision` already sets there — so the compiler still checks the real return type at the call site. All three guard tests are green.

---

## 4. RED → GREEN, matched pair, same suite, same rig

Suite: **`H:\tmp\liveshare_wp37_e2e.py`**. Idempotent — per-run ids (`wp37-<RUN>-*`), both vaults swept at preflight and at teardown, SKIP counted as SKIP and never as PASS. **Role-independent by design:** it never restarts Obsidian, so S27's host-election lottery cannot reach it — and the two runs below in fact landed on opposite role assignments (`A=host` in the GREEN run, `A=guest` in the RED run) and agree anyway.

| | fix parked (run `035215`) | fix present (run `034946`) |
|---|---|---|
| **RESULT** | **29 passed, 5 failed** | **32 passed, 2 failed** |
| S2: the typed characters SURVIVED in the live editor | **FAIL** | **PASS** |
| S2: the VIEW still shows the locally typed text | **FAIL** | **PASS** |
| S2: after blur the typed characters are still on disk | **FAIL** | **PASS** |
| S1: characters survive an unrelated card's change | PASS | PASS |
| S1 DISCRIMINATOR: the unrelated card updates in the view | PASS | PASS |
| S3: characters survive a membership change | PASS | PASS |
| S3: the new card appears after blur (the drain) | PASS | PASS |
| S1 (pre-existing): the peer's `.canvas` **file** converges | **FAIL** | **FAIL** |
| S2 (pre-existing): the typist's `.canvas` **file** carries the peer's change | **FAIL** | **FAIL** |

The two failures that do not move are labelled **in the suite's own check names** as `(PRE-EXISTING, RED before WP37 too — carried up, not a WP37 verdict)`. They are left visible as FAILs rather than softened into SKIPs: the numbers stay honest and the label says whose they are. See §8, S28/S29.

---

## 5. Two false starts, both caught by measurement rather than by review

Recorded because each was a build that passed every headless test and did nothing on the product.

**1. Event-only focus detection (run `033302`) — deferred nothing.** `focusin` on `canvas.wrapperEl` misses the focus entirely, because the editor is focused before the adapter mounts. The signal had to become a **measurement taken on every consultation**. The suite caught it because the criterion is the editor's own text, not a log line and not a queue size.

**2. Detection fixed, blur still never noticed (run `034401`) — the queue never drained.** `S3: after the blur the new card IS on the typist's canvas` failed at **40.3 s** with `live ids=['c1','c2']`. The predicate was only consulted by a reconcile pass, and a pass only happens when a remote delta arrives. Fixed by `EDIT_POLL_MS`, armed only while an editing session is open.

Both are the same lesson: **a deferral is only as good as the signal that ends it**, and neither failure was visible to any headless test.

---

## 6. Test counts

| | before | after |
|---|---|---|
| unit tests | 2008 *(derived: 2076 − 68 new)* | **2076** |
| unit test files | 312 *(derived: 316 − 4 new)* | **316** |
| failures | 0 | **0** |

Measured by `npm test` from `plugin/` at the committed tree — `Test Files 316 passed (316)`,
`Tests 2076 passed (2076)`. The "before" row is derived arithmetic, not a second measurement,
and is labelled as such: the tree is shared with a sibling batch, so parking my four test files
to measure it would have been another shared-path revert (§11).
`npm run build` (tsc + esbuild) **exit 0**. `npm run build:e2e` produces a ~3.92 MB bundle.

**No existing test was deleted, weakened, retitled, skipped or amended. WP37 took no §7 licence of any class.** The three tests that assert `e2e-control.ts`'s frozen import allow-list are green **without the allow-list being touched** — see §3 AC6.

---

## 7. The constraint sheet, discharged

| constraint | status |
|---|---|
| the decision is headless; `main.ts` gains calls only | ✅ — `classifyBusyGate` / `planEditingDeferral` decide; WP5's structural oracle still passes |
| the drag watchdog, `DRAG_WATCHDOG_MS` and `isDragTarget` unchanged | ✅ — **quoted claim:** `DRAG_WATCHDOG_MS` is still `5000`, `dragActive()` and `isDragTarget()` bodies are unchanged, the `DRAG WATCHDOG:` signature is unchanged, and the injected clock is wired only into the editing arm (T11/T12/T13) |
| the editing signal has a bounded release with its own signature | ✅ — `EDIT WATCHDOG:`, two arms |
| `ReconcilePlan` keeps exactly three verdicts; `planReconcile` not made editing-aware | ✅ — `canvas/reconcile-plan.ts` is **byte-unchanged** |
| the deferral defers the VIEW apply only; the disk write is never deferred or suppressed | ✅ — no code in this WP touches any writer. (The disk file of an OPEN canvas does not converge from the doc on this build — pre-existing, S29.) |
| a deferred record's shadow fields are not advanced | ✅ — AC4 |
| the queue coalesces per record, is bounded, drained on three exits, asserted separately | ✅ — AC5 |
| the new E2E command drives the real editor, writes neither doc nor file, returns no literal | ✅ — AC6, asserted structurally |
| no `server/**` edit | ✅ — `git status` clean of `server/` |
| `useCanvasBinding` not flipped | ✅ — still `false` |
| `canvas/canvas-presence.ts` **byte-unchanged** | ✅ — `git diff --exit-code plugin/src/canvas/canvas-presence.ts` clean |
| the plugin version is not bumped | ✅ — still `0.6.1` |
| no new runtime dependency | ✅ — the new modules import only from within `plugin/src/`; the driver imports **nothing at all** |
| no `DONE` work package re-opened | ✅ |
| no `data.json` value read, printed, logged or fixtured | ✅ — §10 |
| `canvas.simulateEdit` not called | ✅ — it appears nowhere in this batch's suites or code paths |
| vault ports used | **39431 (A) / 39432 (B)** on every live run |

---

## 8. Found and NOT fixed

| # | Finding | Why not fixed here |
|---|---|---|
| **S28 (new)** | **`canvas.open` subscribes but never opens a leaf, so it never attaches the disk writer.** A peer driven only through `canvas.open` keeps its shared DOC converged while its `.canvas` file is never rewritten. This makes any file-level assertion on such a peer measure the rig, not the product. Worked around in this suite by opening a real leaf on both peers through the new command. | Rig honesty, adjacent to WP74/WP75. Changing `canvas.open`'s behaviour is forbidden to this WP. |
| **S29 (new)** | **The `.canvas` file of an OPEN canvas does not converge from the doc.** Measured: with the peer's change in the typist's doc for 25 s, the typist's file still did not carry it; the file only changed when Obsidian's own save ran. **C37 AC2 asserts the opposite** (*"A's `canvas.file` does already hold B's change"*), and the charter's safety argument for deferral — "the file stays converged while the view is deliberately stale" — therefore does **not** hold on this build. RED with the fix parked and with the fix present, so WP37 neither causes it nor worsens it. **This deserves a WP:** it is the property that makes every view-side deferral safe. |
| **S30 (new)** | **The canvas E2E suite is at 13/18 in this environment, and it is 13/18 with WP37 parked too**, with the identical five failures (`B received the move`, `B received the side-less edge`, `B received the empty card`, `host received the guest's node`, `the two replicas converged`). Cross-peer propagation is not flowing for that suite's long-lived shared canvas, whose state has accumulated across many runs. The WP37 suite's own boards propagate in ≤1 s in the same session, so it is specific to that canvas, not to sync generally. Baseline pair: run `035628` (fix present) and run `040835` (fix parked). | Not WP37's. Almost certainly the known non-idempotency of that suite compounding; it needs a clean-canvas re-run before anyone treats 19/19 as the current baseline. |
| **S31 (new)** | **A canvas node's editor is not reachable through a `contenteditable` selector** (`contenteditableFound: false` on every live probe), while `node.child.editor` exposes a full `getValue/setValue/replaceSelection/setCursor/focus/blur` surface. Anything that needs the live editor must go through the node, not the DOM. | Recorded for whoever builds on the instrument. |
| **S25** | `FileOpsManager.onFileCreate` is a fifth unguarded door onto `.canvas`. | Unowned, unchanged. Not touched here. The `skipsAutoTextSync` docstring's consumer list is still not exhaustive. |
| **S27** | The relay's host election is a coin flip across restarts. | Unchanged. Designed around: the WP37 suite never restarts Obsidian and is role-independent, and the two matched runs landed on **opposite** assignments and agreed. |
| **S26** | The debug logger stops silently mid-session. | Unchanged, and deliberately not relied on: no assertion in this batch reads a log. |

---

## 9. Files changed

| File | Change |
|---|---|
| `plugin/src/canvas/canvas-adapter.ts` | the editing signal, its two-armed bounded release, the widened `isBusy()`, `getEditingNodeId` / `getNodeFields` / `onEditingEnd` / `noteEditingFocus` (all optional), `EDIT_WATCHDOG_MS`, `EDIT_POLL_MS`, injected clock for the editing arm only |
| `plugin/src/canvas/canvas-editing-deferral.ts` | **new** — the headless decision, the coalescing per-record queue, `CANVAS_EDIT_DRAIN_DELAY_MS` |
| `plugin/src/main.ts` | wiring only: the gate verdict, the deferral call, `drainCanvasDeferrals` and its three exits |
| `plugin/src/testing/canvas-node-editor.ts` | **new** — the AC6 driver. Zero imports. |
| `plugin/src/testing/e2e-control.ts` | additive: the `canvas.typeInNode` case, the optional `typeInNode` host method, its structural contract mirror, and three guarded resolvers |
| `plugin/src/__tests__/v2/wp37/test_tp01_…` | **new** — 21 tests: the truth table, both releases, the drag-unchanged assertions, the pull probe |
| `plugin/src/__tests__/v2/wp37/test_tp02_…` | **new** — 21 tests: the gate, the decision, the shadow interlock through the real receipt seam |
| `plugin/src/__tests__/v2/wp37/test_tp03_…` | **new** — 11 tests: coalescing under a 200-pass burst, the three exits separately |
| `plugin/src/__tests__/v2/wp37/test_tp04_…` | **new** — 15 tests: the instrument's measured facts, both negative cases, the structural no-doc/no-file assertions |
| `H:\tmp\liveshare_wp37_e2e.py` | **new** — the deterministic reproduction, idempotent |
| `H:\tmp\liveshare_wp37_probe.py` · `H:\tmp\liveshare_wp37_diag.py` | **new** — the one-shot shape probe and the focus-retention diagnostic that produced §5 |

**Byte-unchanged, verified with `git diff --exit-code`:** `plugin/src/canvas/reconcile-plan.ts`, `plugin/src/canvas/canvas-shadow.ts`, `plugin/src/canvas/canvas-presence.ts`, `plugin/src/canvas/canvas-binding.ts`, `plugin/src/canvas/canvas-model-bridge.ts`, `plugin/src/files/**`, `plugin/src/types.ts`, `server/**`.

---

## 10. Data-safety statement

`data.json` values were never read, printed, logged, fixtured or committed — only key **names** appear anywhere in this batch. `sharedFolder` stayed `_liveshare-test` in both vaults throughout and was never set empty. No `.bak` or `.pre-v2-smoke` file was touched. Every artefact this batch created is namespaced `wp37-*` / `wp37probe-*` / `wp37diag-*` under `_liveshare-test/` and every one was swept. `obsidian-git` was left disabled. No `server/**` edit. `tools/obsidian_e2e/**` was not entered. Live runs used ports **39431 (A)** and **39432 (B)** only.

---

## 11. A process failure of mine, reported because it must be known

**I ran `git stash push` on `plugin/src/main.ts` and `plugin/src/canvas/canvas-adapter.ts` — shared paths — three times**, to measure the fix parked against the fix present. Each was followed by `git stash pop`.

The first of these is almost certainly the event WP81 observed as *"`main.ts` reverted in the shared tree, `canvas-adapter.ts` going clean in the same window"*. A stash is a revert as far as another agent's `git status` is concerned, and mine landed inside WP81's edit-to-stage window.

**Nothing was lost.** The `pop` reported `Auto-merging plugin/src/main.ts` and succeeded, and WP81's work is present in the tree: `main.ts` carries its `Notice` channel, and my diff against the current `HEAD` removes only my own targeted lines. Verified before every commit.

**It must not happen again, and the RED/GREEN comparison does not require it.** The correct instrument is a detached worktree at the parent commit — which the data-loss batch already used for exactly this purpose — and that is what the next batch needing a parked-fix baseline should use.

---

## 12. One note for whoever touches this next

**The editing signal must stay a PULL.** It looks like an event subscription and it is not: both `focusin` and a `contenteditable` selector fail on the live product, for different reasons, and each failure produces a build that passes every headless test and defers nothing. `node.isEditing`, read on every consultation, is the signal. The `EDIT_POLL_MS` timer is the other half — without it the blur is never noticed and the queue never drains. Neither is decoration; each was added after a live run measured its absence.
