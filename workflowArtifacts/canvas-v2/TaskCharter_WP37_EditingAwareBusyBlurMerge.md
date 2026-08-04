# Task Charter — WP37: `isBusy` + deferred apply + blur merge

<!-- Updated: re-chartered 2026-08-05 (B16b) from the template-generated skeleton, against the current tree on branch `fix-bugs-and-raceconditions`, per hard-won rule 12. Every line number below was measured by reading the tree. No Obsidian was launched, no vault file was read, no `data.json` was opened, no relay was contacted, no E2E script was run. Two substantive changes: (1) this WP is identified as THE work package that closes the owner's observed "verschluckt Buchstaben" defect — the loss happens in the view, not in the register, so WP36 alone cannot close it; (2) the WP gains ONE E2E control command, because the rig as built cannot type into an inline editor and a criterion with no instrument is not a criterion. -->
**Charter Status:** `SPEC_COMPLETE`
**WP:** WP37
**Phase:** P4
**task_mode:** `standard`
**Depends on:** WP5 (`DONE`), WP36 (`planned`)
**W4 Test Targets:** `0`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** a structural reload can no longer destroy an inline editor the user is typing in. **This is the work package that closes the owner's reported defect** — *"manchmal verschluckt er noch Buchstaben."* The keystrokes are lost in the **view**, before they ever reach a register, so no change to how text is *stored* can close it. WP36 is a prerequisite because it makes the deferred merge non-lossy; WP37 is the fix.
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 5, component **C37** (work package **WP37**); CONCEPT_V2 Teil 6, change 2 (*"`isBusy()` erweitert um Text-Editing"*, `CONCEPT_V2.md:515-524`) and change 3 (the per-field apply receipt); phase **P4**.
- **Accepted degradation, settled, not re-opened:** blur-merge is the honest compromise while no binding into Obsidian's private inline editor exists (CONCEPT_V2 Teil 6 and BUILD_SPEC §2, *"no real-time co-typing inside one card"*). The remote text appears **at blur**, not while typing. That is the design, not a defect to be reported.

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: modify + create, **one repository** (`obsidian-live-share`, branch `fix-bugs-and-raceconditions`), **`plugin/src/` only**.
  - Responsibility: extend the busy predicate with an editing signal; turn today's *drop-the-pass* gate into a **per-record deferral queue** drained at blur; keep the Surface-Shadow honest across a deferral; and provide the instrument that makes the whole thing observable on a live instance.
  - Scope summary: editing-aware busy predicate with its own bounded staleness release · per-record apply queue drained on blur / view close / teardown · **no shadow advance for a deferred record** · one new E2E control command that drives the real inline editor.
- **Out of scope / non-goals — each of these is an ESCALATE, not a judgement call:**
  - **⚠ Logic in `main.ts`.** `reconcileLiveCanvas` is the call site and it lives in `main.ts`, which makes this the WP most likely to violate §3.1 S11. The **decision** — is this record deferred, what is queued, what is drained — belongs in a headless module; `main.ts` may only construct, inject and forward. A conditional over canvas state written inside `main.ts` is a **§7 abort criterion**, not a shortcut. The precedent is `wireCanvasSidecar` (`files/canvas-sidecar-lifecycle.ts:459-487`).
  - **⚠ Changing `planReconcile`'s verdict set.** `ReconcilePlan` stays `"structural" | "geometry" | "noop"` (`canvas/reconcile-plan.ts:25`). Introducing a fourth verdict, or making the classifier itself editing-aware, moves a runtime concern into a pure classifier and re-opens WP5. **The deferral happens at execution, not at classification.**
  - **⚠ Weakening the drag watchdog.** `DRAG_WATCHDOG_MS = 5000` (`canvas-adapter.ts:260`), `dragActive()` (`:318-334`), `isDragTarget` (`:337-`) and the `DRAG WATCHDOG:` signature keep their current behaviour exactly. The editing signal is **added alongside**, never folded into the drag flag.
  - **Binding to Obsidian's private inline editor**, or any attempt at real-time co-typing inside one card. Out of scope for the whole initiative.
  - **The `Y.Text` representation, the capture write, the projection render, the migration.** WP36.
  - **Undo.** WP38.
  - **`useCanvasBinding`, `CanvasBinding`, `captureLocal`, `canvas-binding.ts`, `canvas-model-bridge.ts`.** Frozen until P5; flipping the flag or editing those files is a §7 abort criterion.
  - **`server/**`.** Untouched — a `server/` edit outside WP41 is a §7 abort criterion.
  - **`plugin/src/canvas/canvas-presence.ts`.** Byte-unchanged (WP21 AC2).
  - **`canvas.simulateEdit`.** Not extended, not repaired, not used. It writes straight into the `Y.Doc` (`testing/e2e-control.ts:995-1005`) and returns a hardcoded `applied: true` (`:1023`). The new command in AC6 is a **separate** command and must not inherit either property.
  - **Any new runtime dependency.** D11 — an ESCALATE.
