# Validation Report — B50, Worker 4, live in two Obsidian instances

**Branch:** `fix-bugs-and-raceconditions` · **Date:** 2026-08-07 · **Rig:** vault A
`ObsidianOrga` :39431, vault B `ObsidianOrga - Kopie` :39432, relay
`liveshare.neuralangels.de`, room `85ecd0cc…`, `sharedFolder = _liveshare-test`
verified before and after every run in both vaults.

Suites: `tools/e2e/liveshare_b50.py` (`ladder` · `wp91ac4` · `wp90` · `wp68`) and
`tools/e2e/liveshare_b50_wp68_attrib.py`. Machine-readable rows in
`tools/e2e/b50_results/`.

---

## 0. The bundles, because S67 says the digest is the measurement

| | sha256 | size |
|---|---|---|
| **Built here** (`npm run build:e2e`) | `7922d277940881ecc9d57bbac09531c4bb79961dab5030f1fd244a6e9dceb43f` | 4 609 545 |
| **Found installed** in both vaults at start | `b672be50fb9de27017903589bd00d913aa9a8cc199bdb03cf87c9862c41df689` | 4 531 099 |

The installed bundle was **pre-WP68, pre-WP90 and pre-WP91**, established by
marker census rather than by date: `CAPTURE DECLINED` 0, `SEED REFUSAL STORE` 0,
`refusedSidecarRenames` 0 — against 2 / 9 / 3 in the bundle built here.

**That accident was the most valuable thing in this batch.** It meant the
pre-fix profile could be measured *on this rig, this night, under these clamp
conditions* instead of being quoted from B44. Every install was run with
`LS_EXPECT_SHA256`; both vaults verified their landed digest each time.

At the end of the batch both vaults hold `7922d277…`.

---

## 1. WP91 — **PASS**, with one shape excluded and separately attributed

### 1.1 The delta ladder, rung by rung

Oracle: **the writer's own doc**, read back through `canvas.state`. A swallow is
`writer.file = True, writer.doc = False`. Peer arrival is recorded separately so
"never captured" and "captured, never delivered" cannot be conflated.

| delta | PRE-FIX `b672be50` | POST-FIX `7922d277` |
|---|---|---|
| 0.1 s | **0 / 4 captured** | 3 / 3 captured |
| 0.3 s | **0 / 4** | 3 / 3 |
| 0.5 s | **0 / 4** | 3 / 3 |
| 0.8 s | **0 / 4** | 3 / 3 |
| 1.0 s | 2 / 2 captured | 3 / 3 |
| 2.0 s | 2 / 2 captured | 3 / 3 |

Shapes `CTRL_NODE_A`, `EDGE_A`, `NODE_B`. `DELETE_A` is excluded from both
columns and is §4.1.

**The block that decides it is 0.3–0.8 s.** Pre-fix it captured nothing;
post-fix it captures everything, and it now behaves exactly like the ≥ 0.9 s
block did before. The ladder does **not** merely "pass everywhere" — the rungs
that always passed (1.0 s, 2.0 s) passed in both columns, which is what makes
the 0.1–0.8 s column a measurement and not a tautology.

**The receipt tracks the state exactly.** Every pre-fix swallowed rung recorded
**zero** `local modify` receipts; every captured rung recorded one or more. The
event was not being declined — it was never arriving.

Four pre-fix rungs at 1.0/2.0 s were discarded as **INVALID** because their
positive-control marker never landed. They are reported as discarded, not as
results — the rule B41's own script states and the one B44's `≤ 0.5 s, 20/20`
row broke.

### 1.2 AC4, the second step — the destruction reproduced and then closed

| | PRE-FIX `b672be50` | POST-FIX `7922d277` |
|---|---|---|
| step 1: user's write at δ = 0.3 s | **SWALLOWED** (bytes on B's disk, absent from B's doc) | **CAPTURED** |
| step 2: one further remote change, structural | projection written to B's file in **0.41 s** | projection written in **0.41 s** |
| the user's node afterwards | **GONE from their own disk** | present on B's disk **and** on A's |

Pre-fix verdict: **I11 RED — the user's bytes were destroyed.** This is the half
B44 could not see: its file survived because `flushToDisk` deduped and *nothing
tried*. Here something provably tried — the step-2 record is required to land in
the writer's file before the survival question is asked at all — and the user's
node did not survive it.

Post-fix: step 1 captures, so step 2 can never reach the loss.

### 1.3 The new signature behaves as specified

