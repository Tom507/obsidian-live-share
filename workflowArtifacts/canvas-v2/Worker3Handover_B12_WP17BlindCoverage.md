# Worker 3 Handover — Canvas V2, batch B12 (WP17 blind-set coverage)

**Batch:** B12 · **Phase:** VI · **Scope:** WP62 only (narrow)
**Date:** 2026-08-02 · **Returns:** `HANDOVER_READY`

> **WP59 was NOT touched.** It is out of scope for this batch and remains with the Dispatcher.

---

## Scope of This Run

- **Tasks completed:** WP62 — **DONE**
- **Tasks with risk flags:** none
- **Production source touched:** **NONE.** This batch wrote blind-test artefacts and one ledger
  file. Nothing under `plugin/src/**` or `server/src/**` was modified.

## Risk Summary

| WP | Status | risk_flag | Priority for W4 |
|---|---|---|---|
| WP62 | DONE | NONE | NORMAL |

## Per-Task Detail

### WP62 — WP17 blind-set ledger coverage

- **Status:** DONE
- **Changed files:**
  - `workflowArtifacts/canvas-v2/BlindVerificationLedger.md` (2 rows appended, tally + coverage
    boundary corrected)
  - `workflowArtifacts/canvas-v2/tests/blind_set1/WP17/` — 3 new files
  - `workflowArtifacts/canvas-v2/tests/blind_set2/WP17/` — 3 new files
  - `workflowArtifacts/canvas-v2/ImplementationReport_WP62.md` (new)
  - `_blind_records/WP17_set{1,2}_vitest.json` + `index.jsonl` (runner output)
- **Unit test status** *(verbatim from `_blind_records/*.json`)*:

  | Test Set | Files | Tests | PASS | FAIL | Verdict |
  |---|---|---|---|---|---|
  | baseline set1 (12 authored files, run alone first) | 12 | 13 | 13 | 0 | PASS |
  | baseline set2 (12 authored files, run alone first) | 12 | 13 | 13 | 0 | PASS |
  | **blind_set1 (final, 15 files)** | 15 | **22** | 22 | 0 | **PASS** |
  | **blind_set2 (final, 15 files)** | 15 | **110** | 110 | 0 | **PASS** |

- **Risk flag:** NONE
- **Repeated failure points:** none — no test went red at any point
- **Known edge cases not covered:** none within WP17's ACs
- **Open assumptions:** none

## The one thing to read if you read nothing else

**WP17's blind files predate WP17's AC5 by ~4 hours.** The 12 files per set were authored
2026-08-01 21:42–21:49 against AC1–AC4; AC5 was added by Worker 2's amendment on 2026-08-02. A
survey of all 24 files found **zero** coverage of any of AC5's three parts — no side-less
endpoint is ever constructed, the string `null` appears in none of the 24 files, and no file
writes both a flat key and its register onto the same record.

Rowing the sets as-found would have produced two rows that were true and misleading: green
against an AC set that no longer exists. WP62 therefore did both — reproduced the baseline claim
exactly *first*, then added the missing AC5 coverage. **The counts move up; nothing was deleted
or weakened.**

## AC coverage map

| AC | blind_set1 | blind_set2 |
|---|---|---|
| AC1 — `(ord, id)` sort, register expansion, `ord` never written | tp01–tp06 (pre-existing) | tp01–tp06 (pre-existing) |
| AC2 — tombstone/quarantine suppression + edge cascade | tp07–tp09 (pre-existing) | tp07–tp09 (pre-existing) |
| AC3 — cross-replica byte identity, incl. after reorder | tp10, tp11 (pre-existing) | tp10, tp11 (pre-existing) |
| AC4 — round-trip stability of records and relative order | tp12 (pre-existing) | tp12 (pre-existing) |
| **AC5 part 1** — side/end keys omitted; side-less file round-trips byte-identically | **tp13 (new)** | **tp13 (new)** |
| **AC5 part 2** — junk `null`/`""` under a typed flat key dropped, never overrides the register | **tp14 (new)** | **tp14 (new)** |
| **AC5 part 3** — flat-over-register precedence, insertion-order independent | **tp15 (new)** | **tp15 (new)** |

**Blind-set independence:** the two AC5 triples were derived by two separate sub-agents, each
forbidden from reading the visible tests (`plugin/src/__tests__/v2/wp17/`) or the sibling blind
set, each working only from the AC5 text and the production API surface. set1 reasons against the
in-memory object oracle with vitest matchers and inline fixtures; set2 pushes to the serialized
artefact with structural introspection and module-level tables at much higher cardinality
(tp14 = 10 typed keys × 2 junk values; tp15 = 24 insertion-order permutations per scenario,
asserted as `new Set(texts).size === 1`). That is why set2 collects 110 against set1's 22.

## Two structural traps, and what was actually found

