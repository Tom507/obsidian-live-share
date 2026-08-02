# Task Charter — WP49: Real quiescence + file-level oracle

**Charter Status:** `DONE`
**WP:** WP49
**Phase:** P0 (PHASE T3 group)
**task_mode:** `standard`
**Depends on:** WP46
**W4 Test Targets:** `3`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** a green run means the two vaults hold the same canvas on disk, not merely the same doc in memory.
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 5, **PHASE T3**, component **C49 — Real quiescence and file-level convergence oracle** (work package WP49); phase **P0**.

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: modify (`plugin/src/testing/e2e-control.ts` — `sync.waitQuiescent` `:438–451`, the activity `bump` seam `:507`, `canvas.state` `:...`)
  - Responsibility: make "settled" and "converged" mean something on a host where edits also arrive from the user, the relay and the disk writer.
  - Scope summary: activity-based quiescence; convergence asserted on disk
- **Out of scope / non-goals:**
  - Changing what `CanvasPersistence` writes or when; the oracle observes its output only.
  - Introducing a polling loop with a fixed sleep as the quiescence mechanism; quiescence follows activity, not the clock.
  - Comparing anything other than what the two instances actually hold — no normalisation to make a comparison succeed.
- **Known interfaces / dependencies:**
  - Input: doc activity from every origin, and the canvas content the plugin's own writer produced
  - Output: a quiescence signal that reflects real activity, and a file-level convergence oracle alongside the doc-level one
  - Depends on work packages: WP46

---

## 3. Architecture Context

*Task-local architecture guidance only.*

- **Component(s) being changed:** Real quiescence and file-level convergence oracle
- **Interfaces involved:**
  - Input: doc activity from every origin, and the canvas content the plugin's own writer produced
  - Output: a quiescence signal that reflects real activity, and a file-level convergence oracle alongside the doc-level one
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
  - `plugin/src/testing/e2e-control.ts:438–451` — `sync.waitQuiescent` (50 ms quiet window, currently bumped only by `simulateEdit`)
  - `plugin/src/testing/e2e-control.ts:507` — `bump` passed as `() => {}` in `maybeStartE2EControlServer`
  - `plugin/src/__tests__/e2e/two-host-harness.ts:170` — the same `bump` no-op in the lightweight host builder
  - `plugin/src/files/canvas-sync.ts:132–137` — `serializeCanvas`, the canonical form the file oracle compares
  - `tools/MCPserver/liveshare_e2e_mcp_server.py:169` — `_compare`, the existing order-independent id-keyed doc comparison
- **Structure references:** *(intentionally empty — no Graphify graph exists for this project; FALLBACK mode is declared in the BUILD_SPEC section 3. Worker 3 fills this in after implementation. Do not invent paths here.)*

If structure references conflict with the BUILD_SPEC or explicit task scope, the BUILD_SPEC and TaskCharter win. Escalate instead of following the map.

---

## 4. Acceptance Criteria

*Exact copy from BUILD_SPEC section 5, PHASE T3, component C49. No paraphrasing.*

1. Quiescence observes actual document activity from any origin rather than only control-initiated commands; an update arriving from the peer or from a user interaction keeps the instance non-quiescent until it settles.
2. Convergence can be asserted on the serialised `.canvas` file content of both vaults in addition to the doc state, and a run that converges in the doc but not on disk fails (D17).
3. The file-level read-back reports the content the plugin's own writer produced and does not itself write, touch, re-serialise or normalise the file — the single-writer invariant is not weakened by an oracle.
4. Both oracles are reachable through the existing control protocol, with no new transport and no new runtime dependency.

**Definition of Done:** a green run means the two vaults hold the same canvas on disk, not merely the same doc in memory.

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
- **Required report:** `ImplementationReport_WP49.md` (in `workflowArtifacts/canvas-v2/`)
- **BUILD_SPEC updates required:** no — unless implementation invalidates an architecture decision, in which case ESCALATE rather than editing the spec.
- **Gate status required at handover:** `npm run build` PASS and `npm test` with 0 failures, run from `plugin/`. All visible tests PASS. For the Python side of this phase, the standalone `python tools/test_<name>.py` script for this WP passes, launched through `visible-console` `run_python` with an absolute path.

