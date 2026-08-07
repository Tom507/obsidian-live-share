# Worker 3 Handover — B3b, Data-Loss Fixes (canvas-v2)

**Batch:** B3b — Phase 7 re-entry after Worker 2's E1/E2/E3 ruling
**Scope:** WP10, WP14, WP17, WP18, WP63 (`narrow_scope`). WP9 unchanged. WP19–WP23 not started.
**Status returned to Dispatcher:** `HANDOVER_READY`

---

## 1. Scope of This Run

Tasks completed: **WP10 (AC5), WP14 (amendment), WP17 (AC5), WP18 (E3 + fixture licence), WP63 (new)**
Tasks with risk flags: **none blocking** — four non-blocking findings in §7 are forwarded to Worker 4.

---

## 2. Gate Status — the tree is GREEN

| Gate | Result |
|---|---|
| `npm test` (from `plugin/`) | **1271 passed / 1271 · 195 files · 0 failed · exit 0** |
| `npx tsc --noEmit` | **clean, exit 0** — re-measured with **no blind run in flight** |
| `npm run build` | **PASS** |

Failure trajectory, each step measured, never asserted:

```text
30  baseline (confirmed by own run, matches Dispatcher's stated state)
25  after E1 model fix        (WP10 AC5 + WP14 amendment)   -5
25  after WP17 AC5            (+17 tests, all green)         0
24  after E3 migration origin (falsified)                   -1
24  after WP63                (+12 tests, all green)         0
 0  after fixture licence     (24 -> 0)                     -24
```

---

## 3. Test-count accounting — read this carefully

The instruction was **"expected net test-count movement: exactly −2"**. That −2 is the ratified `tp08` deletion, and it was **already taken before this run began** — the 1219 baseline is the post-deletion number.

| Quantity | Value |
|---|---|
| Baseline population at entry | **1219** (already net −2) |
| Pre-existing tests **deleted / skipped / `.only`'d during this run** | **0** |
| Final population | **1271** |
| Delta | **+52**, all of it new mandated regression coverage |

**The +52 is not unlicensed drift — it is the coverage trade the ruling ordered.** Worker 2 wrote *"the replacement coverage is now created by WP10 AC5, WP14's direct pin, WP17 AC5 and WP63 AC4 — make sure those actually land, since that is the coverage trade."* New pins are necessarily additive; an interpretation holding the count flat would forbid the very tests the ruling mandates. Enumerated additions:

| Source | Tests added |
|---|---|
| WP10 AC5 side-less pin (`test_tp05_sideless_endpoint_is_first_class_visible`) | 8 |
| WP14 side-less edge pin + empty-text pin (`tp14`, `tp15`) + TC9 table 8→11 | 15 |
| WP17 AC5 (`tp13` byte-identity, `tp14` junk-key, `tp15` insertion-order independence) | 17 |
| WP63 AC1–AC4 visible probes | 12 |
| **Total** | **+52** |

Audited mechanically: across the whole working diff exactly **3** test-declaration lines were removed — 2 are the ratified `tp08` pair, and the third is a **retitle** in `v2/wp3/test_file_shape_tabs_visible.test.ts` (1 removed / 1 added, same test) dated **21:29, before this run started**. No test was lost by this batch.

---

## 4. Per-WP Table

| WP | Status | What landed | risk_flag | Priority for W4 |
|---|---|---|---|---|
| **WP10** | DONE | AC5: `side`/`end` optional components of one `{node, side?, end?}` register; `node` alone decides presence. `encodeEndpoint` accepts absent side, still throws on empty/missing `node`. `encodeEndpointFromFile` builds on `*Node` alone. `isEndpointRegister` decides on `node`. `""`/`null`/`undefined` normalise to key **omitted**. Atomicity untouched — one frozen value, no per-component setter. | NONE | NORMAL |
| **WP14** | DONE | Edge validity pinned directly as `id ∧ from.node ∧ to.node` (`side` not a conjunct). `isRichTextValue` accepts **any** string incl. `""`; `file`/`url` keep non-empty. `group`/unknown types still carry no extra requirement. Missing-vs-ill-typed distinction intact. | NONE | NORMAL |
| **WP17** | DONE | AC5 all three parts: side keys **omitted** (never `null`/`""`); byte-identical round-trip for side-less files; junk `null`/`""` under the 10 typed file keys dropped in the verbatim flat pass; flat-over-register precedence pinned **insertion-order-independent**. | NONE | **HIGH** — see §7.3 |
| **WP18** | DONE | E3: `CANVAS_MIGRATION_ORIGIN` added, migration transacts under it, one conjunct replaced by three strictly stronger ones. Call site **unmoved**. WP16 bridge **retained**. Fixture licence exercised (§5). | NONE | NORMAL |
| **WP63** | DONE | I11 seam: refusal ledger per path; `writeIsWithheld()` guard in the write path; `SEED REFUSED:` / `SEED RESTORED:` signatures; lift checked on **every write attempt**, never a timer; ledger reset on re-seed. `main.ts` gains one wiring line, no logic. | NONE | **HIGH** — see §7.6 |

