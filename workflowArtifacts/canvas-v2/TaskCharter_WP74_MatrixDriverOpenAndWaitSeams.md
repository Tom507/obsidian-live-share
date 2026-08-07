# Task Charter — WP74: Matrix driver — a canvas that was never opened, and a wait that timed out, must both be impossible to record as a pass

<!-- Updated: chartered 2026-08-04 — verified against the current driver at AgenticWorkspace `50b0cf4` (the commit WP73 landed on) per hard-won rule 12. This is the EIGHTH instance in this run of "a green test that cannot fail" and the SECOND found in the gate's own driver, one seam over from where WP73 closed the seventh. The site counts below were measured from the AST, not taken from the report that raised them. -->
**Charter Status:** `SPEC_COMPLETE`
**WP:** WP74
**Phase:** P0 (PHASE T3 group)
**task_mode:** `standard`
**Depends on:** WP50, WP73
**W4 Test Targets:** `0`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** the driver that renders the release gate's per-case verdicts can no longer decide a case against a canvas no instance is subscribed to, and can no longer read a wait that timed out as a settle.
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 5, **PHASE T3**, component **C74 — Matrix driver: the never-opened canvas and the timed-out wait** (work package WP74); phase **P0**.

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: modify (`tools/MCPserver/liveshare_e2e_mcp_server.py` — `_wait_both`, `_converge_and_check`, `run_matrix`'s pre-case open, and the `open_canvas` tool's verdict)
  - Responsibility: make the driver's own verdict depend on the canvas having been subscribed and on the settle having actually settled, so a case cannot be decided about a document nothing was ever attached to, and a timeout cannot be read as convergence.
  - Scope summary: `{opened, subscribed}` consumed at the two `run_matrix` opens and given a verdict at `open_canvas`; `{quiescent}` consumed for both instances at all ten `_converge_and_check` sites; each seam falsified separately; **plus an AST-asserted inventory of the whole control-protocol response surface (AC5), which is what closes the class rather than repairing its latest two instances**
- **Out of scope / non-goals:**
  - **C73 in any form.** `_was_applied`, `gesture()`, `GestureNotApplied` and `run_matrix`'s `GestureNotApplied` handler are **landed as of batch B10b** — AgenticWorkspace `50b0cf4`, liveshare `b578b0c`, WP72 and WP73 both DONE — and are **not modified, relaxed, re-derived or routed around**. Their shape is a fact to be read in the file, not a proposal to be re-litigated: eleven gesture sites routed through **one** `gesture()` checkpoint, with the absence of any direct `_simulate` call in `_run_case` asserted **from the AST**, so a future call site cannot bypass the check by construction. WP74 extends the machinery C73 built; it does not revisit it.
  - **C50 AC2, AC3, AC4 and AC6.** This WP supplies the mechanism C50 **AC1** and **AC5** name and never had; every other C50 criterion belongs to WP50 and is neither restated nor re-implemented here.
  - **The `applied`-is-a-constant finding (sweep item S1 in §5).** It lives in `plugin/src/testing/e2e-control.ts`, i.e. in `plugin/**`, which this WP may not touch. It is **ESCALATED, not folded in.** A WP74 that quietly widened into the plugin's control surface would be doing exactly what this run has charged five other WPs with avoiding.
  - **Repairing the oracles.** `_compare`, `_index`, `_diff_maps`, `_edge_dangling` and the per-case content predicates are not redesigned. The defect is that the driver never asks whether the canvas was attached or whether the wait finished, not that the comparison is wrong. `_index`'s silent drop of id-less records is recorded as sweep item **S2** and is not fixed here.
  - **Re-classifying a driver exception.** Today a per-case `except Exception` renders `status: "fail"`. That is fail-closed, and changing it alters C50's per-case verdict semantics, which belongs to WP50. Recorded as sweep item **S5**.
  - **Adding, removing or renaming a matrix case.** `MATRIX_CASES` keeps its six identifiers, which mirror the WP3 plugin-side matrix by contract.
  - **Changing the control protocol** or the `{opened, subscribed}` / `{quiescent}` contracts. This WP consumes data the protocol already returns.
  - **Any change to `plugin/**` or `server/**`.**
