# Implementation Report — WP3 — Test contract T1–T10
Date: 2026-07-20
Status: DONE

## ACs Satisfied

1. T1 seed — populated doc + empty model + construct ⇒ model id sets and every record equal the doc. PASS.
2. T2 capture — one user node move ⇒ exactly **one** `CANVAS_BINDING_ORIGIN` update carrying only the changed key (`changedKeys === ["x"]`); doc reflects new value. PASS.
3. T3 apply — remote node move via harness (`tr.local === false`) ⇒ follower updates via `applyNodeUpsert` (spy asserted). PASS.
4. T4 no-echo (sync) — synchronous `onLocalChange` re-emit during `applyRemote` ⇒ **zero** origin updates. PASS (I2).
5. T5 no-echo (async) — timer-fired `onLocalChange` after apply (fake timers) carrying the already-applied value ⇒ **zero** origin updates (empty diff). PASS (I3).
6. T6 streamed drag — 50 sequential geometry deltas from A ⇒ B converges to final geometry AND emits **zero** origin updates across the whole stream. PASS.
7. T7 concurrent different nodes — A moves n1, B moves n2, merged both ways ⇒ both docs and both models hold each mover's value; neither reverts. PASS.
8. T8 same-node lock — `canWriteNode=false` for n1 on B ⇒ B's capture dropped (zero origin updates, doc unchanged); after A propagates, B's model reconciles to A's value. PASS.
9. T9 add/remove — remote add + remote delete reflect in follower; local delete removes id from doc; local upsert for the remotely-deleted id does **not** resurrect it. PASS.
10. T10 minimal diff — capturing a record identical to the doc record ⇒ **zero** origin updates. PASS (I3 at capture boundary).
11. Suite green — `npx vitest run` = 24 files / **453 tests** (440 baseline + 13 new), zero failures, no existing test file modified. PASS.

## ACs Not Satisfied

- None.

## Files Changed

- `plugin/src/__tests__/canvas-binding.test.ts`: the `describe("CanvasBinding contract T1–T10 (WP3)")` block with all 10 cases, built on the WP2 fake + harness. (Same file created under WP2.)

## Quality Gates

- `npx tsc -noEmit -skipLibCheck`: PASS
- `npx biome check src/canvas/canvas-binding.ts src/__tests__/canvas-binding.test.ts`: PASS (clean)
- `npx vitest run`: PASS — 24 files / 453 tests, all green (baseline 23 files / 440 preserved)

## Risk Notes

- Grounding DEGRADED — RepoMap fallback (graphify disabled).
- **T9 no-resurrect representation:** the "remote-delete condition" is modelled by flipping `canWriteNode` to return `false` for the deleted id — faithful to SPEC_01 §7 ("dropping a capture upsert for an id the doc no longer holds *when a lock says it was remotely deleted*"). The binding interface carries no independent remote-deletion memory, so the lock predicate is the intended and spec-sanctioned signal. If a later phase wants lock-independent no-resurrect, that is a new requirement, not a Phase-0 gap.
- T6 uses `i * 3` geometry values; convergence + zero-push asserted on the final value only (intermediate values are transient CRDT states, correctly not re-pushed).
- Repo-wide `npx biome check .` reports 93 pre-existing errors on OTHER (already working-tree-modified) files — see HANDOVER Risk Notes. None involve the two new files.
