# Worker 3 Handover — B10, PHASE VI Verification Integrity

**Batch:** B10 · **Scope:** WP55, WP56, WP57, WP58 (narrow_scope as briefed)
**Result:** all four DONE. Ledger covers every blind set that existed when the sweep ran; the one
set that appeared mid-batch (WP17, from the live B2) is named as uncovered rather than skipped.

---

## Scope of This Run

Tasks completed: **WP55, WP56, WP57, WP58**.
Tasks with risk flags: **none** — but this batch's *output* is a set of findings that need
chartering, listed in §5.

## Risk Summary

| WP | Status | risk_flag | Priority for W4 |
|---|---|---|---|
| WP55 — Blind-set execution integrity | DONE | NONE | HIGH — every other verification claim now rests on this instrument |
| WP56 — Re-verification, discoverable sets | DONE | NONE | NORMAL |
| WP57 — Re-verification, suspect sets | DONE | NONE | NORMAL |
| WP58 — Probe side-effect freedom | DONE | NONE | NORMAL |

---

## 1. The headline

**Every blind set in the project executes. Not one row in the ledger is VACUOUS.**

| Verdict | Rows | WP56 scope | WP57 scope |
|---|---|---|---|
| CONFIRMED | **48** | 27 | 21 |
| DIVERGENT | **4** | 3 | 1 |
| VACUOUS | **0** | 0 | 0 |
| UNRUNNABLE | **0** | 0 | 0 |
| **Total** | **52** | 30 | 22 |

52 rows over all 46 `(WP, set)` pairs that existed on disk when the sweep ran (23 WP folders ×
2 sets); more than 46 because WP44, WP46 and WP47 each hold a TypeScript **and** a Python half,
measured separately.

**One exception, stated up front: `WP17` is not covered.** Batch B2 created
`tests/blind_set{1,2}/WP17/` at 21:42–21:49, *while this batch was running* and after the sweep
had begun — so a directory listing today shows 24 folders, not 23. WP17 is outside both C56's
and C57's declared scope, and B2 was still authoring the files as this ledger was compiled.
Running a set another agent is mid-write would have produced noise and misreported B2's work in
progress, which C56 §5 forbids. **WP17 is unverified, has no row, and that absence is not a
pass.** It needs a row once B2 closes.

The batch was commissioned on the premise that this project's verification claims might be
worthless. **They are not.** The debt turned out to be one of **reproducibility**, not of
execution: the claims were true, but no committed instrument could reproduce them. That is still
a serious process defect — it is just a different one, and the distinction is load-bearing for
how much of this project's history you should trust.

## 2. WP55 — the instrument, and the falsification

`_run_blind.py` is rewritten. `PASS` is assigned in exactly one function and only when a
**structured reporter artefact** (vitest `--reporter=json`, pytest `--junit-xml`) reports a
non-zero collected count with zero failures. Exit code is never accepted as evidence. Zero
collection is a hard failure under the named reason `ZERO_COLLECTION`.

All three no-op paths closed:

1. **Filename glob** — staged copies are renamed to the framework pattern; normalisation is
   name-only and **sha256-enforced** byte-identical to the authored file. Blind files on disk are
   never written to. A file that cannot be made discoverable is named individually and fails the
   run.
2. **Per-set staging depth** — derived by resolving every relative import against the real
   filesystem across candidate `(package, depth)` pairs, not by heuristic. WP5 proves the
   heuristic would fail: it mixes `../../../canvas/…` with `../../harness/…`, and only depth 3
   satisfies both. **WP1–WP16 stay at depth 3 and were not disturbed.**
3. **Cross-package target** — WP41 resolves uniquely to `server/` and is run against the server
   vitest project.

**Falsification evidence** (`python _run_blind.py --selftest`):

