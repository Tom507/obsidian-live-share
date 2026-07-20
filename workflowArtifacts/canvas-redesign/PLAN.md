# Plan: Canvas Sync Redesign — "y-canvas" Binding
Generated: 2026-07-20
Task: Build the canvas-sync CRDT redesign per the approved spec set (canvas-redesign/README + SPEC_01–04). This run implements **Phase 0** (the locked-contract foundation); Phases 1–5 are scaffolded here but are human-gated (real-vault spike + manual two-vault E2E).

> **Artifact home:** This run's artifacts live under `workflowArtifacts/canvas-redesign/`
> to avoid clobbering the prior round's artifacts in `workflowArtifacts/` root
> (PLAN, BUILD_SPEC_ObsidianLiveShare, USER_STORIES, reports — the latency/presence/
> locking round, 2026-07-17). Exception: `../RepoMap.md` (repo-wide structural map).

## Approval basis

User directive: "consider this an approved plan." The spec set under
`workflowArtifacts/canvas-redesign/` (README + SPEC_01 CanvasBinding, SPEC_02
CanvasModelBridge, SPEC_03 Persistence, SPEC_04 Phasing/Acceptance) plus the
rationale `workflowArtifacts/CANVAS_SYNC_REDESIGN.md` **is** the approved plan.
Phase 1 pair-planning approval gate is therefore satisfied without further dialogue.

## Run scope (this orchestration pass)

**In scope — Phase 0 only (SPEC_04 §1):**
- `CanvasBinding` (SPEC_01) — the CRDT↔model core: `applyRemote`, `captureLocal`,
  observer demux, `applyingRemote` reentrancy guard, minimal-diff capture, origin
  isolation, lifecycle (construct/seed/destroy).
- A fake in-memory `CanvasModelBridge` that deliberately re-emits `onLocalChange`
  on every mutation (models Obsidian's "can't-tell-who-moved-it" hazard).
- A two-peer headless harness (two `Y.Doc`s wired via `encodeStateAsUpdate`/
  `applyUpdate`, mirroring the existing `canvas-sync.test.ts` pattern).
- Tests **T1–T10** (SPEC_01 §10) green, in the existing vitest suite.
- **No `main.ts` wiring, no adapter changes, nothing shipped.**

**Out of scope this run — human-gated, deferred (SPEC_04 §2–6):**
- Phase 1 Persistence split (SPEC_03) — headless-testable but touches production
  `canvas-sync.ts` wiring; defer to a follow-up run under user review.
- Phases 2–5 — require the **Phase-0 private-API spike** (SPEC_02 §9) in a real
  vault and **manual two-vault E2E that only the user can run** ("no GUI
  automation"), plus the scp ship gate. Not autonomously completable.

## Tech / Approach Decisions

- **Language/stack:** TypeScript, yjs (already a dependency), vitest suite. No new
  runtime deps — the binding uses only `yjs`.
- **Single source of truth:** the Y.Doc; the model is a pure projection. Enforced by
  invariants I1–I6 (SPEC_01 §5).
- **Reentrancy over timing:** `applyingRemote` boolean guard (I2) + minimal-diff
  no-op capture (I3) kill sync + async echo respectively — no mute windows, no
  timing constants.
- **Origin isolation:** binding writes are stamped `CANVAS_BINDING_ORIGIN`; the
  observer ignores `tr.local` and that origin (I4).
- **Wire-compat doc shape:** unchanged `nodes`/`edges` Y.Map-of-Y.Map layout so a
  binding client interoperates with a legacy file-bridge client during migration.
- **Test harness reuse:** mirror the existing `canvas-sync.test.ts` two-peer
  `encodeStateAsUpdate`/`applyUpdate` pattern rather than inventing a new one.

## Constraints

- **Text sync stays green** — the full existing vitest suite (~440 tests) passes
  after the change; `SyncManager`, awareness, relay, and `yCollab` are never touched.
- **Headless only** — Phase 0 adds no plugin wiring and imports no Obsidian runtime.
- **Reuse over duplication** — align record shape + serializer semantics with the
  existing `canvas-sync.ts` helpers (confirmed by W1 RepoMap).
- **No invented paths** — implementers use only paths confirmed by W1 discovery.
- npm rules (CONTEXT.md): no dependency changes needed; if any arise, `npm ci` +
  7-day rule apply.
- **Do not clobber prior-round artifacts** in `workflowArtifacts/` root.

## Discovery Grounding

W1 discovery (RepoMap, graphify disabled) → `../RepoMap.md`, pinning: the
`nodes`/`edges` Y.Doc record shape, the `applyRemoteCanvasDelta` two-peer test
pattern, `buildCanvasData` + any minimal-diff helpers, the `CanvasAdapter` surface
(for later phases), vitest infra + current test count, and the recommended
`CanvasBinding` file/test paths. W2 consumes `../RepoMap.md` as the structural basis.

## Work Package Sketch

| WP | Title | Scope summary | Depends on |
|---|---|---|---|
| WP1 | CanvasBinding core | Types (`CanvasRecord`, `LocalChange`, `CanvasModelBridge`, `CANVAS_BINDING_ORIGIN`), `CanvasBinding` class: `applyRemote`, `captureLocal`, observer, `writeRecordMinimal`, `recordsEqual`, lifecycle. Invariants I1–I6. | — |
| WP2 | Fake bridge + two-peer harness | In-memory `CanvasModelBridge` that re-emits `onLocalChange` on every mutation; two-`Y.Doc` peer harness mirroring `canvas-sync.test.ts`. | WP1 |
| WP3 | Test contract T1–T10 | Implement SPEC_01 §10 T1–T10 (seed, capture, apply, no-echo sync/async, streamed drag, concurrent nodes, LWW/lock, add/remove, minimal-diff), green in vitest; full suite stays green. | WP1, WP2 |

## Open Questions

- (none blocking) Phase 0 is fully specified by SPEC_01 §4–§10. The `canWrite` /
  `canWriteNode` integration seams (SPEC_01 §8) are exercised in T8 via injected
  predicates; no external wiring needed for the headless contract.
