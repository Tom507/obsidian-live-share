# WP125 - Structural repaint cannot wait for a starved clock

**Source:** `SIGNAL_REGISTER.md` **S197 + S199 + S200 + S201** -> `DISPATCHER_STATE.md` B74, "The next batch" -> `ValidationReport_B74_ReleaseSweep.md`  
**Branch:** `fix-bugs-and-raceconditions`  
**Scope:** one bounded production package plus its tests and diagnostic surface. **Nodes only. Edges remain `S194`, explicitly out of scope by owner ruling.**

---

## 0. Goal

After a whole-board `reloadCanvasData()` / Obsidian `canvas.setData()` apply, every changed, attached node is synchronously repainted from the model in the same turn; the background sweep must make bounded round-robin progress even when its priority set is full; recovery must not depend solely on a Chromium-throttled wall-clock; and diagnostics must attribute repairs to the structural seam, per-node seam, or sweep without arithmetic guesswork.

This package repairs the remaining view-layer route. It does **not** change CRDT state, `.canvas` serialization, conflict policy, presence locks, edge routing, or the correctness claim established by `S189`: document and disk are already right.

---

## 1. Verified problem shape

- `S197`: `main.ts` has whole-board `adapter.reloadCanvasData(...)` paths (currently near `:3196` and `:3252`, including the `H8` edge-endpoint escalation). B72 can synchronously repaint only the single-node apply seams. A structural apply has no targeted repaint and relies on the sweep.
- `S199`: `planRepaintSweep()` (`canvas-adapter.ts`, currently near `:481`) consumes `priority = [...repaintPending]` before round-robin. When priority fills `batch`, cursor never advances. Live cursors froze at 9/7/5 for 270 seconds; zero sweep repairs were attributable across 5,538 calls. A 200-node/10-off-screen headless arm starved completely.
- `S200`: `startCanvasRepaintSweep()` uses a nominal 1,000 ms `setInterval`; live background renderers delivered exactly one tick per minute over nine windows. The existing clock cannot carry a seconds-level guarantee.
- `S201`: `describeRepaintSweep().repaired` includes both apply-seam and sweep repairs. B73 credited the sweep for work performed synchronously elsewhere. One aggregate counter is not an attribution instrument.

The earlier hypotheses are not to be resurrected as facts: `H8` was refuted for the two measured B73 trials; the seventeen B71 divergences were detached-node artefacts (`S195`); edge paint remains unmeasured and out of scope (`S194`).

---

## 2. Design boundaries

### 2.1 Structural apply owns its changed-node repaint

`reloadCanvasData(data)` must determine the node ids whose geometry can change **before** calling Obsidian `setData`, then synchronously invoke the existing safe repaint primitive for those ids **after and only after** `setData` succeeds.

The change set is the semantic geometry delta between the live model immediately before the call and the handed node records: node id plus `x`, `y`, `width`, `height`. It is not every node in the board, not byte equality, not insertion order, and not an edge delta. Newly created or removed nodes may be excluded from the synchronous repaint set because their lifecycle is structural; unchanged nodes must not be rendered.

The existing busy/editor/drag and detached-node rules remain authoritative. Structural repaint must reuse the same guarded repaint operation as the per-node seam; it must not bypass `classifyBusyGate`, render a detached node into the DOM, or write the vault. A refused/deferred id remains eligible for the sweep.

Return semantics of `reloadCanvasData()` stay boolean unless the implementer demonstrates that this prevents exact attribution. Any widened result must be internal to the adapter boundary and must not leak canvas decisions into `main.ts`.

### 2.2 Sweep fairness is mathematical, not eventual

For any `n > 0`, `batch > 0`, and any priority set including `priority.length >= batch`, the planner must select at least one round-robin id per tick and advance the cursor. Recommended policy: reserve one slot for round-robin and spend at most `batch - 1` on priority when `n > 1`; an equivalent policy is acceptable only if it proves the same bound.

Required bound: every id continuously present in the live id set is selected by round-robin within at most `ceil(n / rrSlotsPerTick)` planner calls, independent of priority contents and duplicates. Priority still means "earlier", not "exclusive". Selection contains no duplicate id in one batch, cursor is valid after ids reorder/disappear, and empty/single-node cases are explicit.

### 2.3 A throttled timer cannot be the only trigger

Keep a low-rate periodic sweep for quiescent recovery if useful, but add an **event-driven sweep request** at structural apply and at repaint deferral. It must coalesce: at most one pending callback per mounted canvas, no recursive sweep, no unbounded microtask loop, and no work after view close, session teardown, or plugin unload.

The event-driven trigger must be runnable in a hidden/occluded renderer without waiting for the 1 Hz interval. A microtask or zero-delay task is acceptable only with the coalescing/lifecycle proof above; `requestAnimationFrame`, `requestIdleCallback`, another plain interval, or Obsidian `registerInterval` alone is not an answer to `S200`, because each can be suspended or throttled in the condition being repaired.

No charter may promise "every second" in a background Chromium renderer. The honest guarantees are:

- changed attached nodes on structural apply: synchronous, same turn;
- deferred/off-screen nodes: an immediate coalesced sweep attempt plus fair selection whenever any trigger runs;
- periodic fallback: measured tick count and age, with no seconds-level SLA unless live evidence supports it.

### 2.4 Metrics identify the writer

Replace the ambiguous aggregate with monotonic, state-readable counters that separately name:

- `perNodeSeam`: attempts and repairs;
- `structuralSeam`: changed ids considered, attempts, repairs, and deferred/refused outcomes;
- `sweep`: ticks, visited, repairs, cursor, pending count, and last-trigger kind;
- trigger/liveness: event requests, coalesced requests, event runs, periodic runs, and elapsed time since last run.

Names may differ, but the diagnostic output must make these equations directly checkable without subtraction across unrelated snapshots. `repaired` may remain as a compatibility total only if it is explicitly labelled aggregate and equals the sum of the three repair sources. `canvas_diag.py` and the E2E control response must print missing/pre-WP125 fields as unavailable, never as zero.

---

## 3. Acceptance criteria

**A1 - Structural diff and synchronous repaint.** A `reloadCanvasData()` call changing geometry for exactly two existing attached nodes calls `render()` for exactly those two after successful `setData`; unchanged nodes are not rendered. A failed/throwing `setData` produces zero repaint calls and records no successful structural repair.

**A2 - Safety gates survive composition.** An editing/dragging changed node and a detached changed node are not forcibly rendered. They are reported by reason and remain pending for later fair recovery. Structural repaint emits no vault modify and no CRDT transaction.

**A3 - Fair planner bound.** With 11 ids, batch 3, and at least 3 permanently-prioritised off-screen ids, all 11 ids receive a round-robin selection within the proved bound and cursor advances every non-empty tick. Repeat with 200 ids, batch 10, 10 permanent priorities. Priority order and id reorder/deletion cannot duplicate or strand a surviving id.

**A4 - Event-driven recovery and lifecycle.** Structural apply and repaint deferral request a coalesced sweep without waiting for the periodic interval. One burst produces one pending callback; a request raised during a run schedules at most one follow-up. Close/unload/session teardown cancels pending work, stops the interval, and makes later callbacks no-ops.

**A5 - Attribution cannot lie.** A per-node repair increments only `perNodeSeam`; a structural repair increments only `structuralSeam`; a sweep repair increments only `sweep`. A no-op, refusal, or detached deferral never increments any repair counter. If an aggregate is retained, tests assert exact sum equality after mixed operations.

**A6 - Diagnostic compatibility.** E2E control and `tools/e2e/canvas_diag.py` expose the split counters, trigger kind, cursor, pending count, and last-run age. A pre-WP125 bundle receives an explicit compatibility caveat. No missing field is coerced to `0`, `healthy`, or `repaired nothing`.

**A7 - Live occluded structural arm.** On three real vaults running the same digest, with receiving windows occluded, an edge-endpoint-node drag that takes the whole-board `setData` branch must show: doc/file/model convergence; structural changed ids > 0; structural repaint attempt in the same apply; attached changed nodes paint-agree without tab remount; sweep cursor advances across successive forced/event triggers; and counters attribute work to the correct source. Run a visible-windows control and an unchanged-geometry control. Do not score an arm unless the structural branch and occlusion were both positively observed.

**A8 - No collateral behaviour.** Existing per-node repaint, busy editing, detach virtualization, canvas persistence, locks/cursors/tiebreak, `.md` sync, and build gating remain green. No edge accessor/repaint is added.

---

## 4. Break-to-red table - mandatory before green

Each plant is applied to a copy-aside snapshot, run RED for the named reason, restored byte-identically, then run GREEN. Do not use `git checkout`, `git restore`, or `git stash` in the shared dirty tree.

| Plant | Break | Must redden |
|---|---|---|
| **BK1** | Remove the structural post-`setData` repaint call | A1 structural changed-node test |
| **BK2** | Repaint every handed node instead of the semantic changed set | A1 unchanged-node negative assertion |
| **BK3** | Repaint before `setData`, or repaint after a thrown `setData` | A1 ordering/failure rows |
| **BK4** | Restore priority-first batch filling so `priority >= batch` leaves no round-robin slot | A3 11-node and 200-node coverage/bound rows |
| **BK5** | Keep cursor unchanged after a priority-heavy tick | A3 explicit cursor-progress assertion |
| **BK6** | Remove event request from structural apply and disable the periodic callback in the fake clock | A4 recovery-without-interval test |
| **BK7** | Allow two event requests to enqueue two callbacks | A4 coalescing assertion |
| **BK8** | Let a queued callback execute after teardown | A4 lifecycle assertion |
| **BK9** | Route structural or per-node repairs into the sweep counter | A5 source-attribution table |
| **BK10** | Treat missing split fields from a pre-WP125 bundle as zero | A6 compatibility test |
| **BK11** | Live build with structural repaint seam disabled, same occluded arm | A7 must show paint divergence or absence of structural repaint evidence; otherwise the arm is vacuous and is a finding |

