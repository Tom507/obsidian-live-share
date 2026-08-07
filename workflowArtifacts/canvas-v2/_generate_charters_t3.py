"""Generate the 12 T3 TaskCharter files (WP43-WP54) for the canvas-V2 initiative.

Sibling of `_generate_charters.py`, which produced WP1-WP42 and MUST NOT be re-run
(Worker 3 has since filled sections 8-10 of several of those charters; re-running it
would overwrite that state, and its `assert len(table) == 42` no longer holds anyway).

Same contract as the original: ACs, interfaces, change type and DoD are PARSED out of
BUILD_SPEC_CanvasV2.md so they are copied verbatim. Phase / title / dependencies come
from the section 9 breakdown table. Only per-WP scope boundaries, entry points and
required files are authored here.

Run once. Idempotent: overwrites its own output (WP43-WP54 only).
"""

from __future__ import annotations

import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
SPEC = HERE / "BUILD_SPEC_CanvasV2.md"
SPEC_REL = "workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md"

FIRST, LAST = 43, 54

text = SPEC.read_text(encoding="utf-8")

# --- section 9 table: WP -> (phase, title, scope summary, depends) ---------
row_re = re.compile(
    r"^\|\s*(WP\d+)\s*\|\s*(P\d)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*planned\s*\|$",
    re.MULTILINE,
)
table: dict[str, dict[str, str]] = {}
for m in row_re.finditer(text):
    wp, phase, title, scope, deps = m.groups()
    table[wp] = {
        "phase": phase,
        "title": title.strip(),
        "scope": scope.strip(),
        "deps": deps.strip(),
    }

# --- component blocks ------------------------------------------------------
block_re = re.compile(r"^#### (C\d+) — (.+?)$", re.MULTILINE)
marks = list(block_re.finditer(text))
components: dict[str, dict] = {}

for i, m in enumerate(marks):
    start = m.end()
    end = marks[i + 1].start() if i + 1 < len(marks) else len(text)
    body = text[start:end]

    def field(name: str, _body: str = "") -> str:
        f = re.search(rf"^- {re.escape(name)}:\s*(.+?)$", _body, re.MULTILINE)
        return f.group(1).strip() if f else ""

    sub = {}
    for key in ("Input", "Output"):
        f = re.search(rf"^  - {key}:\s*(.+?)$", body, re.MULTILINE)
        sub[key] = f.group(1).strip() if f else ""

    ac_block = re.search(
        r"^- Acceptance Criteria:\s*$\n((?:^  \d+\. .+$\n?)+)", body, re.MULTILINE
    )
    acs: list[str] = []
    if ac_block:
        for line in ac_block.group(1).splitlines():
            acs.append(re.sub(r"^\s*\d+\.\s*", "", line).strip())

    wp = re.search(r"^- Assigned to work package: \*\*(WP\d+)\*\*", body, re.MULTILINE)
    if not wp:
        continue

    components[wp.group(1)] = {
        "cid": m.group(1),
        "cname": m.group(2).strip(),
        "change_type": field("Change type", body),
        "responsibility": field("Responsibility", body),
        "input": sub["Input"],
        "output": sub["Output"],
        "acs": acs,
        "dod": field("Definition of Done", body),
    }

WPS = [f"WP{n}" for n in range(FIRST, LAST + 1)]
missing_rows = [w for w in WPS if w not in table]
missing_comps = [w for w in WPS if w not in components]
assert not missing_rows, f"section 9 rows missing: {missing_rows}"
assert not missing_comps, f"component blocks missing: {missing_comps}"

# --------------------------------------------------------------------------
# Shared constraint text
# --------------------------------------------------------------------------

T3_SCHEMA = (
    "**Schema impact:** none. PHASE T3 changes no doc format and no `.canvas` file format — "
    "it is host orchestration, identity, data safety and observation only. A T3 WP that finds "
    "itself needing a format change has left its scope and must ESCALATE."
)

