# WP120 — A presence lock needs a lifetime

**Signal:** WP119's A3, escalated and now **authorised by the owner** ·
**Branch:** `fix-bugs-and-raceconditions`

---

## 0. This work has already been done once — recover it, do not reinvent it

**WP119 built this repair, measured it green over six rows, and then reverted it** rather than break WP21
AC2's byte-unchanged pin on `canvas-presence.ts`. That was correct and it is why this package exists.

**Read `workflowArtifacts/canvas-v2/ImplementationReport_WP119.md` §4 first — the full design is there:**
origin-tagged claims, idle expiry swept on the awareness change **before** `reconcileClaims`, an injected
clock, and a 15 s idle window justified against the 200/500 ms capture cadence. Recover that design.
**If you disagree with any of it, say so with reasons** — a predecessor's measured design is a strong prior,
not an instruction.

## 1. The defect

`canvas-sync.ts:4130` claims a presence lock for **every node a local capture upserts** (via
`main.ts:2505`), and those claims have **no release path** — `emitHeld` can only release ids it put into
`held` itself. Combined with a clientID tiebreak that is **fixed for the session**, the losing peer loses
every contest, permanently. **That is why the owner's symptom went from "sporadic, and it fixed itself
after a while" to "every time, and it never recovers."**

WP119 shrank the *cost* of a stale claim from a whole-board `setData` to one per-node apply. **This package
removes the cause.**

## 2. The authorisation, and its exact limits

`BUILD_SPEC` §*"`canvas-presence.ts` — the byte-unchanged pin is LIFTED for one repair"*, owner decision
2026-08-08. Read it.

- **Authorised:** giving presence locks a lifetime, in the shape above.
- **NOT authorised:** anything else in that file. It is load-bearing for **I11** and the single-writer rule.
- **⚠ THE PIN MUST BE RE-ESTABLISHED, NOT REMOVED.** Update the digest to the new content **in the same
  commit**. **A pin deleted to make a change pass is a guard that silently stops guarding** — that is
  `S162`'s shape, and this initiative has already been bitten by a test that pinned a defect.

## 3. Acceptance

**A1 — A claim has a lifetime.** A lock acquired for a node a capture merely touched is released without a
gesture, a restart or a teardown. Demonstrated with the clock driven, not slept on.

**A2 — Self-healing is restored, and this is the owner's own criterion.** After a peer holds stale claims,
the system returns to normal **by itself**. The owner remembers this behaviour existing once — *"it also
fixed itself after a while"* — so the bar is that it does again.

**A3 — A REAL claim is not expired out from under a user.** Someone actively dragging or editing a card
must keep their claim for as long as they are working. **An expiry that fires mid-gesture is worse than the
leak** — it hands the card to someone else while the user is holding it. Assert this with a positive
control, and justify the idle window against the real capture cadence rather than picking a round number.

**A4 — Contested edits still resolve.** The presence system exists so two people do not fight over one
card. WP119's break table shows a change here can pass the headline test while breaking exactly this, so
prove it: two clients on one card, the contest resolves, the loser converges.

**A5 — Do not widen the blast radius.** `revertCanvasNode` now does one per-node apply (WP119). Nothing
here may route back to a whole-board `setData`, and **nothing may make `coldOpen` / `doc-wins` reachable
more often** — that path destroyed 318 nodes of a real board yesterday and has **no conflict copy under
it**. If your change alters how often a canvas file is written, **stop and say so**.

## 4. Method and gate

**Falsifiability (Dispatcher Rule 11):** a break table — plant, RED **for the right reason**, restore
byte-identically by copy-aside, GREEN. Zero `.pre-v2-smoke` files at the end.
**Include a plant that expires a live claim mid-gesture** and show A3's rows go red — that is the failure
mode this package can introduce, so it is the one your table must be able to catch.

**Gate:** full `vitest` + `tsc` clean, bracketed, `npm run build` clean, and `check_signal_register.py`
exit 0. Baseline **3260 tests / 428 files**, measured by the Dispatcher on a quiet tree at `d188b0e`.
**You are the only worker in this tree, so a failure you see is REAL** (`S146`) — but re-run any RED on its
own before attributing it. Known trap: **`S153`**, WP92's `no_collateral` goes red while your work is
uncommitted and green once committed. **Do not edit another package's test.**

**Rules:**

1. **Demonstrated beats argued.** The claim that expired, the user whose claim did not.
2. **No partial test doubles** — six packages lost to them. Drive the real object or state which paths your
   double does not exercise.
3. Every new test gets a positive control.
4. **Correct this charter if it is wrong.** Eight workers in a row have corrected the premise handed to
   them and every one of them was right.
5. **Signal numbers: next free is S173, and you allocate none.** <!-- signal-register: meta -->

**Hard constraints:**

- **Do not rebuild, redeploy, or drive the three live vaults** — a live tester may still hold them.
- **Never `npx biome check --write`** — it corrupts this tree.
- Never commit to a default branch. **Explicit path staging only.** `ARCHITECTURE.md`, `README.md`,
  `docs/security.md`, deleted `USER_STORIES.md` are the **owner's**.
- **`data.json` holds live credentials** — never print, log, echo or fixture a value.
- **Commit before you report**, with the re-established pin digest in that same commit.

**Deliverable:** `workflowArtifacts/canvas-v2/ImplementationReport_WP120.md`.
