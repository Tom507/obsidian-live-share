# WP122 — A file with no writer cannot converge

**Source:** `Investigation_CanvasConvergence.md` §5 **R1 + R2**, and **R5** (`S170`) ·
**Owner decision 2026-08-08** · **Branch:** `fix-bugs-and-raceconditions`
**Depends on WP121, hard.** Read `TaskCharter_WP121_WinningIsNotALicenceToDiscard.md` §0 and §2 first.

---

## 0. The owner's decision, and its exact limits

The owner was shown three ways out of the canvas convergence remodel and **chose the narrow one:**

> **Bind the writer on the host's own creates.**

- **NOT authorised:** the broad reading — *"the host's file follows like any peer"*. Explicitly declined.
- **NOT authorised:** canonicalising serialisation everywhere so all copies match at birth (the third option).
- **DEFERRED by the owner, therefore out of scope:** canvas-only versus the general file-sync model.
  **Scope everything in this package to `.canvas`.** Do not rework the `.md` path. `.md` is measured
  unaffected — a guest's editor edit reaches the host's disk at the first poll, **0.00 s**
  (Investigation §1.3).

**The defect, in one sentence:** a host-created canvas has **no CRDT→disk writer for the life of the session**,
so a guest's edit reaches the host's shared *document* in seconds and its *file* **never** — measured unchanged
after **240 s** and after four unrelated manifest changes, then converged in **0.00 s** the instant a human
opened the board. A guest-created board takes **0.25 s**, because its create handshake attaches the writer.
**The deciding variable is who created the canvas.** This violates the owner's priority-1 ruling
(`DISPATCHER_STATE.md` §5) and sits at the top of the §3 queue.

---

## 1. The three rules, with line numbers verified against the tree on 2026-08-08

The investigation's numbers were checked, not copied. **One is off by one; the rest are exact.**

| # | rule | verified location | status |
|---|---|---|---|
| **R1** | host arm of `mirrorOne` returns `PUBLISH`, *"No write, no attach, no cold open: the host's file must not be rewritten by this pass (AC4 is absolute…)"* | `plugin/src/files/canvas-mirror.ts:310-323` (`MIRROR_VERDICT.PUBLISH` at `:319`) | investigation said `310-322`; **the closing brace is 323**. Trivial, corrected. |
| **R2** | `probe.role === "host"` can only answer `PUBLISH` or `SKIP_NO_SOURCE` | `plugin/src/files/canvas-mirror-decision.ts:140-146` | **exact** |
| **R5** | `handleResult` arms `adoptable` and arms no pass | `plugin/src/files/canvas-create.ts:566-567` | **exact** |
| — | `armCanvasMirrorPass()` | `plugin/src/main.ts:3548` | **exact at the time of writing — see the warning below** |
| — | the guest-create precedent that already attaches on the host | `canvas-create.ts:377` (`role() !== "guest"` → `NOT_GUEST`), attach at `canvas-create.ts:507`, wired at `main.ts:2492` | ✓ |
| — | the mirror's attach seam | `main.ts:3559` `materialise: (path) => this.attachCanvasWriter(path)`; `attachCanvasWriter` at `main.ts:3632`; `hasCanvasWriter` at `main.ts:3597` | ✓ |
| — | the verdict admission gate you will otherwise miss | `admitsCanvasMirror`, `canvas-mirror-decision.ts:180-192` | ✓ |

⚠ **`main.ts` line numbers WILL have moved.** A sibling worker (B58 / WP120) is editing `main.ts` in this same
checkout right now. `armCanvasMirrorPass` is declared at `:3548` and **grep finds ten call sites**
(`main.ts:1372, 1671, 1692, 2227, 2269, 2308, 3484, 4417, 4455, 4471`) — so the call pattern is well
established and yours is the eleventh. **Ten is what grep found, and workflow §3.4 is explicit that grep
cannot support an exhaustiveness claim** (a capability passed as a callback has no call site to grep); do not
carry the figure forward as *"all of them"*. **Re-locate everything in `main.ts` by name, never by number**,
and say in your report which numbers you found.

---

## 2. 🔴 THE INVESTIGATION'S SAFETY ARGUMENT IS WRONG. Design around it.

