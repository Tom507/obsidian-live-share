# Task Charter — WP73: Matrix driver — an unapplied gesture must be impossible to record as a pass

<!-- Updated: chartered 2026-08-04 — verified against the current tree per hard-won rule 12, which also corrected the call-site count from six to eleven. This is the SEVENTH instance in this run of "a green test that cannot fail", and the first located in the instrument that renders the release gate's own per-case verdicts. -->
**Charter Status:** `SPEC_COMPLETE`
**WP:** WP73
**Phase:** P0 (PHASE T3 group)
**task_mode:** `standard`
**Depends on:** WP50
**W4 Test Targets:** `0`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** the driver that renders the release gate's per-case verdicts can no longer report a case in which nothing happened as a case that passed.
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 5, **PHASE T3**, component **C73 — Matrix driver: an unapplied gesture must be impossible to record as a pass** (work package WP73); phase **P0**.

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: modify (`tools/MCPserver/liveshare_e2e_mcp_server.py` — `_run_case` and the `_simulate` wrapper it calls)
  - Responsibility: make the driver's own verdict depend on the gesture having taken effect, so a case cannot pass by both peers agreeing about nothing having happened.
  - Scope summary: `applied` consumed at all eleven `_simulate` sites; an unapplied gesture terminates the case `inconclusive` and names it; falsified by injecting `applied: false`
- **Out of scope / non-goals:**
  - **C50 AC1, AC2, AC4, AC5 and AC6.** This WP supplies the mechanism C50 **AC3** names and never had; every other C50 criterion belongs to WP50 and is neither restated nor re-implemented here.
  - **Adding, removing or renaming a matrix case.** `MATRIX_CASES` keeps its six identifiers, which mirror the WP3 plugin-side matrix by contract.
  - **Changing the control protocol** or the `{applied}` contract of `canvas.simulateEdit`. This WP consumes a datum the protocol already returns.
  - **Changing the MCP tool surface.** `run_matrix`, `edit`, `assert_converged` and the rest keep their signatures and argument shapes; `inconclusive` is expressed inside the existing per-case result shape.
  - **Fixing the oracles themselves.** `_compare`, `_edge_dangling` and the per-case content predicates are not redesigned here; the defect is that the driver never asks whether the gesture happened, not that the comparison is wrong.
  - **Any change to `plugin/**` or `server/**`.**
- **Known interfaces / dependencies:**
  - Input: the per-gesture `{applied}` the control protocol already returns
  - Output: a per-case verdict in which an unapplied gesture is `inconclusive` and is attributed to the gesture that failed
  - Depends on work packages: **WP50**, which owns this file and whose AC3 this WP makes satisfiable. Landing this WP against the pre-WP50 driver would put the repair in a file WP50 then restructures.
  - **WP7 depends on this WP.** It is the run, and it is the only place where an undetected unapplied gesture turns a green case into a false pass.

---

## 3. Architecture Context

*Task-local architecture guidance only.*

- **Component(s) being changed:** Matrix driver — an unapplied gesture must be impossible to record as a pass
- **Interfaces involved:**
  - Input: the per-gesture `{applied}` the control protocol already returns
  - Output: a per-case verdict in which an unapplied gesture is `inconclusive` and is attributed to the gesture that failed
- **Verified against the current tree (hard-won rule 12), 2026-08-04 — given, do not re-derive. The call-site count in the original report was wrong and is corrected here.**
  - `canvas.simulateEdit` returns `{applied}`; `_simulate` returns that result verbatim; the `edit` MCP tool already surfaces it as `{"applied": bool(...)}`. **`_run_case` discards the return value at every call site.**
  - **The measured number of discarded call sites is eleven, not six.** `initial-sync` 1, `multi-edge-move` 2, `bidirectional-drag` 3, `add-node-edge` 2, `delete-node-edge` 2, `file-node` 1. **Six is the number of matrix cases, not of `_simulate` calls** — a repair scoped to six sites would leave five gestures unchecked, and the five it would leave are disproportionately **setup** gestures, which are the ones whose silent failure is hardest to see.
  - Every case then decides on `_converge_and_check`, which settles both peers and compares the two snapshots. **If the gesture never applied, both snapshots are equal and `converged` is `True`.** For `initial-sync` that is the entire verdict, so the case records `pass` having demonstrated nothing at all.
  - The four cases that add a content predicate (`moved`, `both`, `has_node` / `has_edge`, `node_gone`, `file_ok`) are protected against the **final** gesture silently failing, but **not** against an unapplied **setup** gesture — and `delete-node-edge`'s `node_gone` is **satisfied by the node never having been created**, so an unapplied setup makes its own oracle vacuously true rather than merely unprotected.
