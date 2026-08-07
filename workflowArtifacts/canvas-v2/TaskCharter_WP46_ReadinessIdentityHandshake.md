# Task Charter — WP46: Readiness + instance-identity handshake

**Charter Status:** `DONE`
**WP:** WP46
**Phase:** P0 (PHASE T3 group)
**task_mode:** `standard`
**Depends on:** WP45
**W4 Test Targets:** `1`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** it is structurally impossible for a run to drive one vault twice, or to drive a vault nobody intended.
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 5, **PHASE T3**, component **C46 — Readiness and instance-identity handshake** (work package WP46); phase **P0**.

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: modify (`plugin/src/testing/e2e-control.ts` — the `session.info` command `:122–144`, `buildPluginHost` `:356`) + create (`tools/obsidian_e2e/readiness.py`)
  - Responsibility: replace "the port answered" with a positive identification of which vault, which build and which room each endpoint is, before any edit is issued.
  - Scope summary: positive identification of vault, build and room
- **Out of scope / non-goals:**
  - Adding authentication to the control protocol; localhost binding plus the `__LS_E2E__` gate remains the boundary.
  - Changing the transport — the control server stays `node:http` on `127.0.0.1`, no WebSocket, no new dependency.
  - Any canvas operation; readiness precedes the first edit and issues none.
- **Known interfaces / dependencies:**
  - Input: the two control endpoints
  - Output: a readiness verdict carrying both identities, or a named refusal
  - Depends on work packages: WP45

---

## 3. Architecture Context

*Task-local architecture guidance only.*

- **Component(s) being changed:** Readiness and instance-identity handshake
- **Interfaces involved:**
  - Input: the two control endpoints
  - Output: a readiness verdict carrying both identities, or a named refusal
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
  - `plugin/src/testing/e2e-control.ts:122–144` — the command router and the existing `session.info` (`clientId`, `role`, `roomId`, `connected`)
  - `plugin/src/testing/e2e-control.ts:315–332` — `E2EPluginLike`, the structural interface the real `LiveSharePlugin` already satisfies
  - `plugin/src/testing/e2e-control.ts:273–277` — `createControlServer` / `onListening`
  - `plugin/src/__tests__/e2e/two-host-harness.ts:206–216` — `waitForBoundPort`, the existing bounded-readiness precedent
  - `tools/obsidian_e2e/readiness.py` (new)
- **Structure references:** *(intentionally empty — no Graphify graph exists for this project; FALLBACK mode is declared in the BUILD_SPEC section 3. Worker 3 fills this in after implementation. Do not invent paths here.)*

If structure references conflict with the BUILD_SPEC or explicit task scope, the BUILD_SPEC and TaskCharter win. Escalate instead of following the map.

---

## 4. Acceptance Criteria

*Exact copy from BUILD_SPEC section 5, PHASE T3, component C46. No paraphrasing.*

1. `session.info` additionally reports the vault identity the instance serves, the plugin build identity and whether a canvas view surface is available; the added fields change nothing in production and the whole `src/testing/` module still tree-shakes out.
2. Readiness requires, within a bounded timeout, that both endpoints answer, report **different** vault identities, and report the **same** room; any of the three failing aborts the run under a distinct named reason and no edit is issued.
3. Readiness is a positive assertion rather than an absence of error: a timeout, a partially initialised instance, or an endpoint reporting a vault that is not one of the two configured ones each prevent the run from proceeding.
4. The same check is re-runnable mid-run and is reused by teardown to confirm the endpoints are gone.
5. <!-- Updated: AC5 appended — widening `session.info` is the literal content of AC1, so the two exact-shape assertions pinning the pre-WP46 4-key payload are stale and are licensed for amendment 2026-08-01 --> The two assertions that pin the pre-WP46 four-key `session.info` payload with an exact-shape `toEqual` are amended to the nine-key payload, named individually in the implementation report against the §7 amendment-ledger entry. Each amended assertion stays a whole-object `toEqual` over all nine keys — no `toMatchObject`, no subset match, no destructuring away of the added fields, no `skip`/`only`. Nothing is deleted: the test count does not change, and the four legacy fields keep their names, defaults and semantics verbatim (AC1, pinned by TC2).

