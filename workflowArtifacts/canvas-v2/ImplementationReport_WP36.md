# Implementation Report — WP36: `Y.Text` node text and edge labels

**Batch:** B29 · **Worker:** 3 (Implementation) · **Mode:** autonomous
**Date:** 2026-08-05 · **Branch:** `fix-bugs-and-raceconditions` · **Commit:** `3ebd35c`
**Charter:** `TaskCharter_WP36_YTextNodeText.md` (5 ACs)

---

## 0. Summary

| | |
|---|---|
| **Reproduced first?** | **Yes.** On the pre-WP36 baseline the peer's character is destroyed on demand: `A.state='AliceXBob'` where the doc had held `'AliceYBob'`. |
| **RED → GREEN, same suite, same rig, OPPOSITE host roles** | `H:\tmp\liveshare_wp36_e2e.py`: **36 passed / 23 failed / 1 skipped** (baseline `affff5f`, A=host B=guest) → **63 passed / 11 failed / 0 skipped** (this tree, A=guest B=host) |
| **AC status** | AC1 ✅ · AC2 ✅ · AC3 ✅ *(file-driven, as chartered)* · AC4 ✅ · AC5 ✅ |
| **WP37 AC3's positional half** | **Satisfiable at the layer WP36 owns — measured, not asserted.** Two concurrent edits to the same card now both survive, positionally, on both peers. **Through two LIVE inline editors it is still not observable**, and the reason is measured and attributed: the second typist's peer produces **zero** text captures. See §5. |
| **Unit suite** | **2318 / 2331 pass, 13 failed, 333 files.** Baseline at `affff5f` in a detached worktree: **2157 / 2157, 0 failed**. |
| **`npm run build`** | tsc + esbuild, **exit 0** |
| **§7 licences taken** | **NONE, of any class.** No existing test was deleted, weakened, retitled, skipped or amended. The 13 reddened inherited assertions are an **ESCALATE**, left red — §7. |
| **Position-resolution design** | **(a) CONTEXT-ANCHORED.** No `Y.RelativePosition` anchors exist anywhere. **Fallback count across every live run: 0** (of 45 receipts in the largest scenario). |

---

## 1. The mechanism

### 1.1 `canvas/canvas-text-merge.ts` — the three-way merge, pure, zero imports

The precedent is `canvas/reconcile-plan.ts`: no Obsidian, no filesystem, no clock, **no Yjs**. It
decides *which ops* a capture must emit; `canvas-sync.ts` emits them. That split is what makes the
position arithmetic testable at all — it is a pure function of three strings.

```
planTextMerge(base, next, current) -> { ops, resolution, fallback, result }
```

| operand | what it is |
|---|---|
| `base` | the **Surface-Shadow's** value — "what this client last confirmed is on the surface". `undefined` = never observed. |
| `next` | what the local `.canvas` file now holds — **the local intent** |
| `current` | what the `Y.Text` holds right now, **peers included** |

`base -> next` is what the local user did. `base -> current` is what the peers did. **Only the first
is intent**, and that is the whole difference from the two-way helper.

**Position resolution — design (a), context-anchored, and the anchoring is total by construction.**
Both change regions are computed in the same (base) coordinate system and compared:

| case | resolution | rule |
|---|---|---|
| `current === next` | `converged` | the doc already holds what the file holds — **zero ops is provably correct** |
| `base === next` | `identical` | the local user changed nothing |
| `current === base` | `exact` | nobody else touched it; base offsets hold |
| local region entirely **before** the peers' | `disjoint-before` | offsets unchanged |
| local region entirely **after** the peers' | `disjoint-after` | offsets shifted by the peers' net length delta |
| regions **overlap**, deleted text found once | `overlap-anchored` | delete *there*, insert *there* |
| regions **overlap**, deleted text already gone | `overlap-delete-already-applied` | **delete NOTHING**, insert only |
| regions overlap, deleted text occurs **twice** in the peers' span | `fallback-replace` | ambiguous — **do not guess**, whole-value replace, **counted** |
| `base === undefined` | `no-base-insert-only` | no third operand ⇒ **never delete**; contribute insertions only |

`overlap-delete-already-applied` is C36 AC3's second sentence stated as code: *a character the peers
already removed is not deleted again, and a character the peers ADDED is never deleted at all.*

**The `converged` branch is not an optimisation.** A stale base makes an already-landed local edit
look like a fresh one: base `"Alice"`, save `"AliceBob"`, doc `"AliceBob"` would otherwise read as
"insert Bob" against a doc that already has it, and the card would become `"AliceBobBob"`. It is
asserted by its own test.

