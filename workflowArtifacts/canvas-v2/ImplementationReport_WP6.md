# Implementation Report — WP6

Attempt: 1

## Status: DONE

WP6's deliverable **is** the test suite; there is no production change. Both P0 chaos
scenarios exist as named, deterministic suites under `plugin/src/__tests__/v2/wp6/`,
each with a discrimination variant that is part of the suite (an automated test that
asserts the bad outcome occurs when the seam is switched off), and both are collected
by the default `npm test` run.

---

## Completed Work

### AC1 — "view apply artificially delayed + Obsidian save" reproduces the cascade and passes under V2

`plugin/src/__tests__/v2/wp6/chaos_cascade.test.ts`

The delay is **structural, never temporal**. The production hook `CanvasSync.setOnRemoteCanvasUpdate(...)`
— the callback `main.ts` reconciles the live view from — is wired to a **pending queue**
instead of running the pass inline. The scenario then chooses *when* that queue is drained
relative to `handleLocalModify`. Nothing sleeps, nothing polls, no duration is named
anywhere in the file.

Three peers: peer 1 owns a real `CanvasSync`, a real `createCanvasAdapter` over the
contract-faithful `CanvasDouble`, and an open canvas view; peers 2 and 3 are plain Yjs
replicas, so a revert is visible as a value two independent replicas never asked for.

| Test | What it establishes |
|---|---|
| T1 | The delayed pass runs AFTER the save: the peer's `n1.x = 500` survives on all three docs and the user's own drag (`n3.y = 40`) still propagates. |
| T2 | The delayed pass then lands; the view snaps to shared truth, the receipt moves the capture basis, and the next save of the settled view emits **zero** CRDT writes (state-vector fingerprint unchanged) — the cascade cannot take a second step. |
| T3 | Three-way interleaving: peer 2 moves `n1`, peer 3 renames `n2`, peer 1 saves its delayed view with a change of its own. All three converge with nothing reverted. |
| T4 | The delayed pass runs BEFORE the save but its reload never lands (`canvas.setData` gone, I5 degrade path): the capture basis stays at `0`, so still no revert. An attempted apply is not a receipt. |
| T5 | AC4 determinism — two independent runs produce identical readings and byte-identical canonical CRDT content; plus a source scan of the file itself for wall-clock calls. |

### AC2 — "adapter unavailable + open view + remote deltas" leaks nothing

`plugin/src/__tests__/v2/wp6/chaos_degraded_adapter.test.ts`

Two shapes of degradation, because they fail differently: `"unavailable"`
(`createCanvasAdapter({})` — `isAvailable()` false, no receipt is ever built) and
`"reload-broken"` (adapter available, `canvas.setData` gone — the pass RUNS and does not
land, which is the shape the per-field receipt must notice). The canvas view is open the
whole time, so `noteExternalDiskWrite` deliberately advances no shadow field.

| Test | What it establishes |
|---|---|
| T1 | Every triggered pass really returned `deferred` (fixture honesty), and the degraded client's save carries neither the stale `x` nor the stale `text` to peers 2 and 3, while its own genuine drag does reach both. |
| T2 | A card peer 3 created while this client was degraded (`n4`) — which the open view never received — is NOT deleted by the view's save that omits it. Absence without a hand-over receipt is ignorance, not deletion. |
| T3 | Same property in the `"reload-broken"` shape: every pass genuinely ran (`structural`), the basis stayed at `0`, nothing leaked. |
| T4 | Three rounds of remote deltas + local saves never accumulate into a revert; all three peers end on the last peer value plus the last local drag. |
| T5 | Recovery: once the private surface reappears the pass lands, the view receives `n1` and the never-seen `n4`, the shadow advances, and the next save of the settled view emits zero CRDT writes. Deferral is a deferral, not a permanent hole. |
| T6 | AC4 determinism for both degradation shapes + the wall-clock source scan. |

### AC3 — each scenario has an automated discrimination variant

Four variants, two per scenario, in a dedicated `describe` block per file. Each one runs
the SAME scenario with the mechanism disabled through its injected seam, asserts the bad
outcome, and then compares the two runs DIRECTLY (`expect(on.x).not.toBe(off.x)`) so a
future change that quietly neutralises a seam breaks a test instead of leaving two
independently-green cases. See the table further down.

### AC4 — determinism

