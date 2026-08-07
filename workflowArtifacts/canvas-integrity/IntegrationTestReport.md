# Integration Test Report — Obsidian Live Share, Canvas Integrity Round

W4 run: 2026-07-26 · Repo: `H:\Developement\_NeuralAngels\liveshareCollab\obsidian-live-share`
Round folder: `workflowArtifacts/canvas-integrity/` · Baseline: W3 `HANDOVER.md`

> **FINAL STATUS (after revalidation cycle 2): VALIDATION_PASS.**
> All six defects found across the round (F1–F6) are fixed and independently re-verified. No new
> defect. Jump to **[Revalidation — Rework Cycle 2 (FINAL)](#revalidation--rework-cycle-2-final)**
> for the verdict and the hand-to-user residual-risk list.
> Everything above that section is the earlier cycle-0 and cycle-1 reporting, **preserved unedited**
> as the audit trail — including statuses that were correct at the time and have since been
> superseded.

---

## Overall Status: FIXES_REQUIRED

One HIGH defect confirmed by execution (US5 AC1 + AC13 exclusivity broken on the `create` and
`rename` paths). Everything else the round shipped held up under independent probing.

## worker4_mode Applied: full

Level 3 was executed as the **two-instance `liveshare-e2e` rig**, not Playwright.

**Browser-Surface Check — decision and basis.** This is an Obsidian (Electron) plugin bundled to a
single `main.js`. There is no HTTP frontend, no SPA routes, no UI framework in `plugin/package.json`
and no `frontend/`/`web/`/`client/` dir. The role file's Level 1 web-app smoke table (login page,
`Set-Cookie`, SPA routing) and Level 3 Playwright journeys are **not applicable**. Playwright was
not installed. The mandated substitute — a real relay plus two real `SyncManager` clients — was run
in full.

---

## Test Level Summary

| Level | Status | Tests Run | PASS | FAIL | Notes |
|---|---|---|---|---|---|
| 1 Smoke | PASS | 621 + 5 gates | 626 | 0 | build exit 0; W3 suite 621/621 across 34 files in 40.62 s; all §7 abort criteria + DoD greps re-run independently |
| 2 Integration Paths | **FAIL** | 24 | 21 | 3 | J1–J3: the single-owner invariant breaks on `create` / `rename` |
| 3 E2E / two-instance rig | PASS | 9 | 9 | 0 | shared room, live convergence, edge endpoints intact, 6/6 matrix, clean shutdown |
| 4 Focused Regression | **FAIL** | 15 | 14 | 1 | J4 blast radius: two disk writers observed |

W4 probe file `plugin/src/__tests__/w4-canvas-integrity.test.ts` — **39 cases, 35 pass, 4 fail**.
The 4 failures are deliberate: they document the confirmed defect and are written to go green once
it is fixed. Full merged suite: **660 tests, 656 pass, 4 fail, 35 files**. W3's 621 all still pass.

---

## Level 1 — Smoke (re-verified independently, not copied from the handover)

```text
├── npm --prefix plugin run build ............... PASS, exit 0
├── npm --prefix plugin test .................... 621 passed / 34 files / 0 failed, 40.62 s
│                                                 (the 33 s case is the deliberate idle-window test)
├── useCanvasBinding default .................... types.ts:65 `useCanvasBinding: false`   UNCHANGED
├── version ..................................... manifest.json 0.6.0, package.json 0.6.0 UNCHANGED
├── focus / visibilitychange / document.hidden .. 0 hits                                  UNCHANGED
├── CanvasPersistence production call site ...... main.ts:24 / :129 / :1210 / :1216       PRESENT
├── scheduleDiskWrite from the canvas observer .. none (canvas-sync.ts:810 is a comment)  RETIRED
├── direct canvasSync.subscribe( in main.ts ..... 0; subscribeCanvasWithHandover( × 2     AS SPECIFIED
└── US6 signatures with a production emitter .... 10 / 10                                 CONFIRMED
```

All ten signatures were located in non-test production code. No abort criterion tripped.

---

## Level 2 — Critical Integration Paths

| Path | Probe | Status |
|---|---|---|
| vault-events routing: one owner per modify event, with a **real** `CanvasSync` | D1–D3 | PASS |
| `CanvasSync` ↔ `CanvasPersistence`: exactly one writer reaches disk | C1, C2 | PASS |
| Mute refcount under overlapping flushes + continuous remote stream, **real `FileOpsManager`** | B1–B4 | PASS |
| `coldOpen` guest semantics (doc-empty now seeds from file) | E1, E2 | PASS |
| `PROTECTED_KEYS` on BOTH delete paths + adversarial cases | A1–A10 | PASS |
| reconcile-plan classification `structural \| geometry \| noop` | F1–F6 | PASS |
| **Single-owner invariant on the `create` / `rename` paths** | **J1–J3** | **FAIL** |

### The Dispatcher's four priority probes

**1. `PROTECTED_KEYS` (D2) — PASS, including the adversarial half.**
Driven through the real `CanvasSync.handleLocalModify`, not through the guards directly.
An edge cannot lose `fromNode`/`toNode` through the `applyToYMap` full-merge branch (A1) or the
`applyKeyDiff` delete branch (A2). Adversarially: a legitimate `fromSide`/`toSide` **change** is
still writable (A3); a genuine optional-key deletion (`color` on a node, `label` on an edge) still
reaches the CRDT (A4); `type` survives both paths (A6); a genuine whole-record delete still works
and still cascades the dangling-edge prune (A7).

