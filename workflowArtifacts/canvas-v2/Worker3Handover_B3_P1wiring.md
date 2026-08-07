# Worker 3 Handover — Canvas V2, Batch 3 / P1 wiring

**Batch:** B3 · **Phase:** P1 (wiring) · **narrow_scope:** WP18, WP19, WP20, WP21, WP22, WP23
**Outcome returned to Dispatcher:** `ESCALATE_TO_WORKER2`
**Date:** 2026-08-01

---

## Headline

**WP18 cannot be completed as chartered, and the blocker is not an implementation problem.**
Wiring WP14's ingest validator at the local write boundaries — which is literally WP18 AC1 —
causes **30 failures** in the existing suite. The failures were classified by measurement, not by
argument, and **none of them is a coder defect** (class B is empty, established by a counterfactual
run with the gate forced open: 30 → 5, and the 5 are the WP18 tests that fail by construction when
refusal is disabled).

**The single most important finding is not the test count. It is this:**

> WP9/WP10's endpoint model **cannot represent a legal JSON Canvas edge.** `fromSide`/`toSide` are
> **optional** in the JSON Canvas format. WP10's `encodeEndpointFromFile` builds an endpoint register
> only from a whole `{node, side}` pair (`encodeEndpoint` **throws** on an empty `side`), and
> `isEndpointRegister` reads a side-less value back as **absent**. So a fully-connected, perfectly
> legal side-less edge has **no representable V2 endpoint**, WP14 reports `MISSING_FROM`, and WP18
> refuses it.
>
> Because `CanvasPersistence.flush()` then writes the doc back over the file, **the user's edge is
> deleted from their own `.canvas` file.** This is silent data loss on a legal document, not a test
> artefact. `migrateV1ToV2` cannot rescue it either — `migrateEndpoint` calls the same encoder — so
> such an edge is permanently unrepresentable rather than merely un-migrated.

This is a defect in a **frozen** module (WP10, landed DONE in B2) surfaced only by wiring it into a
live path. It needs a Worker 2 ruling; Worker 3 has no licence to change WP10's model, WP14's rules,
or the 29 affected baseline tests.

---

## Tree state — stated plainly

**The plugin suite is RED: 1219 tests, 1189 passed, 30 failed.** `tsc -noEmit -skipLibCheck` is clean.
All 15 WP18 visible tests pass.

**I could not restore the green baseline, and the reason matters.** The entire Canvas V2 initiative
— B1, B2, B10 and the concurrent T3 work — is **uncommitted working-tree state** on top of commit
`e9c7e6f`. `canvas-sync.ts` and `canvas-persistence.ts` therefore carry B2's WP16/WP17 work and my
WP18 work in the same unversioned diff, with no pre-WP18 snapshot between them. A `git checkout` of
either file would destroy B2's work. Reverting was judged more dangerous than reporting honestly.

**Consequence for the next agent:** the 30 failures are confined to three files
(`canvas-sync.test.ts` 22, `canvas-persistence.test.ts` 5, `w4-canvas-integrity.test.ts` 3 — counts
re-measured by Worker 3 Core at handover, 11 failing suites of 495) and every
one is enumerated with its fixture and failing conjunct in
`ImplementationReport_WP18.md` §"Residual failure classification". Nothing else in the tree regressed.

**Process finding worth acting on:** a batch that modifies files carrying earlier uncommitted batches
should snapshot them before the first coder attempt. I did not, and that removed my ability to hand
back a green tree. Cheap to fix, expensive to lack.

---

## Per-WP status

| WP | Title | Status | risk_flag | Note |
|---|---|---|---|---|
| **WP18** | Ingest + create-once wiring | **BLOCKED — ESCALATE** | **HIGH** | ACs implemented; 30 baseline failures are spec-level, not implementation |
| WP19 | Tombstone wiring | **NOT STARTED** | — | `Depends on: WP12, WP15, WP18` |
| WP20 | Quarantine auditor | **NOT STARTED** | — | `Depends on: WP12, WP14, WP19` |
| WP21 | REMOVAL: lock write-denial | **NOT STARTED** | — | red tree makes "no regression" unmeasurable; its ledger targets sit in the same 22 failing `canvas-sync.test.ts` tests |
| WP22 | REMOVAL: `writeRecordMinimal` deletion | **NOT STARTED** | — | `Depends on: WP14, WP18` |
| WP23 | Convergence fuzzer | **NOT STARTED** | — | `Depends on: WP17, WP19, WP20` |

**Why I stopped rather than continuing round the blocker.** Every remaining WP either declares WP18
as a dependency or needs a measurable baseline to prove it regressed nothing. WP21 is the closest to
independent — and its deletion ledger operates on exactly the `canvas-sync.test.ts` tests that the
WP18 ruling will decide the fate of, so doing it first would have to be redone. Attempts consumed:
**WP18 2 of 3**; no other WP consumed any.

