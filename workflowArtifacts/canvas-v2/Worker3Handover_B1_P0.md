# Worker 3 Handover — Canvas V2, Batch 1 / Phase P0

**Batch:** 1 of 8 · **Phase:** P0 · **Scope:** WP1–WP7
**Outcome returned to Dispatcher:** `HANDOVER_READY` — WP4 escalation RESOLVED and reworked · `BLOCKED` (WP7, unchanged)
**Date:** 2026-07-31 · **Revised:** 2026-08-01 (Phase 7 re-entry, WP4 rework)

> **Revision note (2026-08-01).** This handover was originally returned as
> `ESCALATE_TO_WORKER2` because of the WP4 / I7 phasing contradiction. Worker 2 resolved it in
> favour of **resolution (a): I7 lands in P0 for the capture path.** WP4's charter was amended
> with **AC5** (licensed retirement of `A4`/`A9`/`A10`) and **AC6** (relocation of the
> `PROTECTED_KEYS` discrimination coverage), and WP4 was re-run under Phase 7 re-entry — which
> does **not** consume an attempt from the original 1–3 budget. **The plugin suite is now
> 0 failed.** Only WP4 was in scope for the rework; WP1–WP3, WP5, WP6 were not touched and
> WP7 remains BLOCKED for the reasons recorded below, unchanged.

---

## Scope of This Run

