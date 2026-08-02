# Worker 3 Handover — B14, WP19 licensed amendments + rows 9–14 strengthening

**Batch:** B14 (Phase 7 re-entry, does not consume attempts)
**Scope:** WP19 amendment licence only (§7 WP19 entry). **WP64 explicitly out of scope.**
**Measured:** 2026-08-02, plugin suite at the working-tree revision described below.
**Verdict:** `HANDOVER_READY` — row 8's falsification gate **PASSED**, licence **not** revoked.

> **Provenance rule (Worker 2, B14).** Every row below is a *measurement*, not a timeless fact.
> Where the measurement contradicted the prepared ledger it is recorded as such, and no row claims
> more certainty than was actually observed. Line numbers are the **pre-amendment** ones used by the
> §7 ledger — they are the row's identity. Post-amendment lines have shifted; current sites are
> identified by their assertion message instead, which is stable.

---

## Result

| Gate | Result |
|---|---|
| Full plugin suite | **231 files · 1346 tests · 1346 passed · 0 failed** |
| Test count | **unchanged** (1346 → 1346) — nothing added, nothing removed |
| `tsc --noEmit` | **clean** (exit 0, measured with no blind run in flight) |
| `npm run build` | **PASS** |
| Production source changed | **none** — `canvas-tombstone.ts` restored byte-clean, md5 `edc6303d157ca89b3ed840ac4bc43cb4` verified |
| Row 8 falsification | **PASSED** — licence confirmed |
| Rows 9–14 inversion | **all six RED**, each confirmed on the strengthened assertion |

Files touched — **test instruments only**, six files:

```text
plugin/src/__tests__/
├── canvas-sync.test.ts                                       ← rows 1, 2, 3
├── w4-canvas-integrity.test.ts                               ← row 4
└── v2/
    ├── wp4/test_tp01_intent_basis_visible.test.ts            ← rows 5, 10
    ├── wp5v2/test_tp05_handover_and_close_visible.test.ts    ← rows 6, 7, 9, 11
    ├── wp6/chaos_degraded_adapter.test.ts                    ← rows 8, 12, 13 (one helper)
    └── wp18/test_tp03_capture_boundary_..._visible.test.ts   ← row 14
```

Nothing under `server/`, `docker/`, `deploy/`, `plugin/main.js`, `manifest.json`, `package.json`.

---

## Ledger — rows 1–8 (the red rows, licensed AMENDMENT)

The stale line is **replaced**; strictness rises on every row.

| # | File · `it` line | Stale assertion line(s) | Why stale, not violated | Strictness after |
|---|---|---|---|---|
| 1 | `canvas-sync.test.ts:358` | `:387` `nodesMap.size).toBe(1)` · `:388` `get("n2")).toBeUndefined()` | Both spell "the delete propagated" as key absence. It still propagates — as a tombstone. Bug C's subject untouched. | `isTombstoneSuppressed(…,"n2") === true`; projection node ids `toEqual(["n1"])`; `nodesMap.size).toBe(2)`; container fields `x=100`, `y=100`, `type="text"` preserved. **1 property → 3** (suppression, projection, AC1 non-destruction). |
| 2 | `canvas-sync.test.ts:500` | `:529` `edgesMap.get("e1")).toBeUndefined()` | **Cascade row.** AC3 keeps the cascade but expresses it through suppression, not key removal. | `buildCanvasData(...).edges` `toEqual([])`; **measured** `isTombstoneSuppressed(…,"e1") === false` — Correction 2 **confirmed here**; container + `fromNode`/`toNode` preserved. |
| 3 | `canvas-sync.test.ts:869` | `:893` `nodesOf().get("n2")).toBeUndefined()` · `:894` `size).toBe(1)` | `PROTECTED_KEYS` is a per-key guard; the whole-record delete is still honoured, only its spelling changed. | Suppressed `true`; projection `toEqual(["n1"])`; `size).toBe(2)`; container `x=9`, `y=9`, `type="text"`. |
| 4 | `w4-canvas-integrity.test.ts:331` | `:352` `docRecords(…,"nodes").n1` · `:354` `docRecords(…,"edges").e1` | **See deviation below — the ledger over-described this row.** | `n1` suppressed `true`; `projected.nodes` `not.toContain("n1")`; `projected.edges` `toEqual([])`; `e1` container `toEqual` an **exact 5-field object** (`id/fromNode/fromSide/toNode/toSide`). |
| 5 | `v2/wp4/test_tp01:219` (T4) | `:231-234` `nodes.has("n2")).toBe(false)` | Hand-over gating is the subject and WP19 never touched it; the shadow half at `:235` still passes. | Suppressed `true`; projection `toEqual(["n1"])`; container `text="peer"`, `x=400`. **`:235` kept verbatim.** |
| 6 | `v2/wp5v2/test_tp05:159` (T2) | `:168` `nodes.has("n2")).toBe(false)` | A confirmed apply still licenses the omission to count as a deletion. | Suppressed `true`; projection `toEqual(["n1","n3"])`; container `text="two"`, `x=300`. **`:169` kept verbatim.** |
| 7 | `v2/wp5v2/test_tp05:172` (T3) | `:192` `nodes.has("n1")).toBe(false)` | The handed-over record's proven deletion still happens. | Suppressed `true`; projection `not.toContain("n1")`; container `text="one"` preserved. Edited **together with row 11**. |
| 8 | `v2/wp6/chaos_degraded_adapter.test.ts:580` (D2) | `:594-597`, `:598`, `:602` | **Helper repair, not a line swap.** `hasNode` (`:127-129`) was raw key presence, which post-WP19 returns `true` unconditionally. | `hasNode` redefined to **projection visibility**. All three assertions kept **verbatim** (`toBe(false)`, `toBe(false)`, `not.toBe(...)`). Restores the collapsed discrimination. |