- **Known interfaces / dependencies:**
  - Input: an "inline editor focused" signal and the id of the record being edited, surfaced by `canvas-adapter.ts` (the only module permitted to touch Obsidian's private canvas internals)
  - Output: `isBusy()` widened; a per-record deferral queue; a drain on blur / view close / teardown; one E2E control command
  - Depends on: **WP5** (`DONE`) for the per-field receipt AC4 constrains, **WP36** (`planned`) for the `Y.Text` whose blur merge AC3 measures
  - **Blocks:** nothing. It is the last thing P4 needs for the symptom.
  - **File overlap warning:** `plugin/src/testing/e2e-control.ts` is also touched by the chartered-not-built gate WPs (WP72 landed `setFlag`/`clearFlags` there; WP73/WP75 own the Python-side driver in `tools/obsidian_e2e/`). AC6 is **additive** — a new `case` and a new optional host method, on the precedent of `canvasFile` (`e2e-control.ts:513-518`) and `clearFlags`, both of which are optional on the interface so pre-existing fake hosts stay valid. No existing command's shape or behaviour changes.

### §7 disposition — no `DONE` work package is re-opened, and no §7 licence of any class is taken

1. **C5 is constrained, not re-opened.** AC4 requires that a **deferred** record's shadow fields are not advanced. That is what `buildApplyReceipt` / `advanceFromReceipt` already do — the receipt advances only what the surface **confirmed** (`canvas-shadow.ts:836-857`, `isConfirmed`). WP37 must not add a confirmation for something the surface did not take. If an existing WP5 assertion treats a skipped pass as confirming, that is an **ESCALATE with the measured before/after**, left red — not a rewrite.
2. **No existing test is deleted, weakened, retitled, skipped or amended.** WP37 holds **no §7 licence of any class**.
3. **`main.ts` gains wiring only** — the injection of the deferral module and the forwarding of the blur/close/teardown signals. §3.1 S11 and the §7 abort criterion are absolute.
4. **`canvas-adapter.ts` is the only module permitted to read Obsidian's private canvas internals**, and that is where the editing signal is detected. The **decision** made from that signal is not written there either — the adapter reports; a headless module decides.

---

## 3. Architecture Context

*Task-local architecture guidance only.*

### Verified against the current tree (rule 12), 2026-08-05 — measured, given, do not re-derive

**Verification 1 — the exact chain that swallows the characters.**

| Step | Site |
|---|---|
| A remote delta is integrated and the open view is patched | `main.ts:844-849` → `reconcileLiveCanvas` |
| The classifier has three verdicts, and **any** non-geometry difference is `"structural"` | `canvas/reconcile-plan.ts:25`; `diffRecords` `:112-150`; `planReconcile` `:166-182`. The comment at `main.ts:1219-1224` says it outright: *"a remote text/color/type/fromSide/toSide/label change is 'structural' instead of falling into the geometry-only branch"* |
| `"structural"` is executed as a **full** `adapter.reloadCanvasData(...)` → Obsidian `setData` | `main.ts:1268-1275` |
| The only guard is drag-shaped | `main.ts:1212-1217`: `if (adapter.isBusy()) { … return; }`, logged *"deferred (user dragging)"* |
| `isBusy()` is drag-only, with no editing arm at all | `canvas-adapter.ts:572-580` → `dragActive()` `:318-334` → `isDragging` + `DRAG_WATCHDOG_MS` |

So a peer typing into **any** card, or adding **any** node, produces a full `setData` on this client, which rebuilds the view and discards the live inline editor together with every keystroke Obsidian has not yet flushed. A peer merely **moving** a card is geometry-only and is safe — which is exactly why the symptom is *"manchmal"*.

**Verification 2 — today's gate DROPS the pass; it does not queue it.** `main.ts:1212-1217` returns before `planReconcile` is executed and before any receipt is built. Two consequences, both load-bearing for this charter:

- **The safe half, which must be preserved.** Because no receipt is built, the shadow is **not** advanced, so the next capture still diffs against a base that was genuinely on the surface. That is why today's drag gate does not corrupt capture, and it is the property AC4 makes explicit and permanent rather than incidental.
- **The unsafe half, which is what AC2 fixes.** The delta is simply lost to the view. The in-code comment concedes it — *"the trailing disk write keeps data safe and the next delta (or a manual reload) will catch the view up once idle"* — but "the next delta" may never come. Under a **drag** that is a second or two; under an **inline editor** it is however long the user types, which is exactly the window in which staleness is most visible.

**Verification 3 — what the receipt already guarantees, and the interlock AC4 owns.** `buildApplyReceipt` (`canvas-shadow.ts:795-830`) builds lines from `pass.desired` and per-node `ApplyOutcome`s; `advanceFromReceipt` (`:1048`) advances only lines where `isConfirmed(outcome)` — `"applied"` or `"unchanged"` (`:854-857`). An `"interacting"` outcome already leaves that node's fields **unadvanced**, which is C5's per-field granularity working as designed. **A deferred record must land in the same class.** If a deferred record's fields were advanced, the next `handleLocalModify` would compute WP36's three-way base from a string that never reached the surface, and the resulting diff would delete the user's own characters — the WP36 defect, re-entered through WP37's front door. This is the single most important cross-WP constraint in P4 and it is why WP5 is listed as a dependency here.

**Verification 4 — the instrument does not exist, and this WP owns it.** `routeCommand` (`testing/e2e-control.ts:396-521`) exposes exactly: `session.info`, `canvas.open`, `canvas.state`, `canvas.binding`, `canvas.simulateEdit`, `canvas.setFlag`, `canvas.clearFlags`, `sync.waitQuiescent`, `scratch.create`, `scratch.remove`, `canvas.file`. **None of them types into anything**, and `canvas.simulateEdit` — the only one whose name suggests it might — writes directly into the `Y.Doc` and returns a literal.

Therefore: **AC3 and AC5 cannot be validated by writing the `.canvas` file on disk.** A file write is not an inline editor; it produces no focus, no editing surface and nothing to destroy. The whole subject of this WP is a state the rig has no way to create. Per the owner's instruction — *"Falls das e2e plugin noch bugs hat gerne bei w3 in revision geben"* — the missing command is chartered **here, inside WP37**, as a W3 revision, not as a separate infrastructure WP.

- **Component(s) being changed:** `canvas-adapter.ts` (the editing signal and the widened `isBusy`), a new headless deferral module, `main.ts` (wiring only), `testing/e2e-control.ts` (one additive command).
- **Constraints from BUILD_SPEC (invariants — what must not change):**
  - Invariants I1–I5 and I6–I11 are binding and must not be weakened. **I5 in particular:** degradation is per-surface and honest, never a feature break.
  - Yjs stays. `CanvasPersistence` remains the single CRDT→disk writer and emits zero CRDT writes. **A deferral defers the VIEW apply; it never defers or suppresses the disk write** — the file must stay converged even while the view is deliberately stale, which is what makes the deferral safe.
  - **Zero new runtime dependencies.**
  - `GEOMETRY_KEYS` keeps exactly `{x, y, width, height}` and stays exported.
  - `plugin/src/main.ts` may hold wiring only, never logic.
  - Do not bump the plugin version. Do not hand-edit `plugin/main.js` or `server/dist/`. Do not read or edit `plugin/manifest.json` (broken symlink).
- **Technology / framework / config constraints:**
  - TypeScript + Yjs (`yjs ^13.6.0`). Obsidian's Canvas view is private and untyped — **only `canvas-adapter.ts` may touch its internals**, and the editing-focus detection is exactly the kind of private-API read that must live there and nowhere else.
  - The adapter's existing patch discipline applies: install once, lazily, with a disposer registered in `unpatchers` (`canvas-adapter.ts:301`), and a bounded staleness release on the `dragActive()` precedent.
  - Pure cores import nothing from Obsidian, the filesystem or a clock; the precedent is `canvas/reconcile-plan.ts`.
  - **Schema impact:** none. WP37 writes nothing into the doc.
- **Entry points / relevant files:**
  - `plugin/src/main.ts` — `reconcileLiveCanvas` `:1198`, the busy gate `:1212-1217`, the structural branch `:1268-1275`, the receipt `:1324-1327`, the initial reconciles `:1476`, `:1555`
  - `plugin/src/canvas/canvas-adapter.ts` — the `isBusy` contract `:83-87`, `DRAG_WATCHDOG_MS` `:260`, `dragActive()` `:318-334`, `isDragTarget` `:337-`, the `isBusy()` implementation `:572-580`, `applyNodeGeometry`'s `"interacting"` `:582-595`, `unpatchers`/`patchState` `:301-302`
  - `plugin/src/canvas/reconcile-plan.ts` — `ReconcilePlan` `:25` (**read; the verdict set does not change**)
  - `plugin/src/canvas/canvas-shadow.ts` — `buildApplyReceipt` `:795`, `isConfirmed` `:854`, `advanceFromReceipt` `:1048`
  - `plugin/src/testing/e2e-control.ts` — `E2EControlHost` `:265-`, `routeCommand` `:396-521`, the optional-method precedent `canvasFile` `:513-518`, the anti-pattern `simulateEdit` `:995-1023`
- **Structure references:** *(intentionally empty — no Graphify graph exists for this project; FALLBACK mode is declared in BUILD_SPEC §3. Worker 3 fills this in after implementation. Do not invent paths here.)*

If structure references conflict with the BUILD_SPEC or explicit task scope, the BUILD_SPEC and TaskCharter win. Escalate instead of following the map.

---

## 4. Acceptance Criteria

*Restated from BUILD_SPEC §5 C37. Each criterion names **the observable that proves it** and **what would make it vacuous**.*

*Acceptance evidence is two LIVE Obsidian instances driven through the E2E rig — `POST http://127.0.0.1:39431/command` (A) / `:39432` (B), body `{"cmd","args"}`. **Remote edits are driven by writing the `.canvas` file on disk**; **local typing is driven by the AC6 command**, which is part of this WP's deliverable. `canvas.simulateEdit` is not used by any criterion.*

1. **`isBusy()` gains an editing signal, and the drag watchdog is untouched.**
   - **Observable:** headless, through the adapter's own seam — with a simulated focused inline editor and no drag, `isBusy()` is `true`; with neither, `false`; with a drag and no editor, `true` **and** with the identical timing behaviour as before this WP (the `DRAG_WATCHDOG_MS = 5000` release and the one-shot `DRAG WATCHDOG:` warn, unchanged). Live: `canvas-adapter.ts`'s drag-related diff is confined to additive lines, quoted in the report.
   - **The editing signal carries its own bounded staleness release**, on the watchdog's precedent: a focus flag that is never cleared (view swapped, node deleted under the editor, Obsidian's own focus handling missed) would freeze reconcile for the life of the view — a permanent stale canvas is a worse defect than the one being fixed. The release emits its own signature, distinct from `DRAG WATCHDOG:`.
   - **Vacuous if:** the editing arm is asserted only in the state where it returns `true`. A predicate that returns `true` unconditionally passes that. The truth table is asserted **row by row** — {drag, editing} × {on, off}, four rows — and the staleness release is asserted by advancing the injected clock, never by sleeping.

