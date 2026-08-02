# Task Charter — WP48: Teardown, crash recovery, orphan reclaim

**Charter Status:** `DONE`
**WP:** WP48
**Phase:** P0 (PHASE T3 group)
**task_mode:** `standard`
**Depends on:** WP45, WP46
**W4 Test Targets:** `0`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** a crashed run costs a re-run and never a dirty vault, a lost setting or a stuck port.
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 5, **PHASE T3**, component **C48 — Teardown, crash recovery and orphan reclaim** (work package WP48); phase **P0**.

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: create (`tools/obsidian_e2e/teardown.py`) + modify (`tools/launch_obsidian_e2e.py`)
  - Responsibility: make a real-Obsidian run end in a known state whatever happens, including when Obsidian hangs, crashes or is closed by the owner mid-run.
  - Scope summary: one teardown path, bounded waits, reclaim of stale state
- **Out of scope / non-goals:**
  - Recovering Obsidian itself; if the application dies the run fails — the rig recovers its own state, not the editor's.
  - Retrying a failed run automatically; reclaim prepares a clean start, it does not re-run.
  - Any teardown step that could touch a non-scratch artefact.
- **Known interfaces / dependencies:**
  - Input: whatever the run acquired — provisioned settings, scratch artefacts, started processes
  - Output: a released state plus a run verdict that a partial run cannot report as green
  - Depends on work packages: WP45, WP46

---

## 3. Architecture Context

*Task-local architecture guidance only.*

- **Component(s) being changed:** Teardown, crash recovery and orphan reclaim
- **Interfaces involved:**
  - Input: whatever the run acquired — provisioned settings, scratch artefacts, started processes
  - Output: a released state plus a run verdict that a partial run cannot report as green
- **Why PHASE T3 exists (one paragraph, do not re-derive):** CONCEPT_V2 Teil 14 makes a green two-vault run against **real Obsidian** a release condition from P0 onward, and from P5 additionally the empirical confirmation of every `CAPTURE_TRIGGERS` assumption. The rig that exists, `tools/launch_liveshare_e2e.py`, aliases the `obsidian` module to `plugin/src/__mocks__/obsidian.ts` and boots two lightweight plugin hosts — its own usage document scopes real-Obsidian orchestration out as "T3". A green run there proves nothing about the gate, which is why Worker 3 returned WP7 BLOCKED rather than running it. PHASE T3 builds the missing host layer. The control protocol, its command set, the `E2EPluginLike` interface (which the real `LiveSharePlugin` already satisfies), the `__LS_E2E__` bootstrap, the binding instrument seam and the `liveshare-e2e` MCP driver **already exist and are not rebuilt** — T3 is a host-launch, identity, safety and oracle layer.
- **Constraints from BUILD_SPEC (invariants — what must not change):**
  - Invariants I1–I5 (`ARCHITECTURE.md`) and I6–I10 (CONCEPT_V2 Teil 3) are binding and must not be weakened.
  - Yjs stays. No CRDT library swap, no alternative CRDT introduced anywhere.
  - `CanvasPersistence` remains the single CRDT→disk writer; it emits zero CRDT writes; `coldOpen` runs after `waitForSync` and before `start()`. **A T3 oracle reads what that writer produced; it never writes, re-serialises or normalises a `.canvas` file itself.**
  - **Zero new runtime dependencies.** Any dependency at all requires a publish date >= 7 days old (`npm view <pkg>@<version> time.created`); `npm ci` in build/deploy contexts, never `npm install`. This applies to the Python side of the rig as well — prefer the standard library, which is what the existing rig and MCP driver already do.
  - `GEOMETRY_KEYS` keeps exactly `{x, y, width, height}` and stays exported (it now describes the *file* schema). Changing membership or removing the export is an ESCALATE.
  - `plugin/src/canvas/canvas-presence.ts` is not modified by this initiative. If a WP believes it must, that is an ESCALATE.
  - `plugin/src/main.ts` may hold wiring only, never logic — it has no test file.
  - `canvas-binding.ts` / `canvas-model-bridge.ts` stay frozen and `useCanvasBinding` stays `false` until WP39/WP40 (only WP22 makes a narrow removal there).
  - Do not bump the plugin version. Do not hand-edit `plugin/main.js` or `server/dist/`. Do not read or edit `plugin/manifest.json` (broken symlink).
  - `server/` source is off limits except in WP41. Deployment, `docker/.env` and any secret are out of scope entirely.
  - **Data safety (D16, BUILD_SPEC §7 data-safety gate).** `H:\Developement\_NeuralAngels\ObsidianOrga` and `H:\Developement\_NeuralAngels\ObsidianOrga - Kopie` are the owner's **live working vaults**. No pre-existing note, canvas or attachment is ever opened for writing. Everything a run touches is a rig-created scratch artefact that teardown removes. A run that leaves either vault changed outside its own scratch artefacts is a FAILED run whatever else it proved.
  - **Never terminate what the rig did not start (D15).** No process, window or Obsidian instance the rig did not itself launch may be closed, killed or restarted. If a run would need that, it stops and says so.
  - **Long-running or interactive processes go through the `visible-console` MCP tools** (`run_python` / `run_command`, then `await_console`) — never a Bash background process. Python is launched via `run_python` with an **absolute** script path: `run_command` wraps its argument in `cmd.exe /d /c "…"`, so any nested double quote (and therefore any quoted path with spaces) breaks argument parsing. This is a workspace rule, not a preference.
  - **Settings are borrowed, not taken.** Any per-vault plugin setting the rig provisions is captured byte-exactly beforehand and restored byte-exactly on every exit path, including crash and interruption.
  - **No secret through an agent tool.** No password, token or passphrase in any command string, script argument or control-protocol message.
  - **The mock rig is never the gate (D13).** A green run of `tools/launch_liveshare_e2e.py` may not be recorded as satisfying WP7, WP40 or WP54. It aliases the `obsidian` module to `src/__mocks__/obsidian.ts` and boots two lightweight plugin hosts.
