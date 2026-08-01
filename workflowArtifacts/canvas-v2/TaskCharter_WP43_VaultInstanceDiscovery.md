# Task Charter — WP43: Vault registry + instance discovery

**Charter Status:** `IN_PROGRESS`
**WP:** WP43
**Phase:** P0 (PHASE T3 group)
**task_mode:** `standard`
**Depends on:** `none`
**W4 Test Targets:** `0`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** the rig can state, before touching anything, exactly which two vaults it will drive and what already exists there.
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 5, **PHASE T3**, component **C43 — Vault registry and Obsidian instance discovery** (work package WP43); phase **P0**.

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: create (`tools/obsidian_e2e/vaults.py`, new read-only probe module)
  - Responsibility: resolve the two target vaults and the state of anything already serving them, before the rig touches, starts or writes anything.
  - Scope summary: read-only resolution of the two vaults and what already serves them
- **Out of scope / non-goals:**
  - Launching, attaching to, or provisioning anything — this WP only observes (that is WP44/WP45).
  - Deciding which vault is role `a` and which is `b` at run time; the pair is configuration, this module resolves it.
  - Claiming that a running process serves a particular vault — only the control endpoint can establish that (WP46).
- **Known interfaces / dependencies:**
  - Input: the Obsidian vault registry (`%APPDATA%\obsidian\obsidian.json`) and the configured pair of vault paths
  - Output: one resolved instance descriptor per role (`a`, `b`) carrying vault path, registry identity, plugin-install state and whether Obsidian is already running on the host
  - Depends on work packages: `none`

---

## 3. Architecture Context

*Task-local architecture guidance only.*

- **Component(s) being changed:** Vault registry and Obsidian instance discovery
- **Interfaces involved:**
  - Input: the Obsidian vault registry (`%APPDATA%\obsidian\obsidian.json`) and the configured pair of vault paths
  - Output: one resolved instance descriptor per role (`a`, `b`) carrying vault path, registry identity, plugin-install state and whether Obsidian is already running on the host
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
  - `tools/obsidian_e2e/vaults.py` (new)
  - `tools/launch_liveshare_e2e.py` — `preflight()` `:73`, constants `:38–57`: the existing preflight shape and the mock-alias this phase separates from
  - `%APPDATA%\obsidian\obsidian.json` — the vault registry (read-only input, never written)
- **Structure references:** *(intentionally empty — no Graphify graph exists for this project; FALLBACK mode is declared in the BUILD_SPEC section 3. Worker 3 fills this in after implementation. Do not invent paths here.)*

If structure references conflict with the BUILD_SPEC or explicit task scope, the BUILD_SPEC and TaskCharter win. Escalate instead of following the map.

---

## 4. Acceptance Criteria

*Exact copy from BUILD_SPEC section 5, PHASE T3, component C43. No paraphrasing.*

1. A configured vault path resolves to its registry entry for paths containing spaces and for paths differing only by case or a trailing separator; a configured vault that is absent from the registry produces an explicit named failure rather than a fallback guess.
2. Per role the module reports whether the built plugin is present in that vault and whether it is enabled, and "present but disabled" is a distinct named state rather than a variant of missing.
3. The module reports whether Obsidian is running on the host, and it never attributes a running process to a specific vault by process inspection — vault attribution is claimed only through the control endpoint (C46).
4. The module performs no writes of any kind and this is structural rather than incidental: it exposes no write operation, opens no file for writing and starts no process.

**Definition of Done:** the rig can state, before touching anything, exactly which two vaults it will drive and what already exists there.

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
  - `tools/obsidian_e2e/vaults.py` (new)
- **Required report:** `ImplementationReport_WP43.md` (in `workflowArtifacts/canvas-v2/`)
- **BUILD_SPEC updates required:** no — unless implementation invalidates an architecture decision, in which case ESCALATE rather than editing the spec.
- **Gate status required at handover:** `npm run build` PASS and `npm test` with 0 failures, run from `plugin/`. All visible tests PASS. For the Python side of this phase, the standalone `python tools/test_<name>.py` script for this WP passes, launched through `visible-console` `run_python` with an absolute path.

---

## 7. Visible Test Cases / Producer Artifacts

**Framework:** pytest. **Invocation** (from the AgenticWorkspace root):

```text
.venv\Scripts\python.exe -m pytest --rootdir=<repo> workflowArtifacts/canvas-v2/tests/visible/WP43
```

> `--rootdir=<repo>` is required: a dangling junction (`Projects/_external/FinaleAbgabe`) makes
> pytest's rootdir auto-detection raise `FileNotFoundError` during collection. Passing the repo
> root explicitly avoids the walk. Not a test defect.

**Import form** (per `T3_SharedContract.md` §0.2): each file inserts `<repo>/tools` on `sys.path`
and imports `from obsidian_e2e import constants, vaults` — never `tools.obsidian_e2e`.

**Public surface the visible tests exercise** (spec-first — the tests pin these names):

```text
vaults.resolve_vault(configured_path, registry_path) -> VaultResolution
    .configured_path · .ok · .failure · .registry_id · .vault_name · .resolved_path
vaults.discover_instances(vault_paths, registry_path, process_lister=None) -> DiscoveryResult
    vault_paths     ← Mapping[role, path]; any role subset, not only (a, b)
    process_lister  ← injected callable -> iterable of {"pid", "name", "cmdline"} mappings;
                      the seam that lets AC3/AC4 be tested without reading the real process table
    .instances      ← Mapping[role, InstanceDescriptor] · .obsidian_running ← host-level bool
InstanceDescriptor: .role · .configured_path · .resolved_path · .registry_id · .vault_name
                    .plugin_present · .plugin_enabled · .plugin_state · .failures
```

