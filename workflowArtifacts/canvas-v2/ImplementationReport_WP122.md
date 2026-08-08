# ImplementationReport — WP122: A file with no writer cannot converge

**Batch:** B61 · **Worker:** W3 · **Branch:** `fix-bugs-and-raceconditions`
**Landed:** `4a03ac7` — *"WP122 checkpoint: a file with no writer cannot converge"*
**Baseline HEAD:** `6f93068` · **Sibling in the tree:** none (WP120 and WP121 had both landed; `git status` at start showed only an untracked `workflowArtifacts/canvas-v2/temp.md`, which is not mine and was not staged).

**Verdict:** `HANDOVER_READY`. R1, R2 and R5 are **DONE and demonstrated**. B3's `records` clause is a **BLOCKER needing its own package**, with the two lines that forced the conclusion, measured.

---

## 1. §2's verdict, and the design fork

### 1.1 The charter's correction of the investigation is CONFIRMED, and I extend it

The charter §2 says the investigation's safety argument is wrong in two of its three steps. **Both corrections hold, and I found a third thing the charter did not say.**

| investigation's claim | verdict | evidence |
|---|---|---|
| *"the host seed makes doc == file, so an attach is safe"* | **WRONG, confirmed** | `seedFlatSpace` (`canvas-sync.ts:4551`) is create-once **upsert-only** via `writeRecordCreateOnce` (`:1932`), whose own docstring says *"an existing one is merged in place, never replaced"*. After the seed the doc is the **union**, minus refusals. |
| *"an attach is a no-op at attach time"* | **WRONG, confirmed** | `attachCanvasPersistence` (`canvas-persistence.ts:1168`) calls `coldOpen()` unconditionally at `:1175`, before `start()`. `coldOpen` (`:683`) on `docNonEmpty` (`:687`) runs `migrateRecordBearingDoc()` (`:705`), WP121's copy (`:713`) and **`await this.flush()` (`:715`)**. |
| *"WP79 AC4 survives literally"* | **WRONG, confirmed** | follows from the above. The pass writes the host's file. |

**My addition — the seed's merge direction, found by a test that went red.** `upsertRecordFields` means the host's **file** overwrites the **document's** value for any key the file also names. My first geometry row (host file `h1.x = 10`, peer doc `h1.x = 999`, seed after the guest's edit) went red at `expected 10 to be 999` — not a harness bug, the landed WP18/WP29 semantics. Consequence, and it is a **residual, not a WP122 defect**: on a *rejoin*, a host's stale `.canvas` re-proposes its own geometry over a peer's newer position. That is the class the declined *"canonicalise serialisation everywhere"* option would have touched. I re-shaped the row to the **measured live sequence** instead (session up, then the guest edits — `tp02b`), which is what the 240 s stall actually was.

### 1.2 I built **(a) — attach, and let the cold open flush**

**The reason, in one sentence: (b) does not avoid the overwrite. It postpones it and strips both guards off it.**

`coldOpen` is the **only** caller of two things (`canvas-persistence.ts`, one call site each, both inside `coldOpen`):

- `hydrateDurableRefusals()` at `:685` — WP90's durable refusal hydration, the thing that arms `writeIsWithheld()`
- `preserveRecordsTheDocDoesNotKnow()` at `:713` — WP121's conflict copy

and `start()` installs the observer **regardless**, so under (b) the first remote delta calls `scheduleWrite` → `flushToDisk` and writes the whole canonical projection over the host's file anyway. (b)'s literal-AC4 survival lasts exactly until the event the package exists to make converge.

**Demonstrated, not argued** — `test_tp05_what_arm_b_would_have_cost.test.ts`, arm (b) composed inside the test out of the real `CanvasPersistence` (nothing is wired into the product):