COMMON_HARD = [
    "Invariants I1–I5 (`ARCHITECTURE.md`) and I6–I10 (CONCEPT_V2 Teil 3) are binding and must not be weakened.",
    "Yjs stays. No CRDT library swap, no alternative CRDT introduced anywhere.",
    "`CanvasPersistence` remains the single CRDT→disk writer; it emits zero CRDT writes; `coldOpen` runs after `waitForSync` and before `start()`. **A T3 oracle reads what that writer produced; it never writes, re-serialises or normalises a `.canvas` file itself.**",
    "**Zero new runtime dependencies.** Any dependency at all requires a publish date >= 7 days old (`npm view <pkg>@<version> time.created`); `npm ci` in build/deploy contexts, never `npm install`. This applies to the Python side of the rig as well — prefer the standard library, which is what the existing rig and MCP driver already do.",
    "`GEOMETRY_KEYS` keeps exactly `{x, y, width, height}` and stays exported (it now describes the *file* schema). Changing membership or removing the export is an ESCALATE.",
    "`plugin/src/canvas/canvas-presence.ts` is not modified by this initiative. If a WP believes it must, that is an ESCALATE.",
    "`plugin/src/main.ts` may hold wiring only, never logic — it has no test file.",
    "`canvas-binding.ts` / `canvas-model-bridge.ts` stay frozen and `useCanvasBinding` stays `false` until WP39/WP40 (only WP22 makes a narrow removal there).",
    "Do not bump the plugin version. Do not hand-edit `plugin/main.js` or `server/dist/`. Do not read or edit `plugin/manifest.json` (broken symlink).",
    "`server/` source is off limits except in WP41. Deployment, `docker/.env` and any secret are out of scope entirely.",
]

T3_HARD = [
    "**Data safety (D16, BUILD_SPEC §7 data-safety gate).** `H:\\Developement\\_NeuralAngels\\ObsidianOrga` and `H:\\Developement\\_NeuralAngels\\ObsidianOrga - Kopie` are the owner's **live working vaults**. No pre-existing note, canvas or attachment is ever opened for writing. Everything a run touches is a rig-created scratch artefact that teardown removes. A run that leaves either vault changed outside its own scratch artefacts is a FAILED run whatever else it proved.",
    "**Never terminate what the rig did not start (D15).** No process, window or Obsidian instance the rig did not itself launch may be closed, killed or restarted. If a run would need that, it stops and says so.",
    "**Long-running or interactive processes go through the `visible-console` MCP tools** (`run_python` / `run_command`, then `await_console`) — never a Bash background process. Python is launched via `run_python` with an **absolute** script path: `run_command` wraps its argument in `cmd.exe /d /c \"…\"`, so any nested double quote (and therefore any quoted path with spaces) breaks argument parsing. This is a workspace rule, not a preference.",
    "**Settings are borrowed, not taken.** Any per-vault plugin setting the rig provisions is captured byte-exactly beforehand and restored byte-exactly on every exit path, including crash and interruption.",
    "**No secret through an agent tool.** No password, token or passphrase in any command string, script argument or control-protocol message.",
    "**The mock rig is never the gate (D13).** A green run of `tools/launch_liveshare_e2e.py` may not be recorded as satisfying WP7, WP40 or WP54. It aliases the `obsidian` module to `src/__mocks__/obsidian.ts` and boots two lightweight plugin hosts.",
]

COMMON_FLAKY = [
    "No timing-based echo suppression: no new `setTimeout` waits and no new timing constants. V2's echo breaker is byte equality.",
    "No wall-clock sleeps in new tests (the existing 33.5 s sleeper in `wp5/latency.test.ts` is legacy, not a pattern to copy).",
    "Never reason from two peers only — interleaving classes from three peers upward are distinct.",
    "Do not assert on log strings as the primary oracle; state is the oracle, signatures are for humans.",
    "Biome reports a whole-file `format` finding per touched file (CRLF environment artifact). Advisory locally, gating in CI — do not mass-reformat.",
]

