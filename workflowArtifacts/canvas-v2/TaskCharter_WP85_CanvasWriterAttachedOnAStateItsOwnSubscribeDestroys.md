# Task Charter — WP85: the doc→disk writer is attached on a state the product's own subscribe destroys

<!-- Updated: chartered 2026-08-05 (B25) from S29 (WP37-report set) — "the `.canvas` file of an OPEN canvas does not converge from the doc", measured RED both with and without WP37. ⚠ RULE-12 RE-VERIFICATION SPLIT THE FINDING IN TWO, AND BOTH HALVES MATTER. (a) THE MEASUREMENT IS CONFOUNDED. The WP37 suite reaches its canvases through `canvas.open`, and `canvas.open` (`testing/e2e-control.ts:1255-1262`) calls `cs.subscribe(path, roleOf())` DIRECTLY — bypassing both sanctioned attach paths AND, because `main.ts`'s leaf-open attach is gated on `!isSubscribed` (`:1251` at `22fc50b`, `:1220` pre-WP80), permanently disabling the seam that would have attached one. That alone is sufficient to produce the observed non-convergence, so S29 as measured is a RIG ARTEFACT and it is S28-of-the-WP37-set with its consequence traced one step further (recorded as S45). (b) THE SAME SEAM IS REACHABLE IN PRODUCTION WITH NO RIG AT ALL. WP79's mirror pass subscribes every shared canvas on the HOST and returns without materialising (`files/canvas-mirror.ts:249-266`), which makes the leaf-open attach unreachable for the rest of the session — so a host's shared canvas is subscribed and WRITERLESS whether or not it is open. WP79's own landed live receipt is the evidence: `role=host considered=6 published=6 materialised=0`. The claim S29 makes is therefore TRUE OF THE PRODUCT for a different and independently reachable reason than the one it was measured by, and this charter's AC1 is written to establish it WITHOUT `canvas.open` so the confound cannot be inherited. ⚠ C37 AC2 IS NOT AMENDED — see §2. No Obsidian was launched, no vault was written, no E2E script was run, no `data.json` was opened. -->
**Charter Status:** `SPEC_COMPLETE`
**WP:** WP85
**Phase:** P0
**task_mode:** `standard`
**Depends on:** none. **MUST NOT be batched with WP80 or WP82** — all three edit `plugin/src/main.ts` (see §2 Ordering).
**W4 Test Targets:** `0`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b.
>
> **⚠ WP84 does not exist.** It was chartered in brief and **withdrawn as subsumed by WP80** before a charter was written; see the BUILD_SPEC §9 row. The number is deliberately not re-used. This WP is **WP85** and was always called that.

---

## 1. Task Objective

- **Outcome:** a shared canvas that a peer holds a doc for and has **open on screen** has a live doc→disk writer, so remote changes reach the durable artefact — the `.canvas` file — without waiting for Obsidian to decide to save the view. Today the attach is coupled to the *subscribe*: it happens only when a canvas leaf opens for a path **that is not already subscribed** (`main.ts:1251` at `22fc50b`; `:1220` pre-WP80). Every sanctioned path that subscribes a canvas *before* its leaf opens therefore consumes the one opportunity and leaves the path writerless for the life of the session.
- **The sharp form of it:** `CanvasPersistence` is the **only** live doc→disk writer for a canvas (§3 Verification 2, with the census and its positive control), it observes the doc with **no origin filter** so remote deltas persist exactly like local ones (`files/canvas-persistence.ts:239-257`, `:308-309`), and it is attached from exactly **two** call sites (`main.ts:1271` and `:1728` at `22fc50b`; `:1240` / `:1697` pre-WP80). Neither fires for a host's shared canvas. **The mechanism is correct; the gate in front of it is wrong.**
- **Why this is P0.** It removes the safety argument every view-side deferral rests on. WP37 shipped a deliberate view-side deferral on the stated premise that *"the file stays converged while the view is deliberately stale — that is what makes deferral safe"* (`TaskCharter_WP37…:154`). On a writerless path that premise is false, and the same premise is the reason `main.ts`'s pre-WP37 busy gate was described as *"safe"* in C37 AC2 itself. **A safety argument that has never been measured is not one**, and this is the WP that measures it and then makes it true.
- **It is the defect WP49 built an oracle for and no live run has ever pointed at it.** `__tests__/wp49/test_tp6_doc_converged_file_diverged_visible.test.ts` opens with *"On the lightweight host the doc IS the system. On real Obsidian the doc, the view and the file are three projections and only the file is durable. A doc-only oracle therefore goes green while the two vaults hold different bytes on disk."* That is `DOC_CONVERGED_FILE_DIVERGED` — the D17 class — and it is precisely what a writerless peer produces. The oracle is landed and pure; **the state it exists to catch has been live in the product the whole time.**
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 9, work package **WP85**; §5 C7 (US5 AC13/AC16/AC17, the single-writer attach), and C49 AC2 (the D17 verdict this state produces). Phase **P0**: durability of the canonical artefact.

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: modify, **one repository** (`obsidian-live-share`, branch `fix-bugs-and-raceconditions`), **`plugin/src/` only**.
  - Responsibility: decouple the writer attach from the subscribe. An **open, shared, canvas-owned** leaf gets a writer regardless of *who* subscribed the path or *when*.
  - Scope summary: the attach decision in `syncCanvasPresences` (`main.ts:1232-1273` at `22fc50b`) stops being a side effect of the lazy-subscribe branch and becomes its own consultation, taken for every open canvas leaf on a subscribed shared path · the decision itself is a **pure, zero-import predicate** on the `canvas-seed-decision.ts` / `canvas-mirror-decision.ts` precedent, so `main.ts` holds wiring and a read and no decision (§3.1 S11) · `attachCanvasWriter`'s existing per-path idempotence (`main.ts:1749-1751`) is the re-entrancy guarantee and is not re-implemented.
