# Task Charter — WP76: the gate exercises the capture path, the apply path reaches the file, and every case says which path it drove

<!-- Updated: chartered 2026-08-04 — sweep item S7 from WP75, verified by the Dispatcher and re-verified independently against the current tree per hard-won rule 12: liveshare `967bf00` for the plugin side, AgenticWorkspace `50b0cf4` for the driver. Every line number below was read from the file. This WP is NOT another instance of "a green test that cannot fail"; it is the prior question — whether the gate runs the code the initiative exists to fix at all. The re-verification found three facts the escalation did not contain, and each one changes the shape of the repair (S8, S9, S11 in §5). -->
**Charter Status:** `SPEC_COMPLETE`
**WP:** WP76
**Phase:** P0 (PHASE T3 group)
**task_mode:** `standard`
**Depends on:** WP50, WP74, WP75
**W4 Test Targets:** `0`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** the gate stops measuring only `doc → relay → doc` and starts exercising the two directions the initiative exists to fix — a local gesture reaching the CRDT through the instance's **own capture path**, and a remote delta reaching the instance's **view and its `.canvas` file** — and every matrix case carries **positive evidence of which path it drove** rather than an assertion that it drove one. `canvas.simulateEdit` keeps its present behaviour and its present role as the doc-injection (remote-apply-side) gesture; it is not removed, re-pointed or deprecated.
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 5, **PHASE T3**, component **C76 — The gate exercises the capture path, and every case records which path it drove** (work package WP76); phase **P0**.

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: modify, in **two repositories**
    - **Part A** — `plugin/src/testing/e2e-control.ts`, *this* repo, branch `fix-bugs-and-raceconditions`: the control surface gains the workspace-open command and the capture-path gesture, and the protocol type block gains their declarations.
    - **Part B** — `tools/MCPserver/liveshare_e2e_mcp_server.py`, **AgenticWorkspace** repo, branch `toms_branch`: `_run_case` / `run_matrix` consume the new commands and the binding counters and record the path per case; the `edit` tool's docstring and the module docstring are corrected.
  - Responsibility: make the gate's *subject* the right one. WP73 and WP74 made the gate able to detect a false green; WP75 made its signals true; **WP76 makes it exercise the code path whose defect this initiative was opened to close.**
  - Scope summary: a control command opens the canvas in the instance's **own workspace** so the plugin's own wiring runs (`syncCanvasPresences` → `mountCanvasPresence` → `CanvasBinding` when the flag is on, and `attachCanvasWriter` → `CanvasPersistence`); a second control command drives a gesture through the instance's **own capture path** and reports whether capture actually ran and which path it was; `canvas.simulateEdit` is retained unchanged and is named, everywhere, as the doc-injection gesture it is; the matrix records per case which gesture kind it used and which path was exercised, from evidence, and a case that cannot name it is `inconclusive`; the driver's `edit` docstring stops claiming a "real capture path".
- **Out of scope / non-goals:**
  - **Changing `canvas.simulateEdit`'s behaviour.** Its doc-write is the *remote-apply* origin the convergence cases genuinely need — `bidirectional-drag` requires instance `b` to originate a delta, and the "a peer's change arrived" half of every case is exactly what it produces. **Do not remove a capability to add one.** WP75 makes its `applied` truthful; WP76 does not touch it beyond that. Re-pointing it at capture would silently change the meaning of all six cases and of the eleven gesture sites WP73 routed through one checkpoint, and would leave the remote-apply side with no origin at all.
  - **C52's signal tap.** Which patched adapter signal fires, in what order, with a sequence number, and making the counters path-scoped, is **WP52**. WP76 consumes the counters as they are and states their limits (AC4); it does not make them path-scoped and does not add signal events.
  - **C53's input-layer gesture family.** C53 AC1–AC2 already charter driving *each* interaction the trigger table names — a move, each resize handle, a multi-select drag, a paste, a text edit — at the input layer of the real view, so that whichever signal Obsidian fires is a measurement (D18). **WP76 does not re-derive, pre-empt or duplicate that.** WP76 needs *one* capture-traversing gesture sufficient to carry the matrix's six cases; C53 needs the *full interaction inventory* for the trigger ledger. If the implementor finds themselves enumerating interactions, they have crossed into WP53 and that is an ESCALATE.
  - **C51's stale-view state.** Entering, observing and leaving a deliberately-stale view is **WP51**. See the ordering note below: C51 AC2 (*"a control command causes the instance to perform an Obsidian save of the scratch canvas while in that state, with the rig never writing the file itself"*) **composes** the gesture WP76 defines; it does not define a second one.
  - **C50's oracle semantics.** The per-case verdict rules, the file-level oracle's wiring into `assert_converged`, `_compare`'s id-less-record divergence (S2), the exception-vs-inconclusive classification (S5) are WP50's. WP76 adds *what the case records about which path it drove*; it does not redesign what decides pass or fail.
  - **Provisioning `useCanvasBinding`.** Which capture path is live in the two vaults is a settings question and settings provisioning is **WP70's**. WP76 must be correct for **either** value and must never assume one. Its artefacts state which value the code path requires, never which value the vaults hold.
  - **`server/**`.** Untouched. §7 makes a `server/` edit outside WP41 an abort criterion.
  - **`plugin/src/main.ts`.** The identity resolvers in this module already reach `plugin.app` through a loose type and a guarded accessor (`safeCall`, `resolveVaultPath` `:785-793`), which is the pattern that let WP46 land without touching the wiring layer. The workspace is reachable the same way. **If the implementor concludes a `main.ts` change is unavoidable, that is an ESCALATE, not a judgement call** — `main.ts` is the untested 1689-line wiring layer CONCEPT_V2 W10 names as a structural weakness, and a change there is a different WP's blast radius.