```
[1] nonexistent set WP99999      -> NO_SUCH_SET
[2] unresolvable-import set      -> IMPORT_UNRESOLVED: no (package, depth) placement resolves
                                    every relative import. Best candidate plugin/depth2 left
                                    unresolved: ../../this/module/does/not/exist
[3] control set (should PASS >0) -> PASS: collected=1
[4] staging dirs after all runs  -> all absent

FALSIFICATION RESULT: PASS - a non-executed set cannot report green
```

Leg [3] is what makes the rest meaningful: the control fixture is identical to leg [2] except its
import resolves, and it runs and passes with a recorded count. **A runner that fails everything
is as useless as one that passes everything.**

Before/after on WP42 set1 — old runner: `No test files found, exiting with code 1`;
repaired runner: `PASS, plugin/depth 2, 7 files staged, collected 28, 28/0`.

## 3. WP41 / WP42 — the discrepancy, resolved

Measured under the repaired runner:

| WP | set1 | set2 | Combined | Files | B8/P6 claimed |
|---|---|---|---|---|---|
| WP41 | 24 | 20 | **44** | 16 | **44** / 16 (`B8_P6:54`) |
| WP42 | 28 | 45 | **73** | 14 | **73** / 14 (`B8_P6:87`) |

**Four independent claimed quantities — 44, 73, 16, 14 — reproduce exactly.** The counts are
real and attributable to the stored artefacts. Worker 2's ruling that "both statements cannot be
true" was a sound inference on the evidence then available, and it is now falsified.

This is **not** "re-ran it and logged a fresh green". A fresh green would only show the code
works today. What is recorded is the exact reproduction of numbers written down by an earlier
agent that could not have known this run's outcome — evidence about the *claim*, not just the
code. Had the counts come back 51 and 66, B8/P6 would have been invalidated.

**What was actually wrong:** the committed `_run_blind.py` could never have produced those
numbers. B8/P6 staged the files through a rename-and-retarget mechanism it never recorded —
by hand or by throwaway script, doing exactly what WP55 has now made permanent. The residual
finding stands: **a claim not reproducible by committed tooling is unverifiable when made,
however true it later proves to be.**

## 4. Two corrections to the batch's own premises

Both are stated because this batch is about the accuracy of claims, and it would be incoherent to
propagate inaccurate ones.

- **"46 undiscoverable files" is wrong; it is 38.** WP41 16 + WP42 14 + WP46-TS 8 = 38. The three
  affected sets and their per-set counts in the charter are right; only the sum is wrong.
- **"Exits 0 and is reported as a pass" does not reproduce.** Vitest 4.0.18 exits **1** on zero
  discovery, and neither vitest config sets `passWithNoTests`. The old runner propagated that
  code, so a non-discoverable set surfaced as a **loud red**, not a silent green. The three
  defects are real *as causes* — those sets genuinely could not execute — but the concealment
  mechanism was mis-stated, and that is exactly what made B8/P6's green inexplicable and pointed
  WP57 at the right answer. The repaired runner no longer depends on the exit code either way.

Also found beyond the three declared defect classes: **WP47 and WP49's TypeScript halves need
staging depth 2**, which the old runner never used. They were broken by defect 2 alone. The
charter lists WP44 as depth-affected — it is not (depth 3, unaffected) — and omits WP49.

## 5. Findings handed back — each needs a Worker 2 charter

Recorded, **never repaired**. No blind assertion was touched anywhere in this batch.

