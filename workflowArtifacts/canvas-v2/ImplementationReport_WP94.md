# Implementation Report — WP94: the delete licence has one issuer, and the user never meets it

**Batch:** B55 · **Worker 3 (Execution)** · **Phase P0**
**Branch:** `fix-bugs-and-raceconditions` · **Commits:** `c4ba2f1`, `6125994`, `dc7f1af`
**Baseline measured at HEAD `73b43da`:** 2653/2653 tests, 370/370 files, zero failures, 42.45 s
**Final gate measured:** **2717/2717 tests, 378/378 files, zero failures** — `npx tsc -noEmit -skipLibCheck` clean

---

## 1. What was changed, with re-measured citations

All three production files were byte-identical to the charter's citations when I
started, verified by `git hash-object`: `canvas-shadow.ts` `b6244c94`,
`canvas-sync.ts` `5fef347b`, `canvas-persistence.ts` `613d8282`. Rule 4 was
verbatim at `canvas-shadow.ts:566-579`, gate B at `:574`. Rule 5 was a no-op this
time, as the coordinator predicted.

### `plugin/src/canvas/canvas-shadow.ts`

| what | where (pre-change) |
|---|---|
| `ReceiptSurface`, `DeleteWithholdReason`, `DELETE_WITHHOLD_REASONS`, `DeleteEvidence`, `DeleteVerdict`, `judgeDelete` — the criterion as a pure total function | new, inserted before `SurfaceState` at `:347` |
| `SurfaceState.receipts?` — the P2 ledger, per id, tagged with its surface | `:347-353` |
| `ParsedSave.complete?` — `Complete(save)`, per kind | `:335-339` |
| `IntentPlan.withheld` + `WithheldDelete` — the fourth first-class output | `:388-392` |
| rule 4 rewritten onto `judgeDelete`; the `if (surface.viewOpen)` gate removed | `:566-579` |
| `receiptsFor` — merges P1 and P2, de-duplicated | new |

**Purity unchanged.** Still exactly one import, type-only. Asserted by a driven
test (AC8), not by inspection.

### `plugin/src/files/canvas-sync.ts`

| what | where (pre-change) |
|---|---|
| `parseCanvasReport` + `CanvasParseReport`; `parseCanvas` becomes a thin wrapper | `:582-613` |
| `measureCompleteness` — the four `Complete` conjuncts | new, beside `planCapture` `:3425` |
| `fileReceipts` ledger + `recordSurfaceObservation` + `surfaceEvidence`/`surfaceEvidenceFor` | new, near `:2280` |
| `deleteWithholds` counters, `noteDeleteWithholds` (one emitter), `deleteWithholdCounts()` | new, beside `declineCapture` `:3156-3172` |
| `applyIntentPlan`: `captureRefused` veto, `endpointHold`, `gestureHold`, `refused-at-ingest` membership veto | `:3785-3800` |
| host seed excludes refused ids from `advanceShadowFromContent` | `:2927` |
| `advanceShadowFromContent` takes an optional `refused` set | `:3829-3855` |

**Not touched, asserted by running the diff:** `plugin/src/main.ts`,
`plugin/src/files/vault-events.ts`, `plugin/src/files/file-ops.ts`,
`plugin/src/files/canvas-sidecar.ts`. No wiring line was needed — both new
producers are methods of `CanvasSync`, and the merge happens at the single point
of consumption. No ESCALATE arose.

---

## 2. The order in which `Complete` and the widening landed

**`c4ba2f1` — `Complete` alone. `6125994` — the widening.** Two commits, in that
order, and the gap is provable rather than asserted.

**Evidence that the destruction path was never open in between.** At `c4ba2f1`
the delete-candidate set is a strict **subset** of the pre-WP94 one, for three
independent reasons, each checkable in that commit's diff:

1. **`receipts` had no producer.** `SurfaceState.receipts` existed as an optional
   field and nothing in production ever populated it, so `receiptsFor` could only
   ever return `handedToView`'s verdict — byte-for-byte the pre-WP94 licence set.
