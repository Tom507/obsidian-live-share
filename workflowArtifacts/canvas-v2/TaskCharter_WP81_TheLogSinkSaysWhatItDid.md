# Task Charter — WP81: the debug log says where it is writing, and says once and loudly when it cannot

<!-- Updated: chartered 2026-08-05 (B20) from `ImplementationReport_DataLossChain.md` §8 row 5, re-verified against the tree AND against the two vaults' actual log files per hard-won rule 12. ⚠ THE REPORTED SYMPTOM DOES NOT REPRODUCE AND IS NOT WHAT HAPPENED. The log did not stop at 2026-08-04T23:56 — it is continuous through that minute in BOTH vaults and was still being written while this charter was drafted. Measured, see §3 Verification 1. What actually happened is worse in the way that matters: the file MOVED, and nothing in the product said so. The class the report named — "an outcome made unobservable" — holds exactly; its mechanism does not. This charter is therefore re-scoped from "the logger stopped" to "the sink is unobservable", which is the defect that is actually in the tree, and it carries three further measured mechanisms by which the file log CAN silently stop or relocate while `debugLogging: true`. `7754ac6` is NOT the cause; it is a contributing factor to the observation and its own follow-through is incomplete (§3 Verification 4). No Obsidian was launched, no vault file was written, no `data.json` value was read or printed, no relay was contacted, no E2E script was run; the vaults were read only by directory listing and by reading the plugin's own log output. -->
**Charter Status:** `SPEC_COMPLETE`
**WP:** WP81
**Phase:** P0
**task_mode:** `standard`
**Depends on:** none
**W4 Test Targets:** `0`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** the plugin's debug log can be **trusted as an instrument**. Today it cannot, and the reason is not that it fails — it is that **nobody can tell whether it is working**. A `DebugLogger` that is enabled, that is dropping every line it writes, that is writing to a path the reader is not looking at, and that has been silently muted by a *view* control are, from outside, the same thing: a file that is not getting longer. After this WP the sink states, once and observably, **where it is writing** and **whether the last write succeeded**, and a write failure is announced **once, loudly**, on a channel that does not depend on the failing sink — instead of being discarded forever by `.catch(() => {})`.
- **Why this is not cosmetic, in this project's own evidence:** the historical debug log was **decisive** for the D1 root cause. It pinned `resuming as host` → `demoted from host` at **11 ms** (`ImplementationReport_DataLossChain.md` §2.1), which is what ruled out a first-connect race and turned a guess into a diagnosis. The batch that used it then spent effort believing the log had died — because it had moved and nothing said so.
- **The shape, stated because it is the general lesson:** *a logger that silently stops is the same defect class as a delete that reports nothing.* Both convert an outcome into an absence. This project has now been bitten by both in the same week, and the D2 repair's answer — `cleanupStaleFiles` returning a `StaleReconcileDecision` (`types.ts:13-22`) instead of `void`, because *"'I deleted three files', 'there was nothing to delete' and 'I had no business deciding' were the same observation — silence"* — is the exact precedent this WP applies to the sink.
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 9, work package **WP81**; section 7 (Quality Gates), which the plugin's own log is an instrument for. Phase **P0**, because it is a diagnostic-integrity WP and because every phase's evidence has already depended on it.

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: modify, **one repository** (`obsidian-live-share`, branch `fix-bugs-and-raceconditions`), **`plugin/src/` only**.
  - Responsibility: make the file sink's state — **resolved path, enabled, effective level, last write outcome** — an answerable question, and make its first failure an announcement rather than a discard.
  - Scope summary: the swallowed rejection at `debug-logger.ts:154-156` becomes an observed outcome · the buffer stops being cleared before the write is known to have succeeded (`:153`) · the sink's own state is reported to the ring buffer and to the user once · the **view filter stops muting the file sink** (`log-view.ts:71` → `debug-logger.ts:120`) · the settings UI's hardcoded legacy-path fallback (`ui/settings.ts:306`) is corrected · one additive E2E control command so all of it is observable on a live instance.
