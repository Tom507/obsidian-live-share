# Task Charter — WP38: `Y.UndoManager`

<!-- Updated: re-chartered 2026-08-05 (B16b) from the template-generated skeleton, against the current tree on branch `fix-bugs-and-raceconditions`, per hard-won rule 12. Every line number below was measured. No Obsidian was launched, no vault file was read, no `data.json` was opened, no relay was contacted, no E2E script was run. Three substantive findings: (1) `CAPTURE_NET` does NOT exist as a transaction origin — the capture transaction at `canvas-sync.ts:2819` is `doc.transact(fn)` with no origin argument at all, so C38 AC1 as previously written was UNSATISFIABLE and this WP must first create the origin; (2) `CAPTURE_OP` corresponds to `CANVAS_BINDING_ORIGIN` (`canvas-binding.ts:68`), which exists but lives in a file FROZEN until P5 — it may be imported, never edited; (3) the WP gains one E2E control command, because nothing in the rig can invoke undo. This WP is also explicitly recorded as NOT closing the owner's dropped-keystroke defect — WP37 does. -->
**Charter Status:** `SPEC_COMPLETE`
**WP:** WP38
**Phase:** P4
**task_mode:** `standard`
**Depends on:** WP19 (`DONE`), WP36 (`planned`)
**W4 Test Targets:** `0`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** each client can undo its **own** last canvas action — never a peer's — and an undone delete restores the record and every field it held, losslessly, through the tombstone flag rather than by re-creating anything.
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 5, component **C38** (work package **WP38**); CONCEPT_V2 Teil 9 (`CONCEPT_V2.md:648-657`); section 4.5 invariant **I7** and WP19's delete-is-a-value design; phase **P4**.
- **⚠ This WP does NOT close the owner's reported defect.** *"Manchmal verschluckt er noch Buchstaben"* is closed by **WP37**; no criterion here bears on it. WP38 is chartered because CONCEPT_V2 requires it and because it is the natural home for the undo-across-migration question — not because it fixes anything the owner reported. Stated so P4's three WPs are not reported as one undifferentiated fix.

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: create + modify, **one repository** (`obsidian-live-share`, branch `fix-bugs-and-raceconditions`), **`plugin/src/` only**.
  - Responsibility: **create the named capture transaction origin that does not yet exist**; one `Y.UndoManager` per client and canvas doc, scoped to those origins; its lifecycle; the undo/redo command registration; and the instrument that makes it observable on a live instance.
  - Scope summary: per-client selective undo · lossless delete-undo through the tombstone flag · an explicitly stated scope across the `text`→`Y.Text` conversion boundary · one new E2E control command.
- **Out of scope / non-goals — each of these is an ESCALATE, not a judgement call:**
  - **⚠ Editing `plugin/src/canvas/canvas-binding.ts`.** It is frozen until P5 (WP39/WP40) and editing it is a **§7 abort criterion**. `CANVAS_BINDING_ORIGIN` (`:68`) may be **imported**; an import is not an edit. See §3 Verification 2 for the choice this forces and how to record it.
  - **⚠ Changing what a capture transaction WRITES.** WP38 tags the existing transaction with an origin. An origin is metadata; the ops inside it, their order and their content are WP18's and WP19's and stay identical. A diff that changes a value inside `applyIntentPlan` is out of scope.
  - **⚠ Making undo destructive.** An undone delete restores through the tombstone flag (`on: false`), not by re-creating a `Y.Map`. `maps[kind].set(id, …)` on an existing id is exactly what WP18 AC2 forbids and what WP19's design exists to avoid.
  - **⚠ Replacing Obsidian's file-based undo for anything other than owned canvases.** Markdown, unowned files and unsubscribed canvases keep Obsidian's own undo untouched.
  - **The `Y.Text` representation, the capture write, the projection render, the migration mechanism.** WP36. WP38 only states what undo does **across** the conversion boundary.
  - **The deferral queue, the editing-aware busy predicate.** WP37.
  - **`useCanvasBinding`, `CanvasBinding`, `captureLocal`, `canvas-model-bridge.ts`.** Frozen until P5; flipping the flag is a §7 abort criterion.
  - **`server/**`.** Untouched — a `server/` edit outside WP41 is a §7 abort criterion.
  - **`plugin/src/canvas/canvas-presence.ts`.** Byte-unchanged (WP21 AC2).
  - **`canvas.simulateEdit`.** Not extended, not repaired, not used.
  - **Any new runtime dependency.** `Y.UndoManager` ships inside `yjs` — it is not a new dependency. Anything else is an ESCALATE (D11).