These probes were green on first run, so I proved they **discriminate**: `PROTECTED_KEYS` is an
exported mutable `Set`, so A9/A10 disarm the guard in-process (no source file touched) and re-run
the identical scenarios — both then observe the endpoint being lost, and the guard is restored in a
`finally`. Without this, A1/A2 would have been unfalsifiable.

**One behavioural consequence, recorded rather than assumed (A5):** a *genuine* `fromSide` deletion
is now refused — the CRDT keeps the previous side. This is the accepted cost of including
`fromSide`/`toSide`, and it is bounded: Obsidian writes both sides for every edge it creates, so
the case is not reachable through normal editing. Flagged for W2 ratification, not a defect.

**2. `CanvasPersistence` dormant-module risk (R4) — PASS.**
The severe failure mode (a permanently muted path) does not occur. Probed against the **real
`FileOpsManager`** — W3's own tests use a mock counter — asserting the actual production predicate
`isPathMuted(path)`:

- B1: 60 remote deltas at 40 ms with a 120 ms write latency, so flushes genuinely overlap. Final
  `isPathMuted(PATH) === false`. Anti-vacuity guard included: the probe asserts the mute *was*
  taken mid-stream, otherwise the final assertion would be trivially true.
- B2: every `adapter.write` rejects → still unmuted. The error path does not leak.
- B3: `destroy()` while a write is in flight → unmuted immediately, and the in-flight write's
  `finally` does not re-leak after draining.
- B4: after a settled burst the path is unmuted, so a vault `modify` is delivered again.

**3. Single-writer end to end — PASS for the steady state, FAIL on `create`/`rename`.**
C1 puts a real `CanvasSync` and a real `CanvasPersistence` over one `vault.adapter.write` spy: a
remote delta that moves a node *and* re-routes an edge produces **exactly one** disk write, and the
bytes that land keep both endpoints. C2 confirms `noteExternalDiskWrite` opens and closes
`CanvasSync`'s echo window and advances its diff baseline, so the follow-up `handleLocalModify`
logs the echo-breaker no-op instead of replaying the file. The `create`/`rename` failure is
reported separately below.

**4. Untested `main.ts` wiring (D6 items 1+2) — PARTIALLY VERIFIED. Read this honestly.**
`main.ts` extends the Obsidian `Plugin` runtime and is not loadable in the vitest harness; I
confirmed **no test in the repo imports it as a module**. The lightweight e2e host does not load it
either (`plugin/src/testing/e2e-control.ts` imports neither `main.ts` nor `canvas-sync`,
`canvas-persistence` or `vault-events`). So I could not verify the call sites by execution.

What I *could* do, and did (H1–H3): construct the **exact bridge object literal** `main.ts:1245-1248`
passes, hand it to a real `createCanvasAdapter`, and prove a real `DebugLogger` receives
`ADAPTER PATCH:` (with per-method outcomes) and exactly one `DRAG WATCHDOG:` warn per latch; and
confirm `SyncManager.setLogger` accepts the concrete `DebugLogger` at runtime.

- **Closed:** "the `log` vs `debug` name bridge is wrong and silently swallows the signatures."
- **NOT closed:** "`main.ts` actually executes those two statements." That is **UNVERIFIED BY
  EXECUTION** and stays a residual risk requiring manual observation in a real vault. I am not
  dressing a code-reading up as runtime verification — the statements are present at `main.ts:341`
  and `main.ts:1240` and compile, and that is all I can attest.

---

## Level 3 — Two-instance live rig

Launched `tools/launch_liveshare_e2e.py` via `visible-console -> run_python` (console `d22596d4`),
per the workspace rule. Not a Bash background job.

| Check | Result |
|---|---|
| Both hosts joined ONE relay room | PASS — `roomId e83484df-…` identical on 39421 and 39422, `connected: true` both |
| `e2e_connect` | PASS |
| `open_canvas("board.canvas")` | PASS — `opened` + `subscribed` true on both |
| 3 nodes + 2 edges created on A, converged to B | PASS |
| Concurrent edge-touching edits (A recolours e1 + drags n1; B recolours e2 + drags n3) | PASS |
| Edge endpoints after convergence | PASS — `e1: n1→n2`, `e2: n2→n3` intact on **both** peers |
| Legitimate side change over the wire (`e2` → `bottom`/`top`) | PASS — landed on both peers |
| `run_matrix` | PASS — 6/6 (`initial-sync`, `multi-edge-move`, `bidirectional-drag`, `add-node-edge`, `delete-node-edge`, `file-node`) |
| Clean shutdown, ports freed | PASS — no listener on 39421/39422, control server unreachable |

`binding_stats` read all-zero on both instances, as `E2E_USAGE.md` documents for the lightweight
host (no real `CanvasBinding` wired).

**Coverage boundary, stated plainly.** This rig exercises `SyncManager` + the real relay + the
shared canvas `Y.Doc`. It does **not** load `CanvasSync`, `CanvasPersistence`, `vault-events` or
`main.ts`. It therefore proves relay-level CRDT convergence and edge-endpoint survival across two
real clients — it does **not** prove the disk single-writer, the mute refcount, the routing, or the
`main.ts` wiring. Those are Level 2's job and are reported there.

Shutdown used `close_console` (the supervisor-kill path `E2E_USAGE.md` documents as equivalent),
not a literal keyboard Ctrl-C.

---

## Failures

### F1–F4 — the single-owner invariant breaks on the `create` and `rename` paths

**Severity: HIGH.** Full detail, reproduction and recommended fix shape:
`workflowArtifacts/canvas-integrity/Worker4FixRequest_WP6.md`.