- **Known interfaces / dependencies:**
  - Input: the plugin's existing workspace wiring (`syncCanvasPresences` → `mountCanvasPresence`, and `attachCanvasWriter`), its existing capture entry points, and the four binding counters the control server already exposes
  - Output: a canvas the instance itself has opened; a gesture that reached the CRDT the way a user's edit does, reporting which path carried it; a matrix case that names the path it drove
  - Depends on work packages:
    - **WP50**, which owns the driver file and restructures `run_matrix`. Landing Part B underneath it would have to be re-derived. **Same relation WP75 has: WP76 depends on WP50, WP76 does not block WP50.**
    - **WP74**, which owns `_open`, `_wait`, `_wait_both` and `_converge_and_check`. WP76 adds call sites *around* those seams and does not modify them.
    - **WP75**, whose AC1 establishes the discipline this WP's new gesture inherits verbatim — a gesture reports *whether the edit happened*, not *whether the command was accepted* — and which lands in the same two files. A WP76 gesture returning a literal would re-create, in a new command, the exact defect WP75 removes from the old one.
  - **WP7 depends on this WP.** See §5 and the §9 dependency amendment.
  - **WP51 depends on this WP** under the ordering ruling below. **This is a consequence for the Dispatcher to action, not something this charter enacts:** `TaskCharter_WP51` is `planned` and its own §9 row does not carry WP76. Recorded rather than back-dated (rule 5).

### Ordering ruling — who *defines* the capture-path gesture

**One WP defines, the others read (rule 10).** The capability "cause the instance to put a local edit through its own capture path" is currently implied by **two** charters and defined by neither:

- **C51 AC2** requires a command that makes the instance perform an Obsidian save while stale, *"with the rig never writing the file itself"* — but C51's declared change type is `canvas.setFlag` **and its runtime-flag map, nothing else**, so no C51 criterion reaches a new command family.
- **C53** requires a whole *inventory* of input-layer gestures, in **PHASE P5**, which `DISPATCHER_STATE.md` records as gated on the real-Obsidian gate — i.e. it runs *after* the thing WP76 exists to make valid.

**Ruling: WP76 defines the primitive; C51 composes it.** Three reasons. (1) The WP76 gesture is *unconditional* — no stale state, no signal inventory — so it is the more primitive of the three and the primitive belongs to the WP that needs it first. (2) WP76 blocks the gate run and C53 is downstream of it; a definition that lives downstream of its own consumer is not a definition. (3) This is the exact shape C69 was split out for: a step named in prose ("WP50/WP51 will install the bundle") that no acceptance criterion ever reached. **C51's scope is not being widened or narrowed here** — its AC2 stays exactly as written and is satisfied by issuing WP76's command inside the stale state. If the Dispatcher rules the other way, the consequence is that WP51 must land before WP7 *and* before WP76, which reverses two existing dependency rows; that is why it is flagged rather than assumed.

---

## 3. Architecture Context

*Task-local architecture guidance only.*

- **Component(s) being changed:** the E2E control surface's gesture and open commands, and the matrix driver's per-case path record
- **Interfaces involved:**
  - Input: the instance's own workspace-open wiring; the instance's own capture entry points; the four binding counters
  - Output: a positively-reported open, a capture-traversing gesture that names its path, a per-case path record, and two corrected docstrings

### Why this outranks every other finding of this gate effort — stated plainly, because it is the charter's justification

The defect this whole initiative exists to close is **the capture path**. CONCEPT_V2 Teil 1, Symptom 2 (*"beim Nachladen von offscreen zerhackt erst eine Version, dann die andere"*) names it in one line: **`der Capture-Kanal diffiert gegen die falsche Basis`** — capture diffs against `lastWrittenContent`, i.e. against **disk**, and disk can be arbitrarily ahead of an open, stale view. W1 grades it **kritisch** and calls it *"die Wurzel des Kaskaden-Symptoms"*. **I6 INTENT IST SHADOW-RELATIV** is the invariant written to close it; the atomic composite registers (I8/W2), the refusal-never-deletes rule (I7/W3) and the intent diff are the rest of P0 and P1.

The mechanism is a **five-step composition**, and CONCEPT_V2 states each step:

```text
1  a peer's delta lands; CanvasPersistence writes it to A's disk
   → noteExternalDiskWrite → lastWrittenContent now holds B's change
2  A's OPEN VIEW fails to reconcile (isBusy defer, "interacting" skip, degraded
   private API, lazy-load timing) → the live view does NOT hold B's change
3  Obsidian fires requestSave on A — outside the mute window
4  handleLocalModify diffs Obsidian's stale full model against lastWrittenContent
   → reads the difference as an intentional local revert
5  the revert reaches B; B's view is reset; B's Obsidian saves; 3–5 run backwards
```

`buildPluginHost.simulateEdit` (`plugin/src/testing/e2e-control.ts:978-1024`) enters at **none** of those steps. It calls `doc.transact(() => { … upsertRecord(nodesMap, …) … })` at `:996-1005` and writes **directly into the shared `Y.Doc`** — the *output* side of step 4, which is the remote-apply shape, not capture. It never reaches `captureLocal` and never reaches `handleLocalModify`.

**Therefore the run matrix measures `doc → relay → doc` convergence and nothing else.** It does not establish that a user gesture reaches the doc, nor that a remote delta reaches the view or the file. A gate built on it goes green while proving only that **Yjs converges** — which was never in doubt, and which WP23's fuzzer already established far more thoroughly than six matrix cases could. **The gate would validate the transport and say nothing about the fix.** That is why this is a work package and not a note.