2. **The `viewOpen` gate was still in place**, carrying an explicit comment
   naming its removal as the next commit. S84 was not repaired at `c4ba2f1`.
3. **`Complete` can only subtract.** Every conjunct returns `false` on failure and
   a `false` withholds; no conjunct can turn a non-candidate into a candidate.

So at `c4ba2f1` the product deleted exactly what it deleted before, minus
whatever the completeness proof withheld. The full suite was green at that commit
(2668/2668, 371/371) and the AC3 suite — the inversion guard, all five truncation
shapes plus the two discrimination rows — was green there too. The widening
landed only once that was true.

---

## 3. Each AC, with its vacuity discharge

| AC | status | how the named vacuity was discharged |
|---|---|---|
| **AC1** the loss reproduced headless through the real producer | **met** | The store is the real `createSurfaceStateStore`, wired as `main.ts` wires it; the hand-over set is asserted `size === 0` at the instant of the deleting save (**(a)**, the killer). The **create half** is asserted landed in the same run and all six decline counters asserted unmoved (**(b)**). The oracle is `readTombstoneEntry` + the projection, never `nodesMap.has` (**(c)**). The fixture vault's bytes are asserted before the doc (**(d)**). |
| **AC2** the criterion, explicit and pure | **met** | 96 cells asserted against a **restatement of the four conjuncts**, not against the implementation's branch order (**(a)**); every cell reachable, none decorative (**(b)**); **both** wrong-surface rows present and driven (**(c)**); `Complete` supplied by the real producer in the corners (**(d)**). |
| **AC3** an incomplete observation deletes nothing | **met** | (iv) and (v) are both present and are the two that can fail (**(a)**); the paired positive — a genuine wipe deletes N — is reported beside every zero (**(b)**); receipts asserted non-empty before anything is read (**(c)**); conjunct 2 driven through an I/O seam returning **different bytes on the two reads**, with the equal-bytes control green beside it (**(d)**); `noteExternalDiskWrite` asserted still to receive the writer's in-memory string, by counting reads (**(e)**). |
| **AC4** edge, node, node+edge | **met** | Every edge row's oracle is the tombstone, and one arm deletes an edge **whose endpoints both survive** (**(a)**); the licence split is per kind and asserted (**(b)**); the geometry branch is asserted taken, and S82 itself is asserted as a measured fact so the arm cannot go vacuous (**(c)**); the failed-reload row observes the **licence set before and after**, never `reloaded` (**(d)**). |
| **AC5** a refusal is not a deletion | **met** | The refusal is asserted **as state** from the ledger, never from a log (**(a)**); a licensed control deletes in the same run (**(b)**); headless only, by decision, per S80 (**(c)**). |
| **AC6** named and counted | **met** | Every primary observable is a **positive non-zero**; no zero is primary evidence anywhere in the file (**(a)**); all four reasons have fixtures, so none is decoration (**(b)**); nothing is asserted by absence from the log (**(c)**); the count is **per record**, proved with a four-record fixture (**(d)**). |
| **AC7** the closed board (S84) | **met, headless** | Subscription and closed-board state both asserted before anything is concluded, and the six decline counters read and shown unmoved (**(a)**); per-run fixtures, no shared state (**(b)**); headless, so no bundle digest applies (**(c)**); the create half is asserted landed first (**(d)**). Live rows are W4's. |
| **AC8** no collateral | **met** | All five behaviours **driven**, and each shown to redden when its guard is removed (**(a)**); the full-suite figure is quoted with its provenance (**(b)**); the four B53-owned files are shown absent from the diff by running it (**(c)**); S70 was not tripped — the new suites add no `endSession` literal (**(d)**). |

---

## 4. The break table — including the breaks that produced no red

Every break was applied to the working copy, run, and restored by copying the
file back from a copy taken aside (never `git checkout`, never `git stash`).
Restores verified byte-identical with `git hash-object` after each campaign.