- **Known interfaces / dependencies:**
  - Input: the `{opened, subscribed}` `canvas.open` already returns and the `{quiescent}` `sync.waitQuiescent` already returns
  - Output: a run that refuses to begin against an unsubscribed canvas, and a per-case verdict in which a timed-out settle is `inconclusive` and is attributed to the instance whose wait expired
  - Depends on work packages: **WP50**, which owns this file and whose AC1 and AC5 this WP makes satisfiable; **WP73**, which introduced the `status` third state, the no-default reading rule and the `run_matrix` per-case handler that this WP extends. Landing WP74 against the pre-WP50 driver would put the repair in a file WP50 then restructures; landing it before WP73 would guarantee a textual conflict in `run_matrix` and would force this WP to re-derive the third state C73 already established.
  - **WP7 depends on this WP.** It is the run, and it is the only place where an unsubscribed canvas or a timed-out wait turns a green case into a false pass.

---

## 3. Architecture Context

*Task-local architecture guidance only.*

- **Component(s) being changed:** Matrix driver — the never-opened canvas and the timed-out wait
- **Interfaces involved:**
  - Input: the `{opened, subscribed}` `canvas.open` already returns and the `{quiescent}` `sync.waitQuiescent` already returns
  - Output: a run that refuses to begin against an unsubscribed canvas, and a per-case verdict in which a timed-out settle is `inconclusive` and is attributed to the instance whose wait expired

### Verified against the current driver (hard-won rule 12), 2026-08-04 — given, do not re-derive

**The generalisation, stated before the instances, because the instances are no longer the point.** Every seam in this driver that returns a status **nobody checks** has turned out to read as success. WP73 closed one — `applied` discarded at eleven gesture sites — and **in closing it found a second outside its own eleven**: the `edit` MCP tool read `result.get("applied", True)`, so an **absent** key was reported to the caller as *applied*. That is the identical shape, a missing signal defaulting to success, one level up in the tool surface. WP74's two seams are the same shape again at `canvas.open` and `sync.waitQuiescent`, and the sweep in §5 finds it a fourth time at `session.info`. **The class is not "the driver forgets one flag"; it is "a response field with no reader reads as success."** That is why AC5 exists, and why a WP74 that only repaired its two named seams would be the fourth consecutive repair scoped to the instance in front of it.

The driver was read at AgenticWorkspace commit **`50b0cf4`**, i.e. **after** WP73 landed. WP73 did not move either seam. Every count below was obtained by walking the module's AST, not by reading the description that raised the defect. **The description was accurate in kind and silent on quantity; the quantities are stated here so nobody repairs against a number taken from prose. That is what turned WP73's "six" into eleven.**

**Seam (a) — `_open`: the run may proceed against a canvas neither instance is subscribed to.**

- `_open` has **four** call sites. **Two of them are the only opens the matrix ever performs** — `run_matrix` `:509` and `:510`, both statements whose return value is **discarded entirely**. `_run_case` opens nothing at all; every case inherits whatever those two calls did or did not achieve.
- The other **two** are the single expression at `open_canvas` `:238`, which returns both results verbatim inside `{"status": "ok", "a": …, "b": …}`. They are not discarded, but no verdict is derived from them: the tool answers `status: "ok"` for a canvas neither instance opened, so a caller that reads `status` is told the call succeeded. **Surfaced-without-a-verdict is not the same defect as discarded, and the charter distinguishes them so the repair does too.**
- **Why the oracle cannot recover from this.** `canvasState` in the control server returns `{nodes: [], edges: []}` whenever the plugin's `getCanvasSnapshot` returns `null`, and `getCanvasSnapshot` returns `null` in **four distinct situations**: the path is not in `subscribedPaths`; no doc id resolves for it; no doc handle exists; **or the shared doc is simply empty**. All four reach the driver as the same value. `_compare` of two empty snapshots is `converged: True`. **The driver's convergence oracle therefore cannot distinguish "both peers agree" from "neither peer has anything to say" — and `{opened, subscribed}` is the only datum in the whole protocol that can.** It is thrown away.
- **`subscribed` is the load-bearing field, not `opened`.** `canvasOpen` answers `{opened: false, subscribed: false}` only when the instance has no canvas surface at all, and that arm is already fail-closed downstream, because `simulateEdit` throws for the same condition and C73's `gesture()` propagates the throw. The reachable dangerous state is the **mixed** one — `{opened: true, subscribed: false}`, i.e. subscribe ran and did not register the path — and **nothing downstream refuses it.** A repair that checks truthiness, or checks `opened`, closes the arm that was never open and leaves the one that is.

