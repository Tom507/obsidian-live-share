# Implementation Report — WP64: Tombstone-blind test-instrument sweep

**Batch:** B16 · **Charter:** `TaskCharter_WP64_TombstoneBlindOracleSweep.md` (`SPEC_COMPLETE`)
**Measured:** 2026-08-02, plugin suite at the working-tree revision described below.
**Scope:** WP64 only. **WP65 out of scope** — `_run_blind.py` and `_blind_records/` were not touched.
**Verdict:** `HANDOVER_READY`. No production source changed. No test added, removed, skipped or relaxed.

> **Provenance rule (inherited from B14).** Every row below is a **measurement**, not a timeless
> fact. Where a measurement contradicted the charter it is recorded as a contradiction, and no row
> claims more certainty than was observed. Line numbers are **post-amendment** unless marked
> *(pre)*; assertion messages are the stable identity.

---

## 1. Result

| Gate | Result |
|---|---|
| Full plugin suite (measured 11:14, **before** the foreign WP24 batch landed) | **231 files · 1346 tests · 1346 passed · 0 failed** |
| Test count | **unchanged** (1346 → 1346) — nothing added, nothing removed |
| `tsc --noEmit` (same window) | **clean, exit 0** |
| `npm run build` (same window) | **PASS, exit 0** |
| Full suite re-measured 11:16 (**after** WP24 landed) | **1346 tests · 1346 passed · 0 failed**, plus **6 foreign file-level collection errors** in `v2/wp24/` |
| Production source changed | **none** — `plugin/src/canvas/` verified byte-identical to the pre-batch snapshot (`diff -r`, no output) |
| Perturbation residue | **none** — every injected file restored and md5-verified equal to its pre-injection hash |

**Files touched: 30, all under `plugin/src/__tests__/`.** Nothing under `server/`, `docker/`,
`deploy/`, `plugin/main.js`, `manifest.json`, `package.json`, `_run_blind.py`, `_blind_records/`.

### The count claim, stated exactly

The charter requires the test count not to change. It did not: **1346 → 1346**. The AC3 work adds
*assertions inside existing tests*, never new `it(...)` blocks, so no pin increase needs enumerating.

---

## 2. The measured residual — the charter's arithmetic was wrong, in both directions

The charter says *"re-derive them by search rather than trusting this charter's arithmetic"*. Done:

| Class | Charter estimate | **Measured** | Note |
|---|---|---|---|
| `docRecords()`-style tombstone-blind helpers | 4 | **4** | confirmed exactly |
| Residual partial-oracle tests | ~8 | **9** sites | `w4-canvas-integrity` carries 3 of them |
| Remaining **2-arg** serializer call sites | ~10 | **57** | ~5.7× the estimate |

The 2-arg re-derivation used a brace-matching argument-count parser over the whole test tree
(94 serializer call sites total: **57** two-arg, **36** three-arg, **1** false positive).

**The one charter site that does not exist.** `v2/wp19/test_tp05_node_delete_cascades_edges_via_suppression_visible.test.ts:21`
is named in §3 as a 2-arg call site. It is **prose inside the file's header comment**, not code —
the author was *naming the 2-arg call as the hazard the test exists to catch*. That file's only real
projection call (`:190`) is already correctly 3-arg. **Nothing to fix; nothing was changed there.**
The comment is now stale prose, since production `canvas-persistence.ts:297` is 3-arg — reported, not edited.

---

## 3. Verification of Worker 2's deferral judgement (done per site, not assumed)

Worker 2 deferred each residual site *"because it retains an oracle that still catches container
destruction"*. Measured per site:

| Site | Retains a container-destruction oracle? | Verdict |
|---|---|---|
| `wp18/test_tp04:128-131` *(pre)* | Yes — `nodes.get("n-remote-bad")?.get("text")` | **judgement confirmed** |
| `wp18/test_tp06:149-150` *(pre)* | Yes — `n1?.get("color")`, `background`, `e1?.get("color")` | **confirmed** |
| `wp18/test_tp07:133-135` *(pre)* | Yes — `readPosRegister`/`readSizeRegister`/`readFrom`/`readTo` + the `ord` loop | **confirmed** |
| `wp18/test_tp09:87` *(pre)* | Yes — the whole-`V1_NODE_FIELDS` loop + both registers | **confirmed** |
| `wp23/test_tp10:74-77` *(pre)* | Yes — the `missing` key-set comparison | **confirmed** |
| `w4-canvas-integrity:210` (A1) *(pre)* | Yes — `e1.fromNode`, `e1.toNode`, `e1.color` | **confirmed** |
| `w4-canvas-integrity:946-949` (E1) *(pre)* | Yes — `local1.text` | **confirmed** |
| `w4-canvas-integrity:1474-1477` (L1) *(pre)* | Yes — `n1.text` | **confirmed** |
| `wp63/test_tp02:99` *(pre)* | **Partly — see below** | **DEVIATION** |

### Deviation — `wp63/test_tp02:99`

The charter describes this class as *"each keeps a **field-level check** that still catches container
destruction"*. For `wp63 tp02` that is **not true of the record in question**. The line is
`expect(nodes.has("n-peer"), …).toBe(true)`, and `n-peer` has **no field-level assertion at all** —
the neighbouring `nodes.get("n-ok")?.get("x")` pins a *different* record.

Measured consequence: `has()` does still catch outright container destruction, so deferring the site
was **safe**, and it is *not* more urgent than the charter implies in that respect. But an
**emptied container** — the record present with every field stripped — passed the site unchallenged.
Both gaps are now closed (suppression pin, projection pin, **and** a `text` field pin).

---

## 4. Ledger — AC3, the nine residual partial-oracle sites

Original assertions **kept verbatim**; pins **added** beside them. Strictness rises on every row.

| # | File · site | Now-vacuous assertion | Why vacuous | Pins added (post-amendment strictness) |
|---|---|---|---|---|
| 1 | `v2/wp18/test_tp04_remote_delta_never_rejected_at_ingest_visible.test.ts` · `nodes.has("n-remote-bad")` | `.toBe(true)` | Post-WP19 "rejected at ingest" can be spelled as a tombstone; key presence **and** intact fields both survive that spelling | `isTombstoneSuppressed(readTombstoneEntry(deleted,"n-remote-bad")) === false` + projection `toContain("n-remote-bad")` |
| 2 | `v2/wp18/test_tp06_seed_is_upsert_only_i7_visible.test.ts` · `expect(n1/e1).toBeDefined()` | both `toBeDefined()` | The test's whole subject is "absence is not a removal instruction" — and post-WP19 a removal instruction **is** a tombstone, an untested spelling of its own subject | suppression `=== false` for **`n1` and `e1`** + projection `toContain` for both |
| 3 | `v2/wp18/test_tp07_cold_open_migrates_existing_v1_doc_visible.test.ts` · 3× `"a record vanished during cold open"` | `toBeDefined()` ×3 | "Vanished" has a second spelling that leaves the container and every register below intact | suppression `=== false` for `n1`,`n2`,`e1` + projection `arrayContaining(["n1","n2"])` + edges `toContain("e1")` |
| 4 | `v2/wp18/test_tp09_cold_open_migration_is_additive_visible.test.ts` · `"the record did not survive the cold open at all"` | `toBeDefined()` | An *additive* migration must also not subtract the record itself | suppression `=== false` + projection `toContain("n1")` |
| 5 | `v2/wp23/test_tp10_partial_capture_never_removes_a_field_visible.test.ts` · per-replica loop | `expect(record).toBeDefined()` | I7 says observation never deletes; the tombstone spelling of a delete leaves the key set intact, so the `missing` oracle cannot see it | suppression `=== false` on **every replica** for every captured id. Neither `deleteViaSave` nor `undoDelete` is in this run's op subset, so **any** suppression here was written by the partial capture itself |
| 6 | `w4-canvas-integrity.test.ts` · A1 `"edge e1 vanished from the CRDT entirely"` | `toBeDefined()` | The diff baseline **omits** the edge, and per WP19 an omitting save is a *direct* delete that writes a tombstone (B14 Correction 2, second half) | `isRecordSuppressedInDoc(t.doc,"e1") === false` + `visibleRecordIds(t.doc,"edges") toContain "e1"` |
| 7 | `w4-canvas-integrity.test.ts` · E1 `"the guest's local content was silently excluded from the room"` | `toBeDefined()` | "Seeded into the room" must mean **visible** in the room | suppression `=== false` + `visibleRecordIds toContain "local1"` |
| 8 | `w4-canvas-integrity.test.ts` · L1 `"the guest's local canvas never reached the room"` | `toBeDefined()` | The test's subject is **permanent loss**; its survival oracle must see the one spelling of loss that leaves the container behind | suppression `=== false` + `visibleRecordIds toContain "n1"` |
| 9 | `v2/wp63/test_tp02_withhold_is_per_path_and_non_fatal_visible.test.ts` · `nodes.has("n-peer")` | `.toBe(true)` — the record's **only** oracle | Survives a withhold that accepted the record and then tombstoned it; also survives an emptied container | suppression `=== false` + projection `toContain("n-peer")` + **`text === "from a peer"`** (closes the emptied-container gap too) |