T3_FLAKY = [
    "`sync.waitQuiescent` as it stands is bumped **only** by control-initiated `canvas.simulateEdit`; both host builders pass `bump = () => {}`. On a real instance it therefore reports quiescent while remote deltas are still in flight. Do not build a wait on it until WP49 fixes it.",
    "`canvas.state` returns the shared-doc snapshot, not the rendered view and not the file. Doc-level convergence is not file-level convergence on a real host (D17).",
    "Binding-counter SSE events currently carry `path: \"\"` — they are module-global, not path-scoped (WP52 fixes this). Do not attribute one to a canvas before then.",
    "A real Obsidian run is slow and stateful. Retrying a flaky step without a teardown in between compounds state; re-run from a clean start instead.",
    "Obsidian is single-instance: a second vault opens as another window in the same process tree, so process-level identity says nothing about which vault is which (D14).",
]

COMMON_ENV = (
    "Windows dev host; run all plugin commands from `plugin/` (never the repo root). "
    "Runner is Vitest 4.0.18 — the `basic` reporter was removed, use the default or `--reporter=dot`. "
    "Budget >= 90 s for any automated `npm test` invocation (a 33.5 s sleeper makes ~41 s the floor, not a hang). "
    "No Graphify graph exists for this project (declared FALLBACK mode) — `workflowArtifacts/RepoMap.md` is the structural map. "
    "**T3 environment facts, given — do not re-derive:** Obsidian executable "
    "`C:\\Users\\tschm\\AppData\\Local\\Programs\\Obsidian\\Obsidian.exe`; vault registry "
    "`%APPDATA%\\obsidian\\obsidian.json`; target vaults `H:\\Developement\\_NeuralAngels\\ObsidianOrga` and "
    "`H:\\Developement\\_NeuralAngels\\ObsidianOrga - Kopie` (spaces in the path are load-bearing); the built "
    "plugin is already installed in the first. The Python side of this phase has no vitest coverage and must not "
    "pretend to — its units are verified by a standalone `python tools/test_<name>.py` script per workspace "
    "convention; every TypeScript change still goes through the `plugin/` vitest gate."
)

# --------------------------------------------------------------------------
# Authored per-WP data
# --------------------------------------------------------------------------

