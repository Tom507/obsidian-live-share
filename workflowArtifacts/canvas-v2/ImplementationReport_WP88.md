# Implementation Report — WP88: the retry ceiling ends the retry, not the session

**Batch:** B34 · **Worker:** Worker 3 (autonomous) · **Branch:** `fix-bugs-and-raceconditions`
**Charter:** `TaskCharter_WP88_TheRetryCeilingEndsTheRetryNotTheSession.md` (6 ACs)
**Commits:** `bd6b2da` (implementation + headless ACs) · final checkpoint below
**Status:** all six ACs met. AC4's live row RAN and PASSED, on the guest, on the repaired build.

---

## 0. The corrected account, and what was measured for each

The charter carried three corrections up from WP82. All three are now **measured**, not traced.

| claim | evidence class before | evidence class now |
|---|---|---|
| **Six keys, not three** — `roomId`, `token`, `encryptionPassphrase`, `encryptionSalt`, `role`, `permission` | traced by reading `session.ts:134-139` | **measured.** A RED probe against the parked baseline drove route E5 on the real `LiveSharePlugin` with synthetic sentinels and read all six back cleared: `{"roomId":"","token":"","encryptionPassphrase":"","encryptionSalt":"","role":null,"permission":"read-write"}`, with `saveSettings` called **once** (so the clear is *persisted*, not in-memory). |
| **On a host the `DELETE` destroys the room for everyone** | traced from `session.ts:116-133` | **measured.** The same RED probe, with `role: "host"`, recorded exactly one outbound call: `DELETE http://sentinel.invalid/rooms/SENTINEL-ROOM-A1`. A synthetic host, a synthetic room, an injected `requestUrl` double — no relay was contacted. |
| **E5 has no ceiling and is invisible to a text search** | asserted in the charter | **measured, and it is the route the probe used.** `grep -F "endSession"` over `plugin/src/` finds E1–E4 and U1/U2 but **not** E5, because E5 reaches the destruction through `abortSession`, one hop away. The AC1 deriver finds it by reachability. |

**One correction of my own, to the charter's census.** The charter enumerated **seven** rows. Reachability finds **five more production units** the charter did not list, and all five are dispositioned rather than waved away — see §1.

**`encryptionPassphrase` / `encryptionSalt` remain TRACED, not measured on a populated room.** Both are empty on the owner vaults, so clearing them is observationally a no-op *here*. The measurement above used sentinels, which is a statement about the code, not about a real encrypted room. Unchanged from the charter, and stated again so nobody upgrades it.

---

## 1. AC1 — the route census, DERIVED BY REACHABILITY ✅

**Deriver:** `plugin/src/__tests__/wp88/route-census.ts`. A name-based call graph over brace-matched
top-level units, seeded at `endSession`, closed transitively. **Not** a hand-written list, and **not**
a text search — a text search finds six of seven and misses E5 entirely.

**It is comment-stripped, and that is load-bearing.** The first run of this criterion went red on
**four** rows because the deriver read a *comment* that mentioned `endSession()` as a call to it —
the same defect that reddened three tests in this project when WP37's comment quoted an import
statement and the frozen allow-list regex counted it. `stripComments` was added and the rows went
green. *A detector that cannot tell code from prose is measuring the prose.*

### The derived set, with its disposition (pinned; a new member cannot join unnoticed)

| unit | class | in WP88's scope? |
|---|---|---|
| `main.ts#endSession` | plumbing | the user path, preserved |
| `main.ts#abortSession` | plumbing | keeps its three non-connectivity callers |
| `main.ts#startSession` · `#joinSession` · `#joinWithInvite` | start-join | **no** — a session that never started has no identity to retain |
| `main.ts#showRibbonMenu` | user | **no** — U1/U2 |
| `session/commands.ts#registerCommands` | user | **no** — ⚠ **not in the charter's census** |
| `ui/settings.ts#display` | user | **no** — ⚠ **not in the charter's census** |
| `sync/control-handlers.ts#registerControlHandlers` | authoritative | **no** — ⚠ **not in the charter's census** |
| `main.ts#connectSync` · `#resumeSession` · `#onload` · `#rearmSharing` · `testing/e2e-control.ts#rearmSharing` | registers | transitive only — see the honesty note below |

