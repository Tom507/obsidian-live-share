# Implementation Report — WP20

Attempt: 1

## Status: DONE

## Completed Work

| AC | Status | Notes |
| --- | --- | --- |
| AC1 — an invalid record is quarantined `{on:true, q:true}`, never serialised, never rendered, field containers preserved | DONE | The repair pass writes ONLY to the `deleted` container, through WP12's `applyTombstoneOp`. `nodesMap` / `edgesMap` are never written and never read for mutation, so the record's `Y.Map` keeps its identity and every field by construction, not by care. Suppression from the view and the file is not new code: `buildCanvasData`'s existing `isRecordSuppressed` already hides a `on:true` record and cascades to its edges. |
| AC2 — a later delta that restores the missing fields releases the quarantine automatically | DONE | A record that passes the schema again AND is currently `isTombstoneQuarantined` gets an ordinary `on:false` op (same shape as an undo — no `releaseQuarantine` function, no second arbitration rule). The lift is deliberately gated on `isTombstoneQuarantined`, never on `isTombstoneSuppressed`: a user-deleted record is schema-VALID, so the weaker predicate would resurrect every card the user ever deleted, on every peer, on every tick. |
| AC3 — idempotent and convergent; a repeated audit of an unchanged doc emits zero deltas | DONE | Plan-then-write. An action is planned only for a transition that has not happened yet, so a settled doc produces an empty plan and `repairCanvasState` returns before touching anything. This is the load-bearing part: `applyTombstoneOp` always `set`s, a `set` of a semantically identical value is still a real CRDT delta, and the audit is observer-driven — a rewrite would wake every peer's audit, which would rewrite it back. Convergence: one Lamport stamp per pass, `by = clientID`, LWW via `mergeTombstoneEntries`; three replicas that plan the same verdict differ only in `by`, Yjs resolves the same-key writes identically on all three, and the next pass reads the result as a fixed point. |
| AC4 — an endpoint-less edge can no longer reach disk; quarantine and release emit distinct signatures | DONE | Edge validity is `validateEdgeIngest` → `hasBothEndpoints`, i.e. `id ∧ from.node ∧ to.node`. "Endpoint-less" therefore means the `node` is absent, and a side-less endpoint is a COMPLETE endpoint that is left strictly alone — the E1 ruling is honoured by IMPORTING the predicate rather than restating it, so the auditor cannot drift from the ingest path. Signatures: `QUARANTINE RAISED signature: <kind> <id> hidden pending repair (<REASON>)` and `QUARANTINE LIFTED signature: <kind> <id> revalidated, suppression cleared` — different sentences, not the same sentence with a different id. |

## Blocked Items

| Item | Blocker | Workaround attempted |
| --- | --- | --- |
| — | none | — |

## Changes Made

`plugin/src/files/canvas-sync.ts` — the only production file touched.

├── import — added `isTombstoneQuarantined` to the existing `canvas-tombstone` import.
├── new module-scope block before `class CanvasSync` (the WP20 header comment, the
│      `QuarantineAction` union, `quarantineSignature`, `quarantineReleaseSignature`, and
│      `planQuarantineActions` — the whole decision, pure and testable without a doc).
├── `subscribe`'s doc observer — passes `deletedMap` to `scheduleCanvasAudit`. That container was
│      already `observeDeep`'d by WP19, so a peer's repair delta and a peer's quarantine both
│      re-arm the same debounce; no new timer, no new timing constant.
├── `scheduleCanvasAudit(path, nodesMap, edgesMap, deletedMap)` — one added parameter, forwarded.
│      The debounce/max-wait contract is byte-for-byte unchanged.
├── new `private repairCanvasState(nodesMap, edgesMap, deletedMap)` — plan both id spaces, return
│      on an empty plan, then take ONE stamp and apply.
└── `auditCanvasState(..., deletedMap)` — calls `repairCanvasState` FIRST and unconditionally,
       ahead of the `if (!this.logger) return;` guard. Self-healing is a property of the doc: a
       client with no console attached must converge to the same state as one that has. The legacy
       SCATTER / DETACH / NO TYPE telemetry below it is untouched.

Not changed, deliberately: `GEOMETRY_KEYS` (membership and export intact), `PROTECTED_KEYS` (kept
as defence in depth), the ingest path (no remote delta is refused), `canvas-presence.ts`,
`canvas-binding.ts`, `canvas-model-bridge.ts`, `main.ts`, `server/`, `package.json`, the version.
Zero new runtime dependencies. No pre-existing test was edited, skipped, retitled or weakened.

## Visible Test Results

| Test | Status | Notes |
| --- | --- | --- |
| tp01 — invalid record quarantined, not destroyed (2 tests) | PASS | `q:true` read through `isTombstoneQuarantined`; container identity and `toJSON()` unchanged; absent from `buildCanvasData` and `serializeCanvas`; healthy neighbour untouched; the `Y.Map` observer records zero key removals. |
| tp02 — a later delta lifts the quarantine | PASS | Stays quarantined after the delta that repairs only `size`; released (`on:false`) after the one that repairs `text`; same container object; both repair deltas' fields present; back in the view and in the file with the right geometry. |
| tp03 — releases only its own quarantine, never a user delete | PASS | `erased` (valid, `on:true`, no `q`) survives three passes suppressed, un-flagged, with `t:7` / `by:"peer-remote"` untouched; `alive` gets no entry at all; the `INVALID_SIZE` positive control IS quarantined. |
| tp04 — a second audit of an unchanged doc emits zero updates | PASS | Repair pass emits >0; passes 2–5 emit exactly 0; the projected file is byte-identical across them. |
| tp05 — three replicas converge on one end state | PASS | All three quarantine on their own concurrent audit; after the full-mesh exchange all three hold deep-equal tombstone state and byte-identical files; the whole arrow is not quarantined; two further passes emit zero updates. |
| tp06 — an endpoint-less edge cannot reach disk | PASS | Reaches the file before the audit (so the test is not vacuous), quarantined and absent after; both healthy endpoint nodes still on disk; container identity and all fields preserved. |
| tp07 — a side-less edge is NOT quarantined (E1 regression pin) | PASS | Quarantine set is exactly `["severed"]`; `sideless`, `halfsided` and the `group` node have NO entry at all; both legal arrows reach the file with `fromSide` / `toSide` absent rather than `null` / `""`. |
| tp08 — quarantine and release emit distinct signatures | PASS | State transition established first; both transitions emit a `<NAME> signature: …` line naming the record; no line shared; the two still differ after the record id is blanked out. |

