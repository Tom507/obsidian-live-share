# Task Charter — WP83: the fifth door onto a shared `.canvas` is a RAW-BYTES door, and the map that was supposed to list it never claimed to

<!-- Updated: chartered 2026-08-05 (B25) from the Dispatcher's live measurement of S25 (`FileOpsManager.onFileCreate` pushes raw file content for a shared `.canvas`, every role, under 3 seconds), re-verified against the current tree per hard-won rule 12 — which CONFIRMED the door and CORRECTED both stated consequences. (1) The door does NOT install a second `Y.Text`. It emits `{type:"create", path, content}` (`files/file-ops.ts:477-485`) and the receiver applies it with `vault.modify` / `vault.create` (`files/file-ops.ts:194`, `:203`) under a path mute taken at `:184` — a RAW, NON-CRDT, LAST-WRITER-WINS overwrite of a path `CanvasSync` owns, which is a different and sharper defect than the double-CRDT the brief quoted. (2) `skipsAutoTextSync`'s docstring does NOT claim its own consumer list is "exhaustive in both directions"; that sentence (`utils.ts:277-280`) is scoped to the `isSidecarPath` block at `:291-294`, which is TRUE and already test-derived. What is measurably wrong is the OTHER block (`utils.ts:255-268`), which is unenforced and already stale by one row. Both corrections make the work smaller and sharper, and both are load-bearing for the ACs. No Obsidian was launched, no vault was written, no E2E script was run, no `data.json` was opened. -->
**Charter Status:** `SPEC_COMPLETE`
**WP:** WP83
**Phase:** P0
**task_mode:** `standard`
**Depends on:** none. **Batchable with WP80, WP82 and WP85** — it shares no file with any of them (see §2 Ordering).
**W4 Test Targets:** `0`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b.

---

## 1. Task Objective

- **Outcome:** a shared `.canvas` stops being transmissible as **raw bytes over the file-op channel**. Today a vault `create` event on a shared `.canvas` sends the whole file to every peer, and every peer writes those bytes straight onto its own copy of a path `CanvasSync` owns — no CRDT, no merge, no capture, and the receiving write is muted from the vault events that would have fed it back into the doc. After this WP the only routes a `.canvas` takes between peers are the two the design sanctions: the structured `CanvasSync` doc, and WP79's mirror materialisation through the single writer.
- **The second, equal half of the outcome:** the artefact that has been read as *the* map of these doors is corrected and, where it can be, **enforced by a test that derives its rows from the tree**. `skipsAutoTextSync`'s contract comment has been cited by several work packages in this run as an authoritative enumeration. Measured, it is two different enumerations with two different strengths, and the one everybody has been reading is the weaker one.
- **Why it outranks its size.** It is the reason scenario `[07]` went PASS / PASS / FAIL / PASS with no correlation to the bundle: **the scenario was measuring this door, not the canvas mirror.** A test whose subject is not what its name says is the same class as a test that cannot fail, and this one has already produced a false signal about WP79 — the one WP it was supposed to gate.
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 9, work package **WP83**; section 6.1's canvas ownership state machine (`CANVAS-OWNED` / `TEXT-OWNED`), whose invariant *"a shared `.canvas` path has EXACTLY ONE owner at any instant"* (`files/vault-events.ts:6-19`) this door violates without entering either state. Phase **P0**: it is an ownership-invariant breach on the durable artefact.

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: modify, **one repository** (`obsidian-live-share`, branch `fix-bugs-and-raceconditions`), **`plugin/src/` only**.
  - Responsibility: close the raw-content door for a path `CanvasSync` owns; correct and enforce the predicate's contract comment; and prove the sanctioned path still delivers a mid-session canvas, because closing this door removes the mechanism that has been delivering them by accident.
  - Scope summary: the `.canvas` guard on the create-content emission (`files/file-ops.ts:375-405`), taken through the **shared predicate** and never a private `endsWith(".canvas")` · the contract comment at `utils.ts:230-331` split into the claim a test can hold and the note it cannot · one test that **derives** the predicate's production call sites from the tree and fails when the comment and the tree disagree · a live demonstration that a canvas created mid-session still reaches the guest, through the mirror, after the door is shut.