| row | measured |
|---|---|
| `tp05a` (arm a) | cold open reads the door **once**, copies `f9`, then flushes. File = `["g1","h1"]`, copy = `["f9","h1"]`. |
| `tp05b` (arm b) | at attach: **nothing written**, file still `["f9","h1"]`. After **one** remote delta: file = `["g1","g2","h1"]`. Same bytes, later. |
| `tp05c` (arm b) | …and `door.read` **never called**, `door.write` **never called**, **zero** conflict copies. `f9` gone from the only place it existed. |
| `tp05d` (arm b) | no cold open ⇒ no `lastWrittenContent` baseline ⇒ the first flush is unconditional. |
| `tp05e` | the structural claim itself, read from the product source: exactly **one** `this.<guard>(` occurrence each, both inside `coldOpen`. |

**Secondary reasons for (a):** it matches the guest-create precedent (`canvas-create.ts:507`, `env.attachWriter`), measured working at 0.25 s; it needs **no new branch inside the single writer**; and its flush is the fix for boards already divergent when the session starts, which (b) leaves stale until somebody touches them.

**What I expect would have gone wrong had I built (b):** the four rows above are the answer. Concretely — a host rejoining with a divergent board would attach a writerless-no-more but guardless writer; the next guest keystroke would overwrite the host's `.canvas` with the document's projection, **with WP121's conflict copy never consulted and WP90's durable refusal set never hydrated**, so a record the host had durably refused would be deleted from the user's file with nothing said. (b) would have made WP121 — the package the Dispatcher landed specifically as WP122's precondition — **unreachable on the exact population WP122 newly touches**. It also would have needed a new `skipColdOpen` option on `CanvasPersistenceOpts`, i.e. a new way for a writer to exist with an unknown baseline, which is a second thing to get wrong for no benefit.

### 1.3 🔴 The exact WP79 AC4 re-wording, for the owner to approve at handover

AC4's canonical statement is `TaskCharter_WP79_SharedCanvasMirrorMaterialisation.md` §4 clause 4, first sentence. **Current:**

> **Nothing this WP adds ever destroys, and an empty doc produces no file.** Under every entry point, and including a guest whose local `.canvas` has **diverged** from the host's: an existing file is not overwritten, not truncated, not renamed, not trashed and not written to at all — its bytes are compared before and after and are identical.

**Proposed (the only change is the scoping clause; everything after it is byte-unchanged):**

> **Nothing this WP adds ever destroys, and an empty doc produces no file.** Under every entry point, and including a guest whose local `.canvas` has **diverged** from the host's: an existing file is not overwritten, not truncated, not renamed, not trashed and not written to at all — its bytes are compared before and after and are identical. **This is absolute for the GUEST arm, which remains create-only. On the HOST arm, WP122 licenses exactly one write: the guarded `doc-wins` flush of `CanvasPersistence.coldOpen`, reached only through `attachCanvasWriter` and therefore only under WP121's conflict copy and WP90's durable-refusal withhold. No other write of a host's `.canvas` is licensed by this pass, and the guest arm's byte comparison stands unchanged.**

The BUILD_SPEC's WP79 row (`BUILD_SPEC_CanvasV2.md:2443`) carries the same rule as the clause *"**create-only** — an existing `.canvas` is never overwritten, truncated, renamed or trashed"*. **Suggested amendment:** insert *"on the guest arm"* after *"create-only"*, and append *"; on the host arm WP122 licenses the guarded `doc-wins` flush and nothing else"*.