**Definition of Done:** it is structurally impossible for a run to drive one vault twice, or to drive a vault nobody intended.

---

**Amendment note (2026-08-01) — resolution of the WP46 licensing escalation.** AC1–AC4 are unchanged and were already met; AC5 is appended, not substituted. The escalation asked whether widening `session.info` from four keys to nine is the *intended* consequence of AC1, or an overreach that should be reverted. It is intended, and it is not separable from the WP: AC1 says `session.info` "**additionally** reports" vault, build and canvas-surface identity, and AC2's "**different** vault identities" check has no other channel to read them from — the readiness prober is out-of-process and sends exactly one frozen payload (`session.info`) and nothing else, ever (§7 contract). Removing the widening removes the handshake that makes driving one vault twice structurally impossible, which is this WP's entire Definition of Done. Nor is there an "optional fields" escape: visible TC3 requires a hollow plugin to answer **all nine** fields honestly (`vaultId: ""`, `vaultPath: null`), because the Python side can only refuse what the plugin reports honestly. The two assertions are therefore **stale, not violated** — they pin a payload the spec deliberately replaced, while their own subjects (settings/connection-state mapping; port precedence) are untouched.

Practical consequences for this WP:

- The two assertions are now licensed for amendment (AC5). Amend them; do not delete, skip, weaken or `toMatchObject` them. Enumerate them by name in `ImplementationReport_WP46.md`.
- The patches already documented in `ImplementationReport_WP46.md` § Blocked Items **meet the strictness bar as written** — both remain whole-object `toEqual` over the complete new shape, and both are strictly *stronger* than what they replace, since they now also pin the AC3 honest-degradation values that nothing pinned before. Apply them as documented.
- **Preferred refinement, not a blocker:** compose the expected `pluginBuild` as `` `0.0.0+${E2E_BUILD_MARKER}` `` from the exported const rather than the literal `"0.0.0+e2e"`, wherever the test file already imports from `plugin/src/testing/e2e-control.ts` (§7: the marker is "imported by tests, never hardcoded"). A literal is acceptable where no such import exists — it is stricter, not looser.
- **The second site exists twice and both copies must be amended identically:** the untracked staged copy `plugin/src/__tests__/t3/wp44/test_tp11_resolveport_precedence_visible.test.ts:140` **and** its source of truth `workflowArtifacts/canvas-v2/tests/visible/WP44/test_tp11_resolveport_precedence_visible.test.ts`. Amending only the staged copy silently reverts on the next restage.
- That file is **WP44-owned**. WP46 is cross-licensed to change *that one assertion's expected payload and nothing else* in it — no restructuring, no change to the port-precedence logic, no other test in the file. WP44's charter and ACs are **not** reopened.
- The pre-existing baseline test `plugin/src/__tests__/e2e-control.test.ts:197` was correctly left failing rather than patched by a coder. That instinct stands as the rule: this licence is the exception that makes it auditable, not a precedent for coders to amend visible or baseline tests on their own judgement.
- Out of scope and unchanged: the `npm run build` `tsc` failure on **pre-existing** WP49/WP13 staged-test errors. It is not WP46's and is not resolved here.

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
  - `tools/obsidian_e2e/readiness.py` (new)
  - <!-- Updated: AC5 amendment sites 2026-08-01 --> `plugin/src/__tests__/e2e-control.test.ts` (AC5 — the `:197` assertion only)
  - <!-- Updated: AC5 amendment sites 2026-08-01 --> `plugin/src/__tests__/t3/wp44/test_tp11_resolveport_precedence_visible.test.ts` **and** `workflowArtifacts/canvas-v2/tests/visible/WP44/test_tp11_resolveport_precedence_visible.test.ts` (AC5 — the `:140` assertion only, both copies, identically)
