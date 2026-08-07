# Task Charter — WP51: Stale-view scenario surface

<!-- Updated: amended against the measured T3 pre-flight (2026-08-02) — the stale install claim corrected, the dev-build hang entered as a constraint, and the build/install step named as WP69; ACs unchanged 2026-08-02 -->
<!-- Updated: §5 only — the second sync engine corrected from lan-vault-sync (installed, NOT enabled) to obsidian-git; setFlag's borrow-clobber split out as WP72; the agent-mediated run noted. AC1–AC4 unchanged verbatim, and §7 (Worker 3's) untouched 2026-08-04 -->
**Charter Status:** `TESTS_ADDED`
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
  - <!-- Updated: split out to WP69 2026-08-02 --> **Building or installing the E2E-capable plugin bundle.** `T3_SharedContract` §1.1 assigns that step to "WP50/WP51" in prose; it was in neither charter and is now **WP69** (§5 C69). This WP does not edit `plugin/esbuild.config.mjs`, adds no `package.json` script and writes into no vault. Its four criteria are decided under the `plugin/` vitest gate at the control-server seam — **an installed bundle is not needed to reach `DONE`**, and this WP therefore does not depend on WP69. Exercising the scenario on a real instance is WP7's run, which does.
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

- **Permission / environment limits:** Windows dev host; run all plugin commands from `plugin/` (never the repo root). Runner is Vitest 4.0.18 — the `basic` reporter was removed, use the default or `--reporter=dot`. Budget >= 90 s for any automated `npm test` invocation (a 33.5 s sleeper makes ~41 s the floor, not a hang). No Graphify graph exists for this project (declared FALLBACK mode) — `workflowArtifacts/RepoMap.md` is the structural map. **T3 environment facts, given — do not re-derive:** Obsidian executable `C:\Users\tschm\AppData\Local\Programs\Obsidian\Obsidian.exe`; vault registry `%APPDATA%\obsidian\obsidian.json` (**read-only**, S3); target vaults `H:\Developement\_NeuralAngels\ObsidianOrga` (role `a`) and `H:\Developement\_NeuralAngels\ObsidianOrga - Kopie` (role `b`; spaces in the path are load-bearing). <!-- Updated: install state corrected against the measured pre-flight — it is both vaults, and the build is production 2026-08-02 --> **Corrected 2026-08-02 (`T3_PREFLIGHT.md`, measured):** the plugin is installed **and enabled in both vaults**, not only in the first, and in both it is a **production** build (`main.js`, 626 711 bytes, dated 2026-07-26, **zero** `__LS_E2E__` occurrences), so neither installed instance can host the control server this WP extends — whatever port is provisioned. The install directory is `<vault>\.obsidian\plugins\**live-share**\`; `obsidian-live-share` is the repo folder name, not the plugin id. Producing and installing an E2E-capable bundle is **WP69**; do not re-derive any of this. The Python side of this phase has no vitest coverage and must not pretend to — its units are verified by a standalone `python tools/test_<name>.py` script per workspace convention; every TypeScript change still goes through the `plugin/` vitest gate.
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
- <!-- Updated: measured host realities entered from T3_PREFLIGHT.md 2026-08-02 --> **Known risks specific to this WP, measured on this host 2026-08-02 — given, do not re-derive:**
  - **⚠ `npm run dev` never terminates.** `plugin/esbuild.config.mjs` branches on `process.argv[2] === "production"`: production rebuilds once and `process.exit(0)`s, **every other invocation calls `ctx.watch()` and never returns**, and `__LS_E2E__` is `"false"` only in production. If the temptation arises to "just try the command on a real instance" while developing this surface, that build hangs and reads as slow rather than as stuck. **Do not.** The four criteria here are decided under the `plugin/` vitest gate; the one-shot `e2e` build mode is WP69.
  - <!-- Updated: CORRECTED — the engine named here was lan-vault-sync, which is installed but NOT enabled; the enabled second engine is obsidian-git, and its disposition is now a precondition rather than a WP50 judgement call. The design consequence for AC2 is unchanged and deliberately so 2026-08-04 --> **AC2's save is performed by the instance, and a second sync engine is watching.** The enabled second engine is **`obsidian-git`** — `community-plugins.json` is Obsidian's *enabled* list, is byte-identical in both vaults, and contains exactly `obsidian-git` and `live-share`; **`lan-vault-sync` is installed but NOT enabled and cannot run**, and is named here only so it is not rediscovered as a hazard. `obsidian-git` carries `autoPullOnBoot: true` in both vaults over dirty git working trees with `origin` remotes. Its disposition for the live run is a **precondition** carried by **WP50 AC5** (disabled for the run, restored afterwards, both recorded), not this WP's decision. **The design rule for this WP is unchanged and must not be relaxed because the precondition tightened:** do not design the scenario so that it silently depends on nothing else writing the file. AC2's oracle is that *the instance* performed the save, and a foreign writer must be distinguishable from the instance rather than indistinguishable from it — a scenario whose correctness rests on a precondition holding is a scenario that goes green the day the precondition is skipped.
  - <!-- Updated: setFlag's file-write behaviour split out as WP72; AC3 here is unchanged 2026-08-04 --> **⚠ `canvas.setFlag` writes `data.json` today, and that behaviour is NOT this WP's to fix.** For any name that is an existing settings key it assigns into the live `plugin.settings` and calls `plugin.saveSettings()`, rewriting the whole settings file from the in-memory copy — the file WP70 borrows byte-exactly and WP7 AC6 checks against an independent baseline. That **borrow-clobber** is chartered as **WP72 / C72**. **AC3 here is unchanged and is not widened:** AC3 owns the *rejection rule* — a flag no path consults is refused at the command boundary rather than silently stored — and nothing more. The two are separable and the tree proves it: AC3 can be satisfied in full while `setFlag` still rewrites `data.json` for every accepted name. Implement AC3 without taking the file-write behaviour with it, and do not assume WP72 has landed.
  - <!-- Updated: the rig has no launch backend, measured 2026-08-04 --> **The command surface will be driven by an agent, not by a rig that started the instance.** `lifecycle.py`'s only console backend is `PlanOnlyConsole` and nothing under `tools/obsidian_e2e/` spawns a process; the live run is agent-mediated (WP71 / C71). This WP's four criteria are still decided under the `plugin/` vitest gate and are unaffected — but do not write anything in this charter's artefacts that presumes a rig process is holding the instance's lifetime.
  - **Vault B's path contains spaces**, on a host with a recorded `run_command` nested-quote trap. Any invocation goes through `run_python` with an **absolute** script path (BUILD_SPEC §7).
  - **Nothing in the T3 layer has been executed.** The pre-flight established preconditions, not results: no control endpoint has ever answered on this host, and the stale-view scenario has never been exercised on a real instance. Do not write, in code comments, the report or a handover, anything that reads as if it had been.
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

All visible tests run under Vitest 4.0.18 from `plugin/`. None opens a socket, launches
Obsidian, touches a vault, installs a bundle or invokes `npm run dev`. There is no wall-clock
sleep, no new `setTimeout` wait and no new timing constant anywhere in the set — the whole
surface is synchronous over in-memory doubles, and every file-level oracle is byte equality
(V2's echo breaker), never a window. No test asserts on a log string.

They are staged by copying them into `plugin/src/__tests__/wp51/` (hence the
`../../testing/e2e-control` import depth); the staged copies are already in place and are
currently red. Run with `npx vitest run src/__tests__/wp51` from `plugin/`.

> **Staging note:** the artifact filenames already end in `.test.ts`, which matches the default
> vitest `include`, so staging is a plain copy — no rename.

> **Baseline measured before these files were added:** the full suite excluding
> `src/__tests__/wp51/**` is **299 files / 1833 tests, 0 failures**. No existing test is
> deleted, weakened, retitled, skipped or amended by this WP, which holds no BUILD_SPEC §7
> licence of any class. TC4 and TC5 in particular are written so that
> `e2e-control.test.ts` ("setFlag writes a known setting and stashes unknown flags…"),
> `wp46/test_probe_side_effect_free_visible.test.ts` (`debugFlag`) and
> `blind_set1/WP46` (`verboseLog`) all stay green — see the acceptance rule below.

> **Data safety.** No test opens `H:\Developement\_NeuralAngels\ObsidianOrga`,
> `...\ObsidianOrga - Kopie` or anything under `%APPDATA%\obsidian\`. There is no filesystem
> access at all except the READ-ONLY source reads TC9 performs inside `plugin/src/`.

> **CRDT assertion hygiene (T3 contract §10).** Where more than one peer writes, each writes its
> OWN record and the writes are ordered, so every asserted value has a single author with a
> causal predecessor chain. No value produced by two concurrent same-key writes is asserted.

### Required implementation surface (pinned by these tests)

New exports from `plugin/src/testing/e2e-control.ts` — the **only** file WP51 touches
(`SharedOwnershipContract_B9b_Gate.md` §2):

- `STALE_VIEW_FLAG = "canvas.staleView"` — the one runtime flag name this WP registers.
- `STALE_VIEW_MODES = ["live", "delayed", "unavailable"]` + `type StaleViewMode`.
  `delayed` and `unavailable` are the two WP6 chaos seams (C6 AC1 / C6 AC2) reused verbatim,
  not reinvented: they differ in what LEAVING does — `delayed` replays the withheld updates
  (the pass was late), `unavailable` drops them (the surface was gone).
- `RUNTIME_FLAG_READERS: Readonly<Record<string, string>>` — AC3's registry, mapping each
  accepted flag name to **the code path that reads it**. Plus `isKnownRuntimeFlag(name)`.
- `CanvasSaveChannelLike` — `{ path(): string | null; requestSave(): Promise<string> | string }`.
  `requestSave` is Obsidian's OWN save of the open canvas view and resolves to the exact bytes
  the instance handed to Obsidian's writer. It takes no argument, so the rig has no channel
  through which to supply bytes. Injected via `E2EPluginLike.canvasSaveChannel?(path)`,
  mirroring WP47's `scratchAdapter`; the production path resolves the open canvas leaf.
- `CanvasSaveResult` — `{ saved, sha256Before, sha256After, size, byInstance }`.
  `byInstance` is byte equality between what the instance handed over and what is on disk
  afterwards; it is **not** "the digest moved". An absent file is `sha256: ""` (WP49's contract).
- `E2EPluginLike.canvasSync` gains the loosely-typed `setOnRemoteCanvasUpdate` /
  `onRemoteCanvasUpdate` members the real `CanvasSync` already has, so the gate installs itself
  over the handler `main.ts:846` registered. `main.ts` and every `plugin/src/canvas/**` module
  stay byte-identical (TC9).
- `E2EControlHost` gains **optional** `knownFlags?()`, `flags?()` and `canvasSave?(path)`.
  Optional is load-bearing: the hand-rolled fake hosts in the existing suites do not implement
  them and must keep routing exactly as before.

Commands added to T3 contract §6.1 (existing `POST /command` envelope, no new endpoint, no new
dependency):

| cmd | args | result |
|---|---|---|
| `canvas.flags` | — | `{flags: Record<string, unknown>, staleView: StaleViewMode, withheld: number}` |
| `canvas.save` | `path` | `{saved, sha256Before, sha256After, size, byInstance}` |

`canvas.setFlag` keeps its pinned `{set}` result and gains an acceptance rule **at the command
boundary only**:

1. name in `RUNTIME_FLAG_READERS` → applied to the named runtime path (value validated against
   `STALE_VIEW_MODES`);
2. else name is an OWN property of `plugin.settings` → the pre-WP51 settings branch, unchanged;
3. else → **400**, and nothing is stored.

The direct host method `host.setFlag(...)` keeps its pre-WP51 behaviour, because
`e2e-control.test.ts:253` pins it and WP51 may not amend it. The rig only ever reaches the
surface through `routeCommand`, so AC3's "rejected at the command boundary" is fully served.

### TC1 — Entering the stale state stops the view being advanced by remote changes
- Verifies AC: 1
- Test file: tests/visible/WP51/test_tp1_stale_gate_withholds_view_visible.test.ts
- What it checks: a remote delta reaches the view-apply handler while live and stops reaching it once `canvas.setFlag(canvas.staleView, "delayed")` is issued, while `canvas.state` still reports the peer's value — the doc advances, the view does not; entering twice never double-forwards; and a gate with no plugin-installed handler behind it refuses instead of silently swallowing updates.
- Test data channel: in-memory `Y.Doc` + a `CanvasSync` double that owns the `main.ts:846` handler

### TC2 — Leaving returns to normal, and the two WP6 seams differ
- Verifies AC: 1, 4
- Test file: tests/visible/WP51/test_tp2_leave_replays_or_drops_visible.test.ts
- What it checks: leaving `delayed` replays every withheld update in arrival order; leaving `unavailable` drops them and then goes live; the same input produces different outcomes for the two modes; every mode can be entered and left; a value outside `STALE_VIEW_MODES` is a 400.
- Test data channel: deterministic generator (three node-geometry frames, no timers)

### TC3 — The current state is observable through the protocol
- Verifies AC: 1
- Test file: tests/visible/WP51/test_tp3_stale_state_observable_visible.test.ts
- What it checks: `canvas.flags` reports the mode in force and a withheld counter that moves with the traffic and resets on leaving, does not move while live, takes no args, covers every registered flag, and is a structured 400 on a host without the read-back.
- Test data channel: fixture (hand-driven deliveries)

### TC4 — A flag no code path consults is refused at the command boundary
- Verifies AC: 3
- Test file: tests/visible/WP51/test_tp4_unknown_flag_rejected_visible.test.ts
- What it checks: seven unconsulted names (including the realistic typo `canvasStale`) each give 400; nothing is stored where the protocol can see it and settings are untouched; the two accepted classes — a registered runtime flag and a real settings key — still work; `isKnownRuntimeFlag` agrees with the registry; and a pre-WP51 fake host that declares no flag set keeps the legacy pass-through.
- Test data channel: fixture (name table)

### TC5 — An accepted flag is actually READ by the path it names
- Verifies AC: 3
- Test file: tests/visible/WP51/test_tp5_flag_actually_read_visible.test.ts
- What it checks: no flag is ever read back as an oracle. For every entry in `RUNTIME_FLAG_READERS`, two instances differing only in the flag command produce different observable outcomes at the production seam; setting the flag to its default changes nothing (so the difference is the value, not the command); the effect is reversible in both directions; and a flag set on one instance does not leak to another. This is the test that fails against an implementation whose flag is stored but never consulted.
- Test data channel: deterministic generator (registry-parameterised differential)

### TC6 — The instance performs the save; the rig never writes the file
- Verifies AC: 2
- Test file: tests/visible/WP51/test_tp6_instance_saves_rig_never_writes_visible.test.ts
- What it checks: `canvas.save` invokes the instance's own save channel, the bytes that land are the bytes the instance produced, and no writable adapter is reached at all — the WP47 scratch adapter and every mutator on `app.vault.adapter` are spies that stay untouched; a driver-supplied `content` argument cannot reach disk; the save reflects the view now, not a cached answer.
- Test data channel: in-memory vault (Map) + `vi.fn()` adapter spies

### TC7 — A foreign writer is never credited to the instance
- Verifies AC: 2
- Test file: tests/visible/WP51/test_tp7_foreign_writer_not_credited_visible.test.ts
- What it checks: `lan-vault-sync` landing after the instance's save gives `byInstance:false` even though the digest moved (the case a "the file changed" oracle would pass); a save coalesced away gives `byInstance:false`; an idempotent re-save with an unmoved digest is honestly `true`; attribution is byte equality, not shape equality — two serialisations that `JSON.parse` equal do not match; an absent pre-save file is `""`, never the digest of empty.
- Test data channel: fixture (two byte-level serialisations of the same board)

### TC8 — The full scenario: an Obsidian save on a deliberately stale view
- Verifies AC: 1, 2
- Test file: tests/visible/WP51/test_tp8_stale_save_writes_view_bytes_visible.test.ts
- What it checks: the command sequence WP7 AC2's third demonstration needs — enter stale, let a peer move a node, save, read the file back — puts the STALE view's bytes on disk while `canvas.state` already holds the peer's value, so a doc-level oracle would have called that run converged (D17); leaving catches the view up and the next save agrees with the doc; the file moves exactly twice, both times through the instance; `unavailable` produces a stale save no replay repairs.
- Test data channel: in-memory `Y.Doc` + a view that only the view-apply handler advances

### TC9 — No test-only branch is added to any production canvas module
- Verifies AC: 4
- Test file: tests/visible/WP51/test_tp9_no_test_branch_in_canvas_modules_visible.test.ts
- What it checks: a structural assertion over `plugin/src/canvas/**`, `plugin/src/files/canvas-sync.ts` and `plugin/src/main.ts` — none of them mentions any WP51 token, none imports from `testing/`, every e2e mention inside a canvas module is a comment rather than a code line, and `main.ts`'s e2e code lines equal the pinned pre-existing WP4 bootstrap set exactly (an added `if (this.e2eStaleView) return;` shows up as a new entry). A POSITIVE CONTROL first asserts the surface really does exist in `testing/e2e-control.ts`, so the file cannot pass on a tree where WP51 was never implemented.
- Test data channel: fixture (read-only source reads under `plugin/src/`)

---

## 7b. W4 Test Targets (filled by Worker 3's Unit Test Sub-Agent, if any)

*Empty — no AC of this WP is `INTEGRATION_SCOPE`.*

All four criteria are decided under the `plugin/` vitest gate at the control-server seam, which
is what charter §2 already records ("an installed bundle is not needed to reach `DONE`"). AC2's
save is exercised through the instance's own save channel with an in-memory vault; exercising
the same command sequence against a real Obsidian instance is **WP7's run**, not an integration
target owned here.

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
