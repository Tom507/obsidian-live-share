# Task Charter — WP50: Run matrix bound to real hosts

<!-- Updated: amended against the measured T3 pre-flight (2026-08-02) — AC5/AC6 appended from C50, the build blocker split out as WP69, and four host realities entered as constraints; AC1–AC4 unchanged verbatim 2026-08-02 -->
**Charter Status:** `SPEC_COMPLETE`
**WP:** WP50
**Phase:** P0 (PHASE T3 group)
**task_mode:** `standard`
**Depends on:** WP47, WP48, WP49
**W4 Test Targets:** `0`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** `run_matrix` becomes a statement about two real Obsidian instances.
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 5, **PHASE T3**, component **C50 — Run matrix bound to the real hosts** (work package WP50); phase **P0**.

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: modify (`tools/MCPserver/liveshare_e2e_mcp_server.py` — `_wait_both` `:134`, `assert_converged` `:280`, `run_matrix` `:402`)
  - Responsibility: let the existing MCP driver run its matrix against two real Obsidian instances without carrying assumptions that only held for the mock host.
  - Scope summary: MCP driver on real endpoints, per-case oracle verdict
- **Out of scope / non-goals:**
  - Adding new matrix cases; this WP binds the existing six to real hosts.
  - Changing the control protocol; the driver is a client of it.
  - Keeping the doc oracle as the sole verdict source — the file oracle joins it, it does not replace it.
  - <!-- Updated: split out to WP69 2026-08-02 --> **Building or installing the E2E-capable plugin bundle.** `T3_SharedContract` §1.1 assigns that step to "WP50/WP51" in prose; it was in neither charter, and it is now **WP69** (§5 C69). This WP does not edit `plugin/esbuild.config.mjs`, does not add a `package.json` script and does not write into any vault's `.obsidian/plugins/**`. AC5 below requires it to **check** that the endpoint it holds belongs to an E2E-capable build — checking is this WP's job, producing is not.
  - <!-- Updated: 2026-08-02 --> **Repairing the vault registry.** `%APPDATA%\obsidian\obsidian.json` registers a stray third entry (vault B's own `.obsidian` folder, `open: false`, harmless). It is **user state**, it is `open: false`, and it is explicitly not ours to fix. The registry is read-only (S3), and "cleaning it up" is forbidden — a rig that rewrites the vault registry is a rig that can destroy the owner's vault list.
- **Known interfaces / dependencies:**
  - Input: the two real endpoints and the run's scratch canvas
  - Output: a per-case verdict naming the oracle that decided it
  - Depends on work packages: WP47, WP48, WP49
  - <!-- Updated: 2026-08-02 --> **Not** WP69, deliberately: every criterion here is decided at an injectable seam (the driver against fake endpoints), so waiting on an installed bundle would serialise the batch behind its riskiest step for no verification gain. WP7 carries that dependency, because WP7 is the run. See BUILD_SPEC §9, *Amended dependencies (2026-08-02)*.

---

## 3. Architecture Context

*Task-local architecture guidance only.*

- **Component(s) being changed:** Run matrix bound to the real hosts
- **Interfaces involved:**
  - Input: the two real endpoints and the run's scratch canvas
  - Output: a per-case verdict naming the oracle that decided it
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
  - `tools/MCPserver/liveshare_e2e_mcp_server.py:134` — `_wait_both`, which settles via `sync.waitQuiescent`
  - `tools/MCPserver/liveshare_e2e_mcp_server.py:280` — `assert_converged`; `:169` — `_compare`
  - `tools/MCPserver/liveshare_e2e_mcp_server.py:321` — `_run_case`, incl. the 3-char case-prefix id namespacing at `:327`
  - `tools/MCPserver/liveshare_e2e_mcp_server.py:45–52` — `MATRIX_CASES`, the six SPEC_04 cases
  - `tools/mcp_proxy_config.json:158–164` — the `liveshare-e2e` registration (`alwaysOn:false`, `lazy_load:true`)
- **Structure references:** *(intentionally empty — no Graphify graph exists for this project; FALLBACK mode is declared in the BUILD_SPEC section 3. Worker 3 fills this in after implementation. Do not invent paths here.)*

If structure references conflict with the BUILD_SPEC or explicit task scope, the BUILD_SPEC and TaskCharter win. Escalate instead of following the map.

---

## 4. Acceptance Criteria

*Exact copy from BUILD_SPEC section 5, PHASE T3, component C50. No paraphrasing.*

1. The driver settles on the C49 quiescence signal and asserts on the C49 file-level oracle in addition to the doc oracle, and carries no assumption that only held for the lightweight host.
2. Each matrix case runs against the run's scratch canvas and leaves the doc in a state no later case depends on, so a case failure localises to that case rather than cascading.
3. Each case reports which oracle decided its verdict, and a case whose oracles disagree or whose gesture did not take effect is reported as inconclusive rather than as a pass.
4. The existing tool surface and argument shapes are unchanged for existing callers, and no new runtime dependency is introduced.
5. **Host preconditions are dispositioned before the first case runs, not discovered by a failure.** Per role the driver establishes and records, before any gesture is issued: that the endpoint it holds belongs to an E2E-capable build (C69) rather than to the production build the vaults carry today; that the run's scratch canvas is inside the surface both instances actually share, so a convergence verdict is about the mechanism and not about two files nobody is syncing; and the **explicit disposition of every other sync engine installed in the two vaults** — `lan-vault-sync` is enabled in both and can move files underneath the test. That disposition is one of exactly two recorded decisions: disabled for the duration and restored on teardown, or left live with the interference accepted and the acceptance stated. Leaving it undecided is not a permitted outcome. Any precondition unestablished refuses the run under a named reason instead of producing case verdicts, and a case that converges because nothing was shared is reported **inconclusive**, never as a pass.
6. **Restore is verified against a baseline the rig did not produce.** After teardown the run compares each vault's `.obsidian/plugins/live-share/data.json` against the independent sha256-of-bytes baseline recorded in `T3_PREFLIGHT.md` — `ObsidianOrga` = `c2c4db2dc8eeb2fd183d0adea62ca6338d1a8e16a0acf2d092a54a1ca18e4162`, `ObsidianOrga - Kopie` = `070e3f3abe81a57f02e590e8d957438c56b828da11944dc9d0b0b6f30fa9030f` — and against the sha256 C69 recorded for the production `main.js` it displaced. A mismatch **fails the run**. The check consults neither the rig's restore bookkeeping nor its provisioning marker: the point is that it does not trust the code under test. The two `data.json` hashes differ between vaults, which is correct — they carry per-vault identity keys — and must never be "converged". Comparison is **sha256-of-bytes only**: `data.json` holds live credentials, and neither its bytes nor any value read from it is ever printed, logged, echoed into a report or handover, or placed in a fixture.

<!-- Updated: AC5 and AC6 appended verbatim from BUILD_SPEC §5 C50 after the measured T3 pre-flight; AC1–AC4 untouched 2026-08-02 -->

**Definition of Done:** `run_matrix` becomes a statement about two real Obsidian instances.

---

## 5. Constraints and Known Risks

- **Permission / environment limits:** Windows dev host; run all plugin commands from `plugin/` (never the repo root). Runner is Vitest 4.0.18 — the `basic` reporter was removed, use the default or `--reporter=dot`. Budget >= 90 s for any automated `npm test` invocation (a 33.5 s sleeper makes ~41 s the floor, not a hang). No Graphify graph exists for this project (declared FALLBACK mode) — `workflowArtifacts/RepoMap.md` is the structural map. **T3 environment facts, given — do not re-derive:** Obsidian executable `C:\Users\tschm\AppData\Local\Programs\Obsidian\Obsidian.exe`; vault registry `%APPDATA%\obsidian\obsidian.json` (**read-only**, S3); target vaults `H:\Developement\_NeuralAngels\ObsidianOrga` (role `a`) and `H:\Developement\_NeuralAngels\ObsidianOrga - Kopie` (role `b`; spaces in the path are load-bearing). <!-- Updated: install state corrected against the measured pre-flight — it is both vaults, and the build is production 2026-08-02 --> **Corrected 2026-08-02 (`T3_PREFLIGHT.md`, measured):** the plugin is installed **and enabled in both vaults**, not only in the first, and in both it is a **production** build (`main.js`, 626 711 bytes, dated 2026-07-26, **zero** `__LS_E2E__` occurrences) which cannot host a control endpoint whatever port is provisioned. The install directory is `<vault>\.obsidian\plugins\**live-share**\` — `obsidian-live-share` is the repo folder name, not the plugin id, and a path built from it installs nothing silently. The E2E-capable build and its installation are **WP69**; do not re-derive any of this. The Python side of this phase has no vitest coverage and must not pretend to — its units are verified by a standalone `python tools/test_<name>.py` script per workspace convention; every TypeScript change still goes through the `plugin/` vitest gate.
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
  - **⚠ `npm run dev` never terminates.** `plugin/esbuild.config.mjs` branches on `process.argv[2] === "production"`: production rebuilds once and `process.exit(0)`s, **every other invocation calls `ctx.watch()` and never returns**, and `__LS_E2E__` is `"false"` only in production. The only E2E-capable build is therefore the only build that never exits, and an `await_console` on it blocks to timeout while reading as a slow build. **Do not attempt to build an E2E bundle from this WP.** The one-shot `e2e` mode and the install are **WP69**; until WP69 lands, no attempt is permitted.
  - **`lan-vault-sync` is enabled in both vaults** (alongside `obsidian-git`). It is a second sync engine and it can move files underneath the run, producing a failure that has nothing to do with Canvas V2. **AC5 forces the decision**: disabled for the duration and restored on teardown, or left live with the interference accepted and the acceptance stated in the run record. An undecided second sync engine is not an acceptable state, and "the implementor will judge at run time" is exactly what this criterion removes. Whichever is chosen, both plugins must survive the run — neither is uninstalled, and `community-plugins.json` is restored to its prior bytes if it is touched at all.
  - **Vault B's path contains spaces**, on a host with a recorded `run_command` nested-quote trap (`cmd.exe /d /c "…"` breaks on a nested double quote). Combined, this is the single most likely mechanical failure of the batch. Every invocation goes through `run_python` with an **absolute** script path, per BUILD_SPEC §7 — not `run_command`, not a Bash background process, and never a hand-quoted path interpolated into a shell string.
  - **The plugin directories already contain the owner's own backups** — `main.js.bak`, `main.js.0.5.9.bak`, `manifest.json.bak`. They are **not ours**: never written, moved, renamed or deleted, and never used as a restore point. The rig's namespace is `data.json.e2e-original`, `.e2e-provision.json` and WP69's own `main.js` backup; nothing else.
  - **The scratch canvas may not be inside the shared surface.** WP47 creates `<vault>/_e2e-rig/e2e-scratch-<runId>.canvas`, and nothing in the landed rig provisions the plugin's `sharedFolder`, `roomId` or `serverUrl` — WP44 provisions only `e2eControlPort`. If `_e2e-rig/` is outside what both instances share, every case "converges" or fails for a reason that has nothing to do with the mechanism. AC5 requires this to be established **before** the first case and reported **inconclusive** if it is not — it is the vacuous-pass class this run exists to eliminate, in its E2E form. If establishing it turns out to require provisioning a setting this WP does not own, that is an **ESCALATE**, not an unchartered widening.
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
  - `tools/MCPserver/liveshare_e2e_mcp_server.py`
- **Required report:** `ImplementationReport_WP50.md` (in `workflowArtifacts/canvas-v2/`), which must additionally record <!-- Updated: AC5/AC6 evidence requirements 2026-08-02 -->: the **`lan-vault-sync` disposition actually taken** and, if it was disabled, the evidence it was restored; how the scratch canvas's membership of the shared surface was established per role; how an E2E-capable build was distinguished from the production build at each endpoint; the AC6 comparison **verdict** per vault (match / mismatch) expressed as hashes only, with no `data.json` content, key value or credential in any form; and an explicit statement of which parts of this charter have **not** been executed — in particular, whether any live two-instance run has occurred at all.
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
