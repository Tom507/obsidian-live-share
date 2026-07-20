# Implementation Report — WP1 — CanvasBinding core (types + class + invariants + algorithms)
Date: 2026-07-20
Status: DONE

## ACs Satisfied

1. Exact §6 surface exported (`CanvasRecord`, `LocalChange`, `CanvasModelBridge` 9 members, `CANVAS_BINDING_ORIGIN` `unique symbol`, `CanvasBinding` class with readonly `applyingRemote` + `destroy()`, optional `CanvasBindingLogger`) — verified via `npx tsc -noEmit -skipLibCheck` (PASS) and consumption by the WP3 tests.
2. Reads/writes only `nodes`/`edges` map-of-maps; no other top-level keys — verified by code (`doc.getMap("nodes")` / `doc.getMap("edges")` only) and by T1/T2/T7 doc-shape assertions.
3. I2 reentrancy: `_applyingRemote` set true at `applyRemote` entry, reset in `finally`; `captureLocal` returns early while true — verified by T4 (zero origin updates during synchronous re-emit).
4. I3 minimal diff: `writeRecordMinimal` sets only differing keys, deletes keys absent from `next`, returns changed-flag; identical record ⇒ empty transaction ⇒ no update — verified by T5/T10.
5. I4 origin isolation: every write via `doc.transact(fn, CANVAS_BINDING_ORIGIN)`; observer returns early on `tr.local || tr.origin === CANVAS_BINDING_ORIGIN`, else `applyRemote()` — verified by T2 (exactly one origin update) and T3/T4 (remote deltas drive apply).
6. §6.1 targeted reconcile: nodes upserted before edges; only differing/absent entities touched; model-only ids removed — verified by T1 (seed), T3, T9 (remove).
7. §6.2 capture: single origin-stamped transaction; `record === null` deletes when present; else get-or-create ymap + `writeRecordMinimal` — verified by T2, T9, T10.
8. Lifecycle: observer + `onLocalChange` wired on construct; one `applyRemote` when `seedModelFromDoc !== false`; `destroy()` unobserves/unsubscribes and sets `destroyed` guard — verified by T1 (seed on construct) and destroy calls across all cases.
9. `canWrite`/`canWriteNode`/`canDeleteNode` consulted in `captureLocal`; false ⇒ drop with no transaction; absent ⇒ allow — verified by T8 (`canWriteNode=false` drop) and T9 (no-resurrect gate).
10. I6: imports only `yjs` (`import * as Y from "yjs"`); no Obsidian import, no `.canvas` I/O, no new dependency — verified by import line and `package.json` (unchanged).

## ACs Not Satisfied

- §6.1 busy handling (US1 AC8): NOT implemented. The frozen 9-member `CanvasModelBridge` interface exposes no busy/interacting signal, so mid-drag deferral is a bridge-level concern explicitly deferred to SPEC_02 (as US1 AC8 itself permits). No scope invented. Flagged in Risk Notes.

## Files Changed

- `plugin/src/canvas/canvas-binding.ts`: CREATED. Types, `CANVAS_BINDING_ORIGIN`, local `recordsEqual`/`ymapToRecord`/`writeRecordMinimal`, and the `CanvasBinding` class (observer demux, `applyRemote`, `captureLocal`, lifecycle, `applyingRemote` guard, §8 seams). Each guard doc-commented with its invariant ID (I1–I6).

## Quality Gates

- `npx tsc -noEmit -skipLibCheck`: PASS
- `npx biome check src/canvas/canvas-binding.ts`: PASS (clean, zero errors/warnings)
- `npx vitest run`: PASS (contributes via WP3; 453 total)

## Risk Notes

- Grounding is DEGRADED — RepoMap fallback (graphify disabled per BUILD_SPEC §3); structural targets taken from `../RepoMap.md` line refs against HEAD, not a graph.
- `writeRecordMinimal` deliberately does NOT carry the `canvas-sync.ts` GEOMETRY_KEYS deletion-guard. Rationale: the guard exists solely for partial `.canvas` disk reads; the binding's `next` is always a complete model record (no file I/O, I6), matching SPEC_01 §6.2's exact "delete keys absent from next" wording with no exception. Documented in-code.
- Busy handling deferred (see AC not satisfied) — safe for Phase 0 (headless, no live drag), must be revisited when the real adapter-backed bridge lands (SPEC_02).