The `.canvas` skip WP6 added exists **only in `BackgroundSync.startAll`**. `onFileAdded` and
`onFileRenamed` have no equivalent guard, and `vault-events.ts` calls both for any `isTextFile`
path — and `"canvas"` is in `TEXT_EXTENSIONS`.

- **J1** — `create` of a `.canvas` on the host builds a raw `Y.Text` doc for it.
- **J2** — `rename` to a `.canvas` does the same, and its caller is **not** role-gated, so every
  peer observing an unmuted rename creates the doc.
- **J3** — with `CanvasSync` genuinely owning the path, both subsystems hold it simultaneously.
  BUILD_SPEC § 6.1 declares this state impossible.
- **J4 (blast radius)** — the leaked doc's observer schedules a real disk write:
  `BackgroundSync wrote the .canvas while CanvasPersistence owned it: expected 1 to be +0`. Two
  independent debounces, two `lastWrittenContent` baselines, two write queues, no ordering between
  them.

**Why this matters beyond the immediate write:** the handover accepts **R10** on the explicit
grounds that the raw-text fallback is *"exclusive — never concurrent with `CanvasSync`"*. On this
path it is concurrent. Once a second peer lands on the same `Y.Text` — reachable via the announced
R10 fallback after a failed subscribe, or via that peer's own create/rename —
`applyMinimalYTextUpdate` character-merges two concurrently-rewritten JSON files, which is the exact
mechanism that produced the unparseable canvas in `canvas-single-writer.test.ts`'s HEAD red.

**Scope is genuinely bounded, and I want to be fair to W3 about that.** The steady-state flow — an
existing `.canvas` in the manifest, opened during a session — is correct end to end and was proven
so at Levels 2 and 3. The defect is confined to two entry points, and the fix is the same one-line
guard `startAll` already carries. No architectural change; no spec contradiction; not an escalation
to W2.

---

## Overfitting / Regression Signals

This was treated as a first-class deliverable. W3 wrote both the code and 95 new tests, so every
new case was read against the question: *would this still pass if the defect returned in a slightly
different shape?* Findings I **verified myself** are marked; the rest are reported as reviewed
claims.

### Verified — a coverage gap that hid a real defect

- **The `.canvas` guard was only ever tested where it was only ever applied.**
  `background-sync.test.ts:116` proves `startAll` skips a canvas — correctly and well. Nothing
  tested `onFileAdded`/`onFileRenamed`, which is precisely why F1–F4 survived a 621-test suite.
  This is the round's most consequential overfitting signal: the test mirrors the implementation's
  shape rather than the invariant's scope.

### Verified — weak coverage, no live defect

- **`canvas-sync.test.ts:413` "max-wait cap" does not distinguish the cap from the trailing
  debounce.** It churns for 600 ms then advances a further 300 ms of silence, which a pure
  `DEBOUNCE_MS` debounce satisfies on its own. Deleting the `MAX_WAIT_MS` term at
  `canvas-persistence.ts:194` would keep it green. **I checked whether the cap actually works: it
  does** — new probe `G5` churns every 100 ms for 1.2 s with no idle window and observes a write
  landing *mid-churn*, which only the cap can produce. Coverage gap, not a defect. `G5` closes it.
- **Third `GEOMETRY_KEYS` copy is not drift-guarded.** `canvas-sync.ts:29` ↔
  `reconcile-plan.ts:56` are pinned to each other by `canvas-sync.test.ts:902`, but
  `canvas-model-bridge.ts:94` holds a third private copy that nothing asserts. Dormant while
  `useCanvasBinding` is `false` (R1), so LOW.

### Verified — assertions that cannot fail

- `canvas-adapter.test.ts:387` asserts `DRAG_WATCHDOG_MS === 5000` — a constant against its own
  literal. Mitigated: the neighbouring cases assert behaviour *against* the constant, which is the
  right pattern.
- `sync.test.ts:625` asserts `AWARENESS_HEARTBEAT_INTERVAL_MS === TICK + DEADLINE`, which is how
  `sync.ts:68-69` defines it. Unfalsifiable. The other four assertions in the same case are genuine
  invariant guards.

### Reviewed claims — real risks I could not close, reported as risks not findings

- **`reconcileLiveCanvas` (the plan → adapter-call executor) has no test.** The classifier
  `planReconcile` is well covered by 16 pure cases, but the decision to *use* it lives in
  `main.ts`, which no test imports. Re-imposing the HEAD id-set gate downstream of the classifier
  would keep all 16 green and restore the US3 defect. Same root cause as D6: `main.ts` is untested.
- **`canvas-single-writer.test.ts:336` asserts no corruption, but never asserts that sync
  happened.** Its id-set and endpoint assertions are satisfied by the seeded state, so a change
  that stops all syncing would keep it green. It does still catch the specific WP6 corruption. My
  C1 (disk-level content propagation) and the Level 3 live convergence run cover the missing half
  empirically, so I did not raise it as a failure.
- **`onWritten` is wired in `main.ts:1216` but every test wires it itself**, so deleting it from
  `main.ts` would keep the suite green while `CanvasSync`'s baseline went permanently stale. Again
  the `main.ts` gap.

### The opposite signal — genuinely strong tests

