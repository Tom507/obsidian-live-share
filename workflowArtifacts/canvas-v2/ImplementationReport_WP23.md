# Implementation Report — WP23

Attempt: 1

## Status: DONE

## Completed Work

| AC | Status | Notes |
|---|---|---|
| AC1 — 3–5 replicas, pluggable registry, partitions / reorder / duplication / stale-view saves | DONE | Replica count is drawn in `[3, 5]` by the core and an explicit count below 3 is **refused with a named reason**, not silently honoured. 16 registered op classes cover create, move, resize, reroute, relabel, delete, undo and reorder plus six more. Partitions are drawn per window; deltas are shuffled and ~25 % duplicated inside each partition group. Obsidian saves run through the **real** `CanvasSync.handleLocalModify`, and one op class replays a view model at least two windows old. |
| AC2 — SEC, schema invariants, byte equality, shadow consistency, on **every** replica | DONE | Five families in `oracle.ts` (`sec`, `schema`, `bytes`, `shadow`, `intent-trace`) plus two WP-link families (`i7`, `lww`). SEC compares an **order-normalised** doc snapshot — raw `Y.Map` iteration order is a function of local integration history, not of state, so a raw compare would report drift for two replicas holding the same thing. |
| AC3 — reproducible from seed; counter-examples frozen | DONE | Hand-written `mulberry32` (`prng.ts`), zero new dependencies. Same seed ⇒ identical op log, op classes, replica count, and — for a run with no contested write — the byte-identical converged `.canvas`. Every failure message carries `runFuzzScenario({ seed: … })`. No counter-example was found, so nothing needed freezing (see FINDINGS). |
| AC4 — registry open for extension; every merge/serialisation WP reachable | DONE | `fuzzer.ts` imports `OpRegistry` as a **type only** and names no op class anywhere; the world is established by an injected `bootstrap` callback. A test defines a brand-new op class inside the test file, registers it, and the core draws and runs it. Coverage is declared per op in `reaches` and asserted against `REQUIRED_WP_COVERAGE`. |
| AC5 — intent-trace oracle, independent of the implementation's merge | DONE | `intent-trace.ts` imports **nothing** from `src/canvas/` or `src/files/`. Expectations are computed by walking the harness's own op log. Proven to be able to fail while all four convergence families are green: fault 1 below, and `test_tp04_agreement_is_not_sufficient_visible.test.ts` asserts the exact family set `{intent-trace}` over a byte-identical, schema-valid, fully converged document. |

## Fuzzer design

**Files** (`plugin/src/__tests__/harness/fuzz/`, 2 888 lines, deliberately separable from the suite):

```text
harness/fuzz/
├── prng.ts          ← seeded mulberry32; the only randomness the harness owns
├── intent-trace.ts  ← the op log, the record catalogue, the slot-claim ledger  ← imports NOTHING under test
├── op-registry.ts   ← OpDefinition / OpRegistry (register · subset · coverage · draw)
├── replica.ts       ← one replica: Y.Doc + real CanvasSync + in-memory vault + outbox
├── scheduler.ts     ← partitions, delta reorder, delta duplication, quiescence
├── oracle.ts        ← the seven assertion families
├── fuzzer.ts        ← the core: windows, claims, the run loop, FUZZ_BUDGET
└── standard-ops.ts  ← the 16 initial op classes + bootstrapStandardWorld
```

**Replica count** — drawn in `[FUZZ_BUDGET.minReplicas, FUZZ_BUDGET.maxReplicas]` = `[3, 5]`. A
caller asking for 2 gets a throw naming the reason: with two peers an agreed-but-wrong outcome and a
genuinely converged one are the same picture. A replica is not a bare `Y.Doc` — it is a real
`CanvasSync` (capture path, Surface-Shadow, tombstone wiring, quarantine auditor) over its own
in-memory vault, subscribed as a guest so no replica is privileged.