| # | break | red? | what went red / what I concluded |
|---|---|---|---|
| **A** | `Complete` conjunct 1: `parseOk = true` (ignore `degraded`) | **NO RED** | **Reported, not hidden.** Conjunct 1 is **subsumed by conjunct 3**: a parse that threw reports both kind keys absent, so `complete` is already `false`. The conjunct is kept because it *names* the reason and is the fact a future caller that only asks `degraded` would rely on — and it is pinned at unit level instead (break A′). This is recorded in the AC3 test header so the next reader does not mistake it for load-bearing. |
| **A′** | `parseCanvasReport`'s catch branch reports `degraded: false` | yes | `(i)-(iii) unparseable input is reported as degraded` — *"truncation at 25% was not reported: expected false to be true"* |
| **B** | `Complete` conjunct 3: ignore `hasNodesKey`/`hasEdgesKey` | yes | `(iv) {"nodes":[]} with NO edges key` — *"a MISSING `edges` key was read as `every edge was deleted`"* |
| **C** | `Complete` conjunct 2: never compare the confirming re-read | yes | `two reads of one pass that disagree` — *"an unstable read tombstoned n1"* |
| **D** | `Complete` conjunct 4: `captureRefused = false` | yes | `conjunct 4 — a capture-boundary refusal` — *"a save the boundary partly refused was still read as a complete picture"* |
| **E** | the **`Receipt` conjunct removed** — the naive rule | yes, **12 rows** | Including `wp5v2` **T1** and **T3**. This is the I11-inverted rule, and it reddens the two deliberately-argued I7 tests as well as every unlicensed arm. |
| **F** | surface matching removed (any receipt licenses any surface) | yes, 5 rows | Both wrong-surface rows, the AC7 mirror, the AC6 `no-open-surface` counter, and the truth table. |
| **H** | the gesture / cascade endpoint hold removed | yes, 3 rows | `NODE+EDGE where only the NODE is unlicensed` — *"THE HALF-APPLY: the arrow was tombstoned while its card survived"* |
| **I** | the seed's refusal exclusion removed | yes, 3 rows | Including *"a record refused at the seed could never be created again once the file was repaired"* |
| **J** | the withhold counters never advance | yes, 10 rows | Every AC6 row plus `wp5v2` T1's new discrimination. |
| **K** | **P2 issuance removed** — the widening undone | yes, 14 rows | **This is the answer to "the test that would go red if the licence regressed".** AC1's three rows go red first, headed by *"the user's own deletion was silently discarded: expected false to be true"*. |
| **L** | receipts **accumulate** instead of replacing | yes — but **only the WP23 fuzzer** | Caught by `wp23/test_tp01` at seeds 6221190 and 6221252, and by **nothing in `wp94/`**. That gap was the finding; see §5. |
| **L2** | the same break, after adding the deterministic row | yes | `A RECEIPT IS WHAT THE SURFACE HELD LAST TIME` — *"a receipt survived an observation of the same surface that did not carry it"* |
| **M** | an incomplete observation **revokes** receipts | yes | `an INCOMPLETE observation neither issues receipts nor revokes them` — *"a truncated read revoked a valid receipt"* |

**Break A is the one worth reading.** It reddened nothing, and the reason is a
genuine structural fact rather than a weak test: two of AC3's four conjuncts are
nested, not independent, and the charter assumed they were independent.

---

## 5. Three defects in my own widening, all found by tests rather than by argument

The first draft of the widening passed every `wp94` test I had written and was
still wrong three times over.

**(1) Receipts accumulated.** `issueReceipts` used `Map.set`, so a record observed
once held a licence for ever — which is literally *"any past knowledge licenses
any future absence"*, the degeneracy the charter told me to avoid and which I had
nonetheless written. The **WP23 convergence fuzzer** found it (seed 6221142,
4 replicas): a replica saved edge `se0` once, its surface later stopped carrying
the record, and a subsequent save of the same surface spent the stale receipt on
an edge no op had touched — destroyed on all four replicas, converged and wrong.
The production analogue is exact: a client whose canvas view has not yet caught up
with a peer's record saves a file that omits it. Fix: **a complete observation
replaces that kind's receipt set**, per kind, and an incomplete one neither
issues nor revokes.