No wall-clock sleep, no `setTimeout` wait, no timing constant, no `Date.now`, no
`Math.random`, no `advanceTimersByTime` anywhere in either file. Fixtures are fixed
literals (`n1`–`n4`), so there is no seed to fix — and each file proves that about itself
twice over: a repeat-run equality test on both the readings and the canonical CRDT bytes,
plus a source scan of its own text (secondary oracle only; the primary oracle is state).

The only timer touched at all is `vi.runOnlyPendingTimersAsync()`, which drains the settle
window the production code itself opened (`noteExternalDiskWrite`) and names no duration.
It is required: without it `recentDiskWrites` still holds the path and `handleLocalModify`
returns before the scenario begins.

---

## Blocked Items

None. No `SPEC_CONTRADICTION` and no `TOOL_REQUEST` — both scenarios were buildable
against the existing seams with zero production changes.

---

## Tools Created

None. Zero new dependencies; the existing harnesses (`harness/canvas-double.ts`,
`harness/interaction-driver.ts`) and the WP1–WP5 module APIs were sufficient.
`harness/two-peer.ts` was deliberately NOT used: every claim here is a convergence claim
and needs three replicas, so the peers are plain `Y.Doc`s replicated with explicit
one-way `Y.applyUpdate(..., "peer")` pushes — the same pattern the WP4 suites use.

---

## Changes Made

| File | Change |
|---|---|
| `plugin/src/__tests__/v2/wp6/chaos_cascade.test.ts` | NEW — scenario I.a + 2 discrimination variants (7 tests) |
| `plugin/src/__tests__/v2/wp6/chaos_degraded_adapter.test.ts` | NEW — scenario I.b + 2 discrimination variants (8 tests) |

No production source touched. No existing test touched, deleted, skipped or weakened.
No `.only`. `plugin/manifest.json` not read or edited. Version not bumped. `plugin/main.js`
not edited (and `npm run build` deliberately NOT run, since it regenerates that artifact
and this WP is test-only; `npx tsc -noEmit -skipLibCheck` is clean, which is the compile
half of that script).

Both new files were formatted with `npx biome check --write src/__tests__/v2/wp6` — scoped
to the two new files only, no mass-reformat of anything pre-existing.

---

## Scenarios and Their Discrimination Variants

| Scenario | What it proves | Which seam its variant disables | What the variant asserts |
|---|---|---|---|
| I.a delayed view apply + Obsidian save (`chaos_cascade.test.ts`, T1–T3) | A save from a view whose apply has not run yet produces no outbound delta for the stale field; the genuine local edit still propagates; three peers converge with nothing reverted | **D1** `cs.setShadowRebaseEnabled(false)` | The same fixture reverts the peer: `n1.x` becomes `0` locally **and on peers 2 and 3**, the stale `text` is pushed back too, and both readings differ from the enabled run |
| I.a with the delayed apply landing before the save but failing (`chaos_cascade.test.ts`, T4) | An attempted-but-unlanded reload does not move the capture basis, so the still-stale view's save is classified as staleness | **D2** `advanceFromReceipt(..., { perFieldReceipt: false })` | V1 record-snapshot semantics mark the unapplied reload as applied (basis at save time becomes `500`), the stale view then reads as intent, and both peers are reverted to `0` |
| I.b adapter unavailable + open view + remote deltas (`chaos_degraded_adapter.test.ts`, T1–T2) | A degraded client leaks neither stale geometry nor stale text into shared state, and deletes nothing it never received | **D1** `cs.setShadowRebaseEnabled(false)` | The open view leaks into both peers: `n1.x → 0`, `n1.text → "contested"`, both differing from the enabled run |
| I.b in the `reload-broken` degradation (`chaos_degraded_adapter.test.ts`, T3) | A pass that runs but cannot land advances nothing and hands nothing over | **D2** `advanceFromReceipt(..., { perFieldReceipt: false })` | Both halves of the V1 defect fire at once: the basis jumps to `500` and the peers are reverted to `0`, **and** the bogus hand-over unlocks the delete rule so the degraded view's save removes `n4`, a card it never received |

---

## Visible Test Results

`npx vitest run src/__tests__/v2/wp6` (Vitest 4.0.18, from `plugin/`):

```
Test Files  2 passed (2)
     Tests  15 passed (15)
  Duration  ~0.5 s
```