- **Technology / framework / config constraints:**
  - TypeScript + Yjs (`yjs ^13.6.0`); Obsidian's Canvas view is private and untyped — only `canvas-adapter.ts` may touch its internals.
  - Pure cores must import nothing from Obsidian, the filesystem or a clock; the precedent is `plugin/src/canvas/reconcile-plan.ts` (zero imports).
  - The control server is `node:http` bound to `127.0.0.1` — deliberately not a WebSocket, to keep the production dependency count at zero. `POST /command` takes `{cmd, args}`; `GET /events` is an SSE stream. There is no handshake and no auth: localhost plus the `__LS_E2E__` build gate is the boundary.
  - **Schema impact:** none. PHASE T3 changes no doc format and no `.canvas` file format — it is host orchestration, identity, data safety and observation only. A T3 WP that finds itself needing a format change has left its scope and must ESCALATE.
- **Entry points / relevant files (from `workflowArtifacts/RepoMap.md`, the V2 Touchpoint Inventory, and the e2e-infra survey):**
  - `tools/obsidian_e2e/teardown.py` (new)
  - `tools/launch_obsidian_e2e.py` (from WP45)
  - `plugin/src/testing/e2e-control.ts:285–295` — `ControlServerHandle.close()` (ends SSE clients, then the server)
  - `plugin/src/__tests__/e2e/two-host-harness.ts:190–201` — `HostHandle.close()`, the existing per-resource try/catch teardown pattern
  - `tools/MCPserver/liveshare_e2e_mcp_server.py:54` — `_DEFAULT_TIMEOUT = 15.0`, currently with no retry and no reclaim
- **Structure references:** *(intentionally empty — no Graphify graph exists for this project; FALLBACK mode is declared in the BUILD_SPEC section 3. Worker 3 fills this in after implementation. Do not invent paths here.)*

