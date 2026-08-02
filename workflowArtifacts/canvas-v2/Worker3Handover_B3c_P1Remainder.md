# Worker 3 Handover — B3c, P1 Remainder (canvas-v2)

**Batch:** B3c — `narrow_scope` = WP19, WP20, WP21, WP22, WP23
**Status returned to Dispatcher:** `ESCALATE_TO_WORKER2` (one blocking licensing question — WP19)
**Everything else in the batch is DONE and green.**

---

## 1. Scope of This Run

Tasks completed: **WP20, WP21, WP22, WP23** — all DONE, all blind sets green.
Task blocked on a ruling: **WP19** — implementation complete and green on its own ACs; blocked
only by a test-licensing question that Worker 3 has no authority to settle.

---

## 2. Gate Status

| Gate | Result |
|---|---|
| `npm test` (from `plugin/`) | **1346 tests · 1338 passed · 8 failed** |
| `npx tsc --noEmit` | **clean** (`TSC_CLEAN`) — measured with **no blind run in flight** |
| `npm run build` | **PASS** (exit 0) |
| Blind staging | clean after every run — no `v2blind` dir leaked |
| Protected paths | `canvas-presence.ts`, `manifest.json`, `package.json`, `server/`, `docker/`, `deploy/` — untouched (`git status` empty for all) |

**The 8 failures are the WP19 escalation and nothing else.** They are enumerated in §5.

### Test-count accounting — every test accounted for

| Step | Δ | Running total |
|---|---|---|
| Baseline at batch entry (measured by Worker 3 Core, not inherited) | — | **1271** |
| WP19 visible tests added | +8 | 1279 |
| WP20 visible tests added | +9 | 1288 |
| WP21 visible tests added | +20 | 1308 |
| **WP21 licensed deletions** | **−8** | 1300 |
| WP22 visible tests added | +16 | 1316 |
| WP23 visible tests added | +30 | **1346** |

Net **+75 tests, −8 deletions**. The only deletions in the entire batch are WP21's 8, each
enumerated by name in §6. **Zero tests were skipped, `.only`'d, retitled, weakened or softened
anywhere in this batch.**

---

## 3. Per-WP Table

| WP | Status | What landed | risk_flag | Priority for W4 |
|---|---|---|---|---|
| **WP19** | **BLOCKED — ESCALATE** | Tombstone wiring complete: both delete branches write WP12 tombstones and never touch `nodes`/`edges`; `pruneEdgesForDeletedNodes` **removed** (not rewritten) because `buildCanvasData`'s `visibleNodeIds` already expresses the cascade from the same predicate, so serialiser and cascade can no longer disagree; `deleted` map observed by both `CanvasSync.subscribe` and `CanvasPersistence`; `flushToDisk` uses the 3-arg `serializeCanvas`. All 8 visible tests green. **Blocked only by §5.** | **HIGH** | **CRITICAL** |
| **WP20** | DONE | Auditor lifted from log-only detection to idempotent, convergent self-repair. Quarantine `{on:true,q:true}` never destroys the record; **the lift path is implemented and separately falsified**. Validity is *imported* from WP14 (`validateNodeIngest`/`validateEdgeIngest`), never re-derived, so the E1 side-less ruling holds for free. Idempotence is **structural** — an action exists only for a transition not yet made, so a settled doc plans nothing and returns before writing. | NONE | NORMAL |
| **WP21** | DONE | `canWriteEntity`, its 3 call sites, the baseline-hold, the `LOCK DENIED:` emitter, both injected write-gate predicates and their setters, and their `main.ts` wiring + binding-side mirrors — all removed. Locks are now pure UX. 8 tests deleted under licence (§6). | NONE | NORMAL |
| **WP22** | DONE | `writeRecordMinimal`'s absent-key sweep removed, and the byte-identical mirror in `e2e-control.ts`'s `upsertRecord`. Binding writes are upsert-only. `useCanvasBinding` still `false`. **Deletion ledger empty — no deletion was required** (§6). | NONE | NORMAL |
| **WP23** | DONE | 3–5 replica convergence fuzzer, 16 op classes, 5 assertion families, hand-written mulberry32 PRNG (zero new deps). **The intent-trace oracle catches the WP18-class corruption that all four other families are structurally blind to** (§7). | NONE | **HIGH** — read §7 |

