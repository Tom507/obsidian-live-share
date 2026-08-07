# Implementation Report — WP5

Attempt: 3

## Status: DONE

All four gates green:

| Gate | Result |
|---|---|
| `npx vitest run "src/__tests__/v2/wp5v2/"` | **7 files / 35 tests, 0 failures** |
| `npx vitest run "src/__tests__/v2/"` | **38 files / 209 tests, 0 failures** |
| `npm test` (full suite) | 80 files / 927 tests — **3 failures, exactly `A4` / `A9` / `A10` in `src/__tests__/w4-canvas-integrity.test.ts`**, nothing else |
| `npx tsc -noEmit -skipLibCheck` | clean |

No `v2blind` directory exists in this tree. `npx biome check src/canvas/canvas-shadow.ts src/main.ts`
still reports the known whole-file CRLF `format` finding, one per file, and no lint-rule
violation — not mass-reformatted, per the charter.

Attempt 3 changed **only** the WP5/C5 block of `plugin/src/canvas/canvas-shadow.ts`.
`main.ts` was not touched (attempt 1's wiring stands), `canvas-sync.ts` was not touched,
and no test file was created, deleted, skipped, weakened or edited.

---

## Attempt 2 Regression — Root Cause

### The honest finding first

**No attempt-2 change caused `failed_hidden_WP4_tp05_blind2.test.ts` to fail. That test's
`T2` case is nondeterministic by construction, and its outcome is independent of every
line of code in this repository.** I established this before changing anything, and I
re-established it after. Evidence below. I still made the corrective change I was asked to
make, because two of the six attempt-2 generalisations are wrong on their own merits under
the corrected asymmetry — but the report has to state which claim the evidence supports.

### The measurement

I reproduced the exact `T2` sequence **outside the repository** (a throwaway Vitest config
in `h:\tmp\wp5probe\` whose `root` is that temp dir and whose aliases point at the plugin's
real `obsidian` mock and `yjs` — the repo tree was never written to, and no test was added
to any suite). 200 runs of the sequence, tallying the final `c.x` on all three docs:

```text
OVERALL:    [ '[777,777,777]', 98 ]   [ '[555,555,555]', 102 ]
two<three:  [ '[777,777,777]', 98 ]          ← peer "two" has the LOWER clientID
two>three:  [ '[555,555,555]', 102 ]         ← peer "two" has the HIGHER clientID
```

Forcing the ids removes all doubt:

```text
two.clientID=10 three.clientID=20 -> x=[777,777,777]  y=[103,103,103]  ref=["ref b",…]
two.clientID=20 three.clientID=10 -> x=[555,555,555]  y=[103,103,103]  ref=["ref b",…]
```

### Why that is the whole explanation

- In `T2`, peer `two` writes `c.x = 555` and peer `three` writes `c.x = 777` **without ever
  exchanging state** (`three` is forked from the offscreen doc in `makeRoom`, before `555`
  exists, and only receives `555` at the very end). The two writes are therefore
  **concurrent** on the same `Y.Map` key.
- Yjs resolves concurrent same-key writes by client id: among items sharing an origin, the
  larger `clientID` integrates rightmost, and `_map` holds the rightmost item. `Y.Doc`'s
  `clientID` is `random.uint32()` per construction. Hence the exact 50/50 split.
- `555` is **not a stale value**. It is authored by peer `two`; the test's own `T1`
  formulates the real oracle as *"the field is only ever the value a peer authored"*, and
  `555` satisfies it. The offscreen client's stale value is `100`, and `100` **never
  appears** in any of the 200 runs — in both saves it is correctly discarded as staleness.
- The deterministic parts of `T2` — `y === 103` and `ref.text === "ref b"`, i.e. everything
  the offscreen client legitimately owns — are correct in **100 %** of runs.
- Structurally, `canvas-sync.ts` imports only the WP1/WP2 exports from `canvas-shadow.ts`
  (`advanceField`, `advanceRecord`, `createSurfaceShadow`, `getRecordFields`,
  `getRecordState`, `markRecordAbsent`, `planIntentDiff` + types). It imports **nothing**
  from the WP5/C5 block, and the failing scenario never constructs a receipt, so
  `buildApplyReceipt` / `advanceFromReceipt` / `partitionReceipt` / `sweepAbsent` are not
  reachable from it at all.
- Additionally, both G1 and G2 are **inert for every receipt `buildApplyReceipt` can
  produce**: `buildApplyReceipt` emits exactly one line per `(kind, id)`, so the fold had
  nothing to fold; and `exhaustive` is only ever `true` for `structural && reloaded`, in
  which case every line is `"applied"` and `summary.unconfirmed` is empty, so the gate
  never fired. Neither could change any observable behaviour in production or in the
  visible suite.

I verified the WP4 guarantee itself under the **attempt-3** code with 300 further
out-of-repo runs of the three scenarios: the alternation oracle (the field is only ever a
peer-authored value, `"v0"` never returns) passes 100/100; the offscreen client's own edits
(`y`, `ref.text`) survive 100/100; the never-saving peer sees no revert 100/100. The
cascade does not start.

> Reporting this the way rule 4 asks for a wrong *visible* test: `T2`'s
> `expect(nodeField(doc, "c", "x")).toBe(777)` is not a behavioural oracle. No
> implementation can make it deterministic without the offscreen client **pushing** `x` —
> which is precisely the corruption the test exists to forbid. If it is to stay, the sound
> assertion is `expect([555, 777]).toContain(x)` (peer-authored, never the local `100`), or
> the fixture must make peer `three`'s edit causally follow peer `two`'s by pushing
> `two → three` before `three` writes.

### What I nonetheless changed, and why it is right independently

The premise "under-advancing merely costs a redundant reclassification" **is** wrong, and
attempt 2 was built on it. Under the corrected, symmetric rule, two of the six
generalisations are defects on their own merits and are reverted.

| # | Attempt-2 rule | Verdict | Reason |
|---|---|---|---|
| **G1** | Fold `receipt.records` per `(kind, id)`; one unconfirmed line **vetoes** every confirmed line of that record. | **REVERTED** | Its stated justification is false. Attempt 1's line dispatch was **already order-independent**: an unconfirmed line *writes nothing* and a confirmed line only ever *writes*, so the resulting shadow state is the union of the confirmed lines regardless of array order. The only thing the veto adds is the power to **suppress a confirmed line** — and suppressing a confirmed advance is the failure direction that lets a later restatement of that value read as fresh intent and overwrite newer peer state. Section 7 rules 1 and 2 are also written as a dispatch on the line's own `outcome`. |
| **G2** | Skip the `exhaustive` absent sweep whenever the pass left **anything** unconfirmed. | **REVERTED** | This is a whole-pass veto over the module's membership conclusion, and section 7 rule 3 states the sweep **unconditionally** on `exhaustive` — the gate was an addition to the mandatory contract, not a hardening of it. Semantically it is also wrong: a landed structural reload *did* replace the surface's membership, and a record the receipt did not carry is genuinely gone whether or not some *other*, carried record was `"interacting"`. Leaving it standing as `present` with its old field values is exactly the under-advance failure — the next restatement of those values reads as intent and is pushed. The per-record carve-out that AC2/AC3 actually require is retained in full: **a record the receipt carried is never swept, whatever its outcome.** |
| **G3** | Never write `undefined` into the shadow (`toReceiptFields` + the advance side). | **KEPT** | Withholds nothing the surface confirmed: `getField` uses `undefined` as the "never observed" sentinel, so storing it yields *strictly less* knowledge than omitting the key, never more, and `canonicalizeRecord` omits such a key from the `.canvas` file so the value provably cannot be on the surface. |
| **G4** | Confirmed records go through `advanceRecord` (records `present` even with zero fields) instead of a bare `advanceField` loop. | **KEPT** | Advances *more*, not less: a confirmed record was handed to the surface, so `present` is true knowledge that the delete rule and the classifier both depend on. Only the zero-field case differs, and it moves in the safe direction. |
| **G5** | A non-array collection / non-object record shortens the receipt instead of throwing out of the reconcile pass. | **KEPT** | I5 "degrade, never break". Skips only records that have no usable `id` and are therefore not describable in a receipt at all — the `canvasIds` rule, unchanged. |
| **G6** | On the advance side an `id` field takes the record KEY. | **KEPT** | Mirrors `shadowToCanvasRecords`'s "the key wins" in the other direction, so the projection and the shadow can never disagree about which record a field belongs to. Identical to the receipt's own value for everything `buildApplyReceipt` produces. |

### The rule that now governs advancing

> **Both ways to be wrong lose data, so the rule is exact rather than cautious.**
> Advancing a field the surface did **not** take turns the user's next genuine edit back to
> that value into "staleness" and discards it. **Failing** to advance a field the surface
> **did** take turns the next restatement of that value into fresh *intent* — it is pushed
> to the CRDT and overwrites newer peer state, which is the cascade itself. There is no
> safe default to fall back on. Therefore: **advance precisely what was confirmed, advance
> nothing that was not, and let `exhaustive` mean what it says.** Scoping is per record
> (an unconfirmed record advances nothing and is not handed over; a carried record is never
> swept); it is never per pass.

---

## Completed Work

| AC | Status | Notes |
|---|---|---|
| AC1 — `canvasApplied` replaced by the C1 shadow as the single structure; no second, parallel shadow | DONE | `main.ts` obtains `this.canvasSync.getSurfaceShadow()` inside `reconcileLiveCanvas` and never caches it in a field; `shadowToCanvasRecords(shadow, canonical)` is the classifier's `lastApplied`; `createSurfaceStateStore` supplies the hand-over half from the same `advanceFromReceipt` summary. TC1 T1–T5, TC2 T1–T5, TC5 T1–T5 green. |
| AC2 — an `"interacting"` skip leaves exactly the affected record un-advanced and advances every other record's confirmed fields | DONE | TC3 T1–T5 green against the REAL adapter under a real drag bracket; TC6 T2/T3 green. The skip is scoped to the record, and the record is likewise excluded from the absent sweep — it is on the surface, it merely refused the new values. |
| AC3 — a failed or partial apply advances no field of the affected record | DONE | TC4 T1–T5 green, including the TOTAL shadow-dump oracle and the landed-reload absent-marking. TC6 T1/T4 green. `"failed"` / `"missing"` / `"unsupported"` / `"interacting"` each advance nothing and hand nothing over for their own record, and touch no other record. |
| AC4 — `main.ts` gains wiring only | DONE | TC7 T1–T6 green, including both source scans. `main.ts` was not touched in attempt 3 at all — the whole change is in the pure module, which is the point of AC4. |

**Definition of Done:** met. Classification basis and capture basis are literally the same
`SurfaceShadow` instance (TC1 T4 replaces it through `setSurfaceShadow` and both roles
follow in the same call), and the hand-over set is produced by the same
`advanceFromReceipt` call that advances it.

---

## Blocked Items

| Item | Blocker | Workaround attempted |
|---|---|---|
| — | — | none |

---

## Tools Created (by Worker 3 this attempt)

| Tool | Type | Purpose |
|---|---|---|
| `h:\tmp\wp5probe\` (out-of-repo) | throwaway diagnostic | A Vitest config + two probe files living entirely outside the repository, used to reproduce the hidden scenario and measure its determinism without adding anything to the repo tree. Not part of any suite, not referenced by anything, safe to delete. Recipe worth keeping: run `npx vitest run --config <outside-repo>.ts` from `plugin/`, with `root` = the temp dir, `include: ["*.probe.ts"]` and `resolve.alias` for `obsidian` + `yjs`; the config must **not** `import { defineConfig } from "vitest/config"` (resolution happens from the config's own directory → `MODULE_NOT_FOUND`) — export a plain object. |

---

## Changes Made

| File | Change (attempt 3 only) |
|---|---|
| `plugin/src/canvas/canvas-shadow.ts` | WP5/C5 block only. `ReceiptRecordPlan`, `partitionReceipt` and `applyRecordPlan` are removed and replaced by `toAdvanceFields(line)` + `advanceConfirmedLine(...)`; `advanceFromReceipt` dispatches per receipt LINE on `isConfirmed(line.outcome)` again; `sweepAbsent` loses the `summary.unconfirmed.length > 0` gate and builds its `carried` set straight from `receipt.records`. G3–G6 are preserved verbatim inside `toAdvanceFields` / `advanceConfirmedLine` / `toReceiptFields` / `buildApplyReceipt`'s `collect`. **No exported symbol, signature or documented semantic changed** — `shadowToCanvasRecords`, `buildApplyReceipt`, `advanceFromReceipt`, `createSurfaceStateStore`, `ApplyOutcome`, `RecordApplyResult`, `ApplyReceipt`, `ReconcilePass`, `FieldAdvance`, `ReceiptSummary`, `ApplyReceiptOptions`, `SurfaceStateStore` are exactly as section 7 fixes them. WP1/WP2 code (`advanceField` … `planIntentDiff`) untouched. The module still imports nothing, reads no clock and touches no I/O. |
| `plugin/src/main.ts` | **unchanged in attempt 3.** Attempt 1's wiring stands: `canvasApplied` + the `cloneCanvasRecords` / `CanvasRecords` imports removed; `surfaceState` store constructed once from the adapter registry and injected via `setSurfaceStateProvider`; `reconcileLiveCanvas` reads the shared shadow from `CanvasSync`, feeds the projection to `planReconcile`, collects only `reloaded` / `nodeOutcomes` from the two existing execution branches and forwards them through ONE receipt call site, then forwards `summary.handed`. Canvas close clears the hand-over receipt only (`surfaceState.clearPath`), teardown `clearAll()` — the shared shadow path is never cleared. |

Not touched: `reconcile-plan.ts`, `canvas-sync.ts`, `canvas-presence.ts`, `canvas-binding.ts`,
`canvas-model-bridge.ts`, `canvas-adapter.ts`, anything under `server/`, `wp42/`, `wp41/`,
the legacy `__tests__/wp5/`, `w4-canvas-integrity.test.ts`, `manifest.json`, `plugin/main.js`,
the plugin version. `useCanvasBinding` stays `false`. `GEOMETRY_KEYS` unchanged and still
exported. Zero new runtime dependencies. No new `setTimeout`, no new timing constant, no
sleep, no wall-clock reasoning. No doc-schema and no `.canvas` format change.

---

## Existing Tests Adjusted

| Test file | Test name | What changed and why |
|---|---|---|
| — | — | none. No test file was created, deleted, skipped, weakened or otherwise edited in this attempt. The hidden diagnostic was never copied into the repository. |

---

## Visible Test Results

`npx vitest run "src/__tests__/v2/wp5v2/"` — **35 passed / 0 failed (35)**, 7 files.

| Test | Status | Notes |
|---|---|---|
| TC1 `test_tp01_single_shadow_visible` T1–T5 | PASS | confirmed apply moves the capture basis; the same receipt makes the value the view no longer shows real intent; reverse direction; `setSurfaceShadow` re-points both roles; classifier reads the projection |
| TC2 `test_tp02_shadow_projection_visible` T1–T5 | PASS | three verdicts, `null` vs empty arrays, `absent` excluded, detached, hostile field names |
| TC3 `test_tp03_interacting_skip_visible` T1–T5 | PASS | real adapter + real drag bracket; skip scoped, not handed, not erased, deferral not hole |
| TC4 `test_tp04_failed_apply_visible` T1–T5 | PASS | total-dump oracle, `missing`, `unsupported`, partial receipt (I7), landed reload marks absent |
| TC5 `test_tp05_handover_and_close_visible` T1–T5 | PASS | incl. T4: closing the view drops the hand-over ONLY, the shared shadow keeps every field |
| TC6 `test_tp06_discrimination_seam_visible` T1–T4 | PASS | both legs of the direct comparison, default is ENABLED, disabled mode reproduces both V1 defects |
| TC7 `test_tp07_wiring_only_visible` T1–T6 | PASS | four wiring scenarios + both `main.ts` source scans |

---

## Regression Results

| Run | Files | Tests | Pass | Fail | New failures vs the known 3? |
|---|---|---|---|---|---|
| `npx vitest run "src/__tests__/v2/wp5v2/"` | 7 | 35 | 35 | 0 | **no** |
| `npx vitest run "src/__tests__/v2/"` (wp1–wp4, wp5v2, wp6) | 38 | 209 | 209 | 0 | **no** |
| `npm test` (full suite) | 80 | 927 | 924 | 3 | **no** — the 3 are exactly `w4-canvas-integrity` A4 / A9 / A10, confirmed by name in a targeted re-run of that file, and left untouched |
| `npx tsc -noEmit -skipLibCheck` | — | — | — | 0 | clean |
| `npx biome check src/canvas/canvas-shadow.ts src/main.ts` | 2 | — | — | 2 | the known whole-file CRLF `format` finding, one per file. No lint-rule violation. Not mass-reformatted, per the charter. |
| out-of-repo robustness probe (3 scenarios × 100 runs) | — | 300 | 300 | 0 | the cascade does not start: `"v0"` never returns, the offscreen client's own `y` / `ref.text` always survive, the never-saving peer never sees a revert |

`npm run build`'s gating half (`tsc -noEmit -skipLibCheck`) is clean; the `esbuild` half was
deliberately NOT run so the tracked `plugin/main.js` artifact stays out of this diff.

---

## Summary for Worker 3

`canvasApplied` is gone. `reconcileLiveCanvas` reads `this.canvasSync.getSurfaceShadow()`,
projects it with `shadowToCanvasRecords(...)` as `planReconcile`'s `lastApplied`, runs the
two existing execution branches unchanged while collecting only `reloaded` and a
`nodeOutcomes` map, and then makes ONE call — `advanceFromReceipt(shadow,
buildApplyReceipt({...}))` — whose summary both advances the shared shadow per field and
supplies `surfaceState.noteHandover(...)`. Closing a canvas clears the hand-over receipt
only; the shared shadow path is never cleared (TC5 T4 pins that the first save after a
close is still intent-free).

Attempt 3 reverts the two attempt-2 rules that made the advance path *conservative* rather
than *exact* — the record-level veto and the whole-pass gate on the `exhaustive` sweep —
and keeps the four that harden it without withholding anything the surface confirmed.
The governing rule is now stated in the module: **advance precisely what was confirmed,
advance nothing that was not, and let `exhaustive` mean what it says.**

**Two things Worker 3 needs to decide on, in order of importance:**

1. **The hidden diagnostic `failed_hidden_WP4_tp05_blind2.test.ts` `T2` is nondeterministic
   and is not a valid oracle.** Measured 50/50 across 200 runs, exactly correlated with the
   two peer docs' random `Y.Doc.clientID`s; `555` and `777` are both *peer-authored* values
   written concurrently to the same `Y.Map` key, and Yjs resolves that by higher client id.
   The offscreen client's stale `100` never appears. This is the **second** fixture defect
   of this shape in WP5's review loop, and it produced a false regression signal that cost a
   whole attempt. If that suite is going to gate WP4/WP5, its concurrent-write assertions
   need auditing: the sound form is "the value is one a peer authored", or the fixture must
   serialise the two peer edits (`push(two → three)` before `three` writes).
2. **Rounding asymmetry (unchanged, still not a failure).** The capture path rounds geometry
   (`roundCanvasGeometry` in `toParsedRecords`) before writing the shadow; the reconcile
   receipt stores the desired values verbatim, as section 7 specifies. A fractional
   coordinate from a peer costs one extra `geometry` classification, never a wrong value.
   The same asymmetry already exists inside WP4 between `advanceShadowFromContent`
   (unrounded) and `toParsedSave` (rounded), so a fix probably belongs there. Possibly
   WP22 / §4.4.

Lower-priority notes carried forward from attempt 2, unchanged:

3. **Object/array-valued fields can never satisfy the shadow's `===` staleness test.** An
   unknown/future `.canvas` key whose value is an object is preserved by
   `canonicalizeRecord`, stored by BOTH sides of the shadow as a fresh reference, and
   therefore compares unequal forever. It is a property of the WP1 value model and
   `reconcile-plan`'s comparator, identical with or without WP5, and both files are outside
   this charter's edit set.
4. **`reconcileLiveCanvas` holds the shadow in a local `const` for one pass** (obtained once,
   used by both the projection and the receipt). Deliberate, not a cache: classification and
   advance MUST be the same instance within a pass, or a mid-pass `setSurfaceShadow` would
   split them. No field in `main.ts` holds a shadow, and TC7's source scans pass.
5. **One guard kept to stay wiring-only:** `reconcileLiveCanvas` returns early if
   `this.canvasSync` is null (it is `CanvasSync | null` in `main.ts`). A null-dependency
   check, not canvas decision logic.

### Knowledge Signals

- **The two ways to be wrong in the Surface-Shadow are SYMMETRIC, not asymmetric.** This
  supersedes attempt 2's governing rule. Over-advancing turns the user's next genuine edit
  into staleness and discards it; **under-advancing turns the next restatement of a
  confirmed value into fresh intent, which is pushed and overwrites newer peer state.**
  Both lose data, so ambiguity must be resolved by being *exact*, never by defaulting to
  "do not advance".
- A `markRecordAbsent` sweep must be scoped **per record** (never sweep a record the receipt
  carried), never gated **per pass**. Gating per pass leaves records the surface provably no
  longer holds standing as `present` with stale field values — the cascade by the other route.
- A canvas convergence test that asserts a specific value after two **concurrent** peer
  writes to the same `Y.Map` key is a coin flip, not an oracle: Yjs breaks same-key
  concurrency by higher `clientID`, and `Y.Doc.clientID` is random per construction. Before
  treating such a failure as a regression, force the client ids and re-run both orders.
- To reproduce a hidden failing test without copying it into the repo: `npx vitest run
  --config <path outside the repo>` from `plugin/`, with `root` = the temp dir,
  `include: ["*.probe.ts"]` and `resolve.alias` for `obsidian` + `yjs`. The out-of-repo
  config must export a plain object — `import { defineConfig } from "vitest/config"` fails
  with `MODULE_NOT_FOUND` because resolution happens from the config's own directory.
- `advanceFromReceipt` must use `shadow.paths.get(...)` and never `ensurePathState(...)`,
  otherwise a receipt that confirms nothing turns an `unknown` path into an empty path entry
  and the classifier stops taking the safe `structural` branch (TC4 T1 is the oracle).
- `"interacting"` must dominate a same-pass edge-reflow reload in `buildApplyReceipt`: the
  reflow `setData` genuinely re-seats every other node, but Obsidian's drag state still owns
  the held card.
- `undefined` must never be written into the shadow: `getField` uses it as the sentinel for
  "never observed", so storing it makes an observed field read as unobserved. The `.canvas`
  serializer already drops such keys, so the value is unrepresentable on the surface anyway.
