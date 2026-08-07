# Implementation Report — WP93: a ceiling enforced by a timer is not a ceiling on a platform that clamps timers

**Batch:** B53 · **Worker 3 (Execution)** · **Branch:** `fix-bugs-and-raceconditions`
**Charter:** `TaskCharter_WP93_ACeilingEnforcedByATimerIsNotACeiling.md` (chartered at `47231dc`)
**Pre-repair baseline:** `e1cbf69d128f714e6c5311e2a8b9b039401f9458` — every "before" figure in this report is measured against that commit and every line number is re-measured against the working tree at commit time (rule 5).

> **⚠ HEAD MOVED UNDER THIS BATCH.** At start-of-work HEAD was `e1cbf69`. Three sibling commits landed during execution — `dc0c333` (spec), `e64678f` (**S74's US6 AC1 row repaired**), `1fa5131` (`fileop-inject.test.ts` + `testing/e2e-control.ts`). None of them touches this work package's three production files; the overlap check is `git log --oneline e1cbf69..HEAD --stat`, run before staging. The consequence for the gate figure is in §8.

---

## 1. What changed

Three production files, which is the maximum §2 allows.

| File | What | Re-measured anchors |
|---|---|---|
| `plugin/src/files/file-ops.ts` | the inversion + the telltale + the post-await decision | `armMuteRelease` `:397` · `noteVaultEvent` `:434` · `getMuteReleaseStats` `:457` · `muteClass` `:483` · `completeMuteRelease` `:488` (the ONE release, `:515`) · `beginOutboundRead` `:519` · `consumingEventsFor` `:536` · `setLogger` `:225` · the `MUTE OVERRUN:` emitter `:508` · P3's arm `:807` · the three re-checks `:862`, `:870`, `:900` |
| `plugin/src/files/vault-events.ts` | the consumption signal at the five gates | `noteMuteConsumed` `:142` · A1 `:172` · A2 `:208` · A3 `:234`+`:235` · A4 `:325` · A5 `:338` |
| `plugin/src/main.ts` | wiring only — four release sites + the logger | P6 `:1123` · P7 `:1625` · P8 `:2609` · P9 `:2726` · `setLogger` wiring `:1270` |

Plus **new**: `plugin/src/__tests__/v2/wp93/**` — 5 visible test files, 36 rows, plus `census.ts` (the deriver) and `harness.ts` (the fixtures).

### The shape, in one paragraph

The mute is released on the **first** of *(the consuming vault event)* or *(the stated ceiling)*. The event is the mechanism; the ceiling is the safety net. `VAULT_EVENT_SETTLE_MS` (250) is unchanged and is now the *stated ceiling* rather than the *decision*. **No timing constant was changed and no new one was introduced** — the charter's stated failure mode ("an implementation that changes only timing constants FAILS") is avoided by changing nothing numeric at all.

**The ceiling is still a `setTimeout` and is still clampable. That is accepted and stated**, because the alternative to a clampable safety net is no safety net; what changed is that it no longer decides the ordinary case. A release that lands past its own ceiling is counted (`getMuteReleaseStats`) and named (`MUTE OVERRUN:`).

---

## 2. AC1 — the census, derived, with both controls

**Tool:** `plugin/src/__tests__/v2/wp93/census.ts`. It walks `plugin/src` on disk, **strips comments**, and extracts call sites by parse. It is not a grep over the charter's table; the pinned arrays in `test_tp01` are the *expected value* of the derivation, not its input.

**Exclusion, stated (AC1(c)):** `plugin/src/testing/` — the E2E control server, `define`-folded out of the production bundle. `census.excludedFiles` **reports** it (`testing/canvas-node-editor.ts`, `testing/e2e-control.ts`) rather than dropping it silently. 63 files counted. This matters more than it did at charter time: sibling commit `1fa5131` added 413 lines to `testing/e2e-control.ts` including **three `isPathMuted` references** (`:1467`, `:1783`, `:1785`) — a census that did not state this exclusion would have reported 17 consumer sites and been wrong in a way nobody would have caught.

**Comment behaviour, stated (AC1(b)):** derived over comment-stripped code, so `vault-events.ts`'s WP91 comment naming `isPathMuted` is **excluded**. `rawOccurrences` reports the un-stripped count beside it. Both numbers are asserted.

### 2.1 Consumers — and the census disagrees with the charter, twice

| | charter | **derived (pre-repair `e1cbf69` AND post-repair, identical)** |
|---|---|---|
| grep lines | 14 ("one definition and THIRTEEN call sites") | **15** (1 definition + 13 call lines + 1 comment) |
| calls | 13 | **14** |
| call lines | — | 13 |
| files | 2 | 2 |

**Disagreement 1 — thirteen is a count of grep LINES, not of calls.** `file-ops.ts:939` spells

```ts
if (this.isPathMuted(localNew) || this.isPathMuted(localOld) || !this.sendOp) return;
```

which is **one line and two calls**. The charter names that double-ask ("A3 and B7 each ask twice") but does not add it, because A3's two calls fall on two lines (grep sees both) and B7's two fall on one (grep sees one). The true call count is **fourteen**.

**Disagreement 2 — the charter's own arithmetic does not match its own table.** §3.1 lists **B1–B7, seven rows**, then says "Five in `vault-events.ts` and six in `file-ops.ts`" to reach eleven decisions. 5 + 7 = **12**. The derived per-line decision count is **13** (the `vault-events.ts` rename gate is one decision spanning two lines, which the deriver counts as two).

**None of this changes the scope.** The 14 calls are in the 2 files the charter names, at the 13 lines it names. The corrections are to the *arithmetic*, and they matter only because "eleven" and "thirteen" were being quoted as the size of the change.

### 2.2 Producers — and the census finds one nobody has counted

**⚠ FINDING — `plugin/src/files/manifest.ts:519` is a tenth release site, uncapped, and no document in this run names it.**

`ManifestManager.syncFromManifest(mute, unmute, requestBinaryFile, opts)` takes the release as an **injected callback**:

```
manifest.ts:510   mute?.(diskPath);
manifest.ts:518   if (unmute) {
manifest.ts:519     setTimeout(() => unmute(diskPath), VAULT_EVENT_SETTLE_MS);
```

`main.ts:850-851` supplies the two delegates, and `syncFromManifest` is called from **six** `main.ts` sites (`:1155`, `:1443`, `:1723`, `:1760`, `:3461`, `:3477`) — join, resume, reconnect ×2, role demotion, reload-from-host. Under a clamp every one of those holds a mute for ~60 s, on the join path, which is exactly when a peer is applying the most files.

**`grep -rn "unmutePathEvents"` cannot see it**, because the callee is named `unmute` at the call site. That is the same lesson as the charter's own "the count went 2 → 9 by running one grep", one level deeper: **it goes to 10 by following the delegate**, and the only reason it was found is that AC1 required a parse rather than a grep.

**Second correction: the charter's P2 is not a mute release at all.** `canvas-sync.ts:4110-4126`'s `setTimeout` releases `recentDiskWrites`, not the mute. So the charter's nine is **eight real mute releases plus one mis-classification**, and the real pre-repair figure is **nine**, of which eight were the charter's and the ninth is `manifest.ts`.

### 2.3 Producer dispositions — every member marked, every remaining one with a reason

| # | site (re-measured) | before | after | disposition |
|---|---|---|---|---|
| **P3** | `file-ops.ts:807` (`applyRemoteOpInner` `finally`) | bare `setTimeout(250)` | `armMuteRelease` | **capped + event-driven** |
| **P6** | `main.ts:1123` (manifest-driven rename) | bare `setTimeout(250)`, two calls | `armMuteRelease([old,new], {consumes:["rename"]})` | **capped + event-driven** |
| **P7** | `main.ts:1625` (`cleanupStaleFiles` trash loop) | bare `setTimeout(250)` | `armMuteRelease(path, {consumes:["delete"]})` | **capped + event-driven** |
| **P8** | `main.ts:2609` (`reconcileLiveCanvas`) | bare `setTimeout(250)` | `armMuteRelease(path, {consumes:["modify","create"]})` | **capped**; event term inert for a *canvas-owned* path — see §4 |
| **P9** | `main.ts:2726` (`releaseHeldCanvasWrite`) | bare `setTimeout(250)` | `armMuteRelease(path, {consumes:["modify","create"]})` | **capped**; same caveat |
| **P1** | `canvas-persistence.ts:529`, armed at `:519` | capped at `MAX_MUTE_MS` 750 (WP91) | **untouched** | **capped already.** WP91 landed it three commits before the charter; §2 forbids changing it. Its cap is now a floor rather than the mechanism for non-canvas paths and **it is left standing** — a cap that is now a floor is still a cap. |
| **P4** | `background-sync.ts:502` | bare `setTimeout(250)` | **untouched** | **still uncapped.** §6 lists `background-sync.ts` under *Explicitly NOT changed*. Repairing it here would be an ESCALATE. |
| **P5** | `canvas-sync.ts:4304` | bare `setTimeout(250)` | **untouched** | **still uncapped.** §6 forbids `canvas-sync.ts`; already carried up as **S75(b)**. |
| **P10** | `manifest.ts:519` | bare `setTimeout(250)` | **untouched** | **still uncapped, and NEW.** Repairing it needs a **fourth** production file and §2 caps this work package at three. **RECORDED, NOT REPAIRED** — see §9. |

`test_tp03` **T4** asserts this table mechanically: it derives the release sites, filters those still spelling `setTimeout`, and requires the residue to equal exactly `{files/manifest.ts}` with a written reason of >80 characters. P4 and P5 do not appear there because they call `unmutePathEvents` *inside* their own timers rather than wrapping it — they are still uncapped and are reported here rather than by that assertion.

**Positive control (AC1, S53):** `deriveCensus(new Map())` **throws** rather than emitting an empty census, and so does a tree with files but no definition. WP86's deriver returned an empty set and "every derived site is corrected" passed perfectly on it. Both halves are `test_tp01` T3, and both were seen red (breaks **B9**, **B9b**).

---

## 3. AC2 — the disposition per consumer, with the driven row behind each verdict

| consumer | verdict | driven by |
|---|---|---|
| **A1** create | **the lazy release is correct here, and only because the release is keyed per op type.** `applyRemoteOpInner` arms `["create","modify"]` — a `create` whose target exists is applied with `vault.modify`. A `modify`-keyed release would never fire for a fresh create. | tp02 **T1**, **T1b** |
| **A2** delete | **correct.** Arms `["delete"]`. A delete whose target did not exist emits nothing — the ceiling case. | tp02 **T2**, **T6** |
| **A3** rename | **correct, with one thing stated.** The charter's mid-teardown fear does not arise: `vault-events.ts`'s rename gate returns *before* `renamedPaths.add`, so `onFileRename`, `cancelSubscribe`, `onFileRenamed`, `renameFile` and `handleRename` are all **downstream of the gate**, not downstream of the release. Under a mute the `pendingRename` chain **never starts**, so there is no window to lift the mute inside of. One event consumes two armed releases (both endpoints). | tp02 **T3** — a **remote** rename under `applyRemoteOp`, never a local one (AC2(b)) |
| **A4** text modify | **correct.** The clean case. | tp02 **T4** |
| **A5** binary modify | **correct.** Same shape. | tp02 **T4** |
| **B1, B4, B6, B7** entry checks | **unchanged, and unreachable by a release-timing change** — they run before any await. | tp05 **T2** |
| **B2, B3, B5** post-await re-checks | **changed. See below.** | tp02 **T5**, **T5b** |
| *canvas-owned `.canvas` modify* | **no disposition, deliberately** — see §4. | tp05 **T6** |

**A uniform answer for all of them would have been a finding, and it is not uniform:** A1/A2/A3 need per-op-type keying, A3 needs both endpoints, B1/B4/B6/B7 are untouched, B2/B3/B5 changed semantics, and the canvas branch is deliberately excluded.

### The three post-await re-checks — one sentence each

- **B2** (`file-ops.ts:862`, `onFileCreate` after `await vault.readBinary`) — **refuses if the path was muted at any point during the read**, not merely if it is still muted when the read returns.
- **B3** (`:870`, `onFileCreate` after `await vault.read`) — same.
- **B5** (`:900`, `onFileModify` after `await vault.readBinary`) — same.

**The reason, one sentence:** a mute taken *and released* inside the read window means a remote apply landed on this path while we were reading it, so the bytes in hand are the bytes we just applied and emitting them re-broadcasts our own apply.

**Why it had to change at all:** before WP93 the 250 ms timer outlived essentially every read, so the entry check and the re-check agreed by accident of timer length. An event-driven release removes that guarantee — the release can now fire *because of the very event the read is racing* — so the two genuinely disagree. The charter required this to be a decision and not an accident; the decision is *refuse*, and it is implemented as an interval property (`OutboundRead.mutedDuringRead`, set by `mutePathEvents` at `:354`) rather than an instant one, which makes it immune to release timing **in both directions**.

**The fixture is a genuinely deferred read (AC2(c)):** `harness.deferReads(path)` parks `vault.read` on a promise the test resolves by hand. A synchronous fake read would remove the await the whole hazard lives in.

### The degenerate case (AC2's strand row)

`test_tp02` **T6** drives an applied `delete` of a path that does not exist — `applyRemoteOpInner`'s delete branch calls no vault method, so **no event exists by construction** (asserted: `pendingVaultEvents` is empty). The mute is released **by the ceiling**, `releasedByCeiling: 1`, `releasedByEvent: 0`.

**T6b is the control the charter asked for:** the same mute with the ceiling pushed out of reach is **held forever** — ten minutes of simulated time, still muted, `pending: 1`. That is what a *purely* lazy release does, and it is why WP93 is an inversion rather than a replacement.

> One thing this control taught: the first version used `Number.MAX_SAFE_INTEGER` as the "never" ceiling. A `setTimeout` delay above 2³¹−1 **overflows and is silently clamped to 1 ms**, so the "never" timer fired immediately and the control was green for the wrong reason. It is now `2 ** 31 - 1`, with the reason in the file.

---

## 4. The canvas branch — stated, not discovered in code

**WP91's non-consultation of the mute on the canvas path is intact and the canvas branch is byte-unchanged.** `test_tp05` **T6** extracts the ownership branch from the source and asserts it contains **no** `isPathMuted` and **no** `noteMuteConsumed`. Break **B7** (putting a mute check back) reddens it by name.

The consequence, stated because it is a real limit and not an oversight: a **canvas-owned** `modify` returns through WP91's branch, which does not consult the mute, so it **reports no consumption**. Therefore:

- `CanvasPersistence`'s mute (P1) keeps WP91's `MAX_MUTE_MS` cap and is unaffected by WP93 — correct, since it already had a measured ceiling;
- P8's and P9's mutes on a canvas-owned path are released **by the ceiling**, exactly as before WP93.

Adding a consumption signal there would be adding something mute-shaped in front of canvas capture, which §2 makes an abort criterion. The event term is therefore **inert for canvas-owned paths and live for every other path**, which is the honest description.

---

## 5. AC3 — and the proof that the fixture holds the mute ~60 s on pre-repair code

### ⚠ What the clamped scheduler is and is not evidence of

**It is a SIMULATION.** It is **not** evidence that the product survives a real Chromium wake-up clamp; it is evidence that **the product's behaviour does not depend on the timer**. WP91's report records that its instrument was a virtual clock that could not observe a clamp by construction. Nobody may upgrade this reading, and `test_tp03`'s header says so in the file rather than only here.

### The instrument is proven — `test_tp03` T0

This is the row the charter said not to ship without, and it does three things:

1. **The replica is the committed pre-repair source, not a paraphrase.** The test reads `git show e1cbf69:plugin/src/files/file-ops.ts` and asserts it **contains** the exact five-line block

   ```
       } finally {
         setTimeout(() => {
           for (const path of paths) this.unmutePathEvents(path);
         }, VAULT_EVENT_SETTLE_MS);
       }
   ```

   and asserts the **working tree no longer contains it** (read from disk, never from the git index — the index lags an unstaged edit and would report the old shape; this was measured failing that way first).

2. **That expression is then RUN**, verbatim, against the **real shipped `FileOpsManager` primitives**, under a clamp installed on the **global** `setTimeout` (`installGlobalClamp`) — the timer the pre-repair code actually used. Nothing injected, nothing mocked.

3. **Measured result:** still muted at 1 000 ms, still muted at 59 999 ms, released at 60 000 ms. `longestMutedInterval(log, "note.md", now)` = **60 000**, reduced from the recorded `mutePathEvents`/`unmutePathEvents` call sequence, never from a constant.

**T0b closes the gap between the two clamps:** production's default scheduler routes straight to the globals, asserted by stubbing `globalThis.setTimeout` and observing `armMuteRelease` on a manager with **no scheduler injected** request a 250 ms delay through it. A clamp on the globals and a clamp on the injected seam are therefore the same clamp.

Break **B16** (making `installGlobalClamp` not clamp) reddens T0 — the instrument is itself falsifiable.

### The measured rows

| row | fixture | measured |
|---|---|---|
| **T1** | clamped scheduler, applied `modify`, event delivered | mute released **at the event, with the clock never advanced**. `longestMutedInterval` < 250. `releasedByEvent: 1`, `releasedByCeiling: 0`, `overruns: 0`. |
| **T2 (THE CONTROL)** | **identical** fixture, event term removed (`releaseOnConsumingEvent: false`) | the event arrives and is suppressed exactly as in T1 and **changes nothing**. Still muted at 59 999 ms; released at 60 000 ms. `longestMutedInterval` = **60 000**. `releasedByEvent: 0`, `releasedByCeiling: 1`. |
| **T3** | clamped, degenerate no-event case | released at the clamped ceiling, `longestMutedInterval` = **60 000**, and **counted as an overrun**. AC3 and AC4 meet here deliberately. |

**Vacuity discharges:** (a) nothing in `test_tp03` reads a settle constant for an assertion — every interval is reduced from the call sequence; (b) T0, above; (c) no wall-clock sleep anywhere — `vi.useFakeTimers()` throughout, the whole file runs in ~0.7 s; (d) T4 derives the release sites and pins the residue.

**T5 — WP91's cap is not weakened.** `DISK_WRITE_SETTLE_MS`, `MAX_MUTE_MS`, `armSettleRelease` and `releaseMute` are extracted from both the working tree and the `e1cbf69` blob and compared **by running the comparison**. Targeted constructs rather than a whole file, deliberately: the tree is shared and a whole-file comparison reds on a sibling's edit elsewhere in the module (see §7). `wp91/**` is byte-unmodified and green — 32 rows across 6 files.

---

## 6. AC4 — the overrun telltale, and how the vacuity trap it sets for itself is discharged

**Why this outranks the repair:** the clamp reached WP91's stated ceiling and **nothing in the product noticed**. S71 is findable only because `SyncManager` measures its own pulse gap on every pulse; the mute measured nothing, so a 60 s mute and a 250 ms mute were the same observation from outside — silence. This criterion keeps its value even if the inversion turns out to be wrong for some consumer.

**Deliverable:** `FileOpsManager.getMuteReleaseStats()` (`:457`) — read-only, state not a log line, so a test can be an oracle over it. Precedent: WP68's `getSidecarRenameRefusals` and WP88's `getOfflineState` in the same file, and WP91's `captureDeclines`.

```
{ releasedByEvent, releasedByCeiling, overruns, worstOverrunMs, overrunsByClass, pending }
```

**The trap, and the discharge (AC4(a)).** After AC3 lands, an overrun in the ordinary case is unreachable, so *"zero overruns"* is true for free — B44's `[06] B: node gone` shape. So:

- the **primary** observable is a **positive, non-zero** count under the clamped arm (**T1**);
- the zero in the unclamped arm (**T2**) is admissible **only** because T1 in the same run shows the counter can move;
- **T3 runs both arms inside one test body**, so the pairing cannot be split by a later edit: clamped `overruns > 0`, unclamped `overruns === 0`, same traffic, and **both** released (`releasedByCeiling: 1` each) — the difference is *when*, and only the counter can say so.

**T1's measured value, every counter in one assertion** (so a change that moves a neighbour cannot hide behind a green on the one being watched):

```
{ releasedByEvent: 0, releasedByCeiling: 1, overruns: 1,
  worstOverrunMs: 59750, overrunsByClass: { text: 1 }, pending: 0 }
```

`worstOverrunMs` is 60 000 − 250, i.e. the overshoot beyond the stated ceiling.

**The signature.** `MUTE OVERRUN: <pathClass> held=<n>ms ceiling=<n>ms (overruns=<n>)`, one emitter, `file-ops.ts:508`. Measured emission:

```
MUTE OVERRUN: text held=60000ms ceiling=250ms (overruns=1)
```

**No user data (S62's lesson one subsystem over).** T4 drives the overrun on `secret-project-notes.md` and asserts the emitted line contains neither `secret` nor `.md`. The class comes from `muteClass` (`:483`), which uses the **imported** `isCanvasPath` — see §7 for why that matters. Three classes measured distinguishable: `{ text: 1, canvas: 1, binary: 1 }`.

**Exactly one production emitter (BUILD_SPEC §10's rule, which `SEED REFUSAL STORE:` broke until B45).** T5 derives the emitter set from **comment-stripped** production source: four production lines name the signature and three are prose. Grepping would have reported four emitters. Break **B19** (adding a second emitter in `main.ts`) reddens it.

**The `MUTE OVERRUN:` §10 row is NOT landed by this batch.** The charter's §6 proposes it for the Dispatcher and states that this charter does not edit the BUILD_SPEC. The signature therefore emits with its §10 row still pending — **which is the `SEED REFUSAL STORE:` shape**, and it is flagged here rather than left for a later batch to find. It needs the Dispatcher's row.

**AC4's live arm is not discharged here.** It is a §7b W4 target — a real instance over a session long enough to contain a clamp. §8 states what this batch did and did not run.

---

## 7. AC5 — no collateral, in both directions

| observable | evidence |
|---|---|
| the five `vault-events.ts` gates still suppress, with the refcount asserted `> 0` **at the instant of the event** | tp05 **T1** — every mute taken by a **real producer** running a real op, one path per gate |
| **the fixture's mute is doing the work (AC5(c))** | tp05 **T0** — the identical events with **no mute** reach every consumer. Break **B21** (`isPathMuted` always true) reddens T0 by name. |
| the four outbound entry checks still refuse | tp05 **T2**, with a complement census — see below |
| **the strand, asserted positively** | tp05 **T3** — eight ops across text, binary, folder, rename, and two that emit nothing; afterwards `isPathMuted` is `false` for all eight paths, `pending: 0`, and mutes/unmutes are **balanced** |
| `destroy()` cancels every armed ceiling | tp05 **T4** |
| WP91's landed shape survives | tp05 **T6** |
| structural: the forbidden files are not in this diff | tp05 **T5** |
| pre-existing oracles unmodified and green | `wp91/**` 32 rows, `w4-canvas-integrity.test.ts` (its refcount assertions at `:600`/`:623`/`:647`/`:651`/`:678`/`:1460`), `wp68/**`, `wp6/**`, `wp83/**` — 217 rows across 21 files, all green, **byte-unmodified** |

### ⚠ The complement, run as a census — two of the four entry checks redden nothing

Each entry check was deleted in turn and the suite re-run. **Measured, not predicted:**

| break | result | why |
|---|---|---|
| **B1** `onFileCreate` entry | **REDDENS NOTHING** | the push is still refused, by B3's post-await re-check one seam later |
| **B4** `onFileModify` entry | **REDDENS NOTHING** | same, by B5 |
| **B6** `onFileDelete` entry | **REDS** | `onFileDelete` is synchronous and has no re-check; the entry check is the only guard |
| **B7** `onFileRename` entry | **REDS** | same, and it guards both endpoints |

The two that redden nothing are **not a hole**: they are belt-and-braces, and the measurement is that the braces hold when the belt is cut. What it *does* mean is that tp05 T2 is evidence for **B6 and B7 specifically**, and that B1/B4 are evidenced by T1 and tp02 T5 instead. The census is written into the test file above the row, because "which rows could never have gone red and why that is correct for each" is worth more than a green over all four.

### ⚠ Two breaks reddened nothing on the first pass, and both found a real weakness

1. **Removing the comment strip from the census deriver reddened nothing.** The reason: no comment anywhere in the tree currently spells `isPathMuted` **with its opening paren** — every prose mention is backticked bare, which the call regex already declines. The strip is correct and, on today's tree, **inert** — so a row that could only observe it through the tree would have gone on being green after someone removed it. `test_tp01` T4 now pins the behaviour on a **synthetic source** carrying a line-comment call, a block-comment call and a real call, and asserts 1 derived call against 4 raw occurrences. Break **B10** now reds: *`expected [ …(3) ] to have a length of 1 but got 3`*.
2. **Removing `destroy()`'s cancel loop reddened nothing.** The assertion advanced the clock before checking `pending`, which is green whether the timer was **cancelled** or merely **fired late**. tp05 T4 now asserts `pending === 0` **immediately** after `destroy()` and that the whole stats object is unchanged after advancing 60 s. Break **B12** now reds: *`expected 1 to be +0`*.

### ⚠ tp05 T5 was written as a whole-file diff and MEASURED failing on a sibling

Vacuity risk (d) is real in this tree. Two clean full-suite runs ninety seconds apart: one green, one red on tp05 T5 **and** tp01 T6, with `fileop-inject.test.ts` and `wp5/latency.test.ts` carrying fresh mtimes and **no `git status` entry** — the signature of a sibling's patch-run-restore campaign. A whole-file comparison against the pre-repair blob reds on *their* edit and reads as this work package's regression.

T5 now attributes **by a WP93 marker**, which a sibling cannot produce, in both directions:

- none of `canvas-sync.ts`, `canvas-persistence.ts`, `background-sync.ts`, `sync/sync.ts`, `sync/control-handlers.ts`, `debug-logger.ts` **or `canvas-sidecar.ts`** carries a `WP93` line;
- **exactly** `files/file-ops.ts`, `files/vault-events.ts` and `main.ts` do.

`canvas-sidecar.ts` is included in the *marker* half (safe) and excluded from any content comparison (a WP93 line in it would be unattributable by construction; a sibling's line is not this batch's). Break **B24** reds by name.

### A pre-existing oracle caught a real defect in this change

The first version of `muteClass` spelled `path.endsWith(".canvas")` privately. **WP83's `PRIVATE_CANVAS_SPELLERS` census reddened immediately**, on two rows, naming `files/file-ops.ts` — exactly the propagation pattern it exists to stop. Repaired by importing `isCanvasPath` from `canvas/canvas-epoch.ts`, which is that predicate's sanctioned form (contract §1: define once, import). **This is the single most useful thing any oracle did in this batch**, and it is reported rather than quietly fixed.

---

## 8. The falsification table — every test, its break, and the observed red

24 injections, run by patch → run → restore (never `git checkout`, never `stash`; rule 14).

| # | injection | target | observed red |
|---|---|---|---|
| **B1** | `noteVaultEvent` becomes a no-op (the EVENT TERM removed) | all | **7 failed** — tp02 T1/T1b/T2/T3/T4/T5, tp03 T1 · `expected true to be false` |
| **B2** | `armMuteRelease` arms no timer (the CEILING removed) | all | **10 failed** — tp02 T6, tp03 T0b/T2/T3, tp04 T1/T2/T3/T4/T6, tp05 T3 · incl. `mute stranded on subdir: expected true to be false` |
| **B3** | the overrun accounting removed | all | **5 failed** — tp03 T3, tp04 T1/T3/T4/T6 · `expected 0 to be greater than 0` |
| **B4** | the post-await interest guard removed | all | **1 failed** — tp02 T5 · `expected [ { type: 'create', …(2) } ] to have a length of +0 but got 1` |
| **B5** | a 15th `isPathMuted` consumer appears | tp01 | **2 failed** — T1, T6 · `expected [ 'files/file-ops.ts×9', …(1) ] to deeply equal [ 'files/file-ops.ts×8', …(1) ]` |
| **B6** | `MUTE OVERRUN:` carries the path | tp04 | **1 failed** — T4 · `expected 'MUTE OVERRUN: text secret-project-not…' to be 'MUTE OVERRUN: text held=60000ms ceili…'` |
| **B7** | the mute put back in front of canvas capture (**abort criterion**) | tp05 | **1 failed** — T6 · `expected 'if (canvasSync && canvasOwned(file.pa…' not to match /isPathMuted/` |
| **B8** | a `main.ts` release site regresses to a bare `setTimeout` | all | **1 failed** — tp03 T4 · `expected [ 'files/manifest.ts' ] to deeply equal [ 'files/manifest.ts', 'main.ts' ]` |
| **B9** | the deriver stops throwing on an empty input set | tp01 | **1 failed** — T3 · `expected [Function] to throw error matching /empty input set/` |
| **B9b** | the deriver stops throwing when no definition is found | tp01 | **1 failed** — T3 · `expected [Function] to throw an error` |
| **B10** | the comment strip removed from the deriver | tp01 | ⚠ **first pass: NOTHING** (see §7). After strengthening: **1 failed** — T4 · `expected [ …(3) ] to have a length of 1 but got 3` |
| **B11** | the clamped scheduler stops clamping (**AC3(b)'s own vacuity**) | all | **6 failed** — tp03 T2/T3, tp04 T1/T3/T4/T6 · `expected 250 to be 60000` |
| **B12** | `destroy()` stops cancelling armed ceilings | tp05 | ⚠ **first pass: NOTHING** (see §7). After strengthening: **1 failed** — T4 · `expected 1 to be +0` |
| **B13** | the census stops excluding `plugin/src/testing/` | tp01 | **1 failed** — T5 · `expected 0 to be greater than 0` |
| **B14** | the outbound content push never emits | tp02 | **1 failed** — T5b · `expected [] to deeply equal [ { type: 'create', …(2) } ]` |
| **B15** | `armMuteRelease` ignores the caller's stated ceiling | tp02 | **1 failed** — T6b · `expected false to be true` |
| **B16** | `installGlobalClamp` stops clamping (**the instrument itself**) | tp03 | **1 failed** — T0 · `expected false to be true` |
| **B17** | a release site added inside `file-ops.ts` | tp01 | **1 failed** — T2 · `expected [ 'files/background-sync.ts×1', …(5) ] to deeply equal [ … ]` |
| **B18** | a release **inside** its ceiling counted as an overrun | tp04 | **2 failed** — T2, T3 · `expected 1 to be +0` |
| **B19** | a SECOND production emitter of `MUTE OVERRUN:` | tp04 | **1 failed** — T5 · `expected [ 'files/file-ops.ts', 'main.ts' ] to deeply equal [ 'files/file-ops.ts' ]` |
| **B20** | the stats accessor hands back the manager's own mutable map | tp04 | **4 failed** — T1/T2/T4/T6 · `expected Map{ 'text' => 1 } to deeply equal { text: 1 }` |
| **B21** | `isPathMuted` always answers yes | tp05 | **2 failed** — T0, T3 · `mute stranded on a.md: expected true to be false` |
| **B22** | `onFileCreate`'s entry check stops consulting the mute | tp05 | ⚠ **NOTHING** — correct, and the reason is in §7's complement census |
| **B22b** | `onFileDelete`'s entry check stops consulting the mute | tp05 | **1 failed** — T2 · `expected [ { type: 'delete', path: 'note.md' } ] to have a length of +0 but got 1` |
| **B22c** | `onFileRename`'s entry check stops consulting the mute | tp05 | **1 failed** — T2 · `expected [ { type: 'rename', …(2) } ] to have a length of +0 but got 1` |
| **B22d** | `onFileModify`'s entry check stops consulting the mute | tp05 | ⚠ **NOTHING** — correct, §7 |
| **B24** | a `WP93` line appears in an out-of-scope file | tp05 | **1 failed** — T5 · `files/canvas-sync.ts carries a WP93 line and must not` |
| **B25** | one `WP93` marker stripped from an in-scope file | tp05 | **NOTHING** — `vault-events.ts` carries several markers and only one was removed; the complement half of T5 would red on a full strip. Reported rather than re-run. |

Every one of the 36 rows has at least one injection that reddens it, **except**: `tp03` T5 (WP91's constructs), which is not broken here because breaking it means editing `canvas-persistence.ts` — even transiently — in a shared tree where a sibling is running its own campaign. That is a rule-14 refusal, not an oversight, and it is stated rather than papered over.

---

## 9. Gate

| gate | result |
|---|---|
| `cd plugin && npx tsc -noEmit -skipLibCheck` | **exit 0, clean** |
| `npx vitest run src/__tests__/v2/wp93` | **36 / 36 green**, 5 files |
| `npx vitest run` (full) | **2653 / 2653 green, 370 / 370 files, TWO consecutive clean runs** |
| `npm run build` | **NOT RUN** — the charter forbids it and S67 is live |
| `plugin/main.js` | **not staged, not rebuilt** |
| Biome | new `wp93/**` files: **clean** (formatted with `biome format --write` over my own files only). Touched production files: **whole-file `format` finding each** — the known CRLF environment artefact, advisory locally. The five `lint/style/useTemplate` + `lint/complexity/useOptionalChain` findings in `main.ts` are at `:943`, `:1588`, `:2518`, `:2682`, `:2898`, all **pre-existing** and none in this diff. |

### ⚠ The gate's expected failure no longer exists

The dispatch expected **2603 / 364 with exactly one pre-existing failure — `wp5/latency.test.ts` US6 AC1 (S74)**. Measured:

- **baseline at `e1cbf69`: 2603 / 364, ZERO failures.** S74's row happened not to fire in that run (it was characterised as failing ~2 of 3).
- **sibling commit `e64678f` — "S74: the US6 AC1 row measures the injection, not the host scheduler" — repaired it.** S74's flake is gone from the tree, not from my run.
- **after: 2653 / 370, zero failures, twice.**

Arithmetic: 2603 + **14** (sibling `1fa5131`'s `fileop-inject.test.ts`) + **36** (wp93) = **2653**; 364 + **1** + **5** = **370**. Every added test is attributed.

**One failure was observed and it was NOT mine and NOT S74's US6 row.** At 04:16, mid-run, `wp5/latency.test.ts > US4 — reconnecting holder re-claims only still-free nodes` failed with `expected [ 1379248583 ] to deeply equal [ 1430521469 ]`, while `e64678f`'s change to that same file was **in flight in the working tree** (mtime confirms). It has not reproduced in any run since the commit landed. It is a **different row** from S74's and it is reported here rather than attributed to anything.

---

## 10. Out of scope — described, not fixed, not numbered

I do not allocate signal numbers. Each of these needs one.

1. **⚠ `plugin/src/files/manifest.ts:519` — a tenth mute-release site, uncapped, named by no document in this run.** `syncFromManifest` receives the release as an injected callback (`unmute?.(diskPath)`) inside a bare 250 ms `setTimeout`, reached from **six** `main.ts` call sites covering join, resume, reconnect ×2, role demotion and reload-from-host. Under S71's clamp each holds a mute ~60 s **on the join path**, which is when the most files are being applied. `grep -rn "unmutePathEvents"` cannot see it. **Needs a signal number, and it is the direct continuation of the charter's own "2 → 9 by running one grep".**
2. **The charter's P2 is not a mute release.** `canvas-sync.ts:4110-4126` releases `recentDiskWrites`, not the mute. The pre-repair mute-release count is nine, not the charter's nine-including-P2.
3. **The charter's consumer arithmetic.** 14 calls over 13 lines, not 13 calls; and §3.1's "eleven decisions" does not match its own seven-row B1–B7 table (5 + 7 = 12). Corrections only; the scope is unchanged.
4. **`MUTE OVERRUN:` emits with no BUILD_SPEC §10 row.** The charter proposes the row for the Dispatcher and forbids this charter from editing the BUILD_SPEC, so the signature ships unregistered — the exact `SEED REFUSAL STORE:` shape B45 caught. **The Dispatcher owes it a §10 row.**
5. **P4 (`background-sync.ts:502`) and P5 (`canvas-sync.ts:4304`) remain uncapped**, in files §6 forbids. P5 is already S75(b). P4 is the `BackgroundSync` write window and has no signal of its own.
6. **The comment strip in every derivation in this run is currently inert for the `isPathMuted` pattern**, because no comment in the tree spells the symbol with its paren. That is fine today and is a latent hole in any census that only observes the strip through the tree. WP93's own T4 now pins it synthetically; other work packages' derivers may not.
7. **S72 is untouched**, per §3.6's ruling. The charter's question for the Dispatcher — *does the `source=message` opportunity ever fire during a clamped window?* — is not answered here.
8. **The clamp's cause is undetermined** and this work package does not determine it. AC4's counter makes the *fact* observable; attributing it to a host clamp is an inference the emitter cannot make, which is why the signature is named *overrun* and not *clamp*.
9. **The event that beats the arm is not credited.** If a vault event arrives before `applyRemoteOpInner`'s `finally` runs, `noteVaultEvent` finds no armed release and the ceiling decides — i.e. exactly the pre-WP93 behaviour. That is a **degradation, never a strand**, and the 250 ms settle window exists precisely because vault events lag the write, so it is the unusual case. A credit mechanism was designed and **deliberately not built**: it would have released the mute before `applyRemoteOp`'s `afterApply` callback (`control-handlers.ts:95`) runs, which today runs muted, and changing that is a blast radius this work package has no evidence for.

---

## 11. Data safety, licences, and what was not written by me

- **No secret was read, printed, logged, hashed or fixtured.** No `data.json` was opened. No relay was contacted. No Obsidian instance was launched. No E2E script was run. `server/**` was not touched.
- **The counters carry path CLASS and durations only** — never a path, never file contents, never node text. Asserted, with a filename-shaped fixture, in `test_tp04` T4.
- **No existing test was deleted, weakened, retitled, skipped or amended.** **No §7 licence of any class was taken.** The only pre-existing files in this diff are the three production files §2 names.
- **`plugin/main.js` was not rebuilt and is not staged.** `npm run build` was not run (S67).
- **Not written by me, present in the tree at commit time:** `plugin/src/files/canvas-sidecar.ts` (uncommitted, a sibling batch — read, never reverted, never staged); `workflowArtifacts/canvas-v2/SIGNAL_REGISTER.md` (uncommitted, a sibling batch — not staged); and the three sibling commits `dc0c333`, `e64678f`, `1fa5131` that landed on this branch during execution.
- **`git status` was run before every stage and every commit**, and only explicit paths were staged. No `git checkout --`, no `git restore`, no `git stash` at any point — the break campaign patched and restored by string replacement in a script that restores in a `finally`.

## 12. Live arms NOT discharged by this batch

Both §7b W4 targets are **open** and this report claims neither:

1. **AC4's live overrun counter** — a real instance over a session long enough to contain a clamp, with the counter observed non-zero at least once, or a statement that no clamp occurred *and how it knows* (the `AWARENESS GAP:` telltale via `tools/e2e/s65_throttle_history.py`). **Not run.** A headless fixture is exactly where this instrument is most likely to be arranged trivially, and the clamp is a 0.7 % tail; nothing here demonstrates the instrument is wired in a real renderer.
2. **AC5's no-collateral arm on the five gates in the real editor** — a remote create, delete, rename and binary modify applied while the local user is idle. **Not run.** A3's `pendingRename` chain is the specific thing no fake reproduces faithfully, and §3 of this report reasons about that chain from the source rather than from a live observation.
