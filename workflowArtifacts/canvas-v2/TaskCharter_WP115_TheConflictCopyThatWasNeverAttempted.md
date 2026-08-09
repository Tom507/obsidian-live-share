# WP115 — The conflict copy that was never attempted

**Signals:** S148 (Tier 1, data loss) · S151 · **Worker:** fresh context ·
**Branch:** `fix-bugs-and-raceconditions` · **Base:** `27271a5`

---

## Package A — S148: the guest's offline work was silently overwritten, on both branches

### The measurement

Live, build `1ddad2155341adbd`, three real vaults. A guest edits a file while out of session; on rejoin the
host's version overwrites it. **`conflictCopies` reads `{total: 0, byArm: {}, failed: 0}` throughout.**

**So `preserveLocalVersion` did not run and fail. It did not run at all.** Both branches — the preserve
branch and the discard branch — produced a silent overwrite.

### Why this is not simply "a fix regressed"

**One round earlier, S125 was reported VALIDATED LIVE, including the discard branch** — which had never
been reachable in the field before that. Two commits separate the runs (`39255ee`, `6b191d8`), neither of
which names the conflict path.

**The two runs also differ in setup, and the validator put that on the record rather than guessing:**

| | the run that VALIDATED S125 | the run that REFUTED it |
|---|---|---|
| how the session ended | **Obsidian closed** | **`Leave session`, Obsidian left running** |
| how the offline edit was made | edited, then Obsidian reopened | **python wrote the file on disk** |

**Establishing which of these it is comes BEFORE any fix**, and is most of the package. A repair aimed at
the wrong one of those two makes things worse: it either papers over a regression or adds a second
mechanism beside a working one.

### Leads — these are leads, not findings

- **The "offline" premise itself.** If Obsidian is **running** when the bytes change on disk, its file
  watcher fires. If the plugin records that as a change it already knows about, then on rejoin the file is
  not *"changed while we were away"* — it is up to date, and there is nothing to preserve. That would make
  the behaviour **setup-dependent rather than regressed**, and **still data loss**, because the user's edit
  is gone either way.
- **The stamp.** `conflict-copy.ts`'s `usableTimestamp(value)` requires `value > 0`, and
  `DEFAULT_SETTINGS.lastSessionEndedAt` **is** `0` — a fresh install therefore preserves everything.
  `S127` established the stamp *works* when the session is ended **by the command**. Does `Leave session`
  with the process still running take the same path as a close? Read it; do not assume `S127` covers it.
- **The baseline.** `captureVaultBaseline()` → `cleanupStaleFiles()` → `syncFromManifest()` run at all three
  guest entry points. Which baseline is compared against what, and is the comparison even reached before the
  overwrite?

### The task

**A1 — DETERMINE WHICH, with evidence.** Regression, or setup-dependent? The report must state one, name the
mechanism, and show the thing that decides it. *"Probably the setup"* is not an answer.
**A2 — Reproduce the overwrite** in a test that drives the real conflict path — the guest's bytes lost with
`conflictCopies.total === 0`. That reproduction is the deliverable even if the fix is small.
**A3 — Fix it so a guest's offline edit is never silently lost**, on **both** branches. Respect **I11:
refusal never destroys.** If you must choose, keep the bytes and leave clutter — the owner has been explicit
that functionality and reliability are what matter here.
**A4 — If it IS setup-dependent, say what the OTHER setup proves.** The earlier run's green was real. Two
setups giving two outcomes means the guard's precondition is narrower than anyone wrote down, and **naming
that precondition is worth more than the patch.**
**A5 — Do not weaken `S125`'s discard branch to make this pass.** Discarding a doc the guest never touched
is correct behaviour and was demonstrated live with its control.

---

## Package B — S151: the initiator's own disk lags its peers

An emptying reached **both peers' disks in 0.00 s while the initiator's own disk still held the old bytes.**

Small, and probably a write-ordering property rather than a defect — but it inverts an assumption the rig
and the product both make, that the originator settles first. **Anything that checks "did it land?" on the
initiator can currently report the opposite of the truth.**

**B1** — Establish whether the local write is deferred, debounced, or simply later in the sequence, with the
line. **B2** — State plainly whether it is a defect or a property. **A property, documented, is an
acceptable outcome** — an unexamined assumption is not. **B3** — If a debounce is involved, check it against
`S147`'s clamp: a debounce that is fine at 12 ms is not fine at 9 s.

---

## Both packages

**Falsifiability (Dispatcher Rule 11):** a break table per fix — plant, RED **for the right reason**,
restore byte-identically by copy-aside, GREEN. Zero `.pre-v2-smoke` files at the end.

**Gate:** full `vitest` + `tsc` clean, bracketed, and `check_signal_register.py` exit 0. Baseline
**3074 tests / 412 files**, measured by the Dispatcher on a quiet tree.
⚠ Two known instrument traps, neither yours to fix: `NEXT_FREE` is hardcoded at
`check_signal_register.py:53` **and** in the register; and **`S153` — WP92's `no_collateral` asserts a file
is absent from `git diff HEAD`, so it fails while your work is uncommitted and passes once you commit.**
If you meet it, that is what it is; **do not edit another package's test.**

**A facility you should use:** `plugin/src/__tests__/support/timer-clamp.ts` (WP114) runs a scenario under a
clamped-timer regime with growth and ordering jitter. If any part of what you touch is timer-scheduled,
**test it under the clamp** — `S147` showed that punctual-timer tests cannot express this class at all.
Prove the facility can turn your passing scenario red before trusting a failure from it.

**Method rules:**

1. **No partial test doubles.** Five packages lost to them. Drive the real object, or state exactly which
   paths your double does not exercise. **This package is especially exposed**: the defect is *"a thing that
   was never called"*, and a double that stands in for the caller will hide it perfectly.
2. **Demonstrated beats argued.** The bytes lost, the counter at zero, the call that never happened.
3. Every new test gets a positive control.
4. **Report A and B separately.**
5. **Correct this charter if it is wrong.** Four workers in a row have corrected their premise and all four
   were right; §"Leads" above is explicitly not findings.
6. **Signal numbers: next free is S155, and you allocate none.** <!-- signal-register: meta -->

**Hard constraints:**

- **Do not rebuild or deploy, and do not touch the three vaults.** The rig stays on build
  `1ddad2155341adbd` for the next live round.
- **Never run `npx biome check --write`** — it corrupts this tree.
- Never commit to a default branch. **Explicit path staging only — never `git add -A`.**
  `ARCHITECTURE.md`, `README.md`, `docs/security.md`, deleted `USER_STORIES.md` are the **owner's**.
- **`data.json` holds live credentials** — never print, log, echo or fixture a value.
- **You are the only worker in this tree, so a failure you see is REAL** (`S146`). Do not dismiss one as
  flaky without evidence.
- **Commit before you report.**

**Deliverable:** `workflowArtifacts/canvas-v2/ImplementationReport_WP115.md`.
