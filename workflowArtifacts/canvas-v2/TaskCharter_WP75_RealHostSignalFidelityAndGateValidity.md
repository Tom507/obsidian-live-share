# Task Charter — WP75: real-host signal fidelity and gate validity — `applied` is a constant on the real host, and the driver cannot tell two vaults from one

<!-- Updated: chartered 2026-08-04 — the two WP74 sweep items the Dispatcher verified and returned as scope (S1 and S6). Both re-verified independently against the current tree per hard-won rule 12: liveshare `b8a541e` (the commit WP74's charter landed on) for the plugin side, AgenticWorkspace `50b0cf4` for the driver. Every line number below was read from the file, not carried over from the sweep that raised it. This is the NINTH instance in this run of "a green test that cannot fail" and the FIRST that hollows a WP already reported as closed. -->
**Charter Status:** `SPEC_COMPLETE`
**WP:** WP75
**Phase:** P0 (PHASE T3 group)
**task_mode:** `standard`
**Depends on:** WP50, WP73, WP74
**W4 Test Targets:** `0`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** the two places where "a response field with no reader reads as success" lands on the **real host** rather than on the driver are closed: the plugin's `simulateEdit` stops returning a constant where the protocol declares a boolean, and the driver stops treating "the port answered" as "an instrumented, distinct, connected instance answered". After this WP the gate can no longer pass while proving nothing about the build it ran against, and can no longer drive one vault twice while reporting that it drove two.
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 5, **PHASE T3**, component **C75 — Real-host signal fidelity and gate validity** (work package WP75); phase **P0**.

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: modify, in **two repositories**
    - **Part A** — `plugin/src/testing/e2e-control.ts` (`buildPluginHost`'s `simulateEdit`), *this* repo, branch `fix-bugs-and-raceconditions`
    - **Part B** — `tools/MCPserver/liveshare_e2e_mcp_server.py` (`e2e_connect`, `run_matrix`'s pre-case region, the module docstring), **AgenticWorkspace** repo, branch `toms_branch`
  - Responsibility: make the two signals the gate's verdict rests on **true on the real host** — the per-gesture `applied` the real endpoint returns, and the `session.info` payload the driver receives and today discards whole.
  - Scope summary: `applied` becomes a report rather than a literal, with a fault distinguishable from a truthful refusal; `session.info`'s own `connected` is consumed; `pluginBuild`'s e2e marker is checked and an unmarked answer refuses the run; `vaultId` / `vaultName` distinctness between roles `a` and `b` becomes a **gate-validity precondition** checked before case 1; the driver's module docstring is corrected to the payload it actually receives.
- **Out of scope / non-goals:**
  - **Re-opening WP73.** WP73 is `DONE`, its charter was satisfied, and its repair is correct, necessary and structurally sound. **It is not re-opened, relaxed, re-derived or routed around.** What WP75 changes is the *world* C73's guard runs in, not the guard. `_was_applied`, `gesture()`, `GestureNotApplied` and the eleven-sites-through-one-checkpoint structure keep their present behaviour exactly. **The correct statement is not "WP73 was wrong"; it is "C73 AC1 only becomes meaningful once WP75 lands", and this WP's artefacts must use that form.**
  - **WP74's two seams and its AC5 inventory.** `_open`, `_wait`, `_wait_both` and `_converge_and_check` are WP74's. WP75 consumes fields at `session.info` only; it does not touch the open path or the settle path, and it does not restate or re-implement WP74's inventory. Where WP74's AC5 classifies a `session.info` field as *deliberately unread with a named owner*, WP75 is that owner and the classification moves to **consumed** — that is a re-classification inside WP74's landed structure, not a redesign of it.
  - **C50 AC5's other preconditions.** The shared-surface membership check, the `obsidian-git` disposition and the restore verification are WP50's and are neither restated nor implemented here. `pluginBuild` is **cross-referenced** to C50 AC5 — the criterion C50 AC5 states is that the driver *establishes* its endpoint belongs to an E2E-capable build; the **consuming of the datum that lets it** is chartered here, because the datum arrives in `e2e_connect` alongside the rest of a payload nobody reads, and splitting one payload's consumption across two WPs is how the field got lost in the first place.
  - **Repairing the oracles.** `_compare`, `_index`, `_diff_maps`, `_edge_dangling` and the per-case content predicates are not redesigned; sweep item **S2** (below) is recorded, not fixed.
  - **Re-classifying a driver exception.** Sweep item **S5** — a per-case `except Exception` renders `fail` — is WP50's if it is taken at all. **AC2 below interacts with it and does not resolve it:** WP75 moves a *specific* set of conditions off the exception path and onto a truthful `applied: false`; it does not change what the exception path does with what remains.
  - **The control protocol's shape.** No command is added, renamed or removed. No response field is added, renamed or removed. `session.info` keeps its nine keys; `canvas.simulateEdit` keeps returning an object whose `applied` is a boolean. **This WP makes an existing field honest and makes existing fields read; it does not extend the protocol.** A `reason` string accompanying `applied: false` is permitted **only** as an additive optional field that no reader is required to consult and that never substitutes for `applied` — if that reads as extending the protocol to the implementor, that is an ESCALATE, not a judgement call.
  - **`server/**`.** Untouched. §7 makes a `server/` edit outside WP41 an abort criterion.
  - **The `edit` MCP tool's "real capture path" claim.** Recorded as sweep item **S7** below and escalated; not corrected here. See the note there for why a one-line docstring fix is nonetheless *not* folded in.
- **Known interfaces / dependencies:**
  - Input (Part A): the change spec `canvas.simulateEdit` already accepts, and the four conditions under which it presently throws or silently does nothing
  - Input (Part B): the nine-key `session.info` payload `buildPluginHost.sessionInfo()` already returns and `e2e_connect` already receives in full
  - Output: a `applied` that means *the edit happened*, a fault that is distinguishable from a truthful refusal at the driver, and a run that refuses to start against an unmarked build or against two endpoints that are the same vault
  - Depends on work packages:
    - **WP50**, which owns the driver file and whose AC5 this WP supplies one datum for. Landing Part B against the pre-WP50 driver would put the repair in a file WP50 then restructures.
    - **WP73**, whose `_was_applied` / `gesture()` / `GestureNotApplied` machinery is the thing Part A makes reachable. Part A is meaningless without it and must not re-derive it.
    - **WP74**, which restructures `run_matrix`'s pre-case region into a run-level refusal and which inventories the whole response surface. Landing WP75 first would guarantee a textual conflict in exactly that region, would force this WP to invent the run-level refusal shape WP74 establishes, and would leave WP74's AC5 inventory classifying fields this WP had already consumed.
  - **WP7 depends on this WP.** See §5 and the §9 dependency amendment. It is the run, and it is the only place where a constant `applied` or a single vault driven twice turns a green matrix into a false gate.

---

## 3. Architecture Context

*Task-local architecture guidance only.*

- **Component(s) being changed:** Real-host signal fidelity and gate validity
- **Interfaces involved:**
  - Input: the `canvas.simulateEdit` change spec, and the nine-key `session.info` payload
  - Output: a truthful `applied`, a distinguishable fault, a consumed `connected`, a checked `pluginBuild` marker, and a vault-distinctness precondition that refuses the run

### The generalisation, restated because this is the ninth instance and the first to hollow a closed WP

WP74 named the class correctly and its wording is adopted here without change: **the class is not "the driver forgets one flag"; it is "a response field with no reader reads as success."** WP75 covers the two places where that failure lands on the **real host** rather than on the driver — i.e. where the gate could pass while proving nothing, *against the actual build it will run*.

**This is the first instance that hollows a work package already reported as closed, and that has to be said plainly rather than softened.** WP73 is `DONE`. Its guard is structurally correct: eleven gesture sites routed through one checkpoint, the absence of any direct `_simulate` call asserted from the AST, four falsifications recorded. **Every one of those falsifications was decided against a *fake* endpoint that can return `applied: false`. No real endpoint can.** So the checkpoint on which C50 AC3 and the whole per-case verdict depend is, against the build the gate will actually run, **a check on a constant**.

**Stated as the charter must state it: C73 AC1 is presently unfalsifiable against the real build.** Not wrong, not badly implemented, not in need of re-opening — *unfalsifiable*, because the only value its input can take is `true`. **C73 AC1 becomes meaningful when WP75 lands and not before.** Any artefact of this WP that says WP73 "failed", "was insufficient" or "must be redone" is wrong and is to be corrected; any artefact that treats C73 AC1 as currently operative against a real host is also wrong.

### Part A — S1, re-verified against the current tree (rule 12), 2026-08-04, liveshare `b8a541e` — given, do not re-derive

**The declaration.** `plugin/src/testing/e2e-control.ts:285`:

```
simulateEdit(path: string, change: unknown): Promise<{ applied: boolean }>;
```

**The real implementation.** `buildPluginHost` (`:886`) → `simulateEdit` (`:978-1024`). It is the **only** implementation outside `__tests__`; a repo-wide search for `simulateEdit` outside test files returns exactly this one file. Its last statement, `:1023`, is:

```
return { applied: true };
```

**A literal. There is no other return.** The five ways the call can fail to change anything, each measured in the function:

| # | Condition | Line | What happens today |
|---|---|---|---|
| 1 | no canvas surface on the instance | `:980` | **throws** `canvasSync unavailable` |
| 2 | path has no doc handle — not subscribed, no doc id, or no handle | `:981-982` | **throws** `canvas not open: <path>` |
| 3 | a node or edge whose `id` is not a string | `:1000`, `:1004` | **silently skipped** by `if (typeof node.id === "string")`, then `applied: true` |
| 4 | `removeNodes` / `removeEdges` naming a key the `Y.Map` does not hold | `:1002`, `:1006` | `Y.Map.delete` of an absent key is a **silent no-op**, then `applied: true` |
| 5 | an upsert whose every field already holds the given value | `:753-762` | `upsertRecord` skips each unchanged key (`if (ymap.get(k) !== v)`), then `applied: true` |

**So `applied` is an *accepted-the-command* flag, not a *the-edit-happened* flag** — and rows 3–5 mean a change spec that alters nothing still answers `applied: true`. Rows 1–2 mean a genuine "this cannot be done" is delivered as a throw, never as `applied: false`.

**What the throw becomes at the driver, measured end to end.** `routeCommand`'s `catch` (`:523-525`) turns any thrown error into `badRequest(...)`, i.e. HTTP 400 with `{ok: false, error}`. `_command` (driver `:104-108`) raises `RuntimeError` on `ok: false`. `gesture()` (driver `:383-388`) does **not** catch it, so it propagates past `GestureNotApplied` to `run_matrix`'s generic `except Exception` (driver `:530-537`), which records **`status: "fail"`**.

**The consequence, which is sharper than "the flag is a constant".** Against the real host today:

- `applied: false` **cannot occur**, so `GestureNotApplied` **cannot be raised**, so **`status: "inconclusive"` from `reason: "gesture-not-applied"` is structurally unreachable.** C73's third state exists and, on the real host, has no reachable producer on the gesture path.
- Every genuine non-application either arrives as `fail` through the exception path (rows 1–2, which is fail-closed but mis-classified — a case that *could not be decided* recorded as a case that *failed*), or **does not arrive at all** (rows 3–5, which is the false green).
- `delete-node-edge`'s `node_gone` predicate — the case C73's own charter named as the subtle one, because it is satisfied by the node never having been created — is protected exactly as far as `applied` is informative, which against the real host is not at all. Row 4 is *literally the delete path of that case*.

**I11 REFUSAL NEVER DESTROYS is binding on this repair and is the trap in it.** The tempting implementation of "report whether the edit happened" is to compare before/after state, and the tempting implementation of "refuse cleanly" is to undo a partial transaction. **Reporting `false` must not delete or mutate anything** — not the record it refused, not the records that did apply, not the `.canvas` file. A refusal that rolls back by deleting is the composition I11 exists to forbid, and WP63 closed that exact shape at the seed boundary. Whether a partially-applied spec reports `applied: true` with the applied subset intact, or reports `applied: false` having applied nothing, is an **architecture decision the implementor must make and record**, and either answer is acceptable **only** if no destructive step is introduced to reach it. If the only way the implementor can see to report `false` for a mixed spec is to remove what already applied, that is an **ESCALATE**.

**Interaction with WP74 AC1 that must not be missed.** WP74's analysis states that the `{opened: false, subscribed: false}` arm "is already fail-closed downstream, because `simulateEdit` throws for the same condition and C73's `gesture()` propagates the throw." **After WP75 that sentence's mechanism changes and its conclusion does not.** If rows 1–2 become `applied: false`, the arm is fail-closed through `GestureNotApplied` → `inconclusive` instead of through an exception → `fail` — **still fail-closed, and better classified.** WP74's AC1 remains satisfied either way, and this must be stated in the implementation report rather than left for a later reader to worry about.

### Part B — S6, re-verified against the current driver (rule 12), 2026-08-04, AgenticWorkspace `50b0cf4` — given, do not re-derive

**The payload the plugin sends.** `buildPluginHost.sessionInfo()` (`plugin/src/testing/e2e-control.ts:939-957`) returns **nine** keys:

```
clientId · role · roomId · connected      ← the pre-WP46 quartet
vaultId · vaultName · vaultPath · pluginBuild · canvasSurface   ← WP46 identity
```

**What the driver does with it.** `e2e_connect` (`:194-225`) stores each instance's whole response at `info[key] = _command(key, "session.info")` and **reads not one field of it.** Its own `connected` (`:214`, `:219`) is initialised `True` and set `False` only when the call *raised*. **So the driver's `connected` means "the port answered". The response's own `connected` — `Boolean(plugin.muxConnected) && Boolean(plugin.controlConnected)`, the plugin's report of whether its mux and control channels are up — is never consulted.**

**Confirmed by search, not by reading:** `vaultId`, `vaultName`, `vaultPath`, `pluginBuild` and `canvasSurface` appear **nowhere** in `liveshare_e2e_mcp_server.py`. The only occurrences of the string `connected` in that file are the driver's own flag (`:202`, `:214`, `:219`, `:221`, `:225`) and two prose uses (`:95`, `:230`).

**The docstring is two work packages stale.** `:13` still reads:

```
session.info        -> {clientId, role, roomId, connected}
```

That is the **pre-WP46 four-key** payload. WP46 landed the other five. A docstring describing a payload that changed two WPs ago, sitting in the gate's own entry point, is the **recall-not-re-read pattern (hard-won rule 6)** — the same pattern that produced three stale §7-list quotations in this run. It is corrected by AC3 because an implementor reading this file to decide what to consume would be reading a contract that no longer exists.

**Two distinct consequences, and the second is the severe one.**

**(1) The gate cannot prove it is driving an instrumented build.** `pluginBuild` is `` `${manifest.version}+${E2E_BUILD_MARKER}` `` (`:807-809`), with `E2E_BUILD_MARKER = "e2e"` (`:72`). WP46 created it, in its own words, *"so a rig can tell an e2e-capable build from a production build by looking at the answer rather than at the port."* **C50 AC5 requires the driver to establish that its endpoint belongs to an E2E-capable build.** The datum arrives in `e2e_connect` and is discarded, so C50 AC5 has, for this precondition, no mechanism.

> **⚠ One correction to how this is usually phrased, verified here and adopted into AC3.** "A production build answering the port" is **not** the reachable hazard, and an implementor who codes for it will write a check that cannot fire. The control server only exists inside `main.ts:444`'s `if (typeof __LS_E2E__ !== "undefined" && __LS_E2E__)` branch, and `src/testing/` tree-shakes out of a production bundle entirely — **a production build cannot answer `session.info` at all; it has no control port to answer on.** The check is therefore not *"detect a production build on the wire"* but *"the answer positively identifies an e2e-capable build, and anything that answers without the marker is refused."* That is strictly stronger and it covers the hazards that **are** reachable: a stale e2e bundle from an earlier install; the **headless mock rig** (`HEADLESS_RIG_PORT_A/B`, deliberately disjoint per D13, but a mis-provisioned port is exactly the substitution WP7's AC5 exists to prevent, and WP7's own charter had already to be corrected for naming that pair); or a control server that won the bind from a window other than the intended one. **The refusal is the same either way. The reasoning for it must be the correct one.**

**(2) The gate cannot tell two vaults from one — and this is the one that voids the whole run.** `vaultId` and `vaultName` are never compared **between** roles `a` and `b`. Per **D14** Obsidian is single-instance: *"opening a second vault yields a second renderer window inside the same process tree."* WP44 provisions per-vault control ports through the vault-local `data.json` precisely so the two windows are separable — and **nothing anywhere verifies that it worked.** If both roles resolve to the same vault, **every matrix case converges trivially and correctly**: one document, compared with itself, through the driver's own `_compare`, with real gestures that really applied. `allPass: true`. **A "two-vault gate" that is one vault syncing with itself, reporting a full green.**

**This is why the Dispatcher ruled it its own acceptance criterion rather than a line inside C50 AC5.** Vault distinctness is a **gate-validity precondition**: if it fails, *no result from the run means anything*. That is a different category from a case-level check, which asks whether one behaviour held. A case-level failure invalidates a case; this invalidates the run, retroactively, including the cases that passed.

**Two mechanics of the identity check that a naive implementation gets wrong, both measured:**

- **`resolveVaultId` degrades to `""`** (`:796-798`: `app.appId` ?? `resolveVaultPath(plugin)` ?? `""`), and **`resolveVaultName` degrades to `""`** (`:801-804`). **Two empty values are a match, not "distinct-unknown", and they must abort.** An implementation of the form `if a and b and a == b: abort` passes the degraded case, which is the worst case — it is the one where the driver knows least. The absent-key rule C73 and C74 both pin applies verbatim: **an absent or empty identity is the unsafe reading.**
- The check compares **static** data, so the sequential-call limitation that constrains the settle (sweep item **S3**) does **not** apply to it. A vault's identity does not change between two `session.info` calls. This is stated so that S3's constraint is not over-applied to AC4 and so that AC4's artefacts are not weakened by a limitation they do not have.

**Where the check must sit.** Before case 1, in the same run-level refusal shape WP74 AC1 establishes: `inconclusive`, naming the reason, carrying `allPass: false`, fabricating **no** per-case verdicts. **Never a pass. Never a silent skip.** Attributing a run-level precondition failure to six oracles that never ran is the mis-attribution C73 AC2 exists to prevent — the same argument WP74 made for seam (a), and it is the same shape here.

- **Constraints from BUILD_SPEC (invariants — what must not change):**
  - **I11 REFUSAL NEVER DESTROYS** is binding on Part A. Reporting `applied: false` must not delete, truncate or mutate any record, doc entry or file. A rollback implemented as a delete is the composition I11 forbids.
  - **An absent or empty value is the unsafe reading, never the safe one.** A missing `applied` is unapplied (C73's rule, unchanged); a missing or non-marked `pluginBuild` is *not an e2e build*; an absent or empty `vaultId` / `vaultName` is *not distinct*; a missing `connected` is *not connected*.
  - **`inconclusive` is never a pass**, in `allPass` or anywhere else, and a run-level refusal carries `allPass: false` while fabricating **no** case verdicts.
  - **C73's machinery is untouched.** `_was_applied`, `gesture()` and `GestureNotApplied` keep their present behaviour exactly. WP73 is not re-opened.
  - **WP74's seams are untouched.** `_open`, `_wait`, `_wait_both`, `_converge_and_check` are not modified by this WP.
  - **Zero new runtime dependencies**, in either repo. The driver is standard-library only (`json`, `urllib`) and stays that way; the plugin adds no package.
  - **No control-protocol command or field is added, renamed or removed.**
  - No change to `server/**`.
  - **Ports are imported, never spelled.** `REAL_CONTROL_PORT_A` / `REAL_CONTROL_PORT_B` in `tools/obsidian_e2e/constants.py` are the real control endpoints; `HEADLESS_RIG_PORT_A` / `HEADLESS_RIG_PORT_B` in the same file are the **mock** rig's and are deliberately disjoint per D13. **No port literal appears anywhere in this WP's work**, including in a comment or a fake-endpoint harness. WP7's charter already had to be corrected for naming the mock pair; the gate's own artefacts are not exempt.
  - **No secret through an agent tool**, in any command string, script argument or control-protocol message. `data.json` is compared by sha256 of bytes only and no value read from it appears in any artefact.
- **Technology / framework / config constraints:**
  - Part A is TypeScript under the `plugin/` vitest gate. Part B is an MCP server (`FastMCP`) verified by a standalone `python tools/test_<name>.py` script beside the file it verifies, launched through `visible-console` `run_python` with an **absolute** script path (the `run_command` nested-quote trap).
  - The gate run is **agent-mediated** (WP71 / C71): `lifecycle.py`'s only console backend is `PlanOnlyConsole` and nothing under `tools/obsidian_e2e/` spawns a process. **The driver may not assume the endpoint it holds was brought up, opened, subscribed or built by the process calling it.** Every precondition it needs, it establishes itself — which is the whole of Part B.
  - **Schema impact:** none. No doc format and no `.canvas` file-format change.
- **Entry points / relevant files:**
  - `plugin/src/testing/e2e-control.ts` — `buildPluginHost.simulateEdit` (`:978-1024`); the interface declaration at `:285`; `upsertRecord` (`:753-762`) as read-only context; `routeCommand`'s catch (`:523-525`) as the seam that decides whether a condition arrives as a 400 or as a 200 with `applied: false`
  - `tools/MCPserver/liveshare_e2e_mcp_server.py` — `e2e_connect` (`:194-225`); the module docstring (`:11-19`); `run_matrix`'s pre-case region (`:508-511`), **as restructured by WP74**
  - `plugin/src/testing/e2e-control.ts` `sessionInfo` (`:939-957`) and the resolvers (`:785-816`) — **read-only context**, not modified
- **⚠ Cross-repo — do not re-derive, and do not "fix" the paths by guessing.** `tools/MCPserver/liveshare_e2e_mcp_server.py` **does not exist in the `obsidian-live-share` repository.** It lives in the **AgenticWorkspace** repo at `h:\My Code\AgenticWorkspace\tools\MCPserver\liveshare_e2e_mcp_server.py`, on branch **`toms_branch`** (**not** that repo's default branch). **WP73 set the precedent and executed it**, committing the workspace-repo change separately at `50b0cf4` and recording **both** commit hashes in its implementation report, because §7's commit and abort accounting assumes a single repository. **WP75 is the first WP in this run whose *own two halves* land in two different repositories** — Part A here, Part B there — so the two-hash record is not a formality for this WP, it is the only way the change is auditable at all. Both hashes are required in the implementation report; a report carrying one has recorded half the work package.
- **⚠ Rule-10 file overlap, declared rather than discovered.** **WP51 (`planned`) names `plugin/src/testing/e2e-control.ts` as its sole required changed file**, and Part A edits the same file. The two touch different functions — WP51 the stale-view command surface, WP75 `simulateEdit`'s return contract — and neither depends on the other. **If they are scheduled in the same batch, the batch's shared-ownership contract must name who writes which block**, exactly as the WP69/WP70 `constants.py` overlap was handled. Two agents independently editing one file has cost this run a batch before.
- **Structure references:** *(intentionally empty — no Graphify graph exists for this project; FALLBACK mode is declared in the BUILD_SPEC section 3. Worker 3 fills this in after implementation. Do not invent paths here.)*

If structure references conflict with the BUILD_SPEC or explicit task scope, the BUILD_SPEC and TaskCharter win. Escalate instead of following the map.

---

## 4. Acceptance Criteria

*Exact copy from BUILD_SPEC section 5, PHASE T3, component C75. No paraphrasing.*

1. **`applied` reports whether the edit happened, on the real host, for every condition under which it does not.** `buildPluginHost.simulateEdit` returns `applied: false` — not a throw, not `true` — for each of: a path with no resolvable doc handle (unsubscribed, no doc id, or no handle); an instance with no canvas surface; a node or edge record whose `id` is not a string; a `removeNodes` / `removeEdges` id the map does not hold; and a change spec that leaves every addressed field at the value it already held. The declared return type at the interface is unchanged and the field stays a boolean. **I11 REFUSAL NEVER DESTROYS is binding: reporting `false` deletes, truncates and mutates nothing** — not the refused record, not the records that did apply, not the `.canvas` file — and a rollback implemented as a delete is the composition I11 forbids. The disposition of a **partially** applicable spec is an architecture decision the implementor makes and records explicitly; either answer is acceptable only if no destructive step is introduced to reach it.
2. **A genuine fault stays a throw, and a thrown fault is distinguishable at the driver from a truthful `applied: false`.** Faults — a malformed request, an internal error, a condition the host cannot classify — continue to surface as the control server's structured 400, which the driver raises and `run_matrix` records as `fail`. A truthful refusal surfaces as a 200 carrying `applied: false`, which C73's `gesture()` turns into `GestureNotApplied` and `run_matrix` records as `inconclusive`. **The two must not collapse into one another in either direction**, and the implementation report must state which conditions were routed to which and why. Today the distinction exists in the driver and has no reachable producer on the real host: `applied: false` cannot occur, so `status: "inconclusive"` from `reason: "gesture-not-applied"` is structurally unreachable against the real build, and every genuine non-application arrives as `fail` or does not arrive at all. **C73 AC1 is presently unfalsifiable against the real build; this criterion is what makes it meaningful, and no artefact may describe WP73 as having failed.**
3. **`session.info` is read, not stored — its own `connected` is consumed and its `pluginBuild` is checked for the e2e marker, and an unmarked build refuses the run rather than failing a case.** `e2e_connect` consumes the response's `connected` field rather than inferring connectedness from the call not having raised; a response reporting `connected: false`, or one from which the key is absent, is **not connected**. `pluginBuild` is checked to carry the `E2E_BUILD_MARKER`; an absent, empty or unmarked `pluginBuild` **refuses to start the run** under a named reason, carrying `allPass: false` and fabricating no case verdicts — it is a precondition, not a case failure. The check is **positive identification of an instrumented build**, not detection of a production build: a production bundle tree-shakes the control surface out and cannot answer at all, so a check written to catch one cannot fire, while the reachable hazards — a stale bundle, the headless mock rig, a control server that won the bind from the wrong window — are all caught by requiring the marker. `e2e_connect` leaves no half-registered connection whose failure nothing reads. **The module docstring is corrected to the real nine-key payload** (`clientId`, `role`, `roomId`, `connected`, `vaultId`, `vaultName`, `vaultPath`, `pluginBuild`, `canvasSurface`); a docstring describing a payload that changed two WPs ago, in the gate's own entry point, is the recall-not-re-read pattern hard-won rule 6 exists for. `pluginBuild`'s check is cross-referenced to **C50 AC5**, which states the requirement; this criterion supplies the consumption.
4. **Vault distinctness is a gate-validity precondition, checked before case 1, and a match aborts the run.** Before the first case the driver compares `vaultId` and `vaultName` between roles `a` and `b`; **both must differ.** A match on either, or a value that is absent or empty on either side, terminates the run as **`inconclusive`** naming the reason and the field, carrying `allPass: false`, fabricating **no** per-case verdicts. **Never a pass, never a silent skip, and never downgraded to a warning.** Two empty values are a match, not "distinct-unknown": an implementation that skips the comparison when a value is missing passes precisely the case in which the driver knows least. Per **D14** both vault windows may live in one Obsidian process and one control server may win the bind, so the rig can drive **one vault twice while believing it drove two** — and every case then converges trivially and correctly, with real gestures that really applied, reporting a full green. **This is a run-validity precondition and not a case-level check: if it fails, no result from the run means anything, including the cases that passed.** The sequential-call limitation recorded as sweep item S3 does not apply here, because vault identity is static across the two calls.
5. **Each of the four repairs is falsified separately, by injecting exactly its own condition, and Part A is falsified against the REAL endpoint rather than a fake.** Four injections, one at a time, with the rest of the system unchanged, each recorded as **not a pass** under the repaired code and shown to produce a **`pass`** (or, for AC3/AC4, a started run) against a byte copy of the pre-repair code under an identical harness: **(i)** a `removeNodes` id absent from the map, driven through `buildPluginHost` against a real `Y.Doc` — **not** a hand-rolled fake host — which must yield `applied: false` and carry `delete-node-edge` to `inconclusive`, where before it yielded `applied: true` and a `pass`; **(ii)** a record whose `id` is not a string, likewise against the real host; **(iii)** an endpoint answering `pluginBuild` without the marker, which must refuse the run; **(iv)** two endpoints answering the same `vaultId`, which must abort the run before case 1. Injections (i) and (ii) are the criterion this WP is judged on: **falsifying them against a fake host that can already return `applied: false` demonstrates nothing, because that is exactly what WP73 already demonstrated and exactly why WP75 exists.** Injections are targeted, never global (hard-won rule 2), and the report states whether neighbouring cases stayed green. A perturbation that changes nothing is a finding, not a null result.

**Definition of Done:** the two signals the gate's verdict rests on are true on the real host — `applied` reports whether the edit happened, and the driver knows that the instances answering it are instrumented, connected and two.

---

## 5. Constraints and Known Risks

- **Permission / environment limits:** Windows dev host. Part A runs under the `plugin/` vitest gate (run all plugin commands from `plugin/`, never the repo root; Vitest 4.0.18, the `basic` reporter was removed; budget >= 90 s for any automated `npm test` — a 33.5 s legacy sleeper makes ~41 s the floor, not a hang). Part B has **no vitest coverage and must not pretend to** — its units are verified by a standalone `python tools/test_<name>.py` script per the workspace convention, in the **AgenticWorkspace** repo beside the file it verifies, launched through `visible-console` `run_python` with an **absolute** script path. No Graphify graph exists for this project (declared FALLBACK mode).

- **Dependency ruling — WP75 must land before the gate run. It blocks WP7 and it does NOT block WP50.** The argument, because the Dispatcher asked for it rather than for the answer:
  - **It does not block WP50.** WP50 is the *detector* charter and is verified against **fake** endpoints — that is why the BUILD_SPEC already records that WP50 depends on neither WP69 nor WP70 nor WP71–WP73: *"WP7 is again where every one of these dependencies is real."* Part A is a plugin-side TypeScript repair in a different repository; making WP50 wait on it would serialise a Python driver behind a TypeScript change for **no verification gain**, since every WP50 criterion is decidable against injectable seams either way. Part B is in WP50's own file, which is why WP75 **depends on** WP50 rather than the reverse: WP50 restructures that file and a repair landed underneath it would have to be re-derived. **The relation is WP75 → depends on → WP50, not WP75 → blocks → WP50.**
  - **It blocks WP7 absolutely, and more strongly than WP73 or WP74 did.** WP7 is the run. WP73 and WP74 each block it because a specific false green becomes reachable without them. WP75 blocks it for a **stronger** reason: without Part A, the guard WP7's central per-case verdict depends on is a check on a constant, so a green WP7 would carry a falsifiability property it does not have — the gate's own record would assert something untrue about itself. Without Part B, a green WP7 is compatible with **one vault syncing with itself over a build nobody identified**, which is not a weakened gate but a vacuous one: every case would converge trivially and correctly, and the artefact would be indistinguishable from a real green. **The distinction matters for scheduling:** WP73 and WP74 make the gate *able to detect* things; WP75 makes the gate's **result mean anything at all**.
  - **Not decided here, deliberately:** whether WP51 or WP52 should also wait. Neither is claimed as blocked and neither is argued for; that is the Dispatcher's call and inventing it would be the widening this run has charged five WPs with avoiding.

- **Known risks specific to this WP:**
  - **⚠ AC5 is the criterion this WP will be judged on, and the specific way it will be faked here is by falsifying Part A against a fake host.** Every hand-rolled fake host in the existing tests can already return `applied: false` on demand — that is precisely what made WP73's four falsifications possible and precisely why they proved nothing about the real build. **A falsification of AC1 that does not go through `buildPluginHost` against a real `Y.Doc` demonstrates the thing that was already demonstrated.** This is not a stylistic preference about test doubles; it is the entire content of the work package.
  - **⚠ The I11 trap is in the obvious implementation.** "Report whether it happened" invites a before/after comparison, and "refuse cleanly" invites an undo. A refusal that rolls back by deleting is exactly the composition of individually-correct steps that WP63 was chartered to close at the seed boundary. If reporting `false` for a mixed spec appears to require removing what already applied, **ESCALATE**.
  - **⚠ Do not re-open WP73, and do not let the report drift into saying it failed.** WP73 is `DONE`, its charter was satisfied, and its structure is what makes Part A worth doing. The correct statement is *"C73 AC1 only becomes meaningful once WP75 lands."* An implementation report that describes WP73 as insufficient is factually wrong about a closed work package and must be corrected before handover.
  - **⚠ `pluginBuild`'s check must be written as positive identification, not as production-build detection.** A production bundle has no control server — `src/testing/` tree-shakes out of it entirely — so it cannot answer `session.info` and a check written to catch one cannot fire. This is the same shape as the `__LS_E2E__` count that could not fail and was briefly recorded as discharging W4-1. **Require the marker; refuse its absence.**
  - **⚠ Two empty identity values are a match.** `resolveVaultId` degrades to `""` and `resolveVaultName` degrades to `""`. `if a and b and a == b: abort` passes the degraded case, which is the case in which the driver knows least. The absent-value rule is the same one C73 and C74 both pin.
  - **⚠ Part A and Part B land in different repositories and are one work package.** The report carries **both** commit hashes. §7's commit and abort accounting assumes one repository; this is the first WP in the run whose own two halves cross that boundary.
  - **⚠ `plugin/src/testing/e2e-control.ts` is also WP51's sole required changed file.** Declared as a rule-10 hazard in §3; if the two share a batch, the shared-ownership contract names who writes which block.
  - **Nothing has been executed.** **No control endpoint has ever answered on this host** — measured 2026-08-04 by the Dispatcher, both real control ports probed free with nothing listening. Every criterion here is decided against the real *host builder* in a headless test, never against a live Obsidian instance; **no statement about a live instance, a real Obsidian run, or a gate result may be made anywhere in this WP's artefacts.** "Against the real endpoint" in AC5 means `buildPluginHost` over a real `Y.Doc`, not a running vault.

### Recorded, not repaired — carried forward from WP74's sweep and this one

*None of the following is in WP75's scope. Each is recorded so it is not rediscovered as a finding, with its owner named where one exists.*

- **S2 — `_compare` silently drops records that have no `id`, and its TypeScript twin deliberately does not.** `_index` (driver `:155-162`) keys by the `id` field and skips records where it is absent, so two snapshots differing **only** in id-less records compare **equal**. The TypeScript comparison the two are documented as sharing a shape with (`sameRecordSet` / `evaluateCanvasConvergence`, `plugin/src/testing/e2e-control.ts:192`, `:237`) falls back to a positional key *"so an unidentifiable record can never silently match a different one"*. The two are divergent and one of them is the gate's oracle. **Owner: WP50** if it is taken at all — it is an oracle redesign, and C50 owns the per-case verdict semantics.
- **S3 — "both quiescent" is never simultaneous, and this constrains what the gate's own report may claim.** The settle asks instance `a`, then instance `b`. WP74 AC2 makes each answer honest; **it does not establish that the system was quiescent at one instant**, and a delta can land on `a` between the two calls. **No artefact of WP75, WP74, WP50 or WP7 may claim simultaneity, "the system was quiet", or "both peers were settled at the same moment".** The defensible claim is *"each instance reported quiescent when asked, in sequence."* This is a known limitation of the settle, not a defect any of these WPs repairs, and it is recorded here in the imperative form because the artefact most likely to overclaim it is the gate's own run report. **AC4's identity comparison is explicitly NOT constrained by this** — vault identity is static across two calls.
- **S4 — four mid-case settles discard their whole return tuple, including `converged`.** Defensible: a mid-case settle is a barrier, not an oracle. But it is unread by omission rather than by decision. Recorded so a later reader does not mistake it for an oversight, and so that promoting it to an oracle is chartered rather than absorbed. **Owner: none assigned.**
- **S5 — a driver exception is recorded as `fail`, not `inconclusive`.** An unreachable endpoint, an HTTP timeout or a `canvas not open` refusal is a case that could not be **decided**. It is fail-closed, so it is not a false green, and re-classifying it changes C50's per-case verdict semantics. **Owner: WP50** if it is taken at all. **AC2 above interacts with it and does not resolve it:** WP75 moves a named set of conditions off the exception path onto a truthful `applied: false`; what remains on the exception path keeps its present classification.
- **S7 — NEW, found while verifying Part B: the `edit` tool's docstring claims a path the tool does not exercise.** `edit`'s docstring (driver `:261`) reads *"Inject a canvas edit on ONE instance through its **real capture path**."* It does not. `simulateEdit` writes **directly into the shared `Y.Doc`** via `upsertRecord` on `doc.getMap("nodes")` / `getMap("edges")` — which is the *remote-apply* side of the binding, not `captureLocal`. The matrix therefore measures **doc → relay → doc** convergence; it does not establish that a user gesture reaches the doc, nor that a remote delta reaches the canvas view or the file. `canvas.binding`'s four counters (`applyRemote`, `captureLocal`, `rePush`, `originUpdates`) are the only protocol datum that could show which binding path ran — and `run_matrix` **never calls `binding_stats` at all** (`_binding` has exactly one call site, the `binding_stats` tool). **D17 already records the doc-versus-file half of this limitation; the capture-path half is recorded nowhere, and the driver's own docstring asserts the opposite of it.** Two separable items, neither chartered here: the **false claim** is a one-line honesty fix, deliberately **not** folded into AC3 because AC3's docstring clause is scoped to the `session.info` payload and widening it to a second tool's behavioural claim is the scope creep this run has charged five WPs with avoiding; the **substantive question** — whether the matrix should assert on binding counters at all — belongs to **WP50** (per-case oracle verdicts) or **WP52** (which makes the counters path-scoped; they are module-global today and their SSE events carry `path: ""`). **Escalated to the Dispatcher, not annexed.**

- **Known flaky patterns:**
  - No wall-clock sleeps. Every wait is bounded and names the condition it was waiting for on expiry.
  - Do not assert on log strings as the primary oracle; state is the oracle.
  - Biome reports a whole-file `format` finding per touched file (CRLF environment artefact). Advisory locally, gating in CI — do not mass-reformat.
  - A real Obsidian run is slow and stateful. Retrying a flaky step without a teardown in between compounds state.
- **External dependency risks:** No new runtime dependency is permitted in either repo; the driver is standard-library only and must stay so, and the plugin adds no package. If one looks unavoidable, that is an ESCALATE, not a judgement call.
- **Hard constraints:**
  - **I11 REFUSAL NEVER DESTROYS** governs every path that reports `applied: false`.
  - **An absent or empty value is the unsafe reading:** a missing `applied` is unapplied, a missing `connected` is not connected, an unmarked `pluginBuild` is not an e2e build, an empty `vaultId` or `vaultName` is not distinct.
  - **`inconclusive` is never counted as a pass**, and a run-level refusal carries `allPass: false` with no fabricated case verdicts.
  - **C73's machinery is not modified**, relaxed or routed around, and **WP73 is not re-opened**.
  - **WP74's seams are not modified.**
  - **No control-protocol command or response field is added, renamed or removed.**
  - **No port literal anywhere.** Import `REAL_CONTROL_PORT_A` / `REAL_CONTROL_PORT_B`; the headless pair in the same module is the mock rig's and is not this WP's.
  - No change to `server/**`.
  - **Data safety (D16, BUILD_SPEC §7 data-safety gate).** No pre-existing note, canvas or attachment in either owner vault is opened for writing by this WP. Nothing in this WP requires touching a vault at all.
  - No existing test is deleted, weakened, retitled, skipped or amended. **WP75 holds no §7 licence of any class**; an unenumerated deletion or assertion rewrite is an abort criterion.
  - **No secret through an agent tool**, in any command string, script argument or control-protocol message.

---

## 6. Definition of Done Artifacts

- **Required changed files:**
  - `plugin/src/testing/e2e-control.ts` — **this repo**, branch `fix-bugs-and-raceconditions` (Part A)
  - `h:\My Code\AgenticWorkspace\tools\MCPserver\liveshare_e2e_mcp_server.py` — **AgenticWorkspace repo, branch `toms_branch`** (Part B; cross-repo, see §3)
- **Required report:** `ImplementationReport_WP75.md` (in `workflowArtifacts/canvas-v2/`), which must additionally record: the disposition of each of the five non-applying conditions in AC1, stating for each whether it now returns `applied: false` or remains a throw **and why**, and the explicit architecture decision taken for a **partially** applicable spec together with the demonstration that no destructive step was introduced to reach it (I11); the statement that WP74 AC1's `{opened: false}` arm remains fail-closed after this change, and through which mechanism; the AC5 falsification in full, **per injection**, naming the pre-repair and post-repair result for each and whether neighbouring cases stayed green, with an **explicit statement that injections (i) and (ii) were driven through `buildPluginHost` against a real `Y.Doc` and not through a fake host** — or, if they were not, why the WP should be considered anything other than a repetition of WP73; the nine-key `session.info` payload as the corrected docstring states it, checked against the file rather than against this charter; how `pluginBuild`'s marker check was written and the demonstration that it is positive identification rather than production-build detection; the vault-distinctness check's exact comparison, including its behaviour when a value is absent or empty on one or both sides; a statement that **no live Obsidian instance was involved and no gate result is claimed**; and **both commit hashes**, this repo's and AgenticWorkspace's, since §7's commit and abort accounting assumes one repository and this is the first WP whose own two halves cross that boundary.
- **BUILD_SPEC updates required:** no — unless implementation invalidates an architecture decision, in which case ESCALATE rather than editing the spec.
- **Gate status required at handover:** `npm run build` PASS and `npm test` with 0 failures, run from `plugin/`. The standalone `python tools/test_<name>.py` script for Part B passes, launched through `visible-console` `run_python` with an absolute path.

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