### Verified against the current tree (rule 12), 2026-08-04 — given, do not re-derive

**Verification 1 — the escalation is correct, in every particular.**
`simulateEdit` writes into the doc at `:996-1005`; its single return is the literal at `:1023`. The driver's `edit` tool docstring (`liveshare_e2e_mcp_server.py:261`) reads *"Inject a canvas edit on ONE instance through its **real capture path**."* `_binding` (`:140-141`) has exactly **one** call site — the `binding_stats` tool at `:295` — and neither `run_matrix` (`:489-548`) nor `_run_case` (`:362-486`) calls it.

**Verification 2 — no other control command exercises capture either, and the search was exhaustive.**
`routeCommand` (`:381-526`) handles exactly eleven commands: `session.info`, `canvas.open`, `canvas.state`, `canvas.binding`, `canvas.simulateEdit`, `canvas.setFlag`, `canvas.clearFlags`, `sync.waitQuiescent`, `scratch.create`, `scratch.remove`, `canvas.file`. Reading each against the tree:

| command | what it actually does | reaches capture? |
|---|---|---|
| `canvas.open` | `canvasSync.subscribe(path, role)` + `observeCanvas` (`:960-967`) | **no** — a doc subscription, not a workspace open |
| `canvas.state` / `canvas.file` / `canvas.binding` / `session.info` | reads | no |
| `canvas.simulateEdit` | direct `Y.Doc` transaction | **no** — this is the finding |
| `canvas.setFlag` / `canvas.clearFlags` | in-memory settings/flags | no |
| `sync.waitQuiescent` | poll on `lastActivity` | no |
| `scratch.create` | `adapter.write`, **only when the file does not exist** (`:1043`) | **no** — a create fires the vault `create` event, and the `modify` handler is the capture trigger; it explicitly refuses to overwrite, so it can never produce a `modify` |
| `scratch.remove` | `adapter.remove` | no |

The driver uses a strict subset of even that: `session.info`, `canvas.open`, `canvas.state`, `canvas.simulateEdit`, `sync.waitQuiescent`, and `canvas.binding` only from `binding_stats`. **`canvas.file`, `scratch.create`, `scratch.remove`, `canvas.setFlag` and `canvas.clearFlags` have no call site in the driver at all.**

**Verification 3 — S8, NEW and severe: there are TWO capture paths, and the DEFAULT one is not the one the escalation names.**
`useCanvasBinding` defaults to **`false`** (`plugin/src/types.ts:65`; declared `:36`). With the flag **off**, `captureLocal` is never called at all, because `CanvasBinding` is never constructed — its only construction site in `plugin/src` is `main.ts:1453`, inside `mountCanvasPresence`, guarded by `if (this.settings.useCanvasBinding)` at `:1436`. The live capture path with the flag off is the **legacy file→CRDT path**: `vault.on("modify")` (`files/vault-events.ts:230`) → `canvasOwned` → `!plugin.settings.useCanvasBinding` (`:250`) → `canvasSync.handleLocalModify(file.path)` (`:252`).

**And that is the path CONCEPT_V2's central repair lives in.** `handleLocalModify` (`files/canvas-sync.ts:2736`) is where the three-way read of `lastWrittenContent` was removed and the parsed save is *"CAPTURE-ROUNDED (§4.4) and then classified against the Surface-Shadow"* (`:2792-2801`). **So "the real capture path" is not one thing, and a charter that names only `captureLocal` would charter a repair for the path that is switched off by default.** Consequences the implementor must carry:

- **flag OFF** → capture is file→CRDT. Driving it requires the **instance itself** to write or save the canvas file — the rig writing the file is not a gesture, it is the rig impersonating the plugin. `handleLocalModify` additionally requires: the path subscribed (`:2739`), `canWrite` (`:2742`), a resolvable doc (`:2745-2748`), no schema-major mismatch (`:2761`), and content **different from `lastWrittenContent`** (`:2780`, the byte echo breaker).
- **flag ON** → capture is model→CRDT via `captureLocal`, which exists only while a `CanvasBinding` is constructed, i.e. **only while a canvas view is mounted**.

**Verification 4 — S9, NEW: the apply direction is equally absent, and it has the same single root.**
`attachCanvasWriter` — which constructs the CRDT→disk writer `CanvasPersistence` — is called from exactly **two** sites, both in `main.ts`: `:874` (session start, over the manifest entries that existed *then*) and `:1035` (`syncCanvasPresences`, when a canvas **leaf** is detected). **`canvas.open` reaches neither.** A scratch canvas created during a run and opened only through the control channel therefore has **no disk writer attached at all**, so:

- **`doc → file` never runs for it.** C50 AC1 requires the driver to *"assert on the C49 file-level oracle in addition to the doc oracle"*, and D17 exists because *"only the file is the durable one `CanvasPersistence` produces."* Against a canvas with no writer, both instances answer `canvas.file` with `{exists:false, sha256:"", size:0, content:null}` — and `sameFileObservation` (`e2e-control.ts:219-226`) compares those four fields and returns **true**. **The D17 oracle would report `fileConverged: true` over two files that do not exist.** This is the same class the run has now found nine times, and it is the **first instance caught before it landed**: C50 AC1 is chartered and unimplemented, so this is a warning to WP50 rather than a defect in it.
- **`doc → view` never runs for it either**, because `mountCanvasPresence` is only reached from `syncCanvasPresences`, and no control command opens a workspace leaf.

