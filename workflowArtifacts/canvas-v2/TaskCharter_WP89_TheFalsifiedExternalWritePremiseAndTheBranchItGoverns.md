# Task Charter — WP89: the falsified external-write premise, and the branch it still governs

<!-- Updated: chartered 2026-08-05 (B42, Worker 2) from `DEVELOPMENT_REPORT_CanvasV2_II.md` §6.7 and §7 item 15, re-verified independently against the tree per rule 12 on branch `fix-bugs-and-raceconditions` at `a10f4c2`. ⚠ THE ITEM AS FILED IS RIGHT ABOUT THE RESIDUE AND — ON THE EVIDENCE THIS CHARTER MEASURED — WRONG ABOUT WHAT IT COSTS. The audit's four sites are confirmed at the exact lines it gave (`canvas-sync.ts:2028`, `:2265`, `:2798`, `:3863`), and the audit's own caveat ("traced, not measured") is respected: this charter settles the branch STATICALLY and hands the live half to AC1. The static settlement is that `SurfaceState.viewOpen` is NOT "is a leaf open" — `main.ts:206-208` constructs the store as `createSurfaceStateStore((path) => this.canvasAdapters.get(path)?.isAvailable() === true)`, i.e. `viewOpen` means "there is an available CanvasAdapter for this path", which is the SAME predicate `reconcileLiveCanvas` early-returns on at `main.ts:2378`. The two receipt routes are therefore complementary BY CONSTRUCTION and the branch is a route selector, not a claim about Obsidian's reload behaviour. Flipping it to advance unconditionally would advance the shadow past a record the surface did NOT take, which is WP87 §2.3 (S57) measured and repaired. So the expected disposition is COMMENTS + ENFORCEMENT, not a behaviour change — and AC1 exists to make that a measurement rather than this paragraph. THE NEW FINDING, which the item as filed does not contain: `planCanvasDiskWrite` (`canvas/canvas-editing-deferral.ts:365-415`) withholds the disk write ONLY for a positively identified inline editor, while `classifyBusyGate`'s `defer-drag` arm (`main.ts:2394-2399`) defers the VIEW apply and leaves the disk write running on the stated ground that "the trailing disk write keeps data safe". Under WP87's measurement an external write REBUILDS the open view for a change to ANY card — so a peer's delta landing during a local drag reaches the surface the drag gate deliberately refused to touch. Traced, not measured; AC4 owns it. No Obsidian was launched for this charter, no vault file was read or written, no E2E script was run, no `data.json` was opened, no relay was contacted, no `plugin/src/**` file was edited, and no `session.info` call was made: every line number below was measured by reading the tree at `a10f4c2`. -->
**Charter Status:** `SPEC_COMPLETE`
**WP:** WP89
**Phase:** P0
**task_mode:** `standard`
**Depends on:** WP87 (`DONE`, `012f896`/`dc1abc0`) — its measurement is the input and its `canvas.editingSignal` reader is **consumed, never duplicated**. WP5 (`DONE`), WP4 (`DONE`) — the shadow and the receipt seam are read, not redesigned. **MUST NOT be batched with WP90, with B41, or with any other `main.ts` / `canvas-sync.ts` work — see §2 Ordering.**
**W4 Test Targets:** `0`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** every place in the tree that still asserts *"an open canvas ignores external file writes"* either says what is true or is gone, **and the one live branch that reads as if it rested on that premise has a measured verdict on the record** — correct, or repaired. After this WP a reader of `canvas-sync.ts` cannot inherit a false map from it, and a future change that re-asserts the premise reddens a test instead of being reviewed by eye.
- **The question this charter answers, and it is answered by measurement rather than by argument:** *does the `viewOpen === false` gate on `advanceShadowFromContent` still hold under WP87's measurement?* **This charter's static answer is YES, for a reason that has nothing to do with the premise in the comment** — see §3. **AC1 must settle it live before a character of repair is written.** If AC1 confirms the static answer, this WP is a comment-and-enforcement WP and that is a **complete and valuable outcome**, not a shortfall. If AC1 falsifies it, the repair is at the receipt route and AC5 constrains its shape.
- **Why this is chartered at all, given the expected answer is "the code is right".** The run has now been bitten **twice** by prose treated as a map: `skipsAutoTextSync`'s consumer list (the Dispatcher briefed a worker that a TRUE claim was false, `DEVELOPMENT_REPORT_CanvasV2_II.md` §6.1), and this premise, which **three work packages reasoned from** (`ImplementationReport_WP87.md` §10: *"For months the tree said in a comment that an open canvas ignores external writes, three work packages reasoned from it, and it is false"*). A comment that several work packages read as a map is a specification with no test behind it. The deliverable is therefore not "fix four comments" — it is **retire the class**, by deriving the sites from the tree and by deciding, in writing, whether the corrected statement is *enforced*.
- **Why P0.** The Surface-Shadow is the operand of the capture diff, which is the mechanism the whole P0 repair rests on (BUILD_SPEC §5 PHASE P0, WP1/WP2/WP4/WP5). A branch that decides whether the shadow advances is P0 machinery whatever its verdict turns out to be, and the drag exposure in AC4 lands on the same live surface WP37 and WP87 exist to protect.
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 9, work package **WP89**; section 5 PHASE P0 (the shadow and the per-field apply receipt); section 7 (Quality Gates). Phase **P0**.

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: modify, **one repository** (`obsidian-live-share`, branch `fix-bugs-and-raceconditions`), **`plugin/src/` only**.
  - Responsibility: settle the `viewOpen === false` branch **by live measurement, before any repair**; derive from the tree the complete set of sites asserting the falsified premise; correct each in place with the measurement beside it; decide and record whether the corrected statement is enforced by a test; and report the drag exposure with a verdict.
  - Scope summary: AC1 the settlement · AC2 the derived site census and the corrections · AC3 the enforcement decision · AC4 the drag exposure, measured and reported · AC5 the shape constraint on any repair.
