# WP118 — The second live battery: five repairs and one new capability, none of them seen live

**Worker:** W4d, fresh context · **Branch:** `fix-bugs-and-raceconditions` · **Base:** `56dc41d`
**Role:** live validation in three real Obsidian vaults. **You do not fix product code.**

Unit gate at base, measured by the Dispatcher on a quiet tree: **3243 tests / 427 files, `tsc` clean,
server suite 149/149, register exit 0.**

---

## 0. Two prerequisites, in this order, before any measurement

**1. Rebuild and install.** Five packages have landed since `1ddad2155341adbd`. Build, install to all three
vaults, **read back byte-for-byte**, and record the new sha. **Every measurement in your report names it.**

**2. REDEPLOY THE RELAY — `S169`, and it is a hard blocker.** The server's `ALLOWED_TYPES` is a **closed
set**, so the currently deployed relay **silently drops both new canvas-create message types**. Without
this, the headline capability cannot be tested and you will spend an arm discovering it.

> **Relay rules — absolute.** Compose **must** set `name: liveshare`. **Never** pass `--remove-orphans`.
> `neural-angels-access` and `n8n` are **protected containers** — do not stop, restart, recreate or touch
> them. Verify they are still running after your deploy and **say so in the report**. If you cannot deploy
> safely under these rules, **stop and report** rather than improvising.

Note what a redeploy costs: it **reaps existing rooms**, so expect `S136`'s symptom (a dead room presenting
as an authentication failure). That is known — do not spend time diagnosing it. Start a fresh session.

---

## 1. Environment