**Seam (b) — `_wait_both`: a wait that timed out is indistinguishable from a settle.**

- `_wait_both` `:148-151` calls `_wait("a", …)` and `_wait("b", …)` and **returns `None`**. Both `{quiescent}` answers are dropped at the two statements that produce them. `_wait` has exactly **two** call sites and both are inside `_wait_both`; `_wait_both` has exactly **one** caller, `_converge_and_check` `:326`.
- **One structural site, ten reachings, twenty discarded answers per run.** `_converge_and_check` is reached **ten** times in a full matrix run: `initial-sync` 1, `multi-edge-move` 2, `bidirectional-drag` 2, `add-node-edge` 2, `delete-node-edge` 2, `file-node` 1 (`:417`, `:424`, `:426`, `:433`, `:436`, `:443`, `:446`, `:459`, `:461`, `:470`). **This decomposition is 1/2/2/2/2/1 and is NOT the same as C73's gesture decomposition of 1/2/3/2/2/1** — `bidirectional-drag` issues three gestures but settles twice. Copying WP73's per-case numbers into this WP is a mistake with a specific shape and it is named here so it does not happen.
- **Why this seam is worse than (a), and the reason it is urgent rather than tidy.** `waitQuiescent` answers `{quiescent: false}` in exactly one situation: activity kept landing for the whole timeout. That is the signature of slow, stalled or never-arriving relay deltas — **the signature of the sync defect the gate exists to catch.** The driver then reads both snapshots immediately. Two peers that have not yet diverged *because the delta has not reached either of them* compare equal, `converged` is `True`, and the case records `pass`. **The condition that manufactures the false green is the condition a real sync bug produces**, so this seam does not merely fail to detect the defect class the gate is for — it inverts the verdict on it.
- **The two seams are complementary and neither subsumes the other.** `lastActivity` is advanced only through `markActivity`, reached only from a doc observer, and that observer is registered in `canvasOpen` and in `simulateEdit`. A canvas nothing observes has `lastActivity` frozen at host construction, so the **first** poll already sees an idle interval far past the quiet window and the wait returns `{quiescent: **true**}` instantly. **A never-opened canvas reports quiescent TRUE, not false.** Consuming `quiescent` therefore does not catch seam (a), and checking `subscribed` does not catch seam (b). Two criteria, two falsifications, and a repair that collapses them into one has closed one seam and claimed two.

### Does WP73's shape transfer? — decide this before implementing, the answer is not uniform

WP73's solution is *route every site through one checkpoint, and assert that structure from the AST so a future call site cannot skip the check by construction.* **It transfers to seam (b) and it does not transfer to seam (a), and the argument for each is different.**

- **Seam (b): yes, and it is easier here than it was there.** The funnel already exists — `_wait` is called from nowhere but `_wait_both`, and `_wait_both` is called from nowhere but `_converge_and_check`. WP73 had to *build* its checkpoint and then prove no direct `_simulate` call survived; this WP inherits one. The AST-assertable invariant is the same in form and stronger in fact: *no `_wait` call outside `_wait_both`, and no `_wait_both` call whose result is discarded.*
- **Seam (a): no — three reasons, all structural.**
  1. **The call sites live in functions with different contracts.** `open_canvas` is a public MCP tool whose `{a, b}` shape C50 AC4 and C73 AC4 both freeze. A checkpoint that raises inside `_open` would change that tool's contract for existing callers, which is forbidden.
  2. **An unopened canvas is a property of the run, not of a case.** `GestureNotApplied` is caught *inside* the per-case loop, which is correct for a gesture. Reporting a never-subscribed canvas as six `inconclusive` cases would attribute a run-level precondition failure to six oracles that never ran — **the exact mis-attribution C73 AC2 exists to prevent**, reintroduced by copying C73's mechanism into a place its semantics do not fit. The right shape is a refusal **before the first case**, which is also literally what C50 AC5 already demands of every other precondition: *"Any precondition unestablished refuses the run under a named reason instead of producing case verdicts."*
  3. **The datum is two booleans on two instances and the dangerous state is the mixed one.** A single truthiness checkpoint passes `{opened: true, subscribed: false}`. The check must name the field.