Worth recording, because the round is not uniformly weak. `canvas-persistence.test.ts:518`
(`AC14`) constructs a real out-of-order write race from injected latencies rather than mocking call
order. `:751` (`AC17`) asserts the *consequence* of the coldOpen/start ordering instead of spying on
call order. `:293` counts `afterTransaction` on a real doc to prove zero CRDT writes — the
strongest possible statement of "downstream only". `canvas-single-writer.test.ts:536` uses a real
`CanvasSync` with a never-settling `waitForSync` to pin the synchronous-before-first-await
invariant. And **no test was found that mocks the unit under test** — the fixtures consistently
inject seams and delegate to real instances.

---

## Deviations D1 and D5 — both closed by evidence, not by W3's word

The handover flags these as half-verified. Both were independently checked against the actual
pre-round source via `git show 4b34d5e:` — the round's work is uncommitted, so HEAD is the true
before-state.

- **D1 — CONFIRMED, W3 was right and the BUILD_SPEC was wrong.** At HEAD the destructive
  `new Y.Map()` edge re-create sits in an `else if (objChanged(...))` arm that is reachable only
  when `baseObj` exists, `existing` is falsy and `opts` is undefined. A changed-**and-present** edge
  hits the preceding `else if (existing) { applyKeyDiff(...) }` arm and already merged per key. So
  US2 AC2 was indeed green at HEAD, and the branch W3 identified is the remote-delete/resurrect case
  (AC3), which was genuinely red. **No red was faked.** Regression guard re-verified by probe G2.
- **D5 — CONFIRMED, and upgraded from code-reading to execution.** HEAD's classifier is
  `const structural = !!opts?.initial || !sameStringSet(desiredNodeIds, liveNodeIds) || !sameStringSet(desiredEdgeIds, liveEdgeIds);`
  (`main.ts:995`). Probe F1 runs that **verbatim expression** side by side with `planReconcile` on
  the same text-only delta: HEAD yields `geometry` (so the change never reaches the open view),
  current yields `structural`. F2 does the same for an edge `fromSide`-only change. The half W3
  could only reason about is now executed.

---

## Risk Notes for Worker 3

| Priority | Item | Where |
|---|---|---|
| 1 | HIGH — add the `.canvas` guard to `onFileAdded` and `onFileRenamed` (F1–F4) | `Worker4FixRequest_WP6.md` |
| 2 | Re-run `plugin/src/__tests__/w4-canvas-integrity.test.ts` — J1–J4 must go green with no test edit | — |
| 3 | Optional: add `canvas-model-bridge.ts:94` to the geometry-key drift guard | dormant under R1 |

No other fix is requested. Do not weaken J1–J4 into "the doc exists but is unused" — J4 proves it
is not unused.

---

## Residual Risks

- **`main.ts` has no test coverage of any kind (R6).** Confirmed: nothing imports it. This is the
  single largest residual risk and it now covers four separate behaviours — `setLogger`, the
  adapter-logger bridge, the `onWritten` feedback, and the `planReconcile` → adapter-call executor.
  The seams are proven; the call sites are attested only by `tsc`.
- **The three S2 discriminators are unproven at runtime in a real vault.** `AWARENESS GAP:`,
  `DRAG WATCHDOG:` and `ADAPTER PATCH:` all have production emitters and logger-spy assertions, and
  I proved the bridge delivers two of them to a real `DebugLogger` — but no real Obsidian session
  was observed. **Recommend one manual real-vault spike** to confirm the three lines actually appear
  before relying on them to diagnose the next decay incident.
- **S2 itself remains undiagnosed (R2, accepted going in).** WP2/WP3 are guards plus
  instrumentation, and no AC, comment or report in either WP claims otherwise. The phrasing gate
  held — I checked.
- **`fromSide`/`toSide` are now undeletable** (A5). Not reachable through normal Obsidian editing,
  but it is a real semantic narrowing that W2 should ratify.
- **R1 unchanged.** `useCanvasBinding` stays `false`; its `{id}`-edge-capture data-loss defect is
  untouched. Verified not enabled.
- **R9, R10, GAP-7 and the orphaned-`Y.Text` release** remain as documented accepted risks — except
  that R10's "exclusive" justification is currently false on the `create`/`rename` paths and becomes
  true again once F1/F2 are fixed.
- **No install, no deploy, no vault touched.** `server/`, `docker/` and `docker/.env` were never
  read or modified. Version stayed 0.6.0, no dependency added, no reformat.

---

## Recommendation

**CONDITIONAL** — release blocked on one fix.

- Fix F1/F2 (the `.canvas` guard on `onFileAdded` / `onFileRenamed`) and re-run. This is a small,
  well-understood change of the same shape as one already in the codebase, and it needs no
  architectural or spec change.
- Then perform one manual real-vault spike to observe the three S2 log signatures, since no
  automated path can reach the `main.ts` wiring.

Everything else this round shipped — the `PROTECTED_KEYS` endpoint protection, the mute-refcount
fix, the single-writer retirement, the reconcile classifier, the ownership predicate, the cursor
transform and the ten log signatures — held up under independent, discriminating probes and under a
live two-peer relay session.

---

## Artifacts

| Artifact | Path |
|---|---|
| W4 probe suite (39 cases) | `plugin/src/__tests__/w4-canvas-integrity.test.ts` |
| Fix request | `workflowArtifacts/canvas-integrity/Worker4FixRequest_WP6.md` |
| E2E rig console log | `tools/_console_runtime/d22596d4/console.log` (workspace) |

Reproduce the failures:

```text
npx vitest run src/__tests__/w4-canvas-integrity.test.ts -t "J1"
npx vitest run src/__tests__/w4-canvas-integrity.test.ts -t "J4"
```

---
---

# Revalidation — Rework Cycle 1

