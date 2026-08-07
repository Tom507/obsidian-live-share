# Worker 3 Handover — B17 / WP67 (Falsifiability pins for the WP64 helper repairs)

**Status:** `HANDOVER_READY` · **Batch:** B17 · **task_mode:** `lightweight` · **Date:** 2026-08-02
**Report:** `ImplementationReport_WP67.md` · **Charter:** `TaskCharter_WP67_HelperRepairFalsifiabilityPins.md`

## Scope of This Run

Tasks completed: **WP67**
Tasks with risk flags: **none**
Out of scope and not touched: **WP66** (hollow-fixture sweep — held by the Dispatcher until P2 lands).

## Risk Summary

| WP | Status | risk_flag | Priority for W4 |
|---|---|---|---|
| WP67 | DONE | NONE | NORMAL (`W4 Test Targets = 0` — both ACs observable in the unit suite) |

## Per-Task Detail

### WP67 — Falsifiability pins for the WP64 helper repairs

- **Status:** DONE
- **Changed files (2, test instruments only, additive):**
  - `plugin/src/__tests__/v2/wp5v2/test_tp01_single_shadow_visible.test.ts` (309 → 417 lines)
  - `plugin/src/__tests__/v2/wp5v2/test_tp06_discrimination_seam_visible.test.ts` (289 → 400 lines)
- **Production source changed:** none.
- **Unit test status:**

  | Test Set | Tests | PASS | FAIL |
  |---|---|---|---|
  | visible (the two files) | 11 | 11 | 0 |
  | blind_set1 / blind_set2 | — | — | — | (`lightweight`: no blind sets, per charter) |

- **Risk flag:** NONE
- **Repeated failure points:** none — single attempt, no retry consumed.
- **Known edge cases not covered:** none for this scope. The `w4-canvas-integrity` helper stays
  deliberately tombstone-blind (charter §2 out-of-scope) and was **not** converted.
- **Open assumptions:** none.

## The Two Pins and Their Falsification Evidence

One added test per file, identical name in both:

```
WP67 — this file's suppression-aware docRecords() is falsifiable
  └── P1 docRecords omits a tombstoned record the raw form hands over, and keeps the live one
```

Each builds **its own** `Y.Doc` — one suppressed node `n1` and suppressed edge `e1` beside live `n2`/`e2`.
**No tombstone was added to either existing fixture.**

**A/B on an identical injection, one file at a time:**

| Site | Helper form | Pin P1 | Failing assertion | Pre-existing tests |
|---|---|---|---|---|
| `test_tp01` | repaired | **GREEN** | — | T1–T5 GREEN |
| `test_tp01` | raw (pre-WP64) | **RED** | `:403` — *"a deleted node was handed to the reconcile classifier as live: expected [ 'n1', 'n2' ] to not include 'n1'"* | T1–T5 **GREEN** |
| `test_tp06` | repaired | **GREEN** | — | T1–T4 GREEN |
| `test_tp06` | raw (pre-WP64) | **RED** | `:386` — *"a deleted node was written into the receipt's desired state as live: …"* | T1–T4 **GREEN** |

Each pin went red **on its own assertion, first measurement, no narrowing needed** — no B14-style global
perturbation (one function, one file at a time) and no B15-style masking (the failure is on the pin's own
new line). The green right-hand column is itself the confirmation that B16 was right to refuse to count
these sites: before the pin, nothing in either file could distinguish the two helper forms.

A second, **permanent** A/B ships inside each pin: `rawDocRecordsControl()` — the pre-WP64 form verbatim —
is asserted to report `n1`/`e1` on the same doc, so the pin can never pass vacuously if the injection
stops injecting.

**Byte-clean restoration, verified by hash (not inspection):** `head -n 309` of `test_tp01` →
`382df67581d0337c79f47b4fb3fc04c8`; `head -n 289` of `test_tp06` → `6c4c870b570aaa8d6cc7d838126e55fb`.
Both equal the pre-WP67 baselines. Every change is strictly appended.

## Register State — Both Sites

**§7 unfalsifiable-repair register: DISCHARGED for both sites.** The original row is **kept verbatim**
(a ledger row is a measurement, not a timeless fact) with a `DISCHARGED — WP67 / batch B17` block appended
carrying the evidence above. `test_tp01:99` and `test_tp06:94` are now readable as **verified**, and the
prohibition on citing them as evidence is lifted.

> Charter §6 assigns this flip to Worker 2 on handover; the Dispatcher's brief assigned it here. It is
> **done** — Worker 2 should **review, not re-apply**, so the discharge is not recorded twice.

## Counts — Own Scope

| Scope | Before | After | Δ |
|---|---|---|---|
| `test_tp01` | 5 | 6 | +1 |
| `test_tp06` | 4 | 5 | +1 |
| **Own touched set** | **9** | **11** | **+2** |

Exactly the pins added, each enumerated by file and name. No existing test changed state in either
direction (verified per-test with `--reporter=verbose`).

**Gates:** `npm test` **244 files · 1424 tests · 1424 passed · 0 failed** · `npm run build` exit **0** ·
`npx tsc --noEmit` exit **0**.

## Foreign State — Batch B4 (stated separately, not folded into the above)

- The **first** whole-tree run (11:39) reported `1417 passed · 7 failed` in 3 files. One was positively
  identified — `v2/wp24/test_tp06_load_is_idempotent_visible.test.ts`. **The other two were not captured**
  because the log filter used truncated the failure list; that is stated rather than inferred.
- Between runs, `plugin/src/files/canvas-sidecar.ts` was written by **B4** (mtime inside the run window) —
  the very module whose absence produced B16's 6 collection errors.
- The **second** run, minutes later, was fully green (1424/1424, build 0, tsc 0). **B16's standing red has
  cleared, and the clearing is B4's landing, not WP67's work.**
- **Attribution:** the first run measured B4's production source mid-write. WP67's touched set is two test
  files; **zero** failures fell inside it, and the identical count (1424) across both runs shows nothing was
  added or lost. The two unnamed files are attributed to `v2/wp24/` **by the clean re-run, not by
  assumption**. A B17 standing-attribution entry was added to §7 beside B16's.

## Summary for Worker 4 Entry Point

Nothing is deferred to Worker 4 (`W4 Test Targets = 0`). What is now observable: running
`npx vitest run src/__tests__/v2/wp5v2/test_tp01_single_shadow_visible.test.ts
src/__tests__/v2/wp5v2/test_tp06_discrimination_seam_visible.test.ts` from `plugin/` shows 11 green tests,
two of them the new `WP67 … P1` pins. To reproduce the falsification, delete the
`if (isTombstoneSuppressed(readTombstoneEntry(deleted, id))) continue;` line from either file's
`docRecords()` and re-run that file: P1 goes red on its own assertion and every pre-existing test in the
file stays green.

## Automation Candidates

The perturb → measure → restore → hash-verify cycle was run manually four times this batch and is
identical each time (revert one helper line, run one file, restore, compare `head -n <baseline> | md5sum`).
It is a good candidate for a small falsification-harness script if the pattern recurs in WP66.