A plant that reddens nothing is a finding, not a pass. For every green, the implementation report must answer: would this test also pass on B74's broken planner/clock/counter build? If yes, it is not a discriminator.

---

## 5. Test and validation gates

### Headless, from `plugin/`

1. Focused WP125 tests covering A1-A6 and every BK plant.
2. Existing B72 repaint tests, especially the derived three apply seams and busy/detached cases.
3. Planner property/table tests for 0, 1, 11, and 200 nodes; priority empty, below batch, equal batch, and above batch; reorder and deletion.
4. Fake-clock lifecycle tests: burst coalescing, re-request during run, all stop routes, no interval dependence.
5. `./node_modules/.bin/tsc --noEmit --skipLibCheck`
6. `./node_modules/.bin/vitest run` - plain, unfiltered, and not piped through `tail` before pass/fail is known. Record the known `S181` contention timeout by name if it occurs; do not rerun-until-green or reduce its iterations.
7. `npm run build`
8. From repository root: `python workflowArtifacts/canvas-v2/check_signal_register.py`, exit 0 with its positive control demonstrated.

The latest quiet B74 reference is **448 files / 3404 tests / 0 failed**, `tsc` 0 and register 0. Re-measure; do not quote it as the new result.

### Live W4 gate

- Snapshot and hash only the three existing plugin bundles before deployment; do not read or copy `data.json`.
- Install one byte-identical built bundle into A/B/C, reload all three, and verify the loaded WP125 diagnostic protocol before arming.
- Re-read `session.info` before and after; roles migrate. Use `sharedFolder = _liveshare-test`, never empty.
- Execute A7 twice: receivers occluded, then all visible. Use a changed edge-endpoint node known to enter structural `setData`, followed by an unchanged-geometry negative control.
- Capture doc/file/model/paint plus split metrics before and after. `style` is the authoritative paint verdict until the known ~59.86 px rect-offset instrument defect is separately repaired.
- No human-visible correctness claim may be upgraded to PASS without the branch-positive and plant-positive controls.

---

## 6. Allowed files and ownership

Expected production surface:

- `plugin/src/canvas/canvas-adapter.ts`
- `plugin/src/main.ts`
- `plugin/src/testing/e2e-control.ts`
- `tools/e2e/canvas_diag.py`
- new `plugin/src/__tests__/v2/wp125/*` tests

Expected report/artifact surface:

- `workflowArtifacts/canvas-v2/ImplementationReport_WP125.md`
- live diagnostic JSON under `workflowArtifacts/canvas-v2/diag/`
- `SIGNAL_REGISTER.md` status changes only after evidence exists; allocation remains Dispatcher-owned
- `docs/KNOWN_ISSUES.md` only after W4 proves the safety net active

Changes outside this set require `ESCALATE` before editing. `BUILD_SPEC_CanvasV2.md` is not amended by this charter: this is a post-B74 residual package governed by the signal register and Dispatcher state, and it changes no Canvas V2 schema or invariant. If implementation discovers an invariant/spec amendment rather than a local repair, stop and return it to Worker 2.

---

## 7. Shared-tree, security, and abort rules

- Work serially in the shared tree. Do not create/remove a worktree: the junctioned `plugin/node_modules` hazard has already destroyed dependencies once.
- Before the first edit, snapshot every already-dirty allowed file under `workflowArtifacts/canvas-v2/_snapshots/wp125/`. Never overwrite or revert another worker's changes.
- Never use `npx biome check --write`; it corrupts this tree. No dependency changes are authorised.
- `data.json` contains live credentials. Never print, read, log, fixture, hash-and-publish, or route it through a tool. Do not expose relay/session tokens or secrets in commands, reports, screenshots, or diagnostic JSON.
- Abort on: any CRDT/disk write introduced by repaint; synchronous O(n) repaint after structural `setData`; a timer-only solution to `S200`; weakened/skipped tests; missing RED plants; counter attribution inferred by subtraction; forced rendering of editing or detached nodes; edge work; or a live result obtained without proving both the structural branch and occlusion.

---

## 8. Handover contract

Worker 3 returns `ImplementationReport_WP125.md` containing:

- the chosen changed-id algorithm and its complexity;
- the exact fairness bound and a trace for 11 and 200 nodes;
- trigger/coalescing/lifecycle state machine;
- split-counter schema and compatibility behaviour;
- full BK1-BK11 RED -> restore -> GREEN table;
- focused and full gate results without hidden output;
- live A7 evidence or `HUMAN_OBSERVABLE` with exact operator steps if the owner gesture/reload is the only missing action;
- all touched-file hashes, pre-existing errors, snapshots, and unresolved findings.

Worker 4 returns `VALIDATION_PASS`, `FIXES_REQUIRED`, or `HUMAN_OBSERVABLE`. `VALIDATION_PASS` requires the live occluded structural arm; headless success alone cannot close `S197`, `S199`, or `S200`.
