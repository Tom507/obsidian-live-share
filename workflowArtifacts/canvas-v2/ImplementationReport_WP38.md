# Implementation Report — WP38: `Y.UndoManager`

**Batch:** B38 · **Worker:** 3 (Implementation) · **Mode:** autonomous
**Date:** 2026-08-05 · **Branch:** `fix-bugs-and-raceconditions`
**Charter:** `TaskCharter_WP38_UndoManager.md` (6 ACs)
**Commits:** `a1c435e` (the mechanism + 35 tests). The `main.ts` and
`testing/e2e-control.ts` hunks were **swept into a sibling's commits** — see §8.

---

## 0. Summary

| | |
|---|---|
| **AC status** | AC1 ✅ · AC2 ✅ · AC3 ✅ · AC4 ✅ · AC5 ✅ · AC6 ✅ |
| **Live acceptance** | **66 passed / 0 failed / 0 skipped / 2 notes** — `H:\tmp\liveshare_wp38_e2e.py`, run `122118`, two live Obsidian instances, ports 39431 (A) / 39432 (B) |
| **Roles RESUMED as (S37)** | live run: **A = host, B = guest**. The install two runs earlier resumed **A = guest, B = host** — opposite, so the coin flip was exercised in both directions during this batch. |
| **Unit suite** | **2471 / 2471 pass, 0 failed, 347 files** — `npx vitest run` from `plugin/`, measured **12:25–12:26**. Detached-worktree baseline at `05ac138`: **2383 / 2383, 0 failed, 342 files**, measured 11:47. |
| **`tsc`** | `npx tsc -noEmit -skipLibCheck` exit 0, run after every file creation, not at the end |
| **§7 licences** | **NONE, of any class.** No existing test was deleted, weakened, retitled, skipped or amended. **No inherited assertion reddened by the origin tag** — the pre-tag measurement in §1 predicted this and the suite confirmed it. |
| **`CAPTURE_OP` option taken** | **imported `CANVAS_BINDING_ORIGIN`.** `canvas-binding.ts` is **byte-unchanged** (§2.2). |
| **Does WP38 close the dropped-keystroke defect?** | **No. WP37 did.** No criterion here bears on it and nothing in this report claims otherwise. |

---

## 1. THE PRE-TAG ORIGIN MEASUREMENT — taken BEFORE the tag was written

The charter's sharpest instruction: measure whether any inherited assertion reads
a transaction origin **before** writing the tag, or the measurement is of my own
edit. This was the first thing done in this batch, on the unmodified tree, before
a single character of `canvas-sync.ts` moved.

**Patterns searched, and the tool** — `grep` (ripgrep) over `plugin/src`,
`--include=*.ts`, four passes:

| # | pattern | what it is for |
|---|---|---|
| P1 | `on("update"` | every update-handler that could receive an origin argument |
| P2 | `afterTransaction` | every transaction-level observer |
| P3 | `\.origin` | every read of a transaction's origin, anywhere |
| P4 | `origin` ∧ one of `toBeNull\|toBeUndefined\|=== null\|=== undefined\|!== null\|!== undefined\|toBe\(null\)\|toBe\(undefined\)\|== null` | the specific shape that tagging would redden |

**Rule 15 — each pattern proved able to match a known-present line before any
absence was reported:**

- P1 matched 40 sites including `sync/sync.ts:386`, `files/canvas-sidecar-lifecycle.ts:206`.
- P2 matched 21 sites including `files/canvas-sync.ts:2757`, `__tests__/canvas-persistence.test.ts:195`.
- P3 matched 21 sites including `canvas/canvas-binding.ts:210` and `:218`, and
  `__tests__/canvas-persistence.test.ts:193` (`origins.push(tr.origin)`).
- P4 returned **9 hits, none of them a Yjs origin** — all nine are
  `canvas-ingest-schema.ts`'s `invalid(<CODE>, origin)`, where `origin` is a
  **rejection-signature label** (`"local"` / `"remote"`), the same
  name-collision the charter warns about for `"capture-net"`. Recorded rather
  than glossed: a naive count would have called these nine assertions about
  transaction origins.

**Finding: no assertion and no consumer in the tree treats the capture
transaction's origin as `null` or `undefined`.** Every origin read in the tree is
a **positive identity test against a named symbol**:

| site | what it asserts / does | effect of a new named origin |
|---|---|---|
| `__tests__/canvas-persistence.test.ts:432-433` | `countWithOrigin(CANVAS_SEED_ORIGIN) === 0`, `countWithOrigin(CANVAS_MIGRATION_ORIGIN) === 1` | none — filters by identity |
| `__tests__/v2/wp24/test_tp05:118-119` | `origins[0] === SIDECAR_LOAD_ORIGIN` | none |
| `__tests__/v2/wp30/test_tp06:160` | `liveUpdateOrigins[0] === CANVAS_EPOCH_ADOPT_ORIGIN` | none |
| `__tests__/v2/wp28/test_tp03:166` | `filter(tr => tr.origin === CANVAS_EPOCH_ADOPT_ORIGIN)` | none |
| `__tests__/canvas-binding-capture.test.ts:82` | `origin === CANVAS_BINDING_ORIGIN` | none |
| `sync/sync.ts:379` (product) | `if (origin === this) return` — broadcast unless it is our own apply | none: a local capture is still broadcast, exactly as before |
| `files/canvas-sidecar-lifecycle.ts:194` (product) | `if (origin === SIDECAR_LOAD_ORIGIN) return` | none: the capture is still appended to the history, as before |
| `files/canvas-persistence.ts:238` (product) | documents that there is **no** origin filter on the disk writer | none |

**So the tag was predicted to be inert, and it is:** the full suite is
2471/2471 with the tag in place, and the pre-WP38 baseline in a detached
worktree is 2383/2383 — no assertion moved from green to red. **Nothing was
escalated because nothing reddened.** Had one, it would have been left red.

---

## 2. The mechanism

### 2.1 `canvas/canvas-undo.ts` — new, headless, the whole decision

Imports: `yjs` and `./canvas-binding` (whose own only import is `yjs`). Nothing
from Obsidian, the filesystem or a clock — the clock is **injected**.

**The origins this WP creates:**

```
CANVAS_CAPTURE_ORIGIN            Symbol("canvas-capture-origin")            — TRACKED
CANVAS_CAPTURE_MIGRATION_ORIGIN  Symbol("canvas-capture-migration-origin")  — NOT tracked
```

**THE ALLOW-LIST, as constructed, by contents:**

```
UNDO_TRACKED_ORIGINS = [ CANVAS_CAPTURE_ORIGIN, CANVAS_BINDING_ORIGIN ]
captureTimeout (Yjs)  = Infinity   — the boundary is owned here; see §2.4
captureTimeoutMs      = 500        — the boundary this module enforces
scope                 = [ "nodes", "edges", "deleted" ]
```

Read back **off the live instance**, not off the source, by the AC6 command:

```
trackedOrigins=['canvas-capture-origin', 'canvas-binding-origin']
captureTimeoutMs=500  scope=['nodes', 'edges', 'deleted']  managers=42
```

`Y.UndoManager` adds **itself** to `trackedOrigins` in its own constructor (so
that its undo/redo transactions land on the opposite stack). The headless
assertion accounts for that member explicitly rather than pretending it is not
there: `[...manager.trackedOrigins].filter(o => o !== manager)` has length 2 and
contains exactly the two symbols, and `manager.trackedOrigins.has(null)` is
`false`.

### 2.2 `CAPTURE_OP` — the option taken, and why

**Imported `CANVAS_BINDING_ORIGIN` from `canvas/canvas-binding.ts`.** Reasons:

1. It costs nothing structurally — `canvas-binding.ts:1` is its **only** import
   (`import * as Y from "yjs"`), so reaching it pulls in no dependency tree.
2. A P4-owned second symbol would have to be re-pointed in P5, and until then
   there would be **two** symbols naming one path — the shape that makes an
   allow-list stop being assertable.
3. Including an origin that cannot fire while `useCanvasBinding` is `false` is
   forward-correct and harmless, and P5 needs no change here.

**`plugin/src/canvas/canvas-binding.ts` is byte-unchanged.**
`git diff 05ac138..HEAD -- plugin/src/canvas/canvas-binding.ts` is empty, and so
is the file's entry in `git show --stat a1c435e` (it is not listed at all).

### 2.3 THE NEGATIVE ROW — a non-capture origin produces no undo step

Executed, per origin, each paired with a positive control **in the same
fixture** (`test_tp01`):

| transaction origin | undo steps produced | positive control in the same fixture |
|---|---|---|
| `CANVAS_SEED_ORIGIN` | **0** | same write under `CANVAS_CAPTURE_ORIGIN` → **1** |
| `CANVAS_IMPORT_SEED_ORIGIN` | **0** | → **1** |
| `CANVAS_MIGRATION_ORIGIN` | **0** | → **1** |
| `CANVAS_EPOCH_ADOPT_ORIGIN` | **0** | → **1** |
| `SIDECAR_LOAD_ORIGIN` | **0** | → **1** |
| `CANVAS_CAPTURE_MIGRATION_ORIGIN` | **0** | → **1** |
| **`null`** (untagged) | **0** | → **1** |
| `undefined` | **0** | → **1** |