| WP | Set | Finding | Note |
|---|---|---|---|
| **WP3** | set2 | 2 tests in `test_value_preservation_blind2`: round trip returns 5 keys, expected 7; edge optional fields 5 vs 9. Claim `B1_P0:125` said 0 fail. | **B2 territory** (`plugin/src/canvas/**`, `plugin/src/files/**`) — **not touched**, per the batch constraint. B2 is live there; the cause may be its in-flight work. |
| **WP44** | set2 (TS) | `test_tp12_no_server_no_port_blind2`: imports `{node:crypto, node:http}`, test pins exactly `{node:http}` | stale expectation — a later WP added `node:crypto` |
| **WP49** | set1 (TS) | `test_tp4_timeout_semantics_preserved_blind1` | never previously measured |
| **WP49** | set2 (TS) | 4 tests, incl. `test_tp3_control_edit_still_bumps_blind2` expecting a 2-key `session.info`, receiving WP46's settled 9-key payload | stale expectation vs a settled payload |
| **WP47** | set2 (py) | `test_tp04_teardown_exit_paths_blind2` — 2 structurally unsatisfiable points (double `pytest.raises`) | **defective test**, not an implementation failure. Left unmodified per WP57 §5. Predicted by B9a's claim, so CONFIRMED not DIVERGENT. |

Most of these share a shape: **stale expectations**, where a later additive WP changed a shared
surface and an earlier blind set still pins the older shape. That is a consequence of serialising
many WPs over one shared module. Whether each is a real defect or an outdated assertion was
deliberately **not** decided here — deciding it requires touching an assertion, which this batch
is forbidden to do.

Three of the four DIVERGENT rows come from sets **nobody had ever measured** (WP44/WP49 TS halves
carried no blind count in any handover). That is the gap "absence of a row is never readable as a
pass" was written to close.

## 6. WP58 — the probe defect

The second bump was **not from the probe**. `sessionInfo()` is inert and C46 AC2's structural
argument is correct. The duplicate was a trailing `markActivity()` in `simulateEdit`: WP49 moved
the activity seam onto the doc (`observeDoc` registered *before* the transaction), so
`doc.transact` already marks activity for that edit — and the pre-WP49 explicit call counted it a
second time. It fired twice on every `simulateEdit`, probe or no probe.

Fixed by deleting the redundant call. **WP49 AC1 is preserved exactly** — the seam still never
inspects origin; the tempting origin-filter route was not taken and no escalation was needed.

| WP46 blind set | Before | After |
|---|---|---|
| set1 | 22 collected, **1 fail** | **22 / 22 / 0** |
| set2 | 19 / 19 / 0 | **19 / 19 / 0** |

Visible regression gate across all four WPs sharing `e2e-control.ts`: **158 collected, 158
passed, 0 failed.** No test changed; WP46's counts unchanged; WP46 stays `DONE` with only the two
required forward-pointer lines added.

**Not done:** the C46 AC1 production tree-shaking counter-check was not re-run (the change removes
a statement and adds no symbol, so it cannot introduce a marker — but this is reasoned, not
measured). `npm run build` is separately blocked on pre-existing out-of-scope WP49/WP13 `tsc`
errors. **Recommend Worker 4 run it.**

## 7. Artefacts

| File | Content |
|---|---|
| `_run_blind.py` | rewritten runner (WP55) |
| `_sweep_blind.py` | project-wide re-verification driver |
| `_gen_ledger.py` | ledger generator — every count transcribed by script, none retyped |
| `_run_visible.py` | visible regression gate |
| `_blind_records/*.json`, `index.jsonl` | machine-readable per-set records |
| `BlindVerificationLedger.md` | 52 rows, tallies, coverage boundary, findings |
| `ImplementationReport_WP55/56/57/58.md` | per-WP detail |

## 8. Summary for Worker 4 Entry Point

The blind gate is now trustworthy and cheap to re-run: `python _run_blind.py <WP> [set1|set2|both]`
for one set, `python _sweep_blind.py [wp…]` for many, `python _run_blind.py --selftest` to
re-falsify the instrument itself. Every run leaves a JSON record; **a set with no record is not a
set that passed.**

What Worker 4 should probe hardest: the four DIVERGENT rows in §5, because each is either a real
defect in a WP whose handover says it is green, or a stale assertion that has been silently
protecting nothing. They cannot be told apart without touching an assertion, which is a Worker 2
decision. Second priority: the production-bundle check in §6.