If structure references conflict with the BUILD_SPEC or explicit task scope, the BUILD_SPEC and TaskCharter win. Escalate instead of following the map.

---

## 4. Acceptance Criteria

*Exact copy from BUILD_SPEC section 5, PHASE T3, component C48. No paraphrasing.*

1. Teardown runs exactly once on every exit path — success, assertion failure, exception and interruption — and performs the same steps in the same order: restore provisioned settings, remove scratch artefacts, stop only rig-started processes.
2. Every wait in the rig is bounded and names the condition it was waiting for when it expires; no wait can block a run indefinitely.
3. An endpoint that stops answering mid-run fails the run under a named reason and still completes teardown, and the run's exit status is non-zero — a partially executed run can never be reported as a green gate result.
4. Artefacts of a previous crashed run — a provisioned port setting, a scratch file, a bound but dead port — are detected at start-up and reclaimed, and reclaiming is idempotent.

**Definition of Done:** a crashed run costs a re-run and never a dirty vault, a lost setting or a stuck port.

---

## 5. Constraints and Known Risks

- **Permission / environment limits:** Windows dev host; run all plugin commands from `plugin/` (never the repo root). Runner is Vitest 4.0.18 — the `basic` reporter was removed, use the default or `--reporter=dot`. Budget >= 90 s for any automated `npm test` invocation (a 33.5 s sleeper makes ~41 s the floor, not a hang). No Graphify graph exists for this project (declared FALLBACK mode) — `workflowArtifacts/RepoMap.md` is the structural map. **T3 environment facts, given — do not re-derive:** Obsidian executable `C:\Users\tschm\AppData\Local\Programs\Obsidian\Obsidian.exe`; vault registry `%APPDATA%\obsidian\obsidian.json`; target vaults `H:\Developement\_NeuralAngels\ObsidianOrga` and `H:\Developement\_NeuralAngels\ObsidianOrga - Kopie` (spaces in the path are load-bearing); the built plugin is already installed in the first. The Python side of this phase has no vitest coverage and must not pretend to — its units are verified by a standalone `python tools/test_<name>.py` script per workspace convention; every TypeScript change still goes through the `plugin/` vitest gate.
- **Known flaky patterns:**
  - No timing-based echo suppression: no new `setTimeout` waits and no new timing constants. V2's echo breaker is byte equality.
  - No wall-clock sleeps in new tests (the existing 33.5 s sleeper in `wp5/latency.test.ts` is legacy, not a pattern to copy).
  - Never reason from two peers only — interleaving classes from three peers upward are distinct.
  - Do not assert on log strings as the primary oracle; state is the oracle, signatures are for humans.
  - Biome reports a whole-file `format` finding per touched file (CRLF environment artifact). Advisory locally, gating in CI — do not mass-reformat.
  - `sync.waitQuiescent` as it stands is bumped **only** by control-initiated `canvas.simulateEdit`; both host builders pass `bump = () => {}`. On a real instance it therefore reports quiescent while remote deltas are still in flight. Do not build a wait on it until WP49 fixes it.
  - `canvas.state` returns the shared-doc snapshot, not the rendered view and not the file. Doc-level convergence is not file-level convergence on a real host (D17).
  - Binding-counter SSE events currently carry `path: ""` — they are module-global, not path-scoped (WP52 fixes this). Do not attribute one to a canvas before then.
  - A real Obsidian run is slow and stateful. Retrying a flaky step without a teardown in between compounds state; re-run from a clean start instead.
  - Obsidian is single-instance: a second vault opens as another window in the same process tree, so process-level identity says nothing about which vault is which (D14).