**The three sites the charter's census did not contain** are `control-handlers.ts:251` (join request
**denied by host**), `:328` (**kicked**) and `:333` (host's **`session-end`** broadcast). Each ends
the session on a **positive answer from the other side** — the exact opposite of the local, negative,
momentary evidence WP88 forbids acting on. They are legitimate and are **not** severed. Recorded
because a census that quietly matches the charter is not a census.

**Honest limit of the instrument, stated rather than papered over.** The graph cannot tell
*registering* a handler from *calling* it, so `connectSync` is "reaching" purely because it calls
`registerControlHandlers`. Over-approximation is the **safe** direction — it cannot hide a route —
and the precise claim is made per branch instead: the test asserts that the edges putting
`connectSync` and `resumeSession` into the set contain `registerControlHandlers` and **not**
`endSession` / `abortSession`.

### The reverse assertion (S53) and the positive controls

- **Reverse:** the deriver run against a synthetic module with no such path parses it
  (`unitCount > 0`) and returns **`[]`**. WP86's deriver returned an empty set and every downstream
  assertion passed on it; this row is why that cannot happen here.
- **Floor:** the real tree parses **> 200** units, so an empty census cannot be an empty parse.
- **Positive control:** on the real tree it finds `main.ts#endSession` and `main.ts#abortSession`.

### Rule 15 — the absence claim, with pattern, tool and positive control

| claim | pattern | tool | result | positive control |
|---|---|---|---|---|
| no inherited test *asserts* the destruction | literal `endSession` | `grep -rFn` (fixed string) — **`grep -o` was not used**, per the charter | **1 file, 1 line**: `wp82/test_ac1_connected_marking_is_role_independent_visible.test.ts:109`, and it is `async endSession() {}`, a **no-op stub** | same pattern over `main.ts` → **8** known-present production lines (`:1306 :1422 :1447 :1468 :1535 :1542 :2645 :2657`) |

The same claim is additionally **executable** — `test_ac1_…: "rule 15 — no inherited test ASSERTS the
destruction"` re-derives it with `String.includes` (a fixed substring, never a regex with a `.`
wildcard) and asserts the hit list is exactly that one file.

**No §7 licence of any class was taken.** No inherited test was deleted, weakened, retitled, skipped
or amended.

---

## 2. AC2 — the destruction measured KEY BY KEY at the seam ✅

`plugin/src/__tests__/wp88/test_ac2_ac5_end_session_seam_visible.test.ts`.

**No `data.json` was opened, read, copied for inspection or hashed for this AC.** The seam takes an
injected settings object and an injected `requestUrl` double; every value is a synthetic sentinel
invented in that file (`SENTINEL-ROOM-0001`, `SENTINEL-TOKEN-0002`, …), and a reverse row asserts the
sentinels are pairwise distinct, so a clear that wrote one value into every key could not pass.

| row | measured |
|---|---|
| six keys cleared | `roomId`/`token`/`encryptionPassphrase`/`encryptionSalt` → `""`, `role` → `null`, `permission` → `"read-write"` |
| **the persist** | `saveSettings` called **exactly once** — asserting the fields without the persist is the first vacuity risk the AC names, and an in-memory clear would recover on restart |
| host arm | exactly **1** request, `DELETE …/rooms/{sentinel}`, `Authorization` header **present** (existence asserted, never content) |
| **guest arm control** | **0** requests — without it, "the host deletes the room" cannot be told from "everybody does" |
| structural pin | the assignments in `endSession`'s body, comment-stripped, are **exactly** the six keys. The extraction regex is `settings\.(\w+)\s*=(?!=)`; without the lookahead `settings.role === "host"` counts as a seventh write, which is how this row first went red |

**RED/GREEN direction:** these rows are green on **both** trees by design — `endSession`'s body is
preserved byte-for-byte. What changed is **who calls it**, and that is AC1 and AC3.

---

## 3. AC3 — every route ends the RETRY, not the SESSION ✅

`plugin/src/__tests__/wp88/test_ac3_routes_retain_identity_visible.test.ts` — headless, fake timers,
injected sockets, synthetic sentinels, no wall-clock sleep, no `data.json`.

### The five routes, closed

| route | trigger | now calls | measured |
|---|---|---|---|
| **E1** | control chain exhausted, `everConnected === true` | `haltSharing("retry-exhausted")` | REAL `ControlChannel` driven to its REAL ceiling: `retryChainEnded: true`, `reconnectAttempts: 10`, `maxReconnectAttempts: 10` |
| **E2** | control chain exhausted, **first connect** (S39) | `haltSharing("never-established")` | driven without ever opening the socket; six keys retained |
| **E3** | `new WebSocket(url)` throws inside a reconnect timer | same branch | reached with `reconnectAttempts < 10` — this route has no ceiling of its own |
| **E4** | mux chain exhausted (15 attempts) | `haltSharing("retry-exhausted")` | driven on a **host**, the arm that would have issued the `DELETE`; zero relay calls |
| **E5** | plugin-load resume throws — **any reason, no ceiling** | `haltSharing("resume-failed")` | driven by injecting a throw into `connectSync`; six keys intact, zero relay calls, `severance.cause === "resume-failed"` |

For every route: **all six keys byte-unchanged**, `saveSettings` **not called** (`saves() === 0`), and
the injected `requestUrl` double recorded **zero** calls — i.e. no room was deleted on any role.

### `linkReport()` at the ceiling (E1, quoted)

```
state: "gave-up"        sessionActive: true      sharing: false      roleBacked: false
links.control.retryChainEnded: true   links.mux.retryChainEnded: false
severance.cause: "retry-exhausted"
severance.sessionIdentityRetained: { roomIdPresent, tokenPresent, encryptionPassphrasePresent,
                                     encryptionSaltPresent, rolePresent, permissionPresent } = all true
```

`"gave-up"` is **the definer's existing state** (`link-state.ts:145`, resolved at `:186`). A
structural row asserts there is **exactly one** `export type SharingState` union, quotes it verbatim,
and asserts `main.ts` (comment-stripped) contains no `severed:` / `severed =` rival flag. Rule 10 holds.

### Announce once, then count

`notices` containing `"Verbindung verloren"` after the ceiling: **1**. Driving the same transition
twice more leaves it at **1**, and the **paired positive assertion** — without which this passes on a
build that announces nothing — is that the announcement state advanced:
`severanceAnnouncement = { key: "halted:retry-exhausted:control", count: 3 }`.

### S39, both halves

- **Destructive half:** repaired. E2 is E1 with one boolean flipped, at one selector; both arms now
  halt. Repairing one and not the other would have left a network outage still clearing credentials
  on the first-connect path.
- **Mislabelling half:** repaired. The old `Notice` read *"authentication required - sign in via
  settings"* — a claim about the **server's answer**, made when there was no answer at all. It is
  gone; asserted by `not.toContain("authentication required")` **and** `not.toContain("sign in via
  settings")`, paired with the positive assertion that the replacement says `"Relay"` and
  `"Sitzung bleibt bestehen"`.
- **Recorded, not repaired, unowned:** *within* the never-connected case, **"the relay rejected these
  credentials" and "the relay was never reached" are not distinguishable from this client today.**
  No close code is captured anywhere in the plugin, and capturing one would change the landed `close`
  lifecycle signature. So the German string **names both possibilities and asserts neither** rather
  than picking one. That is the honest answer, and the distinction needs an owner.
- **Live row DECLINED, with its reason**, exactly as the charter directs: `restoreLink()` deliberately
  does not reset `everConnected` (`control-ws.ts:142-143`), and a live instance has by definition
  already connected once. Reaching E2 live would need either a `data.json` edit (forbidden) or an
  OS-level network change that would break the sibling batch's instances. **Headless rows carry it.**

### The re-arm — user-reachable, and it does not reset `everConnected`

- **Production seam:** `ControlChannel.rearm()` / `SyncManager.rearm()`. `restoreLink()` now delegates
  to it after lifting its own suppression, so there is **one** re-arm with two callers, not two.
  `everConnected` is untouched (S39) and `silenced` is untouched (that belongs to the rig).
- **Product entry points, both calling the same method:** the command `rearm-session`
  ("Verbindung erneut versuchen", `checkCallback`, gated on an active session and **not** on role),
  and a button in the Session block of the settings tab.
- **E5's way back:** if the resume failed there may be no control channel at all, in which case
  re-arming a channel that does not exist would be a no-op reporting success. `rearmSharing()` re-runs
  the resume instead (`via: "resume"`).
- **Measured:** at the ceiling, `rearmSharing()` returns `rearmed: true`, `control.wasChainEnded: true`,
  `control.reconnectStarted: true`, a **new** control socket is constructed, and after its open
  `retryChainEnded: false`, `up: true`, `severance.halted: false`, six keys still intact.
- **`everConnected` not reset, driven rather than asserted from the field's name:** after the re-arm,
  the *next* outage on that link announces `"Verbindung verloren"` (a real drop) and **not**
  `"Relay konnte nicht hergestellt"` (a first-connect claim).

### The three `shouldConnect = false` sites

`control-ws.ts:225` (construction throw), `:309` (exhausted), `:379` (`destroy`). `rearm()` clears the
chain on the condition `retryChainEnded || !shouldConnect`, so it reaches the first two; `destroy()`
sets `isDestroyed` and is correctly **not** re-armable. E3's row proves the construction-throw state
is reachable and re-armable.

---

## 4. AC4 — RECOVERY WITHOUT A FRESH INVITE, LIVE ✅

**Ran. Passed. On the guest. On the repaired build.** Script: `H:\tmp\liveshare_wp88_e2e.py`.
Artefacts: `H:\tmp\wp88_live_result.json`, `H:\tmp\wp88_live_log.txt`.

### ⚠ Two deviations from the charter's letter, both measured, both reported

**1. `link.break{shape:"silence"}` CANNOT reach the control ceiling. This is a defect in the
instrument, not in the peer.** Under `silence` the pong deadline force-closes the socket, `onclose`
fires, `scheduleReconnect` runs — and the next `openWebSocket`'s `onopen` handler is **ungated by
`silenced`** (`control-ws.ts`), so the reconnect *succeeds*, `reconnectAttempts` resets to `0` and
`retryChainEnded` resets to `false`. The chain oscillates on a ~25 s period and **never exhausts**.
AC4 as written is therefore unsatisfiable with that shape, and no amount of waiting would have
produced `reconnectAttempts: 10`. *A test that waited for it would have hung, not failed — which is
the worse of the two.*

The outage was produced instead with the **landed, chartered** instrument that can produce it:
`canvas.setFlag {name:"serverUrl", value:"http://127.0.0.1:1"}` — WP72's in-memory, session-scoped,
never-persisted, protocol-reversible settings override — followed by `link.break{control,"close"}` to
start the chain. **`data.json` was not opened by the rig for this**, and `canvas.clearFlags` put the
value back. `canvas.simulateEdit` and `canvas.open` were not called by this row.

**2. The off-client control is unchanged in substance.** `/healthz`'s `clients` counts **mux sockets
only** (S35), and only the **control** link was broken, so an unmoved count is exactly the right
control for a control-link outage — it says the break did not take the mux down with it.

### The five mandatory safety conditions, in order

| # | condition | result |
|---|---|---|
| 1 | **guest peer only** | Roles **resumed as** after the install: vault **A = host**, vault **B = guest** (quoted from each instance's own `session.info` after relaunch). The row ran on **vault B, the guest**. Not a SKIP. |
| 2 | **byte-exact `data.json` backup by file copy** | Two backups, both verified by `filecmp` **and** sha256 equality: `pre` (975 B / 975 B) and `armed`, taken **after** the install, i.e. of the exact state the row ran against (946 B / 948 B). **Sizes only. No value read, printed or inspected, and no digest recorded in this report.** |
| 3 | **restore rehearsed and verified BEFORE arming** | **EXECUTED.** The `pre` backup was copied back over both live `data.json` files and verified byte-exact on both (`byteExact=True` / `byteExact=True`) **before** the repaired bundle was installed and before anything was broken. The instances were then relaunched by the installer and came back **as themselves** — `roomIdPresent: true`, a role on both. *A backup that has never been restored is a claim; this one is not.* |
| 4 | **repaired build only** | Bundle built from this batch's tree (`npm run build:e2e`, 4 338 895 B), pinned into the installer by `LS_EXPECT_SHA256`, and the installer re-verified the landed bytes against it in both vaults. **No live vault was ever driven to a ceiling on a build that would destroy its session.** |
| 5 | **grep the INSTALLED bytes for a batch-unique marker (S46)** | `WP88-B34-RETRY-CEILING-SEVERANCE` occurrences in the installed `main.js`: **vault A = 1, vault B = 1**. `session.rearm`: **3 / 3**. **Positive control** for the search: `live-share` occurs **51** times in the same file, so a zero would have been an absence and not a broken grep. |

### The measurement

- **S47 precondition:** `connected: true` asserted on **both** peers before anything was measured.
- **The ceiling, by the peer's own report — never by elapsed time:**

  ```
  control: { readyStateName: "ABSENT", up: false,
             reconnectAttempts: 10, maxReconnectAttempts: 10,
             retryChainEnded: true, silenced: false }
  ```

  Elapsed **129.2 s**, *recorded and not the oracle*; it agrees with the charter's arithmetic
  (300·2ⁿ capped at 30 000 over 10 attempts = 128 100 ms) but the verdict came from the counter.
- **Off-client control:** `/healthz` before `{sessions:1, documents:9, clients:2}` → after
  `{sessions:1, documents:9, clients:2}`. **Unmoved.**
- **At the ceiling, on the guest** (`session.severance`):
  `halted: true · cause: "retry-exhausted" · links: ["control"] · offlineQueueAccepting: false ·
  offlineQueueRefused: 0`, and **all six** `…Present` flags `true`.
  `session.info`: **role unchanged**, `roomId` present.
- **The other peer, untouched:** vault A — `role: host`, `connected: true`, room present. **The room
  survived, for everyone.** On the unrepaired build this is where it would have been gone.
- **Recovery with NO INVITE:** `canvas.clearFlags` restored `serverUrl` (`restored: ["serverUrl"]`);
  `session.rearm` → `rearmed: true, via: "rearm"`; then `control.up: true`,
  `retryChainEnded: false`, `sharing: true`, `state: "connected"`. Same room and same role as before
  the outage — **compared in-process; no value was carried out.** No invite was pasted anywhere.
- **`finally`:** `link.restore` on **both** links on **both** vaults (`wasSilenced: false` at all four
  — nothing was left silenced), and `canvas.clearFlags` on both.
- **Integrity after the row:** both `data.json` files **byte-unchanged since arming** (`True` / `True`).
  The backups remain on disk as `data.json.wp88-b34.pre` / `.armed` in each vault's plugin folder.

**`offlineQueueRefused: 0` is honest, not a pass.** No file operations were produced during the live
outage, so there was nothing to refuse. AC6's paired burst is carried headless, where the positive
control exists.

---

## 5. AC5 — the anti-lobotomy control ✅

Same file as AC2, same assertions, **opposite expected outcome, same run**:

- the **user** route still clears all six keys **and persists them** (`saveSettings` × 1);
- the **host** arm still issues `DELETE /rooms/{roomId}` with an `Authorization` header;
- the **guest** arm still issues nothing, and still clears and persists.

`main.ts:1422-1450` `endSession()` and `session.ts:113-141` are **unchanged**. `main.ts:2645`/`:2657`,
`session/commands.ts` `end-session`/`leave-session` and the two settings buttons are unchanged.
**The severing happens at the caller, never inside `endSession`** — making the destructive function's
behaviour depend on a caller-supplied intent is the very ambiguity that hid this defect, one call
answering both *"I chose to leave"* and *"my Wi-Fi died"*.

---

## 6. AC6 — the offline queue stops growing, and says so ✅

`plugin/src/__tests__/wp88/test_ac6_offline_queue_seal_visible.test.ts`.

**No cap constant. No eviction. Nothing already queued discarded.** `sync/offline-queue.ts` is
**byte-unchanged**. The decision lives in the definer (`acceptsIntoOfflineQueue` over
`SharingVerdict.endedLinks`); `FileOpsManager` is *told* the answer and holds a boolean gate plus a
counter.

| row | measured |
|---|---|
| **positive control** — chain alive | a burst of 5 distinct deletes ⇒ `queueDepth 0 → 5`, `refusedWhileSealed 0`, `acceptingIntoQueue true` |
| chain ended | an **identical** burst ⇒ depth stays at 5, `refusedWhileSealed 0 → 5` |
| **nothing discarded** | 3 queued, then sealed, then 4 refused ⇒ depth 3, refused 4; coming back online drains **exactly** `kept-0/1/2.md`, in order, unchanged — asserted on the drained **content**, not just the count |
| carrier is the right link | a **mux** chain ending does **not** seal the file-op queue; the control link does. `FILE_OP_CARRIER_LINK` is named once |
| re-open resets the counter | so a later seal reports **its own** refusals, not a running total |
| **no cap, derived from source** | `offline-queue.ts` (comment-stripped) matches no `MAX_QUEUE`/`QUEUE_CAP`/`shift()`/`evict`; **positive control**: the same detector finds `enqueue` and `drain`, so the null result is an absence and not a broken pattern |

Announced **once** under WP82's landed `nextAnnouncement` reducer, on its own key
(`queue-sealed:control`) — *"this peer is not sharing"* and *"this peer has stopped accepting work"*
are different facts and a user told the first is still entitled to the second. New log signature:
`OFFLINE QUEUE SEALED: carrier=… retained=… discarded=0`.

**S40's residue, still unowned:** what should happen to ops queued for hours when a peer re-arms, and
whether an eviction policy is ever wanted. Unchanged by this WP.

---

## 7. RED → GREEN

**Parked baseline:** a **detached worktree** at `2a25592` (rule 14 — no `git checkout --`, `git
restore` or `git stash` on any shared path), `H:\tmp\wp88_red_baseline`, with this WP's four test
files copied in.

| | RED (`2a25592`) | GREEN (this tree) |
|---|---|---|
| WP88 suite | **16 failed / 13 passed** | **29 passed / 0 failed** |

The 13 that pass under RED are the non-discriminating rows — AC2/AC5 (the seam body is unchanged by
design), the reverse assertion, the parse floor, the definer's uniqueness, and rule 15's grep. **The
suite knows which of its own rows prove nothing.**

**The RED probe** (`probe_red_e5.test.ts`, run only in the parked worktree, not committed) drove E5 on
the unrepaired tree with a **host** role and recorded, in one run: six keys cleared, `saveSettings`
called once, `DELETE http://sentinel.invalid/rooms/SENTINEL-ROOM-A1` issued, notice
`"Live Share: failed to resume previous session"`. That is the defect, measured.

---

## 8. Gate status, with every failure attributed

| gate | result |
|---|---|
| `npx vitest run` (full plugin suite, from `plugin/`) | **2387 passed / 0 failed, 341 files** — final reading. An earlier reading in the same batch was **2376 / 339**; the tree grew by 2 files and 11 tests **between the two runs**, because a sibling batch is live in it. Both numbers are recorded rather than one, because a count is a measurement of a tree at an instant (rule 5) and this tree moved twice during the batch. |
| WP88 suite alone | **29 / 29** |
| `npm run build` (`tsc -noEmit -skipLibCheck && esbuild`) | **RED — one error, and it is NOT this batch's** (below) |
| `npm run build:e2e` | **PASS** — 4 338 895 B, marker present |
| Canvas E2E, two live instances | **21 / 21 checks passed** — see the labelling note below |

### The build is red, and the attribution is proven rather than asserted

```
src/__tests__/v2/reprsweep/test_tp01_seed_boundaries_do_not_un_migrate.test.ts(38,15):
error TS2305: Module '"../../../canvas/canvas-canonical"' has no exported member 'FlatCanvasData'.
```

`plugin/src/__tests__/v2/reprsweep/` is **untracked** and belongs to a **live sibling batch** which
also holds uncommitted edits to `plugin/src/files/canvas-sync.ts` and
`plugin/src/canvas/canvas-binding.ts`. It is the hazard the charter names by hand — *a mirrored suite
whose subject is not implemented breaks `tsc` repo-wide* — committed by a neighbour.

**Attribution, measured:** a second detached worktree at `HEAD 0e3b1c8` with **only WP88's eight
production files and its four test files** applied gives `tsc` **clean over `plugin/src`** (the only
remaining errors are `../server/**` missing its `node_modules`, which is an artefact of the worktree
having none and is present at baseline too). **Rule 14 was followed: nothing of the sibling's was
touched, reverted or staged.**

### The canvas E2E number, labelled

**21/21.** This is the **first honest baseline since S45 was fixed** — `H:\tmp\liveshare_e2e.py`'s
preflight now opens a real leaf, and the canvas baseline had not been re-measured since. The figure is
**21 checks, not 19**; *19/19 was measuring the rig* (WP85) and nothing here restates it. The suite's
own idempotency sweep removed 58 leftover nodes/edges and 2 stray canvas files before running, and
namespaced this run's artefacts. Scenario `[07]` **passed**, and per the standing carried-up note it
is **flaky and must not be gated on**.

**The 13 red `[lww]` / `[intent-trace]` assertions the brief warned about are B32's and did not
appear:** B32 landed and handed over during this batch (`3744063`, `0e3b1c8`), and the suite is green.
Re-measured, as instructed, rather than trusted.

---

## 9. Discipline statements

- **`session.info`'s legacy quartet is byte-unchanged**, and `wp46/test_legacy_fields_unchanged_visible.test.ts` was **not modified**.
- **⚠ A reversal worth recording.** Three optional presence fields (`roomIdPresent`, `tokenPresent`,
  `rolePresent`) were first added to `session.info` on the `vaultId` precedent. They **reddened three
  landed assertions** — `wp46/test_session_info_identity_fields_visible`,
  `t3/wp44/test_tp11_resolveport_precedence_visible` and `e2e-control.test.ts` — because that
  response's field set is pinned **exhaustively**, not just for the quartet. **Optional on the
  interface is not additive in the response.** WP88 holds no §7 licence, so the fields were
  **removed** and the criterion is served by the new `session.severance` command, which pins nothing.
  The reason is written into `e2e-control.ts` so the next reader does not re-discover it.
- **A second reversal, same class.** `updateOnlineState` was rewritten to hoist the verdict into a
  local; that reddened `wp82/test_structural_seam_and_definer_visible`, which pins the expression
  `setOnline(this.getSharingVerdict().sharing)` **literally**. The landed line was restored verbatim
  and the verdict is simply read a second time.
- **No existing log signature, category, level or volume changed.** Two new signatures, declared here:
  `SHARING HALTED: cause=… links=… sessionIdentityRetained=true roomDeleted=false` (error) and
  `OFFLINE QUEUE SEALED: carrier=… retained=… discarded=0` (warn).
- **No room was created, deleted or mutated.** The relay was contacted by `GET /healthz` only, twice.
- **No `data.json` value, and no socket URL or fragment of one, reached any artefact** — not this
  report, not a log line, not a test name, not a fixture, not a commit message. Credential keys are
  **named**; presence is a boolean. The live script compares digests and byte-equality in-process and
  emits only `True`/`False`.
- **No test was deleted, weakened, retitled, skipped or amended.** **No §7 licence of any class was taken.**
- **`server/**` untouched.** `useCanvasBinding` not flipped. `cleanupStaleFiles`, `files/manifest.ts`,
  `__tests__/dataloss/**`, `__tests__/harness/**` and every canvas file byte-unchanged by this batch.
  Plugin version not bumped. `plugin/manifest.json` not touched. `BUILD_SPEC_CanvasV2.md` not edited.
  No new runtime dependency.
- **Not batched with WP87 or any other `main.ts` WP** — none was running. `git status` was re-read
  **immediately** before the commit and only this batch's paths were staged, with `git commit -o`.

---

## 10. Files changed

| file | change |
|---|---|
| `plugin/src/sync/link-state.ts` | additive **consumers** of the terminal state: `SeveranceCause`, `severanceNoticeText`, `severanceLogLine`, `severanceAnnouncementKey`, `FILE_OP_CARRIER_LINK`, `acceptsIntoOfflineQueue`, `offlineQueueSealKey`, `offlineQueueSealNoticeText`, `WP88_BUILD_MARKER`. **`SharingState` untouched.** |
| `plugin/src/sync/control-ws.ts` | `rearm()` extracted as the production seam; `restoreLink()` delegates to it |
| `plugin/src/sync/sync.ts` | the same, for the mux |
| `plugin/src/files/file-ops.ts` | AC6's stop-accepting boundary + refusal counter; `getOfflineState` extended |
| `plugin/src/main.ts` | `haltSharing`, `rearmSharing`, `severanceReport`, `announceQueueSeal`; **`handleControlState` / `handleMuxExhausted` extracted from `connectSync`'s closures**; the five call sites; `linkReport` extended |
| `plugin/src/session/commands.ts` | the `rearm-session` command |
| `plugin/src/ui/settings.ts` | the re-arm button in the Session block |
| `plugin/src/testing/e2e-control.ts` | `session.rearm` and `session.severance`, additive and optional |
| `plugin/src/session/session.ts` | **NOT TOUCHED** — deliberately |
| `plugin/src/sync/offline-queue.ts` | **NOT TOUCHED** — deliberately |
| `plugin/src/__tests__/wp88/**` | the census deriver + four suites, 29 tests |

**Why `handleControlState` / `handleMuxExhausted` became named methods.** As closures inside
`connectSync` they could be driven only by booting the entire plugin, so **the branch that destroyed
the session on a dropped socket had no reachable seam and was never exercised by anything** — which is
a large part of why a defect this severe survived 2 000 headless tests. They are now individually
invocable, individually pinned by the census, and the `connected` / `reconnecting` arms are byte-unchanged.

---

## 11. Carried up — none owned

1. **⚠ `link.break{shape:"silence"}` cannot drive a control link to its ceiling.** A reconnect's
   `onopen` is ungated by `silenced`, so every retry succeeds and resets the chain. This is a **gap in
   the landed WP82 instrument**, it makes AC4-as-written unsatisfiable, and any future criterion that
   asks for a ceiling via `silence` will **hang rather than fail**. Not repaired here (the seam is
   WP82's and this WP consumes it). **Needs an owner.**
2. **A first-connect failure cannot be classified from the client.** "The relay rejected these
   credentials" and "the relay was never reached" are indistinguishable — no close code is captured
   anywhere in the plugin. WP88 stops *claiming* one; it cannot *tell* them apart. Fixing it means
   capturing `CloseEvent.code`, which would change the landed `close` lifecycle signature. **Unowned.**
3. **`abortSession`'s three non-connectivity callers** (`main.ts` `startSession`, `joinSession`,
   `joinWithInvite`) still destroy the six keys on a start/join failure. Probably right — a session
   that never started has no identity to retain — but **nobody has decided it**. Unchanged, unowned.
4. **The `DELETE /rooms/{roomId}` failure is still swallowed** (`session.ts:130-132`, a `catch` whose
   body is a comment). After a user ends a session, a host that reached the relay and one that did not
   are indistinguishable. Same class as WP81's swallowed `.catch(() => {})`. Deliberately not repaired
   — the user path's body is preserved byte-for-byte. **Unowned.**
5. **Three `endSession` routes the charter's census did not contain** — `control-handlers.ts:251`,
   `:328`, `:333`. Classified `authoritative` and left alone, but the classification is a **judgement
   made here**, not one anybody chartered.
6. **A live sibling batch is breaking `tsc` repo-wide** with an untracked
   `plugin/src/__tests__/v2/reprsweep/` importing `FlatCanvasData`, which `canvas/canvas-canonical`
   does not export. `npm run build` is red for everyone until they land or remove it. **Messaged
   upward; not this batch's to fix, and not this batch's to delete.**
7. **The canvas E2E baseline is 21 checks, not 19.** First measurement since S45's fix. Whoever quotes
   a canvas E2E number next should quote **21/21** and say when it was taken.
8. **Two `data.json` backups were left on disk** in each vault's plugin folder
   (`data.json.wp88-b34.pre`, `.armed`). Deliberate — a way back that outlives this batch. They are
   the rig's own namespace, not the owner's `.bak` and not `.pre-v2-smoke`.
9. **The installed bundle in both vaults is now this batch's e2e build.** Whoever measures next should
   install their own and pin it with `LS_EXPECT_SHA256` **and** grep for their own marker (S46).