- **Why this is the strongest possible argument for the AC that fixes it — state it in the implementation, not only here.** This is the **seventh** instance in this run of *a green test that cannot fail*. The six before it: the vacuous blind runner; unfalsifiable assertions; oracles vacated by a semantic change; a global perturbation that falsely certifies; a prior batch's amendment masking a later falsification; and WP25's ordering gate stalled at the wrong seam, which was found **only** because a perturbation that should have reddened a set left it 47/47 green. **Not one of the seven was found by the mechanism that was supposed to catch it.** This one is inside the instrument that renders the release gate's per-case verdicts — the last place in the project where the class may survive, and the place where surviving costs the most. **C50 AC3 already forbids the outcome in as many words** — *"a case whose oracles disagree or whose gesture did not take effect is reported as inconclusive rather than as a pass"* — and the driver cannot honour it, because it throws away the only datum that says whether the gesture took effect. This WP is the mechanism that criterion names and never had.
- **Constraints from BUILD_SPEC (invariants — what must not change):**
  - **`inconclusive` is never a pass.** `run_matrix`'s `allPass` must not count it, and no caller may read the absence of `pass: False` as success.
  - **A missing `applied` key is unapplied, not applied.** A default-true read is the same defect wearing a default, and it is the shape that would survive this repair unnoticed.
  - **Zero new runtime dependencies.** The driver is standard-library only (`json`, `urllib`) and stays that way.
  - No change to `plugin/**` or `server/**`.
  - **No secret through an agent tool**, in any command string, script argument or control-protocol message.
- **Technology / framework / config constraints:**
  - The driver is an MCP server (`FastMCP`), so its tools are called by an agent by construction. That is unchanged by this WP and is not a finding; what **is** relevant is that the driver may not assume the endpoint it holds was brought up by the process calling it (see §5).
  - **Schema impact:** none. No doc format and no `.canvas` file-format change.
- **Entry points / relevant files:**
  - `_run_case` and its eleven `_simulate` call sites; the 3-char case-prefix id namespacing at the head of the function
  - `_simulate` — the thin `canvas.simulateEdit` wrapper that already returns `{applied}`
  - `_converge_and_check` — settle-then-compare, the function whose `True` an unapplied gesture manufactures
  - `_compare`, `_edge_dangling` — the oracles, **read-only context**: not redesigned here
  - `MATRIX_CASES` — the six case identifiers, which mirror the WP3 plugin-side matrix and do not change
  - `run_matrix` — the `allPass` reduction that must stop treating a non-`pass` case as an implicit failure and start distinguishing `inconclusive`
- **⚠ Location note — do not re-derive, and do not "fix" the paths by guessing.** `tools/MCPserver/liveshare_e2e_mcp_server.py` **does not exist in this repository**; this repo's `tools/` contains only `launch_liveshare_e2e.py`, `launch_obsidian_e2e.py` and `obsidian_e2e/`. The file lives in the **AgenticWorkspace** repo at `h:\My Code\AgenticWorkspace\tools\MCPserver\liveshare_e2e_mcp_server.py`, where `_run_case` is at `:321`, `_simulate` at `:122`, `_converge_and_check` at `:304`, `_wait_both` at `:134`, `assert_converged` at `:280` (decorator; `def` at `:281`) and `run_matrix` at `:402` (decorator; `def` at `:403`). **C50's line references are accurate against that file** — only the repository is wrong, and a reader who "corrects" the line numbers has fixed the wrong thing. Two consequences that must not be absorbed silently: the change lands **outside this project's branch** and therefore outside §7's commit and abort accounting, and this WP's standalone Python verification script cannot sit beside the file it verifies under the usual `tools/test_<name>.py` convention. **Unverified: whether the Dispatcher intends the edit in the workspace repo or the file vendored into this one. ESCALATE rather than choosing.**
- **Structure references:** *(intentionally empty — no Graphify graph exists for this project; FALLBACK mode is declared in the BUILD_SPEC section 3. Worker 3 fills this in after implementation. Do not invent paths here.)*

If structure references conflict with the BUILD_SPEC or explicit task scope, the BUILD_SPEC and TaskCharter win. Escalate instead of following the map.

---

## 4. Acceptance Criteria

*Exact copy from BUILD_SPEC section 5, PHASE T3, component C73. No paraphrasing.*

1. **Every gesture's `applied` is consumed, at every call site, and an unapplied gesture cannot reach a pass.** All eleven `_simulate` call sites in `_run_case` — setup gestures included — are checked. A gesture reporting `applied: false`, or a response from which `applied` is absent, terminates the case as **`inconclusive`** naming the case, the gesture and the instance; it never falls through to a snapshot comparison, and `inconclusive` is never counted as a pass by `run_matrix`'s `allPass`. A missing `applied` key is treated as unapplied, not as `True`: a default-true read is the same defect wearing a default.
2. **The verdict names the oracle *and* the gesture, so a vacuous convergence is attributable.** Per C50 AC3 each case already reports which oracle decided it; a case terminated under AC1 additionally reports which gesture failed to apply, so "both snapshots were equal" can never again be reported without saying whether anything was ever done to them.
3. **The repair is falsified by injecting exactly the condition it fixes.** With the driver otherwise unchanged, a control endpoint is made to return `applied: false` for one gesture and the affected case must move from `pass` to `inconclusive`; the same injection against the unrepaired driver must produce `pass`, and both results are recorded. The injection is targeted at the single gesture, not global (hard-won rule 2), and the report states whether neighbouring cases stayed green. **A repair to a "green that cannot fail" that is not demonstrated to redden under its own class is not a repair** — it is the sixth instance's lesson: a perturbation that changes nothing is a finding, not a null result.
4. **The existing tool surface, argument shapes and case names are unchanged, and no runtime dependency is added.** `run_matrix` keeps its signature and its six `MATRIX_CASES` identifiers; `inconclusive` is expressed within the existing per-case result shape rather than by a new tool; the driver remains standard-library only.