The `null` row is the one that matters: it is exactly what the capture
transaction carried before this WP, and it is exactly what Yjs's default
`trackedOrigins` would have tracked. **The default would have been green today
by accident.** It is not used.

The remote arm is asserted through the real shape, not a sentinel: a second
`Y.Doc` is merged in with `Y.applyUpdate(doc, update, syncManager)` — the origin
`sync/sync.ts:530` uses — and the local stack does not grow (`test_tp02`).

### 2.4 The step boundary, and why the Yjs timeout is switched off rather than widened

`CanvasUndoRegistry.noteCapture(path, at)` is called by the capture path
**immediately before** the transaction opens (`stopCapturing()` has to be in
effect when Yjs's `afterTransaction` handler runs, or the boundary lands one step
late). If `at - lastCapture >= captureTimeoutMs` it calls `stopCapturing()`.

Yjs's own `captureTimeout` is set to `Infinity` **because** the boundary is owned
here: with the wall clock disabled, no behaviour of this registry depends on how
fast the host is, and AC4's two sides are a deterministic function of the
injected clock. This is deliberately **not** the vacuity AC4 names — that
vacuity is a module whose *own* separation threshold is infinite, so nothing is
ever separated. Here `captureTimeoutMs` is **500, finite, asserted by value**, and
both sides are executed:

```
inside the window   captures at t = 1000, 1100, 1200, 1300 (ms)  ->  1 step
                    one undo returns x: 40 -> 0
spanning the window captures at t = 1000, 1100, 1900, 2000 (ms)  ->  2 steps
                    first undo x: 40 -> 20, second undo x: 20 -> 0
multi-node          three cards in ONE transaction at t = 5000    ->  1 step
                    (deliberately far past the timeout: the collapse is
                     structural, not timing)
```

**No wall-clock sleep anywhere in the WP38 test files** (S56).

### 2.5 The tag, and what it did NOT change

`files/canvas-sync.ts`, the capture transaction (was `:3019`, a bare
`docHandle.doc.transact(fn)`; the charter's `:2819` had drifted by 200 lines —
re-measured per rule 12):

```ts
const captureOrigin = chooseCaptureOrigin(captureConvertsCollabText(collabTextTargets));
this.undoRegistry.noteCapture(path);
const applied = docHandle.doc.transact(
  () => this.applyIntentPlan(plan, maps, deletedMap, String(docHandle.doc.clientID)),
  captureOrigin,
);
```

`applyIntentPlan`'s body, its ops, their order and their content are **unchanged
character for character**. An origin rides on the transaction, not in the
document. What is added before it is a **read**: the stored value under every
collaborative-text field this pass is about to write. It has to be taken here
because a nested `doc.transact(fn, otherOrigin)` inside an already-open
transaction is **ignored by Yjs** — the outer origin wins — so the decision
cannot be taken at the write site.

---

## 3. AC5 — the conversion is outside the undo scope. Evidence.

### 3.1 The mechanism, in one line

A capture pass that will convert a plain-string `text`/`label` into a `Y.Text` is
tagged `CANVAS_CAPTURE_MIGRATION_ORIGIN`, which is not in the allow-list, so the
pass contributes **no undo step** and **no undo step can revert a conversion**.

The predicate is pure and mirrors `writeCollabText`'s own branch from the
outside: converts iff the stored value is `undefined` **or** a `string`; a
`Y.Text` merges in place, and anything else takes the pre-WP36 register write.
Only an **existing** record is probed — a record the pass creates is built
detached by `buildDetachedRecord` and never reaches `writeCollabText`, so
creating a card keeps a plain string and stays a normal, undoable step.

### 3.2 Headless (`test_tp02`, through the real `handleLocalModify` path)

```
before the converting save   doc holds a plain string, undo depth 0
after  the converting save   doc holds a Y.Text("AliceX"), undo depth 0   <- CRITERION
the NEXT save (same fixture) undo depth 1                                 <- DISCRIMINATOR
undoing that step            field is still a Y.Text, content "AliceX",
                             length > 0, key present
```

The discriminator is the charter's own requirement and it is executed: *"the
same fixture produces a normal undo step for a normal edit"*, which excludes an
empty stack for the wrong reason (manager never constructed, wrong doc, nothing
tracked).

And the live half, which the charter says is the one that matters:

```
peer's characters merged into the converted Y.Text, then a local undo:
  A saved 'Zcollab', B saved 'collabP'   (neither file held the other's marker)
  merged on BOTH peers    A.text='ZcollabP'  B.text='ZcollabP'
  A undoes                popped=True  depth 2 -> 1
  A.text='collabP'   B.text='collabP'   shape=ytext on both, length 7
```