2. **Structural applies for the record being edited are QUEUED, not dropped; every other record continues immediately.**
   - **Observable (live):** vault A has the canvas open with card X's inline editor focused (AC6 command). Vault B writes its `.canvas` changing **card Y**'s text. After quiescence, **card Y's new text is visible on A's open canvas** — the deferral is per record, not per pass, so an unrelated card is not held hostage. Then vault B changes **card X**'s text: A's view does **not** change while the editor is focused, and A's `canvas.file` **does** already hold B's change (the disk write is never deferred).
   - **Vacuous if:** only the "deferred" half is observed. Today's code already defers — by dropping everything — so an assertion that the edited card did not update **passes unchanged against the pre-WP37 build**. The discriminating half is the *other* card updating, and it must be shown to fail on the current behaviour. Equally vacuous: asserting that the queue "contains" an entry, which measures the queue rather than the view; the oracle is the view and the file.

3. **Remote `Y.Text` changes appear after blur, positionally correct, with no loss of locally typed characters.**
   - **Observable (live), and this is the criterion that measures the owner's defect:** vault A focuses card X's inline editor and types a marker through the AC6 command. While A is still focused, vault B writes its `.canvas` inserting a different marker into card X at a different offset. A blurs. After `sync.waitQuiescent`: **both markers are present in `canvas.file` on both vaults and in `canvas.state` on both**, in the correct relative order. **A's typed characters are present** — that is the "verschluckt Buchstaben" measurement, and it is the reason this criterion is the WP's Definition of Done.
   - **Vacuous if:** A's characters were already flushed to A's file before B's change arrived, in which case they survive even without the fix. **The scenario must record, and assert, that A's typed characters were NOT yet in A's `.canvas` file at the moment B's change landed** — otherwise it measures nothing. This is the same precondition class as the vacuous green the new suite already produced. Equally vacuous: running this without WP36, where the merge resolves to whole-string LWW and one marker is guaranteed to lose; AC3 depends on WP36 and must not be reported green before it.