- **Out of scope / non-goals — each is an ESCALATE, not a judgement call:**
  - **⚠⚠ `files/canvas-mirror.ts` and `files/canvas-mirror-decision.ts`. BYTE-UNCHANGED, and this is the charter's single most important boundary.** The obvious repair — *"the host arm subscribes without attaching, so make it attach"* — **would re-open WP79 and violate C79 AC4 as literally written**: *"an existing file is not overwritten, not truncated, not renamed, not trashed and not written to at all — its bytes are compared before and after and are identical."* The mirror pass's host arm says so in its own comment (`canvas-mirror.ts:257-262`): *"No write, no attach, no cold open: the host's file must not be rewritten by this pass (AC4 is absolute, and it does not carve out the host)."* **The repair therefore lives at the view seam, which has attached writers since WP7 and is governed by C7, not C79.** WP85 removes an accidental gate on a pre-existing mechanism; it does not teach the mirror to write. Attaching inside the mirror is an **abort criterion for this WP**.
  - **⚠ A writer for a canvas that is NOT open.** Out of scope, deliberately and with a reason: attaching a writer to every subscribed path would rewrite files the user has never opened, at session start, from a doc whose cold-open branch is decided by C29 AC4 — a far larger change with a data-loss surface of its own, and it is the shape C79 AC4 forbids in the pass next door. **WP85's subject is exactly the open canvas.** The closed-canvas case is recorded as **S47** and is not repaired.
  - **⚠ `coldOpen`, its three outcomes, its branch order and its `after waitForSync / before start()` placement.** C29 AC4 pins all of it, and `attachCanvasPersistence` (`files/canvas-persistence.ts:698-707`) already owns the ordering. WP85 changes *when the helper is called*, never what it does.
  - **⚠ `files/canvas-persistence.ts`.** Byte-unchanged. The writer is correct; nothing about the observer, the debounce, the withhold or the mute changes.
  - **⚠ `canvas.open`'s behaviour (`testing/e2e-control.ts:1255-1262`).** It is the confound (**S45**) and it is **not repaired here** — `testing/e2e-control.ts` is contended by WP37, WP38, WP80, WP81 and WP82, and a rig repair inside a product WP is the annexation five earlier WPs were held to. **WP85 works around it by never using it** (§4 AC1). Its repair is named and owned by nobody.
  - **⚠ `CanvasSync.writeToDisk` (`files/canvas-sync.ts:3513`).** **Dead in production** — zero production callers, reached only by two `as any` test casts (§3 Verification 3). Deleting it would delete inherited tests and requires a §7 licence. **Not deleted, not revived, not called.** Recorded as **S46**.
  - **⚠ Converging the two replicas, or any claim about *why* they diverge.** WP82 owns the connectivity half and explicitly disclaims convergence; at least four causes are live in these vaults. **WP85 owns "a peer's doc does not reach its own disk", not "two peers' docs disagree."**
  - **⚠ `main.ts`'s presence mounting, the WP37 deferral drain (`:1268-1275` wt), `reconcileLiveCanvas`, and the adapter.** Untouched.
  - **⚠ `files/manifest.ts`, `cleanupStaleFiles`, `sync/**`, `ui/**`, `server/**`, `useCanvasBinding`.** WP80's, WP82's, or frozen.
  - **⚠ Any new runtime dependency.** D11 — an ESCALATE.
- **Known interfaces / dependencies:**
  - Input: the open canvas leaves (`app.workspace.getLeavesOfType("canvas")`), `CanvasSync.isSubscribed`, `ManifestManager.isSharedPath`, and whether a writer is already attached for the path
  - Output: one pure verdict per open leaf; a call to the existing `attachCanvasWriter` for exactly the verdict that licenses it
  - **Blocks nothing. Every file-level assertion in every future live run depends on it.**

### Ordering — what must NOT be batched together

1. **WP85 edits `plugin/src/main.ts`. WP80 is live in that file right now and WP82 is chartered over it.** **WP85 may not run in the same batch as either.** Any order is correct; they are independent repairs that collide only in the file system.
2. **WP83 shares no file with WP85** (`files/file-ops.ts`, `utils.ts` vs `main.ts` + a new module). They are batchable together, and both are batchable with nothing else that is live.
3. **`plugin/src/testing/e2e-control.ts` is not touched.** WP85 adds **no** E2E command: `canvas.typeInNode` (landed by WP37, `e2e-control.ts:658-670`, `:1242-1253`) already opens a real leaf via its `open` argument, and `canvas.file`, `canvas.state`, `sync.waitQuiescent` and `scratch.create` cover the rest. **This is deliberate** — it is what keeps WP85 out of the most contended file in the repo.
4. **Rule 14 is absolute:** re-read `git status` **immediately** before every commit, commit with `git commit -o <paths>`, and never `checkout --` / `restore` / `stash` a path this batch did not create. A sibling reverted `main.ts` — this WP's file — between edit and stage once already in this run (S34).

### §7 disposition — no `DONE` work package is re-opened, no acceptance criterion is amended, and no §7 licence of any class is taken