This is the most important section of the charter. The safety argument is the reason the owner chose this
option over the broad one, so it has to be right — and **two of its three steps do not hold.**

**The claim** (Investigation §5, R1):

> *"`PUBLISH` **already** subscribes and seeds the document from the host's file, so the doc and the file are
> identical at that instant and an attach could not destroy anything. Attaching the writer here is a no-op at
> attach time and the entire fix at edit time."* — and therefore WP79's AC4, *"the host's file must not be
> rewritten by this pass"*, **survives literally**.

**What the tree actually says:**

**(1) The host seed is a MERGE, not a replace — so doc == file is a special case, not the general one.**
`CanvasSync.subscribe`'s host arm (`canvas-sync.ts:3041-3051`) reads the file and calls `applyCanvasToYMaps`
(`:4501`). That method's **own docstring** (`:4495-4499`) states it plainly:

> *"the delete-by-omission this method used to drive through `seedFlatSpace` is gone. **The host's local file is
> no longer the host's picture of the WHOLE board — it is a set of proposals about the records it names**, and a
> rejoin is an ordinary related-replica merge."*

The seed also runs **after** `waitForSync` (`canvas-sync.ts:2989`), so the doc may already carry peer state
before the host's records are merged in, and `seedFlatSpace` can **refuse** records (WP63/WP94 ledger). After
the seed the doc is the **union**, minus refusals. It equals the file only when the doc was empty and nothing
was refused.

**(2) An attach is not a no-op. It cold-opens, and a cold open on a non-empty doc flushes.**
`attachCanvasWriter` (`main.ts:3632`) → `attachCanvasPersistence` (`main.ts:3696`) → `coldOpen()`
(`canvas-persistence.ts:608`) → `docNonEmpty` (`:612`) → `doc-wins` → **`await this.flush()`** (`:619`).
The host arm of `mirrorOne` only runs when `localFileExists === true`, and a non-empty file seeds a non-empty
doc, so **`docNonEmpty` is true essentially always on this arm.**

**(3) Therefore WP79 AC4 does NOT survive literally under a plain attach. The pass writes the host's file.**

### What that does and does not change

- It does **not** make the owner's chosen option wrong. The flush's usual direction is exactly what priority 1
  wants: the doc holds the guest's edit, the flush delivers it to the host's disk. **That is the fix.**
- It **does** demote WP121 from "safety net" to **hard precondition**. WP122 fires the `doc-wins` path
  automatically, on every host-held canvas in the manifest, at the next mirror pass — on boards that are already
  divergent today, all of them at once.
- It **does** force a design decision that must be made deliberately and stated:

  - **(a) Attach, and let the cold open flush.** Simplest; matches the guest-create precedent
    (`canvas-create.ts:507`), which already attaches on the host and is measured working (0.25 s). Safe **only
    because WP121 now guards the flush.** If you choose this, **WP79 AC4 must be re-stated in the spec** as
    *"the pass does not write the host's file except through the guarded `doc-wins` flush"* — you may not leave
    a landed AC quietly contradicted. Say so in your report and hand the wording to the Dispatcher.
  - **(b) Attach with the cold open suppressed, or in a file-aware mode.** The pass writes nothing and AC4
    survives literally — but you must then say what makes the file converge, and *"the next real edit"* is only
    an answer if you **demonstrate** it.

  **Choose, state which, and give the reason. Do not discover this at the keyboard.** (a) is likelier; the
  charter deliberately does not pick.

  > **OWNER'S RULING, 2026-08-08 — the choice is delegated to you, and it is delegated on one condition.**
  > The owner was shown this fork with both options and their costs, and ruled: *let the implementer decide,
  > with evidence.* So **you** pick (a) or (b). The condition is that the decision arrives **argued and
  > broken**, not asserted: your report must give the reason you chose, a break table for the arm you built,
  > and — this is the part that is easy to skip — **what you expect would have gone wrong had you built the
  > other one.** If you chose (a), the exact WP79 AC4 re-wording comes back to the Dispatcher with it; the
  > owner approves that amendment at handover, not you. A landed acceptance criterion may not be left quietly
  > contradicted.

**If, on reading the code, you conclude that THIS correction is itself wrong — say so as loudly as it is said
here.** A predecessor's reading is a strong prior, not an instruction, and workers correcting their charter is
the norm on this run: eight in a row did, and every one was right.

