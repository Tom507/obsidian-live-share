# Implementation Report — the Data-Loss Chain (D1 / D2 / D3)

**Batch:** B16a · **Worker:** 3 (Implementation) · **Mode:** autonomous
**Date:** 2026-08-05 · **Branch:** `fix-bugs-and-raceconditions`
**Scope:** the confirmed data-loss chain. Files were destroyed on a real vault today.

---

## 0. Summary

| | |
|---|---|
| **Reproduced first?** | **Yes.** A file was destroyed on demand, with zero instrumentation, before a line was changed. |
| **D1 root cause** | Established, measured, and it is **not** `demoteToGuest`. See §2. |
| **Fixed** | D1, D2, D3 — plus one regression this batch introduced and then caught. |
| **Unit tests** | 1865/1865 pass (304 files), 9 new, mutation-checked |
| **E2E — data loss** | 12 passed, 0 failed, 0 skipped |
| **E2E — canvas suite** | **19/19** on the corrected build. A [06] regression introduced by this batch was found and fixed (§5). |
| **Suite idempotency** | fixed in both suites; the fix immediately exposed a vacuous pass (§7) |

---

## 1. RED — the loss, reproduced on the real path

**Binding rule: reproduce first.** This ran against the unmodified tree, with no rig
instrumentation whatsoever. The only oracle is the file system.

```
DATA-LOSS CHAIN E2E — run 20260805-011442 — phases: ['r1']

[R1] restart repro — the actual incident path (oracle: the file system)
  PASS  R1 precondition: canary written to vault B
           H:\Developement\_NeuralAngels\ObsidianOrga - Kopie\_liveshare-test\canary-r1-20260805-011442.md
  session before restart: A='guest' B='guest'
  killing Obsidian (5 processes)…
  stopped (0 processes). relaunching ['A', 'B']…
  waiting for the control servers…
    all answering after 4s
      A: role='guest' connected=True vaultId=703aa794cc73a117
      B: role='guest' connected=True vaultId=55a4253eb7a90dde
  session after restart:  A='guest' B='guest'
  >>> FAIL  R1: a shared file in vault B survives a restart
           canary-r1-20260805-011442.md DESTROYED (trashFile -> Recycle Bin);
           roles after restart: A='guest' B='guest'
```

A file, written to a shared folder, destroyed by restarting the editor. **Files disappear
on demand.** Only after this were any sources touched.

---

## 2. D1 — root cause

The starting hint was `main.ts:1797 demoteToGuest`. That is where the symptom surfaces; it
is not the cause. `demoteToGuest` is doing what it is told. The question is who tells it,
and why nothing ever tells the other side the opposite.

### 2.1 The evidence that pinned it

Vault A's own debug log, from the night of the incident:

```
2026-08-04T22:51:09.147Z [INFO] [session] resuming as host
2026-08-04T22:51:09.271Z [INFO] [connection] control channel connected
2026-08-04T22:51:09.282Z [INFO] [session] demoted from host - another host exists
...
2026-08-04T22:58:38.554Z [INFO] [session] resuming as guest
```

**11 ms after the control channel connects**, vault A is demoted. That timing rules out
everything except the `join-response` the server sends in reply to the `join-request`
issued on connect (`main.ts:773-779`). Vault B's log shows it resuming as `guest`
15 seconds *later* — so "the other peer got there first" is not the explanation either.

Two more measurements narrowed it to one path:

- `githubUserId` and `jwt` are **empty in both vaults** (checked by key presence and
  sha256 only; no value was read or printed). So `userId = clientId`, the two clientIds
  differ, and `verifiedUserId` is `null` on both.
- The room still exists on the relay — `server/src/index.ts:127` rejects a control
  upgrade for an unknown room, and both peers were connected (`clients: 2`).

So the server had a `hostUserId`, and it did not match vault A.

### 2.2 The mechanism

`server/src/control-handler.ts:548-591`, the socket-close handler:

```ts
const wasHost = closingClient?.isHost ?? false;
room.clients.delete(ws);
if (wasHost && room.clients.size > 0) {
  // …elect the earliest-joined remaining client…
  newHost.isHost = true;
  if (serverRoom) {
    const electedHostId = newHost.verifiedUserId ?? newHost.userId;
    if (electedHostId) {
      serverRoom.hostUserId = electedHostId;   // ← the room's host identity is REWRITTEN
      touchRoom(roomId);
    }
  }
  sendTo(newHost.ws, { type: "host-transfer-complete", … });
}
```

Closing the host's Obsidian rewrites `room.hostUserId` to the surviving guest and sends
that guest a promotion. **One Obsidian process serves both vaults**, so both windows die
together: the promotion is sent to a client that is already shutting down, and is never
processed and never persisted. The server now believes the guest is the host. The guest's
`data.json` still says `guest`.

On relaunch:

- vault A no longer matches `room.hostUserId` → `determineHostStatus` sets
  `isHost = false` → `join-response { isHost: false }` → **A demotes.** Correct, by A's
  own lights.
- vault B *does* match → `join-response { isHost: true }` → and `control-handlers.ts:143`
  **ignored it entirely.**

### 2.3 The actual defect

```ts
channel.on("join-response", (msg) => {
  if (msg.isHost === false && plugin.settings.role === "host") {
    void plugin.demoteToGuest();      // ← host -> guest: handled
    return;
  }
  if (plugin.settings.role !== "guest") return;   // ← guest -> host: NOTHING
```

**The server's verdict was reconciled in one direction only.** A role could be lost and
never regained, so every disagreement between server and client moved monotonically
towards "guest" and the fixed point of that process is *a session with zero hosts*.

That is D1. Not a bad demotion — a **missing promotion**. `demoteToGuest` was the
half of the mechanism that was implemented.

With no host, nobody calls `publishManifest`. The relay replays the last persisted
manifest. Every guest — which is now everyone — reads it as the host's current word.

---

## 3. What was changed, and why

### 3.1 D1 — `plugin/src/sync/control-handlers.ts`

Added the missing direction:

```ts
if (msg.isHost === true && plugin.settings.role === "guest") {
  void plugin.promoteToHost();
  return;
}
```

Safe by construction: `determineHostStatus` enforces the single-host invariant server-side
(it demotes every other client before answering), so adopting `isHost: true` cannot create
a second host — whereas refusing to adopt it demonstrably creates a session with none.

`promoteToHost` (new, `main.ts`) is idempotent and is now the **single** implementation of
"become the host". `host-transfer-complete` was a second hand-rolled copy of the same
sequence and now routes through it — two copies of a role transition is how one of them
came to be missing a direction in the first place.

### 3.2 D2 — the evidence gate (`plugin/src/files/manifest.ts`, `main.ts`)

The manifest was a bare `path -> entry` map with **no provenance**. A guest holding one
could not distinguish

- *"a live host published this set and your file is not in it"* — a fact, from
- *"this is whatever the relay replayed at me and nobody has said anything since"* — an absence,

and it treated both as a licence to `trashFile`. That is I11 at the top level: absence of
information converted into a destructive action.

**New: `ManifestPublication`** — an attestation stored in a `meta` Y.Map beside `files`:

```ts
{ hostId: string;   // who claims to be host
  seq: number;      // monotonic; the freshness signal
  publishedAt: number }  // diagnostics only — never gate on a clock
```