**Consequence to carry into the implementation:** the AST-assertion half of WP73's shape applies to **both** seams; the one-checkpoint-that-raises-per-case half applies to **(b) only**, and (a) is a run-level precondition refusal.

### `inconclusive` stays a third state — and the specific way it would collapse here

C73 established `pass` | `fail` | `inconclusive` and the rule that `allPass` counts only `pass`. Two traps are specific to this WP and are named rather than left to be rediscovered:

- **The generic exception path renders `fail`.** `run_matrix`'s per-case `except Exception` at `:530-537` sets `status: "fail"`. A timeout implemented as a bare exception with no handler of its own lands there, and the third state silently collapses **for exactly the class that most needs it** — a case that could not be decided reported as a case that failed. AC2 forbids this explicitly.
- **A rescue that only rescues passes has missed half the class.** WP73 found a case that moved **`fail` → `inconclusive`**, not `pass` → `inconclusive`: an unattributed oracle disagreement. Two states were not enough there and are not enough here. A run reporting everything as failed is as uninformative as one reporting everything as passed.

- **Constraints from BUILD_SPEC (invariants — what must not change):**
  - **`inconclusive` is never a pass**, in `allPass` or anywhere else, and a run-level refusal carries `allPass: false` while fabricating **no** case verdicts.
  - **An absent key is the unsafe reading, never the safe one.** A missing `subscribed` is unsubscribed; a missing `quiescent` is a timeout. A default-true read is the same defect wearing a default — C73's own AC1 lesson, restated because the same reader is repairing the same file.
  - **C73's machinery is untouched.** `_was_applied`, `gesture()` and `GestureNotApplied` keep their present behaviour exactly.
  - **Zero new runtime dependencies.** The driver is standard-library only (`json`, `urllib`) and stays that way.
  - No change to `plugin/**` or `server/**`.
  - **Ports are imported, never spelled.** The real control endpoints are `REAL_CONTROL_PORT_A` / `REAL_CONTROL_PORT_B` in `tools/obsidian_e2e/constants.py`; `HEADLESS_RIG_PORT_A` / `HEADLESS_RIG_PORT_B` in the same file are the **mock** rig's and are deliberately disjoint per D13. **No port literal appears anywhere in this WP's work.** WP7's charter already had to be corrected for naming the mock pair, and the standing lesson from that correction is that the gate's own artefacts are not exempt.
  - **No secret through an agent tool**, in any command string, script argument or control-protocol message.
- **Technology / framework / config constraints:**
  - The driver is an MCP server (`FastMCP`), so its tools are called by an agent by construction; the gate run is agent-mediated (WP71 / C71) because `lifecycle.py`'s only console backend is `PlanOnlyConsole` and nothing under `tools/obsidian_e2e/` spawns a process. What follows for this WP is that **the driver may not assume the endpoint it holds was brought up, opened or subscribed by the process calling it.** Every precondition it needs, it establishes itself. That is the whole of seam (a).
  - **Schema impact:** none. No doc format and no `.canvas` file-format change.
- **Entry points / relevant files:**
  - `_open` — the `canvas.open` wrapper; its two discarding sites in `run_matrix` and its two verdict-less sites in `open_canvas`
  - `_wait` / `_wait_both` — the settle path; the two discarding statements and the single funnel they sit in
  - `_converge_and_check` — settle-then-compare, reached ten times per run; the function whose `True` a timed-out wait manufactures
  - `run_matrix` — the pre-case opens, the `allPass` reduction and the `inconclusive` list that must gain a run-level expression
  - `open_canvas` — the public tool whose `{a, b}` shape is frozen and whose verdict is missing
  - `_compare`, `_index`, `_state` — **read-only context**, not redesigned here (see sweep item S2)