W4 revalidation: 2026-07-26 · Authority: `HANDOVER.md` § "Rework Cycle 1 — WP6"
Cycle 1 of a maximum 2.

## Revalidation Status: FIXES_REQUIRED

Cycle 1's fix is **correct, complete for the scope it claimed, and independently verified**. One
**new** HIGH defect was found at the fourth entry point W3 flagged and correctly declined to guess
at: `Worker4FixRequest_WP6_Cycle2.md`.

## Gates — re-measured by me, not taken from W3

```text
npm --prefix plugin run build ..... PASS, exit 0
npm --prefix plugin test .......... 35 files passed (35)
                                    663 tests passed (663), 0 failed, 41.00 s
```

W3's reported numbers are **accurate in every particular**. Arithmetic checks out: 660 with 4
failing → 4 J-probes green (+0) + 3 new unit tests = 663. No test removed, skipped or lost.

Abort criteria re-verified independently: `useCanvasBinding: false` (types.ts:65), version 0.6.0 in
both `manifest.json` and `plugin/package.json`, no new canvas-binding import, build green.

---

## 1. The J4 edit — RATIFIED, and the probe is now stronger than what I wrote

I wrote J4, so I judged this rather than deferring.

**W3's diagnosis is correct and my fix request was wrong on this point.** J4's original
precondition `expect(textHandle, "precondition: the leak did not occur").toBeDefined()` at line 952
**hard-coded the defect**: it required the leaked doc to exist in order to proceed. On any correct
fix there is no leaked doc, so J4 failed on its own precondition. No production change could
satisfy both line 952 and line 969. My claim in `Worker4FixRequest_WP6.md` that "no test change
should be needed" held for J1–J3 and was **false for J4**. That was my error, not W3 taking a
shortcut.

**The repair is legitimate, not a widening:**

- The disk-write assertion — the entire point of the probe — is **byte-for-byte unchanged and still
  runs first**.
- The `toBeDefined` precondition was inverted to `toBeUndefined` and moved *after* it. That is
  strictly **stronger** than what I wrote: J4 now asserts both "no second writer" **and** "no second
  CRDT", where it previously asserted one plus a contradiction.
- The remote-delta push became conditional, which is what makes the probe satisfiable at all.
- It is explicitly **not** the softening I warned against. It does not say "the doc exists but is
  unused"; it says the doc must not exist *and* nothing may write.
- The edit is documented in-place with its reasoning, so it cannot be mistaken for a quiet change.

**Anti-vacuity, checked.** On a fixed tree the conditional block is skipped, so "0 writes" is
trivially true in isolation — but the added `toBeUndefined` covers exactly that case by proving the
*reason* nothing was written. The pair is not vacuous.

**Discrimination re-verified by me, not accepted from W3.** I removed only the `onFileAdded` guard
from `background-sync.ts`, re-ran, and restored — with `diff` confirming a byte-identical revert:

```text
J1  RED   expected true to be false
J3  RED   expected true to be false
J4  RED   BackgroundSync wrote the .canvas while CanvasPersistence owned it — expected 1 to be +0
J2  GREEN (correct: only the create-path guard was removed — clean isolation)
```

J4 fails with **F4's exact original signature**. Its teeth are intact. W3's report of this is
accurate.

**Verdict: ratified.** The edit was necessary, minimal, correctly scoped, honestly declared, and
independently proven to discriminate.

---

## 2. Option A vs Option B — the choice was right, on a fact I did not have

W3 is correct that `onFileRenamed` never calls `subscribe()` — it reimplements the flow with its
own `getDoc`/`waitForSync`/`attachObserver`. I verified this in the source. **Option B's headline
benefit as I wrote it was therefore false**: it would have reached 2 of 3 entry points, not 3,
while breaking `canvas-single-writer.test.ts:774`'s exact single-argument assertion and forcing a
rewrite of the `background-sync.test.ts:134` fallback pin I had flagged as load-bearing. Option A
was the better call and my recommendation was based on an incomplete reading. W3 also found the
call-site counts are 3 and 2, not the 1 and 1 I reported.

The guard implementation is sound: one named `skipsAutoTextSync(path)` predicate carrying the
rationale, consulted by all three event-driven entry points, with `subscribe()` deliberately left
as the sole R10 door. The rename guard is correctly placed **after** the old path's teardown — the
trap I called out — and W3 pinned that with a test asserting `releaseDoc(old)` still runs.

---

## 3. Headline invariant, end to end — PASS

| Probe | Result |
|---|---|
| K6 — `.canvas` **created** mid-session: exactly one owner, exactly one disk writer | PASS |
| K7 — `.canvas` **renamed** mid-session: no second CRDT, old path still torn down | PASS |
| K8 — R10 exclusivity: the explicit fallback door still works for a `.canvas` | PASS |
| J1–J4 (cycle 1 failures) | **all PASS**, no test change beyond the declared J4 repair |

R10's rationale genuinely holds again. `BackgroundSync.subscribe` has exactly one production caller
(`vault-events.ts:114`), reached only after `canvasSync.isSubscribed(path) === false`. K8 confirms
the guard did not leak into it — a canvas can still take the announced fallback, which matters
because the alternative (a canvas silently unsynced after a failed subscribe) is worse.

---

## 4. NEW HIGH DEFECT — `syncFromManifest` writes an empty `.canvas`

**Fix request: `Worker4FixRequest_WP6_Cycle2.md`.** W3 asked me to establish this by execution
rather than accept its reading. Done — and it is worse than W3's reading suggested.