`CAPTURE DECLINED: _liveshare-test/smoke.canvas reason=echo (declines=2…6)` —
fires live, with `reason=echo`, and the user's own edit **never** appears as a
decline. In the post-fix ladder the counts move with the shape (8 modifies / 4
declines for a host-side node, 3 / 2 for a guest-side one) rather than being
constant, which is what a real counter looks like.

---

## 2. WP90 / S73 — **S73 RESOLVED**; WP90 **PARTIAL**

### 2.1 `SEED REFUSED:` fired live, for the first time in this project

Planted: `_liveshare-test/wp90-c50.canvas` on the **host**, carrying two valid
nodes and one edge with `fromNode` and no `toNode` → `validateEdgeIngest` →
`MISSING_TO`, `reject: true`.

```
01:23:49.083 [WARN] [canvas-sync]        INGEST REJECTED signature: boundary=host-seed refused edge wp90-c50-BADEDGE (MISSING_TO)
01:23:49.325 [DEBUG][canvas-persistence] SEED REFUSAL STORE: …/wp90-c50.canvas adopted this session's seed verdict (1 refused) — the stored set is re-derived, not restored
01:23:49.331 [WARN] [canvas-persistence] SEED REFUSED: …/wp90-c50.canvas write WITHHELD — 1 refused: edge wp90-c50-BADEDGE (MISSING_TO)
01:23:52.597 [DEBUG][canvas-persistence] SEED REFUSED: …/wp90-c50.canvas write WITHHELD — 1 refused: edge wp90-c50-BADEDGE (MISSING_TO)
01:23:58.133 [WARN] [canvas-sync]        INGEST REJECTED signature: boundary=capture-net refused edge wp90-c50-BADEDGE (MISSING_TO)
```

Both levels appear — the WARN arming and the quieter DEBUG repeat — which is
`writeIsWithheld`'s documented "quieter, but never silent" behaviour executing.

**The withhold demonstrably held:** a remote nudge reached the refusing
instance's **doc** (`True`) and never reached its **file** (`False`). That is
positive evidence that a write was attempted and suspended, not that nothing
happened.

### 2.2 The answer to S73 is BOTH readings, plus a precondition nobody had stated

The first attempt planted the record and produced **`INGEST REJECTED` but no
`SEED REFUSED:`** — and the reason is the interesting part:

> `SEED REFUSED:` is emitted only from `CanvasPersistence.writeIsWithheld()`,
> reached only from `flushToDisk`. **If no `CanvasPersistence` is attached to the
> path, the withhold is never consulted and the signature cannot fire however
> many records were refused.** On the **host** a writer is *not* attached by
> WP79's mirror pass (C79 AC4 forbids materialising the host's own file, so it
> returns `PUBLISH`); the only other trigger is WP85's per-open-leaf attach
> consultation. **The board has to be open on the refusing instance.**

So S73's two readings are not exclusive: no malformed record had ever been
present, **and** the withhold arm additionally requires an attached writer, which
on the host requires an open leaf. Both are now shown reachable. The first
attempt is recorded here because it looked exactly like a product finding and
was an instrument gap.

### 2.3 What the same run destroyed, on the other instance

In that first attempt the **guest** replicated the file, cold-opened it
`doc-wins`, and wrote `nodes=2 edges=0` over it — the malformed edge is gone from
the guest's disk. No refusal was ever recorded there, because the seed does not
run there, so nothing withheld the write. This is WP90 AC1's predicted role
control, observed live: **host arm survives, guest arm destroys.** WP90 does not
claim to protect it, and its durable store cannot: a refusal only exists where a
seed ran.

### 2.4 Across a real restart

Both instances restarted through `liveshare_e2e_install.py` (same digest).

| row | result |
|---|---|
| durable store present at session-2 start | ✅ `seed-refusals.json` holds `_liveshare-test/wp90-c50.canvas → [{host-seed, edge, wp90-c50-BADEDGE, MISSING_TO}]` |
| withhold in force in session 2 | ✅ `SEED REFUSED: … write WITHHELD` at `01:25:30.724`, before any session-2 action of mine |
| **the withhold was produced by the durable record** | ❌ **NO** — `SEED REFUSAL STORE: … adopted this session's seed verdict (1 refused) — the stored set is re-derived, not restored`. The host seed re-derived it. The durable record was **not load-bearing** in any run I took. |
| the lift lifts, across the restart | ✅ repair → `SEED RESTORED: … refused set is empty — resuming the canonical projection write` → `CANVAS WRITER: … nodes=3 edges=1`, and the store entry is pruned (`n_paths` 1 → 0) |
| the refused record still on disk after the restart | ⚠️ **NOT DEMONSTRATED** — see below |

