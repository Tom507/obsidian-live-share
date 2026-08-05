# Implementation Report — WP82: connectivity is measured, not latched

**WP:** WP82 · **Batch:** B30 · **Worker:** 3 (Implementation) · **Date:** 2026-08-05
**Branch:** `fix-bugs-and-raceconditions` · **Commits:** `73b7f35` (implementation + tests), `<report commit>` (this file + charter §7–§10)
**Status:** **DONE**, with **one declared deviation** (AC5's live exhaustion row — §AC5 below, with the reason and the substitute evidence).

---

## 0. THE CORRECTION THAT MUST NOT BE LOST (S41) — stated first, as the charter requires

**No connection ever dropped. The reported log silence did not occur. `autoReconnect` did not fail to fire.**
All three of the incident report's supporting claims are false; the defect is real and is worse than reported.
What was measured instead, on this batch's own runs:

| Reported | Measured, this batch |
|---|---|
| "the connection dropped" | **Both sockets OPEN throughout.** In the RED reproduction the broken peer reported `control.readyStateName = "OPEN"` and `mux.readyStateName = "OPEN"` **while `session.info.connected` was `false`**, and the relay reported `clients: 2` in the same minute. |
| "38 connection lines, newest 2026-08-01" | Vault A's log holds **10 470 lines** with **151 `[connection]` lines dated before this batch started** and **197 after**; vault B **9 556 / 160 / 110**. The file is appended to continuously. |
| "`autoReconnect: true` never fired" | **`autoReconnect` is not a reconnect driver.** Its only non-UI read is one conjunct of the `onLayoutReady` auto-resume gate; neither retry loop consults it. Its settings description now says so (AC5). |
| "relay `clients: 2` contradicts A" | It contradicts nothing (**S35**). `clients` counts **mux sockets only**, and both mux sockets were genuinely alive — confirmed here by the fact that a **mux** `close` moves the counter and a **control** `close` does not. |
| "vault B was the healthy control" | **Neither peer's `connected` was a measurement before this WP.** Confirmed by construction: the repair changes the operands, not the expression. |

---

## 1. What the defect actually was, and what changed

`plugin.controlConnected` was a **latch** written `true` at exactly two sites, **mutually exclusive by role**:
`main.ts`'s ControlChannel `connected` callback (gated `role === "host"`, at socket-open) and
`control-handlers.ts`'s `join-response` handler (reachable only past a `role !== "guest"` return).
A peer that resumed as **guest** and was then **promoted** by the relay's `join-response` fell between both
and was never marked again for the life of the session — while both of its sockets were open, every file
operation it performed went into an unbounded `OfflineQueue` whose only drain is an edge that could no
longer occur, and its status bar read `Live Share: hosting`.

**The repair is not a better latch.** Three notions of connectivity coexisted; the sockets — the only true
one — were read by nothing. Now:

| | Before | After |
|---|---|---|
| definer | none; three rivals | **`plugin/src/sync/link-state.ts`** — pure, **zero imports**, no I/O |
| `muxConnected` / `controlConnected` | latched fields | **getters** that hand the socket's live `readyState` to the definer; the assignment records a **belief**, reported separately |
| `session.info.connected` | `Boolean(mux) && Boolean(control)` | **byte-unchanged** — its two operands became measurements |
| `updateOnlineState` | hand-rolled conjunction of two latches | `setOnline(this.getSharingVerdict().sharing)` |
| status bar | `ConnectionStateManager`, which **never sees the mux** | the definer's verdict; `connectionState` is now an **operand** of it |
| mux lifecycle | narrated nothing at all | open / close(forced) / numbered retry / gave-up / abandoned |

---

## 2. Roles each live instance RESUMED as — quoted from its own line (S37 discipline)

```text
RED  run (bundle 5ff78ec6…, instruments only, latch UNREPAIRED)
  A  2026-08-05T04:52:47.386Z [INFO] [session] resuming as host
  B  2026-08-05T04:53:02.874Z [INFO] [session] resuming as guest

GREEN run (bundle 69338288…, full WP82)
  A  2026-08-05T05:04:25.191Z [INFO] [session] resuming as guest
  B  2026-08-05T05:04:40.655Z [INFO] [session] resuming as host
```

**The roles are OPPOSITE between the RED and the GREEN run.** S37's coin flip is therefore a
**role-symmetry control** here rather than a confound — the same instrument produced the defect on a peer
that resumed as guest (RED, vault B was the survivor) and the repair on a peer that resumed as guest
(GREEN, vault A was the survivor), with the *other* vault holding host in each case.

**Both live runs used ports 39431 (A, `vaultId 703aa794cc73a117`) and 39432 (B, `vaultId 55a4253eb7a90dde`).**

---

## 3. RED → GREEN, the live reproduction

Driver: `H:\tmp\liveshare_wp82.py` (idempotent; every break paired with its restore in a `finally`;
log evidence taken as a byte-offset delta so no scenario depends on a previous run's log).

### The chain — user-reachable, no kill, no crash, no network fault on the peer that breaks

1. the host's control socket closes with a peer still present → the relay auto-elects the survivor and
   rewrites `room.hostUserId`;
2. the survivor's control socket closes and reconnects → it opens while `settings.role === "guest"`, so
   the pre-WP82 host-only gate at socket-open is false;
3. its `join-request` is answered `isHost: true` → `promoteToHost()` → the pre-WP82 handler `return`s
   **before** the connected marking.

**Both break shapes are required to produce it, and this is the concrete reason AC3 demands two.**
The host is additionally `silence`d before its `close`, so its own reconnect (300 ms backoff) cannot
re-send `join-request` and reclaim the room; and the survivor is `silence`d during the election so it
**drops** the `host-transfer-complete` that would otherwise promote it through a path where its link was
already marked. *A `close`-only instrument cannot reach this state* — measured across three failed
attempts before the shapes were combined.

### RED — measured, and it persisted

```json
{
  "hostAtEntry": "A", "survivor": "B",
  "survivorRoleAfter": "host",
  "survivorConnectedAfter": false,
  "survivorPromoted": true,
  "survivorLinks": {
    "control": {"readyStateName":"OPEN","believedConnected":false,"beliefDisagrees":true,"up":true},
    "mux":     {"readyStateName":"OPEN","believedConnected":true, "beliefDisagrees":false,"up":true}
  },
  "survivorFileOpsOnline": false,
  "survivorStatusBarText": "Live Share: hosting (2) 9ms",
  "sessionLines": ["2026-08-05T05:01:54.141Z [INFO] [session] promoted to host - server designated this peer as the room host"]
}
```

Pinned to the millisecond, from the survivor's own log:

```text
2026-08-05T05:01:53.775Z [INFO] [connection] control link broken by e2e seam (shape=close)
2026-08-05T05:01:54.130Z [INFO] [connection] control link open (reconnect=true)
2026-08-05T05:01:54.132Z [INFO] [connection] control channel connected
2026-08-05T05:01:54.141Z [INFO] [session]    promoted to host - server designated this peer as the room host
```

**9 ms** between socket-open and promotion. The charter's live case took 106 ms; this is the same window.

**It persisted.** Re-read ~90 s later, after the scenario's own `restore` of every link:

```json
port 39432 -> {"role":"host","connected":false}
link.report -> control {"rs":"OPEN","believed":false,"disagrees":true},
               mux {"rs":"OPEN","believed":true,"disagrees":false},
               "fileOpsOnline": false, "statusBar": "Live Share: hosting (2) 8ms"
relay /healthz -> {"sessions":1,"documents":9,"clients":2}
```

**That is the before-state contradiction the charter demands be recorded as such:
`Live Share: hosting` on screen, `connected: false` in `session.info`, both sockets `OPEN`, and the
file-op route dead.**

### GREEN — same script, opposite roles

```json
{
  "hostAtEntry": "B", "survivor": "A",
  "survivorRoleAfter": "host",
  "survivorConnectedAfter": true,
  "survivorPromoted": true,
  "survivorLinks": {
    "control": {"readyStateName":"OPEN","believedConnected":true,"beliefDisagrees":false,"up":true},
    "mux":     {"readyStateName":"OPEN","believedConnected":true,"beliefDisagrees":false,"up":true}
  },
  "survivorFileOpsOnline": true,
  "survivorStatusBarText": "Live Share: hosting (2) 9ms",
  "sessionLines": ["2026-08-05T05:05:50.085Z [INFO] [session] promoted to host - server designated this peer as the room host"]
}
```

Same promotion path (`server designated this peer as the room host` — the `join-response` branch, not the
transfer branch), and the peer is now **connected, role-backed and transmitting**.

> **Declared deviation on AC1's "with no session restart":** a peer already sitting in the broken state
> cannot be observed across a bundle swap, because installing a bundle restarts Obsidian. The GREEN
> evidence is therefore the *same deterministic reproduction re-run on the corrected bundle*, plus the
> headless RED→GREEN at the handler seam (§AC1). Stated rather than glossed.

---

## AC1 — the connected marking is a function of the link, not of the role

**Deliverable landed.** `control-handlers.ts`: the marking is **hoisted above both role branches**
(structurally asserted: exactly one occurrence, and its index is below neither `promoteToHost` nor
`demoteToGuest`). `main.ts`: the `if (this.settings.role === "host")` gate around the socket-open marking
is **gone** (structurally asserted, with a positive control that the pattern still finds the *other*,
legitimate `role === "host"` check in `connectSync`).

**Four role rows, headless, at the `registerControlHandlers` seam with a fake channel.** The test models
the **pre-WP82** `main.ts` gate faithfully, so only the handler under test can turn row 1 green.

| row | ordering | against the CURRENT tree | against HEAD (detached worktree, unrepaired) |
|---|---|---|---|
| **1** | resume guest → `isHost:true` → **promoted** | **PASS** | **FAIL** ← the live defect, the only discriminating row |
| 2 | resume host → `isHost:false` → demoted | PASS | PASS |
| 3 | resume guest → `isHost:false` (ordinary guest join) | PASS | PASS |
| 4 | resume host → `isHost:true` (ordinary host) | PASS | PASS |
| 5 | structural: the marking is reached before either branch returns | **PASS** | **FAIL** |

Measured RED at HEAD: `Tests 2 failed | 3 passed (5)`. **The three rows that pass on the unrepaired build
are exactly the non-discriminating ones** — recorded, because asserting only those is the vacuity the
charter names.

**The "set it unconditionally" trap is closed structurally, not by discipline:** the marking is a
*belief*, and `controlConnected` is no longer that belief — it is `isLinkUp(snapshot)`, i.e.
`hasSocket && readyState === OPEN`, taken from the socket. A genuinely dead control link cannot report
healthy however the belief is set. Two headless rows assert exactly this (the defect and its mirror).

---

## AC2 — a peer reports each link separately, and every field is read from the link

**Command:** `link.report` (additive; optional on `E2EControlHost`, on the `vaultId` / `canvas.file`
precedent, so the ~24 fake hosts carrying `controlConnected` still compile).

Per link: `hasSocket`, **`readyState` read from the socket at call time** + `readyStateName`,
`believedConnected` (the peer's own belief, under its own name), **`beliefDisagrees`**, `up`,
`reconnectAttempts`, `maxReconnectAttempts`, `retryChainEnded`, `lastChangeAt`, `silenced`.
Plus once each: `offlineQueueDepth`, `fileOpsOnline`, `sharing`, `roleBacked`, `state`, `healthy`,
`downLinks`, `endedLinks`, `desyncedLinks`, `reason`, and `statusBarText` **read back from the live
status-bar element**.

**Live, both vaults, GREEN baseline:**

```json
A  control {rs:OPEN, believed:true, disagrees:false, attempts:0/10, ended:false}
   mux     {rs:OPEN, believed:true, disagrees:false, attempts:0/15, ended:false}
   state=connected sharing=true roleBacked=true queue=0 fileOpsOnline=true
   statusBarText="Live Share: joined (2) 9ms"
B  control {rs:OPEN, believed:true, disagrees:false, attempts:0/10, ended:false}
   mux     {rs:OPEN, believed:true, disagrees:false, attempts:0/15, ended:false}
   state=connected sharing=true roleBacked=true queue=0 fileOpsOnline=true
   statusBarText="Live Share: hosting (2) 9ms"
```

**The one state where the belief and the socket CAN disagree, shown disagreeing** — read from the live
socket in the same response as the break, in the window between `close()` and `onclose`:

```json
{"readyStateBeforeName":"OPEN","readyStateAfterName":"CLOSING","breakId":7,
 "control.believedConnected":true,"control.readyStateName":"CLOSING","control.up":false,
 "control.beliefDisagrees":true,"desyncedLinks":["control"],"sharing":false}
```

and five seconds later, unprompted:

```json
{"control":{"readyStateName":"OPEN","believedConnected":true,"beliefDisagrees":false,"up":true},
 "sharing":true,"desyncedLinks":[],"fileOpsOnline":true}
```

**No field is an echo of `muxConnected` / `controlConnected`.** The RED run is the proof rather than the
claim: it reported `believedConnected:false` **and** `readyStateName:"OPEN"` on the same link in the same
response. A report derived from the peer's booleans could not have produced those two values together —
it would have said "disconnected" about an open socket, which is the defect wearing a new field name.
**No field is a literal**; `readyState` comes from `ControlChannel.getLinkSnapshot` / `SyncManager.getLinkSnapshot`,
which read `this.ws.readyState` or report `ABSENT` when there is no socket object at all.

---

## AC3 — a link can be broken on demand, in two shapes, with off-client positive controls

**Commands:** `link.break {link, shape}` and `link.restore {link}` (additive). **Both arguments are
validated at the command boundary, before the host and therefore before any socket is reached**, so a
refused call cannot half-break anything (I11).

```json
unknown link    -> {"ok":false,"error":"refused: unknown link 'sidecar' — expected 'control' or 'mux'"}
unknown shape   -> {"ok":false,"error":"refused: unknown break shape 'kill' — expected 'close' or 'silence'"}
missing arg     -> {"ok":false,"error":"missing or invalid string arg: 'link'"}
restore unknown -> {"ok":false,"error":"refused: unknown link 'sidecar' — expected 'control' or 'mux'"}
state after the four refusals -> {"A.sharing":true,"B.sharing":true}   ← nothing was touched
```

A link with no channel object on this instance is a **named refusal in `main.ts`** before any state is
read (`refused: no control channel exists on this instance`).

### The mandatory off-client positive controls — and the two shapes DIFFER on them

| shape · link | off-client witness | RED run | GREEN run |
|---|---|---|---|
| `close` · **mux** | relay `GET /healthz` → `clients` | **2 → 1 → 2**, drop of **exactly one**, restored | **2 → 1 → 2** |
| `silence` · **mux** | relay `clients` | **2, 2, … 2** — 20 one-second samples, **moved not at all** | **20 × 2** |
| `close` · **control** | the **other** peer's view of `presence-leave` | peer status bar `"…hosting (2) 8ms"` → **`"…hosting 8ms"`** → `"(2)"` again | `"…hosting (2) 8ms"` → **`"…hosting 8ms"`** → `"(2)"` again |

The control witness is read **from the peer**, never from the peer that was broken: the `(N)` suffix is
composed from `remoteUsers.size`, and `handlePresenceLeave` is the only thing that shrinks it.
The window is ~300 ms (the reconnect's base backoff), which is why it is sampled at 10 Hz — a 1 s poll
walks straight past it and would have reported a false absence.

**`silence` ends only by the peer's own pong deadline**, and that close is marked as watchdog-forced:

```text
2026-08-05T05:05:00.837Z [INFO] [connection] mux link broken by e2e seam (shape=silence)
2026-08-05T05:05:24.665Z [INFO] [connection] mux link closed (forced=true)     ← +23.8 s
```

whereas `close` produces `mux link closed (forced=false)` in **9 ms**. *An implementation that quietly did
the same thing twice fails this pair; this one does not.*

Every break additionally returns the socket's `readyState` **immediately before and after**, read from the
live socket (`OPEN → CLOSING` for `close`; `OPEN → OPEN` for `silence`), plus a **monotonically increasing
`breakId`** (observed 1…7 across the runs).

**`restore` is required and its effect is asserted, not assumed** — headless: after `restore` a `send`
reaches the socket again (paired with a control that shows it did not while silenced); live: every
scenario ends with a restore in a `finally` and the run's last act re-restores every link on both vaults.
**Final live state, both vaults: `silenced:{control:false, mux:false}`, both links `up`, `sharing:true`,
queue 0. No link was left silenced.**

### The seam is unreachable in a production build — measured, with a positive control

`node esbuild.config.mjs production` → 861 854 B. Fixed-string counts (`grep -F`, because `grep -o "link.break"`
treats `.` as a wildcard and reported two false hits — rule 15, caught in this batch):

```text
e2e-control   0      breakLink     7     (class methods, no caller — explicitly permitted by §2)
link.break    0      restoreLink   4
link.report   0      e2eBreakLink  1
link.restore  0
case "link.   0
positive control (the same grep -F finds what IS there):
  cleanupStaleFiles 12   controlConnected 12   decideSharing 2   "link broken by e2e seam" 1
```

Structurally asserted too: no `addCommand`/`onClick` path reaches the seam, `commands.ts` /
`ui/settings.ts` / `control-handlers.ts` contain no reference to it (each with a positive control that
the file really does register commands / toggles / handlers).

---

## AC4 — the mux link narrates its own lifecycle

**Before/after line counts, split at the first WP82 bundle install (`2026-08-05T04:52`):**

| pattern | vault A before / after | vault B before / after |
|---|---|---|
| `mux link ` | **0** / **41** | **0** / **13** |
| `control link ` | **0** / **60** | **0** / **43** |
| `control channel ` *(pre-existing signature)* | 151 / 22 | 160 / 16 |
| `[connection]` *(category)* | 151 / 197 | 160 / 110 |

Positive control for the scan: the same pass finds 117 (A) / 126 (B) `control channel connected` lines in
the **before** window, so it is capable of matching there — the `mux link` zero is a real absence.

**The two shapes produce DIFFERENT lines** — the discriminating assertion, not "some line appeared":

```text
close   : mux link closed (forced=false)   then  mux link retry 1/15 in 100ms  then  mux link open (reconnect=true)
silence : mux link closed (forced=true)    ← only this shape, and only after the pong deadline
```

**Declared new log signatures** (all under the existing `"connection"` category; the renderer is the pure
`describeLifecycle`, one row per kind, machine-contract-stable):

```text
<link> link open (reconnect=<bool>)
<link> link closed (forced=<bool>)
<link> link retry <attempt>/<max> in <delay>ms
<link> link gave up after <attempts>/<max> attempts (cause=exhausted|socket-construction-threw[, detail=<ErrorName>])
<link> link reconnect abandoned at <site> (<reason>)
<link> link broken by e2e seam (shape=<shape>)      ← e2e-only, absent from the production bundle
<link> link restored by e2e seam                    ← e2e-only
not sharing: <reason> (announced once)
not sharing: <reason> (occurrence <n>, not re-announced)
sharing restored — announcement re-armed
```

`<link>` is always the link's **name** (`control` | `mux`), never its URL.

**No existing log signature, category, level or volume changed.** Measured on the diff with a pattern
proven to match (`logger\??\.(log|warn|error|debug)\(` — 56 hits in the current `main.ts`):
**0 removed call sites, 8 added**, and `this.logger.log("connection", \`control channel ${controlState}\`)`
is verbatim at `main.ts:1494`.

---

## AC5 — a retry chain that has ended says so, once

**Once-then-count, measured live** (the counter is asserted, not just the absence of a second toast):

```text
05:04:59.482 [WARN]  not sharing: not yet established: mux (announced once)      ← 1 Notice
05:04:59.483 [DEBUG] not sharing: not yet established: mux (occurrence 2, not re-announced)
05:04:59.483 [DEBUG] not sharing: reconnecting: mux (occurrence 3, not re-announced)
05:04:59.626 [INFO]  sharing restored — announcement re-armed                    ← recovery re-arms
```

Headless, over the pure reducer: one announcement then counts `2,3,4,5,6` on the next five occurrences;
`null` (recovery) re-arms and a further exhaustion announces again with the count reset to 1; and a
**different** state announces immediately rather than being swallowed by the counter. The announcement is
bound to the **state**, so nine further backoff ticks at the same state produce the same key and no second
`Notice` — the 300 ms-base toast storm the charter forbids cannot occur.

**Every exit from both retry chains, driven deliberately and shown to produce an observable outcome where
it produced none before (S38):**

| exit | site | driven by | result |
|---|---|---|---|
| exhaustion | `control-ws` `scheduleReconnect` | 12 closes under fake timers | exactly **1** `gave-up` event, `cause:"exhausted"`, `max:10`, retries numbered `1…10` |
| exhaustion | `sync.ts` `scheduleReconnect` | 18 closes | exactly **1** `gave-up`, `max:15` |
| silent early return | `control-ws` `openWebSocket` | destroyed channel asked to open | **1** `abandoned` event at `openWebSocket` |
| silent early returns ×2 | `sync.ts` `openWebSocket` | empty `roomId`; destroyed manager | **1** `abandoned` each, naming the **key** that was empty and never its value |
| **throw** from `new WebSocket(url)` | both files | socket factory that throws inside the reconnect timer | **1** `gave-up`, `cause:"socket-construction-threw"`, `detail` = the error **name** only; `JSON.stringify(event)` asserted free of `wss?:|token|jwt|password` |
| retry timer fires with `shouldConnect` false | both files | — | `abandoned` at `reconnectTimer` |

All six rows are **RED against the current tree** in the sense that the events they assert did not exist
at all before WP82 (`onLifecycle` is new; there was no callback, no state change and no log on any of
these paths).

**`autoReconnect`'s description now states its real scope** (`ui/settings.ts`): *"…This governs startup
only — reconnect attempts during a running session are always made and are not controlled by this
setting."*

### ⚠ DECLARED DEVIATION — AC5's **live** exhaustion row was NOT run, and here is why

AC5 asks for a live `close` whose restore is withheld until the ceiling is passed. **With a reachable
relay this state is unreachable**: a `close` reconnects in ~350 ms and `ws.onopen` resets
`reconnectAttempts`, so no ceiling is ever approached. Producing it live would require making the relay
unreachable *for one peer* — the only in-protocol way being an in-memory `serverUrl` override via
`canvas.setFlag`.

**I did not do that, deliberately, and the reason is a finding in itself:** on exhaustion the control
channel calls `stateChangeCallback("disconnected")`, whose `main.ts` branch runs
`new Notice("Live Share: connection lost, session ended")` and **`endSession()`** — and `endSession`
clears `roomId`, `token` and `role` from `data.json`. A 128-second control-link outage therefore **logs
the user out of the session permanently**, and re-joining needs a fresh invite link, which the rig cannot
produce. On a shared environment with the owner away, spending vault A that way to obtain one row is not
a trade worth making.

The row is carried by the headless rows above, which the charter itself sanctions
(*"Headless tests against injected fakes are the honest tool wherever a state cannot be produced on a
live instance without abusing it"*). **Carried up as a product finding for the Dispatcher to number:**
*the end of the control retry chain is not merely unannounced — it destroys the session credentials, so
"gave up" is unrecoverable without a re-invite.* Unowned; WP82 makes it **observable** and deliberately
does not change **when** it happens (redesigning the reconnect policy is out of scope).

### S39 — explicit disposition: **NOT REPAIRED**

A first-connect network outage is still reported to the user as
`Live Share: authentication required - sign in via settings`, because `connect()` resets
`everConnected = false` and exhaustion with `everConnected === false` routes to `auth-required`. WP82
touches neither line, and **no criterion here claims to cover it**. The one adjacent decision taken:
`restoreLink()` deliberately does **not** reset `everConnected`, so the E2E seam cannot manufacture S39
as a side effect.

---

## AC6 — the user is told, and the surface stops asserting health it has not measured

**One definer, its call sites enumerated structurally** (asserted in
`test_structural_seam_and_definer_visible.test.ts`, not by reading three agreeing values in one lucky
state):

- `decideSharing(` appears in `main.ts` **exactly once**, inside `getSharingVerdict`;
- consumer 1 — `updateOnlineState` → `setOnline(this.getSharingVerdict().sharing)`;
- consumer 2 — `updateStatusBar` → `sharingStatusText(verdict, healthyText)`;
- consumer 3 — `linkReport()` → `this.getSharingVerdict(facts)`;
- `main.ts` contains **no** `readyState === WebSocket.OPEN` comparison — no link-state decision is written
  there;
- the old hand-rolled conjunction is gone, with a **positive control** that the identical expression still
  exists (unchanged) in `session.info`, so the pattern can match.

`connectionState` is not a fourth notion: it is passed **into** the definer as a fact, and the status bar
no longer reads it alone.

**The discriminating live read — the status bar during a held break:**

| | pre-WP82 build (RED) | WP82 build (GREEN) |
|---|---|---|
| mux `close`, read while down | **`"Live Share: hosting 9ms"`** | **`"Live Share: Verbindung unterbrochen (mux)"`** |
| after restore | `"Live Share: hosting (2) 9ms"` | `"Live Share: hosting (2) 9ms"` (verbatim, unchanged) |

`ConnectionStateManager` is not transitioned by **any** mux event, which is exactly why the pre-WP82
build kept claiming `hosting` while the sync socket was gone. The healthy string is returned **verbatim**
by `sharingStatusText` when the verdict is healthy, so nothing changes in the healthy state.

**New user-visible strings are German** (§1 UI-language rule); the pre-existing English strings keep their
language:

```text
Live Share: Verbindung unterbrochen (<links>)[ — <n> Ops in Warteschlange]
Live Share: Verbindung aufgegeben (<links>)[ — <n> Ops in Warteschlange]
Live Share: verbinde (<links>)
Live Share: nicht synchronisiert — <n> Ops in Warteschlange
Notice: Live Share: diese Sitzung überträgt gerade nicht (<links>)
Notice: Live Share: Verbindung aufgegeben (<links>) — es werden keine Änderungen mehr übertragen
```

**Five states, not two:** `no-session` · `connecting` · `retrying` · `gave-up` · `connected`, each with a
headless row. `enabled === false` is not a failure.

**`cleanupStaleFiles`' live-host check was NOT rewired.** It consumes a **remote** peer's `isHost` from
`remoteUsers`, which is a different input from the local role and lives in WP80's file. WP82 **defines**
the predicate (`roleBacked` — *is this peer's role backed by a live link*) and leaves that call site
alone. **Named here as WP80's to adopt.** `role` itself stays a verbatim passthrough of `settings.role`.

---

## 4. Does the OfflineQueue drain? — S47 / S51, answered explicitly

**Yes, and the edge was measured firing.** `updateOnlineState` is what hands `FileOpsManager.setOnline`
its verdict, and the queue's only drain is a `setOnline(true)` with a `wasOffline` edge.

```text
GREEN, vault A, mux close + restore:
  fileOpsOnline  before = true   during the break = false   after restore = true
  offlineQueueDepth      0                                  0
  sharing        true            false                      true
  statusBar      hosting…        "Live Share: Verbindung unterbrochen (mux)"    hosting…
```

**And the RED run is the counter-example that gives it meaning:** the latched survivor sat at
`fileOpsOnline: false` **with both sockets OPEN and no edge that could ever restore it** — the state in
which S51's host delete never arrived and a host rename arrived as a copy. On the repaired build the same
reproduction ends `fileOpsOnline: true`.

**S40 is untouched:** `OfflineQueue` still has no cap. `getOfflineState()` makes the **depth** reportable
and changes nothing about what the queue holds — a cap is a data-retention decision and is out of scope.

**Consequence for the rig, worth carrying up:** the standing precondition S47 introduced —
*absence-based E2E assertions are vacuous unless both peers were `connected: true` at measurement time* —
is now **checkable in one call** (`link.report` → `sharing`, plus `fileOpsOnline` and `offlineQueueDepth`),
and it was checked for this batch's own canvas-E2E measurement below.

---

## 5. Suite numbers — measured, not remembered

| what | number | how |
|---|---|---|
| WP82 visible tests | **59 passed / 0 failed** (5 files) | `npx vitest run src/__tests__/wp82` |
| WP82 AC1 rows against the **unrepaired** tree | **2 failed / 3 passed** | same suite in the detached worktree at HEAD |
| Plugin suite, **HEAD + WP82 only** (detached worktree `H:/tmp/wp82_baseline`) | **2231 passed / 0 failed** (331 files) | `npx vitest run` |
| Plugin suite, **pure HEAD**, same worktree | **2172 passed / 0 failed** (323 files) | `npx vitest run` |
| arithmetic | 2172 + 59 = **2231** — reconciles exactly | |
| Plugin suite, **shared working tree** | 2255 passed / **13 failed** (331 files) | `npx vitest run --reporter=dot` |
| `npm run build` (tsc `-noEmit -skipLibCheck` + esbuild production) | **PASS**, 861 854 B | `npm run build` |
| `npm run build:e2e` | PASS, 4 246 248 B, sha256 `69338288287fbaccc930efa283a164809071338f514c925651161702b9248444` | |
| `npm run lint` (biome) | **no new finding.** 4 × `lint/style/useTemplate` + 1 × `organizeImports` on `main.ts` / `e2e-control.ts` are **pre-existing at HEAD** — same count, only line numbers shift. Whole-file `format` findings are the known CRLF artefact; **not** mass-reformatted. | `npx biome check <files>` at HEAD and with WP82 |

**The 13 shared-tree failures are NOT WP82's, and this is measured rather than asserted.** Positive
control: the 12 failing files were run at **HEAD + the full WP82 diff, with WP36's uncommitted work
absent** → **119 passed / 0 failed**. They are WP36's live work in `files/canvas-sync.ts`,
`canvas/canvas-text-merge.ts` and `__tests__/v2/wp36/`.

**No existing test was deleted, weakened, retitled, skipped or amended. No §7 licence of any class was
taken.** `wp46/test_legacy_fields_unchanged_visible.test.ts` is byte-unchanged (asserted structurally: it
still contains its own title and contains no reference to WP82).

### Canvas E2E — recorded as a measurement, with its confound named

**13/18**, unchanged from the pre-WP82 reading. Both peers were **`connected: true` at measurement time**
(checked immediately after: `port 39431 role=host connected=True`, `port 39432 role=guest connected=True`),
so **these five absences are not vacuous** — which is itself new information: the 13/18 was previously
attributed to the latch, and it is not the latch.

> **⚠ Confound, named rather than glossed:** the installed GREEN bundle was built from the shared working
> tree and therefore **contains WP36's uncommitted `files/canvas-sync.ts`, `canvas/canvas-text-merge.ts`
> and `testing/canvas-node-editor.ts`.** The canvas figure cannot be attributed to WP82 in either
> direction. WP82's own scenarios touch no canvas. `19/19` is still not established, and is not claimed.

---

## 6. Invariants — each stated positively

- **`session.info`'s legacy quartet is byte-unchanged.** Structurally asserted, all four expressions
  verbatim, `connected` included: `Boolean(plugin.muxConnected) && Boolean(plugin.controlConnected)`.
  WP46 is **protected, not amended**; its test file was not modified.
- **Every new `session.info`/host field is optional on `E2EControlHost`** (`linkReport?`, `breakLink?`,
  `restoreLink?`) — the ~24 fake hosts still compile; `npm run build` PASS proves it repo-wide.
- **The three new commands are purely additive** — all 21 pre-WP82 `case` labels asserted still present.
- **`canvas.simulateEdit` was neither called, extended nor repaired**, and `main.ts` contains no reference
  to it (asserted).
- **Byte-unchanged, verified by `git diff --name-only` over the commit:** `server/**`,
  `plugin/manifest.json`, `plugin/src/files/manifest.ts`, `plugin/src/files/manifest-purge-decision.ts`,
  `plugin/src/__tests__/dataloss/**`, `plugin/src/canvas/canvas-binding.ts`,
  `plugin/src/canvas/canvas-model-bridge.ts` — **0 paths matched**. `cleanupStaleFiles` does not appear in
  the `main.ts` diff (0 hits). `useCanvasBinding` is untouched and still `false`. The plugin version is
  not bumped.
- **FROZEN respected:** the five session registration sites and the intra-handler ordering of
  `registerManifestChangeHandler` / `armStaleReconcileRetry` / `armCanvasMirrorPass` are untouched.
- **No new runtime dependency** (D11). The definer imports nothing at all.
- **No secret reached anything.** No `data.json` value was read or printed at any point (the installer's
  own port write is pre-existing and untouched). No socket URL, or fragment of one, is in any log line,
  E2E response, error message, test name, fixture, this report or any commit message — asserted by a test
  whose pattern is proven to match a line that *would* leak, and which correctly does **not** match
  `reason: "settings.serverUrl is empty"`, because keys may be named and values may not.
  `sharedFolder` was not touched and remains `_liveshare-test`.
- **The relay was contacted by `GET /healthz` only.** No room created or deleted, no relay process
  touched, no `server/**` edit.
- **No link was left silenced.** Final live state on both vaults: `silenced:{control:false, mux:false}`,
  both links `up`, `sharing:true`, `offlineQueueDepth:0`.

---

## 7. Carried up (unowned unless noted)

1. **The end of the control retry chain destroys the session.** Exhaustion → `"disconnected"` →
   `endSession()` → `roomId`/`token`/`role` cleared from `data.json`. A ~128 s control outage logs the
   user out permanently; re-joining needs a fresh invite. WP82 makes the give-up **observable** and does
   not change the policy. **Needs an owner.** This is also why AC5's live row was declined.
2. **S39 stands, explicitly unrepaired** — a first-connect outage still surfaces as
   `authentication required - sign in via settings`.
3. **S40 stands** — `OfflineQueue` is still uncapped; only its depth became reportable.
4. **S36's remote half stands** — `remoteUsers` is still never pruned by staleness. WP82 bounds only the
   local half (`roleBacked`).
5. **WP80 to adopt the definer at `cleanupStaleFiles`' live-host check.** WP82 defines `roleBacked` and
   deliberately does not rewire that call site; today a live peer claiming host can still be a peer whose
   role is not backed by a live link — WP82 makes that *askable*, it does not make WP80 ask it.
6. **`grep -o "link.break"` reported two false hits in a production bundle** because `.` is a wildcard.
   Caught here by re-running with `grep -F`. Rule 15's cousin: *a pattern that matches more than it claims
   is as bad as one that matches less* — and a presence claim needs the same discipline as an absence
   claim.
7. **The canvas E2E number is confounded by WP36's uncommitted work** being inside every bundle built from
   the shared tree. Any batch that installs from `plugin/main.js` while a sibling is mid-edit is measuring
   the sibling too, `LS_EXPECT_SHA256` notwithstanding — the digest proves *which bytes shipped*, not
   *whose source they came from*.
8. **The two break shapes are not merely different instruments, they compose.** The live reproduction is
   unreachable with `close` alone and unreachable with `silence` alone; it needs `silence` on two peers to
   suppress the transfer and prevent the reclaim, plus `close` to trigger the relay's election. That is a
   stronger justification for AC3's pair than the charter had.

---

## 8. Files changed

| file | what |
|---|---|
| `plugin/src/sync/link-state.ts` | **NEW.** The pure, zero-import definer: `isLinkUp`, `decideSharing`, `sharingStatusText`, `sharingNoticeText`, `announcementKey`, `nextAnnouncement`, `describeLifecycle`, and the `LinkSnapshot` / `PeerLinkFacts` / `SharingVerdict` / `LinkLifecycleEvent` shapes. |
| `plugin/src/sync/control-handlers.ts` | The `join-response` connected marking **hoisted above both role branches**. |
| `plugin/src/sync/control-ws.ts` | Lifecycle events; observable chain exits (incl. a guarded `new WebSocket`); `getLinkSnapshot`; the `close`/`silence` break seam + `restoreLink`; watchdog-forced-close marking. |
| `plugin/src/sync/sync.ts` | The same for the mux link, which narrated nothing before. |
| `plugin/src/main.ts` | **Wiring and reads only.** The role gate removed; `muxConnected`/`controlConnected` become measured getters over believed setters; `peerLinkFacts` / `getSharingVerdict` / `linkReport` / `e2eBreakLink` / `e2eRestoreLink` / `onLinkLifecycle` / `announceSharingState`; the status bar reads the definer. |
| `plugin/src/files/file-ops.ts` | `getOfflineState()` — read-only depth + online flag. Nothing about what the queue holds changed. |
| `plugin/src/ui/settings.ts` | `autoReconnect`'s description states its real scope. |
| `plugin/src/testing/e2e-control.ts` | Three additive commands + three optional host methods. Import allow-list untouched (5 specifiers), one `.listen(`, no `new WebSocket`. |
| `plugin/src/__tests__/wp82/**` | 5 files, 59 tests. |

**Rig:** `H:\tmp\liveshare_wp82.py` — the deterministic, idempotent live reproduction and proof.
Outputs: `H:\tmp\wp82_red.json`, `wp82_red2.json`, `wp82_red3.json`, `wp82_red4.json` (RED), `wp82_green.json` (GREEN).