- **F5 (K1)** — `syncFromManifest` calls `getDoc(bare path)` for a `.canvas`: `expected 1 to be +0`.
  Only 1 of the 6 `main.ts` call sites passes `{ skipText: true }`.
- **F6 (K2) — DATA LOSS** — it then writes `tempHandle.text.toString()` to disk. Since WP6 made
  `startAll` skip `.canvas`, **nothing populates that bare-path `Y.Text` any more**, so the content
  is always `""`. Observed: `expected [ [ 'board.canvas', '' ] ] to have a length of +0 but got 1` —
  an empty file written over a canvas containing `n1`.

**This answers W3's open question.** W3 held off because "the write may be load-bearing for a
guest's first canvas fetch". It cannot be: under the guards the doc is always empty, so the write
can only ever destroy. **And it is a regression** — `git show HEAD:plugin/src/files/background-sync.ts`
confirms pre-round `startAll` subscribed every text file including `.canvas`, so the doc *was*
populated and the write carried real content. WP6's skip removed the only populator and left the
consumer behind.

**Reachability — split honestly.** Proven by execution: the doc creation and the empty write.
Reading only: whether it self-heals. `CanvasPersistence.coldOpen` restores the file if the shared
canvas doc is non-empty; if the shared doc is *also* empty, the guest's local content — which the
round's own `"seeded-from-file"` improvement would have published — is already gone. The ordering
that decides this lives in `main.ts` (`connectSync()` runs before `manifestManager.connect()`, so
the session-start subscribe loop at `:825` may see an empty manifest), and **`main.ts` has no test
file, so I did not verify it.** Recorded as a question for W3, not as a finding.

---

## 5. `editor/collab.ts` — confirmed not a defect, recorded as residual risk

Probed by execution (K5). `CollabManager.activateForFile` has **no internal `.canvas` guard** — given
a `.canvas` path it does acquire a bare-path `Y.Text` doc. It is unreachable for a canvas only
because `main.ts` gates on `getActiveViewOfType(MarkdownView)` and a canvas opens in a Canvas view.
**W3's reading was correct.** No fix requested. Recorded as an unguarded call protected solely by an
untested `main.ts` gate, rather than as "safe".

---

## 6. Revalidation test summary

| Level | Status | Notes |
|---|---|---|
| 1 Smoke | PASS | build exit 0; 663/663 across 35 files; abort criteria clear |
| 2 Integration | **FAIL** | K1, K2 — the fourth entry point |
| 3 E2E rig | not re-run | cycle 1 touched no code the rig exercises (`e2e-control.ts` loads none of `background-sync`, `manifest`, `canvas-sync`); re-running would have re-proved cycle 0's result, not tested the fix |
| 4 Focused regression | PASS | J1–J4 green + discrimination re-verified by mutation |

W4 probe file now **47 cases, 45 pass, 2 fail**. Full merged suite with the new K probes:
**671 tests, 669 pass, 2 fail, 35 files** — the 2 failures are K1/K2 documenting the new defect.

## 7. Revalidation residual risks

- **`main.ts` still has zero test coverage.** Unchanged, and not relitigated per the Dispatcher —
  recorded as a manual spike. It now also blocks answering the F6 self-heal question.
- **The invariant is by-convention across four methods, not structural.** W3 named this honestly as
  Option A's residual. F5 is the proof that it is a real cost: a fourth entry point in a different
  file was missed by the same reasoning that missed the first three. Once F5 is fixed, **four**
  separate places must each remember the rule. Worth a follow-up round: a single
  `isAutoTextSyncEligible(path)` chokepoint that every text-sync entry point must pass through.
- **No live two-instance run of a mid-session canvas create/rename.** Still unrun.
- Unchanged: R1, R9, R10, GAP-7, the `fromSide`/`toSide` undeletability, and the S2 diagnosis gap.

## 8. Revalidation recommendation

**CONDITIONAL — one more cycle.** Fix F5/F6, answer the self-heal ordering question, re-run. Cycle
1's work is good: the diagnosis was independent, the reds were observed first, the one test edit was
necessary and declared, and the two things W3 chose *not* to fix were both correctly identified and
correctly escalated rather than guessed at. The new defect is a pre-existing regression that cycle
1 surfaced rather than caused.

---
---

# Revalidation — Rework Cycle 2 (FINAL)

W4 final revalidation: 2026-07-26 · Authority: `HANDOVER.md` § "Rework Cycle 2 — WP6"
Cycle 2 of 2 — the last in budget.

## Final Status: VALIDATION_PASS

F5 and F6 are fixed. No new defect. One **correction to a W3 claim** about residual scope, which is
not a defect and does not require a cycle 3 — detail in § 4 below.

## Gates — re-measured by me

```text
npm --prefix plugin run build ..... PASS, exit 0
npm --prefix plugin test .......... 35 files passed (35)
                                    672 tests passed (672), 0 failed, 40.72 s
```

W3's numbers are **accurate**. With my two new M probes the tree stands at **674 / 674, 0 failed,
35 files**.

Abort criteria re-verified independently: `useCanvasBinding: false` (types.ts:65); version `0.6.0`
in both `manifest.json` and `plugin/package.json` (the only `package.json` diff is the round's
pre-existing 0.5.9 → 0.6.0 bump — **no dependency change**); build green.

---

## 1. The fix — verified, including my own tripwires

