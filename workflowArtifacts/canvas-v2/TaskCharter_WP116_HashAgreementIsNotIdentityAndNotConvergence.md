# WP116 — Hash agreement is not identity, and it is not convergence

**Signals:** S158 (instrument, blocks the next live round) · S159 (data loss) ·
**Worker:** fresh context · **Branch:** `fix-bugs-and-raceconditions` · **Base:** `b5646e5`

Both packages come from one list: WP112's A4 census of every place this codebase reads *"the hashes match"*
as *"the state is right"*. They are the two members of that list that can **destroy data or hide its
destruction**, which is why they are chartered together and ahead of the rest.

The owner named the underlying property in one sentence: **hash agreement is evidence of agreement, not of
correctness.**

---

## Package A — S158: the convergence oracle cannot tell convergence from a shared loss

`e2e-control.ts:305` and `:1966` score two peers' `sha256` agreeing as **converged**.

**This project supplied its own counter-example.** Under `S119`, all three clients agreed perfectly on
`e3b0c442…` — the digest of the empty string — **while every `.md` in the share was being destroyed.** By
this oracle that run was a textbook pass.

An agreement oracle has **no reference point outside the peers**, so *"everyone has the right bytes"* and
*"everyone lost the same bytes"* are the same reading. **Every `converged` verdict in every validation
report this project has produced came from it.**

**This is why it is first: the next live round is queued behind it**, and that round exists to validate
three data-loss repairs. Validating them with an oracle that cannot see data loss is not worth doing.

### The task

**A1 — An oracle with an external reference point.** Convergence must be asserted against **what the bytes
are supposed to be**, not merely against what the other peer has. What that reference is, is your design
call — the gesture's intended content, a pre-recorded expectation, a non-empty precondition — but state it
and justify it.

**A2 — It must fail the `S119` scenario.** The acceptance test for this package: **feed it three peers that
agree on the empty digest for a file that had content, and it must report a FAILURE.** If it passes that
scenario, the repair has not happened. This is the positive control and it is not optional.

**A3 — Do not silently narrow what the rig can express.** Some comparisons legitimately are peer-to-peer
(*"did this reach B?"*). Distinguish *arrival* from *correctness* rather than deleting one; a rig that can
no longer answer a question it used to answer is a regression of a different kind.

**A4 — Say what this does to the existing reports.** You do not need to re-run anything. But state plainly
which past verdicts rested on the weak oracle, so a later reader is not misled by a green in
`ValidationReport_*.md`. **Do not edit those reports** — they are the record of what was believed on a day.

---

## Package B — S159: hash equality read as file identity

`utils.ts:142 matchRenamesByHash` and `manifest-removal-decision.ts:305 hasContentPair` pair a
**disappearance** with an **appearance** by content hash, and the **destructive half acts on the match**.

`hash("")` is a full digest like any other, so **two empty notes are interchangeable to the pairer.**

**Reachable, not theoretical:** `S119` left **18 zero-byte `.md` files** in one live vault — a supply of
mutually interchangeable identities sitting in exactly the state that triggers this. WP95 names the
*hostile* version of this collision; **the benign one is named nowhere.**

### The task

**B1 — Demonstrate the mispairing** and what the destructive half then does with it. Two same-content
files, one disappearing, one appearing, and the wrong pair chosen. Empty content is the obvious case;
**check whether it is only empty content or any duplicate** — two identical notes are ordinary in a vault
and the answer changes the severity.

**B2 — Fix it so content equality alone can never establish identity.** A guid, a path relationship, a
disambiguating refusal when the match is ambiguous — your call, justified. **When identity is ambiguous the
answer is REFUSE, not guess: I11, refusal never destroys.** Losing a rename's tidiness is recoverable;
acting on the wrong file is not.

**B3 — Do not break legitimate rename detection.** Renames are ordinary and users rely on them following.
`S135` was just repaired; a fix that stops renames propagating trades one defect for a worse one. Assert
the ordinary rename still works, in both states.

**B4 — WP95's hostile case must stay closed.** Read what it pinned and keep it pinned.

---

## Both packages

**Falsifiability (Dispatcher Rule 11):** a break table per fix — plant, RED **for the right reason**,
restore byte-identically by copy-aside, GREEN. Zero `.pre-v2-smoke` files at the end.

**Gate:** full `vitest` + `tsc` clean, bracketed, and `check_signal_register.py` exit 0. Baseline
**3112 tests / 416 files**, measured by the Dispatcher on a quiet tree at `b5646e5`.
**You are the only worker in this tree, so a failure you see is REAL** (`S146`). Known trap, not yours to
fix: `S153` — WP92's `no_collateral` asserts a file is absent from `git diff HEAD`, so it may fail while
your work is uncommitted and pass once you commit. **Do not edit another package's test.**

**Method rules:**

1. **No partial test doubles.** Six packages lost to them. Drive the real object, or state exactly which
   paths your double does not exercise.
2. **Demonstrated beats argued.** For A2 in particular: the oracle failing the `S119` scenario is the
   deliverable, not the code that intends to.
3. Every new test gets a positive control — **and note the recursion here: this package's product IS an
   oracle**, so "can this thing detect the failure it exists to detect?" is both your positive control and
   your acceptance criterion. `check_signal_register.py` does exactly this and is worth reading as a model.
4. **`S155`'s rule:** any ledger or counter you add increments on **every** branch, including do-nothing.
5. **Report A and B separately.**
6. **Correct this charter if it is wrong.** Five workers in a row have corrected the premise they were
   handed, and all five were right.
7. **Signal numbers: next free is S161, and you allocate none.** <!-- signal-register: meta -->

**A facility to use:** `plugin/src/__tests__/support/timer-clamp.ts` (WP114), for anything timer-scheduled.
Prove it can redden your scenario before trusting a failure from it.

**Hard constraints:**

- **Do not rebuild or deploy, and do not touch the three vaults.** The rig stays on `1ddad2155341adbd`.
- **Never run `npx biome check --write`** — it corrupts this tree.
- Never commit to a default branch. **Explicit path staging only — never `git add -A`.**
  `ARCHITECTURE.md`, `README.md`, `docs/security.md`, deleted `USER_STORIES.md` are the **owner's**.
- **`data.json` holds live credentials** — never print, log, echo or fixture a value.
- **Commit before you report.**

**Deliverable:** `workflowArtifacts/canvas-v2/ImplementationReport_WP116.md`.