**The hydration branch never fired.** `SEED REFUSAL STORE: … restored N standing
refusals` has zero occurrences. Every session I observed re-derived the verdict
from the host seed, which is precisely AC4's *"the host is accidentally safe"* —
still accidental, and now the accident is what makes the durable half look like
it works. **WP90's durability is written, persisted and read; it has not yet
been shown to be the thing that protects anything.**

### 2.5 Why the on-disk survival row is NOT DEMONSTRATED

The host seed refused the record at `01:25:30.710` *after* the restart, which
proves the record was still on disk then. My check ~30 s later read it as gone —
and there is **no `CANVAS WRITER:` line for that path in the interval**
(`CANVAS WRITER:` has 2 000 historical hits, so the pattern is proven matchable).
**The plugin's single writer did not remove it.**

The board was open on that instance — which §2.2 shows is *required* for the
withhold to be consulted at all — and Obsidian's own canvas view is then a second
writer to the same `.canvas`. An edge with no `toNode` is not a thing that view
will preserve. I did not confirm this further, so it is stated as: *the
plugin did not write it, the most likely other writer is Obsidian's own canvas
view, and the record I chose is one the host application normalises away.*

**Consequence, and it is a real tension rather than a fixture problem:** on the
host, the withhold requires an open leaf, and an open leaf puts Obsidian's own
normaliser on the same file. A withhold protects the user's bytes from the
*plugin's* projection and not from the host application. **Needs a signal
number.**

---

## 3. WP68 — security property **PASS**; AC3 as written **FAILS**, but not because of WP68; inbound **NOT DEMONSTRATED**

**The instrument was tested first**, because every "no rename was emitted"
reading is otherwise true for free. Control: an ordinary shared → shared rename
performed on disk in vault A **propagated** — the peer gained the new path and
lost the old. Renames are observable on this rig.

| row | result |
|---|---|
| **shared → sidecar: the peer's `.obsidian/**` receives nothing** | ✅ **PASS.** `d1_B_sidecar_written = False`. The peer-reachable write into `.obsidian/**` is shut. |
| sidecar file leaks to the peer on create | ✅ `False` |
| A's own moved file, both directions | ✅ present at the destination, **bytes byte-identical** (sha256 compared) |
| **the peer keeps its copy at `oldPath`** | ❌ **False** — the peer's copy is gone |
| inbound: the receiver refuses independently | ⚠️ **NOT DEMONSTRATED** — see §5 |

### The peer-file loss is attributed, and it is not WP68's

`liveshare_b50_wp68_attrib.py` runs three arms whose only difference is the
destination:

| arm | destination | peer kept its copy at `oldPath` |
|---|---|---|
| `inside` | another shared path | False (and gained the new path — correct) |
| `root` | **vault root**, not a sidecar path, WP68's guard cannot fire | **False** |
| `sidecar` | `.obsidian/liveshare/state/…` | **False** |

**Any rename out of the shared tree removes the peer's copy, sidecar destination
or not.** So C68 AC3's stated invariant — *"Divergence … is the accepted outcome;
deletion is an abort criterion"* — does **not** hold on this rig, and **WP68's
refusal is not what breaks it.** The destructive step is upstream of the guard,
in whatever turns "this path left the shared tree" into a deletion on the peer.
That is the I11 / D2 shape again: an absence translated into a destructive
action. **Needs a signal number.**

The `sidecar → shared` direction gave `peer has the destination = True`, and my
instrument **cannot distinguish** "the refused rename was applied" from "the file
entered the shared tree and was replicated by the ordinary create path". Given
that the out-of-tree arms show renames are *not* carried to peers as moves, the
create path is the likely explanation — but I did not establish it, so it is
reported as undistinguished rather than as a pass.

---

## 4. Findings that are not any of the three work packages

### 4.1 A node deletion expressed as a whole-file `.canvas` write is never captured

`DELETE_A` — the ladder's node-deletion shape, with its precondition (the node
must be present on **both** peers) satisfied every time:

| bundle | δ = 0.1–0.8 s | δ = 1.0 s | δ = 2.0 s | δ = 6.0 s |
|---|---|---|---|---|
| pre-fix `b672be50` | 0 captured | *(invalid rungs)* | — | **0 / 1** |
| post-fix `7922d277` | 0 captured | 0 captured | 0 captured | **0 / 1** |

Measured at a 45 s observation budget, and the δ = 6.0 s pre-fix control ran with
the **S71 clamp inactive** (11 s flush wait, zero `AWARENESS GAP:` in window).

- **Delta-independent** — therefore not the WP91 window.
- **Identical on both bundles** — therefore **pre-existing, not a WP91
  regression.**