---

## 3. Scope, in build order

**R2 before R1** — the verdict has to exist before the host arm can return it.

1. **`canvas-mirror-decision.ts` — a fourth verdict.** `PUBLISH_AND_BIND_WRITER`, or an `attach` field on
   `PUBLISH`. **The pure core stays pure** — zero imports, no I/O, no attach; it returns a verdict and
   `canvas-mirror.ts` executes it.
   ⚠ **`admitsCanvasMirror` (`:180-192`) enumerates the admitted verdicts.** A new verdict not added there is
   skipped before `decideCanvasMirror` is ever asked — WP117 already hit exactly this and left the comment
   saying so. Derive it from the same function rather than re-stating the rule, as the other three are.
2. **`canvas-mirror.ts` — the host arm executes it.** Use the existing `materialise` seam (`main.ts:3559`) or an
   equivalent injected callback. **Do not add a second attach route into `main.ts`:** `hasCanvasWriter`
   (`main.ts:3597`) is the single definition of *"already attached"*, re-entrancy is real (the attach awaits
   `coldOpen` while `syncCanvasPresences` fires on `layout-change` and `active-leaf-change`), and two definitions
   of that predicate is how a double attach gets in.
3. **`canvas-create.ts:566-567` — R5, one line, its own acceptance criterion.** Call `armCanvasMirrorPass()`
   from `handleResult`'s **accepted** branch. **This is the whole of `S170`.**
   ⚠ `armCanvasMirrorPass` is `main.ts`-private and the coordinator's environment is an injected surface —
   `main.ts:2492` shows the established pattern (`attachWriter: (path) => this.attachCanvasWriter(path)`). **Add
   one env field. Do not import `main.ts` into `canvas-create.ts`.**

⚠ **`main.ts` is the sibling's file.** B58 / WP120 owns `canvas-presence.ts`, `canvas-sync.ts` and `main.ts`.
If B58 has not landed when you start, **coordinate with the Dispatcher before editing `main.ts`** — do not edit
it concurrently. State in your report exactly which `main.ts` hunks you own.

---

## 4. Acceptance

### B1 — A host-created canvas has a writer, without a human

`hasWriter` reads **true** on the host for a board the host created and nobody opened.

**Measure it on the host's own writer state, never from `canvas.mirror`.** `S138`: throughout the 240-second
stall the host's mirror read `role=host considered=14 published=14 failed=0` — a completely healthy-looking
pass on a peer whose file was 176 bytes and two records behind its own document. **`published` means "the guid
is bound" and nothing more.**

### B2 — THE HEADLINE: a guest's edit reaches the host's file, on a host-created board nobody opened

The priority-1 criterion. **Scored on parsed records. Never on bytes** — see B3.

**Discriminator, and build it in:** ask what this test does on **today's** build. Today the host's file is
unchanged after 240 s and after four unrelated manifest changes, so a correctly constructed test is red today by
an enormous margin. **Show that red.** If your test could pass with R1 unchanged, it is measuring the document,
not the file, and it measures nothing this package is about.

### B3 — 🔴 `S174`: the oracle cannot judge geometry, and this criterion IS geometry

**The facts, verified:**

- `ExpectedContent` (`plugin/src/testing/e2e-control.ts:424-443`) has exactly five fields: `origin`, `exists`,
  `sha256`, `contains`, `atLeastBytes`. **No records clause. No geometry clause.** A positional expectation
  returns `unjudgeable`.
- `sha256` is forbidden here by construction: three stable spellings for identical records — the author's, the
  plugin's canonical `serializeCanvas` = `JSON.stringify(buildCanvasData(…), null, "\t")` (`canvas-sync.ts:1253`,
  the `stringify` at `:1258`), and **Obsidian's own** one-record-per-line form. Measured live at 235 / 296 /
  218 B with **zero field differences**.
- **`contains` is not a substitute.** It is a raw substring test. `"x": 111` (plugin, tab-indented) and
  `"x":111` (Obsidian) are different substrings for the same geometry, so a `contains` expectation goes green or
  red depending on which peer happened to have the board open. **Demonstrate that as a row** — it is one line of
  test and it retires the idea permanently.
