# Task Charter — WP45: Real-Obsidian launch + attach lifecycle

**Charter Status:** `DONE`
**WP:** WP45
**Phase:** P0 (PHASE T3 group)
**task_mode:** `standard`
**Depends on:** WP43, WP44
**W4 Test Targets:** `0`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** both roles reach a reachable control endpoint without the owner losing an open window or unsaved state.
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 5, **PHASE T3**, component **C45 — Real-Obsidian launch and attach lifecycle** (work package WP45); phase **P0**.

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: create (`tools/obsidian_e2e/lifecycle.py`, `tools/launch_obsidian_e2e.py` — the real-rig entrypoint) + modify (`tools/launch_liveshare_e2e.py` — self-identification as the headless rig)
  - Responsibility: bring both vault windows into a state where their control endpoints are reachable, attaching to what is already open and launching only what is not.
  - Scope summary: attach to open windows, launch only what is missing
- **Out of scope / non-goals:**
  - Deciding readiness — a reachable port is not a ready instance (WP46).
  - Any form of closing, killing or restarting a window the rig did not start.
  - Replacing or deleting `tools/launch_liveshare_e2e.py`; it stays as the headless rig and is only made to identify itself as such.
- **Known interfaces / dependencies:**
  - Input: the two provisioned instance descriptors
  - Output: two reachable control endpoints plus a per-role record of whether the rig attached or launched
  - Depends on work packages: WP43, WP44

---

## 3. Architecture Context

*Task-local architecture guidance only.*

- **Component(s) being changed:** Real-Obsidian launch and attach lifecycle
- **Interfaces involved:**
  - Input: the two provisioned instance descriptors
  - Output: two reachable control endpoints plus a per-role record of whether the rig attached or launched
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
  - `tools/obsidian_e2e/lifecycle.py` (new)
  - `tools/launch_obsidian_e2e.py` (new — the real-rig entrypoint)
  - `tools/launch_liveshare_e2e.py:45` and `:101` — `OBSIDIAN_MOCK` and `--alias:obsidian=…`, the exact seam that makes that script the mock rig
  - `tools/launch_liveshare_e2e.py:126–158` — `_terminate_child()`, the existing terminate→wait→kill pattern (a model for rig-started processes only)
- **Structure references:** *(intentionally empty — no Graphify graph exists for this project; FALLBACK mode is declared in the BUILD_SPEC section 3. Worker 3 fills this in after implementation. Do not invent paths here.)*

If structure references conflict with the BUILD_SPEC or explicit task scope, the BUILD_SPEC and TaskCharter win. Escalate instead of following the map.

---

## 4. Acceptance Criteria

*Exact copy from BUILD_SPEC section 5, PHASE T3, component C45. No paraphrasing.*

1. Per role the rig attaches to an already-open vault window when its control endpoint answers and launches Obsidian for that vault only when it does not; which of the two happened is recorded per role in the run record.
2. The rig never terminates, closes or restarts a process or window it did not itself start; a run that would require restarting an already-open vault stops with an explicit instruction to the operator instead of doing it (D15).
3. Launching resolves the executable path rather than assuming it and opens the vault by URI with the vault name URL-encoded, so a vault path containing spaces is handled correctly.
4. Every long-running or interactive process the rig starts is started through the workspace `visible-console` tools (`run_python` / `run_command`, then `await_console`) and never as a detached background shell process; the rig entrypoint is a Python script invoked by absolute path.

**Definition of Done:** both roles reach a reachable control endpoint without the owner losing an open window or unsaved state.

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
  - `tools/obsidian_e2e/lifecycle.py` (new)
  - `tools/launch_obsidian_e2e.py` (new)
  - `tools/launch_liveshare_e2e.py`
- **Required report:** `ImplementationReport_WP45.md` (in `workflowArtifacts/canvas-v2/`)
- **BUILD_SPEC updates required:** no — unless implementation invalidates an architecture decision, in which case ESCALATE rather than editing the spec.
- **Gate status required at handover:** `npm run build` PASS and `npm test` with 0 failures, run from `plugin/`. All visible tests PASS. For the Python side of this phase, the standalone `python tools/test_<name>.py` script for this WP passes, launched through `visible-console` `run_python` with an absolute path.

---

## 7. Visible Test Cases / Producer Artifacts

**Runner:** pytest. From the AgenticWorkspace root:

```text
.venv\Scripts\python.exe -m pytest <test path> --rootdir=Projects\_external\liveshareCollab\obsidian-live-share
```