**The root is a single missing primitive.** It is not "a capture command" and it is not "a file oracle": it is **"open the canvas in the instance's own workspace."** With a real leaf open, the plugin's own wiring does the rest — `syncCanvasPresences` attaches the writer (so `doc → file` runs and D17 becomes measurable), mounts the presence, and constructs the `CanvasBinding` when the flag is on (so `applyRemote` reaches the view and the counters can move). **That is why AC1 below is the workspace open and not the gesture: the gesture is the second thing this WP needs, not the first.**

**Verification 5 — S11, NEW: the counters cannot be the path witness on their own.**
`bindingInstrument` is invoked at exactly four sites, all inside `CanvasBinding` (`canvas/canvas-binding.ts:216`, `:266`, `:307`, `:308`). The instrument is installed once, in `maybeStartE2EControlServer` (`e2e-control.ts:1264-1268`). So:

- with `useCanvasBinding` **off**, or with **no canvas leaf open**, all four counters are **permanently zero**, whatever capture ran;
- `bindingCounters(_path)` (`:974-976`) **ignores its path argument** and returns the module-global object, and the SSE binding events carry `path: ""` (`:1267`) — already recorded against **WP52**;
- therefore an all-zero reading is consistent with *"no path ran"* **and** with *"the legacy file path ran"*, and a matrix that treats "counters moved" as the path evidence is a check that, under the default settings, can only ever be red — which is the mirror image of the `__LS_E2E__` count that could only ever be green.

**A witness that cannot distinguish its two outcomes is not evidence.** AC4 below is written around this, and it is the single most likely place for this WP to be implemented wrongly.

**Verification 6 — S10, minor, recorded not repaired.** `maybeStartE2EControlServer` builds the host with `bump: () => {}` (`:1270`), so `hooks.bump` has **no reader in the production wiring**, while `buildPluginHost`'s own docstring (`:883-885`) says `emit` and `bump` *"feed the SSE channel + quiescence tracking"*. Quiescence in fact reads `lastActivity`, which `markActivity` still updates, so this is **not** a false green — it is a field with no reader plus a docstring claim that outlived its truth. **Owner: none assigned.**

- **Constraints from BUILD_SPEC (invariants — what must not change):**
  - **`canvas.simulateEdit` is not removed, re-pointed, deprecated or behaviourally changed.** Both gestures exist after this WP and the matrix says which it used per case.
  - **The rig never writes or saves the canvas file on the instance's behalf.** A capture gesture that consists of the rig writing the file measures the rig, not the plugin — the same requirement C51 AC2 already states in as many words.
  - **An absent or empty value is the unsafe reading.** An open that cannot confirm a leaf is **not open**; a gesture that cannot confirm capture ran is **not captured**; a case that cannot name the path it drove has **not named it**, and is `inconclusive`.
  - **`inconclusive` is never a pass**, in `allPass` or anywhere else.
  - **I11 REFUSAL NEVER DESTROYS.** Every refusal path added here — a canvas that will not open, a gesture that cannot traverse capture — deletes, truncates and mutates nothing, and no rollback is implemented as a delete.
  - **I7 BEOBACHTUNG LÖSCHT NIE.** A partial or failed capture produces upserts or nothing; it never removes a record because a field was not observed.
  - **C73's machinery is untouched** (`_was_applied`, `gesture()`, `GestureNotApplied`), **WP73 is not re-opened**, and **WP74's seams are not modified.**
  - **Zero new runtime dependencies** in either repo. The driver is standard-library only (`json`, `urllib`) and stays that way; the plugin adds no package and the control surface's transport stays the Node built-in `http`.
  - **Zero production footprint.** Everything added lives under `plugin/src/testing/` and must still tree-shake out of the production bundle — the property C7 AC4 and C69 AC2 both assert. **A new optional member on `E2EPluginLike` is not a production change; a new call from `main.ts` is.**
  - **Ports are imported, never spelled.** `REAL_CONTROL_PORT_A` / `REAL_CONTROL_PORT_B` in `tools/obsidian_e2e/constants.py` are the real control endpoints; `HEADLESS_RIG_PORT_A` / `HEADLESS_RIG_PORT_B` in the same file are the **mock** rig's and are deliberately disjoint per D13. **No port literal appears anywhere in this WP's work**, including in a comment or a fake-endpoint harness.
  - **Data safety (D16, §7 data-safety gate).** No pre-existing note, canvas or attachment in either owner vault is opened for writing. Anything the new open command opens is the run's own scratch artefact, confined by `isScratchPath` (`:99-113`) exactly as WP47's commands are. `data.json` is compared by sha256 of bytes only and no value read from it appears in any artefact.
  - **No secret through an agent tool**, in any command string, script argument or control-protocol message.
- **Technology / framework / config constraints:**
  - Part A is TypeScript under the `plugin/` vitest gate. Part B is an MCP server (`FastMCP`) verified by a standalone `python tools/test_<name>.py` script beside the file it verifies, launched through `visible-console` `run_python` with an **absolute** script path (the `run_command` nested-quote trap).
  - The gate run is **agent-mediated** (WP71 / C71): `lifecycle.py`'s only console backend is `PlanOnlyConsole` and nothing under `tools/obsidian_e2e/` spawns a process. The driver may not assume the endpoint it holds was brought up, opened, subscribed, built or *made to hold an open canvas view* by the process calling it — **which is precisely why AC1 is a command and not an operator instruction.**
  - **Schema impact:** none. No doc format and no `.canvas` file-format change.