- **⚠ Cross-repo — do not re-derive, and do not "fix" the paths by guessing.** `tools/MCPserver/liveshare_e2e_mcp_server.py` **does not exist in the `obsidian-live-share` repository.** It lives in the **AgenticWorkspace** repo at `h:\My Code\AgenticWorkspace\tools\MCPserver\liveshare_e2e_mcp_server.py`, on branch **`toms_branch`** (**not** that repo's default branch). **This is settled, not open** — WP73 established the precedent and executed it: it committed the workspace-repo change separately at `50b0cf4` and recorded **both** commit hashes in its implementation report, because §7's commit and abort accounting assumes a single repository. WP74 does the same. The standalone Python verification script sits beside the file it verifies, in the workspace repo, under the usual `tools/test_<name>.py` convention — WP73's charter worried this was impossible; it is not, and that worry is retired.
- **Structure references:** *(intentionally empty — no Graphify graph exists for this project; FALLBACK mode is declared in the BUILD_SPEC section 3. Worker 3 fills this in after implementation. Do not invent paths here.)*

If structure references conflict with the BUILD_SPEC or explicit task scope, the BUILD_SPEC and TaskCharter win. Escalate instead of following the map.

---

## 4. Acceptance Criteria

*Exact copy from BUILD_SPEC section 5, PHASE T3, component C74. No paraphrasing.*

1. **The run refuses to begin against a canvas the instances are not subscribed to, and the refusal is a run-level verdict rather than six case verdicts.** Both `{opened, subscribed}` results the matrix's pre-case opens obtain are consumed, on both instances; `subscribed` must be `True` on each, `opened` alone does not satisfy it, and a response from which either key is absent counts as **not subscribed** rather than as subscribed. Failure terminates the run **before the first case** as **`inconclusive`**, naming the instance and the field that failed, carrying `allPass: false`, and fabricating **no** per-case verdicts — a run-level precondition failure attributed to six oracles that never ran is the mis-attribution C73 AC2 exists to prevent. The `open_canvas` tool keeps its `{a, b}` shape unchanged for existing callers and additionally reports a verdict a caller can act on, so it can no longer answer `status: "ok"` for a canvas neither instance subscribed to.
2. **A wait that timed out can never be read as a settle, and it is `inconclusive` rather than `fail`.** Every `{quiescent}` the settle path obtains is consumed — both instances, at all **ten** `_converge_and_check` reachings — and a `quiescent: false` from either instance, or a response from which `quiescent` is absent, terminates the case as **`inconclusive`** naming the case, the instance and the wait. It never falls through to a snapshot read or to `_compare`, and it is not routed into the generic driver-exception path that renders `fail`: a case that could not be decided is not a case that failed, and collapsing the two loses exactly the information the gate needs. `inconclusive` is never counted as a pass by `run_matrix`'s `allPass`.
3. **Each seam is falsified separately, by injecting exactly its own condition, one at a time.** Two injections against fake endpoints with the driver otherwise unchanged: **(i)** an instance returning `subscribed: false` from `canvas.open` while every other command answers normally, and **(ii)** an instance returning `quiescent: false` from `sync.waitQuiescent` for one wait in one case. Each must be recorded as **not a pass** under the repaired driver and must be shown to produce a **`pass`** against a byte copy of the pre-repair driver under an identical harness; both results are recorded for both injections. Injections are targeted, never global (hard-won rule 2), and the report states whether neighbouring cases stayed green. **`initial-sync` must be among the cases falsified by (ii)** — it carries no content predicate, so `converged` is its entire verdict and it is the case that today records `pass` on a settle that never settled. Injection (i) must be shown to **refuse the run**, not to fail or to inconclusive six cases. **A repair to a "green that cannot fail" that is not demonstrated to redden under its own class is not a repair**, and a single falsification covering both seams demonstrates one of them.
4. **The tool surface, argument shapes and case names are unchanged, no runtime dependency is added, and C73's machinery is not touched.** `run_matrix` and `open_canvas` keep their signatures and argument shapes; `MATRIX_CASES` keeps its six identifiers; the run-level refusal is expressed inside the existing result shape (`status` / `allPass` / `inconclusive`) rather than by a new tool; the driver remains standard-library only; and `_was_applied`, `gesture()` and `GestureNotApplied` are not modified, relaxed or routed around.
5. **The class is closed by an inventory, not by this WP's two repairs — every control-protocol response field the driver receives is either read or registered as deliberately unread, and the inventory is asserted from the AST.** For each command the driver issues (`session.info`, `canvas.open`, `canvas.state`, `canvas.binding`, `canvas.simulateEdit`, `sync.waitQuiescent`), every field of the documented response shape is classified exactly once as **consumed** (some code path reads it and can act on it) or as **deliberately unread** (named, with the reason, and with the WP that owns it if it is somebody's criterion). A field in neither class fails this criterion. The classification is asserted structurally — the same technique C73 used to pin its checkpoint, generalised from one call site to the whole response surface — so that **adding a protocol field, or a new call site that drops one, fails the assertion rather than passing silently.** This is the criterion that distinguishes closing the class from repairing its latest two instances: the class has now been located one seam over from its previous repair **three** times in this one file, and each repair so far has been scoped to the instance in front of it.