- **Required report:** `ImplementationReport_WP46.md` (in `workflowArtifacts/canvas-v2/`) — <!-- Updated: AC5 2026-08-01 --> must now also carry the amendment-ledger entry required by AC5: both assertions named individually with file, line and the one-line reason each, plus the before/after test-count showing it did not move.
- **BUILD_SPEC updates required:** no — unless implementation invalidates an architecture decision, in which case ESCALATE rather than editing the spec.
- **Gate status required at handover:** `npm run build` PASS and `npm test` with 0 failures, run from `plugin/`. All visible tests PASS. For the Python side of this phase, the standalone `python tools/test_<name>.py` script for this WP passes, launched through `visible-console` `run_python` with an absolute path.

---

## 7. Visible Test Cases / Producer Artifacts

Fourteen test points, split by side. **AC1** is TypeScript (vitest) against
`plugin/src/testing/e2e-control.ts`; **AC2/AC3/AC4** are Python (pytest) against
`tools/obsidian_e2e/readiness.py`.

**Data safety — how every Python test runs.** Each one starts one or two *fake in-process
HTTP control endpoints* (`BaseHTTPRequestHandler` + `ThreadingHTTPServer` bound to
`127.0.0.1:0`, bound port read back), following the existing precedent
`tools/test_liveshare_e2e_mcp.py`. **No test contacts a real Obsidian instance, either
vault, or `%APPDATA%\obsidian\`, and no test binds `REAL_CONTROL_PORT_A/B`** — the stubs
assert their own ephemeral port is neither of the two. Every stub also records the commands
it received, which is the oracle for "no edit is issued".

**Runner note (Python).** Run from the plugin repo root:
`h:\My Code\AgenticWorkspace\.venv\Scripts\python.exe -m pytest workflowArtifacts/canvas-v2/tests/visible/WP46 -q`.
Each file also runs standalone (`python <file>`) per workspace convention. Do **not** run
pytest from the workspace root — a broken junction under `Projects/_external/` breaks
rootdir discovery. Import form is the one pinned in `T3_SharedContract.md`:
`sys.path.insert(0, <repo>/tools)` then `from obsidian_e2e import constants, readiness` —
never `tools.obsidian_e2e`.

**Runner note (TypeScript).** Stage the `.ts` files into `plugin/src/__tests__/wp46/`
(one level deep — the imports are `../../testing/e2e-control`) and give vitest a matching
`test.include`, since `test_*_visible.ts` does not match the default `*.test.ts` glob.

> **Verified before handover:** the 30 Python files (10 test points × 3 sets, 123 pytest
> cases) were executed against a throwaway reference implementation of the contract below —
> **123/123 pass**. Three targeted mutations (drop the same-vault check, drop the room
> comparison, make the teardown check always report "gone") produce **27 failures across all
> three sets**, so discrimination holds by construction. The reference implementation was
> deleted; nothing was added under `tools/`. The TypeScript files are *not* execution-
> verified — they import the WP46 seams (`E2E_BUILD_MARKER`, the `E2EPluginLike` identity
> members) that do not exist yet, so they compile only after the implementation lands.

### Required API surface (contract for the coder)

**Python — new module `tools/obsidian_e2e/readiness.py`.** Standard library only. Every
named refusal is imported from `obsidian_e2e.constants`; this module declares no reason
string of its own.

```python
@dataclass(frozen=True)
class ReadinessVerdict:
    ready: bool
    reason: str | None          # exactly one constants.* name when ready is False
    identities: dict            # role -> the raw `session.info` result, for roles that answered
    detail: str = ""            # human text; never the oracle

def check_readiness(
    endpoints: Mapping[str, str],          # role -> base URL, e.g. {"a": "http://127.0.0.1:39431"}
    configured_vaults: Mapping[str, str],  # role -> expected vault id (the two configured vaults)
    timeout_s: float,
) -> ReadinessVerdict