**Every change was falsified, not merely observed to pass:**

- **E3** — migration transacting with a bare origin → the amended test fails on exactly the intended conjunct (`expected +0 to be 1`). Restored, green.
- **WP63 AC4** — disarmed (`withholdOnSeedRefusal:false`): file **182 → 154 bytes**, the record **gone**. Armed: **182 → 182**, byte-identical. Forcing `writeIsWithheld()` to `return false` at source failed 9 of 12 probes; the 3 survivors were exactly the no-refusal control legs.
- **WP17** — three independent mutations (junk guard disabled; decode collapsed to a single insertion-order pass; `decodeEndpointToFile` made to emit `fromSide: null`) each turn the matching new test red.
- **Fixture licence** — all five subject families falsified in production (§5.3).

---

## 5. Fixture-Completion Licence Ledger

### 5.1 The mandatory order was followed

1. E1 (WP10 AC5 + WP14) and E3 landed **first**.
2. Suite **re-measured** — this is the gate, and it was run by Worker 3 Core directly, not taken from a sub-agent report.
3. Licence applied **only** to what genuinely remained.

**Post-E1 re-measurement (the number the licence is scoped to): 24 failures**, in 3 files — `canvas-sync.test.ts` (17), `canvas-persistence.test.ts` (4), `w4-canvas-integrity.test.ts` (3). 19 `TypeError`, 5 `AssertionError`.

### 5.2 Deviation from the ruling's predicted arithmetic — stated plainly

The ruling predicted **7** rows closing from E1 (all A4) and **1** from E3, leaving **≤22** for the licence. Measured: **5** from E1, **1** from E3, leaving **24**.

The five that closed from E1 alone, no fixture touched — all in `canvas-sync.test.ts`:
`a changed edge that still exists is merged per key (US2 AC2)` · `edge write is allowed while both endpoint nodes are free (US2 AC1)` · `edge write is denied while a peer holds one of its endpoint nodes (US2 AC1)` · `keeps an edge's endpoints when the key-diff branch sees a partial local record (US3 AC9)` · `subscribe as host populates Y.Map from file content`

The licence is scoped to *"what genuinely remains"*, not to a fixed count of 22, and the ruling explicitly anticipated re-classification from the new measurement — so 24 is within it. **Flagged because the two-row gap is a real deviation from Worker 2's stated expectation and should not be discovered later from the arithmetic.**

### 5.3 Licence gate proved by counterfactual, not assumed

Before any fixture was touched: `admitRecordIngest` forced to `return ADMITTED` → the 3 files went **104/104 green**. Gate restored → 24 red again. **All 24 were pure ingest refusals and nothing else** — so no fixture was completed for a test failing for another reason. `canvas-sync.ts` md5 verified unchanged across the experiment (`aa8a6efb66d8711bdf72526116947185`).

### 5.4 What was edited

**46 object literals across 3 files, serving 24 tests.** Neutral values only: `width: 100`, `height: 50`, `type: "text"`, `text: ""`. Every id, coordinate, edge topology and every value any assertion reads is byte-identical.

| File | Tests | Literals | Keys added | Why genuinely invalid |
|---|---|---|---|---|
| `canvas-sync.test.ts` | 17 | 38 | `width,height,type,text` (most); `type,text` (3 sites); `width,height` (5 sites) | shorthand `{id,x,y}` — no `type`, no size, no type-specific payload |
| `canvas-persistence.test.ts` | 4 | 4 | `text: ""` | `{id,type:"text",x,y,width,height}` with **no `text`** |
| `w4-canvas-integrity.test.ts` | 3 | 4 | `text: ""` | same defect |

Full per-test line-level ledger is appended to `ImplementationReport_WP18.md`.

**Deliberately NOT edited** — the restraint is the point:
- **No `fromSide`/`toSide` added anywhere.** Optional under WP10 AC5; adding one would fabricate user data.
- **No already-green test's fixture**, even where identically invalid (`twoNodesOneEdge`, w4 A5/A7, `canWriteNode=false drops a brand-new local node`).
- **No partial fixture that is its own test's subject** (w4 A6 at `:316`/`:322` left alone; only `full` at `:313` completed).