- **Known interfaces / dependencies:**
  - Input: local undo/redo commands, registered in `main.ts`
  - Output: one `Y.UndoManager` per client and canvas doc, destroyed with the doc; one new named capture origin; one E2E control command
  - Depends on: **WP19** (`DONE`) — the tombstone flag AC3 restores through; **WP36** (`planned`) — the `Y.Text` whose conversion AC5 scopes undo across
  - **Blocks:** nothing.
  - **File overlap warning:** `plugin/src/testing/e2e-control.ts` is shared with the gate WPs and with **WP37**, which adds its own command there. **If WP37 and WP38 are implemented in the same batch, the second one to touch the file must not clobber the first** — both additions are additive `case` arms plus optional host methods, on the `canvasFile` (`e2e-control.ts:513-518`) precedent.

### §7 disposition — no `DONE` work package is re-opened, and no §7 licence of any class is taken

1. **Tagging the capture transaction with an origin is not a re-open of WP18 or WP19.** `doc.transact(fn)` and `doc.transact(fn, origin)` produce identical document state; the origin is carried on the transaction, not written into the doc. No C18 or C19 acceptance criterion mentions an origin, and none changes meaning.
   **The one way this could still bite, named:** if an inherited assertion subscribes to `doc.on("update", (u, origin) => …)` or `doc.on("afterTransaction", …)` and asserts the origin is `null`/`undefined`, tagging reddens it. That is an **ESCALATE with the measured before/after**, left red — not a rewrite, not a fixture edit. WP38 holds **no §7 licence of any class**. The implementor measures this before writing the tag, not after.
2. **No existing test is deleted, weakened, retitled, skipped or amended.**
3. **`main.ts` gains wiring only** — the manager's construction, injection and the command registration. §3.1 S11 is absolute: the undo **decision** (what is undoable, what the scope is, what happens at the migration boundary) lives in a headless module. This is the WP most likely to drift, because "register a command" looks like wiring and "decide whether this step is undoable" looks like part of it.
4. **`canvas-binding.ts` is byte-unchanged.** Importing its exported symbol is permitted; editing it is a §7 abort criterion.

---

## 3. Architecture Context

*Task-local architecture guidance only.*

### Verified against the current tree (rule 12), 2026-08-05 — measured, given, do not re-derive

**Verification 1 — `Y.UndoManager` does not exist anywhere in the tree.** A whole-tree search for `UndoManager` outside test files returns **zero** hits. This WP is a genuine create, not a rewiring.

**Verification 2 — `CAPTURE_NET` and `CAPTURE_OP` are names from the concept, not symbols in the tree, and C38 AC1 as previously written was unsatisfiable.**

| Name in C38 AC1 | What actually exists | Consequence for this WP |
|---|---|---|
| `CAPTURE_NET` | **Nothing.** The capture transaction is `docHandle.doc.transact(() => this.applyIntentPlan(...))` at `canvas-sync.ts:2819` — **no origin argument**, so its origin is `null`. The string `"capture-net"` at `canvas-sync.ts:1156`/`INGEST_BOUNDARY.capture` is a **rejection-signature label**, not a Yjs origin. | **WP38 creates it** and tags `:2819`. |
| `CAPTURE_OP` | `CANVAS_BINDING_ORIGIN` (`canvas/canvas-binding.ts:68`), a `unique symbol` — but the file is **frozen until P5** and can never fire while `useCanvasBinding` is `false` (`types.ts:65`). | **Import it, or define a P4-owned symbol and let P5 re-point.** Either is acceptable; the choice and its reason go in the implementation report. `canvas-binding.ts` stays byte-unchanged either way. Including an origin that cannot fire yet is forward-correct and harmless. |