4. **A deferred record's Surface-Shadow fields are not advanced.**
   - **Observable:** headless, at the receipt seam — after a pass in which record X was deferred and record Y was applied, the shadow holds Y's new field values and **X's previous** ones. Then, live: after the AC3 scenario, A's subsequent capture does **not** delete B's marker — which is the consequence this criterion exists to guarantee and the reason it is stated at all.
   - **Vacuous if:** the check reads the shadow immediately after the pass and finds X unadvanced **because the pass was dropped entirely**, which is the pre-WP37 behaviour and would pass without a queue existing. The assertion must be made in a run where the deferred entry is subsequently **drained and applied**, and must then show the shadow advancing at the drain — unadvanced-then-never-advanced is a leak, not a deferral.

5. **The queue is bounded, per record, and drained on blur, on view close and on teardown.**
   - **Observable:** headless — a burst of N remote changes to the edited record leaves a bounded queue (the criterion is that repeated changes to one record **coalesce**, not accumulate); the drain happens on each of the three exits, asserted **separately**, each shown to leave nothing queued and nothing retained that outlives the adapter.
   - **Vacuous if:** only blur is exercised and close/teardown are asserted by argument — they differ in what still exists when they run, and "the same drain function is called" is a claim about the code, not about the state it meets. Equally vacuous: a bound asserted by reading a constant rather than by driving a burst past it.

