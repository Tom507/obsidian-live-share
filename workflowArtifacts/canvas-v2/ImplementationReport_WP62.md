# Implementation Report — WP62: WP17 blind-set ledger coverage

**WP:** WP62 · **Phase:** VI · **Status:** `DONE`
**Charter:** `TaskCharter_WP62_WP17BlindSetCoverage.md`
**Run date:** 2026-08-02 · **Worker:** Worker 3 (batch B12)

---

## 1. What this WP found before it did anything

The charter scoped WP62 as *run the existing sets and row them*. That is what happened, but one
fact changed the shape of the work and is recorded first because everything else depends on it:

**WP17's 12 blind files per set were authored 2026-08-01 21:42–21:49, against AC1–AC4.
WP17's AC5 was added by Worker 2 on 2026-08-02.** The blind files predate the acceptance
criterion by roughly four hours.

A survey of all 24 authored files confirmed the consequence: **zero** of them touch any of
AC5's three parts.

- `fromSide`/`toSide` appear in 13 places, but **always as a supplied non-empty value** — never
  once is a side-less endpoint constructed.
- `fromEnd`/`toEnd`: one file asserts them present, one asserts them omitted; `fromSide`/`toSide`
  are supplied and asserted *present* in both.
- `null`: **zero occurrences across all 24 files.** Nothing tested "never `null`, never `""`".
- Flat-vs-register precedence: absent. No file ever writes both a flat key and its register onto
  the same record.

Rowing the sets as-is would have produced two CONFIRMED rows that were *true* and *misleading*:
green against an AC set that no longer exists. So WP62 rowed the baseline honestly **and** added
the missing AC5 coverage.

## 2. Baseline run — the prior claim, reproduced on its own terms

The 12 authored files were run **first, unchanged, and alone**, before a single new file existed.

| Set | Files | Collected | Pass | Fail | Verdict |
|---|---|---|---|---|---|
| set1 | 12 | 13 | 13 | 0 | PASS |
| set2 | 12 | 13 | 13 | 0 | PASS |

Prior claim, `Worker3Handover_B2_P1cores.md:99` — WP17: `12 / 13 / 0` for both sets.
**Reproduced exactly.** The B2 claim is CONFIRMED on its own terms, independently of anything
WP62 added afterwards. Package/depth `plugin / 3`, derived by the runner's own import-resolution
pass — not assumed, not hardcoded, and not inferred by analogy to WP17's neighbours.

## 3. AC5 coverage added

Three counterparts per set, derived **independently per set** by two separate sub-agents, each
forbidden from reading the visible tests (`plugin/src/__tests__/v2/wp17/`) or the sibling blind
set. Both derived only from the AC5 text and the production API surface.

| File (per set) | AC5 part | What it pins |
|---|---|---|
| `test_tp13_sideless_edge_file_byte_identical_round_trip_blind{1,2}.test.ts` | part 1 | side/end keys **omitted** — proven as key ABSENCE (`Object.keys` equality, the `in` operator, `hasOwnProperty === false`), never as a value being `undefined`; plus the byte-identical `parse → doc → serialize` round trip of a hand-written canonical side-less `.canvas` literal |
| `test_tp14_junk_flat_key_never_reaches_disk_blind{1,2}.test.ts` | part 2 | a junk `null`/`""` under a typed flat key is dropped, never reaches the serialized text, and never overrides the register still holding the real answer |
| `test_tp15_flat_over_register_precedence_is_insertion_order_independent_blind{1,2}.test.ts` | part 3 | stale register + fresh flat key ⇒ **flat wins**, and the outcome is **invariant under `Y.Map` insertion order** |

**The two sets attack the same claims differently, by construction.**

- **set1** reasons against the in-memory object oracle: `buildCanvasData` + vitest matchers
  (`toMatchObject`, `not.toHaveProperty`, `toEqual`), inline imperative fixtures. tp15 builds the
  contested record in two separate docs, register-then-flat and flat-then-register, and asserts
  `textA === textB`.