def check_endpoints_gone(                  # the same probe, used in the teardown direction
    endpoints: Mapping[str, str],
    timeout_s: float,
) -> ReadinessVerdict                      # ready=True iff NO endpoint answers at all
```

Rules the tests pin:

- The probe is `POST {url}/command` with `{"cmd": "session.info"}` — **and nothing else, ever.**
- **An endpoint that refuses the connection counts as "does not answer"** → `READINESS_TIMEOUT`
  (§7 names no separate refusal reason).
- Refusal precedence: not-all-answered → `READINESS_TIMEOUT`; a `session.info` missing any
  §6.2 field → `PLUGIN_NOT_E2E_CAPABLE`; a reported vault outside `configured_vaults.values()`
  (empty and whitespace-only ids included) → `IDENTITY_UNKNOWN_VAULT`; the two vaults equal →
  `IDENTITY_SAME_VAULT`; a blank room or two different rooms → `ROOM_MISMATCH`.
- Room and vault ids are compared **exactly** — no case folding, no trimming, no normalisation.
- In the teardown direction, *any* HTTP answer means "still present", even an unusable one;
  the surviving role appears in `identities` when its answer parses. The reason string for a
  failed teardown is **not** pinned by `T3_SharedContract` §7 — the tests only require a
  named, non-empty string.

**TypeScript — `plugin/src/testing/e2e-control.ts`.** `sessionInfo()` gains the five §6.2
fields; the four legacy fields keep their names, defaults and semantics verbatim.

```ts
export const E2E_BUILD_MARKER = "e2e";     // build marker, imported by tests, never hardcoded