The surrogate-pair boundary rule is **re-implemented** here (the charter permits it explicitly);
`utils.ts` is byte-unchanged and is neither called nor imported.

### 1.2 `files/canvas-sync.ts` — the write router, the migration, the projection render

**The router** sits in `applyIntentPlan`, **before** the equality question:

```ts
if (isCollabTextField(upsert.field) && typeof upsert.value === "string") {
  applied.textWrites.push(this.writeCollabText(existing, path, kind, id, upsert.field, upsert.value));
  applied.upserts.push(upsert);
  continue;
}
if (!docValueEquals(existing.get(upsert.field), upsert.value)) existing.set(upsert.field, upsert.value);
```

`docValueEquals` is **not** widened — the charter's §7 clause 4. It is a value-equality predicate
shared with `upsertRecordFields`, and a `Y.Text` arm there would make real edits silently skip. The
correct shape is a **routing** decision, and it means no capture path can overwrite a `Y.Text` with a
plain value.

**The base is read inside the transaction**, from `getField(this.shadow, path, kind, id, field)`.
That is sound and deliberate: the shadow is only advanced *after* `applyIntentPlan` returns, so at
the write site it still holds the pre-capture value — which is exactly the three-way base. No new
state store, no snapshot, no relative-position index.

**The migration** is lazy, write-triggered and **ONE operation**:

```ts
const converted = new Y.Text(start);   // populated while DETACHED (Yjs queues and replays at integration)
applyTextOpsToYText(converted, plan.ops);
record.set(field, converted);          // ONE set of an ALREADY-POPULATED Y.Text
```

So the key is never deleted, never absent for an instant, and no empty `Y.Text` is ever attached and
filled afterwards. That is what keeps it off the Ä4 shape. There is **no bulk pass**: a record the
local user did not edit is never converted (asserted live *and* headlessly).

**The projection render** is explicit, in `toCanonicalFileRecord`:

```ts
raw[key] = renderDocValue(value);   // Y.Text -> value.toString(); everything else byte-identical
```

`buildCanvasData` has **four** consumers, not one: `serializeCanvas` (disk), `reconcileLiveCanvas`
(the **open Obsidian view**), `getCanvasSnapshot` (`canvas.state`) and `buildApplyReceipt` →
`advanceFromReceipt` (**the Surface-Shadow**). `JSON.stringify` would make two of those right by
accident and hide the other two. §4 shows both hidden ones going red without the render.

### 1.3 The doc-level witness — `TextWriteReceipt` + `canvas.textShape`

A string read-back **cannot** satisfy AC1: the projected string is identical whether the doc holds a
`Y.Text` or a plain string. The mechanism therefore emits its own receipt per captured text write —
`targetBefore`, `ytextAfter`, `migrated`, `ops`, `resolution`, `fallback`, `baseObserved` and four
lengths. **No user text appears in it**: counts, lengths and shapes only, so it cannot carry vault
content out of the process. It is kept in a bounded ring (200) on `CanvasSync`, **scoped by path**,
and read over the control channel through one additive `canvas.textShape` command.