D: dict[str, dict] = {
"WP43": dict(slug="VaultInstanceDiscovery",
  out=["Launching, attaching to, or provisioning anything — this WP only observes (that is WP44/WP45).",
       "Deciding which vault is role `a` and which is `b` at run time; the pair is configuration, this module resolves it.",
       "Claiming that a running process serves a particular vault — only the control endpoint can establish that (WP46)."],
  entry=["`tools/obsidian_e2e/vaults.py` (new)",
         "`tools/launch_liveshare_e2e.py` — `preflight()` `:73`, constants `:38–57`: the existing preflight shape and the mock-alias this phase separates from",
         "`%APPDATA%\\obsidian\\obsidian.json` — the vault registry (read-only input, never written)"],
  files=["`tools/obsidian_e2e/vaults.py` (new)"]),

"WP44": dict(slug="PerVaultControlPortProvisioning",
  out=["Starting Obsidian or waiting for a port to answer — provisioning only prepares the setting (WP45/WP46).",
       "Changing any plugin setting other than the control port.",
       "Introducing a new precedence rule into `resolvePort`; its existing order stands."],
  entry=["`tools/obsidian_e2e/ports.py` (new)",
         "`plugin/src/testing/e2e-control.ts:462–473` — `resolvePort`: `process.env.LIVESHARE_E2E` first, then the hidden `plugin.settings.e2eControlPort`, else `null` (no server)",
         "`tools/launch_liveshare_e2e.py:178–186` — the existing `LIVESHARE_E2E_PORT_A` / `_B` defaults 39421 / 39422",
         "the per-vault plugin settings file inside each vault's `.obsidian/plugins/<id>/`"],
  files=["`tools/obsidian_e2e/ports.py` (new)",
         "`plugin/src/testing/e2e-control.ts`"]),

"WP45": dict(slug="ObsidianLaunchAttachLifecycle",
  out=["Deciding readiness — a reachable port is not a ready instance (WP46).",
       "Any form of closing, killing or restarting a window the rig did not start.",
       "Replacing or deleting `tools/launch_liveshare_e2e.py`; it stays as the headless rig and is only made to identify itself as such."],
  entry=["`tools/obsidian_e2e/lifecycle.py` (new)",
         "`tools/launch_obsidian_e2e.py` (new — the real-rig entrypoint)",
         "`tools/launch_liveshare_e2e.py:45` and `:101` — `OBSIDIAN_MOCK` and `--alias:obsidian=…`, the exact seam that makes that script the mock rig",
         "`tools/launch_liveshare_e2e.py:126–158` — `_terminate_child()`, the existing terminate→wait→kill pattern (a model for rig-started processes only)"],
  files=["`tools/obsidian_e2e/lifecycle.py` (new)",
         "`tools/launch_obsidian_e2e.py` (new)",
         "`tools/launch_liveshare_e2e.py`"]),

"WP46": dict(slug="ReadinessIdentityHandshake",
  out=["Adding authentication to the control protocol; localhost binding plus the `__LS_E2E__` gate remains the boundary.",
       "Changing the transport — the control server stays `node:http` on `127.0.0.1`, no WebSocket, no new dependency.",
       "Any canvas operation; readiness precedes the first edit and issues none."],
  entry=["`plugin/src/testing/e2e-control.ts:122–144` — the command router and the existing `session.info` (`clientId`, `role`, `roomId`, `connected`)",
         "`plugin/src/testing/e2e-control.ts:315–332` — `E2EPluginLike`, the structural interface the real `LiveSharePlugin` already satisfies",
         "`plugin/src/testing/e2e-control.ts:273–277` — `createControlServer` / `onListening`",
         "`plugin/src/__tests__/e2e/two-host-harness.ts:206–216` — `waitForBoundPort`, the existing bounded-readiness precedent",
         "`tools/obsidian_e2e/readiness.py` (new)"],
  files=["`plugin/src/testing/e2e-control.ts`",
         "`tools/obsidian_e2e/readiness.py` (new)"]),

"WP47": dict(slug="ScratchCanvasVaultSafety",
  out=["Editing the scratch canvas — creating and disposing of it is this WP; driving it is WP50/WP53.",
       "Any operation on a pre-existing note, canvas or attachment, for reading-as-input as well as for writing.",
       "A fingerprint that is merely logged; the comparison is part of the run verdict."],
  entry=["`tools/obsidian_e2e/scratch.py` (new)",
         "`plugin/src/testing/e2e-control.ts:122–144` — the command router (new scratch create/remove commands go here)",
         "`plugin/src/files/canvas-persistence.ts` — the single writer whose output the scratch file is; the rig must not write the file itself",
         "`tools/MCPserver/liveshare_e2e_mcp_server.py:403` — the current hard-coded default canvas name `e2e-matrix.canvas`, which the scratch path replaces"],
  files=["`tools/obsidian_e2e/scratch.py` (new)",
         "`plugin/src/testing/e2e-control.ts`"]),

"WP48": dict(slug="TeardownCrashRecovery",
  out=["Recovering Obsidian itself; if the application dies the run fails — the rig recovers its own state, not the editor's.",
       "Retrying a failed run automatically; reclaim prepares a clean start, it does not re-run.",
       "Any teardown step that could touch a non-scratch artefact."],
  entry=["`tools/obsidian_e2e/teardown.py` (new)",
         "`tools/launch_obsidian_e2e.py` (from WP45)",
         "`plugin/src/testing/e2e-control.ts:285–295` — `ControlServerHandle.close()` (ends SSE clients, then the server)",
         "`plugin/src/__tests__/e2e/two-host-harness.ts:190–201` — `HostHandle.close()`, the existing per-resource try/catch teardown pattern",
         "`tools/MCPserver/liveshare_e2e_mcp_server.py:54` — `_DEFAULT_TIMEOUT = 15.0`, currently with no retry and no reclaim"],
  files=["`tools/obsidian_e2e/teardown.py` (new)",
         "`tools/launch_obsidian_e2e.py`"]),

"WP49": dict(slug="RealQuiescenceFileOracle",
  out=["Changing what `CanvasPersistence` writes or when; the oracle observes its output only.",
       "Introducing a polling loop with a fixed sleep as the quiescence mechanism; quiescence follows activity, not the clock.",
       "Comparing anything other than what the two instances actually hold — no normalisation to make a comparison succeed."],
  entry=["`plugin/src/testing/e2e-control.ts:438–451` — `sync.waitQuiescent` (50 ms quiet window, currently bumped only by `simulateEdit`)",
         "`plugin/src/testing/e2e-control.ts:507` — `bump` passed as `() => {}` in `maybeStartE2EControlServer`",
         "`plugin/src/__tests__/e2e/two-host-harness.ts:170` — the same `bump` no-op in the lightweight host builder",
         "`plugin/src/files/canvas-sync.ts:132–137` — `serializeCanvas`, the canonical form the file oracle compares",
         "`tools/MCPserver/liveshare_e2e_mcp_server.py:169` — `_compare`, the existing order-independent id-keyed doc comparison"],
  files=["`plugin/src/testing/e2e-control.ts`"]),

"WP50": dict(slug="RunMatrixRealHosts",
  out=["Adding new matrix cases; this WP binds the existing six to real hosts.",
       "Changing the control protocol; the driver is a client of it.",
       "Keeping the doc oracle as the sole verdict source — the file oracle joins it, it does not replace it."],
  entry=["`tools/MCPserver/liveshare_e2e_mcp_server.py:134` — `_wait_both`, which settles via `sync.waitQuiescent`",
         "`tools/MCPserver/liveshare_e2e_mcp_server.py:280` — `assert_converged`; `:169` — `_compare`",
         "`tools/MCPserver/liveshare_e2e_mcp_server.py:321` — `_run_case`, incl. the 3-char case-prefix id namespacing at `:327`",
         "`tools/MCPserver/liveshare_e2e_mcp_server.py:45–52` — `MATRIX_CASES`, the six SPEC_04 cases",
         "`tools/mcp_proxy_config.json:158–164` — the `liveshare-e2e` registration (`alwaysOn:false`, `lazy_load:true`)"],
  files=["`tools/MCPserver/liveshare_e2e_mcp_server.py`"]),

"WP51": dict(slug="StaleViewScenarioSurface",
  out=["Asserting the scenario's outcome; this WP provides the surface, WP7 performs and records the run.",
       "Adding a test-only conditional to a production canvas module — the scenario rides the injected seams WP6 already requires.",
       "A stale-view state that cannot be left; entering and leaving are both commands."],
  entry=["`plugin/src/testing/e2e-control.ts:425–436` — `canvas.setFlag` and its per-host `runtimeFlags` map (currently inert: nothing reads it)",
         "`plugin/src/testing/e2e-control.ts:122–144` — the command router",
         "the WP6 chaos-suite seams — 'view apply artificially delayed' and 'adapter unavailable' (C6 AC1/AC2), which this surface reuses rather than duplicates",
         "`plugin/src/main.ts:1046–1175` — `reconcileLiveCanvas`, the path the delayed-apply seam gates (read for shape; wiring only, no logic)"],
  files=["`plugin/src/testing/e2e-control.ts`"]),

"WP52": dict(slug="AdapterInteractionTap",
  out=["Changing which signals the adapter patches; the tap observes the existing patch set, it does not extend it (extending it is a possible WP54 outcome).",
       "Interpreting the events — the tap records, the ledger judges (WP54).",
       "Any tap that is present in the production bundle."],
  entry=["`plugin/src/canvas/canvas-adapter.ts:240–245` — `PatchName = \"updateSelection\" | \"setDragging\" | \"markViewportChanged\"`",
         "`plugin/src/canvas/canvas-adapter.ts:107–109` — `onNodeInteractionStart` / `onNodeInteractionEnd`",
         "`plugin/src/canvas/canvas-binding.ts:81–89` — `setCanvasBindingInstrument`, with call sites `:213` `applyRemote`, `:263` `captureLocal`, `:304` `rePush`, `:305` `originUpdate`",
         "`plugin/src/testing/e2e-control.ts:501–505` — the instrument install; `:259–271` — `maybeEmitForRequest`, the existing SSE fan-out (binding events currently carry `path: \"\"`)",
         "`plugin/esbuild.config.mjs:26` — `__LS_E2E__`, the tree-shake gate"],
  files=["`plugin/src/testing/e2e-control.ts`",
         "`plugin/src/canvas/canvas-adapter.ts`",
         "`plugin/src/canvas/canvas-binding.ts`"]),

"WP53": dict(slug="GestureDriverTriggerSet",
  out=["Emitting or simulating the committing signal itself — that would restate the R2 assumption as a green test (D18).",
       "Judging what a gesture proved; the driver reports, WP54 decides.",
       "Driving a gesture against anything other than the run's scratch canvas."],
  entry=["`plugin/src/testing/e2e-control.ts:122–144` — the command router (the new gesture command family)",
         "`plugin/src/testing/e2e-control.ts:397–423` — `canvas.simulateEdit`, which writes the doc directly and is exactly what a gesture must NOT do",
         "`plugin/src/__tests__/harness/interaction-driver.ts` — `driveDrag` / `driveResize` / `driveAddNode` / `driveEdge` / `driveDeleteNode` / `driveTextEdit`: the headless precedent for the gesture vocabulary (it fires the signal directly, which the real driver must not)",
         "`plugin/src/canvas/canvas-model-bridge.ts:88–93` — `CAPTURE_TRIGGERS`, the exact set of claims the gestures must cover"],
  files=["`plugin/src/testing/e2e-control.ts`"]),

"WP54": dict(slug="CaptureTriggerVerificationLedger",
  out=["Flipping `useCanvasBinding` — that is WP40 and only WP40.",
       "Recording a verdict for an interaction whose gesture did not demonstrably take effect; that is UNCONFIRMED, not a pass.",
       "Extending the adapter's patched signal set as part of this WP — if the measurement shows an interaction fires neither signal, that is a recorded finding and an ESCALATE, not silent new scope."],
  entry=["`plugin/src/canvas/canvas-model-bridge.ts:61–93` — the `CAPTURE_TRIGGERS` block and its \"⚠ ASSUMPTION — Phase-0 real-vault spike\" warning, which this WP replaces with a measurement",
         "`ARCHITECTURE.md` Part IX R2 — the exact list of unverified trigger assumptions",
         "`workflowArtifacts/CONCEPT_V2.md` Teil 14 §2 — the wording that makes this a release condition",
         "`workflowArtifacts/canvas-v2/CaptureTriggerLedger.md` (new — the evidence artefact WP40 AC5 consults)"],
  files=["`workflowArtifacts/canvas-v2/CaptureTriggerLedger.md` (new)",
         "`plugin/src/canvas/canvas-model-bridge.ts` (only if the measurement corrects the mapping)"]),
}

