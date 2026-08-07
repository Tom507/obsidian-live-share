# Task Charter — WP47: Scratch canvas + vault data safety

**Charter Status:** `DONE`
**WP:** WP47
**Phase:** P0 (PHASE T3 group)
**task_mode:** `standard`
**Depends on:** WP43, WP46
**W4 Test Targets:** `3`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** the owner's two working vaults are provably unchanged by any run, including a failed one.
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 5, **PHASE T3**, component **C47 — Scratch canvas lifecycle and vault data safety** (work package WP47); phase **P0**.

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: create (`tools/obsidian_e2e/scratch.py`) + modify (`plugin/src/testing/e2e-control.ts` — scratch-canvas create/remove commands)
  - Responsibility: give every run its own disposable canvas and establish that the two working vaults are left exactly as they were found.
  - Scope summary: disposable canvas per run, before/after vault fingerprint
- **Out of scope / non-goals:**
  - Editing the scratch canvas — creating and disposing of it is this WP; driving it is WP50/WP53.
  - Any operation on a pre-existing note, canvas or attachment, for reading-as-input as well as for writing.
  - A fingerprint that is merely logged; the comparison is part of the run verdict.
- **Known interfaces / dependencies:**
  - Input: the two ready instances and a run identifier
  - Output: one scratch canvas path per vault plus a before/after vault fingerprint pair
  - Depends on work packages: WP43, WP46

---

## 3. Architecture Context

*Task-local architecture guidance only.*

- **Component(s) being changed:** Scratch canvas lifecycle and vault data safety
- **Interfaces involved:**
  - Input: the two ready instances and a run identifier
  - Output: one scratch canvas path per vault plus a before/after vault fingerprint pair
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
  - `tools/obsidian_e2e/scratch.py` (new)
  - `plugin/src/testing/e2e-control.ts:122–144` — the command router (new scratch create/remove commands go here)
  - `plugin/src/files/canvas-persistence.ts` — the single writer whose output the scratch file is; the rig must not write the file itself
  - `tools/MCPserver/liveshare_e2e_mcp_server.py:403` — the current hard-coded default canvas name `e2e-matrix.canvas`, which the scratch path replaces
- **Structure references:** *(intentionally empty — no Graphify graph exists for this project; FALLBACK mode is declared in the BUILD_SPEC section 3. Worker 3 fills this in after implementation. Do not invent paths here.)*

If structure references conflict with the BUILD_SPEC or explicit task scope, the BUILD_SPEC and TaskCharter win. Escalate instead of following the map.

---

## 4. Acceptance Criteria

*Exact copy from BUILD_SPEC section 5, PHASE T3, component C47. No paraphrasing.*

1. Each run creates a uniquely named `.canvas` file inside a rig-owned folder in each vault, and at no point of a run is any pre-existing note, canvas or attachment opened for writing.
2. The scratch file and the rig-owned folder are removed on teardown, including after a failed, aborted or interrupted run.
3. A vault fingerprint taken before the run equals the one taken after teardown apart from the scratch artefacts, and a mismatch fails the run — this comparison is part of the run's verdict, not an optional diagnostic (D16).
4. The scratch name is derived so two concurrent runs cannot collide, and a stale scratch artefact left by an earlier crashed run is detected and removed at start-up rather than reused.

**Definition of Done:** the owner's two working vaults are provably unchanged by any run, including a failed one.

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
  - `tools/obsidian_e2e/scratch.py` (new)
  - `plugin/src/testing/e2e-control.ts`
- **Required report:** `ImplementationReport_WP47.md` (in `workflowArtifacts/canvas-v2/`)
- **BUILD_SPEC updates required:** no — unless implementation invalidates an architecture decision, in which case ESCALATE rather than editing the spec.
- **Gate status required at handover:** `npm run build` PASS and `npm test` with 0 failures, run from `plugin/`. All visible tests PASS. For the Python side of this phase, the standalone `python tools/test_<name>.py` script for this WP passes, launched through `visible-console` `run_python` with an absolute path.

---

## 7. Visible Test Cases / Producer Artifacts

**Frameworks — split by side.**