**Definition of Done:** the driver that renders the release gate's per-case verdicts can no longer decide a case against a canvas no instance is subscribed to, can no longer read a wait that timed out as a settle, and can no longer receive a protocol field that nobody has decided what to do with.

---

## 5. Constraints and Known Risks

- **Permission / environment limits:** Windows dev host. The Python side of this phase has **no vitest coverage and must not pretend to** — its units are verified by a standalone `python tools/test_<name>.py` script per the workspace convention, in the **AgenticWorkspace** repo beside the file it verifies, launched through `visible-console` `run_python` with an **absolute** script path (the `run_command` nested-quote trap). No Graphify graph exists for this project (declared FALLBACK mode).

- **Known risks specific to this WP:**
  - **⚠ AC3 is the criterion this WP will be judged on, and the specific way it will be faked here is by falsifying once.** The two seams have different mechanisms, different failure modes and different verdict shapes; one injection that reddens something proves whichever seam it happened to touch. Both injections are required, separately, each against the pre-repair driver as well. A perturbation that changes nothing is a finding, not a null result — the sixth instance was found by exactly that observation.
  - **⚠ Seam (b) is the one that inverts the verdict on the defect class the gate exists for.** `quiescent: false` means deltas were still landing for the whole timeout, which is what a stalled or slow sync looks like; reading it as a settle produces a **false green under precisely the conditions a real sync bug creates**. If only one seam could be closed, this is the one — but both are in scope and AC1 is not optional.
  - **⚠ The two seams do not subsume each other, and the tempting simplification is wrong.** A canvas nothing observes reports `quiescent: **true**` immediately, because `lastActivity` is never advanced for a doc no observer was registered on. So consuming `quiescent` does **not** detect a never-subscribed canvas, and checking `subscribed` does **not** detect a timeout. Two criteria, two mechanisms, two falsifications.
  - **⚠ `opened` is the wrong field to check.** `{opened: false}` arises only when the instance has no canvas surface at all, and that arm is already fail-closed downstream through C73's gesture checkpoint. The reachable dangerous state is `{opened: true, subscribed: false}`. A truthiness check, or a check on `opened`, closes the arm that was never open.
  - **⚠ Do not repair by counting, and do not copy C73's counts.** The settle decomposition is **1/2/2/2/2/1** across the six cases (ten reachings); C73's gesture decomposition is **1/2/3/2/2/1** (eleven sites). `bidirectional-drag` issues three gestures and settles twice. Re-derive both numbers from the function and state what you found.
  - **⚠ `inconclusive` must stay a third state.** The generic per-case `except Exception` renders `fail`; a timeout implemented as a bare exception lands there and collapses the distinction for the class that most needs it. C73's precedent is a case that moved **`fail` → `inconclusive`**, so a repair that only rescues passes has missed half the class.
  - **The driver may not assume the endpoints were opened or subscribed by its caller.** The gate run is agent-mediated (WP71 / C71) and nothing under `tools/obsidian_e2e/` spawns a process. Every precondition the driver needs, it establishes itself.
  - **Nothing has been executed.** **No control endpoint has ever answered on this host** — measured 2026-08-04 by the Dispatcher, both real control ports probed free with nothing listening. Every criterion here is decided against fake endpoints; **no statement about a live instance, a real Obsidian run, or a gate result may be made anywhere in this WP's artefacts.**