**Definition of Done:** the driver that renders the release gate's per-case verdicts can no longer report a case in which nothing happened as a case that passed.

---

## 5. Constraints and Known Risks

- **Permission / environment limits:** Windows dev host. The Python side of this phase has **no vitest coverage and must not pretend to** — its units are verified by a standalone `python tools/test_<name>.py` script per the workspace convention, launched through `visible-console` `run_python` with an **absolute** script path (the `run_command` nested-quote trap). No Graphify graph exists for this project (declared FALLBACK mode).
- **Known risks specific to this WP:**
  - **⚠ AC3 is the criterion this WP will be judged on, and it is the one most easily faked.** A "repair" that consumes `applied` but is never shown to redden has repeated the class rather than closed it. The falsification must be **targeted** at one gesture in one case (rule 2), must be run **against the unrepaired driver as well**, and both results must be recorded. A perturbation that changes nothing is a finding, not a null result — the sixth instance was found by exactly that observation.
  - **⚠ The `initial-sync` case is the sharp one and must be in the falsification.** It has **no** content predicate at all: `converged` is its entire verdict, so it is the case that today records `pass` on a wholly unapplied gesture. A falsification that only injects into a case with a content predicate has chosen the easiest target and demonstrates less than it appears to.
  - **⚠ `delete-node-edge` is the subtle one.** Its `node_gone` predicate is **satisfied by the node never having been created**, so an unapplied *setup* gesture makes the case's own oracle vacuously true. Consuming `applied` on the setup gestures — not only the final one — is what closes it, which is why AC1 says *setup gestures included*.
  - **Do not repair by counting.** "Six call sites" is what the original report said and it is wrong; the measured number is eleven. Consume the flag at the `_simulate` wrapper or at every call, but do not implement against a count taken from prose — re-derive it from the function, and state the number you found.
  - **`inconclusive` must be a third state, not a renamed failure.** C50 AC3 distinguishes a case that failed from a case that could not be decided; collapsing them loses exactly the information the gate needs, and a run reporting everything as failed is as uninformative as one reporting everything as passed.
  - **The driver may not assume the endpoints were brought up by its caller.** The gate run is agent-mediated (WP71 / C71): `lifecycle.py`'s only console backend is `PlanOnlyConsole` and nothing under `tools/obsidian_e2e/` spawns a process. Every precondition the driver needs it establishes itself.
  - **Nothing has been executed.** **No control endpoint has ever answered on this host** — measured 2026-08-04, both real control ports probed free with nothing listening. Every criterion here is decided against fake endpoints; no statement about a live instance may be made.
- **Known flaky patterns:**
  - No wall-clock sleeps. Every wait is bounded and names the condition it was waiting for on expiry.
  - Do not assert on log strings as the primary oracle; state is the oracle.
  - A real Obsidian run is slow and stateful. Retrying a flaky step without a teardown in between compounds state.
- **External dependency risks:** No new runtime dependency is permitted; the driver is standard-library only and must stay so. If one looks unavoidable, that is an ESCALATE, not a judgement call.
- **Hard constraints:**
  - **`inconclusive` is never counted as a pass**, in `allPass` or anywhere else. This is AC1 and it is also the boundary of the WP.
  - **A missing `applied` key is unapplied.**
  - No change to `plugin/**`, `server/**` or the control protocol.
  - No existing test is deleted, weakened, retitled, skipped or amended. **WP73 holds no §7 licence of any class**; an unenumerated deletion or assertion rewrite is an abort criterion.
  - **No secret through an agent tool**, in any command string, script argument or control-protocol message.

---

## 6. Definition of Done Artifacts

- **Required changed files:**
  - `liveshare_e2e_mcp_server.py` — **at the location the Dispatcher rules on** (see the location note in §3; today the file is in the AgenticWorkspace repo, not this one)
- **Required report:** `ImplementationReport_WP73.md` (in `workflowArtifacts/canvas-v2/`), which must additionally record: the **re-derived** count of `_simulate` call sites in `_run_case` and how it was obtained; the AC3 falsification in full — which case, which gesture, the pre-repair result and the post-repair result, and whether neighbouring cases stayed green; an explicit statement that the `initial-sync` case was among those falsified, or why not; and the location the change was actually made in, since it is not this repository.
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
