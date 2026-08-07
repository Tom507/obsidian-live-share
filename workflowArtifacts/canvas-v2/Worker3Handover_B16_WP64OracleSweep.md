# Worker 3 Handover — B16, WP64 tombstone-blind oracle sweep

**Batch:** B16 · **Scope:** **WP64 only.** WP65 explicitly out of scope — `_run_blind.py` and
`_blind_records/` were not touched.
**Measured:** 2026-08-02 · **Verdict:** `HANDOVER_READY`
**Full ledger:** `ImplementationReport_WP64.md` (§4 AC3 · §5 AC1 · §6 AC2 · §7 fixture · §8 AC4)

> Every row here is a **measurement**, not a timeless fact. Where a measurement contradicted the
> charter it is recorded as a contradiction.

---

## Result

| Gate | Result |
|---|---|
| Full plugin suite (11:14, **before** the foreign WP24 batch landed) | **231 files · 1346 tests · 1346 passed · 0 failed** |
| Test count | **unchanged** 1346 → 1346 — nothing added, removed, skipped or relaxed |
| `tsc --noEmit` · `npm run build` (same window) | **exit 0** · **exit 0** |
| Production source changed | **none** — `plugin/src/canvas/` byte-identical by `diff -r` |
| Perturbation residue | **none** — every injected file md5-verified restored |
| AC4 falsification | **10/10 RED on their own new pin**, first measurement, none needing isolation |

**30 files touched, all under `plugin/src/__tests__/`.** Nothing under `server/`, `docker/`,
`deploy/`, `plugin/main.js`, `manifest.json`, `package.json`.

---

## What the sweep actually found (the charter's estimates were wrong in both directions)

| Class | Charter | **Measured** |
|---|---|---|
| `docRecords()` helpers | 4 | **4** — exact |
| Partial-oracle tests | ~8 | **9 sites** (3 of them in `w4-canvas-integrity`) |
| 2-arg serializer call sites | ~10 | **57** — a 5.7× underestimate |

Plus one site in the charter that **does not exist**: `v2/wp19/test_tp05…:21` is **prose inside a
header comment**, not a call. That file's only projection call is already correctly 3-arg.

---

## Worker 2's deferral judgement — verified per site, not assumed

**Confirmed for 8 of 9.** Each retains a genuine field-level oracle that still catches container
destruction, so deferring them was safe.

**One deviation — `v2/wp63/test_tp02:99`.** The charter's stated reason ("each keeps a *field-level
check*") is **false for this record**: `n-peer` has no field-level assertion anywhere; `has()` alone
was its oracle. The deferral was still *safe*, because `has()` does catch outright destruction — so
this is not "more urgent than the charter implies" in the loss sense. But an **emptied container**
would have passed it silently. Now pinned three ways (suppression, projection, and `text`).

---

## The one thing Worker 2 should look at: a fixture defect, not a stale oracle

`w4-canvas-integrity` **A1** — *"a stale disk read cannot delete fromNode/toNode"* — was running
against an **empty node map**. Measured before any edit: `PROBE_A1 nodes=[] edges=["e1"] deleted=[]`.
Its `type:"text"` nodes carry no `text`, so the C18 AC1 ingest boundary refuses both
(`MISSING_TYPE_SPECIFIC`); with no visible endpoint the edge is then pruned as dangling, which is why
a projection pin is unassertable there. **This is B14's row-4 class, measured independently at a
second site.** Not a production defect — an incomplete fixture. Completed under the fourth §7 class
(extended from "WP18 only" to "WP18 and WP64" as part of this entry), and enumerated.

**Reported, not edited:** the same incomplete node literal appears **13 times** in that file, so
**A2, A3, A5 and A6** are very likely running against an empty node map too. They are outside WP64's
residual list, so they were left byte-untouched. **Any WP that needs a node-side oracle in that
describe must complete them first** — and their current green is worth exactly as much as A1's was.

---

## AC4 evidence — the decisive measurement

Method was B14's, not the cheaper one: **targeted injection of each pin's own loss class**, never a
global suppression inversion.

All 10 sites went **RED on their own new pin** — including the harness-level injection where
`partialCapture` itself writes the tombstone (`replica 0: the partial capture on node "d1"
TOMBSTONED the record`). **No row needed isolating**, and that is structural rather than lucky: a
bare tombstone write touches no container and no field value, so it cannot trip a neighbouring
field-level oracle by accident — which is precisely the failure mode that masked two of B14's rows.

**In every row the pre-existing oracle stayed GREEN under the same injection.** The run only ever
reached the new pin because the old one was satisfied by a tombstoned record.