**(2) WP19 AC3's cascade fed back.** The `.canvas` file is written from
`buildCanvasData`, which refuses to emit an edge whose endpoint node is
tombstoned. So deleting a card removes its arrows *from the file*, and the next
capture read that suppression as a deletion of the arrows. Same seed, second
mechanism, found after fixing the first. An independent tombstone on the edge
would also break undo — restoring the card could never bring its arrows back.
Fix: an edge whose endpoint is withheld, going in this pass, or already
tombstoned is not deletable by omission, charged `incomplete-observation`.

**(3) P3 is not an issuer — a measured deviation from the charter's scope.** The
charter names three producers and `noteExternalDiskWrite` as the sharpest of them,
on the strength of its own comment (*"with no open Obsidian canvas the FILE is
the surface"*). Both halves of that comment are true and they still do not add up
to a delete licence: it proves what **we** wrote to the file, never what the
**next writer** had read. Wiring it as an issuer reddened
`wp91/test_tp05` **T2** — a peer's record lands, `CanvasPersistence` projects it
to disk, and the user's editor still holding the pre-projection bytes saves
without it, tombstoning a record the user never saw. That is I11 inverted and the
exact two-step chain WP91 AC4 exists to pin.

**Nothing is lost by the omission.** AC7's closed board still captures its
deletions, through **P2**: a record the local writer has actually saved earns a
`"file"`-tagged receipt from that save. The charter's AC7 predicted the repair
would land "through the P3 receipt"; the observable outcome is identical and only
the attribution differs. A consequence worth noting: **`wp4/test_tp01` T3 is
therefore unamended and still green on its original I7 argument.**

---

## 6. The S83 interaction — reported, not fixed

S83 stands exactly as the register describes it. A structural pass with
`reloaded === false` gives every receipt line `"failed"`, `summary.handed` is
empty, and `noteHandover` **replaces** rather than merges — so one pass that
nobody classifies as an error writes an empty set over the P1 licences for the
whole path.

**WP94 does not repair that, and it does change its blast radius.** P2 lives in
`CanvasSync`'s own ledger, deliberately not inside `main.ts`'s
`SurfaceStateStore`, so `noteHandover`'s wholesale replacement **cannot reach
it**. After a failed reload, P1 is empty and the user's own deletions still land.

This is a consequence of where the ledger was put, not a fix, and it is asserted
as such in `wp94/test_ac4_…` (`S83, ADJACENT AND NOT REPAIRED HERE`) so a later
reader cannot mistake it for one. **The revocation mechanism itself is untouched
and still needs owning.**

---

## 7. The I7 argument for the `test_tp05` T1 amendment

**T1 passes unchanged.** Its record reaches the doc through the **host seed**, and
WP29 is explicit that a seed has no opinion about deletion — so the seed issues no
receipt, the record holds no licence, and the omission is ignorance exactly as T1
says. T1 was **incomplete, not wrong**, and the amendment is a strengthening with
every original assertion kept verbatim.

The criterion, quoted rather than paraphrased:

> `Delete(X)` ⇔ `Receipt(X, surface)` ∧ `Complete(save)` ∧ `Present(X)` ∧ `¬Seen(X, save)`
>
> **Absence never authorises. A receipt authorises; absence only selects which
> authorised record to spend it on.** Delete the `¬Seen` conjunct and **nothing**
> is deleted. Delete the `Receipt` conjunct and **everything** is.

I7 says a partial report must never be read as *"the rest is gone"*. The criterion
satisfies it in two independent ways, and WP94 changes **who may issue** a
receipt, never **whether one is required**:

- **`Receipt` is a positive, per-record, per-surface fact.** It is never derived
  from an absence, and it is spendable only on the surface it names. Widening the
  issuer set from one to two adds facts the product already asserts; it does not
  make absence into evidence.
- **`Complete` is measured**, so an observation that cannot be shown to be a full
  picture of the surface deletes nothing at all, whatever receipts exist. That is
  I7 applied to the **observation** rather than to the record, and it is the
  conjunct that keeps a truncated read from destroying a board.

**What T1 could not tell apart, and why it needed amending.** A green there was
equally consistent with *"the record had no licence"* and with *"the delete rule
never ran at all"* — and the second was in fact true for every closed board (S84)
and every locally created record (S78). The added assertion charges the reason
positively, so a build that disabled rule 4 outright now fails at T1. Break **E**
(the `Receipt` conjunct removed) reddens T1 and T3 together, which is the
demonstration that the I7 protection is still live.

**T2–T5 are untouched. T3's outcome is unchanged**, because the AC4 repair is at
the *gesture* rather than at the licence: the card the user is holding still earns
no licence and is still never deleted by a save it never saw — and now its arrows
are not either. **No ESCALATE arises.**

---

## 8. The full-suite figure, and the S74 caveat

**2717/2717 tests, 378/378 files, zero failures**, measured by me at `dc7f1af`.
Baseline re-measured by me at `73b43da` before starting: **2653/2653, 370/370,
zero failures, 42.45 s**. Net +64 tests, +8 files, all WP94's.

`wp5/latency.test.ts` (S74) passed in every full-suite run I made — five of five.
I am not claiming S74 is closed; I am reporting that it did not fire for me.

S88 did not fire: WP94 touched neither `file-ops.ts` nor `vault-events.ts`, so
`v2/wp93/`'s census tests were never transiently red.

---

## 9. Things in the tree I did not write

- **`workflowArtifacts/canvas-v2/DISPATCHER_STATE.md`** — changed by `a8b9a7a`
  (*"dispatch: B55 + B56 resumed from transcript"*), which landed on the branch
  while I was working. Not mine, not in my commits.
- **`check_signal_register.py` reports one NEW violation key that is not mine**
  (`DISPATCHER_STATE.md`, line 2884), added by `a8b9a7a`:

  ```text
  UNKNOWN  DISPATCHER_STATE.md  S90  0 -> 1  (line(s) 2884)
  ```

  The offending line is the Dispatcher's own bookkeeping row recording which
  number is next free. It is a line **about** the numbers, which is precisely the
  case section 5 says to mark `<!-- signal-register: meta -->`. It is the
  Dispatcher's file and the Dispatcher's bookkeeping, so **I have not edited it**.
  **No WP94 file is flagged**, and this report's own citations of that number are
  inside fenced blocks, which section 5 exempts.
- `plugin/src/files/canvas-sidecar.ts` showed as modified when I first looked
  (CRLF, byte-identical normalised hash); the coordinator had already restored it
  to LF by the time I resumed. Untouched by me.

## 10. Proposed to the Dispatcher — I allocate no signal numbers

<!-- signal-register: meta -->
1. **A signal for the receipt-staleness class**, which is new and which I
   introduced and then removed within this WP: *a delete licence derived from a
   past observation of a surface is unsound unless every complete observation of
   that surface replaces it; an accumulating licence set turns a client whose view
   has not caught up into a destroyer of peers' records.* Found by the WP23
   fuzzer, not by review. Needs a number.
2. **A signal for the cascade feedback**: *the `.canvas` file is written from
   `buildCanvasData`, which suppresses an edge whose endpoint node is tombstoned,
   so the projection's own suppression is readable back as user intent by the next
   capture.* Structural, and it will recur anywhere a capture reads a file the
   projection wrote. Needs a number.
3. **§9 WP94 row and §10 `DELETE WITHHELD:`** — already landed. The §10 reason set
   is implemented exactly as registered:
   `no-open-surface | no-receipt | incomplete-observation | refused-at-ingest`.
   No fifth member was added; the closed `CAPTURE DECLINED:` set still has exactly
   six members and gained nothing.
4. **S82 is narrowed, not closed.** `buildApplyReceipt`'s branch asymmetry is
   untouched — an edge is still always confirmed in the geometry branch and a held
   card still is not. What WP94 removes is the *user-visible consequence* (the
   arrow can no longer land in the opposite direction from its card). The receipt
   still answers two different questions with one value.
5. **S78 and S84** are repaired headless and await W4's live confirmation.
   **S83** is untouched; its blast radius is reduced but its mechanism is intact.
