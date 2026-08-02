# Implementation Report — WP67: Falsifiability pins for the WP64 helper repairs

**Batch:** B17 · **Worker:** Worker 3 (Implementation, Core) · **task_mode:** `lightweight`
**Date:** 2026-08-02 · **Status:** `HANDOVER_READY`
**Charter:** `TaskCharter_WP67_HelperRepairFalsifiabilityPins.md` · **Component:** BUILD_SPEC §5 C67

---

## 1. What was owed

WP64/B16 made three `wp5v2` `docRecords()` helpers suppression-aware. At `test_tp05` the repair was
proven by an explicit A/B. At `test_tp01` and `test_tp06` it could not be: **those fixtures contain no
tombstone**, so the repaired and the raw form return the same records and nothing could tell them apart.
B16 recorded that openly and declined to count them as verified. This WP supplies the missing measurement
**without adding a tombstone to either fixture** — the helper is what is unverified, so the helper is
what is pinned.

---

## 2. Changed files

| File | Change | Lines |
|---|---|---|
| `plugin/src/__tests__/v2/wp5v2/test_tp01_single_shadow_visible.test.ts` | additive only — appended below the original last line | 309 → 417 |
| `plugin/src/__tests__/v2/wp5v2/test_tp06_discrimination_seam_visible.test.ts` | additive only — appended below the original last line | 289 → 400 |

**No production source file was modified.** No import statement was changed in either file: the pins
write the tombstone entry as its plain in-doc form (`{ t, by, on }`) directly into the `deleted` map, so
the existing import lines stay untouched too.

**Byte-identity of everything that already existed — verified by hash, not by inspection:**

```
head -n 309 test_tp01_single_shadow_visible.test.ts | md5sum → 382df67581d0337c79f47b4fb3fc04c8   (= pre-WP67)
head -n 289 test_tp06_discrimination_seam_visible.test.ts | md5sum → 6c4c870b570aaa8d6cc7d838126e55fb   (= pre-WP67)
```

Both match the baselines taken before any edit. Every added line is strictly appended; no existing
fixture, assertion, matcher, title or strictness was touched.

---

## 3. The pins added (AC1)

One test per file, identical name in both:

```
WP67 — this file's suppression-aware docRecords() is falsifiable
  └── P1 docRecords omits a tombstoned record the raw form hands over, and keeps the live one
```

Each pin builds **its own** `Y.Doc` — never the file's fixture — holding:

```text
nodes:   n1 (SUPPRESSED)   n2 (live)
edges:   e1 (SUPPRESSED)   e2 (live)
deleted: n1 → { t: 7, by: "peerA", on: true }
         e1 → { t: 7, by: "peerA", on: true }
```

This is the exact class the helper exists to catch: V2 deletion is **data**, so the record stays in its
map and only `deleted[id].on` says it is gone — which is precisely why a raw key-presence reading reports
a deleted record as live.

The pin asserts the repaired helper **omits** `n1` and `e1`, **retains** `n2` and `e2`, and that the
retained record keeps its field values (suppression is not a blanket).

---

## 4. The A/B measurement (AC2)

Taken in two independent forms. Both are reported; the second is the falsification.

### 4a. In-file control — permanent, ships with the pin

Each pin carries `rawDocRecordsControl()`, the **pre-WP64 raw form verbatim**
(`for (const [, record] of …)`, no suppression check), and asserts that it **does** report `n1` and `e1`
on the same doc. Nothing else calls it.

This is what makes the pin a measurement rather than an assertion: it establishes that the injected
records **are in the map**, so the repaired helper's omission is genuine suppression and not a record
that was never there. A future change that silently stops the injection breaks the control instead of
letting the pin pass vacuously.

### 4b. Perturbation — repaired vs raw, identical injection, one file at a time

The helper was reverted to the pre-WP64 raw form and the file re-run, then restored. **Never both files
at once** — the injection was kept narrow so the failing site could not be confused with a neighbour.

| Site | Helper form | Pin P1 | Failing assertion | Pre-existing tests |
|---|---|---|---|---|
| `test_tp01` | repaired (WP64) | **GREEN** | — | T1–T5 GREEN |
| `test_tp01` | raw (pre-WP64) | **RED** | `:403` — *"a deleted node was handed to the reconcile classifier as live: expected [ 'n1', 'n2' ] to not include 'n1'"* | T1–T5 **GREEN** |
| `test_tp06` | repaired (WP64) | **GREEN** | — | T1–T4 GREEN |
| `test_tp06` | raw (pre-WP64) | **RED** | `:386` — *"a deleted node was written into the receipt's desired state as live: expected [ 'n1', 'n2' ] to not include 'n1'"* | T1–T4 **GREEN** |