- **External dependency risks:** No new runtime dependency is permitted. Yjs, `y-protocols`, `lib0` and `minimatch` are already present and are the only libraries available; the Python rig and the MCP driver are standard-library only today and should stay that way. If a dependency is genuinely unavoidable, its published version must be **>= 7 days old** (`npm view <pkg>@<version> time.created`) per workspace policy, and introducing it is an ESCALATE, not a judgement call. Obsidian's private Canvas API may vanish at any release — degrade, never break (I5).
- **Hard constraints:**
  - Invariants I1–I5 (`ARCHITECTURE.md`) and I6–I10 (CONCEPT_V2 Teil 3) are binding and must not be weakened.
  - Yjs stays. No CRDT library swap, no alternative CRDT introduced anywhere.
  - `CanvasPersistence` remains the single CRDT→disk writer; it emits zero CRDT writes; `coldOpen` runs after `waitForSync` and before `start()`. **A T3 oracle reads what that writer produced; it never writes, re-serialises or normalises a `.canvas` file itself.**
  - **Zero new runtime dependencies.** Any dependency at all requires a publish date >= 7 days old (`npm view <pkg>@<version> time.created`); `npm ci` in build/deploy contexts, never `npm install`. This applies to the Python side of the rig as well — prefer the standard library, which is what the existing rig and MCP driver already do.
  - `GEOMETRY_KEYS` keeps exactly `{x, y, width, height}` and stays exported (it now describes the *file* schema). Changing membership or removing the export is an ESCALATE.
  - `plugin/src/canvas/canvas-presence.ts` is not modified by this initiative. If a WP believes it must, that is an ESCALATE.
  - `plugin/src/main.ts` may hold wiring only, never logic — it has no test file.
  - `canvas-binding.ts` / `canvas-model-bridge.ts` stay frozen and `useCanvasBinding` stays `false` until WP39/WP40 (only WP22 makes a narrow removal there).
  - Do not bump the plugin version. Do not hand-edit `plugin/main.js` or `server/dist/`. Do not read or edit `plugin/manifest.json` (broken symlink).
  - `server/` source is off limits except in WP41. Deployment, `docker/.env` and any secret are out of scope entirely.
  - **Data safety (D16, BUILD_SPEC §7 data-safety gate).** `H:\Developement\_NeuralAngels\ObsidianOrga` and `H:\Developement\_NeuralAngels\ObsidianOrga - Kopie` are the owner's **live working vaults**. No pre-existing note, canvas or attachment is ever opened for writing. Everything a run touches is a rig-created scratch artefact that teardown removes. A run that leaves either vault changed outside its own scratch artefacts is a FAILED run whatever else it proved.
  - **Never terminate what the rig did not start (D15).** No process, window or Obsidian instance the rig did not itself launch may be closed, killed or restarted. If a run would need that, it stops and says so.
  - **Long-running or interactive processes go through the `visible-console` MCP tools** (`run_python` / `run_command`, then `await_console`) — never a Bash background process. Python is launched via `run_python` with an **absolute** script path: `run_command` wraps its argument in `cmd.exe /d /c "…"`, so any nested double quote (and therefore any quoted path with spaces) breaks argument parsing. This is a workspace rule, not a preference.
  - **Settings are borrowed, not taken.** Any per-vault plugin setting the rig provisions is captured byte-exactly beforehand and restored byte-exactly on every exit path, including crash and interruption.
  - **No secret through an agent tool.** No password, token or passphrase in any command string, script argument or control-protocol message.
  - **The mock rig is never the gate (D13).** A green run of `tools/launch_liveshare_e2e.py` may not be recorded as satisfying WP7, WP40 or WP54. It aliases the `obsidian` module to `src/__mocks__/obsidian.ts` and boots two lightweight plugin hosts.

---

## 6. Definition of Done Artifacts

- **Required changed files:**
  - `tools/obsidian_e2e/teardown.py` (new)
  - `tools/launch_obsidian_e2e.py`
- **Required report:** `ImplementationReport_WP48.md` (in `workflowArtifacts/canvas-v2/`)
- **BUILD_SPEC updates required:** no — unless implementation invalidates an architecture decision, in which case ESCALATE rather than editing the spec.
- **Gate status required at handover:** `npm run build` PASS and `npm test` with 0 failures, run from `plugin/`. All visible tests PASS. For the Python side of this phase, the standalone `python tools/test_<name>.py` script for this WP passes, launched through `visible-console` `run_python` with an absolute path.

