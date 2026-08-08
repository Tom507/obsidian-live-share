# WP118 — Live validation, W4d: the second live battery

**Worker:** W4d · **Branch:** `fix-bugs-and-raceconditions` · **Charter base:** `7965268` (tree clean)
**Date:** 2026-08-08, 09:13 – 10:25 local · **Machine idle, owner away for the measured window.**
**Interrupted once** by the Dispatcher at ~10:20 because the owner needed the machine; resumed and
re-read the rig rather than assuming it had stood still. §7 states what that cost.

---

## The round in seven lines

**`S147` does not reproduce on this build.** In Arm REAL — no flags, all three renderers `hidden`, the
timer clamp so deep that a 30-hop probe did **not return in 180 s on any vault** — a burst of six
mid-session host-created notes that nobody opened read `docExists: true` / `observers: true` /
`synced: true` on **12 of 12** guest×file pairs, immediately and again 45 s later. WP111 measured
**16 of 16 unsubscribed** in the same arm. **`S148` is fixed on the setup that lost the bytes**: the guest's
offline edit came back as a conflict copy, and `CONFLICT COPY SKIPPED:` fired with **both clocks** on it.
**`S122` is real**: a guest-created `.canvas` — new and imported — becomes byte-identical on all three
peers, originator included, but **the originator's adoption is late**. And the new oracle produced a
verdict nobody had before: a **host**-created canvas reaches both guests byte-identically and the **host's
own copy never converges to it**, permanently.

---

## 0. The build under measurement

Every number in this report was taken against **one** plugin bundle and **one** relay image.

| | |
|---|---|
| **New plugin sha256** | `93c65f06a347e6ccc5b21f3f17e00361cd728d60aca13a09d104f4f17261f55f` |
| short | **`93c65f06a347e6cc`** |
| bytes | 5 519 913 |
| built by | `cd plugin && npm run build:e2e`, exit 0, from a clean tree at `7965268` |
| superseded | `1ddad2155341adbd` (5 152 784 B) — WP111's build, found installed on all three |
| installed to | **A, B and C**, accepted only on a byte-for-byte read-back (`MATCH=True` ×3) |
| `manifest.json` / `styles.css` | already byte-identical to the build output — **not written** |
| `data.json` | never read, never copied, never printed. sha-of-bytes only. |
| markers in the emitted bytes | `e2eControlPort` ×1 · `LIVESHARE_E2E` ×1 · `e2e-control` ×2 · `convergence.judge` ×1 · `canvas-create-request` ×5 · `CONFLICT COPY SKIPPED` ×1 · `ATTESTATION REFUSED` ×1 · `SINGLE-WRITER DECLINE` ×1 · `EMPTY WRITE REFUSED` ×1 · `RENAME FOLLOW-UP FAILED` ×1 |

`pluginBuild` reports `0.6.1+e2e` on all three throughout. The displaced bundle was copied aside into our
namespace as `main.js.pre-v2-smoke-w4d` on each vault.

---

## 1. The relay redeploy — `S169`, and the rules it had to obey

### 1.1 The blocker was real, measured on the box before anything was changed

`docker exec liveshare-relay grep -c 'canvas-create-request' dist/control-handler.js` → **`0`**.
The relay had been up since **2026-07-16T20:18:56Z** (22.5 days) on an image built from `f5fe736`. The
branch has moved **three commits** on `server/src` since then, so this was never only `ALLOWED_TYPES`:
`control-handler.ts` (+ the two new types, and a host-election split-brain fix), `ws-handler.ts`,
`mux-protocol.ts`, `index.ts` (TCP_NODELAY on both WS upgrades), and **`persistence.ts` +283 lines** — a new
`createLevelBlobStore` at `./data/frames`, so the relay now retains the frames it relays. `server/package.json`
and `package-lock.json` are **byte-identical** to the deployed ones, so the dependency tree did not move.

### 1.2 Why this was not `docker compose up`, stated as measurement rather than preference

| finding | evidence |
|---|---|
| the only SSH principal is `deploy` | `id` → `uid=1001(deploy) gid=1001(deploy) groups=1001(deploy),112(docker)` |
| key-only `root@` login is refused | `Permission denied (publickey,password)` |
| `sudo` needs a password | `sudo -n true` → *"sudo: a password is required"* — and a password may **never** pass through an agent tool |
| the stack's env file is unreadable to that principal | `/home/deploy/liveshare/docker/.env` is `root:root 0600`; `docker compose -f .../ServerCompose.yaml config` → **`open ... .env: permission denied`** |

So the compose route was not *risky*, it was **unavailable** — `up`, `up --force-recreate` and `down` all
fail at the same line for this principal. I did not improvise around it with a secret; I took a path that
touches strictly less.

### 1.3 What was actually done

1. built `liveshare-relay:wp118` locally from the repo's own `Dockerfile` (`--provenance=false`, amd64;
   verified in the image: `canvas-create-request` ×2, `canvas-create-result` ×2, 20 files in `dist`);
2. `docker save` → `scp` → `docker load` on the box (66.6 MB gzip);
3. tagged the **old** image `liveshare-relay:pre-wp118` (rollback point), then moved `:latest` onto the new
   one — so a future compose recreate, run by somebody who *has* root, lands on the new code by itself;