1. **C37 AC2 is NOT amended, and the question the brief poses is answered: the BEHAVIOUR is wrong, not the criterion.** C37 AC2's normative content is *"structural applies for the record being edited are queued, not dropped, and applied on blur; applies for every other record continue immediately"* (BUILD_SPEC `:1047`). That is correct, it is landed, and nothing here touches it. What is false on the current build is its **justification clause** — *"which is safe"* — and the WP37 charter's expansion of it (`TaskCharter_WP37…:154`, *"the file must stay converged while the view is deliberately stale … the property that lets AC2 assert `canvas.file` already holds B's change"*). **A criterion is not made wrong by an unmeasured premise in its rationale; the premise is made true, or the criterion loses its safety argument.** WP85 makes it true. Amending AC2 would be the wrong move twice over: it would weaken a correct requirement, and it would record the product's defect as a specification correction.
2. **No landed test asserts the false premise, and that was measured, not assumed.** Pattern `canvasFile|canvas\.file` over `plugin/src/__tests__/` matches six files, all under `__tests__/wp49/`, and every one of them tests the **pure verdict function** `evaluateCanvasConvergence` over synthetic `canvas.state` / `canvas.file` payloads — the oracle, not the product. The same pattern matches five known-present production lines in `testing/e2e-control.ts` (`:185`, `:290`, `:386`, `:408`, `:424`), so it can find what it looks for. **No inherited assertion reddens on this repair, and no §7 licence of any class is required.**
3. **WP79 is `DONE` and is protected rather than amended** — see §2's first boundary. `canvas-mirror.ts` and `canvas-mirror-decision.ts` are byte-unchanged and C79 AC4 stays exactly as strict as it is.
4. **WP7 (C7) is the criterion this WP serves.** US5 AC13/AC16/AC17 established the single writer and its attach; WP85 does not add a second writer, a second serialiser or a second attach helper. It removes a gate.
5. **`main.ts` gains wiring and a read only.** §3.1 S11 and the §7 abort criterion are absolute: the verdict lives in a separate zero-import module.
6. **If a type is added to `types.ts` it goes at the TOP**, beside `StaleReconcileDecision` — the WP22 dormancy-test comment-strip trap. Inherited verbatim from WP80, WP81 and WP82.

---

## 3. Architecture Context

*Task-local architecture guidance only.*

### Verified against the current tree (rule 12), 2026-08-05 — measured, given, do not re-derive

> **Evidence classes, stated so they are not conflated.** Verifications 1–4 are **static measurements of the tree**. **Line numbers are pinned to `22fc50b`** (`WP80 checkpoint`), which landed while this charter was being written and moved `main.ts` by a few lines; the pre-WP80 numbers at `7964fa2` are given in parentheses where they differ, because two live briefs are already circulating with them. `files/canvas-mirror.ts`, `files/canvas-mirror-decision.ts` and `files/canvas-persistence.ts` were **not touched by WP80** and their numbers are the same in both. Verification 5's live figures are **another batch's landed measurements**, quoted with their source. **Nothing in this charter is a live measurement taken by this batch** — an agent is live in `plugin/src/**` and in both vaults, and this batch is forbidden to launch Obsidian or run the rig. AC1 is where the live measurement is taken. **Re-read before editing: rule 6 — a cited contract is re-read, not recalled, and this file has moved once during this charter's own writing.**

**Verification 1 — the attach gate. One `if`, and the writer is on the wrong side of it.**

```
main.ts:1249 (pre-WP80 :1218)   if (
main.ts:1250 (pre-WP80 :1219)     rawPath &&
main.ts:1251 (pre-WP80 :1220)     !this.canvasSync.isSubscribed(rawPath) &&     ← the gate
main.ts:1252 (pre-WP80 :1221)     this.manifestManager.isSharedPath(rawPath)
main.ts:1253 (pre-WP80 :1222)   ) {
        …
main.ts:1270 (pre-WP80 :1239)     }).then((owned) => {
main.ts:1271 (pre-WP80 :1240)       if (owned) void this.attachCanvasWriter(rawPath);   ← the ONLY leaf-driven attach
main.ts:1272 (pre-WP80 :1241)     });
main.ts:1273 (pre-WP80 :1242)   }
```

`syncCanvasPresences` (`main.ts:1232`) runs on `layout-change` and `active-leaf-change` (`main.ts:1091-1092`) and from `onActiveFileChange` (`:1166`). It iterates every open canvas leaf on every one of those. **For a path that is already subscribed it does everything except attach a writer** — it mounts presence, it tracks the adapter, it drains WP37's deferrals — because the attach is nested inside the lazy-subscribe branch rather than taken as its own decision.

**Verification 2 — the writer census, and its positive control (rule 15).**

Pattern `attachCanvasWriter` over `plugin/src/` (production and tests): **3 hits, all in `main.ts`** — the definition at `:1718` (wt `:1749`) and exactly two calls, `:1240` (wt `:1271`) and `:1697` (wt `:1728`). **Zero hits under `__tests__/`**, and the same pattern finds the definition, so it can match a known-present line.

Pattern `adapter\.write\(|vault\.(modify|create)\(` over `plugin/src/`, excluding tests and mocks: **12 sites**, all accounted for —

| site | what it is |
|---|---|
| `files/canvas-persistence.ts:674` | the single canvas writer's IO. **The only doc→disk canvas writer that runs.** |
| `files/canvas-sync.ts:2198` | the epoch conflict archive — refuses to clobber by design (`:2187-2196`) |
| `files/canvas-sync.ts:3534` | `writeToDisk`, **dead** — see Verification 3 |
| `files/file-ops.ts:194`, `:203`, `:215`, `:327`, `:331` | the file-op channel and its chunk assembly — WP83's subject |
| `files/manifest.ts:513`, `:515` | `syncFromManifest`, which skips `.canvas` at `:475` |
| `files/background-sync.ts:495` | the raw-text path, guarded at `:97` / `:239` / `:292` |
| `testing/e2e-control.ts:1467` | `scratch.create` |

**So there is exactly one live doc→disk writer for a canvas, and it is attached from exactly two places.**

**Verification 3 — `CanvasSync.writeToDisk` is dead, and it is exactly the trap WP79 already fell into once.**