**Six named origin symbols already exist and establish the pattern** — `CANVAS_BINDING_ORIGIN` (`canvas-binding.ts:68`), `CANVAS_EPOCH_ADOPT_ORIGIN` (`canvas-epoch.ts:312`), `CANVAS_MIGRATION_ORIGIN` (`canvas-schema.ts:417`), `CANVAS_IMPORT_SEED_ORIGIN` (`canvas-import.ts:102`), `CANVAS_SEED_ORIGIN` (`canvas-persistence.ts:89`), `SIDECAR_LOAD_ORIGIN` (`canvas-sidecar.ts:131`). A new capture origin follows the same shape and lives beside the transaction it tags.

**Verification 3 — what `trackedOrigins` must exclude, and why the exclusions are already safe.**

| Writer | Origin today | Must undo track it? |
|---|---|---|
| Remote deltas from the relay | `this` (the `SyncManager`) — `sync/sync.ts:530`, `:534` | **No.** Already excluded by being non-`null` and non-capture. This is what makes AC2 achievable. |
| Sidecar replay at load | `SIDECAR_LOAD_ORIGIN` — `canvas-sidecar.ts:363` | **No.** Undoing a history replay would delete the history. |
| Host seed / cold-open seed | `CANVAS_SEED_ORIGIN`, `CANVAS_IMPORT_SEED_ORIGIN` — `canvas-persistence.ts:89`, `canvas-import.ts:102` | **No.** A seed is not a user action. |
| V1→V2 migration | `CANVAS_MIGRATION_ORIGIN` — `canvas-schema.ts:417` | **No.** |
| Epoch adoption | `CANVAS_EPOCH_ADOPT_ORIGIN` — `canvas-epoch.ts:312` | **No.** |
| **File-driven local capture** | **`null`** — `canvas-sync.ts:2819` | **Yes**, and it is the only one. |

**Do not rely on `Y.UndoManager`'s default `trackedOrigins` of `{null}`.** It would work today by accident — every non-capture writer is already tagged — and it would silently start tracking the next untagged transaction anyone adds. `trackedOrigins` must be an **explicit allow-list of the named capture origins**, which is also what makes AC1 assertable at all.

**Verification 4 — the delete this WP must undo is already a value, not an absence.** `applyIntentPlan`'s delete path (`canvas-sync.ts:3049-3062`) touches `maps` **not at all**: it calls `applyTombstoneOp(deletedMap, del.id, { t, by, on: true })` and the record's `Y.Map` keeps its identity and every field. The in-code comment states the consequence — *"which is the whole of what makes the delete reversible (AC4) and mergeable (AC2)"*. So AC3's losslessness is a property WP19 already built; WP38's job is to reach it **through the tombstone flag** and never by re-creating the record. `buildCanvasData`'s suppression (`:854-865`, `:936-940`) makes the restored record reappear in the projection with no further work.

**Verification 5 — the migration boundary, and the hazard that decides AC5.** WP36's conversion (`set(text, new Y.Text(previousString))`) is written **inside the capture transaction**, so with the origin tagged it is **tracked by default**. Undoing it would restore the pre-conversion **plain string** — and that string does not contain any characters a peer merged into the `Y.Text` in the meantime. **A local undo would therefore destroy a peer's characters**, which is precisely what AC2 forbids, arriving through a path AC2's own test would not exercise.

**Ruling: the conversion op is excluded from the undo scope.** It is a representation change, not a user action; no user performed it and no user expects `Ctrl+Z` to reverse it. Excluding it is also the only option that does not require undo to reason about content it did not author. The implementor may achieve the exclusion however Yjs makes cleanest (a separate transaction under a non-tracked origin is the obvious form), but the **property** is fixed: **no undo step ever reverts a `text` → `Y.Text` conversion.** CONCEPT_V2's "lossless within an epoch" claim is scoped accordingly and stated in AC5.

**Verification 6 — the instrument does not exist.** `routeCommand` (`testing/e2e-control.ts:396-521`) exposes eleven commands and **none of them invokes an Obsidian command**. Undo is a keyboard command on a live instance; there is no way to trigger it through the rig. Per the owner's instruction — *"Falls das e2e plugin noch bugs hat gerne bei w3 in revision geben"* — the missing command is chartered **here, inside WP38**, as a W3 revision.