---

## The WP8 migration call site — the question I was asked to answer

**Answer: the gap is closed, and the call site is `CanvasPersistence.coldOpen()`.**

`migrateV1ToV2` had no production caller; verified independently — the only callers anywhere were
WP8's own tests. It is now called from `coldOpen`, **after** the seed, on both record-bearing paths:

- doc **non-empty** (the real V1-from-relay case) → migrate → `flush()`
- doc **empty** + file present → seed from file **first** → then migrate
- doc empty + no file → **not** migrated (no `meta` stamped on a recordless doc)

**Why after the seed, not before.** My first directive said "before the split", and it was wrong.
The migration guard is one-shot, so stamping `meta` first forces everything seeded afterwards to
already be V2 — which is why attempt 1 retired WP16's `decodeCanvasDataToFlat` bridge and broke the
pre-V2 suite. Migrating *after* the seed gets the same guarantee with none of that: whatever the
seed wrote is translated, and retiring the bridge stops being necessary at all. Retiring it was
never a WP18 acceptance criterion — that was B2's forward-plan, not a chartered obligation.

**What proves a V1 doc actually migrates** (rather than the seed happening to write registers):
`test_tp11_cold_open_leaves_no_record_unmigrated_*` asserts `coldOpen`'s post-condition on both
branches and uses **`ord` presence** as the discriminator. `ord` is assigned only by `assignOrds`
inside the migration, so a record carrying an `ord` is proof the migration passed over it. Credit
for that oracle goes to the unit-test sub-agent; it is sharper than the vocabulary check I asked for.

**Caveat, stated so it is not over-claimed:** this is proven at unit/injected-seam level. It has
never run against a real Obsidian vault (the standing R2 gap). And because the ruling below may
change the seed boundary's behaviour, the call site is correct but its *surroundings* are not final.

---

## Escalation to Worker 2 — three rulings needed

### E1 (CRITICAL) — side-less edges are unrepresentable in the V2 endpoint model

- **What:** JSON Canvas makes `fromSide`/`toSide` optional. WP10's endpoint register requires a
  whole `{node, side}`; `encodeEndpoint` throws on an empty side; `isEndpointRegister` reads
  side-less as absent. WP14 → `MISSING_FROM`. WP18 refuses. `flush()` then removes the edge from the
  user's file.
- **Blast radius:** 7 failing baseline tests, and — far more importantly — **real user data**.
- **Not fixable below Worker 2:** inventing a default side would admit a record `migrateV1ToV2`
  also cannot convert (same encoder), leaving the doc permanently in the state WP20 exists to
  quarantine. The coder correctly refused to fabricate one.
- **Question:** does the V2 endpoint model gain a side-less form (WP10 reopened), or does WP14 stop
  requiring a side, or is the seed boundary made non-destructive (see E2)?

### E2 (HIGH) — is refusal the right answer at the *seed* boundary at all?

- **What:** AC1 says an invalid local record "never reaches the doc". At the **capture** boundary
  that is protective — it stops a stale view model proposing garbage. At the **seed** boundary the
  input is *the user's own file*, and refusal is **destructive**: the record is dropped and then
  `flush()` writes the doc back over the file.
- Meanwhile WP20 exists precisely to handle invalid records **non-destructively** — tombstone
  `{on:true, q:true}`, field containers preserved, quarantine lifted when a later delta repairs them.
- **Blast radius:** 22 failing baseline tests whose fixtures are legacy shorthand genuinely invalid
  under WP14 — nodes with no `type` (12), `text`/`file` nodes with no payload (7), nodes with no
  `width`/`height` (3). These shapes would not occur in a real Obsidian file; they are test
  sloppiness. But **fixing them means editing 22 baseline tests, which needs an explicit licence**
  (§7: an unenumerated assertion rewrite is an abort criterion).
- **Question:** (a) grant WP18 a licence to update those 22 fixtures to schema-valid records, or
  (b) phase AC1 so the seed boundary **quarantines** (WP20) instead of refusing, keeping refusal for
  `CAPTURE_NET`? Option (b) also dissolves E1 and is, in my read, the more defensible product
  behaviour — but it changes a chartered AC and is therefore not mine to choose.

### E3 (MEDIUM) — the chartered migration call site vs. a baseline invariant

- **What:** the charter requires the doc-wins branch to migrate an unstamped V1 doc. The baseline
  test `canvas-persistence.test.ts > "non-empty doc + stale file → doc wins, file overwritten, NO
  file→CRDT read"` asserts `tx.count() === 0` over that same fixture class. Migrating opens a
  transaction. `countTransactions` hooks bare `afterTransaction`, so there is no loophole.
- **Note:** the test's *subject* is "no file→CRDT read". A migration transaction is a doc-internal
  translation, not a file read — so this looks like an **instrument over-specifying its subject**,
  the same shape B2 resolved for the WP3/WP16 conflict. That would make it an *amendment*, not a
  deletion. But WP18 is on neither the licensed-deletion nor the licensed-amendment list.
