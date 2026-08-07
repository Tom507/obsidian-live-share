# Task Charter — WP91: a mute that cannot tell who wrote is not an echo breaker

<!-- Updated: chartered 2026-08-07 (B47, Worker 2) from `ImplementationReport_B44_ScheduleDependence.md` §1 and from the Dispatcher's own re-verification at `DISPATCHER_STATE.md:2420-2444`. Re-verified independently against the tree per rule 12, on branch `toms_branch` at `61e18c2`, citing `fb631f8` per B44's own rule. THE FOUR CITED SITES ALL HOLD, VERBATIM, AND THE PICTURE IS WORSE AND SIMPLER THAN THE ACCOUNT STATES. Verified with `git show fb631f8:<path>`: `vault-events.ts:232` is `if (plugin.fileOpsManager.isPathMuted(file.path)) return;` with no log line and no content in hand; `file-ops.ts:196` is `return (this.mutedPaths.get(normalizePath(path)) ?? 0) > 0;` over a bare `Map<string, number>` refcount (`:47`); `canvas-persistence.ts:463` `armSettleRelease()` opens with `if (this.settleTimer !== undefined) this.scheduler.clearTimeout(this.settleTimer);` and is called from `writeSnapshot`'s `finally` at `:446`, i.e. once per write; `canvas-sync.ts:3065` is `if (this.recentDiskWrites.has(path)) return;`. ⚠ FOUR ADDITIONS AND ONE CORRECTION, each measured, each material. (1) **THE DISCRIMINATOR THE BRIEF ASKS ME TO DESIGN ALREADY EXISTS, IS ALREADY CHARTERED, AND IS ALREADY LANDED — five lines past the gate that stops it running.** `canvas-sync.ts:3107` is `if (content === this.lastWrittenContent.get(path))`, whose own comment reads *"the BYTE echo breaker (BUILD_SPEC D9) … it is deliberately NOT a timer: identical bytes are our own write coming back"* — C4 AC2, WP4 `DONE`. This WP is not the invention of a discriminator; it is the removal of three timers that sit in front of the one the spec already chose. (2) **A FIFTH SITE B44 DID NOT CITE, with the same re-arm shape as the third:** `noteExternalDiskWrite` (`canvas-sync.ts:3969-3977`) clears and re-arms its own independent `VAULT_EVENT_SETTLE_MS = 250` (`utils.ts:5`) timer on every write, so *two* re-arming 250 ms timers are held across the same burst, not one. (3) **THE ARITHMETIC CLOSES AND PREDICTS THE MEASURED WINDOW:** `MAX_WAIT_MS = 500` + `DISK_WRITE_SETTLE_MS = 250` = **750 ms** (`canvas-sync.ts:309`, `canvas-persistence.ts:53`), against B44's measured *lost ≤ 0.8 s / OK ≥ 0.9 s*. The window is a derived constant, not a mystery, and that makes it a falsifiable prediction this charter hands to its implementor. (4) **THE SPEC ITSELF CARRIES THE BLIND SPOT.** C4's declared input is *"a vault `modify` event for an owned, **unmuted** `.canvas` path"* (`BUILD_SPEC_CanvasV2.md:313`). WP4's byte breaker was specified to run only on events the mute had already admitted. Nobody ever asked whether the mute could drop a real one. ⚠ THE CORRECTION, and it is to the brief I was given rather than to B44, which is honest about it in its own §1: the row *"≤ 0.5 s LOST 20/20"* comes from a sweep that **lost its own positive control**, which by the script's stated rule invalidates that block as a *threshold* measurement (`ImplementationReport_B44…:47-50`). It supports *"everything at ≤ 0.5 s is lost"* and nothing narrower. The threshold rests on the 0.5–0.8 s block (11/12) and the 0.9–1.0 s block (4/4). ALSO VERIFIED, because this charter's scope turns on it: `vault-events.ts`, `canvas-sync.ts`, `canvas-persistence.ts` and `main.ts` are **byte-identical between `fb631f8` and the working tree** (`git hash-object` on all four), so every line number below is valid at both — while `file-ops.ts` has moved `isPathMuted` from `:196` to `:219` under B46/WP68's live edit, which is exactly why this charter puts that file out of scope. No Obsidian was launched, no vault file was read, no `data.json` was opened, no relay was contacted, no E2E script was run, and no `plugin/src/**` file was edited for this charter. -->
**Charter Status:** `SPEC_COMPLETE`
**WP:** WP91
**Phase:** P0
**task_mode:** `standard`
**Depends on:** WP4 (`DONE`) — its byte echo breaker (C4 AC2, `canvas-sync.ts:3107`) is **consumed and promoted to sole authority, never duplicated or replaced**. WP63/WP90 (`DONE`) — the withhold gate at `canvas-persistence.ts:345` is untouched. **MUST NOT be batched with B46/WP68** (`file-ops.ts`, `control-handlers.ts` live) **or with WP89** — see §2 Ordering.
**W4 Test Targets:** `3`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** a user's edit to a shared `.canvas` is never discarded because the plugin cannot tell it from its own write echo. Today a whole-file write landing within ~0.8 s of a remote change being applied to that path is **silently and permanently dropped** — the bytes stay on the writer's disk, the writer's **own** doc never shows them, the peer never shows them, nothing reconciles the two, and no receipt of any kind is produced. `useCanvasBinding` is `false`, so this is the live capture path for a real user in the Obsidian UI, and during active co-editing remote changes land constantly.
- **The one-sentence statement of the defect:** *the decision to drop is taken in a place that cannot know who wrote, five lines before the place that already knows.*
- **What the substance of the work actually is, stated plainly because the brief invited me to design a discriminator and the tree already contains it.** `handleLocalModify` reads the file at `canvas-sync.ts:3099` and compares it at `:3107` against `lastWrittenContent` — the byte echo breaker WP4 built for exactly this purpose, whose own comment says *"it is deliberately NOT a timer"*. Three timer-based gates stand in front of it: `vault-events.ts:232` (the mute refcount), `vault-events.ts:244` and `canvas-sync.ts:3065` (both reading `recentDiskWrites`). **The sound mechanism was specified, built, landed, and then never given the events it was built to judge.** WP91 does not invent echo suppression for this path; it makes the mechanism that already owns the question the one that answers it.
- **Why a refcount cannot be repaired into a discriminator, and why the alternatives named in the brief are worse here.** A refcount on a path is a statement about *what we did*, evaluated against an event that only tells us *which file changed*. It has no term for the bytes, so it cannot be made to distinguish anything.
  - **An origin token** is the right answer where the producer and consumer are in one process and the event carries a payload — and the project already uses one, correctly, at `canvas-sync.ts:3157-3169` for Yjs transactions. It cannot work here: Obsidian's `vault.on("modify")` hands us a `TFile` and nothing else. The event has no field to carry an origin, so a token would have to be stored on the side, keyed by path, and released on a schedule. **That is the mute.** An origin token at this seam degenerates into the mechanism it was meant to replace.
  - **A generation counter** fails for the same reason and one more: it would answer *"how many writes ago"*, which is a proxy for time, and a user edit arriving between our write and its event is inside every window a counter can define.
  - **Content identity is the only discriminator available at this event**, because the only sound question the event permits is *"are these bytes ours?"* — and the only place that question can be asked is after the file has been read, which is `handleLocalModify`, not the synchronous gate at `vault-events.ts:232`.