| Suite | Tests | Result |
|---|---|---|
| `chaos_cascade.test.ts` — WP6 AC1 (T1–T5) | 5 | PASS |
| `chaos_cascade.test.ts` — WP6 AC3 discrimination (D1, D2) | 2 | PASS (each asserts the bad outcome with the seam off) |
| `chaos_degraded_adapter.test.ts` — WP6 AC2 (T1–T6) | 6 | PASS |
| `chaos_degraded_adapter.test.ts` — WP6 AC3 discrimination (D1, D2) | 2 | PASS (each asserts the bad outcome with the seam off) |

---

## Regression Results

| Command | Result | New failures vs the known 3? |
|---|---|---|
| `npx vitest run src/__tests__/v2/wp6` | 2 files / 15 tests, all pass | no |
| `npx vitest run "src/__tests__/v2/"` (WP1–WP6) | 38 files / 209 tests, **0 failures** | no |
| `npm test` (full suite) | 152 files / 1289 tests → **4 failures** | **no** — 3 are the known `A4`, `A9`, `A10` in `src/__tests__/w4-canvas-integrity.test.ts`; the 4th is in `src/__tests__/v2blind/wp5v2/test_tp01_single_shadow_blind2.test.ts`, an **untracked directory owned by a concurrent team** that WP6 never touched or imported (see note below) |
| `npx tsc -noEmit -skipLibCheck` | clean, no output | no |
| `npx biome check src/__tests__/v2/wp6` | clean after the scoped format | no |

**Note on the 4th failure.** `plugin/src/__tests__/v2blind/` is untracked in git and is not
part of WP6's scope; the failing case is
`WP5 AC1 (blind2) — the capture path distinguishes the confirmed record from the other two`
(`expected '8' to be '2'`). WP6 added only two new files that nothing imports, and Vitest
isolates test files, so this failure cannot be caused by WP6. It was **not** fixed or
touched (that suite belongs to another role). Flagging it for Worker 3 / Worker 4 as an
additional pre-existing failure alongside the known three — it looks like the same
"unconfirmed vs confirmed record" question as WP5's per-field receipt, so it may be a real
blind-validation finding against WP5 rather than a fixture bug.

A caution about the glob: `npx vitest run src/__tests__/v2` (no trailing slash) also matches
`v2blind/` by substring. Use `"src/__tests__/v2/"` with the trailing slash for the WP1–WP6
set.

---

## Summary for Worker 3

- **WP6 is DONE.** Two named, deterministic chaos suites live at
  `plugin/src/__tests__/v2/wp6/`, collected by the default `npm test`, 15 tests, all green.
- **Zero production changes.** Neither scenario needed one; no ESCALATE and no
  `SPEC_CONTRADICTION`.
- **The discrimination variants are tests, not procedures.** Four of them, both seams used
  (`setShadowRebaseEnabled(false)` and `advanceFromReceipt(..., { perFieldReceipt: false })`),
  each asserting the bad outcome AND comparing directly against the enabled run so a seam
  that is quietly neutralised later breaks a test.
- **The "artificial delay" is a queue, not a clock.** The production hook
  `setOnRemoteCanvasUpdate` is wired to a pending list and drained on either side of
  `handleLocalModify`; both orderings are real production interleavings.
- **Regression status: no new failures.** The 3 known `w4-canvas-integrity` failures are
  untouched. One **additional pre-existing** failure exists in the untracked
  `src/__tests__/v2blind/` directory (another team's) — WP6 did not cause it and did not
  touch it, but Worker 3 should route it, because it reads like a genuine WP5 finding.
- **Reusable detail for later chaos WPs (WP35):** after applying a remote delta in a
  fixture, always simulate `CanvasPersistence`'s flush —
  `vault.files.set(path, serializeCanvas(...))` + `cs.noteExternalDiskWrite(path, thatContent)`
  + drain pending timers — *before* the view's save, or WP4's byte echo breaker
  short-circuits `handleLocalModify` and the scenario tests nothing. The extra step past the
  documented trap is the timer drain: without it `recentDiskWrites` still holds the path and
  `handleLocalModify` returns at its very first line.
- **Second reusable detail:** to exercise a *structural* reconcile pass (the only branch
  whose apply can fail to land, and therefore the only one where the per-field receipt seam
  is observable), the remote delta must touch a NON-geometry field. A delta touching only
  `x/y/width/height` classifies as `geometry`, whose per-node path ignores `canvas.setData`
  entirely.
