# Task Charter — WP7: E2E rig as mandatory gate

<!-- Updated: Worker 3's BLOCKED escalation resolved in favour of building the rig, not weakening the gate; deps extended onto the T3 layer; AC5/AC6 added 2026-08-01 -->
<!-- Updated: WP69 added as a dependency (no live run without an E2E-capable bundle), the control ports corrected against the landed T3 constants, and the measured pre-flight realities entered; AC1–AC6 unchanged verbatim 2026-08-02 -->
**Charter Status:** `SPEC_COMPLETE`
**WP:** WP7
**Phase:** P0
**task_mode:** `standard`
**Depends on:** WP4, WP5, WP50, WP51, WP69
**W4 Test Targets:** `0`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** the R2 verification debt is discharged for the P0 mechanisms and the rig is a standing gate.
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 5, component **C7 — E2E rig promoted to a mandatory gate** (work package WP7); phase **P0**.

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: modify (`tools/launch_liveshare_e2e.py`, `plugin/src/testing/e2e-control.ts`, `workflowArtifacts/e2e-infra/E2E_USAGE.md`)
  - Responsibility: execute the never-run two-vault rig for the first time and make a green run a release condition from P0 onward.
  - Scope summary: first green two-vault run; gate documented
- **Out of scope / non-goals:**
  - Verifying the `CAPTURE_TRIGGERS` table — that is <!-- Updated: 2026-08-01 --> **WP54** (measurement + ledger) and WP40 (promotion on that evidence); it requires the binding path.
  - Enabling `useCanvasBinding`.
  - Any relay deployment; the rig runs against a local relay.
- **Known interfaces / dependencies:**
  - Input: two real Obsidian hosts, each with an E2E control endpoint on `REAL_CONTROL_PORT_A/B` = **39431 / 39432** (`tools/obsidian_e2e/constants.py:75-76`), against one room on the **rig-started local relay** whose port WP70 defines as a constant. <!-- Updated: corrected 2026-08-02 — this line previously read "ports 39421/39422", which are HEADLESS_RIG_PORT_A/B, i.e. the headless MOCK rig. Following it verbatim would have driven the mock and recorded a green gate that never touched real Obsidian — the exact substitution AC5 exists to prevent. Import the constants; spell no literal. -->
  - Output: a recorded, reproducible green run plus a documented invocation
  - Depends on work packages: WP4, WP5, WP50, WP51, **WP69**
  - <!-- Updated: T3 2026-08-01 --> **"Two Obsidian hosts" now means two real Obsidian instances**, delivered by BUILD_SPEC §5 PHASE T3 (WP43–WP51): `H:\Developement\_NeuralAngels\ObsidianOrga` as role `a` and `H:\Developement\_NeuralAngels\ObsidianOrga - Kopie` as role `b`. The control port is provisioned per vault through the plugin's persisted setting, not through a process environment variable (D14) — both vault windows may share one Obsidian process, so `process.env` cannot differ between them.
  - <!-- Updated: PORTS CORRECTED against the landed T3 constants — 39421/39422 are the HEADLESS rig's ports and using them here would drive the mock, which is exactly what AC5 forbids 2026-08-02 --> **⚠ Port correction.** The "39421/39422" written in the Input line above and in C7's interface block are the **headless mock rig's** ports (`tools/launch_liveshare_e2e.py`, `HEADLESS_RIG_PORT_A`/`_B`). The real-Obsidian rig uses **39431 / 39432** (`tools/obsidian_e2e/constants.py:75–76`, `REAL_CONTROL_PORT_A`/`_B`; `T3_SharedContract` §2), and the two pairs are **deliberately disjoint** so a stale mock endpoint can never be mistaken for a real one (D13). WP44 defines these constants; every other WP reads them. **Do not spell a port literal in this WP** — import the constants. Driving 39421/39422 from this WP would drive the mock rig, which is precisely the substitution AC5 exists to make impossible.
  - <!-- Updated: 2026-08-02 --> **WP69 is a hard precondition of the run, not a nicety.** Both vaults carry a **production** build with zero `__LS_E2E__` occurrences, which cannot host a control endpoint at any port, and the only build that sets the flag true is the watch build that never terminates. Until WP69's one-shot `e2e` mode and its reversible install have landed, this WP is **not runnable** — a dependency state, not a blocker. `readiness.py` will report `PLUGIN_NOT_E2E_CAPABLE`, and that is the correct diagnosis, not a timeout and not a wrong port.

---

## 3. Architecture Context

*Task-local architecture guidance only.*

