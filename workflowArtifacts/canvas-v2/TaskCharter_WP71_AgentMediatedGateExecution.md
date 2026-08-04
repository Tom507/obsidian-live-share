# Task Charter — WP71: Agent-mediated gate execution — run plan, outcomes and replay

<!-- Updated: chartered 2026-08-04 — lifecycle.py's only console backend is PlanOnlyConsole and there is no process spawn anywhere under tools/obsidian_e2e/, so the T3 rig cannot start Obsidian and a gate run is necessarily agent-mediated. WP43–WP49 delivered what they were chartered to deliver; the mediation was never chartered at all. -->
**Charter Status:** `SPEC_COMPLETE`
**WP:** WP71
**Phase:** P0 (PHASE T3 group)
**task_mode:** `standard`
**Depends on:** WP45, WP48
**W4 Test Targets:** `0`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** a gate run nobody can start with one command can nevertheless be replayed step by step from a committed artefact, and no step of it rests on an agent's account of itself.
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 5, **PHASE T3**, component **C71 — Agent-mediated gate execution: the run plan, its outcomes and its replay** (work package WP71); phase **P0**.

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: create (`tools/obsidian_e2e/mediation.py` — the plan/outcome artefact and the console seam that consumes it) + modify (`tools/launch_obsidian_e2e.py` — emit the whole-run plan and render the verdict from fed-back outcomes; `workflowArtifacts/canvas-v2/T3_SharedContract.md` — the matching contract entry)
  - Responsibility: make a gate run that no process can start end to end nevertheless **reproducible** — by turning the rig's planned calls into one ordered artefact an agent executes verbatim, and by making the rig, not the agent, render the verdict from what came back.
  - Scope summary: one ordered machine-readable plan artefact emitted before execution; exactly one recorded outcome per planned step; the rig renders the verdict; improvisation detected and refused; no process-spawn capability added
- **Out of scope / non-goals:**
  - **Adding any process-spawn capability.** No `subprocess`, `Popen`, `os.system`, `os.spawn*` or equivalent is introduced anywhere under `tools/obsidian_e2e/`. C45 AC4 is `DONE` and binding; a spawn backend does not satisfy it, and shipping one would silently reopen a landed acceptance criterion. Adding one is an **ESCALATE**, not a judgement call. See §3 for the full argument.
  - **Re-scoping WP43–WP49.** Discovery, port provisioning, launch planning, readiness, scratch safety, teardown and the oracles are delivered and are not reopened, re-verified or re-implemented here. This WP consumes them.
  - **Running the gate.** That is **WP7**. This WP builds the capability the run needs; it does not perform the run, and nothing it produces may be recorded as a gate result.
  - **Changing the control protocol** (`POST /command`, `GET /events`) or any command in it.
  - **Any change to `plugin/src/**`, `server/**` or `plugin/esbuild.config.mjs`.**
  - **Deciding what the plan contains for a component that does not exist yet.** Where WP69's install steps, WP70's relay steps or WP50's matrix steps are not landed, the plan carries the steps that *are* landed and names the absent ones as absent. It does not invent them.