### Sweep findings — same class, recorded here so they are not lost, and NOT in this WP's scope

*This is the second time this class has been found one seam over from where it was last fixed. The driver was therefore swept as a whole while it was open. Five items follow; none is repaired by WP74, and each is recorded rather than absorbed.*

- **S1 — ⚠ `applied` is a constant on the real host, so C73's checkpoint cannot fire against the build the gate will run. ESCALATE.** The plugin's `simulateEdit` returns the literal `{applied: true}` on every path that returns at all; it *throws* for a missing canvas surface and for a missing doc handle rather than reporting `applied: false`. Worse, its transaction skips any node or edge whose `id` is not a string, and deleting an absent key from a `Y.Map` is a silent no-op — so **a change spec that alters nothing still returns `applied: true`.** `applied` is an *accepted-the-command* flag, not a *the-edit-happened* flag. C73's repair is correct, necessary and structurally sound, and its verification script and four falsifications are real — but all of them are decided against **fake** endpoints that can return `applied: false`, and **no real endpoint can.** Against the real build, C73 AC1's guard is presently unfalsifiable, and `delete-node-edge`'s vacuous `node_gone` — the case C73 named as the subtle one — is closed only as far as `applied` is informative, which against the real host is not at all. **Same class, a third time, in the same driver, one seam further again, this time on the plugin side of the protocol.** It lives in `plugin/src/testing/e2e-control.ts`, which WP74 may not touch and which no charter currently names for this. It is escalated to the Dispatcher as candidate new scope, not folded in.
- **S2 — `_compare` silently drops records that have no `id`.** `_index` keys by the `id` field and skips records where it is absent, so two snapshots differing only in id-less records compare **equal**. The TypeScript twin of this comparison deliberately falls back to a positional key *"so an unidentifiable record can never silently match a different one"*; the Python side does not, and the two are documented as being the same shape. Out of scope (oracle redesign); recorded.
- **S3 — "both quiescent" is never simultaneous.** The settle asks instance a, then instance b. AC2 makes each answer honest; it does **not** establish that the system was quiescent at one instant, and a delta can land on a between the two calls. **No artefact of this WP may claim otherwise.** Recorded as a known limitation of the settle, not a defect this WP repairs.
- **S4 — four mid-case settles discard their entire return tuple**, including `converged`. AC2 makes the *wait* inside them honest; the mid-case `converged` remains unread, which is defensible — a mid-case settle is a barrier, not an oracle — but it is unread by omission rather than by decision. Recorded so a later reader does not mistake it for an oversight, and so that if it is ever promoted to an oracle it is chartered rather than absorbed.
- **⚠ S6 — the THIRD instance, in the entry point, found by applying the generalisation rather than by looking where the last one was.** `e2e_connect` issues `session.info` to both instances and **stores the whole response without reading a single field of it.** Its `connected` is set `True` unless the call *raised*, so it means **"the port answered"**, not "the instance is connected" — the response's own `connected` field, the plugin's report of whether its mux and control channels are up, is never consulted. Nor are WP46's four identity fields, two of which matter to criteria that already exist:
  - **`pluginBuild`** carries the `e2e` build marker and WP46 created it *for exactly this check* — *"so a rig can tell an e2e-capable build from a production build by looking at the answer rather than at the port."* **C50 AC5 requires the driver to establish that its endpoint belongs to an E2E-capable build**; the datum arrives in `e2e_connect` and is discarded. **Owner: C50 AC5** — flagged, not annexed by WP74.
  - **`vaultId` / `vaultName`** are never compared **between** a and b. Per D14 Obsidian is single-instance: a second vault is another window in the same process tree, one control server wins the bind, and **the rig can drive one vault twice while believing it drove two, with a green-looking run.** WP44 provisions per-vault ports precisely to prevent this; nothing in the driver verifies it worked. **Owner: a Dispatcher ruling** — D14 identity distinctness is named in no acceptance criterion of any WP.
  - **`connected` and `canvasSurface`** are pure instances of this component's own class and are the two fields **AC5's inventory forces a decision on** without widening into anyone else's criterion.
  **This is the third time the class has been found one seam over from its last repair, and the first time it was found by looking for the *shape* rather than the *place*.** It is also the earliest seam of the three: `e2e_connect` runs before every open, every gesture and every settle.