TPL = """# Task Charter — {wp}: {title}

**Charter Status:** `SPEC_COMPLETE`
**WP:** {wp}
**Phase:** {phase} (PHASE T3 group)
**task_mode:** `standard`
**Depends on:** {deps}
**W4 Test Targets:** `0`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** {dod}
- **BUILD_SPEC reference:** `{spec}` — section 5, **PHASE T3**, component **{cid} — {cname}** (work package {wp}); phase **{phase}**.

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: {change_type}
  - Responsibility: {responsibility}
  - Scope summary: {scope}
- **Out of scope / non-goals:**
{out_scope}
- **Known interfaces / dependencies:**
  - Input: {input}
  - Output: {output}
  - Depends on work packages: {deps}

---

## 3. Architecture Context

*Task-local architecture guidance only.*

- **Component(s) being changed:** {cname}
- **Interfaces involved:**
  - Input: {input}
  - Output: {output}
- **Why PHASE T3 exists (one paragraph, do not re-derive):** CONCEPT_V2 Teil 14 makes a green two-vault run against **real Obsidian** a release condition from P0 onward, and from P5 additionally the empirical confirmation of every `CAPTURE_TRIGGERS` assumption. The rig that exists, `tools/launch_liveshare_e2e.py`, aliases the `obsidian` module to `plugin/src/__mocks__/obsidian.ts` and boots two lightweight plugin hosts — its own usage document scopes real-Obsidian orchestration out as "T3". A green run there proves nothing about the gate, which is why Worker 3 returned WP7 BLOCKED rather than running it. PHASE T3 builds the missing host layer. The control protocol, its command set, the `E2EPluginLike` interface (which the real `LiveSharePlugin` already satisfies), the `__LS_E2E__` bootstrap, the binding instrument seam and the `liveshare-e2e` MCP driver **already exist and are not rebuilt** — T3 is a host-launch, identity, safety and oracle layer.
- **Constraints from BUILD_SPEC (invariants — what must not change):**
{hard}
- **Technology / framework / config constraints:**
  - TypeScript + Yjs (`yjs ^13.6.0`); Obsidian's Canvas view is private and untyped — only `canvas-adapter.ts` may touch its internals.
  - Pure cores must import nothing from Obsidian, the filesystem or a clock; the precedent is `plugin/src/canvas/reconcile-plan.ts` (zero imports).
  - The control server is `node:http` bound to `127.0.0.1` — deliberately not a WebSocket, to keep the production dependency count at zero. `POST /command` takes `{{cmd, args}}`; `GET /events` is an SSE stream. There is no handshake and no auth: localhost plus the `__LS_E2E__` build gate is the boundary.
  - {schema_line}
- **Entry points / relevant files (from `workflowArtifacts/RepoMap.md`, the V2 Touchpoint Inventory, and the e2e-infra survey):**
{entry}
- **Structure references:** *(intentionally empty — no Graphify graph exists for this project; FALLBACK mode is declared in the BUILD_SPEC section 3. Worker 3 fills this in after implementation. Do not invent paths here.)*

If structure references conflict with the BUILD_SPEC or explicit task scope, the BUILD_SPEC and TaskCharter win. Escalate instead of following the map.

---

## 4. Acceptance Criteria

*Exact copy from BUILD_SPEC section 5, PHASE T3, component {cid}. No paraphrasing.*

{acs}

**Definition of Done:** {dod}

---

## 5. Constraints and Known Risks

- **Permission / environment limits:** {env}
- **Known flaky patterns:**
{flaky}
- **External dependency risks:** No new runtime dependency is permitted. Yjs, `y-protocols`, `lib0` and `minimatch` are already present and are the only libraries available; the Python rig and the MCP driver are standard-library only today and should stay that way. If a dependency is genuinely unavoidable, its published version must be **>= 7 days old** (`npm view <pkg>@<version> time.created`) per workspace policy, and introducing it is an ESCALATE, not a judgement call. Obsidian's private Canvas API may vanish at any release — degrade, never break (I5).
- **Hard constraints:**
{hard}

---

## 6. Definition of Done Artifacts

- **Required changed files:**
{files}
- **Required report:** `ImplementationReport_{wp}.md` (in `workflowArtifacts/canvas-v2/`)
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
"""