- **Component(s) being changed:** a new headless undo module; the capture origin at `canvas-sync.ts:2819`; `main.ts` (wiring + command registration); `testing/e2e-control.ts` (one additive command).
- **Constraints from BUILD_SPEC (invariants — what must not change):**
  - Invariants I1–I5 and I6–I11 are binding. **I7 in particular:** nothing on a local path deletes a key because an incoming record failed to mention it — and an undo is a local path.
  - Yjs stays. `CanvasPersistence` remains the single CRDT→disk writer and emits zero CRDT writes; an undo produces a CRDT delta and the writer projects it like any other.
  - **Zero new runtime dependencies.** `Y.UndoManager` is part of `yjs`.
  - `GEOMETRY_KEYS` keeps exactly `{x, y, width, height}` and stays exported.
  - `plugin/src/main.ts` may hold wiring only, never logic.
  - Do not bump the plugin version. Do not hand-edit `plugin/main.js` or `server/dist/`. Do not read or edit `plugin/manifest.json` (broken symlink).
- **Technology / framework / config constraints:**
  - TypeScript + Yjs (`yjs ^13.6.0`). Obsidian's Canvas view is private and untyped — only `canvas-adapter.ts` may touch its internals.
  - Pure cores import nothing from Obsidian, the filesystem or a clock; the precedent is `canvas/reconcile-plan.ts`.
  - **Schema impact:** none. An undo writes ordinary CRDT ops.
- **Entry points / relevant files:**
  - `plugin/src/files/canvas-sync.ts` — the capture transaction `:2819`, `applyIntentPlan` `:2943`, the delete path `:3049-3062`, `INGEST_BOUNDARY` `:1150-1158`, `buildCanvasData` suppression `:854-865`, `:936-940`
  - `plugin/src/canvas/canvas-tombstone.ts` — `applyTombstoneOp`, the suppression predicate (WP12/WP19)
  - `plugin/src/canvas/canvas-binding.ts` — `CANVAS_BINDING_ORIGIN` `:68` (**import only; byte-unchanged**)
  - `plugin/src/sync/sync.ts` — `Y.applyUpdate(doc, payload, this)` `:530`, `:534` (the remote origin AC2 relies on)
  - `plugin/src/files/canvas-sidecar.ts` — `SIDECAR_LOAD_ORIGIN` `:131`, `:363`
  - `plugin/src/main.ts` — command registration; the doc lifecycle the manager must be destroyed with
  - `plugin/src/testing/e2e-control.ts` — `E2EControlHost` `:265-`, `routeCommand` `:396-521`, optional-method precedent `canvasFile` `:513-518`, anti-pattern `simulateEdit` `:995-1023`
- **Structure references:** *(intentionally empty — no Graphify graph exists for this project; FALLBACK mode is declared in BUILD_SPEC §3. Worker 3 fills this in after implementation. Do not invent paths here.)*

If structure references conflict with the BUILD_SPEC or explicit task scope, the BUILD_SPEC and TaskCharter win. Escalate instead of following the map.

---

## 4. Acceptance Criteria

*Restated from BUILD_SPEC §5 C38. Each criterion names **the observable that proves it** and **what would make it vacuous**.*

*Acceptance evidence is two LIVE Obsidian instances driven through the E2E rig — `POST http://127.0.0.1:39431/command` (A) / `:39432` (B). **Edits are driven by writing the `.canvas` file on disk**; **undo is driven by the AC6 command**, which is part of this WP's deliverable. `canvas.simulateEdit` is not used by any criterion.*

1. **One manager per client and canvas doc, with an explicit named-origin allow-list, destroyed with its doc.**
   - **Observable:** headless — one manager per subscribed canvas doc, `trackedOrigins` an **explicit set of the named capture origins**, never Yjs's `{null}` default; subscribing two canvases yields two independent managers whose stacks do not interact; unsubscribing or tearing down a canvas destroys its manager and releases its doc reference. Live: undo on canvas 1 leaves canvas 2 unchanged on both vaults.
   - **The origin is created by this WP.** `canvas-sync.ts:2819` is tagged. Before writing the tag, the implementor **measures** whether any inherited assertion reads a transaction origin; a reddened one is an ESCALATE, left red (§2 §7-disposition clause 1).
   - **Vacuous if:** `trackedOrigins` is left at the default, which tracks `null` and therefore tracks the capture path **by accident today** — every assertion passes and the next untagged transaction anyone adds silently becomes undoable. The criterion is satisfied only by an explicit allow-list, asserted by its **contents**, plus a negative row: a transaction under a non-capture origin (use one of the six existing symbols) produces **no** undo step. Equally vacuous: asserting the manager was constructed rather than that it is *scoped* — construction is not a scope.