---

## 5. Ledger — AC1, the four tombstone-blind `docRecords()` helpers

| Helper | Used for | Repair | Why this form |
|---|---|---|---|
| `w4-canvas-integrity.test.ts:135` `docRecords(doc, which)` | **Mixed** — mostly field-value reads (`.text`, `.fromNode`, `.x`, an exact-object compare) and two absence checks | **Left as-is**, plus **two tombstone-aware siblings added**: `isRecordSuppressedInDoc(doc,id)` and `visibleRecordIds(doc,which)` | AC1's explicit second option. Every **survival** assertion (rows 6–8) now uses the siblings; blindness is harmless for a field-value read, and the report states which is which as AC1 requires |
| `v2/wp5v2/test_tp01_single_shadow_visible.test.ts:99` | **Fixture input** — feeds `confirmReload(...)` | Made suppression-aware (skips suppressed ids) | Its own doc-comment claims it is *"what `buildCanvasData()` hands `reconcileLiveCanvas`"* — post-WP19 that claim is **false** unless suppression is honoured |
| `v2/wp5v2/test_tp05_handover_and_close_visible.test.ts:91` | **Fixture input** — feeds `confirmReload(...)` | Same | Same; this is the one file of the three whose fixtures actually contain tombstones |
| `v2/wp5v2/test_tp06_discrimination_seam_visible.test.ts:94` | **Fixture input** — feeds `desired:` | Same | Same |

**A finding the charter did not anticipate.** The three `wp5v2` helpers are used as neither survival
assertions nor field-value reads — they are **fixture inputs** that stand in for what production
hands the view. So AC1's binary ("survival assertion" vs "field-value read") does not classify them.
They were repaired anyway, because the *fidelity* claim in their own doc-comment is what went stale:
production's reconcile receives the **suppressed projection**, and a raw read hands the view a
deleted record as if it were live. The minimal skip-suppressed form was chosen over delegating to
`buildCanvasData` deliberately — the latter also applies register expansion and `ord` stripping,
which would have changed the record *shape* these tests compare.

---

## 6. Ledger — AC2, all 57 measured 2-arg call sites

Every site is dispositioned. **15 converted to 3-arg**, **42 dispositioned as deliberate 2-arg**.

### 6a. Converted to the 3-arg form (15 sites, 10 files)

