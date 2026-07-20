# Implementation Report — WP2 — Fake bridge + two-peer harness
Date: 2026-07-20
Status: DONE

## ACs Satisfied

1. Fake implements all 9 `CanvasModelBridge` members with in-memory `Map`s; `getNode`/`getEdge` return a copy (`{ ...r }`) or `null` — verified by WP2 smoke test "fake implements all 9 members".
2. Every state-changing mutator (`applyNode*`/`applyEdge*` remote-appliers AND `userSet*`/`userRemove*` helpers) re-emits `onLocalChange` with the corresponding `LocalChange` — the adversarial "can't-tell-who-moved-it" hazard — verified by T4/T5 (guards must absorb the re-emits) and T2 (user helper drives capture).
3. `onLocalChange` returns a working unsubscribe — verified by WP2 smoke test "onLocalChange returns a working unsubscribe".
4. `applyRemoteCanvasDelta` mirrors `canvas-sync.test.ts` L62-74: syncs replica from source, mutates, integrates back as `tr.local === false`, destroys replica; deletes reference the synced item — verified by WP2 smoke test "harness integrates as a non-local transaction" and by T9 delete/no-resurrect.
5. `countOriginUpdates` isolates `CANVAS_BINDING_ORIGIN` updates (filters the `doc.on("update")` origin) — verified by T4/T5/T6/T10 zero-count assertions.
6. Fake-timer support available — verified by T5 (`vi.useFakeTimers()` / `vi.advanceTimersByTime`); no real `setTimeout` waits or wall-clock constants anywhere.
7. Fake + harness live inline in `canvas-binding.test.ts`, importing only `yjs` and the binding module — verified by the import block (no Obsidian import).

## ACs Not Satisfied

- None.

## Files Changed

- `plugin/src/__tests__/canvas-binding.test.ts`: CREATED (scaffolding portion — `FakeCanvasModel`, `applyRemoteCanvasDelta`, `remoteNode`, `seedDoc`, `countOriginUpdates`, `nodeRecord`, `afterEach` cleanup + 3 WP2 smoke cases). The T1–T10 cases live in the same file (WP3).

## Quality Gates

- `npx tsc -noEmit -skipLibCheck`: PASS
- `npx biome check src/__tests__/canvas-binding.test.ts`: PASS (clean)
- `npx vitest run src/__tests__/canvas-binding.test.ts`: PASS (13 tests)

## Risk Notes

- Grounding DEGRADED — RepoMap fallback (graphify disabled). Harness mirrors the RepoMap-cited `applyRemoteCanvasDelta`/`remoteNode` pattern; the referenced production `canvas-sync.ts` helpers were read-only references and NOT imported.
- `userSetEdge`/`userRemoveEdge` helpers are provided for completeness of the bridge surface but are not exercised by T1–T10 (node-focused contract) — harmless, keeps the fake symmetric for future edge-centric cases.