**My character is gone; the peer's survives, on both vaults.** A tracked
conversion would have restored the pre-conversion plain string `"collab"` and
destroyed `P` with it — the AC2 violation reached through a path AC2's own
scenario does not exercise.

### 3.3 The COST of this choice, stated rather than hidden

**A converting pass is untracked in its entirety**, including anything else that
pass captured. In steady state that is one save per field per record — the first
edit that touches a card's text — because a warm Surface-Shadow discards
restated fields and only genuinely changed fields become upserts.

**It is broader than that when the shadow is cold**, and this was measured, not
reasoned: with `warm=False` and a two-card board, run 4 of the live suite made
`c2`'s never-captured `text` an upsert too, so the whole pass converted and no
undo step was produced for a change that had nothing to do with `c2`. The live
scenario was narrowed to a one-card board to isolate the criterion, and the
breadth is recorded here as the real cost.

**Why this and not the alternative.** Hoisting the conversion into its own
earlier untracked transaction would keep the rest of the pass undoable, but it
splits WP36's single `set(field, new Y.Text(start + ops))` into a `set` of the
pre-edit string plus character ops. That changes what a capture **writes**, which
§2 puts out of scope, and it would redden WP36's landed assertions in two
places: the `record.observe` tripwire's *"the observed value at the key's first
event is already the full content"*, and `TextWriteReceipt.migrated`, which would
become `false` at the write site. Both are ESCALATE territory, not a licence.
**The narrow, inert choice was taken and its cost is named.**

---

## 4. AC-by-AC, with the live output

Live acceptance suite `H:\tmp\liveshare_wp38_e2e.py`, run `122118`, ports
**39431 (A)** and **39432 (B)**, **A = host, B = guest** (resumed as; S37).
Idempotent: per-run board ids `wp38-<RUN>-*`, both vaults swept at preflight and
teardown (18 boards swept at teardown). **`canvas.simulateEdit` is not called
anywhere in the suite.**

### AC1 — one manager per client and canvas doc, explicit allow-list, destroyed with its doc ✅

```
PASS  S1 (AC1): trackedOrigins is an EXPLICIT named allow-list, by contents - not {null}
      trackedOrigins=['canvas-capture-origin', 'canvas-binding-origin']
      captureTimeoutMs=500 scope=['nodes', 'edges', 'deleted'] managers=42

PASS  S6: the undo acted on board 1 - the instrument reports WHICH board
PASS  S6: the registry holds a manager per subscribed canvas doc   managers=51
PASS  S6 (THE CRITERION, on A): board 1 reverted, board 2 UNCHANGED  A.p1.x=0 A.p2.x=400
PASS  S6 (THE CRITERION, on B): board 1 reverted, board 2 UNCHANGED  B.p1.x=0 B.p2.x=400
```

Headless conjuncts: two canvases yield two distinct managers whose stacks do not
interact; a second `attach` for the same path returns the **same** manager, never
a second stack; `detach` destroys it, and a further capture on the doc it was
bound to does **not** move its depth — stated as *"the depth did not move"*
rather than *"the depth is zero"*, because `Y.UndoManager.destroy()` detaches the
handler without clearing the stack it already held, and asserting zero would have
been asserting Yjs's cleanup rather than this WP's detachment. It carries its own
positive control: a still-attached manager over the **same doc** does grow on the
same write shape. An undo aimed at a detached path is a named refusal
(`"no undo manager for this canvas"`), not a crash.

Through the real path: `CanvasSync.subscribe` attaches, `unsubscribe` detaches
(registry size 1 → 0), `destroy` releases every manager.

### AC2 — undo reverts only this client's own last action ✅

The **same record, different field** run — the one a coarse implementation fails:

```
PASS  S2 precondition 1: A's own change landed on BOTH        A.x=400 B.x=400
PASS  S2 precondition 2: the PEER's change to the SAME record reached A   A.color=5
PASS  S2: A's undo popped a step                              before=2 after=1
PASS  S2 (THE CRITERION, on A): my field is back AND the peer's field is untouched
      A.x=0 A.color=5
PASS  S2 (THE CRITERION, on B - the peer's OWN vault): same, on the other side
      waited=1.0s B.x=0 B.color=5
PASS  S2: A's .canvas FILE carries the peer's field and not my undone one
      waited=0.0s A.file peer_field=True mine_undone=False
NOTE  S2: B's .canvas FILE does not carry the converged value - WP85 class, not WP38's
```

And the different-record run, also read on **both** ports:

