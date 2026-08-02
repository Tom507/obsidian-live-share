# Implementation Report — WP48: Teardown, crash recovery, orphan reclaim

**Status:** `DONE`
**WP:** WP48 · PHASE T3 · component C48 · attempt 2 (robustness pass)
**Charter:** `workflowArtifacts/canvas-v2/TaskCharter_WP48_TeardownCrashRecovery.md` (Charter Status → `DONE`)
**Files:** `tools/obsidian_e2e/teardown.py` (new) · `tools/launch_obsidian_e2e.py` (modified) · `tools/obsidian_e2e/__init__.py` (member list only)

---

## 1. Acceptance Criteria

| AC | Statement (abridged) | State | Where it lives | Pinned by |
|---|---|---|---|---|
| AC1 | Teardown runs **exactly once** on every exit path and performs the same steps in the same order: restore settings → remove scratch → stop only rig-started processes | **MET** | `TeardownRunner.run` / `_execute`, `run_with_teardown`, `TEARDOWN_STEP_ORDER` | TP01, TP02, TP03, TP04 |
| AC2 | Every wait is bounded and **names its condition** when it expires; no wait can block a run indefinitely | **MET** | `wait_for`, `WaitTimeout`, `_require_positive_finite`, `wait_endpoints_gone` | TP05, TP06 |
| AC3 | An endpoint lost mid-run fails the run under a named reason, **still completes teardown**, and exits **non-zero** | **MET** | `check_endpoints_alive`, `EndpointLostMidrun`, `RunOutcome.green` / `.exit_status`, entrypoint `_verify_endpoints_still_answer` | TP07 |
| AC4 | Crash artefacts (provisioned setting, stale scratch, bound-but-dead port) are detected at start-up and reclaimed; reclaiming is **idempotent** | **MET** | `reclaim_stale_state` + `_reclaim_settings` / `_reclaim_scratch` / `_reclaim_ports`, entrypoint `_startup_reclaim` | TP08–TP12 |

### How each AC is actually enforced (not just satisfied)

- **AC1 — "exactly once" is a counter, and the slot is claimed before the work.**
  `TeardownRunner.run()` takes the lock, returns the memoised `TeardownResult` if one exists, otherwise stores the (still empty) result object **and then** executes the steps. A re-entrant call — from inside a step, from a body that tore itself down, from a repeated `run()` — sees a result and returns it. `executions` is an `int`, so a second pass fails the assertion rather than flipping a boolean back and forth.
  Each step is wrapped in `except BaseException` and lands in `failures[step]`: a raising step does **not** stop the remaining steps, the original exception object is retrievable (`result.failures[step] is boom`), `result.ok` is derived from `failures` rather than set, and the run becomes non-green with a non-zero exit status. `run_with_teardown` catches `BaseException` because interruption is one of the four exit paths AC1 enumerates.
- **AC2 — unboundedness is unspellable.**
  `wait_for(condition, predicate, *, timeout_s, poll_s=…, clock=None, sleep=None)`: `timeout_s` is keyword-only with no default, and `None`, `0`, negatives, `inf` and `nan` are rejected with `ValueError` **before** the clock is read (`nan` matters most — every comparison against it is false, which is "wait forever" wearing a number). A nameless condition is rejected too. `WaitTimeout` carries `constants.WAIT_TIMEOUT` **and** the condition name into `str(exc)` and into `to_dict()`, so the name survives into the serialised run record.
- **AC3 — all three properties on one path.**
  `check_endpoints_alive` raises `EndpointLostMidrun(role)` on the first silent role. `run_with_teardown` then: sets `failure_reason = constants.ENDPOINT_LOST_MIDRUN` (only names in `constants.FAILURE_REASONS` pass — no ad-hoc reason string can leak in), still calls `runner.run()` so all three steps complete in order, and reports `green is False` with `exit_status == 1`. `green` is conjunctive (`no error AND not interrupted AND teardown ok`), so a partially executed run — or a clean run whose teardown failed — cannot be reported green.