`npx vitest run src/__tests__/v2/wp20` → **8 files, 9 tests, 9 passed**.

## Falsification Results

Every mutation was applied at source, the targeted visible test(s) run, and the source restored
byte-for-byte afterwards. Baseline before the sweep: 9 passed. After the sweep: 9 passed.

| AC | Mutation applied | Test that went RED | Restored green? |
| --- | --- | --- | --- |
| AC1 | quarantine op writes `q: false` instead of `q: true` | tp01 test 1 (1 failed / 1 passed — test 2 asserts only `isTombstoneSuppressed`, which is `q`-agnostic, so it correctly stays green) | yes |
| AC1 | after quarantining, also `nodesMap/edgesMap.delete(action.id)` (destroy instead of suppress) | tp01 both tests (2 failed) | yes |
| AC2 (lift) | the `release` action is planned but never pushed — quarantines correctly, never lifts | tp02 + tp08 (2 failed) | yes |
| AC2 (user delete) | release condition weakened from `isTombstoneQuarantined` to `isTombstoneSuppressed` | tp03 (1 failed) | yes |
| AC3 (idempotence) | the `if (isTombstoneSuppressed(entry)) continue;` guard removed, so every pass re-emits an identical tombstone | tp04 + tp05 (2 failed) | yes |
| AC4 (disk) | the edge id space is not planned at all | tp06 (1 failed) | yes |
| AC4 (E1 pin) | `side` reinstated as an endpoint conjunct, so a side-less endpoint reads as endpoint-less | tp07 (1 failed) | yes |
| AC4 (signatures) | `quarantineReleaseSignature` returns the raise sentence verbatim | tp08 (1 failed) | yes |

The two the brief called out specifically are both covered and both bite: the LIFT-path mutation
(row 3) turns quarantine into a delete with extra steps and is caught by tp02/tp08, and the
IDEMPOTENCE mutation (row 5) leaves every state assertion satisfied while re-broadcasting an
identical tombstone on every pass — caught only by tp04's update counter and tp05's fixed point,
which is exactly why those two tests count deltas rather than inspect state.

## Full-suite gate

- `npm test -- --reporter=dot` from `plugin/` → **209 files, 1288 tests: 8 failed | 1280 passed**
  (40.9 s). The failure set is EXACTLY the declared 8 pre-existing reds and nothing else:
  - `canvas-sync.test.ts` — "a genuine local DELETE of a whole record is still honoured", "genuine
    local delete removes the node from the Y map", "prunes edges in the shared doc when their
    endpoint node is locally deleted (GAP-5)"
  - `w4-canvas-integrity.test.ts` — "A7 a genuine WHOLE-record delete is unaffected by PROTECTED_KEYS"
  - `v2/wp4/test_tp01_intent_basis_visible.test.ts` — "T4 with the view open and a hand-over receipt…"
  - `v2/wp5v2/test_tp05_handover_and_close_visible.test.ts` — "T2 …", "T3 …"
  - `v2/wp6/chaos_degraded_adapter.test.ts` — "D2 seam `advanceFromReceipt(…, { perFieldReceipt: false })`…"

  All eight are the legacy V1 delete oracles awaiting a licensing ruling. Not touched, not fixed,
  not edited. The count and the set are identical to the pre-change baseline; no new failure
  anywhere.
- `npx tsc --noEmit` → clean, exit 0.
- `npm run build` → PASS (`tsc -noEmit -skipLibCheck && node esbuild.config.mjs production`).
- Line width: no added line exceeds Biome's 100 columns. The file remains fully CRLF (2746 CRLF,
  0 bare LF) — no mass reformat, and the diff against HEAD grew by exactly this change.

## Summary for Worker 3

WP20 is DONE on attempt 1: `auditCanvasState` now runs a plan-then-write self-repair pass before
its telemetry, quarantining schema-invalid records as `{on:true, q:true}` through WP12's single
tombstone op and releasing that quarantine automatically the moment a later delta makes the record
whole again — with the record's `Y.Map` never touched, which is the only reason the lift can work
at all. The whole decision is one pure function that asks WP14's `validateNodeIngest` /
`validateEdgeIngest` and re-derives nothing, so the 2026-08-02 E1 ruling holds here for free: a
side-less endpoint is a complete endpoint and its edge is never quarantined (pinned by tp07).
Idempotence is structural rather than cached — an action exists only for a transition that has not
happened yet, so a settled doc plans nothing and writes nothing, and three replicas auditing
concurrently converge on one entry and then sit still. All 9 visible tests pass, all 8 source
mutations (including a lift-path-only and an idempotence-only mutation) drive the matching test
RED and restore green, and the full suite is back at exactly the 8 known pre-existing reds with
`tsc` and `build` clean. Note for the record: this protects the DOC, not the FILE — a record that
exists only in the user's file is still WP63's I11 problem, and nothing here makes WP63
unnecessary.
