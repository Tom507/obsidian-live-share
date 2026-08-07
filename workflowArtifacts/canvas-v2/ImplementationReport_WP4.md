# Implementation Report — WP4

Attempt: 1, plus the Phase 7 re-entry rework for the amended charter (AC5 / AC6).

## Status: DONE

All six acceptance criteria are met. The full plugin suite is **81 files / 926 tests — 926 passed,
0 failed**. `tsc -noEmit -skipLibCheck` is clean and `npm run build` passes.

**What the rework changed.** AC1–AC4 and the production implementation are untouched — the design
authority ruled that the BUILD_SPEC §4.6 traceability row was the error, not the code, and that the
removal of field-deletion-by-key-omission belongs in P0 as a consequence of AC1. The amended charter
therefore licenses the three probes that pinned the old behaviour (AC5) and requires their
discrimination coverage to be relocated rather than dropped (AC6). This rework is confined to the
test layer plus this report:

- `plugin/src/__tests__/w4-canvas-integrity.test.ts` — exactly three `it(...)` blocks deleted
  (`A4`, `A9`, `A10`), each replaced by a comment recording the retirement and its reason.
- `plugin/src/__tests__/v2/wp4/test_tp08_protected_keys_seed_discrimination_visible.test.ts` — new,
  the AC6 discrimination pair at the still-live host-seed boundary.

`PROTECTED_KEYS` and the `applyToYMap` guard are **unchanged**: same membership, same export, still
live on both seed boundaries. Retiring them there is WP18's job, not WP4's (§3.1 S2). No production
file was touched by the rework, no `.canvas` format change, no `meta.schemaVersion` change, no
version bump, no field-removal path reintroduced anywhere.

---

## Completed Work

| AC | Status | Notes |
|---|---|---|
| AC1 — the C2 intent plan, not the three-way diff against `lastWrittenContent`, decides what reaches the CRDT | DONE | The baseline read and three-way base construction at the old `:520–521` are deleted. `lastWrittenContent` is written and read in exactly one place now: the byte echo breaker (plus the `writeToDisk` redundant-write skip that already existed). Capture-side `roundCanvasGeometry` is applied to every node and edge before anything else looks at them, so rounding can never appear as intent (TC7). |
| AC2 — a byte-identical save is an echo and produces zero CRDT writes | DONE | `content === lastWrittenContent.get(path)` → one debug line, return. No shadow mutation. The semantic `canvasRecordsEqual` / `ymapToRecords` pair is removed entirely. The message keeps the pinned substring `no-op (disk == shared state)`; both pins (`canvas-persistence.test.ts`, `w4-canvas-integrity.test.ts` C2) still pass. |
| AC3 — the closed-view persistence write advances the shadow | DONE | `noteExternalDiskWrite` gained a third job gated on `surfaceStateProvider(path).viewOpen === false`: every written record advances the shadow field-by-field, and every record the shadow still holds as `present` that the content omits becomes `absent`. With `viewOpen === true` the shadow is not touched at all. The host seed in `subscribe` advances the shadow unconditionally (same class of receipt). |
| AC4 — zero writes for a stale field, observable under a dedicated signature | DONE | Discarded staleness is filtered to DIVERGENT discards only (`ymap.get(field) !== discard.value`, evaluated before the transaction). One `logger.debug("canvas-sync", …)` line per pass, format `SHADOW STALE: <path> <n> field(s) not pushed: <kind>/<id>.<field>, …` — ids and field names only, never a value. Exactly one emitter. |
| AC5 — the three probes that pin deletion-by-key-omission (`A4`, `A9`, `A10`) are deleted deliberately and enumerated against the §7 ledger | DONE | All three `it(...)` blocks removed in full from `plugin/src/__tests__/w4-canvas-integrity.test.ts`; a comment at each site records the retirement and its reason so the file explains its own history. Nothing else in that file (or anywhere else) was rewritten, skipped, `.skip`/`.todo`'d, commented out, `.only`'d, weakened or relaxed — `A1`, `A2`, `A3`, `A5`, `A6`, `A7`, `A8` and every non-`A` probe are byte-identical, and no shared helper was removed. Ledger entry below. |
| AC6 — the discrimination coverage is relocated, not dropped; `PROTECTED_KEYS` keeps its membership and export | DONE | `PROTECTED_KEYS` and `applyToYMap` are untouched. A discrimination pair now runs at the still-live host-seed boundary (`subscribe(path,"host")` → `applyCanvasToYMaps` → `applyToYMap`) in `plugin/src/__tests__/v2/wp4/test_tp08_protected_keys_seed_discrimination_visible.test.ts`. One scenario, two runs, one difference; both outcomes asserted and compared directly. Falsifiability verified by hand — see **AC6 Replacement Coverage**. |
| DoD — the Symptom-2 cascade cannot start | DONE | TC5 verifies it on the outbound delta itself across three replicas; TC6 proves the shadow rebase is what does the work (`setShadowRebaseEnabled(false)` reproduces the cascade from the identical fixture). |

