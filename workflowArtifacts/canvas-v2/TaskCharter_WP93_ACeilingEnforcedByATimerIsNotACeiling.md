# Task Charter — WP93: a ceiling enforced by a timer is not a ceiling on a platform that clamps timers

<!-- Updated: chartered 2026-08-07 (B51, Worker 2) against S71, and against the Dispatcher's ruling at `DISPATCHER_STATE.md:2639-2645` / `SIGNAL_REGISTER.md:122-127` that the lazy release is S71's remedy and was not WP91's to take. Re-verified independently against the tree per rule 12, on branch `fix-bugs-and-raceconditions` at `8e88f88`. ⚠ THE FIVE-CONSUMER FIGURE IS EXACTLY RIGHT FOR ONE FILE AND EXACTLY WRONG AS A CLOSED SET, and I derived the census rather than transcribing it. `grep -rn "isPathMuted" plugin/src --include=*.ts` with tests excluded returns **fourteen lines: one definition (`file-ops.ts:219`) and THIRTEEN call sites**, and they are not all where the run has been looking. **`vault-events.ts` holds five gates over six calls** (`:140` create, `:173` delete, `:196`+`:197` rename, `:282` text-modify, `:292` binary-modify) — that is the five, and it is the set WP91's charter §2 was reaching for. **`file-ops.ts` holds SEVEN MORE CALLS IN FOUR METHODS that no document in this run names** (`:469`, `:514`, `:522`, `:537`, `:548`, `:575`, `:587`), and **three of them are POST-AWAIT RE-CHECKS** (`:514`, `:522`, `:548`) that read the refcount a second time after an awaited `vault.read`/`readBinary` — which is precisely the shape a release-timing change can break and a timer cannot. ⚠ AND WP91's §2 LIST DOUBLE-COUNTS: it names `applyRemoteOp`'s mute as one of the five, but `applyRemoteOp` is a PRODUCER (`file-ops.ts:276` takes, `:460-464` releases) and consults nothing; and it names "the manifest arm" as a separate consumer when that arm sits behind the same `:292` binary gate it already counted. So the true census is **eleven consumer decisions over thirteen calls in two files**, not five, and the six nobody has named are the six most exposed to this change. ⚠ THE PRODUCER SIDE IS WORSE THAN THE CONSUMER SIDE AND NOBODY HAS COUNTED IT: `grep -rn "unmutePathEvents"` excluding tests gives **NINE production release sites, and every single one is a `setTimeout`** — `canvas-persistence.ts:519` (capped by WP91 at `MAX_MUTE_MS` 750), `canvas-sync.ts:4120` (capped at `MAX_ECHO_WINDOW_MS`), `file-ops.ts:462`, `background-sync.ts:502`, `canvas-sync.ts:4304`, `main.ts:1120`, `:1615`, `:2591`, `:2705` — **seven of the nine uncapped and released by a bare 250 ms `setTimeout`.** Under a 60 s clamp every one of them holds its mute for ~60 s. ⚠ AND THE LAZY RELEASE CANNOT BE PURELY LAZY — see §3.4: a write of identical bytes may emit no vault event at all, and three of the five `vault-events.ts` gates are armed for `create`/`delete`/`rename` events that a `modify`-keyed release would never see. A purely event-driven release strands the refcount, which is a PERMANENT silent freeze of that path — this WP's own defect with an infinite window. The honest shape is stated in §3.4 and it is an inversion, not a replacement. No Obsidian was launched, no vault file was read, no `data.json` was opened, no relay was contacted, no E2E script was run, and no `plugin/src/**` file was edited for this charter. -->
**Charter Status:** `SPEC_COMPLETE`
**WP:** WP93
**Phase:** P0
**task_mode:** `standard`
**Depends on:** WP91 (`DONE`, `267d5b2` / `54e50ce`) — its `MAX_MUTE_MS` cap, its `muteOpenedAt` burst marker and its `CAPTURE DECLINED:` counters are **consumed and extended, never duplicated or replaced**. WP68 (`DONE`, `58aff0a`…) — `file-ops.ts`'s sidecar guards are byte-unchanged. WP6/US5 — the one-ownership-predicate discipline at `vault-events.ts:243-281` must survive intact. **MUST NOT be batched with WP92, with WP89, or with any other `file-ops.ts` / `vault-events.ts` / `canvas-persistence.ts` work** — see §2 Ordering.
**W4 Test Targets:** `2`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **The statement of the problem, in one sentence:** *a ceiling enforced by `setTimeout` cannot be honoured on a platform that clamps `setTimeout`, and every echo-suppression window in this plugin is enforced by `setTimeout`.*
- **What is measured, and it is not a hypothesis.** **S71**: the renderer's timers are clamped to **60.00 s ± 0.02**. Two independent timers in two independent modules — `DebugLogger`'s `FLUSH_DELAY_MS = 500` `setTimeout` and `SyncManager`'s `AWARENESS_TICK_INTERVAL_MS = 4_000` `setInterval` — stretch to exactly one minute **at the same moments**, and the second one reports it itself (`AWARENESS GAP: 59998ms … source=tick`). No I/O explanation covers two timers in two modules aligning to a whole minute; it is a host wake-up clamp on the renderer. Incidence over the whole retained history: **0.7 % of 18 608 / 18 496 pulses in the 40–70 s band** — a **fat tail, not the steady state**, which is exactly why nothing caught it.
- **Why that lands on WP91's work specifically.** WP91 capped its two settle windows at a measured **750 ms** (`MAX_WAIT_MS` 500 + `DISK_WRITE_SETTLE_MS` 250, `canvas-persistence.ts:79`) and **recorded honestly that its instrument is a virtual clock and cannot observe a clamp by construction.** It also recorded the consequence, which is the reason this WP is P0 and not P2: *after WP91 a 60 s clamp costs **latency**, not **data**, because the capture path no longer consults the mute at all — **before** WP91 it would have turned a 750 ms silent-destruction window into a ~60 s one, and the ladder would still have gone green.* **That is a statement about one path.** The other eleven consumer decisions in §3.2 still consult the mute, none of them has a content baseline, and for them a 60 s clamp is still a 60 s window.
- **Outcome:** an echo-suppression window is bounded by something that is **not a promise made to a clamped clock**, and when a window does overrun its stated ceiling the product **says so** instead of the fact being recoverable only from a rig that happened to be watching.
- **The two deliverables, and they are not equally important.**
  1. **The lazy release** — the remedy the Dispatcher referred here. It is right, it is not a drop-in replacement (§3.4 shows why a purely event-driven release **strands the refcount**, which is a permanent silent freeze of that path), and its blast radius is the eleven consumers §3.2 enumerates.
  2. **The overrun telltale** — a mute that is released later than its own ceiling is **counted and named**. This is the smaller change and it is the one that survives the lazy release turning out to be the wrong remedy, because it makes S71 observable **in the product** rather than only in an instrument that was pointed at it by luck. `AWARENESS GAP:` already does exactly this for the awareness pulse (`sync.ts:920-926`) and it is the reason S71 was findable at all. **The mute has no equivalent, and that absence is why the clamp reached WP91's ceiling unobserved.**
- **Why this is P0.** Every consumer in §3.2 is a gate on a data path — an outbound file-op that is or is not emitted, a text capture that does or does not run, a manifest update that does or does not happen. A gate held open by an unbounded factor of 120 is a P0-class mechanism whatever the incidence, and the incidence is measured rather than assumed.
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 5, component **C93** (work package **WP93**), and the section 9 row; section 4.6 (**I11**, **I5**); section 10 (the signature register — this WP proposes one, see §6). **C93, the §9 row and the header arithmetic are PROPOSED in §6 and landed by the Dispatcher; this charter does not edit the BUILD_SPEC.**

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: modify, in **at most three** production files:
    - `plugin/src/files/file-ops.ts` — `mutePathEvents` / `unmutePathEvents` / `isPathMuted` / `mutedPaths` (`:204-221`), the release mechanism, the overrun counter, and `applyRemoteOpInner`'s release (`:460-464`).
    - `plugin/src/files/vault-events.ts` — **only** if the lazy release needs the vault handlers to signal consumption. Any change here is under the WP6/US5 ownership discipline and AC5.
    - `plugin/src/main.ts` — **wiring only**, and only for the release-notification seam. §3.1's S11 rule is absolute.
  - Responsibility: give the mute a release condition that a clamped renderer cannot stretch, **without** letting it become a release condition that never fires; and make an overrun **countable** rather than invisible.