- **Entry points / relevant files:**
  - `plugin/src/testing/e2e-control.ts` — `routeCommand` (`:381-526`); the `E2EControlHost` / `E2EFileControlHost` declarations (`:265-342`); `buildPluginHost` (`:886-1195`), specifically `canvasOpen` (`:960-967`), `simulateEdit` (`:978-1024`, **read-only context — not modified**) and `bindingCounters` (`:974-976`); the `E2EPluginLike` shape (`:693-737`) and the guarded-accessor pattern at `:770-815`
  - `tools/MCPserver/liveshare_e2e_mcp_server.py` — the module docstring (`:11-19`); `edit` (`:259-281`); `_binding` (`:140-141`) and `binding_stats` (`:284-297`); `_run_case` (`:362-486`) and `run_matrix` (`:489-548`), **as restructured by WP74 and WP50**
  - Read-only context, none of it modified by this WP: `plugin/src/main.ts` `syncCanvasPresences` (`:1015-1060`), `mountCanvasPresence` (`:1410-1479`) and `attachCanvasWriter` (`:1365`, call sites `:874` and `:1035`); `plugin/src/files/vault-events.ts` `:230-255`; `plugin/src/files/canvas-sync.ts` `handleLocalModify` (`:2736`); `plugin/src/canvas/canvas-binding.ts` `:216`/`:266`/`:307`/`:308`; `plugin/src/types.ts:65`