6. **The instrument exists, drives the real editor, and returns measured facts.**
   - **Deliverable:** one new E2E control command that, on a live instance, focuses a named node's inline editor and inserts characters through the editing surface Obsidian itself uses. **It must not write into the `Y.Doc`. It must not write the `.canvas` file. It must not return a literal.** Its response reports **measured** facts: whether focus was actually taken, and the text the node's own editing surface reports afterwards. A blur/commit affordance is part of the same deliverable, since AC3 cannot be observed without one.
   - **Observable:** on a live instance, the command reports focus taken and the typed text present at the editing surface, while `canvas.file` at that same moment does **not** yet contain those characters — which is simultaneously the proof that the command drove the editor rather than the file, and the precondition AC3 needs.
   - **Vacuous if:** the command returns a hardcoded success. This is not hypothetical — it is `canvas.simulateEdit`'s `applied: true` (`e2e-control.ts:1023`) and it has already produced multiple false greens in this run (WP73, WP75). **Every field of the response is read from the live surface at call time, and a call against a node that does not exist, or a canvas that is not open, returns a structured failure rather than a success.** Both the missing-node and the not-open cases are exercised. Equally vacuous: implementing it as a `.canvas` write with a different name — the response must be distinguishable from a file write, and the observable above is what distinguishes it.