- **S5 — a driver exception is recorded as `fail`, not `inconclusive`.** An unreachable endpoint, an HTTP timeout or a `canvas not open` refusal is a case that could not be decided. It is fail-closed, so it is not a false green, and re-classifying it changes C50's per-case verdict semantics. Out of scope; belongs to WP50 if it is taken at all.

- **Known flaky patterns:**
  - No wall-clock sleeps. Every wait is bounded and names the condition it was waiting for on expiry — which, after this WP, it must also *report*.
  - Do not assert on log strings as the primary oracle; state is the oracle.
  - A real Obsidian run is slow and stateful. Retrying a flaky step without a teardown in between compounds state.
- **External dependency risks:** No new runtime dependency is permitted; the driver is standard-library only and must stay so. If one looks unavoidable, that is an ESCALATE, not a judgement call.
- **Hard constraints:**
  - **`inconclusive` is never counted as a pass**, and a run-level refusal carries `allPass: false` with no fabricated case verdicts.
  - **An absent key is the unsafe reading:** a missing `subscribed` is unsubscribed, a missing `quiescent` is a timeout.
  - **C73's machinery is not modified**, relaxed or routed around.
  - **No port literal anywhere.** Import `REAL_CONTROL_PORT_A` / `REAL_CONTROL_PORT_B`; the headless pair in the same module is the mock rig's and is not this WP's.
  - No change to `plugin/**`, `server/**` or the control protocol.
  - No existing test is deleted, weakened, retitled, skipped or amended. **WP74 holds no §7 licence of any class**; an unenumerated deletion or assertion rewrite is an abort criterion.
  - **No secret through an agent tool**, in any command string, script argument or control-protocol message.

---

## 6. Definition of Done Artifacts

- **Required changed files:**
  - `h:\My Code\AgenticWorkspace\tools\MCPserver\liveshare_e2e_mcp_server.py` — **AgenticWorkspace repo, branch `toms_branch`** (cross-repo; see §3)
- **Required report:** `ImplementationReport_WP74.md` (in `workflowArtifacts/canvas-v2/`), which must additionally record: the **re-derived** counts — `_open` call sites by function, and `_converge_and_check` reachings with their per-case decomposition — and how each was obtained; the AC3 falsification in full, **per seam**, naming which case, which instance, the pre-repair result and the post-repair result for each injection, and whether neighbouring cases stayed green; an explicit statement that `initial-sync` was among the cases falsified by the `quiescent: false` injection, or why not; an explicit statement that the `subscribed: false` injection **refused the run** rather than producing case verdicts; the implementor's own judgement on whether WP73's one-checkpoint-asserted-from-the-AST shape was applied to each seam and why; **the AC5 inventory in full** — every command, every response field, and its classification as consumed or deliberately-unread-with-a-named-owner — together with the disposition of `session.info`'s `connected` and `canvasSurface` (sweep item S6) and an explicit statement that `pluginBuild` was left to C50 AC5 and `vaultId` distinctness to the Dispatcher rather than annexed; and **both commit hashes**, this repo's and AgenticWorkspace's, since §7's commit and abort accounting assumes one repository.
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