> `--rootdir` is **required**: a broken junction at `Projects/_external/FinaleAbgabe` makes
> pytest's rootdir discovery abort with `FileNotFoundError` when it walks up from the
> workspace root. This is a pre-existing environment fault, not a test fault.

**Import form** (T3_SharedContract, import rule) — every test uses exactly this; never
`tools.obsidian_e2e`:

```python
TOOLS_DIR = Path(__file__).resolve().parents[5] / "tools"
sys.path.insert(0, str(TOOLS_DIR))
from obsidian_e2e import constants, lifecycle
```

### Contract these tests pin (implement these names)

`tools/obsidian_e2e/lifecycle.py`:

| Symbol | Shape |
|---|---|
| `RIG_KIND` | `== constants.RIG_KIND_REAL_OBSIDIAN` |
| `obsidian_uri(vault_name) -> str` | `"obsidian://open?vault=" + quote(name, safe="")` — literal, never "smart" |
| `resolve_executable(candidate=None, *, exists=os.path.isfile) -> str \| None` | candidate first, then `constants.OBSIDIAN_EXE_PATH`; each is tested with `exists`; nothing found → `None` |
| `build_launch_argv(executable, vault_name) -> list[str]` | exactly `[executable, uri]`, a **list**, never joined |
| `spawn_through_console(console, argv, *, title) -> console_id` | the **one** sanctioned seam — the only function allowed to touch a spawn primitive; calls `console.run_command(argv, title=…)` then `console.await_console(cid)` |
| `ensure_endpoints(instances, *, probe, console, resolve_exe=None) -> dict` | the run record |

Injected seams: `probe(role, port) -> bool`; `console` with
`run_command(argv, *, title) -> cid`, `run_python(script, *, args=None, title) -> cid`,
`await_console(cid, *, timeout=None)`. Instance descriptors are duck-typed with
`role`, `vault_path`, `vault_name`, `control_port`, `port_provisioned_while_running`.

Decision rule per role: endpoint answers → `attach`; silent and
`port_provisioned_while_running` → abort `RESTART_REQUIRED_OPERATOR`; silent otherwise →
`launch`.

Run record (plain JSON-serialisable dict):

```text
{"rig_kind", "roles": {<role>: {"role","mode","port","vault_name",
                                "launched_by_rig","console_id"}},
 "ok", "reason", "operator_instruction", "entrypoint", "terminated": []}
```

`mode` ∈ `{"attach","launch"}` (`None` for a role never reached). `terminated` is
**always** `[]` — D15 is recorded, not merely respected. `entrypoint` is the absolute path
of `tools/launch_obsidian_e2e.py`.

`tools/launch_obsidian_e2e.py`: `ENTRYPOINT_PATH` (absolute), `RIG_KIND`, `REAL_BANNER`,
`main()`, `__main__` guard.
`tools/launch_liveshare_e2e.py` (modify only): add `RIG_KIND == "headless-mock"` and
`HEADLESS_BANNER` (must contain "headless", "mock", "cannot satisfy", "gate"), and use the
banner as the argparse `description`. The `--alias:obsidian=` mock seam at `:101` stays.

> **Data-safety property of the suite.** Every WP45 test file carries an autouse
> `_no_real_process` fixture that replaces `os.system/popen/kill/startfile/exec*` and
> `subprocess.Popen/run/call/check_call/check_output` with a trip-wire raising a
> `BaseException` subclass. No test can start or end a real process even against a wrong
> implementation. Do not remove it.

---

### TC1 — Both control endpoints answer → both roles recorded as `attach`

- Verifies AC: AC1
- Test file: `workflowArtifacts/canvas-v2/tests/visible/WP45/test_tp01_attach_both_visible.py`
- What it checks: with `probe` returning `True` for both roles, the run record marks every role `mode="attach"`, `launched_by_rig=False`, `console_id=None`; both roles are probed on `REAL_CONTROL_PORT_A/B`; the console seam is never engaged; `resolve_exe` is never consulted; `terminated == []`.
- Test data channel: injected `probe` callable + fake console recorder; descriptors are `SimpleNamespace` values.

### TC2 — No endpoint answers → both roles recorded as `launch`

- Verifies AC: AC1, AC3
- Test file: `workflowArtifacts/canvas-v2/tests/visible/WP45/test_tp02_launch_both_visible.py`
- What it checks: `mode="launch"` and `launched_by_rig=True` per role in the record; exactly one spawn and one await per role through the console seam; each argv is a list whose `argv[0]` is the resolved executable and whose last element is that role's own vault URI (`ObsidianOrga`, `ObsidianOrga%20-%20Kopie`).
- Test data channel: `probe` returning `False`; executable is an empty file under `tmp_path`.