- **Known interfaces / dependencies:**
  - Input: the rig's planned calls for a complete run — install (WP69), relay (WP70), provisioning (WP44/WP70), launch or attach (WP45), readiness (WP46), scratch (WP47), matrix (WP50), scenario (WP51), teardown (WP48) — plus the outcomes an agent returns for them
  - Output: one ordered, machine-readable run-plan artefact; one outcome record per planned step; a rig-computed verdict; and a replay statement that names any divergence between planned and executed
  - Depends on work packages: **WP45** (`lifecycle.py`, `spawn_through_console`, `PlanOnlyConsole` and the payload shape this WP generalises), **WP48** (teardown's one-exit-path guarantee, which the plan must express as steps rather than replace)
  - **WP7 depends on this WP.** WP50, WP51, WP69 and WP70 deliberately do **not** — each is verified at its own injectable seam, and coupling them to the mediation would serialise the queue behind it for no verification gain. WP7 is where the dependency is real: it is the run.

---

## 3. Architecture Context

*Task-local architecture guidance only.*

- **Component(s) being changed:** Agent-mediated gate execution — the run plan, its outcomes and its replay
- **Interfaces involved:**
  - Input: the rig's planned calls for a complete run, plus the outcomes an agent returns for them
  - Output: one ordered machine-readable plan artefact; one outcome per planned step; a rig-computed verdict; a replay statement
- **The measured gap this closes, and what it is *not*** — given, do not re-derive:
  - `tools/obsidian_e2e/lifecycle.py` exposes **`PlanOnlyConsole` as its only console backend**, and there is **no `subprocess`, `Popen` or other process spawn anywhere in `tools/obsidian_e2e/`**. Measured 2026-08-04. The entrypoint `tools/launch_obsidian_e2e.py` therefore **plans** launches; it cannot start Obsidian, and an `await_console` on it is not a gate result.
  - **This is not a failure of WP43–WP49, and must not be recorded as one.** C45 AC4 requires every long-running process the rig starts to be started through the workspace `visible-console` tools and never as a detached background process. The rig runs as a plain Python process with no MCP client, so it *cannot* make those calls itself, and a direct spawn would have violated the criterion it was built under. `PlanOnlyConsole` is the honest consequence: it records each call and emits the exact `{server_id, tool_name, arguments}` payload a client would send, with the argv as a **list** and never a rendered command line. Every WP43–WP49 deliverable is real.
  - **What was never chartered is the mediation.** Nobody owns the artefact that carries a whole run's plan, nobody owns feeding the outcomes back, and nobody owns the statement that the executed sequence was the planned one. That is a **missing chartered capability**, and it is why C7 AC1's *"executes end to end"* has had no satisfiable reading.
- **Why a real spawn backend is the wrong answer — decided, not left open.** Three grounds, the first decisive.
  1. **It contradicts a landed acceptance criterion.** C45 AC4 is `DONE`. A `subprocess` backend does not satisfy it, so shipping one adds capability by quietly reopening WP45's AC — the move §7 exists to make impossible.
  2. **It removes the only structural guarantee protecting the owner's vaults.** The console is *injected*, which is what makes it impossible for a test, a dev loop or a mistaken import to reach the real `Obsidian.exe` and the owner's live working vaults by accident (D16). `lifecycle.py` states this as the reason. A default-constructed spawn backend converts a structural property into a convention.
  3. **It buys less reproducibility than it appears to.** Even with a spawn backend, the run would still be started, watched and adjudicated by an agent, so the plan/outcome artefact would still be required — the spawn would merely hide *which* steps had been improvised. The mediated design makes that visible by construction, which is the property §7 and C7 AC1 actually need.
- **The cost, recorded rather than minimised.** An agent-mediated gate **is** harder to make reproducible than a single command. This WP's entire burden is to pay that cost in an artefact rather than in trust: a plan written before execution, an outcome per step supplied by the console surface rather than by narration, and a positive statement that the executed sequence was the planned one. §7 requires *"a recorded, reproducible green run plus a documented invocation"*; under this design "the invocation" is the plan plus the outcomes, which is a stricter document than a command line, not a weaker one.
- **Constraints from BUILD_SPEC (invariants — what must not change):**
  - **C45 AC4 stands unweakened.** Every long-running process still goes through `visible-console`; the console stays injected; `spawn_through_console` stays the single seam.
  - **Never terminate what the rig did not start (D15).** Mediation gives the rig no new authority over processes. A plan step that would close, kill or restart something the run did not start is refused at plan time, not at execution time.
  - **Data safety (D16).** `H:\Developement\_NeuralAngels\ObsidianOrga` and `H:\Developement\_NeuralAngels\ObsidianOrga - Kopie` are the owner's **live working vaults**. No pre-existing note, canvas or attachment is ever opened for writing.
  - **No secret through an agent tool.** No password, token or passphrase in a plan step, an argv element, an outcome record or the run artefact. `data.json` values are never read into a plan; comparison is sha256-of-bytes only.
  - **Zero new runtime dependencies.** The Python side of this phase is standard-library only and stays that way; a dependency here is an ESCALATE.
  - `plugin/src/**`, `server/**` and `plugin/esbuild.config.mjs` are untouched.
- **Technology / framework / config constraints:**
  - The plan artefact is data, not code. It is never `exec`'d, never rendered into a shell string, and never re-parsed by an OS interpreter — argv travels as a **list**. Both target vault paths contain spaces, and this host has a recorded `run_command` nested-quote trap: a rendered command line is both a quoting failure and a launch vector one call site from being used.
  - **Schema impact:** none. This WP changes no doc format and no `.canvas` file format.
- **Entry points / relevant files:**
  - `tools/obsidian_e2e/lifecycle.py` — `spawn_through_console` (the single sanctioned seam), `PlanOnlyConsole` (`CONSOLE_BACKEND = "plan-only"`, `run_command`, `run_python`, `await_console` and the payload shape they record), `plan_endpoints`, `ensure_endpoints`, `role_order`, `_operator_instruction`
  - `tools/launch_obsidian_e2e.py` — the argument surface (`--allow-launch`, `--reclaim`, `--json`), the `run_mode` values it already emits (`plan-only (no --allow-launch)`, `aborted before launch`, `attach-and-launch`) and the `launched_by_rig` / `console_id` tagging
  - `tools/obsidian_e2e/teardown.py` — the one-exit-path guarantee the plan must express as ordered steps
  - `workflowArtifacts/canvas-v2/T3_SharedContract.md` — where the artefact's name, location and record shape are mirrored, per hard-won rule 10
- **Structure references:** *(intentionally empty — no Graphify graph exists for this project; FALLBACK mode is declared in the BUILD_SPEC section 3. Worker 3 fills this in after implementation. Do not invent paths here.)*

If structure references conflict with the BUILD_SPEC or explicit task scope, the BUILD_SPEC and TaskCharter win. Escalate instead of following the map.

---

## 4. Acceptance Criteria

*Exact copy from BUILD_SPEC section 5, PHASE T3, component C71. No paraphrasing.*

1. **The plan is complete, ordered, machine-readable and emitted before anything is executed.** Every call the run will make is a numbered step carrying the verbatim `{server_id, tool_name, arguments}` payload and the argv list as a **list**, never a rendered command string — both target vault paths contain spaces and a rendered line is a re-parsed launch vector. The plan is written to a run-scoped artefact under `workflowArtifacts/canvas-v2/` before the first step is executed, so a plan that was truncated or revised mid-run is detectable rather than invisible. The ordering constraints C70 AC4 enforces are expressed *in the plan*, not merely honoured by whoever reads it.
2. **Every planned step has exactly one recorded outcome, and a missing outcome is a named failure rather than an omission.** An outcome carries the step number, the console id, the exit status or the structured result, and it is supplied by the console surface — **an agent's narration of what it did is not an outcome, and no criterion may be discharged by one.** A run whose outcome record is incomplete reports `INCOMPLETE` under the name of the first step that lacks one; it may not report a verdict, and it may not be recorded as green with a caveat.
3. **The rig renders the verdict, not the mediating agent, and improvisation is refused rather than tolerated.** The verdict is computed only from fed-back outcomes. An executed step that does not correspond to a planned step, a planned step executed out of order, and a planned step executed with arguments that differ from the planned payload are each detected and each fail the run under a distinct named reason. The replay statement records, positively, that the executed sequence was the planned sequence — a run that cannot state that has not been reproduced and cannot claim to be reproducible.
4. **Mediation adds no process-spawn capability anywhere in the rig, and this is structural rather than incidental.** After this component lands there is still no `subprocess`, `Popen`, `os.system` or equivalent under `tools/obsidian_e2e/`; the console remains injected; `spawn_through_console` remains the single seam; and C45 AC4 is satisfied unchanged. A backend that starts a process directly is out of scope and adding one is an ESCALATE, not a judgement call.

**Definition of Done:** a gate run nobody can start with one command can nevertheless be replayed step by step from a committed artefact, and no step of it rests on an agent's account of itself.

---

## 5. Constraints and Known Risks

- **Permission / environment limits:** Windows dev host. The Python side of this phase has **no vitest coverage and must not pretend to** — its units are verified by a standalone `python tools/test_<name>.py` script per the workspace convention, launched through `visible-console` `run_python` with an **absolute** script path. No Graphify graph exists for this project (declared FALLBACK mode) — `workflowArtifacts/RepoMap.md` is the structural map.
- **Known risks specific to this WP:**
  - **The likeliest failure of this WP is that it becomes a documentation exercise.** A "procedure the agent follows" has no acceptance criterion and nothing can falsify *"the agent followed it"*. Every criterion here is written against an **artefact** for that reason. If implementation drifts toward prose in a usage document, it has left scope.
  - **⚠ The recursive trap: this WP is itself a verification instrument, and it is exactly the shape that has gone vacuously green six times in this run.** A mediation layer that accepts whatever an agent reports, and then reports it back as a verdict, is a green that cannot fail — and it would sit one level above the gate. AC2's *"an agent's narration is not an outcome"* and AC3's improvisation detection are the pins that prevent it. **They must be falsified by injection**: a fabricated outcome for a step that was never executed, and an executed step that was not in the plan, must each produce a named failure. If they do not, this WP has built the seventh instance rather than closing the sixth.
  - **Bounded waits are inherited, not re-invented.** WP48 AC2 requires every wait to be bounded and to name the condition it was waiting for on expiry. A mediated step whose outcome never arrives is such a wait: it expires under a name, it does not hang, and it does not default to success.
  - **Do not let the plan become an execution engine.** The plan is data. If it acquires conditionals, retries or branching, it is code being smuggled past AC4, and its correctness stops being auditable by reading it.
  - **A crashed or abandoned mediation must not leave the vaults borrowed.** Teardown (WP48) still runs on every exit path; the plan expresses it as steps and does not become an alternative path around it. A run abandoned mid-plan is `INCOMPLETE` **and** teardown-complete, never one without the other.
- **Known flaky patterns:**
  - No wall-clock sleeps. Every wait is a bounded poll of a condition that names itself on expiry.
  - Do not use log strings as a primary oracle; state is the oracle.
  - Biome reports a whole-file `format` finding per touched file (CRLF environment artefact). Advisory locally, gating in CI — do not mass-reformat.
- **External dependency risks:** no new runtime or dev dependency on either side. If one looks unavoidable, that is an ESCALATE, not a judgement call.
- **Hard constraints:**
  - **No process spawn under `tools/obsidian_e2e/`, by any route.** This is AC4 and it is also the boundary of the WP.
  - **Never terminate what the rig did not start (D15).**
  - **Data safety (D16).** A run that leaves either vault changed outside its own scratch artefacts is a FAILED run whatever else it proved.
  - **Long-running or interactive processes go through the `visible-console` MCP tools**; Python is launched via `run_python` with an **absolute** script path (the `run_command` nested-quote trap).
  - **No secret through an agent tool**, in any command string, script argument, plan step, outcome record or control-protocol message.
  - No existing test is deleted, weakened, retitled, skipped or amended. **WP71 holds no §7 licence of any class**; an unenumerated deletion or assertion rewrite is an abort criterion.
  - `plugin/src/**`, `server/**` and `plugin/esbuild.config.mjs` are untouched.
- **Unverified, and stated as such.** Nothing about the gate has been executed. `PlanOnlyConsole`'s payloads have never been consumed by a real `visible-console` call, no plan artefact exists, and **no control endpoint has ever answered on this host** — the latter now **measured** (both real control ports probed free, nothing listening), not inherited. Nothing this WP produces may be written as though a run had occurred.

---

## 6. Definition of Done Artifacts

- **Required changed files:**
  - `tools/obsidian_e2e/mediation.py` (new)
  - `tools/launch_obsidian_e2e.py`
  - `workflowArtifacts/canvas-v2/T3_SharedContract.md` — the artefact's name, location and record shape, mirrored per hard-won rule 10 so no second agent invents a second format
- **Required report:** `ImplementationReport_WP71.md` (in `workflowArtifacts/canvas-v2/`), which must additionally record: the grep evidence that no `subprocess` / `Popen` / `os.system` / `os.spawn*` exists under `tools/obsidian_e2e/` after the change (AC4); the falsification results for AC2 and AC3, each by targeted injection, with the pre-repair and post-repair outcomes stated; and an explicit statement that **no run has been performed** and that the artefact has never carried a real run.
- **BUILD_SPEC updates required:** no — unless implementation invalidates an architecture decision, in which case ESCALATE rather than editing the spec.
- **Gate status required at handover:** `npm run build` PASS and `npm test` with 0 failures, run from `plugin/` (this WP touches no TypeScript, so the gate is a no-regression check). The standalone `python tools/test_<name>.py` script for this WP passes, launched through `visible-console` `run_python` with an absolute path.

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

*Empty at handover.*