**Definition of Done:** typing is never interrupted, and nothing is lost by deferring — demonstrated on two live Obsidian instances by AC3, with its precondition recorded.

---

## 5. Constraints and Known Risks

- **Permission / environment limits:** Windows dev host. Run tests from the workspace root, never from a subdirectory; long-running invocations through `visible-console` `run_python`/`run_command` with **absolute** paths, never a Bash background process. **The two owner vaults are shared with other work** — do not restore, reinstall or reset them without checking `DISPATCHER_STATE.md` first, and never during another agent's run.

- **Known risks specific to this WP:**
  - **⚠ The most likely wrong implementation is putting the decision in `main.ts`.** The call site is there, the state is there, and the diff is three lines smaller. It is a **§7 abort criterion** (§3.1 S11). The adapter reports the signal; a headless module decides; `main.ts` forwards.
  - **⚠ The second most likely is an editing flag that is never cleared.** Obsidian's canvas is private and untyped; a focus detection that misses one exit path leaves `isBusy()` permanently `true` and the canvas permanently stale, on every open view, for the rest of the session. That is a worse defect than the one being fixed and it will present as "sync stopped working". The bounded release in AC1 is not optional.
  - **⚠ The third is deferring the DISK write along with the view apply.** They are different things. The file must stay converged while the view is deliberately stale — that is what makes deferral safe, and it is the property that lets AC2 assert `canvas.file` already holds B's change while A's view does not.
  - **⚠ The fourth is advancing the shadow for a deferred record.** It re-enters WP36's defect from the other side: the next capture's three-way base becomes a string that was never on the surface, and the diff then deletes the user's own characters. §3 Verification 3.
  - **⚠ The fifth is a new hardcoded literal in the E2E command.** The run has produced this class at least ten times, including twice inside the gate's own driver. AC6's vacuity clause is the specific defence and may not be trimmed.
  - **⚠ AC3 depends on WP36.** Run against a whole-string LWW register it is guaranteed to lose one marker. **Do not report AC3 green before WP36 is implemented**, and do not weaken it to "one marker survives" to get an earlier green — that is the defect wearing the criterion's clothes.
  - **⚠ Do not assume the unbuilt phases.** `useCanvasBinding` is `false` and frozen until P5; the live capture path is `handleLocalModify`. A criterion that would only pass once P5 lands is a criterion this WP cannot discharge.
  - **⚠ Do not mirror any generated test suite into `plugin/src/__tests__/` before this WP is implemented.** `tsc` typechecks `src/` including tests, so an unimplemented mirrored suite breaks `npm run build` repo-wide. This has been violated once already in this run.
  - **⚠ Both vaults' `data.json` hold live credentials.** Never printed, logged, echoed into a report or a commit message, or placed in a fixture. Keys may be named; values may not. Comparison is sha256-of-bytes only.
  - **⚠ File overlap.** `plugin/src/testing/e2e-control.ts` is shared with the gate WPs. The AC6 addition is additive only, on the `canvasFile` / `clearFlags` optional-method precedent, and no existing command changes shape.

- **Known flaky patterns:**
  - No wall-clock sleeps. Timing behaviour is asserted by advancing an injected clock; live waits are `sync.waitQuiescent` or a bounded wait that names the condition it was waiting for on expiry.
  - Do not assert on log strings as the primary oracle; state is the oracle. The `DRAG WATCHDOG:` signature is a human signal, not a test contract, and the new release signature must not become one either.
  - **The E2E suite is not idempotent** — every scenario here creates its own canvas (or its own node ids) and asserts its **precondition** before its postcondition.
  - A test that asserts an absence — "the view did not change" — is suspect by default, and here it is *guaranteed* to pass against the pre-WP37 build. Every such assertion is paired with the positive one that discriminates.