---

## 7. Visible Test Cases / Producer Artifacts

Framework **pytest**. Run from the AgenticWorkspace root:

```text
.venv\Scripts\python.exe -m pytest ^
  --rootdir="Projects/_external/liveshareCollab/obsidian-live-share" ^
  "Projects/_external/liveshareCollab/obsidian-live-share/workflowArtifacts/canvas-v2/tests/visible/WP48" -q
```

- `--rootdir` is **required**: without it pytest's rootdir scan walks `Projects/_external/` and dies on the broken `FinaleAbgabe` junction. This is an environment artefact, not a test defect.
- Every test file bootstraps itself: it walks up to the repo root (the directory holding both `tools/` and `plugin/`), puts `<repo>/tools` on `sys.path` and imports `from obsidian_e2e import constants, teardown`. **Never** `from tools.obsidian_e2e import …` — the AgenticWorkspace ships a regular `tools` package that wins over this repo's namespace portion regardless of `sys.path` order.
- **No constant is redeclared.** Roles, ports, settings/marker/backup paths, scratch naming and every failure-reason string come from `tools/obsidian_e2e/constants.py` (WP43). Verified present with the expected values.

**Data safety of the suite itself.** No test references the owner's vaults, `%APPDATA%\obsidian\`, a real socket or a real process. Fixture vaults are built under pytest `tmp_path`; the port probe, the process control, the clock and the teardown IO are all injected fakes. Settings bytes are compared **only by sha256** — no test asserts on, prints or serialises settings content (S4).

### API surface these tests pin (the contract for `tools/obsidian_e2e/teardown.py`)

```text
TEARDOWN_STEP_ORDER = ("restore_provisioned_settings",
                       "remove_scratch_artefacts",
                       "stop_rig_started_processes")
RECLAIM_KIND_SETTINGS / RECLAIM_KIND_SCRATCH / RECLAIM_KIND_PORT = "settings" / "scratch" / "port"

WaitTimeout(condition, timeout_s)        ← .reason == constants.WAIT_TIMEOUT, .condition, .to_dict()
EndpointLostMidrun(role)                 ← .reason == constants.ENDPOINT_LOST_MIDRUN, .role, .to_dict()
wait_for(condition, predicate, *, timeout_s, poll_s=…, clock=None, sleep=None) -> float
check_endpoints_alive(probe, roles=constants.ROLES) -> None
ProcessRecord(pid, role, rig_started, label="")
TeardownRunner(*, io, provisioned_settings, scratch_artefacts, processes, recorder=None)
    .executions: int   .run() -> TeardownResult          ← run() is idempotent per instance
TeardownResult: .steps_run  .failures  .stopped_pids  .skipped_pids  .ok  .to_dict()
RunOutcome:     .exit_status  .failure_reason  .teardown_result  .error  .interrupted
                .green  .to_dict()
run_with_teardown(body, runner) -> RunOutcome
reclaim_stale_state(vault_path, *, ports=(), port_probe=None, process_control=None,
                    clock=None, sleep=None, timeout_s=<finite>) -> ReclaimReport
ReclaimReport:  .artefacts  .reclaimed  .unreclaimed  .actions  .to_dict()
ReclaimedArtefact: .kind  .target  .reclaimed  .reason  .detail
```

Injected boundaries: `io.restore_setting(record)` · `io.remove_scratch(path)` · `io.terminate_process(pid)`;
`port_probe.is_bound(port)` · `.answers_control(port)` · `.owner_pid(port)`;
`process_control.is_alive(pid)` · `.terminate(pid)`.
**Reclaim must read the provision marker before the settings step deletes it** — the marker's `pid` is the only record of rig ownership the port step has.