| Probe | Purpose | Result |
|---|---|---|
| K1 | no bare-path `getDoc` for a `.canvas` in `syncFromManifest` | PASS |
| K2 | no empty `.canvas` written to disk | PASS |
| **K3** | **tripwire** — `skipText: true` still skips correctly | **PASS** |
| **K4** | **tripwire** — a markdown entry still syncs on join | **PASS** |
| J1–J4 | cycle 1's fixes still hold | PASS |
| K6–K8 | headline invariant + R10 door | PASS |

The fix did **not** go over-broad: K4 confirms markdown still syncs through `syncFromManifest`, and
K8 confirms the R10 fallback door still admits a `.canvas`. The guard is correctly scoped to the
canvas extension rather than to the caller, exactly as the fix request directed.

## 2. `L1` scrutinised — it discriminates, and it asserts the invariant

W3's own probe answering W3's own open question is precisely the configuration my overfitting sweep
exists for, so I did not accept it on report.

**Does it assert the invariant or the implementation's shape?** Both, in the right order. Its first
assertion (`coldOpen === "seeded-from-file"`) is implementation-shaped on its own — it checks a
returned enum. But it is backed by two genuine behavioural assertions: that the guest's node `n1`
actually reached the shared doc, and that its `text` survived as `"mine"`. Those are the invariant —
*the guest's local canvas content was not destroyed and did get published*. A version asserting only
the enum would have been a finding; this is not.

**Does it compose real modules?** Yes — the real `ManifestManager.syncFromManifest` and the real
`attachCanvasPersistence`, and it reuses **my** `makeManifestFixture` rather than a bespoke fixture
built to pass.

**Discrimination — I ran the mutation myself.** Reverted only the `manifest.ts:174` guard, re-ran,
restored, `diff` byte-identical:

```text
L1  RED   the join sync erased the canvas before coldOpen could publish it — PERMANENT loss:
          expected 'empty' to be 'seeded-from-file'
```

W3's reported signature reproduces exactly. **L1 is ratified.**

One honest note on its strength: on a *fixed* tree the canvas is skipped, so `syncFromManifest`
becomes a no-op and L1 reduces to my existing E1 seed probe plus that no-op call. Its entire
discriminating value lives in the reverted-guard case — which is legitimate for a regression guard,
and which I have now verified rather than assumed.

## 3. The `utils.ts` lift — RATIFIED

Verified by grep, not by report:

```text
utils.ts:258  export function skipsAutoTextSync(path)   ← ONE definition
├── background-sync.ts:72  startAll
├── background-sync.ts:195 onFileAdded
├── background-sync.ts:248 onFileRenamed
└── manifest.ts:174        syncFromManifest
```

All four consumers import the single definition; `background-sync.ts`'s local copy is gone. The
body is unchanged (`path.endsWith(".canvas")`), so the move carried no behaviour change — confirmed
by all four guard sites' probes staying green. W3's placement argument is sound: the predicate is
the *exception to* `isTextFile`, which lives in `utils.ts`, and both consumers already import from
there, so it adds no new coupling.

**The three surviving `endsWith(".canvas")` occurrences in production are NOT stragglers** — I
checked each. `vault-events.ts:57` is inside `canvasOwned` (an *ownership* predicate),
`vault-events.ts:253` selects the fallback warning, and `main.ts:828` selects canvases *to
subscribe*. Three distinct semantics; collapsing them into `skipsAutoTextSync` would be wrong.

## 4. The `getDoc` sweep — W3's claim is INCOMPLETE (correction, not a defect)

I swept every `getDoc` call in production myself rather than accept the summary. W3's line numbers
for the `background-sync.ts` sites were stale, so I re-derived them.

| Site | Enclosing function | Verdict |
|---|---|---|
| `background-sync.ts:97` | `subscribe()` | Correct — the deliberate R10 door (K8) |
| `background-sync.ts:250` | `onFileRenamed` | Correct — sits *after* the guard at `:248` |
| `background-sync.ts:297` | `handleLocalTextModify` | Correct — this **is** the R10 fallback path; a doc here is by design |
| `background-sync.ts:370` | `flushWrite` | Correct — gated on an armed write timer, which only a subscribed path can arm (M2) |
| `manifest.ts:201` | `syncFromManifest` | Fixed this cycle (K1) |
| `collab.ts:62` | `activateForFile` | Unguarded, unreachable via the `MarkdownView` gate (K5) |
| **`background-sync.ts:173`** | **`setActiveFile`** | **Unguarded — and NOT gated on subscription** |

**M1 proves by execution** that `setActiveFile` acquires a bare-path `Y.Text` doc for a `.canvas`
that was never subscribed: set the active file to `board.canvas`, then switch away, and
`getDoc("board.canvas")` fires on `oldActive`. So W3's statement that the remaining
`background-sync.ts` sites "operate on paths that are already subscribed" is **wrong for this one**,
and `collab.ts:62` is **not** the last unguarded bare-path `getDoc` — there are two.

**Why this is not a defect and not a cycle 3.** Both sites live in the *same* `main.ts` function.
`onActiveFileChange` computes one `sharedPath` (which passes `isTextFile`, true for `.canvas`) and
feeds it to `backgroundSync.setActiveFile` at `:911` and `collabManager.activateForFile` at `:931`.
Both are unreachable for a canvas for the same reason: the function early-returns unless the active
view is a `MarkdownView`, and a canvas opens in a Canvas view. That is exactly the residual risk
already accepted for `collab.ts:62` in cycle 1 — unchanged in kind, larger in surface than stated.

**Recommended follow-up (one line, not this round):** apply `skipsAutoTextSync` when computing
`sharedPath` at `main.ts:908`. That closes **both** sites at once, at the point where the
`isTextFile`-includes-canvas assumption actually enters the system. `skipsAutoTextSync` now sits in
`utils.ts` ready for it.