All of these **stand in for the bytes production writes**, and production
(`canvas-persistence.ts:297`) serialises **with** the tombstone map — so the stand-in did not match
the thing it stands in for.

| File | Site(s) | Reason |
|---|---|---|
| `canvas-sync.test.ts` | `:866` *(pre)* | Oracle reads `.edges[0].fromNode`; the fixture has a `deletedOf()` and sibling tests write tombstones |
| `v2/wp6/chaos_degraded_adapter.test.ts` | `:154` *(pre)* — the `canonical()` helper | Captured **after** the save that omits `n4`, i.e. after a delete |
| `w4-canvas-integrity.test.ts` | `:644`, `:1348` *(pre)* | Echo-window baseline bytes; the G4 dangling-edge prune probe |
| `v2/wp4/test_tp01_intent_basis_visible.test.ts` | `:155`, `:189` *(pre)* | Flush simulation in a file whose later tests write tombstones |
| `v2/wp4/test_tp02_byte_echo_visible.test.ts` | `:148` *(pre)* | Flush simulation |
| `v2/wp4/test_tp03_closed_view_shadow_advance_visible.test.ts` | `:127`, `:169` *(pre)* | Flush simulation |
| `v2/wp5v2/test_tp01_single_shadow_visible.test.ts` | `:199` *(pre)* | Flush simulation |
| `v2/wp5v2/test_tp06_discrimination_seam_visible.test.ts` | `:140` *(pre)* | Flush simulation |
| `v2/wp6/chaos_cascade.test.ts` | `:128` *(pre)* | `canonical()` flush simulation |
| `v2/wp63/test_tp03_withhold_lifts_when_refused_set_empties_visible.test.ts` | `:85` *(pre)* | Comparator for "the first write after the lift is the ordinary canonical projection" |
| `canvas-persistence.test.ts` | `:299`, `:433`, `:565` *(pre)* | Compare **production output against a 2-arg expectation** — would go spuriously red the moment a tombstone entered the fixture |

### 6b. Deliberate 2-arg, dispositioned by comment (36 sites, 12 files)

`v2/wp17/` — the canonical-serializer suite. Each file carries a note stating that **every**
serializer call in it is 2-arg by design: the fixtures build `nodes`/`edges` maps directly, no
`deleted` map is ever created, no delete path runs, and the subject is ORDER and BYTES, never
whether a record is alive. **No call in these files is a survival oracle.**

`test_tp01:43` · `test_tp02:41` · `test_tp03:42` · `test_tp04:40` · `test_tp05:52` ·
`test_tp06:59,64` · `test_tp10:56,57` · `test_tp11:63,64,72,73` · `test_tp12:62,66` ·
`test_tp13:99,108,117,127,137,144` · `test_tp14:67,76,93,109,112,127,142,163` ·
`test_tp15:109,117,142,167,168,186` *(all pre)*

> **Interpretation stated openly.** AC2 says each site *"carries a one-line comment"*. The note is
> placed **once per file** rather than repeated up to eight times, because in every one of these
> files all serializer calls belong to a single class and a repeated comment would be noise, not
> information. Every individual site is enumerated above, so the disposition is per-site in the
> ledger even where the comment is per-file.

### 6c. Deliberate 2-arg, **not** edited — concurrency deferral (6 sites, 1 file)

`v2/wp3/test_two_client_bytes_visible.test.ts:67,68,75,93,94,108` *(pre)*.

Measured **bucket B (benign)**: zero matches for `deleted`/tombstone/delete anywhere in the file;
the calls are byte-identity, id-sorted-record and dangling-edge-prune probes on hand-built replicas
(pruning is not tombstoning). **Left byte-untouched because batch B15 is live in the WP3 sets** and
the instance parameters direct me to stay out of them. Disposition recorded here instead of in the
file; a one-line comment is all that is owed once B15 lands.

---

## 7. Fixture completion — enumerated, as B14 required