For the `wp5v2` helper this was measured as an explicit A/B on an identical injection:

| Run | Helper | Result |
|---|---|---|
| A | **repaired** (suppression-aware) | **RED** — `expected [ 'n1', 'n3' ] to deeply equal [ 'n1', 'n2', 'n3' ]` |
| B | **original raw** | **GREEN** |

The old instrument cannot see a deleted record being handed to the view at all.

### Stated limits of the claim

`v2/wp5v2/test_tp01` and `test_tp06` contain **no tombstones** in their fixtures, so their helper
repair is a behaviour-preserving no-op today and is **not currently falsifiable** — future-proofing
and fidelity, not a measured strengthening. Not counted as an AC4 red. The 36 `wp17` and 6 `wp3`
sites are dispositions, not strengthenings; nothing to falsify and nothing claimed.

---

## A finding the charter's AC1 could not classify

AC1 splits helpers into "used by survival assertions" vs "used only for field-value reads". The
three `wp5v2` `docRecords()` helpers are **neither** — they are **fixture inputs** that stand in for
what production hands the view. They were repaired anyway, because what went stale is the fidelity
claim in their own doc-comment (*"what `buildCanvasData()` hands `reconcileLiveCanvas`"*): production
hands over the **suppressed projection**, so a raw read hands the view a deleted record as live.

Minimal skip-suppressed form was chosen over delegating to `buildCanvasData` **deliberately** — the
latter also applies register expansion and `ord` stripping, which would have changed the record
*shape* these tests compare.

---

## Foreign changes — reported, not touched

| Batch | Files | Note |
|---|---|---|
| **B15** | `v2/wp3/test_file_shape_tabs_visible.test.ts`, `tests/blind_set{1,2}/WP3/…`, `_run_blind.py` (M), `_blind_records/` (untracked) | Left alone per instance parameters |
| **WP24** | `plugin/src/__tests__/v2/wp24/` — untracked, 8 spec-first files + `harness.ts`, appeared **mid-run at 11:14–11:16** | Not mine |

### The current red gates are WP24's, not WP64's — do not misread this

- Suite: **6 file-level collection errors**, all `Cannot find module '../../../files/canvas-sidecar'`
  (a production module that does not exist yet). **Zero tests collected from them**, which is why the
  test line still reads **`1346 passed (1346)`**.
- `tsc` / `build`: **11 errors, every single one in `src/__tests__/v2/wp24/`**. **Zero** in any
  WP64-touched file.
- WP64's own gates were measured **before** WP24 landed: tsc exit 0, build exit 0, suite 1346/1346.

**Consequence for the WP3 sites:** the 6 `v2/wp3` 2-arg call sites are measured benign (no `deleted`
map, no delete path anywhere in the file) but were **left byte-untouched** because B15 is live there.
They owe one comment line once B15 lands — no behaviour change is pending.

---

## Risk notes for Worker 4

| Item | Note |
|---|---|
| `w4` A2/A3/A5/A6 fixtures | Almost certainly running against an empty node map, same as A1 was. Their green is not evidence of node-side behaviour. Needs a charter. |
| `v2/wp3` call sites | Dispositioned in the ledger only, not in code. Cosmetic debt, not a correctness gap. |
| `wp5v2` tp01/tp06 helpers | Repaired but not falsifiable today — no tombstone reaches those fixtures. If a future WP adds one, these become live oracles for free. |
| `w4` `docRecords` | Deliberately left tombstone-blind, and correctly so: every remaining use is a field-value read or an absence check. The two new siblings carry all survival assertions. Do not "finish the job" by converting it — that would change what the field-value reads observe. |
| Stale prose | `v2/wp19/test_tp05…:21` describes a 2-arg hazard that production no longer has (`canvas-persistence.ts:297` is 3-arg). Comment only. |

---

## Summary for Worker 4 entry point

WP19's residual class is closed. **Nine** vacated survival oracles now carry suppression + projection
pins beside their originals, **four** tombstone-blind instruments read visibility instead of key
presence, **15** serializer call sites that stood in for production's writer now serialise the way
production does, and **42** more are dispositioned as deliberately suppression-free. Deletion is no
longer something a test can fail to notice: every strengthened site was proven falsifiable by a
targeted injection of its own loss class, and the one instrument where old and new could be compared
side by side showed the old one **blind and green** where the new one is **red**. The test count
never moved, no assertion was relaxed, and no production source was touched.

The one thing that is *not* closed is the thing the sweep uncovered rather than fixed: an entire
describe block in `w4-canvas-integrity` whose node fixtures never reach the doc. That is scenery
failing silently under tests that look like they are passing — the same category of problem WP64
existed to remove, one level further down.