- **pytest** (11 files) for `tools/obsidian_e2e/scratch.py`. Run from the AgenticWorkspace root:
  `.venv\Scripts\python.exe -m pytest <file>`. Every file bootstraps `<repo>/tools` onto `sys.path`
  and imports `from obsidian_e2e import constants, scratch` (**never** `tools.obsidian_e2e` — the
  workspace `tools/` is a regular package and shadows the repo's namespace portion).
- **vitest** (3 files) for the new `scratch.create` / `scratch.remove` commands in
  `plugin/src/testing/e2e-control.ts`, in the style of `plugin/src/__tests__/e2e-control.test.ts`
  and staged into `plugin/src/__tests__/wp47/` (the `plugin/src/__tests__/wp42/` precedent).

**No constant is redeclared.** `SCRATCH_FOLDER`, `SCRATCH_PREFIX`, `SCRATCH_EXT`,
`PLUGIN_DIR_REL`, `FINGERPRINT_MISMATCH` and `new_run_id()` are imported from
`tools/obsidian_e2e/constants.py` (WP43); the TS side imports the mirrored
`SCRATCH_FOLDER` / `SCRATCH_PREFIX` / `SCRATCH_EXT` / `DEFAULT_SCRATCH_CONTENT` from
`e2e-control.ts`. No test contains the literal `"_e2e-rig"` or `"e2e-scratch-"`.

**Data safety.** No test reads, writes or names anything under `H:\Developement\_NeuralAngels\`.
Every pytest test builds a throwaway fixture vault under `tmp_path` (notes, canvases, binary
attachments, `.obsidian/`, nested subfolders, and a synthetic `data.json`). No assertion, print or
snapshot ever touches `data.json` content; every comparison is a **sha256 of bytes**.

**API surface these tests pin** (the contract the Coder Sub-Agent implements):

```python
# tools/obsidian_e2e/scratch.py
ScratchError(reason, message="", changed=())        # .reason, .changed; subclass of RuntimeError
Verdict(ok: bool, reason: str | None, changed: tuple[str, ...])
scratch_relpath(run_id) -> str                      # SCRATCH_FOLDER/SCRATCH_PREFIX+id+SCRATCH_EXT
is_scratch_relpath(relpath) -> bool                 # one level deep, prefix + ext, no traversal
fingerprint_vault(vault) -> dict[str, tuple[int, str]]   # rel_posix -> (size, sha256)
diff_fingerprints(before, after) -> tuple[str, ...]      # sorted, deduplicated
reclaim_stale_scratch(vault) -> tuple[str, ...]          # sorted; idempotent; files only
scratch_run(vault, run_id=None, content=None) -> ContextManager[ScratchRun]
# ScratchRun: .vault .run_id .relpath .path .folder .folder_created .reclaimed
#             .before .after .removed .folder_removed .verdict  + .write(content)
```

```ts
// plugin/src/testing/e2e-control.ts
export const SCRATCH_FOLDER, SCRATCH_PREFIX, SCRATCH_EXT, DEFAULT_SCRATCH_CONTENT;
export function isScratchPath(path: string): boolean;
export interface ScratchAdapterLike { exists; mkdir; write; remove }   // DataAdapter subset
// E2EControlHost  += scratchCreate(path, content?) -> {created, path}
//                 += scratchRemove(path)           -> {removed}
// E2EPluginLike   += scratchAdapter?: ScratchAdapterLike | null
```

---

### TC1 — Scratch path is derived from the pinned constants and lands only in the rig folder
- Verifies AC: AC1
- Test file: `workflowArtifacts/canvas-v2/tests/visible/WP47/test_tp01_scratch_path_derivation_visible.py`
- What it checks: `scratch_relpath(run_id)` equals `SCRATCH_FOLDER/SCRATCH_PREFIX+id+SCRATCH_EXT` composed from the constants; the created file's parent is exactly the rig folder; the only paths a run adds to the vault are the rig folder and that one file; all pre-existing files keep their sha256; `is_scratch_relpath` rejects root-level, other-folder, nested, traversal, absolute, wrong-prefix and wrong-extension variants.
- Test data channel: pytest `tmp_path` fixture vault (notes, canvas, binary attachment, `.obsidian/`, nested tree).

### TC2 — Crown jewel: a write-mode-open guard over a full create → edit → teardown cycle
- Verifies AC: AC1
- Test file: `workflowArtifacts/canvas-v2/tests/visible/WP47/test_tp02_write_guard_full_cycle_visible.py`
- What it checks: `builtins.open`, `io.open`, `os.open` and the mutating `os`/`shutil` calls are intercepted; any write-mode open or mutation of a vault path outside `SCRATCH_FOLDER` and outside `PLUGIN_DIR_REL` raises and is recorded; a full cycle (create, two edits, teardown) and a failing cycle both run under the armed guard with zero violations; a meta-test proves the guard is not a no-op; read access for the fingerprint is explicitly not a violation.
- Test data channel: pytest `tmp_path` fixture vault + `monkeypatch`-installed filesystem guard.

### TC3 — A pre-existing note colliding with the scratch pattern is never adopted or overwritten
- Verifies AC: AC1
- Test file: `workflowArtifacts/canvas-v2/tests/visible/WP47/test_tp03_pattern_collision_not_adopted_visible.py`
- What it checks: decoy notes named `SCRATCH_PREFIX…SCRATCH_EXT` at the vault root and in a normal folder keep their bytes across a run and across `reclaim_stale_scratch`; they appear in the fingerprint (so an accidental overwrite would fail the run); pinning the run_id to the decoy's id still targets the folder-scoped path, not the decoy.
- Test data channel: pytest `tmp_path` fixture vault with three planted decoys.

### TC4 — Teardown removes the artefacts on every exit path
- Verifies AC: AC2
- Test file: `workflowArtifacts/canvas-v2/tests/visible/WP47/test_tp04_teardown_exit_paths_visible.py`
- What it checks: parameterised over success, assertion failure, raised exception and `KeyboardInterrupt` — the scratch file and the rig folder are gone and the vault's path set is identical afterwards on every path; the original exception propagates unmasked; `KeyboardInterrupt` is not downgraded to an ordinary exception; `run.removed` / `run.folder_removed` are recorded.
- Test data channel: pytest `tmp_path` fixture vault, `pytest.mark.parametrize` over the four exit paths.

### TC5 — The rig folder is removed only if the rig created it and only if it holds no non-rig file
- Verifies AC: AC2
- Test file: `workflowArtifacts/canvas-v2/tests/visible/WP47/test_tp05_folder_removal_conditions_visible.py`
- What it checks: a folder the rig created is removed; a pre-existing folder is kept; a user file or user subfolder dropped into the folder stops removal and is never deleted (bytes verified by sha256); the scratch file is still removed in that case; a concurrent run's live artefact is not deleted; nothing outside the folder ever changes.
- Test data channel: pytest `tmp_path` fixture vault; the stray file is written mid-run.

### TC6 — Fingerprint equality across a clean run, and the fingerprint holds no content
- Verifies AC: AC3
- Test file: `workflowArtifacts/canvas-v2/tests/visible/WP47/test_tp06_fingerprint_clean_run_visible.py`
- What it checks: every entry is `(size, sha256-hex)` and matches `hashlib` over the file bytes; `SCRATCH_FOLDER`, `PLUGIN_DIR_REL`, `.git/` and `.trash/` are excluded while the rest of `.obsidian/` is not; before equals after across a run; `run.verdict` is green with an empty change tuple; no file content appears anywhere in the fingerprint's repr (S4).
- Test data channel: pytest `tmp_path` fixture vault including `.git/`, `.trash/` and a synthetic plugin `data.json`.

### TC7 — One mutated pre-existing byte FAILS the run with `FINGERPRINT_MISMATCH`
- Verifies AC: AC3
- Test file: `workflowArtifacts/canvas-v2/tests/visible/WP47/test_tp07_fingerprint_mutation_fails_visible.py`
- What it checks: flipping one byte of a pre-existing note between the two fingerprints makes the context manager raise `ScratchError` with `reason == constants.FINGERPRINT_MISMATCH`; the run cannot reach its normal end (asserted with an explicit `ended_normally` flag, so a log-only downgrade fails the test); the verdict names exactly the changed path; artefacts are still removed; nothing of the file's content is printed; an untouched control run over the same fixture stays green.
- Test data channel: pytest `tmp_path` fixture vault; the mutation is an in-place XOR of a single byte.

### TC8 — All four change classes are caught, including same-size different-content
- Verifies AC: AC3
- Test file: `workflowArtifacts/canvas-v2/tests/visible/WP47/test_tp08_fingerprint_change_classes_visible.py`
- What it checks: added, deleted, renamed and size-preserving content change are each detected by `diff_fingerprints` and each fail the run; the size-preserving case asserts equal sizes and different hashes, proving the hash — not the size — is load-bearing; the diff is sorted and deduplicated; a change confined to the scratch folder is not a mismatch.
- Test data channel: pytest `tmp_path` fixture vault; two module-level byte strings of asserted equal length.

### TC9 — Two run_ids in the same second in the same process differ
- Verifies AC: AC4
- Test file: `workflowArtifacts/canvas-v2/tests/visible/WP47/test_tp09_run_id_collision_visible.py`
- What it checks: the id has the pinned `timestamp-pid-random` shape with the current pid; ids grouped by their `timestamp-pid` prefix contain same-second pairs and none of those collide (a timestamp+pid generator dies here); a 2000-id burst is fully unique; derived scratch paths inherit the uniqueness; 25 sequential and 2 overlapping runs in one vault never share a path.
- Test data channel: in-process id bursts plus a small `tmp_path` fixture vault for the run-level cases.

### TC10 — A stale artefact from a crashed run is removed at start-up, never reused
- Verifies AC: AC4
- Test file: `workflowArtifacts/canvas-v2/tests/visible/WP47/test_tp10_stale_reclaim_startup_visible.py`
- What it checks: a planted stale scratch file is already gone when the run body starts and is listed in `run.reclaimed`; its content is never inherited; several stale artefacts are all reclaimed in sorted order; a non-rig file inside the rig folder is never removed; reclaim leaves the vault fingerprint unchanged; after a crashed run no scratch file survives.
- Test data channel: pytest `tmp_path` fixture vault with hand-planted "crashed run" artefacts.

### TC11 — Reclaim is idempotent
- Verifies AC: AC4
- Test file: `workflowArtifacts/canvas-v2/tests/visible/WP47/test_tp11_reclaim_idempotent_visible.py`
- What it checks: the second and third calls reclaim nothing; the vault path set and full fingerprint are stable across repeats; reclaim on a vault without the rig folder is a no-op and does not create it; reclaim on an empty folder is a no-op; three consecutive runs reclaim only what is genuinely stale and get three distinct paths.
- Test data channel: pytest `tmp_path` fixture vault; stale artefacts planted before the first call.

### TC12 — `scratch.create` / `scratch.remove` are confined to the rig folder
- Verifies AC: AC1
- Test file: `workflowArtifacts/canvas-v2/tests/visible/WP47/test_tp12_control_path_confinement_visible.test.ts`
- What it checks: `isScratchPath` accepts only the derived path; fourteen realistic bad paths (plain notes, traversal, absolute, nested, look-alike folder, wrong prefix/extension, backslash, plugin dir) are each refused with HTTP 400 by both commands, with `write`/`mkdir`/`remove` never called; the sanctioned path still succeeds and returns `{created:true, path}`; refusal happens in the host, not only in the router, and never crashes it.
- Test data channel: in-memory fake `ScratchAdapterLike` (vitest `vi.fn` spies) over a seeded fake vault — no filesystem at all.

### TC13 — `scratch.create` contract: folder ensured, default content, no adoption
- Verifies AC: AC1
- Test file: `workflowArtifacts/canvas-v2/tests/visible/WP47/test_tp13_control_create_contract_visible.test.ts`
- What it checks: the result shape `{created, path}`; exactly one write; `mkdir` is called for `SCRATCH_FOLDER` and no other folder, and is skipped when the folder exists; an omitted `content` falls back to `DEFAULT_SCRATCH_CONTENT`, which parses to `{nodes:[],edges:[]}`; an existing file yields `{created:false}` with **no** write and untouched bytes; missing/non-string `path`, non-string `content` and a missing adapter are structured 400s; the raw-body path behaves identically.
- Test data channel: in-memory fake adapter with `vi.fn` call assertions.

### TC14 — `scratch.remove` contract: the teardown half
- Verifies AC: AC2
- Test file: `workflowArtifacts/canvas-v2/tests/visible/WP47/test_tp14_control_remove_contract_visible.test.ts`
- What it checks: `{removed:true}` when the file existed, `{removed:false}` when it did not, and no `remove` call in the latter case; three consecutive removes issue exactly one delete (teardown may run twice); only the named file is removed, never a neighbour in the same folder; a missing `path`, an adapter rejection and a missing adapter are structured 400s; a create-then-remove cycle leaves the fake vault exactly as it started.
- Test data channel: in-memory fake adapter seeded with the scratch file plus a neighbour artefact and a pre-existing note.

---

## 7b. W4 Test Targets (filled by Worker 3's Unit Test Sub-Agent, if any)

Three seams carry residual risk that **cannot** be closed by a unit test in this batch. Worker 4
must treat these as integration/observation targets, not as covered behaviour.

1. **`scratchAdapter` production wiring.** The unit tests drive `buildPluginHost` with an injected
   fake adapter. The real binding — `plugin.app.vault.adapter` handed to the E2E host in
   `main.ts` — is wiring only and `main.ts` has no test file by charter rule. A wrong or absent
   binding produces a rig that refuses every scratch command at run time while every unit test
   stays green.
2. **The fingerprint against the owner's real vaults.** S5 forbids any live run in this batch, so
   the before/after comparison is only ever exercised against `tmp_path` fixture vaults. Scale
   (tens of thousands of files), Windows path casing, long paths and files locked by a running
   Obsidian are unverified. First real exercise belongs to WP50/WP51.
3. **Cross-process staleness.** The pinned reclaim rule treats "not owned by a live run **in this
   process**" as stale, so two rig processes driving the same vault concurrently would let the
   second reclaim the first's live scratch file. This is data-safe (only rig-owned artefacts are
   ever removed) but it is an assumption about single-process operation, not a tested property.
   If WP48's orchestration ever spawns a second rig process, this must be revisited.

---

## 8. Autonomous Execution Plan (filled by Coder Sub-Agent, attempt 1)

- **Observed current behavior:** `tools/obsidian_e2e/` held WP43–WP46 (`constants`, `vaults`,
  `ports`, `lifecycle`, `readiness`) but no scratch module at all, so nothing gave a run its own
  disposable canvas and nothing compared the vault before and after. `constants.py` already owned
  every value this WP needs (`SCRATCH_FOLDER`, `SCRATCH_PREFIX`, `SCRATCH_EXT`,
  `FINGERPRINT_EXCLUDED`, `new_run_id()`, `scratch_rel_path()`, `FINGERPRINT_MISMATCH`,
  `SCRATCH_STALE_UNRECLAIMED`, `CMD_SCRATCH_CREATE/REMOVE`). `e2e-control.ts` had the seven
  existing commands and no scratch surface; `routeCommand`'s switch was untouched by WP46.
- **Approach:** one new module `tools/obsidian_e2e/scratch.py`, plus a purely additive block in
  `e2e-control.ts`. The AC1 guarantee is made structural rather than promised: every vault
  mutation in the Python module goes through `assert_write_allowed`, which refuses any path
  outside `SCRATCH_FOLDER` / `PLUGIN_DIR_REL` before anything is opened; on the TS side both
  `routeCommand` and `buildPluginHost` independently apply `isScratchPath`. Teardown is a
  `finally`-equivalent that also catches `BaseException`, so `KeyboardInterrupt` is covered and
  the original failure is re-raised unmasked. The fingerprint is `(relpath, size, sha256)` and
  its diff is the run's verdict — a mismatch raises `ScratchError(FINGERPRINT_MISMATCH)`.
- **Fallback path if all attempts fail:** not needed — all 14 visible test cases passed on the
  first full run of each side.

---

## 9. Handover Summary (filled by Coder Sub-Agent on completion)

- **What is complete:** all four ACs. `tools/obsidian_e2e/scratch.py` (new) and the WP47 block in
  `plugin/src/testing/e2e-control.ts`. Visible tests: **81/81 pytest, 64/64 vitest, 0 failed.**
  Zero regressions — the full plugin suite still shows exactly the 28 pre-existing failures
  documented as the WP46 baseline, and the production bundle guard still greps 0.
- **What remains open:** the three §7b integration targets stand, with item 1 reduced:
  `buildPluginHost` now falls back to `app.vault.adapter` (which structurally satisfies
  `ScratchAdapterLike`), so no `main.ts` wiring is required and an absent binding is no longer the
  likely failure — but the *real* adapter behaviour is still only exercised against fakes.
  `npm run build` remains red on its `tsc` half because WP49's visible tests are staged ahead of
  WP49; the esbuild half passes and WP47 contributes zero type errors.
- **Final status:** `DONE`.

---

## 10. Risk Notes for Worker 4 (filled by Worker 3 Core)

- **Risk flag:** NONE