- **set2** pushes to the serialized artefact and structural introspection: `serializeCanvas` +
  `JSON.parse`, `"key" in out === false`, `Object.keys(...)`, raw-string `not.toContain`, driven
  from module-level tables. tp14 is table-driven over all **10 typed keys × 2 junk values**; tp15
  permutes **4 writes → 24 orderings per scenario** and asserts `new Set(texts).size === 1`.

### Why a naive blind set would have missed the two properties that matter

Both are recorded because both are structural, not incidental:

1. **Ordering.** `canonicalizeCanvasData`'s id-only array sort discards `ord` order *while still
   producing byte-identical files*, so a byte-equality assertion cannot catch an ordering
   regression. Verified: the pre-existing `tp10` and `tp11` in **both** sets already assert
   ORDER (an explicit id-array `toEqual` against a hardcoded ord-derived sequence) **in addition
   to** bytes, and `tp12` in both sets asserts order with no byte assertion at all. **No ordering
   blind spot existed** — this is a positive finding, not an assumption.
2. **Insertion order.** `decodeV2RecordToFlat` once resolved flat-vs-register collisions by
   `Y.Map` insertion order, and **both replicas converge on the same wrong value**, so
   cross-replica byte equality provably cannot see this class and a value-only assertion passes
   with the bug present. Both new `tp15` files therefore assert insertion-order **independence
   directly**, and treat the identical-output check as the primary assertion rather than the
   value check.

**CRDT assertion trap observed:** every fixture is single-author on one `Y.Doc`. No concurrent
same-key write is created and no `clientID` tiebreak is ever asserted, so no test in either new
set can pass ~50% of runs.

## 4. Final measured result — verbatim from `_blind_records/*.json`

Not retyped from console output. Source: `_blind_records/WP17_set1_vitest.json`,
`_blind_records/WP17_set2_vitest.json`.

```json
{ "wp": "17", "set": "set1", "framework": "vitest", "files_staged": 15,
  "tests_collected": 22, "tests_passed": 22, "tests_failed": 0,
  "exit_code": 0, "verdict": "PASS", "package": "plugin", "depth": 3 }

{ "wp": "17", "set": "set2", "framework": "vitest", "files_staged": 15,
  "tests_collected": 110, "tests_passed": 110, "tests_failed": 0,
  "exit_code": 0, "verdict": "PASS", "package": "plugin", "depth": 3 }
```

| Set | Files | Collected | Pass | Fail | Verdict | Package/depth |
|---|---|---|---|---|---|---|
| set1 | 12 → **15** | 13 → **22** | 22 | 0 | **PASS** | plugin / 3 (derived) |
| set2 | 12 → **15** | 13 → **110** | 110 | 0 | **PASS** | plugin / 3 (derived) |

Both counts are non-zero and both moved **up**. Staging clean after every run
(`[staging clean: no v2blind staging dirs present]`), verified independently by directory check
before and after.

## 5. Findings

**None.** No test went red at any point, in either set, in either the baseline or the final run.
No assertion was weakened; the only mid-work adjustments either sub-agent made were to its own
fixtures.

The production implementation satisfies all three parts of AC5 as written —
`decodeV2RecordToFlat`'s two-pass structure (`plugin/src/files/canvas-sync.ts:379–440`),
`isJunkFileValue` (`:369`), and `encodeEndpoint` / `decodeEndpointToFile`
(`plugin/src/canvas/canvas-registers.ts:578`, `:615`).

## 6. Ledger changes

- **Two rows appended** for `WP17 set1` and `WP17 set2`, in WP56's schema and verdict vocabulary,
  each carrying the prior claim with its artefact and line (`Worker3Handover_B2_P1cores.md:99`),
  the collected/passed/failed counts, and a **CONFIRMED** verdict.