### TC3 — Mixed run: role a attaches, role b launches

- Verifies AC: AC1
- Test file: `workflowArtifacts/canvas-v2/tests/visible/WP45/test_tp03_mixed_attach_launch_visible.py`
- What it checks: the per-role record distinguishes the two outcomes in one run; exactly one spawn occurs and it carries role b's percent-encoded vault URI; the attached role keeps `console_id=None`; no unencoded vault name appears in any argv element.
- Test data channel: role-sensitive `probe` (`role == ROLE_A`), fake console.

### TC4 — Attach-never-kill: zero terminations on every code path (D15)

- Verifies AC: AC2
- Test file: `workflowArtifacts/canvas-v2/tests/visible/WP45/test_tp04_attach_never_kill_spy_visible.py`
- What it checks: a spy replaces `os.kill/system/popen/startfile` and `subprocess.Popen/run/call/check_call/check_output` and records every call; the rig is then driven through all five paths (both-attach, both-launch, mixed, restart-required, executable-missing) and the recorded termination set **and** spawn set must be empty on each; no console command contains a kill token (`taskkill`, `Stop-Process`, `pkill`, …); `record["terminated"] == []` every time.
- Test data channel: monkeypatched process primitives + fake console; PIDs are never real.

### TC5 — A run needing a restart stops and instructs the operator

- Verifies AC: AC2
- Test file: `workflowArtifacts/canvas-v2/tests/visible/WP45/test_tp05_restart_required_operator_visible.py`
- What it checks: a silent endpoint whose port was provisioned while Obsidian was already running aborts with `reason == constants.RESTART_REQUIRED_OPERATOR`, `ok is False`, and a non-empty `operator_instruction` naming the vault and asking a human to restart/reopen it; the console is never engaged; the role is not marked launched; the already-attached role is left attached, not torn down.
- Test data channel: descriptor flag `port_provisioned_while_running=True`; injected probe.

### TC6 — Missing executable → `LAUNCH_EXECUTABLE_MISSING`, not a crash

- Verifies AC: AC3
- Test file: `workflowArtifacts/canvas-v2/tests/visible/WP45/test_tp06_executable_missing_visible.py`
- What it checks: `resolve_executable` returns `None` when the existence predicate finds nothing (with and without an explicit candidate); `ensure_endpoints` then returns `ok=False` with the pinned reason instead of raising or spawning an unresolved path; no console call is made and no role is marked launched.
- Test data channel: `exists=lambda p: False`; `resolve_exe=lambda: None`.

### TC7 — The executable is resolved, not assumed

- Verifies AC: AC3
- Test file: `workflowArtifacts/canvas-v2/tests/visible/WP45/test_tp07_executable_resolved_not_assumed_visible.py`
- What it checks: the resolver actually calls the existence predicate and the pinned `OBSIDIAN_EXE_PATH` appears among the probed candidates; a relocated installation supplied as a candidate wins over the pinned default; and the path that came out of resolution — not the pinned constant — is what `argv[0]` carries into the console seam.
- Test data channel: recording `exists` predicate; a relocated "executable" under `tmp_path`.

### TC8 — Vault name URL-encoded, argv is a list

- Verifies AC: AC3
- Test file: `workflowArtifacts/canvas-v2/tests/visible/WP45/test_tp08_vault_uri_encoding_argv_list_visible.py`
- What it checks: `obsidian_uri("ObsidianOrga - Kopie") == "obsidian://open?vault=ObsidianOrga%20-%20Kopie"` exactly — spaces become `%20`, never `+`, and no raw space survives; a name without specials is left alone; `build_launch_argv` returns a `list[str]` with no pre-quoted or `cmd`-wrapped element; the argv the console receives is that same list.
- Test data channel: pure string construction plus one fake-console round trip.

### TC9 — No process spawn outside the sanctioned seam (structural)

- Verifies AC: AC4
- Test file: `workflowArtifacts/canvas-v2/tests/visible/WP45/test_tp09_no_rogue_process_spawn_visible.py`
- What it checks: an AST scan of `lifecycle.py` and `launch_obsidian_e2e.py` finds every call to `subprocess.Popen/run/call/check_call/check_output`, `os.system/popen/startfile/exec*/spawn*` and asserts each one is lexically inside `spawn_through_console`; `shell=True` appears nowhere; no detached-launch token (`start_new_session`, `DETACHED_PROCESS`, `CREATE_NO_WINDOW`, `creationflags`, `nohup`) appears in either file.
- Test data channel: source text and AST only — nothing is executed.