---

## 4. Blind Verification — executed counts (WP55 runner)

All ten sets **PASS with non-zero collected counts**. No `ZERO_COLLECTION`. Staging clean after
every run.

| WP | set1 collected/passed | set2 collected/passed |
|---|---|---|
| WP19 | **6 / 6** | **6 / 6** |
| WP20 | **9 / 9** | **8 / 8** |
| WP21 | **16 / 16** | **15 / 15** |
| WP22 | **13 / 13** | **14 / 14** |
| WP23 | **8 / 8** | **9 / 9** |

No blind file's assertions were edited to make it run. WP21's blind TC6 counterparts were
updated **as part of the TC6 predicate correction ruled by Worker 3 Core** (§5.2) — these are
tests authored in this batch, not pre-existing coverage, and the change made them strictly
stronger in both polarities.

---

## 5. THE ESCALATION — WP19 needs an amendment licence (the one blocking item)

### 5.1 What happened, stated precisely

**These 8 failures were caused by WP19 inside this batch. They are NOT a pre-existing
condition and must not be recorded as one.** B3b closed the tree at 1271/1271/0. Worker 3 Core
measured the entry baseline directly (1271 passed / 0 failed) and measured again immediately
after WP19 landed (1279 total / 1271 passed / **8 failed**). The 8 were green before WP19 and
red after it. Causation is measured, not inferred.

WP19 AC1 says, verbatim: *"no record's field container is destroyed by **any** delete path."*
These 8 tests assert `nodesMap.has(id) === false` / `edgesMap.get(id) === undefined` after a
local capture-path delete — the **V1 spelling** of "the delete happened". Both cannot hold.
There is no implementation that satisfies AC1 and these oracles simultaneously.

**In every one of the 8, the property the test is about is fully preserved** — the delete is
still honoured, the cascade still happens, the hand-over gating is untouched. Only the *oracle
spelling* is V1. `wp5v2 T3`'s discriminating half (`nodes.has("n2") === true` — the held card
must survive) still passes, which proves the gating itself is unchanged: `plan.deletes` comes
from `planIntentDiff`, which WP19 did not touch.

### 5.2 Why Worker 3 could not settle it

This is the **amendment** class, not the deletion class: each test survives, and one oracle
line is restated. BUILD_SPEC §7's licensed-**amendment** list is **WP10, WP14, WP18, WP46,
WP59, WP60, WP61** (+WP62 conditionally). **WP19 is on neither that list nor the
licensed-deletion list** (WP4, WP18, WP21, WP22, WP33). An unenumerated assertion rewrite is an
abort criterion exactly as an unenumerated deletion is — so Worker 3 left all 8 byte-untouched
and escalated instead.

The same reasoning was applied twice more during the batch, both times conservatively:
- **WP21 / `canvas-sync.test.ts:791`** — its `LOCK DENIED:` count-0 assertion became trivially
  always-true. Worker 3 Core ruled: **leave it entirely alone.** An always-true assertion is not
  a weakening; a licence not held is a violation. The coder obeyed and escalated the resulting
  conflict with its own TC6 corpus scan — correctly. Worker 3 Core then ruled that **TC6 itself**
  was defective (it flagged an assertion of *absence* as if it pinned the removed behaviour) and
  corrected TC6, a test authored in this batch and therefore inside Worker 3's authority.
- **WP22** — the coder was instructed that any amendment candidate must be reported, not edited.
  It found none.

### 5.3 The 8 rows, ready for a ruling

Each is a **one-line oracle swap** to `isTombstoneSuppressed(readTombstoneEntry(deleted, id))`
or to absence from `buildCanvasData(nodes, edges, deleted)`. Strictness does not fall and the
test count does not change — both conditions the amendment class requires.