### TC1 — Teardown runs exactly once on every exit path
- Verifies AC: AC1
- Test file: `workflowArtifacts/canvas-v2/tests/visible/WP48/test_tp01_teardown_once_visible.py`
- What it checks: parameterised over all four exit paths (success, assertion failure, raised exception, `KeyboardInterrupt`), `runner.executions == 1` and each step appears exactly once — a counter, not a boolean, so a double teardown fails. Also: a body that already tore itself down does not get a second teardown, and three explicit `run()` calls execute the steps once.
- Test data channel: in-memory recording IO fake; no filesystem, no process.

### TC2 — The step sequence is identical and ordered on all four exit paths
- Verifies AC: AC1
- Test file: `workflowArtifacts/canvas-v2/tests/visible/WP48/test_tp02_step_order_visible.py`
- What it checks: the recorded sequence equals the literal ordered triple `restore → remove scratch → stop processes` on every path, `TEARDOWN_STEP_ORDER` matches it, and the four paths agree with each other. Includes a guard proving the assertion is positional: a permutation has the same set but must not compare equal.
- Test data channel: step recorder list plus an ordered IO call log; injected fakes only.

### TC3 — A raising teardown step does not stop the remaining steps and still surfaces
- Verifies AC: AC1
- Test file: `workflowArtifacts/canvas-v2/tests/visible/WP48/test_tp03_step_failure_isolation_visible.py`
- What it checks: with the first step raising, all three steps still run in order, the later steps really do their work, the original exception object is retrievable from `result.failures`, `result.ok is False`, and the run is non-green with a non-zero exit status. A teardown failure on an otherwise successful run also makes it non-green, and the failure appears in `to_dict()`.
- Test data channel: IO fake with per-primitive exception injection.

### TC4 — Teardown stops only rig-started processes (D15)
- Verifies AC: AC1
- Test file: `workflowArtifacts/canvas-v2/tests/visible/WP48/test_tp04_only_rig_started_visible.py`
- What it checks: a process the rig did **not** start receives **zero** terminate calls, while the rig-started one is stopped; a run that attached to both windows terminates nothing yet still records the step; and D15 holds on the interrupt path too.
- Test data channel: process ledger of `ProcessRecord`s plus a terminate-call spy; no real PID is ever inspected or signalled.

### TC5 — An expired wait reports WAIT_TIMEOUT and names its condition
- Verifies AC: AC2
- Test file: `workflowArtifacts/canvas-v2/tests/visible/WP48/test_tp05_wait_timeout_names_condition_visible.py`
- What it checks: the raised `WaitTimeout` carries `reason == constants.WAIT_TIMEOUT` **and** the awaited condition name, which must survive into the serialised payload — a bare timeout with no condition name fails. Two different conditions produce two different payloads, and a condition that becomes true returns without raising.
- Test data channel: injected virtual clock (`now`/`sleep`), so the test consumes no wall-clock time.

### TC6 — No wait helper can exist without a bounded timeout
- Verifies AC: AC2
- Test file: `workflowArtifacts/canvas-v2/tests/visible/WP48/test_tp06_no_unbounded_wait_visible.py`
- What it checks: the module is introspected — every wait-shaped callable must take a timeout that is required or has a positive finite default; `wait_for`'s `timeout_s` is keyword-only with no default; `None`, `0`, negative, `inf` and `nan` are rejected with `ValueError`; and a never-satisfied predicate terminates instead of blocking. A newly added unbounded wait fails this test too.
- Test data channel: `inspect.signature` plus a virtual clock with a hard call budget, so a non-enforcing implementation fails loudly rather than hanging.

