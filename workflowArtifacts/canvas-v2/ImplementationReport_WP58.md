# Implementation Report — WP58: Readiness probe side-effect freedom

**Status:** DONE · **Changed file:** `plugin/src/testing/e2e-control.ts` (one statement removed,
replaced by an explanatory comment) · plus the two forward-pointer lines required by the charter.

---

## 1. Where the second bump came from

**Not from the probe.** `sessionInfo()` reads nine fields and returns them; it registers nothing,
subscribes to nothing and issues no request. C46 AC2's structural argument — "exactly one
outbound request site, one module-level frozen payload" — is **correct**, and the charter was
right that the side effect enters by a path that argument does not cover.

The duplicate was in `simulateEdit`, and it is a sequencing artefact of two correct changes:

```
async simulateEdit(path, change) {
  ...
  observeDoc(doc);            // WP49: registers doc.on("update", markActivity)
  doc.transact(() => { ... }); // fires "update"  -> markActivity() -> bump()   #1
  markActivity();              // pre-WP49 seam   -> bump()                     #2
  return { applied: true };
}
```

`observeDoc` is registered **before** the transaction, so the transaction's own `update` event
already marks activity for this very edit. The trailing `markActivity()` was the *original*
activity seam and was correct until WP49 moved that seam onto the doc itself. From that point it
counted one edit twice — deterministically, on every `simulateEdit`, whether or not a probe was
issued.

**The probe's role was to make it visible, not to cause it.** The blind test issues a probe and
then one edit and asserts `bump` fired once; it fired twice. Any test that performed a single
`simulateEdit` and counted bumps would have caught it — but none existed, and WP46's TS blind set
(the one that did) was not executable by the committed runner until WP55.

## 2. Why C46's structural argument did not cover it

C46 AC2 reasons about the **request** path: how many outbound sites exist and what payload they
send. The defect is a duplicate **count** on the **edit** path. The two are disjoint. A
structural claim about `session.info` could be entirely true — it is — while the counter it was
meant to protect still advanced twice. That is precisely why Worker 2 required WP58 to be gated
on an *observable* criterion rather than a structural one, and that judgement is vindicated by
where the defect actually turned out to live.

## 3. The fix

The trailing `markActivity()` in `simulateEdit` is removed, and replaced by a comment recording
why it was correct before WP49 and why it is a double-count after.

**This does not make the activity seam origin-aware.** WP49 AC1 requires that the seam
*never* inspect origin, so that peer-originated updates count. That property is untouched: every
update to an observed doc still marks activity, whatever its origin. The charter explicitly
flagged "make the seam ignore updates whose origin is the probe" as a WP49 AC1 regression and an
escalation rather than a fix — **that route was not taken, and no escalation was needed**,
because the real fix is a deletion of a redundant count, not an origin filter.

The change is one statement inside a single method. The WP44 / WP46 / WP47 / WP49 regions of
`e2e-control.ts` are otherwise byte-preserved, per the additive-layering constraint.

## 4. Verification

**The oracle, under the repaired WP55 runner** (`_blind_records/WP46_set1_vitest.json`):

| WP46 blind set | Before | After |
|---|---|---|
| set1 | 22 collected, 21 pass, **1 fail** | **22 collected, 22 pass, 0 fail** |
| set2 | 19 collected, 19 pass, 0 fail | **19 collected, 19 pass, 0 fail** |

Both carry recorded **non-zero** collected counts, satisfying AC4. The failing test
`test_probe_side_effect_free_blind1 > does not disturb an edit that follows it`
(`expected "vi.fn()" to be called 1 times, but got 2 times`) now passes.

**No test was changed.** The fix is entirely in the implementation. WP46's test counts are
unchanged (22 and 19), no blind or visible assertion was edited, and the nine-key `session.info`
payload and both amended assertions are exactly as WP46 left them.

**Visible regression gate** (`_run_visible.py`, covering the four WPs that share
`e2e-control.ts` plus the control-module suite — `e2e-control.test.ts`, `wp46/`, `wp47/`,
`wp49/`, `t3/wp44/`):

```
VISIBLE GATE: collected=158 passed=158 failed=0
```

**Sibling blind sets, re-run after the fix — no regression:** WP44 (11/11 set1 TS, 66/66 and
87/87 pytest), WP47 (59/59 and 60/60 TS, 92/92 pytest). WP49's pre-existing failures
(set1 1, set2 4) are **numerically identical before and after** the change, confirming this fix
neither caused nor masked them. They are recorded in `BlindVerificationLedger.md` as findings
owned by WP49.

## 5. AC coverage

| AC | Status | Evidence |
|---|---|---|
| 1 — probe + one edit advances the counter by exactly one | MET | `test_probe_side_effect_free_blind1` green; the double-count is deleted at source |
| 2 — the no-edit property holds observably, not structurally | MET | asserted by an executed blind test with a recorded count, not inferred |
| 3 — N consecutive probes then one edit still advance by one | MET | the probe never touched the counter; with the duplicate removed the count is a pure function of doc updates, independent of probe count. Covered by the same blind file's re-runnable-probe points. |
| 4 — verified under C55 with non-zero counts, implementation fixed not test | MET | 22/22 and 19/19 recorded; zero test edits |
| 5 — WP46 not reopened | MET | WP46 stays `DONE`; only the two forward-pointer lines were added |

## 6. Not done, and why

**AC1's production tree-shaking counter-check (C46 AC1) was not re-run in this batch.** The
charter's gate asks for an esbuild production bundle grepping to 0 for
`e2e-control|LIVESHARE_E2E|e2eControlPort`, with a `__LS_E2E__=true` counter-check confirming the
0 is real. This change **removes** a statement from a module that is already excluded from
production bundles and adds no import, no symbol and no new reference, so it cannot introduce a
marker into the production bundle that was not there before. The check was nevertheless not
executed here, and this is reported rather than assumed. `npm run build` is additionally known to
fail at its `tsc` stage on pre-existing, out-of-scope WP49/WP13 errors, which would have to be
worked around to run it. **Recommend Worker 4 re-run the bundle check as part of its gate.**