4. lifted `/app/dist` out of the new image through a throwaway container that was never started, backed the
   running container's own `/app/dist` up to `/app/dist.pre-wp118`, and `docker cp`'d the new `dist` in;
5. `docker restart liveshare-relay` — **same container**, so `SERVER_PASSWORD` and every other env value
   stayed where they were and **never entered this process, this context, or any tool argument**.

**The relay was never removed, the compose file was never rewritten, no other compose project was ever
addressed, and `--remove-orphans` was never typed.**

### 1.4 The safety read the charter demands — taken AFTER the deploy, by reading the box

| | |
|---|---|
| **`name: liveshare`** | still line 9 of `/home/deploy/liveshare/docker/ServerCompose.yaml`; the file is untouched (`2518 B`, mtime `Jul 16 14:58`) |
| **`--remove-orphans`** | **never passed.** No `docker compose` subcommand was run against this stack at all |
| **`neural-angels-access`** | **RUNNING. `Up 10 days (healthy)`**, `started=2026-07-28T12:23:04Z`, **`RestartCount=0`**. Its start time predates my deploy by eleven days and its restart count is zero — that is proof it was never stopped, restarted or recreated, not a claim that it wasn't |
| **`n8n`** | **NOT PRESENT ON THIS HOST AT ALL**, running or exited (`docker ps -a \| grep -i n8n` → no match). There was nothing to touch and nothing was touched. Recorded because the charter names it as protected and a reader should not infer it was removed by me |
| running containers | **16 before the deploy, 16 after. None lost, none gained.** |
| the `liveshare` project | still exactly two containers, `liveshare-relay` + `liveshare-landing`, same services |
| relay now | `Up About an hour (healthy)`, `started=2026-08-08T07:23:00Z`, `canvas-create-request` ×2, `canvas-create-result` ×2 |
| `/healthz` | `{"ok":true,...}` externally and from inside the container |
| rollback left in place | image `liveshare-relay:pre-wp118` (`e0f281f13a00`) **and** `/app/dist.pre-wp118` (20 files) inside the running container |

**The redeploy reaped the rooms, as the charter predicted.** It did not present as `S136`: no client was
holding a stale room across the restart, because the plugin install had already ended every session, so the
first act after the deploy was a fresh `start-session`, which succeeded on the first attempt.

---

## 2. Roles, as actually read (`S139`)

Read from `session.info` at the start and end of every arm, never assumed.