- **Out of scope / non-goals — each of these is an ESCALATE, not a judgement call:**
  - **⚠⚠ THE REFCOUNT'S MEANING. `isPathMuted` answers "did we cause this" and must keep answering exactly that.** This WP changes **when the answer stops being yes**, not what the question is. "Make `isPathMuted` content-aware" is out: **eleven of its thirteen call sites have no content in hand at the moment they ask** (§3.2), and the two that could get it — `file-ops.ts:514`/`:522`/`:548`'s post-read re-checks — are re-checks of a decision already taken. Content identity is WP4's byte breaker and WP91 already promoted it on the one path where the bytes are available. **Re-opening that is an abort criterion.**
  - **⚠⚠ `plugin/src/files/canvas-sync.ts`'s `handleLocalModify` and the byte echo breaker at `:3239`.** WP4 AC2, promoted by WP91 to sole authority for canvas-owned paths, and **correct**. The canvas capture path does **not** consult the mute after WP91 (`vault-events.ts:249-280`) and this WP must not put it back. Widening, weakening or adding a tolerance to the byte breaker re-opens WP4 and is an abort criterion.
  - **⚠ WP91's cap, and the two windows it bounds.** `MAX_MUTE_MS` (`canvas-persistence.ts:79`), `armSettleRelease` (`:505-523`), `muteOpenedAt` (`:271`), `MAX_ECHO_WINDOW_MS` and `noteExternalDiskWrite`'s twin (`canvas-sync.ts:4100-4126`). **They are the model this WP generalises, not the thing it replaces.** WP91 landed them three commits ago; changing their values is out, and a change that makes either cap unreachable is an abort criterion. **If the lazy release makes `armSettleRelease` redundant, say so in writing and leave it standing** — a cap that is now a floor is still a cap.
  - **⚠ `plugin/src/sync/sync.ts` and the awareness prune window (S72).** **Ruled SEPARATE — see §3.6 for the argument, which is not "different subsystem".** Out of scope entirely.
  - **⚠ `plugin/src/debug-logger.ts` and `FLUSH_DELAY_MS`.** S71's other measured victim. WP81 owns that file; the clamp is not a logging defect and repairing the logger would repair a symptom.
  - **⚠ Diagnosing the clamp itself.** Confirming it is Chromium's hidden-page intensive wake-up throttling specifically requires a window-focus change on a shared rig; B49 declined it and so does this WP. **AC4 makes the clamp observable; it does not explain it.** An AC that turns on the cause being known would be unbuildable.
  - **⚠ Replacing `setTimeout` globally.** There are dozens of `setTimeout`/`setInterval` call sites in `plugin/src`. This WP addresses the **mute release** and nothing else. A sweep is a different work package and would be unattributable in one diff.
  - **⚠ `plugin/src/files/canvas-sidecar.ts`** — **uncommitted in the shared tree at chartering time** under a sibling batch. Read it, never revert it, never stage it. Rule 14.
  - **⚠ `server/**`, deployment, `docker/.env`, any secret, any `data.json` value.** Entirely out. The relay is production; `GET /healthz` is the only permitted interaction.
  - **⚠ `useCanvasBinding`, `canvas-binding.ts`, `canvas-model-bridge.ts`, `canvas-presence.ts`.** Frozen; the flag stays `false`. **Flipping it would route capture off the file path and make one symptom disappear without touching the mechanism** — the single most tempting wrong answer in this area, and an abort criterion.
  - **⚠ Any new runtime dependency** (D11), and **any new timing constant except a stated ceiling derived from an existing one** — WP91's precedent exactly.
- **Known interfaces / dependencies:**
  - Input: a path mute taken by one of nine producers (§3.3); the vault event that consumes the echo it was taken for, where one exists
  - Output: a release that is bounded by consumption **or** by a ceiling, whichever comes first; a counted, named overrun
  - Depends on: **WP91** for the cap shape and the burst marker, **WP68** for `file-ops.ts`'s current sidecar guards, **WP6/US5** for the ownership discipline

### Ordering — what must NOT be batched together

Measured at charter time (`git status`, `git log`, `8e88f88`), and stated as a measurement, not a timeless fact (rule 5).

1. **Not with WP92**, chartered in the same batch. WP92's surface is `canvas-persistence.ts:641-685` and `main.ts`'s attach + `onunload`; WP93's includes `file-ops.ts` and `main.ts` wiring. **Both touch `main.ts`, and rule 14 makes region-disjointness insufficient (S34).**
2. **Not with WP89**, also chartered in the same batch. WP89's `main.ts` surface is the reconcile region (`:2379-2600`), which contains **two of this WP's nine release sites** (`main.ts:2591`, `:2705`). Direct overlap.
3. **Not with any other `file-ops.ts` work.** WP68 landed +78 lines in it and WP88's counters live in it; it is the second-most contended file in the run.
4. **Not with a live sibling E2E suite.** Two E2E suites against one instance pair **do not compose** — B39 measured `19/21` vs `21/21` and `37/1/4` vs `38/0/4`, **with the loser recorded as a product failure.** **B50 is live against both instances at chartering time.**
5. **`plugin/src/files/canvas-sidecar.ts` is uncommitted in the shared tree.** Re-locate every symbol in it by name; never revert.

---

## 3. Architecture Context

*Task-local architecture guidance only.*

### Verified against the tree (rule 12), 2026-08-07, branch `fix-bugs-and-raceconditions` at `8e88f88` — measured, given, do not re-derive

**Every claim below states its pattern and its tool. Cite by symbol; the line numbers are a measurement at `8e88f88` and are to be re-measured before they are quoted anywhere else (rule 5, broken at least five times in this run, including in the file that states the rule).**

#### 3.1 ⭐ THE CONSUMER CENSUS — derived from the tree, and the number is not five