- Written **only** by `publishManifest`, which only a host calls.
- Written **inside the same Yjs transaction as the entries**. A peer can never observe a
  purged entry set without the statement that vouches for it (that ordering reads as "the
  host says these files are gone" for a purge nobody attested), nor an attestation ahead
  of its entries. One transaction makes both orderings unrepresentable.
- `seq`, not a timestamp, deliberately: freshness must survive two peers whose clocks
  disagree. Compared against a baseline taken in `connect()` **after** `waitForSync`, it
  answers exactly the question that matters — *did a publication happen after I connected?*

**`cleanupStaleFiles` now requires two independent conditions, each failing closed alone:**

1. `hasFreshPublication(ownId)` — a publication landed after we connected, and it is not
   our own (a peer must not be its own witness).
2. a peer **currently present** in the session claims to be host. The attestation says
   somebody spoke; this says somebody is still there.

Everything else returns a **refusal** carrying a stated reason. It also now returns a
`StaleReconcileDecision` instead of `void`: previously "I deleted three files", "there was
nothing to delete" and "I had no business deciding" were the same observation — silence.
The data loss was invisible in the logs until the files were noticed missing.

A refusal is not final. `armStaleReconcileRetry` re-asks the decision on every publication —
the exact event that creates the evidence — so the legitimate cleanup still happens, the
moment the evidence arrives and not one instant before. The host also republishes when a
previously-unseen peer appears, so a guest joining a long-running session can obtain the
evidence at all.

### 3.3 D3 — `main.ts`

`if (manifest.size === 0) return;` is no longer the gate. It survives only as a redundant
floor *behind* the evidence check ("the freshly published manifest is empty; refusing to
empty the shared folder"). It was never the right question: emptiness is a property of a
data structure, and the question is about the world.

### 3.4 `demoteToGuest` no longer reconciles

The `cleanupStaleFiles()` call inside `demoteToGuest` was **removed and must not return**.
A peer arriving there has just been told it is *not* the host, so the only manifest it
holds is one it published itself, as the host it no longer is. Reconciling against that is
a peer deleting files on the authority of a claim it has just been stripped of. In the
incident this was one of the two live trash paths.

---

## 4. GREEN — the same conditions, no longer destructive

`H:\tmp\liveshare_dataloss_e2e.py`, run `20260805-014516`, against two live instances:

```
[S1] hostless session must not delete — vault B relaunched ALONE
    B: role='guest' connected=True
  PASS  S1 precondition: vault A is down                    port 39431 does not answer
  manifest on B: size=1 fresh=False hostPeers=[] publication=null
  PASS  S1 precondition: no live host peer and no publication this session
        — i.e. the exact 'nobody told me' state that destroyed files
  decision: {"ran": false,
             "reason": "no host has ever published a manifest for this room",
             "candidates": 0, "trashed": []}
  PASS  S1: the reconcile destroyed nothing                 3 file(s) intact
  PASS  S1: the canary specifically survived                canary-s1-20260805-014516.md present
  PASS  S1: the reconcile REFUSED, with a stated reason, rather than silently no-opping

[S2] a live host's fresh manifest still deletes (the fix is not a lobotomy)
  session: A='host' B='guest'
  PASS  S2 precondition: the file reached the guest (B) — both sides hold it
  stopping both, deleting the file from the host's vault only…
  PASS  S2 precondition: the file is gone on the host and still present on the guest
  roles after restart: A='host' B='guest'
  guest B manifest: size=3 fresh=True hostPeers=['500920d4-…']
  decision on B: {"ran": true,
                  "reason": "host 500920d4-… published a manifest of 3 entry/entries this session"}
  PASS  S2: the guest DID delete the file its live host no longer lists
            guest_copy_present=False

[S3] restart both — no shared file may disappear (the incident shape)
  before: A=4 files, B=4 files
  PASS  S3 precondition: both shared folders hold the same file set (so no deletion could be correct)
  session after restart: A='host' B='guest'
  PASS  S3: vault A lost no shared file across the restart  4 file(s) intact
  PASS  S3: vault B lost no shared file across the restart  4 file(s) intact
  PASS  S3: the session has exactly one host after the restart (D1)   A='host' B='guest'

RESULT: 12 passed, 0 failed, 0 skipped   (run 20260805-014516)
```

The S1 refusal is the direct answer to the RED at 01:14:42: same shape, same hostless
state, a stated refusal instead of a destroyed file.

**D1 confirmed independently:** immediately after installing the fixed bundle, vault A —
which had been stuck as a guest since the incident — reported `role: "host"` again, and
`manifest.info` showed the first attestation (`seq: 2`, `hostId` = A) with the guest seeing
`freshPublication: true`. The session recovered a host without any manual intervention.

---

## 5. A regression this batch introduced, and caught

The first version of the fix moved `registerManifestChangeHandler()` **ahead of**
`syncFromManifest` and `backgroundSync.startAll("guest")` on the guest paths, so that the
publication retry would be armed before the first refusal.

The canvas E2E suite dropped from **19/19 to 17/19**: scenario [06], canvas node deletion
reaching the guest, began failing. Rather than assume it was pre-existing, the parent
commit's bundle was built and installed on the same two instances:

| bundle | scenario [06] |
|---|---|
| `6380e28~1` (pre-fix) | **PASS** — 19/19 overall |
| first fix attempt | **FAIL** — 17/19 overall, twice (`-014843`, `-015034`) |
| corrected fix | **PASS** — [06] 3/3, and **19/19 overall** on the final run `-020454` |

**It was mine.** The retry and the file-level manifest handler are two different concerns
with two different ordering requirements: the retry must be armed early, the manifest
handler must not be. They are now two registrations (`armStaleReconcileRetry` and
`registerManifestChangeHandler`), and every pre-existing call site keeps its original
position. The comment at `armStaleReconcileRetry` records the measurement so the two are
not folded back together.

*The interesting part is not the regression. It is that the E2E suite caught, in one run,
something 1856 headless tests could not see — and that "it can't be mine, my diff doesn't
touch that code" would have shipped it.*

---

## 6. Tests added

**`plugin/src/__tests__/dataloss/test_stale_reconcile_evidence_gate.test.ts`** — 9 tests.

They exist for the half the E2E rig **cannot reach any more**: with D1 fixed, a lone
instance is told by the server that it is the host and promotes, so "a session with no
host" is no longer reachable by restarting anything. That is the desired outcome, and it
would leave D2/D3 pinned by nothing but D1's correctness — a single point of failure in
front of an irreversible operation. These pin the evidence gate directly.

Cases: never published · **THE INCIDENT** (stale attestation replayed by the relay) ·
live host after connect · same-`seq` republication · a peer as its own witness ·
malformed attestations · re-baselining on reconnect · `seq` advance and publisher stamp ·
single-transaction atomicity.

**Mutation-checked, not assumed.** Disabling the freshness baseline
(`if (pub.seq <= this.seqAtConnect) return false;` → `if (false)`) fails 3 of the 9,
including "THE INCIDENT". Restored and re-verified afterwards.

---

## 7. Suite idempotency — fixed, and it immediately paid for itself

Both suites were non-idempotent; the dispatcher had flagged that scenario [04] passed on
run 2 only because run 1's node was still there.

- `H:\tmp\liveshare_e2e.py` — every artefact is namespaced with a per-process `RUN` id
  (`empty-card-015034`, `edge-sideless-015034`, `second-015034.canvas`), and
  `sweep_previous_runs()` removes earlier runs' nodes, edges and stray canvases from
  **both** vaults at preflight, reporting the count.
- `H:\tmp\liveshare_dataloss_e2e.py` — per-run canary ids, a sweep before and after,
  set-comparison rather than hardcoded expectations, and a **SKIP is recorded as a SKIP**
  and never folded into the pass count.

Two runs back to back, `-014843` and `-015034`, produced identical results on their own
artefacts — the property that was missing.

**It immediately exposed a vacuous pass.** Scenario [07] (WP79, canvas distribution to a
guest) had been passing. The dispatcher already suspected it of asserting the wrong
precondition, and with the sweep removing the leftover `second-*.canvas` from vault B the
suspicion is confirmed: **[07] is flaky, not deterministic.** Across four runs on three
different bundles it went PASS, PASS, FAIL, PASS, with no correlation to the bundle —
consistent with it depending on whether the guest happens to have the canvas subscribed at
that moment. Its mechanism (`background-sync.ts:97` / `coldOpen`) is untouched by this
batch. **It must not be trusted as a WP79 gate in either direction until it is made
deterministic**: a scenario that flips without a code change is not measuring the thing it
names, and a *passing* [07] would wrongly suggest WP79 is already fixed.

---

## 8. Found and NOT fixed

| # | Finding | Why not fixed here |
|---|---|---|
| 1 | **Host identity is not stable across restarts.** The relay's auto-election rewrites `room.hostUserId` to the surviving peer on every host disconnect, so host and guest swap between restarts (measured repeatedly: A=host → restart → B=host → restart → A=host). Benign now — S3 proves exactly one host and no loss — but every restart triggers a role change and a full purge-republish. | The rewrite is in `server/src/control-handler.ts:588`. **`server/**` edits are out of scope for this batch.** The client-side promotion makes it non-destructive; making it *stable* is a server change. |
| 2 | **A peer promoted before it finished syncing publishes a manifest that omits files it has not received yet**, and `purge: true` then removes those entries. | Pre-existing and identical on the `host-transfer-complete` path; not introduced here. Now bounded on the consuming side — a guest at least requires the assertion to come from a live host rather than from nobody. A real fix is "do not publish a purging manifest until initial sync completes", which is its own work package. |
| 3 | **`isSharedPath` prefix match** (`manifest.ts:443-449`): `normalizePath` strips the trailing slash, so `"_liveshare-testing/secret.md".startsWith("_liveshare-test")` is true. Still **unverified**, as the dispatcher noted. | Out of this batch's scope; it is a confidentiality bug, not the data-loss chain. Cheap to settle with one test. Note it is *adjacent*: a wider `isSharedPath` widens what `cleanupStaleFiles` may delete. |
| 4 | **`plugin/manifest.json` is a broken symlink** to another machine. | Known, no owner, worked around. |
| 5 | **The plugin debug log stopped writing at 2026-08-04T23:56** and produced nothing for any of today's runs, despite `debugLogging: true`. The historical log was decisive for D1's root cause; had it not existed, the diagnosis would have been much harder. | Noticed while diagnosing, not investigated. Worth a look — a logger that silently stops is the same class of defect as a delete that reports nothing. |
| 6 | `types.test.ts` asserted the pre-`7754ac6` `debugLogPath` default and had been failing since that commit. **Corrected** (a one-line truth correction), because a red baseline makes RED/GREEN evidence unreadable. Flagged here since it is another batch's change. | — |

---

## 9. Files changed

| File | Change |
|---|---|
| `plugin/src/files/manifest.ts` | `ManifestPublication`, `meta` map, `getPublication`, `hasFreshPublication`, `setPublicationChangeHandler`, baseline in `connect()`, attestation written in `publishManifest`'s transaction |
| `plugin/src/main.ts` | `cleanupStaleFiles` evidence-gated + returns a decision; `promoteToHost`; `armStaleReconcileRetry`; `demoteToGuest` no longer reconciles |
| `plugin/src/sync/control-handlers.ts` | guest→host promotion on `isHost: true`; host republishes for a new peer; `host-transfer-complete` routed through `promoteToHost` |
| `plugin/src/types.ts` | `StaleReconcileDecision` (placed at the top of the file — position is load-bearing, see the note in §10) |
| `plugin/src/testing/e2e-control.ts` | `manifest.info`, `session.reconcileStale`, `manifest.publish` |
| `plugin/src/__tests__/dataloss/…` | new, 9 tests |
| `plugin/src/__tests__/types.test.ts` | stale assertion corrected |
| `H:\tmp\liveshare_dataloss_e2e.py` | new suite (S1/S2/S3), idempotent |
| `H:\tmp\liveshare_e2e.py` | idempotency: per-run ids + sweep |

No `server/**` edits. No `.bak` files touched. `obsidian-git` left disabled.
`sharedFolder` remains `_liveshare-test` in both vaults and was never set empty.
`data.json` values were never read, printed or fixtured — key presence and sha256 only.

---

## 10. Two notes for whoever touches this next

**`StaleReconcileDecision` must stay at the top of `types.ts`.** The `DEFAULT_SETTINGS`
block contains a `//` comment with the literal `` `${configDir}/**` ``. The WP22 dormancy
test strips comments with a naive non-greedy `/\*[\s\S]*?\*/`, so that `/**` opens a block
comment as far as the test is concerned, and any JSDoc added *below* it supplies the `*/`
that closes the pairing — swallowing `useCanvasBinding: false,` and failing a test that has
nothing to do with the change. Position, not style.

**The E2E rig commands invoke the real methods.** `session.reconcileStale` calls
`plugin.cleanupStaleFiles()` itself — not a copy, not a re-implementation of its rules. A
rig command that re-implements the logic it is testing proves only that the rig agrees with
itself, which is the `canvas.simulateEdit` mistake this project has already paid for once.