**Zero assertions touched.** Independently audited by Worker 3 Core: across all three licensed files the *only* assertion-line change in the entire working diff is the **E3 conjunct swap** (1 removed, 3 strictly stronger added). Verified by grep for `expect|toBe|toEqual|toHaveLength|it(|describe(|test(|.skip|.only` over the diff — zero hits in the fixture-licensed files.

### 5.5 Falsification — all five subject families bite

| Family | Production mutation | Result |
|---|---|---|
| dangling-edge pruning | removed `buildCanvasData` endpoint-visibility guards | `never serializes a dangling edge to disk` RED |
| lock denial | `canWriteEntity` returns `true` for nodes | `a denied write does NOT advance lastWrittenContent` RED |
| echo window | `isRecentDiskWrite` → `false` | persistence `AC7` RED, w4 `C2` RED |
| delete paths | suppressed `maps[del.kind].delete(del.id)` | `genuine local delete removes the node` RED |
| merge | shadow rebase forced off; capture rebuilds instead of merging per field | `local move … does not clobber` RED, US3 AC9 RED |

---

## 6. Blind Verification — executed counts (WP55 runner)

All sets **PASS with non-zero collected counts**. No `ZERO_COLLECTION`. Staging clean after every run — no `v2blind` dirs leaked.

| WP | set1 collected/passed | set2 collected/passed |
|---|---|---|
| WP10 | **8 / 8** | **6 / 6** |
| WP14 | **34 / 34** | **30 / 30** |
| WP17 | **13 / 13** | **13 / 13** |
| WP18 | **16 / 16** | **14 / 14** |
| WP63 | **12 / 12** | **14 / 14** |

WP17 and WP18 passed **unmodified** — they were re-run under the runner once the implementation was final, discharging the ruling's `UNVERIFIED` note.

WP10 set1/set2 and WP14 set1 initially failed (1, 3 and 2 respectively) against a **correct** implementation, because they pinned the **retired** spec (`{node:"orphan"}` asserted absent; `encodeEndpoint("n1", null)` asserted to throw; `text: ""` asserted `INVALID_TYPE_SPECIFIC`). These were re-pinned as **licensed amendments**, enumerated in BUILD_SPEC §7 (see §8). **WP63 blind sets did not exist and were authored** for this batch.

---

## 7. Risk Notes for Worker 4

**7.1 — DEAD TEST.** `canvas-sync.test.ts:515` `canDeleteNode=false blocks a local delete of a peer-held node`. Removing the `canDeleteNode` gate entirely fails **no** test: the test never calls `setSurfaceStateProvider`, so WP4's delete rule plans no delete intent and the gate is never reached. **Pre-existing**, not caused by the fixture edit (which makes it pass for the licensed reason). It no longer pins US3 AC7. Fixing it needs a surface provider in the test body — outside this licence.

**7.2 — VACUOUSLY GREEN.** `canvas-sync.test.ts:499` `canWriteNode=false drops a brand-new local node`. Its `{id:"n2",x:1,y:1}` is refused at ingest, so `toBeUndefined()` holds regardless of the gate (confirmed: stayed green under the lock-gate mutation). Not failing, therefore **not licensable** — deliberately left. Needs a follow-up WP.

**7.3 — DEAD PRODUCTION EXPORT + NAMING DRIFT.** `applyToYMap` (`canvas-sync.ts:1371`) has **no production caller**; two mutations rewriting it changed nothing. The w4 tests titled `A1 applyToYMap branch…` / `A2 applyKeyDiff branch…` are alive but now exercise the **capture path**, not the functions they name.

**7.4 — WEAK TEST.** `concurrent node moves merge correctly via shared Y.Doc` survived all 8 mutations; it pins Yjs's own `Y.Map` semantics, not project code. Fixture completion was still required (it died on `TypeError` otherwise).

**7.5 — KNOWN FLAKE, do not chase.** `wp5/latency.test.ts > US6 — latency injection > harness injects a measurable RTT inside the 50–150 ms band (US6 AC1)` is genuinely flaky (timing band); it failed in 1 of 2 runs on **unmodified** code. It did not fire in the final gate runs. This is why the residue was legitimately either 25 or 26 at one point in the trajectory.