A `TEXT WRITE:` line is also emitted to the debug logger. **The ring, not the line, is the oracle** —
a log can stop silently (the run's own S26).

---

## 2. AC-by-AC, with the live output

### AC1 — the field is a `Y.Text`, created complete in one operation, never replaced by a plain value ✅

```
PASS  S1 precondition: before ANY capture the doc holds a PLAIN STRING
      (the migration is lazy and write-triggered — there is no bulk pass)   shape='string'
PASS  S1: one changed character reaches BOTH peers        waited=1.0s A='AliceBoc' B='AliceBoc'
PASS  S1: after the first text capture the doc field IS a Y.Text            shape='ytext'
PASS  S1: the capture emitted a DOC-LEVEL RECEIPT for the conversion, exactly once
      migrating_receipts=1 {"seq":1,"path":"…ac1.canvas","kind":"node","id":"c1","field":"text",
       "targetBefore":"string","ytextAfter":true,"migrated":true,…}
PASS  S1: the SECOND changed character also reaches both peers  waited=1.0s A='AliceBod' B='AliceBod'
PASS  S1 (THE CRITERION): the SECOND capture did NOT flatten the Y.Text     shape='ytext'
PASS  S1 (THE WITNESS): the SECOND capture's receipt reports a Y.Text target, a non-migrating
      merge and a NON-ZERO op count
      {"seq":4,…,"targetBefore":"ytext","ytextAfter":true,"migrated":false,"ops":2,
       "resolution":"exact","fallback":false,"baseObserved":true,"baseLength":8,"currentLength":8,…}
PASS  S1: the peer's doc holds a Y.Text too (the nested type crossed the wire)   B.shape='ytext'
```

**The second capture's receipt is the one AC1 demands**, and it is present verbatim above:
`targetBefore: "ytext"`, `migrated: false`, `ops: 2`. On the baseline every one of these is RED
(`shape=None`, `{}`) because `canvas.textShape` reports `available: false`.

Headless counterpart: `test_tp03` drives the same thing through the real
`handleLocalModify → planCapture → applyIntentPlan` path and asserts `instanceof Y.Text` after the
**second** save, plus a `record.observe` tripwire showing exactly **one** `"update"` action for the
key, carrying content at its first observable instant.

### AC2 — the capture write is three-way, and the two-way helper is not the writer ✅

**The discriminating scenario, live, with its recorded precondition:**

```
PASS  S2: the field is a Y.Text on BOTH peers before the concurrent step    A='ytext' B='ytext'
PASS  S2 PRECONDITION 1: the peer's character reached A's shared DOC        waited=1.0s A.state='AliceYBob'
PASS  S2 PRECONDITION 2 (VACUITY GUARD): the peer's character is NOT in A's own .canvas file
      — A is about to save without it              marker='Y' present_in_A_file=False
      A saved 'AliceXBob' (peer marker 'Y' absent from that file)
PASS  S2 (THE CRITERION): the PEER's character survived A's save, on A      A.state='AliceXYBob'
PASS  S2 (THE CRITERION): the PEER's character survived A's save, on B      B.state='AliceXYBob'
PASS  S2: A's own character landed too                                      A.state='AliceXYBob'
PASS  S2: the context-anchoring FALLBACK did not fire   fallback_count=0 of 5 receipts
```

**The same two checks on the baseline:**

```
>>> FAIL  S2 (THE CRITERION): the PEER's character survived A's save, on A   A.state='AliceXBob'
>>> FAIL  S2 (THE CRITERION): the PEER's character survived A's save, on B   B.state='AliceXBob'
```

**The single-character substitution at the same offset** (S2b), which no "the diff boundaries
happened not to overlap" fallback can pass by luck:

```
PASS  S2b PRECONDITION 1: the peer's character reached A's shared DOC   waited=0.0s A.state='AliceYBob'
PASS  S2b PRECONDITION 2 (VACUITY GUARD): …                            present_in_A_file=False
PASS  S2b (THE CRITERION): the PEER's character survived A's save, on A  A.state='AliceYXBob'
PASS  S2b (THE CRITERION): the PEER's character survived A's save, on B  B.state='AliceYXBob'
PASS  S2b: the character BOTH users deleted is gone on both (a merge that never deletes is not a
      merge)                                                            A='AliceYXBob' B='AliceYXBob'
```

Baseline: both criteria FAIL with `A.state='AliceXBob'` — `Y` destroyed.

**Static half, quoted:**

- `git diff affff5f..HEAD -- plugin/src/utils.ts` → **empty**. `plugin/src/utils.ts` is byte-unchanged.
- **No call to `applyMinimalYTextUpdate` exists on any canvas path.** Stated precisely, because
  "zero occurrences" would be false:
  - Search pattern **`applyMinimalYTextUpdate(`** (with the opening parenthesis — a *call*, not a
    mention) over `plugin/src/files/canvas-sync.ts` and `plugin/src/canvas/`: **no match**.
  - **Rule 15 positive control:** the identical pattern, run over `plugin/src/files/background-sync.ts`,
    matches the known-present call sites at `:144` and `:313`. The pattern can match; the absence is
    real.
  - The bare word **does** occur twice on canvas paths, both in prose: `canvas-text-merge.ts:10-12`
    (the header explaining why it may not be used) and `canvas-sync.ts:3115` (the `writeCollabText`
    docstring saying it is not called). Recorded rather than glossed — a comment is exactly what a
    naive grep would have counted as a hit.
- `canvas-text-merge.ts` imports nothing at all — the file has no `import` statement.

### AC3 — concurrent editing merges character-wise, and no capture deletes a character it did not observe the user delete ✅

**As the charter states it — both vaults' `.canvas` written within one window, distinct markers at
distinct offsets of the same card, at least one run inside the same word:**

```
[S3b]  A saved 'kolla1boration', B saved 'kollabo2ration' — neither file holds the other's marker
PASS  S3b (THE CRITERION): BOTH markers are present on A            A.state='kolla1bo2ration'
PASS  S3b (THE CRITERION): BOTH markers are present on B            B.state='kolla1bo2ration'
PASS  S3b (POSITIONAL): '1' comes before '2' on BOTH peers — the offsets were resolved, not
      merely both appended                        A='kolla1bo2ration' B='kolla1bo2ration'
PASS  S3b: the surrounding word survived intact on both    A stripped='kollaboration' B stripped='kollaboration'
PASS  S3b: the two replicas agree (convergence is necessary — it is just not sufficient, which is
      why it is asserted LAST)
PASS  S3b: a GENUINE local deletion removes the characters on BOTH peers    waited=1.0s
PASS  S3b: the context-anchoring FALLBACK did not fire     fallback_count=0 of 45 receipts
```

`kolla1bo2ration` is the merge: both markers, in their typed positions, inside one word, on both
peers. **The convergence assertion is deliberately last** — convergence is exactly what the defect
preserves.

**The deletion half is asserted in the same run** (`kolla…ratio`, the `n` gone on both), because a
merge that never deletes is not a merge.

### AC4 — the projection renders explicitly, and the render is not `JSON.stringify`'s ✅

**Live:**

```
PASS  S4 precondition: the field is a Y.Text (otherwise the render is untested)   A='ytext' B='ytext'
PASS  S4: A's .canvas parses as valid JSON Canvas and 'text' is a JSON STRING  text_type=str
PASS  S4: B's .canvas parses as valid JSON Canvas and 'text' is a JSON STRING  text_type=str
PASS  S4: A's canvas.state reports 'text' as a JSON string, not an object      type=str
PASS  S4: B's canvas.state reports 'text' as a JSON string, not an object      type=str
PASS  S4 (THE VIEW CONSUMER): the card RENDERS its text on A's open canvas
      surfaceText='render me now' source='model' nodeFound=True canvasOpen=True
PASS  S4 (THE VIEW CONSUMER): the card RENDERS its text on B's open canvas
      surfaceText='render me now' source='model' nodeFound=True canvasOpen=True
```

**The headless half, which AC4 says may not be dropped — and its RED control.** Both assertions run
against the real seams, and each is paired with a control that reproduces the *un-rendered*
projection and shows the same assertion failing (`test_tp02`):

| consumer | with the render | **control: render removed** |
|---|---|---|
| the value handed to `reloadCanvasData` (`buildCanvasData`) | `typeof === "string"`, `"hello card"`, `Object.prototype.toString` = `[object String]` | `typeof` is **not** `"string"`; `instanceof Y.Text` is `true` |
| the Surface-Shadow after a confirmed apply (`buildApplyReceipt` → `advanceFromReceipt`) | `typeof === "string"`, `"shadow me"` | `typeof` is **not** `"string"` — *the next capture would diff against an object* |

Both controls are executed tests, not prose. **A render whose removal changes no test is not being
tested**, so the removal is what the controls perform.

Also covered: an **edge `label`** (`label` is a member of both `V2_NODE_FIELD_KEYS` and
`V2_EDGE_FIELD_KEYS`) renders through the same path; and `serializeCanvas` round-trips a string
containing `"` and `\` through `JSON.parse`.

### AC5 — the migration is lazy, non-destructive by construction, and `""` survives it ✅

**Live:**

```
PASS  S5: the emptied card reached both peers    waited=1.0s A='' B=''
PASS  S5 (A): the card is PRESENT and its 'text' key is PRESENT and exactly ""
      record_present=True key_present=True value=''
PASS  S5 (B): the card is PRESENT and its 'text' key is PRESENT and exactly ""
      record_present=True key_present=True value=''
PASS  S5 (A): the .canvas BYTES carry "text": "" — not an absent key
      node={"id":"c1","type":"text","text":"","x":20,…}
PASS  S5 (A) CONTROL: the non-empty card in the SAME board is still non-empty    c2='anchor card'
PASS  S5 (B) CONTROL: the non-empty card in the SAME board is still non-empty    c2='anchor card'
PASS  S5: the emptied card is still a Y.Text (an empty card is not an un-migration)  shape='ytext'
```

**No falsy assertion anywhere**: key presence (`"text" in node`) **plus** exact equality to `""`
**plus** `isinstance(str)`. `undefined`, a missing key and a dropped record are all falsy and all
three are what this criterion exists to catch, so none of them can satisfy it. The **non-empty
control card travels in the same board**, which excludes "empty for the wrong reason".

**The prohibitions, discharged:**

| prohibition | evidence |
|---|---|
| the conversion is a **single** `set` of an already-populated `Y.Text` | `record.observe` tripwire: exactly `["update"]` for the key, and the observed value at that instant is already the full content (`test_tp02`, `test_tp03`) |
| no branch deletes the key | the tripwire fails on any `"delete"` action |
| no branch attaches an empty `Y.Text` and fills it afterwards | the same tripwire — the observed value at the first event is the content |
| **no bulk pass** | live S1 (`shape='string'` before any capture) and `test_tp03` ("a record the local user did NOT edit keeps its plain string") |
| `migrateV1ToV2`, `SUPPORTED_SCHEMA_MAJOR`, `isRichTextValue` byte-unchanged | `git diff affff5f..HEAD -- plugin/src/canvas/canvas-schema.ts plugin/src/canvas/canvas-ingest-schema.ts` → **empty** |

---

## 3. RED → GREEN, matched pair

Suite: **`H:\tmp\liveshare_wp36_e2e.py`**. Idempotent — per-run ids (`wp36-<RUN>-*`), both vaults
swept at preflight and teardown, SKIP counted as SKIP and never as PASS.

| | **RED — baseline `affff5f`** | **GREEN — this tree** |
|---|---|---|
| bundle | `669d61e9…`, 4 091 136 B, built in a **detached worktree** at `H:\tmp\wp36-baseline` | `0007cae6…`, 4 258 635 B |
| `canvas.textShape` reports | `available: false` | `available: true` |
| roles resumed as | **A=host, B=guest** | **A=guest, B=host** — *opposite; S37 symmetry control* |
| `connected` on both | true (after one relaunch — see §6) | true |
| **RESULT** | **36 passed, 23 failed, 1 skipped** | **63 passed, 11 failed, 0 skipped** |
| S2 THE CRITERION (A) | **FAIL** `A.state='AliceXBob'` | **PASS** `A.state='AliceXYBob'` |
| S2 THE CRITERION (B) | **FAIL** `B.state='AliceXBob'` | **PASS** `B.state='AliceXYBob'` |
| S2b THE CRITERION (A/B) | **FAIL** `'AliceXBob'` | **PASS** `'AliceYXBob'`, `K` gone |
| S3b both markers, positional | *(scenario added after the RED run — see §6)* | **PASS** `'kolla1bo2ration'` on both |
| AC1 shape + receipts | **FAIL** (`shape=None`, `{}`) | **PASS** (`ytext`, receipts quoted above) |
| AC5 still a `Y.Text` after `""` | **FAIL** `shape=None` | **PASS** `shape='ytext'` |

**The 11 remaining GREEN failures, all attributed:**

| # | what | whose |
|---|---|---|
| 6 | `.canvas` BYTES do not carry the other peer's characters (S1, S2 ×2, S2b ×2, S5) | **PRE-EXISTING, WP85** — a `.canvas` does not converge from the doc; each peer's file holds only what that peer last saved. RED on the baseline too, labelled in the suite's own check names. |
| 4 | S3, the two-live-editor scenario | **WP37's class, attributed by measurement.** See §5. |
| 1 | S3b KNOWN LIMIT — one duplicated character | **WP36's own, self-reported.** See §5.2. |

---

## 4. The answer to WP37's AC3 — measured, not asserted

WP37 reported AC3 as **PARTIAL** because *"whole-string LWW means one marker must lose by
construction"*. That constraint is **gone**. What replaced it is a different, narrower blocker, and
the distinction is worth being exact about.

**At the layer WP36 owns — SATISFIED.** Two concurrent edits to the same card, from a common base,
each at a distinct offset **inside the same word**, both survive, in their typed relative order, on
both peers: `kolla1bo2ration` (S3b). Nothing about that outcome is representable under a whole-string
register.

**Through two live inline editors — NOT YET, and not because of the merge.** Driving the real editor
on both peers via `canvas.typeInNode` (A inserts `1` at offset 5, B inserts `2` at offset 7) gives:

```
PASS  S3 precondition: A's characters reached the EDITOR, not the model
      before='kollaboration' after='kolla1boration' source='editor'
PASS  S3 precondition: B's characters reached the EDITOR, not the model
      before='kollaboration' after='kollabo2ration' source='editor'
PASS  S3 precondition: the two edits landed at DIFFERENT offsets inside the same word
>>> FAIL  S3 (WP37 AC3's positional half, THROUGH TWO LIVE EDITORS): BOTH markers present on A
      A.state='kolla1boration'
>>> FAIL  S3 (ATTRIBUTION): the second typist's peer produced a text capture at all
      B receipts for c1 on this board: 0 []
```

**Zero receipts. B's capture never ran for that board at all**, so no merge decision was ever taken
and the loss cannot be the merge's. A dedicated diagnostic (`H:\tmp\liveshare_wp36_s3_diag.py`)
traced it to the second:

```
--- both typed, NOTHING blurred yet
    A: doc='kollaboration'  surface='kolla1boration'(editor)
    B: doc='kollaboration'  surface='kollabo2ration'(editor)
>>> A blurred
    +2s   B.doc='kolla1boration'  B.surf='kollabo2ration'    <- B still holds its own text
    +4s   B.doc='kolla1boration'  B.surf='kolla1boration'    <- B's EDITOR was REPLACED
```

A's blur commits and propagates; ~4 s later the peer's committed value **replaces B's live editor**,
and B's `2` is destroyed *in the view, before storage*. A second diagnostic
(`…_s3_diag2.py`) removed the propagation window entirely by blurring both editors back to back —
same outcome, and B still emitted **no receipt at all**, so this is not a timing margin that a longer
`CANVAS_EDIT_DRAIN_DELAY_MS` would close.

**Ruling:** WP37 closed "a peer changing the card you are typing in destroys your editor" for the
case its suite exercises. It does **not** cover *"a peer's blur-committed change to the card you are
typing in, arriving while you are still typing"* — the two-typist case. That is a residual WP37-class
gap, it now blocks the last unmeasured half of C37 AC3, and **it needs its own work package**. It is
recorded as **S50** in §6.

---

## 5. Found, and honestly reported

### 5.1 ESCALATE — 13 inherited assertions are RED and were NOT rewritten

| | |
|---|---|
| baseline `affff5f`, detached worktree | **2157 tests, 2157 passed, 0 failed** *(2 suites could not load: `Cannot find package 'cors'` — the worktree has no `server/node_modules`; a worktree artefact, not a result)* |
| this tree | **2331 tests, 2318 passed, 13 failed, 333 files** |
| measured by | `npx vitest run` from `plugin/` |

**Every one of the 13 has the same shape**, and the shape is the point:

```
AssertionError: the legitimate label change did not land:
  expected YText{ … } to be 'L2'                        // Object.is equality
AssertionError: real intent was swallowed:
  expected YText{ … } to be 'edited'
AssertionError: the stale text must be pushed back too:
  expected YText{ … } to be 'contested'
```

The **value is correct in every case** — the `Y.Text` holds exactly the string the assertion names.
What changed is the *representation*, which is what this WP exists to change and which `V2Node`'s own
docstring anticipated: *"a read must tolerate BOTH shapes, so no consumer may narrow it with a hard
`typeof === "string"` validity assertion"* (`canvas-registers.ts:148-152`). These oracles read the
`Y.Map` directly and narrow it.

Four of the 13 are WP23 fuzzer scenarios, and the fuzzer's diagnosis is precise:

- **No `[byte]` and no convergence family fails anywhere.** Across every WP23 file, the violated
  families are exactly **`[lww]` (622 lines) and `[intent-trace]` (493 lines)** — and only those two.
  Cross-replica byte identity still holds.
- Both violated families encode *"`text` is a whole-string LWW register"*, which is the property this
  WP removes. The harness says so itself: `standard-ops.ts:552-555`, on `relabelViaSave` — *"P1
  `text` is a plain LWW string field. COLLABORATIVE TEXT EDITING (a nested `Y.Text` with
  character-level merge) does NOT exist yet — that is WP36 … It is not a stand-in for it."*
- The fuzzer additionally re-authors every replica's edits as every other replica's local intent
  (`saveWithOverride` builds each save from the **shared** trace), which is idempotent under LWW and
  is not under character merge. That is a harness-semantics mismatch, not a product defect — the
  product's equivalent case is guarded by the `converged` branch (§1.1), because a real peer's file
  only ever receives text *from its own doc*.

**Per §7 clause 2 this is an ESCALATE with the measured before/after, and the tests are left RED.**
No test was deleted, weakened, retitled, skipped or amended. **WP36 took no §7 licence of any class.**
Whoever disposes of this must decide *what the fuzzer's `text` oracle should now assert* — that is a
spec question about §4.3's `text` row, not an implementation one.

### 5.2 KNOWN LIMIT, self-reported — a single-span diff from a stale base can re-author one character

```
>>> FAIL  S3b (KNOWN LIMIT): the merge introduced no character neither user typed
      A='kolla1bo22ratio' count('2')=2
```

The local diff is a **single contiguous span**. When one save both inserts and deletes across a span
that straddles a peer's insertion point, and the local base predates that insertion, the peer's
character can be re-authored — one extra character neither user typed. **No data is lost and both
replicas agree**, but it is a value nobody submitted. Reachable in practice only because a `.canvas`
does not converge from the doc (WP85), which is what keeps a peer's base stale. Closing it needs a
multi-span (LCS-style) local diff; that is a deliberate non-goal here and is left visible as a failing
check rather than hidden.

### 5.3 The degraded no-base branch, stated as a trade

When the Surface-Shadow has never observed a field there is no third operand. The branch chosen is
**insert-only, never delete** — it can leave stale characters (and, in the extreme of a doc and file
that diverged entirely, concatenate them) but it can never destroy a peer's text, which is AC3's
absolute rule. The alternative (a two-way whole-value replace, i.e. today's behaviour) destroys peer
text. The window is one capture per field per session: the capture itself advances the shadow, so
every later write is a real three-way. The live suite establishes the base explicitly with one
geometry-only warm-up save and records why.

### 5.4 The convergence-fuzzer `text-edit` op was NOT registered — deliberate, documented

The charter asks for a `text-edit` op in WP23's registry. **It was not added**, for a stated reason:
the registry's two judging families for `text` (`[lww]`, `[intent-trace]`) currently assert
whole-string LWW and are already contradicted by this WP (§5.1); adding an op would perturb every
seed's draw and manufacture further red against an oracle that is itself pending disposition. It
should land **together with** the fuzzer's `text` oracle decision, in the same pass. The charter's own
caveat stands and is repeated here: **the fuzzer provably cannot see AC3's failure mode**, because
both replicas converge on the same destroyed string; it is supporting evidence and is not the
acceptance evidence.

---

## 6. Found and NOT fixed / carried up

| # | finding | disposition |
|---|---|---|
| **S50 (new)** | **A peer's blur-committed change to the card you are still typing in replaces your live editor.** Measured twice, with and without a propagation window; the second typist emits **zero** text captures. This is the last thing standing between WP36 and an end-to-end demonstration of C37 AC3. **Needs a WP.** | WP37's class; out of WP36's scope (`main.ts` is not touched by this WP). |
| **S46, twice, in this run** | `plugin/main.js` is contended and a sibling **installed a bundle at 06:01 containing my uncommitted `canvas-sync.ts` but not my `e2e-control.ts`** — which silently invalidated my first "RED baseline" (it was running my merge). Caught by inspecting the installed bytes for source markers, not by any warning. The second time the digest guard was set and the install was correct. | **Always set `LS_EXPECT_SHA256`, and additionally grep the installed bundle for a marker string unique to your change.** A size check is not enough; a digest check only proves *which* build, not *whose*. |
| **S47, live** | After the baseline install, vault A resumed `role: host, connected: false`. The suite's preflight **refused to measure** and exited 2. One `liveshare_wp83_relaunch.py` cleared it. The gate is worth its cost. | WP82, chartered, unimplemented. |
| **(process)** | A sibling batch's checkpoint **committed my `e2e-control.ts` additions under its own commit** (`affff5f`, WP86) while I was mid-run. Nothing was lost; the additive `canvas.textShape` case and the `at` argument are in that commit rather than in `3ebd35c`. | Reported so the archaeology is not confusing later. Shared-tree consequence of two batches touching one file; no revert was performed by me on any shared path (rule 14 honoured). |
| **WP85 class** | 6 of the 11 GREEN failures are "a `.canvas` does not converge from the doc". Labelled in the suite's own check names as pre-existing and RED before WP36. | WP85's; landed after this batch started (`40932de`) — not re-measured here. |
| **`canvas.typeInNode` gained an `at` offset** | Appending is not sufficient evidence for AC3: two appends by two peers land at different offsets of different strings and can be reconciled by luck. `at` clamps to line 0 and is **refused at the command boundary** when non-finite, so an ignored position cannot masquerade as an append. | W3 revision of the WP37 instrument, per the owner's workflow. No existing behaviour changed: `at` absent ⇒ byte-identical to WP37's append path. |

---

## 7. The constraint sheet, discharged

| constraint | status |
|---|---|
| the capture write is three-way; `applyMinimalYTextUpdate` is not the writer | ✅ — §2 AC2 static half |
| `plugin/src/utils.ts` **byte-unchanged** | ✅ — `git diff affff5f..HEAD -- plugin/src/utils.ts` empty |
| `isRichTextValue`, `migrateV1ToV2`, `SUPPORTED_SCHEMA_MAJOR` **byte-unchanged** | ✅ — `git diff` on both files empty |
| the conversion is ONE op; never absent; never empty-then-filled | ✅ — `record.observe` tripwire |
| the projection renders `Y.Text` → string **explicitly** | ✅ — AC4, with both RED controls |
| no capture path overwrites a `Y.Text` with a plain value | ✅ — the router; AC1's second capture |
| `docValueEquals` **not** widened | ✅ — routing decided before the equality question |
| `"text": ""` present, valid, exactly `""` | ✅ — AC5 |
| no bulk pass, no schema-major bump, no second CRDT | ✅ |
| **`main.ts` not modified** | ✅ — WP36 needed no wiring, exactly as the charter predicted |
| no `server/**` edit · `useCanvasBinding` not flipped · version not bumped | ✅ — still `false`, still `0.6.1` |
| no new runtime dependency | ✅ — `canvas-text-merge.ts` has **no import statement at all** |
| no `DONE` WP re-opened; no §7 licence of any class | ✅ — §5.1 is an ESCALATE, not a rewrite |
| `canvas.simulateEdit` **not called** | ✅ — it appears nowhere in this batch's suites or diagnostics |
| edits driven by writing the `.canvas` on disk (and, for S3, the real editor) | ✅ |
| vault ports used | **39431 (A) / 39432 (B)** on every live run |

---

## 8. Files changed

| file | change |
|---|---|
| `plugin/src/canvas/canvas-text-merge.ts` | **new** — the three-way merge core. Zero imports. |
| `plugin/src/files/canvas-sync.ts` | the write router, `writeCollabText`, the lazy one-op conversion, the explicit projection render, `TextWriteReceipt` + the bounded path-scoped ring, `getTextShape` / `getTextWriteReceipts` |
| `plugin/src/testing/canvas-node-editor.ts` | additive `at` caret offset (W3 revision of WP37's instrument) |
| `plugin/src/testing/e2e-control.ts` | additive `canvas.textShape` case + optional host method + the `at` argument, refused at the boundary when non-finite. *(The first version of these lines was swept into a sibling's commit `affff5f`; `3ebd35c` carries the path-scoping refinement.)* |
| `plugin/src/__tests__/v2/wp36/test_tp01_…` | **new** — 19 tests: the merge arithmetic, the two-way control, the counted fallback firing, surrogates |
| `plugin/src/__tests__/v2/wp36/test_tp02_…` | **new** — 8 tests: the projection render at both non-JSON consumers, each with its RED control; the one-op conversion; `""` |
| `plugin/src/__tests__/v2/wp36/test_tp03_…` | **new** — 10 tests: the real capture path end to end, including the peer-character-survives scenario and the no-bulk-pass control |
| `H:\tmp\liveshare_wp36_e2e.py` | **new** — the deterministic live reproduction and proof, idempotent |
| `H:\tmp\liveshare_wp36_s3_diag.py` · `…_s3_diag2.py` · `…_install_green.py` | **new** — the S50 attribution diagnostics and the digest-guarded installer wrapper |

**Byte-unchanged over `affff5f..HEAD`, verified with `git diff --quiet`:** `plugin/src/utils.ts`,
`plugin/src/canvas/canvas-schema.ts`, `plugin/src/canvas/canvas-ingest-schema.ts`,
`plugin/src/canvas/canvas-shadow.ts`, `plugin/src/canvas/reconcile-plan.ts`,
`plugin/src/canvas/canvas-presence.ts`, `plugin/src/types.ts`, `server/**` (`git diff --stat` empty).

**`plugin/src/main.ts` — not touched by WP36, and the check is stated exactly rather than loosely.**
`git diff affff5f..HEAD -- plugin/src/main.ts` reports CHANGED, because sibling batches (WP85, WP86)
committed to it in that range. **WP36's own commit does not contain it:** `git show --stat 3ebd35c`
lists exactly seven files, and `main.ts` is not among them.

---

## 9. Data-safety statement

`data.json` values were never read, printed, logged, fixtured or committed — only the key name
`e2eControlPort` appears, and only inside the pre-existing installer. `sharedFolder` stayed
`_liveshare-test` in both vaults throughout and was never set empty. `obsidian-git` was left disabled.
No `server/**` edit. Every artefact this batch created is namespaced `wp36-*` under `_liveshare-test/`
and every one was swept (14 at the final teardown). The `TextWriteReceipt` carries **no user text** by
construction — counts, lengths and shapes only — which is what makes it safe to read over the control
channel and to quote in this report. Live runs used ports **39431 (A)** and **39432 (B)** only.

---

## 10. One note for whoever touches this next

**The third operand is the whole work package.** Everything else — the router, the render, the
migration — is plumbing that a careful reader will get right. The one thing that is easy to get wrong,
and that no convergence test, no byte-equality check and no fuzzer can catch, is diffing the
`Y.Text`'s own content instead of the shadow's. It makes every replica agree, every suite green, and
the remote user's characters disappear. If you ever find yourself reaching for
`applyMinimalYTextUpdate` on a canvas path, that is the bug, however green it looks.