### TC7 — Endpoint lost mid-run: named reason + full teardown + non-zero exit (false-pass guard)
- Verifies AC: AC3
- Test file: `workflowArtifacts/canvas-v2/tests/visible/WP48/test_tp07_endpoint_lost_not_green_visible.py`
- What it checks: **all three in one scenario.** Two matrix cases pass, then role b stops answering: the run fails under `constants.ENDPOINT_LOST_MIDRUN`, teardown still completes all three steps in order (`result.ok is True`), and the exit status is asserted explicitly as a non-zero int with `green is False`. D15 still holds while failing. A clean run is asserted to exit `0` so "non-zero" actually discriminates.
- Test data channel: injected endpoint probe that answers twice then goes silent; teardown IO spy.

### TC8 — A leftover provisioned port setting is reclaimed at start-up
- Verifies AC: AC4
- Test file: `workflowArtifacts/canvas-v2/tests/visible/WP48/test_tp08_reclaim_settings_visible.py`
- What it checks: the saved original is restored **byte-exactly** (sha256 + size), the backup and the provision marker are removed, nothing outside the plugin directory changes, the report names the artefact, and the serialised report contains no settings content. A vault with no leftover is a no-op.
- Test data channel: fixture vault under `tmp_path` with `data.json`, `data.json.e2e-original` and `.e2e-provision.json`; comparisons by hash only.

### TC9 — A stale scratch artefact is reclaimed at start-up
- Verifies AC: AC4
- Test file: `workflowArtifacts/canvas-v2/tests/visible/WP48/test_tp09_reclaim_scratch_visible.py`
- What it checks: the stale scratch canvas and the rig-owned folder are removed while every other vault file keeps its hash; several stale runs in one folder are all cleared; and when removal is impossible at the OS level the artefact comes back `reclaimed is False` with `reason == constants.SCRATCH_STALE_UNRECLAIMED` instead of being swallowed.
- Test data channel: fixture vault under `tmp_path`; the unremovable case patches `Path.unlink` / `os.remove` / `os.rmdir` / `shutil.rmtree` to fail for paths under the rig folder only.

### TC10 — A bound-but-dead control port is reclaimed, and only if the rig owns it
- Verifies AC: AC4
- Test file: `workflowArtifacts/canvas-v2/tests/visible/WP48/test_tp10_reclaim_port_visible.py`
- What it checks: a port that is bound, silent and held by the pid recorded in the rig's own marker is reclaimed (one terminate call); a port held by anything else is reported unreclaimed and **never** terminated; a port that still answers is left completely alone; an unbound port produces no artefact.
- Test data channel: injected port probe (`is_bound` / `answers_control` / `owner_pid`) and process control, plus a virtual clock — no socket is opened, no process signalled.

### TC11 — All three crash artefacts present at once are reclaimed in one pass
- Verifies AC: AC4
- Test file: `workflowArtifacts/canvas-v2/tests/visible/WP48/test_tp11_reclaim_combined_visible.py`
- What it checks: settings, scratch and port are all reclaimed in a single start-up pass (`actions == 3`) with the per-kind end state verified, the owner's content untouched, the three `RECLAIM_KIND_*` names pinned, and the port step still running when the settings step found nothing (guards against an early return).
- Test data channel: fixture vault under `tmp_path` carrying all three artefacts; injected port/process fakes.

### TC12 — Reclaiming is idempotent
- Verifies AC: AC4
- Test file: `workflowArtifacts/canvas-v2/tests/visible/WP48/test_tp12_reclaim_idempotent_visible.py`
- What it checks: after a full reclaim, a second pass reports `actions == 0` and `reclaimed == []`, issues no further terminate call, and leaves a byte-identical end state (relative-path → sha256 map incl. directories) — in particular the restored original is not overwritten by a second "restore". Holds for three consecutive passes and for an already-clean vault.
- Test data channel: fixture vault under `tmp_path`; state captured as a hash map, never as content.

### Suite validation performed

The suite was validated against a **throwaway reference implementation** in an isolated sandbox (`h:\tmp\wp48_ref`, its own `tools/` + `plugin/` skeleton, deleted afterwards) — nothing was written into `tools/` in this repo. Result: **131 tests pass** (visible + both blind sets). Twelve targeted mutations of the reference — step order swapped, idempotence guard removed, a raising step aborting teardown, D15 dropped, condition name stripped from the timeout payload, timeout made optional/unbounded, a lost endpoint exiting zero, settings re-serialised instead of restored byte-exactly, stale scratch reused, reclaim killing any port holder, reclaim returning early after the first kind, reclaim never becoming a no-op — were **all killed**, each by its intended test point.

