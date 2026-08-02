# Implementation Report — WP45: Real-Obsidian launch + attach lifecycle

**Status:** `DONE`
**WP:** WP45 · **Phase:** P0 (PHASE T3) · **Attempt:** 2 (robustness pass)
**Charter:** `TaskCharter_WP45_ObsidianLaunchAttachLifecycle.md` (Charter Status → `DONE`)

---

## 1. Per-AC table

| AC | Requirement (abridged) | State | Where it lives / how it is proven |
|---|---|---|---|
| **AC1** | Per role: attach when the control endpoint answers, launch only when it does not; which happened is recorded **per role** in the run record | **MET** | `lifecycle.plan_endpoints()` probes every role first; `ensure_endpoints()` then acts. Record carries `roles[<role>]["mode"]` (`attach`/`launch`/`blocked`), `planned_mode`, `endpoint_answered`, `launched_by_rig`, `console_id`, `argv`, `uri`. Both-attach (TP01), both-launch (TP02) and mixed (TP03) are the same code path. |
| **AC2** | Never terminate/close/restart what the rig did not start; a run needing a restart **stops** under `RESTART_REQUIRED_OPERATOR` with an operator instruction (D15) | **MET** | `lifecycle.py` contains **no** process-stopping primitive. `RigStartedProcesses` is the only tag source and `request_process_stop()` the only door — it refuses any untagged handle. WP45 tags only consoles it opened itself, so every path refuses and `record["terminated"]` is `[]` on all five code paths (TP04 kill-spy). Restart case aborts *before* acting, with an instruction naming the vault (TP05). |
| **AC3** | Resolve the executable rather than assume it; open the vault by URI with the name URL-encoded; argv as a list | **MET** | `resolve_executable(*candidates, exists=…)` walks explicit candidate → `$OBSIDIAN_EXE` → pinned `constants.OBSIDIAN_EXE_PATH` → `%LOCALAPPDATA%`/`%PROGRAMFILES%` locations through an injectable existence check; nothing resolves → `LAUNCH_EXECUTABLE_MISSING`, no blind spawn (TP06/TP07). `obsidian_uri()` uses `quote(name, safe="")` → `ObsidianOrga%20-%20Kopie` (`%20`, never `+`); `build_launch_argv()` returns `[exe, uri]` as a list (TP08). |
| **AC4** | Every long-running process goes through `visible-console` (`run_*` → `await_console`); entrypoint referenced by absolute path | **MET** | `spawn_through_console()` is the single seam: `console.run_command(argv, title=…)` then `console.await_console(id, timeout=…)` on the id it got back. AST scan (TP09) proves no spawn primitive, no `shell=True` and no backgrounding flag exists anywhere in `lifecycle.py` or `launch_obsidian_e2e.py`. `ENTRYPOINT_PATH` is absolute in both the entrypoint and the run record (TP10). |
| **D13** | Mock-rig record structurally distinguishable from a real one; headless rig says it cannot satisfy the gate | **MET** | `lifecycle.RIG_KIND` = `launch_obsidian_e2e.RIG_KIND` = `real-obsidian`; every record stamped. `launch_liveshare_e2e.RIG_KIND` = `headless-mock`, `HEADLESS_BANNER` printed on every run and carried in `--help`. Mock alias seam untouched (TP11). |

---

## 2. Blocked Items

None. No `TOOL_REQUEST` was needed.

Two boundary notes for Worker 3, neither of which is a WP45 defect:

1. **No executing console seam exists inside a plain Python process.** The rig has no MCP client, so it cannot call `visible-console` itself. Rather than falling back to a direct spawn — precisely what AC4 forbids — the default `PlanOnlyConsole` records each launch and emits the ready-to-run MCP payload (`run_command` with the argv rendered as a *single-quoted PowerShell* line, so no nested double quote reaches the `cmd.exe /d /c "…"` wrapper). WP50/WP51 inject an executing seam; the interface it must satisfy is three methods: `run_command(argv, title=…) -> id`, `run_python(script, args=…, title=…) -> id`, `await_console(id, timeout=…)`.
2. **`PLUGIN_NOT_E2E_CAPABLE` is the live state of both vaults.** Contract §1.1. Surfaced as WP43's named state in the entrypoint's `preconditions` block, never as a launch failure or a timeout, and the entrypoint refuses to dispatch launches on it (overridable with `--ignore-plugin-state`) rather than starting windows that provably cannot answer.