### Row 4 — measured deviation from the prepared ledger (two corrections)

Both were verified by direct probe, not inferred:

1. **Only `:354` was actually red.** `:352` passed **vacuously**: this fixture's nodes never reach the
   doc at all. C18 AC1 refuses both at the host-seed boundary —
   `INGEST REJECTED signature: boundary=host-seed refused node n1 (MISSING_TYPE_SPECIFIC)` (same for
   `n2`) — because a `type:"text"` node here carries no `text`. Measured immediately **after the seed
   and before any delete**, so nothing was destroyed; the containers never existed.
   → The row's required "both containers preserved" is **not assertable**. This is recorded in-test as
   a comment. Completing the fixture is the **WP18 fixture-completion class / WP64**, not this licence.
2. **`e1` *does* carry its own tombstone here** (`{t,by,on:true}`), because this test's new file omits
   the edge entirely — a **direct edge delete**, not merely a cascade. Correction 2's "a cascaded edge
   has no tombstone of its own" holds for **row 2** (measured `false`) but **not for row 4**. I used
   the mandated **projection form** and did **not** assert the negative tombstone, which would have
   been false here.

---

## Ledger — rows 9–14 (the green rows, licensed STRENGTHENING)

Original assertions **kept verbatim**; pins **added** beside them. Test count unchanged.

| # | File · `it` line | Now-vacuous assertion | Added pins |
|---|---|---|---|
| 9 | `v2/wp5v2/test_tp05:142` (T1) | `:153-156` `nodes.has("n2")).toBe(true)` — **the test's only oracle** | `isTombstoneSuppressed(…,"n2") === false` + projection `toContain("n2")` |
| 10 | `v2/wp4/test_tp01:201` (T3) | `:212-215` `nodes.has("n2")).toBe(true)` | Same pins; `:216` shadow `"present"` kept verbatim. Pairs with row 5 — **both halves now tombstone-aware** |
| 11 | `v2/wp5v2/test_tp05:172` (T3) | `:193-195` `nodes.has("n2")).toBe(true)` | Same pins, in the **same edit as row 7**: after it `n1` is suppressed and `n2` is not — the discrimination the test exists for. Original line **re-added verbatim** (see note) |
| 12 | `v2/wp6/chaos_degraded_adapter.test.ts:432` (T2) | `:435-439` `newRecordLocal/Peer2/Peer3` | **Fixed by the row 8 helper repair.** Assertions verbatim; the *reading* became projection visibility |
| 13 | `v2/wp6/chaos_degraded_adapter.test.ts:442` (T3) | `:453` `newRecordLocal).toBe(true)` | Same helper repair |
| 14 | `v2/wp18/test_tp03:79` | `:110` `nodes.has("n1")).toBe(true)` — **key presence is the only oracle**; the E2/I11 loss class | `isTombstoneSuppressed(…,"n1") === false` + projection `toContain("n1")` + bystander field `text="existing"` intact |

**Bonus, same helper:** `chaos_degraded_adapter` T5 (recovery) also read `hasNode(doc,"n4")` as a
survival oracle and was equally vacuous. The row 8 repair de-vacuates it too. Not chartered; reported,
not counted as a row.

**Note on row 11.** It was first written as a *replacement*. Rows 9/10/14 are strengthenings where the
ledger says "keep verbatim as well", so for consistency — and to honour "no assertion is relaxed or
deleted" — the original `nodes.has("n2")).toBe(true)` was **re-added verbatim** beside the new pins.
It can no longer fail on its own; it is kept because nothing in a strengthening row should be removed.

---

## Row 8 — falsification verdict: **PASSED, licence confirmed**

Measured through a temporary probe on the D2 seam (probe removed afterwards):

| Run | `n4` key present | `n4` suppressed | `n4` visible in projection | peer 2 visible |
|---|---|---|---|---|
| **disarmed** (`perFieldReceipt: false`) | `true` | **`true`** | **`false`** | `false` |
| **armed** (`on`) | `true` | `false` | **`true`** | `true` |

The disarmed run shows `n4` **suppressed and invisible** — i.e. **the delete did happen**. This is the
condition the licence required. It is therefore a **stale reading, not a hand-over-gating regression**,
the row is **not revoked**, and `ESCALATE_TO_WORKER2` is **not** triggered. It also shows exactly why
the repair was needed: under key presence both rows read `true`, which is what had silently collapsed
D2's enabled-vs-disabled discrimination at `:602`.