- **Out of scope / non-goals — each is an ESCALATE, not a judgement call:**
  - **⚠ `onFileDelete` and `onFileRename` (`file-ops.ts:450`, `:461`).** They emit **path-only** ops — `{type:"delete"}`, `{type:"rename"}` — and carry no content, so neither can install a second writer or overwrite a byte. Whether a peer's `.canvas` *should* be trashed by a remote delete is a real question and it is **not this WP's**. Recorded as **S43**.
  - **⚠ `onFileModify` (`file-ops.ts:412`).** Already unreachable for a `.canvas`, twice over and independently: the vault router returns into the text/canvas branch before reaching it (`vault-events.ts:230-264`, the call is at `:265`), and the method itself returns at `:417` on `if (!binary) return;`. **It is not touched, and its double guard is the shape the create path should have had.**
  - **⚠ Chunked transfer (`sendChunked`, `file-ops.ts:487`).** Reached only *from* `sendFileContent`; closing the door upstream closes it. No independent guard is added there, because a second private guard is precisely the propagation pattern the shared predicate exists to stop (`utils.ts:270-272`).
  - **⚠ `skipsAutoTextSync`'s BEHAVIOUR.** The predicate body (`utils.ts:332-334`) is byte-unchanged. WP26 AC1/AC3/AC4 own it and it is correct.
  - **⚠ The `isSidecarPath` enumeration (`utils.ts:277-294`) and its test.** **Measured true** (§3 Verification 3) and already derived from the tree by `__tests__/v2/wp26/test_tp09_one_predicate_one_definition_visible.test.ts`. It is **not** rewritten, not demoted and not re-scoped. Correcting a claim that is right is how a run loses a working oracle.
  - **⚠ `files/canvas-mirror.ts`, `files/canvas-mirror-decision.ts`, `main.ts`.** WP79's, and WP85's and WP80's. **Byte-unchanged.** WP83 proves the mirror still works; it does not modify it.
  - **⚠ `server/**`.** A `server/` edit outside WP41 is a §7 abort criterion.
  - **⚠ `useCanvasBinding`, `canvas-binding.ts`, `canvas-model-bridge.ts`.** Frozen until P5.
  - **⚠ Any new E2E control command.** **None is needed** (§4 AC3/AC4 are driven by `scratch.create`, `canvas.file`, `canvas.state` and `sync.waitQuiescent`, all landed). This is deliberate: `testing/e2e-control.ts` is contended by WP37, WP38, WP80, WP81 and WP82, and staying out of it is what makes WP83 batchable with all of them.
  - **⚠ Any new runtime dependency.** D11 — an ESCALATE.
- **Known interfaces / dependencies:**
  - Input: the vault `create` event for a shared path (`files/vault-events.ts:137-142`), the shared predicate `skipsAutoTextSync` (`utils.ts:332`)
  - Output: one guarded emission point; one corrected contract comment; one tree-derived enforcement test
  - **Blocks nothing. Unblocks an honest `[07]`.**

### Ordering — what must NOT be batched together

1. **WP83 shares no file with any live or chartered WP.** WP80 is live in `main.ts`, `files/manifest.ts`, `sync/control-handlers.ts`, `files/manifest-purge-decision.ts` and `testing/e2e-control.ts`; WP82 is chartered over `sync/**`, `main.ts`, `ui/settings.ts` and `testing/e2e-control.ts`; WP85 is chartered over `main.ts`. **WP83 touches `files/file-ops.ts` and `utils.ts` and nothing else.** It may run in the same batch as any of them.
2. **`utils.ts` is a repo-wide import root.** A change there that does not compile breaks `npm run build` for every sibling batch at once. The predicate body is untouched; only the comment above it and one new import in `file-ops.ts` move.
3. **Rule 14 is absolute:** re-read `git status` **immediately** before every commit, commit with `git commit -o <paths>`, and never `checkout --` / `restore` / `stash` a path this batch did not create. A sibling reverted `main.ts` between edit and stage once already in this run (S34).

### §7 disposition — one `DONE` WP is touched at its documentation surface, and no §7 licence of any class is taken

1. **WP26 is `DONE` and WP83 edits its contract comment.** This is **not** a re-opening. C26's acceptance criteria are about the *predicate* — one definition, two disjoint clauses, four named sidecar-only seams, and *"its consumers are enumerated in the code comment"*. WP83 **keeps that enumeration, adds the row the tree already has, and makes the enumeration testable**. AC3 of C26 is satisfied more strictly afterwards than before. **A criterion that says "the consumers are enumerated" is not weakened by enumerating them correctly.**
2. **No `DONE` work package's acceptance criterion is amended.** `files/file-ops.ts`'s create path is named in no WP's ACs. WP68 (`P2`, **planned**, not done) owns the *rename* boundary of the same module and is untouched.
3. **WP83 holds no §7 licence of any class.** No inherited test is deleted, weakened, retitled, skipped or amended.
4. **⚠ ONE named hazard, and it is an ESCALATE if it fires.** `__tests__/w4-canvas-integrity.test.ts` wraps `skipsAutoTextSync` in a `vi.mock` and records every consult into an array (`:70-79`), then asserts the **exact array** for one path: `expect(guardConsults.filter(c => c.path === PATH).map(c => c.verdict)).toEqual([true])` at `:1673-1678` (the `setActiveFile` row) and `:1756-1761` (the `activateForFile` row). If WP83's new guard is consulted inside either test's scope, that array grows and the assertion reddens. **That is an ESCALATE with the measured before/after, left red — not a rewrite.** It is named here so it cannot be discovered late and repaired quietly.
5. **If a type or constant is added to `types.ts` it goes at the TOP**, beside `StaleReconcileDecision` — the WP22 dormancy-test comment-strip trap. Inherited verbatim from WP80, WP81 and WP82; it has already cost this run once.