- **Tally corrected** 52 → **54** rows, CONFIRMED 51 → **53**.
- **Coverage-boundary section rewritten.** The "One set is deliberately NOT covered: WP17"
  carve-out is replaced by the rows themselves plus a closure note.
- **Directory check re-measured** at 2026-08-02 00:52 UTC: **27** WP folders per set = **54**
  pairs, against **54** rows covering **24 of 27** folders. The arithmetic is spelled out in the
  ledger so a reader can check it rather than trust it.
- **A new carve-out added, honestly named:** `WP18`, `WP19` and `WP63` have no row.

## 7. The residual on C62 AC2 — stated, not buried

C62 AC2 asked that on completion the ledger cover *every* blind set on disk "with no gaps". That
was written when WP17 was the only gap. **It is no longer satisfiable by WP62 alone**, because
the filesystem moved:

| Folder | Appeared | Status |
|---|---|---|
| `WP18` | 2026-08-01 23:32 | outside WP62's declared scope (charter §2 = WP17 only) |
| `WP63` | 2026-08-02 01:49 | outside WP62's declared scope |
| `WP19` | 2026-08-02 02:50 | created by the **live batch B3c while WP62 was running** |

`WP19` is the exact situation WP17 was in during B2, and the charter's own §5 reasoning applies
unchanged: running a set another agent is mid-way through authoring produces noise, not evidence.

This is reported rather than silently closed, because closing it silently is precisely the
failure mode the "absence of a row is never a pass" rule exists to prevent. **AC2's substance is
delivered** — the ledger's coverage claim is checkable against the filesystem, and the three
uncovered folders are named. AC1, AC3 and AC4 are satisfied in full.

## 8. Constraint compliance

| Constraint | Status |
|---|---|
| No production source modified | **Held.** `git status` over `plugin/` and `server/` is byte-identical to the pre-run snapshot. |
| No blind test edited, renamed, deleted or weakened | **Held.** The 24 pre-existing files are untouched; WP62 only added 6 new ones. Counts move up. |
| No change to `_run_blind.py` | **Held.** |
| Staging depth derived per set, not hardcoded | **Held.** Runner resolved `plugin / 3` from the sets' own imports. |
| Non-zero executed count | **Held.** 22 and 110. |
| Run from repo root, `PYTHONIOENCODING=utf-8` | **Held.** Launched via `visible-console` `run_python` with an absolute script path + `await_console`; the WP55 runner sets the encoding itself. |
| No new dependency | **Held.** |

**`tsc` was deliberately not run as a WP62 gate.** `plugin/tsconfig.json` includes only
`src/**/*.ts`, so these files sit outside the type-checked tree except transiently while staged —
WP62 cannot affect `tsc` by construction. Measuring it now would only have sampled batch B3c's
in-flight edits to `plugin/src/canvas/**`, `plugin/src/files/**` and `plugin/src/sync/**`, and
recorded a foreign batch's work-in-progress as a WP62 build failure.

## 9. Files

**Created (6, all blind-test artefacts):**

```text
workflowArtifacts/canvas-v2/tests/blind_set1/WP17/
├── test_tp13_sideless_edge_file_byte_identical_round_trip_blind1.test.ts
├── test_tp14_junk_flat_key_never_reaches_disk_blind1.test.ts
└── test_tp15_flat_over_register_precedence_is_insertion_order_independent_blind1.test.ts

workflowArtifacts/canvas-v2/tests/blind_set2/WP17/
├── test_tp13_sideless_edge_file_byte_identical_round_trip_blind2.test.ts
├── test_tp14_junk_flat_key_never_reaches_disk_blind2.test.ts
└── test_tp15_flat_over_register_precedence_is_insertion_order_independent_blind2.test.ts
```

**Modified (1):** `workflowArtifacts/canvas-v2/BlindVerificationLedger.md`
**Generated:** `_blind_records/WP17_set{1,2}_vitest.json` + `index.jsonl` entries