- **`peersAgree` is not usable either.** `evaluatePeerAgreement` (`:489`) compares via `sameFileObservation`
  (`:302`) = `exists && sha256 && size && content`. **Peer agreement on this build is a byte test.**

**DECISION — made here, not left to you: extending `ExpectedContent` with a record-level clause is IN SCOPE for
WP122.**

**Reasoning, so you can overturn it with something better.** WP122's headline criterion is literally a node
position. Without the clause, B2 can only be expressed (i) on bytes — forbidden; (ii) by a bespoke comparison
written inside the test — which is **`S158`'s shape**, an instrument with no reference point outside the peers,
and this project supplied its own counter-example when all three clients agreed perfectly on the digest of the
empty string while every `.md` in the share was being truncated to nothing. A judge that cannot express the
project's central question is the gap. It is one additive clause and it is small.

**Bound it tightly:**

- A `records` clause stating expected node/edge **ids**, and optionally `x`/`y` per id, matched against
  `parseCanvas` output. **Not** a general geometry language, **not** a diff engine.
- **Additive only.** An unstated clause reports `stated: false, satisfied: null` — that is already the shape of
  every clause (`ConvergenceClause`, `:452-461`) and it is `S155`'s rule. Every existing clause's semantics stay
  byte-unchanged.
- ⚠ `plugin/src/__tests__/v2/wp116/test_s158_the_oracle_that_could_not_see_a_shared_loss.test.ts` **pins every
  branch** (`everyBranch: ExpectedContent[]`, `:334`). **It must stay green without being edited.** If you find
  you have to edit it, **stop and report** — that is the signal that your clause is not additive.
- If you conclude the clause **cannot** be additive, treat it as a **blocker needing its own package** and say
  so — but say it with the line that forced the conclusion, not as a preference.

### B4 — The attach does not destroy, on a board that is ALREADY divergent

This is the population WP122 newly touches and the entire reason WP121 goes first. Two cases, both required:

- **The union case (the fix):** the doc holds a peer's card the host's file lacks. After the attach the host's
  file **holds it**, and nothing the file uniquely held is gone.
- **The dangerous case:** the file holds records the doc does not — the exact `doc-wins` trapdoor. **WP121's
  guard must fire.** If it does not, WP122 cannot land; report that as a blocker rather than working around it.

### B5 — `S170` closes, and the test can tell the fix from the accident

`armCanvasMirrorPass()` from `handleResult`'s accepted branch. Measured: an originator sat unadopted for
**240 s**, then adopted in **0.20 s** the moment the host created an unrelated note somewhere else in the share.

**The test must show the adoption happening with NO other manifest activity at all.** A test that permits any
other manifest write cannot distinguish your fix from the accident — and that accident is precisely why WP118's
third round converged in 0.22 s while rounds 1 and 2 waited for the next unrelated manifest write
(Investigation §3.3).

### B6 — Do not widen

- **`.canvas` only.** Do not touch `background-sync.ts`, the `.md` path, or the general file-sync model. The
  owner deferred that question.
- **Do not touch `file-ops.ts` or `vault-events.ts`** — `S88`: `v2/wp93/`'s census tests read the **live working
  copy** of those two files and the gate goes transiently red while they are edited.
- **Keep every `=== true` and `!== false` in `decideCanvasMirror` exactly as it is.** They are fail-closed by
  design: an unanswered probe must not make the host subscribe — and therefore seed — a path it may not hold.
  `canvas-seed-decision.ts`'s header explains what a truthiness test costs here: it turns a wiring bug into data
  loss. The host arm's `localFileExists === true` → else `SKIP_NO_SOURCE` behaviour is unchanged by this package.

---

## 5. Method — the break table (Dispatcher Rule 11 / workflow §3.1)

For every AC: plant the break, show **RED for the right reason**, restore **byte-identically by copy-aside**,
show **GREEN**. **A break that reddens nothing is a finding, not a cleanup item.**

**The specific plant most likely to expose the failure mode THIS package can introduce:**

> **Hoist the attach ABOVE the subscribe** — move it before `await deps.canvasSync.subscribe(path, role)`
> (`canvas-mirror.ts:305-307`). The doc is then empty-or-peer-only at cold open, the host's own records have not
> been merged in, and the flush writes a board **missing everything the host authored**.
>
> **B4 must go RED and must name the missing record ids.**
>
> This is the destruction this package can cause, and the ordering that prevents it **is not enforced by any
> type** — it is enforced only by the order of two statements inside one function. Nothing in the codebase will
> catch a future refactor that reorders them except this test.