- **Component(s) being changed:** E2E rig promoted to a mandatory gate
- **Interfaces involved:**
  - Input: two real Obsidian hosts, each with an E2E control endpoint on `REAL_CONTROL_PORT_A/B` = **39431 / 39432** (`tools/obsidian_e2e/constants.py:75-76`), against one room on the **rig-started local relay** whose port WP70 defines as a constant. <!-- Updated: corrected 2026-08-02 — this line previously read "ports 39421/39422", which are HEADLESS_RIG_PORT_A/B, i.e. the headless MOCK rig. Following it verbatim would have driven the mock and recorded a green gate that never touched real Obsidian — the exact substitution AC5 exists to prevent. Import the constants; spell no literal. -->
  - Output: a recorded, reproducible green run plus a documented invocation
- **Constraints from BUILD_SPEC (invariants — what must not change):**
  - Invariants I1–I5 (`ARCHITECTURE.md`) and I6–I10 (CONCEPT_V2 Teil 3) are binding and must not be weakened.
  - Yjs stays. No CRDT library swap, no alternative CRDT introduced anywhere.
  - `CanvasPersistence` remains the single CRDT→disk writer; it emits zero CRDT writes; `coldOpen` runs after `waitForSync` and before `start()`.
  - **Zero new runtime dependencies.** Any dependency at all requires a publish date >= 7 days old (`npm view <pkg>@<version> time.created`); `npm ci` in build/deploy contexts, never `npm install`.
  - `GEOMETRY_KEYS` keeps exactly `{x, y, width, height}` and stays exported (it now describes the *file* schema). Changing membership or removing the export is an ESCALATE.
  - `plugin/src/canvas/canvas-presence.ts` is not modified by this initiative. If a WP believes it must, that is an ESCALATE.
  - `plugin/src/main.ts` may hold wiring only, never logic — it has no test file.
  - `canvas-binding.ts` / `canvas-model-bridge.ts` stay frozen and `useCanvasBinding` stays `false` until WP39/WP40 (only WP22 makes a narrow removal there).
  - Do not bump the plugin version. Do not hand-edit `plugin/main.js` or `server/dist/`. Do not read or edit `plugin/manifest.json` (broken symlink).
  - `server/` source is off limits except in WP41. Deployment, `docker/.env` and any secret are out of scope entirely.
- **Technology / framework / config constraints:**
  - TypeScript + Yjs (`yjs ^13.6.0`); Obsidian's Canvas view is private and untyped — only `canvas-adapter.ts` may touch its internals.
  - Pure cores must import nothing from Obsidian, the filesystem or a clock; the precedent is `plugin/src/canvas/reconcile-plan.ts` (zero imports).
  - **Schema impact:** No `meta.schemaVersion` change and no `.canvas` file-format change. P0 is a pure logic change in the capture and serialisation paths, which is exactly why it ships first (CONCEPT_V2 Teil 13). Mixed-version behaviour: a P0 client and a pre-P0 client interoperate unchanged at the doc level.
- **Entry points / relevant files (from `workflowArtifacts/RepoMap.md`, V2 Touchpoint Inventory):**
  - `tools/launch_liveshare_e2e.py` — `preflight()` `:73`, `build_bundle()` `:90`, `run_bundle()` `:117`, `main()` `:161`; constants `:38–57`; ports 39421/39422
  - `plugin/src/__tests__/e2e/launch-entry.ts` (98 L) — the bundled TS entry
  - `plugin/src/testing/e2e-control.ts` — `createControlServer` `:185`, `buildPluginHost` `:356`, `maybeStartE2EControlServer` `:481`
  - `plugin/esbuild.config.mjs:26` — the `__LS_E2E__` production gate; `:4` and `:32–37` — the mode branch **WP69** extends with a one-shot `e2e` mode. **Read-only context here; this WP does not edit the build config.**
  - `tools/obsidian_e2e/constants.py:72–76` — `HEADLESS_RIG_PORT_A/B` (39421/39422) vs `REAL_CONTROL_PORT_A/B` (39431/39432). Import, never re-spell.
  - `workflowArtifacts/canvas-v2/T3_PREFLIGHT.md` — the measured host facts and the independent restore baselines this WP's AC6 is checked against
  - `workflowArtifacts/e2e-infra/E2E_USAGE.md`
- **Structure references:** *(intentionally empty — no Graphify graph exists for this project; FALLBACK mode is declared in the BUILD_SPEC section 3. Worker 3 fills this in after implementation. Do not invent paths here.)*

If structure references conflict with the BUILD_SPEC or explicit task scope, the BUILD_SPEC and TaskCharter win. Escalate instead of following the map.