- **AC4 — ordering, not caching; and all three kinds every pass.**
  `reclaim_stale_state` reads the provision marker **before** the settings step, because `ports.restore_port` deletes that marker and its `pid` is the port step's only evidence of rig ownership. It then runs all three kinds unconditionally — an early return after the first kind would clean a settings file and leave a stuck port, which is exactly the combination a crash produces. Idempotence comes from the primitives themselves: the second pass finds no marker (so WP44's restore is a no-op and the just-restored original is **not** overwritten by the already-provisioned state), no stale scratch, and an unbound port.

---

## 2. Data safety and D15

- **No code path can terminate a process the rig did not start.** Two funnels, both refusing by default:
  - teardown → `_stop_rig_started(io, record)` raises `D15Violation` unless `record.rig_started` is true; `TeardownRunner` additionally records non-rig-started pids in `skipped_pids` and never reaches the funnel with them;
  - reclaim → `_terminate_rig_owned(process_control, pid, rig_owned_pids)` raises `D15Violation` unless the pid appears in the rig's **own** provisioning marker.
  Both call an **injected** `terminate` seam. `grep` over both touched files finds **no** `taskkill`, `Stop-Process`, `os.kill`, `signal`, `subprocess`, `Popen`, `os.system`, `pkill` or process sweep of any kind — the only occurrences of "terminate" are the two funnels, the injected seam names and prose. A port that still answers is skipped entirely ("a live instance to attach to, not an orphan"), and a bound-but-silent port whose holder is not in the marker is reported with an operator instruction, never signalled.
- **No constant owned by `constants.py` was redefined.** `teardown.py` imports `constants` and reads `WAIT_TIMEOUT`, `ENDPOINT_LOST_MIDRUN`, `SCRATCH_STALE_UNRECLAIMED`, `PROVISION_CONFLICT`, `SETTINGS_RESTORE_MISMATCH`, `FAILURE_REASONS`, `ROLES`, `PLUGIN_DATA_REL`, `PROVISION_MARKER_REL`, `SCRATCH_FOLDER`. The only names WP48 declares are its own: `TEARDOWN_STEP_ORDER` / the three step names, `RECLAIM_KIND_*`, `DEFAULT_POLL_S`, `DEFAULT_RECLAIM_TIMEOUT_S` — none of which the shared contract pins elsewhere.
- **S4 held.** No `data.json` content is read, printed, logged or serialised anywhere in this WP. Settings work is delegated to WP44, which compares by sha256 of bytes; reclaim reports name the *file*, and the report text deliberately avoids the settings key so that `json.dumps(report.to_dict())` contains neither `serverPassword` nor `e2eControlPort` (asserted by TP08).
- **S5 held.** Every test runs against fixture vaults under `tmp_path`; the manual end-to-end smoke ran against a throwaway fixture pair under `h:\tmp\wp48_smoke` (deleted afterwards) with explicit `--vault-a/--vault-b`. The owner's vaults and `%APPDATA%\obsidian\` were never written.
- **Zero new dependencies.** Standard library only (`json`, `math`, `threading`, `time`, `dataclasses`, `pathlib`, `typing`).

---

## 3. Changes Made

### `tools/obsidian_e2e/teardown.py` (new)

```text
TEARDOWN_STEP_ORDER = (restore_provisioned_settings, remove_scratch_artefacts, stop_rig_started_processes)
RECLAIM_KIND_SETTINGS / _SCRATCH / _PORT = "settings" / "scratch" / "port"

WaitTimeout(condition, timeout_s)          ← .reason=WAIT_TIMEOUT .condition .to_dict()
EndpointLostMidrun(role)                   ← .reason=ENDPOINT_LOST_MIDRUN .role .to_dict()
D15Violation                               ← raised by both stop funnels
wait_for(condition, predicate, *, timeout_s, poll_s=…, clock=None, sleep=None) -> float
wait_endpoints_gone(endpoints, *, timeout_s, …)   ← wraps WP46 readiness.check_endpoints_gone
check_endpoints_alive(probe, roles=constants.ROLES) -> None
ProcessRecord(pid, role, rig_started, label)
TeardownRunner(*, io, provisioned_settings, scratch_artefacts, processes, recorder=None)
    .executions  .run()  .register_provisioned_settings/_scratch_artefact/_process
TeardownResult   .steps_run .failures .stopped_pids .skipped_pids .ok .to_dict()
RunOutcome       .exit_status .failure_reason .teardown_result .error .interrupted .green .to_dict()
run_with_teardown(body, runner) -> RunOutcome
reclaim_stale_state(vault, *, ports=(), port_probe=None, process_control=None,
                    clock=None, sleep=None, timeout_s=5.0, poll_s=…) -> ReclaimReport
ReclaimReport    .artefacts .reclaimed .unreclaimed .actions .to_dict()
ReclaimedArtefact .kind .target .reclaimed .reason .detail
```

