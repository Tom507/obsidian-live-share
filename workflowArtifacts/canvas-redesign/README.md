# Canvas Sync Redesign — Spec Set

> Design specs for rebuilding canvas multiplayer on a **CRDT-as-source-of-truth**
> foundation. These are specifications only — no code is implemented from them yet.
> Approval gate: review + sign-off before Phase 0 coding starts.

## Why

The current canvas sync bridges the CRDT through the `.canvas` file, giving the
open document **two writers** (our disk writer + Obsidian's `requestSave`). That
two-writer race is the root of every canvas multiplayer bug and cannot be closed
by patching. Full rationale, the v0.5.4–0.5.9 fix chronicle, the "guest stable /
host scatters" analysis, and the race-coverage matrix live in the parent doc:

- **`../CANVAS_SYNC_REDESIGN.md`** — architecture rationale & decision record.

The target mirrors the text-collab contract already proven in this repo
(`yCollab` binds the CRDT directly to CodeMirror; the file is a projection). We
build the canvas analog — a **"y-canvas" binding**.

## The specs

| # | Spec | Scope |
|---|---|---|
| 01 | [`SPEC_01_CanvasBinding.md`](SPEC_01_CanvasBinding.md) | The y-canvas binding: the CRDT↔model core. Interfaces, invariants, apply/capture algorithms, reentrancy + minimal-diff safeties, concurrency model, test contract. **The heart of the redesign.** |
| 02 | [`SPEC_02_CanvasModelBridge.md`](SPEC_02_CanvasModelBridge.md) | The adapter-side contract: how Obsidian's private Canvas API implements `CanvasModelBridge`. Critically: sourcing the **capture signal from user-interaction events, not the async `requestSave`**; the remote mutators; availability/degradation. |
| 03 | [`SPEC_03_Persistence.md`](SPEC_03_Persistence.md) | The `.canvas` file demoted to **write-only persistence**: debounced CRDT→file writer, cold-open load path, single-owner file semantics while open, crash safety. |
| 04 | [`SPEC_04_Phasing_Acceptance.md`](SPEC_04_Phasing_Acceptance.md) | Phased rollout 0–5, per-phase acceptance criteria, the "text sync stays green" gates, and the headless convergence harness that locks the contract. |

## Reading order

1. Parent rationale (`../CANVAS_SYNC_REDESIGN.md`) — *why*.
2. Spec 01 — *the contract*.
3. Specs 02 + 03 — *the two edges of the binding* (live model, persisted file).
4. Spec 04 — *how we get there without breaking text sync*.

## Status

| Item | State |
|---|---|
| Architecture rationale | ✅ written |
| Spec 01–04 | ✅ written (this set) |
| Sign-off | ⏳ pending user review |
| Phase 0 code | ⛔ not started (specs-first) |

## Non-goals (explicit)

- Dual-document sync (a canvas `file` node ↔ its linked `.md`) — two separate Y
  docs; **out of scope for v1**, documented as a known limitation.
- Cursor-coordinate inversion (B5) — an independent transform bug, fixed
  separately; unaffected by this redesign.
- Server/relay changes — none. The binding reuses the existing `SyncManager`,
  per-file Y.Doc, and awareness channel unchanged.