`failure` / `failures` / `plugin_state` carry the pinned reason strings from `constants.py`; no
test hardcodes a port, plugin id, path fragment or reason string. `obsidian_running` lives on the
**result**, never on a descriptor — that placement is the structural expression of AC3.

**Data safety:** every test builds its own fixture vault + fixture registry under pytest's
`tmp_path` and points the module at them via explicit arguments. No test reads, writes or
fingerprints `H:\Developement\_NeuralAngels\ObsidianOrga`, `…ObsidianOrga - Kopie` or
`%APPDATA%\obsidian\`. Fixture `data.json` files participate in fingerprints by **sha256 only**;
no test asserts on, prints or snapshots `data.json` content.

### TC1 — Space-bearing configured path resolves to its registry entry
- Verifies AC: AC1
- Test file: `workflowArtifacts/canvas-v2/tests/visible/WP43/test_ac1_spaces_visible.py`
- What it checks: a vault whose name contains a space (`Orga Notes Alpha`) resolves to the correct registry id, name and normalised path.
- Test data channel: fixture

### TC2 — Case-only difference resolves to the same registry entry
- Verifies AC: AC1
- Test file: `workflowArtifacts/canvas-v2/tests/visible/WP43/test_ac1_case_visible.py`
- What it checks: the configured path passed fully lower-cased still resolves to the registry id whose recorded path differs only by case.
- Test data channel: fixture

### TC3 — Trailing separator on the configured path resolves
- Verifies AC: AC1
- Test file: `workflowArtifacts/canvas-v2/tests/visible/WP43/test_ac1_trailing_sep_visible.py`
- What it checks: `<path>` + `os.sep` resolves to the same entry, and the reported `vault_name` is the real basename rather than an empty string.
- Test data channel: fixture

### TC4 — Vault absent from the registry fails by name, without guessing
- Verifies AC: AC1
- Test file: `workflowArtifacts/canvas-v2/tests/visible/WP43/test_ac1_absent_named_failure_visible.py`
- What it checks: `failure == VAULT_NOT_IN_REGISTRY`, `ok is False`, and `registry_id` / `vault_name` / `resolved_path` are all `None` — no fallback to a neighbouring entry.
- Test data channel: fixture

### TC5 — Per-role plugin presence and enablement are reported
- Verifies AC: AC2
- Test file: `workflowArtifacts/canvas-v2/tests/visible/WP43/test_ac2_plugin_state_per_role_visible.py`
- What it checks: role a (plugin installed and listed in `community-plugins.json`) reports present + enabled; role b (no plugin directory) reports `PLUGIN_MISSING`.
- Test data channel: fixture

### TC6 — "Present but disabled" is a distinct named state
- Verifies AC: AC2
- Test file: `workflowArtifacts/canvas-v2/tests/visible/WP43/test_ac2_disabled_distinct_from_missing_visible.py`
- What it checks: `PLUGIN_PRESENT_BUT_DISABLED != PLUGIN_MISSING` as values (and neither contains the other, so it is not a subtype by naming), and a disabled fixture vault is never reported with the missing state.
- Test data channel: fixture

### TC7 — Obsidian liveness is host-level; no process is attributed to a vault
- Verifies AC: AC3
- Test file: `workflowArtifacts/canvas-v2/tests/visible/WP43/test_ac3_no_process_vault_attribution_visible.py`
- What it checks: with an injected process listing whose command lines quote both vault paths, `result.obsidian_running` is a single host-level bool and no per-vault descriptor carries a pid, a process record or a pid/process-named field.
- Test data channel: fixture (vaults) + deterministic generator (injected process listing)

### TC8 — Read-only is structural: no write surface, no byte changes, no write-mode open
- Verifies AC: AC4
- Test file: `workflowArtifacts/canvas-v2/tests/visible/WP43/test_ac4_structural_readonly_visible.py`
- What it checks: (a) no public callable in the module or its classes carries a write-operation name (`write/save/create/delete/remove/mkdir/rename/copy/touch/provision/install/launch/spawn/kill/…`); (b) a recursive before/after fingerprint of both fixture vaults and the fixture registry — path, size and sha256 only — is identical across a full discovery run; (c) `builtins.open` / `io.open` are guarded during the run so any `w`/`a`/`x`/`+` mode fails the test.
- Test data channel: fixture

---

## 7b. W4 Test Targets (filled by Worker 3's Unit Test Sub-Agent, if any)

*Empty — all four ACs are unit-testable against fixture vaults; nothing is routed to Worker 4.*

---

## 8. Autonomous Execution Plan (filled by Coder Sub-Agent, attempt 1)

- **Observed current behavior:**
- **Approach:**
- **Fallback path if all attempts fail:**

---

## 9. Handover Summary (filled by Coder Sub-Agent on completion)

- **What is complete:**
- **What remains open:**
- **Final status:**

---

## 10. Risk Notes for Worker 4 (filled by Worker 3 Core)

- **Risk flag:** NONE