---

## 3. Changes Made

```text
tools/
├── obsidian_e2e/
│   ├── lifecycle.py        ← NEW (WP45) — attach-vs-launch lifecycle, run record
│   └── __init__.py         ← +1 member line, +`lifecycle` in __all__ (no logic)
├── launch_obsidian_e2e.py  ← NEW (WP45) — the REAL-rig entrypoint (D13)
└── launch_liveshare_e2e.py ← MODIFIED — self-identification ONLY
```

### `tools/obsidian_e2e/lifecycle.py` (new)

- `ensure_endpoints(instances, probe=…, console=…, resolve_exe=…)` → the run record. Order is deliberate: **probe all → decide → act**, so both abort paths leave the console untouched and leave an attached window attached.
- `plan_endpoints(...)` — same decision logic without acting; backs the entrypoint's read-only default mode.
- `resolve_executable`, `obsidian_uri`, `build_launch_argv`, `default_probe` (TCP connect, read-only).
- `RigStartedProcesses` + `request_process_stop()` — the D15 funnel.
- `spawn_through_console()` — the one sanctioned seam (AC4).
- `PlanOnlyConsole` — non-spawning console that emits MCP payloads.
- `InstanceDescriptor` / `descriptors_for` / `descriptors_from_discovery` — consumes WP43's `DiscoveryResult`; descriptors are read mapping-shaped or attribute-shaped, so fixtures, `SimpleNamespace` doubles and WP44 results all work.

### `tools/launch_obsidian_e2e.py` (new)

`ENTRYPOINT_PATH` (absolute), `RIG_KIND = real-obsidian`, `REAL_BANNER`. Flow: WP43 read-only discovery → precondition report → probe → plan (default) or attach/launch (`--allow-launch`). Everything pointable at doubles: `--vault-a/-b`, `--port-a/-b`, `--roles`, `--exe`, `--registry`, `--provisioned-while-running`, `--probe-timeout`, `--ignore-plugin-state`, `--json`.

### `tools/launch_liveshare_e2e.py` (modified — self-identification only)

Added: module docstring D13 paragraph, `RIG_KIND` (**imported** from `constants`, never re-declared), `HEADLESS_BANNER`, the banner in the argparse description + epilog, and two banner lines printed at the top of `main()`. **Nothing else changed** — `OBSIDIAN_MOCK` (now line 77) and `--alias:obsidian={OBSIDIAN_MOCK}` (now line 133) are byte-identical, as are `preflight()`, `build_bundle()`, `run_bundle()` and `_terminate_child()`. Verified: `--help` renders, alias seam grep-confirmed.

### Constants discipline

**Zero constants owned by `constants.py` were redefined.** `lifecycle.py` and both entrypoints import every pinned value (`OBSIDIAN_EXE_PATH`, `OBSIDIAN_EXE_NAME`, `ROLE_A/B`, `ROLES`, `REAL_VAULT_PATH_A/B`, `REAL_CONTROL_PORT_A/B`, `REAL_CONTROL_PORTS`, `CONTROL_HOST`, `OBSIDIAN_OPEN_URI_TEMPLATE`, `LAUNCH_EXECUTABLE_MISSING`, `RESTART_REQUIRED_OPERATOR`, `PLUGIN_*`, `RIG_KIND_*`, `new_run_id()`). Only WP45-local record vocabulary (`MODE_ATTACH`/`MODE_LAUNCH`/`MODE_BLOCKED`, two timeout defaults) is declared here, and none of it appears in the shared contract.

### Data safety