**Each pin went red on its own assertion, on the first measurement, with no narrowing needed.** No row
required isolation: reverting the helper touches no container and no field, so it cannot trip a
neighbouring field-level oracle — the same structural reason B16 gave for its own clean AB.

**The green column is itself a result.** Under the reverted helper, `test_tp01`'s T1–T5 and `test_tp06`'s
T1–T4 all stayed green. That is direct confirmation that B16 was right to refuse to count these sites:
before the pin existed, **nothing in either file could tell the two helper forms apart.** It also rules
out both known false-certification modes — no B14-style global perturbation (only one function changed,
in one file at a time) and no B15-style masking by an earlier amendment (the failure is on the pin's own
new line, quoted above).

Both perturbations were restored and the restoration verified by the hashes in §2.

---

## 5. Test count

| Scope | Before | After | Δ |
|---|---|---|---|
| `test_tp01_single_shadow_visible.test.ts` | 5 | 6 | +1 |
| `test_tp06_discrimination_seam_visible.test.ts` | 4 | 5 | +1 |
| **Both files** | **9** | **11** | **+2** |

The rise is exactly the number of pins added, each enumerated by file and name in §3. **No existing test
changed state in either direction** — verified per-test with `--reporter=verbose`, not inferred from a
total.

---

## 6. Gates

| Gate | Result |
|---|---|
| `npm test` (whole tree, second measurement) | **244 files · 1424 tests · 1424 passed · 0 failed** |
| `npm run build` | exit **0**, zero errors |
| `npx tsc --noEmit` | exit **0**, zero errors |
| Production source | untouched by this WP |

### Concurrent batch B4 — foreign state, stated separately

The **first** whole-tree run (11:39) reported `1417 passed · 7 failed` across 3 files. One was positively
identified — `v2/wp24/test_tp06_load_is_idempotent_visible.test.ts` — and **the other two were not
captured, because the log filter used truncated the failure list.** Stated plainly rather than inferred:
three failed files were seen and only one was named.

Between that run and the next, `plugin/src/files/canvas-sidecar.ts` was written by **B4** (mtime inside
the run window; the module whose absence caused B16's 6 collection errors). The **second** run, minutes
later, was **fully green** — 1424/1424, `tsc` and `build` exit 0. B16's standing red has therefore
cleared, and the clearing is B4's landing, not WP67's work.

Attribution: the first run measured **B4's production source mid-write**. WP67's touched set is two test
files; **zero** failures fell inside it, and the identical test count (1424) across both runs shows
nothing was added or lost between them. The two unnamed files are attributed to `v2/wp24/` **by the
clean re-run, not by assumption**.

---

## 7. Compliance against the charter's hard constraints

| Constraint | Status |
|---|---|
| No production source file modified | ✅ |
| No tombstone added to either fixture | ✅ — each pin uses its own isolated `Y.Doc` |
| Existing fixtures and assertions byte-identical | ✅ — verified by hash (§2) |
| No existing test changes state in either direction | ✅ — verified per-test |
| Test count rises by exactly the pins added, each enumerated | ✅ — +2 (§5) |
| A pin that cannot go red is not a pin | ✅ — both went red (§4b) |
| `v2/wp24/` untouched | ✅ |
| Zero new dependencies; no version bump; `main.js`/`manifest.json` untouched | ✅ |

---

## 8. Register state

BUILD_SPEC §7's **unfalsifiable-repair register** row is **kept verbatim** — it records what was true at
B16, and a ledger row is a measurement, not a timeless fact — with a **DISCHARGED (WP67 / B17)** block
appended carrying the evidence above. Both sites are now readable as **verified**; the prohibition on
citing them as evidence is lifted.

A **B17 standing attribution** entry was added beside B16's, recording that B16's red gates have cleared
and that the clearing belongs to B4.

> **Note for Worker 2:** the charter (§6) assigns the register flip to Worker 2 on handover; the
> Dispatcher's instance brief assigned it to this worker. It is done — **please review rather than
> re-apply**, so the discharge is not recorded twice.

---

## 9. Risk notes

None. `W4 Test Targets = 0`; both ACs are observable in the unit suite. The pins are self-contained
(own doc, own control function, no shared state, no timers) and cannot interact with the scenarios in
their host files.

One durable property worth keeping: the in-file control (§4a) means these two sites stay falsifiable
**permanently**, not just at the moment of this measurement. If a later WP reverts or weakens either
helper, P1 fails — which is the whole point of C67.