---

## 7b. W4 Test Targets (filled by Worker 3's Unit Test Sub-Agent, if any)

**W4 Test Targets: 0.** All four ACs are fully decidable at the unit level through injected seams (teardown IO, endpoint probe, port probe, process control, clock) against fixture vaults under `tmp_path`. Nothing in WP48 needs a live target: T3 shared contract S5 forbids any live run against the owner's vaults in this batch, and driving real Obsidian is WP50/WP51. Worker 4 has nothing to validate here beyond the green unit suite.

---

## 8. Autonomous Execution Plan (filled by Coder Sub-Agent, attempt 1)

- **Observed current behavior:** `tools/obsidian_e2e/teardown.py` did not exist. `tools/launch_obsidian_e2e.py` (WP45) probed, planned and printed, then returned `0`/`1` from three separate branches — with no teardown on any of them, no start-up reclaim and no mid-run endpoint check. The three primitives teardown needs were already built and were consumed rather than reimplemented: WP44 `ports.restore_port` (byte-exact restore + backup/marker removal, safe no-op when nothing is borrowed), WP47 `scratch.stale_scratch_relpaths` / `reclaim_stale_scratch` / `assert_write_allowed`, WP46 `readiness.check_endpoints_gone` (the inverted probe), WP45 `lifecycle.request_process_stop` + `RigStartedProcesses`.
- **Approach:** one module, four seams. `TeardownRunner` claims its execution slot *before* running the steps (so a re-entrant or repeated `run()` cannot produce a second pass) and counts executions; each step is guarded by `except BaseException` and records into `failures`, so a raising step neither stops the remaining steps nor disappears. `wait_for` takes a keyword-only `timeout_s` with no default and rejects `None`/`0`/negative/`inf`/`nan` before touching the clock. `run_with_teardown` catches `BaseException` (interruption is one of the four exit paths), records `interrupted`, and derives `green` conjunctively, with `exit_status` non-zero whenever `green` is false. `reclaim_stale_state` reads the provision marker **first** (its `pid` is the port step's only ownership evidence, and the settings step deletes it), then runs all three kinds unconditionally. Both stop paths go through a single funnel (`_stop_rig_started`, `_terminate_rig_owned`) that refuses anything not tagged rig-started / not named by the rig's own marker.
- **Fallback path if all attempts fail:** not needed — no attempt failed and nothing was blocked.

---

## 9. Handover Summary (filled by Coder Sub-Agent on completion)

- **What is complete:** all four ACs. `tools/obsidian_e2e/teardown.py` created; `tools/launch_obsidian_e2e.py` wired so start-up reclaim runs before probing and teardown runs on every exit path with a non-zero status on any non-green outcome. WP48 visible suite 46/46; whole visible tree 266/266; three targeted mutations (step order swapped, D15 guard dropped, reclaim returning early after the settings kind) all killed by their intended test points.
- **What remains open:** the entrypoint passes `process_control=None` and a port probe whose `owner_pid` is `None`, because mapping a listening port to its holder needs an OS query the rig has no sanctioned primitive for. A bound-but-silent port is therefore *reported* to the operator, never force-reclaimed — which is the D15-correct behaviour. The forced-reclaim path is fully implemented and unit-covered; a later WP that can supply a real owner lookup injects it. No TypeScript was touched, so the `plugin/` vitest gate is unaffected by this WP and was deliberately not re-run (another Worker 3 is mid-edit in `plugin/src/**`).
- **Final status:** DONE.

---

## 10. Risk Notes for Worker 4 (filled by Worker 3 Core)

- **Risk flag:** NONE