- **Out of scope / non-goals — each of these is an ESCALATE, not a judgement call:**
  - **⚠ `server/**`.** Untouched. A `server/` edit outside WP41 is a §7 abort criterion. `GET /healthz` is the only permitted relay interaction; no room may be created, deleted or mutated.
  - **⚠ `plugin/src/canvas/canvas-shadow.ts`.** WP5's file, and WP87 deliberately did not touch it (`ImplementationReport_WP87.md` §2.3: the `buildApplyReceipt` / `nodeOutcomes` asymmetry is **named and unowned**). WP89 does not repair that asymmetry either. If AC1 falsifies the branch and the repair lands inside `canvas-shadow.ts`, that is an **ESCALATE**, because it re-opens WP5's declared surface and because the asymmetry is a distinct unowned finding that deserves its own attribution.
  - **⚠ `plugin/src/files/canvas-persistence.ts`.** WP85's declared boundary, **byte-unchanged** since WP85 and kept so by WP87 (which decorated the injected `PersistenceIO` in `main.ts` rather than editing the writer). WP89 has no reason to touch it and touching it is an **ESCALATE** on WP87's own precedent.
  - **⚠ `planCanvasDiskWrite`'s fail-open direction.** `canvas/canvas-editing-deferral.ts:353-364` states it explicitly: withholding a *view* apply costs stale pixels; withholding a *disk* write with nothing to release it is WP85's defect rebuilt, so **only a positively identified editing session withholds and every unknown writes.** AC4 **reports** the drag exposure; it does **not** extend the withhold to drags. Extending it is a product decision with a measured counter-example behind the current direction (WP87 §4.2: the ceiling exists because an over-reporting signal withheld a write and put a stale node in a `.canvas`) and is not taken here.
  - **⚠ `getEditingNodeId()`'s over-report (S61).** WP37's predicate, one definer, bounded by WP87's ceiling and **explicitly unowned**. WP89 consumes it and does not narrow it. Authoring a second editing predicate is **rule 10** and an abort criterion.
  - **⚠ `useCanvasBinding`, `canvas-binding.ts`, `canvas-model-bridge.ts`, `canvas-presence.ts`.** Frozen; flipping the flag or editing those files is a §7 abort criterion. **S59** (the P5 binding path reaching the view mutators and consulting the editing predicate zero times) is recorded and not this WP's.
  - **⚠ Any timing constant.** `CANVAS_EDIT_DRAIN_DELAY_MS` (2500), `EDIT_WATCHDOG_MS` (120 000), `EDIT_POLL_MS` (400), `DRAG_WATCHDOG_MS` (5000), `CANVAS_MAX_WITHHELD_FLUSHES` (8) and `VAULT_EVENT_SETTLE_MS` keep their values. WP87 pinned the first four by test; WP89 does not move any of them.
  - **⚠ `canvas.simulateEdit`.** Not used, not extended, not repaired. Its shape — a direct `Y.Doc` write (`testing/e2e-control.ts:995-1005`) plus a hardcoded `applied: true` (`:1023`) — is **explicitly forbidden** for anything this WP adds.
  - **⚠ `canvas.open`.** Not called by any criterion (**S45**): it subscribes directly, opens **no leaf**, and permanently consumes the `!isSubscribed` opportunity that would have attached the disk writer. Every leaf in every criterion is opened via **`canvas.typeInNode{open:true}`** with empty text and no blur, on WP87's landed precedent.
  - **⚠ `plugin/manifest.json`** — a broken symlink (git mode **120000**, verified at `a10f4c2` by `git ls-files -s`). Not read, not edited, not repaired. **S23**, Tier 0, and it is not WP89's.
  - **⚠ `WORKFLOW_ANALYSIS.md`** — untracked and not this batch's. Not read, not edited, not committed.
  - **⚠ Any new runtime dependency.** D11 — an ESCALATE.
- **Known interfaces / dependencies:**
  - Input: `CanvasSync.noteExternalDiskWrite` (`files/canvas-sync.ts:3855`), `CanvasSync.advanceShadowFromContent` (`:3597`), `CanvasSync.surfaceStateProvider` (`:2057-2060`, wired at `main.ts:1883`), `createSurfaceStateStore` (`canvas/canvas-shadow.ts:1105`), `Plugin.reconcileLiveCanvas` (`main.ts:2371`), `classifyBusyGate` / `planEditingDeferral` / `planCanvasDiskWrite` (`canvas/canvas-editing-deferral.ts`), `adapter.describeEditingSignal()` via the landed `canvas.editingSignal` rig case.
  - Output: the derived site census and its corrections; **at most one** additive read-only E2E surface if AC1 cannot be satisfied through `canvas.state` / `canvas.file` / `canvas.textShape` / `canvas.editingSignal`; the enforcement test if AC3 rules for one.
  - **Blocks nothing.** It unblocks nothing either. Its value is that the next work package in this area inherits a true map.

### Ordering — what must NOT be batched together

Measured at charter time (`git status`, `git log`, `a10f4c2`), and stated as a measurement, not a timeless fact (rule 5):