No real process was started or terminated at any point. Nothing was written into either owner vault or `%APPDATA%\obsidian\`. Zero new dependencies (standard library only). Files outside the WP45 boundary — `plugin/src/canvas/**`, `plugin/src/files/**`, `plugin/src/sync/**`, `server/**`, `plugin/src/testing/e2e-control.ts` — were not touched. No test was deleted, edited or weakened.

---

## 4. Visible Test Results

```text
cd h:\...\obsidian-live-share
h:\My Code\AgenticWorkspace\.venv\Scripts\python.exe -m pytest workflowArtifacts/canvas-v2/tests/visible/WP45 -v

29 passed in 0.28s        ← 11 files / 29 tests, 0 failed, 0 skipped (attempt 1, first run)
```

| File | Tests | Result |
|---|---|---|
| `test_tp01_attach_both_visible.py` | 1 | PASS |
| `test_tp02_launch_both_visible.py` | 1 | PASS |
| `test_tp03_mixed_attach_launch_visible.py` | 1 | PASS |
| `test_tp04_attach_never_kill_spy_visible.py` | 1 | PASS |
| `test_tp05_restart_required_operator_visible.py` | 1 | PASS |
| `test_tp06_executable_missing_visible.py` | 2 | PASS |
| `test_tp07_executable_resolved_not_assumed_visible.py` | 3 | PASS |
| `test_tp08_vault_uri_encoding_argv_list_visible.py` | 4 | PASS |
| `test_tp09_no_rogue_process_spawn_visible.py` | 4 | PASS |
| `test_tp10_console_seam_and_absolute_entrypoint_visible.py` | 4 | PASS |
| `test_tp11_rig_kind_separation_d13_visible.py` | 7 | PASS |

**Regression:** WP43 visible suite re-run — `10 passed`. (The `__init__.py` edit is the only shared-file touch, and it is additive.)

**Blind sets** (`tests/blind_set1/WP45/`, `tests/blind_set2/WP45/`) were deliberately **not opened or run** — blind validation is Worker 3 Core's, and reading them would destroy the property that makes it worth anything.

**TypeScript gate:** WP45 changed **no** `.ts`/`.js` file, so `npm run build` / `npm test` are unaffected by it. They are not re-run here because another Worker 3 is mid-edit in `plugin/src/canvas/**` and `plugin/src/testing/e2e-control.ts`; a result now would report their in-flight state, not WP45's.

**Live smoke run (AC4 end-to-end, through the sanctioned tooling):**

```text
run_python(script=r"H:\...\obsidian-live-share\tools\launch_obsidian_e2e.py") → console a34b3f2b
await_console(a34b3f2b) → exit 1

[rig] rig_kind      : real-obsidian
[rig] mode          : plan-only (no --allow-launch)
[rig] role a vault  : 'ObsidianOrga'         exists=True plugin=PLUGIN_NOT_E2E_CAPABLE
[rig] role b vault  : 'ObsidianOrga - Kopie' exists=True plugin=PLUGIN_NOT_E2E_CAPABLE
[rig] role a endpoint: port=39431 answered=False mode=blocked launched_by_rig=False
[rig] role b endpoint: port=39432 answered=False mode=blocked launched_by_rig=False
[rig] terminated    : []  (D15: always empty)
[rig] ok            : False  reason=PLUGIN_NOT_E2E_CAPABLE
```

Exit 1 is the **correct** outcome: both vaults resolved from the registry, both control ports silent, the production build reported as the named state — and nothing launched, nothing terminated, nothing written.

---

## 5. Summary for Worker 3

WP45 is **DONE** on attempt 1, 29/29 visible green, no blocked items.

The three things worth carrying forward:

1. **D15 is now structural.** `lifecycle.py` has no stop primitive; the only door refuses any handle not tagged rig-started, and WP45 tags nothing it did not open itself. Any later WP that needs to stop something must go through `request_process_stop()` — adding a second door would be caught by the TP09 AST scan and the TP04 kill spy.
2. **The two rigs can no longer be confused.** Two entrypoints, two `rig_kind` values stamped into every record, two disjoint port pairs, and the headless rig now says in its banner and `--help` that it cannot satisfy the Teil-14 gate. The mock alias seam it needs is intact.
3. **`PLUGIN_NOT_E2E_CAPABLE` is the real blocker for a real run, and it is WP50/WP51's.** The lifecycle is complete and exercised; what is missing is an e2e-capable dev build in the vaults and an executing `visible-console` seam. Both are outside WP45's scope and both are named explicitly in the entrypoint's output rather than showing up later as a mysterious readiness timeout.

---

## 6. Attempt 2 — robustness

Two charter properties were honoured only in the shape the visible tests happened to
exercise. Both are now structural. **No test was modified.**

### 6.1 Per-role addressing is complete and order-independent

| Before | After |
|---|---|
| `roles` was keyed by role but *built* in the order the caller handed the descriptors over, and `attached` / `launched` / `needs_launch` / `restart_required` inherited that order | `plan_endpoints` indexes the descriptors by their own `role` field first, then walks them in `role_order()` — contract order, then any extra role sorted. Every list in the record derives from that walk |
| the entry carried `control_port` only, while the contract's record shape (charter §7) names the field `port` | the entry carries **both spellings of the same value**, next to `vault_name` / `vault_path`, so `role -> (vault, port)` is read off the record and never re-derived |

`role_order()` is now the single ordering rule — `descriptors_for()` and
`descriptors_from_discovery()` were duplicating it and now call it.

**Two orders, deliberately different.** *Acting* order stays the caller's: the caller may
have a reason to bring one vault up first and the rig has none to override it, so probing
and the launches that follow walk the supplied sequence (`_needs_launch_entries` keeps that
order). *Record* order is canonical: `roles` is keyed by role and emitted in
`role_order()`, and `attached` / `launched` / `needs_launch` / `restart_required` are too.
A description that changes when the same two instances arrive in the other order is one
nobody can diff.

This generalises rather than special-cases: nothing anywhere in the module reads a role out
of a position any more. A third role, a single-role run and a caller that iterates a `dict`
in insertion order all land on the same record.

### 6.2 "Starts nothing outside the sanctioned seam" is structural

The previous implementation *documented* the property and then kept, in the same file, the
two things that could break it:

- `RigStartedProcesses` + `request_process_stop()` — a stop funnel. Correct, refusing by
  default, and still process-termination machinery living in the module that owns starting.
  **Moved to `teardown.py`**, which is the module that owns the end of a run (WP48 item 1
  of the same pass allows a *rig-started* process to be stopped — there, not here).
  `launch_obsidian_e2e.py` now imports it from `teardown`.
- `_powershell_quote()` and a rendered `shell_type: powershell` command line in
  `PlanOnlyConsole`. A rendered command line is a launch vector one call site away from
  being used, and it is the artefact the workspace's own Windows-quoting rule warns about.
  **Removed**: the emitted MCP payload now carries the `argv` **list** verbatim and the
  driver hands it to whichever console surface it uses.

`ensure_endpoints` no longer holds a registry at all — the run record (`launched_by_rig` +
`console_id`) *is* the handover, and `rig_started_consoles` is derived from it. The result:
`lifecycle.py` contains no OS process primitive, no command string for an interpreter to
re-parse, and no vocabulary for ending a process — checked as a text scan over the whole
module for `subprocess`, `Popen`, `os.system`, `startfile`, `shell`, `powershell`,
`cmd.exe`, `taskkill`, `Stop-Process`, `pkill`, `killall`, `TerminateProcess`, `kill(`,
`kill `, `signal`, `SIGTERM`, `SIGKILL`, `spawnv`, `execv`: **zero hits**. The same scan
was applied to `launch_obsidian_e2e.py`, which still carried the word `taskkill` in a
docstring saying it had none — a lexical scan cannot tell a denial from a use, so the
sentence was rewritten. The only survivor of that family in either file is the record key
`terminated`, which is `[]` by construction and which TP01–TP06 require.

### 6.3 Result

Visible suite **266/266** (before this pass: 265 passed, 1 failed — the failure was WP47's,
see that report). WP45's own 29 tests unchanged and green. The entrypoint was smoke-run
end-to-end in plan-only mode against a `tmp` fixture vault: banner, preconditions, per-role
addressing, empty `terminated`, teardown and verdict all print correctly.
