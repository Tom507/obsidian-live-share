# WP111 — The full live battery, with background throttling controlled for the first time

**Worker:** W4c, fresh context · **Branch:** `fix-bugs-and-raceconditions` · **Base:** `bc4a3bc`
**Role:** live validation in three real Obsidian vaults. You do not fix product code.

---

## 0. What is different about this round

**The machine is idle.** The owner has stepped away deliberately so this run has the PC to itself. You may
foreground, launch and focus windows freely. Nobody will type into a vault while you measure — if a file
changes with no gesture behind it, that is a finding, not the owner.

**The pinned build `d8f98603ad6ddb1c` is superseded.** Two packages landed after it (`39255ee`, `6b191d8`).
**Rebuild and install first**, and record the new sha — every measurement in this report must name it.

**The new variable, and it is the reason this round exists.** Obsidian is Electron, and Chromium throttles
**background** renderers — timers clamped, rAF paused. We run **six Obsidian processes on one machine**, so
at most one is ever foreground and **the rest are throttled by definition.** Every live latency number this
project has ever taken was measured under that condition, uncontrolled. It is a live candidate explanation
for the 78 s first canvas, the 0.70/1.08/**9.05** s spread on one delete, and — most importantly — for
`S134`'s live `observers:false`, which the unit-level fix could not reproduce.

---

## 1. Environment

- **Vaults** (the owner's real ones, playground-authorised): `H:\Developement\_NeuralAngels\ObsidianOrga`
  (**A**, port **39431**), `... - Kopie` (**B**, **39432**), `... - W4TestC` (**C**, **39433**).
- **E2E protocol:** `POST http://127.0.0.1:<port>/command`, body `{"cmd": "..."}` — the field is **`cmd`**,
  **not** `command`. A wrong field returns `{"ok":false,"error":"malformed body: 'cmd' must be a string"}`.
  **Always print the raw response**; a predecessor's parser printed "no answer" and hid exactly that error.
- **Tooling that already exists — use it, do not rewrite it:** `tools/obsidian_e2e/install.py`,
  `vaults.py`, `readiness.py`, `tools/launch_obsidian_e2e.py`, `tools/launch_liveshare_e2e.py`.
- **Build:** `cd plugin && npm run build:e2e` (or `build`), then install to all three vaults.
- Roles migrate between runs (`S139`). **Read the actual role from `session.info` before every arm** and
  report it; never assume the one from the last arm.

---

## 2. Throttling — the arm that has never been run

Run the battery **twice**, and this is the primary structural result of the package:

- **Arm CLEAN** — all instances launched with background throttling **disabled**:
  `--disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows`
- **Arm REAL** — launched **without** those flags, i.e. what a user actually runs, with the windows
  genuinely backgrounded (focus something else, or minimise) during the measured interval.

**Report every latency for both arms.** If they differ materially, then a share of what this project has
recorded as sync defects is Chromium power management, and several signals need re-reading. If they do not
differ, that is equally valuable and it retires the hypothesis. **Either outcome is a result — do not
prefer one.**

Confirm the flags actually took effect rather than assuming (a flag that a packaged Obsidian ignores is
this run's version of a partial test double). If you cannot make them take effect, **say so plainly and
run Arm REAL only** — an honest single arm beats two arms where one is fiction.

---

## 3. The falsifiable predictions — these are the point

Each was written down *before* this run. Report each as CONFIRMED / REFUTED / UNMEASURED, and **refuted is
a good outcome** — it is how we learn the unit fix was not the live cause.

**P1 — `S134`, host-born vs guest-born.** WP109 fixed seeding for the **active** file, and only the *host*
seeds. Prediction: **before** the fix only **host-born** mid-session notes broke; a note born on a **guest**
was always fine. **After** the fix both work. Test all four cells: {host-born, guest-born} × {is it
readable and convergent on the other two peers}. Create the note **during** a live session, edit it on all
three, and check convergence — do not settle for "the bytes arrived".

**P2 — `S143`, the live signature.** `attachObserver` is the **last** statement in `subscribe()`, and
`waitForSync`'s `catch { return; }` leaves `observers:false` **permanently** — no retry, no counter, no
log, until the next `startAll`. Prediction: **under Arm REAL (throttled), a subscribe can time out and the
file stays unsubscribed forever**, which is exactly the `observers:false`/`synced:false` reading measured
last round and which WP109 could **not** reproduce. Try to produce it: background a window across a
subscribe, then read `observers`/`synced` for that path, then wait and read again. **If it reproduces, that
is the largest finding of the round.**

**P3 — `S135`, cross-folder move.** Prediction: cross-folder moves now propagate, both roles, `.md` and
`.canvas`. **If they still do not**, grep the debug log for **`RENAME FOLLOW-UP FAILED:`** — a line that
did not exist when the original measurement was taken, and the reason that run could not attribute
anything. Report the endpoints it names.

**P4 — `S137`, attribution.** Empty-write refusals now reach the **debug log** as
`EMPTY WRITE REFUSED: arm=… path=… reason=…`. Prediction: any refusal this round is attributable to a path.
Also watch for `CONFLICT COPY FAILED:`. **If refusals fire on an ordinary rejoin again, name the files** —
that was impossible last time and is why `S137` is still open.

**P5 — regression, on the NEW build.** `S123` (a new canvas reaches **both** guests), `S125` (both
branches, including discard), `S126` (a real delete of a note **closed on the other peers** reaches them).
These passed on the old build; they must still pass on this one.

---

## 4. Instrument traps that have already cost this project runs

1. **`require('obsidian')` is NOT resolvable in the renderer.** It threw on every editor op last round and
   cascaded into a bogus "rename failed" chain; the run was correctly voided. Use the plugin's own control
   surface, not module resolution.
2. **`canvas.mirror` reports the LAST COMPLETED PASS, not current state** (`S138`). **Score canvas
   outcomes on disk bytes**, never on the verdict.
3. **A symmetric delay is not a latency test** (`S131`). All three clients are the same distance from the
   relay; do not present a symmetric-delay result as evidence about the first-arrival race.
4. **Verify a gesture did what you think before you attribute its result.** Last round's good `S126`
   evidence exists because the run confirmed the selection covered all 56 characters *before* sending the
   delete.
5. **A room is reaped at 24 h** (`S136`) and presents as an **authentication** failure. If everything says
   "invalid credentials", probe the relay directly with a negative control before concluding anything about
   auth — stored credentials → `403 Invalid room or token` vs wrong credentials → `403 Invalid server
   password` are different answers from the same route.
6. **Voiding your own run is a valid, respected outcome.** If the instrument was wrong, say so and discard
   the findings it produced rather than reporting them hedged.

---

## 5. Hard constraints — non-negotiable

- **`data.json` in every vault contains LIVE CREDENTIALS** (`serverPassword`, `token`, `jwt`,
  `encryptionPassphrase`, `encryptionSalt`). **Never print, log, echo, paste into a report, or place in a
  fixture.** Comparisons are **sha256-of-bytes only**. Naming a key is fine; naming a value is never.
  **No secret may pass through any agent tool** — not in a command string, not in an argument.
- **`sharedFolder` must stay `_liveshare-test` on all three. Never empty** — empty means the entire vault.
- Pre-existing `.bak` files in plugin directories are **the owner's**. Our copy-aside namespace is
  **`.pre-v2-smoke`**, and **zero may remain** at the end of the run.
- The stray third vault registration in `obsidian.json` is **user state — do not repair it.**
  `Projects/_external/FinaleAbgabe` is the owner's **thesis symlink — never delete or repair.**
- `ARCHITECTURE.md`, `README.md`, `docs/security.md`, deleted `USER_STORIES.md` are **the owner's** — never
  stage, revert or touch.
- **Never run `npx biome check --write`** — it corrupts this tree.
- Relay, if you touch it at all: compose must set `name: liveshare`, **never `--remove-orphans`**;
  `neural-angels-access` and `n8n` are protected containers.
- **Never commit to a default branch. Explicit path staging only — never `git add -A`.**
- **Signal numbers: next free is S147, and you allocate none.** <!-- signal-register: meta --> Describe
  findings in prose; the Dispatcher numbers them.
- **Leave the rig running and connected** at the end, shares back to the pre-existing file set, and say in
  the report exactly what state you left and any file you deliberately left behind as evidence.

---

## 6. Deliverable

`workflowArtifacts/canvas-v2/ValidationReport_WP111_LiveW4c.md`, and commit it.

Report **P1–P5 each with its verdict**, both throttling arms side by side, the new build sha on every
measurement, the roles as actually read, every anomaly you could not explain (recorded, not explained —
that discipline is why `S140` is honest), and a plain statement of what you did **not** get to.

**The owner's standing instruction: only functionality and reliability matter here.** Security findings are
**recorded, not chartered** — this is a trusted share between the owner's own machines.