---

## 7. Visible Test Cases / Producer Artifacts

All visible tests run under Vitest 4.0.18 from `plugin/`, open no socket, touch no
vault and contain no wall-clock sleep — every timing assertion runs on
`vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync`. They are staged by copying
them into `plugin/src/__tests__/wp49/` (hence the `../../testing/e2e-control`
import depth); the staged copies are already in place and currently red.

> **Staging note:** the artifact filenames already end in `.test.ts`, which matches
> the default vitest `include`, so staging is a plain copy — no rename. Run with
> `npx vitest run src/__tests__/wp49` from `plugin/`.

> **Data safety.** No test opens `H:\Developement\_NeuralAngels\ObsidianOrga`,
> `...\ObsidianOrga - Kopie` or anything under `%APPDATA%\obsidian\`. The filesystem
> tests create their own directory with `mkdtempSync(join(tmpdir(), "ls-wp49-…"))`
> and remove it in `afterEach`; everything else is an in-memory double.

> **CRDT assertion hygiene (T3 contract §10).** No test asserts a value produced by
> two concurrent same-key writes. Where a peer writes, its `Y.Doc` is seeded from the
> host state first, so every asserted value has a single author with a causal
> predecessor chain; where both sides must write, the writes are ordered and the
> first is observed before the second is made.

### Required implementation surface (pinned by these tests)

- `E2EControlHost.canvasFile(path): Promise<{exists, sha256, size, content}>` — the
  `canvas.file` command of T3 contract §6.1; `sha256` is lowercase hex over the raw
  bytes; an absent file is exactly `{exists:false, sha256:"", size:0, content:null}`
  (`content:null` is what distinguishes absent from an empty file).
- `E2EPluginLike.app?.vault.adapter` with `exists` / `readBinary` (`read` accepted) —
  the real `LiveSharePlugin` already satisfies this structurally, so no production
  change is needed.
- `buildPluginHost` observes `update` on the `Y.Doc` of every canvas opened through
  `canvasOpen`, whatever the origin, once per doc.
- `evaluateCanvasConvergence(a, b)` (pure) → `{converged, docConverged, fileConverged,
  reason}` plus the exported constant `DOC_CONVERGED_FILE_DIVERGED`, whose value is
  the T3 contract §7 enum string verbatim. `reason` is that constant only for the D17
  class and `null` otherwise.

### TC1 — An update arriving from the peer keeps the instance non-quiescent
- Verifies AC: 1
- Test file: workflowArtifacts/canvas-v2/tests/visible/WP49/test_tp1_peer_origin_blocks_quiescence_visible.test.ts
- What it checks: after settling, a probe shorter than the quiet window reports `quiescent:true`; a relay-origin `Y.applyUpdate` then flips it to `false`; once the relay stops it returns to `true`. The doc content is asserted too, so the oracle cannot be reacting to nothing.
- Test data channel: in-memory `Y.Doc` pair (peer doc seeded from host state)

### TC2 — An update from a user interaction does the same
- Verifies AC: 1
- Test file: workflowArtifacts/canvas-v2/tests/visible/WP49/test_tp2_user_origin_blocks_quiescence_visible.test.ts
- What it checks: a local view-origin transaction — never routed through the control channel — blocks quiescence and then settles; a simulated drag (ten geometry writes 20 ms apart) keeps it non-quiescent for the whole burst and quiescent once the hand comes off.
- Test data channel: in-memory `Y.Doc` + fake timers

### TC3 — A control-initiated edit still works exactly as before
- Verifies AC: 1
- Test file: workflowArtifacts/canvas-v2/tests/visible/WP49/test_tp3_control_edit_still_bumps_visible.test.ts
- What it checks: `simulateEdit` still returns `{applied:true}`, still writes the doc, still blocks and then releases quiescence, still calls the `bump` hook, and still throws on a canvas that was never opened (→ router 400). Regression guard for the seam being widened.
- Test data channel: in-memory `Y.Doc` + `vi.fn()` bump spy

### TC4 — `sync.waitQuiescent` keeps its name and its timeout contract
- Verifies AC: 1
- Test file: workflowArtifacts/canvas-v2/tests/visible/WP49/test_tp4_timeout_semantics_preserved_visible.test.ts
- What it checks: the router still defaults `timeoutMs` to `2000` when absent and when the value is non-numeric or negative, still forwards an explicit value, still returns the `{quiescent}` envelope; on a live host, sustained activity yields `false` at the deadline and `true` once activity stops.
- Test data channel: fake host spy + in-memory `Y.Doc`

### TC5 — Quiescence answers for the whole instance, not one canvas
- Verifies AC: 1
- Test file: workflowArtifacts/canvas-v2/tests/visible/WP49/test_tp5_multi_canvas_activity_tracked_visible.test.ts
- What it checks: `sync.waitQuiescent` takes no `path`, so an edit on the second open canvas blocks it exactly like the first; the negative control proves a doc the instance never opened does **not** block it.
- Test data channel: two tracked in-memory `Y.Doc`s + one untracked

### TC6 — Doc converged, disk diverged → the run fails under the named reason (D17)
- Verifies AC: 2
- Test file: workflowArtifacts/canvas-v2/tests/visible/WP49/test_tp6_doc_converged_file_diverged_visible.test.ts
- What it checks: identical `canvas.state` on both sides with different `canvas.file` digests gives `docConverged:true`, `fileConverged:false`, `converged:false`, `reason:"DOC_CONVERGED_FILE_DIVERGED"`; the constant is asserted to equal the contract enum string verbatim; a third case demonstrates that a doc-only oracle would have passed this exact input.
- Test data channel: fixture (hand-built `canvas.state` + `canvas.file` observations)

### TC7 — Doc converged and disk converged → honest green
- Verifies AC: 2
- Test file: workflowArtifacts/canvas-v2/tests/visible/WP49/test_tp7_honest_green_convergence_visible.test.ts
- What it checks: both projections agreeing gives `converged:true` with `reason:null`; the doc comparison is id-keyed and order-independent (array order and record key order do not change the verdict), mirroring the existing `_compare` in the MCP driver.
- Test data channel: fixture (nodes + edges, reordered variants)

### TC8 — Files agree but the docs do not → still a failed run, not the D17 class
- Verifies AC: 2
- Test file: workflowArtifacts/canvas-v2/tests/visible/WP49/test_tp8_files_agree_doc_diverges_visible.test.ts
- What it checks: identical bytes with divergent docs gives `fileConverged:true`, `docConverged:false`, `converged:false` and `reason:null` — the D17 reason is reserved for the case the doc oracle would have passed. A single differing geometry value is enough to break doc convergence.
- Test data channel: fixture

### TC9 — `canvas.file` reads back and never writes
- Verifies AC: 3
- Test file: workflowArtifacts/canvas-v2/tests/visible/WP49/test_tp9_file_read_is_readonly_visible.test.ts
- What it checks: every mutating adapter method is a spy that also throws, so a write is fatal twice over; after the read the bytes and the `mtime` on disk are unchanged, no mutator was called, and the reported `content`/`size`/`sha256` match the file exactly. Repeated reads are byte-identical and still write nothing. **This is the single most important test in the WP.**
- Test data channel: real temp directory (`mkdtempSync` under `tmpdir()`) + spy adapter double

### TC10 — An absent file stays absent
- Verifies AC: 3
- Test file: workflowArtifacts/canvas-v2/tests/visible/WP49/test_tp10_absent_file_not_created_visible.test.ts
- What it checks: a missing path resolves (never rejects) to `{exists:false, sha256:"", size:0, content:null}`; the directory listing is byte-identical afterwards, no file appears, and a missing file inside a missing folder does not create the folder.
- Test data channel: real temp directory + spy adapter double

### TC11 — The read-back reports what the writer produced, not a normalised form
- Verifies AC: 3
- Test file: workflowArtifacts/canvas-v2/tests/visible/WP49/test_tp11_no_normalisation_bytes_verbatim_visible.test.ts
- What it checks: the fixture is deliberately in a shape the plugin's canonical serialiser would rewrite — keys out of schema order, records not id-sorted, ragged whitespace, no trailing newline. `content` equals the file byte-for-byte and is explicitly **not** `JSON.stringify(JSON.parse(content))`; `sha256` is the digest of the bytes on disk and `size` their byte length; record and key order survive.
- Test data channel: real temp directory (hand-written non-canonical `.canvas`)

### TC12 — Both oracles ride the existing protocol, with no new dependency or transport
- Verifies AC: 4
- Test file: workflowArtifacts/canvas-v2/tests/visible/WP49/test_tp12_existing_protocol_no_new_dependency_visible.test.ts
- What it checks: `canvas.file` routes through `routeCommand`/`parseAndRoute` with the existing `{ok:true,result}` envelope and the existing structured `400 {ok:false,error}` on a missing `path`; `plugin/package.json` still declares exactly the five known runtime dependencies and no socket library; `e2e-control.ts` imports nothing outside the allow-list and still contains exactly one `createServer(` and one `.listen(`.
- Test data channel: fake host + structural read of `package.json` and the module source

---

## 7b. W4 Test Targets (filled by Worker 3's Unit Test Sub-Agent, if any)

Three AC halves cannot be reached headlessly — they need a real Obsidian instance
and the two real vaults, which is WP50/WP51 territory and out of scope for this
batch (T3 contract §0/S5). The unit tests above cover every seam that is reachable
without one; what is left is genuinely the host half.

1. **AC1 (real-host half) — `INTEGRATION_SCOPE`.** On a real instance the three origins are the relay socket, the Obsidian canvas view and the disk writer. The unit tests prove the seam observes *any* doc update; only a real run can prove that the plugin's actual relay and view paths go through that doc rather than around it. Oracle: with a peer actively editing, `sync.waitQuiescent` must not return `{quiescent:true}` before the peer's last delta has been applied locally.
2. **AC2 (two-vault half) — `INTEGRATION_SCOPE`.** `evaluateCanvasConvergence` is verified as a pure function; wiring it to two live `canvas.file` read-backs from two different vaults, and failing the run under `DOC_CONVERGED_FILE_DIVERGED`, needs both endpoints up. Oracle: a deliberately induced disk divergence (one instance's `CanvasPersistence` prevented from flushing) must turn a doc-green run red with that reason.
3. **AC3 (real adapter half) — `INTEGRATION_SCOPE`.** The read-only proof here runs against an adapter double over a temp directory. Against Obsidian's real `DataAdapter` the same property must be shown with the WP47 vault fingerprint: before-run and after-teardown fingerprints equal, with the oracle having read every scratch canvas in between.

**Environment prerequisite (not an AC):** the build installed in both vaults is a
production build with no control server (T3 contract §1.1), so none of the three can
run until WP50/WP51 install a dev build. Blocked on that, not on WP49.

---

## 8. Autonomous Execution Plan (filled by Coder Sub-Agent, attempt 1)

- **Observed current behavior:**
  - `buildPluginHost` marked activity in exactly one place — inside `canvas.simulateEdit`.
    Nothing else could move `lastActivity`, so `sync.waitQuiescent` reported `quiescent:true`
    on a real instance while relay deltas were still landing and while the user's hand was
    still on the mouse. Both host builders pass `bump = () => {}`, so the outward hook was
    equally blind.
  - `waitQuiescent` answered out of *pre-call* history: it evaluated the idle window before
    its first sleep, so a caller that started waiting while the instance happened to be idle
    got `true` even if activity then continued for the entire timeout.
  - No file-level projection existed at all: `canvas.state` returns the shared-doc snapshot,
    so a run could converge in the doc while the two `.canvas` files on disk differed (D17).
- **Approach:**
  - **AC1 — move the seam to the doc.** `buildPluginHost` subscribes `markActivity` to the
    `update` event of the `Y.Doc` behind every canvas opened through `canvas.open` (and the
    one reached through `simulateEdit`), idempotently, via a `WeakSet<Y.Doc>`. Origin is
    never inspected, so peer, view and control updates are equally visible; a doc the
    instance never opened is never observed and therefore never blocks it.
  - **AC1 — the wait covers the interval it was asked about.** The poll loop sleeps first
    and evaluates afterwards. `timeoutMs`, the 2000 default, the 50 ms quiet window and the
    `{quiescent}` envelope are unchanged.
  - **AC2 — `evaluateCanvasConvergence(a, b)`,** a pure exported function over one
    `canvas.state` plus one `canvas.file` observation per instance, plus the exported
    `DOC_CONVERGED_FILE_DIVERGED` constant mirrored over T3 contract §7. Doc comparison is
    id-keyed and order-independent (array order and record key order); file comparison is
    digest/size/content exact with no normalisation. The named reason is emitted **only**
    for the D17 class, so it stays diagnostic rather than decorative.
  - **AC3 — `canvas.file` reads through a read-only adapter view.** `CanvasFileAdapterLike`
    declares `exists` + `readBinary`/`read` and **no mutating member at all**, so no code
    path can reach a writer even by accident. Absent → `{exists:false, sha256:"", size:0,
    content:null}` without touching the filesystem further. Present → the raw bytes,
    hashed and decoded, never parsed and re-serialised.
  - **AC4 — no new transport, no new dependency.** One extra `case "canvas.file"` in the
    existing `routeCommand` switch on the existing envelope; the only new import is the
    Node built-in `node:crypto`.
  - **Type pattern (WP47's, one step further):** `canvasFile?` is optional on
    `E2EControlHost` so the pre-WP49 hand-rolled fake hosts stay valid, and required on
    `E2EFileControlHost extends E2EScratchControlHost`, which is what `buildPluginHost`
    now returns.
- **Fallback path if all attempts fail:** not needed — no attempt failed.

---

## 9. Handover Summary (filled by Coder Sub-Agent on completion)

- **What is complete:** all four ACs, in `plugin/src/testing/e2e-control.ts` only.
  12/12 visible test files, 36/36 tests PASS. `tsc -noEmit -skipLibCheck` reports
  **0 errors in `wp49/`** (down from 17). The production esbuild build succeeds and
  `main.js` is **byte-identical in size** to the pre-change build with 0 matches for
  `e2e-control|LIVESHARE_E2E|e2eControlPort` — the whole module still tree-shakes out.
- **What remains open:** the three `INTEGRATION_SCOPE` halves in §7b (real host, two
  vaults, real `DataAdapter`) — WP50/WP51 territory, unchanged by this WP.
- **Inherited, NOT caused by WP49 (for Worker 3):** `src/__tests__/e2e-control.test.ts`
  → "sessionInfo maps settings + connection state" and `src/__tests__/t3/wp44/`
  → `test_tp11_resolveport_precedence_visible.test.ts` both `toEqual` a four-field
  `session.info`; WP46's five identity fields break them. `src/__tests__/v2/wp8/**`
  (5 files) is blocked on a missing `canvas/canvas-schema`, another worker's file.
  `src/__tests__/wp5/latency.test.ts` is a wall-clock flake (154 ms vs a 150 ms band)
  that passes in isolation.
- **Final status:** `DONE`

---

## 10. Risk Notes for Worker 4 (filled by Worker 3 Core)

- **Risk flag:** NONE