```
PASS  S2b (THE CRITERION, on A): c1 reverted, the peer's c2 kept its value  A.c1.x=0 A.c2.y=777
PASS  S2b (THE CRITERION, on B): c1 reverted, the peer's c2 kept its value  B.c1.x=0 B.c2.y=777
```

Readings are from `canvas.state` on both ports and `canvas.file` on both. The one
`.canvas`-file reading that does not converge is the **peer's** file, which is the
WP85 class (a `.canvas` does not converge from the doc); it is labelled in the
suite's own output as not WP38's and is not counted as a pass.

### AC3 — undo of a delete restores through the tombstone flag, losslessly ✅

Fixture: a card carrying **six** distinct values, plus an edge whose endpoint it
is. Every field compared **individually**, on **both** vaults:

```
PASS  S3 precondition: the card carries SEVERAL distinct field values
      {"id":"c1","type":"text","x":10,"y":4,"width":321,"height":111,"color":"6","text":"delete me"}
PASS  S3 precondition: the edge whose endpoint it is exists on BOTH  A.edges=['e1'] B.edges=['e1']
PASS  S3: after quiescence the card is GONE from canvas.state on BOTH   waited=1.0s
PASS  S3: and gone from canvas.file on A
NOTE  S3: B's .canvas still holds the card - WP85 class (the file does not converge)
PASS  S3: A's undo popped a step                                       before=2 after=1
PASS  S3 (THE CRITERION): the card REAPPEARS on BOTH vaults
PASS  S3 (A) field 'text'   A.text='delete me'   PASS  S3 (B) field 'text'   B.text='delete me'
PASS  S3 (A) field 'color'  A.color='6'          PASS  S3 (B) field 'color'  B.color='6'
PASS  S3 (A) field 'width'  A.width=321          PASS  S3 (B) field 'width'  B.width=321
PASS  S3 (A) field 'height' A.height=111         PASS  S3 (B) field 'height' B.height=111
PASS  S3 (A) field 'x'      A.x=10               PASS  S3 (B) field 'x'      B.x=10
PASS  S3 (A) field 'type'   A.type='text'        PASS  S3 (B) field 'type'   B.type='text'
PASS  S3: the edge whose endpoint it was reappears WITH it, on both
      (the WP19 cascade in reverse - suppression is a projection, not a deletion)
      A.edges=['e1'] B.edges=['e1']
```

**The restore went through the tombstone flag, asserted structurally** and not
inferred (`test_tp02`):

- the record's `Y.Map` is **the same object** before the delete, during the
  delete and after the undo (`expect(nodes.get("c1")).toBe(identityBefore)`);
- a `nodes.observe` tripwire over the whole delete-and-undo cycle records
  **zero** key events on the record collection — so **no `set(id, …)` of any
  kind was issued for that id**, and in particular no `set(id, new Y.Map())`;
- the record's own entries serialise byte-identically either side of the cycle.

### AC4 — a drag burst is one step, a multi-node drag is one step ✅

Headless with the injected clock, both sides of the timeout — §2.4. Live:

```
PASS  S4 precondition: all three moved cards reached the peer
PASS  S4: exactly ONE step was popped for the three-card write   before=2 after=1
PASS  S4 (THE CRITERION): ONE undo returned ALL THREE cards on A
      c1.x=0 c2.x=600 c3.x=1200
PASS  S4: and all three on B
```

### AC5 — undo does not cross the conversion ✅

§3, and live:

```
PASS  S5a baseline: the stack is EMPTY before the converting save
      (so `no step` below cannot be empty for the wrong reason)   before=0 popped=False
PASS  S5a precondition: before any text capture the field is a PLAIN STRING
      (the migration is lazy - there is no bulk pass)             shape=string
PASS  S5a precondition: the converting edit reached the peer      B.text='AliceX'
PASS  S5a precondition: the field IS a Y.Text on both             A=ytext B=ytext
PASS  S5a (THE CRITERION): the CONVERTING pass produced NO undo step
      before=0 popped=False outcome={"seq":35,...,"reason":"empty stack","popped":false,
      "changed":false,"undoDepthBefore":0,"undoDepthAfter":0}
PASS  S5a: and the conversion was NOT reverted - still a Y.Text holding its content
      shape=ytext text='AliceX'
```

plus the peer-characters half quoted in §3.2.

### AC6 — the instrument exists and returns measured facts ✅

New E2E control command **`canvas.undo`**, additive: one `case`, one optional
host method, on the `canvas.textShape` / `canvas.editingSignal` precedent.

**It is not the `simulateEdit` shape, and the difference is structural:**

- it takes **no path** — the registered command resolves the canvas in context
  for itself, and a path argument would let the instrument report the depths of a
  manager the command never touched;