### Section 7 contract, item by item

| Contract item | Implemented as |
|---|---|
| `private shadow = createSurfaceShadow()` | field initialiser on `CanvasSync` |
| `getSurfaceShadow()` / `setSurfaceShadow()` | live instance, never a copy / instance replacement for WP5 |
| `setSurfaceStateProvider()` | default `() => ({ viewOpen: false, handedToView: { node: new Set(), edge: new Set() } })`, consulted in `handleLocalModify` AND `noteExternalDiskWrite` |
| `setTombstoneView()` | default `{ isDeleted: () => false }` |
| `setShadowRebaseEnabled()` | default `true`; `false` replaces the classification only — echo breaker, rounding, delete rule, resurrect block and shadow advance are untouched |
| step 5 upsert / delete | `applyIntentPlan(...)`, one record group per id, created once per transaction, `set` only when the current value differs, never a field delete (I7) |
| step 6 shadow advance | `advanceField` per applied upsert, `markRecordAbsent` per applied delete; a denied id advances nothing |
| lock seam | unchanged (`canWriteEntity` / `canDeleteNode`, `denied`, the `LOCK DENIED:` warn, the held baseline). The "previous record" argument is now the shadow's record fields instead of the three-way base |
| host seed (`subscribe`) | `advanceShadowFromContent(path, content, false)` alongside `lastWrittenContent.set(...)` |
| paths | every shadow key is `toCanonicalPath(normalizePath(rawPath))` |

---

## Blocked Items

| Item | Blocker | Workaround attempted |
|---|---|---|
| — | — | none; the attempt-1 escalation (A4/A9/A10 vs I7 phasing) was resolved by the charter amendment of 2026-07-31 and is closed by AC5 + AC6 below |

---

## Deletion Ledger Entry (WP4, BUILD_SPEC §7)

Three pre-existing probes were deleted under the licence granted by the amended charter's **AC5**.
All three lived in `plugin/src/__tests__/w4-canvas-integrity.test.ts`. Each `it(...)` block was
removed in its entirety and replaced at the same site by a comment recording the retirement, the
owning AC and the reason, so the file explains its own history.

| # | Test (verbatim name) | Reason for retirement |
|---|---|---|
| 1 | `A4 ADVERSARIAL: a genuine OPTIONAL-key deletion (color/label) still reaches the CRDT` | Asserted that a save which OMITS `color`/`label` deletes that field from the CRDT. I7 ("observation never deletes") now forbids exactly that on the capture path, so no fixture can satisfy it. Its retirement is an **ACCEPTED, RECORDED user-visible regression** (BUILD_SPEC §3.1 S14): clearing a card's colour or an edge's label via an Obsidian save no longer propagates to peers. Closure is owned by **WP39 AC5** in P5. |
| 2 | ``A9 DISCRIMINATION: with `fromNode` removed from the live guard, A1's scenario LOSES the endpoint`` | Became **UNFALSIFIABLE**, not merely failing. It mutates `PROTECTED_KEYS` and asserts `fromNode` is then lost via `handleLocalModify`, but `handleLocalModify` no longer reads `PROTECTED_KEYS` at all, so disarming the guard cannot change the outcome and the test can never go red. |
| 3 | ``A10 DISCRIMINATION: with `toNode` removed from the live guard, A2's key-diff scenario LOSES the endpoint`` | Same as A9, for `toNode`. |