- **TOOL:** `grep -rn "isPathMuted" plugin/src --include=*.ts`, `plugin/src/__tests__/**` excluded.
- **RESULT: fourteen lines — one definition and THIRTEEN call sites**, plus one comment (`vault-events.ts:252`, WP91's, which the pattern also matches and which is not a call).
- **Positive control for the same pattern with the same tool:** the identical grep including tests returns **68 lines**, so the pattern matches abundantly and the production restriction is what narrows it, not a broken pattern (rule 15).

**Definition:** `file-ops.ts:219` — `return (this.mutedPaths.get(normalizePath(path)) ?? 0) > 0;` over a bare `Map<string, number>`. No content term, no origin term.

**Group A — `vault-events.ts`: five gate decisions over six calls. This is the five, and it is real.**

| # | site | the decision it gates | has a content baseline? |
|---|---|---|---|
| **A1** | `:140` | vault `create` → `fileOpsManager.onFileCreate`, **and** the host's `backgroundSync.onFileAdded` + `manifestManager.updateFile`/`addFolder` | **no** |
| **A2** | `:173` | vault `delete` → `onFileDelete`, **and** the host's `backgroundSync.onFileRemoved` + `manifestManager.removeFile` | **no** |
| **A3** | `:196` + `:197` | vault `rename`, **either endpoint** → `onFileRename`, `cancelSubscribe`, `onFileRenamed`, host `renameFile`, **and `canvasSync.handleRename`** | **no** |
| **A4** | `:282` | `modify`, **text branch** — reached only after the canvas branch has returned (WP91) → `backgroundSync.handleLocalTextModify` | **no at this gate.** `BackgroundSync` has a byte breaker, but it lives *inside* the writer (`background-sync.ts:487-489`), past this return. |
| **A5** | `:292` | `modify`, **binary branch** → `fileOpsManager.onFileModify`, **and** the host's binary `manifestManager.updateFile` | **no** |

**Group B — `file-ops.ts`: SEVEN more calls in FOUR methods, which no document in this run names.**

| # | site | what it guards | shape |
|---|---|---|---|
| **B1** | `:469` | `onFileCreate` entry — refuses the outbound content push | entry check |
| **B2** | `:514` | `onFileCreate`, **after `await vault.readBinary`** | **post-await re-check** |
| **B3** | `:522` | `onFileCreate`, **after `await vault.read`** | **post-await re-check** |
| **B4** | `:537` | `onFileModify` entry | entry check |
| **B5** | `:548` | `onFileModify`, **after `await vault.readBinary`** | **post-await re-check** |
| **B6** | `:575` | `onFileDelete` entry | entry check |
| **B7** | `:587` | `onFileRename` entry, **both endpoints** | entry check |

**So the census is eleven consumer decisions over thirteen calls in two files.** Five in `vault-events.ts` and six in `file-ops.ts`.

**⚠ And the "five" as recorded double-counts and mis-attributes.** `TaskCharter_WP91…:40` lists its five as *"`applyRemoteOp` mutes around a remote file-op apply (`:253`/`:439`) … the vault `create`, `delete` and `rename` handlers … and the text-sync branch and the manifest arm"*. Two corrections, both measured:

- **`applyRemoteOp` is a PRODUCER, not a consumer.** `applyRemoteOpInner` **takes** the mute at `file-ops.ts:276` and **releases** it at `:460-464`. `grep -nF "isPathMuted" plugin/src/files/file-ops.ts` shows no call inside it. It belongs in §3.3's table, not this one.
- **"The manifest arm" is not a separate gate.** The host's manifest work sits *inside* A1, A2 and A5, behind the same three `isPathMuted` returns already counted. Counting it again inflates the census by one and, worse, suggests there is a gate to reason about that does not exist.

**The six in `file-ops.ts` are the ones this WP most needs to reason about, and here is why the shape matters.** B2, B3 and B5 read the refcount a **second** time, after an awaited `vault.read` / `readBinary`. Today the 250 ms timer makes the two reads agree for any read faster than 250 ms — which is nearly all of them — so the re-check is a belt-and-braces guard that almost never changes the answer. **An event-driven release removes that guarantee**: the release can now fire *because of the very event the read is racing*, and the entry check and the re-check can genuinely disagree. Whether that is a defect or the intended behaviour is a decision this charter requires in writing (AC2), because the two readings lead to opposite implementations.

#### 3.2 What a lazy release does to each consumer — the table AC2 must produce, seeded with what is derivable statically

**This is an input to be re-measured, not a result to be quoted.** The implementor produces the authoritative version.

| consumer | the event that would release the mute it consults | does that event exist? | what a lazy release does |
|---|---|---|---|
| **A1** create | a vault **`create`** for the applied path | yes, for a `create` op | works — **if** the release is keyed per op type. A `modify`-keyed release **never fires** here. |
| **A2** delete | a vault **`delete`** | yes, for a `delete` op | same. And a delete whose target did not exist emits nothing at all → **stranded**. |
| **A3** rename | a vault **`rename`**, **two paths, one event** | yes | **the hazard case.** `vault-events.ts:203-226` chains the work behind `pendingRename`; releasing on the event fires *before* `onFileRenamed`, `renameFile` and `handleRename` complete, so the mute lifts mid-teardown. |
| **A4** text modify | a vault **`modify`** | yes — this is the clean case | works, and it is the only consumer for which the naive reading is correct. **But** A4 has no content baseline at the gate, so an early release means the text path captures its own echo — the exact defect WP91 closed for the canvas path and **did not** close here. |
| **A5** binary modify | a vault **`modify`** | yes | as A4, and `onFileModify` has no content test anywhere: it re-reads and re-emits. |
| **B1–B7** | the inbound apply completing | **not an event** — these guard the *outbound* side against re-broadcasting what we just applied | a release tied to the inbound event landing is *right* for these; the post-await re-checks (B2/B3/B5) become order-sensitive. |

#### 3.3 ⚠ THE PRODUCER SIDE, WHICH NOBODY HAS COUNTED — nine releases, nine `setTimeout`s

- **TOOL:** `grep -rn "unmutePathEvents" plugin/src --include=*.ts`, tests excluded, then each site read.

| # | producer | release | ceiling |
|---|---|---|---|
| **P1** | `CanvasPersistence.armSettleRelease` (`canvas-persistence.ts:505-523`) | injected `scheduler.setTimeout` → `releaseMute` `:527` | **capped**, `MAX_MUTE_MS = MAX_WAIT_MS + DISK_WRITE_SETTLE_MS = 750` (`:79`), measured from `muteOpenedAt` (WP91) |
| **P2** | `CanvasSync.noteExternalDiskWrite` (`canvas-sync.ts:4110-4126`) | `setTimeout` — releases `recentDiskWrites`, **not** the mute | **capped**, `MAX_ECHO_WINDOW_MS` (WP91/S68) |
| **P3** | `FileOpsManager.applyRemoteOpInner` (`file-ops.ts:460-464`) | bare `setTimeout(…, VAULT_EVENT_SETTLE_MS)` in a `finally` | **none** |
| **P4** | `BackgroundSync` write (`background-sync.ts:500-505`) | bare `setTimeout(…, 250)` | **none** |
| **P5** | `CanvasSync` seed writer (`canvas-sync.ts:4302-4307`) | bare `setTimeout(…, 250)` — **S75(b)**, the retired writer still arming | **none** |
| **P6** | `main.ts:1111-1123` — the manifest-driven rename | bare `setTimeout(…, 250)` | **none** |
| **P7** | `main.ts:1610-1616` — `cleanupStaleFiles`'s trash loop | bare `setTimeout(…, 250)` | **none** |
| **P8** | `main.ts:2493` → `:2591` — `reconcileLiveCanvas` | bare `setTimeout(…, 250)` | **none** |
| **P9** | `main.ts:2695` → `:2705` — `releaseHeldCanvasWrite` | bare `setTimeout(…, 250)` | **none** |

**Nine producers. Nine `setTimeout` releases. Seven of them uncapped.** Under a clamp every one holds its mute for ~60 s instead of 250 ms, and **only P1 and P2 would even notice**, because only they measure anything. **This is the real size of S71 on this subsystem, and the count has gone 2 → 9 by running one grep.** The parallel with S75 is exact: *the timer count on this path has gone 3 → 4 → 5 as each batch looked harder, and none of them was found by reading the charter.*

#### 3.4 ⚠ WHY THE LAZY RELEASE CANNOT BE PURELY LAZY — the inversion, stated so it is not discovered in code

The proposal referred here is *release the mute at the next event rather than on a timer*. Taken literally it is unsafe, for three reasons that are all facts about the tree:

1. **A write can produce no event.** `BackgroundSync` (`background-sync.ts:485-490`) explicitly reads the file first and **returns without writing** when the bytes already match. A write that does not happen emits no `modify`. `CanvasPersistence.flushToDisk` dedups on `lastQueuedContent` for the same reason. **No event ⇒ a purely lazy release never fires ⇒ the refcount is stranded.**
2. **A stranded refcount is permanent and silent.** `unmutePathEvents` (`file-ops.ts:209-217`) decrements; `mutedPaths` has no sweeper and no clock. A count that is never decremented **drops every vault event for that path for the rest of the session.** That is this WP's own defect with an infinite window, and `w4-canvas-integrity.test.ts` already carries four assertions against it (`:623`, `:647`, `:651`, `"a failed write leaked the mute"`).
3. **Three of the five `vault-events.ts` gates are armed for events a `modify`-keyed release would never see** (§3.2, A1/A2/A3).

**So the honest shape is an INVERSION, not a replacement:** release on the **first** of *(the consuming event arrives)* or *(the stated ceiling is reached)*. Today the timer is **the mechanism** and there is no event term at all. After this WP the event is the mechanism and the timer is **the safety net** — still a `setTimeout`, still clampable, but now it is the thing that catches the case where no event comes, rather than the thing that decides the ordinary case. **A clamp then costs a mute that is held slightly too long in a case that is already degenerate, instead of a mute that is held 240× too long in the ordinary case.**

**That distinction is the whole charter, and it is the same distinction WP91 landed:** *a byte-identity decision is immune to a clamp; a timer-shaped one is not.* Here the event is the identity.

#### 3.5 The clamp is not observable from inside the mute today, and that is the second deliverable

`SyncManager` measures its own pulse gap on **every** pulse and warns above `AWARENESS_GAP_WARN_MS = 20_000` (`sync.ts:915-926`) — which is why `AWARENESS GAP: 59998ms … source=tick` exists, and it is the line that turned a logging complaint into S71. **Nothing analogous exists for the mute.** `CanvasPersistence` records `muteOpenedAt` (`:271`) and computes `capRemaining` (`:517`) but never reports when the release actually landed. So a 60 s mute and a 250 ms mute are the same observation from outside: silence.

**A telltale here is worth more than the repair**, on the same argument WP91 made for `CAPTURE DECLINED:`: *an unlogged silent discard on a data path is the mechanism by which a data-loss bug becomes undetectable.* AC4 owns it, and it is the criterion that stays valuable if AC2 concludes the lazy release is wrong for some consumer.

#### 3.6 ⚖️ S72 — RULED SEPARATE, and the argument is not "different subsystem"

**S72:** the awareness prune window is `AWARENESS_OUTDATED_TIMEOUT_MS = 30_000` (`sync.ts:81`) against a measured 60 s pulse gap, so under the clamp a live peer can be older than its own prune horizon and pruned as stale. **The arithmetic is correct.** Three measured facts decide the disposition, and none of them is the subsystem boundary:

1. **`sync.ts` already contains a designed mitigation for exactly this clamp, by name.** `:49-65`: *"a fixed period only holds while every tick fires on schedule, and Chromium throttles timers in occluded windows to 1 Hz and then to roughly 1/min. IF a tick were to slip past the 30 s outdated-timeout, every peer would prune this client's awareness state."* The pulse is therefore driven by an **absolute-time deadline** with **two** opportunity kinds, and the second is explicitly not timer-throttled: *"(b) EVERY inbound framed mux message — socket delivery is not timer-throttled, so the first packet after a throttled window is what actually recovers liveness."* **The lazy-release idea WP93 exists to build is already half-built in `sync.ts`.**
2. **And it did not fire.** S71's own evidence line reads `source=tick`, not `source=message` — so during those 60 s **no inbound framed mux message arrived either**. Three explanations are live and **none is measured**: the peer was clamped too and sent nothing; the receiving side's message dispatch is itself queued behind the clamp; or the mux was genuinely idle because nobody was doing anything. **The third is entirely plausible on an idle rig, and if it is the answer then S72's severity is a rendered cursor, not data** — a peer nobody is receiving from is a peer nobody is collaborating with.
3. **So S72 is an open DIAGNOSIS and WP93 is a REPAIR.** Folding them gives WP93 an acceptance criterion that cannot be written until a question outside its scope is answered, and the answer changes the criterion's severity by two orders of magnitude. That is the shape that produced this run's worst outcomes: **two batches "independently reproduced" the falsified logger silence because they inherited a premise instead of measuring it.**

**Ruling: SEPARATE.** WP93 carries S72 as a named non-goal and hands the Dispatcher one concrete question: *does the `source=message` opportunity ever fire during a clamped window, and if not, why?* The instrument to answer it already exists — `emitAwarenessPulse` records `source` on every pulse — so it is a log census over the retained history, not a new build. One correction for the register while this is being read: S71's own history table puts the 40–70 s band at **0.7 %** of pulses, so *"routinely"* in S72's wording is true **inside the clamp regime** and misleading **overall**; 93.5 % of pulses sit in the 8–20 s band, comfortably under 30 s.

- **Interfaces involved:**
  - Input: a mute taken by one of the nine producers in §3.3; the vault event, if any, that consumes the echo it was taken for
  - Output: a release; an overrun count when the release lands past its ceiling
- **Constraints from BUILD_SPEC (invariants — what must not change):**
  - **I11 REFUSAL NEVER DESTROYS** — a release that fires **early** turns a suppressed echo into a re-broadcast and, on A4/A5, into a capture of our own write. **A release that fires late or never is a permanent freeze.** Both directions are data-affecting and AC5 covers both.
  - **I5 DEGRADE** — a mute anomaly is per-path and non-fatal; nothing throws out of a handler; other paths keep syncing.
  - Invariants I1–I5 (`ARCHITECTURE.md`) and I6–I11 (CONCEPT_V2 Teil 3 + §4.6) are binding and must not be weakened.
  - `CanvasPersistence` remains the single CRDT→disk writer. `main.ts` holds wiring only. `canvas-binding.ts` / `canvas-model-bridge.ts` stay frozen and `useCanvasBinding` stays `false`.
  - **Zero new runtime dependencies. No new timing constant except a ceiling derived from an existing one** (WP91's precedent).
  - Do not bump the plugin version. Do not hand-edit `plugin/main.js` or `server/dist/`. `plugin/manifest.json` is a **real file** since `67f1036`.
- **Entry points / relevant files:**
  - `plugin/src/files/file-ops.ts:204-221` — the mute primitives; `:265-277`, `:455-465` — `applyRemoteOpInner`'s take and release
  - `plugin/src/files/vault-events.ts:136-305` — all five Group A gates
  - `plugin/src/files/canvas-persistence.ts:79`, `:490-530` — WP91's capped release, **read-only context, the model, NOT a target**
  - `plugin/src/files/canvas-sync.ts:4100-4126`, `:4288-4308` — P2 and P5, **read-only context, NOT a target**
  - `plugin/src/main.ts:1111`, `:1610`, `:2493`/`:2591`, `:2695`/`:2705` — P6–P9, **release sites; wiring only**
  - `plugin/src/sync/sync.ts:49-81`, `:905-931` — the already-built deadline design and the `AWARENESS GAP:` telltale, **read-only context, OUT of scope**
- **Structure references:** *(intentionally empty — no Graphify graph exists for this project; FALLBACK mode is declared in BUILD_SPEC section 3. Worker 3 fills this in after implementation. Do not invent paths here.)*

If structure references conflict with the BUILD_SPEC or explicit task scope, the BUILD_SPEC and TaskCharter win. Escalate instead of following the map.

---

## 4. Acceptance Criteria

*Each criterion names **the observable that proves it** and **what would make it vacuous**.*

*Acceptance evidence is **visible tests only** plus, for the two rows in §7b, **two LIVE Obsidian instances** driven through the E2E rig — `POST http://127.0.0.1:39431/command` (A) / `:39432` (B). **Blind sets are discontinued** — no `blind_set1`, no `blind_set2`, no `BlindVerificationLedger` row is owed. `canvas.simulateEdit` is **never** called; `canvas.open` is **never** called (**S45**); every leaf is opened with `canvas.typeInNode{open:true}`, empty text, no blur. **Every local edit is driven by writing the file on disk**, which is the live path (`useCanvasBinding` is `false`). **No `data.json` value is read, printed, logged, hashed or fixtured.** **Every live row records the role its instance resumed as** (**S37**) **and the bundle hash** (**S67**, `S57(installer)`). **No absence claim is read from the debug log** unless `tools/e2e/ls_logwait.py` proves the flush past the action window (**S65** — the lag is bimodal, 0.50 s or 60.0 s, and 31 % of measured batches exceeded the old 2.5 s margin). The negative control is `shape="mux"`, never `close` (**S66**). **State is the oracle; signatures are for humans.***

---

1. **THE CENSUS IS CLOSED, DERIVED FROM THE SOURCE, AND EVERY MEMBER HAS A STATED DISPOSITION.**
   - **Why this is AC1 and not a preamble:** the Dispatcher's ruling referred this WP here on the strength of *"five other consumers"*. §3.1 measured **eleven decisions over thirteen calls in two files**, and the six nobody had named are the six most exposed to a release-timing change. **A charter's table is not a census.** The implementor derives its own and reconciles it against §3.1, and a disagreement is a finding.
   - **Deliverable:** a test that derives, from the parsed production tree (`plugin/src/**`, `__tests__` excluded), **every** call site of `isPathMuted` **and every** call site of `unmutePathEvents`, and pins both sets. A new consumer or a new producer cannot join either class unnoticed.
   - **Observable (the consumer set):** the derived consumer set equals §3.1's thirteen calls on the pre-repair tree, and every member carries a **disposition** in the implementation report: *unchanged*, *changed and how*, or *changed and here is what breaks*.
   - **Observable (the producer set):** the derived producer set equals §3.3's nine on the pre-repair tree, and each is marked **capped** or **uncapped**. After the repair, **zero uncapped** — or, for each remaining one, a stated reason.
   - **Observable (the positive control MUST find a known member and MUST exit non-zero on an empty set):** the deriver is pointed at the pre-repair tree and must find `file-ops.ts:219`'s definition and at least one call in **each** of the two files. It **exits non-zero without emitting a census** if its input set is empty — the third-deriver pattern, and **S53**'s recursive trap: WP86's deriver returned an **empty** set and *"every derived site is corrected"* passed perfectly on it.
   - **Vacuity risk — named.** **(a) The killer:** a hand list copied from §3.1 and dressed as a derivation. It cannot catch the fourteenth call site the next WP writes, which is the entire point. The census must be produced by parsing, and the report states the tool. **(b)** A deriver that strips comments and reports twelve rather than thirteen — `vault-events.ts:252` **is** a comment and **must** be excluded, so the report states which of the two behaviours it chose and shows the count either way. WP37 had three tests reddened by an allow-list regex that read comments; the inverse error is available here. **(c)** A census over `plugin/src` that silently includes `plugin/src/testing/` — the rig is not the product; state the exclusion. **(d)** Reporting "eleven decisions" without also reporting "thirteen calls" — the two numbers differ because A3 and B7 each ask twice, and a reader who has only one of them will mis-size the change.

2. **A DECISION, IN WRITING, ON EACH CONSUMER — including the three post-await re-checks, which are the ones the change actually reaches.**
   - **Deliverable:** §3.2's table, produced by the implementor from its own census, with one of three verdicts per row: *the lazy release is correct here*, *the lazy release is correct here only with X*, or *the lazy release must not apply here and the timer stays*. **A uniform answer for all eleven is a finding, not a shortcut — say so and show it.**
   - **Observable (the three hazard rows are driven, not argued):**
     - **A3, the rename:** a remote rename applied under `applyRemoteOpInner`'s mute, with `vault-events.ts:203-226`'s `pendingRename` chain in flight. Assert that the mute is **still held** when `handleRename` runs — or, if the chosen design releases earlier, assert what the chain then does and that it is intended.
     - **A1/A2, create and delete:** an applied `create` and an applied `delete` each release their mute. A design in which either is released only by a `modify` **strands the refcount**, and the test must show the strand exists in that design and does not in the shipped one.
     - **B2/B3/B5, the post-await re-checks:** a mute released **during** the awaited `vault.read` must produce a stated, asserted outcome — either the outbound op is emitted (the re-check now admits) or it is not. Both are defensible; **which one the product does must be a decision and not an accident.**
   - **Observable (the degenerate case, and it is the one that strands):** a write of **byte-identical content**, which `background-sync.ts:487-489` shows produces no vault event at all. The mute must still release, and the test must show it releases **by the ceiling and not by an event** — with a control in which the ceiling is disabled and the mute is shown held forever.
   - **Vacuity risk — named.** **(a)** A table filled in by reasoning with no driven row behind any verdict — every row marked *"the lazy release is correct here"* must have a test that reddens if the release is made incorrect for that consumer specifically. **(b)** The rename row driven with a *local* rename, which takes no mute at all (`onFileRename` is guarded by `isPathMuted`, so an unmuted local rename never exercises the interaction) — it must be a **remote** rename under `applyRemoteOp`. **(c)** The post-await rows driven with a synchronous fake `vault.read`, which removes the await the whole hazard lives in; the fixture's read must be genuinely deferred and the release must be schedulable inside it. **(d)** The degenerate case driven with a write that *does* change bytes, so no event is missing and the ceiling is never the thing that released.

3. **THE RELEASE IS BOUNDED BY SOMETHING A CLAMPED RENDERER CANNOT STRETCH — and the ceiling is explicitly NOT the mechanism.**
   - **The shape, fixed here rather than left to the implementor** (§3.4): release on the **first** of *(the consuming event)* or *(the ceiling)*. The ceiling remains a `setTimeout` and remains clampable; **that is accepted and stated**, because the alternative to a clampable safety net is no safety net. What must change is that the ceiling stops deciding the ordinary case.
   - **Observable (headless, injected scheduler — the clamp is SIMULATED, which is the only way it can be):** with the scheduler's `setTimeout` made to fire at **60 000 ms** for a delay of 250 ms — a fixture that reproduces the clamp's ratio exactly — the mute is nonetheless observed **released** at the consuming event, and the longest continuous muted interval is bounded by the event, not by 60 s. Measured from the recorded `mutePathEvents`/`unmutePathEvents` **call sequence**, never from a constant.
   - **Observable (the control, and this is what makes the row mean anything):** the identical fixture with the event term removed must show the mute held for the **full clamped 60 s**. **A test that passes without ever demonstrating the 60 s failure it prevents is a green that cannot fail.**
   - **Observable (the ceiling still works):** the degenerate no-event case from AC2, under the same clamped scheduler, releases at the clamped ceiling and **the release is counted as an overrun** (AC4). The two criteria meet here deliberately.
   - **Observable (WP91's cap is not weakened):** `MAX_MUTE_MS` is unchanged and `wp91`'s 32 rows across 6 files are green, byte-unmodified.
   - **Vacuity risk — named.** **(a) The C73/WP75 class:** asserting the bound by reading a constant (`expect(VAULT_EVENT_SETTLE_MS).toBe(250)`) is a check on a constant, not a measurement of behaviour. The observable is the call sequence. **(b)** A "clamped scheduler" fixture that clamps a timer nothing under test uses — the fixture must be shown to stretch the **actual** release timer, by demonstrating the pre-repair code holds the mute for 60 s under it. **This is the row that proves the instrument, and WP91's own report records that its instrument could not observe a clamp by construction — do not ship a second one.** **(c)** A wall-clock 60 s sleep instead of an injected scheduler: a 60 s sleeper in the suite is a **worse** liability than the 33.5 s one already there. **(d)** Asserting the bound on `file-ops.ts`'s primitives only, leaving P3–P9's own `setTimeout`s untouched, so eight of the nine producers are unchanged and the measurement moves while the mechanism does not — this is exactly S68's shape and AC1's producer census exists to prevent it.

4. **AN OVERRUN IS COUNTED AND NAMED. This is the criterion that survives AC2 concluding the lazy release is wrong.**
   - **Why this outranks the repair, and say so in the report:** the clamp reached WP91's ceiling and **nothing in the product noticed**. S71 exists because `SyncManager` happens to measure its own pulse gap (`sync.ts:915-926`) and the mute does not. **A mechanism that cannot report that it overran its own stated bound cannot be audited**, and every past measurement of a mute window in this run was taken with no record of which regime the renderer was in — **D3** in the S65 audit says that is undecidable in principle for past runs.
   - **Deliverable:** a read-only accessor on `FileOpsManager` reporting **per-path-class overrun counts** — the number of releases that landed later than their own stated ceiling, and the worst observed overshoot — plus **one** signature with **exactly one** production emitter (§6). Precedent: WP68/WP88's counters in the same file and WP91's `captureDeclines` (`canvas-sync.ts:3151-3162`) — *the counter is the observable; it is state, not a log line, so a test can be an oracle over it.*
   - **Observable (state):** under the clamped-scheduler fixture, the overrun counter advances by **exactly one** per overrun release, the worst-overshoot figure reads ≈ the clamped delay, and **every other counter in the same accessor is asserted unchanged in the same assertion**. Under an unclamped fixture with the same traffic the counter stays **0** — and that zero is admissible **only** because the clamped arm in the same run showed it can be non-zero.
   - **Observable (the counters carry no user data):** path **class** or a count, never file contents, never node text. A count is a diagnostic; a filename here would put user data into a value other components may render — the `readiness.RawAnswer` lesson (**S62**), one subsystem over.
   - **Observable (live, and it is the point of the whole criterion):** on a real instance, over a session long enough to contain a clamp, the counter is **non-zero at least once**, or the report states that no clamp occurred in the observation window **and how it knows** — the `AWARENESS GAP:` pulse-gap telltale is the available cross-check and `tools/e2e/s65_throttle_history.py` already computes it.
   - **Vacuity risk — named.** **(a) The trap this AC sets for itself:** after AC3 lands, an overrun in the ordinary case becomes unreachable, so *"zero overruns"* is **true for free** — the exact shape of B44's `[06] B: node gone`. This AC therefore asserts a **positive non-zero** under the clamped fixture as its primary observable and asserts **no zero anywhere** as evidence of the fix. **(b)** A counter incremented on a branch no test reaches: each producer class that can overrun needs its own driving fixture, and a class with no fixture is removed rather than left as decoration. **(c)** The overrun asserted from the debug log — under **S65** a zero-line read is not an absence, and a signature with zero historical hits is `UNINFORMATIVE`, never `ABSENT`. **Absence claims about the log are not accepted as evidence for this AC at all; the counters are.** **(d)** The live arm reported as satisfied because a clamp *probably* occurred — the clamp is a **0.7 % tail** and the report must show the telltale, not assume the tail.

5. **NO COLLATERAL, IN BOTH DIRECTIONS — an early release and a stranded release are both data-affecting.**
   - **Observable (behavioural, in the same run, not a diff reading):** each of §3.1's eleven decisions is driven and shown to behave as its AC2 disposition says — a remote file-op applied under `applyRemoteOp`'s mute emits **no** outbound file-op; a muted `.md` write does **not** reach `handleLocalTextModify`; a muted `create`/`delete`/`rename` is still suppressed at A1/A2/A3; the host's manifest arms behind A1/A2/A5 behave as before; and B1–B7 still refuse the outbound push for a path we are applying. Each with its pre-existing test **unmodified** and green.
   - **Observable (the strand, asserted positively and not by absence):** after every driven scenario, `isPathMuted(path)` reads **`false`** and the refcount is **0** for every path touched. `w4-canvas-integrity.test.ts` already carries this shape at `:600`, `:623`, `:647`, `:651`, `:678` and `:1460` — those assertions stay byte-unmodified and green. **A change that strands a mute count is a permanent silent freeze of that path: this WP's own defect with an infinite window.**
   - **Observable (the ownership predicate survives):** `vault-events.ts:243-281`'s WP6/US5 discipline — **one** ownership predicate, evaluated **once** per event, with the text path structurally unreachable for a canvas-owned path — holds after any reordering. A change that lets a canvas-owned path fall through to `handleLocalTextModify` re-creates the two-writer race and is an **abort criterion**.
   - **Observable (WP91's landed shape survives):** the canvas branch at `vault-events.ts:249-280` still does **not** consult the mute; `canvas-sync.ts:3239`'s byte breaker is byte-unchanged; `wp91/**` is green byte-unmodified. **Putting the mute back in front of the canvas capture is an abort criterion**, whatever it does for a ceiling.
   - **Observable (structural):** `plugin/src/files/canvas-sync.ts`, `plugin/src/files/canvas-persistence.ts`, `plugin/src/sync/sync.ts`, `plugin/src/sync/control-handlers.ts`, `plugin/src/files/canvas-sidecar.ts` and `server/**` are **not in this WP's diff at all** — asserted by running the diff, not by prose. `canvas-sidecar.ts` is **uncommitted under a sibling batch** and a WP93 line in it is unattributable by construction.
   - **Vacuity risk — named.** **(a)** "Unchanged" asserted by reading the diff rather than running one. **(b)** A full-suite green quoted in place of naming the affected test files and their counts — a suite green hides a file quietly edited to stay green. **(c)** The eleven behaviours driven on a harness that never takes a mute, so all eleven are true of the unmuted case: the mute refcount must be asserted **`> 0` at the instant of the event** in each, and that assertion must be shown to fail if the mute-acquire is removed from the fixture. **(d)** Attributing a red to a sibling batch without measuring it — **B50 is live**, and §5's concurrent-batch attribution rule applies.

**Definition of Done:** an echo-suppression window ends when the echo it was taken for arrives, not when a clock the host is free to stretch says so; the ceiling is the safety net rather than the mechanism; and a window that overruns its own stated bound is counted and named instead of being visible only to whoever happened to be watching.

---

## 5. Constraints and Known Risks

- **Permission / environment limits:** Windows dev host; run all plugin commands from `plugin/` (never the repo root). Runner is Vitest 4.0.18 — the `basic` reporter was removed, use the default or `--reporter=dot`. Budget **≥90 s** for any automated `npm test` (a deliberate 33.5 s sleeper in `wp5/latency.test.ts` makes ≈41 s the floor, not a hang). No Graphify graph exists (declared FALLBACK mode); `workflowArtifacts/RepoMap.md` is the structural map.
- **🚨 RULE 14 — the working tree is shared.** `git status` before **every** stage and **every** commit, not earlier in the turn. Stage **explicit paths only**. Never `git checkout --`, `git restore`, `git stash` or any revert on a path you did not create in this batch; the instrument for a parked baseline is a **detached worktree**. **S34**: a sibling reverted `main.ts` between WP81's edit and its stage and it was caught only by the before-commit check. **`plugin/src/files/canvas-sidecar.ts` is uncommitted at chartering time and B50 is running live E2E against both instances.**
- **⚠ The "five other consumers" figure you were handed is right for one file and wrong as a closed set.** §3.1 derived eleven decisions over thirteen calls, and WP91's list double-counted a producer as a consumer. **Do not scope from the number; scope from your own census.** If your census disagrees with §3.1, that is a finding worth more than agreement — report it with its tool and its control.
- **The most likely wrong answer is a smaller number.** Lowering `VAULT_EVENT_SETTLE_MS`, or lowering `MAX_MUTE_MS`, makes every unclamped measurement improve and does **nothing** under a clamp, because the clamp multiplies whatever the number is. **An implementation that changes only timing constants FAILS this charter, whatever any ladder measures** — WP91's identical constraint, for the identical reason.
- **The second most likely is a purely lazy release**, which strands the refcount (§3.4) and produces a **permanent** silent freeze. AC2's degenerate case and AC5's refcount-zero assertions exist for it, and the existing `w4-canvas-integrity.test.ts` rows are the pre-existing oracle.
- **The third is a sweeper.** "Clear mutes older than N" re-introduces a clock as the authority and is the defect one layer out. **Forbidden.** The ceiling in AC3 is per-mute and derived from an existing constant; a global periodic sweep is not.
- **The fourth is flipping `useCanvasBinding`.** It would route capture off the file path and make one symptom disappear without touching the mechanism, in a subsystem frozen until P5. **Abort criterion.**
- **The instrument problem is this WP's central risk, and WP91 already hit it.** WP91's report records that its instrument is a virtual clock and **cannot observe a host clamp by construction**. AC3 answers that with a scheduler fixture whose `setTimeout` fires at 60 000 ms for a 250 ms delay — a **simulation**, honestly labelled. **It is not evidence that the product survives a real clamp; it is evidence that the product's behaviour does not depend on the timer.** Say that in the report rather than letting a reader upgrade it.
- **S74 makes the gate figure unquotable without a caveat.** `wp5/latency.test.ts` US6 AC1 asserts a wall-clock RTT band (50–150 ms) while 364 files run in parallel: **fails 2 of 3 full-suite runs**, green 11/11 in isolation, **pre-existing**, flagged independently by two batches. Name it; do not report it as this WP's, and do not let it cover a genuine red.
- **S67 and `S57(installer)` govern every live row.** The repo's committed `plugin/main.js` is **not** the installed bundle (`85a29c85` vs `b672be50`); running the installer without `LS_EXPECT_SHA256` silently changes the code under measurement, and installed bytes are not loaded bytes. **State the bundle hash and grep the installed bytes for a marker unique to this batch's change.**
- **S65 governs every log-based claim.** The lag is **bimodal — 0.50 s or 60.0 s** — and 31 % of measured batches exceeded the old 2.5 s margin. Use `tools/e2e/ls_logwait.py`, which raises `FlushNotProven` rather than returning an empty list.
- **S66 governs the negative control:** `shape="mux"`, never `close` — a run scored 29/29 with the link nominally severed under `close`.
- **Verification must be by targeted injection of this WP's own class.** A green is worth nothing unless removing the change reddens a test **on its own named assertion**. Two classes apply most directly here: a clamped-scheduler fixture that does not actually clamp the timer under test (AC3(b)), and an overrun counter asserted at zero (AC4(a)).
- **Known flaky patterns:**
  - **No wall-clock sleeps in new tests**, and emphatically no 60 s one. Use the injected scheduler / fake timers.
  - Do not assert on log strings as the primary oracle; state is the oracle, signatures are for humans.
  - Never reason from two peers only where a third would behave differently.
  - Biome reports a whole-file `format` finding per touched file (CRLF environment artefact). Advisory locally, gating in CI — do not mass-reformat.
- **Hard constraints:**
  - Invariants I1–I5 and I6–I11 are binding; **I11 is an acceptance criterion, not advice**, and it binds in **both** directions here.
  - `plugin/src/files/canvas-sync.ts`, `plugin/src/files/canvas-persistence.ts`, `plugin/src/sync/sync.ts`, `plugin/src/sync/control-handlers.ts`, `plugin/src/files/canvas-sidecar.ts` and `server/**` are **not modified by this WP**. If implementation appears to require it, **ESCALATE**.
  - No existing test is deleted, weakened, retitled, skipped or amended. **WP93 holds no §7 licence of any class**, and an unenumerated deletion or assertion rewrite is an abort criterion. `wp91/**` and `w4-canvas-integrity.test.ts` in particular are the pre-existing oracles for this change.
  - `isPathMuted` keeps **one** definer (rule 10). A second mute predicate is an abort criterion.

### Recorded, not repaired — this WP's own sweep

1. **`BackgroundSync`'s own 250 ms disk-write window** (`vault-events.ts:242`, `backgroundSync.isRecentDiskWrite`) — **S75(a)**, still ahead of the ownership predicate, reachable only in the ≤250 ms text→canvas handover. Named in neither WP91's charter nor its §9 row. Not repaired here; it is a `background-sync.ts` timer and this WP's surface is the mute.
2. **`canvas-sync.ts:4288-4308`, the retired seed writer's uncapped 250 ms timer** — **S75(b)**. It is P5 in §3.3 and it is `canvas-sync.ts`, which is out of scope. **It is the clearest single instance of the problem this WP describes and it is deliberately not in the diff.** Carried up.
3. **S72**, ruled separate in §3.6 with a concrete question attached for the Dispatcher.
4. **The clamp's cause is undetermined** and this WP does not determine it (§2).
5. **No production code records which throttle regime a measurement was taken in.** The S65 audit's **D3** calls this undecidable in principle for past runs. AC4's counter is the first thing in the product that would let a *future* measurement say. That is a side effect worth naming, because it means every measured window in this run — including WP91's 750 ms — is quoted without its regime.

---

## 6. Definition of Done Artifacts

- **Required changed files:**
  - `plugin/src/files/file-ops.ts`
  - `plugin/src/files/vault-events.ts` (only if the release needs a consumption signal; AC5 governs)
  - `plugin/src/main.ts` (wiring only)
  - `plugin/src/__tests__/v2/wp93/**` — **new**
- **Explicitly NOT changed:** `plugin/src/files/canvas-sync.ts`, `plugin/src/files/canvas-persistence.ts`, `plugin/src/files/background-sync.ts`, `plugin/src/files/canvas-sidecar.ts`, `plugin/src/sync/sync.ts`, `plugin/src/sync/control-handlers.ts`, `plugin/src/debug-logger.ts`, `plugin/src/canvas/**`, `server/**`.
- **Required report:** `ImplementationReport_WP93.md` (in `workflowArtifacts/canvas-v2/`), containing: **the derived consumer census and the derived producer census, both with their tool and both halves of their positive control**, and an explicit reconciliation against §3.1/§3.3 with any disagreement named; **AC2's per-consumer disposition table**, produced from that census, with the driven row behind each verdict; **the decision on the three post-await re-checks in one sentence each**; the per-AC falsification (change neutralised → which test reddens, on which **named** assertion, and whether any neighbouring pre-existing oracle also reddened); **AC3's clamped-scheduler control shown holding the mute for the full 60 s on the pre-repair code**, without which the row means nothing; AC4's overrun counters with the clamped arm non-zero and the unclamped arm zero **in the same run**; the live rows with the bundle hash, the resumed role, the pulse-gap telltale for the observation window, and every SKIP carrying its reason; a positive statement that `wp91/**` and `w4-canvas-integrity.test.ts` are byte-unmodified and green; the before/after full-suite counts with every failure attributed by owner and **S74** named; the artefact sweep count; a data-safety statement; **an explicit statement that the clamped scheduler is a SIMULATION and what it does and does not prove**; and the statement that no existing test was deleted, weakened, retitled, skipped or amended and that **no §7 licence of any class was taken**.

### Proposed for the Dispatcher to land — this charter does not edit `BUILD_SPEC_CanvasV2.md`

- **Proposed signature (BUILD_SPEC §10 row).** §10's rule is that every declared signature has exactly one production emitter; **`SEED REFUSAL STORE:` was emitting unregistered until B45 caught it**, and this WP must not repeat that.

  | Signature | Status | Owner |
  |---|---|---|
  | `MUTE OVERRUN:` | new | WP93 — one emitter in `files/file-ops.ts`; a path mute released later than its own stated ceiling, with the ceiling, the measured interval and the running count |

  Format: `MUTE OVERRUN: <pathClass> held=<n>ms ceiling=<n>ms (overruns=<n>)`. **Path CLASS and durations only — never the path itself, never file contents, never node text.** A count is a diagnostic and a filename here would put user data into a value other components may render. The name is deliberately *overrun* rather than *clamp*: the emitter measures that its own bound was exceeded, which is a fact it can establish; **attributing that to a host clamp is an inference it cannot make**, and a signature that asserted the cause would be a claim the product cannot support.

- **Proposed §9 row:**

  | WP | Phase | Title | Scope summary | Depends on | Status |
  |---|---|---|---|---|---|
  | **WP93** | **P0** | **A ceiling enforced by a timer is not a ceiling on a platform that clamps timers** | **S71**: the renderer's timers are clamped to **60.00 s ± 0.02**, measured, with two independent timers in two independent modules (`FLUSH_DELAY_MS = 500` and `SyncManager`'s `setInterval(4000)`) stretched simultaneously to a whole minute — a host wake-up clamp, not I/O — at **0.7 % of 18 600 pulses**, a fat tail rather than the steady state. **WP91 capped its two settle windows at a measured 750 ms and recorded that its instrument is a virtual clock that cannot observe a clamp by construction.** Scope: **the census closed and DERIVED FROM THE SOURCE** — the *"five other consumers"* figure is right for `vault-events.ts` (`:140` create, `:173` delete, `:196`+`:197` rename, `:282` text, `:292` binary) and **wrong as a closed set**: `file-ops.ts` holds **seven more calls in four methods** (`:469`, `:514`, `:522`, `:537`, `:548`, `:575`, `:587`) that no document in this run names, **three of them post-await re-checks** that a release-timing change reaches and a timer does not; and WP91's own list **double-counted** `applyRemoteOp` (a PRODUCER, `:276` take / `:460-464` release) as a consumer and counted the manifest arm separately when it sits behind the same binary gate. **True census: eleven decisions, thirteen calls, two files.** · **the producer side counted for the first time: NINE release sites, ALL `setTimeout`, SEVEN uncapped** (`file-ops.ts:462`, `background-sync.ts:502`, `canvas-sync.ts:4304`, `main.ts:1120`/`:1615`/`:2591`/`:2705`, against WP91's two capped ones) — the count went 2 → 9 by running one grep, the same way S75's went 3 → 5 · **the lazy release as an INVERSION, not a replacement**: release on the first of *(the consuming event)* or *(the ceiling)*, because a byte-identical write emits **no vault event at all** (`background-sync.ts:487-489`) and three of the five `vault-events.ts` gates are armed for `create`/`delete`/`rename` events a `modify`-keyed release would never see — a purely lazy release **strands the refcount**, which is a **permanent** silent freeze of that path, this WP's own defect with an infinite window · **an overrun COUNTED and NAMED** under a new `MUTE OVERRUN:` signature, because the clamp reached WP91's ceiling and nothing in the product noticed — `SyncManager` measures its own pulse gap and is why S71 was findable; the mute measures nothing · every clamped row proven by a control showing the **pre-repair** code held the mute for the full 60 s under the same fixture. **An implementation that changes only timing constants FAILS, whatever any ladder measures.** **`canvas-sync.ts`, `canvas-persistence.ts` and `sync.ts` out of scope; WP91's `MAX_MUTE_MS`, its byte breaker at `canvas-sync.ts:3239` and the canvas branch's non-consultation of the mute are all untouched — putting the mute back in front of canvas capture is an abort criterion.** **S72 RULED SEPARATE** — `sync.ts:49-65` already implements the same event-driven mitigation and it did **not** fire (`source=tick`, never `source=message`), so S72 is an undiagnosed question rather than a repair, and folding it would give this WP an AC that cannot be written. | **WP91 (`DONE`), WP68 (`DONE`), WP6/US5** | **planned** |

- **Proposed header arithmetic.** Current: **90 live (WP1–WP83, WP85–WP91; WP84 withdrawn, counted zero, number not re-used)**. **90 + WP92 + WP93 = 92 live (WP1–WP83, WP85–WP93).** A simple range extension: nothing withdrawn, split or renumbered, and WP84's withdrawn row still counts zero. *(WP92 and WP93 are chartered together in B51 and propose one shared arithmetic; entering only one of them gives 91.)*

- **Question referred to the Dispatcher, not a signal and not this WP's:** **S72's mitigation exists and did not fire, and nobody has asked why.** `sync.ts:49-65` documents the clamp by name and drives the awareness pulse from an absolute-time deadline with two opportunity kinds, the second being *"EVERY inbound framed mux message — socket delivery is not timer-throttled"*. **S71's own evidence line reads `source=tick`.** So during a 60 s clamped window **no inbound framed mux message arrived either**, and three explanations are live and unmeasured: the peer was clamped too; the receiving side's message dispatch is itself queued; or the mux was genuinely idle. **The third would reduce S72's severity to a rendered cursor.** The instrument to decide it already exists — `emitAwarenessPulse` stamps `source` on every pulse and `tools/e2e/s65_throttle_history.py` already walks the retained log — so this is a census, not a build. **Recommend chartering S72 only after that census.** One correction while this is read: S71's history table puts the 40–70 s band at **0.7 %** and the 8–20 s band at **93.5 %**, so S72's *"routinely"* is true inside the clamp regime and misleading overall.

- **BUILD_SPEC §5 component:** **C93** is proposed by the §9 row above and by §4's criteria. The Dispatcher writes it.

- **Gate status required at handover:** `tsc -noEmit -skipLibCheck` exit 0 · `npm test` from `plugin/` with the executed count recorded and every failure attributed by owner (**S74** named) · `npm run build`'s esbuild half **only when `plugin/src/**` is quiet** — it overwrites the shared, gitignored `plugin/main.js` and a sibling's bundle has already been destroyed that way once. **B50 is live at chartering time; check the batch table before building.**

---

## 7. Visible Test Cases / Producer Artifacts

*Empty — filled by Worker 3's producer sub-agent. Worker 2 does not generate tests.*

*⚠ **Blind sets are discontinued for new work** (owner's instruction, 2026-08-05): no `blind_set1`, no `blind_set2`, no falsification-injection requirement and no `BlindVerificationLedger` row is owed by this WP. Validation is W4 against two live Obsidian instances. E2E-plugin defects found while validating go back to **W3 as a revision**.*

---

## 7b. W4 Test Targets (filled by Worker 3's Unit Test Sub-Agent, if any)

**Two criteria carry a live arm that no unit seam can settle.** Everything else in §4 is decidable headless: `FileOpsManager` takes an injected sender and vault, `vault-events.ts`'s handlers are registered against a fake plugin, and the clamp is reproduced by an injected scheduler.

1. **AC4's live overrun counter.** On a real instance, over a session long enough to contain a clamp, the overrun counter must be observed **non-zero at least once** — because a headless fixture is exactly where this instrument is most likely to be arranged trivially. If no clamp occurs in the window, the row states so **and shows how it knows**, using the `AWARENESS GAP:` pulse-gap telltale (`tools/e2e/s65_throttle_history.py`) as the cross-check. **A live run in which no overrun is ever counted has not demonstrated that the instrument is wired**; it has demonstrated that the tail is 0.7 %.
2. **AC5's no-collateral arm on the five `vault-events.ts` gates, in the real editor.** A remote create, a remote delete, a remote rename and a remote binary modify, each applied while the local user is idle, must produce **no** outbound echo and must leave `isPathMuted` **false** afterwards. This is the arm a headless harness can satisfy without ever exercising Obsidian's real event ordering, and A3's `pendingRename` chain is the specific thing no fake reproduces faithfully.

**Constraints on every live row:** the bundle hash is stated (**S67**, `S57(installer)`) and the installed bytes are grepped for a marker unique to this batch's change; the instance's resumed role is quoted from its own `[session] resuming as …` line (**S37**); the negative control is `shape="mux"` and never `close` (**S66**); no absence claim is read from the debug log without `ls_logwait.py` proving the flush (**S65**); per-run ids and `reset_canvas()` are mandatory; `canvas.simulateEdit` and `canvas.open` are never called; and no `data.json` **value** is read, printed or fixtured. **No sibling live suite may be in flight** — two suites against one instance pair do not compose, and the loser is recorded as a product failure.

---

## 8. Autonomous Execution Plan (filled by Coder Sub-Agent, attempt 1)

*Empty at handover.*

---

## 9. Handover Summary (filled by Coder Sub-Agent on completion)

*Empty at handover.*

---

## 10. Risk Notes for Worker 4 (filled by Worker 3 Core)

*Empty at handover.*