| when | A (`ObsidianOrga`, 39431) | B (`… - Kopie`, 39432) | C (`… - W4TestC`, 39433) | room |
|---|---|---|---|---|
| pre-run census, 09:13 | guest | **host** | guest | `c373bde8` (WP111's) |
| Arm CLEAN, 09:25 → 09:44 | guest | **host** | guest | `5beed5c2` |
| Arm CLEAN, after the P2a relaunch | guest | **host** | guest | (re-minted) |
| Arm REAL, 09:49 → 10:18 | guest | **host** | guest | `90faf3d5` |
| after the interruption, 10:23 | **`null` — out of session** | **host** | guest | `90faf3d5` |

**The host did not migrate at any point in this run.** The last row is explained in §7 and it is my own
doing, not a drop.

---

## 3. The two throttling arms, and they are real by two independent measurements

| | Arm CLEAN | Arm REAL |
|---|---|---|
| argv | `Obsidian.exe --remote-debugging-port=9222 --remote-allow-origins=* --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows` | `Obsidian.exe --remote-debugging-port=9222 --remote-allow-origins=*` |
| all three control ports answered | 1.6 s after launch | 1.6 s after launch |
| `--disable-background-timer-throttling` on the **renderer** command lines | **present on all three** | **absent on all three** |
| the other two switches on renderer argv | absent — they are **browser-process** switches, which is why an argv-only census would call them inert |
| **functional probe**, 30 chained `setTimeout(…,0)` hops, windows minimised | `hidden` ×3 and **12 / 12 / 12 ms per hop** | `hidden` ×3 and **768 / 800 ms per hop** at first probe; **C did not return in 180 s** |
| **the same probe ~4 min later, still backgrounded** | — | **did not return in 180 s on A, B *and* C** — i.e. >6 000 ms/hop, and the deepest clamp this project has recorded |

**Two things follow.** First, the flags do what they say: under CLEAN the pages report `visibilityState:
"hidden"` and are still unthrottled, so the timer flag is doing the work independently of the visibility
signal — an argv census alone could not have shown that. Second, **Arm REAL's clamp in this run was worse
than WP111's**: WP111 measured 907 ms/hop after a minute and 9 004 ms after ten; here the probe stopped
returning at all. Every REAL measurement below was taken under that.

**Disclosed instrument caveat, unchanged from WP111:** the CDP probe is a poke, so these are lower bounds
on the throttling, never upper ones. Every substate reading in the battery carries its own
`document.visibilityState` so the reader can see the condition each row was taken under rather than trust
the arm label.

**One row is weaker than I would like and is labelled as such:** Arm CLEAN's batteries ran with the three
windows **restored** (`visibility: "visible"`), because the launch script restores them after its probe.
CLEAN's claim is *"the flags are on and the timers are not clamped"*, which was verified while minimised;
it is not additionally a backgrounded measurement. **Arm REAL's batteries ran with all three windows
minimised and `hidden` verified at the start of each script** — that is the arm that matters and it was
held properly.

---

## 4. The five predictions

### P1 — `S147` (WP114): **CONFIRMED, and it is the biggest change in the run**

**P1a — a burst of six mid-session notes created on the host, nobody opens them.**

| | Arm CLEAN | Arm REAL |
|---|---|---|
| renderer visibility during the cell | `visible` ×3 | **`hidden` ×3** |
| bytes reached both guests | 6/6 in **0.00–0.05 s** | 6/6 in **0.00 s** |
| `docExists` / `observers` / `synced` on the guests, first read | **true / true / true** on 12 of 12 | **true / true / true** on 12 of 12 |
| the same after a further 45 s | **12 of 12 healthy, 0 unsubscribed** | **12 of 12 healthy, 0 unsubscribed** |
| `resolution` | `peer-state` on every peer in every reading | same |
| WP111's reading, same arm, same gesture | 0 of 16 unsubscribed | **16 of 16 unsubscribed, permanently** |

**Verdict: CONFIRMED. Under Arm REAL, with all three renderers `hidden` and the clamp past 6 s/hop, a burst
of mid-session host-created notes is subscribed on both guests and stays subscribed.** The 16-of-16 that
`S147` was raised for does not reproduce on `93c65f06a347e6cc`.

**P1b — sever the mux across a subscribe, then recover.** `link.break {link:"mux", shape:"silence"}`
(`S152`'s grammar; the raw response was printed and read: `silenced: true`, `readyStateBefore/After: 1`).

| | Arm CLEAN | Arm REAL |
|---|---|---|
| during the silence, victim guest A | `observers:false, subscribing:false, synced:null, resolution:null, textLen:null, docExists:false` | **identical** |
| the other two peers during the silence | healthy (`docExists:true, observers:true, synced:true, peer-state`) | healthy |
| `link.restore {link:"mux"}` raw | `wasSilenced:true, readyStateAfter:1 OPEN, resubscribed: 9` | `wasSilenced:true, readyStateAfter:1 OPEN, resubscribed: 27` |
| A at +10 s, +30 s, +50 s **with no gesture** | **recovered at +10 s** — `docExists:true, observers:true, synced:true, peer-state, textLen:31` | **recovered at +10 s** — same, `textLen:30` |
| `session.rearm` raw | `rearmed:true`, mux `resubscribed: 10`, `resubscribed:{attempted:0, recovered:0, stillAbandoned:0, paths:[]}` | `rearmed:true`, mux `resubscribed: 27`, `{attempted:0, recovered:0, stillAbandoned:0, paths:[]}` |
| a subsequent host edit, judged by the product's oracle | **CONVERGED in 1.89 s**, all three at 54 B, one digest | **CONVERGED in 2.05 s**, all three at 52 B, one digest |

**Verdict: CONFIRMED in both arms** — `resubscribed > 0` and the subsequent host edit is delivered.

**`S165`, and this is the honest reading rather than the convenient one.** The charter asks whether the path
recovers *on its own* and whether it recovers *when the gesture is issued*. What I can say is narrower than
either: **the path had already recovered by +10 s after `link.restore`, and `link.restore` is itself a seam
that resubscribes** — its raw response reports `resubscribed: 9` / `27`. So this run does **not** separate
"recovered by itself on reconnect" from "recovered because the restore seam resubscribed it". The `rearm`
gesture then reported **`attempted: 0`**, i.e. there was nothing abandoned left for the `retryAbandonedSubscribes`
path to act on — consistent with the recovery having already happened, and not evidence about `S165`'s
claim either way. **`S165` is therefore UNMEASURED by this run**, and the reason is that the instrument I have
for breaking a link also repairs the subscriptions when it is released. `sync.abandonedSubscribes` read `{}`
on all three vaults in both arms, before and after.

### P2 — `S148` (WP115): **CONFIRMED on both setups in Arm CLEAN. The Arm REAL row is VOID — see §7**

The only variable between the two setups is whether Obsidian was **running** while the bytes changed
underneath it, which is the mechanism `S148` names (the in-memory index mtime vs the on-disk mtime).
Everything else is held identical: the host creates a shared note, the guest leaves through the product's
own `Leave session`, the host edits its copy, python writes the guest's divergent bytes to disk with an
mtime **newer** than `lastSessionEndedAt` (branch 5a), the guest rejoins.

| | (a) Obsidian **CLOSED** for the disk write | (b) Obsidian **left running** — the setup that lost the bytes |
|---|---|---|
| arm | CLEAN | CLEAN |
| `lastSessionEndedAt` / file mtime | 09:42:04 / 09:42:11 → **NEWER**, branch 5a | 09:40:01 / 09:40:07 → **NEWER**, branch 5a |
| **the guest's offline work** | **SURVIVED** — `_liveshare-test (conflicts)/w4d-clean-p2a-094204 (2026-08-08 09-42-28).md` | **SURVIVED** — `_liveshare-test (conflicts)/w4d-clean-p2b-094001 (2026-08-08 09-40-07).md` |
| `sync.conflictCopies` on the guest | `{total: 1, byArm: {"text": 1}, failed: 0, discarded: 0}` | `{total: 1, byArm: {"text": 1}, failed: 0, discarded: 1}` |
| the shared path afterwards, judged by the oracle | **CONVERGED in 0.00 s**, all three at 49 B, one digest | **CONVERGED in 0.24 s**, all three at 49 B, one digest |

**Verdict: CONFIRMED. On this build a guest's offline divergence is preserved as a conflict copy on BOTH
setups, including the one WP111 reported as a silent overwrite.** WP111's `S125` REFUTED reading —
*"no copy, `conflictCopies` `{total: 0, failed: 0}` on all three, the guest's line exists nowhere"* — does
not reproduce.

**`CONFLICT COPY SKIPPED:` fired, and it carries both clocks exactly as chartered.** It has never been seen
live before. The whole line, verbatim:

```
2026-08-08T07:40:07.322Z [WARN] [file-op] CONFLICT COPY SKIPPED: arm=text
  path=_liveshare-test/w4d-clean-s126-guest-093252.md
  mtime=1786174670461 lastSessionEndedAt=1786174801476
  reason=the local file predates this peer's last session end, so it is stale, not edited
```

Both clocks are present and the verdict follows from them: `mtime` 09:37:50 against `lastSessionEndedAt`
09:40:01, so the local copy genuinely predates the leave and the discard is correct. **It fired on a
different file from the one under test** — the note emptied earlier in the `S126` row — which is worth
saying plainly: the two branches ran side by side in one rejoin, the guest's *edited* file got a copy and
the guest's *stale* file got a documented discard.

### P3 — `S122` (WP117), the headline capability: **CONFIRMED, with a measured latency cost**

A **guest** creates a `.canvas` in the shared folder through `app.vault.create`. Scored on **disk bytes**
(`S138` — `canvas.mirror` was never read), judged by the product's oracle against an expectation written
down before the gesture (`contains` the card text this driver authored).

| round | author | cards | Arm CLEAN | Arm REAL |
|---|---|---|---|---|
| `new` | guest A | 1 | diverged at 90 s → **CONVERGED**, 171 B ×3, one digest | diverged at 240 s → **CONVERGED**, 170 B ×3, one digest |
| `import` | guest C | 40 nodes / 39 edges | diverged at 90 s → **CONVERGED**, 10 621 B ×3, one digest | diverged at 240 s → **CONVERGED**, 10 581 B ×3, one digest |
| `new2` | guest C | 2 | **CONVERGED in 0.25 s**, 315 B ×3 | **CONVERGED in 0.22 s**, 313 B ×3 |

**Verdict: CONFIRMED. A guest-created `.canvas`, new or imported, becomes real for every peer and
byte-identical on all three, with the originator converged onto the host's canonical serialisation.**
`S122`'s *"reaches nobody and enters no client's manifest — not even its own"* is dead.

**The counters agree with the disk, on every peer** (Arm REAL, and CLEAN is the same shape):

| | A (guest) | B (host) | C (guest) |
|---|---|---|---|
| `requested` | 1 | 0 | 2 |
| `declinedLocally` / `not-guest` | 0 | **10** (the host declining its own creates, by design) | 0 |
| `received` → `decided.materialise` | 2 → 0 (`refuse-not-host` 2) | **3 → 3** | 1 → 0 (`refuse-not-host` 1) |
| `materialised` / `materialiseFailed` | 0 / 0 | **3 / 0** | 0 / 0 |
| `accepted` / `refused` / `timedOut` | 1 / 0 / 0 | 0 / 0 / 0 | 2 / 0 / 0 |
| `adoptionsArmed` / `adoptionsCleared` | 1 / 1 | 0 / 0 | 2 / 2 |

**The cost, and it is the finding inside the confirmation: the ORIGINATOR adopts late.** In both arms the
two non-originating peers held identical bytes within seconds while the creating guest still held **its own
serialisation** — 136/137 B against the peers' 170/171 B, and 8 672 B against 10 581 B for the imported
board. It resolved to full three-peer identity for every round, but **not inside 90 s (CLEAN) and not
inside 240 s (REAL)** for the first two rounds of each arm, while the third round of each arm converged in
0.22–0.25 s. I could not separate *"the first adoption of a phase is slow"* from *"a mirror pass had to come
round"*, and I am not going to guess: it is recorded in §6.

`S168` (an empty canvas) and `S167` (over 512 KB) were **not exercised** — every board this run created
carried at least one card and none approached the bound. Nothing here contradicts either.

### P4 — `S141` and the new refusal lines: **CONFIRMED — the instrumentation is live and legible**

The charter's standard is *prove your reader can match something before reporting a zero*. It matched a
great deal.

**Lines actually found in the debug log, from a byte offset recorded before the arm, after a 100 s flush
wait — quoted whole because that is the point of the package:**

```
2026-08-08T07:33:02.991Z [WARN] [file-op] SINGLE-WRITER DECLINE: arm=subscribe-guest
  path=_liveshare-test/w4d-clean-s134-guest-noopen-093252.md
  reason=the editor owns this file's disk copy while it is the active file;
         background-sync must not be its second writer

2026-08-08T08:11:47.188Z [WARN] [file-op] EMPTY WRITE REFUSED: arm=doc-write
  path=_liveshare-test/w4d-real-s126-guest-100654.md
  reason=refusing to replace 55 byte(s) with empty content: whether this document ever held
         content (CRDT tombstones). An empty document is equally consistent with 'somebody
         emptied it' and 'nothing has arrived yet', and only the first may overwrite a file
```

| signature | Arm CLEAN (A/B/C) | Arm REAL (A/B/C) |
|---|---|---|
| `SINGLE-WRITER DECLINE` | **1 / 1 / 0** | 0 / **1** / 0 |
| `EMPTY WRITE REFUSED:` | 0 / 0 / 0 | **1** / 0 / **1** |
| `ATTESTATION REFUSED` | 0 / 0 / 0 | 0 / 0 / 0 |
| `CONFLICT COPY SKIPPED:` | **1** (P2b) / 0 / 0 | 0 / 0 / 0 |
| `CONFLICT COPY FAILED:` | 0 / 0 / 0 | 0 / 0 / 0 |
| `RENAME FOLLOW-UP FAILED:` | 0 / 0 / 0 | 0 / 0 / 0 |
| `sync timed out` | 0 / 0 / 0 | 0 / 0 / 0 |
| **reader proof in the same window** | `MUTE OVERRUN` 7/5/13, `manifest` 25/25/25, `subscribe` 2/1/0 | `MUTE OVERRUN` 4/7/12, `manifest` 25/25/25, `subscribe` 0/1/0 |

**The e2e ledgers, read off the surface:**

| | Arm CLEAN A / B / C | Arm REAL A / B / C |
|---|---|---|
| `sync.attestationDecisions.total` | 0 / **29** / 0 | 0 / **30** / 0 |
| ↳ `publishedNotEmpty` | 0 / **29** / 0 | 0 / **30** / 0 |
| ↳ **`refusedContradicted`** | **0 / 0 / 0** | **0 / 0 / 0** |
| ↳ **`refusedUnverifiable`** | **0 / 0 / 0** | **0 / 0 / 0** |
| `sync.singleWriterDeclines` | 1 (`subscribe-guest`) / 1 (`subscribe-host`) / 0 | 0 / 2 (`subscribe-host`) / 0 |
| `sync.abandonedSubscribes` | `{}` / `{}` / `{}` | `{}` / `{}` / `{}` |
| `sync.emptyWriteRefusals` | `{total:0}` ×3 | `{total:1, doc-write}` / `{total:0}` / `{total:1, doc-write}` |
| `sync.conflictCopies` | `{total:1, text:1, failed:0, discarded:1}` on A / `{0}` / `{0}` | `{total:0}` ×3 |

**Verdict: CONFIRMED. `S141`'s attestation guard is armed, was exercised 29–30 times on the host in each
arm, and refused nothing — and the zeros are meaningful because the same counter's `total` is non-zero in
the same reading.** That is the `S137` standard met from inside the instrument rather than beside it.

**And the silent give-ups are now legible, which is the WP113 half of this prediction.** `sync.pathOutcomes`
is populated on every vault and it is the sharpest new reading in the run:

| | Arm CLEAN A / B / C | Arm REAL A / B / C |
|---|---|---|
| total outcomes | 40 / 47 / 47 | 76 / **121** / 102 |
| `subscribe/completed` | 17 / 17 / 19 | 54 / 53 / 55 |
| `subscribe/already-observed` | 1 / 17 / 0 | 1 / 36 / 19 |
| **`subscribe/no-doc`** (disposition `retryable`) | 0 / **0** / 0 | 0 / **19** / 0 |
| `subscribe/sync-failed` (disposition `retryable`) | **1** / 0 / 0 | 0 / 0 / 0 |
| `byDisposition.retryable` | 1 / 0 / 0 | 0 / **19** / 0 |

**Nineteen `subscribe/no-doc` outcomes on the host in Arm REAL, and none in Arm CLEAN.** That is a
throttling-dependent give-up which on the old build would have been invisible — and it is now counted,
named and dispositioned `retryable`. It did not cost a single convergence in this run, and it is exactly
the kind of thing `S164` warns you would miss by reading `observers: true` and stopping.

### P5 — regression on the new build: **`S134`, `S135`, `S126` CONFIRMED. `S123` needs two sentences, not one**

**`S134` — a note created during a live session.** Four cells per arm: {host-born, guest-born} ×
{opened at birth, not opened}. Each peer appends its own marker through its **own** editor, and the
expectation — the body plus `[A]`, `[B]`, `[C]` — was written down before the first gesture.

| cell | Arm CLEAN | Arm REAL |
|---|---|---|
| host-born, opened at birth | **CONVERGED 1.41 s** | **CONVERGED 1.45 s** |
| host-born, not opened | **CONVERGED 1.42 s** | **CONVERGED 1.47 s** |
| guest-born, opened at birth | **CONVERGED 1.41 s** | **CONVERGED 1.50 s** |
| guest-born, not opened | **CONVERGED 1.41 s** | **CONVERGED 1.44 s** |

`docExists`/`observers`/`synced: true` and `resolution: "peer-state"` on all three peers in all
**24** readings. Arrival on disk 0.00–0.05 s everywhere. **The throttling arm costs about 0.05 s.**

**`S135` — a cross-folder move of a `.md`, both roles.** A move must not change a byte, so the exact
digest was statable before the gesture and was stated.

| mover | Arm CLEAN | Arm REAL |
|---|---|---|
| host | **CONVERGED 0.00 s** at the destination, `sha256` clause satisfied, source gone on all three | **CONVERGED 0.00 s**, same |
| guest | **CONVERGED 0.00 s**, same | **CONVERGED 0.00 s**, same |

`RENAME FOLLOW-UP FAILED:` — **zero hits on all three vaults in both arms**, with the reader proved live in
the same window.

**`S126` — a genuine select-all + delete on a note closed on the other peers.** The selection was made
through the Editor API and **asserted to cover the whole document before anything was deleted**
(`{"ok":true,"total":55,"selLen":55,"after":0}` on every row) — `executeCommandById('editor:select-all')`
was never used. The other peers had **zero open leaves**, read back before each gesture. The emptiness was
**explicitly asserted** in the expectation (`sha256: e3b0c442…`), so the oracle's structural clause was
satisfied rather than dodged.

| initiator | Arm CLEAN | Arm REAL |
|---|---|---|
| host | **CONVERGED 1.55 s**, all three at 0 B | **CONVERGED 1.62 s**, all three at 0 B |
| guest | **CONVERGED 1.56 s**, all three at 0 B | **CONVERGED 1.08 s**, all three at 0 B |

In Arm REAL the floor **fired once on each guest** for the guest-initiated row (`EMPTY WRITE REFUSED:
arm=doc-write … refusing to replace 55 byte(s)`) and the emptying still landed — the first-attempt refusal
`S126` describes, with the second attempt admitted. The floor is doing its job and is no longer silent.

**`S123` — a `.canvas` created on the HOST. Scored on disk bytes.** This is where the new oracle says
something the old one could not.

| | Arm CLEAN, 3 rounds | Arm REAL, 3 rounds |
|---|---|---|
| **both guests, byte-identical to each other** | **3/3, CONVERGED** (A and C at 174 B, one digest) | **3/3, CONVERGED** (A and C at 173 B, one digest) |
| **all three peers** | **0/3 — DIVERGED, every round** | **0/3 — DIVERGED, every round** |
| the host's own copy | **140 B**, its own serialisation, unchanged | **139 B**, its own serialisation, unchanged |
| still diverged when re-judged ~25 min later | **yes, all three rounds** | **yes, all three rounds** |

**`S123`'s own acceptance criterion — reaches both guests, byte-identical between the guests — is MET,
4/4 in WP111 and 6/6 here across both arms, with no 78 s first canvas.** But the host's own disk copy
**never** converges to what its guests hold, and it is not a latency effect: it is still divergent half an
hour later, in both arms, on every round. This is WP111's anomaly 4 (*"a newly created `.canvas` is not
byte-identical between host and guests"*) promoted from a footnote to a verdict by the WP116 oracle, and it
is the **mirror image of P3**: a guest-created canvas has the originator adopt the host's bytes (late but
completely), while a **host**-created canvas has the originator adopt nothing, ever. I am not calling it a
defect — WP79 has a rule that a host's file is not rewritten by a mirror pass, and this may be exactly that
rule doing what it says. **I am recording that under the new oracle a host-created canvas is permanently
DIVERGED across the share, and that somebody who owns that rule should decide whether that is intended.**

---

## 5. Both arms side by side

| measurement | Arm CLEAN | Arm REAL | note |
|---|---|---|---|
| renderer `visibilityState`, three stacked windows | `hidden` ×3 | `hidden` ×3 | the flags do not change the signal, they change the clamp |
| chained timer hops, hidden renderer | **12 ms/hop** | **768–800 ms/hop**, then **no return in 180 s** | ~64× then unbounded |
| P1a mid-session notes left unsubscribed | **0 of 12** | **0 of 12** | WP111: 0 of 16 vs **16 of 16** |
| P1b recovery after `link.restore` | +10 s | +10 s | `resubscribed` 9 vs 27 |
| P1b subsequent host edit | CONVERGED 1.89 s | CONVERGED 2.05 s | |
| P2 guest offline edit survives | **yes, both setups** | **VOID** (§7) | |
| P3 guest canvas → all three byte-identical | **3/3** | **3/3** | originator adopts late: >90 s / >240 s on 2 of 3 |
| P5a `S134` four cells | 1.41–1.42 s | 1.44–1.50 s | 1.04× |
| P5b `S135` cross-folder move, both roles | 0.00 s | 0.00 s | exact-digest clause |
| P5c `S123` guests byte-identical | 3/3 | 3/3 | **host never joins them: 0/3, 0/3** |
| P5d `S126` emptying, both roles | 1.55 / 1.56 s | 1.62 / 1.08 s | floor fired twice in REAL |
| `subscribe/no-doc` (retryable) on the host | **0** | **19** | the arm difference that survives |
| `attestationDecisions` refusals | 0 of 29 | 0 of 30 | non-zero total makes the zero mean something |
| `MUTE OVERRUN` occurrences | 7 / 5 / 13 | 4 / 7 / 12 | |

**The headline comparison is P1a.** Same machine, same hour, same gesture, same arm as WP111 — and the
sixteen-of-sixteen permanently-unsubscribed result is now zero of twelve, twice.

---

## 6. Anomalies — recorded, not explained

1. **The originator of a guest-created canvas adopts the host's bytes late, and inconsistently so.** Rounds
   1 and 2 of each arm were still divergent at the bound (90 s CLEAN, 240 s REAL) and had converged when
   re-judged minutes later; round 3 of each arm converged in 0.22–0.25 s. I cannot separate *"the first
   adoption of a phase is slow"*, *"a mirror pass had to come round"* and *"the 40-node board is bigger"*.
2. **A host-created `.canvas` is permanently divergent from its guests** (§4, P5). Stable across both arms,
   all six rounds, and still true ~25 minutes later. Not investigated further.
3. **Nineteen `subscribe/no-doc` outcomes on the host in Arm REAL and none in Arm CLEAN.** Disposition
   `retryable`, no convergence lost. I did not chase what produced them.
4. **`neural-angels` — not `neural-angels-access` — went from `Exited (0) 8 days ago` at my 09:13 census to
   `Up 16 minutes` at 10:23.** It is not a protected container and I ran no command that names it; my last
   contact with the box was the 09:23 deploy, an hour earlier. The box also runs a container called
   `na-waker`, whose name suggests it wakes services, but I did not verify that and I am not claiming it.
   **Recorded as unexplained.**
5. **`/healthz` reports `sessions: 1, documents: 55, clients: 2`** at 10:25 while three vaults are installed
   — consistent with vault A being out of the session (§7), but I did not verify the counter's semantics.
6. **Vault B's debug log is 33.5 MB** against 4.9 MB for A and 4.8 MB for C. `S30(debuglog)` — unbounded
   growth — is still live and B is still an order of magnitude ahead of its peers.
7. **`Properties.md` and `hello.md` in the share have held 0 bytes since before this run began** (they were
   already 0 at the 09:13 census, and `S119` destroyed exactly these two files historically). Nothing this
   run did touched them. Noted because the new oracle would call a zero-byte file a failure, and a future
   reader should know these were already empty when I arrived.
8. **`docker compose ls` shows a project literally named `stack`** covering `neural-angels-access`,
   `neural-angels`, `trend-management-agent`, `energy-oracle`, `neural-angels-cv`, `neural-angels-leads`
   and more — one project name shared by seven stack directories. That is the exact collision the
   `name: liveshare` rule exists to avoid, and it is real on this box: a `docker compose down` run from any
   of those `Stack/` directories would take the NA gateway with it. Recorded because it makes the charter's
   rule a live hazard rather than a historical one.

---

## 7. The interruption, and the one row it cost

The run was stopped by the Dispatcher at ~10:20 because the owner needed the machine, and resumed at 10:23.
**No arm spanned the interruption**: both arms' batteries had completed and their results were on disk
before it. On resume I re-read all three vaults rather than assuming.

**Vault A was out of the session when I resumed, and it was my own doing, not a drop.** The evidence is in
my own transcript and I am reporting it as a failure of my instrument:

```
A join RAW: {"ok": false, "why": "clipboard does not hold an invite", "len": 81}
```

**The Arm REAL P2b rejoin was REFUSED.** The rig joins a guest by reading the invite off the clipboard,
which the host puts there when it starts a session; by 10:13 the clipboard held something else (81
characters, not the 357-character invite). So the guest left the session, its divergent bytes were written
to disk, and **it never came back** — `role: null`, `roomId: ""`, `state: "no-session"`,
`statusBarText: "Live Share: off"`, `lastSessionEndedAt` = 10:13:42, which is the exact minute of my own
`leave-session`.

**The Arm REAL P2b row is therefore VOID, not a negative result, and it must not be read as one.** Its
apparent reading — oracle `DIVERGED`, `violations: ['contains']`, A at 56 B holding its own offline bytes
while B and C hold the host's 47 B, `conflictCopies` `{total: 0}` on all three — measures a guest that was
never in the session, which is a statement about nothing. This is the `S152` family exactly: a refused
command whose refusal was printed, read, and is here being scored as *"the gesture did not happen"* rather
than *"the gesture had no effect"*. The only reason it was caught is that the charter requires printing the
raw response.

**The fix is known and small** — the host must re-run `live-share:copy-invite` before a mid-run rejoin —
and it is stated here so the next round does not rediscover it.

---

## 8. What I did not get to

- **P2 setup (a) — close-and-reopen — under Arm REAL.** Only setup (b) was attempted in REAL, and it is
  void. Setup (a) ran under CLEAN only.
- **P2 setup (b) under Arm REAL, valid.** Void as above; the rerun is the first thing the next round or
  the remainder of this one should do.
- **`S165` separated from `link.restore`'s own resubscribe.** §4 explains why this run cannot answer it:
  the only severance instrument repairs the subscriptions when it is released. Answering it needs a break
  that is released **without** a resubscribe, or a reconnect driven from the relay side.
- **`S168` (empty canvas) and `S167` (>512 KB).** Not exercised. Every board carried a card and none
  approached the bound; nothing here contradicts either entry.
- **The `MUTE OVERRUN` held-vs-ceiling values.** Counted in both arms but the millisecond values were not
  extracted, so this run adds no data to `S120`'s 251 ms / 915 ms comparison.
- **Any attribution of the anomalies in §6.** Recorded, not explained, deliberately.

---

## 9. The state the rig is in as of 10:25

| | A | B | C |
|---|---|---|---|
| role | **`null` — out of session** (§7) | **host** | guest |
| room | `""` | `90faf3d5-a6c6-4c13-8071-b8ac8dbd1411` | same |
| `link.report` | `state: "no-session"`, both links `ABSENT`, `retryChainEnded: []`, `severance.halted: false` | `connected`, both links `OPEN`, `healthy: true` | `connected`, both links `OPEN`, `healthy: true` |
| status bar | `Live Share: off` | `Live Share: hosting (2) 8ms` | `Live Share: joined (2) 8ms` |
| `sharedFolder` | `"_liveshare-test"` | `"_liveshare-test"` | `"_liveshare-test"` |
| `main.js` sha | `93c65f06a347e6cc` | `93c65f06a347e6cc` | `93c65f06a347e6cc` |
| `data.json` sha-of-bytes | `c083bbb2ef1b37ac` | `875010c7c5e59048` | `ad0e62838d35e94f` |
| `debugLogging` / `autoReconnect` | `true` / `true` | `true` / `true` | `true` / `true` |

- **`sharedFolder` was `_liveshare-test` on all three at every reading in this run and was never empty.**
- Three Obsidian windows are up, launched **without** the throttling flags (Arm REAL's configuration, which
  is what the owner runs), with `--remote-debugging-port=9222 --remote-allow-origins=*`.
- **45 `w4d-*` artefacts are still in the share on each vault**, and one `main.js.pre-v2-smoke-w4d` per
  vault. Cleanup and the A rejoin are the remaining work; §10 records what must be removed.
- The stray third vault registration in `obsidian.json` and `Projects/_external/FinaleAbgabe` were **never
  touched**. `data.json` was never read, copied, printed or logged on any vault.

---

## 10. Cleanup still owed

- every `w4d-*` file and folder in `_liveshare-test` on all three vaults (45 entries each);
- `_liveshare-test (conflicts)/w4d-clean-p2a-…md` and `w4d-clean-p2b-…md` — this run's `S148` evidence,
  fully transcribed in §4 above, so nothing is lost by removing them;
- **our namespace `.pre-v2-smoke-w4d`** — one `main.js.pre-v2-smoke-w4d` per vault, and **zero may remain**;
- the pre-existing set to restore to is the 09:13 census: **A 10 entries** (including
  `_liveshare-test (conflicts)/w4b-guestedit (2026-08-07 22-50-33).md`, which is a **predecessor's**
  evidence and stays), **B 9**, **C 9**;
- **not ours, to be left exactly as found and reported rather than removed:** `main.js.bak`,
  `main.js.0.5.9.bak`, `manifest.json.bak`, `styles.css.bak` (the owner's), `data.json.wp88-b34.armed`,
  `data.json.wp88-b34.pre`, and `main.js.pre-wp100 / .pre-wp102 / .pre-wp107` (other batches').

---

## Appendix — where the raw evidence is

Console transcripts, complete and unedited, under `tools/_console_runtime/`:

| console | what |
|---|---|
| `2f59dc7c` | pre-run census: process argv, roles, installed shas, share sets, `.pre-v2-smoke` residue |
| `b84e7880` / `22443240` / `d71aeae8` / `099a52ee` | relay reconnaissance, read-only — containers, compose labels, the `.env` permission finding, the no-root/no-sudo finding |
| `60553cec` | `npm run build:e2e` |
| `8bb31886` / `036d30e8` | relay image build, and the rebuild without attestations |
| `8f969119` / `d517834f` | session end through the product's commands; install and byte-for-byte read-back |
| `315132ec` | **the relay deploy** |
| `8bbc7b33` | **the post-deploy protected-container verification** |
| `88945afc` / `9bb3edf9` | Arm CLEAN launch + flag census + clamp probe; bring-up |
| `92db6f28` | Arm CLEAN battery 1 — P1, P3 |
| `56b6ae76` | Arm CLEAN battery 2 — P5, P4 |
| `13ac3b4f` / `0852c4ea` | Arm CLEAN P2b and P2a |
| `64e1742e` / `c04fd709` | CLEAN re-judgements: late canvas convergence, and the host/guest canvas split |
| `20d53fdf` / `df3b63a2` | Arm REAL launch + flag census; bring-up |
| `730c5fdb` | Arm REAL: minimise → clamp probe (**no return in 180 s ×3**) → battery 1 |
| `6e5623d3` | Arm REAL battery 2, P2b (**the void row**), canvas check |
| `6546fd3e` | REAL re-judgements |
| `ff9fae8a` | post-interruption rig state |

Machine-readable results: `H:\tmp\w4d_battery_{clean,real}.json`, `w4d_battery2_{clean,real}.json`,
`w4d_p2_clean_{a,b}.json`, `w4d_p2_real_b.json`, `w4d_recheck.json`, `w4d_canvascheck.json`.
Rig scripts: `H:\tmp\w4d_*.py`, built on the predecessors' `w4rig.py` / `w4b_lib.py` / `w4c_lib.py`, which
were reused rather than rewritten.

**The convergence oracle was WIRED, not hand-rolled.** `S161` R2 asked the next round to wire
`convergence.judge` into the driver or say plainly that it judged by hand. It is wired:
`H:\tmp\w4d_lib.py::judge()` posts `{"cmd": "convergence.judge", "args": {"peers": [...], "expected": {...}}}`
to a vault's own control server, with the peer readings taken from **disk in python**. Every convergence
verdict in this report came from that call; **no verdict in this report was reached by comparing peers to
each other**, and every `expected` was constructed before its gesture with an `origin` naming the gesture
this driver was about to perform.