### TC10 — `run_*` → `await_console`, and an absolute rig entrypoint

- Verifies AC: AC4
- Test file: `workflowArtifacts/canvas-v2/tests/visible/WP45/test_tp10_console_seam_and_absolute_entrypoint_visible.py`
- What it checks: for a two-role launch the console call sequence is exactly `run_command, await_console, run_command, await_console` and each await names the id its spawn returned (an unawaited console is a detached background process); `launch_obsidian_e2e.ENTRYPOINT_PATH` is absolute and equals `<repo>/tools/launch_obsidian_e2e.py`; the run record's `entrypoint` is absolute; no console call receives a relative target path.
- Test data channel: fake console recorder + module import.

### TC11 — D13: the mock rig can never be mistaken for the real one

- Verifies AC: AC1 (run record), AC4; decision D13
- Test file: `workflowArtifacts/canvas-v2/tests/visible/WP45/test_tp11_rig_kind_separation_d13_visible.py`
- What it checks: the two rig-kind values are the pinned distinct strings `real-obsidian` / `headless-mock`; each entrypoint declares its own (`launch_obsidian_e2e.RIG_KIND`, `launch_liveshare_e2e.RIG_KIND`, `lifecycle.RIG_KIND`); a real run record is stamped `real-obsidian`; `launch_liveshare_e2e.HEADLESS_BANNER` and its `--help` output both self-identify as the headless mock rig and state it **cannot satisfy** the Teil-14 gate; the `--alias:obsidian=` / `__mocks__/obsidian.ts` seam is still present (D13 keeps the mock rig, it is not ripped out); the real entrypoint contains no mock alias.
- Test data channel: module imports, `--help` capture via `capsys`, source text reads.

---

## 7b. W4 Test Targets (filled by Worker 3's Unit Test Sub-Agent, if any)

**W4 Test Targets: 0.**

All four ACs are fully covered at unit level with injected seams. There is deliberately no
W4 live target: T3_SharedContract S5 forbids any live run against the owner's vaults in this
batch, and driving real Obsidian is WP50/WP51. A W4 "verify by launching the rig" step would
violate the data-safety gate, not strengthen it.

---

## 8. Autonomous Execution Plan (filled by Coder Sub-Agent, attempt 1)

- **Observed current behavior:** only `tools/launch_liveshare_e2e.py` existed — the headless mock rig, which aliases `obsidian` to `plugin/src/__mocks__/obsidian.ts` and identified itself as nothing in particular. There was no attach path, no launch path and no run record. Verified on the host: Obsidian is **not running** (0 processes), so "nothing to attach to" is the normal path, and both vaults carry a **production** plugin build → `PLUGIN_NOT_E2E_CAPABLE`.
- **Approach:** `tools/obsidian_e2e/lifecycle.py` probes every role *first*, then decides, then acts — so both abort paths (`RESTART_REQUIRED_OPERATOR`, `LAUNCH_EXECUTABLE_MISSING`) stop before anything is started. D15 is structural, not careful: the module holds no process-stopping primitive at all, and `request_process_stop()` refuses any handle `RigStartedProcesses` has not tagged. `tools/launch_obsidian_e2e.py` is the new real-rig entrypoint (absolute `ENTRYPOINT_PATH`, `rig_kind=real-obsidian`, read-only by default). `tools/launch_liveshare_e2e.py` gained self-identification only; its `--alias:obsidian=` seam is untouched.
- **Fallback path if all attempts fail:** not needed — attempt 1 was green.

---

## 9. Handover Summary (filled by Coder Sub-Agent on completion)

- **What is complete:** all four ACs. 29/29 WP45 visible tests pass; WP43's 10 visible tests still pass. The real entrypoint was smoke-run on the host through `visible-console` `run_python` by absolute path: it resolved both vaults from the registry, reported `PLUGIN_NOT_E2E_CAPABLE` as the named precondition, launched nothing and terminated nothing.
- **What remains open:** the rig cannot call MCP itself, so the default console seam (`PlanOnlyConsole`) emits the exact `visible-console` payloads instead of spawning — an executing seam is injected by WP50/WP51, which also install the e2e-capable dev build that makes a real endpoint possible at all. Readiness is WP46's, not decided here.
- **Final status:** DONE

---

## 10. Risk Notes for Worker 4 (filled by Worker 3 Core)

- **Risk flag:** NONE
