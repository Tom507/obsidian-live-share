# Validation Report — B56, Worker 4, live in two Obsidian instances

**Branch:** `fix-bugs-and-raceconditions` · **Date:** 2026-08-07 · **Rig:** vault A
`ObsidianOrga` :39431, vault B `ObsidianOrga - Kopie` :39432, relay
`liveshare.neuralangels.de`. `sharedFolder = _liveshare-test` verified in both
vaults before and after every arm, and asserted again by every provisioner run.

Suites: `tools/e2e/ls_b56.py` (harness) · `liveshare_b56_provision.py` ·
`liveshare_b56_s81.py` · `liveshare_b56_wp68in.py` · `liveshare_b56_wp93.py` ·
`liveshare_b56_s79_s84.py`. Machine-readable rows and full transcripts in
`tools/e2e/b56_results/`.

---

## 0. The bundle, and the census that dated it

| | sha256 | size |
|---|---|---|
| **Built here**, from commit `1e057e9`, tree clean | `d8818271c5b3e228101d6d34e531fe47e5dee852afa9071a2984261a2b9659c4` | 4 692 730 |
| **Found installed** in both vaults at start | `7922d277940881ecc9d57bbac09531c4bb79961dab5030f1fd244a6e9dceb43f` | 4 609 545 |

The installed bundle was **pre-`fileop.inject` and pre-WP93**, established by
**marker census, not by date**: `fileop.inject` 0, `MUTE OVERRUN` 0,
`mutedAfterDispatch` 0 — against 4 / 2 / 2 in the bundle built here. It was
*post*-WP68/90/91 (`CAPTURE DECLINED` 2, `SEED REFUSAL STORE` 9,
`refusedSidecarRenames` 3 in both). It was B50's bundle, untouched.

Every one of the six installs this batch performed ran under
`LS_EXPECT_SHA256=d8818271…` and every install read back the landed digest. Both
vaults hold `d8818271…` at handover.

**The tree moved under me and it matters for one row.** Repo `HEAD` was
`1e057e9` when I built and `fec039d` when I finished — **WP94 landed in between**
(`dc7f1af`, `71951fc`), together with S90 and S91. So §5's S84 numbers are a
**pre-WP94 profile**, which is what the brief asked for if WP94 had not landed
and is now more useful than that: it is a clean pre-fix control taken on this
rig, this day, against which WP94 can be measured.

---

## 0a. The rig was broken before any arm could run — the relay room was gone

Both instances came up `connected: false` with `reconnectAttempts 10/10,
retryChainEnded`. The plugin's own log:

```
[ERROR] [session]    failed to resume session
[ERROR] [connection] SHARING HALTED: cause=resume-failed  links=control,mux  roomDeleted=false
[INFO ] [connection] control channel auth-required
[ERROR] [connection] control link gave up after 10/10 attempts (cause=exhausted)
```