---

## Rows 9–14 — inversion results, each confirmed **on the strengthened assertion**

Perturbation: the **C23 suppression inversion** — `isTombstoneSuppressed` negated in
`plugin/src/canvas/canvas-tombstone.ts`. Because `buildCanvasData` routes through
`isRecordSuppressed` → `isTombstoneSuppressed`, this inverts both the tombstone reads **and** the
projection, i.e. it is a true suppression inversion rather than a local edit.
**Restored byte-clean; md5 `edc6303d157ca89b3ed840ac4bc43cb4` verified; zero perturbation markers remain.**

| # | Went red? | Failed on | On-target? |
|---|---|---|---|
| 9 | **RED** | `"an omission without a hand-over receipt TOMBSTONED a record (I7)"` — a **new** pin | **Yes, directly** |
| 10 | **RED** | `"a partial observation TOMBSTONED a record (I7 violated)"` — a **new** pin | **Yes, directly** |
| 11 | **RED** | under global inversion it failed first on **row 7's** pin (masked) → **isolated** | **Yes, via targeted injection** |
| 12 | **RED** | its own `newRecordLocal` line, `"the degraded view deleted a card it never received"` | **Yes, directly** (the repaired *reading* is the strengthening) |
| 13 | **RED** | its own `newRecordLocal).toBe(true)` line | **Yes, directly** |
| 14 | **RED** | under global inversion it failed first on the **pre-existing** `cap-good` line (masked) → **isolated** | **Yes, via targeted injection** |

### The two masked rows, isolated

A row that goes red for an unrelated reason has not been strengthened, so rows 11 and 14 were
re-measured under a **targeted fault injection** of the exact loss class each pin guards. Both
injections were removed and the files verified byte-identical afterwards.

- **Row 11** — injected `deleted["n2"] = {on:true}` ("the held card *is* deleted by the save it never
  saw"). Result: **RED on its own pin**, `"the card the user was holding was deleted by a save it
  never saw"`. Row 7's pin stayed green, proving the two halves now discriminate independently.
- **Row 14** — injected `deleted["n1"] = {on:true}` ("the refusal *spares* the bystander by
  tombstoning it"). Result: **RED on its own pin**, `"the refusal TOMBSTONED an unrelated record"` —
  **while the pre-existing `nodes.has("n1")` line at `:110` stayed GREEN.** This is the single
  clearest result in the batch: the old oracle cannot see this loss at all, and the new one does. It
  is the E2/I11 class, so this is precisely the regression that would otherwise ship silently.

---

## Foreign changes in the tree — reported, not touched

A sibling batch (**B15**) is live in the **WP3 blind sets**. Observed in `git status` and left alone:

- `plugin/src/__tests__/v2/wp3/test_file_shape_tabs_visible.test.ts` (M)
- `workflowArtifacts/canvas-v2/tests/blind_set1/WP3/test_file_shape_tabs_blind1.test.ts` (M)
- `workflowArtifacts/canvas-v2/tests/blind_set2/WP3/test_value_preservation_blind2.test.ts` (M)
- `workflowArtifacts/canvas-v2/_run_blind.py` (M), `_blind_records/` (untracked)

None of these are B14 territory and none were edited here. The 1346/1346 green tree above was measured
with those edits present in the working tree.

---

## Risk notes for Worker 4

| Item | Note |
|---|---|
| Row 4's node half | Its only non-vacuous node oracle is now the **tombstone** assertion. The fixture's nodes are refused by C18 AC1 (`MISSING_TYPE_SPECIFIC`) and never enter the doc, so container survival is unpinnable there until the fixture is completed under **WP18/WP64**. |
| Correction 2's scope | "A cascaded edge carries no tombstone" is true for **row 2** and false for **row 4**, where the save omits the edge and the delete is direct. Do not generalise it into a rule; it depends on whether the save omits the edge. |
| Residual vacuity | The wider class (~8 partial-oracle tests, tombstone-blind `docRecords()` helpers, ~10 remaining 2-arg `serializeCanvas`/`buildCanvasData` call sites) is **still vacuous by design** and chartered to **WP64**. It was deliberately not touched. |
| `docRecords()` helpers | Still tombstone-blind in `w4-canvas-integrity.test.ts` and the `wp5v2` files. WP64 owns them. Row 4 reads them only for **non-destruction**, where blindness is harmless. |

---

## Summary for Worker 4 entry point

WP19's licence is fully discharged. Deletion now reads as a **value** everywhere the licence reached:
13 assertion lines across 8 tests restated, 6 vacated survival oracles strengthened, one shared helper
(`hasNode`) redefined from key presence to projection visibility — which simultaneously repaired D2's
collapsed discrimination and de-vacuated rows 12, 13 and T5. Test count never moved, no assertion was
relaxed, skipped or deleted, and no production source changed. The half that matters most — rows 9–14,
which pin **I7**, the invariant whose regression means user data disappearing — is now **falsifiable**,
demonstrated by going red under suppression inversion and, for the two rows that inversion masked, under
a targeted injection of the exact loss class.