## 5. Cycle-2 test summary

| Level | Status | Notes |
|---|---|---|
| 1 Smoke | PASS | build exit 0; 672/672 (674/674 with M probes); abort criteria clear |
| 2 Integration | PASS | K1–K4 green incl. both tripwires; L1 ratified |
| 3 E2E rig | not re-run | cycle 2 touched `utils.ts`/`manifest.ts`/`background-sync.ts`; `e2e-control.ts` loads none of them, so a re-run would re-prove cycle 0's result, not test this fix |
| 4 Focused regression | PASS | J1–J4 green; L1 and J4 discrimination both re-verified by my own mutation |

W4 probe file: **50 cases, all green.** Full suite **674 / 674**.

---

## 6. RESIDUAL RISKS — hand-to-user form

*(As requested: what still needs a manual real-vault spike, and whether an already-run session
could have damaged a vault.)*

### A. Needs a manual real-vault spike before relying on it

1. **The three S2 log signatures.** `AWARENESS GAP:`, `DRAG WATCHDOG:` and `ADAPTER PATCH:` all
   have production emitters and test assertions, and I proved the `main.ts` logger bridge delivers
   two of them to a real `DebugLogger`. But **no real Obsidian session was ever observed** in this
   round. Open a real vault, enable debug logging, and confirm the three lines appear. Until then
   they are unproven as a diagnosis tool — which matters, because they are the only discriminators
   for the S2 decay symptom if it recurs.
2. **`main.ts` wiring generally.** `main.ts` has **no test file** and nothing imports it. Four
   behaviours rest on it alone: `syncManager.setLogger`, the adapter-logger bridge, the `onWritten`
   feedback into `CanvasSync`, and the `planReconcile` → adapter-call executor. All compile; none
   are executed by any test.
3. **A live two-instance mid-session canvas create/rename.** The fixed paths are proven at the
   `registerVaultEvents` → `BackgroundSync` seam with real objects, but never across two real
   clients. The two-instance rig cannot reach them (it does not load `vault-events`,
   `background-sync`, `manifest` or `canvas-sync`).

### B. Could an already-run session have damaged a real vault?

**Yes — plausibly, and I think it is worth a human check before the next install.**

The F6 defect was live in the build that existed during this round. Concretely: **if a guest ever
joined, resumed or reconnected to a session whose manifest contained a `.canvas`, and that guest's
local copy differed from the host's hash, the join sync wrote an empty file over it.** Whether that
was recoverable depends on timing — if the shared canvas doc already held content, opening the
canvas restored it; if the shared doc was still empty, the content is **permanently gone**, because
the file that would have seeded the room had already been erased.

This repo cannot tell you whether that happened; W3 is right about that. What I would check:

- Look for suspiciously small `.canvas` files (an emptied one is `""` — zero bytes, or `{}`-ish) in
  any vault that has been used as a **guest** in a Live Share session recently.
- The two known test vaults (`ObsidianOrga` and `ObsidianOrga - Kopie`) are the obvious candidates.
  **I did not inspect them** — installing into or reading those vaults is outside my remit.
- Obsidian's own file recovery / snapshot history is the recovery route if an emptied canvas is
  found.

To be clear about exposure: the fault requires the *guest* role plus a hash mismatch. A host-only
user is unaffected, and a guest whose canvas matched the manifest hash is unaffected.

### C. Accepted, unchanged, no action needed now

- **R1 rollout blocker** — `useCanvasBinding` stays `false`; its `{id}`-edge-capture data-loss
  defect is untouched by design. Verified not enabled.
- **Two unguarded bare-path `getDoc` sites** (`collab.ts:62`, `background-sync.ts:173`) behind the
  untested `MarkdownView` gate — § 4. One-line follow-up available.
- **The invariant is by-convention across four call sites, not structural.** This defect class
  propagated three times (`onFileAdded`, `onFileRenamed`, `syncFromManifest`). The shared predicate
  removes the copy-paste vector but not the "remember to consult it" vector. A single
  `isAutoTextSyncEligible(path)` chokepoint is the durable fix.
- **`fromSide`/`toSide` are now undeletable** — a real semantic narrowing, not reachable through
  normal Obsidian editing. **W2 should ratify**, as it was an unplanned mid-round judgment call.
- **S2 remains undiagnosed** (accepted going in). WP2/WP3 are guards plus instrumentation, and no
  AC or report claims otherwise — I verified the phrasing gate held.
- **R9, R10, GAP-7** and the orphaned-`Y.Text` release remain documented accepted risks. R10's
  "exclusive" justification is now true again.

---

## 7. Final recommendation

**RELEASE — conditional on the two items in § 6B and § 6A.1 being handled as operational steps, not
as code changes.**

Before the next install: check the guest-role vaults for emptied `.canvas` files (§ 6B), and run one
manual real-vault spike to confirm the three S2 log signatures appear (§ 6A.1). Neither blocks the
code.

**On the round as a whole.** Three cycles, six defects, all found by execution and all fixed. W3's
conduct across the rework cycles was sound: it observed my reds itself before editing, it declared
its one edit to my probe and was right that my probe was unsatisfiable, it chose the better of my
two proposed fix shapes on a fact I had got wrong, and both times it declined to guess it flagged
the right thing for me to probe. The one claim it overstated (the `getDoc` sweep) I have corrected
above, and it is a residual-risk scope correction rather than a defect.