- it **invokes the registered Obsidian command** via
  `app.commands.executeCommandById`, with the full id **measured against the
  registry** rather than assembled from a guessed manifest id, and the id it used
  is reported;
- it reaches the command ids by a **dynamic call** into `canvas/canvas-undo.ts`
  — the frozen import allow-list (`node:http`, `node:crypto`, `yjs`,
  `../canvas/canvas-binding`, `../utils`) is **not amended**, and no comment in
  the file quotes an import statement (the regex those three tests use reads
  comments; that trap is named in the file for the next editor without
  reproducing it);
- **there is no `Y.Doc` in the method** — no `getCanvasDocHandle`, no
  `doc.transact`, no `UndoManager`, no vault write. It cannot undo anything even
  by accident;
- every number it returns is a **difference between two readings of the
  production undo registry** taken either side of the invocation, and it carries
  the mechanism's **own receipt** with its own `seq` as a second, independent
  witness.

**THE EMPTY-STACK CASE — mandatory, and it is live:**

```
[S1] drained 0 pre-existing step(s) on A
PASS  S1: the instrument INVOKED a REGISTERED command, by an id it MEASURED
      commandId=live-share:undo-canvas-change invoked=True
PASS  S1: it resolved the board this scenario meant, not another one
PASS  S1 (THE CRITERION): an EMPTY stack reports NO STEP POPPED and depth 0 -> 0
      before=0 after=0 popped=False
      outcome={"seq":40,...,"reason":"empty stack","popped":false,"changed":false,
               "undoDepthBefore":0,"undoDepthAfter":0}
PASS  S1: and the canvas is UNCHANGED by that call
```

and, in the **same fixture**, the discriminator a literal cannot fake:

```
PASS  S1 (THE DISCRIMINATOR): the SAME instrument now reports a step POPPED, n -> n-1
      before=1 after=0 popped=True outcome={"seq":41,...,"popped":true,"changed":true}
PASS  S1: the change is REVERTED in canvas.state on A            A.x=0
PASS  S1: the change is REVERTED in canvas.file on A             waited=1.0s
PASS  S1: the undo REACHED THE PEER (an undo is an ordinary CRDT delta)   B.x=0
```

The command's `checkCallback` guards on *"is there a canvas in context whose undo
history this client owns?"* — deliberately **not** *"is there a step?"*. The
second question is the one the invocation answers, and it has to stay free to
answer "no": an empty stack must reach the mechanism and come back with a
measured `0 → 0`, which is precisely what the empty-stack row above shows.

`redo` rides the same command (`{redo: true}`) and reports the redo depths.
Non-boolean `redo` is refused at the command boundary.

---

## 5. Suite numbers, and when