- **External dependency risks:** none permitted (D11). A new runtime dependency is an ESCALATE.
- **Hard constraints:**
  - **The decision is headless. `main.ts` gains calls only** — a conditional over canvas state in `main.ts` is a §7 abort criterion.
  - **The drag watchdog, `DRAG_WATCHDOG_MS` and `isDragTarget` behaviour are unchanged.**
  - **The editing signal has a bounded staleness release with its own signature.**
  - **`ReconcilePlan` keeps exactly three verdicts. `planReconcile` is not made editing-aware.**
  - **The deferral defers the VIEW apply only. The disk write is never deferred or suppressed.**
  - **A deferred record's shadow fields are not advanced.**
  - **The queue coalesces per record, is bounded, and is drained on blur, view close and teardown — each asserted separately.**
  - **The new E2E command drives the real editor, writes neither the `Y.Doc` nor the file, and returns no literal.**
  - **No `server/**` edit. `useCanvasBinding` is not flipped. `canvas-presence.ts` is byte-unchanged. The plugin version is not bumped.**
  - **No `DONE` work package is re-opened; WP37 holds no §7 licence of any class.** A reddened inherited assertion is an ESCALATE, left red.
  - **No owner-vault file is read, hashed into a report, fixtured or named by value; no secret through any agent tool.**

---

## 6. Definition of Done Artifacts

- **Required changed files:**
  - `plugin/src/canvas/canvas-adapter.ts` — the editing signal, its bounded release, the widened `isBusy()`
  - `plugin/src/canvas/` or `plugin/src/files/` — the new headless deferral module (the decision, the per-record queue, the drain)
  - `plugin/src/main.ts` — **wiring only**: injection and the forwarding of blur / view-close / teardown
  - `plugin/src/testing/e2e-control.ts` — the AC6 command, additive, with its host method optional on the interface
- **Already landed by Worker 2 with this charter — NOT implementor work:** the revised §5 C37 block and the revised §9 WP37 row. The header count is unchanged at 79. The implementor does not edit `BUILD_SPEC_CanvasV2.md`.
- **Required report:** `ImplementationReport_WP37.md` (in `workflowArtifacts/canvas-v2/`), which must additionally record: the **four-row `isBusy()` truth table** as executed, plus the staleness-release result with the injected clock; the **AC2 live evidence** for both halves, the edited card held **and** the unrelated card updating, with the statement that the second half fails on the pre-WP37 behaviour; the **AC3 scenario in full** with its **recorded precondition** — that A's typed characters were not yet in A's `.canvas` when B's change landed — and the final content of both vaults; the **AC4 drain-time shadow advance**, not only its absence; **AC5's three exits asserted separately**; the **AC6 command's response for the two failure cases** (node absent, canvas not open) showing structured failures rather than successes, plus the observable proving it drove the editor and not the file; a quoted statement that the drag watchdog behaviour and `DRAG_WATCHDOG_MS` are unchanged and that `canvas-presence.ts` is byte-unchanged; confirmation that **`main.ts` received calls only**; the **executed test count** before and after with the statement that no existing test was deleted, weakened, retitled, skipped or amended and that **no §7 licence of any class was taken**; and, for every live run, which vault ports were used, that no `data.json` value was read or printed, and that `canvas.simulateEdit` was not called.
- **BUILD_SPEC updates required:** no — §5 and §9 were entered when this charter was written. Anything further is an **ESCALATE** rather than a spec edit.
- **Gate status required at handover:** `npm run build` (tsc + esbuild) PASS and `npm test` 0 failed from `plugin/`, with the executed test count recorded. `npm run lint` advisory locally, gating in CI — do not mass-reformat.

---

## 7. Visible Test Cases / Producer Artifacts

*Filled by Worker 3. Worker 2 leaves this section empty.*

*⚠ **Blind sets are discontinued for new work** (owner's instruction, 2026-08-05): no `blind_set1`, no `blind_set2`, no falsification-injection requirement and no `BlindVerificationLedger` row is owed by this WP. Validation is W4 against two live Obsidian instances. E2E-plugin defects found while validating go back to **W3 as a revision** — and note that for this WP the E2E command is itself part of the deliverable, so a defect in it is a defect in WP37.*

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