2. **Undo reverts only this client's own last action, never a peer's, even when the peer's edit was in between.**
   - **Observable (live):** vault A changes card X (write A's `.canvas`); vault B changes card Y; after quiescence, A undoes. **Card X returns to its previous value on both vaults; card Y keeps B's value on both vaults**, read from `canvas.state` and `canvas.file` on both ports.
   - **Vacuous if:** the peer's edit touches a different **field of a different record**, where almost any implementation succeeds. At least one run must have the peer's edit land on the **same record** as the undone one — different field — because that is where a coarse implementation reverts the whole record. Equally vacuous: asserting only that card Y is unchanged on vault A; the peer's own vault is where a wrongly propagated undo shows.

3. **Undo of a delete restores the record and all its field values through the tombstone flag, with no data loss.**
   - **Observable (live):** vault A deletes a card carrying several distinct field values (text, colour, size). After quiescence the card is gone from `canvas.state` and from `canvas.file` on **both** vaults. A undoes. The card reappears on **both** vaults with **every** field value byte-identical to before the delete, and any edge whose endpoint it was reappears with it (the WP19 cascade running in reverse, because suppression is a projection and not a deletion).
   - **Additionally required:** the restore is asserted to have gone through the tombstone flag — the record's `Y.Map` identity is unchanged and no `set(id, new Y.Map())` was issued for that id.
   - **Vacuous if:** the fixture card carries one field, so "all its field values" is one value. It must carry several, and each must be compared **individually** — a whole-record `toEqual` against a one-field record proves nothing. Equally vacuous: asserting reappearance without asserting the **values**, which a re-creation would also satisfy while having lost everything the record held.

4. **A drag burst is one undo step, and a multi-node drag is one step.**
   - **Observable:** headless with an injected clock — a burst of geometry captures inside `captureTimeout` collapses to one step, and a burst spanning the timeout produces two; a multi-node move captured in one transaction is one step because it is one transaction. Live: a multi-card change written into the `.canvas` in one file write is undone by **one** undo.
   - **Vacuous if:** the burst is produced with wall-clock sleeps, which makes it timing-dependent and flaky, or if only the collapsing case is exercised. Both sides of the timeout are required — a `captureTimeout` of infinity passes the collapse test perfectly and never separates anything.

5. **Undo does not cross the `text` → `Y.Text` conversion, and the scope claim is stated rather than assumed.**
   - **Observable:** headless — after a record's `text` is converted (WP36), no undo step reverts the conversion; the field is never left absent, never left neither string nor `Y.Text`, and never left empty when it was not. Live: with a peer's characters merged into a converted `Y.Text`, a local undo of the local **text edit** leaves the **peer's characters present on both vaults**.
   - **The live half is the one that matters.** A tracked conversion would restore the pre-conversion plain string and thereby destroy the peer's characters — an AC2 violation reached through a path AC2's own scenario does not exercise. §3 Verification 5.
   - **Vacuous if:** only the headless half is run. "No step reverts the conversion" is satisfied trivially by an undo stack that is empty for the wrong reason (nothing tracked, wrong doc, manager not constructed) — which must be excluded by showing the **same** fixture produces a normal undo step for a normal edit. Equally vacuous: asserting the field is "still a `Y.Text`" without asserting its **content**, since an empty `Y.Text` is still a `Y.Text`.

6. **The instrument exists and returns measured facts.**
   - **Deliverable:** one new E2E control command that invokes the registered undo command on a live instance and returns **measured** facts — whether a step was actually popped, and the undo-stack depth before and after. A redo affordance rides the same command. **It must not manipulate the `Y.Doc` directly and must not return a literal.**
   - **Observable:** on a live instance, calling it with an empty stack reports **no step popped** and depth `0 → 0` — and the canvas is unchanged; calling it after a local edit reports a step popped, depth `n → n-1`, and the change reverted in `canvas.state` and `canvas.file`.
   - **Vacuous if:** the command returns a hardcoded success. This is not hypothetical — `canvas.simulateEdit` returns a hardcoded `applied: true` (`e2e-control.ts:1023`) and that class has produced multiple false greens in this run (WP73, WP75). **The empty-stack case is mandatory**, because it is the one call whose honest answer is "nothing happened", and a literal cannot produce it.

**Definition of Done:** undo is per-client, selective and lossless — demonstrated on two live Obsidian instances by AC2 and AC3, and bounded by AC5's stated scope.

---

## 5. Constraints and Known Risks

- **Permission / environment limits:** Windows dev host. Run tests from the workspace root, never from a subdirectory; long-running invocations through `visible-console` `run_python`/`run_command` with **absolute** paths, never a Bash background process. **The two owner vaults are shared with other work** — do not restore, reinstall or reset them without checking `DISPATCHER_STATE.md` first, and never during another agent's run.

- **Known risks specific to this WP:**
  - **⚠ The most likely wrong implementation is leaving `trackedOrigins` at its default.** It tracks `null`, which is what the capture transaction carries today, so **every test passes** — and the scope is then an accident of what nobody has tagged yet. Explicit allow-list, asserted by contents, with a negative row.
  - **⚠ The second most likely is editing `canvas-binding.ts` to reach `CANVAS_BINDING_ORIGIN`.** It is frozen until P5 and editing it is a **§7 abort criterion**. Import it or define a P4-owned symbol; either way the file stays byte-unchanged, and the choice is recorded.
  - **⚠ The third is a tracked `text` → `Y.Text` conversion.** It makes a local undo destroy a peer's characters — an AC2 violation that AC2's own scenario will not catch. §3 Verification 5 and AC5's live half exist for it.
  - **⚠ The fourth is an undo that re-creates the record.** `maps[kind].set(id, new Y.Map())` on an existing id is what WP18 AC2 forbids and what makes the restore lossy. The restore is through the tombstone flag.
  - **⚠ The fifth is a manager that outlives its doc.** A retained reference is a leak, and an undo reaching a torn-down surface is a crash. Destruction is an AC1 conjunct, not cleanup.
  - **⚠ The sixth is a new hardcoded literal in the E2E command.** AC6's empty-stack case is the defence and may not be trimmed.
  - **⚠ Do not put the undo decision in `main.ts`.** "Register a command" is wiring; "decide whether this step is undoable" is logic and a §7 abort criterion if it lands there.
  - **⚠ Measure the origin-assertion question BEFORE tagging.** If an inherited test asserts on transaction origin, tagging reddens it and the correct response is ESCALATE-and-leave-red, not a rewrite. Finding that out after the tag is written is how a licence gets assumed.
  - **⚠ Do not assume the unbuilt phases.** `useCanvasBinding` is `false` and frozen until P5; `CAPTURE_OP` can never fire before then, and no criterion may depend on it firing.
  - **⚠ Do not mirror any generated test suite into `plugin/src/__tests__/` before this WP is implemented.** `tsc` typechecks `src/` including tests, so an unimplemented mirrored suite breaks `npm run build` repo-wide. This has been violated once already in this run.
  - **⚠ Both vaults' `data.json` hold live credentials.** Never printed, logged, echoed into a report or a commit message, or placed in a fixture. Keys may be named; values may not. Comparison is sha256-of-bytes only.
  - **⚠ File overlap with WP37.** Both add a command to `testing/e2e-control.ts`. If they run in the same batch, the second must not clobber the first; both additions are additive.

- **Known flaky patterns:**
  - No wall-clock sleeps. `captureTimeout` behaviour is asserted by advancing an injected clock, never by sleeping.
  - Do not assert on log strings as the primary oracle; state is the oracle.
  - **The E2E suite is not idempotent** — every scenario here creates its own canvas (or its own node ids) and asserts its **precondition** before its postcondition.
  - A test that asserts an absence — "no undo step exists" — is suspect by default and here is trivially satisfiable by a manager that was never constructed. Every such assertion is paired with the positive control that discriminates.
- **External dependency risks:** none permitted (D11). `Y.UndoManager` ships inside `yjs` and is not a new dependency.
- **Hard constraints:**
  - **`trackedOrigins` is an explicit named allow-list, never the Yjs default.**
  - **`canvas-binding.ts` is byte-unchanged; `CANVAS_BINDING_ORIGIN` may be imported, not edited.**
  - **Tagging the capture transaction changes no op, no value and no order.**
  - **No undo step reverts a `text` → `Y.Text` conversion.**
  - **An undone delete restores through the tombstone flag; no record is re-created.**
  - **A manager is destroyed with its doc.**
  - **The new E2E command invokes the real command, manipulates no `Y.Doc` and returns no literal; the empty-stack case is exercised.**
  - **The undo decision is headless; `main.ts` gains calls and a command registration only.**
  - **No `server/**` edit. `useCanvasBinding` is not flipped. `canvas-presence.ts` is byte-unchanged. The plugin version is not bumped.**
  - **No `DONE` work package is re-opened; WP38 holds no §7 licence of any class.** A reddened inherited assertion is an ESCALATE, left red.
  - **No owner-vault file is read, hashed into a report, fixtured or named by value; no secret through any agent tool.**

---

## 6. Definition of Done Artifacts

- **Required changed files:**
  - `plugin/src/canvas/` or `plugin/src/files/` — the new headless undo module (the manager's construction, scope, lifecycle and the undoable/not-undoable decision)
  - `plugin/src/files/canvas-sync.ts` — the named capture origin and the tag on the transaction at `:2819`
  - `plugin/src/main.ts` — **wiring only**: construction, injection, undo/redo command registration, destruction on teardown
  - `plugin/src/testing/e2e-control.ts` — the AC6 command, additive, host method optional on the interface
- **Already landed by Worker 2 with this charter — NOT implementor work:** the revised §5 C38 block and the revised §9 WP38 row. The header count is unchanged at 79. The implementor does not edit `BUILD_SPEC_CanvasV2.md`.
- **Required report:** `ImplementationReport_WP38.md` (in `workflowArtifacts/canvas-v2/`), which must additionally record: the **`trackedOrigins` set as constructed**, by contents, with the **negative row** (a non-capture-origin transaction producing no step); **which `CAPTURE_OP` option was taken** — import `CANVAS_BINDING_ORIGIN` or define a P4-owned symbol — and why, with the statement that `canvas-binding.ts` is byte-unchanged; the **origin-assertion measurement taken BEFORE the tag was written**, naming what was searched and what was found; the **AC2 live evidence** including the same-record/different-field run and the readings from **both** ports; the **AC3 per-field comparison**, field by field, plus the statement that the record's `Y.Map` identity was unchanged and no `set(id, new Y.Map())` was issued; **AC4 both sides of the `captureTimeout`**, driven by an injected clock; the **AC5 live half** showing the peer's characters surviving a local undo; the **AC6 empty-stack response**; the **executed test count** before and after with the statement that no existing test was deleted, weakened, retitled, skipped or amended and that **no §7 licence of any class was taken**; a positive statement that **WP38 closes no part of the dropped-keystroke defect** (WP37 does), so no report reader infers otherwise; and, for every live run, which vault ports were used, that no `data.json` value was read or printed, and that `canvas.simulateEdit` was not called.
- **BUILD_SPEC updates required:** no — §5 and §9 were entered when this charter was written. Anything further is an **ESCALATE** rather than a spec edit.
- **Gate status required at handover:** `npm run build` (tsc + esbuild) PASS and `npm test` 0 failed from `plugin/`, with the executed test count recorded. `npm run lint` advisory locally, gating in CI — do not mass-reformat.

---

## 7. Visible Test Cases / Producer Artifacts

*Filled by Worker 3. Worker 2 leaves this section empty.*

*⚠ **Blind sets are discontinued for new work** (owner's instruction, 2026-08-05): no `blind_set1`, no `blind_set2`, no falsification-injection requirement and no `BlindVerificationLedger` row is owed by this WP. Validation is W4 against two live Obsidian instances. E2E-plugin defects found while validating go back to **W3 as a revision** — and for this WP the E2E command is itself part of the deliverable, so a defect in it is a defect in WP38.*

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