- **Why this is P0 severity though it is a P0-phase mechanism anyway.** It destroys the user's *live* work in the *ordinary* case — two people editing one canvas — with no notice, no log line, no retry and no reconciliation. Every other capture-side defect this run has found either surfaced as a visible failure or was recoverable by a resync. This one is invisible on both sides of the link and is not recoverable, because the doc never learned that the edit existed.
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 5, component **C91** (work package **WP91**), and the section 9 row; section 4.6 (invariant → work-package traceability, **I11**); section 10 (the signature register — this WP proposes one, see §6). C91 and the §9 row are **proposed in §6 of this charter and landed by the Dispatcher**; this charter does not edit the BUILD_SPEC. Phase **P0**: the mechanism is the capture boundary C4 owns, and that is where the spec's own ordering puts it.

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: modify, in **at most three** production files:
    - `plugin/src/files/vault-events.ts` — the `vault.on("modify")` handler, `:229-277` at chartering time. The gate ordering for **canvas-owned shared paths only**.
    - `plugin/src/files/canvas-sync.ts` — `handleLocalModify` (`:3063`), its decline set, and the two 250 ms re-arming settle timers it owns (`:3969-3977`, `:4152-4156`).
    - `plugin/src/files/canvas-persistence.ts` — `armSettleRelease` (`:463`) and the constant at `:53`, for AC5 only.
  - Responsibility: make **content identity** the sole authority on whether a local `.canvas` modify is our own echo; make every decline **counted and named**; and put a stated ceiling on a settle window whose real length is currently a function of peer activity rather than of its own constant.
- **Out of scope / non-goals — each of these is an ESCALATE, not a judgement call:**
  - **⚠⚠ `plugin/src/files/file-ops.ts` — `isPathMuted`, `mutePathEvents`, `unmutePathEvents` and the `mutedPaths` map. DO NOT TOUCH, and re-measure before you read.** Two independent reasons, and both are hard.
    1. **The file is being edited RIGHT NOW by a sibling batch, B46/WP68.** At chartering time the working tree carries 78 uncommitted insertions in this file and `isPathMuted` has already moved from `:196` (at `fb631f8`) to `:219`. **Every line number for this file in this charter, in B44's report and in `DISPATCHER_STATE.md` is stale by construction.** Re-locate by symbol name, never by line number (rule 5), and coordinate with B46 before reading its state as settled. Under RULE 14 you do not revert, stash or check out over it.
    2. **The refcount is correct for its other five consumers and this WP must leave it exactly as it is.** `applyRemoteOp` mutes around a remote file-op apply (`:253`/`:439`) so the apply is not re-broadcast; the vault `create`, `delete` and `rename` handlers consult it (`vault-events.ts:140`, `:173`, `:196-197`); and the text-sync branch and the manifest arm sit behind it (`vault-events.ts:262`, `:266-275`). **None of those has a content baseline to compare against.** "Make `isPathMuted` content-aware" and "remove the mute" are both out of scope and both would re-open the two-writer race WP6/US5 closed. The fix is narrower than the mechanism: this WP changes *who gets to ask the question for canvas-owned paths*, not what the refcount means.
  - **`plugin/src/sync/control-handlers.ts`.** Also live under B46/WP68, and not on this path at all.
  - **`canvas-sync.ts:3107`, the byte echo breaker itself.** It is C4 AC2, it is `DONE`, and it is **correct**. It is promoted, not modified. Widening it, weakening it, adding a tolerance to it, or replacing byte equality with a semantic compare re-opens WP4 and is an abort criterion — the semantic compare is the thing WP4 deliberately removed (`canvas-sync.ts:1193-1198`).
  - **`lastWrittenContent`'s producers.** `noteExternalDiskWrite` (`canvas-sync.ts:3957`) and `writeCanvasFile` (`:4149`) both advance it, and `main.ts:2903` wires `CanvasPersistence.onWritten` into the first. That wiring is what arms the breaker and it stays exactly as it is. The **timers** those same two functions arm are in scope; the **baseline advance** is not.
  - **`CanvasPersistence`'s write queue, its debounce, `writeSnapshot`, `acquireMute`/`releaseMute`'s pairing, the single-writer invariant and WP85's attach seam.** Untouched. AC5 touches `armSettleRelease`'s *duration policy* and nothing else. WP90 landed 112 insertions and 0 deletions in this file precisely so it could report those as untouched; do not be the batch that breaks that.
  - **WP63/WP90's withhold gate** (`canvas-persistence.ts:345`, `writeIsWithheld`), the `SeedRefusalStore`, and both seed boundaries. This WP is on the **capture** side; the withhold is on the **projection** side. They meet only in AC4, where the withhold is a *read-only* fact.
  - **`useCanvasBinding`, `CanvasBinding`, `captureLocal`, `canvas-binding.ts`, `canvas-model-bridge.ts`.** Frozen. The flag stays `false`. Flipping it is an abort criterion — and note that flipping it would *hide* this defect rather than fix it, by routing capture off the file path entirely, which is the single most tempting wrong answer in this charter.
  - **`plugin/src/main.ts` gains nothing but wiring, if it gains anything.** §3.1 S11 is absolute. A conditional over canvas state written into `main.ts` is a §7 abort criterion.
  - **The E2E suite's retry behaviour.** `write_and_confirm_capture()` deliberately does **not** retry a swallowed write, because a retry re-issues the `modify` event outside the window and turns the defect back into a green. **Adding a retry to the product as the fix is an abort criterion**, and adding one to the suite destroys the instrument that found this.
  - **`server/**`, deployment, `docker/.env`, any secret, any `data.json` value.** Entirely out.
  - **WP37, WP89 and the reconcile/apply side.** See §3's explicit statement — a different mechanism and a different loss.