def bullets(items: list[str], indent: str = "  - ") -> str:
    return "\n".join(f"{indent}{i}" for i in items)


written: list[str] = []
for wp in WPS:
    t = table[wp]
    c = components[wp]
    d = D[wp]

    acs = "\n".join(f"{i}. {a}" for i, a in enumerate(c["acs"], start=1))

    body = TPL.format(
        wp=wp,
        title=t["title"],
        phase=t["phase"],
        deps=t["deps"] if t["deps"] != "—" else "`none`",
        scope=t["scope"],
        spec=SPEC_REL,
        cid=c["cid"],
        cname=c["cname"],
        change_type=c["change_type"],
        responsibility=c["responsibility"],
        out_scope=bullets(d["out"]),
        input=c["input"],
        output=c["output"],
        hard=bullets(COMMON_HARD + T3_HARD),
        schema_line=T3_SCHEMA,
        entry=bullets(d["entry"]),
        acs=acs,
        dod=c["dod"],
        env=COMMON_ENV,
        flaky=bullets(COMMON_FLAKY + T3_FLAKY),
        files=bullets(d["files"]),
    )

    name = f"TaskCharter_{wp}_{d['slug']}.md"
    (HERE / name).write_text(body, encoding="utf-8")
    written.append(f"{wp} [{t['phase']}] {name} :: {t['title']} :: deps={t['deps']}")

print(f"BUILD_SPEC parsed: {len(components)} components, {len(table)} table rows")
print(f"T3 charters written: {len(written)}")
for line in written:
    print("  " + line)
