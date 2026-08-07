# Implementation Report — WP43: Vault registry + Obsidian instance discovery

**Status:** `DONE`
**WP:** WP43 · **Phase:** P0 (PHASE T3 group) · **Attempt:** 1
**Visible tests:** 10 passed / 0 failed
**Data safety:** no write of any kind was performed in either live vault, in `%APPDATA%\obsidian\`, or anywhere outside the three new module files. No `data.json` content was read, printed or logged.

---

## Per-AC table

| AC | Requirement (abridged) | State | How it is satisfied |
|---|---|---|---|
| **AC1** | Vault path → registry entry for spaces / case-only difference / trailing separator; absent vault gives an explicit named failure, not a fallback guess | **MET** | `resolve_vault()` keys both sides on `os.path.normcase(os.path.abspath(p))`. `abspath` drops the trailing separator and normalises separators; `normcase` folds case; spaces need no handling at all (they only ever break *shell quoting*, never path comparison). A junction/symlink second pass on `os.path.realpath` runs **only** if the primary key misses. No match → `VAULT_NOT_IN_REGISTRY` with `registry_id`, `vault_name` and `resolved_path` all `None` — nothing from the registry is attributed to an unregistered path. A registry entry whose directory no longer exists → `VAULT_PATH_MISSING`. Matching performs zero filesystem access, so a deleted vault still resolves and is reported as missing rather than as unregistered. |
| **AC2** | Per role: plugin present? enabled? "present but disabled" a distinct named state | **MET** | `inspect_plugin()` returns `present` / `enabled` / `e2e_capable` plus a single `state`. Presence = `.obsidian/plugins/live-share/main.js` exists. Enablement = `PLUGIN_ID` listed in `.obsidian/community-plugins.json`. Precedence: missing → `PLUGIN_MISSING`; present + not listed → `PLUGIN_PRESENT_BUT_DISABLED` (its own constant, not a substring or subtype of the missing one); present + enabled + no e2e markers → `PLUGIN_NOT_E2E_CAPABLE`; else `PLUGIN_OK`. `data.json` is deliberately never read — AC2 does not need it and it holds a live production secret (S4). |
| **§1.1** | `PLUGIN_NOT_E2E_CAPABLE` modelled as its own state, never conflated with "port not provisioned" | **MET** | Detected by the absence of **all** of `E2E_BUILD_MARKERS = ("e2eControlPort", "LIVESHARE_E2E", "e2e-control")` in the installed `main.js`. Only marker *presence* is ever reported; no bundle content is returned or logged. Verified empirically: both live vaults report `plugin_present=True, plugin_enabled=True, plugin_e2e_capable=False` → `PLUGIN_NOT_E2E_CAPABLE`, exactly as contract §1.1 predicts. |
| **AC3** | Report whether Obsidian runs on the host; never attribute a running process to a vault | **MET** *(no visible test at task start; one landed mid-run and passes)* | `is_obsidian_running()` returns `(running, known)` — a host-level boolean. The default lister collects **process names only**: the pid sits right there in the ToolHelp `PROCESSENTRY32W` struct and is deliberately dropped, so this module has no pid to attribute even if it wanted one. Injected listers may carry pids/command lines; only `name` is ever read. `VaultInstance` has no pid field, no command-line field and no "this window is mine" flag, and `DiscoveryResult.obsidian_running` is a single host-level bool, not a per-role one. The registry's `open` flag is also **not** exposed, for the same reason: "which vault is open" is an attribution claim reserved for WP46 (D14 — Obsidian is single-instance, so a second vault is another window in the same process tree). |
| **AC4** | No writes, structurally rather than incidentally: no write operation exposed, no file opened for writing, no process started | **MET** | Every filesystem read in `vaults.py` funnels through one helper, `_read_bytes(path)`, whose mode is the hardcoded literal `"rb"`. It takes **no mode parameter**, so no caller can turn it into a write. There is no other `open(` in the module, no `shutil`, no `os.remove`/`mkdir`/`rename`/`unlink`, and no `subprocess` — host liveness uses a read-only `ctypes` ToolHelp kernel snapshot precisely so that nothing is ever started (shelling out to `tasklist`/`wmic` would have started a process and broken this AC). `__all__` contains no write-shaped name. Audit cost: one grep per line for `open(`, `subprocess`, `Popen`, `shutil`. |

---

## Blocked Items

None. No escalation, no `TOOL_REQUEST`, no AC partially met.

---

## Changes Made (file level)

| File | Change | Notes |
|---|---|---|
| `tools/obsidian_e2e/__init__.py` | **rewritten** (was a throwaway stub) | Makes `obsidian_e2e` a **regular** package, which is what contract §0.2's sanctioned import form requires. Docstring records the sanctioned form and the rule that `obsidian-live-share/tools/` must never get its own `__init__.py`. |
| `tools/obsidian_e2e/constants.py` | **rewritten** (was a throwaway stub with ~15 values) | The single owning module for the batch. Contract §§1, 2, 3, 4, 5, 6, 6.1, 6.2, 7, 8, 9 transcribed verbatim. |
| `tools/obsidian_e2e/vaults.py` | **new** | The read-only probe: `resolve_vault`, `inspect_plugin`, `is_obsidian_running`, `discover_instances`, `default_process_lister`, plus four frozen dataclasses. |

Both pre-existing files carried the banner `"""THROWAWAY reference ... used only to validate the WP43 spec-first tests. DELETE ME."""` — they were the test sub-agent's scaffolding, and replacing them was the intended handover.

**Nothing else was touched.** No file under `plugin/src/canvas/**`, `plugin/src/files/**`, `plugin/src/sync/**` or `server/**` was modified, no test anywhere was deleted, weakened or edited, and no visible test file was changed.

### Public surface (what WP44–WP49 consume)

```text
vaults.resolve_vault(vault_path, registry_path=None)          -> VaultResolution
vaults.inspect_plugin(vault_path)                             -> PluginInspection
vaults.is_obsidian_running(process_lister=None)               -> (running, known)
vaults.discover_instances(vault_paths, registry_path=None,
                          process_lister=None)                -> DiscoveryResult
vaults.default_process_lister()                               -> names only, starts nothing
```

Every path is injectable — registry path, vault paths and process lister are all arguments — so the module runs unchanged against a fixture vault. Nothing here can only look at the owner's real vault.

---

## Visible Test Results

```text
10 passed in 0.32s
```

| Test file | Result |
|---|---|
| `test_ac1_spaces_visible.py` | PASS |
| `test_ac1_case_visible.py` | PASS |
| `test_ac1_trailing_sep_visible.py` | PASS |
| `test_ac1_absent_named_failure_visible.py` | PASS |
| `test_ac2_plugin_state_per_role_visible.py` | PASS |
| `test_ac2_disabled_distinct_from_missing_visible.py` | PASS (2 tests) |
| `test_ac3_no_process_vault_attribution_visible.py` | PASS |
| `test_ac4_structural_readonly_visible.py` | PASS (2 tests) |

No visible test was modified, and none contradicts the charter.

### ⚠ Environment note — the prescribed command needs one extra flag

`pytest` run from the workspace root aborts during collection, **before reaching any WP43 test**:

```text
FileNotFoundError: [WinError 3] ... 'H:\My Code\AgenticWorkspace\Projects\_external\FinaleAbgabe'
```

`Projects/_external/FinaleAbgabe` is a **broken symlink** to `/e/Dateien/Tom/THM/MIB5/FinaleAbgabe` on an absent drive. Pytest 8 `samefile`s its way down the argument path and dies on it. This is a pre-existing workspace defect, entirely unrelated to WP43 — it aborts the *session*, not a test. Two working invocations:

```bash
# from the workspace root, as prescribed, plus one ignore
cd "h:\My Code\AgenticWorkspace" && .venv\Scripts\python.exe -m pytest \
  "Projects\_external\liveshareCollab\obsidian-live-share\workflowArtifacts\canvas-v2\tests\visible\WP43" -v \
  --ignore="Projects\_external\FinaleAbgabe"

# or from the repo root, no flag needed
cd "h:\My Code\AgenticWorkspace\Projects\_external\liveshareCollab\obsidian-live-share" && \
  "h:\My Code\AgenticWorkspace\.venv\Scripts\python.exe" -m pytest workflowArtifacts/canvas-v2/tests/visible/WP43 -v
```

Both give 10 passed. Every later WP in this batch will hit the same collection abort — the flag is worth putting in the batch's run instructions rather than rediscovering per WP.

### Real-environment verification (read-only, S5-permitted)

Run through `visible-console` `run_python` with an absolute path, per the workspace rule. It read the real registry and the two real vault paths, wrote nothing, started nothing, and printed no file content:

```text
registry path      : C:\Users\tschm\AppData\Roaming\obsidian\obsidian.json
registry available : True
obsidian running   : False (known: True)

role a : ObsidianOrga          registry_id 703aa794cc73a117  present=True enabled=True e2e_capable=False -> PLUGIN_NOT_E2E_CAPABLE
role b : ObsidianOrga - Kopie  registry_id 55a4253eb7a90dde  present=True enabled=True e2e_capable=False -> PLUGIN_NOT_E2E_CAPABLE

AC3 audit role a: process-ish fields = []
AC3 audit role b: process-ish fields = []
```

Two findings the rest of the batch should carry:

1. **Contract §1.1 is empirically confirmed.** Both live vaults hold a production build with zero e2e markers. WP46 readiness against these vaults cannot succeed — not because a port is unprovisioned, but because there is no control server to provision a port *for*. The dev-build install (WP50/WP51, or B9b per §0.1) is the unblocking step, and `PLUGIN_NOT_E2E_CAPABLE` is the state that says so.
2. **Obsidian was not running on the host** at implementation time (cross-checked independently: `Get-Process Obsidian` → 0; the ToolHelp lister enumerated 424 processes, so `False` is a real observation and not a broken probe). The batch brief assumed both vaults were open — WP45's attach-vs-launch branch should not assume an attachable instance exists.

---

## Constants defined in `constants.py`

WP44–WP49 import these and must never redefine any of them.

**§1 environment:** `OBSIDIAN_EXE_PATH`, `OBSIDIAN_EXE_NAME`, `VAULT_REGISTRY_REL`, `VAULT_REGISTRY_PATH`, `REAL_VAULT_PATH_A`, `REAL_VAULT_PATH_B`
**§2 roles/ids:** `ROLE_A`, `ROLE_B`, `ROLES`, `REAL_VAULT_PATHS`, `CLIENT_ID_A`, `CLIENT_ID_B`, `CLIENT_IDS`, `CANVAS_DOC_ID_PREFIX`, `canvas_doc_id()`
**§3 ports:** `HEADLESS_RIG_PORT_A`, `HEADLESS_RIG_PORT_B`, `REAL_CONTROL_PORT_A`, `REAL_CONTROL_PORT_B`, `REAL_CONTROL_PORTS`
**§4 plugin surface:** `SETTINGS_PORT_KEY`, `PLUGIN_ID`, `PLUGIN_DIR_REL`, `PLUGIN_DATA_REL`, `COMMUNITY_PLUGINS_REL`, `PLUGIN_MAIN_REL`, `SETTINGS_BACKUP_REL`, `PROVISION_MARKER_REL`, `PROVISION_MARKER_FIELDS`, `E2E_BUILD_MARKERS`
**§5 scratch:** `SCRATCH_FOLDER`, `SCRATCH_PREFIX`, `SCRATCH_EXT`, `FINGERPRINT_EXCLUDED`, `new_run_id()`, `scratch_rel_path()`
**§6 control protocol:** `CONTROL_HOST`, `CONTROL_COMMAND_PATH`, `CONTROL_EVENTS_PATH`, `CMD_SESSION_INFO`, `CMD_CANVAS_OPEN`, `CMD_CANVAS_STATE`, `CMD_CANVAS_BINDING`, `CMD_CANVAS_SIMULATE_EDIT`, `CMD_CANVAS_SET_FLAG`, `CMD_SYNC_WAIT_QUIESCENT`, `SYNC_WAIT_QUIESCENT_DEFAULT_TIMEOUT_MS`
**§6.1 new commands:** `CMD_SCRATCH_CREATE`, `CMD_SCRATCH_REMOVE`, `CMD_CANVAS_FILE`
**§6.2 `session.info` fields:** `SESSION_INFO_CLIENT_ID`, `SESSION_INFO_ROLE`, `SESSION_INFO_ROOM_ID`, `SESSION_INFO_CONNECTED`, `SESSION_INFO_VAULT_ID`, `SESSION_INFO_VAULT_NAME`, `SESSION_INFO_VAULT_PATH`, `SESSION_INFO_PLUGIN_BUILD`, `SESSION_INFO_CANVAS_SURFACE`, `SESSION_INFO_FIELDS`
**§7 failure reasons:** `VAULT_NOT_IN_REGISTRY`, `VAULT_PATH_MISSING`, `PLUGIN_MISSING`, `PLUGIN_PRESENT_BUT_DISABLED`, `PLUGIN_NOT_E2E_CAPABLE`, `SETTINGS_RESTORE_MISMATCH`, `PROVISION_CONFLICT`, `LAUNCH_EXECUTABLE_MISSING`, `RESTART_REQUIRED_OPERATOR`, `READINESS_TIMEOUT`, `IDENTITY_SAME_VAULT`, `IDENTITY_UNKNOWN_VAULT`, `ROOM_MISMATCH`, `ENDPOINT_LOST_MIDRUN`, `FINGERPRINT_MISMATCH`, `SCRATCH_STALE_UNRECLAIMED`, `DOC_CONVERGED_FILE_DIVERGED`, `WAIT_TIMEOUT`, `FAILURE_REASONS`
**§8 rig kind:** `RIG_KIND_HEADLESS_MOCK`, `RIG_KIND_REAL_OBSIDIAN`
**§9 URI:** `OBSIDIAN_OPEN_URI_TEMPLATE`
**WP43-owned addition:** `PLUGIN_OK`

`PLUGIN_OK` is the one name **not** pinned by the contract. Contract §7 enumerates only *failure* reasons, but `plugin_state` needs a value in the healthy case too, and `state is None` would be a worse contract. It lives in `constants.py` like everything else so no consumer invents its own; it is documented in-file as not being part of the §7 failure enum, and it is excluded from `FAILURE_REASONS`.

---

## Summary for Worker 3

WP43 is `DONE` on all four acceptance criteria with 10/10 visible tests green on the first attempt, and no test anywhere was modified. The batch now has its single owning constants module: every value contract §§1–9 pins is transcribed verbatim into `tools/obsidian_e2e/constants.py`, so WP44–WP49 import rather than re-declare — the frame-type-collision failure mode the contract was written to prevent. `vaults.py` is a genuinely read-only probe: AC4 is structural, with every filesystem read funnelled through one `_read_bytes` helper whose mode is a hardcoded `"rb"` literal and no mode parameter, and host liveness taken from a `ctypes` ToolHelp snapshot rather than a `tasklist` subprocess specifically so that "starts no process" holds. AC3 is enforced by omission rather than by policy — the default process lister collects names only and drops the pid that sits right there in the struct, so no returned structure *can* map a process to a vault. Two facts from the read-only real-host run should propagate: both live vaults are `PLUGIN_NOT_E2E_CAPABLE` (production build, no control server — confirming §1.1, and meaning WP46 readiness is blocked until the dev build lands in WP50/WP51 or B9b), and Obsidian was not running at all, so WP45 must not assume an attachable instance. One environment snag worth putting in the batch run instructions: pytest from the workspace root aborts during collection on the pre-existing broken symlink `Projects/_external/FinaleAbgabe`, which every later WP will hit; `--ignore="Projects\_external\FinaleAbgabe"` (or running from the repo root) clears it.