- **Out of scope / non-goals — each of these is an ESCALATE, not a judgement call:**
  - **⚠ A logging framework, a second sink, a rotation scheme, a size cap or a compression step.** The log grew to 0.55 MB and Obsidian complained about indexing it; `7754ac6` answered that by **moving** it out of the indexed tree, and that ruling stands. Unbounded growth in `.obsidian/` is a **separate** question with no owner (recorded as **S30**) and is **not** re-opened here. A WP81 that arrives with a rotation policy has over-run.
  - **⚠ Changing what is logged, or any log signature.** `DRAG WATCHDOG:`, `LOCK REVERT:`, `AWARENESS GAP:`, `CANVAS MIRROR:` and every other uppercase signature is a machine contract (BUILD_SPEC §1). No category is added, removed, renamed or re-levelled. **The volume of logging does not change.**
  - **⚠ Reverting `7754ac6`.** `.obsidian/live-share-debug.md` is the right location and the reason is stated in the commit. WP81 makes the location **observable**; it does not move it back. Measured: writing there works — see §3 Verification 1.
  - **⚠ Changing the ring buffer's semantics or `RING_CAP`** (`debug-logger.ts:32`), the subscriber fan-out, or `LogView`'s rendering. The ring buffer is the one channel that already works when the file sink does not, and AC3 depends on that property staying true.
  - **⚠ `server/**`.** Untouched — a `server/` edit outside WP41 is a §7 abort criterion.
  - **⚠ `useCanvasBinding`, `canvas-binding.ts`, `canvas-model-bridge.ts`.** Frozen until P5; flipping the flag or editing those files is a §7 abort criterion.
  - **`canvas.simulateEdit`.** Not used, not extended, not repaired.
  - **`plugin/manifest.json`** — a broken symlink to another machine (S23). Not read, not edited, not repaired here.
  - **Any new runtime dependency.** D11 — an ESCALATE.
- **Known interfaces / dependencies:**
  - Input: `Vault.adapter.append`, the plugin's `debugLogging` / `debugLogPath` settings, the `LogView` level control
  - Output: an observable sink state; a once-only announcement on failure; a corrected settings fallback; one additive E2E control command
  - **Blocks nothing, and everything benefits.** It is diagnostic infrastructure for every other WP.

### §7 disposition — no `DONE` work package is re-opened, and no §7 licence of any class is taken

1. **No `DONE` work package is re-opened.** `DebugLogger` is not the subject of any §5 component and is named in no WP's acceptance criteria. It is inherited infrastructure, older than this initiative.
2. **Two inherited test files touch this surface and neither is re-opened:** `plugin/src/__tests__/debug-logger.test.ts` and `plugin/src/__tests__/types.test.ts` (whose `debugLogPath` assertion was corrected by the data-loss batch after `7754ac6` left it red — `ImplementationReport_DataLossChain.md` §8 row 6). **WP81 holds no §7 licence of any class.** If a repair reddens an inherited assertion, that is an **ESCALATE with the measured before/after, left red** — not a rewrite. In particular, the `types.test.ts` default-path assertion must stay green and must **not** be re-pointed at `ui/settings.ts`'s literal to make AC5 easier.
3. **`main.ts` gains wiring only** — the construction of the logger and the forwarding of settings changes, which is what it does today (`main.ts:420-424`, `:597`). §3.1 S11 and the §7 abort criterion are absolute; no decision about the sink is written in `main.ts`.
4. **The `types.ts` `DEFAULT_SETTINGS` block is not edited.** `debugLogPath`'s default (`types.ts:86`) stays `.obsidian/live-share-debug.md`. AC5 changes the **settings-UI fallback**, not the default. And note the position trap documented by the data-loss batch (§10): the `DEFAULT_SETTINGS` comment contains the literal `` `${configDir}/**` ``, which the WP22 dormancy test's naive `/\*[\s\S]*?\*/` comment strip reads as an opening block comment — **any JSDoc added below it closes the pairing and swallows `useCanvasBinding: false`**, reddening a test that has nothing to do with this change. If WP81 must add a type, it goes at the **top** of `types.ts`, beside `StaleReconcileDecision`.

---

## 3. Architecture Context

*Task-local architecture guidance only.*

### Verified against the current tree AND the live artefacts (rule 12), 2026-08-05 — measured, given, do not re-derive

**Verification 1 — ⚠ THE REPORTED SYMPTOM DOES NOT HOLD. Measured on both vaults' actual log files.**

The report states the log *"stopped writing at 2026-08-04T23:56 in both vaults … and produced nothing for the whole of the following day's runs."* Read directly, per minute, from `<vault>/.obsidian/live-share-debug.md` in both vaults:

| minute (UTC, the log's own `toISOString()` stamps) | vault A entries | vault B entries |
|---|---|---|
| `2026-08-04T23:54` | 20 | 27 |
| `2026-08-04T23:55` | 9 | 9 |
| **`2026-08-04T23:56`** | **7** | **7** |
| `2026-08-04T23:57` | 7 | 7 |
| `2026-08-04T23:58` | 6 | 6 |
| `2026-08-04T23:59` | 34 | 21 |
| `2026-08-05T00:00` | 14 | 14 |
| … every minute through … | … | … |
| `2026-08-05T00:54` (drafting time) | 40 | live |

**There is no gap.** Hourly totals: `2026-08-04T22` = 784 / 471, `2026-08-04T23` = 829 / 846, `2026-08-05T00` = 738 / 653. Both files' mtimes tracked the current minute while this charter was being written, and both `data.json` files still carry `debugLogging: true` and `debugLogPath: ".obsidian/live-share-debug.md"` (**checked by key-and-literal match with a count only; no value was printed, and no other key was read**). **The logger was writing throughout the window in which it was reported dead, and it is writing now.**

**Verification 2 — what actually happened, and why it is still a defect.**

`H:\tmp\liveshare_fix_debuglog.py` (mtime `2026-08-04T22:57Z`) rewrote `debugLogPath` in both vaults from `live-share-debug.md` to `.obsidian/live-share-debug.md` and **moved the existing file** (`:42-63`). `git show 7754ac6` (authored `2026-08-04T23:04Z`) changed only the *default* in `types.ts` — 1 file, 7 insertions — so it could not have affected a vault whose `data.json` already carried an explicit value. Neither `<vault>/live-share-debug.md` exists any more; a `find` over both vaults returns **exactly one** `live-share-debug*` file each, the one in `.obsidian/`.

So the file the reader was watching **ceased to exist at 22:57Z**, an hour before the reported stop time, and the product said nothing at any point — not when `updateSettings` swapped the path (`debug-logger.ts:61-64`), not on the next successful append, not ever. **That is the reported class exactly — an outcome made unobservable — arrived at by relocation rather than by failure.** The mis-stated timestamp is itself evidence for the charter: a reader with no instrument cannot even say *when* the log stopped, because the only thing they can observe is a filename.

**Verification 3 — the structural defect, which holds independently of any of the above.**

```text
debug-logger.ts:150   flush(): void {
debug-logger.ts:151     if (this.buffer.length === 0) return;
debug-logger.ts:152     const lines = `${this.buffer.join("\n")}\n`;
debug-logger.ts:153     this.buffer = [];                                   ← cleared BEFORE the write is known to succeed
debug-logger.ts:154     this.vault.adapter.append(this.logPath, lines).catch(() => {
debug-logger.ts:155       // Best-effort logging, discard write failures     ← the rejection is discarded
debug-logger.ts:156     });
debug-logger.ts:157   }
```

Three consequences, none of them speculative:

- A failed append **loses those lines permanently** — they were dropped from the buffer at `:153` before the outcome was known. There is no retry and no dead-letter.
- The failure is **invisible**: no counter, no error entry in the ring buffer, no `Notice`, no state on the object. There is nothing to ask.
- Because the state is not recorded, the **next** flush behaves identically. An unwritable path fails **forever**, silently, at 500 ms intervals (`FLUSH_DELAY_MS`, `:3`).

**Ruling for the charter, since the brief asks for it: a swallowed `.catch(() => {})` on a persistent sink is not acceptable.** A best-effort sink may drop **data**; it may not drop the **fact that it dropped data**. The two are different promises and only the first was intended.

**Verification 4 — three further live mechanisms by which the file log can stop or move while `debugLogging: true`. All measured; none is hypothetical.**

| # | Mechanism | Site | Effect |
|---|---|---|---|
| **M1** | **A *view* control mutes the *file* sink.** `LogView`'s level dropdown calls `this.logger?.setLevel(this.filterLevel)` — `log-view.ts:69-73` → `DebugLogger.setLevel` `:86-88` → `record()`'s early return at `:120`, which sits **above** the file-sink push at `:136-139` | `log-view.ts:71` | Choosing `WARN` in the status console **stops INFO and DEBUG lines reaching the file** for the rest of the session, with nothing saying so. It is not persisted, so it self-heals on the next reload — which is precisely the shape of *"the log stopped and later came back."* **This is a real, in-tree route to the reported symptom.** |
| **M2** | **The settings UI reverts the path to the pre-`7754ac6` location.** `settings.debugLogPath = value.trim() \|\| "live-share-debug.md";` — a hardcoded literal, **not** `DEFAULT_SETTINGS.debugLogPath` | `ui/settings.ts:306` | Clearing the field puts the log back in the **vault root**, the exact location `7754ac6` moved it out of and for the exact reason (Obsidian indexes it, it joins the graph and Quick Switcher, it grows unbounded). A reader watching `.obsidian/` then sees it "stop". **`7754ac6`'s follow-through is incomplete: it changed the default and left the fallback.** |
| **M3** | **A hard kill discards the buffer.** `destroy()` (`:159-166`) flushes, and `main.ts:519-522` `onunload` calls it — but only on a **graceful** unload. The rig's own scripts use `taskkill /F` (`H:\tmp\liveshare_e2e_install.py:47`), so up to `FLUSH_DELAY_MS` = 500 ms of entries are lost at every rig restart | `debug-logger.ts:3`, `:159-166` | Small and bounded, and **exactly the window in which a crash-adjacent diagnosis needs the last lines.** Named, not necessarily repaired — see AC4's scope note. |

**Verification 5 — the instrument does not exist, and this WP owns it.**

`routeCommand` (`testing/e2e-control.ts:435-573`) exposes: `session.info`, `canvas.open`, `canvas.state`, `canvas.binding`, `canvas.simulateEdit`, `canvas.setFlag`, `canvas.clearFlags`, `sync.waitQuiescent`, `scratch.create`, `scratch.remove`, `canvas.file`, `manifest.info`, `session.reconcileStale`, `manifest.publish`. **`plugin.settings` is NOT among them** — the only occurrence of that string is a flag-owner label at `:1253`. **Nothing can currently ask a live instance where it is logging, or whether the last write worked.** Per the owner's standing instruction — *"Falls das e2e plugin noch bugs hat gerne bei w3 in revision geben"* — that command is chartered **here, inside WP81**, as a W3 revision.

- **Component(s) being changed:** `plugin/src/debug-logger.ts` (the sink state and the announcement), `plugin/src/session/log-view.ts` (the filter stops reaching the sink), `plugin/src/ui/settings.ts` (the fallback literal), `plugin/src/main.ts` (wiring only), `plugin/src/testing/e2e-control.ts` (additive).
- **Constraints from BUILD_SPEC (invariants — what must not change):**
  - **The ring buffer and the subscriber fan-out keep working when the file sink does not.** `record()` populates them independently of `enabled` (`:124-133`, `:136`) and that is the property AC3's announcement channel rests on. It stays.
  - **The announcement is once, not per failure.** A `Notice` per failed flush at 500 ms intervals is a worse defect than the one being fixed, and it would be user-visible. Subsequent failures are **counted**, not repeated.
  - **`enabled === false` is not a failure.** A disabled sink must be reported as *disabled*, distinctly from *failing*. Collapsing them re-creates the ambiguity this WP removes.
  - **No secret reaches the log or any report.** Both vaults' `data.json` hold live credentials. The sink state reports the **path** and the **outcome**; it never reports settings values. **Keys may be named; values may not** — in the log, in the E2E response, in a test name, in a fixture, in a report or in a commit message.
  - **`useCanvasBinding` stays `false`.** No criterion depends on P4 or P5 behaviour.
- **Technology / framework / config constraints:**
  - TypeScript, `plugin/` workspace, Vitest 4.0.18. **Zero new runtime dependencies** (D11).
  - `Vault.adapter.append` returns a `Promise`; **its rejection is the only signal that a write failed** and there is no synchronous alternative. Obsidian's adapter is the seam — tests inject a fake vault, as `debug-logger.test.ts` already does.
  - **Schema impact:** none. `debugLogging` and `debugLogPath` keep their names, types and meanings; `DEFAULT_SETTINGS` is not edited.
  - Biome reports a whole-file `format` finding per touched file (CRLF environment artefact). Advisory locally, gating in CI — do not mass-reformat.
- **Entry points / relevant files:**
  - `plugin/src/debug-logger.ts` — `FLUSH_DELAY_MS` `:3`, `RING_CAP` `:32`, the class `:46`, fields `:47-53`, ctor `:55-59`, `updateSettings` `:61-64`, `setLevel` `:86-88`, `record` `:119-140` (the level gate `:120`, the file-sink push `:136-139`), `scheduleFlush` `:142-148`, `flush` `:150-157`, `destroy` `:159-166`
  - `plugin/src/session/log-view.ts` — `filterLevel` `:20`, `setLogger` `:27-31`, the dropdown handler `:69-73`, `appendEntry`'s own display filter `:118-` (**this one is correct and stays** — it is the view filtering the view)
  - `plugin/src/ui/settings.ts` — the toggle `:294-296`, the path field `:305-307`
  - `plugin/src/main.ts` — construction `:420-424`, `logger.updateSettings` `:597`, `onunload` / `logger.destroy` `:519-522` (**wiring only**; line numbers drift, resolve by symbol)
  - `plugin/src/testing/e2e-control.ts` — `routeCommand` `:435-573`, the optional-method precedent `canvasFile` `:513-518`, the anti-pattern `simulateEdit` `:995-1023`
  - `plugin/src/types.ts` — `debugLogging` `:45`, `debugLogPath` `:46`, defaults `:79` and `:86` (**read only; not modified**)
  - Read-only context: `plugin/src/__tests__/debug-logger.test.ts`, `plugin/src/__tests__/types.test.ts`
- **Files this WP may NOT touch:** everything under `server/`, `plugin/src/canvas/canvas-binding.ts`, `plugin/src/canvas/canvas-model-bridge.ts`, the `DEFAULT_SETTINGS` block of `plugin/src/types.ts`, `plugin/src/files/manifest.ts`, `plugin/src/main.ts`'s `cleanupStaleFiles`, and `plugin/manifest.json`. **If the repair appears to require reaching into any of these, that is an ESCALATE, not a judgement call.**
- **Structure references:** *(intentionally empty — no Graphify graph exists for this project; FALLBACK mode is declared in BUILD_SPEC §3. Worker 3 fills this in after implementation. Do not invent paths here.)*

If structure references conflict with the BUILD_SPEC or explicit task scope, the BUILD_SPEC and TaskCharter win. Escalate instead of following the map.

### The ruling on scope, since the premise was falsified

The reported *mechanism* is gone; the reported *class* is not. **This WP is chartered, and it is chartered on what is measurably in the tree** (Verification 3 and 4), not on the incident narrative. Two consequences the implementor must not undo:

- **No criterion asserts that the historical silence is repaired**, because there was no silence. A test named after 2026-08-04T23:56 would be asserting a fiction and would go green for free.
- **The relocation case is first-class, not a footnote.** *"The log is fine, you are reading the wrong file"* is the failure that actually cost this project a day, and AC1's resolved-path report is what makes it a two-second question instead of a diagnosis.

---

## 4. Acceptance Criteria

*Each criterion names **the observable that proves it** and **what would make it vacuous**.*

*Acceptance evidence is **two LIVE Obsidian instances** driven through the E2E rig — `POST http://127.0.0.1:39431/command` (vault A) / `:39432` (vault B), body `{"cmd","args"}` (route confirmed at `testing/e2e-control.ts:641`). **Blind sets are discontinued** — no `blind_set1`, no `blind_set2`, no falsification-injection requirement, no `BlindVerificationLedger` row is owed. Unit tests against an injected fake vault are the honest tool for AC2 and AC3's failure paths, since a real unwritable path cannot be manufactured in a live vault without touching it — they are **evidence for those rows** and the live rig is the evidence for the rest.*

1. **The sink can be asked what it is doing, on a live instance, and every field is measured.**
   - **Deliverable:** one additive E2E control command reporting at least: the **resolved log path the sink is actually appending to**, whether the file sink is **enabled**, the **effective minimum level** the file sink is applying, the **number of lines written this session**, and the **last write failure** (its message and a count) or an explicit absence of one. Optional on the host interface, on the `canvasFile` / `clearFlags` precedent (`e2e-control.ts:513-518`), so pre-existing fake hosts stay valid. No existing command changes shape.
   - **Observable (live):** on both vaults the command reports the path, and that path **matches the file that is actually growing** — asserted by taking the reported path, reading its length, emitting a log-producing action, and observing the length increase **at that path**. The written-line counter advances by the same act.
   - **Vacuous if:** the command echoes `settings.debugLogPath` rather than the path the sink is using. Those are the same today and would be the same after a broken repair, so echoing the setting proves nothing — the value must come from the sink's own state and must be shown to **differ** from the setting in the one case where they can differ (a path changed by `updateSettings` while a flush is pending). Equally vacuous, and this is the failure this project has produced ten-plus times: **any hardcoded field.** `canvas.simulateEdit`'s `applied: true` (`:1023`) is the precedent. Every field is read at call time.

2. **A write failure is recorded, is announced once, and is not announced again.**
   - **Observable (headless, injected fake vault — a live vault must not be made unwritable):** with an `adapter.append` that rejects, the first failure produces (a) a **recorded** last-error on the sink state, readable through AC1's command, (b) **one** entry in the ring buffer, at `error` level, and (c) **one** user-visible `Notice`. The next N failures produce **no further** `Notice` and **no further** ring entries — only the counter advances. A subsequent **success** clears the failing state, and a later failure announces **again**.
   - **Vacuous if:** only the first failure is exercised, which cannot distinguish "announces once" from "announces always" — and "always" is a worse defect, at 500 ms intervals, than the silence it replaces. The burst is mandatory, the counter is asserted to have advanced while the announcement did not, and the recovery-then-refail cycle is asserted, or "once" is indistinguishable from "once ever, then never again even after it heals".

3. **No line is discarded on the strength of a write that has not succeeded, and the announcement does not depend on the failing sink.**
   - **Observable (headless):** the buffer is not emptied before the append is known to have resolved — after a rejected flush the lines are either still pending or explicitly accounted for by the recorded failure; **the count of lines the sink believes it wrote never exceeds the count the sink actually wrote.** And the AC2 announcement reaches the ring buffer and the `Notice` **while the file sink is failing**, which is the only reason it can be observed at all.
   - **Vacuous if:** "not lost" is asserted by reading the buffer immediately, before the rejection has been delivered — a `Promise` rejection is a microtask and the naive assertion passes against `:153` **unchanged**. The assertion must be made after the rejection has settled, and the test must be shown to go **red** against the current `flush()` body. Equally vacuous: a growth policy with no bound, which turns a permanently failing sink into a memory leak — the retained set is **bounded** (the `RING_CAP` precedent) and the bound is asserted by driving a burst past it, not by reading a constant.

4. **A *view* filter never mutes the *file* sink.**
   - **Observable (headless at the seam, and live if the console can be driven):** with the file sink at its configured level, setting the `LogView` dropdown to `error` leaves `debug` and `info` lines **still reaching the file** — the file's length grows on a `debug` line — while the **view** shows only `error`. The file sink's effective level, as reported by AC1's command, is **unchanged** by any view action. Asserted for all four `LOG_LEVELS`, not one.
   - **Vacuous if:** asserted only for the level that happens to pass everything (`debug`), which is the current default (`log-view.ts:20`) and would pass **against the unrepaired build**. The discriminating row is a restrictive view level with permissive file logging, and it must be shown to fail on the pre-WP81 behaviour. Equally vacuous: asserting the view's own display filter (`log-view.ts:118-`) — that one is **correct** and is not the subject.

5. **Clearing the log-path setting cannot silently move the log back into the vault root.**
   - **Observable:** with the settings field cleared, the effective path is the **current default** (`DEFAULT_SETTINGS.debugLogPath`, `types.ts:86`), not the pre-`7754ac6` literal at `ui/settings.ts:306`, and AC1's command reports it. `types.test.ts`'s existing default assertion stays green and is **not** modified. The relationship is asserted **by reference to the default**, so a future default change cannot re-open the divergence.
   - **Vacuous if:** the test hardcodes `.obsidian/live-share-debug.md`, which reproduces the exact defect — two independent literals that agree today — in the oracle. The assertion is *"the fallback IS the default"*, demonstrated by perturbing the default and observing the fallback follow.

6. **The location is stated once per session, so nobody has to guess again.**
   - **Observable (live):** after a plugin load with the sink enabled, the log file itself contains **one** entry naming the resolved path it is writing to, and the ring buffer holds it too — so a reader who opens the status console, or who finds *any* copy of the log, can tell **which file is current**. Read on both vaults after a restart driven by the rig.
   - **Vacuous if:** the statement is emitted only to the file — in which case it is unreadable in precisely the case it exists for (the reader cannot find the file). It must reach the ring buffer, which does not depend on the sink. Equally vacuous: emitting it on every flush, which is noise, or emitting it before the path is resolved, which states an intention rather than a fact.

**Definition of Done:** *"is the log working, and where is it?"* is a question a live instance answers in one call — and a sink that cannot write says so once, loudly, on a channel that does not depend on it.

---

## 5. Constraints and Known Risks

- **Permission / environment limits:** Windows dev host. Run tests from the workspace root, never from a subdirectory; long-running invocations through `visible-console` `run_python` / `run_command` with **absolute** paths, never a Bash background process. **The two owner vaults and `H:\tmp\liveshare_*.py` are shared with other work** — check `DISPATCHER_STATE.md` and the task registry before launching, installing, restoring or resetting anything, and never during another agent's run. **A vault path must never be made unwritable to produce AC2's failure**; the failure is injected at the adapter seam, headless.

- **Known risks specific to this WP:**
  - **⚠ The most likely wrong implementation is a `Notice` per failed flush.** `FLUSH_DELAY_MS` is 500 ms (`debug-logger.ts:3`), so a permanently failing sink becomes two toasts a second, forever. AC2's once-then-count clause is the defence and may not be trimmed.
  - **⚠ The second is an unbounded retry buffer.** "Do not discard lines that failed to write" reads like "keep them all". A sink that fails permanently then grows without bound is a memory leak wearing a bugfix's clothes. AC3 requires a stated, asserted bound.
  - **⚠ The third is a rotation policy.** It is the obvious adjacent improvement, it is **explicitly out of scope** (§2), and it would put a size-management decision inside a WP about observability. **S30**, unowned.
  - **⚠ The fourth is repairing the wrong thing because the report named it.** The historical silence **did not happen** (§3 Verification 1). A criterion, a test name or a report claim asserting that it is now fixed is asserting a fiction. Rule 12 applied here changed the whole subject of this charter; do not un-apply it.
  - **⚠ The fifth is asserting `7754ac6` was the cause.** It was authored **after** the vault migration script that did the actual move, it changed only a default in `types.ts` (1 file, 7 insertions), and both vaults carried an explicit value that a default could not affect. It is a **contributing factor to the observation** and its follow-through is incomplete (`ui/settings.ts:306`, AC5). **It is not the cause, and the log demonstrably kept working after it.**
  - **⚠ M3 (`taskkill /F` discards up to 500 ms of buffer) is named but not necessarily repaired.** A synchronous or shutdown-hook flush is a different problem with different risks. If it is repaired, it gets its own criterion and its own evidence; if it is not, the report says so. **Silently leaving it while implying AC3 covers it is the failure mode.**
  - **⚠ Do not assume the unbuilt phases.** `useCanvasBinding` is `false` and frozen until P5. A criterion that would only pass once P4 or P5 lands is a criterion this WP cannot discharge.
  - **⚠ Do not mirror any generated test suite into `plugin/src/__tests__/` before this WP is implemented.** `tsc` typechecks `src/` including tests, so an unimplemented mirrored suite breaks `npm run build` **repo-wide** for every other WP. This has been violated once already in this run.
  - **⚠ Both vaults' `data.json` hold live credentials.** Never printed, logged, echoed into a report, a fixture, a test name or a commit message. **Keys may be named; values may not.** The debug log is itself an artefact that leaves the process — nothing this WP adds may write a settings **value** into it, and the sink-state response reports the **path** only.

- **Known flaky patterns:**
  - No wall-clock sleeps. `FLUSH_DELAY_MS` behaviour is asserted by advancing an injected clock / fake timers, never by sleeping.
  - Do not assert on log strings as the primary oracle — **except** where the log content *is* the subject (AC6), and there the assertion is on the sink's own once-per-session statement, not on an unrelated signature.
  - A test that asserts an absence — *"no second Notice"* — is suspect by default and is paired here with the counter that must have advanced.
  - **The E2E suites are idempotent as of the data-loss batch, and every WP81 scenario must stay so**: per-run markers, no dependence on a previous run's log content, and a SKIP recorded as a SKIP.

- **External dependency risks:** none permitted (D11). A new runtime dependency is an ESCALATE.
- **Hard constraints:**
  - **No swallowed rejection on the persistent sink.** `.catch(() => {})` at `debug-logger.ts:154-156` does not survive in any form.
  - **Announce once, then count.** Recovery re-arms the announcement.
  - **The announcement channel does not depend on the file sink.**
  - **No line is dropped on the strength of an unresolved write; the retained set is bounded.**
  - **`setLevel` from a view control never gates the file sink.**
  - **The settings-UI fallback IS `DEFAULT_SETTINGS.debugLogPath`**, by reference, not by a second literal.
  - **`DEFAULT_SETTINGS` is not edited; `7754ac6` is not reverted; the log stays in `.obsidian/`.**
  - **No log signature, category, level or volume changes. No rotation, no size cap, no second sink.**
  - **The ring buffer, `RING_CAP` and the subscriber fan-out are behaviourally unchanged.**
  - **The E2E command reports measured facts and returns no literal.**
  - **No `server/**` edit. `useCanvasBinding` is not flipped. The plugin version is not bumped. `plugin/manifest.json` is not touched.**
  - **No `DONE` work package is re-opened; WP81 holds no §7 licence of any class.** A reddened inherited assertion — in particular in `debug-logger.test.ts` or `types.test.ts` — is an ESCALATE, left red.
  - **No owner-vault file is made unwritable, modified, hashed into a report, fixtured or named by value; no secret through any agent tool.**

### Recorded, not repaired — this WP's own sweep

- **S29 — the reported symptom did not occur.** `ImplementationReport_DataLossChain.md` §8 row 5 states the log stopped at `2026-08-04T23:56` in both vaults. It did not; both files are continuous through that minute and beyond (§3 Verification 1). The observation was almost certainly of the **pre-migration path**, which stopped existing at `2026-08-04T22:57Z`. **Recorded so the claim is not inherited as a fact**, and because it is itself the argument for AC1: with no instrument, a reader cannot distinguish "stopped" from "moved", and this project spent a diagnosis on that difference.
- **S30 — the debug log grows without bound in its new location.** `7754ac6` moved it out of the indexed tree, which fixed the *indexing* complaint; the files were 749 960 B and 708 014 B at charter time and nothing caps or rotates them. **Explicitly out of WP81's scope. Owner: none assigned.**
- **S31 — the log file carries duplicated historical content.** Both vaults' logs contain the same early blocks (`2026-07-17T17`, `2026-07-20T11-13`, …) more than once, in adjacent runs, which the append-only logger cannot produce. It is a **file-operation** artefact (a backup/restore or a repeated move), not a `DebugLogger` defect, and it is not repaired here — but a reader counting entries or bisecting by timestamp will be misled. **Owner: none assigned.**
- **S32 — the E2E readiness probe accepts any HTTP answer as "control is live."** `H:\tmp\liveshare_e2e_install.py:56-69` posts to `/cmd`; the control server routes only `/command` (`testing/e2e-control.ts:641`). Every non-`no answer` result is treated as success (`:104-109`). **Also recorded on WP80 as S27. Owner: none assigned.**
- **S33 — `plugin.settings` is documented as a working rig command and is not one.** It appears in `DISPATCHER_STATE.md`'s command list; `routeCommand` has no such case (§3 Verification 5). **Recorded so no charter is written against an instrument that does not exist. Owner: none assigned.**

---

## 6. Definition of Done Artifacts

- **Required changed files:**
  - `plugin/src/debug-logger.ts` — the sink state, the resolved path, the once-only announcement, the non-discarding flush
  - `plugin/src/session/log-view.ts` — the view filter stops calling `setLevel`
  - `plugin/src/ui/settings.ts` — the fallback becomes the default, by reference
  - `plugin/src/main.ts` — **wiring only**
  - `plugin/src/testing/e2e-control.ts` — the AC1 command, additive, host method optional on the interface
- **Already landed by Worker 2 with this charter — NOT implementor work:** the §9 WP81 row and the §7 / header counts (79 → 81, together with WP80), re-derived from §7 and §9 rather than edited independently. **The implementor does not edit `BUILD_SPEC_CanvasV2.md`.**
- **Required report:** `ImplementationReport_WP81.md` (in `workflowArtifacts/canvas-v2/`), which must additionally record: an explicit statement, at the top, that **the reported 2026-08-04T23:56 silence did not occur** and what was measured instead, so the correction is not lost; the **AC1 live response from both vaults**, with the path→growth attribution and the demonstration that the reported path is the sink's own state and not an echo of the setting; the **AC2 burst result** — first failure announced, next N counted and not announced, recovery re-arming — with the counter values; the **AC3 red-against-the-current-`flush()`** result, stated as measured, plus the asserted bound and the burst that proved it; **AC4 for all four levels**, naming the row that fails on the pre-WP81 build; **AC5's perturbation** of the default showing the fallback follow it, with the confirmation that `types.test.ts` was not modified; **AC6's once-per-session statement** as it appears in the file **and** in the ring buffer, from both vaults after a rig-driven restart; a positive statement that **no log signature, category, level or volume changed**, that `RING_CAP` and the subscriber fan-out are behaviourally unchanged, that **`DEFAULT_SETTINGS` was not edited** and `7754ac6` was not reverted; the **disposition of M3** (repaired with its own evidence, or explicitly not repaired); the **executed test count** before and after with the statement that no existing test was deleted, weakened, retitled, skipped or amended and that **no §7 licence of any class was taken**; and, for every live run, which vault ports were used, that **no `data.json` value was read or printed**, that no vault path was made unwritable, and that `canvas.simulateEdit` was not called.
- **BUILD_SPEC updates required:** no — the §9 row and the counts were entered when this charter was written. Anything further is an **ESCALATE** rather than a spec edit.
- **Gate status required at handover:** `npm run build` (tsc + esbuild) PASS and `npm test` 0 failed from `plugin/`, with the executed test count recorded. `npm run lint` advisory locally, gating in CI — do not mass-reformat.

---

## 7. Visible Test Cases / Producer Artifacts

*Filled by Worker 3. Worker 2 leaves this section empty.*

*⚠ **Blind sets are discontinued for new work** (owner's instruction, 2026-08-05): no `blind_set1`, no `blind_set2`, no falsification-injection requirement and no `BlindVerificationLedger` row is owed by this WP. Validation is W4 against two live Obsidian instances, with the injected-adapter unit tests carrying the failure rows that a live vault must not be used to produce. E2E-plugin defects found while validating go back to **W3 as a revision** — and note that for this WP the E2E command is itself part of the deliverable, so a defect in it is a defect in WP81.*

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