1. **`plugin/src/files/canvas-sync.ts` is contended by WP90**, which this batch chartered alongside this one: WP90's subject includes the `SeedRefusalLedger` doc comment at `:1455-1462` and the ledger's producers at `:2011`, `:3721-3726`, `:3753-3761`. **WP89 and WP90 must not be in flight in the same batch**, and neither may be batched with anything else editing that file. At `a10f4c2` the file is **byte-identical to WP38's checkpoint `a1c435e`** (`git log -3 -- plugin/src/files/canvas-sync.ts`), so it is currently quiet — the implementor re-measures rather than trusting this sentence.
2. **`plugin/src/main.ts` is contended by nearly everything** and by WP90 specifically (its `attachCanvasPersistence` wiring at `:2884-2892`). WP89's `main.ts` surface is the reconcile region (`:2371-2585`) and the writer-decoration region (`:2840-2900`); WP90's is the persistence-attach region. **They overlap.** Not batchable, in either direction. Rule 14 makes region-disjointness insufficient: a sibling reverted a shared path between WP81's edit and its stage (**S34**) and it was caught **only** by re-reading `git status` immediately before the commit.
3. **⚠ B41 must be finished, and its answer read, before AC1 runs.** B41 is investigating the schedule dependence B39 measured (`DEVELOPMENT_REPORT_CanvasV2_II.md` §4.2b): five canvas-suite checks green on wall-clock gaps rather than on the product, with the leading hypothesis *"a second whole-file write to the same `.canvas` shortly after a previous one, against Obsidian's debounced `requestSave`"*. **That hypothesis is about this seam.** `noteExternalDiskWrite` owns `recentDiskWrites` and the `externalWriteSettleTimers` window (`canvas-sync.ts:3868-3877`), and `handleLocalModify` returns immediately for a path inside it (`:2965`). If B41 attributes the dependence to a second write in that window, its finding is an **input** to AC1 and possibly to AC4. Running AC1 first would measure the same seam twice and risk the two batches inheriting each other's premise — which is exactly how WP81's non-existent symptom was "independently reproduced" by two batches.
4. **Two E2E suites driving one pair of instances do not compose** — measured by B39 (`19/21` vs `21/21`; `37/1/4` vs `38/0/4`), and **the loser is recorded as a product failure**. Every live row of this WP runs behind a no-change watch over both shared trees, with no sibling suite in flight. Nothing in the rig enforces this and it is therefore an instruction, not a guarantee.
5. **`plugin/src/testing/e2e-control.ts` is contended by WP37, WP38, WP80, WP81, WP82 and WP88.** Any addition WP89 needs is **additive and optional on the host interface**, and any module it reaches is reached by **dynamic `import()`** on WP37's landed precedent — never by amending the frozen import allow-list, and **never mentioned in a comment**, because the allow-list regex reads comments and has already reddened three tests that way.

### §7 disposition — no `DONE` work package is re-opened, and no §7 licence of any class is expected

1. **WP87 is CONSUMED, not re-opened.** Its report (§8, row S55) names the residue and files it: *"Every past reasoning that leaned on 'an open canvas ignores external file writes' needs re-reading — including `canvas-sync.ts`'s `noteExternalDiskWrite` comment, which says so in as many words and which WP87 did not touch (B32's file)."* WP89 takes precisely the work WP87 named as not its own. WP87's ACs, its two new test files and its constraint sheet are untouched.
2. **WP5 and WP4 are read, not re-opened.** The shadow, the receipt seam and `planCapture` are inputs. `canvas-shadow.ts` is byte-unchanged unless AC1 falsifies the branch, and in that case the edit is an **ESCALATE** rather than a licence question (§2).
3. **No §7 licence of any class is anticipated.** Every §7 licence class governs an **inherited test** that is deleted, weakened, retitled, skipped or amended (and the D-1 ruling: a batch-authored restatement is a log entry, not a grant). AC2's corrections are to **comments**, which no test asserts on; AC3's enforcement test is **new** and batch-authored. If AC1 falsifies the branch and the repair reddens an inherited WP4/WP5/WP87 assertion, **that is an ESCALATE before it is a licence request** — a reddened P0 shadow assertion is more likely to be a real defect than a stale expectation, which is the ruling §7 already makes about this class.
4. **`plugin/src/canvas/canvas-editing-deferral.ts:315-340` and `plugin/src/main.ts:2944-2956`** already carry WP87's corrected statement. They are the **positive controls** for AC2's census and must not be reworded into a different sentence — a census whose positive control moves has no control.

---

## 3. Architecture Context

### Verified against the current tree (rule 12), 2026-08-05, branch `fix-bugs-and-raceconditions` at `a10f4c2` — measured, given, do not re-derive

**Every claim in this section states its pattern and its tool. `grep -F` for literals; `grep -o` is forbidden (its `.` is a wildcard and produced two false hits in this run). Cite by symbol; the line numbers are a measurement at `a10f4c2` and are to be re-measured before they are quoted anywhere else (rule 5, which this run has broken at least five times).**

#### Verification 1 — the premise is absent from `canvas-sync.ts` in the words the item was filed in, and present in four others