- **Vaults** (the owner's real ones, playground-authorised): `H:\Developement\_NeuralAngels\ObsidianOrga`
  (**A**, port **39431**), `... - Kopie` (**B**, **39432**), `... - W4TestC` (**C**, **39433**).
- **E2E protocol:** `POST http://127.0.0.1:<port>/command`, body `{"cmd": "..."}` — **`cmd`**, not
  `command`. **Always print the raw response.**
- Existing tooling — use it, do not rewrite it: `tools/obsidian_e2e/install.py`, `vaults.py`,
  `readiness.py`, `tools/launch_obsidian_e2e.py`, `tools/launch_liveshare_e2e.py`.
- **Roles migrate between runs (`S139`).** Read the role from `session.info` at the start and end of every
  arm and report it. Never assume.

---

## 2. Run everything in BOTH throttling arms

`S147` established that this is not optional: in the ordinary three-window setup **all three renderers are
`hidden`**, and the clamp reaches **9 s/hop after ten minutes**.

- **Arm CLEAN** — `--disable-background-timer-throttling --disable-renderer-backgrounding
  --disable-backgrounding-occluded-windows`. Verify on the renderer command lines **and** functionally
  (chained `setTimeout(…,0)` hops); the last two are browser-process switches and an argv-only census
  would call them inert.
- **Arm REAL** — no flags, windows genuinely backgrounded. **This is the arm that matters** — it is what
  the owner runs.

---

## 3. The predictions — each CONFIRMED / REFUTED / UNMEASURED. Refuted is a good outcome.

**P1 — `S147` (WP114).** Under **REAL**, a burst of mid-session host-created notes reads `docExists: true`
and `observers: true` on **both** guests inside the window — against the previous **16 of 16 unsubscribed**.
And `link.break` + `link.restore` reports `resubscribed > 0` and **delivers a subsequent host edit**.
⚠ `link.break`'s grammar is `{link, shape}` (`S152`) — two signals previously misread it as `shape="mux"`
and a refused command scored as *"no severance happened"*.
⚠ **`S165`:** recovery is wired **only** to the `rearmSharing` gesture, **not** to reconnect. So test both:
does it recover on its own, and does it recover when the gesture is issued? The second is what shipped.

**P2 — `S148` (WP115), and this needs BOTH setups because the defect was setup-dependent.**
(a) **close Obsidian → edit on disk → reopen** — the setup that historically passed;
(b) **`Leave session`, Obsidian left running → write on disk → rejoin** — the setup that lost the bytes.
**The guest's edit must survive both.** Grep for **`CONFLICT COPY SKIPPED:`** — new, never seen live — and
report both clocks it carries.

**P3 — `S122` (WP117), the headline new capability.** A **guest** creates a `.canvas` in the shared folder
and it becomes real for **every** peer, byte-identical, with the originator converged onto the **host's**
document. Then the same for an **imported** canvas. Known limits, do not report them as surprises:
**`S168`** an *empty* canvas reaches the host but not a third peer until it holds one card;
**`S167`** anything over **512 KB** is refused before a frame is sent.
⚠ **Score canvas outcomes on DISK BYTES** — `canvas.mirror` reports the last completed pass (`S138`).

**P4 — `S141` (WP112) and the new refusal lines.** Grep the debug log for **`ATTESTATION REFUSED`**,
**`SINGLE-WRITER DECLINE`**, **`EMPTY WRITE REFUSED:`**, **`RENAME FOLLOW-UP FAILED:`** and the
`path-outcome` lines. Also read `sync.attestationDecisions` and `sync.singleWriterDeclines` off the e2e
surface. **Prove your reader can match something before reporting a zero** — `S137`'s zeros were only
meaningful because `MUTE OVERRUN` was matched in the same window.

**P5 — regression on the new build.** `S134` (mid-session notes converge), `S135` (cross-folder `.md`
moves, both roles), `S123`, `S126`. These passed before; they must still pass.

---

## 4. Use the new oracle — this is not optional

WP116 replaced the convergence oracle. **`CONVERGED` is unreachable without an `ExpectedContent`**, and an
existing file holding zero bytes is a **FAILURE** unless the emptiness was explicitly asserted.

- **Record every expectation BEFORE the gesture** (WP116 R1: `origin` is provenance, not proof). An
  expectation read off a peer afterwards is the old oracle wearing a new name.
- **`convergence.judge` is exposed as a command but is NOT yet wired into `tools/e2e/*.py`** (`S161` R2).
  Wire it, or state plainly that you judged by hand and how.
- **Never assert convergence by comparing peers to each other.** That oracle passed `S119` while every
  `.md` in the vault was being destroyed.

---

## 5. Instrument traps that have already cost this project runs

1. **`require('obsidian')` is NOT resolvable in the renderer** — it voided an entire run.
2. **`app.commands.executeCommandById('editor:select-all')` returns `false`** in this build — go through
   the Editor API and **assert the selection covers what you think** before acting on it.
3. **`canvas.mirror` reports the last completed pass** (`S138`) — score on disk bytes.
4. **A symmetric delay is not a latency test** (`S131`).
5. **`observers: true` no longer means a path is healthy** (`S164`) — five exits leave the observer
   attached with the reconciliation unrun. Check `docExists` and convergence too.
6. **Voiding your own run is a respected outcome.** Two predecessors did it and both were right.

---

## 6. Hard constraints — non-negotiable

- **`data.json` in every vault contains LIVE CREDENTIALS** (`serverPassword`, `token`, `jwt`,
  `encryptionPassphrase`, `encryptionSalt`). **Never print, log, echo, paste into a report or fixture
  them.** sha256-of-bytes comparisons only. Naming a key is fine; a value never. **No secret through any
  agent tool** — not in a command string, not in an argument, not in `ssh_args`.
- **`sharedFolder` stays `_liveshare-test` on all three. Never empty** — empty shares the entire vault.
- `.bak` files in plugin directories are **the owner's**. Our namespace is **`.pre-v2-smoke`** and **zero
  may remain**.
- The stray third vault registration in `obsidian.json` is **user state — do not repair.**
  `Projects/_external/FinaleAbgabe` is the owner's **thesis symlink — never touch.**
- `ARCHITECTURE.md`, `README.md`, `docs/security.md`, deleted `USER_STORIES.md` are **the owner's**.
- **Never `npx biome check --write`.** Never commit to a default branch. **Explicit path staging only.**
- **Signal numbers: next free is S170, and you allocate none.** <!-- signal-register: meta -->
- **Leave the rig running and connected**, shares back to the pre-existing file set, and state exactly what
  you left and anything deliberately left as evidence.

**The owner's standing instruction: only functionality and reliability matter. Security findings are
recorded, not chartered** — this is a trusted share between the owner's own machines.

---

## 7. Deliverable

`workflowArtifacts/canvas-v2/ValidationReport_WP118_LiveW4d.md`, committed.

**P1–P5 each with its verdict**, both arms side by side, the new build sha on every measurement, the relay
deploy confirmed safe with the protected containers verified still running, the roles as actually read,
every anomaly you could not explain (**recorded, not explained**), and a plain statement of what you did
not get to.