- **Known interfaces / dependencies:**
  - Input: a vault `modify` event for a shared, canvas-owned `.canvas` path, **whether or not that path is currently muted**
  - Output: a capture whenever the bytes differ from what this client last wrote; a counted, named decline otherwise
  - Depends on: **WP4** (`DONE`) for the byte breaker, **WP6/US5** for the one-ownership-predicate discipline at `vault-events.ts:236-255` that must survive intact

### Ordering — what must NOT be batched together

1. **Not with B46/WP68.** Same subsystem, and WP68 is mid-flight in `file-ops.ts`. This WP is scoped to avoid the file entirely; batching them together would put both in one diff and make the "`file-ops.ts` is byte-unchanged by WP91" claim in AC6 unverifiable.
2. **Not with WP89.** WP89 owns the `defer-drag` arm on the **apply** side. B44 established it is unblocked and is not the cause here — but it inherits one fact from this defect (the disk write its arm leaves running is what opens the mute burst), and a shared batch would make each WP's contribution to any measured change unattributable.
3. **Not with any other `canvas-sync.ts` / `canvas-persistence.ts` work.** These two files have been the run's most contended pair; WP90's clean 112/0 diff is the standard.

---

## 3. Architecture Context

*Task-local architecture guidance only.*

### Verified against the tree (rule 12), 2026-08-07, branch `toms_branch` at `61e18c2`, citing `fb631f8` — measured, given, do not re-derive

**All four files cited below are byte-identical between `fb631f8` and the working tree** (verified with `git hash-object`), so every line number holds at both. `file-ops.ts` is the sole exception and is out of scope for that reason.

#### The journey, link by link

| # | site | what it does |
|---|---|---|
| 1 | `files/vault-events.ts:231` | `isSharedPath` — correct, not in scope |
| 2 | **`files/vault-events.ts:232`** | **`if (plugin.fileOpsManager.isPathMuted(file.path)) return;`** — an unconditional early return **before any content is examined and with no log line**. The event is gone and nothing records that it existed. **This is the drop that produces "no `local modify` receipt at all".** |
| 3 | `files/file-ops.ts` `isPathMuted` (`:196` at `fb631f8`, `:219` in the tree) | `return (this.mutedPaths.get(normalizePath(path)) ?? 0) > 0;` over a bare `Map<string, number>` (`:47`). No content term, no origin term. **A user's edit and our own echo are the same value.** |
| 4 | `files/vault-events.ts:244` | `!canvasSync.isRecentDiskWrite(file.path)` — a **second** timer gate, reading the same set as link 6 |
| 5 | `files/vault-events.ts:252` | `void canvasSync.handleLocalModify(file.path)` — reached only if 2 and 4 both admit |
| 6 | **`files/canvas-sync.ts:3065`** | `if (this.recentDiskWrites.has(path)) return;` — a **third** timer gate, redundant with link 4 on this path and load-bearing for other callers |
| 7 | `files/canvas-sync.ts:3099` | `const content = await this.vault.read(file);` — **the bytes finally arrive** |
| 8 | **`files/canvas-sync.ts:3107`** | `if (content === this.lastWrittenContent.get(path))` — **the byte echo breaker, C4 AC2, `DONE`.** Its own comment: *"it is deliberately NOT a timer: identical bytes are our own write coming back."* |

**Links 2, 4 and 6 are three timers standing in front of the one content test at link 8.** Link 8 is strictly stronger than all three: it is exact, it has no window, and it cannot be wrong about an edit it can see. **Every drop at 2, 4 or 6 is either redundant with 8 or a bug**, and B44 measured the bug.

#### Why the window is ~0.8 s and not 250 ms — and the arithmetic closes

Two **independent** 250 ms timers are cleared and re-armed on **every** write of the burst that one remote change provokes:

| timer | armed at | released after | re-arm |
|---|---|---|---|
| `CanvasPersistence.settleTimer` → `io.unmutePathEvents` | `writeSnapshot`'s `finally`, `canvas-persistence.ts:446` → `armSettleRelease` `:463` | `DISK_WRITE_SETTLE_MS = 250` (`:53`) | `:464` clears the previous timer on every write |
| `CanvasSync.externalWriteSettleTimers` → `recentDiskWrites.delete` | `noteExternalDiskWrite`, `canvas-sync.ts:3968-3977` | `VAULT_EVENT_SETTLE_MS = 250` (`utils.ts:5`) | `:3970` clears the previous timer on every write |

**The second one is not in B44's account and has the same shape as the first.** `main.ts:2903` wires `CanvasPersistence.onWritten` straight into `noteExternalDiskWrite`, so one landed write re-arms both.

The burst length is bounded by the flush debounce: `DEBOUNCE_MS = 200` capped by `MAX_WAIT_MS = 500` (`canvas-sync.ts:308-309`). So the predicted mute ceiling for one remote change is **500 + 250 = 750 ms**, against B44's measured *lost at ≤ 0.8 s, OK at ≥ 0.9 s*. **The window is a derived constant, and the implementor should treat 750 ms as a falsifiable prediction: if the measured ceiling is materially above it, a third timer is involved and this charter has missed it.** Under sustained co-editing the cap is per-flush, not per-burst, so a stream of remote changes re-arms indefinitely — the window has no ceiling at all in the case the product exists to serve.

#### The spec's own blind spot, and it is the reason nothing detected this

`BUILD_SPEC_CanvasV2.md:313` declares C4's input as *"a vault `modify` event for an owned, **unmuted** `.canvas` path"*. **WP4's byte breaker was specified to run only on the events the mute had already admitted.** The mute was upstream of the criterion, so no WP4 acceptance criterion could reach it, and the comment at `canvas-persistence.ts:50-53` told every later reader not to look: *"Purely mechanical echo suppression — NOT a correctness mechanism."* **It has been one for the life of the V2 capture path.** A mechanism documented as unable to affect correctness, sitting on a data path, with no receipt when it acts, is how a silent edit-loss defect survives a whole run of adversarial review. That sentence is not a comment to correct; it is the finding.

#### The relationship to WP37 — a different mechanism and a different loss. Say this in the report.

**A reader who conflates the two will believe this is already fixed. It is not.**

| | **WP37** (`e9a9cc9`, landed) | **WP91** (this) |
|---|---|---|
| side of the link | **apply** | **capture** |
| what is lost | keystrokes Obsidian has not flushed out of a live inline editor | a **whole-file save**, already flushed and already on disk |
| how | `reconcileLiveCanvas` executes a `"structural"` verdict as a full `setData`, which rebuilds the view and destroys the editor (`main.ts:1268-1275`, guarded only by the drag-only `isBusy()`) | `vault-events.ts:232` returns before the content is read |
| does `handleLocalModify` run? | **yes** — it is not on WP37's loss path at all, and WP37's charter says so | **no** — the event never arrives, which is the entire signature |
| observable | a rebuilt view; the user sees characters vanish while typing | **nothing.** No receipt, no signature, no counter, no notice |
| trigger | a peer's non-geometry change while an inline editor is open | a peer's change of **any** shape, while the user is not necessarily typing at all |