- **TOOL:** `grep -rnF "external write" plugin/src --include=*.ts` (fixed-string, not ERE).
- **Absence:** `grep -cF "external write" plugin/src/files/canvas-sync.ts` → **0**.
- **Positive control for the same pattern with the same tool:** the same fixed string matches **four known-present lines** under the same root — `canvas/canvas-editing-deferral.ts:324`, `:378`, `main.ts:2947`, `:2951`. The pattern works; the absence is real (rule 15).
- **Consequence:** `DISPATCHER_STATE.md:2105`'s *"`canvas-sync.ts:3785-3789` still asserts it"*, propagated verbatim from `ImplementationReport_WP87.md:362`, **points at a WP29 delete-by-omission comment**. The citation was wrong when written — `git log -3 -- plugin/src/files/canvas-sync.ts` shows the file unchanged since `a1c435e` (WP38's checkpoint), i.e. it has not drifted. The item is filed against the wrong line.

#### Verification 2 — the premise survives at exactly four sites in that file, in different words

- **TOOL:** `grep -cE "reload|re-read|refresh|external"` over the file → **15** hits; positive control `main.ts` → **31**. Then each site pinned by a **fixed string** (`grep -nF`), which is what the implementor re-runs:

| pin (`grep -nF`) | symbol it sits on | line at `a10f4c2` |
|---|---|---|
| `ignores external file writes` | the `onRemoteCanvasUpdate` field declaration | `:2028` |
| `ignores external .canvas writes` | `getCanvasSnapshot`'s doc comment | `:2265` |
| `external .canvas writes while the view is open` | the deep observer inside `subscribe` | `:2798` |
| `ignores external file writes` | inside `noteExternalDiskWrite` (`:3855`) | `:3863` |

The first pin matches **two** lines (`:2028`, `:3863`); that is a property of the pin, stated so the implementor does not read a two-hit result as a drift.

**Three of the four justify PATCHING THE OPEN VIEW DIRECTLY rather than relying on the file write.** Under the corrected premise that code is not merely still right, it is **more** necessary: the alternative — letting the file write catch the view up — is exactly the rebuild that destroys an inline editor. So those three comments are **false in their premise and their code is correct for a stronger reason**, and correcting them must say so rather than deleting them (the `skipsAutoTextSync` precedent: a claim in the tree that was corrected in place, with its measurement beside it, is the shape WP87 landed and this WP inherits it).

#### Verification 3 — the fourth site is a live branch, and what `viewOpen` actually means settles it

```ts
// canvas-sync.ts, inside noteExternalDiskWrite (:3855)
if (this.surfaceStateProvider(path).viewOpen === false) {
  this.advanceShadowFromContent(path, content, true);
}
```

- **`noteExternalDiskWrite` has exactly two production callers**, both in `main.ts`: the writer's `onWritten` hook at `:2884` and `releaseHeldCanvasWrite` at `:2690`. **"External" here means external to `CanvasSync`** — it is *our own single writer*, not a third party. `grep -n "noteExternalDiskWrite" plugin/src --include=*.ts -r` gives those two plus the definition and test call sites; there is no third production caller.
- **`viewOpen` is not "is a leaf open".** `main.ts:206-208`:
  ```ts
  private surfaceState: SurfaceStateStore = createSurfaceStateStore(
    (path) => this.canvasAdapters.get(path)?.isAvailable() === true,
  );
  ```
  and `createSurfaceStateStore` (`canvas/canvas-shadow.ts:1105-1129`) computes `stateFor(path).viewOpen = isViewOpen(path)` from exactly that closure. So **`viewOpen` ≡ "there is an available `CanvasAdapter` for this path"**.