**`w4-canvas-integrity.test.ts` A1.** B14's row-4 note said fixture completion belongs to
WP18/WP64 and must be enumerated if done. It was needed here and it was done.

**Measured before touching anything** (temporary probe, removed): `PROBE_A1 nodes=[] edges=["e1"] deleted=[]`.

A1's nodes are `type:"text"` with **no `text` field**, so the C18 AC1 ingest boundary refused both
(`MISSING_TYPE_SPECIFIC`) and they **never entered the doc**. The test — named *"a stale disk read
cannot delete fromNode/toNode"* — was therefore running against an **empty node map**, and because
the edge then had no visible endpoint, `buildCanvasData` pruned it as dangling and the projection
was `[]`. That is why the projection pin first went red: **not a production defect, and not a stale
oracle — an incomplete fixture**, the same class B14 measured at A7.

Repair: `text: "one"` / `text: "two"` added to A1's three node literals (the `full` seed, the
`noEdge` diff baseline, and the final disk write) so all three stay consistent. A1 now genuinely
exercises its subject with real nodes in the doc, and all of its pre-existing assertions still pass.

**Reported, not edited (charter: "anything found beyond that list is reported, not edited"):** the
same incomplete-node-literal pattern occurs **13 times** in `w4-canvas-integrity.test.ts`, i.e. it
also affects **A2, A3, A5, A6** in the same describe. Those tests are not on WP64's residual list, so
they were left byte-untouched. They are presumably running against an empty node map too, and any WP
that needs a node-side oracle in that describe must complete them first.

---

## 8. AC4 — targeted-injection falsification, per site