---

## 3. Architecture Context

*Task-local architecture guidance only.*

### Verified against the current tree (rule 12), 2026-08-05 — measured, given, do not re-derive

> **Evidence classes, stated so they are not conflated.** Verifications 1–4 are **static measurements of the tree at working-tree state** (`files/file-ops.ts`, `files/vault-events.ts` and `utils.ts` are **unmodified** in `git status`, so their line numbers are HEAD-accurate and are not disturbed by WP80's live edit). The *timing* fact — under 3 seconds — is the **Dispatcher's live measurement**, carried, not re-measured here.

**Verification 1 — the door, end to end. It is a raw-bytes door, not a second CRDT.**

| step | site | what is there |
|---|---|---|
| trigger | `files/vault-events.ts:137-142` | `vault.on("create")` → `isSharedPath` → `isPathMuted` → `renamedPaths` → `void plugin.fileOpsManager.onFileCreate(file)`. **No role gate. No canvas gate.** The role gate at `:143` guards only the manifest/`onFileAdded` arm below it. |
| read | `files/file-ops.ts:398` | `const content = normalizeLineEndings(await this.vault.read(tfile));` — a `.canvas` is in `TEXT_EXTENSIONS`, so it takes the text arm |
| send | `files/file-ops.ts:400` → `:477-485` | `sendFileContent` emits `{ type: "create", path, content }` (or chunks it above `CHUNK_SIZE`) |
| receive | `files/file-ops.ts:187-206` | `case "create"`: **file exists** ⇒ `await this.vault.modify(exists, op.content)` (`:194`); **file absent** ⇒ `await this.vault.create(op.path, op.content)` (`:203`) |
| and this is the sharp part | `files/file-ops.ts:184` | `for (const path of paths) this.mutePathEvents(path);` runs **before** the apply. The resulting vault `modify` event is muted, so `canvasOwned` → `handleLocalModify` (`vault-events.ts:236-247`) never sees it. **The bytes land on disk and never enter the doc.** |

**So the consequence the brief quoted is not the one that occurs.** No `Y.Text` is installed by this path and no second CRDT is created. What occurs is worse in one specific way and milder in another: it is a **raw, unmerged, last-writer-wins overwrite of a CRDT-owned file, invisible to the CRDT**. The two-owner corruption the ownership state machine exists to prevent (`files/vault-events.ts:6-19`) is *character-level interleaving*; this is *wholesale replacement*. Both destroy edges; only one of them leaves the doc still believing the old content.

**Verification 2 — the guard is absent, and the search that says so can find what it looks for (rule 15).**

Pattern: `skipsAutoTextSync|\.canvas|isSidecarPath|canvasOwned`, ripgrep, over single files.

| file | hits |
|---|---|
| `plugin/src/files/file-ops.ts` | **0** |
| `plugin/src/utils.ts` | 16 |
| `plugin/src/files/vault-events.ts` | 9 |

The pattern matches 25 known-present lines in the two neighbouring modules and **nothing at all** in the 500+ lines of `file-ops.ts`. The absence is a measurement, not a failure to look. **No canvas-related token of any spelling occurs anywhere in `files/file-ops.ts`.**

**Verification 3 — the docstring. TWO enumerations, TWO strengths, and the strong claim is on the block nobody was reading.**

| block | lines | what it says | measured status |
|---|---|---|---|
| **A — callers of `skipsAutoTextSync`** | `utils.ts:255-268` | *"Every caller that would AUTOMATICALLY install or consume a bare-path `Y.Text` must consult this predicate:"* then 5 rows — `background-sync.ts` `startAll` / `onFileAdded` / `onFileRenamed`, `manifest.ts` `syncFromManifest`, `collab.ts` `activateForFile` | **STALE BY ONE ROW, AND UNENFORCED.** The tree has **six** production call sites: `background-sync.ts:97` (`startAll`), **`:216` (`setActiveFile`) — not a row**, `:239` (`onFileAdded`), `:292` (`onFileRenamed`), `manifest.ts:475` (`syncFromManifest`), `collab.ts:84` (`activateForFile`). |
| **B — production call sites of `isSidecarPath`** | `utils.ts:277-294` | *"The CONSUMER LIST … is **exhaustive in both directions**: every production call site of `isSidecarPath` … appears as a row; and every row is a real call site."* then 4 rows | **TRUE, 4 for 4, AND ALREADY DERIVED FROM THE TREE BY A TEST.** `background-sync.ts:339` (`handleLocalTextModify`), `manifest.ts:441` (`syncFromManifest`), `:678` (`renameFile`), `:713` (`isSharedPath`). Enforced by `__tests__/v2/wp26/test_tp09_one_predicate_one_definition_visible.test.ts` — *"the comment names every consumer module of the exclusion"* — which walks every production `.ts`, keeps those referencing `isSidecarPath`, and requires the basename in the comment. |

**Three consequences, each of which changes the work:**

1. **The "exhaustive in both directions" sentence has been mis-attributed.** It governs block **B**, and block B is correct. The claim that has actually misled this run is block **A**'s *"Every caller … must consult this predicate"*, which is a claim about the world stated in the grammar of a list — and it is already one row behind its own module set.
2. **`setActiveFile` is not an obscure omission.** `__tests__/w4-canvas-integrity.test.ts:1671-1678` tests it **by name** as a guarded consumer, with its own anti-vacuity note. **The test suite knows about a consumer the comment does not name.** The comment did not fail to keep up with an obscure change; it failed to keep up with a change that has a test.
3. **No enumeration of `skipsAutoTextSync`'s callers can ever catch this door, and the charter must say so instead of pretending otherwise.** A derivation over *consumers* finds only sites that already consult the predicate. `onFileCreate` consults nothing — that is the defect. **A consumer list is a coherence check on the comment; it is not a door census.** AC2 buys the coherence check because it is cheap and it would have caught `setActiveFile`; AC1 buys the actual door.

**Verification 4 — closing this door must not regress mid-session canvas distribution, and the sanctioned replacement is already wired.**

This is the risk that would make the fix worse than the defect: if the raw-bytes door is the only thing delivering a mid-session canvas, shutting it re-opens WP79's complaint one week later.

| fact | site |
|---|---|
| the mirror pass is re-armed on **every manifest entry change**, unconditionally | `main.ts:373` (HEAD) / `:394` (working tree) — with the comment *"the guid arrives as a manifest entry change, so the decision is re-asked on exactly the event that creates the evidence"* |
| a host creating a canvas writes a manifest entry for it | `files/vault-events.ts:143-160` — the host arm of the same create handler calls `manifestManager.updateFile(file, content)` |
| the host's mirror arm mints and binds the guid without writing a byte | `files/canvas-mirror.ts:249-266` — `PUBLISH`, *"No write, no attach, no cold open"* |
| the guest's arm then materialises through the single writer | `files/canvas-mirror.ts:271-289` → `main.ts:1697` (HEAD) / `:1728` (wt) `attachCanvasWriter` |

**So the sanctioned chain exists and is triggered by the same event.** It is nevertheless **not assumed**: AC4 makes the mid-session delivery a live criterion with an owner-attribution observable, precisely because *"the replacement path exists in the source"* is what a green that cannot fail sounds like.

**Verification 5 — the `[07]` attribution, and what it means for the suite.**

The Dispatcher's account is that `[07]` was measuring this door rather than the mirror. Verifications 1 and 4 make that mechanically coherent: both paths end in a `.canvas` appearing on the guest, and **nothing in a file-existence assertion distinguishes them**. The two are distinguishable only by the *owner of the write*, which the plugin's own log already reports — `CANVAS WRITER: <path> owner=CanvasPersistence attached (coldOpen=…)` and the `CANVAS MIRROR: role=… materialised=…` receipt (`files/canvas-mirror.ts:224-230`), both quoted verbatim in `ImplementationReport_WP79.md`. **A file-existence assertion is not an assertion about the mechanism**, and AC4 is written so it cannot be satisfied by one.

---

## 4. Acceptance Criteria

*Each criterion names **the observable that proves it** and **what would make it vacuous**.*

*Acceptance evidence is **two LIVE Obsidian instances** driven through the E2E rig — `POST http://127.0.0.1:39431/command` (vault A) / `:39432` (vault B), body `{"cmd","args"}`. **Blind sets are discontinued** — no `blind_set1`, no `blind_set2`, no falsification injection, no `BlindVerificationLedger` row is owed. Headless tests carry only the rows a live instance cannot honestly produce, and are named as such per row. **Edits are driven by writing files on disk**; `canvas.simulateEdit` is not called.*

1. **A shared `.canvas` never leaves this peer as raw content on the file-op channel.**
   - **Deliverable:** the create-content emission in `FileOpsManager.onFileCreate` (`files/file-ops.ts:375-405`) does not run for a path the shared predicate answers `true` for. The guard is **`skipsAutoTextSync` imported from `utils.ts`** — never a private `endsWith(".canvas")`, never a re-spelt sidecar test, never a second constant (`utils.ts:270-272` names four private copies as how this defect class propagated). The refusal is a **refusal to transmit content**, not a refusal to handle the event: I11 — nothing is deleted, nothing is trashed, no other create is affected, and the sidecar clause of the same predicate keeps behaving exactly as it does today.
   - **Observable (live, both vaults, and this is the whole point of the WP):** a `.canvas` is created in the shared folder on vault A **by writing the file on disk**. On the **unrepaired** bundle, vault B's `canvas.file` reports the file with A's bytes within the Dispatcher's measured window; on the repaired bundle, **B does not receive it by this route** — and the discriminator that makes that statement meaningful is AC4's, not a timeout. A **non-canvas** file created in the same folder in the same run still arrives on B, which is the control proving the channel itself was not broken.
   - **Observable (headless, deterministic):** `onFileCreate` is driven with a `.canvas` path against a fake `sendOp` and emits nothing; driven with a `.md` path it emits `{type:"create"}` unchanged; driven with a sidecar path it emits nothing, as it must have already. **The `.canvas` row must be shown RED against the current tree.**
   - **Vacuity risk — named:** asserting only that B's file is *absent*, which is also true if the manifest never listed it, if the session was not live, if the folder was wrong, or if B simply had not finished joining. **Absence is the weakest possible oracle and this run has been burned by it twice** (the falsified log silence, and the WP82 grep that could not match its own subject). The required guard is the positive control in the same run: the `.md` file arrives, so the channel is up. Second: guarding at the **receiving** side instead, which would leave the bytes on the wire and make every future consumer of the frame inherit the hole. Third: guarding with a private `.canvas` test, which passes every behavioural assertion here and re-creates the exact propagation pattern the predicate exists to prevent — AC2's derivation is what forbids it.

2. **The predicate's contract comment states only what a test can hold, and a test holds it.**
   - **Deliverable:** the comment at `utils.ts:230-331` is corrected in three specific ways and in no others. **(a)** Block A gains the missing row — `background-sync.ts setActiveFile` — and any row this WP adds. **(b)** Block A's heading is **demoted from a claim about the world to a claim about the tree**: it enumerates *the production call sites of this predicate*, which is checkable, instead of asserting that every caller which *would* install a bare-path `Y.Text` consults it, which is not. **(c)** A short, explicitly **non-exhaustive** note is added naming the other mechanism by which a `.canvas` reaches a peer — the file-op content channel — with `files/file-ops.ts onFileCreate` as its first row, so the next reader is told that this comment is not a door census and never was. **Block B — the `isSidecarPath` enumeration and its "exhaustive in both directions" sentence — is byte-unchanged**, because it is true.
   - **The ruling this AC encodes, made rather than left open:** the docstring is **enforced where it can be and demoted where it cannot**, not one or the other. Block B is enforced already. Block A becomes enforced as a coherence check. The unenforceable part — *"these are all the ways a `.canvas` can travel"* — is **removed as a claim** rather than left standing as a false one, because a claim no test can hold is exactly what a work package inherits and trusts. **Demoting the whole comment to a note would have thrown away a working oracle; enforcing all of it would have asserted something underivable.**
   - **Observable (headless, derived from the tree, not from a literal):** one test walks every production `.ts` under `plugin/src/` (excluding `__tests__` and `__mocks__`, on `test_tp09`'s landed precedent), collects every file containing a call to `skipsAutoTextSync` other than `utils.ts` itself, and asserts each appears in the contract comment. Run against the **current** comment it must go **RED naming `background-sync.ts`'s uncovered call site**, and that RED is recorded — a coherence test that is green on the day it is written has proven nothing about its own reach. It is additionally shown to redden when a call site is added to a module the comment does not name.
   - **Vacuity risk — named:** asserting the comment merely *contains the string* `"file-ops"`, which any prose mentioning the module satisfies. Second, and this is the one that would matter: **a module-granularity derivation cannot tell a guarded call site from an unguarded module** — a file that names the predicate anywhere, including in a comment, satisfies it. The test therefore strips comments before deciding (the landed `stripComments` helper), and the charter **states in writing that this criterion buys comment/tree coherence and does not buy door coverage**. Third: writing the enforcement so it also "covers" AC1 — it cannot, by construction, and a criterion that claims to catch a *non*-consumer by enumerating *consumers* is a green that cannot fail.

3. **The canvas ownership invariant is stated as a property, not as a list of guarded sites.**
   - **Deliverable:** one test asserts, over the production tree, that **no production module transmits or writes file *content* for a path this predicate answers `true` for without consulting it**, expressed at the seam where content is emitted (`emitOp` / `sendFileContent` in `files/file-ops.ts`, plus any future sibling) rather than by a hand-maintained allowlist of module names. Where the property cannot be decided structurally, the test **enumerates the undecidable sites by name and fails on a new one** — a census that grows silently is the WP78 spawn-census shape and is the failure mode here.
   - **Observable:** removing AC1's guard turns this test red **on its own pin**, distinct from AC1's behavioural rows; adding a new content-emitting call site with no guard turns it red naming that site; a guarded call site does not. The census count is pinned as a number and its members are listed in the report.
   - **Vacuity risk — named:** a regex over source that matches nothing on a tree where the emitter has been renamed — **the WP82 diagnostic failure, in test form**. The test must carry a **positive control** proving its pattern matches a known-present emission site before it reports zero unguarded ones. Second: pinning the census to the two emitters that exist today in a way that quietly admits a third; the pin is `toEqual` over the enumerated set, not a `>=` count.

4. **The sanctioned path still delivers a canvas created mid-session, and the evidence names the mechanism.**
   - **Deliverable:** no code — this is the criterion that stops the fix from re-opening WP79's complaint. With the door closed, a `.canvas` created in the shared folder mid-session still reaches the guest.
   - **Observable (live, both vaults):** after the create, the guest holds the file **and** its own log carries the mirror receipt for that path — `CANVAS MIRROR: role=guest … materialised=` incremented, and `CANVAS WRITER: <path> owner=CanvasPersistence attached (coldOpen=…)` — the exact two lines `ImplementationReport_WP79.md` records for a materialised canvas. The guest's `canvas.state` shows the records, so the file is doc-backed rather than a byte drop. **The host arm reports `materialised=0` and writes nothing**, unchanged (S21).
   - **Vacuity risk — named, and it is the reason this AC exists at all:** asserting that the guest *has the file*. That is exactly what `[07]` asserted, and it is exactly what the door being closed here was satisfying. **A file-existence assertion cannot distinguish the mechanism that produced the file, so it may not be the oracle for a WP whose subject is which mechanism ran.** The owner-attribution line is the oracle. Second: reading the receipt from the wrong vault — the host publishes and the guest materialises, and a receipt read on the host would show `materialised=0` and be reported as a failure of the guest. Third: a canvas that was **already** in the manifest before the run, which the mirror would have delivered at join and which proves nothing about the mid-session path; the canvas must be created **after** both peers report a live session, and that precondition is asserted, not assumed.

**Definition of Done:** a shared `.canvas` travels between peers by exactly two routes, both of which merge; and the comment that lists them says only what a test can keep true.

---

## 5. Constraints and Known Risks

- **Permission / environment limits:** Windows dev host. Run tests from the workspace root, never from a subdirectory; long-running invocations through `visible-console` `run_python` / `run_command` with **absolute** paths, never a Bash background process. **The two owner vaults, the two control ports (39431 / 39432) and `H:\tmp\liveshare_*.py` are shared with other work** — check `DISPATCHER_STATE.md` and the task registry before launching, installing, restoring or resetting anything, and never during another agent's run. The relay is production: `GET /healthz` only.

- **Known risks specific to this WP:**
  - **⚠ The most likely wrong implementation is a private `endsWith(".canvas")` at the emission point.** It passes every behavioural row in AC1 and re-creates the propagation pattern the predicate exists to stop. AC2's derivation and AC3's census are the defences and may not be trimmed.
  - **⚠ The second is to guard the whole `onFileCreate` rather than the content emission.** The method also handles folders (`:378-381`) and is the loop-prevention surface for received creates. A blanket early return changes behaviour for paths this WP has no business touching. **The refusal is of the CONTENT PUSH for one path class, and nothing else.**
  - **⚠ The third is to "fix" the docstring by deleting the enumeration.** Block B is a working, tree-derived oracle with a landed test. Deleting or loosening it because a *different* block was misleading trades a real check for tidiness.
  - **⚠ The fourth is to widen into `onFileDelete` / `onFileRename`.** Both are named out of scope with reasons (§2). Annexing them is the unchartered-widening failure five earlier WPs were held to.
  - **⚠ The fifth is to assume the mirror covers mid-session creation because the source says so.** Verification 4 traces the chain and **AC4 measures it**. The distance between those two is the whole difference between this run's good weeks and its bad ones.
  - **⚠ The sixth is to conclude the docstring "was wrong" and stop there.** It was mis-scoped and one row stale; the sentence everyone quoted governs a block that is correct. A report that records *"the docstring was false"* would propagate a second wrong claim to replace the first, which is the S41 shape one WP later.
  - **⚠ Do not mirror any generated test suite into `plugin/src/__tests__/` before this WP is implemented.** `tsc` typechecks `src/` including tests, so an unimplemented mirrored suite breaks `npm run build` **repo-wide** for every other WP. Violated once already in this run.
  - **⚠ Both vaults' `data.json` hold live credentials.** No value from it is read, printed, logged, fixtured, put in a test name, a report or a commit message.

- **Known flaky patterns:**
  - **The relay's host election is a coin flip** (S27 / S37): 34 role transitions on one vault in 2 h 05 min, no alternation. **No criterion here may depend on which vault is host** — AC1's and AC4's shapes are role-symmetric by design, and every live row records the role each instance actually **resumed as**, read from its own `[session] resuming as …` line.
  - **The canvas E2E suite is not idempotent** and reads **13/18** for reasons attributed to WP82's latch. **Whatever it reads is recorded as a measurement; 19/19 is not the current baseline** and must not be asserted.
  - Every WP83 scenario carries a per-run marker in the file name it creates, and cleans up after itself. A scenario that leaves a `.canvas` in the shared folder has changed the manifest for every scenario after it.
  - Do not assert on log strings as a general oracle — **except** in AC4, where the write's **owner** is the subject and the log line is the only place the product states it.

- **External dependency risks:** none permitted (D11).
- **Hard constraints:**
  - **The guard is the shared predicate, imported. No private `.canvas` test, no second constant, no re-spelt sidecar prefix.**
  - **`skipsAutoTextSync`'s body (`utils.ts:332-334`) is byte-unchanged.**
  - **Block B of the contract comment (`utils.ts:277-294`) and `test_tp09_one_predicate_one_definition_visible.test.ts` are byte-unchanged.**
  - **`onFileModify`, `onFileDelete`, `onFileRename` and `sendChunked` are byte-unchanged.**
  - **`files/canvas-mirror.ts`, `files/canvas-mirror-decision.ts`, `files/manifest.ts`, `main.ts`, `sync/**` and `testing/e2e-control.ts` are byte-unchanged.**
  - **No new E2E control command. No `server/**` edit. `useCanvasBinding` is not flipped. The plugin version is not bumped. `plugin/manifest.json` is not touched.**
  - **No `DONE` work package's acceptance criterion is amended; WP83 holds no §7 licence of any class.** A reddened inherited assertion — in particular the two `toEqual([true])` consult-array assertions in `__tests__/w4-canvas-integrity.test.ts` (`:1673-1678`, `:1756-1761`) — is an **ESCALATE**, left red.
  - **`git status` re-read immediately before every commit (rule 14). No revert of a path this batch did not create.**

### Recorded, not repaired — this WP's own sweep

- **S42 — the signal register has COLLIDED, and two of the collisions are load-bearing for this batch.** `S28` names both *"a per-file read failure in `publishManifest` becomes an entry deletion"* (`DISPATCHER_STATE.md`, B20) and *"`canvas.open` subscribes but never opens a leaf"* (`ImplementationReport_WP37.md:395`). `S29`, `S30` and `S31` collide the same way between the B20 set and the WP37 report's set — `S30` is simultaneously *"the debug log grows unbounded"* and *"the canvas E2E suite is at 13/18"*. `S25` names both *"the relay's host-identity churn"* (BUILD_SPEC §9 WP80 note) and *"a fifth unguarded door onto `.canvas`"*. **A batch briefed with a bare S-number cannot resolve it**, and this batch was briefed with three of them. Numbers from **S42** upward are allocated here to avoid extending the collision. **Needs an owner; it is a register, and a register with duplicate keys is not one.**
- **S43 — `onFileDelete` and `onFileRename` carry a shared `.canvas` path across the file-op channel.** `files/file-ops.ts:450-459`, `:461-474`; applied at `:216-229` (`trashFile`) and `:231-…`. They carry **no content**, so neither can overwrite a byte or install a writer, and they are correctly out of WP83's scope. **But the delete arm trashes a peer's `.canvas` on a path `CanvasSync` owns, outside the CRDT and outside the tombstone design WP12/WP19 built for exactly this** — and it is muted from the vault events, so the doc is not told. Whether that is intended propagation or a sixth door is a real question with a real data-loss shape. **Unowned. Do not fold it into WP83.**
- **S44 — WP80's `readFailures` gate does not cover an incomplete file *listing*, only an incomplete file *read*.** `getSharedFiles()` is `this.vault.getFiles().filter(isSharedPath)` (`files/manifest.ts`, working tree). A path missing from Obsidian's loaded-file index never enters `files`, never throws, and therefore contributes **zero** to `readFailures` — so `decidePublication`'s S28 clause (`files/manifest-purge-decision.ts:242-255`) cannot see it, and witness 1 (`enteredSessionAsHost && !foreignEver`, `:267-275`) grants the purge regardless of `unaccounted`. **This is the honest residue of the withdrawn WP84** (§9 of the BUILD_SPEC): the read-failure shape is closed, the listing shape is not. **TRACED, NOT MEASURED** — no measurement of whether `vault.getFiles()` can be incomplete at any publish call site was taken, and this batch is forbidden to run the instances. Recorded with its evidence class named, on the `isSharedPath` precedent where a confident wrong claim would have chartered a WP against a bug that did not exist. **Unowned.**
- **S45 — `canvas.open` permanently disables the product's own writer-attach seam for the path it opens.** `testing/e2e-control.ts:1255-1262` (HEAD) calls `cs.subscribe(path, roleOf())` **directly**, bypassing both sanctioned attach paths, and `main.ts`'s leaf-open attach is gated on `!isSubscribed` (`:1220` HEAD / `:1247` wt). So a path opened through the rig is subscribed, writerless, and **can no longer be given a writer by opening a real leaf**. This is S28-of-the-WP37-set with its consequence traced one step further, and it is the confound in that report's S29 measurement. **Owned by WP85 as its central hazard, not by WP83.**

---

## 6. Definition of Done Artifacts

- **Required changed files:**
  - `plugin/src/files/file-ops.ts` — the guard on the create-content emission, and the import of the shared predicate
  - `plugin/src/utils.ts` — the contract comment only; the predicate body byte-unchanged
  - `plugin/src/__tests__/**` — the AC2 coherence derivation and the AC3 census, staged only once the implementation lands
- **Already landed by Worker 2 with this charter — NOT implementor work:** the §9 WP83 row and the §7 / header counts (82 → 84, with WP84 withdrawn), re-derived from §7 and §9 rather than edited independently. **The implementor does not edit `BUILD_SPEC_CanvasV2.md`.**
- **Required report:** `ImplementationReport_WP83.md` (in `workflowArtifacts/canvas-v2/`), which must additionally record: an explicit statement at the top that **the door is a raw-bytes door and not a second `Y.Text`**, with the receiving-side sites (`file-ops.ts:194`, `:203`) and the mute at `:184` quoted, so the corrected mechanism is not lost; **AC1's live before/after on both vaults**, with the non-canvas control file that proves the channel was up, and the role each instance resumed as; **AC1's headless `.canvas` row shown RED against the current tree**; **AC2's derivation shown RED against the current comment, naming `background-sync.ts`'s uncovered call site**, plus the three specific comment changes quoted in full and a positive statement that **block B and `test_tp09` are byte-unchanged**; **AC3's census as a pinned enumerated set** with its positive control demonstrated; **AC4's guest-side receipt lines quoted verbatim** with the host arm's `materialised=0`, and the statement that the canvas was created **after** both peers reported a live session; the **executed test count** before and after with the statement that no existing test was deleted, weakened, retitled, skipped or amended and that **no §7 licence of any class was taken**; the disposition of the two `w4-canvas-integrity.test.ts` consult-array assertions (unaffected, or ESCALATED and left red); and, for every live run, which vault ports were used, that **no `data.json` value was read or printed**, that the relay was contacted only by `GET /healthz`, that the shared folder was left as found, and that `canvas.simulateEdit` was not called.
- **BUILD_SPEC updates required:** no — the §9 row and the counts were entered when this charter was written. Anything further is an **ESCALATE** rather than a spec edit.
- **Gate status required at handover:** `npm run build` (tsc + esbuild) PASS and `npm test` 0 failed from `plugin/`, with the executed test count recorded. `npm run lint` advisory locally, gating in CI — do not mass-reformat. **The canvas E2E suite's reading is recorded as a measurement, never asserted as 19/19.**

---

## 7. Visible Test Cases / Producer Artifacts

*Filled by Worker 3. Worker 2 leaves this section empty.*

*⚠ **Blind sets are discontinued for new work** (owner's instruction, 2026-08-05): no `blind_set1`, no `blind_set2`, no falsification-injection requirement and no `BlindVerificationLedger` row is owed by this WP. Validation is W4 against two live Obsidian instances, with headless tests carrying the rows a live instance cannot honestly produce. E2E-plugin defects found while validating go back to **W3 as a revision**.*

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
