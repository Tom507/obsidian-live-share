# Task Charter — WP51: Stale-view scenario surface

**Charter Status:** `SPEC_COMPLETE`
**WP:** WP51
**Phase:** P0 (PHASE T3 group)
**task_mode:** `standard`
**Depends on:** WP6, WP47, WP49
**W4 Test Targets:** `0`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** WP7 AC2's third demonstration is a command sequence, not a manual procedure.
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 5, **PHASE T3**, component **C51 — Stale-view scenario surface** (work package WP51); phase **P0**.

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: modify (`plugin/src/testing/e2e-control.ts` — `canvas.setFlag` `:425–436` and its runtime-flag map)
  - Responsibility: make the one scenario WP7 must demonstrate — an Obsidian save on a deliberately stale view — reproducible as a command sequence on a real instance.
  - Scope summary: deliberate stale view + instance-performed save
- **Out of scope / non-goals:**
  - Asserting the scenario's outcome; this WP provides the surface, WP7 performs and records the run.
  - Adding a test-only conditional to a production canvas module — the scenario rides the injected seams WP6 already requires.
  - A stale-view state that cannot be left; entering and leaving are both commands.
- **Known interfaces / dependencies:**
  - Input: a named instance and the run's scratch canvas
  - Output: a stale-view state that can be entered, observed and left, and a save performed by the instance itself
  - Depends on work packages: WP6, WP47, WP49

---

## 3. Architecture Context

*Task-local architecture guidance only.*

- **Component(s) being changed:** Stale-view scenario surface
- **Interfaces involved:**
  - Input: a named instance and the run's scratch canvas
  - Output: a stale-view state that can be entered, observed and left, and a save performed by the instance itself
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
  - `plugin/src/testing/e2e-control.ts:425–436` — `canvas.setFlag` and its per-host `runtimeFlags` map (currently inert: nothing reads it)
  - `plugin/src/testing/e2e-control.ts:122–144` — the command router
  - the WP6 chaos-suite seams — 'view apply artificially delayed' and 'adapter unavailable' (C6 AC1/AC2), which this surface reuses rather than duplicates
  - `plugin/src/main.ts:1046–1175` — `reconcileLiveCanvas`, the path the delayed-apply seam gates (read for shape; wiring only, no logic)
- **Structure references:** *(intentionally empty — no Graphify graph exists for this project; FALLBACK mode is declared in the BUILD_SPEC section 3. Worker 3 fills this in after implementation. Do not invent paths here.)*

If structure references conflict with the BUILD_SPEC or explicit task scope, the BUILD_SPEC and TaskCharter win. Escalate instead of following the map.

---

## 4. Acceptance Criteria

*Exact copy from BUILD_SPEC section 5, PHASE T3, component C51. No paraphrasing.*

1. A control command puts a named instance into a state where its canvas view is deliberately not advanced by incoming remote changes, a second command returns it to normal, and the current state is observable through the protocol.
2. A control command causes the instance to perform an Obsidian save of the scratch canvas while in that state, with the rig never writing the file itself.
3. A runtime flag the control server accepts is actually read by the code path it names; a flag no path consults is rejected at the command boundary rather than silently stored.
4. The scenario reuses the injected seams the chaos suite already requires and adds no test-only branch to any production canvas module.

**Definition of Done:** WP7 AC2's third demonstration is a command sequence, not a manual procedure.

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
  - `plugin/src/testing/e2e-control.ts`
- **Required report:** `ImplementationReport_WP51.md` (in `workflowArtifacts/canvas-v2/`)
- **BUILD_SPEC updates required:** no — unless implementation invalidates an architecture decision, in which case ESCALATE rather than editing the spec.
- **Gate status required at handover:** `npm run build` PASS and `npm test` with 0 failures, run from `plugin/`. All visible tests PASS. For the Python side of this phase, the standalone `python tools/test_<name>.py` script for this WP passes, launched through `visible-console` `run_python` with an absolute path.

---

## 7. Visible Test Cases / Producer Artifacts

*Filled by Worker 3's Unit Test Sub-Agent. Worker 2 leaves this section empty.*

---

## 7b. W4 Test Targets (filled by Worker 3's Unit Test Sub-Agent, if any)

*Empty at handover.*

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