1. **Ordering vs bytes.** `canonicalizeCanvasData`'s id-only array sort discards `ord` order while
   still producing byte-identical files, so byte-equality assertions structurally cannot catch an
   ordering regression. **Checked, and the sets are clean:** pre-existing `tp10`/`tp11` in *both*
   sets already assert ORDER (explicit id-array `toEqual` against a hardcoded ord-derived
   sequence) **in addition to** bytes, and `tp12` in both sets asserts order with no byte
   assertion at all. No ordering blind spot existed.
2. **Insertion order.** `decodeV2RecordToFlat` once resolved flat-vs-register collisions by
   `Y.Map` insertion order, and **both replicas converge on the same wrong value** — so
   cross-replica byte equality provably cannot see this class, and a value-only assertion passes
   with the bug present. Both new `tp15` files assert insertion-order **independence directly**,
   with the identical-output check as the *primary* assertion and the value check secondary.

**CRDT assertion trap:** all fixtures are single-author on one `Y.Doc`. No concurrent same-key
write is created anywhere, so no new test is tie-broken on `clientID` and none can pass ~50% of
runs.

## Ledger state after this batch

- **54 rows** (was 52): 53 CONFIRMED, 1 DIVERGENT, 0 VACUOUS, 0 UNRUNNABLE. Arithmetic verified
  against the file: 42 rows for 21 single-framework WPs + 12 rows for the 3 dual-framework ones
  (WP44/WP46/WP47) = 54.
- **Directory check re-measured 2026-08-02 00:52 UTC:** 27 WP folders per set = 54 pairs. Rows
  cover **24 of 27** folders.
- The "One set is deliberately NOT covered: WP17" carve-out is **replaced by the rows themselves**
  plus a closure note.

## Handed BACK to the Dispatcher — three uncovered folders

Absence of a row is still not readable as a pass. These need their own charter:

| Folder | Appeared | Why no row |
|---|---|---|
| `WP18` | 2026-08-01 23:32 | outside WP62's declared scope (charter §2 = WP17 only) |
| `WP63` | 2026-08-02 01:49 | outside WP62's declared scope |
| `WP19` | 2026-08-02 02:50 | created by the **live batch B3c while WP62 was running** — the identical situation WP17 was in during B2 |

**`WP19` should not be run until B3c closes.** The charter's own §5 reasoning applies unchanged:
running a set another agent is mid-way through authoring produces noise, not evidence.

### Residual on C62 AC2

AC2 asked that the ledger cover *every* blind set on disk "with no gaps". That was written when
WP17 was the only gap; three folders have appeared since, one during this WP, so the literal
condition is **not satisfiable by WP62 alone**. AC1, AC3 and AC4 are satisfied in full, and AC2's
substance is delivered — the coverage claim is checkable against the filesystem and the three
uncovered folders are named rather than silently absorbed. Flagged here rather than closed
quietly, because closing it quietly is the exact failure mode the rule exists to prevent.

## Foreign changes observed (NOT fixed, NOT ours)

Batch **B3c** is live in `plugin/src/canvas/**`, `plugin/src/files/**` and `plugin/src/sync/**`
(WP19–WP23). Its in-flight edits are visible in `git status` — `canvas-registers.ts`,
`canvas-shadow.ts`, `canvas-persistence.ts`, `canvas-sync.ts`, `main.ts`, `e2e-control.ts`, a
deleted `v2/wp4/test_tp08_*` and several modified test files. **None of these are WP62's**, none
were touched, and the pre-run and post-run `git status` over `plugin/` are byte-identical.

`tests/blind_set{1,2}/WP19/` appeared at 02:50 mid-run — that is B3c authoring, not a WP62
artefact.

## Note for Worker 4

**W4 Test Targets: `0`.** WP62 produces no runtime behaviour. It adds unit-level blind tests and
a documentation artefact; there is nothing to observe in a running system.

**`tsc` was deliberately not measured as a WP62 gate.** `plugin/tsconfig.json` includes only
`src/**/*.ts`, so the blind files sit outside the type-checked tree except transiently while the
runner stages them — WP62 cannot affect `tsc` by construction. Running it now would only sample
B3c's in-flight edits and record a foreign batch's work-in-progress as a WP62 build failure.
Measure `tsc` when no blind run is in flight and B3c has closed.

**Staging hygiene:** verified absent before the first run and after the last
(`plugin/src/__tests__/v2blind`, `plugin/src/v2blind_d1`, and both `server/` equivalents). If you
see a `v2blind` / `_blind[12]` path in a build error, it is a transient staging artefact of a
concurrent blind run — re-check before diagnosing it as a break.

## Summary for Worker 4 Entry Point

Nothing new is observable at runtime. The verifiable outputs are:
`python workflowArtifacts/canvas-v2/_run_blind.py WP17 both` from the repo root → two PASS
verdicts with 22 and 110 collected, and `BlindVerificationLedger.md`, whose coverage claim now
states a count a reader can check against a directory listing.
