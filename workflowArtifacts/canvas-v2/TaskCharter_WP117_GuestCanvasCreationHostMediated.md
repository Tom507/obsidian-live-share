# WP117 — Guest canvas creation, host-mediated

**Signals:** S122 (owner-required capability) · the AC6 residual, which closes with it ·
**Worker:** fresh context · **Branch:** `fix-bugs-and-raceconditions` · **Base:** `07899ab`

---

## 0. Read the spec first — the design is already decided

**`workflowArtifacts/BUILD_SPEC_ObsidianLiveShare.md` §7, "Guest canvas creation — REQUIRED, owner decision
2026-08-07".** It is authoritative: it states the capability, the sanctioned design, five numbered
implementation requirements, and the residual that must close with it. **This charter does not restate it —
read it.**

The owner's words, because they set the bar: *"let any guest initialise new canvases, this is a big
limitation if it doesn't work"* and *"new or imported"*. **Import is in scope, not a follow-up.**

**Confirmed still broken:** WP111 reproduced S122 unchanged in **both** throttling arms — a guest-created
`.canvas` reached no peer, in a live session, on the current build.

---

## 1. Why the design is what it is — do not re-litigate it

A guest-created `.canvas` is refused by **three doors at once**, and **two of them are correct**:

| Door | Refusal | Verdict |
|---|---|---|
| manifest `updateFile` | `role === "host"` | correct — the host is the sole manifest writer |
| content push | `skipsAutoTextSync` | correct — WP83; a raw character-merge corrupts a canvas |
| **guid mint** | `role !== "host" → null` | **this is the owner of the hole** |

**Host-mediated creation preserves seed authority rather than moving it**, which is precisely why it was
sanctioned. A content-free variant (announce the path, let the originating guest seed from its own file)
**was declined twice** — it hands seeding to guests, which makes the residual below worse instead of
closing it. If you believe the sanctioned design is wrong, **say so in the report with your reasoning; do
not quietly implement the declined variant.**

---

## 2. The residual that closes with it — and it is real data loss

`canvas-sync.ts` computes `peerKnowsDoc` as *"did bytes arrive across the await"*, which under `NO_PEERS`
(`S131`) is `false`, so `decideSeed` can return `SEED_FROM_FILE`. A guest holding a **stale** canvas that
wins the subscribe race seeds its stale content; the host's later subscribe sees a non-empty document,
`doc-wins`, and **the host's canvas is overwritten.**

**If guests never seed, this closes with the main work.** Demonstrate that it is closed — do not assert it.

---

## 3. Acceptance

**A1 — A guest creates a `.canvas` in the shared folder and it becomes real for every peer**: host and both
guests, byte-identical, with the originating guest converged onto **the host's** document.

**A2 — Import is covered.** A canvas imported (not authored in-place) reaches every peer.

**A3 — The host validates before acting**: `isPathSafe`, `isSharedPath`, `isProtectedPath`, and a size
bound. A guest is not trusted to name a path.

**A4 — A refusal reaches the guest and is visible to the user.** A silently dropped creation is `S114`'s
shape: the user made a canvas, nothing happened, nothing said why. **Counted and logged too** — and per
`S155`, **count every branch including the do-nothing one.**

**A5 — Size.** The shared boards in this project's own vault reach **45 KB** and an import can be far
larger. The existing binary transfer chunks at 50 MB; do not assume small. State what happens at the bound.

**A6 — The originating guest adopts rather than keeps a private copy.** Its local file already exists, so
the mirror's `SKIP_LOCAL_FILE` verdict is **wrong for this case** and must be replaced by an adopt path.
Note `S138`: `canvas.mirror` reports the last completed pass, so **score on disk bytes, not on the verdict.**

**A7 — The residual is demonstrated closed**, with the `NO_PEERS` condition actually induced rather than
argued about.

**A8 — The three invariants still hold, asserted rather than assumed:** WP83 (a `.canvas` is never synced
as raw text — the handoff is a one-shot structured transfer over the control channel), host-only manifest
authority, and single-writer (exactly one peer seeds, and it is the same peer that always did).

---

## 4. Method

**Falsifiability (Dispatcher Rule 11):** a break table — plant, RED **for the right reason**, restore
byte-identically by copy-aside, GREEN. Zero `.pre-v2-smoke` files at the end.

**Gate:** full `vitest` + `tsc` clean, bracketed, and `check_signal_register.py` exit 0. Baseline
**3184 tests / 421 files**, measured by the Dispatcher on a quiet tree at `07899ab`.
**You are the only worker in this tree, so a failure you see is REAL** (`S146`). **`S153` is confirmed three
times in both directions:** WP92's `no_collateral` goes red while your work is uncommitted and green once you
commit. **Do not edit another package's test.**

**Facilities and traps you inherit:**

- `plugin/src/__tests__/support/timer-clamp.ts` (WP114) — for anything timer-scheduled. Prove it can redden
  your scenario before trusting a failure from it.
- **The convergence oracle now takes an expectation** (WP116): `CONVERGED` is unreachable without one, and
  an existing file holding zero bytes is a failure unless the emptiness was asserted. **Use it. Do not
  assert convergence by comparing peers to each other** — that oracle passed `S119` while every note was
  being destroyed.
- **`S164`** — `observers: true` no longer means a path is fine; five exits leave the observer attached and
  the reconciliation unrun.
- Partial test doubles have cost **six** packages. Drive the real object, or state exactly which paths your
  double does not exercise.

**Rules:**

1. **Demonstrated beats argued** — especially A7.
2. Every new test gets a positive control.
3. **Report each acceptance criterion separately**, including any you could not meet.
4. **Correct this charter, or the spec, if either is wrong.** Six workers in a row have corrected the
   premise they were handed and all six were right. **If the spec is wrong, say so — it is the owner's
   document and a correction is worth more than a workaround.**
5. **Signal numbers: next free is S166, and you allocate none.** <!-- signal-register: meta -->

**Hard constraints:**

- **Do not rebuild or deploy, and do not touch the three vaults.** The rig stays on `1ddad2155341adbd`.
- **Never run `npx biome check --write`** — it corrupts this tree.
- Never commit to a default branch. **Explicit path staging only — never `git add -A`.**
  `ARCHITECTURE.md`, `README.md`, `docs/security.md`, deleted `USER_STORIES.md` are the **owner's**.
- **`data.json` holds live credentials** — never print, log, echo or fixture a value.
- **Commit before you report.**

**Deliverable:** `workflowArtifacts/canvas-v2/ImplementationReport_WP117.md`.