| # | File | `it` line | Test title | Stale oracle | Post-amendment |
|---|---|---|---|---|---|
| 1 | `plugin/src/__tests__/canvas-sync.test.ts` | 358 | `genuine local delete removes the node from the Y map` | `nodesMap.has(id) === false` | record is tombstone-suppressed **and** absent from `buildCanvasData` — strictly stronger (pins suppression *and* projection, where the old line pinned key absence only) |
| 2 | `plugin/src/__tests__/canvas-sync.test.ts` | 500 | `prunes edges in the shared doc when their endpoint node is locally deleted (GAP-5)` | edge key removed | edge suppressed via the cascade predicate and absent from the projection |
| 3 | `plugin/src/__tests__/canvas-sync.test.ts` | 869 | `a genuine local DELETE of a whole record is still honoured (protection is per-key only)` | record key removed | record tombstoned; **field container still present** — this row gets strictly stronger, since preservation is exactly what AC1 adds |
| 4 | `plugin/src/__tests__/w4-canvas-integrity.test.ts` | 331 | `A7 a genuine WHOLE-record delete is unaffected by PROTECTED_KEYS` | record key removed | as row 3 |
| 5 | `plugin/src/__tests__/v2/wp4/test_tp01_intent_basis_visible.test.ts` | 219 | `T4 with the view open and a hand-over receipt, the delete still happens` | record key removed | record tombstoned; the hand-over gating half is untouched and already passes |
| 6 | `plugin/src/__tests__/v2/wp5v2/test_tp05_handover_and_close_visible.test.ts` | 159 | `T2 after a confirmed apply the same omission is a deletion` | record key removed | record tombstoned |
| 7 | `plugin/src/__tests__/v2/wp5v2/test_tp05_handover_and_close_visible.test.ts` | 172 | `T3 an interacting record is never handed over, so it cannot be deleted` | record key removed | record tombstoned; its **discriminating half already passes unchanged** |
| 8 | `plugin/src/__tests__/v2/wp6/chaos_degraded_adapter.test.ts` | 580 | ``D2 seam `advanceFromReceipt(..., { perFieldReceipt: false })`: the unlanded apply leaks and deletes`` | record key removed | record tombstoned |

**Requested ruling:** add **WP19** to the BUILD_SPEC §7 licensed-amendment list with these 8
enumerated rows — the same shape of ruling already granted for WP10 and WP14 in B3b. If instead
Worker 2 judges any row to be a **real defect** rather than a stale oracle, that row should come
back as a fix request; Worker 3 deliberately did not pre-judge that.

---

## 6. Deletion Ledgers (WP21, WP22)

### WP21 — 8 deletions, all licensed and enumerated

BUILD_SPEC §7 lists WP21 on the licensed-deletion list. Line numbers are **pre-deletion**.

| # | File | Line | Test title | Why it pinned removed behaviour |
|---|---|---|---|---|
| 1 | `plugin/src/__tests__/canvas-sync.test.ts` | 481 | `canWriteNode=false drops a local node edit in the diff path` | Injects `setCanWriteNode`, asserts the node upsert is dropped — the removed node call site of `canWriteEntity`. |
| 2 | `plugin/src/__tests__/canvas-sync.test.ts` | 499 | `canWriteNode=false drops a brand-new local node` | Same gate on the create branch. |
| 3 | `plugin/src/__tests__/canvas-sync.test.ts` | 515 | `canDeleteNode=false blocks a local delete of a peer-held node` | Injects `setCanDeleteNode` — the removed delete call site. |
| 4 | `plugin/src/__tests__/canvas-sync.test.ts` | 560 | `drops an un-flushed local edit when a remote peer holds the node (US5 AC2)` | Asserts the local edit is discarded for the holder's value — the removed write denial. |
| 5 | `plugin/src/__tests__/canvas-sync.test.ts` | 774 | `edge write is denied while a peer holds one of its endpoint nodes (US2 AC1)` | Asserts the `LOCK DENIED:` emitter fires — the removed both-endpoints edge gate. |
| 6 | `plugin/src/__tests__/canvas-sync.test.ts` | 849 | `a denied write does NOT advance lastWrittenContent and stays observable (US2 AC4/AC5)` | The baseline-hold-on-denial test in full — exactly the behaviour AC1 abolishes. |
| 7 | `plugin/src/__tests__/canvas-sync.test.ts` | 1142 | `the tiebreak loser is denied, holds its baseline, reverts once, and lands on the winner's coords` | Wires both removed setters from real `CanvasPresence` instances; asserts denial + baseline hold. |
| 8 | `plugin/src/__tests__/w4-canvas-integrity.test.ts` | 1228 | `G1 an edge whose ENDPOINT a peer holds is not written, and the baseline is HELD` | Asserts the edge write is withheld, `LOCK DENIED:` fires, baseline held across an idempotent second pass. |