**Ledger arithmetic — pre-existing baseline bucket: `674 → 671`.** Three tests removed, zero added to
that bucket. The AC6 replacement pair is counted in **WP4's own bucket** (`src/__tests__/v2/wp4`:
`27 → 29`), not against the pre-existing baseline, so the §7 arithmetic on the baseline bucket is the
clean `-3` and nothing else. In the current working tree the same bucket measures
`718 → 715` passing (the charter's `674` figure predates several untracked suites that were already
present before WP4 began); the delta is identical, `-3`, and the bucket is now 42 files / 715 tests,
all passing.

**Explicit statement of scope.** No other test anywhere in the repository was deleted, skipped,
`.skip`'d, `.todo`'d, `.only`'d, commented out, weakened, relaxed, re-pointed or otherwise modified
by this rework. In particular `A1`, `A2`, `A3`, `A5`, `A6`, `A7` and `A8` in the same `describe`
block are untouched and still pass, and every shared helper in that file
(`makeSubscribedCanvas`, `canvasJson`, `docRecords`, `applyRemoteDelta`, `createVault`,
`createSyncManager`, `createRealFileOps`, …) is still present and still used by the surviving probes.
The `PROTECTED_KEYS` import is still consumed by the surviving `A8`. No production file changed.

---

## AC6 Replacement Coverage