**The in-source statement of AC4** (`canvas-mirror.ts`'s host arm, formerly *"No write, no attach, no cold open: the host's file must not be rewritten by this pass (AC4 is absolute, and it does not carve out the host)"*) I **have** rewritten, because it is inside the file this package owns and leaving it would have been a comment that contradicts the code beneath it. The charter's and the BUILD_SPEC's copies are the owner's, and are **not** touched by this commit.

---

## 2. B3 — the `records` clause is a BLOCKER. Two lines forced it, both measured.

The charter ruled the clause **in scope** and asked me to overturn that only with the line that forces it. I have two.

**Obstacle 1 — the clause cannot be additive. Measured.** I added a sixth `records` row to `judgeFileAgainstExpectation` and ran the suite:

```
FAIL v2/wp116/test_s158_the_oracle_that_could_not_see_a_shared_loss.test.ts
  AssertionError: expected [...] to have a length of 5 but got 6      :232
  AssertionError: expected [...] to have a length of 5 but got 6      :315   (×3 rows)
  AssertionError: expected [ Array(6) ] to strictly equal [ Array(5) ] :347
  Tests  5 failed | 97 passed
```

The pin is not `everyBranch` at `:334` as the charter believed — that is a list of *expectation shapes* and it is fine. The pin is the **clause-row ledger**: `expect(judgement.clauses).toHaveLength(5)` at `:232` and `:315`, and `expect(judgement.clauses.map(c => c.clause)).toStrictEqual([...five names...])` at `:347-353`. **Five tests in another package's file go red on a sixth row.** The charter's own instruction for this outcome is *"stop and report"*.

Reporting the clause outside `clauses` is not an escape: S155's rule — which the charter itself cites as the reason for the `stated:false, satisfied:null` shape — is *one row per clause in every branch*. A clause that reports somewhere else is the exact ambiguity S155 exists to remove.

**Obstacle 2 — the clause cannot use `parseCanvas`. Also measured.** `e2e-control.ts`'s static import list is **frozen to five specifiers** by `wp72/test_tp4_no_production_branch_and_no_new_transport_visible.test.ts:33-39`, asserted at `:54`. Adding `import { parseCanvas } from "../files/canvas-sync"`:

```
FAIL wp72/test_tp4_no_production_branch_and_no_new_transport_visible.test.ts
  > e2e-control.ts imports nothing outside the frozen allow-list
  AssertionError: expected false to be true            :54
```

So the clause would need a **second, private canvas parser inside `e2e-control.ts`** — which is precisely the "four private copies of the canvas test" defect class `WP83`'s census exists to prevent, in the one file this project has explicitly frozen against widening.

**`e2e-control.ts` was restored by copy-aside and verified byte-identical**: sha256 `1f7c8389127e4fdce2a3391643628a19bb57f3ae556d43de679ab13d73aa8ae1`, before and after. **No file in `v2/wp116/` or `wp72/` was edited.** Both are green.

**What this does NOT block.** WP122's headline is demonstrated headlessly against a reference point outside the peers (a **planted** fixture, not a peer reading), so it is not `S158`'s shape. The clause is needed by **W4's live arm**, and it should be its own package, sized to include amending `wp116`'s three ledger assertions — which is an owner-visible change to a landed AC and not a thing to slip into a package about writers.

---

## 3. Break table

Every plant was applied to the **product source**, measured, and restored by **copy-aside from `H:/tmp/wp122-aside`**, verified by whole-file sha256 against a recorded baseline. **No `git checkout`, no `git stash`, no `git restore`** at any point. Final restore output: `RESTORED 4 files, all sha256 verified byte-identical`.

| # | AC | break | file / anchor | went RED | right reason? |
|---|---|---|---|---|---|
| **P1** | B1 | delete the `PUBLISH_AND_BIND_WRITER` row from `admitsCanvasMirror` | `canvas-mirror-decision.ts:237` | **12 tests** — `tp01a/b`, `tp02a/b/d/e`, `tp03a/b/c/c2/d/e` | ✅ the WP117 wall: the path is skipped **before** `decideCanvasMirror` is asked. `hasWriter` false; disk unchanged. |
| **P2** | B1, B2 | return the verdict, never execute the bind (`await deps.bindHostWriter(path)` → `await Promise.resolve()`) | `canvas-mirror.ts:414` | **11 tests** | ✅ `S160`'s shape exactly — publication unconditional, the write that would make it true removed. Receipt still reads `bound`; `hasWriter` false. **The receipt is not the oracle, and this row proves it.** |
| **P3+P3b** | B4 | the charter's ordering plant, as a true **move**: bind hoisted above the subscribe **and** deleted from the host arm | `canvas-mirror.ts` (two hunks) | **10 tests** | ⚠️ **red for a DIFFERENT reason than the charter predicted** — see §3.1. |
| **P4** | B5 | remove `this.env.armMirrorPass?.()` from the ACCEPTED branch | `canvas-create.ts:593` | **1 test** — `tp04a` | ✅ no pass runs, no writer, `adoptionsCleared` stays 0. Exactly the 240 s stall. |
| **P5** | B6 | `probe.localFileExists === true` → truthiness | `canvas-mirror-decision.ts:188` | **6 tests** — five WP79 fail-closed rows + my `tp01e` | ✅ the fail-closed clause is live, and WP79's own rows catch it. |
| **P6** | B1 | collapse `bound` into `published` (`bound: 0`) | `canvas-mirror.ts:288` | **1 test** — `tp01a` | ✅ the `S138` separation is load-bearing in the receipt. |
| **P7** | — | delete the `deps.bindHostWriter === undefined` conjunct | `canvas-mirror.ts:387` | **NOTHING** | 🔴 **a finding — see §3.2** |
| **P8** | B1, B2 | delete `bindHostWriter:` from `main.ts`'s mirror deps | `main.ts:3570` | **NOTHING** *(before `tp06`)* → **2 tests** after | 🔴 **a finding — see §3.3** |
| **P9** | B5 | delete `armMirrorPass:` from `main.ts`'s create env | `main.ts:2497` | **NOTHING** *(before `tp06`)* → **3 tests** after | 🔴 same finding |

### 3.1 P3 — the charter's ordering plant does not fail the way the charter says, and I corrected it

The charter §5 predicted the hoisted bind would flush *"a board missing everything the host authored"*. **In production it cannot**, and the reason is one line: `attachCanvasWriter` (`main.ts:3643-3646`) early-returns when `getCanvasDocHandle(rawPath)` yields no handle, and **only the subscribe creates that handle**. A bind hoisted above the subscribe therefore attaches **nothing at all**. The measured failure is *"the writer never exists"* (`tp01a`: `expected false to be true`, `tp03a`: `expected ['h1'] to strictly equal ['g1','h1']`), not *"the writer wrote the wrong board"*.

My first attempt at P3 was itself wrong — I *added* a hoisted bind without removing the original, which reddened only the two trace rows. That is on record because a plant that reddens the wrong thing is exactly the class this rule exists to catch. P3+P3b is the true move.

**The destruction the charter describes is still real, and it is still reachable** — but it needs a doc that already exists, i.e. the **mid-session `isSubscribed` path**, where `mirrorOne` skips the subscribe entirely (`canvas-mirror.ts`, `if (!deps.canvasSync.isSubscribed(path))`). That population is `tp03c`, and there WP121's copy fires. `tp03d` keeps the reordering as a **standing row** driven from the harness (`hoistBindAboveSubscribe`), where the doc is present, and asserts the destruction **by name**: `['g1']`, with `h1` and `h2` absent and preserved in the conflict copy.

**Correction to the charter:** §5's *"B4 must go RED and must name the missing record ids"* is right about the standing row and wrong about the source plant. The ordering is still worth pinning — it is still enforced by nothing but statement order — but its failure mode in production is *no writer*, not *a destroyed board*.

### 3.2 P7 — a break that reddened nothing, and the honest reason

`if (verdict !== PUBLISH_AND_BIND_WRITER || deps.bindHostWriter === undefined)`. The second conjunct is **subsumed**: the verdict can only be `PUBLISH_AND_BIND_WRITER` when `bindsHostWriter === true`, which `mirrorOne` derives as `typeof deps.bindHostWriter === "function"`. So no runtime input can distinguish them, and no test can.

It is **kept, and a different gate proves it live**. With P7 planted:

```
src/files/canvas-mirror.ts(414,13): error TS2722: Cannot invoke an object which is possibly 'undefined'.
```

TypeScript, not vitest, is the instrument for this conjunct — the narrowing is what makes the call site legal. This is the same shape as `canvas-mirror.ts`'s existing `identityResolves === true` subsumption note (break table B30, WP101): a conjunct that cannot be false today, kept so it does not silently become wrong if the gate above it is relaxed. **Recorded rather than deleted.**

### 3.3 P8 / P9 — the gap this package found in itself, and closed

**Both `main.ts` wiring hunks could be deleted with the entire suite still green.** The fix would have been absent from the product and every gate would have reported success. `main.ts` has no test file of its own; WP117 and WP121 both solved this with a source census, and WP122 had not.

Closed by **`test_tp06_the_product_wires_both_seams.test.ts`** — nine rows, derived from `main.ts`'s source rather than from a hand list, with the two-half positive control `S53` requires (HALF A: it reports a literal of the pre-WP122 call site as UNWIRED; HALF B: it **throws** on an input with no call site rather than reporting "all wired"). Re-measured with `tp06` present: P8 reddens 2, P9 reddens 3.

**Caveat, stated rather than discovered (`S88`'s shape):** `tp06` reads the **live working copy** of `main.ts`. A batch editing that file makes these rows transiently red and the redness is not attributable to WP122.

---

## 4. The safety demonstration — measured, not assumed

**The question the Dispatcher explicitly refused to grant me:** does WP121's guard actually cover the boards WP122's bind newly attaches writers to?

**Answer: yes, and here is the measurement — `tp03c`.**

- Construction: the **production-reachable** mid-session case. `mirrorOne` skips the subscribe when the path is already subscribed, so no host seed runs; the document holds `["g1","h1"]` and the host's disk holds `["f9","h1"]`. `f9` exists nowhere but that file.
- Asserted **before** the bind: doc `["g1","h1"]`, disk `["f9","h1"]`. The dangerous case, stated rather than hoped for.
- After the pass: `hasWriter` **true**; the canvas path holds `["g1","h1"]` — `doc-wins` did what `doc-wins` does, unchanged by WP121 and unchanged by WP122; and **exactly one** file exists under `conflictsRootFor("share")`, holding `["f9","h1"]`.
- **Positive control `tp03c2`:** the identical board with `preservation: false` — the pre-WP121 composition — loses `f9` with **zero** copies. Without this row, `tp03c` could not tell "the guard fired" from "the harness kept a spare file".
- The conflicts root is located through `conflictsRootFor`, the one definer, never a re-spelt literal.

**Structural half:** the bind travels `attachCanvasWriter` (`main.ts:3643`), the same route the guest-create handshake has used since WP117, and that method wires `preserveDiscarded` unconditionally (`main.ts:3771`). `tp06b` pins that both seams point at that one method, so a future package cannot add a second attach route with its own idea of what is guarded.

**One arm I did NOT demonstrate, and it is a real limit.** When the host seed **refuses** a record (WP63/WP94), `coldOpen` skips *both* the preservation and the flush (`canvas-persistence.ts:712-715`, `if (!this.writeIsWithheld())`), so the file is not overwritten at all and there is nothing to preserve against. That is a *stronger* protection than WP121's copy, and I state it as **argued** rather than demonstrated — my harness does not exercise `seedFlatSpace`'s refusal path (declared in the harness header). `S176`'s degraded arm — the durable-refusal protection silently off when `refusalIdentity` is null — sits on that same path and I did not touch it.

---

## 5. `S170` — closed, and the test can tell the fix from the accident

R5 is one line: `this.env.armMirrorPass?.()` at `canvas-create.ts:593`, in `handleResult`'s **accepted** branch, immediately after `adoptionsArmed`. Wired at `main.ts:2497` as `armMirrorPass: () => this.armCanvasMirrorPass()` — the **eleventh** call site of a pass `main.ts` already owns, forwarding only.

**`S170` is CLOSED (demonstrated).** `tp04a`: the accepted result adopts the board, `hasWriter` goes true, and `manifestWrites` is **exactly** `["publish:share/plan.canvas"]` before and after — the host's own publish, which happens *before* the answer frame. **No manifest activity at all** between the answer and the adoption, which is B5's criterion verbatim and what distinguishes the fix from WP118's coincidence.

Supporting rows: `tp04b` (the same world with no arm seam: `passes` 0, `hasWriter` false, adoption armed and waiting — the stall, reproduced); `tp04c` (a refused result arms nothing, and the user is told); `tp04e` (a result this peer never requested arms nothing); and `tp04d`, which states in a row **why the ledger is not the oracle here** — `adoptionsArmed` moves on the accepted branch either way, so a pass armed on refusal would be invisible in the stats.

---

## 6. Demonstrated vs argued (§3.7)

**DEMONSTRATED — closed:**

1. A host-created canvas has a writer after one pass, with no human and no leaf event (`tp01a/b`), read from the **writer registry**, never from `canvas.mirror`.
2. A guest's edit reaches the host's **file** — both the cold-open union (`tp02a`) and the measured live sequence, session-up-then-edit (`tp02b`), with the writer's own observer→debounce→flush chain (`tp02e`).
3. The discriminator: the identical scenario on the pre-WP122 composition leaves the file **byte-unchanged with zero writes** (`tp02c`, `tp02b2`).
4. WP121's guard covers the newly-attached population, with a positive control (`tp03c`, `tp03c2`).
5. The union case loses nothing the file uniquely held, nodes and edges (`tp03a`, `tp03b`).
6. The ordering is load-bearing, and its destruction is named by record id (`tp03d`, `tp03e`).
7. `S170` closes with zero other manifest activity (`tp04a`, controls `tp04b/c/d/e`).
8. Arm (b)'s cost (`tp05a–e`).
9. The product wires both seams, with the two-half control (`tp06a–i`).
10. `S174`: a byte oracle scores in-sync boards divergent and `contains` flips on the same geometry — one row, and it retires the byte oracle permanently (`tp02d`).
11. Every pre-WP122 verdict is byte-unchanged: the full suite went 3310 → 3310 passing with the product change alone, before a single new test existed.
12. B3 is a blocker (§2), on two measured lines.

**ARGUED — not closed:**

- The withheld-flush arm (§4's last paragraph): stronger protection, reasoned from `canvas-persistence.ts:712-715`, not exercised.
- **Live behaviour of any kind.** No Obsidian was launched, no vault touched, no relay contacted. Under this workflow a green suite is a **precondition**, not a completion; the live arm is W4's.
- That the fix scales to a manifest of N host-held canvases. `mirrorSharedCanvases` is sequential and each path is independently wrapped, so I expect N binds and N cold opens at session start — **that is a cost W4 should watch**, and it is the same amplification WP79's charter §5 flagged for the host seed. I did not measure it.

---

## 7. What I could not separate (§3.6)

- **The seed merge from the bind, in `tp02a`/`tp03a`.** Both run inside one pass. I mitigated it by asserting the doc state explicitly before the bind in every row and by declaring the modelled paths in the harness header, but a single row cannot attribute a disk record to "the merge put it in the doc" versus "the flush put it on disk". `tp02b`, which binds *before* the edit exists, is the row that separates them, and it is why I kept it.
- **`tp03d`'s two effects.** The hoist both destroys and triggers the conflict copy; I assert both, but the row cannot say the copy would have fired had the destruction been smaller.
- **`S153`.** WP92's `no_collateral` was **green throughout, uncommitted and committed**. Same as WP121 reported. Its silence is evidence of nothing either way and I claim nothing from it.
- **The `main.ts` call-site count.** `tp06i` asserts 11 `this.armCanvasMirrorPass()` occurrences. Workflow §3.4 is right that grep cannot support exhaustiveness for a **callback**; this is a directly-called private method in one file, which is the narrow case where the textual occurrences *are* the call sites. I state the method used rather than claiming "all of them".

---

## 8. Gate — measured by me, in this session

From `plugin/`, in order:

```sh
./node_modules/.bin/tsc -noEmit -skipLibCheck     # 0 errors
./node_modules/.bin/vitest run                     # 440 files / 3347 tests / 0 failed
npm run build                                      # exit 0
```

then from `workflowArtifacts/canvas-v2/`:

```sh
python check_signal_register.py                    # exit 0
# scanned 247 files under canvas-v2/  (control: all classes proved)
# baselined debt: 136 citations across 62 keys
# clean - no NEW violations. (29 baselined citations have since gone)
```

**Baseline I measured myself at `6f93068` before touching anything: 434 files / 3310 tests / 0 failed, tsc 0.** That matches the Dispatcher's figure exactly. Delta is +6 files / +37 tests, all of them mine (`tp01` 6, `tp02` 6, `tp03` 6, `tp04` 5, `tp05` 5, `tp06` 9 = 37).

**Caveats I attach to this figure:**

1. `tp06` reads the live working copy of `main.ts` (`S88`'s shape). It is red while any batch edits that file, and that redness is not WP122's.
2. `wp5/latency.test.ts` took 38.5 s, one row idling 33.5 s. By design.
3. `S153` did not fire in either state. Not evidence of resolution.
4. Signal numbers: **I allocated none.** Findings are in prose. Next free remains as the Dispatcher set it.

---

## 9. Line numbers I actually found (the charter warned they had moved — they had)

| thing | charter said | measured now |
|---|---|---|
| `armCanvasMirrorPass` declaration | `main.ts:3548` | **`main.ts:3552`** |
| its call sites | 10, at `1372, 1671, 1692, 2227, 2269, 2308, 3484, 4417, 4455, 4471` | **11**, at `1372, 1671, 1692, 2227, 2269, 2308, 3488, 4456, 4494, 4510` + **`2497` (mine)**. Three of the ten had moved. |
| `materialise:` seam | `main.ts:3559` | **`main.ts:3563`** |
| `hasCanvasWriter` | `main.ts:3597` | **`main.ts:3608`** |
| `attachCanvasWriter` | `main.ts:3632` | **`main.ts:3643`** |
| guest-create attach wiring | `main.ts:2492` | **`main.ts:2492`** — exact |
| `coldOpen` | Dispatcher said `canvas-persistence.ts:608`, flush `:613-620` | **`:683`, `docNonEmpty` `:687`, flush `:715`.** *The Dispatcher's own "verified" numbers were stale too — WP121 moved them.* The **facts** were right. |
| host arm of `mirrorOne` | `canvas-mirror.ts:310-323` | was exact; now **`:365-433`** |
| `admitsCanvasMirror` | `canvas-mirror-decision.ts:180-192` | was exact; now **`:225-247`** |
| R5's site | `canvas-create.ts:566-567` | was exact; now **`:590-593`** |

**`main.ts` hunks I own:** exactly two, both pure wiring — `:2497` (`armMirrorPass`) and `:3570` (`bindHostWriter`), each a forwarding arrow to a method `main.ts` already had. **No conditional over canvas state was added to `main.ts`.**

**`S175` did not bite.** I added no `write(`-shaped call near the attach; my parameters are named `path`. `wp87`/`wp88` census rows stayed green throughout, including under every plant.

**`canvas-presence.ts` untouched.** Not read into, not staged, not modified. No pin re-established, none deleted.

---

## 10. Handoff (Rule 13)

### Established, with file and line

| what | where |
|---|---|
| the fourth verdict | `canvas-mirror-decision.ts:72` (`PUBLISH_AND_BIND_WRITER`), host arm `:185-193`, admission `:237` |
| the capability field | `canvas-mirror-decision.ts:142` (`bindsHostWriter`, optional, `=== true`) |
| the bind seam | `canvas-mirror.ts:179` (`bindHostWriter?`), derived `:346`, executed `:414` |
| the host arm | `canvas-mirror.ts:365-433` |
| `bound` in the receipt | `canvas-mirror.ts:118` (type), `:288` (tally), `:299` (log line) |
| R5 | `canvas-create.ts:267` (env member), `:593` (the call) |
| product wiring | `main.ts:2497`, `main.ts:3570` |
| the wiring census | `__tests__/v2/wp122/test_tp06_the_product_wires_both_seams.test.ts` |

### Designs rejected, and why

1. **Rename `PUBLISH` → `PUBLISH_AND_BIND_WRITER`.** Kills the old verdict, breaks every WP79/WP117 row and every existing consumer. Rejected for the optional-degrade design instead, which left the full suite at **3310/3310** with the product change alone.
2. **Reuse `materialise` for the host bind.** Would have made `bindsHostWriter` unfalsifiable — `materialise` is required by the interface, so the capability probe would be a constant `true`, a negative control that cannot fail. A separate optional dep is genuinely absent in every pre-WP122 object.
3. **`bindsHostWriter` as a boolean the caller states.** That is a feature flag wearing an observation's clothes. Deriving it from `typeof deps.bindHostWriter === "function"` takes it from the object that owns the answer.
4. **A `hasCanvasWriter`-driven verdict** (`PUBLISH` when already attached, `PUBLISH_AND_BIND_WRITER` when not). Rejected: the read races the attach, and it would have put a second definition of "already attached" outside `main.ts`.
5. **Arm (b).** §1.2, priced.
6. **The `records` clause.** §2, blocked.

### Residuals left deliberately

1. **B3's `records` clause — needs its own package.** Sized: it must amend `wp116/test_s158_…` at `:232`, `:315` and `:347-353` (a landed-AC change, owner-visible) **and** decide the `parseCanvas` question against `wp72`'s frozen allow-list at `:33-39`. Both are decisions above a worker's pay grade, which is why this is a package and not a follow-up line.
2. **The seed's upsert direction on rejoin** (§1.1). A host's stale `.canvas` re-proposes its own geometry over a peer's newer position. Landed WP18/WP29 semantics, out of WP122's declared scope, and squarely in the territory the owner **deferred**. Worth a signal.
3. **The refusal arm of §4**, argued not demonstrated. It sits next to `S176`'s silently-degrading arm.
4. **Cost at scale**: N binds and N cold opens at session start on a manifest with N host-held canvases. Unmeasured; W4 should watch the join.
5. **The charter's §5 plant description** is corrected in §3.1 and the charter file itself is **not** edited — it is the Dispatcher's artefact.
6. `workflowArtifacts/canvas-v2/temp.md` is untracked and **not mine**; I left it alone.

### For W4, in one paragraph

Start a session with a **host-created** `.canvas` in the share that nobody opens. On the host, `canvas.mirror` should now report `bound=N` alongside `published`, and the host's writer registry should hold the path — check `canvasEditingSignal(path).hasWriter`, **not** the mirror report (`S138`). Then have a guest move a card. The host's **file** should follow within a debounce, where before it did not follow at all. The two things worth watching that I could not measure headlessly: **(i)** the cost of N simultaneous binds at join, and **(ii)** whether any conflict copy appears beside the share on the first session after this lands — that would be WP121 firing on a board that was already divergent, which is **correct behaviour and will look alarming**, so it should be counted rather than treated as a regression.