- The signature is distinctive: **one `local modify` receipt and zero
  `CAPTURE DECLINED:`**. The event reaches the capture path and is not declined;
  the deletion simply never reaches the doc. The peer keeps the node.

B44 had already found that the deletion scenario `[06] B: node gone` was a green
that could not fail. **With that green removed, live node deletion appears never
to have been demonstrated at all.** **Needs a signal number.**

### 4.2 WP80 held live, under a real host churn

Mid-batch the room's host moved: A `resuming as host` → `demoted from host —
another host exists`; B `resuming as guest` → `promoted to host — server
designated this peer as the room host`. The publish that followed:

```
[manifest] publish[promote-to-host] verdict=purge published=true purged=true entries=8 deleted=0 unaccounted=0
```

**`deleted=0`.** This is the exact transition that produced the confirmed data
loss on 2026-08-05, and WP80's completeness evidence stopped it. Verified
independently: no file of the owner's is missing from either shared tree against
the pre-run snapshot, across **four** restarts.

### 4.3 S71 is real, was active, and cost this batch an hour of instrument time

Measured at 02:40: `AWARENESS GAP: 60006ms … source=tick` on **both** vaults,
debug log trailing wall-clock by **90 s**. It later relaxed to 0–11 s. The B41
ladder takes two S65-guarded reads per rung, so 24 rungs would have been 1–2
hours of pure wait. `liveshare_b50.py` takes **one** guarded read for the whole
run and attributes receipts by stamp — same watermark guard, same rule-15
controls, 1/24th of the wait. Every absence in this report carries its
historical-hit control; every `UNINFORMATIVE` verdict is printed as such and no
claim is built on one.

---

## 5. Every check that could not be run, and why

| check | why not |
|---|---|
| **WP68 AC2 — the receiver refuses independently of the sender** | The e2e control surface has **no command to inject a hand-built `FileOp`**, and both peers run the same guarded build, so neither will ever emit a sidecar rename to be refused. This is the one AC that is about surviving a hostile or older peer and it is **unreachable from this rig**. → **W3 revision request: a `fileop.inject` command taking a raw op for the inbound path.** |
| WP68 `sidecar → shared` refusal | Cannot be distinguished from ordinary create-path replication (§3). |
| WP90 — the record's on-disk survival across the restart | Confounded by Obsidian's own canvas view rewriting the open `.canvas` (§2.5). A record the host application preserves is needed. |
| WP90 — the durable store as the *cause* of a session-2 withhold | The host seed re-derives first every time; the `restored N standing` branch never fired (§2.4). Needs a fixture where the refusing instance does **not** re-seed. |
| WP91 AC4 pre-fix on the *host* side | Only the guest arm was driven. The mechanism is role-independent by construction, but only one arm was measured. |
| Headless `npm test` | Not run. S74 says the figure is unquotable without a caveat and nothing here depends on it; the whole point of this batch is the product doing the thing. |

## 6. Anything that could not be distinguished from instrument error

1. **The four INVALID pre-fix ladder rungs** (markers that never arrived at
   δ = 1.0/2.0 s). Discarded, not reported. Most likely the marker write itself
   being swallowed by the same defect, which would make them evidence *for* it —
   but that is a guess and they are counted as nothing.
2. **The WP90 phase-2 poke that never reached the refusing instance's doc**
   (30 s timeout). Could be §4.1's class, could be post-restart subscription
   timing. Not established; the rows that depend on it are not claimed.
3. **§2.5's disappearance.** The plugin's writer provably did not do it. The
   attribution to Obsidian's canvas view is an inference from "the board was
   open and no other writer exists", not a measurement.
4. My own **store reader bug** — it read the top level of `seed-refusals.json`
   and reported `n_paths=2` for `{"version","paths"}` with no entry for the run.
   It looked like a missing durable record. Fixed, and recorded here because a
   reader bug that manufactures a product finding is exactly this run's dominant
   class pointed at the instrument.

---

## 7. Rig state at handover

- Both vaults hold `7922d277940881ecc9d57bbac09531c4bb79961dab5030f1fd244a6e9dceb43f`.
- **Roles have swapped: A = guest (:39431), B = host (:39432)**, by server
  designation, not by the D1 defect. Documents assuming A = host need updating.
- `sharedFolder = _liveshare-test` in both, verified after the last run.
- Both shared trees are back to their pre-run 8-file state; no artefact of this
  batch remains; no `.bak` of the owner's was touched. Pre-run snapshot at
  `H:\tmp\b50_snapshot\pre\`.