**New file:** `plugin/src/__tests__/v2/wp4/test_tp08_protected_keys_seed_discrimination_visible.test.ts`
(placed in WP4's own visible bucket precisely so the §7 baseline arithmetic above stays a clean `-3`).

**New tests, and the coverage each restores:**

| Test | Restores | Boundary |
|---|---|---|
| ``T1 DISCRIMINATION `fromNode`: intact guard keeps the endpoint through the host seed, disarmed guard loses it`` | The `fromNode` endpoint-protection discrimination formerly held by **A9** | `CanvasSync.subscribe(path, "host")` → `applyCanvasToYMaps` (`canvas-sync.ts:938–970`) → `applyToYMap` (`canvas-sync.ts:229–251`) — the host seed, still LIVE until WP18 |
| ``T2 DISCRIMINATION `toNode`: intact guard keeps the endpoint through the host seed, disarmed guard loses it`` | The `toNode` endpoint-protection discrimination formerly held by **A10** | same boundary |

**Why this boundary.** `PROTECTED_KEYS` is dead on `handleLocalModify` (which is why A9/A10 became
unfalsifiable) but still live on the two seed boundaries: `applyCanvasToYMaps` and the
`CanvasPersistence` cold-open file parse (`canvas-persistence.ts:373`, `:381`). The host seed was
chosen because it runs through the real `CanvasSync` over a doubled vault + sync manager and a real
`Y.Doc` — the same composition the existing suites already use for this seam.

**The scenario (one scenario, two runs, one difference).** The doc already holds the complete edge
`e1 {fromNode:n1, toNode:n2, fromSide, toSide}`; the local `.canvas` lists the same edge as a
partial/transient record `{id:"e1", color:"3"}` with the endpoints missing. `subscribe(PATH,"host")`
merges the file over the doc through `applyToYMap`, whose full-merge branch deletes every doc key the
file record omits — except the ones `PROTECTED_KEYS` shields. Run A leaves the guard whole; run B
deletes exactly one key (`fromNode`, resp. `toNode`) from the live exported Set, restores it in a
`finally`, and asserts the restore. Nothing else differs between the runs.

**Assertions.** Both outcomes are asserted (intact → `"n1"` / `"n2"`; disarmed → `undefined`) *and*
compared directly (`intact?.fromNode === disarmed?.fromNode` must be `false`), so a change that
quietly neutralises the guard cannot leave both halves green. Two anti-vacuity guards are also in
place: the non-protected key the partial file *does* carry (`color: "3"`) must have landed, proving
the merge genuinely ran; and the *other* endpoint must survive run B, proving the loss is
attributable to the one key that changed rather than to the merge failing wholesale.

**Evidence that the pair is genuinely falsifiable (the A9/A10 failure mode, checked by hand).** The
`PROTECTED_KEYS.delete(...)` line in each run B was temporarily neutralised (commented out) and the
file re-run. Both tests went **RED** with the intended signature:

```text
FAIL  test_tp08_protected_keys_seed_discrimination_visible.test.ts > T1 DISCRIMINATION `fromNode` …
AssertionError: VACUOUS: the endpoint survived even with the guard disarmed — this pair proves
nothing: expected 'n1' to be undefined

FAIL  test_tp08_protected_keys_seed_discrimination_visible.test.ts > T2 DISCRIMINATION `toNode` …
AssertionError: VACUOUS: the endpoint survived even with the guard disarmed — this pair proves
nothing: expected 'n2' to be undefined

Test Files  1 failed (1)   Tests  2 failed (2)
```

The neutralisation was then reverted and the file restored byte-for-byte; the pair is green again.
This is the exact check A9/A10 could no longer pass on the capture path, and it demonstrates that at
the seed boundary the guard — not something else — is what produces the outcome.

**Non-goal honoured.** `PROTECTED_KEYS` was not removed, its membership was not changed and its
export was not changed (§3.1 S2 escalation rule); `A8` still pins its membership. The guard is
retired by WP18, not here.

---

## Tools Created (by Worker 3 this attempt)

| Tool | Type | Purpose |
|---|---|---|
| — | — | none |

---

## Changes Made

| File | Change |
|---|---|
| `plugin/src/files/canvas-sync.ts` | modified (attempt 1) — the only production file touched, in the whole WP including the rework |
| `plugin/src/__tests__/canvas-sync.test.ts` | attempt 1 — 3 fixture adjustments (see next section) |
| `plugin/src/__tests__/w4-canvas-integrity.test.ts` | attempt 1 — 1 fixture adjustment (see next section); **rework** — `A4`, `A9`, `A10` deleted under AC5, each replaced by a retirement comment |
| `plugin/src/__tests__/v2/wp4/test_tp08_protected_keys_seed_discrimination_visible.test.ts` | **rework** — NEW: the AC6 discrimination pair at the still-live host-seed boundary |
| `workflowArtifacts/canvas-v2/TaskCharter_WP4_CaptureShadowRebase.md` | Charter Status + sections 8/9 |

File-level summary of `canvas-sync.ts`:

- Added imports from `../canvas/canvas-shadow` and `roundCanvasGeometry` from `../canvas/canvas-canonical`
  (`roundCanvasGeometry` had no caller since WP3; it does now).
- Removed the module-private `ymapToRecords`, `canvasRecordsEqual`, `objChanged` and `applyKeyDiff`
  helpers and the private `applyLocalDiffToYMaps` method — all of them existed only to serve the
  three-way diff and the semantic echo compare.
- Added module-private `toParsedRecords` / `toParsedSave` (capture rounding + `ParsedSave` shaping),
  the `RECORD_KINDS` constant and two local types (`SaveIndex`, `AppliedIntent`).
- Added the four seams + the shadow accessors listed in the contract table above.
- Rewrote `handleLocalModify` to the documented order of operations, and added the private
  `planCapture`, `applyIntentPlan` and `advanceShadowFromContent` methods.
- Extended `subscribe` (host seed) and `noteExternalDiskWrite` with the shadow receipt.
- Widened the `canWriteEntity` rest-parameter type to `Readonly<Record<string, unknown>>` so the
  frozen `ParsedSaveRecord.fields` can be passed to it. No behaviour change.

No new dependency, no new timer, no new timing constant, no `setTimeout`, no schema or `.canvas`
format change, no version bump, `manifest.json` untouched, `canvas-shadow.ts` and
`canvas-canonical.ts` untouched, `CanvasPersistence` still the single CRDT→disk writer with zero
CRDT writes.

---

## Existing Tests Adjusted

All four are the same, single, behaviour-preserving adjustment: C2's delete rule requires an OPEN
view plus a hand-over receipt for the id, and P0's default surface state is honestly "closed". The
tests below assert that a genuine local delete propagates; they now state that precondition through
the documented `setSurfaceStateProvider` seam instead of relying on the implicit old behaviour.
Nothing else in them changed — no assertion was removed, relaxed or re-pointed. The same property is
independently pinned by WP4's own TC1 T4 (open view + receipt → the delete still happens) and TC1 T3
(closed view → it must not).

| Test file | Test name | What changed and why |
|---|---|---|
| `plugin/src/__tests__/canvas-sync.test.ts` | `genuine local delete removes the node from the Y map` | Added `setSurfaceStateProvider(() => ({ viewOpen: true, handedToView: { node: {"n1","n2"}, edge: {} } }))` after `subscribe`. Without a hand-over receipt an absence is ignorance, not deletion (I7 / C2 rule 4). |
| `plugin/src/__tests__/canvas-sync.test.ts` | `prunes edges in the shared doc when their endpoint node is locally deleted (GAP-5)` | Same addition (`node: {"n1","n2"}`, `edge: {"e1"}`). The GAP-5 cascade is downstream of the node delete, so the node delete has to be able to happen at all. |
| `plugin/src/__tests__/canvas-sync.test.ts` | `a genuine local DELETE of a whole record is still honoured (protection is per-key only)` | Same addition (`node: {"n1","n2"}`). |
| `plugin/src/__tests__/w4-canvas-integrity.test.ts` | `A7 a genuine WHOLE-record delete is unaffected by PROTECTED_KEYS` | Same addition (`node: {"n1","n2"}`, `edge: {"e1"}`), applied to the local `t.cs` only — the shared `makeSubscribedCanvas` helper is untouched, so A1–A6 and A9/A10 keep the default closed-view surface. |

---

## Visible Test Results

Run from `plugin/`: `npx vitest run src/__tests__/v2/wp4/` → **8 files, 29 tests, 29 passed, 0 failed.**
(Was 7 files / 27 tests before the rework; the AC6 pair adds one file and two tests.)

| Test | Status | Notes |
|---|---|---|
| TC1 `test_tp01_intent_basis_visible` (5 cases) | PASS | Opposite-verdict states: the stale save is discarded, the genuine change in the same save lands, closed-view absence does not delete, open-view + receipt does, a captured edit advances the shadow. |
| TC2 `test_tp02_byte_echo_visible` (4 cases) | PASS | Byte echo → zero writes + the no-op line; no shadow advance; a one-field change is not swallowed; reordered keys are not an echo and still yield zero writes through the intent diff. |
| TC3 `test_tp03_closed_view_shadow_advance_visible` (4 cases) | PASS | Closed-view receipt advances every field; open view advances nothing; the host seed is the same class of receipt; the advance is path-scoped. |
| TC4 `test_tp04_shadow_stale_signature_visible` (4 cases) | PASS | Exactly one `SHADOW STALE:` line for the divergent field, none when nothing diverges, edge ids in the edge id space, no user data on the line. |
| TC5 `test_tp05_cascade_cannot_start_visible` (3 cases) | PASS | The outbound delta itself carries no write for the stale field; three-way interleaving converges with nothing reverted; repeated stale saves never accumulate. |
| TC6 `test_tp06_discrimination_seam_visible` (3 cases) | PASS | Seam ON vs OFF give opposite outcomes from the identical fixture. |
| TC7 `test_tp07_capture_geometry_rounding_visible` (4 cases) | PASS | Fractional drag → whole pixels + rounded shadow; sub-pixel noise is discarded, not pushed; only the four geometry keys, `-0` → `0`; whole pixels round-trip with zero writes. |
| TC8 `test_tp08_protected_keys_seed_discrimination_visible` (2 cases) | PASS | AC6 replacement pair. Intact guard vs `fromNode`- / `toNode`-disarmed guard at the host seed give opposite outcomes from the identical scenario; both asserted and compared directly; falsifiability re-verified by hand. |

---

## Gate Results (rework, all run from `plugin/`)

| Gate | Command | Result |
|---|---|---|
| WP4 visible set | `npx vitest run src/__tests__/v2/wp4/` | **8 files / 29 tests — 29 passed, 0 failed** |
| Typecheck | `npx tsc -noEmit -skipLibCheck` | **clean** (exit 0, no diagnostics) |
| Build | `npm run build` | **PASS** (`tsc -noEmit -skipLibCheck && node esbuild.config.mjs production`, exit 0) |
| Full plugin suite | `npm test` | **81 files / 926 tests — 926 passed, 0 failed** (duration 41.16 s) |
| Pre-existing baseline bucket | `npx vitest run --exclude "src/__tests__/v2/**"` | **42 files / 715 tests — 715 passed, 0 failed** |

Full-suite delta against the previous state: **80 files / 927 tests (924 pass, 3 fail) → 81 files /
926 tests (926 pass, 0 fail)**. The arithmetic is exactly `−3` (the licensed A4/A9/A10 deletions,
which were the only 3 failures) `+2` (the AC6 pair) `= 926`, and `+1` file for the new test file.
No other test's status changed.

---

## Regression Results

| Suite | Files | Tests | Pass | Fail |
|---|---|---|---|---|
| `npm test` (FULL plugin suite) | 81 | 926 | 926 | 0 |
| `npx vitest run --exclude "src/__tests__/v2/**"` (pre-existing baseline bucket) | 42 | 715 | 715 | 0 |
| `npx vitest run src/__tests__/v2/wp4/` (WP4 visible) | 8 | 29 | 29 | 0 |
| `npx tsc -noEmit -skipLibCheck` | — | — | clean | — |
| `npm run build` | — | — | PASS | — |

Note on the expected baseline: the charter's `674 passed / 35 files` is stale for the current working
tree — the non-v2 suite is 42 files / 718 tests before any WP4 change (`canvas-persistence.test.ts`,
`canvas-single-writer.test.ts`, `w4-canvas-integrity.test.ts`, `wp42/`, `canvas-binding-*.test.ts`,
`reconcile-plan.test.ts` are present and untracked). The §7 ledger arithmetic is stated on the
charter's declared baseline bucket as `674 → 671`; measured on this working tree the same bucket goes
`718 → 715`, an identical `−3`. After the rework that bucket is fully green. The three failures
recorded at attempt 1 are gone because those three tests are gone, by licence — not by weakening
anything.

Runner notes (as briefed, confirmed): Vitest 4.0.18, `--reporter=dot` works (`basic` is removed),
full run ≈ 41 s because of the 33.5 s sleeper in `wp5/latency.test.ts` — not a hang. Biome's
whole-file `format` finding on touched files is the known CRLF artifact; no repo-wide formatter was
run.

---

## Summary for Worker 3

The capture path is now re-based on the Surface-Shadow. Observable behaviour: `CanvasSync` owns a live
`SurfaceShadow` (`getSurfaceShadow()`), the echo breaker is byte equality against `lastWrittenContent`,
every parsed save is geometry-rounded before classification, `noteExternalDiskWrite` advances the
shadow when and only when `surfaceStateProvider(path).viewOpen === false`, and a stale save now emits a
single `SHADOW STALE: <path> <n> field(s) not pushed: <kind>/<id>.<field>` debug line for the divergent
fields only and produces zero outbound delta for them. To trigger it by hand: subscribe a canvas, let a
peer change a field, then write the pre-change file back to disk and call `handleLocalModify` — the
CRDT is unchanged and the log names the field. `setShadowRebaseEnabled(false)` restores the old
observation-as-intent behaviour and reproduces the cascade, which is how TC6 discriminates.

The Phase 7 rework closed the one item that was open. Following the amended charter, the three probes
that pinned the old deletion-by-key-omission behaviour — `A4`, `A9`, `A10` in
`w4-canvas-integrity.test.ts` — are now **deleted** rather than left red, each with a retirement
comment at its old site and a §7 ledger entry above (baseline bucket `674 → 671`); nothing else was
deleted, skipped, `.only`'d, weakened or relaxed, and no production code changed. Because the guard
they exercised is dead only on `handleLocalModify` and is still LIVE on the seed boundaries until
WP18, their discrimination coverage was relocated, not dropped: the new
`v2/wp4/test_tp08_protected_keys_seed_discrimination_visible.test.ts` re-runs the same
one-scenario/two-runs/one-difference shape against the real `CanvasSync` host seed
(`subscribe` → `applyCanvasToYMaps` → `applyToYMap`), and I verified by hand that neutralising the
disarm turns both halves RED with the intended `VACUOUS: …` message — so `PROTECTED_KEYS` stays
falsifiable for the rest of the initiative and `A1`/`A2` stay non-vacuous. All gates are green:
WP4 visible 8/29, `tsc` clean, `npm run build` PASS, full suite **81 files / 926 tests, 926 pass,
0 fail**. One deliberate posture remains for the next WP to note (not a defect):
`surfaceStateProvider` still defaults to `viewOpen: false`, so in production P0 the capture path
emits no record deletes until WP5 wires the real view state. The accepted, recorded cost of A4's
retirement — clearing `color`/`label` via an Obsidian save no longer propagates — is BUILD_SPEC
§3.1 S14, owned by **WP39 AC5**, and must not be "fixed" inside P0 by reintroducing key-absence
semantics.
