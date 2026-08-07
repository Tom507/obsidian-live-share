# Task Charter — WP87: a blur commit is a remote change like any other, and the editor it lands on is protected like any other

<!-- Updated: chartered 2026-08-05 (B33) from S54, measured by WP36 (`ImplementationReport_WP36.md` §4) and attributed by receipt there. Verified against the current tree per rule 12 on branch `fix-bugs-and-raceconditions` at `fc10c5b`. ⚠ ONE THING IS DELIBERATELY NOT CLAIMED BY THIS CHARTER, AND IT IS THE FIRST ACCEPTANCE CRITERION: **which seam puts peer A's committed value on peer B's live surface is NOT established.** WP36 measured the OUTCOME (B's editor holds A's value ~4 s after A blurs, and B emits zero text captures) and proved what it is NOT (not the merge — the merge produces `kolla1bo2ration`; not a `CANVAS_EDIT_DRAIN_DELAY_MS` margin — removing the propagation window entirely changes nothing). It did not name the route, and this charter does not invent one. The tree yields exactly four candidate routes, each with a discriminating receipt, and they are enumerated in §3 Verification 3 with their line numbers so the implementor can decide between them in one live run instead of re-deriving them. **Attribution by receipt precedes repair.** That order is not procedural fussiness: WP81 chartered a symptom that did not exist, WP86 traced a mechanism that was wrong in the worse direction, and WP37's own charter had the chain right and the granularity wrong — three instances in this run of a repair aimed by inference. No Obsidian was launched for this charter, no vault file was read or written, no E2E script was run, no `data.json` was opened, no relay was contacted, and no `plugin/src/**` file was edited: every line number below was measured by reading the tree, and every live figure is quoted from a landed implementation report with its source named. -->
**Charter Status:** `SPEC_COMPLETE`
**WP:** WP87
**Phase:** P4
**task_mode:** `standard`
**Depends on:** WP36 (`DONE`, `3ebd35c`/`44dabf2`), WP37 (`DONE`, `996f080`/`79cb934`/`ecb4736`/`7648c0c`), WP85 (`DONE`, `2b59735`/`2117e24`). **MUST NOT be batched with WP80, WP82, WP85, WP86 or any other `main.ts` work — see §2 Ordering.**
**W4 Test Targets:** `0`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** two people typing into the **same card** both keep their characters. Today the second typist does not: when the first blurs, the value that blur commits reaches the second peer and **replaces its live inline editor**, destroying the characters **in the view, before storage**. After this WP a peer's blur commit is treated as what it is — a remote change to a record — and the protection WP37 built for a typist facing a remote structural change covers it, at the same seam, with **one** definer.
- **Why it outranks the rest of P4's residue:** it is the **only** thing standing between WP36 and an end-to-end demonstration of C37 AC3, and WP36 says so in its own report (`ImplementationReport_WP36.md` §4: *"it now blocks the last unmeasured half of C37 AC3, and it needs its own work package"*). It is also **WP37's own defect class with one participant moved**: WP37 protected a typist from a *remote structural change*; nothing protects a typist from a *peer's blur commit*. Two work packages have now hardened one approach to a live editor while a second stood open beside it — the same shape as WP80/WP86 one layer up, and the same lesson: **the door that was measured is not the same thing as the set of doors.**
- **The ruling this WP inherits and extends.** WP81's landed ruling — *a swallowed failure may drop data, but may not drop the fact that it dropped data* — has a WP37 form and a WP87 form. WP37's: *a client may be slow to show you a peer's change; it may not destroy what you are typing to show it.* WP87's is the same sentence with the subject widened: **it does not matter that the remote change originated in another person's editor rather than in a file write. A card being edited is a card being edited.**
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 9, work package **WP87**; section 5, component **C37** (whose AC2/AC3/AC4 this WP constrains and does not amend); section 7 (Quality Gates). Phase **P4**.

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: modify, **one repository** (`obsidian-live-share`, branch `fix-bugs-and-raceconditions`), **`plugin/src/` only**.
  - Responsibility: **(a)** reproduce the destruction live and **attribute it by receipt** to a named seam; **(b)** make the editing-aware predicate WP37 built the **single** consultation on every route that can put a remote value on a live canvas surface, with the route set derived from the tree by a test rather than asserted; **(c)** show that the second typist's own capture now runs, where it emitted **zero** receipts before; **(d)** carry C37 AC3's positional half end to end through two live inline editors and report its verdict.
  - Scope summary: attribution first · the consumer census, derived · the repair at the route the receipt names · the reciprocal half asserted (A's committed value still arrives) · C37 AC3 run end to end.
- **Out of scope / non-goals — each of these is an ESCALATE, not a judgement call:**
  - **⚠ A second copy of the editing predicate.** `canvas/canvas-adapter.ts`'s `editingActive()` / `getEditingNodeId()` (`:635-668`, `:990`) and `canvas/canvas-editing-deferral.ts`'s `classifyBusyGate` / `planEditingDeferral` (`:86-92`, `:188-266`) are **the** definers. A route that needs the answer **calls** them. Authoring a second predicate — even a two-line one, even "just a boolean on the writer" — is **hard-won rule 10** and an abort criterion. The whole defect is that one question has one answer consulted in one place.
  - **⚠ Logic in `main.ts`.** The call sites are there and the diff is smaller there. §3.1 S11 and the §7 abort criterion are absolute: `main.ts` constructs, injects, forwards and reads a verdict. A conditional over canvas state written in `main.ts` is an abort criterion. Precedent: `wireCanvasSidecar`, and WP37's own `classifyBusyGate`, which exists precisely so `main.ts` executes a verdict rather than holding one.
  - **⚠ `files/canvas-persistence.ts`.** **WP85 is `DONE` and its charter explicitly excludes this file from repair** (C85 §2, *"`files/canvas-persistence.ts` and `coldOpen`'s three outcomes/order/placement (C29 AC4)"* — not in scope). WP87 may **read** it. If AC1's attribution lands the destruction **inside** `CanvasPersistence`'s write, that is an **ESCALATE with the receipt attached**, not a repair taken in passing — it would re-open a `DONE` WP's declared boundary, and the decision of whether to do that is the Dispatcher's. **The seam for a view-level repair is the view (C7), never the writer.**
  - **⚠ `files/canvas-mirror.ts` / `files/canvas-mirror-decision.ts`.** Byte-unchanged. Attaching or deciding anything there violates C79 AC4 (*the host arm writes nothing*) and is an abort criterion, inherited verbatim from C85.
  - **⚠ Changing `planReconcile`'s verdict set.** `ReconcilePlan` stays `"structural" | "geometry" | "noop"` (`canvas/reconcile-plan.ts:25`). C37 §2's constraint, unchanged: **the deferral happens at execution, not at classification.**
  - **⚠ Weakening the drag watchdog.** `DRAG_WATCHDOG_MS = 5000` (`canvas-adapter.ts:260`), `dragActive()` (`:418`-), `isDragTarget` and the `DRAG WATCHDOG:` signature keep their current behaviour exactly. C37 AC1.
  - **⚠ The `Y.Text` representation, the three-way capture, the projection render, the migration.** WP36, `DONE`. WP87 changes **nothing** about how text merges. If the repair appears to require a merge change, the attribution is wrong — WP36 measured the merge producing `kolla1bo2ration` on both peers.
  - **⚠ Undo.** WP38. **⚠ `useCanvasBinding`, `canvas-binding.ts`, `canvas-model-bridge.ts`.** Frozen until P5; flipping the flag or editing those files is a §7 abort criterion.
  - **⚠ `server/**`.** Untouched. A `server/` edit outside WP41 is a §7 abort criterion. Nothing in this defect is server-reachable: both peers' sockets are open throughout the WP36 diagnostic and the value in question travels the ordinary mux path.
  - **⚠ `canvas.simulateEdit`.** Not used, not extended, not repaired, not called. Its shape — a side effect at `testing/e2e-control.ts:995-1005` plus a hardcoded `applied: true` at `:1023` — is **explicitly forbidden** for anything this WP adds.
  - **⚠ `canvas.open`.** **Not called by any criterion, in any scenario, at any point.** It subscribes without opening a leaf and the leaf-open attach is gated on `!isSubscribed`, so calling it **permanently disables the seam that attaches the disk writer** (**S45**, WP85-report set). It invalidated five rows of the canvas suite for months. Every leaf is opened through `canvas.typeInNode` with `open: true` and empty text — no text, no blur, a non-invasive read (`testing/e2e-control.ts:867-903`).
  - **⚠ WP36's single-span known limit.** `ImplementationReport_WP36.md` §5.2: a single contiguous local diff from a stale base can re-author one peer character (`kolla1bo22ratio`). **Named, not repaired here.** Closing it needs a multi-span LCS diff and is WP36's residue, not WP87's. AC6 states the consequence.
  - **⚠ The 13 reddened inherited assertions and the fuzzer's `text` oracle.** **B32's**, live at charter time. WP87 does not touch `plugin/src/__tests__/v2/wp23/**`, `plugin/src/__tests__/harness/fuzz/**`, `plugin/src/__tests__/v2/wp4/**`, `plugin/src/__tests__/v2/wp5v2/**` or `plugin/src/__tests__/harness/collab-text.ts`.
  - **⚠ Any new runtime dependency.** D11 — an ESCALATE.
- **Known interfaces / dependencies:**
  - Input: `adapter.getEditingNodeId()`, `adapter.getNodeFields(id)`, `adapter.isBusy()`, `adapter.onEditingEnd(cb)`, the `ReconcilePlan` verdict, the Surface-Shadow, the live node/edge id sets
  - Output: the repaired route (named by AC1), a tree-derived census of routes that must consult the predicate, and at most **one additive read-only** E2E reader if AC4 needs one
  - Depends on: **WP36** for the merge that makes both markers representable, **WP37** for the predicate and the queue, **WP85** for the fact that an open leaf now has a live disk writer at all
  - **Blocks:** the end-to-end half of **C37 AC3**, recorded PARTIAL since WP37 and re-scoped by WP36

### Ordering — what must NOT be batched together

Measured at charter time (`git status` on `fc10c5b`), and stated as a measurement, not as a timeless fact (rule 5):

1. **`plugin/src/main.ts` is contended by nearly everything in this run.** WP80, WP82, WP85 and WP86 all edit it, and **WP85's own charter already says all three of WP80/WP82/WP85 must not be batched together** for exactly this reason. **WP87 edits `main.ts` and must not be in flight with any other WP that does.** Rule 14 makes region-disjointness insufficient: a sibling reverting a shared path between edit and stage has already happened once in this run (**S34**), on this file set, and was caught **only** because WP81 re-read `git status` immediately before committing.
2. **B32 is live and its territory is measured, not assumed.** At `fc10c5b` the working tree carries modifications to `plugin/src/__tests__/v2/wp4/test_tp01_intent_basis_visible.test.ts`, `.../wp4/test_tp07_capture_geometry_rounding_visible.test.ts`, `.../v2/wp5v2/test_tp01_single_shadow_visible.test.ts` and **`plugin/src/files/canvas-sync.ts`**, plus the untracked `plugin/src/__tests__/harness/collab-text.ts`. **`files/canvas-sync.ts` is a production file and it is B32's, not WP87's** — that is wider than "the fuzzer and the text oracle" and it is the row that matters, because a canvas WP's instinct is to reach into it. **WP87 treats `plugin/src/files/canvas-sync.ts` as read-only.** If the attribution names a seam inside it, that is an **ESCALATE**, not an edit.
3. **`plugin/src/testing/e2e-control.ts` is contended by WP37, WP38, WP80, WP81, WP82 and WP83's disposition.** WP87 adds **at most one additive read-only** reader and only if AC4 cannot be satisfied by the landed `canvas.textShape` (`:905`). Any new module it needs is reached by **dynamic `import()`**, on WP37's landed precedent — never by amending the frozen import allow-list, and **never mentioned in a comment**: the allow-list regex reads comments and has already reddened three tests that way (`wp49/tp12`, `wp72/tp4`, `t3/wp44/tp12`).
4. **WP87 and WP88 do not depend on each other and share no file.** WP88's surface is `sync/**` + `session/session.ts` + `main.ts`'s session-lifecycle region; WP87's is `canvas/**` + `main.ts`'s reconcile region. **They collide in `main.ts` and therefore may not be batched together**, and that is the only relation between them. Either order is correct.

### §7 disposition — no `DONE` work package is re-opened, and no §7 licence of any class is taken

1. **WP37 is CONSTRAINED, not re-opened, and the form is WP37's own.** C37 AC2 (queue, do not drop), AC4 (no shadow advance for a deferred record) and AC5 (bounded, per record, three drains) stay in force and stay green. WP87 widens **who consults** the predicate; it changes nothing about what the predicate answers or what the queue holds. This is exactly how WP37 treated C5: *"constrained, not re-opened"* — the receipt seam was required to keep behaving as specified while a new caller was added beside it.
2. **C37 AC3 is DISCHARGED-OR-REPORTED, never amended.** Its positional half is recorded PARTIAL for a reason WP36 has since replaced with a narrower one. WP87 runs the criterion **as written** and reports the verdict. **Weakening it to "one marker survives" is the defect wearing the criterion's clothes** — C37's own §5 names that move by hand — and is an abort criterion.
3. **WP85 is not re-opened.** Its subject is *where the writer attaches*; WP87's is *what may reach a live editor*. `files/canvas-persistence.ts` and `files/canvas-mirror*.ts` are byte-unchanged (§2). If the attribution lands inside the writer, **ESCALATE** — see §2.
4. **WP36 is not re-opened.** No merge behaviour changes. WP36's known single-span limit is named in AC6 and left visible, exactly as WP36 left it.
5. **No inherited test is deleted, weakened, retitled, skipped or amended.** WP87 holds **no §7 licence of any class.** The WP37 test surface — `plugin/src/__tests__/v2/wp37/` (3 files carrying `CANVAS_EDIT_DRAIN_DELAY_MS` / `planEditingDeferral` / `classifyBusyGate` / `getEditingNodeId` **12 / 25 / 2** times respectively) — must stay green. A reddened assertion there is an **ESCALATE with the measured before/after, left red.**
6. **The 13 reddened inherited assertions from WP36 are NOT WP87's and must not be recorded as pre-existing breakage of WP87's own doing.** They are B32's subject, they are `[lww]` / `[intent-trace]` family rows only, and the Dispatcher's ruling on them is already written. The report states the count it observed and attributes it.
7. **If a type is added to `types.ts` it goes at the TOP**, beside `StaleReconcileDecision` — the WP22 dormancy-test comment-strip trap (`DEFAULT_SETTINGS`'s comment contains `` `${configDir}/**` ``, so JSDoc added below it closes the pairing and swallows `useCanvasBinding: false`). Inherited verbatim from WP80, WP81 and WP82; it has already cost this run once.

---

## 3. Architecture Context

*Task-local architecture guidance only.*

### Verified against the current tree (rule 12), 2026-08-05, branch `fix-bugs-and-raceconditions` at `fc10c5b` — measured, given, do not re-derive

**Verification 1 — the defect, quoted from the measurement that produced it.** `ImplementationReport_WP36.md` §4, diagnostic `H:\tmp\liveshare_wp36_s3_diag.py`, both peers driving real inline editors through `canvas.typeInNode`:

```text
--- both typed, NOTHING blurred yet
    A: doc='kollaboration'  surface='kolla1boration'(editor)
    B: doc='kollaboration'  surface='kollabo2ration'(editor)
>>> A blurred
    +2s   B.doc='kolla1boration'  B.surf='kollabo2ration'    <- B still holds its own text
    +4s   B.doc='kolla1boration'  B.surf='kolla1boration'    <- B's EDITOR was REPLACED
```

and the attribution row from the same run:

```text
>>> FAIL  S3 (ATTRIBUTION): the second typist's peer produced a text capture at all
      B receipts for c1 on this board: 0 []
```

**Three facts follow, and the third is the one that shapes this charter.**

- **The doc is correct on B before the destruction.** At `+2s` B's doc already holds A's value and B's surface still holds B's. So whatever destroys B's editor acts **after** the delta has been integrated — it is a *surface* event, not a merge event.
- **It is not a timing margin.** A second diagnostic (`…_s3_diag2.py`) removed the propagation window entirely, blurring both editors back to back: **same outcome, still zero receipts on B.** `CANVAS_EDIT_DRAIN_DELAY_MS = 2500` (`canvas/canvas-editing-deferral.ts:69`) is therefore **not** the mechanism and must not be tuned as if it were.
- **B emitted zero text captures for that board.** That is not a second symptom; it is the **instrument**. B's characters never reached B's own capture, so nothing about the merge, the three-way base or the shadow was ever consulted for them. **AC4 makes that number the oracle, because it is the one figure that cannot be satisfied by a view that merely looks right.**

**Verification 2 — the protection that exists, and its exact reach.** WP37 landed a per-record substitution: `main.ts:2033` calls `planEditingDeferral` with measured facts (`:2041` `adapter.getEditingNodeId?.() ?? null`, `:2043-2044` `adapter.getNodeFields(...)`), and the pure module at `canvas/canvas-editing-deferral.ts:188-266` returns `proceed` / `defer-drag` / `substitute` / `hold`. Under `substitute` the edited card's record is replaced by **what the surface itself reports holding** (`:253-255`), so Obsidian's node reuse leaves the live editor alone while every other record takes its new value.

**The consumer set of that predicate is small, closed and measurable.** Pattern (ERE, `grep -cE`) `getEditingNodeId|onEditingEnd|planEditingDeferral|classifyBusyGate|isBusy`, counted per file over `plugin/src/`:

| file | hits | role |
|---|---|---|
| `canvas/canvas-adapter.ts` | **16** | the definer of the signal — **positive control** |
| `main.ts` | **14** | every consultation in the plugin — **positive control** |
| `canvas/canvas-editing-deferral.ts` | **6** | the pure decision |
| `files/canvas-persistence.ts` | **0** | the only live doc→disk canvas writer (WP85) |
| `files/canvas-sync.ts` | **0** | the CRDT owner of `.canvas` |
| `files/vault-events.ts` | **0** | `handleLocalModify`, the live capture path |
| `canvas/canvas-shadow.ts` | **0** | the receipt seam |

**Rule 15, in both directions:** the pattern is an **ERE alternation** run with `grep -cE` (not `grep -F`, and not `grep -o`, whose `.` wildcard produced two false hits earlier in this run). It is proven able to match known-present lines by the two positive controls above — 16 and 14 hits in the two files where the mechanism demonstrably lives. The four zeros are therefore an **absence with a demonstrated detector**, not an absence of evidence.

**Verification 3 — the four candidate routes, with the receipt that tells them apart. AC1 chooses between these; this charter does not.**

| # | Route | Where it is in the tree | The receipt that names it |
|---|---|---|---|
| **R-A** | the reconcile pass, with the substitution running and **not sufficient** | `main.ts:1990` `classifyBusyGate` → `:2033` `planEditingDeferral` → `:2094` / `:2142` `adapter.reloadCanvasData` → `canvas-adapter.ts:1069-1083` `c.setData(data)` | the `reconcile <path>: … [deferred (inline editor on '<id>')]` line built at `main.ts:2099-2107` from `deferral.reason` (`canvas-editing-deferral.ts:262-264`), timestamped **inside** the destruction window |
| **R-B** | the reconcile pass, with the editing signal reading **null** at that instant | same call chain, but `adapter.getEditingNodeId()` (`main.ts:2041`) returns `null`, so `planEditingDeferral` takes the `proceed` branch at `:190` | a `structural reload ok` line at `main.ts:2098-2107` **without** any `deferred (…)` clause, while `link.report`-style live reads still show B's editor open |
| **R-C** | the **disk** write under the open leaf | `files/canvas-persistence.ts:395-410` `writeSnapshot` → `io.write(this.diskPath, content)`; the writer now attaches on a real leaf open (WP85), and it consults the editing predicate **0 times** (Verification 2) | the `CANVAS WRITER: <path> owner=CanvasPersistence nodes=… edges=…` line at `canvas-persistence.ts:405-408`, inside the window, with **no** reconcile line for that path in the same window |
| **R-D** | WP37's own **drain**, re-applying to the wrong peer's surface | `main.ts:2366-2369` `adapter.onEditingEnd(...)` → `setTimeout(… CANVAS_EDIT_DRAIN_DELAY_MS)` → `:2196` `drainCanvasDeferrals` → `:2205-2206` fresh snapshot → `reconcileLiveCanvas` | the `draining N deferred record(s) from M withheld pass(es) (inline editor blurred)` line at `main.ts:2200-2203`, on **B**, while B's editor is still open — i.e. an `EDIT WATCHDOG:` release (`canvas-adapter.ts:540-543`) fired on B |

**One inherited claim in the tree bears directly on R-C and is a claim, not a measurement.** `main.ts:2376` states, in a comment: *"Obsidian never reloads a canvas from an external write."* It was written for the cold-open case, **before WP85 made an open leaf carry a live disk writer**, and it has never been tested with an inline editor open. **R-C is exactly the state that would falsify it.** AC1 settles it in one direction or the other and the report records which — an inherited comment that turns out to be false is the same class as `skipsAutoTextSync`'s docstring, which several work packages in this run treated as a map.

**Verification 4 — why R-B is a live possibility rather than a formality.** The editing signal is a **pull**, re-measured on every consultation (`canvas-adapter.ts:614-630` `syncEditingFromDom`, `:653-668` `editingActive`), whose primary probe is Obsidian's own `node.isEditing` over the live node map (`:574-590`). It has two releases (`:653-668`): **positive liveness** — the edited card left the live node map, immediate — and **inactivity**, `EDIT_WATCHDOG_MS = 120_000`. And `syncEditingFromDom` at `:626-629` treats *"the DOM is readable and nothing editable inside a card has focus"* as **evidence of a blur**, which releases the flag **and fires the blur subscribers**. A programmatically driven editor whose focus is not where that probe looks would therefore be released, and both R-B and R-D follow from it. This is not speculation about the product; it is a reading of the probe's own stated contract, and it is why **AC1 must record `getEditingNodeId()`'s value on B at the moment of destruction** rather than inferring it.

**Verification 5 — WP37 measured the single-typist case and it is GREEN, which is what makes this a gap rather than a regression.** `ImplementationReport_WP37.md` §1, on the unmodified tree: a peer changing **another** card → editor survives; a peer **adding** a card → survives; a peer changing **the card being edited** → **destroyed**; and after the fix, `surface(c1)='card one-MINE034946' source='editor'` where it had been the peer's text. **The route WP37 repaired is real and works.** WP87's subject is the case where the remote change is another person's **blur commit** and the local peer is **in an editing session driven the same way** — a state WP37's suite never produced, because it only ever had one typist.

- **Component(s) being changed:** decided by AC1's attribution. The **permitted** surfaces are `plugin/src/canvas/canvas-editing-deferral.ts` (the pure decision), `plugin/src/canvas/canvas-adapter.ts` (the signal, if the attribution names R-B/R-D), `plugin/src/main.ts` (**wiring, injection and a verdict read only**), and `plugin/src/testing/e2e-control.ts` (**at most one additive read-only** reader). Any other file is an ESCALATE.
- **Constraints from BUILD_SPEC (invariants — what must not change):**
  - Invariants I1–I11 are binding and must not be weakened. **I5:** degradation is per-surface and honest, never a feature break. **I11:** a refusal never destroys — a route that cannot prove it is harmless withholds the **view** apply and nothing else.
  - **A deferral defers the VIEW apply. It never defers or suppresses the disk write.** C37's asymmetry, and it is what makes deferral safe: the file stays converged while the pixels are briefly stale. **If AC1 attributes to R-C, the repair is still not "stop writing the file"** — it is that the write must not be allowed to rebuild a view that is being typed into. Stopping the writer would re-introduce the WP85 defect and is an abort criterion.
  - `CanvasPersistence` remains the single CRDT→disk writer and emits zero CRDT writes.
  - `GEOMETRY_KEYS` keeps exactly `{x, y, width, height}` and stays exported. `ReconcilePlan` keeps exactly three verdicts.
  - `plugin/src/main.ts` may hold wiring and a verdict read, never logic.
  - **Zero new runtime dependencies** (D11).
  - New user-visible strings are **German** (§1 UI-language rule). Log signatures are uppercase ASCII machine contracts (§1 / §10): `EDIT WATCHDOG:`, `DRAG WATCHDOG:` and `CANVAS WRITER:` are **declared** signatures with exactly one production emitter each — **no existing signature, category, level or volume changes**, and a new one is declared in §10, not improvised.
  - **`useCanvasBinding` stays `false`.** No criterion may depend on P4-beyond-WP38 or P5 behaviour.
  - Biome reports a whole-file `format` finding per touched file (CRLF environment artefact). Advisory locally, gating in CI — do not mass-reformat.
- **Technology / framework / config constraints:** TypeScript + Yjs (`yjs ^13.6.0`), `plugin/` workspace, Vitest. Obsidian's Canvas view is private and untyped — **only `canvas-adapter.ts` may touch its internals.** Pure cores import nothing from Obsidian, the filesystem or a clock; the precedent is `canvas/reconcile-plan.ts` and `canvas/canvas-editing-deferral.ts`, which is already zero-import by contract (`:41-42`). No wall-clock sleeps in headless tests — timing is asserted by advancing an injected clock.
- **Entry points / relevant files:**
  - `plugin/src/main.ts` — the busy gate `:1986-1996`, the deferral call `:2031-2046`, the `hold` exit `:2053-2062`, the structural reload `:2094`, the geometry edge-reflow reload `:2142`, the receipt `:2160-2166`, the drain `:2196-2207`, the three drain call sites `:1829` (view close), `:2366-2369` (blur), `:2509` (teardown), the writer attach `:2300-2343`, the inherited external-write claim `:2376`
  - `plugin/src/canvas/canvas-editing-deferral.ts` — `CANVAS_EDIT_DRAIN_DELAY_MS` `:69`, `classifyBusyGate` `:86-92`, `planEditingDeferral` `:188-266`, `hold` `:268-288`, the coalescing queue `:337-388`
  - `plugin/src/canvas/canvas-adapter.ts` — `releaseEditing` `:530-553`, `probeEditingNode` `:574-610`, `syncEditingFromDom` `:614-630`, `editingActive` `:653-668`, `ensureEditingPatch` `:673-`, `isBusy()` `:968`, `getEditingNodeId()` `:990`, `onEditingEnd` `:1030`, `reloadCanvasData` `:1069-1083`, `DRAG_WATCHDOG_MS` `:260`
  - `plugin/src/testing/e2e-control.ts` — `canvas.typeInNode` `:867-903` (with the additive `at` caret offset `:882-891`), `canvas.textShape` `:905`, `canvas.file` `:752`, `canvas.state` `:643`, `sync.waitQuiescent` `:720`, the anti-pattern `simulateEdit` `:647` / `:995-1023`
  - Read-only context: `plugin/src/files/canvas-persistence.ts` (`writeSnapshot` `:395-410`, the receipt `:405-408`), `plugin/src/files/canvas-sync.ts` (**B32's, read-only**), `plugin/src/canvas/canvas-shadow.ts`, `plugin/src/canvas/reconcile-plan.ts:25`, `plugin/src/__tests__/v2/wp37/**`
- **Files this WP may NOT touch:** everything under `server/`, `plugin/src/canvas/canvas-binding.ts`, `plugin/src/canvas/canvas-model-bridge.ts`, `plugin/src/canvas/canvas-presence.ts` (WP21 AC2), `plugin/src/files/canvas-persistence.ts`, `plugin/src/files/canvas-mirror.ts`, `plugin/src/files/canvas-mirror-decision.ts`, `plugin/src/files/canvas-sync.ts` (**B32 live**), `plugin/src/files/manifest.ts`, `plugin/src/__tests__/dataloss/**`, `plugin/src/__tests__/v2/wp23/**`, `plugin/src/__tests__/harness/**`, the `DEFAULT_SETTINGS` block of `plugin/src/types.ts`, and `plugin/manifest.json` (a broken symlink to another machine, **S23**). **If the repair appears to require reaching into any of these, that is an ESCALATE, not a judgement call.**
- **Structure references:** *(intentionally empty — no Graphify graph exists for this project; FALLBACK mode is declared in BUILD_SPEC §3. Worker 3 fills this in after implementation. Do not invent paths here.)*

If structure references conflict with the BUILD_SPEC or explicit task scope, the BUILD_SPEC and TaskCharter win. Escalate instead of following the map.

### Ruling — does WP87 discharge C37 AC3's positional half?

**It removes the only known blocker, and it is required to run the criterion and report the verdict. It is not permitted to declare the criterion discharged from a layer below it.**

- **WP37 recorded AC3 PARTIAL for a reason that no longer holds.** Its stated cause was *"whole-string LWW means one marker must lose by construction"*. WP36 removed that: at the merge layer both markers survive in typed order, `kolla1bo2ration`, on both peers (`ImplementationReport_WP36.md` §4).
- **WP36 then recorded a narrower blocker, which is this WP.** *"Zero receipts. B's capture never ran for that board at all, so no merge decision was ever taken and the loss cannot be the merge's."* AC4 makes exactly that number the discriminating observable, and AC6 runs C37 AC3 through two live editors once it inverts.
- **The one thing that could still hold it open is WP36's own known limit, not WP87's subject.** A single-span local diff from a stale base can re-author one character (`kolla1bo22ratio`, `ImplementationReport_WP36.md` §5.2) — no data lost, replicas agree, but **a value nobody typed**. If that fires in AC6's run, **C37 AC3 is reported PARTIAL against WP36's named limit and WP87 is still complete**, because the loss WP87 owns — a peer's characters destroyed in the view — has been closed. **What is forbidden is reporting AC3 green from `canvas.textShape` or from the doc.** That is the layer WP36 already satisfied, and it is not the open half.

---

## 4. Acceptance Criteria

*Each criterion names **the observable that proves it** and **what would make it vacuous**.*

*Acceptance evidence is **two LIVE Obsidian instances** driven through the E2E rig — `POST http://127.0.0.1:39431/command` (vault A) / `:39432` (vault B), body `{"cmd","args"}`. **Blind sets are discontinued** — no `blind_set1`, no `blind_set2`, no falsification injection and no `BlindVerificationLedger` row is owed. Headless tests against injected fakes are the honest tool wherever a state cannot be produced live, and are named as such per row. **Every leaf is opened with `canvas.typeInNode{open:true}` and empty text; `canvas.open` is never sent (S45). `canvas.simulateEdit` is never called.** **Every live row records the role its instance actually resumed as, quoted from its own `[session] resuming as …` line** — the relay's election is a coin flip (**S37**: 34 role transitions on one vault in 2 h 05 min) and a green that does not record the role is a green on a coin toss.*

1. **The destruction is reproduced live, on demand, in both role orders — and is attributed by receipt to ONE named seam before anything is repaired.**
   - **Deliverable:** a live scenario with two typists in the **same card**: A types a marker at one offset, B types a different marker at a different offset, **neither blurs**, then **A blurs**. The scenario samples B's surface (`canvas.typeInNode` with empty text, reading `textAfter` and its `source`) at bounded intervals across the window in which WP36 measured the replacement.
   - **Observable (live, RED):** B's surface holds B's marker before, and A's committed value after — the `+2s / +4s` shape of `ImplementationReport_WP36.md` §4, reproduced. Run in **both role orders**.
   - **Observable (attribution) — this is the criterion, not the reproduction:** the run records, for B, in the destruction window: **(a)** `adapter.getEditingNodeId()`'s value; **(b)** whether a `reconcile <path>: …` line was emitted and whether it carried a `deferred (inline editor on '<id>')` clause (`main.ts:2099-2107`); **(c)** whether a `CANVAS WRITER: <path> owner=CanvasPersistence` line was emitted (`canvas-persistence.ts:405-408`); **(d)** whether a `draining N deferred record(s) …` line was emitted (`main.ts:2200-2203`); **(e)** whether an `EDIT WATCHDOG:` release fired (`canvas-adapter.ts:540-543`). The report names **exactly one** of **R-A / R-B / R-C / R-D** (§3 Verification 3) as the route, quotes the receipt that names it, and states what the other three showed. **A repair may not be written before this row is recorded.**
   - **Additionally required, because it settles an inherited claim:** if the route is **R-C**, the report states that `main.ts:2376`'s comment — *"Obsidian never reloads a canvas from an external write"* — is **false with an inline editor open**, and the comment is corrected. If the route is not R-C, the report states that the claim was **tested and held** under this scenario. Either way it stops being an untested assertion in the tree.
   - **Vacuity risk — named:** first and worst, **attribution by adjacency** — naming the route that was nearest rather than the one with the receipt. WP81 chartered a symptom that did not exist and WP86's traced mechanism was wrong in the worse direction; both were caught by a receipt, not by a reading. Second: **B's characters were already flushed** before A's commit landed, in which case nothing was destroyed and the row measures nothing — WP37's `present_in_file=False` vacuity guard is required **verbatim in form**, asserted for B before A blurs. Third: asserting only *"B's marker is gone"*, which is also true of a run in which B never typed — B's typed text must be shown present at B's surface with `source='editor'` first. Fourth: reaching either canvas with `canvas.open` (**S45**), which produces every observation on its own and invalidated five suite rows for months. Fifth: a single role order, which is a coin toss on the relay's election (**S37**).

2. **The editing-aware predicate has ONE definer, and the set of routes that must consult it is DERIVED FROM THE TREE by a test.**
   - **Deliverable:** a test that enumerates, from the parsed tree rather than from a filename list, every production site that can put a remote-sourced record onto a live canvas surface, and pins that each such site consults the landed predicate (`canvas-adapter.ts`'s `getEditingNodeId` / `isBusy`, via `canvas-editing-deferral.ts`'s `classifyBusyGate` / `planEditingDeferral`). **No second predicate is authored** — rule 10, and the enumeration is what proves it: exactly one definer, its call sites named.
   - **Observable (headless, structural):** the derived set is non-empty, contains the site AC1 named, and each member is shown to consult the definer. **The deriver carries a mandatory reverse assertion — that it finds a site known to exist** — and that reverse assertion is shown to fail if the deriver is fed a module with no such site.
   - **Observable (rule 15, both directions):** the absence claim *"these files do not consult the predicate"* is stated with its pattern, its tool and its positive control. The charter's own measurement is the baseline to reproduce: ERE `getEditingNodeId|onEditingEnd|planEditingDeferral|classifyBusyGate|isBusy` under `grep -cE` gives **16** in `canvas/canvas-adapter.ts` and **14** in `main.ts` (the positive controls) against **0** in `files/canvas-persistence.ts`, `files/canvas-sync.ts`, `files/vault-events.ts` and `canvas/canvas-shadow.ts`. The report states which tool it used; **`grep -o` is forbidden for literals — its `.` wildcard produced two false hits in this run — and `grep -F` is used where the pattern is a literal.**
   - **Vacuity risk — named:** **S53, the recursive one** — WP86's census deriver first returned an **empty** set, and *"every derived site is pinned"* passed perfectly on it. The reverse assertion is the only defence and may not be trimmed. Second: a census assembled from a **filename allowlist**, which cannot catch the route nobody thought of and is the exact failure `skipsAutoTextSync`'s caller list already produced. Third: asserting that the predicate is **called** rather than that its **verdict is honoured** — a site that consults it and ignores the answer satisfies a call-site check and destroys the editor anyway.

3. **The repair is at the record, and BOTH halves are asserted: B keeps its characters, and A's committed value still arrives.**
   - **Observable (live, GREEN, both role orders):** the AC1 scenario re-run on the repaired bundle. B's surface still holds B's marker after A's blur, `source='editor'`, at every sample across the window that was RED. **And the reciprocal half:** B then blurs, and after `sync.waitQuiescent` **A's committed value is present** — on B's surface, in B's `canvas.file` and in B's `canvas.state` — together with B's own. **Neither peer's characters are lost, and neither peer's change is dropped.**
   - **Observable (live, the per-record half, inherited from C37 AC2):** while B's editor is held, a change by A to a **different** card **does** reach B's view. The board does not stop updating because somebody is typing.
   - **Vacuity risk — named:** asserting only that B's marker survived. **A build that ignores every remote delta while any editor is open passes that**, and it is precisely the shape WP37 measured, refused and wrote into `canvas-editing-deferral.ts:208-215` (*"holding it therefore bought nothing and cost a board that stops updating"*). The discriminating assertions are the reciprocal arrival of A's value and the unrelated card updating, and both must be shown to distinguish the repaired build from a hold-everything build. Second: asserting the **queue's contents** rather than the view and the file — C37 AC2's named trap, *"which measures the queue rather than the view"*. Third: reading B's text from `canvas.state` alone; `canvas.state` is a doc-level read and was already correct at `+2s` in the RED run, so it cannot discriminate. **The surface read is the oracle.**

4. **The second typist's own capture runs — the zero that attributed the defect must invert, and be shown to.**
   - **Observable (live, before and after):** B's per-write text-capture receipts for that board, read through the landed `canvas.textShape` (`testing/e2e-control.ts:905`), are **0** on the unrepaired bundle (reproducing `B receipts for c1 on this board: 0 []`) and **≥ 1** on the repaired one, for the same scenario, in both role orders. The count is recorded, not described.
   - **Vacuity risk — named:** counting receipts on a board B never typed into, or over a window that includes B's warm-up. The board, the node and the window are named per row and B's typed text is shown present at B's surface first. Second: counting a receipt produced by WP37's **drain** rather than by B's own blur — the two are distinguishable by the `draining N deferred record(s) …` line (`main.ts:2200-2203`) and the row states which produced it. Third: reporting the count without the RED half; **a number with no before is not a measurement**, and this is the one figure that attributed the defect in the first place.

5. **Nothing WP37 landed is weakened, and the deferral cannot become permanent.**
   - **Observable (headless, injected clock, no sleeps):** the four-row `isBusy()` truth table `{drag, editing} × {on, off}` still holds; `DRAG_WATCHDOG_MS = 5000`, `dragActive()`, `isDragTarget` and the `DRAG WATCHDOG:` signature are byte-unchanged, quoted in the report; both `EDIT WATCHDOG:` releases still fire and still fire the blur subscribers; the three drains — blur (`main.ts:2366`), view close (`:1829`), teardown (`:2509`) — are each asserted **separately** and each leaves nothing queued.
   - **Observable (live):** after the AC3 scenario completes and both editors are blurred, **both peers' canvases converge** — `canvas.file` and `canvas.state` agree on both — and neither peer is left with a permanently stale view. A repair that protects an editor by never applying anything again is a worse defect than the one it replaces.
   - **Vacuity risk — named:** asserting the constants by **reading** them rather than by driving the behaviour they govern — C37 AC5's named trap (*"a bound asserted by reading a constant rather than by driving a burst past it"*). Second: exercising only the blur drain and asserting close/teardown by argument; they differ in what still exists when they run. Third: changing `CANVAS_EDIT_DRAIN_DELAY_MS`, `EDIT_WATCHDOG_MS` or `EDIT_POLL_MS` as the repair. **The diagnostic that removed the propagation window entirely changed nothing** (§3 Verification 1) — a timing change here is a repair aimed at a mechanism already falsified, and any change to those three constants must be argued from a measurement in the report or not made.

6. **C37 AC3 is run end to end through two live inline editors, and its verdict is REPORTED — not assumed, not weakened, not claimed from a lower layer.**
   - **Observable (live, both role orders):** the C37 AC3 scenario **as written**: A focuses card X's inline editor and types a marker; while A is still focused, B inserts a different marker at a **different offset inside the same word** (`canvas.typeInNode` with the additive `at` caret offset); both blur; after `sync.waitQuiescent`, **both markers are present in `canvas.file` and in `canvas.state` on both vaults, in the correct relative order**, and **both typists' characters are present**. The preconditions are asserted, not assumed: each typist's characters reached the **editor** (`source='editor'`) and were **not yet in that peer's own `.canvas` file** when the other's change landed.
   - **Deliverable (a statement, not code):** the report states plainly whether C37 AC3's positional half is now **satisfied end to end**, and if not, **which named limit holds it open**.
   - **Vacuity risk — named:** claiming AC3 from `canvas.textShape` or from the doc. **WP36 already established the merge layer** (`kolla1bo2ration`); that is not the open half, and reporting it as AC3 would be the run's signature failure — a green measured one layer below its subject. Second: weakening the criterion to *"one marker survives"* to obtain an earlier green, which C37 §5 names by hand as *"the defect wearing the criterion's clothes"* and which is an abort criterion here. Third: reporting green while WP36's single-span limit re-authored a character (`kolla1bo22ratio`) — that outcome is **PARTIAL against WP36's named limit**, reported as such, and it does not block WP87.

**Definition of Done:** two people type into the same card, one of them blurs, and **neither of them loses a character** — demonstrated on two live Obsidian instances, in both role orders, with the second typist's own capture receipts shown to have gone from zero to non-zero.

---

## 5. Constraints and Known Risks

- **Permission / environment limits:** Windows dev host. Run tests from the workspace root, never from a subdirectory; long-running invocations through `visible-console` `run_python` / `run_command` with **absolute** paths and an **explicit `session_key`**, never a Bash background process. **`run_command` without an explicit `session_key` has been answered `"reused"` against an unrelated console, after which `await_console` reported `completed / exit 0` for a run that never happened** — verify the artefact (the installed digest), never the exit status. **The two owner vaults, the two control ports (39431 / 39432) and `H:\tmp\liveshare_*.py` are shared with other work** — check `DISPATCHER_STATE.md` and the task registry before launching, installing, restoring or resetting anything, and never during another agent's run. **The relay is production and is shared:** `GET /healthz` is the only permitted relay interaction; no room is created or deleted and no relay process is touched.

- **Known risks specific to this WP:**
  - **⚠ The most likely wrong move is to repair before attributing.** Four routes are live and three of them are wrong. A repair aimed at R-A when the destroyer is R-C changes nothing and goes green anyway if the scenario is loose enough. **AC1 is first for that reason and its receipt requirement may not be trimmed.**
  - **⚠ The second is a second predicate.** *"The writer just needs to know whether an editor is open"* is a two-line change that creates a second answer to a question that already has one, and the next edit to the real one will not reach it. **Rule 10, abort criterion.** The precedent is `promoteToHost`, which had a second hand-rolled copy until the data-loss batch routed both through one.
  - **⚠ The third is a build that stops applying remote changes while anyone types.** It passes *"B's marker survived"* trivially. WP37 already built that, measured it, and removed it with the reasoning written into `canvas-editing-deferral.ts:208-215`. AC3's reciprocal half is the defence.
  - **⚠ The fourth is tuning a timing constant.** `CANVAS_EDIT_DRAIN_DELAY_MS` is the obvious suspect and is **falsified**: the second diagnostic removed the propagation window entirely and changed nothing (§3 Verification 1).
  - **⚠ The fifth is reaching into `files/canvas-persistence.ts` or `files/canvas-sync.ts`.** The first is WP85's declared non-scope; the second is **B32's live working file** at charter time. Both are ESCALATEs.
  - **⚠ The sixth is `canvas.open`.** It is one line, it looks like the obvious way to reach a canvas, and it **permanently disables the writer attach** (S45). Every scenario in this run that used it measured the rig. Use `canvas.typeInNode{open:true}` with empty text.
  - **⚠ Do not attribute the 13 red assertions to this WP.** They are WP36's superseded `[lww]` / `[intent-trace]` rows and are B32's subject. The report records the executed count it observed and names them.
  - **⚠ Do not mirror any generated test suite into `plugin/src/__tests__/` before this WP is implemented.** `tsc` typechecks `src/` including tests, so an unimplemented mirrored suite breaks `npm run build` **repo-wide** for every other WP. Violated once already in this run.
  - **⚠ Both vaults' `data.json` hold live credentials.** Never printed, logged, echoed into a report, a commit message or a fixture. **Keys may be named; values may not.** Comparison is sha256-of-bytes only.
  - **⚠ A digest guard proves WHICH build, not WHOSE (S46).** A sibling has twice installed a bundle containing another batch's uncommitted work, silently invalidating a RED baseline. **Also grep the installed bytes for a marker unique to this batch's own change** before trusting any RED or GREEN.

- **Known flaky patterns:**
  - **The relay's host election is a coin flip** (S27 / S37). No criterion may depend on which vault is host; every live row records the role its instance resumed as, from its own `[session] resuming as …` line, and every criterion is run in **both** role orders.
  - **The E2E suite is not idempotent.** Every scenario creates its own canvas (or its own node ids), asserts its **precondition** before its postcondition, and records a SKIP as a SKIP.
  - No wall-clock sleeps in headless tests; timing is asserted by advancing an injected clock. Live waits are `sync.waitQuiescent` or a bounded wait that names the condition it was waiting for on expiry.
  - Do not assert on log strings as the primary oracle — **except** in AC1, where the receipt **is** the attribution instrument. State is the oracle everywhere else.
  - A test that asserts an absence — *"B's view did not change"* — is suspect by default and is paired here with the positive assertion that discriminates.
- **External dependency risks:** none permitted (D11).
- **Hard constraints:**
  - **Attribution by receipt precedes repair. Exactly one route is named, with the receipt quoted, and the other three are reported as what they showed.**
  - **One definer. No second editing predicate is authored anywhere (rule 10).**
  - **The route set is DERIVED FROM THE TREE, with a mandatory reverse assertion that the deriver finds a site known to exist (S53).**
  - **Every absence and every presence claim states its pattern and its tool and carries a positive control (rule 15 and its cousin). `grep -F` for literals; `grep -o` is forbidden.**
  - **`canvas.open` is never called. `canvas.simulateEdit` is never called. Every leaf is opened with `canvas.typeInNode{open:true}`, empty text, no blur.**
  - **The deferral defers the VIEW apply only. The disk write is never deferred or suppressed.**
  - **The decision is headless. `main.ts` gains wiring and a verdict read — a conditional over canvas state in `main.ts` is a §7 abort criterion.**
  - **`DRAG_WATCHDOG_MS`, `dragActive()`, `isDragTarget` and `DRAG WATCHDOG:` are byte-unchanged. `ReconcilePlan` keeps three verdicts. `canvas-presence.ts` is byte-unchanged.**
  - **`files/canvas-persistence.ts`, `files/canvas-mirror*.ts`, `files/canvas-sync.ts`, `server/**` and `plugin/manifest.json` are byte-unchanged. `useCanvasBinding` is not flipped. The plugin version is not bumped.**
  - **No existing log signature, category, level or volume changes. Any new signature is declared in §10.**
  - **C37 AC3 is run as written and its verdict reported. Weakening it is an abort criterion.**
  - **No `DONE` work package is re-opened; WP87 holds no §7 licence of any class.** A reddened inherited assertion — in particular under `plugin/src/__tests__/v2/wp37/` — is an **ESCALATE with the measured before/after, left red.**
  - **Not batched with any other `main.ts` WP. `git status` re-read immediately before every commit (rule 14). No `git checkout --`, `git restore` or `git stash` on any path this batch did not create.**

### Recorded, not repaired — this WP's own sweep

- **`main.ts:2376`'s external-write claim is untested.** *"Obsidian never reloads a canvas from an external write"* was written before WP85 made an open leaf carry a live disk writer, and has never been evaluated with an inline editor open. **AC1 settles it in one direction or the other.** Recorded here so that, whichever way it falls, it stops being an inherited assertion the next work package treats as a map — the `skipsAutoTextSync` lesson.
- **WP36's single-span diff limit** (`ImplementationReport_WP36.md` §5.2) — a value nobody typed, reachable when the local base is stale. **Named in AC6, not repaired.** Closing it needs a multi-span LCS diff. **Unowned.**
- **`ImplementationReport_WP36.md` §5.4: the convergence fuzzer's `text-edit` op was deliberately not registered**, because the two judging families for `text` currently assert whole-string LWW. **B32's**, and named here only so WP87 does not attempt it.

---

## 6. Definition of Done Artifacts

- **Required changed files:** determined by AC1's attribution, from the permitted set only — `plugin/src/canvas/canvas-editing-deferral.ts`, `plugin/src/canvas/canvas-adapter.ts`, `plugin/src/main.ts` (**wiring and a verdict read only**), and **at most one additive read-only** case in `plugin/src/testing/e2e-control.ts`. Any file outside that set is an ESCALATE.
- **Already landed by Worker 2 with this charter — NOT implementor work:** the §9 WP87 row and the §7 / header counts (85 → 87 live, entered together with WP88), re-derived from §7 and §9 rather than edited independently. **The implementor does not edit `BUILD_SPEC_CanvasV2.md`.**
- **Required report:** `ImplementationReport_WP87.md` (in `workflowArtifacts/canvas-v2/`), which must additionally record: **AC1's attribution in full** — the one named route, the receipt quoted, and what each of the other three showed, plus `getEditingNodeId()`'s value on B in the destruction window and the disposition of `main.ts:2376`'s claim; the **RED reproduction in both role orders** with the role each instance resumed as, quoted from its own `[session] resuming as …` line, and B's `present_in_file=False` precondition asserted; **AC2's derived route census** with its reverse assertion, its patterns, the tool used for each, and the positive control for every absence and presence claim; **AC3's GREEN in both role orders**, both halves — B's characters surviving **and** A's committed value arriving — plus the unrelated-card row that distinguishes the repair from a hold-everything build; **AC4's receipt counts before and after**, per board and per window, with the statement of which mechanism produced each; **AC5's four-row truth table, both `EDIT WATCHDOG:` releases, and the three drains asserted separately**, with a quoted statement that `DRAG_WATCHDOG_MS` and the drag behaviour are byte-unchanged and that no timing constant was changed (or, if one was, the measurement that required it); **AC6's C37 AC3 run end to end with its plain verdict** and, if PARTIAL, the named limit that holds it open; a positive statement that **`canvas.open` was never called, `canvas.simulateEdit` was never called**, and every leaf was opened with `canvas.typeInNode{open:true}`; that `files/canvas-persistence.ts`, `files/canvas-mirror*.ts` and `files/canvas-sync.ts` are byte-unchanged; that **no logic was added to `main.ts`**; the **executed test count** before and after, with the 13 WP36-superseded red assertions **named and attributed to B32** rather than recorded as pre-existing breakage; the statement that no existing test was deleted, weakened, retitled, skipped or amended and that **no §7 licence of any class was taken**; and, for every live run, which vault ports were used, that **no `data.json` value was read or printed**, that the installed bytes were grepped for a marker unique to this batch (S46), and that both vaults were left with no link silenced and no scenario artefact holding an editor open.
- **BUILD_SPEC updates required:** no — the §9 row and the counts were entered when this charter was written. Anything further is an **ESCALATE** rather than a spec edit.
- **Gate status required at handover:** `npm run build` (tsc + esbuild) PASS and `npm test` from `plugin/` with the executed count recorded and every failure attributed by owner. `npm run lint` advisory locally, gating in CI — do not mass-reformat. **The canvas E2E baseline is NOT 19/19 and is not to be claimed as one** — WP85 established that the figure quoted all week was measuring the rig, and the baseline has never been re-established. Whatever it reads is recorded as a measurement.

---

## 7. Visible Test Cases / Producer Artifacts

*Filled by Worker 3. Worker 2 leaves this section empty.*

*⚠ **Blind sets are discontinued for new work** (owner's instruction, 2026-08-05): no `blind_set1`, no `blind_set2`, no falsification-injection requirement and no `BlindVerificationLedger` row is owed by this WP. Validation is W4 against two live Obsidian instances, with headless tests carrying the rows a live instance must not be abused to produce. E2E-plugin defects found while validating go back to **W3 as a revision**.*

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