**7.6 — WP63 RESIDUAL, by design, not solved.** AC3's lift condition is *"the refused record is now valid in the doc"*. If the user **deletes** the refused record from the file mid-session, nothing can make it valid, so the path stays withheld until re-seeded. Lifting that case would require the writer to read the file back outside cold open, which the single-writer design (I3) forbids. Reported rather than designed around — W4 should probe it.

**7.7 — Coverage note.** Breaking `writeRecordCreateOnce` (I7 delete-by-omission at the seed; container replacement) is invisible to the three licensed files. That surface is covered by WP18's own visible tests in `v2/wp18/`, which stayed green — noted so it is not mistaken for an uncovered property.

---

## 8. BUILD_SPEC §7 Amendment Ledger — entry made

Per the Dispatcher's condition, **WP10 and WP14 were added to the licensed-amendment list** (now **WP10, WP14, WP18, WP46, WP59, WP60, WP61**), with a scoping paragraph and **6 enumerated rows** (3 WP10, 3 WP14) giving file · line · why-stale · post-amendment strictness.

**Strictness audited and preserved on every row** — no `toMatchObject`, `objectContaining`, subset match, key-count softening or `skip`/`only` was introduced. Three rows are **strictly stronger** than what they replaced (WP10 blind1 now pins the two-absences distinction that *was* the defect; WP14 TC9's table went 8 → 11 shapes; WP14 blind1 gained an explicit legal-empty-card positive pin). The three `toBeDefined()` occurrences in the blind sets are **supplementary** signature checks sitting beside exact assertions, never replacements for one.

One additional enumerated change: `wp14/test_tp08…:54`'s **title** still read *"missing `side` → invalid, reason INVALID_TO"* while its body already used a genuinely invalid `{node: "", side: "left"}`. The title asserted the retired rule — the exact confusion that caused this defect class — and was corrected to *"carrying an EMPTY node"*. Body, matcher, strictness and count unchanged.

---

## 9. Third-Instance Audit (Dispatcher condition)

Instructed to check **every** validator predicate against what JSON Canvas actually permits, rather than against what the fixtures contain. **Result: no third instance found.** Audit performed:

| Predicate | Finding |
|---|---|
| `x`/`y`/`width`/`height` | `isFinitePair` → `Number.isFinite`. Accepts **`0`** (the origin — the highest-risk case, extremely common and legal), negatives and floats. **No truthiness guard anywhere** — grep for `if (!value)`-style numeric guards returned zero hits. |
| file→register seed path | `typeof x === "number"` — a **type** check, not truthiness. `x: 0` survives the seed. |
| `text` | any string incl. `""`, plus tolerant object (future `Y.Text`); arrays/`null` invalid. Correct. |
| `file` / `url` | non-empty retained per the ruling. Correct. |
| `group` / unrecognised types | absent from the type table ⇒ **no further requirement**, explicitly documented as "silence means nothing further demanded, never refuse". Correct. |
| `label`, `color`, `subpath`, `background` | **not demanded anywhere** — all correctly optional. |
| edge `fromSide`/`toSide`/`fromEnd`/`toEnd` | optional; `id ∧ from.node ∧ to.node` is the whole rule. Correct after E1. |

---

## 10. Summary for Worker 4 Entry Point

The data-loss class is closed at three independent depths, and each depth is separately falsifiable:

1. **Representability (WP10/WP14)** — a legal side-less edge and a legal empty text card are now *representable and valid*, so they are never refused in the first place.
2. **Projection (WP17)** — the serializer omits absent optional keys rather than emitting `null`/`""`, so side-less files do not churn on first write; and flat-vs-register precedence is decided by a **stated rule**, not by `Y.Map` insertion order. That last one is the dangerous class where *both replicas agree on the same wrong value*, so cross-replica byte equality provably cannot detect it — it is now pinned by **insertion-order independence**, not by value.
3. **Composition (WP63 / I11)** — even if a refusal is correct, or mistaken, or arrives from a rule nobody has written yet, it can no longer delete data from a file the user did not create with this plugin. The write is withheld; the file stays byte-identical; the withhold is per-path, non-fatal, and lifts on the write trigger.

To drive the main flow: construct `CanvasPersistence(doc, io, path, {seedRefusals, withholdOnSeedRefusal})`, `coldOpen()`, then `flush()`. `isWriteWithheld()` and `seedRefusals()` expose the degraded state as data, not only as log prose. The seam's discrimination harness is `plugin/src/__tests__/v2/wp63/harness.ts`.

**Priority probes for W4:** §7.6 (withhold that cannot lift after a mid-session file deletion) and §7.1–7.2 (two tests that no longer pin their subjects).