| | |
|---|---|
| **This tree, final** | **2471 tests, 2471 passed, 0 failed, 347 files** — `npx vitest run` from `plugin/`, **12:25–12:26** |
| **Baseline, detached worktree at `05ac138`** | **2383 tests, 2383 passed, 0 failed, 342 files** — 11:47. Two suites could not load (`Cannot find package 'cors'` — a worktree has no `server/node_modules`); that is an artefact, not a result. |
| **Arithmetic, closed** | baseline 2383 + 52 (the two unloadable suites + the sibling WP87's two files) = 2435; + 35 (WP38) = **2470**, which is what this tree measured at 11:45. WP87 landed one more test afterwards → 2471. |
| **`tsc`** | `npx tsc -noEmit -skipLibCheck` exit 0, run **immediately after each file was created**, never only at the end |
| **`npm run build`** | **deliberately NOT run as a gate.** It runs `esbuild.config.mjs production` and overwrites the shared, contended `plugin/main.js`. `npm run build:e2e` was run once, deliberately, to produce the rig's bundle (§7). |

**One intermittent failure, reported rather than smoothed:** the 12:24 run
reported `1 failed` out of 2471. Two subsequent full runs (12:25 and the one
between) were 2471/2471 with no `FAIL` line, and the name was not captured before
it went green. No WP38 file is timing-dependent — WP38's clock is injected and
its tests contain no sleep — and the suite's one wall-clock-bound file is
`wp5/latency.test.ts` (a 33.5 s idle window). Recorded as unattributed.

---

## 6. The constraint sheet, discharged

| constraint | status |
|---|---|
| `trackedOrigins` is an explicit named allow-list, never the Yjs default | ✅ §2.1, asserted by contents + 8 negative rows with positive controls |
| `canvas-binding.ts` byte-unchanged; `CANVAS_BINDING_ORIGIN` imported, not edited | ✅ `git diff 05ac138..HEAD` empty; not in `a1c435e`'s file list |
| tagging the capture transaction changes no op, no value and no order | ✅ `applyIntentPlan` unchanged; the diff adds a pre-read and an origin argument |
| no undo step reverts a `text` → `Y.Text` conversion | ✅ §3, headless + live, with the discriminator |
| an undone delete restores through the tombstone flag; no record re-created | ✅ AC3: `Y.Map` identity preserved, `nodes.observe` tripwire zero key events |
| a manager is destroyed with its doc | ✅ AC1, with a positive control for the detachment |
| the E2E command invokes the real command, manipulates no `Y.Doc`, returns no literal; empty stack exercised | ✅ AC6 |
| the undo decision is headless; `main.ts` gains calls and a command registration only | ✅ three thin members in `main.ts` (path resolution + hand-off), two `addCommand` blocks in `session/commands.ts`; all stack arithmetic, scope and origin live in `canvas/canvas-undo.ts` |
| no `server/**` edit · `useCanvasBinding` not flipped · `canvas-presence.ts` byte-unchanged · version not bumped | ✅ |
| `canvas-persistence.ts`, `manifest-purge-decision.ts`, `__tests__/dataloss/**` untouched | ✅ |
| `BUILD_SPEC_CanvasV2.md` not edited · `WORKFLOW_ANALYSIS.md` not touched | ✅ |
| no `DONE` WP re-opened; **no §7 licence of any class** | ✅ nothing reddened |
| `canvas.simulateEdit` not called | ✅ it appears nowhere in this batch's suite or tests |
| no wall-clock sleep standing in for a wait (S56) | ✅ every wait in the live suite is `wait_for(condition, budget)`; the only bare sleeps are settling delays after a file write, and none of them stands in for an assertion |

---

## 7. The bundle, and the S46 record

| | |
|---|---|
| built | `npm run build:e2e` (never `npm run build`) at 12:00 |
| bundle | **4 489 627 B**, sha256 `ae1adefbc11ffe78aa08234947e654cab754cc7de29beedfeb07eeac0c425a68` |
| installed | with `LS_EXPECT_SHA256` set to that digest; the installer verified the landed bytes in **both** vaults |
| marker check on the **installed** bytes | `canvas-capture-origin` ×1, `undo-canvas-change` ×1, `canvas.undo` ×2 — **in both vaults**. A digest proves *which* build; the marker proves *whose*. |
| **caveat, stated** | the bundle also contains the sibling WP87's work, which was uncommitted in the shared tree at build time. That is the S46 hazard in its ordinary form and it is recorded rather than tidied away. |
| **`plugin/main.js` right now** | **4 493 887 B**, sha256 `5fd6a908e9fe7f2b646c355644619b93a4d7874bc21a636f9efefb45830892cb` — **not** the bundle this run measured. A sibling rebuilt it after the live run. Anyone installing must set `LS_EXPECT_SHA256` and grep for their own marker. |

---

## 8. Found, and carried up

| # | finding | disposition |
|---|---|---|
| **S57 (new)** | **A live instance answered `unknown cmd: canvas.undo` from one port for the first two scenarios of a run and answered normally for the remaining four**, with no restart in between and with the installer having verified the bytes on disk in both vaults minutes earlier. **"The installer verified the bytes" is not evidence that the LOADED plugin is those bytes.** Not reproduced since; cause unidentified. Mitigated in the suite by a preflight gate on the S47 pattern — `canvas.undo` must route and report a `commandId` on **both** ports or the suite refuses to measure. **Unowned.** | recorded; the gate is in `H:\tmp\liveshare_wp38_e2e.py` |
| **process** | **My `main.ts` and `testing/e2e-control.ts` hunks were committed under a sibling's commits** (`012f896`, `dc1abc0`, WP87) while this batch was mid-run. Nothing was lost — the whole WP38 is in `HEAD` — but the archaeology is split: `a1c435e` carries `canvas-undo.ts`, `canvas-sync.ts`, `session/commands.ts` and the three test files; WP87's commits carry the `main.ts` and `e2e-control.ts` wiring. This is the exact mirror of what WP36 reported happening to it. **No revert was performed by this batch on any shared path (rule 14 honoured).** | reported |
| **AC5's cost** | a converting pass is untracked in its entirety, and with a **cold** Surface-Shadow that can be a whole board's first save rather than one field. §3.3. Bounded, one-time per field per record in steady state. A finer split is possible but changes what a capture writes and would redden two of WP36's landed assertions. | recorded, not taken |
| **WP36's `fallback-replace`, re-confirmed live** | two clients contributing at the **same offset** produce an ambiguous overlap, and the merge resolves it by a whole-value replace that destroys the peer's character *before any undo runs*. Measured in run 4 of this suite (`A.text='AliceXZ'`, the peer's `P` gone). **WP36's documented known limit, not WP38's** — the live scenario was moved to disjoint offsets so that it measures undo rather than the merge. | WP36's; unchanged |
| **WP85 class, twice** | the **peer's** `.canvas` file does not converge from the doc (S2, S3). Labelled as such in the suite's own output and counted as a NOTE, never as a pass. | WP85's |
| **rig** | `H:\tmp\liveshare_wp38_e2e.py` is new, idempotent, and is the WP38 acceptance instrument. Two probe calls made during debugging popped one step on the pre-existing `_liveshare-test/smoke.canvas` (a Dispatcher-seeded disposable fixture, 2 → 1). Recorded so nobody attributes that state to something else. | reported |
| **charter line drift** | the capture transaction is at `canvas-sync.ts:3019` in the current tree, not `:2819` — 200 lines. Rule 5 again: a line number is a measurement, not a name. The statement at that line was exactly as the charter described it. | corrected here |
| **`console runtime`** | a `visible-console` run died mid-suite with `[WinError 5] … status.json.tmp -> status.json` and killed the python process with it. Worked around by teeing the suite's output to a file. **Unowned.** | reported |

---

## 9. Files changed

| file | change |
|---|---|
| `plugin/src/canvas/canvas-undo.ts` | **new** — the two origins, the allow-list, the conversion predicate, the origin decision, `CanvasUndoRegistry` (attach / noteCapture / undo / redo / report / detach / destroy), the command ids. Imports `yjs` and `./canvas-binding` only. |
| `plugin/src/files/canvas-sync.ts` | the origin tag on the capture transaction, the pre-transaction collab-text probe, the step-boundary call, and the registry's lifecycle in `subscribe` / `unsubscribe` / `destroy` + two accessors |
| `plugin/src/session/commands.ts` | two `addCommand` blocks, no default hotkey, `checkCallback` guarded on availability — **not** on stack depth |
| `plugin/src/main.ts` | wiring only: `canvasUndoReport`, `runCanvasUndo`, `canvasUndoLastOutcome`, `canvasUndoAvailable` — path resolution through the ONE existing "canvas in context" definer, and a hand-off. No stack arithmetic, no origin, no scope. |
| `plugin/src/testing/e2e-control.ts` | additive `canvas.undo` case + optional host method + two structural mirrors + `app.commands` declaration + one guarded registry resolver |
| `plugin/src/__tests__/v2/wp38/test_tp01_…` | **new** — 18 tests: the allow-list by contents, 8 negative rows each with a positive control, per-doc independence, destruction with its control, both sides of the capture timeout, the multi-node collapse, the conversion predicate, the empty stack |
| `plugin/src/__tests__/v2/wp38/test_tp02_…` | **new** — 9 tests: undo through the real capture path — the seed is not undoable, AC2 both shapes with a real `Y.applyUpdate` peer, AC3 with the `Y.Map` identity and the `observe` tripwire, AC5 with its discriminator and the peer-characters case |
| `plugin/src/__tests__/v2/wp38/test_tp03_…` | **new** — 8 tests: the instrument at `routeCommand` level over a real registry and a real dispatch table — id discovery, the empty-stack case, the pop case, redo, the scope readout, two boundary refusals |
| `H:\tmp\liveshare_wp38_e2e.py` | **new** — the live acceptance suite, idempotent, 66 checks |

---

## 10. Data-safety statement

No `data.json` value was read, printed, logged, echoed into this report, placed
in a fixture or committed — only the key name `e2eControlPort` appears, and only
inside the pre-existing installer. `sharedFolder` stayed `_liveshare-test` in
both vaults throughout and was never set empty. WP88's `.wp88-b34.*` backups were
not touched. No `server/**` edit. No secret passed through any agent tool. Every
board this batch created is namespaced `wp38-*` under `_liveshare-test/` and
every one was swept at teardown (18 at the final run). Live runs used ports
**39431 (A)** and **39432 (B)** only.

---

## 11. One note for whoever touches this next

**The origin decision has to be taken before the transaction opens, and that is
not a style choice.** A nested `doc.transact(fn, otherOrigin)` inside an
already-open transaction is silently ignored by Yjs — the outer origin wins and
no error is raised. So "tag the conversion differently at the write site" reads
like the obvious implementation of AC5, compiles, runs, and does nothing at all:
the conversion stays tracked, every headless test still passes, and the first
peer to merge a character into a converted `Y.Text` loses it to somebody else's
`Ctrl+Z`. The whole reason the pre-transaction probe exists — reading the stored
value of every collaborative-text field the pass is about to write — is that it
is the only place the decision can still be made.