---

## 4. Acceptance Criteria

*Exact copy from BUILD_SPEC section 5, component C7. No paraphrasing.*

1. A two-vault run against a real Obsidian executes end to end and is recorded with its command, environment and outcome; any blocker found is fixed in the rig rather than worked around.
2. The run demonstrates at least: a node move propagating both ways, a node create and delete, and an Obsidian save on a deliberately stale view producing no revert on the peer.
3. The gate is documented as a release condition from P0 onward, with the exact invocation, and the previously "never executed" status is corrected in the rig's usage document.
4. The production build still tree-shakes the whole `src/testing/` module out of `main.js` (`__LS_E2E__` false in production).
5. The run is performed by the real-Obsidian rig, and a run performed by the headless mock-host rig cannot be recorded as satisfying this gate: the record names the entrypoint that produced it and the two distinct vault identities it drove, and the mock rig's own documentation and banner state that it is not the gate.
6. The run leaves both vaults unchanged apart from its own scratch artefacts, which are removed; this is established by the before/after vault fingerprint, and a fingerprint mismatch fails the gate rather than being reported as a caveat.

**Definition of Done:** the R2 verification debt is discharged for the P0 mechanisms and the rig is a standing gate.

### Resolution of the WP7 escalation (Worker 2, 2026-08-01)

Worker 3 returned this WP `BLOCKED` and asked Worker 2 to choose between chartering the T3 rig or rewriting these ACs down to the lightweight rig that exists. **The owner chose to build T3.** The refusal was correct: a green mock-host run would have been a false pass on the initiative's most important gate.

What changed, and what did not:

- **AC1–AC4 are unchanged, verbatim.** The gate was never weakened.
- **The rig these ACs describe now exists as chartered work:** BUILD_SPEC §5 **PHASE T3**, WP43–WP51. This WP now depends on **WP50** (the run matrix bound to real hosts) and **WP51** (the stale-view scenario surface that AC2's third demonstration needs), which transitively pull in discovery, port provisioning, launch/attach, the identity handshake, scratch-canvas data safety, teardown and the file-level oracle.
- **AC5 is new** and exists so the mock-for-real substitution can never be made silently again — including by a future agent that finds `tools/launch_liveshare_e2e.py` and assumes it is the gate. It is not: it aliases `obsidian` to `plugin/src/__mocks__/obsidian.ts` at `:45`/`:101` and boots two lightweight plugin hosts. Both rigs are kept (D13); only one is the gate.
- **AC6 is new** and makes data safety a gate condition. The two vaults are the owner's live working vaults (D16).
- **Blocker two is resolved by fact, not by charter:** Obsidian *is* installed at `C:\Users\tschm\AppData\Local\Programs\Obsidian\Obsidian.exe`, and both target vaults exist and are synchronised for this purpose. The earlier "not installed" finding is superseded — do not re-derive it.

### Pre-flight amendments (Worker 2, 2026-08-02) — no acceptance criterion changed

**AC1–AC6 stand verbatim.** What follows constrains how they are discharged, against facts measured on this host on 2026-08-02 (`T3_PREFLIGHT.md`) that did not exist when they were written.

- **AC4 must be re-established against a bundle built *after* WP69's config change**, not inherited from one built before it. WP69 AC2 performs exactly that measurement (byte-identical production `main.js` before and after, zero `__LS_E2E__`, zero E2E markers); this WP **cites** it rather than repeating the build. If WP69's recorded hashes predate the current tree, rebuild and re-measure — a hash is a measurement, not a timeless fact. The pre-flight's finding that both *installed* production bundles contain zero `__LS_E2E__` occurrences is corroboration of the tree-shaking property, **not** a discharge of AC4, because those bundles date from 2026-07-26.
- **AC6 gains a second, independent leg.** Beyond the rig's own before/after fingerprint (C47 AC3 — which is the code under test checking its own work), the run's verdict includes a post-teardown sha256-of-bytes comparison of each vault's `.obsidian/plugins/live-share/data.json` against the baseline recorded in `T3_PREFLIGHT.md` and reproduced in BUILD_SPEC §7, plus WP69's recorded production `main.js` hash per vault. This check consults none of the rig's bookkeeping. **A mismatch fails the gate**, exactly as AC6 already says a fingerprint mismatch does. Both files hold live credentials: comparison is **hash-only**, and no byte, key value or credential is ever printed, logged, echoed into the run record or placed in a fixture.
- **AC2's third demonstration** (an Obsidian save on a deliberately stale view) is discharged through WP51's command surface, in a run whose `lan-vault-sync` disposition has been recorded per WP50 AC5. A stale-view result obtained while a second sync engine was writing the same file, with no record of that decision, is not evidence.
- **AC5's record must name the real ports.** The entrypoint is `tools/launch_obsidian_e2e.py` and the control ports are **39431 / 39432**; 39421/39422 belong to the headless mock rig and appear nowhere in a record that claims to satisfy this gate.
- **The stray third vault registration in `obsidian.json` is user state and out of scope.** It is `open: false` and harmless. The registry is read-only (S3): the gate does not repair, reformat or rewrite it, and a run that does has failed on data safety whatever else it proved.
- **Nothing above has been executed.** The pre-flight established preconditions, not results. No control endpoint has ever answered on this host, no E2E bundle has been built or installed, and no arm of the gate has been observed. Every statement this WP makes about a run must be a statement about a run that actually happened.

---

## 5. Constraints and Known Risks

- **Permission / environment limits:** Windows dev host; run all plugin commands from `plugin/` (never the repo root). Runner is Vitest 4.0.18 — the `basic` reporter was removed, use the default or `--reporter=dot`. Budget >= 90 s for any automated `npm test` invocation (a 33.5 s sleeper makes ~41 s the floor, not a hang). No Graphify graph exists for this project (declared FALLBACK mode) — `workflowArtifacts/RepoMap.md` is the structural map.
- **Known flaky patterns:**
  - No timing-based echo suppression: no new `setTimeout` waits and no new timing constants. V2's echo breaker is byte equality.
  - No wall-clock sleeps in new tests (the existing 33.5 s sleeper in `wp5/latency.test.ts` is legacy, not a pattern to copy).
  - Never reason from two peers only — interleaving classes from three peers upward are distinct.
  - Do not assert on log strings as the primary oracle; state is the oracle, signatures are for humans.
  - Biome reports a whole-file `format` finding per touched file (CRLF environment artifact). Advisory locally, gating in CI — do not mass-reformat.
- <!-- Updated: measured host realities entered from T3_PREFLIGHT.md 2026-08-02 --> **Host realities for the run, measured 2026-08-02 — given, do not re-derive:**
  - **⚠ `npm run dev` never terminates**, and it is the only build that sets `__LS_E2E__` true. Never `await_console` on it. The one-shot `e2e` build is **WP69**; this WP consumes it and does not edit `plugin/esbuild.config.mjs`.
  - **Obsidian was not running at measurement time** (0 processes). The rig launches what is not open and **attaches** to what is (D15) — it never closes, kills or restarts a window it did not start, and a run that would need that stops and says so. Note the interaction with WP69: replacing `main.js` under an instance the rig did not start does not take effect until that plugin reloads, and forcing the reload by restarting that instance is forbidden.
  - **`lan-vault-sync` is enabled in both vaults** (with `obsidian-git`). Its disposition for this run is recorded per WP50 AC5 — disabled and restored, or left live and accepted. Both plugins must survive the run.
  - **Vault B's path contains spaces**, on a host with a recorded `run_command` nested-quote trap. The entrypoint is launched through `visible-console` `run_python` with an **absolute** script path, then `await_console` (BUILD_SPEC §7). Never a Bash background process, never a hand-quoted path in a shell string.
  - **The plugin directories contain the owner's own backups** — `main.js.bak`, `main.js.0.5.9.bak`, `manifest.json.bak`. Not ours: never written, moved, renamed or deleted, and never used as a restore point.
  - **Both `data.json` files hold live credentials.** No secret goes through any agent tool, into any command string, into the run record or into a fixture. Comparison is sha256-of-bytes only.
- **External dependency risks:** No new runtime dependency is permitted. Yjs, `y-protocols`, `lib0` and `minimatch` are already present and are the only libraries available. Obsidian's private Canvas API may vanish at any release — degrade, never break (I5).
- **Hard constraints:**
  - Invariants I1–I5 (`ARCHITECTURE.md`) and I6–I10 (CONCEPT_V2 Teil 3) are binding and must not be weakened.
  - Yjs stays. No CRDT library swap, no alternative CRDT introduced anywhere.
  - `CanvasPersistence` remains the single CRDT→disk writer; it emits zero CRDT writes; `coldOpen` runs after `waitForSync` and before `start()`.
  - **Zero new runtime dependencies.** Any dependency at all requires a publish date >= 7 days old (`npm view <pkg>@<version> time.created`); `npm ci` in build/deploy contexts, never `npm install`.
  - `GEOMETRY_KEYS` keeps exactly `{x, y, width, height}` and stays exported (it now describes the *file* schema). Changing membership or removing the export is an ESCALATE.
  - `plugin/src/canvas/canvas-presence.ts` is not modified by this initiative. If a WP believes it must, that is an ESCALATE.
  - `plugin/src/main.ts` may hold wiring only, never logic — it has no test file.
  - `canvas-binding.ts` / `canvas-model-bridge.ts` stay frozen and `useCanvasBinding` stays `false` until WP39/WP40 (only WP22 makes a narrow removal there).
  - Do not bump the plugin version. Do not hand-edit `plugin/main.js` or `server/dist/`. Do not read or edit `plugin/manifest.json` (broken symlink).
  - `server/` source is off limits except in WP41. Deployment, `docker/.env` and any secret are out of scope entirely.

---

## 6. Definition of Done Artifacts

- **Required changed files:** <!-- Updated: T3 2026-08-01 -->
  - `workflowArtifacts/e2e-infra/E2E_USAGE.md` — corrects the "never executed" status **and** states that this document describes the headless mock rig, which is not the gate (AC5)
  - `tools/launch_liveshare_e2e.py` — self-identification as the headless rig only; the real run is driven by the T3 entrypoint `tools/launch_obsidian_e2e.py` (WP45), which this WP consumes rather than creates
  - `plugin/src/testing/e2e-control.ts` (only if the run reveals a rig defect — AC1 requires fixing the rig, not working around it)
  - the recorded gate run itself, under `workflowArtifacts/canvas-v2/`, naming the entrypoint, the two vault identities, the environment, the outcome, and the before/after vault fingerprint result (AC5, AC6) — <!-- Updated: pre-flight evidence requirements 2026-08-02 --> and additionally: the real control ports actually used (39431/39432, from the constants, not literals); the identity of the installed bundle per role, with WP69's production/E2E sha256 pair; the `lan-vault-sync` disposition taken and its restoration if it was disabled; the independent post-teardown `data.json` hash comparison per vault against the `T3_PREFLIGHT.md` baseline, expressed as match/mismatch with hashes only and no file content; and an explicit list of anything the run did **not** demonstrate, so no reader can infer coverage the run did not have
- **Required report:** `ImplementationReport_WP7.md` (in `workflowArtifacts/canvas-v2/`)
- **BUILD_SPEC updates required:** no — unless implementation invalidates an architecture decision, in which case ESCALATE rather than editing the spec.
- **Gate status required at handover:** `npm run build` PASS and `npm test` with 0 failures, run from `plugin/`. All visible tests PASS.

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

> <!-- Updated: 2026-08-01 --> **SUPERSEDED as a blocker, retained as a record.** Worker 3's analysis below was correct and is preserved verbatim; its "Decision required from Worker 2" is now answered — see *Resolution of the WP7 escalation* in section 4. Two of its statements are factually superseded: Obsidian **is** installed (`C:\Users\tschm\AppData\Local\Programs\Obsidian\Obsidian.exe`), and the rig it correctly identified as mock-bound is now being replaced for this purpose by the T3 entrypoint (WP43–WP51). The risk flag stands as HIGH for Worker 4's attention until the first real run is recorded, but this WP is no longer BLOCKED — it is **not yet runnable**, which is a dependency state, not a blocker.

- **Risk flag:** HIGH — BLOCKED, not implemented.
- **Outcome:** AC4 verified PASS (production `main.js` contains zero `src/testing/` symbols). AC1, AC2, AC3 BLOCKED.
- **Blocked for two independent reasons:**
  1. Obsidian is not installed on this host (checked `%LOCALAPPDATA%\Obsidian\Obsidian.exe`, `C:\Program Files\Obsidian\Obsidian.exe`, plus a recursive scan of `C:\` and `H:\` to depth 4).
  2. `tools/launch_liveshare_e2e.py` is by design **not** a real-Obsidian rig — it aliases the `obsidian` import to the mock and boots two lightweight plugin hosts. Its own usage doc scopes it as "NOT two full Obsidian instances. Real full-Obsidian orchestration is T3 and out of scope."
- **The rig was deliberately not run**, because a green lightweight-host run would prove nothing about AC1/AC2 and would constitute a false pass on the initiative's most important gate.
- **Decision required from Worker 2:** either charter the T3 real-Obsidian rig as its own WP and make WP7 depend on it, or rewrite WP7's ACs to target the lightweight rig that exists (a materially weaker gate than CONCEPT_V2 Teil 14 intends).
- Full detail: `ImplementationReport_WP7.md` and `Worker3Handover_B1_P0.md`.
