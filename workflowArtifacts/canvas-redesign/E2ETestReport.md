# E2E Test Report — CanvasBinding (obsidian-live-share canvas-sync redesign, Phase 0)

W4 run: 2026-07-20
Status: **VALIDATION_PASS**

Scope: headless CRDT⇄model binding (SPEC_01), gated on SPEC_04 §1. No browser/UI surface exists in Phase 0 — **no browser surface: browser E2E not applicable**. The vitest two-peer harness (T1–T10) is the full E2E coverage; each US AC is mapped to its T-case below.

---

## Quality Gates (run from `plugin/`)

| Gate | Command | Result |
|---|---|---|
| Tests | `npx vitest run` | **PASS** — 24 files / **453 tests**, 0 failures |
| Baseline preservation | vs 440/23 | **PASS** — 440 preserved + 13 new (453/24); zero regressions |
| New test file present | `canvas-binding.test.ts` | **PASS** — 13 tests (T1–T10 + 3 WP2 smoke), all green in isolation |
| Typecheck | `npx tsc -noEmit -skipLibCheck` | **PASS** — exit 0, no errors |
| Lint (new files) | `npx biome check src/canvas/canvas-binding.ts src/__tests__/canvas-binding.test.ts` | **PASS** — 2 files checked, 0 errors/warnings |
| Headless constraint (I6) | `grep obsidian src/canvas/canvas-binding.ts` | **PASS** — only `import * as Y from "yjs"`; no obsidian import |

**Scope-of-change verification.** The two Phase-0 deliverables — `plugin/src/canvas/canvas-binding.ts` and `plugin/src/__tests__/canvas-binding.test.ts` — are untracked/new. Both are lint-clean and contribute **zero** new biome errors. The repo-wide `biome check .` debt (~93 pre-existing errors) sits entirely on files this run never authored (`canvas-adapter.ts`, `canvas-presence.ts`, `main.ts`, `canvas-sync.ts`, several `__tests__/*`), all carrying prior-round uncommitted working-tree changes. Per BUILD_SPEC §7 and the W4 instruction, that debt is OUT OF SCOPE and is not a CRITICAL/HIGH issue for Phase 0. The binding imports only `yjs` and re-implements `recordsEqual`/`writeRecordMinimal` locally, so the uncommitted `canvas-sync.ts` changes do not affect it — the `nodes`/`edges` map-of-maps doc shape is self-contained in the binding (HANDOVER DEGRADED-grounding probe resolved).

---

## Test Level Results

### Smoke Tests (enabled)

One happy-path smoke per user story — all PASS:

| US | Smoke | Result |
|---|---|---|
| US1 (binding contract) | T1 seed brings empty model up to populated doc; T2 single capture reflects in doc | PASS |
| US2 (fake bridge + harness) | 3 WP2 scaffolding cases: fake 9-member + copy/null semantics, working unsubscribe, non-local (`tr.local === false`) harness integration | PASS |
| US3 (T1–T10 contract) | Full suite `npx vitest run` green (453) | PASS |

### Integration Tests (enabled)

Cross-component surfaces (binding ⇄ fake bridge ⇄ two-peer Yjs harness), incl. RISKY-flagged probes:

| Integration surface | Case | AC | Result |
|---|---|---|---|
| Remote delta → model (CRDT→model apply) | T3 | US3 AC3 | PASS |
| Adversarial re-emit during apply (I2 sync echo) | T4 | US3 AC4 | PASS |
| Async echo after apply (I3 empty-diff drop, fake timers) | T5 | US3 AC5 | PASS |
| Streamed 50-delta convergence, zero re-push (RISKY: "guest stable / host scatters") | T6 | US3 AC6 | PASS |
| Concurrent two-way merge (both movers survive) | T7 | US3 AC7 | PASS |
| Injected `canWriteNode` lock seam → capture dropped + reconcile | T8 | US3 AC8 | PASS |
| Add/remove + lock-gated no-resurrect | T9 | US3 AC9 | PASS |
| Minimal-diff at capture boundary | T2 / T10 | US3 AC2/AC10 | PASS |

### Full E2E Tests (enabled — headless two-peer convergence)

Each US3 AC (T1–T10) verified as a real, passing, non-tautological test (bodies read; no `.skip/.todo/.only`):