Two more, both required:

- **Return the new verdict but never execute the attach.** B1 must go red. This is `S160`'s shape — publication
  unconditional while the write that would make it true is conditional — and it is easy to ship by accident when
  the verdict and the effect live in different files.
- **Arm the mirror pass on the REFUSED branch instead of the accepted one** (`canvas-create.ts`). B5 must go red.
  A pass armed on refusal is invisible in the stats: `adoptionsArmed` increments on the accepted branch (`:567`)
  either way.

⚠ **Restore by copy-aside only.** A sibling shares this checkout. **Never `git checkout` or `git stash` to undo
a break** — it takes the sibling's uncommitted work with it.

**No partial test doubles** — six packages lost to them. Drive the real objects, or state exactly which paths
your double does not exercise. This package is exposed twice over: a double for `attachCanvasWriter` hides the
cold-open flush that §2 is entirely about, and a double for `subscribe` hides the merge semantics that make B4
non-trivial.

**Every new test gets a positive control.**

---

## 6. Gate

From `plugin/`, in this order:

```sh
./node_modules/.bin/tsc -noEmit -skipLibCheck
./node_modules/.bin/vitest run
npm run build
```

then `check_signal_register.py`, exit 0.

- **Plain `vitest run`.** `--reporter=basic` **does not exist in this version and fails to load**, which looks
  exactly like a suite failure and is not.
- **Baseline: `[Dispatcher to insert]`.** There is **no confirmed count at HEAD** — the run started at `e974fdd`
  died on a console launcher fault before reporting a total, and the older **3260 / 428** at `d188b0e` is stale.
  **Do not write a number you did not measure, and do not copy 3260/428.**
- **Caveat `S153`:** WP92's `no_collateral` asserts a file is absent from `git diff HEAD` — red while
  uncommitted, green once committed. Confirmed three times. **Not a real failure. Do not edit another package's
  test.**
- **Caveat `S88`:** stay out of `file-ops.ts` and `vault-events.ts` (B6).
- **Never `npx biome check --write`** — it corrupts this tree.

**Hard constraints**

- **Sibling in the tree.** B58 / WP120 owns `canvas-presence.ts`, `canvas-sync.ts` and `main.ts`. Coordinate
  before touching `main.ts`; do not touch, stage, revert or checkout the other two. You may read anything.
- **Explicit path staging only.** `git commit -o <paths>`; `git add -N <path>` first for a new file.
  **Never `git add -A`.** Never commit to a default branch.
- **`M` with an empty `git diff` is ambiguous** — CRLF artefact, or a mode/symlink flip. Distinguish with
  `git ls-files -s` + `git hash-object`, never by reading the diff.
- **`data.json` holds live credentials** — never print, log, echo or fixture a value.
- **Do not rebuild, redeploy, or drive the three live vaults.** Headless package; the live arm is W4's, and
  under this workflow a green suite is a **precondition**, not a completion.

---

## 7. Report

**Deliverable:** `workflowArtifacts/canvas-v2/ImplementationReport_WP122.md`.

1. **Split every finding into DEMONSTRATED and ARGUED** (workflow §3.7). Only the first counts as closed.
2. **§2's verdict, in the first section.** Did you confirm the correction, or overturn it? Which of (a)/(b) did
   you build, and why? **If you chose (a), hand the Dispatcher the exact re-wording for WP79 AC4.**
3. **B3's decision as built**, and whether the `records` clause stayed additive — with the state of
   `test_s158_the_oracle_that_could_not_see_a_shared_loss.test.ts`.
4. **The `main.ts` line numbers you actually found**, and which hunks you own.
5. **The break table**, one row per AC, including the hoisted-attach plant.
6. **The gate figure you measured yourself**, with the tree state.
7. **Correct this charter if it is wrong.** §2 is itself a correction of the investigation this package is built
   from.
8. **Signal numbers: next free is S175, and you allocate none.** Describe findings in prose; the Dispatcher
   numbers them in `SIGNAL_REGISTER.md`. <!-- signal-register: meta -->
</content>