B44's discriminator reproduced exactly: the relay answers `403 Invalid room or
token` for room `85ecd0cc…` and a bare `403 Forbidden` for a room id that cannot
exist. **Two different answers from the same route** — the relay is up, the room
is gone. `session.rearm` re-armed both chains and both re-failed.

The room was reprovisioned. This is a rig repair, not a product finding, and the
brief's room id is stale from here on.

## 0b. The live role assignment — and it is not a coin flip when you provision

Asked with `session.info` before every arm, never assumed:

| moment | A (:39431) | B (:39432) |
|---|---|---|
| at pickup (stale room) | guest | host |
| after reprovision (host=A) | **host** | guest |
| S81 step 1 | **host** | guest |
| S81 steps 2–3, WP68, WP93, S79, S84 | guest | **host** |
| **at handover** | **guest** | **host** |

Two things worth recording. **Launch order does not decide it** — the installer
opens A first and A came up guest. **Room creation does**: the relay honours the
`hostUserId` given to `POST /rooms`, so `liveshare_b56_provision.py <A|B>` is a
reliable lever on the role assignment. S81's arm is built on that lever, and it
is the reason the arm was runnable at all.

---

## 1. S81 — **PASS.** The `restored N standing` branch has fired, and it was the only thing holding the withhold

### 1.1 Why it had never fired — read from the source first, then measured

`SeedRefusalLedger.note()` is the **only** writer of a refusal and has exactly
two callers, each of which calls `reset()` first, setting `seededThisSession`:

- `canvas-sync.ts:3946` `applyCanvasToYMaps` — the **host** seed, gated on
  `role === "host"` **and** the local file existing;
- `canvas-persistence.ts:739` `seedDocFromCanvasData` — the **cold-open** seed,
  which runs only when the doc is **empty** at cold open.

`hydrateDurableRefusals` (`:641`) restores from the store only when
`hasSeededThisSession` is **false**. So, per path:

> **A session that can RECORD a refusal is exactly a session that cannot RESTORE
> one, and vice versa.**

On a host holding the file the seed runs every session, so the host can never
take the restore branch. That is the structural reason S81 stood, and it says
the branch is reachable only across a **change of role** or of doc-emptiness.
**Needs a signal number.**

### 1.2 The arm, and how S80's precondition was defeated

Three sessions, with the role assignment as the instrument.

**step 1 — A is host, the malformed board is planted in both vaults while
Obsidian is down.** `_liveshare-test/b56-s81-115521.canvas`: two valid nodes, one
edge with `fromNode` and no `toNode` → `MISSING_TO`.

```
09:55:31.714 [WARN] [canvas-sync] INGEST REJECTED signature: boundary=host-seed refused edge b56-s81-115521-BADEDGE (MISSING_TO)
```

and then **nothing** for 150 s — no store entry, no `SEED REFUSAL STORE:` line.
One leaf, opened with `canvas.typeInNode{open:true}` (never `canvas.open`, S45):

```
10:02:33.901 [DEBUG][canvas]              writer attach verdict for …b56-s81-115521.canvas: attach
10:02:33.902 [DEBUG][canvas-persistence]  SEED REFUSAL STORE: … adopted this session's seed verdict (1 refused) — the stored set is re-derived, not restored
10:02:33.912 [WARN] [canvas-persistence]  SEED REFUSED: … write WITHHELD — 1 refused: edge b56-s81-115521-BADEDGE (MISSING_TO)
10:02:33.913 [INFO] [canvas]              CANVAS WRITER: … attached (coldOpen=doc-wins)
```

The durable entry appeared **within 2 s** of the leaf:
`[{"boundary":"host-seed","kind":"edge","id":"b56-s81-115521-BADEDGE","reason":"MISSING_TO"}]`.
That is S80 measured rather than quoted: **150 s without a leaf, 2 s with one.**

**step 2 — a room is provisioned with B as host, so A returns as a GUEST holding
an entry its own seed wrote, and A's copy of the board is removed while A is
down** so WP79's mirror pass is admitted and attaches the writer **with no leaf
open**:

```
10:05:23.643 [WARN] [canvas-persistence] SEED REFUSAL STORE: …b56-s81-115521.canvas restored 1 standing refusal(s) from the durable store — edge b56-s81-115521-BADEDGE (MISSING_TO)
10:05:23.647 [WARN] [canvas-persistence] SEED REFUSED: … write WITHHELD — 1 refused: edge … (MISSING_TO)
10:05:23.648 [INFO] [canvas]             CANVAS WRITER: … attached (coldOpen=doc-wins)
```

`cold_open_seed_ran = False`; no `host-seed` line in this session; no `adopted`
line in this session. **No seed of any kind ran on A**, so re-derivation was
impossible and `restore()` is the only thing that can have been holding the
withhold. `doc-wins` **flushes**, and the flush did not land: A's file stayed
absent for the full 120 s the arm waited **on that observable**. The mirror pass
reports it from its own accounting: `materialised=0 … failed=1`.

**step 3 — THE CONTROL.** Same room, same roles, same absent file, one
difference: A's durable entry for the path deleted while A was down.

```
10:08:17.614 [DEBUG][canvas-persistence] CANVAS WRITER: …b56-s81-115521.canvas owner=CanvasPersistence nodes=2 edges=0
10:08:17.615 [INFO] [canvas]             CANVAS WRITER: … attached (coldOpen=doc-wins)
```

No `restored` line, no `SEED REFUSED`, and the file **landed** — `nodes=2,
edges=0`, the refused record absent. The projection that step 2 withheld is the
projection step 3 wrote.

| row | step 2 (entry present) | step 3 (entry deleted) |
|---|---|---|
| `restored N standing` fired | ✅ **yes, first time in this project's history** | ❌ no |
| `SEED REFUSED: … WITHHELD` | ✅ | ❌ |
| any seed ran on the recorder | ❌ **no** | ❌ no |
| the projection landed | ❌ **withheld** | ✅ landed, `edges=0` |

**Verdict: PASS. WP90's durable path is load-bearing.** The oldest open P0 now
has the row it was missing.

### 1.3 The qualification, and it is not small

What the withhold protected here is **the write**, not existing user bytes — and
that is forced, not a choice of fixture. `decideCanvasMirror`
(`canvas-mirror-decision.ts:109-126`) materialises for a guest **only when the
local file is absent** (`localFileExists !== false` → `SKIP_LOCAL_FILE`), and the
module states the reason itself: *"the pass only ever touches paths with no user
file to destroy."* The host arm returns `PUBLISH` without materialising (C79
AC4). The only other attach route is WP85's per-open-leaf consultation.

> **There is no leaf-less configuration, on either role, in which the withhold
> guards a file that already exists.** Where the file exists, the withhold needs
> an open leaf — and an open leaf puts Obsidian's own normaliser on the same
> file, which is the confound B50 hit in its §2.5.

This widens S80 from *"the host needs a leaf"* to *"anything holding the file
needs a leaf"*. **Needs a signal number.**

---

## 2. WP68 AC2, inbound — **PASS for the predicate as implemented.** And the predicate is narrower than the charter's subject

Injected at the real boundary with `fileop.inject` into the **guest** (A), which
is the peer-reachable side. All four rows delivered via
`control-socket.dispatchEvent`.

| # | op | destination | `mutedAfterDispatch` | `mutated` | verdict |
|---|---|---|---|---|---|
| 0 | `create` | `b56-…-nowhere.md`, outside the shared tree | false | false | dropped by the **ordinary not-shared test**, not by WP68 |
| 1 | `rename` | `.obsidian/liveshare/state/…` | **false** | **false** | **REFUSED** |
| 2 | `rename` | `_liveshare-test/…-moved.canvas` | **true** | **true** | **ADMITTED** |
| 3 | `rename` | `.obsidian/plugins/live-share/…` | **true** | **true** | **ADMITTED** |

**Row 1 is a refusal and not an absence.** The `before` reading proves the source
existed — `_liveshare-test/b56-s81-115521.canvas exists=true size=325
sha256=88b6699ce28dae24…` — and it is unchanged in `after`. The destination is
absent before and after. The product says so itself:

```
10:10:52.890 [WARN] [file-op] refused remote rename touching the sidecar directory (2 paths)
```

`'refused remote rename'` verdict **PRESENT**, `matcher_ok=true`.

**Row 2 is what makes row 1 mean something.** The identical op with a
non-sidecar destination was admitted: the mute was taken, the source is gone,
the destination holds the source's bytes at the same sha256. The gate can pass
things.

**Row 0 is why row 2 was needed at all**: a delivered frame that does nothing
also reads `mutated=false`, so `mutated=false` alone is not evidence of the WP68
gate.

### 2.1 Row 3 — the scope finding, and I think it is the most serious thing in this batch

`isSidecarPath` (`canvas-sidecar.ts:94-103`) is a directory-prefix test over
`SIDECAR_DIR = ".obsidian/liveshare/state"`, and that prefix is the **whole** of
what the WP68 gate tests. WP68's own charter states its subject as *"a
peer-reachable write into this Electron process's own `.obsidian/**`"*.

A peer-shaped rename with `newPath = .obsidian/plugins/live-share/<name>` is
**admitted and applied**. Measured: the mute was taken, the source left the
shared tree, and the destination inside the plugin directory exists afterwards
carrying the source's bytes (`sha256 88b6699ce28dae24…`, size 325). That
directory holds this vault's `data.json` — `serverPassword`, `token`,
`encryptionPassphrase`, `encryptionSalt` — and `main.js`, the code Obsidian
loads.

The chain is complete without any further capability: a peer controls the
content of a shared file, and `oldPath` need only be shared and locally present.
I did **not** test a destination that would overwrite `data.json` or `main.js`,
because that is destructive and, for `main.js`, a live code-execution attempt on
the owner's machine. The structural implication is stated, not demonstrated:
nothing in the measured predicate distinguishes those names from the harmless
one I used.

The probe was moved back immediately; the plugin directory is clean.
**Needs a signal number, and I would treat it as the batch's P0.**

---

## 3. WP93 §7b — AC5 **PASS on both roles**; AC4 **NOT DEMONSTRATED**

### 3.1 AC5 — the no-collateral arm, in the real editor

Four remote ops injected while the local user was idle, run **twice**: once
targeting the guest, once the host.

| op | delivered | mute WAS taken | applied | `isPathMuted` after |
|---|---|---|---|---|
| remote `create` | ✅ | ✅ | ✅ | **false** |
| remote binary `modify` (`binary:true`) | ✅ | ✅ | ✅ | **false** |
| remote `rename` | ✅ | ✅ | ✅ | **false** on both endpoints |
| remote `delete` | ✅ | ✅ | ✅ | **false** |

Not one stranded mute in eight rows. The `mute WAS taken` column is what stops
this being vacuous: if it were false the op never reached `applyRemoteOp` and
`isPathMuted == false` afterwards would be true for free.

**Outbound echo — and one honest split.** Targeting the **guest**, the peer's
shared tree was unchanged for all four ops: no echo. Targeting the **host**, the
peer *did* gain the create, the rename and the delete. That is not the
`vault-events.ts` echo gates leaking; it is `control-handlers.ts`'s `afterApply`,
which is explicitly `if (plugin.settings.role !== "host") return;` and then
updates the manifest and calls `backgroundSync.onFileAdded/onFileRemoved/
onFileRenamed`. The guest/host split matches that branch exactly, which is the
attribution. I could not separate the two mechanisms by instrument alone; the
attribution is from the role split plus the source, and it is offered as such.

Both shared trees were byte-identical before and after this arm.

### 3.2 AC4 — the live overrun counter: **NOT DEMONSTRATED**

There is **no e2e command exposing `getMuteReleaseStats()`**, so the only live
reading available is the `MUTE OVERRUN:` line, whose `(overruns=N)` field is the
counter. Driven under deliberate 16-way CPU contention over a 90 s window:

- `MUTE OVERRUN:` in the window: **0** — and its rule-15 verdict is
  **UNINFORMATIVE**, `history_hits = 0`. **The signature has never been observed
  in this project, so its absence is not admissible as evidence of anything.**
- the telltale the charter asks for: **16 pulses in the window, worst gap
  19 001 ms, and 0 pulses in the 40–70 s clamp band.** No clamp occurred.
- **only 4 mute-taking ops completed in the 90 s**, because under that contention
  each injection round-trip cost ~22 s. That is a thin sample and I am not
  dressing it up.

Per the charter's own words, this is *"the tail is 0.7 %"*, not a pass. I made
one genuine provocation attempt and stopped rather than waiting and calling the
wait a result. **What would close it cheaply is an e2e command returning
`getMuteReleaseStats()`** — the counter is already state, it simply has no
reader; that is a W3 revision request, not a product defect.

---

## 4. S79 — characterised, not repaired, and the door has a name

Driven from the **host**, three destinations, gesture = a plain on-disk move of a
shared file this run created.

| destination | peer lost its copy at `oldPath` | after | peer has the destination |
|---|---|---|---|
| vault root | **yes** | 1.2 s | no |
| `.obsidian/liveshare/state/…` | **yes** | 1.2 s | no |
| another shared path | **yes** | 1.2 s | **yes** (correct rename) |

**Destination-independent, and identical to the tenth of a second** — B50's
finding reproduced on this bundle from the other role.

**The door is the manifest, not the file-op.** Zero `file-op` lines in the window
on either side. What the peer emits instead:

```
[manifest] change[pass=17] added=0 removed=1 updated=0 renamed=0 delegated=1 destroyed=0 aborted=true error=ENOENT: … rename '…\_liveshare-test\b56-s79-122632-vault_root.canvas' -> …
[manifest] change[pass=17] removal delegated _liveshare-test/b56-s79-122632-vault_root.canvas — a local file exists at a path the manifest stopped listing; this route holds no evidence…
[manifest] handler error: ENOENT: no such file or directory, rename …
```

So it is the **manifest-change / removal-delegation** route — the D2/D3 and
WP80/WP86 family — reached because the host stops listing a path it still has,
just elsewhere. It is **not** WP68's door and not the file-op door, which is what
B50's attribution arm predicted without being able to name the mechanism.

**What I could not settle:** the delegated removal reports `destroyed=0
aborted=true` with an `ENOENT`, i.e. it *errored*, and the peer's file is gone
anyway. Either the first attempt succeeded and a retry hit ENOENT, or something
else removed it. The evidence does not separate those and I am not going to
guess. The characterisation that is safe: **destination-independent, host-side
gesture, manifest door, and a removal route that is failing partway while the
file still disappears.**

---

## 5. S84 — the PRE-WP94 profile, with the control that makes it a measurement

Board: a shared canvas on the **host** with `hasAdapter=false, hasWriter=false` —
subscribed, and genuinely **closed**. Oracle: the writer's own doc via
`canvas.state`.

| delta | ADD (the control) | DELETE |
|---|---|---|
| 0.3 s | **captured**, 0.0 s | **NOT captured**, 45 s budget |
| 1.0 s | **captured**, 0.2 s | **NOT captured**, 45 s |
| 2.0 s | **captured**, 0.2 s | **NOT captured**, 45 s |

**The ADD column is the whole point.** The identical gesture — a whole-file
`.canvas` write — on the identical closed board, at the same delta, is captured
every time in a fifth of a second. So the board is being watched and the DELETE
column is a measurement, not a dead instrument. **S84 is confirmed live,
delta-independent, on a closed board, on `d8818271` — which is pre-WP94.**

### 5.1 The first attempt scored nothing, and that is reported rather than dropped

Run from the **guest**, every rung — including the ADD control — failed. Cause,
measured: on this rig the guest holds every shared file, so WP79's mirror pass
returns `SKIP_LOCAL_FILE`, and with no leaf open nothing lazily subscribes. The
guest had **`docNodes=0`, `hasWriter=false`, `hasAdapter=false`** for that board.
**A guest's local edits to a shared canvas it already holds are not captured at
all**, because there is no doc to capture them into. **Needs a signal number.**

The control is what caught this. A suite without the ADD rungs would have
reported six clean "deletion not captured" rows from an instance that was not
watching the board.

### 5.2 B50's precondition had to be relaxed, and it is stated

B50 required the node present on **both** peers before deleting. That is
unmeetable here for the reason above, so the precondition became *present in the
**writer's own** doc*, with the peer's state recorded separately rather than
folded in. `present_in_peer_doc` was `false` for every rung, which is consistent
with §5.1 and is reported, not scored.

---

## 6. Two instrument facts that invalidated a first attempt each

1. **A file created externally into a running vault is never noticed.** Measured:
   a `.canvas` written into the shared folder produced **zero** receipts over
   90 s and was still absent from the doc and the manifest 10 minutes later —
   while a **modify** of an already-indexed shared canvas reached both docs in
   **2.0 s** in the same session. Every fixture in this batch is therefore
   planted while Obsidian is **down**, or created through `fileop.inject`, which
   is a real vault `create`. Any past arm that created a file externally and
   concluded from the absence of an effect was measuring this.
2. **An inbound op applied on a guest is not redistributed** (§3.1). My first
   S79 attempt created its fixtures by injecting into the guest; they never
   reached the peer and all three rows were correctly recorded as **SKIPPED, not
   scored**.

---

## 7. The batch's own teardown was defeated by S84, and that is evidence

Removing this arm's nodes from the `.canvas` file did not remove them from the
doc — which is the finding, applied to me. The doc kept twelve nodes the file no
longer had, and the next writer attach projected them back onto the **owner's**
file. Recovery needed three steps and none of them is a product path: restore the
file bytes from the pre-run snapshot, provision a fresh room (which did **not**
clear it — the doc is replayed from the sidecar), and finally delete that board's
sidecar replica (`6cadde03….ycheckpoint` / `.yhistory`) and its `index.json` row
in both vaults.

**A deletion that cannot be captured cannot be undone by editing the file**, and
there is no user-reachable gesture that clears it. Stated as a consequence of
S84 rather than as a new claim.

---

## 8. Every check that could not be run, and why

| check | why not |
|---|---|
| **WP93 AC4's live overrun counter** | No clamp occurred in the window (0/16 pulses in the 40–70 s band) and the signature's rule-15 verdict is UNINFORMATIVE (`history_hits=0`). One deliberate provocation (16-way CPU contention, 90 s) did not produce one. **Reported as NOT DEMONSTRATED.** |
| `getMuteReleaseStats()` as a live reading | Not exposed by any e2e command. → **W3 revision request.** |
| The `.obsidian/plugins/live-share/data.json` and `main.js` destinations | Destructive, and for `main.js` a live code-execution attempt. Only the structural implication of §2.1 is stated. |
| S84 on an **open** board on this bundle | Not run; B50 already measured that arm and it is not the row S84 adds. |
| S84 with the record present on **both** peers | Structurally unmeetable on this rig (§5.2). |
| Headless `npm test` | Not run. A sibling had `seed-refusal-store.ts` open in the working tree for part of this batch, which is exactly S88's condition, and nothing in this report depends on the figure. |

## 9. What I could not separate from instrument error

1. **§4's `aborted=true` / `ENOENT`.** The peer's file is gone and the removal
   route reports an error. Two readings, and the log does not separate them.
2. **§3.1's host-arm peer delta.** Attributed to `afterApply`'s host branch from
   the guest/host split and the source. Not measured by isolating the branch.
3. **The `[canvas-sync] disk write … nodes=2 edges=0` line at 10:02:34**, logged
   on the instance whose write was withheld one second earlier and whose file
   bytes provably did not change. The file is the oracle and it did not move, so
   no row rests on it — but the line reads like a write that did not happen.

---

## 10. Findings offered for numbering — **I allocated none**

1. **The record/restore mutual exclusion** (§1.1). A session that can record a
   seed refusal cannot restore one, and vice versa; the durable path is reachable
   only across a role change or a change in doc-emptiness. This is *why* S81
   stood, and it means WP90's durability has a precondition nobody had stated.
2. **No leaf-less configuration protects an existing file** (§1.3). Widens S80.
3. **WP68's guard covers `.obsidian/liveshare/state/**` only** (§2.1). A
   peer-injected rename writes into `.obsidian/plugins/live-share/`, which holds
   `data.json` and `main.js`. **Measured, admitted, applied.** I would rank this
   the batch's P0.
4. **An externally created file is never noticed by a running instance** (§6.1),
   while an external modify is noticed in ~2 s.
5. **A guest is not subscribed to a shared canvas it already holds** (§5.1): no
   doc, no writer, no adapter, and therefore no capture of its local edits.

---

## 11. Rig state at handover

- Both vaults hold `d8818271c5b3e228101d6d34e531fe47e5dee852afa9071a2984261a2b9659c4`
  (4 692 730 B), built from `1e057e9`, installed under `LS_EXPECT_SHA256`.
- **A = guest (:39431), B = host (:39432)**, asked via `session.info` after the
  final relaunch. Room `314c85ca-4eb6-491f-9c47-2a5bda4ea75c` — the room in the
  brief no longer exists (§0a).
- `sharedFolder = _liveshare-test` in both, verified after the last run.
- Both shared trees hold their pre-run **8** files. Vault A is byte-identical to
  the pre-run snapshot. Vault B differs in exactly one file, `smoke.canvas`,
  which the plugin re-serialised into its canonical form — **the node and edge
  id sets are identical** and it is now byte-identical to A's copy. The pre-run
  divergence between the two replicas was resolved by the product's own
  projection, not by me.
- Both `seed-refusals.json` are `{"version": 1, "paths": {}}` — every entry this
  batch created was pruned or removed.
- One sidecar replica was deleted in both vaults during recovery (§7):
  `6cadde03efc1e2f4ce01c57a8cfebed8` for
  `_liveshare-test/wp79-035734-one.canvas`, plus its `index.json` row. That
  board's doc now holds its two original nodes and nothing else.
- No `.bak` of the owner's was read or written; this batch's namespace is
  `b56-*` and `.pre-v2-smoke-b56`. Pre-run snapshot at `H:\tmp\b56_snapshot\pre\`.