WP37's protection is structurally unable to reach this: it defers an **apply**, and there is no apply here. B44 confirmed it live — `CANVAS WRITE HELD:` (one emitter, `main.ts:2883`) had zero hits in every measurement window, so no busy-gate hold is implicated. **See §5 for the one thing about that absence claim that I could not reproduce.**

#### The consequence B44 did NOT measure, and it is why AC4 exists

B44 recorded *"the bytes on the writer's disk: **present**"* and *"state after a further 20 s: **unchanged**"*. **That does not establish that the user's bytes survive**, and the charter must not be read as if it did. `flushToDisk` returns early on `this.lastQueuedContent === content` (`canvas-persistence.ts:352`), so with the doc unchanged nothing is queued and the file keeps the user's bytes for as long as nothing else happens. **The on-disk destruction needs exactly one more remote change to that path** — which is the ordinary condition of co-editing: the doc moves, the dedup no longer fires, and the canonical projection of a doc that never learned about the user's edit is written over the file that still holds it. **The 20 s observation window contained no further remote change and therefore could not see this.** AC4 is the measurement that decides it, and its verdict is reported either way.

#### What the fix is, stated as a property rather than as a patch

**No local `modify` for a canvas-owned shared path may be dropped for a reason that is not a fact about the bytes.** Where the reordering is placed — hoisting the canvas branch above the mute check, or routing canvas-owned paths past it — is Worker 3's decision. What is not negotiable is that the resulting decline set contains no timer.

Two consequences the implementor should expect and not treat as problems:
- **An extra `vault.read` per echo.** That is the honest price of the change, and it is the price the comment at `canvas-persistence.ts:50-53` already claims to be paying for: a mechanism described as *purely mechanical* must be removable from the correctness path without changing behaviour. AC2 is where that claim is finally evaluated.
- **`handleLocalModify` will now run for our own writes.** It must produce **zero** CRDT writes and **zero** shadow mutation on that path — which is exactly what C4 AC2 already specifies, and exactly what AC2 measures.

- **Interfaces involved:**
  - Input: `TFile` from `vault.on("modify")`; the file's bytes; `lastWrittenContent` for that path
  - Output: a capture, or a counted decline carrying its reason
- **Constraints from BUILD_SPEC (invariants — what must not change):**
  - **I11 REFUSAL NEVER DESTROYS** is binding and is AC4. This is I11 failing on the **capture** side: the plugin refuses to accept an edit it cannot attribute, and the user loses it. The invariant has been read as a rule about *deletions* throughout this run; a dropped capture that is then overwritten by the projection is the same invariant, one seam upstream.
  - **I5 DEGRADE** — a decline is per-path and non-fatal; nothing throws out of the handler; other paths keep capturing.
  - Invariants I1–I5 (`ARCHITECTURE.md`) and I6–I11 (CONCEPT_V2 Teil 3 + §4.6) are binding and must not be weakened.
  - `CanvasPersistence` remains the single CRDT→disk writer. `coldOpen` runs after `waitForSync` and before `start()`. `canvas-presence.ts` is byte-unchanged. `main.ts` holds wiring only. `canvas-binding.ts` / `canvas-model-bridge.ts` stay frozen and `useCanvasBinding` stays `false`.
  - **Zero new runtime dependencies.** Zero new timing constants except the AC5 cap, which is derived from an existing one.
  - Do not bump the plugin version. Do not hand-edit `plugin/main.js` or `server/dist/`. `plugin/manifest.json` is a **real file** since `67f1036` — the old "broken symlink, do not read" instruction in BUILD_SPEC §10 is retired.
- **Entry points / relevant files:**
  - `plugin/src/files/vault-events.ts:229-277` — the `modify` handler
  - `plugin/src/files/canvas-sync.ts:3063-3110` — `handleLocalModify`'s gate set and the byte breaker
  - `plugin/src/files/canvas-sync.ts:3955-3978`, `:4128-4158` — the two `recentDiskWrites` arm sites
  - `plugin/src/files/canvas-persistence.ts:421-476` — `writeSnapshot`, `acquireMute`, `armSettleRelease`, `releaseMute`
  - `plugin/src/main.ts:2903` — the `onWritten` → `noteExternalDiskWrite` wiring, **read-only context, not a target**
  - `plugin/src/files/file-ops.ts` — **read-only context, NOT a target, and live under B46**
- **Structure references:** *(intentionally empty — no Graphify graph exists for this project; FALLBACK mode is declared in BUILD_SPEC section 3. Worker 3 fills this in after implementation. Do not invent paths here.)*

If structure references conflict with the BUILD_SPEC or explicit task scope, the BUILD_SPEC and TaskCharter win. Escalate instead of following the map.

---

## 4. Acceptance Criteria

*Each criterion names **the observable that proves it** and **what would make it vacuous**.*

*Acceptance evidence is **visible tests only** plus **two LIVE Obsidian instances** driven through the E2E rig — `POST http://127.0.0.1:39431/command` (A) / `:39432` (B). **Blind sets are discontinued** — no `blind_set1`, no `blind_set2`, no `BlindVerificationLedger` row is owed. `canvas.simulateEdit` is **never** called: it writes straight into the `Y.Doc` (`testing/e2e-control.ts:995-1005`) and returns a hardcoded `applied: true` (`:1023`), so a suite built on it measures doc→relay→doc and proves nothing about capture. **Every local edit is driven by writing the `.canvas` file on disk**, which is the path this WP is about. **No `data.json` value is read, printed, logged, hashed or fixtured** — key names and boolean presence only. **Any absence claim read from the debug log must first prove its pattern matches a known-present line (rule 15) and must account for S65** — a stamp-to-flush lag measured at ~58 s against readers using a 2–2.5 s margin. **State is the oracle; signatures are for humans.***

---