- **Question:** amend that one assertion under §7's amendment class (strictness held), or move the
  migration call site?

---

## Deletion ledger

| WP | Test title (verbatim) | File | Reason | Replacement coverage |
|---|---|---|---|---|
| WP18 | ``T1 DISCRIMINATION `fromNode`: intact guard keeps the endpoint through the host seed, disarmed guard loses it`` | `plugin/src/__tests__/v2/wp4/test_tp08_protected_keys_seed_discrimination_visible.test.ts` | Pure discrimination pair: requires the **disarmed** run to LOSE the endpoint. WP18 AC3 abolishes absent-key deletion, so both runs agree and the pair proves nothing — unsatisfiable exactly as WP4's `A9`/`A10` became. | None possible: after AC3 no boundary deletes absent keys, so no live boundary can host the discrimination. `PROTECTED_KEYS` membership stays pinned by `w4-canvas-integrity` A8 and WP3 `blind_set1/test_geometry_keys_drift`. |
| WP18 | ``T2 DISCRIMINATION `toNode`: intact guard keeps the endpoint through the host seed, disarmed guard loses it`` | same file (whole file removed; these are its only two tests) | same | same |

**Verified before deleting:** no blind counterpart exists (WP4's blind sets stop at `tp07`), and there
is no artifact source-of-truth copy — `tp08` lived only in the plugin tree.

**Nothing else was deleted, weakened, skipped or `.only`'d anywhere in this batch.** WP21's and
WP22's ledgers are empty because neither WP ran.

> ### ⚠ §7 list omission — needs a one-line Worker 2 ratification
> **BUILD_SPEC §7's licensed-deletion list is `WP4, WP21, WP22, WP33`. WP18 is not on it** — yet the
> **WP18 charter itself** (§4 amendment note, 2026-07-31) explicitly orders this retirement *by name*:
> *"Retire it here, by name, under the same deletion-ledger rule (§7) — do not weaken it and do not
> leave it red."*
> I proceeded on the charter's explicit instruction and enumerated both tests above, because §7's
> operative licensing condition is *enumeration by name in the implementation report*, which is
> satisfied. But the **list** was not updated, and I have no authority to edit the BUILD_SPEC.
> **Please append WP18 to the §7 licensed-deletion list, or instruct me to restore the file.**
> Until then this batch's test-count drop of exactly 2 is enumerated but not list-licensed.

---

## Blind-set evidence

**Per the mandatory evidence rule, blind results are reported with executed-test counts — and I am
not reporting a pass, because none was ledgered.** WP18's blind sets were staged and executed by the
unit-test sub-agent (24 files, ~30 tests collected, running and failing for the intended reasons),
but they were **deliberately not run through the WP55 runner**, so no `_blind_records/` entry exists.

**Per §7's retro-applied gate, a blind claim without a ledger record is unverified regardless of what
any handover says. WP18's blind sets are therefore UNVERIFIED, not green.** They must be re-run under
`python _run_blind.py WP18 both` once the ruling lands and the implementation is final — running them
against an implementation that is about to change would produce a number with no shelf life.

No other WP in this batch has blind sets.

---

## What the next Worker 3 run inherits

1. **Three rulings** (E1, E2, E3). E2 is the pivotal one — option (b) collapses E1 as well.
2. **A tree at 30 failures**, fully enumerated, class B empty, in three files.
3. **WP18's implementation is substantially correct and worth keeping**: one shared gate
   (`admitRecordIngest`) at all three local boundaries branching on WP14's `verdict.reject` and never
   re-deriving rejection from origin; create-once via draft → detached `Y.Map` → single attach;
   `applyToYMap`'s absent-key delete loop retired (AC3/I7); `PROTECTED_KEYS` preserved as an exported
   constant; the migration call site wired.
4. **A real corruption bug fixed in passing, worth keeping regardless of the ruling.**
   `decodeV2RecordToFlat` resolved flat-vs-register collisions by **`Y.Map` insertion order**, so a
   moved card could snap back to its pre-move coordinate on disk — **and both replicas agree on the
   wrong value, so cross-replica byte equality cannot detect it.** Now an explicit two-pass precedence
   (flat wins in P1). Four previously-green tests caught it. This is the same "byte equality is not a
   sufficient oracle" class WP17 found, arriving from a different direction.
5. **`SharedOwnershipContract_B3_P1wiring.md`** — written, unused so far, still binding for WP19–WP23.
   Its §2.1–2.3 (the `deleted` map name, the Lamport `t`/`by` allocator, the shared validity
   predicate) are the collision risks WP19/WP20 will hit immediately.
6. **A snapshot discipline** — snapshot files carrying earlier uncommitted batches before the first
   coder attempt, so a red tree can always be handed back green.