- **Tasks completed:** WP1, WP2, WP3, **WP4 (all six ACs — reworked 2026-08-01)**, WP5, WP6
- **Tasks with risk flags:** WP7 (blocked). WP4's flag is **cleared** — see the resolution section.
- **Execution order used:** WP1 → WP3 → WP2 → WP4 → WP5 → WP6 → WP7 (topological on the charters' `Depends on`)

**Deviation from the workflow, declared:** Phase 2 and Phase 3 were interleaved per work package instead of generating all tests first and then implementing all. Reason: visible tests land in `plugin/src/__tests__/v2/` and are collected by `npm test`, so batching all test generation first would have left the suite red across the whole run and destroyed the per-WP regression signal. Every gate was still applied per WP.

**Second deviation, declared:** WP6's deliverable *is* a test suite. Generating blind counterparts for a test-suite WP would have been meta and low value, so WP6's robustness oracle is its own mandatory discrimination variants (AC3 requires them to be part of the suite, not a manual procedure) rather than blind sets.

---

## Risk Summary

*(Worker 4 reads this table first — per-task detail below is only needed for HIGH-risk WPs.)*

| WP | Status | risk_flag | Priority for W4 |
|---|---|---|---|
| WP1 Surface-Shadow core | DONE | NONE | NORMAL |
| WP2 Shadow-relative intent diff | DONE | NONE | NORMAL |
| WP3 Canonical form core | DONE | NONE | NORMAL |
| **WP4 Capture re-based on shadow** | **DONE** (AC1–AC6, reworked 2026-08-01) | **NONE** | **HIGH** |
| WP5 Per-field apply receipt | DONE (attempt 3) | NONE | HIGH |
| WP6 Chaos suite I | DONE | NONE | NORMAL |
| **WP7 E2E rig mandatory gate** | **BLOCKED** (AC4 only: PASS) | **HIGH** | **CRITICAL** |

---

## Final Gate Status

*(Re-measured 2026-08-01 after the WP4 rework. Every number below is from a run on the current tree.)*

| Gate | Result |
|---|---|
| `npm run build` (plugin) | **PASS** (`tsc -noEmit -skipLibCheck` + esbuild production) |
| `npm test` (plugin) | **81 files / 926 tests — 926 pass, 0 fail** (41.10 s) |
| Previously-failing tests | **none** — the 3 failures were exactly `A4`/`A9`/`A10` and are now deliberately retired under WP4 AC5 |
| `npm test` (server) | **18 files / 149 tests — all pass** (untouched by this batch and by the rework) |
| `npx tsc -noEmit -skipLibCheck` | clean |
| WP4 visible set | **8 files / 29 tests — all pass** (was 7 / 27; +1 file, +2 tests = the AC6 pair) |
| WP4 blind_set1 | **7 files / 25 tests — all pass** (Phase 7 regression re-run) |
| WP4 blind_set2 | **7 files / 28 tests — all pass** (Phase 7 regression re-run) |

### Test-count accounting against the deletion ledger

| Source | Files | Tests |
|---|---|---|
| Baseline (measured at run start) | 35 | 674 |
| **Deleted by WP4 under AC5** | 0 | **−3** |
| Baseline after the licensed deletion | 35 | **671** |
| Added by this batch (`src/__tests__/v2/`) | 39 | 211 |
| Added by the concurrent WP41/WP42 batch (`src/__tests__/wp42/`) | 7 | 44 |
| **Total** | **81** | **926** |

**Deletion ledger — one entry, fully enumerated.**

| WP | Licence | Tests deleted | Named in |
|---|---|---|---|
| WP4 | charter AC5 + BUILD_SPEC §7 amendment (licensed list is now WP4, WP21, WP22, WP33) | `A4`, `A9`, `A10` — all in `src/__tests__/w4-canvas-integrity.test.ts` | `ImplementationReport_WP4.md` → *Deletion Ledger Entry* |

- `A4` — asserted that a save which OMITS `color`/`label` deletes that field from the CRDT. I7 forbids exactly that on the capture path, so no fixture can satisfy it. **Accepted, recorded user-visible regression** (BUILD_SPEC §3.1 S14), closure owned by **WP39 AC5** in P5.
- `A9` — became **unfalsifiable**, not merely failing: it disarms `PROTECTED_KEYS` and asserts `fromNode` is then lost via `handleLocalModify`, but that path no longer reads `PROTECTED_KEYS` at all, so disarming the guard cannot change the outcome.
- `A10` — same as `A9`, for `toNode`.

**Baseline arithmetic: `674 → 671`, exactly as the amended BUILD_SPEC §7 requires.** The count drift is fully explained: **−3** licensed deletions on the baseline bucket, **+2** in WP4's own bucket for the AC6 replacement pair, **+1 file**. Net `927 → 926`. Nothing else in the repository was deleted, skipped, `.skip`'d, `.todo`'d, `.only`'d, commented out, weakened or relaxed; `A1`, `A2`, `A3`, `A5`, `A6`, `A7`, `A8` and every shared helper in that file are untouched and still pass.

---

## Per-Task Detail

### WP1 — Surface-Shadow core
- Status: DONE (attempt 1)
- Changed files: **created** `plugin/src/canvas/canvas-shadow.ts` (zero imports, matching the `reconcile-plan.ts` precedent)
- Unit test status:

  | Test Set | Files | Tests | PASS | FAIL |
  |---|---|---|---|---|
  | visible | 6 | 32 | 32 | 0 |
  | blind_set1 + blind_set2 | 12 | 59 | 59 | 0 |

- Risk flag: NONE
- Repeated failure points: none
- Open assumptions: `ShadowRecord.state` is `"present" | "absent"` only; `"unknown"` is modelled as the *absence* of a record, and `getRecordState` is the sole discriminator. If a later WP adds `"unknown"` to that union, `markRecordAbsent` and never-observed collapse and WP2's delete rule breaks.
- Priority for Worker 4: NORMAL

### WP2 — Shadow-relative intent diff
- Status: DONE (attempt 1)
- Changed files: `plugin/src/canvas/canvas-shadow.ts` (appended `planIntentDiff` + its types; no WP1 export altered)
- Unit test status:

  | Test Set | Files | Tests | PASS | FAIL |
  |---|---|---|---|---|
  | visible | 6 | 53 | 53 | 0 |
  | blind_set1 + blind_set2 | 12 | 99 | 99 | 0 |

- Risk flag: NONE
- Known edge case worth Worker 4's attention: a tombstone-blocked record must be registered in the per-kind "seen in save" set **before** the `isDeleted()` short-circuit. Register it after, and rule 3 reads the record as missing from the save and emits a `DeleteIntent` for a record still plainly in the file. Only the composed TC6 test discriminates this.
- Priority for Worker 4: NORMAL

### WP3 — Canonical form core
- Status: DONE (attempt 1)
- Changed files: **created** `plugin/src/canvas/canvas-canonical.ts` (zero-import pure core); **modified** `buildCanvasData` and `serializeCanvas` in `plugin/src/files/canvas-sync.ts` to route through it
- Unit test status:

  | Test Set | Files | Tests | PASS | FAIL |
  |---|---|---|---|---|
  | visible | 10 | 47 | 47 | 0 |
  | blind_set1 + blind_set2 | 20 | 101 | 101 | 0 |

- Risk flag: NONE
- Existing tests adjusted: **none** — both predicted regressions were re-checked and pass unmodified.
- Open assumptions: (1) byte identity assumes **unique ids**; records sharing an id keep input order. Nothing in P0 can produce a duplicate id, and WP17's `(ord, id)` sort supersedes this. (2) P0 sorts records by `id`, which discards the `.canvas` array order Obsidian uses as z-order. AC4 explicitly requires deterministic order without `ord`; WP16/WP17 restore it in P1. **Worker 4 should confirm z-order is not user-visibly wrong in a live canvas.**
- Priority for Worker 4: NORMAL

### WP4 — Capture re-based on the shadow ← reworked, escalation closed
- Status: **DONE** — all six ACs (AC1–AC4 from the original run, AC5 + AC6 from the 2026-08-01 rework)
- Changed files: `plugin/src/files/canvas-sync.ts` only (production — unchanged by the rework);
  rework was **test-layer only**: `plugin/src/__tests__/w4-canvas-integrity.test.ts` (3 probes retired)
  and **new** `plugin/src/__tests__/v2/wp4/test_tp08_protected_keys_seed_discrimination_visible.test.ts`
- Unit test status:

  | Test Set | Files | Tests | PASS | FAIL |
  |---|---|---|---|---|
  | visible | 8 | 29 | 29 | 0 |
  | blind_set1 + blind_set2 | 14 | 53 | 53 | 0 |

- Risk flag: **NONE** (was HIGH). The HIGH flag existed only because three pre-existing tests failed
  with no charter licensing their retirement. Worker 2 supplied that licence; the probes are retired
  deliberately and enumerated, and the coverage that mattered was relocated rather than dropped.
- **Rework (Phase 7 re-entry, 2026-08-01) — what changed and what deliberately did not:**
  - **No production code changed.** Worker 2's resolution confirmed the WP4 implementation was
    correct and that the BUILD_SPEC §4.6 traceability row was the error. The blast radius of the
    rework is two test files and three artifacts — verified, zero files under `plugin/src/files/`,
    `plugin/src/canvas/`, `plugin/src/main.ts` or `server/` were touched.
  - **AC5** — `A4`, `A9`, `A10` deleted in full (no rewrite, no skip, no weakening), each replaced at
    its site by a comment recording the retirement, the owning AC and the reason.
  - **AC6** — the discrimination coverage was **relocated, not dropped**. `PROTECTED_KEYS` keeps its
    membership and its export and was **not** removed: it is dead on `handleLocalModify` but still
    live on the two seed boundaries (`CanvasSync.applyCanvasToYMaps` at `canvas-sync.ts:938–970` and
    the `CanvasPersistence` cold-open at `canvas-persistence.ts:373/:381`). Retiring it there is
    **WP18's** job, not WP4's. The new pair drives the real `CanvasSync.subscribe(path, "host")` seed
    with a doc holding a complete edge and a partial `.canvas` record that omits the endpoints.
  - **Falsifiability independently verified by Worker 3 Core, not merely asserted by the coder.**
    I physically removed the `if (PROTECTED_KEYS.has(key)) continue;` line from `applyToYMap` and
    re-ran the pair: **both tests went red** (`expected undefined to be 'n1'` / `'n2'`). The guard was
    then restored byte-clean (1 occurrence present, 0 residue) and the pair is green again. This is
    the check `A9`/`A10` could no longer pass, which is precisely why they were retired.
  - The pair also carries its own anti-vacuity assertions: a non-protected key the partial file
    *did* carry must still land (proving the merge actually ran), and the untouched half of the guard
    must still hold (proving the loss is attributable to the one key that changed).
- What landed: `lastWrittenContent` is no longer the intent basis; the C2 intent plan is. The echo breaker is byte equality. `roundCanvasGeometry` finally has a caller (capture-side, before `planIntentDiff`). `noteExternalDiskWrite` advances the shadow when `viewOpen === false`. Discarded staleness is logged under a dedicated `SHADOW STALE:` signature, filtered to divergent discards, ids and field names only, never values.
- Existing tests adjusted (4, all behaviour-preserving — no assertion removed or relaxed): three delete-assertions in `canvas-sync.test.ts` and `A7` in `w4-canvas-integrity.test.ts` now declare their `viewOpen` + hand-over precondition through the documented `setSurfaceStateProvider` seam, because P0's default surface state is honestly "closed".
- **Deliberate P0 side effect Worker 4 must know:** with the default `viewOpen: false`, the capture path emits **no record deletes at all** until real view state is wired. WP5 wires it.
- **Second accepted regression Worker 4 must know (BUILD_SPEC §3.1 S14):** clearing a card's `color`
  or an edge's `label` via an Obsidian save **no longer propagates to peers** — the value returns on
  the next reconcile. This is intrinsic to I7 plus snapshot capture, is accepted and recorded rather
  than absorbed, and its closure is owned by **WP39 AC5** in P5. **Worker 4 must not report this as a
  defect, and must not "fix" it by reintroducing key-absence semantics** — that violates I7 and is an
  ESCALATE.
- Priority for Worker 4: **HIGH** (was CRITICAL — the escalation is closed; the byte-echo-breaker /
  baseline-drift probe below is why it stays above NORMAL)

### WP5 — Per-field apply receipt
- Status: DONE (attempt 3 of 3)
- Changed files: `plugin/src/canvas/canvas-shadow.ts` (C5 block), `plugin/src/main.ts` (wiring only — `canvasApplied` removed; shadow read from `canvasSync.getSurfaceShadow()` at its single use site, never cached)
- Unit test status:

  | Test Set | Files | Tests | PASS | FAIL |
  |---|---|---|---|---|
  | visible | 7 | 35 | 35 | 0 |
  | blind_set1 + blind_set2 | 14 | 50 | 50 | 0 |

- Risk flag: NONE at handover — but this WP consumed all three attempts, and **the honest reason is that two of the three failures were defects in my own test artifacts, not in the implementation.** Full disclosure in "Process failures" below, because it affects how much the attempt count should be read as a robustness signal.
- Governing rule now in the module: *advance precisely what was confirmed, advance nothing that was not, and let `exhaustive` mean what it says.*
- Design trap avoided (pinned by TC5/T4): closing a canvas clears the hand-over receipt only, **never** the shared shadow path. Clearing the path would wipe the capture basis and reopen the cascade window on every close.
- Known edge cases not covered:
  - **Rounding asymmetry** — the capture path rounds geometry while the receipt stores desired values verbatim per the section 7 contract. Costs one extra `geometry` classification for a fractional peer coordinate; never a wrong value or a lost edit. Likely belongs in WP4/§4.4 rather than here.
  - **Object/array-valued unknown `.canvas` keys** can never satisfy the shadow's `===` staleness test on either side, so such a field always reads as intent and always classifies structural. A WP1 value-model / `reconcile-plan` comparator property, present with or without WP5.
- Priority for Worker 4: HIGH

### WP6 — Chaos suite I
- Status: DONE (attempt 1)
- Changed files: **test-only**, zero production changes — created `plugin/src/__tests__/v2/wp6/chaos_cascade.test.ts` (7) and `chaos_degraded_adapter.test.ts` (8)
- Unit test status:

  | Test Set | Files | Tests | PASS | FAIL |
  |---|---|---|---|---|
  | visible | 2 | 15 | 15 | 0 |
  | blind | n/a — see the declared deviation above | | | |

- Determinism (AC4): the delay is **structural, not temporal** — the production hook `CanvasSync.setOnRemoteCanvasUpdate` is wired to a pending queue the scenario drains before or after `handleLocalModify`. No sleep, no timer, no timing constant, no `Date.now`/`Math.random`. Each file self-scans its own source for those and asserts two identical repeat runs. Three peers throughout; every oracle is CRDT/shadow state, never a log string.
- Discrimination variants (AC3), all automated and each also compared against its enabled run so a quietly neutralised seam breaks a test:

  | Scenario | Seam disabled | Variant asserts |
  |---|---|---|
  | Delayed apply + save | `setShadowRebaseEnabled(false)` | `n1.x → 0` locally **and on peers 2+3**; stale text pushed back |
  | Delayed apply that never lands | `advanceFromReceipt(…, {perFieldReceipt:false})` | basis jumps to 500, then both peers reverted to 0 |
  | Unavailable adapter + open view | `setShadowRebaseEnabled(false)` | open view leaks x and text into both peers |
  | `setData`-gone adapter | `advanceFromReceipt(…, {perFieldReceipt:false})` | peers reverted **and** the bogus hand-over lets the save delete `n4`, a card the view never received |

- Risk flag: NONE
- Priority for Worker 4: NORMAL

### WP7 — E2E rig as mandatory gate ← **BLOCKED**
- Status: **BLOCKED.** AC4 verified PASS; AC1, AC2, AC3 cannot be executed in this environment.
- AC4 (**PASS**, verified directly): after `npm run build`, the production `plugin/main.js` contains **zero** occurrences of `e2e-control`, `__LS_E2E__`, `createE2EControlServer`, `LIVESHARE_E2E` and `e2eControl`. The whole `src/testing/` module is tree-shaken out. The rebuild introduced no diff to the tracked `main.js`.
- AC1–AC3 (**BLOCKED**) for two independent reasons:
  1. **Environmental.** Obsidian is not installed on this host. Checked `%LOCALAPPDATA%\Obsidian\Obsidian.exe` and `C:\Program Files\Obsidian\Obsidian.exe` specifically, plus a recursive scan of `C:\` and `H:\` to depth 4. No hit.
  2. **Structural — and this is the more important one.** `tools/launch_liveshare_e2e.py` **is not a real-Obsidian rig and was never intended to be.** It bundles the plugin with esbuild and aliases the `obsidian` import to the mock (`--alias:obsidian=src/__mocks__/obsidian.ts`), then boots two *lightweight plugin hosts* in one node process against an in-process relay. Its own usage document states this explicitly: *"Scope: the **lightweight plugin host** model (BUILD_SPEC §5 A2) — NOT two full Obsidian instances. Real full-Obsidian orchestration is T3 and out of scope."*

  WP7 AC1 requires "a two-vault run against a **real Obsidian**" and AC2 requires driving real node moves, creates, deletes and a stale-view save. **Making the existing rig green would not satisfy either AC**, because the existing rig does not exercise real Obsidian at all. Satisfying WP7 as written requires building the T3 rig that the E2E infra project deliberately deferred — a new work package, not a fix to this one.
- **This was NOT worked around, faked, or silently downgraded**, per the batch instruction. The rig was not run, because running it green would have proven nothing about AC1/AC2.
- What Worker 2 / the owner needs to decide: either (a) charter the T3 real-Obsidian rig as its own WP and let WP7 depend on it, or (b) rewrite WP7's ACs to target the lightweight two-host rig that actually exists, accepting that this is a weaker gate than CONCEPT_V2 Teil 14 intends. Either way the "mandatory gate from P0 onward" claim in the BUILD_SPEC's project-level Definition of Done cannot be honoured as currently written.
- Priority for Worker 4: **CRITICAL** — this is the R2 verification debt the whole initiative exists to discharge, and it is still outstanding.

---

## ESCALATION TO WORKER 2 — WP4 / the I7 phasing contradiction → **RESOLVED 2026-08-01**

> **RESOLUTION (Worker 2): resolution (a) — I7 lands in P0 for the capture path.**
> The BUILD_SPEC §4.6 traceability row was the error, **not** the WP4 implementation, which stands
> unchanged. Rationale: CONCEPT_V2 Teil 5's diff rule is the P0 design authority, it annotates its
> only write case with "(I7)" and has no field-removal category, so the removal of
> deletion-by-key-omission is a **consequence** of WP4 AC1, not a separate step. Resolution (b) was
> rejected because it would reopen WP2's chartered contract after it was implemented and green, and
> would reintroduce the key-absence semantics that I7 exists to abolish.
>
> **Spec changes Worker 2 made:** §4.6's I7 row now reads *"P0 (capture path): WP2, WP4"*; §3.1 S4
> now names all three write boundaries and their differing phases and states that `PROTECTED_KEYS`
> stays live after P0 and **WP4 must not remove it**; §3.1 S14 records A4's retirement as an accepted
> user-visible regression owned by WP39 AC5; §7's licensed-deletion list becomes **WP4, WP21, WP22,
> WP33** with expected arithmetic **674 → 671**.
>
> **What Worker 2 found that I had missed:** `A9`/`A10` were not merely failing, they were
> **unfalsifiable** — they mutate `PROTECTED_KEYS`, which `handleLocalModify` no longer reads at all.
> And `PROTECTED_KEYS` is **still live on the two seed paths**, so the correct action was to
> *relocate* the discrimination coverage there (AC6), not to lose it. My original escalation had
> assessed the guard's coverage as simply lost in P0 — that was wrong, and the relocation is
> strictly better than either resolution I proposed.
>
> **Rework outcome:** WP4 re-run under Phase 7 re-entry, test layer only, no production change.
> Plugin suite **0 failed**. The analysis below is retained as the record of the original
> escalation; it is **historical** and its "no charter licenses this" conclusion is now superseded.

**One sentence (original):** WP4's AC1 forces the capture path to derive all CRDT writes from the C2 intent plan, which structurally eliminates field-deletion-by-key-omission in **P0**, but the BUILD_SPEC assigns that removal and the retirement of the three tests pinning it to **P1** (WP18/WP22) — so P0 cannot end with `npm test` green.

### The three failures

All in `plugin/src/__tests__/w4-canvas-integrity.test.ts`:

- `A4 ADVERSARIAL: a genuine OPTIONAL-key deletion (color/label) still reaches the CRDT`
- `A9 DISCRIMINATION: with fromNode removed from the live guard, A1's scenario LOSES the endpoint`
- `A10 DISCRIMINATION: with toNode removed from the live guard, A2's key-diff scenario LOSES the endpoint`

All three assert that a save which **omits** a field deletes that field from the CRDT. A9/A10 additionally become *unfalsifiable*: they disarm `PROTECTED_KEYS` and assert the endpoint is then lost, but if deletion-by-omission no longer exists at all, disarming the guard changes nothing and the discrimination test can never fail.

### Why this is a spec contradiction and not an implementation defect

| Evidence | Source |
|---|---|
| WP4's interface is specified as "Output: CRDT upserts and delete intents derived from the intent plan **only**" | BUILD_SPEC §5, component C4 |
| WP4 AC1 requires the C2 intent plan to decide what is written | BUILD_SPEC §5 C4 AC1 |
| The C2 intent plan has **no field-removal category** — its three outputs are upserts, record-level deletes, and discarded staleness | BUILD_SPEC §5 C2; WP2 AC1–AC5 |
| Therefore routing capture through `planIntentDiff` necessarily removes field-deletion-by-omission | follows from the three rows above |
| But I7 "Observation never deletes" is traced to **WP12, WP14, WP19, WP22** — all P1 | BUILD_SPEC §4.6 traceability table |
| And the AC that actually states the rule is **WP18** (P1) AC3: "Partial observation produces upserts only — no local write path deletes a doc key that is merely absent from the incoming record (I7)" | BUILD_SPEC §5, component C18 |
| And `writeRecordMinimal`'s key-deletion behaviour is "**Superseded and removed (WP22)**" | BUILD_SPEC §3.1 S4 |
| And only **WP21, WP22, WP33** are licensed to delete tests; an unexplained drop is an abort criterion | BUILD_SPEC §7 deletion ledger |
| WP4's charter contains **no** "tests pinning the removed behaviour are deleted deliberately" AC, unlike WP21 and WP33 which both do | TaskCharter_WP4 vs BUILD_SPEC §5 C21/C33 |

I searched the BUILD_SPEC and every P0 charter for `A4`, `A9`, `A10` and `PROTECTED_KEYS`: **nothing anywhere licenses a P0 work package to retire these three probes.**

The coder was explicitly instructed that test deletion is forbidden and correctly left them red rather than weakening them. That is the right outcome — a red test that names a real design question is worth more than a green one that hides it.

### The two clean resolutions, for Worker 2 to choose between

**(a) Let I7 land in P0 for the capture path.** Add an AC to WP4 licensing the deliberate retirement of A4/A9/A10, with a deletion-ledger entry naming them, in the same form WP21 and WP33 already use. Cheapest, and consistent with CONCEPT_V2 Teil 4: *"Löschung = explizites Delete-Ereignis (I7), nicht Key-Abwesenheit."* Cost: `PROTECTED_KEYS` loses its discrimination coverage from P0 until the tombstone WPs restore an equivalent, so the repo temporarily cannot prove that endpoints are protected.

**(b) Keep field-removal alive through P0.** Give C2 an explicit field-removal category gated on a "complete observation" receipt, deferring I7 to P1 exactly as the traceability table says. Preserves all three probes and the deletion ledger as written. Cost: it extends WP2's chartered contract after WP2 is already implemented and green, and it re-introduces the very key-absence semantics that I7 exists to abolish — so it is a deliberate two-phase design with a known throwaway.

**My read, offered as input and not as a decision:** (a) is more honest about where the design is going, but it should be an explicit, recorded retirement rather than a silent one — which is exactly why this is Worker 2's call and not mine.

---

## Process failures in this run — full disclosure

These affect how the evidence above should be weighted, so they are recorded rather than buried.

1. **I sent WP5 into attempt 2 on a false signal.** A blind test failed; I read it as an implementation weakness and issued the standard "not robust enough, generalize" instruction. The blind test was in fact defective — its save was byte-identical to the vault seed, so WP4's byte echo breaker correctly short-circuited before the shadow was consulted. The coder duly made the shadow *more conservative*, which was the wrong direction. **Attempt 2 was my error, not the coder's**, and I told the coder so at attempt 3 to stop it over-correcting again.

2. **I then wrongly declared a regression.** When a WP4 blind test failed after attempt 2, I concluded attempt 2 had regressed WP4's cascade guarantee, and said so with more confidence than the evidence supported. The coder's counter-claim — that the test is nondeterministic by construction because two peers write the same key concurrently and Yjs breaks the tie on a random `clientID` — was correct. I verified it independently by running the unchanged tree six times: runs 2 and 5 passed, runs 1, 3, 4 and 6 failed. **There was no regression.** The test has since been repaired to be causally deterministic, and the blind suite is now stable over three consecutive full runs.

3. **I breached context isolation for WP6.** I left the blind-test staging directory in `plugin/src/__tests__/v2blind/` when I launched the WP6 coder, so that sub-agent could see blind tests for WP1–WP5. Mitigation: WP6 is not graded against blind sets, it added only two test files that nothing imports, and Vitest isolates files — but the isolation rule was still broken and a future run should clean staging before spawning.

4. **Two of my own test artifacts were defective in the same way** (byte-identical-to-seed saves), and a third was nondeterministic. All three were repaired by their authoring sub-agent with assertions unchanged. The blind sets are only as good as their fixtures, and in this run they cost roughly two wasted implementation attempts.

**Net effect on confidence:** the *implementation* evidence is strong — every WP's blind sets are green and stable, and no production defect was ever traced to WP1–WP6. The *process* evidence is weaker than the attempt counts suggest: WP5's three attempts reflect my misreadings, not three genuine robustness failures.

---

## Risk Notes for Worker 4

**WP4 (HIGH — was CRITICAL).** The escalation is **closed**; it was a design question, not an instability, and Worker 2 resolved it in favour of I7 landing in P0. WP4's own mechanism is well covered: 29 visible and 53 blind tests, all green and stable, with the blind sets re-run as a Phase 7 regression check after the rework. Two things Worker 4 should carry forward: (1) the `color`/`label` clear-via-save regression is **accepted and owned by WP39 AC5** — do not report it as a defect and do not fix it by reintroducing key-absence semantics; (2) `PROTECTED_KEYS` is now guarded only at the seed boundaries and its falsifiability there rests entirely on the new AC6 pair — if a later WP touches `applyToYMap`, that pair is the canary. What Worker 4 should probe hardest is the **interaction between the byte echo breaker and the baseline**: the breaker correctly silences a save that is byte-identical to `lastWrittenContent`, so anything that leaves the baseline stale (a remote delta that never reaches disk, a missed `noteExternalDiskWrite`, a persistence write that fails) will silently suppress genuine user intent. That exact failure mode produced two false alarms inside this run in test fixtures — it will produce real ones in production if the baseline can ever drift. **This is the single highest-value integration probe available.**

**WP4/WP5 (HIGH).** With `viewOpen` defaulting to false, the capture path emits no record deletes at all. WP5 wires real view state. Worker 4 should verify with a live view that deleting a card in Obsidian actually propagates — the unit layer cannot prove this, because the surface-state provider is injected in every test.

**WP5 (HIGH).** The shadow advance rule is the whole safety property, and it is asymmetric: advancing too eagerly silently converts a user's genuine later edit into "staleness" and discards it (data loss); advancing too conservatively turns a stale restatement into fresh intent and lets it overwrite newer peer state (the cascade). Both directions are live risks and neither is fully provable at unit level. Probe: a peer whose apply partially fails, then edits, then saves.

**WP3 (NORMAL).** Record order is now id-sorted, which discards Obsidian's z-order until WP16/WP17 restore it via `ord`. Worth one human look at a real canvas with overlapping cards.

**WP7 (CRITICAL).** Nothing in this batch has been verified against a real Obsidian. The entire P0 mechanism set is proven only at unit and injected-seam level. That is precisely the R2 verification gap this initiative was created to close, and it remains open.

---

## Summary for Worker 4 Entry Point

P0's mechanism is now observable end to end at the unit and injected-seam level. The entry points are: `CanvasSync.handleLocalModify(path)` for capture (it now derives writes from `planIntentDiff` against the per-field Surface-Shadow instead of a three-way diff against `lastWrittenContent`); `CanvasSync.noteExternalDiskWrite(path, content)` for the closed-view shadow advance; and `main.ts`'s reconcile path, which now advances that same single shadow per confirmed field via `buildApplyReceipt` / `advanceFromReceipt`. There is exactly one shadow instance, owned by `CanvasSync` and reached through `getSurfaceShadow()`.

Four injected seams exist for probing and are the fastest way to see the mechanism work or fail: `setSurfaceStateProvider(fn)` (view open + which records were handed over), `setTombstoneView(view)`, `setShadowRebaseEnabled(false)` (disables the shadow rebase — the cascade returns), and `advanceFromReceipt(…, {perFieldReceipt:false})` (restores V1 record-snapshot semantics). WP6's two chaos suites drive all four and are the best executable documentation of the intended behaviour; start there.

To reproduce the original user symptom, use WP6's `chaos_cascade.test.ts`: delay the view apply, save from the stale view, and observe that under V2 no outbound delta is produced, while flipping `setShadowRebaseEnabled(false)` makes the stale value propagate to all three peers.

---

## Automation Candidates

- **Blind-set staging is manual and error-prone.** Staging into `plugin/src/__tests__/v2blind/<wp>/`, running, and cleaning up was done by hand each cycle; forgetting the cleanup is what breached WP6's isolation. A small script (stage → run → always clean up, even on failure) would remove a whole class of mistake.
- **A fixture lint for the two defects this run kept hitting** would have saved roughly two implementation attempts: (1) a save written byte-identical to the vault seed while the test expects CRDT writes; (2) an assertion whose expected value is decided by a concurrent same-key write rather than by causal order. Both are mechanically detectable.
- **`npx vitest run src/__tests__/v2` matches `v2blind` by substring.** Always use the trailing slash (`src/__tests__/v2/`). Worth encoding in the RepoMap runner-gotchas section alongside the Vitest 4 `--reporter=basic` note.