Consumed, not reimplemented: WP44 `ports.restore_port`; WP47 `scratch.stale_scratch_relpaths` / `reclaim_stale_scratch` / `assert_write_allowed`; WP46 `readiness.check_endpoints_gone`; WP43 `constants`.

### `tools/launch_obsidian_e2e.py` (modified)

- `main()` now owns only the teardown ledger, the single `run_with_teardown` call, printing and the exit status; the run itself moved into `_run(args, runner, console, registry)`. Every previous `return 0/1` branch became a returned run record, so **all** exit paths — including the two early-return refusals — go through the same teardown.
- Start-up reclaim (`_startup_reclaim`) runs per configured vault **before** anything is probed. It writes into the vault, so it is off in the default read-only mode and on for `--allow-launch`; new flags `--reclaim`, `--no-reclaim` (wins), `--reclaim-timeout`.
- `_ControlPortProbe` reuses WP45's connect probe for `is_bound` and WP46's inverted readiness probe for `answers_control`; `owner_pid` returns `None` on purpose (see Blocked Items).
- `_RigTeardownIO` wires the three primitives to `ports.restore_port`, WP47's write guard + `unlink`, and `lifecycle.request_process_stop` (which refuses any untagged handle).
- `_register_endpoint_processes` records attached windows as `rig_started=False` so D15 shows up in the record as a *skipped* pid rather than as an omission; a launched role is tagged rig-started only when the console backend really starts something (`PlanOnlyConsole` starts nothing, so nothing is tagged).
- `_verify_endpoints_still_answer` (AC3) re-probes the roles that answered earlier and raises `EndpointLostMidrun`.
- Exit status: `outcome.exit_status`, upgraded to `1` when the run record itself reports `ok: false` — so a named precondition failure still exits non-zero.
- No spawn primitive, no detached-launch token and no `__mocks__` / `alias:obsidian` reference was introduced (WP45's AST guard TP09 and TP11 still pass).

---

## 4. Visible Test Results

Run from the **repo root** (the workspace root aborts collection on a dangling `Projects/_external/FinaleAbgabe` junction — known environment defect):

```text
cd h:\My Code\AgenticWorkspace\Projects\_external\liveshareCollab\obsidian-live-share
h:\My Code\AgenticWorkspace\.venv\Scripts\python.exe -m pytest workflowArtifacts/canvas-v2/tests/visible/WP48 -q
```

| Suite | Result |
|---|---|
| `tests/visible/WP48` (12 files, TP01–TP12) | **46 passed, 0 failed** |
| `tests/visible` (whole tree, WP41–WP49 regression) | **266 passed, 0 failed** |
| `tests/visible/WP45` (the entrypoint's own guards, after rewiring) | **29 passed, 0 failed** |

**Mutation check of the implementation** (each mutation applied to the real module, suite run, source restored):

| Mutation | Killed by |
|---|---|
| step order swapped (scratch before settings) | 12 failures — TP02 step order, TP01, TP03, TP07 |
| D15 guard dropped from the stop step | 4 failures — TP04 (all three) + TP07 |
| reclaim returns early after the settings kind | 5 failures — TP11 combined + port-after-empty-settings, TP12 idempotence |

**End-to-end smoke of the wired entrypoint** (fixture vault pair under `h:\tmp`, deleted afterwards):

- pass 1 reclaimed 2 artefacts per vault (settings + scratch), restored `data.json` to the original sha256, removed backup + marker + rig folder, left the owner's note byte-identical; pass 2 reported `actions=0` with an identical end state.
- all four exit paths (`RuntimeError`, `AssertionError`, `KeyboardInterrupt`, `EndpointLostMidrun`) produced: teardown steps `[restore, scratch, processes]` exactly once, in order, and **exit status 1**. The `EndpointLostMidrun` case additionally reported `failure_reason: "ENDPOINT_LOST_MIDRUN"` with `teardown.ok: true` — AC3's three properties on one path.

---

## 5. Blocked Items

None. Two bounded scope notes, neither blocking:

1. **`owner_pid` is `None` in the real entrypoint.** Mapping a listening port to its holding pid needs an OS query (`netstat`/WMI) and every such primitive is forbidden outside WP45's single `spawn_through_console` seam. Under D15 an unknown owner is not a rig-owned one, so the entrypoint *reports* a bound-but-silent port to the operator instead of force-reclaiming it. The forced path is fully implemented and unit-covered (TP10, TP11) and is reached by injecting a probe that can answer `owner_pid` — the seam exists for exactly that.
2. **`run_with_teardown` returns rather than re-raises on `KeyboardInterrupt`.** The batch brief's design note said "re-raise unmasked", but both the charter §7 API surface (`run_with_teardown(body, runner) -> RunOutcome`) and TP01's `keyboard_interrupt` parameterisation require a returned `RunOutcome`; re-raising would make the teardown record unreachable for the caller. The interruption is therefore not masked but **recorded**: `interrupted=True`, `error` is the original exception object, `green is False`, `exit_status` non-zero. No test was modified.

---

## 6. Summary for Worker 3

WP48 is **DONE** on all four ACs with 46/46 visible tests green and the whole visible tree at 266/266. `tools/obsidian_e2e/teardown.py` is the single teardown path — ordered, run exactly once by counter, isolating a raising step without swallowing it — plus the bounded-wait primitive, the mid-run endpoint guard, and the idempotent three-kind start-up reclaim. `tools/launch_obsidian_e2e.py` now routes every exit path through it and reclaims crash artefacts before probing.

Two things worth carrying forward: (a) **no code path in this WP can terminate a process the rig did not start** — both stop paths are funnels that refuse by default and call an injected seam, and there is no OS kill primitive in either file; (b) **no constant owned by `constants.py` was redefined** — every failure reason is imported, and the only new names are WP48's own step and reclaim-kind labels.

Risk for Worker 4: **NONE**. `W4 Test Targets: 0` stands — all four ACs are decidable at the unit level through the injected seams, and S5 still forbids a live run against the owner's vaults in this batch. No TypeScript was touched, so the `plugin/` vitest gate is untouched by WP48 and was deliberately not re-run while another Worker 3 is mid-edit in `plugin/src/**`.

---

## 7. Attempt 2 — robustness

Four items. **No test was modified.**

### 7.1 The stop list is resolved before anything is stopped (D15)

`_stop_rig_started_processes` iterated the ledger directly, so two properties were
accidents of registration order:

- the same pid registered twice — two call sites, a re-probe, an attach later recorded as a
  launch — was **terminated twice**. At best a no-op; at worst a signal aimed at whatever
  process inherited the number;
- a pid appearing **both** as attached and as rig-started resolved to whichever entry the
  loop saw last.

`resolve_stop_list(processes)` now collapses the ledger to **one decision per pid** before
the step runs, and the resolution rule is deliberate: **attached wins, in either order**. A
claim that the rig did not start something cannot be cancelled by a later entry claiming
otherwise, because the cost of being wrong in that direction is the owner's unsaved work.
Identity is compared as text (`_pid_key`), so the charter's `int` pid and the entrypoint's
console-id string are recognised as the same process. First-seen order is preserved, so the
teardown record still reads in acquisition order — only the *decision* stopped depending on
it. Verified: duplicate rig pid → one terminate; rig+attached in both orders → zero;
`42` vs `"42"` → zero; `[1, 2, 1]` → `[1, 2]`.

### 7.2 A wait condition name is rejected at construction

`wait_for` checked the name; `WaitTimeout("", 30)` did not. A timeout that names nothing is
exactly the defect AC2 exists to prevent, so it is now impossible to *build* one:
`WaitTimeout.__init__` validates the condition through the new `_require_named_condition`
(empty, blank and non-string all `ValueError`) and the timeout through the existing
`_require_positive_finite` — the same treatment a missing timeout already got, applied at
the same place. The name is stored stripped, so trailing whitespace cannot make one
condition read as two. `wait_endpoints_gone` over an empty endpoint map now names
`<none>` rather than producing a condition that trails off.

### 7.3 Reclaim reports what it cannot safely determine

The settings kind flattened every WP44 refusal into `PROVISION_CONFLICT` and let anything
that was *not* a `ProvisionError` escape and abort the whole pass — so a permission error
or a vanished directory during the settings step meant the stale scratch file and the stuck
port were never even looked at. Now:

- a **structural pre-check** (`_missing_backup_reason`) runs first, read-only: a marker
  claiming a saved original whose backup file is *gone* is reported as
  `SETTINGS_RESTORE_MISMATCH`, because that is what it is — a restore that cannot be
  byte-exact — rather than the generic "this borrow record is contradictory". Reclaim is
  the only layer that can name it, since WP44's `ports.py` is not this WP's to change;
- for everything else the reported reason is the exception's **own** `constants` name
  (`_reported_reason`), falling back to `PROVISION_CONFLICT`. A backup no marker accounts
  for, a damaged marker and a non-byte-exact restore each keep their own diagnosis instead
  of sharing one label;
- any other error is caught and reported as an unreclaimed settings artefact, so the
  remaining two kinds still run.

Nothing is guessed either way: an unresolvable record leaves `data.json` exactly as found
and comes back `reclaimed=False` with a named reason — verified, including that the file is
byte-identical afterwards.

### 7.4 Reclaiming the rig folder is complete — and still confined

`_remove_scratch_folder_if_empty` only removed the folder when it was empty. A run that
crashed mid-write leaves more than tidy `.canvas` files — a partial write, a `.tmp`
sibling, a log, a subdirectory — and none of those is a *scratch canvas*, so the
(correctly narrow) `is_scratch_relpath` declined to touch them. Result: after the first
crash the folder stood forever with the rig's own leftovers in it, which is exactly the
state AC4 exists to clear.

Start-up now uses a rule fit for start-up, `scratch.reclaim_scratch_folder()`: **the rig
owns `SCRATCH_FOLDER` outright** — it creates it, it is the only writer into it, and if it
still exists at start-up it is the wreckage of a run that is already gone — so the whole
folder goes, contents and subdirectories included.

Two different situations, two rules, and that is the point:

| | teardown (`scratch_run`, WP47 TP05) | start-up (`reclaim_stale_state`) |
|---|---|---|
| whose folder | this run created it | a previous, dead run left it |
| what else is in it | a live peer's artefact, a file the user just dropped in | that run's debris |
| rule | remove only if **empty** | remove **completely** |

The guard that keeps this from becoming a vault cleaner is **confinement**, and it is
untouched: `assert_write_allowed` is called for every single entry and for the folder
itself, so nothing outside the rig folder is reachable from here — a user-owned canvas
elsewhere in the vault that merely *looks* like a scratch file is untouchable, as is every
note, attachment and setting. A folder still holding an artefact of a run **live in this
process** is left completely alone: that is a running peer, not wreckage. There is no
`rmtree`: the tree is walked bottom-up through the guarded single-file / single-directory
primitives, and any failure abandons the removal where it stands and reports.

Verified: folder with a `.canvas`, a prefixless `leftover.log` and a `sub/deep.tmp` →
removed whole, owner's notes untouched; a look-alike canvas in `Canvases/` → untouched; an
empty rig folder → removed; an absent rig folder → no artefact; a folder in use by a live
run → untouched. And WP47's own two rules are unchanged: `scratch_run`'s teardown still
keeps a folder holding a user file, and `reclaim_stale_scratch` still never removes a
non-scratch file.

### 7.5 Also relocated here

`RigStartedProcesses` and `request_process_stop()` moved from `lifecycle.py` into this
module (WP45's attempt-2 item 2: the module that owns starting must contain no
process-ending machinery at all). Same behaviour, same refuse-by-default funnel, and
`launch_obsidian_e2e.py` now wires `_RigTeardownIO.terminate_process` to
`teardown.request_process_stop`. There is still no OS termination primitive in this file:
both stop funnels call an **injected** seam.

### 7.6 Result

Visible suite **266/266** (before this pass: 265 passed, 1 failed — WP47's run-id burst
test). WP48's own 46 tests unchanged and green.