**Op registry shape, and how it extends without touching the core.** An op is
`{ name, weight, reaches, note?, applicable(ctx), run(ctx) }`. `run` returns `false` when it declines
(no eligible target, or its slot is already claimed) — declining is normal. `OpContext` carries the
RNG, the issuing replica, the whole mesh, the trace, this window's claim ledger, the window index,
the timer flush, an id generator and `partitionOf`. The core calls only `registry.draw(ctx)` and
`definition.run(ctx)`; it holds no op name, no `switch`, no import of `standard-ops.ts`. A later
phase adds an op with `registry.register(…)` and changes nothing in `fuzzer.ts` —
`test_tp06_…_visible.test.ts` proves it by defining an op class inside the test file and watching the
core draw, run and judge it.

**Partition / reorder / duplication model.** Per window: replicas are split into 1–3 groups (a group
of one is possible, and is the harshest case for the capture path's surface bookkeeping). Every
locally-authored Yjs update goes to that replica's outbox. Delivery is **within a group only**;
before delivery each target's queue is duplicated with p = 0.25 and then fully shuffled, so a
duplicate can land before its original and an update can arrive before its causal predecessors (Yjs
buffers those as pending structs). At the window's end the partition heals and `quiesce` alternates a
full-mesh state-vector exchange with a flush of the debounced audit timer until no replica produces
another update and every state vector agrees. **No wall-clock sleep, no `setTimeout`, no new timing
constant** — the flush is injected by the suite (`vi.runOnlyPendingTimers`), which is why the core
never imports the test runner.

**Save simulation with a stale view model.** The harness owns the simulated Obsidian surface: it
builds the `.canvas` text from **its own model**, writes it to that replica's vault and calls the
real `handleLocalModify`. `staleObsidianSave` replays a snapshot of that replica's surface from at
least two windows earlier. It must carry exactly one genuinely new intent, because a file
byte-identical to `lastWrittenContent` is correctly recognised as this client's own write and skipped
— a fuzzer that only ever produced those would be asserting over a capture path it never invoked.
After the save the harness checks, for every field the stale surface re-stated that the world has
since moved past, that the replica's own doc does **not** hold the stale value.

**Seed / reproducibility.** One 32-bit seed drives a `mulberry32` stream: replica count, partition,
op choice, target record, written values, delivery order and duplication. `FuzzResult.reproduce`
carries `runFuzzScenario({ seed: N, replicaCount: R, windows: W })`. The one thing deliberately **not**
seeded is Yjs's `clientID = random.uint32()`; pinning it would make every concurrency test agree with
a world that does not exist, so a run containing a contested write may converge on either author's
value and nothing in the suite asserts which.

**Scenario budget** — `FUZZ_BUDGET` in `fuzzer.ts`, so CI raises it without editing an assertion:

```ts
scenarios: 200,  windows: 10,  opsPerWindow: 5,  minReplicas: 3,  maxReplicas: 5
```

plus `FUZZ_TEST_TIMEOUT_MS = 120_000`. Vitest's 5 s default is exceeded by a scenario *band* under
full-suite parallel load even though the same band takes ~1 s alone; shrinking the sample to fit a
default would have traded coverage for a number nobody chose.

## How the intent-trace oracle stays deterministic

This is the central design problem and it is solved by **construction**, not by tolerance.

The oracle needs a total order over ops. It never derives one from `clientID` tie-breaks. Instead
**the harness imposes and records the order it will later assert against**, through two mechanisms
that compose:

**1 — WINDOWS give a cross-window total order.** A run is a sequence of windows and *every window
ends with a full-mesh quiescence*. So every op issued in window `w+1` comes from a replica that has
already integrated every op of window `w`. Two writes to the same field in different windows are
therefore **causally ordered, never concurrent**, and Yjs's LWW resolves them deterministically in
favour of the later one — no arbitration, nothing to predict. Partitions, reordering and duplication
all live *inside* a window, so the interleaving space is genuinely explored; what the window boundary
removes is the unpredictability of the *arbitration*, not the concurrency.

**2 — SLOT CLAIMS give a within-window exclusivity.** `SlotClaims` is a per-window ledger keyed by
`kind|id|field`, with a wildcard form `kind|id|*` that claims a whole record. An op must claim every
slot it writes **before** acting, and an op that cannot claim ABORTS and is not logged. So two ops in
one window necessarily touch distinct fields. A whole-surface Obsidian save claims every save-eligible
record at once, which is what keeps a save from racing a direct doc write; at most one save-path op
runs per window, by construction.

**3 — Where genuine same-field concurrency is the point, it is DECLARED.** The WP21 link needs two
peers writing the same thing at the same time, so `contendedFieldWrite` and `contendedAtomicRegister`
pick two replicas in *different partition groups* and log both writes with `contested: true`. For a
contested slot the oracle asserts exactly three things and no more:

- every replica agrees,
- the surviving value is one of the values actually written — never a third, and
- for a multi-field fact (`pos` → `[x, y]`) the survivor is **one author's whole tuple**, checked as a
  tuple. Per-field checking cannot see a torn `(A.x, B.y)`, because each half is individually a value
  somebody wrote.

It **never** asserts which one won.

Two further rules keep the expectation honest as a run evolves. A contested slot that is written
again in a later window becomes determinate (the later write is causally after both candidates), and
only the *latest* paired contest per record still has an opinion. Both are implemented in
`IntentTrace.expect` and in the oracle's contest loop.

**Non-circularity.** `intent-trace.ts` imports nothing from `src/canvas/` or `src/files/`. Expected
values are recorded **at op-issue time**, in the `.canvas` FILE vocabulary the user sees, and the
node→edge visibility cascade and the `(ord, id)` record order are re-derived by the harness with its
own comparator rather than borrowed from `buildCanvasData` / `compareOrdId` — borrowing either would
blind the oracle to a bug in exactly the way AC5 forbids.

**Result: the suite is not flaky.** The visible suite was run 5× and the visible + both blind sets 3×,
each run with fresh random Yjs clientIDs: 30/30 and 47/47 every time.

**Two harness-modelling bugs this discipline caught, worth recording** (both were *my* errors, not
production's, and both would have made the fuzzer flaky):

- A save-path op that wrote a value the *issuing replica's own surface already showed* had its write
  correctly **discarded** by `planIntentDiff` as staleness — the op was asserting that a restatement
  must overwrite a peer's newer value. Ops now decline instead.
- A delete-by-omission op targeting a record the issuing replica's shadow held as `unknown` produced
  no delete intent, because absence from a save the shadow never saw is ignorance, not deletion. Ops
  now only delete what their own surface carries.

## Op registry coverage

| Op class | WP reached | Notes |
|---|---|---|
| `createNodeViaSave` | WP18, WP22, WP4 | The real capture boundary: validated, create-once, upsert-only |
| `moveViaSave` | WP4, WP9, WP18, WP21 | Geometry through `handleLocalModify`; records a WP21 write-admission |
| `resizeViaSave` | WP4, WP9, WP18 | `width`/`height` through the same boundary |
| `rerouteViaSave` | WP10, WP18, WP20 | Endpoint change; feeds the dangling-edge/cascade path |
| `relabelViaSave` | WP4, WP17 | **Gap stated:** P1 `text` is a plain LWW string. Collaborative text editing (nested `Y.Text`, character-level merge) **does not exist yet — that is WP36**. This op exercises whole-value replacement and is not a stand-in for it. |
| `deleteViaSave` | WP19, WP12, WP17 | Omission + open view + hand-over receipt → tombstone, never a key removal |
| `undoDelete` | WP19, WP12 | **Gap stated:** WP38 owns real UI undo and does not exist. This issues what the spec says an undo IS — one more `applyTombstoneOp` with `on:false`, stamped strictly above the delete it reverses, so the two form a causal chain rather than a concurrent pair. It does not simulate an undo stack. |
| `reorderRecord` | WP13, WP17 | Writes `ord`; the oracle re-derives the expected order with its own comparator |
| `dualSpellingWrite` | WP17, WP18, WP9 | **The AC5 mandated class.** Creates a record carrying BOTH spellings of one fact with the register deliberately stale and the **insertion order varied**, or moves an existing such record by writing the flat keys only |
| `moveRegisterOnly` | WP9, WP17 | The pure-register vocabulary (what a V2 cold-open seed writes) |
| `partialCapture` | WP22 | `CanvasBinding.captureLocal` with one field; snapshots the key set before/after (I7) |
| `injectInvalidEdge` | WP20, WP14 | **Fault injection:** writes an invalid record directly into one replica inside a partitioned window, so the auditor is exercised under concurrency |
| `repairInvalidEdge` | WP20, WP14, WP10 | Supplies the missing endpoint so the quarantine **lift** is exercised too |
| `staleObsidianSave` | WP4, WP5, WP22 | Replays a view model ≥2 windows old — the W1 discriminant |
| `contendedFieldWrite` | WP21, WP4 | Two replicas in different partitions save the same field; both writes must land locally and the echo baseline must have advanced |
| `contendedAtomicRegister` | WP9, WP21 | Two peers dragging one card: the winner must be **one author's whole `[x, y]`** (I8) |

`REQUIRED_WP_COVERAGE` = WP4, WP9, WP10, WP12, WP13, WP14, WP17, WP18, WP19, WP20, WP21, WP22 — all
reachable, asserted by `test_tp06_…_visible.test.ts`. `test_tp05_…_blind2` additionally asserts that
all 16 classes are actually **drawn** across its 96-scenario band, and that the collision class was
produced in *both* insertion orders — a precondition checked before the property, so a green run
cannot be green because the interesting op was never selected.

## Fault-injection matrix (proof the fuzzer bites)

Each fault was injected into **production** source one at a time, the fuzzer's headline test run at
the shipped budget (200 scenarios × 10 windows), and the source restored and verified byte-identical
against a pre-change backup (`cmp -s`). Numbers are violation counts.

| Injected fault | intent-trace | SEC | schema | bytes | shadow | i7 | lww |
|---|---|---|---|---|---|---|---|
| *(none — baseline)* | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| **1. Insertion-order flat-vs-register resolution** (`decodeV2RecordToFlat` collapsed back to one pass — the WP18-class bug) | **2913** | 0 | 0 | 0 | 0 | 0 | 0 |
| **2. Delete suppression broken** (`isRecordSuppressed` → `false`; a tombstoned record still serialises) | 854 | 0 | **863** | 0 | 0 | 0 | 0 |
| **3. Partial capture removes an unmentioned field** (`writeRecordMinimal` absent-key sweep restored) | 31221 | 0 | 0 | 0 | 0 | **2587** | 0 |
| **4. One replica pushes a stale field** (`planIntentDiff` staleness discriminant disabled) | 339 | 0 | 0 | 0 | **372** | 0 | 0 |

**The headline result is row 1.** The known WP18-class corruption is caught by the intent-trace oracle
**and by nothing else**: SEC, schema, byte equality and shadow consistency are *all four green* while
2 913 field values across the band are not what the last op on that field wrote. That contrast is the
entire justification for AC5 — every replica agrees, the schema holds, the bytes are identical
everywhere, the shadow agrees, and the document is corrupt.

Two observations worth recording about the other rows:

- **SEC never fires in any row.** That is correct and it is the point: faults 1–4 are all
  *projection* or *capture* defects, and every replica commits the same defect, so the doc states stay
  identical. A convergence oracle cannot see a correctness bug. (SEC *does* fire on a genuine
  divergence — `test_tp01_…_blind1` constructs one and asserts `{sec, bytes}`.)
- **Byte equality never fires either**, for the same reason. Byte equality is a convergence oracle and
  can never be a correctness oracle — "convergence is not correctness" turned on the fuzzer's own
  instruments.
- Faults 2–4 also raise intent-trace, which is expected: a record that should be visible and is not
  (or vice versa), and a field pushed back to a stale value, are both departures from the op log.
  The discriminating column is the *second* family in each row.

## FINDINGS — real bugs discovered

**None.** No counter-example was found in any run, so nothing needed freezing as a regression test.
Across the visible suite, both blind sets and the reproducibility bands, roughly 700 scenarios
(3–5 replicas each, 6–10 windows each) were executed with zero violations, repeatedly, with fresh
random Yjs clientIDs each time.

One hypothesis was raised during design and **empirically falsified** rather than left as folklore, so
it is recorded here instead of as a test:

> **Could a concurrent drag tear `x` from `y` through the P1 capture path?** The capture boundary
> still authors the FLAT file vocabulary (the WP16 decode bridge, retired when the write boundaries
> move to the registers at WP22/WP39), so `x` and `y` reach the doc as two independent `Y.Map` keys —
> apparently reopening exactly the torn-coordinate class the atomic `pos` register exists to make
> unrepresentable.
>
> **It does not reproduce.** A dedicated probe ran 40 trials of two replicas concurrently saving a
> move of the same card through `handleLocalModify` with no exchange between them: **0 torn pairs**.
> The reason is that Yjs's per-key arbitration for two concurrent items is a function of the two
> `clientID`s, which is the *same* comparison for every key — so when both authors write both keys,
> the same author wins both. Divergent per-key outcomes only arise when the writes are not mutually
> concurrent, and that is causally correct rather than torn.
>
> The fuzzer's `contendedAtomicRegister` op still asserts whole-tuple atomicity on the register path
> (where it is the designed guarantee), and the save-path contention op deliberately uses a scalar
> field, so nothing in the suite depends on the falsified hypothesis either way.

Nothing in production was changed to make the fuzzer pass, and the oracle was never weakened. Two
early failures *were* fixed — both in the harness, both listed under "How the intent-trace oracle
stays deterministic", and both cases where the implementation was right and my op model was wrong.

## Visible Test Results

11 files, 30 cases, **all PASS**. Isolated run: ~4.1 s wall (~9.5 s of parallel test time).
Run 5× consecutively with no flake.

| File | Cases | Covers |
|---|---|---|
| `test_tp01_all_families_over_random_interleavings_visible.test.ts` | 2 | AC1 + AC2 + AC5, the headline band |
| `test_tp02_three_to_five_replicas_never_two_visible.test.ts` | 3 | AC1 replica band, refusal below 3 |
| `test_tp03_flat_register_collision_class_visible.test.ts` | 3 | AC5 collision class, both insertion orders, deterministic |
| `test_tp04_agreement_is_not_sufficient_visible.test.ts` | 3 | AC5 — exact family set `{intent-trace}`; circularity self-test |
| `test_tp05_reproducible_from_seed_visible.test.ts` | 4 | AC3 |
| `test_tp06_registry_open_for_extension_visible.test.ts` | 5 | AC4 both halves + declared gaps |
| `test_tp07_delete_and_undo_reach_sec_visible.test.ts` | 2 | WP19 link |
| `test_tp08_quarantine_under_concurrency_visible.test.ts` | 2 | WP20 link |
| `test_tp09_write_gate_removal_does_not_change_convergence_visible.test.ts` | 1 | WP21 link |
| `test_tp10_partial_capture_never_removes_a_field_visible.test.ts` | 2 | WP22 link |
| `test_tp11_byte_identity_and_stale_save_discrimination_visible.test.ts` | 2 | WP17 link + shadow family |

**Blind sets** (staged at depth 3 into `plugin/src/__tests__/<a>/<b>/` for verification, then removed):
10 files, 17 cases, **all PASS**, ~2.6 s. blind1 reaches the properties through a family
discrimination matrix, an expectation re-derived inside the test rather than through `oracle.ts`, the
tombstone container instead of the file, key-set monotonicity checked at **every window boundary**,
and byte equality restated as a cardinality. blind2 reaches them through core-enforced band
structure, a whole-run fingerprint, absence-of-write-gate-evidence, a universal schema check over
every file in every settled window, and a fresh 96-scenario band gated on op coverage.

## Full-suite gate

Run from `plugin/`.

| | Baseline (before WP23) | After WP23 | Delta |
|---|---|---|---|
| `npm test` test files | 220 (5 failed) | 231 (5 failed) | +11 |
| `npm test` tests | 1316 — **8 failed**, 1308 passed | 1346 — **8 failed**, 1338 passed | **+30 tests, +0 failures** |
| Wall duration | 40.94 s | 41.12 s | **+0.18 s** |

**The failure set is exactly the 8 pre-existing WP19-caused reds**, unchanged in identity:

```text
canvas-sync.test.ts                          × 3   (legacy V1 delete oracles)
w4-canvas-integrity.test.ts                  × 1
v2/wp4/test_tp01_intent_basis_visible        × 1
v2/wp5v2/test_tp05_handover_and_close        × 2
v2/wp6/chaos_degraded_adapter                × 1
```

Not mine, not touched, not counted. **Test-count delta fully accounted for:** +30 = the 30 WP23
visible cases; +11 files = the 11 WP23 visible files. Nothing else was added, and no existing test was
deleted, skipped, `.only`-ed, retitled, weakened or softened.

**Runtime added: +0.18 s wall** (the fuzzer parallelises with the rest of the suite; its own
contribution is ~9.5 s of test time, comfortably inside the 20–30 s budget, and `FUZZ_BUDGET` is the
one place CI raises it).

- `npx tsc --noEmit` — **PASS**, clean, with the blind sets staged as well.
- `npm run build` — **PASS** (`tsc -noEmit -skipLibCheck && node esbuild.config.mjs production`).
- **Production source untouched.** `plugin/src/files/canvas-sync.ts`, `plugin/src/canvas/canvas-binding.ts`
  and `plugin/src/canvas/canvas-shadow.ts` were verified byte-identical (`cmp -s`) against pre-change
  backups after the fault matrix; `grep -rn "FAULT INJECTION" src/` returns nothing.
  `canvas-presence.ts`, `canvas-binding.ts`, `canvas-model-bridge.ts`, `main.ts`, `manifest.json`,
  `package.json`, `server/`, `docker/`, `deploy/` and the plugin version are all unchanged.
- **Zero new dependencies.** No property-testing library. The PRNG is 30 lines of mulberry32.

## Summary for Worker 3

WP23 is DONE on attempt 1. The deliverable is a reusable convergence fuzzer
(`plugin/src/__tests__/harness/fuzz/`, 2 888 lines) driving 3–5 real `CanvasSync` replicas over random
op sequences, partitions, reordered and duplicated deltas and stale-view Obsidian saves, judged by
seven assertion families — the four AC2 convergence families plus the **intent-trace correctness
oracle** AC5 demands and two WP-link families.

The determinism problem was solved by construction, not tolerated: **windows** make cross-window
writes causally ordered, **per-window slot claims** make within-window ops touch disjoint fields, and
the one place genuine same-field concurrency is wanted is **declared contested** and judged by
LWW-consistency only. The suite is stable across repeated runs with fresh random Yjs clientIDs
(30/30 visible ×5, 47/47 including both blind sets ×3).

The headline evidence: reintroducing the WP18-class insertion-order bug produces **2 913 intent-trace
violations and zero from every other family**. SEC, schema, byte equality and shadow consistency are
all green over a corrupted document — which is precisely why AC5 exists, and is now demonstrated
rather than argued.

No production bug was found, so nothing was frozen as a regression test. One hypothesised bug (torn
`x`/`y` through the P1 flat capture path) was probed empirically and **falsified**; the reasoning is
recorded under FINDINGS so it is not re-litigated. Full suite ends at exactly the 8 pre-existing
WP19-caused failures, +30 tests, +0.18 s.