1. **A local write that differs from our own last write is CAPTURED, at delta zero, with the mute provably held.**
   - **Deliverable:** the discrimination. The event reaches `handleLocalModify` and the capture happens, regardless of any timer's state.
   - **Observable (headless, deterministic, injected clock — no wall-clock sleep):** with the path's mute refcount asserted **`> 0`** and both settle timers asserted **armed and unexpired**, a `modify` event is delivered through **the registered `vault.on("modify")` handler** for a file whose content differs from `lastWrittenContent` by one node. The record appears in the doc's `nodes` map. The assertion is on **doc state**, not on a log line.
   - **Observable (live, W4, and this is the row that reproduces B44):** the B41 ladder re-run — `liveshare_b41_observe_then_write.py` with `LS_B41_DELTAS=0.0,0.1,0.3,0.5,0.8` — must report **OK on every rung and every shape**, where today it reports LOST. `CTRL_NODE_A` must be present and must have arrived in every retained block; **a block whose positive control did not arrive is discarded, not reported** (the rule B41's own script states and the reason the "≤ 0.5 s, 20/20" row is not a threshold measurement).
   - **Vacuity risk — named.** **(a) The killer: a test that calls `canvasSync.handleLocalModify(path)` directly.** That bypasses `vault-events.ts:232` — the gate that produces the entire defect — and would be green against a completely untouched tree. The test must dispatch through the registered handler. **(b) A test in which no mute was ever taken**, so nothing was there to drop the event: the mute refcount must be asserted `> 0` **at the instant of the write**, and that assertion must be shown to fail if the mute-acquire is removed from the fixture. **(c)** The live rung passing because the marker write never landed on disk — assert the file's bytes on the writer before asserting the doc. **(d)** The live suite is **not idempotent by default** and a node left behind by the previous run makes any presence check true for free (the first vacuity instance found in this E2E suite): per-run ids and `reset_canvas()` are mandatory.

2. **Our own echo is still suppressed — by identity, and at every delta including ones no timer covers.**
   - **Deliverable:** proof that removing the timers costs nothing, which is what `canvas-persistence.ts:50-53` has been claiming without evidence since it was written.
   - **Observable (headless):** a `modify` event whose content is **byte-identical** to `lastWrittenContent` for that path produces **zero** CRDT writes, **zero** shadow mutation and no `seq` advance — asserted at **delta 0 ms** (inside every timer) **and at delta 10 s** (outside all of them, on the injected clock). The delta-10 s row is the anti-regression: an echo must be suppressed because it is an echo, never because it arrived early.
   - **Observable (the discrimination pair, in the same run):** the identical fixture with **one byte changed** must produce writes. A "no writes" assertion that is not paired with a "writes" assertion over the same harness proves only that the harness is inert.
   - **Observable (the baseline is real):** `lastWrittenContent.get(path)` is asserted **equal to the exact bytes written**, not merely non-`undefined`. An echo test against an empty baseline is a test of `undefined !== content`.
   - **Vacuity risk — named.** **(a)** Zero writes because the doc handle, the subscription or `canWrite` declined first — every one of `subscribedPaths`, `canWrite`, the doc handle and the schema-major gate must be asserted **passing** before the echo assertion is read; otherwise this AC is satisfied by four unrelated early returns. **(b)** The delta-10 s row run on a **real** clock, where 10 s of test time is a 33.5 s-sleeper-class liability and, worse, where a real timer may have fired for reasons the test did not control. Use the injected scheduler. **(c)** "Byte-identical" produced by re-serialising rather than by replaying the exact bytes `onWritten` reported — the two differ the moment anything about serialisation drifts, and that drift is precisely what would silently disarm the breaker.

3. **No silent discard. Every declined local canvas modify is COUNTED, ATTRIBUTED and NAMED.**
   - **Why this is a criterion and not a nicety:** the defect survived the entire run because the drop produced nothing at all — no signature, no counter, no receipt. **An unlogged silent discard on a data path is the mechanism by which a data-loss bug becomes undetectable**, and it is worth more here than the fix, because it is what would have found the fix's own regression.
   - **Deliverable:** a **closed reason set** and a per-reason counter on `CanvasSync`, plus **one** signature with **exactly one** production emitter. Reasons, at minimum: `echo` (byte-identical), `not-subscribed`, `read-only`, `schema-major`, `no-doc`. Proposed signature name and format are in §6; **the Dispatcher registers it in BUILD_SPEC §10 — this WP does not edit that file.**
   - **Observable (state, and state is the oracle):** a read-only accessor returning the per-reason counts, on the precedent WP68 and WP88 set in `file-ops.ts` — *"the counter is the observable; it is state, not a log line, so a test can be an oracle over it."* Each reason is driven at least once and its counter asserted to have advanced by exactly one, with every other counter asserted **unchanged in the same assertion**. The counters carry **no path and no content**: a count is a diagnostic, and a path here would put user filenames into a value other components may render.
   - **Observable (the signature, for humans):** one greppable line per decline, naming the path and the reason. **Never the file's contents and never a node's text.**
   - **Vacuity risk — named.** **(a) The trap this AC sets for itself:** after the fix, `muted` is no longer a reachable reason for a canvas-owned path, so an assertion of the form *"zero muted declines"* is **true for free** — the exact shape of B44's `[06] B: node gone`. This AC therefore asserts **positively** that the counter reaches non-zero on `echo` in the same run, and does **not** assert a zero anywhere as its primary observable. **(b)** A counter incremented on a branch no test reaches — each reason needs its own driving fixture, and a reason with no fixture must be removed from the enum rather than left as decoration. **(c)** The signature asserted by *absence* from the debug log. Under **S65** that is unsound: a ~58 s stamp-to-flush lag against a 2–2.5 s reader margin returns zero lines for a signature that fired. Absence claims about the log are not accepted as evidence for this AC at all; the counters are.

4. **I11 — a declined capture never destroys the user's bytes, and the verdict is reported either way.**
   - **Why this is a criterion and why it is not already answered:** B44 observed the file *"unchanged after 20 s"*, but with the doc unmoved `flushToDisk` dedups at `canvas-persistence.ts:352` and nothing is written — the file survives because nothing tried. **One further remote change to that path removes the dedup**, and the projection of a doc that never learned about the user's edit is then written over the file that still holds it. **This is unmeasured**, it is the ordinary condition of co-editing, and it is the difference between "your edit did not sync" and "your edit is gone from your disk".
   - **Observable (live, W4, and it is a two-step scenario):** step 1 — a local write is issued and confirmed swallowed on the pre-fix bundle (the writer's own doc lacks it, its file has it). Step 2 — **one further remote change** is applied to the same path from the peer. The writer's `.canvas` is then read through `canvas.file` and compared against the bytes step 1 left there. **If the user's node is gone, that is the RED**, and it is reported as an I11 violation with its own row. On the fixed bundle the same scenario must never reach step 2's loss, because step 1 no longer swallows.
   - **Observable (the write must have been attempted):** a `CANVAS WRITER:` line **and** an `onWritten` callback for that path between the two reads. A file that survived because no write was queued has not demonstrated anything.
   - **Observable (headless companion):** with the fix in place, a capture that declines for any reason in the AC3 set leaves the file's bytes untouched by the decline itself — the decline path performs no `vault.modify`, no `vault.create`, no `trashFile` and no `delete`.
   - **Vacuity risk — named.** **(a)** The file surviving because the flush was **deduped away**, which is the default outcome and would make this AC green on an unfixed tree — hence the mandatory positive evidence that a write occurred. **(b)** The "user's node is still there" check done by substring search over the whole `.canvas`, which matches `"x": 20` and `"width": 400` — **the check parses the record's own `id` field**, the guard WP87 got wrong. **(c)** A step-2 remote change that is **geometry-only**, which may take a different reconcile path; the shape of the remote change is stated and at least one non-geometry shape is used. **(d)** Reporting AC4 as satisfied when the scenario simply never reproduced step 1 — a swallow that did not happen has not been survived.

5. **The settle window has a stated ceiling — and the ceiling is not the fix.**
   - **The decision, and the argument, because the brief asked for one.** The re-arm is **bounded, not removed, and not relied upon.**
     - **Not removed.** `armSettleRelease`'s re-arm exists so a burst takes and releases the mute once rather than N times — `acquireMute` is explicitly *"at most ONCE per open settle window"* (`canvas-persistence.ts:450`). Removing the re-arm produces mute churn in the middle of a burst and re-opens the echo on the **text-sync**, **file-op** and **manifest** consumers of `isPathMuted`, none of which has a content baseline. Removing it would trade a capture-side defect for three others.
     - **Not relied upon.** The discrimination is fixed by AC1–AC3, at the seam that can see the bytes. **If the cap were the whole fix, this charter would be shipping a smaller window instead of a correct decision**, and the next person to raise `MAX_WAIT_MS` would silently re-open the defect. Any implementation that changes only the timing constants and leaves the drop at `vault-events.ts:232` unattributed **fails this charter**, no matter what the ladder measures.
     - **Bounded.** The window's real length is currently a function of peer activity and has **no ceiling at all** under sustained co-editing — while the constant a reader finds at `:53` says `250`. That is a false constant on a data path, and it is the specific thing that made this defect hard to see. An absolute cap measured from the **first** write of the burst, on the exact precedent of `MAX_WAIT_MS` in the same subsystem (`canvas-sync.ts:309`), makes the documented number computable again. The same treatment applies to `noteExternalDiskWrite`'s timer (`canvas-sync.ts:3969-3977`), which has the identical shape and is not currently named anywhere.
   - **Observable (headless, injected scheduler):** with a write issued every 100 ms for 10 s of simulated time, the mute is observed **released** while writes are still arriving, and the longest continuous muted interval is **≤ the stated cap**. Measured from the recorded `mutePathEvents`/`unmutePathEvents` call sequence.
   - **Observable (the constant is honest):** the value a reader computes from the module's own constants equals the value the test measures. **The comment at `canvas-persistence.ts:50-53` is rewritten** — it may keep saying the suppression is mechanical, but it may no longer say the window is 250 ms unless it is.
   - **Vacuity risk — named.** **(a) The C73/WP75 class:** asserting the cap by reading the constant (`expect(DISK_WRITE_SETTLE_MS).toBe(250)`) is a check on a constant, not a measurement of behaviour. The observable is the call sequence. **(b)** A scheduler fixture in which the re-arm never fires, so the cap is never exercised and the test is green against any value — the control is the same fixture with the cap disabled, which must show the mute held for the full 10 s. **(c)** Asserting the cap on `CanvasPersistence` only and leaving `noteExternalDiskWrite`'s twin unbounded, which leaves half the window in place; both are named.

6. **No collateral. The refcount keeps its meaning everywhere it is the only answer available.**
   - **Observable (behavioural, in the same run, not a diff reading):** with this WP's change in place — a remote file-op applied under `applyRemoteOp`'s mute emits **no** outbound file-op; a muted `.md` write does **not** reach `handleLocalTextModify`; a muted `create`/`delete`/`rename` is still suppressed at `vault-events.ts:140`, `:173`, `:196-197`; and the manifest arm at `:266-275` behaves as before. Each with its pre-existing test **unmodified** and green.
   - **Observable (structural):** `plugin/src/files/file-ops.ts` and `plugin/src/sync/control-handlers.ts` are **not in this WP's diff at all** — asserted by running the diff, not by prose. **B46/WP68 owns both files concurrently**, and a WP91 line in either is unattributable by construction.
   - **Observable (bookkeeping):** every `mutePathEvents` still has its matching `unmutePathEvents` and `muteDepth` returns to `0`. A change that strands a mute count is a silent freeze of that path — the exact failure this WP exists to remove, re-created by its own fix.
   - **Observable (the ownership predicate survives):** `vault-events.ts:236-255`'s WP6/US5 discipline — **one** ownership predicate, evaluated **once** per event, with the text path structurally unreachable for a canvas-owned path — holds after the reordering. A reordering that lets a canvas-owned path fall through to `handleLocalTextModify` re-creates the two-writer race and is an abort criterion.
   - **Vacuity risk — named.** **(a)** "Unchanged" asserted from reading the diff — the five behaviours are driven, in the same run, and each is shown to redden if its mute check is removed. **(b)** A full-suite green quoted in place of naming the affected test files and their counts; a suite green hides a file that was quietly edited to stay green. **(c)** Attributing a red to a sibling batch without measuring it: §7's concurrent-batch attribution rule applies, and B46's edits are live in two of the files this WP must prove it did not touch.

**Definition of Done:** no local edit to a shared canvas is discarded for a reason that is not a fact about its bytes; every decline is counted, attributed and greppable; and the settle window has a ceiling a reader can compute from the module it lives in.

---

## 5. Constraints and Known Risks

- **Permission / environment limits:** Windows dev host; run all plugin commands from `plugin/` (never the repo root). Runner is Vitest 4.0.18 — the `basic` reporter was removed, use the default or `--reporter=dot`. Budget **≥90 s** for any automated `npm test` (a deliberate 33.5 s sleeper in `wp5/latency.test.ts` makes ≈41 s the floor, not a hang). No Graphify graph exists (declared FALLBACK mode); `workflowArtifacts/RepoMap.md` is the structural map.
- **🚨 RULE 14 — the working tree is shared.** `git status` before every stage and every commit; stage **explicit paths only**; never revert, stash or `checkout` over a sibling's changes. **B46/WP68 is live in `plugin/src/files/file-ops.ts`, `plugin/src/sync/control-handlers.ts` and `plugin/src/utils.ts` at chartering time.** If a coder believes this WP requires editing any of the three, that is an **ESCALATE**, not an implementation choice.
- **⚠ Every `file-ops.ts` line number in this charter, in `ImplementationReport_B44_ScheduleDependence.md` and in `DISPATCHER_STATE.md` is stale.** `isPathMuted` was at `:196` at `fb631f8` and is at `:219` in the tree. Re-locate by symbol name (rule 5). The other four cited files are byte-identical between `fb631f8` and the tree and their numbers hold.
- **The bundle under measurement is contended, and two signals govern it.** **S67** — the repo's committed `plugin/main.js` (`85a29c85`) is **not** the installed bundle (`b672be50`); anyone running `liveshare_e2e_install.py` without `LS_EXPECT_SHA256` **silently changes the code under measurement**. **`S57(installer)`** — installed bytes are not loaded bytes. Both apply to every live row in §4 and they compose. State the bundle hash in every live row.
- **S65 governs every log-based claim in this WP.** Stamp-to-flush lag measured at ~58 s against 2–2.5 s reader margins. **No absence claim about a signature is accepted as evidence for any AC**; the counters in AC3 exist so none is needed.
- **S66 governs the negative control.** `link.break shape="close"` is **not** a break — `autoReconnect` reverses it inside the scenario and a run scored 29/29 with the link nominally severed. Use `shape="mux"`, which is the shape B44's own red measurement used.
- **Verification must be by targeted injection of this WP's own class.** A green is worth nothing unless removing the change reddens a test **on its own named assertion**. The two classes that apply most directly:
  - **A test that never reaches the guard.** Calling `handleLocalModify` directly is the whole-charter version of this and would be green against an untouched tree. AC1(a) names it.
  - **A green that cannot fail.** Three of the five checks that were hiding this defect were unfalsifiable — including one asserting a node was absent on a peer it had never been sent to. Every AC above carries its own risk for this reason.
- **Known flaky patterns:**
  - **No new timing-based echo suppression, and no new `setTimeout` in the decline path.** The whole point of this WP is to take a timer off a correctness path; adding one is an abort criterion.
  - **No wall-clock sleeps in new tests.** Use the injected `PersistenceScheduler` / fake timers.
  - Do not assert on log strings as the primary oracle; state is the oracle, signatures are for humans.
  - Never reason from two peers only where a third would behave differently.
  - Biome reports a whole-file `format` finding per touched file (CRLF environment artefact). Advisory locally, gating in CI — do not mass-reformat.
- **Known risks specific to this WP:**
  - **The most likely wrong answer is a smaller number.** Lowering `DISK_WRITE_SETTLE_MS`, or removing the re-arm, makes the ladder pass at 0.5 s and leaves the defect intact at 0.1 s. **A ladder that goes green is not evidence that the drop was attributed** — AC3's counters are.
  - **The second most likely is a retry.** Re-issuing the write outside the window turns the defect back into a green and is the move that hid it for the life of the suite. Forbidden in product and in tests.
  - **The third is flipping `useCanvasBinding`.** It would route capture off the file path and make the symptom disappear without touching the mechanism, in a subsystem frozen until P5. Abort criterion.
  - **A stranded mute count** — introduced by a reordering that skips an `unmutePathEvents` — is a **permanent** silent freeze of that path, i.e. this same defect with an infinite window. AC6 exists for it.
  - **The `lastWrittenContent` advance must not be able to lag the event.** Today it is set synchronously after the awaited write in both producers (`canvas-persistence.ts:427` before `onWritten` at `:435`; `canvas-sync.ts:4148-4149`), so the breaker is armed at every instant the timers were covering. **That ordering becomes load-bearing under this WP and must be asserted, not assumed** — if a producer ever advances the baseline asynchronously, the echo is captured as a user edit and every peer gets a spurious delta.
- **External dependency risks:** no new runtime dependency. Obsidian's `Vault` surfaces used here (`on("modify")`, `read`, `adapter.write`) are public API and stable; the private Canvas API is not involved on this path.
- **Hard constraints:**
  - Invariants I1–I5 and I6–I11 are binding; **I11 is an acceptance criterion, not advice.**
  - `plugin/src/files/file-ops.ts`, `plugin/src/sync/control-handlers.ts` and `plugin/src/utils.ts` are **not modified by this WP**.
  - No existing test is deleted, weakened, retitled, skipped or amended. **WP91 holds no §7 licence of any class**, and an unenumerated deletion or assertion rewrite is an abort criterion.
  - WP4's byte echo breaker at `canvas-sync.ts:3107` is promoted, never modified.

### Recorded, not repaired — three things in B44's account I could not reproduce, and one I could not check

Stated here rather than transcribed into the charter body, because a charter that repeats an unverified citation is how this run has broken rule 5 repeatedly. **None of the four changes the mechanism, which is verified statically at four sites.**

1. **The `≤ 0.5 s → LOST 20/20` row is not a threshold measurement.** B44's own §1 records that the ≤ 0.5 s sweep **lost its own positive control**, which by the script's stated rule invalidates that block. It supports *"everything at ≤ 0.5 s is lost"*; it does not support the per-shape 20/20. The threshold rests on the 0.5–0.8 s block (11/12) and the 0.9–1.0 s block (4/4). **The brief I was given presents the invalidated row as clean.** W4 must re-run the ladder with the control retained.
2. **`shape="silence"` is asserted and never measured.** B44 §3.3 states that `close` is not a break, then that *"`shape="silence"` leaves the socket open and stops delivery, which is the condition the checks actually depend on"*, and then reports its red state under **`LS_E2E_BREAK=mux`**. `SIGNAL_REGISTER.md` records **`mux`** as the shape that breaks (S66). **No measurement in the report supports the `silence` sentence.** Use `mux`.
3. **The `CANVAS WRITE HELD:` zero-hit claim cannot be checked from the artefact.** B44 §5 says it and `SHADOW STALE:` had zero hits *"each proved matchable against a present line first (Rule 15)"*, but the matched control line is not in the report. `CANVAS WRITE HELD:` has exactly one emitter (`main.ts:2883`) and this is precisely the absence-claim shape **S65** invalidates. The conclusion it supports — that WP37's busy gate is not implicated — is independently true from the static trace in §3, so nothing downstream depends on it.
4. **The on-disk survival of the swallowed bytes is unmeasured beyond 20 s with no further remote change.** See §3; this is AC4 and it may be the most serious part of the finding.

---

## 6. Definition of Done Artifacts

- **Required changed files:**
  - `plugin/src/files/vault-events.ts`
  - `plugin/src/files/canvas-sync.ts`
  - `plugin/src/files/canvas-persistence.ts` (AC5 only)
- **Explicitly NOT changed:** `plugin/src/files/file-ops.ts`, `plugin/src/sync/control-handlers.ts`, `plugin/src/utils.ts`, `plugin/src/main.ts` (beyond wiring, if any), `plugin/src/canvas/canvas-presence.ts`, `plugin/src/canvas/canvas-binding.ts`, `plugin/src/canvas/canvas-model-bridge.ts`, `server/**`.
- **Required report:** `ImplementationReport_WP91.md` (in `workflowArtifacts/canvas-v2/`), containing: the gate placement after the change, link by link against §3's table; the per-AC falsification (change neutralised → which test reddens, on which **named** assertion, and whether any neighbouring pre-existing oracle also reddened); the measured mute ceiling against the **750 ms prediction** in §3, with the third-timer escalation if it does not hold; the live ladder rows with the bundle hash and each block's positive control; the AC4 two-step verdict **either way**; the before/after full-suite counts with foreign edits attributed to B46; and a line-by-line diff statement for `canvas-persistence.ts` on WP90's precedent.

### Proposed for the Dispatcher to land — this charter does not edit `BUILD_SPEC_CanvasV2.md`

- **Proposed signature (BUILD_SPEC §10 row).** §10's rule is that every declared signature has exactly one production emitter; **`SEED REFUSAL STORE:` was emitting unregistered until B45 caught it**, and this WP must not repeat that.

  | Signature | Status | Owner |
  |---|---|---|
  | `CAPTURE DECLINED:` | new | WP91 — one emitter in `canvas-sync.ts` `handleLocalModify`; a local canvas modify that produced no capture, with its path and its reason from the closed set |

  Format: `CAPTURE DECLINED: <path> reason=<echo|not-subscribed|read-only|schema-major|no-doc> (declines=<n>)`. **Path and reason only — never file contents, never node text.** The name is deliberately *declined* rather than *dropped*: after this WP there is no drop, only a decision that names itself.

- **Proposed §9 row:**

  | WP | Phase | Title | Scope summary | Depends on | Status |
  |---|---|---|---|---|---|
  | **WP91** | **P0** | **A mute that cannot tell who wrote is not an echo breaker** | A local whole-file write to a shared `.canvas` landing within ~0.8 s of a remote change applied to that path is **silently dropped** — bytes on the writer's disk, absent from the writer's **own** doc, absent from the peer, **no `local modify` receipt at all**; `useCanvasBinding` is `false`, so this is the live user path. Three timer gates (`vault-events.ts:232` mute refcount with no log line, `vault-events.ts:244` and `canvas-sync.ts:3065` `recentDiskWrites`) stand in front of **the byte echo breaker WP4 already built for this exact question** (`canvas-sync.ts:3107`, C4 AC2, *"deliberately NOT a timer"*), which they prevent from ever running. Window = `MAX_WAIT_MS 500` + `DISK_WRITE_SETTLE_MS 250` = **750 ms**, held by **two** independently re-arming 250 ms timers (`canvas-persistence.ts:463`, `canvas-sync.ts:3969-3977`) — unbounded under sustained co-editing. Root cause is in the spec: **C4's declared input is an *"unmuted"* path**, so no WP4 criterion could reach the mute, and `canvas-persistence.ts:50-53` told every reader it was *"NOT a correctness mechanism"*. Scope: content identity promoted to sole authority for canvas-owned paths · every decline **counted, attributed and greppable** under a new `CAPTURE DECLINED:` signature, because an unlogged silent discard on a data path is how this survived · **I11 on the capture side**, including the unmeasured second step where one further remote change lets the projection overwrite the user's surviving bytes · the settle window **bounded, not removed and not relied upon** · `file-ops.ts` and `control-handlers.ts` **out of scope** (live under B46/WP68) and the refcount left byte-identical for its five consumers that have no content baseline. **Not WP37** — that was a view-rebuild keystroke loss on the apply side; this is whole-file, capture side, never reaching `handleLocalModify`. | **WP4** | **planned** |

- **New finding needing a signal number — described, not numbered** (per SIGNAL_REGISTER §1, workers describe and the Dispatcher allocates): **`noteExternalDiskWrite` (`canvas-sync.ts:3969-3977`) holds a second, independent, re-arming 250 ms echo window that no document in this run names.** It has the same clear-and-re-arm shape as `armSettleRelease`, is fed by the same `onWritten` wiring, and is therefore held across the same burst. Any repair that bounds only `CanvasPersistence`'s timer leaves half the window in place. Not a separate defect from WP91 — it is a second instance of WP91's mechanism, and it is worth a number because it is the part a scoped fix will miss.

- **BUILD_SPEC §5 component:** **C91** is proposed by the §9 row above and by §4's criteria. The Dispatcher writes it.

- **Gate status required at handover:** `npm run build` PASS and `npm test` with 0 failures, run from `plugin/`, attributed against B46's concurrent edits. All visible tests PASS. **`plugin/main.js` is contended — do not build it without checking the current batch table.**

---

## 7. Visible Test Cases / Producer Artifacts

*Empty — filled by Worker 3's producer sub-agent. Worker 2 does not generate tests.*

---

## 7b. W4 Test Targets (filled by Worker 3's Unit Test Sub-Agent, if any)

**Three criteria carry a live arm that no unit seam can settle.** Everything else in §4 is decidable headless, at the registered `vault.on("modify")` handler, in `handleLocalModify`, and against `CanvasPersistence` with an injected scheduler.

1. **AC1 — the ladder.** `liveshare_b41_observe_then_write.py` at `LS_B41_DELTAS=0.0,0.1,0.3,0.5,0.8`, all four edit shapes, `CTRL_NODE_A` retained in every block, blocks whose control did not arrive **discarded rather than reported**. Today: LOST. Required: OK on every rung. **This is the row that reproduces B44 and the row that proves the fix on the product rather than on a seam.**
2. **AC3 — the counters on a live instance.** The `echo` counter must be observed **non-zero** on a real instance during ordinary co-editing, because that is the reason a headless fixture is most likely to arrange trivially. A live run in which no decline is ever counted has not demonstrated that the instrument is wired.
3. **AC4 — the two-step I11 scenario**, which requires two live instances and a real remote apply between two reads of the writer's own file. **Its verdict is reported either way**; a RED here is a finding of its own and is escalated rather than folded into WP91's completion.

**Constraints on every live row:** the bundle hash is stated (S67, `S57(installer)`); the negative control is `shape="mux"` and never `close` (S66); no absence claim is read from the debug log (S65); per-run ids and `reset_canvas()` are mandatory; `canvas.simulateEdit` is never called; and no `data.json` **value** is read, printed or fixtured.

---

## 8. Autonomous Execution Plan (filled by Coder Sub-Agent, attempt 1)

*Empty at handover.*

---

## 9. Handover Summary (filled by Coder Sub-Agent on completion)

*Empty at handover.*

---

## 10. Risk Notes for Worker 4 (filled by Worker 3 Core)

*Empty at handover.*