Pattern `writeToDisk` over all of `plugin/src/`: 6 live calls in `files/background-sync.ts` (its own copy, `:453`), the `canvas-sync.ts` definition at `:3513`, **no production call to it anywhere**, and two test call sites reaching it through `as any` (`__tests__/canvas-sync.test.ts:608-619`). The positive control is the six `background-sync.ts` calls the same pattern finds. **A reader tracing "does a remote canvas delta reach the disk?" finds a private method named `writeToDisk` in `canvas-sync.ts` that does exactly that, and it never runs.** WP79's report already recorded the general form of this — *"a dead code path is not automatically a path that should be alive"* — after nearly mass-installing the R10 fallback by reviving one. **Do not revive this one either.**

**Verification 4 — the writer observes remote deltas, so attaching one is sufficient.**

`files/canvas-persistence.ts:239-257` — `nodesMap`, `edgesMap` and `deletedMap` are all `observeDeep`ed by one observer, and the comment states the design: *"Unlike the binding's observer, there is NO origin filter: both directions must persist."* `:308-309` repeats it: *"the observer re-arms the debounce on EVERY change (local capture or remote delta, no origin filter)"*. **There is no missing write path to build. There is a missing attach.**

**Verification 5 — the two entrances to the writerless state, and which of them is the product's.**

| entrance | mechanism | class |
|---|---|---|
| **the host's own canvases, every session** | `files/canvas-mirror.ts:249-253` subscribes the path (`admitsCanvasMirror` admits `PUBLISH`), then `:257-266` returns `PUBLISH` **without calling `materialise`**. The path is now subscribed. Every later leaf-open hits `main.ts:1251`'s `!isSubscribed` and skips the attach. | **PRODUCT.** Needs no rig, no test harness and no unusual sequence. |
| a path opened through the rig | `testing/e2e-control.ts:1255-1262` `canvasOpen` calls `cs.subscribe(path, roleOf())` directly — no handover helper, no attach — and thereby consumes the same opportunity | **RIG (S45).** It is `S28`-of-the-WP37-set with its consequence traced one step further. |

**And the guest's pre-existing canvas is NOT affected**, which is what makes the first row a specific claim rather than a general one: for a guest with a local file, `decideCanvasMirror` answers `SKIP_LOCAL_FILE`, `admitsCanvasMirror` returns `false` (it admits only `PUBLISH` and `MATERIALISE`, `canvas-mirror-decision.ts:139-145`), and `mirrorOne` returns at `:246-249` **before the subscribe** — so the path stays unsubscribed and the leaf-open attach fires normally. **The mirror pass leaves exactly two of its four verdicts subscribed, and exactly one of those two writerless.**

**The corroborating live figure, quoted rather than re-measured:** `ImplementationReport_WP79.md` records the host arm's production receipt as `CANVAS MIRROR: role=host considered=6 published=6 materialised=0`, and the guest's as `materialised=3 skipped(local-file)=3` with three `owner=CanvasPersistence attached (coldOpen=doc-wins)` lines. **`materialised=0` on the host is `attachCanvasWriter` called zero times on the host.** That is a landed live measurement by another batch, of the exact quantity this charter turns on.

### Ruling — is S29 a product defect or a rig artefact? BOTH, and the distinction is the charter

- **S29 as measured is a rig artefact.** The WP37 suite reaches its canvases through `canvas.open`, and S45 alone is sufficient to produce every observation S29 records. **The measurement does not establish a product defect and must not be cited as if it did.**
- **The claim S29 makes is nevertheless true of the product**, by the first row of Verification 5, which involves no rig at any point. **Two things can produce one observation; finding one of them does not retire the other.** S28-of-the-WP37-set and S30 were both examined and neither is assumed to explain S29 and neither is assumed not to: S28's mechanism *is* S45 and it explains the measurement; S30 (the canvas suite at 13/18, attributed to WP82's latch) explains cross-peer propagation failures and cannot explain a peer's own doc failing to reach its own disk, because the writer's observer never crosses the network.
- **Therefore the WP is chartered, and AC1 is written to establish the product half without `canvas.open`.** Had only the rig entrance existed, the correct outcome would have been to record S45 and charter nothing — and that outcome was live until Verification 5's first row was traced.

---

## 4. Acceptance Criteria

*Each criterion names **the observable that proves it** and **what would make it vacuous**.*

*Acceptance evidence is **two LIVE Obsidian instances** driven through the E2E rig — `POST http://127.0.0.1:39431/command` (vault A) / `:39432` (vault B), body `{"cmd","args"}`. **Blind sets are discontinued** — no `blind_set1`, no `blind_set2`, no falsification injection, no `BlindVerificationLedger` row is owed. Headless tests carry only the rows a live instance cannot honestly produce. **Edits are driven by writing the `.canvas` file on disk**; `canvas.simulateEdit` is not called, and **`canvas.open` is not called for the path under test in AC1** — it is the confound this WP exists to see past.*