**Method (B14's, not the cheaper one).** Global suppression-inversion falsely certifies rows by
turning them red on a *neighbouring* assertion, so every site was perturbed with a **targeted
injection of the exact loss class its pin guards**, and the failure was checked to be **on the new
pin itself**. Every file was restored from its pre-injection bytes and **md5-verified** afterwards.

| # | Site | Injection (the exact loss class) | Result | Failed on |
|---|---|---|---|---|
| 1 | `wp18 tp04` | `deleted["n-remote-bad"] = {on:true}` — *the ingest boundary tombstones the remote record* | **RED** | `"an invalid REMOTE record was TOMBSTONED at ingest — this replica now diverges from its peer"` — **its own new pin** |
| 2 | `wp18 tp06` | tombstone `n1` **and** `e1` — *the seed deletes what the file omitted* | **RED** | `"the seed TOMBSTONED the node because the file omitted it (I7)"` — **own pin** |
| 3 | `wp18 tp07` | tombstone `n2` — *the migration deletes a record it should migrate* | **RED** | `"the cold-open migration TOMBSTONED n2"` — **own pin** |
| 4 | `wp18 tp09` | tombstone `n1` | **RED** | `"the cold-open migration TOMBSTONED the record it was supposed to migrate"` — **own pin** |
| 5 | `wp23 tp10` | **harness-level**: `partialCapture` itself writes `applyTombstoneOp(…, on:true)` on the record it just captured | **RED** | `replica 0: the partial capture on node "d1" TOMBSTONED the record — I7 says observation never deletes, in either spelling` — **own pin** |
| 6 | `w4 A1` | `deleted["e1"] = {on:true}` — *the stale disk read tombstones the edge* | **RED** | `"the stale disk read TOMBSTONED edge e1"` — **own pin** |
| 7 | `w4 E1` | tombstone `local1` | **RED** | `"the guest's local content was seeded into the room already TOMBSTONED"` — **own pin** |
| 8 | `w4 L1` | tombstone `n1` | **RED** | `"the self-heal seeded the guest's canvas back as a TOMBSTONED record — still permanent loss"` — **own pin** |
| 9 | `wp63 tp02` | tombstone `n-peer` | **RED** | `"the withheld canvas TOMBSTONED the remote record it had just accepted"` — **own pin** |
| 10 | `wp5v2 tp05` helper (AC1) | `deleted["n2"] = {on:true}` before `confirmReload` — *a tombstoned record is handed to the view as live* | **RED** | `expected [ 'n1', 'n3' ] to deeply equal [ 'n1', 'n2', 'n3' ]` |

**Every injection was on-target on the first measurement — no row needed isolating**, because a bare
tombstone write touches no container and no field value, so it cannot trip a neighbouring
field-level oracle by accident. That is the structural reason this batch avoided B14's masking
problem rather than merely getting lucky.

### 8a. Did the pre-existing oracle stay green? — the decisive measurement

**Yes, in every case, and that is the point.** In rows 1–9 the pre-existing oracle
(`toBeDefined()` / `has(...) === true` / the field-value checks) executes **before** the new pin and
**passed** under the same injection — the run only reached the new pin because the old one was
satisfied by a tombstoned record. The old oracles are blind to this entire loss class.

**Row 10 makes it explicit with a double measurement** — the clearest evidence in the batch, the
same shape as B14's row 14:

| Run | Helper | Same injection | Result |
|---|---|---|---|
| A | **repaired** (suppression-aware) | `deleted["n2"] = {on:true}` | **RED** — `expected [ 'n1', 'n3' ] to deeply equal [ 'n1', 'n2', 'n3' ]` |
| B | **original raw** helper | *identical injection* | **GREEN** |

The old helper cannot see a deleted record being handed to the view at all; the repaired one does.
`MD5 pre == MD5 post` verified (`dd3a36311fc8ceb3a9a97049e86d75fe`).

### 8b. Honest limits of the AC4 claim

- `v2/wp5v2/test_tp01` and `test_tp06`: their fixtures contain **no tombstones**, so the helper
  repair there is a **behaviour-preserving no-op today** and is **not currently falsifiable**. It is
  future-proofing and fidelity, not a measured strengthening. Recorded as such rather than counted
  as an AC4 red.
- The 36 `wp17` sites and the 6 `wp3` sites are dispositions, not strengthenings; there is nothing
  to falsify and none is claimed.

---

## 9. Foreign changes in the tree — reported, not touched

| Batch | Files | Status |
|---|---|---|
| **B15** (WP3 blind sets) | `v2/wp3/test_file_shape_tabs_visible.test.ts`, `tests/blind_set1/WP3/…`, `tests/blind_set2/WP3/…`, `_run_blind.py` (M), `_blind_records/` (untracked) | Left alone. Also the reason §6c defers the 6 `wp3` call sites |
| **WP24** (new, appeared **mid-run** at 11:14–11:16) | `plugin/src/__tests__/v2/wp24/` — untracked, 8 spec-first test files + `harness.ts` | **Not mine.** They import `../../../files/canvas-sidecar`, which does not exist yet |

**The WP24 batch is the sole cause of the current red gates**, and this must not be misread as WP64
regression:

- Suite: **6 file-level collection errors**, all `Cannot find module '../../../files/canvas-sidecar'`.
  **Zero tests are collected from them**, which is why the test line still reads `1346 passed (1346)`.
- `tsc --noEmit` / `npm run build`: **11 errors, every one in `src/__tests__/v2/wp24/`**. Zero errors
  in any WP64-touched file.
- WP64's own gates were measured **before** WP24 landed and were clean: tsc exit 0, build exit 0.

---

## 10. Definition of Done

> *"No test in the tree proves a record survived by an oracle that a tombstone can satisfy."*

Met for every site in WP64's chartered scope, with two stated exceptions carried forward:

1. The 6 `v2/wp3` sites (§6c) — measured benign, deferred **only** for B15 concurrency.
2. The `w4-canvas-integrity` A2/A3/A5/A6 fixtures (§7) — found beyond the residual list, reported
   rather than edited, per the charter's own instruction.