**Collateral, dead-only, no test behaviour:** the now-empty `describe("CanvasSync + CanvasPresence
loser-revert (US2 AC9)")`; the `WP4 — GAP-1 loser-revert seam` section header and the
`makeAwarenessNetwork()` helper (verified single caller = deletion #7); the resulting unreferenced
`AwarenessLike`/`CanvasPresence` import; and `canvas-sync.ts`'s `getRecordFields` import (both call
sites fed `canWriteEntity`). **No 9th test was deleted.**

**Correction to Worker 3 Core's authorisation table, found by the coder and handled correctly:**
`w4-canvas-integrity.test.ts:1215`'s `describe` does **not** become empty after deleting G1 —
G2–G5 and the shared `lockFixture()` live there too. Only G1 was deleted; the block, helper and
title stayed intact (retitling would have been an unlicensed amendment).

### WP22 — deletion ledger EMPTY

No deletion was required, and this was verified rather than assumed: the full suite passes with
the absent-key sweep removed; the only `writeRecordMinimal` mention in the test tree
(`v2/wp2/test_tp02:11`) pins the **new** semantics; and the `canvas-binding*` delete oracles are
all record-level. **Zero pre-existing test files were modified.** No amendment candidates found
either. WP22 held a deletion licence and did not need to spend it.

---

## 7. WP23 — the fuzzer, and its headline result

### 7.1 Fault-injection matrix — proof the fuzzer bites

200 scenarios × 10 windows per row; production restored and `cmp`-verified byte-identical after
each injection.

| Injected fault | intent-trace | SEC | schema | bytes | shadow | I7 |
|---|---|---|---|---|---|---|
| none | 0 | 0 | 0 | 0 | 0 | 0 |
| **1. insertion-order flat-vs-register (the WP18 class)** | **2913** | 0 | 0 | 0 | 0 | 0 |
| 2. delete suppression broken | 854 | 0 | **863** | 0 | 0 | 0 |
| 3. partial capture removes an unmentioned field | 31221 | 0 | 0 | 0 | 0 | **2587** |
| 4. a replica pushes a stale field | 339 | 0 | 0 | 0 | **372** | 0 |

**Row 1 is the justification for AC5, now demonstrated rather than argued.** The known
WP18-class corruption is caught by the intent-trace oracle and by **nothing else** — SEC, schema,
byte equality and shadow are all four green over a provably corrupt document. Note also that
**SEC and byte equality never fire in any row**: every replica commits the same projection
defect, so a convergence oracle structurally cannot see a correctness bug. *Convergence is not
correctness*, measured.

### 7.2 How the oracle stays deterministic (the CRDT trap, solved explicitly)

The harness **imposes and records** the total order instead of inferring it, via three composing
rules:

1. **Windows.** A run is a sequence of windows each ending in full-mesh quiescence. Every op in
   window `w+1` comes from a replica that already integrated all of window `w`, so cross-window
   same-field writes are **causally ordered, never concurrent**. Partitions, delta reordering and
   duplication all live *inside* a window, so the interleaving space is still fully explored —
   only the unpredictability of the arbitration is removed.
2. **Per-window slot claims** keyed `kind|id|field` with a `kind|id|*` wildcard. An op claims
   before acting or **aborts unlogged**, so two ops in one window necessarily touch disjoint
   fields.
3. **Declared contests** for the WP21 link: two replicas in *different partition groups*, logged
   `contested: true`. There the oracle asserts only that all replicas agree, that the winner is
   one of the written values, and that for `pos` the winner is **one author's whole `[x,y]`
   tuple** (per-field checking cannot see a torn `(A.x, B.y)`). **It never asserts which won.**

Stability verified: 30/30 visible × 5 runs and 47/47 including blind sets × 3 runs, with fresh
random `clientID`s each time.

### 7.3 FINDINGS — real bugs discovered: **none**