- **`reconcileLiveCanvas` early-returns on the same predicate**: `main.ts:2378` — `if (!adapter || !adapter.isAvailable()) return; // canvas not open → file sync suffices`.
- **Therefore the two receipt routes are complementary by construction.** Adapter available ⇒ `viewOpen === true` ⇒ the reconcile pass runs and the shadow advances through `buildApplyReceipt` / `advanceFromReceipt` (`main.ts:2567-2580`). Adapter absent or unavailable ⇒ `viewOpen === false` ⇒ the reconcile pass returns early and the shadow advances from the written content. **Exactly one route is live at any moment, keyed on one predicate.**
- **This also closes the hole an obvious reading would predict.** The guest-adapter race (**S56**, WP87 §1.4 — a guest's open canvas never got a `CanvasAdapter`, 3/3) does *not* strand the shadow, because no adapter means `viewOpen === false` and the disk-write receipt fires. The same holds for the documented non-reconcilable view (private API unavailable → banner, BUILD_SPEC §5 P0).
- **And flipping the branch to advance unconditionally is a MEASURED regression, not a hypothetical one.** With an adapter available, the written content holds the peer's value for a record the surface may deliberately **not** have taken — WP87's substitution. Advancing the shadow to it is `ImplementationReport_WP87.md` §2.3 verbatim (**S57**): *"the substituted record advanced the Surface-Shadow to what the surface held … the user's own save then diffed against a shadow that already contained it and was discarded as `SHADOW STALE`."* WP87 repaired that with `receiptData`; an unconditional advance re-creates it from the other side.

> **The static verdict, stated plainly so AC1 can falsify it rather than inherit it:** *the branch is correct, and the comment's reason for it is false. The real reason is that `viewOpen` selects between two complementary receipt routes keyed on adapter availability — it is not a claim about whether Obsidian reloads a canvas from an external write, and it never was.* **This is traced, not measured. AC1 measures it.**

#### Verification 4 — the residue reaches `main.ts`, and one site is a live exposure the item as filed does not contain

Pinned by fixed string (`grep -nF`), at `a10f4c2`:

| pin | site | what it now says that is not true |
|---|---|---|
| `canvas not open → file sync suffices` | `main.ts:2378` | the early return fires for an **open leaf with no adapter** too; "file sync suffices" then means "the file write rebuilds the view", which is a different and much stronger statement than the comment intends |
| `the trailing disk write keeps data safe` | `main.ts:2394` | the `defer-drag` arm. **The disk write is not withheld for a drag** — `planCanvasDiskWrite` withholds only for a positively identified inline editor (`canvas/canvas-editing-deferral.ts:376-415`), and a drag is `isBusy()`, not `editingNodeId` |
| `The disk write is untouched and keeps converging` | `main.ts:2457` | the `deferral.mode === "hold"` arm. WP87's write hold covers this arm **when an editor is focused**; the comment states it unconditionally |

**The drag exposure, traced link by link and stated as traced:** a remote delta arrives during a local drag → `classifyBusyGate` returns `defer-drag` → `reconcileLiveCanvas` returns **before** touching the surface (`main.ts:2394-2399`), deliberately → but `CanvasPersistence`'s observer re-arms on every doc change and `planCanvasDiskWrite` returns `write` because `editingNodeId` is `null` → the bytes change → **per WP87's measurement the open view rebuilds, for a change to any card**. The gate refused to touch the surface and the writer touched it 200 ms later, which is **R-C with a drag instead of an editor**. Whether Obsidian's drag gesture survives that rebuild is **exactly the kind of thing that must be measured**, and it is AC4.

#### Verification 5 — what an unadvanced shadow costs, and the two suppressors that bound it

Both are in `handleLocalModify` (`canvas-sync.ts:2963`) and both are unconditional, i.e. they fire whatever `viewOpen` says:

1. `:2965` — `if (this.recentDiskWrites.has(path)) return;`. `noteExternalDiskWrite` adds the path and arms a `VAULT_EVENT_SETTLE_MS` timer (`:3868-3877`), so our own write's echo never reaches the classifier.
2. `:3007` — the byte echo breaker against `lastWrittenContent`, which `noteExternalDiskWrite` advances **unconditionally at `:3857`, outside the branch**. So a later save whose bytes equal our last write is a no-op with **zero shadow mutation** — and its comment already says the right thing: *"the bytes prove what the DISK holds, never what an open Obsidian canvas holds (that receipt is a confirmed apply, WP5's job)."* That sentence is the corrected premise, already written, in the same file, four hundred lines above the branch.

So a stale shadow can only bite on a save whose bytes differ from our last write, arriving after the settle window — and in that state the apply-receipt route has already advanced it, because an adapter was available. **That is the second half of the static verdict.**

---

## 4. Acceptance Criteria

*Each criterion names **the observable that proves it** and **what would make it vacuous**.*

*Acceptance evidence is **two LIVE Obsidian instances** driven through the E2E rig — `POST http://127.0.0.1:39431/command` (vault A) / `:39432` (vault B). **Blind sets are discontinued** — no `blind_set1`, no `blind_set2`, no falsification injection and no `BlindVerificationLedger` row is owed. **Every live row records the role its instance actually resumed as, quoted from its own `[session] resuming as …` line** (S37, the relay's election is a coin flip and the role-symmetry control is how this run turns that confound into evidence). `canvas.simulateEdit` and `canvas.open` are **never** called; every leaf is opened with `canvas.typeInNode{open:true}`, empty text, no blur. **No `data.json` value is read, printed, logged, hashed into a report or fixtured.***

1. **The branch is SETTLED BY MEASUREMENT, in both of its arms, before a character of repair is written.**
   - **Deliverable:** a live reproduction, on a bundle carrying **the instrument and no fix**, that measures — for one shared `.canvas`, on the peer *receiving* a change it did not make — whether the Surface-Shadow advances, and **by which route**, in each of three surface states: **(a)** an adapter is available for the path; **(b)** the leaf is open and the adapter is **absent or unavailable**; **(c)** no leaf is open for the path.
   - **Observable (the route, by receipt, on the receiving peer's own log):** the apply route is evidenced by a `reconcile <path>:` line inside the window; the disk route by a `CANVAS WRITER: <path> owner=CanvasPersistence` line **with no `reconcile <path>:` line for that path in the same window** — WP87's own R-C discriminator, reused verbatim rather than re-invented.
   - **Observable (the consequence, and this is the criterion):** for one field the local user **never touched**, the receiving peer's **next capture** must produce **zero** upserts for that field. A shadow that advanced knows the value; a shadow that did not re-classifies the peer's value as this client's intent and re-pushes it. Read through the landed `canvas.textShape` receipt ring and `canvas.editingSignal`; the `SHADOW STALE:` signature is corroboration, never the oracle.
   - **Observable (the complementarity, structurally, headless):** `SurfaceState.viewOpen` has **exactly one** production definer and it is the closure `main.ts` hands `createSurfaceStateStore`; `reconcileLiveCanvas`'s early return consults **the same** predicate. Asserted by a test, from the parsed tree, not by reading the two lines and agreeing.
   - **The required output is a VERDICT IN WRITING:** *the `viewOpen === false` branch is CORRECT / INCORRECT*, and **if correct, the reason it is correct**, stated in one sentence that does not contain the falsified premise. **A verdict of CORRECT is a complete AC1, not a failure** — the charter's static answer is CORRECT and AC1 exists to make that a measurement.
   - **Vacuity risk — named:** **state (b) may not be reachable on demand.** If the adapter always mounts, the branch has one live arm and every row in (b) proves nothing about it — the run must show state (b) was **entered**, by the adapter probe reading `hasAdapter=False` / `avail=False` for that path (WP87 §1.4's shape), before any (b) row counts; if it cannot be entered, the row **SKIPs with that reason recorded** and (b) is reported as unmeasured rather than as passed. Second: reading *"no re-push"* off a peer whose capture never ran at all — the capture must be shown to have **run** (a receipt exists for that board in that window) before its zero counts, which is the same trap WP87's AC4 named (*"a number with no before is not a measurement"*). Third: measuring with the leaf reached by `canvas.open`, which subscribes without a leaf and disables the writer seam — **S45**, and it would make every file-level row measure the rig. Fourth: a byte-identical write, which per WP87's own probe produces **no reload at all** — the write must be shown to have changed the bytes.

2. **Every site asserting the falsified premise is DERIVED FROM THE TREE and corrected in place, with the measurement beside it.**
   - **Deliverable:** a test that derives the site set from the parsed tree rather than from this charter's table, over **production sources** (`plugin/src/**`, tests excluded), and pins it. A new occurrence cannot join the set unnoticed.
   - **Observable (headless, structural):** the derived set contains all four `canvas-sync.ts` sites of §3 Verification 2 and all three `main.ts` sites of §3 Verification 4 on the **pre-repair** tree, and is **empty of uncorrected members** on the post-repair tree. Each correction (a) keeps the original sentence visible rather than deleting it, (b) states what was measured and where the measurement lives, and (c) states the **actual** reason the code beneath it is right.
   - **Observable (rule 15 and its cousin, both directions, with the tool named):** every absence **and** every presence claim in the report states its pattern, its tool and its positive control. `grep -F` for literals; **`grep -o` is forbidden**. The charter's own baseline is given in §3 and is to be **re-measured, not quoted** (rule 5).
   - **⚠ The detector must NOT strip comments, and that inverts WP87's rule.** WP87's AC2 census ran over **comment-stripped** source, because a detector that counts a mention in prose measures the prose — and that reddened three tests in this run. **Here the target IS the prose.** The census therefore runs over raw source, and its reverse assertion is correspondingly different: it must find **zero** in a module known to contain no such claim, and it must find a **known-present** member in the real tree.
   - **Vacuity risk — named:** **S53, the recursive one** — WP86's census deriver returned an **empty** set and *"every derived site is corrected"* passed perfectly on it. The deriver must **exit non-zero without emitting a census** if its input set is empty (the third-deriver pattern, `DEVELOPMENT_REPORT_CanvasV2_II.md` §5.3), and its positive control must have **two halves** and fail if it can show neither, because after the repair *"the class is empty"* and *"the deriver went blind"* otherwise produce the same output. Second: a hand list dressed as a derivation — it cannot catch the site the next WP writes. Third: matching only the exact string `external write`, which finds **zero** in `canvas-sync.ts` and would report the whole item closed (this is the filed item's own error, and repeating it is the one failure this AC exists to prevent). Fourth: rewording `canvas-editing-deferral.ts:324` or `main.ts:2947` — they are the census's positive controls (§2.4) and a control that moves is not a control.

3. **A DECISION, in writing, on whether the corrected statement is ENFORCED — and if it is, a test that reddens when the premise is re-asserted.**
   - **Deliverable:** the decision, with its reason, in the implementation report. If **enforced**: a test that goes red if a future change re-couples the two receipt routes or re-asserts the premise as a governing fact. If **not enforced**: the reason, recorded, and why a comment is sufficient here when it was not sufficient for `skipsAutoTextSync`.
   - **Observable (if enforced):** the test pins the **predicate wiring** — one definer for `SurfaceState.viewOpen`, `reconcileLiveCanvas`'s early return consulting the same predicate, and the two receipt routes shown mutually exclusive by driving both arms — and it is shown **red** against a synthetic build in which they are decoupled. A test that is never shown red against the thing it forbids is a claim.
   - **Vacuity risk — named:** **pinning a string in a comment.** WP37's three red tests were red on a comment that quoted an import statement, because the allow-list regex reads comments. A test that asserts *"the file no longer contains this sentence"* is enforcement of prose by prose and is **explicitly not what this AC asks for** — it must pin the wiring. Second: an enforcement test that passes on a build where **neither** route runs (no adapter, no writer), which is green and empty; it must drive both arms. Third: deciding "not enforced" by default because the enforcement is awkward — the decision is only satisfied if the report states what was considered and why.

4. **The drag exposure is MEASURED and REPORTED, and is NOT repaired under this WP.**
   - **Deliverable:** a live row measuring whether a peer's delta that lands on disk during a local **drag** disturbs the dragging peer's view — the state where `reconcileLiveCanvas` deliberately deferred (`main.ts:2394-2399`, `gate === "defer-drag"`) and `planCanvasDiskWrite` returned `write` because `editingNodeId` is `null`.
   - **Observable:** on the dragging peer, `adapter.isBusy()` reads **true** (through the landed `canvas.editingSignal` reader, non-mutating) **before** the write lands; the write lands, evidenced by its `CANVAS WRITER:` line and by the file's bytes changing; and the dragged card's live position is sampled across the window. The verdict is whatever it reads — **establishing that the drag survives is as valuable as establishing that it does not**, and the row is reported either way.
   - **Disposition, fixed here rather than left to the implementor:** if the exposure is real it is **carried up with its receipt, not repaired**. Extending the withhold to drags inverts `planCanvasDiskWrite`'s deliberate fail-open direction, against which WP87 has a measured counter-example (`ImplementationReport_WP87.md` §4.2 — an over-reporting signal withheld a write and left a stale node in a `.canvas`, `21/21 → 19/21`). It is a product decision and it is **not taken here**.
   - **Vacuity risk — named:** a "drag" the rig performs that Obsidian never treats as one. `isBusy()` must be shown **true on the victim** at the moment the bytes change, or the row measures nothing and is reported as unmeasured. Second: a write that does not change the bytes — no bytes, no rebuild, and the row is vacuous by WP87's own reload probe. Third: reaching for `canvas.simulateEdit` to manufacture the delta — forbidden outright; the delta comes from the other live instance. Fourth: concluding "the drag survived" from a final position that happens to match, without sampling across the window — WP87's criterion sampled 18/18 and named `first_loss`, and that shape is the standard here.

5. **Any repair is SHAPE-CONSTRAINED, and the no-repair outcome is asserted rather than claimed.**
   - **If AC1 returns CORRECT:** `plugin/src/files/canvas-sync.ts`'s **executable** lines are byte-unchanged — asserted by a diff over the file restricted to non-comment lines, not stated in prose — and the WP lands as AC2 + AC3 + AC4.
   - **If AC1 returns INCORRECT:** the repair may **not** be an unconditional `advanceShadowFromContent`. That reintroduces **S57** (`ImplementationReport_WP87.md` §2.3), and the regression must be **shown RED as a control** on the candidate repair before any alternative is accepted — attribution by receipt before repair, which this run has ruled should be a standing rule (`DEVELOPMENT_REPORT_CanvasV2_II.md` §9.5).
   - **In both cases:** `canvas-shadow.ts`, `canvas-persistence.ts` and `reconcile-plan.ts` are byte-unchanged; no timing constant moves; `getEditingNodeId` keeps one definer; `useCanvasBinding` is still `false`; the plugin version is not bumped.
   - **Vacuity risk — named:** *"nothing changed"* asserted by reading the diff rather than by running one. Second: a repair that is green because the branch it changed is never entered in any criterion — every arm the repair touches must be shown **entered**, on the same evidence AC1's state (b) requires. Third: quietly widening `SurfaceState` to carry a third state, which would make the complementarity AC3 pins untrue by construction while every row still passes.

---

## 5. Constraints and Known Risks

- **The item as filed points at the wrong line and understates the scope.** `DISPATCHER_STATE.md:2105` and `ImplementationReport_WP87.md:362` both cite `canvas-sync.ts:3785-3789`; that range is a **WP29 delete-by-omission comment**. The implementor works from §3's fixed-string pins and **re-measures them**, because the line numbers in this charter are a measurement at `a10f4c2` and this run has broken rule 5 on line numbers at least five times, including in the file that states the rule.
- **The expected outcome is "the code is right and the comments are wrong", and that is a risk in itself.** A charter whose author expects one answer is a charter whose implementor may find that answer. **AC1 runs on a bundle with the instrument and no fix, and its state (b) has an explicit SKIP path** precisely so that "correct" cannot be reached by not looking.
- **`externalWriteSettleTimers` is built on the same premise and is NOT in scope beyond AC2's comment corrections.** `grep -cF "externalWriteSettleTimers"` over the file gives **9** at `a10f4c2` — **note the audit's §6.7 says "10 references", and `grep -c` counts *lines*, not occurrences, so the two numbers are not necessarily in conflict; re-measure and state which you counted.** It is a settle window for **our own** writer's echo, and its correctness does not depend on whether Obsidian reloads — but the sentence justifying it does. If AC1 or B41 shows the window itself is load-bearing for the schedule dependence, that is an **ESCALATE**, not a drive-by.
- **A sibling batch may be live in this repo throughout.** HEAD moved twice while `DEVELOPMENT_REPORT_CanvasV2_II.md` was being written and once more before this charter (`ffc6345` → `a10f4c2`). **Rule 14:** never `git checkout --`, `git restore` or `git stash` a shared path; the instrument for a parked baseline is a **detached worktree**; commit with `git commit -o <paths>`; re-read `git status` immediately before **every** commit. A sibling reverted a shared path between WP81's edit and its stage (**S34**) and it was caught only that way.
- **A detached-worktree measurement of the unit suite is 15 tests short** unless `server/node_modules` is linked as well as `plugin/node_modules`, and it reports the shortfall as **two failed files** (`e2e/two-host.test.ts`, `wp5/latency.test.ts`), not as a smaller total (`DEVELOPMENT_REPORT_CanvasV2_II.md` §4.1, §6.10). Any baseline this WP quotes states its environment.
- **`data.json` holds live credentials.** No value is read, printed, logged, echoed into a report, a commit message or a fixture. Key **names** and boolean presence only.
- **The relay is production and shared** (`https://liveshare.neuralangels.de`). `GET /healthz` is the only permitted interaction; no room is created, deleted or mutated.
- **The canvas E2E baseline is 21/21 and is recorded as schedule-dependent in five checks** (`8458167`). It is **not** 19/19 and not 13/18 — both of those measured the rig (**S45**, WP85). Whatever it reads at handover is recorded as a measurement with its band, never as a property to preserve.
- **Every install is digest-guarded and marker-grepped.** **S46** has fired for real three times in this run, most recently at 11:41 on 2026-08-05 when a sibling's bundle had replaced `plugin/main.js` between build and install. Always set `LS_EXPECT_SHA256`, and grep the **installed** bytes for a marker unique to this batch's own change — a digest proves *which* build, not *whose*.
- **Both owner vaults are currently on a 4.5 MB instrumented e2e build with `obsidian-git` disabled**, three `data.json` backups and eight fixtures each. Every artefact this WP creates is namespaced `wp89-*` under `_liveshare-test/` and swept at teardown, with the count reported.

### Recorded, not repaired — this WP's own sweep

- **`buildApplyReceipt`'s branch asymmetry** — `nodeOutcomes` is consulted only in the geometry branch (`canvas-shadow.ts:816-819`), so C37 AC4 holds for one branch and silently not for the other. WP87 worked around it via `receiptData` without touching the file and **named the asymmetry as unowned**. WP89 does not repair it; it is `canvas-shadow.ts` and it deserves its own attribution.
- **S61** — `getEditingNodeId()` over-reports an editor on boards nobody is typing in. Bounded by WP87's ceiling, not repaired, unowned, and named by WP87 as the highest-value follow-up in this area. It is an **input** to AC4's interpretation: if the drag row sees a non-null `editingNodeId`, the exposure may be masked by an over-report rather than absent.
- **WP79's charter cites the ledger at `canvas-sync.ts:1313-1321`, `:1842`** (`TaskCharter_WP79…:125`). Both are wrong at `a10f4c2` (the class is at `:1463`, its doc comment at `:1455-1462`, the map at `:2011`). Recorded here because it is the same rule-5 failure this WP exists to stop propagating, and because WP90 owns that text.

---

## 6. Definition of Done Artifacts

- **Required changed files (the maximum surface; a CORRECT verdict at AC1 makes most of it comment-only):**
  - `plugin/src/files/canvas-sync.ts` — the four corrections; executable lines byte-unchanged unless AC1 falsifies the branch
  - `plugin/src/main.ts` — the three corrections at `:2378`, `:2394`, `:2457`
  - `plugin/src/__tests__/v2/wp89/**` — **new**: AC2's deriver and its two-halved positive control, AC3's enforcement test if AC3 rules for one, AC1's structural complementarity assertion
  - `plugin/src/testing/e2e-control.ts` — **at most one** additive, read-only case, and only if AC1 cannot be satisfied through the landed `canvas.state` / `canvas.file` / `canvas.textShape` / `canvas.editingSignal`. Reached by dynamic `import()`, never named in a comment
  - `H:\tmp\liveshare_wp89_*.py` — the live reproduction, idempotent, per-run ids, both vaults swept at preflight and teardown
- **Already landed by Worker 2 with this charter — NOT implementor work:** the §9 WP89 row and the §7 / header counts (**87 → 89 live**, entered together with WP90), re-derived from §7 and §9 rather than edited independently. **The implementor does not edit `BUILD_SPEC_CanvasV2.md`.**
- **Required report:** `ImplementationReport_WP89.md` (in `workflowArtifacts/canvas-v2/`), which must additionally record: **AC1's verdict in one sentence** with the receipts that produced it, all three surface states with the ones that could not be entered marked SKIP-with-reason, the role each instance resumed as, and the bundle digest and the unique marker grepped from the installed bytes; **AC2's derived census** on both the pre- and post-repair tree, with every pattern, the tool used for each, the positive control for every absence and presence claim, and an explicit statement that the detector did **not** strip comments and why; **AC3's decision with its reasoning**, and if enforced, the red control that shows the test forbids what it claims to forbid; **AC4's drag row** with `isBusy()` shown true on the victim before the bytes changed, the sampled positions, and the verdict either way; **AC5's byte-unchanged assertions**, run rather than claimed; a positive statement that `canvas-shadow.ts`, `canvas-persistence.ts`, `reconcile-plan.ts` and `server/**` are byte-unchanged, that no timing constant moved, that `useCanvasBinding` is still `false` and the version still `0.6.1`; the **executed test count** before and after with every failure attributed by owner; the canvas E2E figure **with its band**; the artefact sweep count; a data-safety statement; and the statement that no existing test was deleted, weakened, retitled, skipped or amended and that **no §7 licence of any class was taken**.
- **BUILD_SPEC updates required:** no — the §9 row and the counts were entered when this charter was written. Anything further is an **ESCALATE** rather than a spec edit.
- **Gate status required at handover:** `tsc -noEmit -skipLibCheck` exit 0 and `npm test` from `plugin/` with the executed count recorded and every failure attributed by owner. `npm run build`'s esbuild half only when `plugin/src/**` is quiet — it overwrites the shared, gitignored `plugin/main.js` and a sibling's bundle has already been destroyed that way once. `npm run lint` advisory locally, gating in CI — do not mass-reformat.

---

## 7. Visible Test Cases / Producer Artifacts

*Filled by Worker 3. Worker 2 leaves this section empty.*

*⚠ **Blind sets are discontinued for new work** (owner's instruction, 2026-08-05): no `blind_set1`, no `blind_set2`, no falsification-injection requirement and no `BlindVerificationLedger` row is owed by this WP. Validation is W4 against two live Obsidian instances. E2E-plugin defects found while validating go back to **W3 as a revision**.*

---

## 7b. W4 Test Targets (filled by Worker 3's Unit Test Sub-Agent, if any)

*Empty at handover.*

---

## 8. Autonomous Execution Plan (filled by Coder Sub-Agent, attempt 1)

*Empty at handover.*

---

## 9. Handover Summary (filled by Coder Sub-Agent on completion)

*Empty at handover.*

---

## 10. Risk Notes for Worker 4 (filled by Worker 3 Core)

*Empty at handover.*