- **⚠ Cross-repo — do not re-derive, and do not "fix" the paths by guessing.** `tools/MCPserver/liveshare_e2e_mcp_server.py` **does not exist in the `obsidian-live-share` repository.** It lives in the **AgenticWorkspace** repo at `h:\My Code\AgenticWorkspace\tools\MCPserver\liveshare_e2e_mcp_server.py`, on branch **`toms_branch`** (**not** that repo's default branch). WP73 set the precedent and executed it (`50b0cf4`), and WP75 is the first WP whose own two halves cross the boundary; **WP76 is the second.** §7's commit and abort accounting assumes a single repository, so **both commit hashes are required in the implementation report; a report carrying one has recorded half the work package.**
- **⚠ Rule-10 file overlap, declared rather than discovered.** `plugin/src/testing/e2e-control.ts` is **WP51's sole required changed file** and is Part A of **WP75**. Three WPs now touch it. They touch different regions — WP51 the `canvas.setFlag` surface, WP75 `simulateEdit`'s return contract, WP76 the command table and `buildPluginHost`'s open/gesture members — and **if any two share a batch the batch's shared-ownership contract must name who writes which block**, exactly as the WP69/WP70 `constants.py` overlap was handled. Two agents independently editing one file has cost this run a batch before.
- **Structure references:** *(intentionally empty — no Graphify graph exists for this project; FALLBACK mode is declared in the BUILD_SPEC section 3. Worker 3 fills this in after implementation. Do not invent paths here.)*

If structure references conflict with the BUILD_SPEC or explicit task scope, the BUILD_SPEC and TaskCharter win. Escalate instead of following the map.

---

## 4. Acceptance Criteria

*Exact copy from BUILD_SPEC section 5, PHASE T3, component C76. No paraphrasing.*

1. **The canvas is opened in the instance's own workspace, and what that produced is reported positively.** A control command causes the named instance to open the run's scratch canvas **in its own Obsidian workspace**, so that the plugin's existing wiring runs rather than the rig's: the presence mount, the `CanvasBinding` construction where `useCanvasBinding` is on, and the attachment of the CRDT→disk writer. The response states positively, per instance, **whether a canvas leaf for that path is open, whether a binding was constructed for it, and whether the disk writer is attached to it**; an absent, unknown or unanswerable value is **no**, never an assumed yes. `canvas.open` keeps its present behaviour and its present name unchanged, and is documented for what it is — **a doc subscription that opens nothing in the workspace**. The path this command accepts is confined exactly as the scratch commands are, so no pre-existing note or canvas can be reached through it. **This criterion exists because `attachCanvasWriter` is reachable only from the two `main.ts` wiring sites — session start over the then-existing manifest entries, and a detected canvas leaf — so a canvas the rig subscribed and never opened has no disk writer at all, and the file-level oracle C50 AC1 requires would then compare two absent files, find all four of their fields equal, and report converged.**
2. **A gesture reaches the CRDT through the instance's own capture path, the rig never writes the file itself, and the gesture reports which path carried it.** A second control command causes the instance to make a local canvas change **through the path a user's change takes**, and returns whether **capture actually ran** — not whether the command was accepted, which is the distinction C75 AC1 draws for `simulateEdit` and which applies verbatim to any gesture added here. **The rig never writes or saves the canvas file on the instance's behalf**; a "gesture" that is the rig writing the file measures the rig. **There are two capture paths and the command names which one it drove:** with `useCanvasBinding` off — **the default** — capture is the file→CRDT path, `vault.on("modify")` → `handleLocalModify`, which is where the surface-shadow diff that closed the reported corruption cascade actually lives; with it on, capture is the model→CRDT `captureLocal`, which exists only while a `CanvasBinding` is constructed and therefore only while a view is mounted. The command is correct for **either** setting, states which path it drove, and **refuses under a named reason rather than silently driving neither**. The preconditions the file path imposes are respected rather than worked around: the path subscribed, writable, schema-compatible, and content that differs from what the writer last wrote — the byte echo breaker is not a defect to be defeated.
3. **`canvas.simulateEdit` is retained unchanged, and every artefact names it for what it is.** It is the **doc-injection** gesture — a direct `Y.Doc` transaction, the remote-apply side of the binding — and it is **not removed, re-pointed, deprecated or behaviourally altered** by this WP: the convergence cases need a doc-side origin, `bidirectional-drag` needs instance `b` to originate a delta, and WP73 routed eleven gesture sites through it. The driver's `edit` tool docstring, which today claims the tool injects *"through its real capture path"*, is **corrected in this WP** — it is one line, it is a false claim about what the tool does, and it is the specific thing that would let a careful reader believe the gate covers capture. The module docstring lists the two gestures as **distinct** entries with distinct meanings. **Rule 6 applies to code comments: a claim that outlived its truth misleads exactly the reader who is trying to be careful.**
4. **Each matrix case records which gesture kind it used and which path was exercised, from positive evidence, and a case that cannot name it is not a pass.** Every case records, per role, the gesture kind it issued and the path the instance reported carrying it, together with the **delta of the four binding counters across the case**, read through the existing `canvas.binding` command before and after the case's gestures. **The counters alone are not a sufficient witness and an implementation that treats them as one is wrong:** they are incremented only inside `CanvasBinding`, whose sole construction site is gated on `useCanvasBinding` **and** on a mounted view, and they are module-global and path-blind — so an all-zero delta is equally consistent with "no path ran" and with "the file capture path ran", and a check written as "counters moved" can only ever be red under the default settings. The case's recorded path therefore comes from the **gesture's own report**, corroborated by the counter delta wherever the binding path is live, and **a case whose path is unknown, or contradicts the gesture kind it issued, is `inconclusive`** — carrying `allPass: false`, naming the reason, never a pass. **A case that cannot say which path it drove is not evidence; that is the same "field with no reader" class this run has now found nine times.**
5. **Each repair is falsified separately, by injecting exactly its own condition, and the plugin-side repairs are falsified against the REAL host builder rather than a fake.** Injections, one at a time with the rest unchanged, each recorded as **not a pass** under the repaired code and shown to produce the pre-repair outcome against a byte copy of the pre-repair code under an identical harness: **(i)** an instance on which the canvas cannot be opened in the workspace, which must report the open as **not** open and must not be reported as a case that passed; **(ii)** a capture gesture whose capture did not run, which must carry its case to `inconclusive` and must **not** be recordable as applied; **(iii)** a case whose counter delta contradicts the path its gesture reported, which must be `inconclusive`; **(iv)** a run in which the doc converges while the two `.canvas` files do not, which must **not** be reported as a converged file state — the D17 shape, which today would be reported converged over two files that do not exist. Injections (i) and (ii) go through `buildPluginHost` against a real `Y.Doc`, **not** a hand-rolled fake host, for the same reason C75 AC5 requires it: a fake host can be made to answer anything, and demonstrating that a fake answers correctly demonstrates nothing about the build the gate will run. Injections are targeted, never global (rule 2), and the report states whether neighbouring cases stayed green. **A perturbation that changes nothing is a finding, not a null result.**

**Definition of Done:** the gate exercises the path the initiative exists to fix, in both directions, and no case can report a verdict without naming the path it drove.

---

## 5. Constraints and Known Risks

- **Permission / environment limits:** Windows dev host. Part A runs under the `plugin/` vitest gate (run all plugin commands from `plugin/`, never the repo root; Vitest 4.0.18, the `basic` reporter was removed; budget >= 90 s for any automated `npm test` — a 33.5 s legacy sleeper makes ~41 s the floor, not a hang). Part B has **no vitest coverage and must not pretend to** — its units are verified by a standalone `python tools/test_<name>.py` script per the workspace convention, in the **AgenticWorkspace** repo beside the file it verifies, launched through `visible-console` `run_python` with an **absolute** script path. No Graphify graph exists for this project (declared FALLBACK mode).

- **Dependency ruling — WP76 blocks WP7; it does NOT block WP50; and it is NOT ordered against WP75.** The argument, in the same terms the WP75 ruling used, because the Dispatcher asked for the argument rather than the answer:
  - **It blocks WP7 absolutely.** WP7 is the run. A green WP7 without WP76 would be a true statement about `doc → relay → doc` convergence presented as a statement about the capture path — and the driver's own docstring already asserts the latter. The artefact would be **indistinguishable from a real green** to any reader who trusted the tool's description of itself.
  - **It does not block WP50, for exactly the reason WP75 did not.** WP50 is the *detector* charter and is verified against **fake** endpoints; the BUILD_SPEC already records that WP50 depends on neither WP69 nor WP70 nor WP71–WP73, *"WP7 is again where every one of these dependencies is real."* Every WP50 criterion stays decidable against injectable seams. **The relation is WP76 → depends on → WP50**, because Part B lands in WP50's own file. **But C50 AC1's file-level oracle becomes meaningful only once WP76 lands** — the same "becomes meaningful when" form C75 used for C73 AC1, and for the same reason: against a canvas with no disk writer attached, the oracle compares two absent files and reports them converged. That is a cross-reference and a warning to WP50's implementor, **not** a re-opening and **not** a claim that C50 is wrong.
  - **⚠ It is NOT more fundamental than WP75, and the Dispatcher's framing is the one thing in the escalation I do not adopt.** The proposed ordering was *"a gate that runs the wrong path cannot be rescued by making its signals honest"* — true, and the converse is equally true: a gate that runs the **right** path while unable to tell two vaults from one, over a build nobody identified, with a constant `applied`, is **also** unrescuable. The two are **orthogonal failures of the same run, not a ranking**: WP75 makes the run's *signals* true; WP76 makes the run's *subject* the right one. Neither substitutes for the other and each is independently sufficient to void WP7. The one asymmetry worth recording is about the **artefact**, and it cuts the other way: a WP76-less gate that has had AC3's docstring corrected is *honestly labelled* — it says it measures transport, and it does — whereas a WP75-less gate lies about whether it ran at all. **Sequencing follows from the files, not from the ranking:** WP76 lands after WP75 because both edit `simulateEdit`'s module and `run_matrix`, because WP76's new gesture inherits WP75 AC1's "report whether it happened" discipline verbatim, and because a WP76 gesture returning a literal would re-create in a new command the exact defect WP75 removes from the old one.
  - **WP51 depends on WP76** under the §2 ordering ruling — C51 AC2 composes the gesture WP76 defines. **Recorded, not enacted:** `TaskCharter_WP51` is `planned` and its §9 row does not carry WP76, and back-dating it is exactly what rule 5 forbids. **This is a Dispatcher decision, and if it is ruled the other way two existing dependency rows reverse.**
  - **Not decided here, deliberately:** whether WP52 should also wait, and whether any part of C53 should be pulled forward. Neither is claimed and inventing either would be the widening this run has charged six WPs with avoiding.

- **Known risks specific to this WP:**
  - **⚠ The most likely wrong implementation is "consume the binding counters and call that the path evidence".** They are incremented only inside `CanvasBinding`; the only construction site is gated on `useCanvasBinding` **and** on a mounted canvas view; and `bindingCounters` ignores its `path` argument entirely. Under the **default** settings they are permanently zero however much capture ran. **An all-zero delta does not distinguish "nothing ran" from "the file path ran", and a witness that cannot distinguish its two outcomes is not a witness.** AC4 is written around this; an implementation that reduces to "counters moved ⇒ the path ran" is wrong in the same way the `__LS_E2E__` count was, with the sign flipped.
  - **⚠ The second most likely wrong implementation is the rig writing the canvas file and calling it a capture gesture.** It would work — `vault.on("modify")` would fire and `handleLocalModify` would run — and it would measure the rig's ability to write a file. C51 AC2 already states the rule in as many words: *the rig never writes the file itself.* If the only way the implementor can see to trigger capture is to write the file from the driver, that is an **ESCALATE**.
  - **⚠ Do not enumerate interactions.** C53 owns the input-layer gesture inventory for the trigger table, in P5. WP76 needs **one** capture-traversing gesture, sufficient for the matrix's six cases. An implementor who begins listing resize handles, pastes and multi-selects has crossed into WP53.
  - **⚠ Do not touch `main.ts`.** The workspace is reachable through the loose `app` shape and the guarded-accessor pattern this module already uses for `getBasePath` (`:785-793`). A `main.ts` wiring change is a different blast radius — the untested 1689-line layer CONCEPT_V2 W10 names — and is an **ESCALATE**.
  - **⚠ Do not assume a value for `useCanvasBinding`.** It defaults to `false`. **What the two owner vaults hold has NOT been read and is UNVERIFIED**; `data.json` is compared by hash only, and settings provisioning is WP70's. Every artefact of this WP states which value a code path requires, never which value the vaults have.
  - **⚠ `canvas.open`'s name is itself part of the finding, and renaming it is not the fix.** It subscribes a doc; it opens nothing. The driver's `open_canvas` docstring says *"Open (and subscribe to) a canvas on both connected instances"*, which is the same false-claim class as the `edit` docstring one command over. **The command's behaviour and name are unchanged** — changing either would break every existing caller and every case — and the correction is documentary, alongside AC3's.
  - **⚠ I11 and I7 both bind here.** A refusal to open, or a capture that did not run, must delete and mutate nothing, and a partial capture produces upserts or nothing — never a removal because a field was not observed.
  - **⚠ Both halves land in different repositories and are one work package.** The report carries **both** commit hashes.
  - **Nothing has been executed.** **No control endpoint has ever answered on this host**, no gate has run, no canvas view has ever been opened by a rig, and **it is not established that the two vaults will report distinct identity** — that is WP75 AC4's precondition and it is explicitly unverified. Every criterion here is decided against `buildPluginHost` over a real `Y.Doc` in a headless test, never against a live Obsidian instance. **No statement about a live instance, a real Obsidian run, or a gate result may be made anywhere in this WP's artefacts.**
  - **S3 remains binding on this WP's artefacts.** The settle asks instance `a`, then `b`, so **no artefact of WP76 may claim simultaneity, "the system was quiet", or "both peers were settled at the same moment"**. The defensible claim is *"each instance reported quiescent when asked, in sequence."*

### Recorded, not repaired — this WP's own sweep

*None of the following is in WP76's scope. Each is recorded so it is not rediscovered as a finding, with its owner named where one exists. S2–S5 and S7 are carried in C74's and C75's registers and are not restated here.*

- **S8 — there are two capture paths and the default one is the file path.** `useCanvasBinding` defaults to `false` (`plugin/src/types.ts:65`), so `CanvasBinding` — and therefore `captureLocal` — is never constructed unless the flag is on **and** a view is mounted (`main.ts:1436`, `:1453`). The live default path is `vault.on("modify")` → `handleLocalModify` (`vault-events.ts:230-255`, `canvas-sync.ts:2736`), which is where CONCEPT_V2's surface-shadow diff actually lives. **Not a defect — a fact that changes the shape of the repair, which is why it is an input to AC2 rather than a register entry.** Recorded here because the escalation named only `captureLocal` and a WP scoped to that alone would have repaired the switched-off path.
- **S9 — `canvas.open` attaches no disk writer, so the D17 file oracle would compare two absent files and report converged.** `attachCanvasWriter` has exactly two call sites, both in `main.ts` (`:874`, `:1035`), and neither is reachable from the control protocol. `sameFileObservation` (`e2e-control.ts:219-226`) returns `true` for two `{exists:false, sha256:"", size:0, content:null}` observations. **Tenth instance of the "green that cannot fail" class in this run and the FIRST caught before it landed** — C50 AC1 is chartered and unimplemented. **Owner: closed by C76 AC1; the warning belongs to WP50's implementor.**
- **S10 — `hooks.bump` has no reader in the production wiring.** `maybeStartE2EControlServer` passes `bump: () => {}` (`:1270`) while `buildPluginHost`'s docstring (`:883-885`) says `emit` and `bump` *"feed the SSE channel + quiescence tracking"*. Quiescence reads `lastActivity`, which is still updated, so this is **not** a false green — it is a dead parameter plus a stale docstring (rule 6). **Owner: none assigned.**
- **S11 — the counters are module-global, path-blind and structurally zero without a mounted binding.** `bindingCounters(_path)` (`:974-976`) discards its argument; the SSE binding events carry `path: ""` (`:1267`). The path-scoping half is **WP52's** (C52 AC2). The *structurally zero* half is new and is an input to C76 AC4, not a defect to repair.
- **The driver never calls five of the eleven control commands.** `canvas.file`, `scratch.create`, `scratch.remove`, `canvas.setFlag` and `canvas.clearFlags` have no call site in `liveshare_e2e_mcp_server.py`. Four of those are chartered consumers elsewhere (C50 AC1 for the file oracle, C70/C47 for scratch lifecycle, C51 for the flags), so this is an **inventory note, not a finding** — recorded so a later reader does not mistake the absence for an oversight and so that any *new* unconsumed command is visibly a regression.

- **Known flaky patterns:**
  - No wall-clock sleeps. Every wait is bounded and names the condition it was waiting for on expiry.
  - Do not assert on log strings as the primary oracle; state is the oracle.
  - Biome reports a whole-file `format` finding per touched file (CRLF environment artefact). Advisory locally, gating in CI — do not mass-reformat.
  - A real Obsidian run is slow and stateful. Retrying a flaky step without a teardown in between compounds state.
- **External dependency risks:** No new runtime dependency is permitted in either repo; the driver is standard-library only and must stay so, and the plugin adds no package and keeps the Node built-in `http` transport. If one looks unavoidable, that is an ESCALATE, not a judgement call.
- **Hard constraints:**
  - **`canvas.simulateEdit` is not removed, re-pointed, deprecated or behaviourally changed**, and `canvas.open` keeps its behaviour and its name.
  - **The rig never writes or saves the canvas file on the instance's behalf.**
  - **An absent or empty value is the unsafe reading:** an unconfirmed open is not open, an unconfirmed capture did not capture, an unnamed path is not evidence.
  - **`inconclusive` is never counted as a pass.**
  - **I11 REFUSAL NEVER DESTROYS** and **I7 BEOBACHTUNG LÖSCHT NIE** govern every refusal and every partial capture added here.
  - **C73's machinery is not modified**, **WP73 is not re-opened**, and **WP74's seams are not modified.**
  - **Zero production footprint:** everything added stays under `plugin/src/testing/` and still tree-shakes out; **no `main.ts` change** (ESCALATE if it appears unavoidable); **no `server/**` change.**
  - **No port literal anywhere.** Import `REAL_CONTROL_PORT_A` / `REAL_CONTROL_PORT_B`; the headless pair in the same module is the mock rig's and is not this WP's.
  - **Data safety (D16, §7 data-safety gate).** No pre-existing note, canvas or attachment in either owner vault is opened for writing; the new open command's path is confined exactly as the scratch commands' are.
  - No existing test is deleted, weakened, retitled, skipped or amended. **WP76 holds no §7 licence of any class**; an unenumerated deletion or assertion rewrite is an abort criterion.
  - **No secret through an agent tool**, in any command string, script argument or control-protocol message.

---

## 6. Definition of Done Artifacts

- **Required changed files:**
  - `plugin/src/testing/e2e-control.ts` — **this repo**, branch `fix-bugs-and-raceconditions` (Part A)
  - `h:\My Code\AgenticWorkspace\tools\MCPserver\liveshare_e2e_mcp_server.py` — **AgenticWorkspace repo, branch `toms_branch`** (Part B; cross-repo, see §3)
- **Required report:** `ImplementationReport_WP76.md` (in `workflowArtifacts/canvas-v2/`), which must additionally record: what the workspace-open command reports and how each of its three positive statements (leaf open, binding constructed, writer attached) is established rather than assumed, including what it answers when it cannot establish one; which capture path the gesture drives under each value of `useCanvasBinding`, how it reports which one it drove, and the explicit statement that **the rig did not write or save the canvas file at any point**; the demonstration that `canvas.simulateEdit`'s behaviour is byte-for-byte unchanged by this WP and that both gestures exist afterwards; the corrected `edit` docstring and module-docstring text quoted from the file rather than from this charter; the exact per-case path record the matrix now emits, with the explicit statement of **why the counter delta alone is not treated as the witness** and what the case does when the counter delta and the gesture's report disagree; the AC5 falsification in full, per injection, naming the pre-repair and post-repair result for each and whether neighbouring cases stayed green, with an **explicit statement that injections (i) and (ii) were driven through `buildPluginHost` against a real `Y.Doc` and not through a fake host**; confirmation that nothing was added outside `plugin/src/testing/` and that `main.ts` was not modified; a statement that **no live Obsidian instance was involved, no canvas view was opened on this host by any run, and no gate result is claimed**; and **both commit hashes**, this repo's and AgenticWorkspace's, since §7's commit and abort accounting assumes one repository.
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