~700 scenarios, zero violations. Worth recording:

- A hypothesis that the P1 flat capture path could **tear `x` from `y`** on a concurrent drag was
  **probed empirically and falsified** — 0/40 torn pairs. Yjs's per-key arbitration is the same
  `clientID` comparison for every key, so when both authors write both keys, the same author wins
  both. Recorded so it is not re-litigated.
- Two early failures were **harness modelling bugs**, not production bugs (a save-path op writing
  a value equal to its own replica's shadow; a delete targeting a record that replica's shadow
  never saw). Production was right both times. This is the correct outcome of the rule that a
  fuzzer failure is a finding, not a licence to change production.

### 7.4 WP21's empirical backing — delivered

The WP21 link is genuinely exercised, not merely asserted possible: concurrent writes to the same
register converge by honest LWW on every replica, with **no baseline-hold artefact and no
held-back local state**. This is the evidence for WP21's whole premise that locks became pure UX.

---

## 8. Risk Notes for Worker 4

**8.1 — WP19 is CRITICAL priority and its 8 reds are in the tree.** Do not treat them as
inherited noise. Until Worker 2 rules, the suite is 1338/1346. Every one of the 8 is a stale
V1 oracle over a preserved property (§5.3).

**8.2 — Quarantine protects the DOC, not the FILE.** WP20 does not make WP63/I11 unnecessary.
The only question that matters for a user's `.canvas` is whether the record survives a
`flush()`. WP20 was deliberately built not to look like a file-safety mechanism.

**8.3 — WP20 log noise, out of scope.** The legacy `SCATTER`/`DETACH`/`NO TYPE` telemetry now
re-narrates an already-quarantined record on every audit pass. **Log-only, zero deltas** — the
idempotence property is intact. W4 will see it; it is not a defect.

**8.4 — `FUZZ_TEST_TIMEOUT_MS = 120_000`.** A fuzzer scenario band exceeds vitest's 5 s default
under full-suite parallel load although it runs in ~1 s alone. The suite is green both in
isolation and under `npm test`. Do not "fix" this by shrinking the scenario budget without
re-checking the fault-injection matrix still bites.

**8.5 — Documentation residual.** `v2/wp19/test_tp02_*_visible.test.ts:5` carries a comment-only
reference to the removed lock gate. Left deliberately under Worker 3 Core's Ruling 2 — prose, not
an oracle, and touching it would be an unlicensed edit. Worth a comment fix under any future
licence.

**8.6 — Two of B3b's open risk notes are now closed by WP21's deletions.** B3b §7.1 (the DEAD
TEST `canDeleteNode=false blocks a local delete…`) and §7.2 (the VACUOUSLY GREEN
`canWriteNode=false drops a brand-new local node`) were deletions #3 and #2 here. They no longer
need a follow-up WP.

**8.7 — `plugin/main.js` was regenerated** by the mandatory `npm run build` gate. It was never
hand-edited.

---

## 9. Summary for Worker 4 Entry Point

Deletion is now **reversible**: a delete writes a WP12 tombstone and destroys no field container,
the edge cascade is expressed by one suppression predicate shared by the view and the serialiser
(so they can no longer disagree), and an undo restores every field value the record had. On top
of that, the auditor **repairs rather than reports** — an invalid record is quarantined without
being destroyed and the quarantine **lifts automatically** when a later delta restores the missing
fields, idempotently and convergently across concurrent clients. Locks have lost all write
authority and are now pure UX, with the awareness liveness machinery byte-unchanged. Binding
writes are upsert-only at both remaining boundaries.

Most importantly, the initiative now has an oracle that can see the failure mode it had been
structurally blind to: the convergence fuzzer's **intent-trace oracle** checks the converged value
against what the *operations* imply, computed from the harness's own op log and never read back
from the implementation. The fault-injection matrix proves the point that motivated it — the
WP18-class corruption is invisible to SEC, schema, byte equality and shadow consistency, and
visible only to intent.

To drive the fuzzer: `plugin/src/__tests__/harness/fuzz/` (core, separable and extensible per AC4)
and `plugin/src/__tests__/v2/wp23/` (suite). Runs reproduce from their seed.