export interface E2EPluginLike {
  /* ...existing members unchanged... */
  app?: {
    appId?: string;
    vault?: { getName?(): string; adapter?: { getBasePath?(): string } };
  };
  manifest?: { version?: string };
  hasCanvasSurface?: () => boolean;
}
```

Resolution rules the tests pin (all degrade, none throw, none guess):

- `vaultId` — `app.appId` when a non-empty string, else the absolute vault base path, else `""`.
- `vaultName` — `app.vault.getName()` as a string, else `""`.
- `vaultPath` — the adapter base path when a non-empty string, else **`null`** (never `""`).
- `pluginBuild` — `` `${manifest.version ?? "0.0.0"}+${E2E_BUILD_MARKER}` ``, always a non-empty string.
- `canvasSurface` — `plugin.hasCanvasSurface()` when that hook exists (it wins), else
  `Boolean(plugin.canvasSync)`.
- `session.info` stays **read-only**: it mutates no setting, writes nothing to the doc, and
  never calls `bump` — the TypeScript-side mirror of AC2's "no edit is issued".

### TC1 — session.info reports the vault, the build and the canvas surface
- Verifies AC: AC1
- Test file: workflowArtifacts/canvas-v2/tests/visible/WP46/test_session_info_identity_fields_visible.ts
- What it checks: the result carries exactly the four legacy fields plus the five names pinned in T3_SharedContract §6.2 and nothing else; `vaultId`/`vaultName`/`vaultPath` identify the serving vault, `pluginBuild` contains both the manifest version and the imported `E2E_BUILD_MARKER`, `canvasSurface` is a boolean, and `routeCommand("session.info")` surfaces the whole payload at HTTP 200.
- Test data channel: fixture (a fully initialised fake `E2EPluginLike` — no Obsidian, no socket)

### TC2 — the four pre-existing fields keep their names and semantics
- Verifies AC: AC1
- Test file: workflowArtifacts/canvas-v2/tests/visible/WP46/test_legacy_fields_unchanged_visible.ts
- What it checks: `clientId`/`role`/`roomId`/`connected` are still present, still default to `""`/`null`/`""`/`false`, still string-coerce the ids and pass `role` through verbatim, `connected` is still the conjunction of `muxConnected` and `controlConnected` over all four combinations, and the legacy quartet is byte-identical with and without the new identity sources present.
- Test data channel: fixture (settings matrix over a fake plugin)

### TC3 — a partially initialised instance answers honestly instead of guessing
- Verifies AC: AC1, AC3
- Test file: workflowArtifacts/canvas-v2/tests/visible/WP46/test_identity_degradation_visible.ts
- What it checks: a hollow plugin still answers all nine fields and never throws; `vaultPath` is `null` (never `""`) when the adapter exposes no base path; `vaultId` falls back from `appId` to the absolute vault path and otherwise stays `""`; `canvasSurface` follows `canvasSync` unless the explicit hook overrides it. This is the TypeScript half of the AC3 refusal — the Python side can only refuse what the plugin reports honestly.
- Test data channel: fixture (progressively hollowed fake plugins)

### TC4 — the added fields change nothing else, and the probe is read-only
- Verifies AC: AC1, AC2
- Test file: workflowArtifacts/canvas-v2/tests/visible/WP46/test_probe_side_effect_free_visible.ts
- What it checks: repeated `sessionInfo()` calls are equal and mutate no setting, never write to the Y.Doc and never call `bump`; `session.info` still ignores args; the other six commands keep their exact routing, arguments and result shapes; malformed input still returns a structured 400 rather than throwing.
- Test data channel: fixture (fake plugin over a real `Y.Doc`) + spy (`vi.fn()` on the activity bump)

### TC5 — a healthy pair is ready and the verdict carries both identities
- Verifies AC: AC2
- Test file: workflowArtifacts/canvas-v2/tests/visible/WP46/test_ready_pair_verdict_visible.py
- What it checks: two endpoints that answer within the bound, report different vaults and the same room produce `ready=True`, `reason=None`, both identities keyed by role and carrying the five added fields — and even on the green path only `session.info` was sent.
- Test data channel: fixture (two fake control endpoints on `127.0.0.1:0`) + spy (per-endpoint command log)

### TC6 — an endpoint that does not answer within the bound aborts under READINESS_TIMEOUT
- Verifies AC: AC2, AC3
- Test file: workflowArtifacts/canvas-v2/tests/visible/WP46/test_timeout_abort_visible.py
- What it checks: a stub that accepts the connection and never answers yields `reason == constants.READINESS_TIMEOUT`; the call returns far inside a ceiling well below the stub's own hold time, so the wait is provably bounded rather than merely slow; both-silent is still one named timeout; and no edit reaches either instance.
- Test data channel: fixture (one answering endpoint + one deliberately silent endpoint) + spy (command log)

### TC7 — both endpoints on the same vault abort under IDENTITY_SAME_VAULT
- Verifies AC: AC2
- Test file: workflowArtifacts/canvas-v2/tests/visible/WP46/test_same_vault_abort_visible.py
- What it checks: two endpoints reporting the same configured vault are refused with `constants.IDENTITY_SAME_VAULT` even when everything else is healthy and the client ids differ (D14: one process can host both windows, so session identity proves nothing) — and no edit is issued.
- Test data channel: fixture (two fake endpoints sharing one vault identity) + spy (command log)

### TC8 — two different rooms abort under ROOM_MISMATCH
- Verifies AC: AC2
- Test file: workflowArtifacts/canvas-v2/tests/visible/WP46/test_room_mismatch_abort_visible.py
- What it checks: correctly separated vaults that report different rooms are refused with `constants.ROOM_MISMATCH`; an empty room on one side is still a refusal; the comparison is exact rather than prefix-based; and no edit is issued.
- Test data channel: fixture (two fake endpoints with scripted room ids) + spy (command log)

### TC9 — a partially initialised instance is not accepted as ready
- Verifies AC: AC3
- Test file: workflowArtifacts/canvas-v2/tests/visible/WP46/test_partial_identity_refused_visible.py
- What it checks: an endpoint that answers perfectly with only the four legacy fields (exactly what a pre-WP46 production build returns), or with an empty vault identity, or still booting with no room and no canvas surface, is refused — `ready is False` with a reason drawn from the named set in `constants`, never an exception and never a bare `False` — and receives no edit.
- Test data channel: fixture (fake endpoint returning legacy-only / empty-identity payloads) + spy (command log)

### TC10 — a vault that is not one of the two configured ones aborts under IDENTITY_UNKNOWN_VAULT
- Verifies AC: AC3
- Test file: workflowArtifacts/canvas-v2/tests/visible/WP46/test_unknown_vault_abort_visible.py
- What it checks: a healthy, well-formed endpoint reporting a third vault is refused with `constants.IDENTITY_UNKNOWN_VAULT`; two distinct-but-unknown vaults are still unknown rather than "distinct enough"; a near-miss id is not matched by name similarity; and nothing is written towards the unintended vault.
- Test data channel: fixture (fake endpoint reporting a stranger vault) + spy (command log)

### TC11 — an HTTP 200 with a malformed body never reads as ready
- Verifies AC: AC3
- Test file: workflowArtifacts/canvas-v2/tests/visible/WP46/test_malformed_body_not_ready_visible.py
- What it checks: a 200 carrying non-JSON, an envelope with no `result`, a truncated body, a protocol-level `ok:false`, or a `result` that is not an object each produce a named refusal — "the port answered" is precisely the weak signal WP46 replaces — and no edit is issued in any of them.
- Test data channel: fixture (fake endpoint replying with scripted raw bytes) + spy (command log)

### TC12 — the same check is safely re-runnable mid-run
- Verifies AC: AC4
- Test file: workflowArtifacts/canvas-v2/tests/visible/WP46/test_rerunnable_midrun_visible.py
- What it checks: two calls against a healthy pair both return ready with equal reason and equal identities; the second call demonstrably re-probes rather than replaying a cached verdict; three calls still send nothing but `session.info`; and a pair that degrades between calls is caught by the same function.
- Test data channel: fixture (two fake endpoints, one stopped mid-test) + spy (command counts)

### TC13 — teardown reuses the check inverted: both endpoints gone is a success
- Verifies AC: AC4
- Test file: workflowArtifacts/canvas-v2/tests/visible/WP46/test_teardown_endpoints_gone_visible.py
- What it checks: with both endpoints released, `check_endpoints_gone` returns `ready=True` with no reason and no identities, while `check_readiness` on the identical world state returns `ready=False` with `constants.READINESS_TIMEOUT` — the inversion asserted explicitly, in both directions, on one state. A live pair fails the teardown check, and the teardown check is itself re-runnable.
- Test data channel: fixture (fake endpoints started and then stopped, ports read back before release)

### TC14 — a half-finished teardown is not a clean teardown
- Verifies AC: AC4
- Test file: workflowArtifacts/canvas-v2/tests/visible/WP46/test_teardown_survivor_detected_visible.py
- What it checks: one surviving endpoint makes `check_endpoints_gone` return `ready=False` under a named, non-empty reason; the survivor is identified by role and vault in `identities`; the check sends it no edit; and teardown converges to success once the survivor is released.
- Test data channel: fixture (one live + one released fake endpoint) + spy (command log)

---

## 7b. W4 Test Targets (filled by Worker 3's Unit Test Sub-Agent, if any)

One target — the production-bundle half of AC1. It cannot be observed from a unit test:
it is a property of the *built* artefact, not of any module under test.

### W4-1 — `src/testing/` still tree-shakes out of the production bundle
- Verifies AC: AC1 (second clause)
- Scope: `INTEGRATION_SCOPE` — requires `npm run build` from `plugin/` and a grep over the produced `plugin/main.js`
- Procedure: run `npm run build` in `plugin/`, then grep the production `main.js` for `e2e-control|LIVESHARE_E2E|e2eControlPort`. The existing guard must still return **0 matches** (`T3_SharedContract.md` §6.2, and the environment fact in §1 that the installed build carries zero such markers).
- Pass condition: 0 matches, and `npm run build` exits 0. A non-zero match count means the added `session.info` fields have pulled `src/testing/` into the production bundle, which is an AC1 failure regardless of how green the unit tests are.
- Note for W4: the byte-level "production impact is zero" claim rests on this check plus TC2 and TC4; do not treat a green vitest run as covering it.

<!-- Updated: W4-1 must be re-run after WP58; the build blocker WP58 reported does not reproduce 2026-08-01 -->

**Re-run requirement and two corrections (Worker 2, 2026-08-01). WP46 is not reopened — this is a note on an existing W4 target, and no AC is changed.**

- **W4-1 must be re-run, and it stays in W4's integration scope — it does not become its own work package.** `ImplementationReport_WP58.md` §6 records that WP58 did not execute it and recommends W4 do so. That recommendation is **accepted as written**: W4-1 is already chartered here, with a procedure, a pass condition and a counter-check, and it is a property of the *built artefact* — exactly W4's altitude. Creating a separate WP for a check that already has an owner would duplicate it. **WP58's reasoning that its change is safe is sound but unmeasured** (it deletes a statement from a module already excluded from production bundles and adds no import, symbol or reference, so it cannot introduce a marker that was not there before) — W4 measures it rather than inheriting the argument.
- **Correction — the build is not blocked.** WP58 reported `npm run build` as failing at its `tsc` stage on "pre-existing, out-of-scope WP49/WP13 errors", which would have to be worked around. **That does not reproduce.** `npx tsc -noEmit -skipLibCheck` in `plugin/` was measured at **0 errors** on 2026-08-01. W4 should not budget for a workaround.
- **Hazard that explains the discrepancy, and that W4 must not fall into.** The blind runner stages test files *into the type-checked source tree* (`plugin/src/__tests__/v2blind/…`) and removes them when the run ends. A `tsc` or `npm run build` invoked **while any blind run is in flight** type-checks those transient staged files and can report errors that belong to a blind set, not to the product. This was observed directly: one run reported a single error in `src/__tests__/v2blind/wp10_set2/…_blind2.test.ts`, and minutes later that entire directory did not exist and `tsc` was clean. **Before recording `npm run build` as failing — a §7 abort criterion — confirm no blind run is active and re-run.** A build error whose file path contains `v2blind` or a `_blind[12]` suffix is a staging artefact, not a product defect.

---

## 8. Autonomous Execution Plan (filled by Coder Sub-Agent, attempt 1)

- **Observed current behavior:** `session.info` reported only `clientId`/`role`/`roomId`/`connected`, so the rig could establish that *a* port answered but nothing about *which vault* was behind it. No rig-side readiness module existed at all.
- **Approach:** TypeScript — five §6.2 fields added to `buildPluginHost().sessionInfo()` through five pure, guarded resolver helpers; `routeCommand` was deliberately **not** touched (it already passes the whole payload through, and leaving it untouched keeps WP47/WP49 collision-free). Python — new `tools/obsidian_e2e/readiness.py` with one frozen outbound payload, one bounded concurrent probe, and an ordered refusal ladder shared by the forward and the inverted (`check_endpoints_gone`) direction.
- **Fallback path if all attempts fail:** n/a — no attempt failed.

---

## 9. Handover Summary (filled by Coder Sub-Agent on completion)

- **What is complete:** all four ACs. 15/15 visible test files pass (21 vitest cases + 41 pytest cases). W4-1's production-bundle guard re-verified out of band: an esbuild production bundle built to a scratch path greps to **0** matches for `e2e-control|LIVESHARE_E2E|e2eControlPort`, while the same bundle with `__LS_E2E__=true` matches — so the 0 is real elimination, not a false negative.
- **What remains open (owner decision, deliberately NOT taken by this sub-agent):** two pre-existing exact-shape `session.info` assertions now fail, because AC1 changes the payload from 4 to 9 keys while visible TC1 pins the exact 9-key set — no implementation can satisfy both. Both were left **failing and unmodified** per the "do not modify an existing/visible test" rule; the one-line fix for each is written out in `ImplementationReport_WP46.md` § "Blocked Items". They are `plugin/src/__tests__/e2e-control.test.ts:197` and the staged `plugin/src/__tests__/t3/wp44/test_tp11_resolveport_precedence_visible.test.ts:140` (source: `workflowArtifacts/canvas-v2/tests/visible/WP44/`). Separately, `npm run build` still fails at its `tsc` stage on **pre-existing** WP49/WP13 errors (`canvasFile`, `evaluateCanvasConvergence`, `canvas/canvas-ord` missing) — nothing WP46 touched; after the WP46 change `tsc` reports **zero** errors outside those two WPs' staged test folders.
- **Final status:** DONE.
- **Forward pointer (added by WP58, batch B10):** the readiness-probe side-effect defect
  (`bump` called twice after a single `canvas.simulateEdit`) is owned by **WP58**, not by this
  charter. WP46 remains `DONE`; its ACs, its §7 amendment-ledger entry and its test counts are
  not reopened. WP58 fixed it in `plugin/src/testing/e2e-control.ts` `simulateEdit`; both WP46
  blind sets are now green with recorded collected counts of 22 (set1) and 19 (set2).

---

## 10. Risk Notes for Worker 4 (filled by Worker 3 Core)

- **Risk flag:** NONE