| T | Behavior | US AC | Genuine-assertion check | Result |
|---|---|---|---|---|
| T1 | seed empty model → populated doc; id sets + every record equal doc | US3 AC1 (US1 AC11) | asserts full id-set + per-record equality vs `nodeRecord(doc,…)` | PASS |
| T2 | one node move ⇒ exactly one origin update carrying only changed key | US3 AC2 (US1 AC5) | asserts `count()===1` AND `changedKeys===["x"]` via observeDeep | PASS |
| T3 | remote move drives follower via `applyNodeUpsert` | US3 AC3 (US1 AC3) | spy asserts `applyNodeUpsert("n1",{x:50})` + model state | PASS |
| T4 | sync re-emit during apply ⇒ zero origin updates | US3 AC4 (US1 AC4, I2) | fake re-emits inside apply; asserts `count()===0` | PASS |
| T5 | timer-fired re-emit after apply ⇒ zero (empty diff) | US3 AC5 (I3) | `vi.useFakeTimers` + `advanceTimersByTime`; asserts `count()===0` | PASS |
| T6 | 50 sequential deltas converge, zero re-push | US3 AC6 | asserts follower `x===150` AND `count()===0` across stream | PASS |
| T7 | concurrent different nodes; neither reverts | US3 AC7 | encodes both before applying (true concurrency); asserts both docs + both models hold mover values | PASS |
| T8 | `canWriteNode=false` ⇒ capture dropped + reconcile to peer | US3 AC8 (US1 AC12) | asserts `counterB===0` + doc unchanged, then reconcile to A's x=55 | PASS |
| T9 | add/remove + no-resurrect of remotely-deleted id | US3 AC9 | asserts remote add/delete reflect, local delete removes, locked upsert does not re-add n1 | PASS |
| T10 | identical record ⇒ zero origin updates | US3 AC10 (I3) | asserts `count()===0` on exact-record capture | PASS |

**Invariant-integrity confirmation (critical).** The fake `FakeCanvasModel` re-emits `onLocalChange` on **every** state-changing mutator, including the remote→model appliers (`applyNodeUpsert`/`applyNodeRemove`/`applyEdgeUpsert`/`applyEdgeRemove`, lines 43–56). This means T4/T5/T6 are **not** false-green: the echo path is genuinely driven during and after `applyRemote`, and the guards (`applyingRemote` I2 sync; empty-diff drop I3 async; `CANVAS_BINDING_ORIGIN` isolation I4) are what force the zero counts. The `countOriginUpdates` counter filters strictly to `CANVAS_BINDING_ORIGIN`, so remote-integration updates are never miscounted as echoes.

**HANDOVER risk items probed:**
- Busy-handling (US1 AC8) — not implemented; correctly deferred to SPEC_02 per the frozen 9-member interface and AC8's own permission. Not a Phase-0 defect.
- T9 no-resurrect is lock-gated (via `canWriteNode` flag), matching SPEC_01 §7 wording. Lock-independent no-resurrect would be a new spec requirement, not a bug.
- `writeRecordMinimal` omits the `GEOMETRY_KEYS` delete-guard by design (no file I/O, always complete records). Consistent with SPEC_01 §6.2; T-cases pass under this behavior.

---

## Issues Found

| Severity | WP | US | Description | AC | Suggested Fix |
|---|---|---|---|---|---|
| CRITICAL | — | — | None | — | — |
| HIGH | — | — | None | — | — |
| LOW | — | US2 | Pre-existing repo-wide biome debt (~93 errors) on untouched prior-round files. Explicitly out of Phase-0 scope; not a regression and not introduced by the two new files. | — | Address in a dedicated lint-cleanup run; do NOT mass-reformat during Phase 0. |

---

## Fix Requests

None — no CRITICAL or HIGH issues. `VALIDATION_PASS`.

---

## Verdict

All enabled test levels (smoke, integration, full-E2E-headless) PASS. Quality gates green: vitest 453/453 (baseline 440 preserved, +13 new), tsc clean, new-file lint clean, headless constraint satisfied, no production file modified by this run. T1–T10 are genuine, non-tautological, and exercise invariants I1–I6 through an adversarial re-emit fake. **SPEC_04 §1 Phase-0 acceptance gate satisfied.**

**Status: VALIDATION_PASS**