1. **A remote change reaches the durable file of an OPEN canvas, on a peer whose path `canvas.open` never touched.**
   - **Deliverable:** none by itself — this is the criterion that establishes the defect and then closes it. It is the row that must be shown **RED against the current tree**.
   - **The protocol, specified rather than left to the implementor, because the confound is the whole difficulty:**
     1. A session is live on both vaults and each instance records the role it actually **resumed as**, quoted from its own `[session] resuming as …` line (S27/S37 — the election is a coin flip and no criterion may depend on it). The peer under test is the one that resumed as **host**.
     2. The path under test is a shared `.canvas` the host already holds, so the mirror pass has subscribed it and taken the attach opportunity. **`canvas.open` is never sent for that path in that session, on either instance.**
     3. **Precondition, asserted not assumed:** the host's `canvas.state` for the path returns records — a snapshot exists only for a subscribed path (`e2e-control.ts:1264-1267`), so this is the positive proof that the path is subscribed and that step 4's leaf-open will hit the gate.
     4. The leaf is opened on the host through **`canvas.typeInNode` with `open: true` and empty text** — the landed non-invasive read that takes no focus and drives no edit (WP37's instrument). This opens a real workspace leaf without going near `canvas.open`.
     5. The remote change is driven by **writing vault B's `.canvas` file on disk**.
     6. **Precondition, asserted not assumed:** the host's `canvas.state` shows B's change — the doc converged. Without this, a failure at step 7 measures the network, not the writer.
     7. `canvas.file` on the host is polled to a bounded budget. **RED = the bytes never arrive. GREEN = they arrive.**
   - **Observable (live, and the discriminator that names the mechanism):** the host's log carries `CANVAS WRITER: <path> owner=CanvasPersistence attached (coldOpen=…)` for that path **after** the repair and **not before** — the same line `ImplementationReport_WP79.md` quotes for a materialised guest canvas, which is the positive control proving the pattern can match a real attach. The `CANVAS WRITER: … nodes=N edges=M` write line follows it.
   - **Vacuity risk — named, and this AC is one long defence against it:** driving the canvas through `canvas.open` at any point, which produces the RED for the rig's reason and would make the whole WP a repair of a confound (**the most likely way this charter goes wrong**). Second: asserting the file is stale **without** step 6, which is satisfied by a peer that never received the change at all — and both peers' connectivity is currently unreliable (WP82). Third: waiting for a budget so long that Obsidian's own view save lands and reports GREEN for a reason that has nothing to do with a writer — the log's owner line is the oracle, the file content is the symptom, and the budget is recorded. Fourth: running on the peer that resumed as **guest** with a pre-existing local file, where the mirror never subscribed and the attach already works today — **that arm is GREEN on the unrepaired build and proves nothing** (§3 Verification 5), and it is required as the *control*, never as the criterion.

2. **The attach is a decision about an open canvas, taken by a pure core, and it is not a side effect of subscribing.**
   - **Deliverable:** a **zero-import** module — no Obsidian, no filesystem, no clock, no Yjs — answers, for one open canvas leaf, whether a writer must be attached, over a **closed verdict set** covering at least: *attach* (a shared, subscribed, canvas-owned path with no writer), *already attached* (idempotence is a verdict, not a silent no-op), *not shared*, *not subscribed* (the lazy-subscribe branch's business, unchanged), *no path*. Every input that is missing, `undefined`, `null` or non-boolean yields a **non-attach** — the `!== true` discipline `decideSeed` and `decideCanvasMirror` both state in their own headers. `main.ts` holds the wiring and the read; **no decision about attachment is written in `main.ts`** (§3.1 S11).
   - **Observable (headless, exhaustive table over the pure function, including every unknown-input row):** each verdict is produced by its own row and the table is complete over the input space, on `manifest-purge-decision.test.ts`'s landed precedent. Separately, at the `syncCanvasPresences` seam with a fake workspace: a leaf whose path is **already subscribed** produces exactly one `attachCanvasWriter` call, and **this row is shown RED against the current tree**; a leaf whose path is **not** subscribed still takes the existing lazy-subscribe-then-attach route, once, unchanged; a second pass over the same leaf attaches **nothing further**.
   - **Vacuity risk — named:** calling `attachCanvasWriter` unconditionally for every open leaf and relying on its internal `has(canonical)` early return (`main.ts:1750-1751`) to make it idempotent. That is "attach whatever, the helper will sort it out" — it defeats the closed verdict set, it attaches for unshared and unsubscribed paths where `getCanvasDocHandle` returns `null` and the failure is silent, and it makes the *"already attached"* verdict unobservable. Second: asserting the verdicts only, never the seam — a pure core that nothing calls is the eleventh instance of this run's signature failure. Third: a test that counts attach calls without pinning **which path** they were for.

3. **The file the writer produces is the projection, and nothing about the writer's behaviour changed.**
   - **Deliverable:** none — a boundary criterion. The bytes are `serializeCanvas(...)` through the existing `CanvasPersistence`, exactly as C79 AC2 requires for the mirror. **No second writer, no second serialiser, no `Y.Text`, no change to `coldOpen`'s three outcomes, branch order or placement (C29 AC4), no change to the withhold, the debounce or the echo mute.**
   - **Observable:** `files/canvas-persistence.ts` is byte-unchanged, stated positively in the report with a `git diff --stat` over the file; the AC1 host's file after the repair is byte-equal to the peer's projection of the same doc state; and the pre-existing `canvas-persistence` and `canvas-adapter` suites pass unmodified with their counts recorded.
   - **Vacuity risk — named:** proving byte-equality between two files that are both stale. The comparison is against the **doc's** projection at a quiesced instant (`sync.waitQuiescent`), not against the other vault's file. Second: reporting *"no second writer was added"* as a claim rather than as the Verification-2 census re-run after the change, with its positive control.

4. **The safety premise every view-side deferral rests on is stated, measured, and true.**
   - **Deliverable:** none by itself. C37 AC2's justification — *the file stays converged while the view is deliberately stale* — becomes a measured property instead of an assumption. **C37 AC2 is not amended** (§2 §7 disposition).
   - **Observable (live, on the AC1 host, with WP37's deferral actually engaged):** with an inline editor open on record `c1` — driven by `canvas.typeInNode` with real text, which is the instrument WP37 built for exactly this — a peer's change to a **different** record `c2` is written to the host's `.canvas` file **while the editor is still open and before any blur**, and the host's own typed characters are **not** in that file yet. Both halves are asserted in the same read: the deferral is doing its job on the view, and the file is converged anyway. The recorded precondition is WP37's own vacuity guard, verbatim in form: `marker … present_in_file=False`.
   - **Vacuity risk — named:** asserting after blur, where Obsidian's own save makes the file correct for a reason that has nothing to do with the writer — **that is exactly what `ImplementationReport_WP37.md`'s `S2: after blur … waited=0.0s` row measures, and it is why AC2 of C37 looked safe.** The read must happen with the editor **open**. Second: using a change to the *edited* record, which WP37 defers by design and which would make this criterion a re-test of WP37. Third: claiming this closes WP37's partial AC3 — it does not; AC3's positional half is unsatisfiable until WP36 lands and **nothing here changes that**.

**Definition of Done:** an open, shared canvas has a writer, whoever subscribed it; and the sentence *"the file stays converged while the view is stale"* is a measurement.

---

## 5. Constraints and Known Risks

- **Permission / environment limits:** Windows dev host. Run tests from the workspace root, never from a subdirectory; long-running invocations through `visible-console` `run_python` / `run_command` with **absolute** paths, never a Bash background process. **The two owner vaults, the two control ports (39431 / 39432) and `H:\tmp\liveshare_*.py` are shared with other work** — check `DISPATCHER_STATE.md` and the task registry before launching, installing, restoring or resetting anything, and never during another agent's run. The relay is production: `GET /healthz` only.

- **Known risks specific to this WP:**
  - **⚠⚠ The most likely wrong implementation is to attach inside the mirror pass.** It is the shortest diff, it makes AC1 green, and it **violates C79 AC4** and re-opens a `DONE` WP by rewriting the host's file from a pass whose criterion says it writes nothing. §2 makes it an abort criterion. The seam is the **view**, not the mirror.
  - **⚠ The second is to measure through `canvas.open`.** It produces RED for the rig's reason (S45) and the repair would then be validated against a confound. AC1's protocol forbids it by construction, and the report must state that the command was not sent for the path under test.
  - **⚠ The third is to attach for every subscribed path, open or not.** Larger, riskier, and out of scope with a reason (§2). It would also make AC3 hard to keep, because a cold open on a never-opened path is the one place `coldOpen`'s branch choice becomes user-visible.
  - **⚠ The fourth is to revive `CanvasSync.writeToDisk`.** It is dead, it looks exactly like the missing mechanism, and WP79 already nearly shipped the analogous mistake with the dead subscribe loop. **A dead code path is not automatically a path that should be alive.**
  - **⚠ The fifth is to treat the guest arm as the control group without checking which arm it is.** A guest with a pre-existing local file is GREEN today (§3 Verification 5) — using it as the before-state produces a green baseline and a green after, and concludes nothing.
  - **⚠ The sixth is to let this WP absorb the divergence.** The two `smoke.canvas` replicas are diverged for reasons WP82 explicitly declined to attribute. **WP85 claims a peer's doc reaches its own disk and claims nothing about two peers agreeing.**
  - **⚠ Do not mirror any generated test suite into `plugin/src/__tests__/` before this WP is implemented.** `tsc` typechecks `src/` including tests, so an unimplemented mirrored suite breaks `npm run build` **repo-wide**. Violated once already in this run.
  - **⚠ Both vaults' `data.json` hold live credentials.** No value from it is read, printed, logged, fixtured, put in a test name, a report or a commit message.

- **Known flaky patterns:**
  - **The relay's host election is a coin flip** (S27 / S37): 34 role transitions on one vault in 2 h 05 min, no alternation. **AC1's subject is the peer that resumed as host**, which the run does not choose — every live row records the role each instance actually resumed as, and a run that elects the wrong host is **re-run or recorded as SKIP**, never silently re-attributed.
  - **The canvas E2E suite is not idempotent** and reads **13/18** for reasons attributed to WP82's latch. **Whatever it reads is recorded as a measurement; 19/19 is not the current baseline.** WP85 may move it; if it does, the movement is measured and attributed, not claimed.
  - Every WP85 scenario uses a per-run marker and leaves the shared folder as it found it. A scenario that leaves a canvas open, a leaf mounted or a marker in a `.canvas` has changed the state for every scenario after it.
  - Do not assert on log strings as a general oracle — **except** for the `CANVAS WRITER: … owner=CanvasPersistence attached` line, where the **owner of the write** is the subject and the log is the only place the product states it. That signature already exists; **no existing log signature, category, level or volume changes.**

- **External dependency risks:** none permitted (D11).
- **Hard constraints:**
  - **The repair lives at the view/leaf seam in `main.ts`. `files/canvas-mirror.ts` and `files/canvas-mirror-decision.ts` are byte-unchanged.**
  - **`files/canvas-persistence.ts` is byte-unchanged. `coldOpen` keeps three outcomes, their order and their placement (C29 AC4).**
  - **One pure zero-import definer; `main.ts` holds wiring and a read and no decision.**
  - **No new E2E control command; `testing/e2e-control.ts` is byte-unchanged. `canvas.open` is not called for the path under test and `canvas.simulateEdit` is not called at all.**
  - **`CanvasSync.writeToDisk` is not revived, not called and not deleted.**
  - **No second writer, no second serialiser, no `Y.Text` on this path.**
  - **`files/manifest.ts`, `cleanupStaleFiles`, `sync/**`, `ui/**` and `server/**` are byte-unchanged. `useCanvasBinding` is not flipped. The plugin version is not bumped. `plugin/manifest.json` is not touched.**
  - **C37 AC2 is not amended. No `DONE` work package is re-opened; WP85 holds no §7 licence of any class.** A reddened inherited assertion is an **ESCALATE**, left red.
  - **Not batched with WP80 or WP82. `git status` re-read immediately before every commit (rule 14). No revert of a path this batch did not create.**

### Recorded, not repaired — this WP's own sweep

- **S45 — `canvas.open` permanently disables the product's own writer-attach seam for the path it opens.** `testing/e2e-control.ts:1255-1262` calls `cs.subscribe(path, roleOf())` directly — not through `subscribeCanvasWithHandover`, not through the mirror — and `main.ts:1251`'s `!isSubscribed` gate then makes the leaf-open attach unreachable for that path for the rest of the session. **Every file-level assertion taken on a peer whose canvas was opened through the rig measures the rig.** This is the confound in `ImplementationReport_WP37.md`'s S29 and it is one step past that report's own S28. **WP85 works around it and does not repair it** — `testing/e2e-control.ts` is contended by four other WPs. **Unowned, and it invalidates more than one past measurement.**
- **S46 — `CanvasSync.writeToDisk` (`files/canvas-sync.ts:3513-3545`) is dead in production.** Zero production callers; reached only by `__tests__/canvas-sync.test.ts:608-619` through `as any`. It is a full, correct-looking canvas disk writer with a sequence gate and an echo mute sitting in the module a reader would search first. **Deleting it deletes inherited tests and needs a §7 licence; reviving it is the WP79 dead-loop mistake.** Named so it is not re-discovered as a mechanism. **Unowned.**
- **S47 — a subscribed canvas that is never opened has no writer at all, and this WP does not change that.** After WP85 the attach still requires an open leaf. A host that shares a canvas and never opens it accumulates remote changes in the doc and in the sidecar while its `.canvas` on disk stays at whatever it last was. **Not data loss** — the sidecar carries the doc across restarts and WP29's seed-once prevents the stale file winning — **but the durable artefact the user can see, sync or commit is wrong, silently, for as long as the canvas stays closed.** Whether that is acceptable is a product decision with a real data-retention shape and it is **explicitly out of scope** here (§2). **Unowned.**
- **S48 — the `[07]`-style trap in file-level assertions generally.** Two mechanisms can put correct bytes in a `.canvas` — the writer, and Obsidian's own save of an open view — and a third can put bytes there that no CRDT knows about (WP83's door). **A file-content assertion alone identifies none of them.** The `CANVAS WRITER:` / `CANVAS MIRROR:` receipts are the only place the product states which one ran. Recorded as a standing instruction for every future live canvas scenario, not as a defect.

---

## 6. Definition of Done Artifacts

- **Required changed files:**
  - `plugin/src/main.ts` — **wiring and a read only**: the attach consultation moved out of the lazy-subscribe branch in `syncCanvasPresences`
  - `plugin/src/canvas/<new>.ts` or `plugin/src/files/<new>.ts` — the pure, zero-import attach verdict (sited beside `canvas-mirror-decision.ts` / `canvas-seed-decision.ts`, whichever the implementor's own reading of the module boundaries supports; the choice is recorded)
  - `plugin/src/__tests__/**` — the AC2 verdict table and the seam rows, staged only once the implementation lands
- **Already landed by Worker 2 with this charter — NOT implementor work:** the §9 WP85 row and the §7 / header counts (82 → 84, with WP84 withdrawn), re-derived from §7 and §9 rather than edited independently. **The implementor does not edit `BUILD_SPEC_CanvasV2.md`.**
- **Required report:** `ImplementationReport_WP85.md` (in `workflowArtifacts/canvas-v2/`), which must additionally record: an explicit statement at the top that **S29's original measurement was confounded by S45** and that the product defect was established independently, with the entrance quoted (`canvas-mirror.ts:249-266` + `main.ts:1251`); **AC1's full protocol as executed**, naming the role each instance resumed as, stating in writing that **`canvas.open` was not sent for the path under test**, quoting both preconditions (the path is subscribed; the doc converged) and the polling budget, with the **RED** result on the current tree and the **GREEN** after; the **`CANVAS WRITER: … owner=CanvasPersistence attached` line quoted verbatim** for that path, absent before and present after; the **guest-arm control** shown green on the unrepaired build, with the statement that it is a control and not the criterion; **AC2's exhaustive verdict table** including every unknown-input row, and the seam row shown RED before; a positive statement that **`files/canvas-persistence.ts`, `files/canvas-mirror.ts`, `files/canvas-mirror-decision.ts` and `testing/e2e-control.ts` are byte-unchanged**, with `git diff --stat`; the **Verification-2 writer census re-run after the change**, with its positive control, showing no second writer; **AC4's editor-open read** with WP37's vacuity guard in the same form; an explicit statement that **C37 AC2 was not amended** and why; the **executed test count** before and after with the statement that no existing test was deleted, weakened, retitled, skipped or amended and that **no §7 licence of any class was taken**; the canvas E2E suite's reading before and after **as a measurement**; and, for every live run, which vault ports were used, that **no `data.json` value was read or printed**, that the relay was contacted only by `GET /healthz`, that the shared folder and both vaults were left as found, and that `canvas.simulateEdit` was not called.
- **BUILD_SPEC updates required:** no — the §9 row and the counts were entered when this charter was written. Anything further is an **ESCALATE** rather than a spec edit.
- **Gate status required at handover:** `npm run build` (tsc + esbuild) PASS and `npm test` 0 failed from `plugin/`, with the executed test count recorded. `npm run lint` advisory locally, gating in CI — do not mass-reformat.

---

## 7. Visible Test Cases / Producer Artifacts

*Filled by Worker 3. Worker 2 leaves this section empty.*

*⚠ **Blind sets are discontinued for new work** (owner's instruction, 2026-08-05): no `blind_set1`, no `blind_set2`, no falsification-injection requirement and no `BlindVerificationLedger` row is owed by this WP. Validation is W4 against two live Obsidian instances, with headless tests carrying the rows a live instance cannot honestly produce. E2E-plugin defects found while validating go back to **W3 as a revision** — but note that **`testing/e2e-control.ts` is byte-unchanged by this WP**, so an E2E defect found here is reported and routed, never patched inside this batch.*

**Filled by Worker 3 (B31).**

### Headless test cases

| file | rows | what it pins |
|---|---|---|
| `plugin/src/__tests__/v2/wp85/test_tp01_writer_attach_verdict_truth_table.test.ts` | 54 | AC2 first half — the pure verdict, all 16 boolean rows written out, every unknown-input spelling per field, the closed answer set, non-mutation |
| `plugin/src/__tests__/v2/wp85/test_tp02_sync_canvas_presences_attach_seam.test.ts` | 9 | AC2 second half — the **real** `syncCanvasPresences` driven off `LiveSharePlugin.prototype`; attach calls counted **per path**; the old lazy route still runs exactly once; a second pass adds nothing |

RED against the base tree (`3310947`): `4 failed / 59 passed (63)`. GREEN: `63 passed (63)`.

### Live acceptance artefacts (the criterion; headless carries only what a live instance cannot)

- Driver: `H:\tmp\liveshare_wp85_e2e.py` — `prepare` / `measure --phase <p>` / `cleanup`. It **raises** on
  the command name `canvas.open`, so AC1's central prohibition is enforced by construction rather than by
  intention.
- Results: `H:\tmp\wp85_{red,red2,green,green2}_result.json`.
- Four phases, both role orders: RED `9/13` (A=host) and `9/13` (B=host); GREEN `13/13` (A=host) and
  `13/13` (B=host).

---

## 7b. W4 Test Targets (filled by Worker 3's Unit Test Sub-Agent, if any)

*Empty at handover.*

---

## 8. Autonomous Execution Plan (filled by Worker 3, B31)

- **Observed current behavior:** on the unrepaired bundle, a shared canvas the host already holds is
  subscribed by WP79's mirror pass (`CANVAS MIRROR: role=host … published=8 materialised=0`) and the
  leaf-open attach — the only leaf-driven one — is nested inside a branch gated on `!isSubscribed`. Opening
  a real leaf on that host therefore attaches **nothing**: measured live, the host's `.canvas` never
  received a peer's change inside a 30 s budget (`file_len` unchanged at 352 B) while its own doc had
  converged in 1.0 s, and no `CANVAS WRITER: … attached` line exists for the path.
- **Approach:** split the fused question. The lazy-subscribe branch keeps `!isSubscribed` and is
  behaviourally unchanged; a **separate consultation** runs for every open canvas leaf on every pass, over
  a pure zero-import verdict (`files/canvas-writer-attach-decision.ts`) with a closed set of five answers.
  `main.ts` hoists two reads (`wasSubscribed`, `isShared`) **before** the lazy branch — because
  `subscribe()` adds synchronously and a later read would drive the attach twice for one open — and gains
  one private reader, `hasCanvasWriter(path)`, that `attachCanvasWriter`'s own guard also uses, so the two
  cannot disagree about what "already attached" means.
- **Fallback path if all attempts fail:** not needed — attempt 1 met all four ACs. The fallback would have
  been to report RED with the trace and escalate, never to attach inside the mirror pass (the charter's
  abort criterion) or to attach for every subscribed path (out of scope, C79 AC4 shape).

---

## 9. Handover Summary (filled by Worker 3, B31)

- **What is complete:** all four ACs. AC1 RED→GREEN live in both host/guest role orders, with both
  preconditions asserted, the 30 s budget recorded, and the `CANVAS WRITER: … owner=CanvasPersistence
  attached` receipt quoted absent-before / present-after. AC2's exhaustive verdict table and the real-seam
  rows, shown RED first. AC3's byte-unchanged boundary with a positive control and the re-run writer
  census (12 write sites, unchanged; one added call, no new definition). AC4 measured with WP37's vacuity
  guard, which **failed on the unrepaired build and passes on the repaired one**.
- **What remains open:** nothing in scope. **S47** (a subscribed canvas that is never opened still has no
  writer) is deliberately unrepaired. **S45** is now measured as the sole cause of the canvas suite's five
  failures and remains unowned. **S50** — the mirror pass runs its host arm after a demotion, leaving a
  *guest* with every canvas subscribed and (pre-WP85) writerless — is new, unowned, and repaired in its
  outcome but not in its cause.
- **Final status:** **DONE.** `npx vitest run` 330 files / 2294 passed / 0 failed in an isolated worktree
  (baseline 328 / 2231 / 0). `npm run build` exit 0.

---

## 10. Risk Notes for Worker 4 (filled by Worker 3 Core)

- **Do not validate this WP through `canvas.open`.** It subscribes without opening a leaf, and WP85's
  consultation is a decision about an **open leaf**. A validation that uses it will read RED on a correct
  build. Use `canvas.typeInNode { open: true }` with no text.
- **The `CANVAS WRITER: <path> owner=CanvasPersistence attached` line is the oracle; the file content is
  the symptom.** Two other mechanisms can put correct-looking bytes in a `.canvas` (Obsidian's own view
  save, and WP83's former raw-text door). AC4's RED row is a live demonstration of the first one fooling a
  file-content assertion.
- **Search the log with a literal substring, not a regex.** `.` is a wildcard and has produced false hits
  in this run.
- **Record the role each instance resumed as.** The election is a coin flip and one arm of every scenario
  here is role-dependent.
- **A guest can be writerless too (S50).** A peer that resumed as host and was demoted milliseconds later
  still runs the host mirror arm. Do not assume "guest ⇒ the lazy route ran".
