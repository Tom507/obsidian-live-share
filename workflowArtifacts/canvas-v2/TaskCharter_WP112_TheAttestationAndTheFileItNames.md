# WP112 — The attestation and the file it names

**Signals:** S141 (potentially P0) · S142 · **Worker:** fresh context · **Branch:** `fix-bugs-and-raceconditions`

Both packages are about `BackgroundSync` publishing or writing on behalf of a file whose real bytes it did
not consult.

---

## Package A — S141: the empty-write floor defeated through the front door of its own guard

### What is known, and the exact limit of it

`background-sync.ts:304`, inside `setActiveFile`:

```ts
const content = docHandle.text.toString();          // ← the CRDT DOCUMENT
void this.writeToDisk(oldActive, content, this.currentSeq(oldActive));
if (this.role === "host") {
  const file = getFileByPath(this.vault, toLocalPath(oldActive));
  if (file) void this.manifestManager.updateFile(file, content);   // ← UNFLOORED publish
}
```

**The host hashes a different object than the one it names.** `content` comes from the document; the
attestation is published against `file`. When the doc is legitimately empty and the file has bytes, the
host publishes *"this file is empty"* about a file that is not.

The guest's floor then behaves **correctly and still loses the data**: `syncFromManifest`'s evidence test is
`hashContent(content) === entry.hash`, and with `content === ""` against `entry.hash === hash("")` that is
**true**. The write is not empty-*looking* to the floor, so it proceeds. **S119's outcome, reached through
the guard built to stop S119.**

**The honest limit: this is TRACED IN CODE, NOT MEASURED.** WP109 removed the producer it knew about. The
entry was deliberately not closed because **the path survives its producer** — the floor is still defeasible
by *any* producer of an empty-content attestation.

### The task

**A1 — DEMONSTRATE IT, and this is the package's centre of gravity.** A test in which a host publishes an
attestation of empty content for a file that has bytes, and a guest consequently writes empty over its own
non-empty file — **with the floor active and not firing.** Not a re-trace, not a reachability argument: the
executed write and the lost bytes.

**If it cannot be demonstrated on current `HEAD`, that is a legitimate and valuable outcome** — but then
you must say which property now prevents it, name the line, and prove that line is what stops it (remove
it, watch the demonstration succeed, restore it). *"I could not build it"* and *"it cannot happen"* are
different claims and the report must not blur them.

**A2 — Census the producers.** Every call that publishes an attestation — `updateFile` and any sibling —
audited for whether its content argument is derived from **the bytes it attests about**. Derive the list
from source; do not hand-list it. WP109 removed one producer; the question is how many there are.

**A3 — Fix at the producer.** An attestation must be derived from the file it names, or must not be
published. A floor on the publish path is the shape to aim for — the same discipline as the write path,
which already has one. **Do not fix this by hardening the consumer**: the guest's evidence test is not
wrong, it is being told the truth about the wrong thing.

**A4 — The deeper property, stated because the owner raised it.** Hash agreement is evidence of
**agreement**, not of **correctness** — `""` matching `hash("")` proves the transmission was faithful and
nothing else. Where else does this codebase treat "the hashes match" as "the state is right"? Report the
list. **Do not fix them in this package** — the list is the deliverable.

---

## Package B — S142: the guest arm has no active-file guard at all

`subscribe()`'s **guest** arm has no equivalent of the host arm's active-file check, so the same
single-writer violation exists in the other role — where the editor also owns the disk copy. Pre-existing,
untouched by WP109, which correctly declined to widen a branch it was not chartered for.

**B1** — Demonstrate the violation: the guest arm writing the disk copy of the file the editor owns.
**B2** — Fix it in the shape WP109 established for the host arm — the invariant as an **explicit branch a
test can point at**, not as a side effect of where a guard happens to sit. That placement is what caused
S134; do not reproduce it.
**B3** — Guests do not seed, so verify you have not introduced a case where a guest's file never converges.

---

## Both packages

**Falsifiability (Dispatcher Rule 11):** a break table per fix — plant, RED **for the right reason**,
restore byte-identically by copy-aside, GREEN. Zero `.pre-v2-smoke` files at the end.

**Gate:** full `vitest` + `tsc` clean, bracketed, and `check_signal_register.py` exit 0. Baseline is
**3092 tests / 414 files**, measured by the Dispatcher on a quiet tree at `ab3741e`.
**You are the only worker in this tree, so a failure you see is REAL** (`S146`) — do not dismiss one as
flaky without evidence. Two known instrument traps, neither yours to fix: `S153`, WP92's `no_collateral`
asserts a file is absent from `git diff HEAD`, so it can fail while your work is uncommitted and pass once
you commit; and `NEXT_FREE` is hardcoded in `check_signal_register.py` as well as in the register.
⚠ **If the checker fails on a number you did not cite, note that `NEXT_FREE` is hardcoded at
`check_signal_register.py:53` as well as in the register — that coupling is recorded, not yours to fix.**

**Two things learned since this charter was written, both of which bear on it directly:**

- **`S155` — a counter that does not increment on every branch makes silence ambiguous.** WP115 lost a
  round to exactly this: a guard's do-nothing branch returned *before* every counter, so *"ran and
  declined"* and *"was never called"* produced byte-identical readings and three readers in a row got it
  wrong. **Any ledger you add or touch here must count the do-nothing case too.** This matters especially
  for A1: you are hunting a floor that may be *deciding* rather than *absent*.
- **`plugin/src/__tests__/support/timer-clamp.ts`** (WP114) runs a scenario under clamped timers with
  growth and ordering jitter. If any path you touch is timer-scheduled, test it under the clamp — and
  prove the facility can turn your passing scenario red before trusting a failure from it.

**Method rules:**

1. **No partial test doubles.** They silently skip whole code paths and have cost **five** packages in this
   run. Drive the real object, or state exactly which paths your double does not exercise.
2. **Demonstrated beats argued** — this package exists *because* its signal was only traced.
3. Every new test gets a positive control. A green that could not have gone red is not a measurement.
4. **Report A and B separately**, each with its own evidence.
5. **Correct this charter if it is wrong.** The last three workers all corrected the premise they were
   given and all three were right to. Say so in the report rather than working around it.
6. **Signal numbers: next free is S147, and you allocate none.** <!-- signal-register: meta -->

**Hard constraints:**

- **Do not rebuild or deploy the plugin, and do not touch the vaults** — a live validation round owns the
  rig. Code plus unit/harness tests only.
- **Never run `npx biome check --write`** — it corrupts this tree.
- Never commit to a default branch. **Explicit path staging only — never `git add -A`.**
  `ARCHITECTURE.md`, `README.md`, `docs/security.md`, deleted `USER_STORIES.md` are the **owner's**.
- **`data.json` holds live credentials** — never print, log, echo or fixture a value.
- **Commit before you report.**

**Deliverable:** `workflowArtifacts/canvas-v2/ImplementationReport_WP112.md`.
