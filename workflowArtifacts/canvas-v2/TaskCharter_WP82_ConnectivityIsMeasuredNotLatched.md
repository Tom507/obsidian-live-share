# Task Charter — WP82: connectivity is measured, not latched — and a peer that is not sharing says so

<!-- Updated: chartered 2026-08-05 (B24) from the Dispatcher's live measurement of the two vault instances, re-verified independently and in full per hard-won rule 12. ⚠ THE DEFECT IS REAL, IS WORSE THAN REPORTED, AND ITS REPORTED MECHANISM IS WRONG IN EVERY PARTICULAR. There was no dropped connection. Both of vault A's sockets are OPEN right now and both are carrying traffic — proven by A's own log emitting `awareness pulse … (source=message)` seconds before this charter was written, a line that is unreachable unless `ws.readyState === OPEN` (`sync/sync.ts:655`, `:668`). The reported log silence does not hold either: vault A's log carries **128** `[connection]` lines, **34 of them today**, the most recent at `2026-08-05T02:10:18.881Z` — not 38 lines ending 2026-08-01. What is actually true is sharper and is a one-line client defect: `controlConnected` is a LATCH set on two mutually exclusive role-gated paths, and a peer promoted from guest to host by the server's `join-response` falls between both of them and is never marked connected again for the life of the session. Vault A is in that state; vault B is in its mirror image, where the same latch reports `connected: true` on a role B no longer holds. **`connected` is wrong on BOTH peers, in opposite directions, from one defect — and the peer the Dispatcher used as the healthy control is not one.** See §3, Verifications 1–5. No Obsidian was launched, no vault file was written, no E2E script was run, no `data.json` was opened, no relay state was mutated; the instances were read through `session.info` and `GET /healthz` only, and the vaults by directory listing and by reading the plugin's own log output. -->
**Charter Status:** `SPEC_COMPLETE`
**WP:** WP82
**Phase:** P0
**task_mode:** `standard`
**Depends on:** none. **MUST NOT be batched with WP80** — see §2 Ordering.
**W4 Test Targets:** `0`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** a peer's answer to *"am I sharing right now?"* becomes a **measurement of its two sockets** instead of a latch set once, on one of two role-dependent code paths, and never revisited. Today the plugin holds **three** independent and mutually contradictory notions of connectivity in one process, and on vault A right now all three disagree with each other and two of them disagree with the sockets. After this WP there is **one definer**, every consumer reads it, each link reports its own state separately, and a peer that has stopped transmitting says so — to the rig, to the log, and to the user.
- **Why this outranks most of the backlog:** every other defect this week was loud once you looked — files vanished, characters vanished, a canvas failed to appear. This one presents as *everything is fine*. For a collaboration product that is the worst failure mode there is: **the user believes they are sharing while nothing is arriving.** It is the run's central lesson at the level of the product's core promise — *an absence of information rendered as a positive claim* — and here the absence is literal: a boolean that nobody ever set is read as the statement "not connected", and a boolean set under a role the peer has since lost is read as the statement "connected".
- **It has already invalidated a measurement.** The canvas E2E suite reads 13/18 rather than 19/19 purely because of this state, and two batches nearly filed those five failures as regressions in their own work. **19/19 is not the current baseline until this lands.**
- **The ruling this WP inherits and extends.** WP81 ruled that *a swallowed failure may drop data but may not drop the fact that it dropped data*. WP82's form of it: **a peer that is not transmitting may fail to transmit; it may not report that it is transmitting.** Vault A violates that literally — its status bar says `Live Share: hosting` while every file operation it performs is being appended to an unbounded in-memory queue that nothing will ever drain (`files/file-ops.ts:100-107`, `sync/offline-queue.ts`).
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 9, work package **WP82**; section 7 (Quality Gates), whose live two-instance gate this state currently voids. Phase **P0**, on WP81's precedent: it is diagnostic-integrity work, and every phase's evidence already depends on it.

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: modify, **one repository** (`obsidian-live-share`, branch `fix-bugs-and-raceconditions`), **`plugin/src/` only**.
  - Responsibility: make per-link connectivity an **observed fact with one definer**; repair the role-transition latch that is the live root cause; make the mux link narrate its own lifecycle as the control link already does; make every exit from a retry chain observable; and make the user-visible surface stop asserting health it has not measured.
  - Scope summary: the `join-response` promotion path stops skipping the connected latch (`sync/control-handlers.ts:193-195`) · the latch stops being role-gated at socket-open (`main.ts:985-988`) · one **pure, zero-import predicate module** becomes the single definer of "is this peer sharing" and of "is `role` currently backed by a live link" · `session.info` gains **additive** per-link measured fields, with the WP46 quartet byte-unchanged · the mux socket lifecycle gains the narration the control socket has had all along · a retry chain that has ended says so once · the status surface reads the definer · two additive E2E commands: one to read link state, one to **break a link on demand** in two named shapes with mandatory positive controls.
- **Out of scope / non-goals — each of these is an ESCALATE, not a judgement call:**
  - **⚠ `server/**`.** Untouched. A `server/` edit outside WP41 is a §7 abort criterion. The relay's host-election churn (**S27**, quantified below as **S37**) is the *upstream* cause of the role transitions this WP survives; it is **not repaired here**, and no criterion may depend on which vault the relay elects.
  - **⚠ Changing `session.info`'s legacy quartet — `clientId`, `role`, `roomId`, `connected`.** `connected` **stays** `Boolean(muxConnected) && Boolean(controlConnected)` (`testing/e2e-control.ts:1175`), byte-unchanged, because WP46 pins it (`__tests__/wp46/test_legacy_fields_unchanged_visible.test.ts:55-82`) and every rig scenario reads it. The repair is that the two operands become **true**, plus new fields beside them. WP46's own comment (`e2e-control.ts:346-349`) establishes additive extension as the sanctioned mechanism. **Making `connected` mean something new instead of making it correct would re-open a `DONE` WP and break the rig in the same edit.**
  - **⚠ Redesigning the reconnect policy.** `MAX_RECONNECT_ATTEMPTS` 10 / 15, `RECONNECT_BASE_MS`, `RECONNECT_MAX_MS`, the backoff curve and the ping/pong deadlines keep their current values. This WP makes **giving up observable**; choosing *when* to give up is a product decision with no measurement behind it today and is not made here.
  - **⚠ Repairing the divergence.** The two `smoke.canvas` replicas are diverged (measured, §3 Verification 4) and **this WP does not converge them and does not claim to**. Its subject is that a peer cannot tell you it has stopped sharing. **Claim 4 does not follow from the latch and must not be bundled with it** — see the ruling in §3.
  - **⚠ The offline queue's unbounded growth.** `OfflineQueue` (`sync/offline-queue.ts`) has no cap; a peer stuck offline accumulates ops until the session ends. Recorded as **S40**, **not** repaired here — a cap is a data-retention decision, and putting one inside an observability WP is the annexation five earlier WPs were held to. One AC requires the queue's **depth** to be reportable; nothing changes what it holds.
  - **⚠ `useCanvasBinding`, `canvas-binding.ts`, `canvas-model-bridge.ts`.** Frozen until P5; flipping the flag or editing those files is a §7 abort criterion.
  - **⚠ `cleanupStaleFiles`, `files/manifest.ts`, `plugin/src/__tests__/dataloss/**`.** WP80's subject, and WP80 is being implemented **right now**. Byte-unchanged here.
  - **`canvas.simulateEdit`.** Not used, not extended, not repaired. **Its shape — a side effect plus a hardcoded literal return (`e2e-control.ts:995-1005`, `:1023`) — is explicitly forbidden for every command this WP adds.**
  - **`plugin/manifest.json`** — a broken symlink to another machine (S23). Not read, not edited, not repaired.
  - **Any new runtime dependency.** D11 — an ESCALATE.
- **Known interfaces / dependencies:**
  - Input: the two live `WebSocket` objects (`sync/control-ws.ts:23`, `sync/sync.ts` `this.ws`), `join-response.isHost`, the settings' `role` and `autoReconnect`
  - Output: one link-state definer; additive `session.info` fields; mux lifecycle log lines; a once-only give-up announcement; a status surface that reads the definer; two additive E2E commands
  - **Blocks nothing, and every live-instance verdict in the project depends on it.**

### Ordering — what must NOT be batched together

1. **WP80 is live in `plugin/src/main.ts`, `plugin/src/files/manifest.ts` and `plugin/src/sync/control-handlers.ts` at the time of writing.** WP82 edits **two of those three files**. **WP80 and WP82 may not run in the same batch**, and WP82 must re-read `git status` immediately before every commit (rule 14) — a sibling reverting a shared path between edit and stage has already happened once in this run (S34), on this exact file set.
2. **`plugin/src/testing/e2e-control.ts` is contended by WP37, WP38, WP80 and WP81.** WP82's two commands are additive and reach the frozen import allow-list by **dynamic `import()`** if they need a new module, on WP37's landed precedent — never by amending the allow-list, and never in a comment, because the allow-list regex reads comments and has already reddened three tests that way.
3. **WP82 does not depend on WP80 and WP80 does not depend on WP82.** They are independent repairs that collide only in the file system. Either order is correct.

### §7 disposition — no `DONE` work package is re-opened, and no §7 licence of any class is taken

1. **No `DONE` work package is re-opened.** The latch, the mux narration gap and the status surface are inherited infrastructure named in no WP's acceptance criteria.
2. **WP46 is the one `DONE` WP whose surface is adjacent, and it is protected rather than amended.** `test_legacy_fields_unchanged_visible.test.ts:55` asserts `connected` is the conjunction of `muxConnected` and `controlConnected`. That assertion **stays green and unmodified**; the repair makes the operands correct and adds fields beside them. If it reddens, that is an **ESCALATE with the measured before/after, left red** — not a rewrite.
3. **WP82 holds no §7 licence of any class.** No inherited test is deleted, weakened, retitled, skipped or amended. Roughly two dozen test files construct fake hosts carrying `controlConnected` (`__tests__/wp46/**`, `__tests__/wp47/**`, `__tests__/wp49/**`, `__tests__/t3/wp44/**`, `__tests__/e2e/two-host-harness.ts:157`, `:166`); every new `session.info` field must therefore be **optional on the `E2EControlHost` interface**, on the landed `vaultId` precedent (`e2e-control.ts:346-349`), or those fakes stop compiling and `npm run build` breaks repo-wide.
4. **`main.ts` gains wiring and the status-surface read only.** §3.1 S11 and the §7 abort criterion are absolute: no decision about link state is written in `main.ts`. The definer is a separate module.
5. **If a type is added to `types.ts` it goes at the TOP**, beside `StaleReconcileDecision` — the WP22 dormancy-test comment-strip trap (`DEFAULT_SETTINGS`'s comment contains `` `${configDir}/**` ``, so any JSDoc added below it closes the pairing and swallows `useCanvasBinding: false`). Inherited verbatim from WP80 and WP81 and it has already cost this run once.

---

## 3. Architecture Context

*Task-local architecture guidance only.*

### Verified against the current tree AND the two live instances (rule 12), 2026-08-05 02:25Z — measured, given, do not re-derive

**Verification 1 — the live state, re-measured independently. The Dispatcher's `session.info` figures hold exactly.**

| | vault A | vault B |
|---|---|---|
| `role` | `host` | `guest` |
| `connected` | **`false`** | `true` |
| `vaultId` | `703aa794cc73a117` | `55a4253eb7a90dde` |
| `roomId` | **non-empty, identical on both** | **non-empty, identical on both** |
| `pluginBuild` | `0.6.1+e2e` | `0.6.1+e2e` |

**`roomId` is the load-bearing one and it is new.** `SessionManager.endSession()` clears `roomId`, `token` and `role` (`session/session.ts:134-138`). A's `roomId` and `role` are both intact, so **`endSession()` did not run** — which rules out, by construction, every path that would have ended it:

- the ControlChannel `disconnected` branch (`main.ts:1003-1011`) ⇒ **the control channel never reached `disconnected`**
- the ControlChannel `auth-required` branch (`main.ts:998-1002`) ⇒ **never reached `auth-required`**
- `SyncManager.onMaxReconnect` (`main.ts:947-951`) ⇒ **the mux never exhausted its 15 attempts**

**Verification 2 — ⚠ THERE WAS NO DISCONNECT. Both of A's sockets are OPEN and carrying traffic.**

Vault A's own log, read at `02:25:11Z`, last line `02:25:06.323Z`:

```text
2026-08-05T02:24:58.312Z [DEBUG] [sync] awareness pulse: gap 9461ms (source=message)
2026-08-05T02:25:06.323Z [DEBUG] [sync] awareness pulse: gap 8011ms (source=message)
```

That line is emitted by `emitAwarenessPulse` (`sync/sync.ts:668-690`), reachable **only** through `tickAwarenessKeepAlive` (`:655-663`), whose first statement is `if (this.ws?.readyState !== WebSocket.OPEN) return false`. And `source=message` means the tick was driven by an **inbound framed message** (`handleMessage`, `:439-444`). **A's mux socket is open and receiving frames.** The same file is being appended to continuously, which also retires the "log silence" premise: **128** `[connection]` lines, **34 dated today**, most recent `02:10:18.881Z`.

Independently, `GET https://liveshare.neuralangels.de/healthz` → `{"sessions":1,"documents":14,"clients":2}`. **`clients` is not a contradiction of anything** — it counts unique **mux** sockets (`server/src/index.ts:74-82` → `ws-handler.ts:421-435`), the control WSS is not counted at all, and both mux sockets are genuinely alive. Reading it as "peers connected" is reading one of two links; recorded as **S35**.

**Verification 3 — ⭐ THE ROOT CAUSE. A single early `return`, and the log pins it to the millisecond.**

`plugin.controlConnected` is written `true` at exactly **two** sites in the whole tree, and they are **mutually exclusive by role**:

| site | condition | when |
|---|---|---|
| `main.ts:985-988` | `if (this.settings.role === "host")` | inside the ControlChannel `connected` callback, at **socket-open time** |
| `sync/control-handlers.ts:218-220` | reached only after `if (plugin.settings.role !== "guest") return;` (`:201`) | on **`join-response`**, later |

`join-response` is also where the server's authoritative host verdict is applied (the D1 repair):

```text
sync/control-handlers.ts:193   if (msg.isHost === true && plugin.settings.role === "guest") {
sync/control-handlers.ts:194     void plugin.promoteToHost();
sync/control-handlers.ts:195     return;                        ← returns BEFORE :218
sync/control-handlers.ts:196   }
```

So a peer that **resumes as guest and is promoted to host by the relay**:

1. opens its control socket while `role === "guest"` ⇒ the host-only gate at `:985` is **false** ⇒ latch not set — correct so far, a guest is supposed to wait for `join-response`
2. receives `join-response{isHost: true}` ⇒ `:193` matches ⇒ `promoteToHost()` ⇒ **`return` at `:194`** ⇒ `:218` `plugin.controlConnected = true` is **never reached**
3. `promoteToHost` (`main.ts:2187-2204`) sets the role, publishes, broadcasts presence, updates the status bar — and **does not touch `controlConnected`** and **does not call `updateOnlineState()`**

`controlConnected` is now `false` **permanently**, because nothing outside a fresh `connectSync()` can ever set it again. **Vault A's own log is the trace, at millisecond resolution:**

```text
2026-08-05T02:10:18.784Z [INFO] [session]    resuming as guest
2026-08-05T02:10:18.881Z [INFO] [connection] control channel connected      ← :985 gate false
2026-08-05T02:10:18.890Z [INFO] [session]    promoted to host - server designated this peer as the room host
```

106 ms, three lines, and A has been `role: host, connected: false` ever since. **Nothing failed. Nothing was logged, because nothing had anything to report.**

**And the mirror image, which nobody has named and which matters more:** vault B's last transition is `02:10:34.258Z resuming as host` → `02:10:34.350Z demoted from host - another host exists` (`main.ts:2222` via `control-handlers.ts:197-199`). B opened its socket **as host**, so `:985` **did** latch `controlConnected = true` — and B was then demoted to guest, a role for which that latch was never valid, and `demoteToGuest` does not clear it either. **B's `connected: true` is not a measurement; it is a latch set on a role B no longer holds.** The two peers are wrong in opposite directions from one defect, and **the peer the Dispatcher used as the healthy control is not one.**

The promotion path is not exotic: **34 role transitions in vault A in 2 h 05 min today** — 8 promotions, 5 demotions, 21 plain resumes — driven by the relay's auto-election on host socket close (`server/src/control-handler.ts:548-591`, S27). Quantified as **S37**.

**Verification 4 — what the latch actually breaks, and the one thing it does NOT explain.**

`updateOnlineState()` (`main.ts:191-193`) is `fileOpsManager.setOnline(muxConnected && controlConnected)`. It is called on every mux connection change (`main.ts:953-956`), so on A it has run with `controlConnected === false` and **`FileOpsManager.isOnline` is `false`**. Consequence, `files/file-ops.ts:100-107`:

```text
files/file-ops.ts:105   if (!this.isOnline) {
files/file-ops.ts:106     this.offlineQueue.enqueue(op);
files/file-ops.ts:107     return;
```

**Every file operation vault A performs is being enqueued and will never be sent**, because the only drain is `setOnline(true)` with a `wasOffline` edge (`:74-82`), and that edge cannot occur. The queue is unbounded (`sync/offline-queue.ts`). **That is the user-visible half of the defect: A is a host that transmits no file operations and says `Live Share: hosting`.**

**What this does NOT explain, and the charter says so rather than bundling it.** The `.canvas` replicas are genuinely diverged — A `smoke.canvas` 6 nodes / 6 edges / 2109 B, B 7 nodes / 5 edges / 2159 B, B carrying an extra node `from-guest-041217` written at `02:12Z`, two minutes after A's promotion. **But canvas node state travels over the mux/Yjs link, which is open on both peers, not over `FileOpsManager`.** The divergence is therefore **not** shown to follow from the latch, and half a dozen other candidate causes are live in these vaults this week — the non-idempotent E2E suite, the `wp79-*` and `wp37probe-*` rig artefacts (which are diverged too, in both directions), bundles swapped mid-session, and agents writing `.canvas` files directly. **Attributing the divergence to the latch would be a diagnosis by adjacency**, which is the failure WP81's charter was rewritten to avoid. **This WP owns the second half of claim 4 — that the peers do not report they have not converged — and explicitly does not own the first.**

**Verification 5 — three notions of connectivity in one process, and on vault A all three disagree.**

| # | Notion | Definer | Consumers | Sees the mux? | Sees the control link? | Says on A right now |
|---|---|---|---|---|---|---|
| 1 | `connectionState` | `sync/connection-state.ts:19-52` | **the status bar** (`main.ts:1976-2004`, subscribed `:448`) | **no** | yes, via `main.ts:983/995/1003` | **`connected` ⇒ `Live Share: hosting (…)`** |
| 2 | `muxConnected && controlConnected` | `main.ts:191-193` | `session.info` (`e2e-control.ts:1175`), `FileOpsManager.setOnline` | yes | yes, via the latch | **`false`** |
| 3 | the sockets | `control-ws.ts:23`, `sync/sync.ts` `this.ws` | nothing reads them | — | — | **both `OPEN`** |

Notion 1 **never sees the mux at all**: if the sync socket died, the status bar would still read `hosting`. Notion 2 is the latch. Notion 3 is the truth and is exposed nowhere. **One definer is the whole point of this WP.**

**Verification 6 — the reconnect drivers, and what `autoReconnect` actually governs.**

- **`autoReconnect` is not a reconnect driver.** Its only read outside the settings UI is `main.ts:513-514`, one conjunct of the `onLayoutReady` gate that decides whether to call `resumeSession()` **at plugin load**. Neither retry loop consults it. It did not "fail to fire"; **it governs auto-resume at startup, and its label misleads.**
- **Control link:** `control-ws.ts:135-147`, base 300 ms, ×2, capped 30 s, **`MAX_RECONNECT_ATTEMPTS = 10`** (`:18`) ⇒ ≈128 s, then `shouldConnect = false` and one terminal state (`:136-139`). Nothing re-arms it short of a new session.
- **Mux link:** `sync/sync.ts:423-437`, base 100 ms, capped 30 s, **`MAX_RECONNECT_ATTEMPTS = 15`** (`:36`) ⇒ ≈180 s, then `shouldConnect = false` and `onMaxReconnectCallback` (`:426-429`).
- **Half-dead sockets are handled** — app-level ping/pong on both (`control-ws.ts:200-220`, `sync/sync.ts:601-632`) force-close a socket whose pong deadline expires. That machinery is correct and is not this WP's subject; it is the **instrument** AC3 must exercise.
- **Three silent exits from the retry chain, all structural, none observed to have fired.** `control-ws.ts:72` and `sync/sync.ts:352-353` are early `return`s that abandon a scheduled reconnect with no callback, no state change and no log; and `new WebSocket(url)` is unguarded at `control-ws.ts:79` and `sync/sync.ts:363`, so a synchronous throw inside a reconnect timer terminates the chain permanently and invisibly. Recorded as **S38** and bounded by AC5.
- **⚠ A first-connect network outage is reported to the user as an authentication problem.** `connect()` resets `everConnected = false` (`control-ws.ts:67`); exhaustion then routes to `auth-required` (`:138`), which raises `Live Share: authentication required - sign in via settings` and ends the session (`main.ts:998-1002`). Recorded as **S39**; named, not necessarily repaired — AC5's disposition clause.

- **Component(s) being changed:** `plugin/src/sync/control-handlers.ts` (the latch), a **new pure predicate module** under `plugin/src/sync/` (the definer), `plugin/src/sync/sync.ts` (mux narration), `plugin/src/sync/control-ws.ts` (give-up observability + the break seam), `plugin/src/main.ts` (**wiring and the status-surface read only**), `plugin/src/ui/settings.ts` (the `autoReconnect` description's scope), `plugin/src/testing/e2e-control.ts` (additive).
- **Constraints from BUILD_SPEC (invariants — what must not change):**
  - **`session.info`'s legacy quartet is byte-unchanged**, `connected` included. New fields are additive and **optional on `E2EControlHost`**.
  - **The definer is pure and has zero imports** — the `canvas-seed-decision.ts` / `canvas-mirror-decision.ts` precedent. It takes facts and returns a verdict; it reads no globals, touches no sockets and performs no I/O, so it is testable without a vault, a relay or a fake plugin.
  - **The break seam may not be reachable in a production build.** `testing/` is dead-code-eliminated by `__LS_E2E__` (`main.ts:529-535`, §7). The break method may exist on a channel class, but its **only** call site outside tests must be inside `testing/`, and it must be reachable from no UI, command, setting or message handler.
  - **Announce once, then count.** The give-up and not-sharing announcements follow WP81's landed discipline: one `Notice`, subsequent occurrences counted not repeated, recovery re-arms. A toast per retry would be a worse defect than the silence.
  - **`enabled === false` is not a failure** — the WP81 distinction, transposed: *no session*, *connecting*, *retrying*, *gave up* and *connected* are five states and must not collapse into two.
  - **No secret reaches any log, response, report or fixture.** Both vaults' `data.json` hold live credentials. **Keys may be named; values may not** — and note that this WP's surface is closer to them than any so far: the socket URLs carry `token`, `jwt` and `password` as query parameters (`control-ws.ts:74-77`, `sync/sync.ts:355-362`). **No new log line, E2E response field, error message or test name may contain a socket URL, or any part of one.** A link is identified by name (`control` / `mux`), never by URL.
  - **`useCanvasBinding` stays `false`.** No criterion depends on P4 or P5 behaviour.
- **Technology / framework / config constraints:**
  - TypeScript, `plugin/` workspace, Vitest 4.0.18. **Zero new runtime dependencies** (D11).
  - No wall-clock sleeps in headless tests: backoff, ping and pong deadlines are asserted with fake timers.
  - New user-visible strings are **German** (§1 UI-language rule). Existing status-bar strings keep their current language; re-translating them is not this WP's subject.
  - Biome reports a whole-file `format` finding per touched file (CRLF environment artefact). Advisory locally, gating in CI — do not mass-reformat.
- **Entry points / relevant files:**
  - `plugin/src/sync/control-handlers.ts` — `join-response` `:158`, the promote branch `:193-196`, the demote branch `:197-200`, the guest gate `:201`, the latch `:218-220`
  - `plugin/src/main.ts` — `updateOnlineState` `:191-193`, the `autoReconnect` gate `:510-521`, `cleanupSession` `:786-789`, `connectSync` `:944-956` (**the mux wiring at `:953-956` logs nothing**), the control state callback `:974-1012` (the only `"connection"` log site in the tree is `:975`), the host-only latch `:985-988`, the terminal branch `:1003-1011`, `updateStatusBar` `:1976-2004`, `promoteToHost` `:2187-2204`, `demoteToGuest` `:2222-`
  - `plugin/src/sync/control-ws.ts` — constants `:16-20`, `connect` `:63-69`, `openWebSocket` `:71-133`, `onclose` `:120-130`, `scheduleReconnect` `:135-147`, the give-up `:136-139`, `destroy` `:181-198`, ping/pong `:200-232`
  - `plugin/src/sync/sync.ts` — constants `:34-40`, `connect` `:193-197`, `openWebSocket` `:351-364`, `onopen` `:367-393`, `onclose` `:401-419`, `scheduleReconnect` `:423-437`, the give-up `:426-429`, heartbeat `:601-632`, `tickAwarenessKeepAlive` `:655-663`
  - `plugin/src/sync/connection-state.ts` — the whole file (61 lines)
  - `plugin/src/files/file-ops.ts` — `isOnline` `:53`, `setOnline` `:74-82`, `emitOp` `:100-107`
  - `plugin/src/testing/e2e-control.ts` — `E2EControlHost` `:342-355` (**the optional-field precedent is in the comment at `:346-349`**), `routeCommand` `:504-…`, `sessionInfo` `:1169-1186`, the conjunction `:1175`, the anti-pattern `simulateEdit` `:995-1023`
  - Read-only context: `plugin/src/session/presence-manager.ts:71`, `:142-143`; `plugin/src/sync/offline-queue.ts`; `plugin/src/__tests__/wp46/test_legacy_fields_unchanged_visible.test.ts`; `plugin/src/__tests__/control-ws.test.ts`; `plugin/src/__tests__/sync.test.ts:560-580`; `server/src/index.ts:74-82`; `server/src/ws-handler.ts:421-435`; `server/src/control-handler.ts:548-591` (**all four server files are READ-ONLY context and are not edited**)
- **Files this WP may NOT touch:** everything under `server/`, `plugin/src/canvas/canvas-binding.ts`, `plugin/src/canvas/canvas-model-bridge.ts`, `plugin/src/files/manifest.ts`, `plugin/src/main.ts`'s `cleanupStaleFiles`, `plugin/src/__tests__/dataloss/**`, the `DEFAULT_SETTINGS` block of `plugin/src/types.ts`, and `plugin/manifest.json`. **If the repair appears to require reaching into any of these, that is an ESCALATE, not a judgement call.**
- **Structure references:** *(intentionally empty — no Graphify graph exists for this project; FALLBACK mode is declared in BUILD_SPEC §3. Worker 3 fills this in after implementation. Do not invent paths here.)*

If structure references conflict with the BUILD_SPEC or explicit task scope, the BUILD_SPEC and TaskCharter win. Escalate instead of following the map.

### Ruling — is this user-reachable, or only reachable by SIGKILL-level abuse?

**User-reachable, and the abusive treatment changed the rate, not the reachability.** The ruling is required by the brief and it is not a hedge:

- **The trigger is a role transition on `join-response`, not a dropped socket.** Nothing in the reproduction requires a kill, a crash or a network fault on the peer that ends up broken. It requires the relay to answer `isHost: true` to a peer whose local `settings.role` is `guest` — and the relay manufactures exactly that disagreement on its own, by auto-electing a survivor and rewriting `room.hostUserId` whenever a host's socket closes with peers still present (`server/src/control-handler.ts:548-591`). **A host closing its laptop lid is sufficient.**
- **A `taskkill /F` is not needed and a restart is not needed either.** `join-request` is re-sent on **every** control-channel `connected` event (`main.ts:979-984`), reconnects included. So an ordinary flaky-Wi-Fi drop on a guest whose relay-side status has meanwhile flipped produces the same promotion, mid-session, with no restart — and the same permanently unset latch.
- **What the abuse did change:** it drove **34 role transitions in 2 h 05 min** on one vault. An ordinary user might see one a week. The rig's treatment raised the frequency by three orders of magnitude and is why the state was caught at all; it is not why the state exists.
- **And the Dispatcher's own caveat stands independently:** a client that neither retries nor reports is a defect whatever caused the drop. Here it is stronger — **there was no drop at all, and the peer still reports wrongly.** The abuse hypothesis is not merely unnecessary; it is falsified by the measurement, because both sockets are open.

---

## 4. Acceptance Criteria

*Each criterion names **the observable that proves it** and **what would make it vacuous**.*

*Acceptance evidence is **two LIVE Obsidian instances** driven through the E2E rig — `POST http://127.0.0.1:39431/command` (vault A) / `:39432` (vault B), body `{"cmd","args"}` (`testing/e2e-control.ts:641`). **Blind sets are discontinued** — no `blind_set1`, no `blind_set2`, no falsification injection, no `BlindVerificationLedger` row is owed. Headless tests against injected fakes are the honest tool wherever a state cannot be produced on a live instance without abusing it, and are named as such per row.*

1. **The connected latch is a function of the link, not of the role the peer held when the link opened.**
   - **Deliverable:** the `join-response` promotion and demotion branches (`control-handlers.ts:193-200`) no longer skip the connected marking, and the socket-open path (`main.ts:985-988`) no longer gates it on `role === "host"`. A peer's control link is marked connected when, and only when, its control socket is usable — under **every** ordering of `{socket open, join-response, promotion, demotion}`.
   - **Observable (headless, deterministic, at the `registerControlHandlers` seam with a fake channel):** all **four** role paths are exercised as separate rows and each asserts the marking afterwards — resume-as-guest → `isHost:true` → promoted; resume-as-host → `isHost:false` → demoted; resume-as-guest → `isHost:false`/approved (the ordinary guest join); resume-as-host → `isHost:true` (the ordinary host case). **The first row must be shown to FAIL against the current tree** — that is the live defect and it is the only row that discriminates today.
   - **Observable (live):** on the instance currently reporting `role: host, connected: false`, `session.info` reports `connected: true` after the corrected bundle is loaded, **with no session restart, no re-join and no relay change** — and AC2's per-link fields show *why*, rather than the verdict alone.
   - **Vacuity risk — named:** asserting only the two ordinary paths, which pass against the **unrepaired** build and prove nothing. Equally vacuous: asserting `session.info.connected` on a live instance that happens to have resumed **as host**, since `main.ts:985` latches that case correctly today — **the live evidence must record which role the instance resumed as, from its own `[session] resuming as …` line, or a green here is a coin flip on the relay's election** (S27/S37). Third: setting the latch unconditionally somewhere convenient, which would make a genuinely dead control link report connected — the demotion row and AC2's socket-derived fields are what forbid that.

2. **A peer reports each link separately, and every field is read from the link rather than from a latch.**
   - **Deliverable:** one additive E2E command (or additive fields on `session.info`, or both) reporting **per link** — `control` and `mux` — at least: whether the socket object exists, its **live `readyState` read at call time**, the peer's own belief about that link, the number of reconnect attempts used and the ceiling, whether the retry chain has ended, and the timestamp of the last state change. Plus, once each: the offline-queue **depth**, and the definer's verdict for "is this peer sharing". **`session.info`'s quartet is byte-unchanged; every new field is optional on `E2EControlHost`.**
   - **Observable (live, both vaults):** the reported `readyState` for each link **agrees with reality**, demonstrated by taking AC3's break, re-reading, and observing the field change — and by the peer's belief and the socket's `readyState` being reported as **two separate fields that are shown to disagree** in the one state where they can (between a break and the reconnect).
   - **Vacuity risk — named:** reporting the peer's own booleans twice under two names. `muxConnected`/`controlConnected` are exactly the values this defect corrupts; a "per-link report" derived from them would have reported vault A as disconnected on a link that was open, which is the current defect wearing a new field name. **The `readyState` fields must come from the socket objects.** And, this run's signature failure eleven times over: **any hardcoded field.** `simulateEdit`'s `applied: true` (`:1023`) is the precedent. Every field is read at call time.

3. **A link can be broken on demand, in two shapes, and the break is proven to have taken effect before any recovery is claimed.**
   - **Deliverable:** one additive E2E command taking a **named link** (`control` | `mux`) and a **named break shape**, plus a restore. Two shapes are required and they are not interchangeable:
     - **`close`** — the socket is closed from inside the process. Exercises `onclose` → `scheduleReconnect` (`control-ws.ts:120-130`, `sync/sync.ts:401-419`). This is the clean-FIN shape.
     - **`silence`** — the socket is left open but its traffic is suppressed in both directions, so **no `onclose` fires** and only the pong deadline can end it (`control-ws.ts:214-219`, `sync/sync.ts:608-613`). This is the flaky-Wi-Fi shape, it is the one a `close` cannot simulate, and it is the only one that exercises the half-dead-socket watchdogs at all.
   - **The instrument choice, decided here rather than left open, with the alternatives and why they were rejected:** the relay is remote (`https://liveshare.neuralangels.de`) and `server/**` is a §7 abort criterion outside WP41, so **the relay may not be modified, restarted or killed**. A **local relay** is WP70's subject and WP70 is `planned`, not landed — `tools/obsidian_e2e/relay.py`'s `LocalRelay` is unproven and carries S18. A **blocked port** needs an OS firewall rule on the owner's machine and would break the sibling agent's instances at the same time. A **proxy** needs `serverUrl` rewritten inside both vaults' `data.json`, which holds live credentials and is the WP72 borrow-clobber hazard — forbidden outright. **The in-process break is the only shape that is additive, needs no infrastructure, cannot reach the other instance, and can produce the half-dead case selectively.** It is specified as **additive**: no existing command changes shape, and it does not exist in a production build (§2 invariant).
   - **Observable — the positive control is mandatory and is per shape:**
     - `close`, `link=mux`: the relay's `GET /healthz` `clients` **decreases by exactly one** within a bounded poll and returns to its prior value after the reconnect. This is **off-client** corroboration and it is valid precisely because that counter counts mux sockets (`ws-handler.ts:421-435`).
     - `close`, `link=control`: the **other** instance observes the `presence-leave` the relay broadcasts on a control-socket close (`server/src/control-handler.ts:558-563`) — again off-client, and read from the peer, not from the peer that was broken.
     - `silence`: the relay's `clients` count **does not change**, and the outage is ended by the peer's own pong deadline — recorded by AC4's narration as a watchdog-forced close. **The two shapes must be shown to differ on the relay-side counter**, which is what proves the implementation did not quietly do the same thing twice.
     - Every shape additionally returns the socket's `readyState` **immediately before and immediately after**, read from the live socket, plus a monotonically increasing break id.
   - **Vacuity risk — named, and this is the row the brief singles out:** *"the peer reconnects"* passes trivially if the connection was never actually broken. **A criterion that asserts recovery without an off-client witness that the break landed is unfalsifiable and is rejected.** Second: a command that returns `{broken: true}` — the `simulateEdit` shape verbatim, forbidden by this AC. Third: a break that names a link with no socket and reports success; that is a **named refusal at the command boundary**, before any state is touched (I11 / WP72 precedent). Fourth: leaving an instance silenced after an aborted run — `restore` is required, and its effect is asserted, not assumed.

4. **The mux link narrates its own lifecycle, as the control link already does.**
   - **Deliverable:** `sync/sync.ts`'s socket lifecycle — open, close, each scheduled retry with its attempt number and delay, the watchdog-forced close, and the give-up — reaches the logger. Today **`main.ts:975` is the only `"connection"` log site in the entire plugin** and it narrates the control channel only; `SyncManager` holds a logger (`:165`) and uses it for one metric (`:681`, `:688`). The mux wiring in `main.ts:953-956` records nothing.
   - **Observable (live, both vaults):** after an AC3 `close` on the mux, the log contains a close line, at least one numbered retry line, and a reconnect line, **at that link's name** — read from the file whose path AC-adjacent WP81 machinery reports, so the reader is not guessing which file is current. After an AC3 `silence`, the log additionally contains the **watchdog-forced** close, which the `close` shape does not produce. Line counts before and after are recorded.
   - **Vacuity risk — named:** asserting that *some* line appeared. The discriminating assertion is that the **`close` and `silence` shapes produce different lines**, since a narration that logs one generic "mux changed" string would satisfy a naive check while telling the reader nothing about which mechanism ended the socket — which is exactly the distinction this whole WP exists to preserve. Second: asserting on log strings as a general oracle; here the log **is** the subject, but a new signature is a machine contract (BUILD_SPEC §1 / §10) and must be declared, not improvised — and **no signature, category, level or volume of any existing log changes.**

5. **A retry chain that has ended says so, once — and no path leaves it silently.**
   - **Deliverable:** every exit from either retry chain is observable: exhaustion (`control-ws.ts:136-139`, `sync/sync.ts:426-429`), the silent early returns at `control-ws.ts:72` and `sync/sync.ts:352-353`, and a throw from the unguarded `new WebSocket(url)` at `control-ws.ts:79` / `sync/sync.ts:363` (**S38**). The end of a retry chain is announced **once** — one log entry and one `Notice` — with subsequent occurrences counted, and a later successful connect re-arming the announcement. Separately, the `autoReconnect` setting's description states its **actual** scope: it governs whether a session is resumed **at plugin load** (`main.ts:510-521`), and it is read by neither retry loop.
   - **Observable (headless, fake timers, injected socket):** driving a link past its ceiling produces exactly one announcement, the counter advances on the next N failures without a second `Notice`, and a success followed by a further exhaustion announces again. Each silent exit is driven deliberately and shown to produce an observable outcome where it produces none today; the throw case is driven by a socket factory that throws. **Each row must be shown red against the current tree.**
   - **Observable (live):** an AC3 `close` followed by a restore that is withheld until the ceiling is passed on **one** link, with the announcement observed and the peer's own report (AC2) showing `gave up = true` for that link and not for the other. Run on **one** vault only; the other stays untouched as the control.
   - **Vacuity risk — named:** a `Notice` per retry, which at 300 ms base backoff is a worse defect than the silence it replaces — the once-then-count clause is the defence and may not be trimmed. Second: asserting "no second Notice" alone, which passes on a build that announces nothing at all; it is paired here with the counter that must have advanced. Third: quietly repairing **S39** — the first-connect outage reported as `Live Share: authentication required` (`control-ws.ts:67` + `:138` → `main.ts:998-1002`) — while implying this AC covers it. **It is repaired with its own criterion and its own evidence, or the report states plainly that it was not.** WP81's M3 precedent.

6. **The user is told, and the surface stops asserting health it has not measured.**
   - **Deliverable:** one definer — a **pure, zero-import predicate module** — answers *"is this peer sharing right now?"* and *"is this peer's `role` currently backed by a live link?"*, and **every** consumer reads it: the status bar (`main.ts:1976-2004`, today driven by `connectionState`, which never sees the mux), `updateOnlineState`, and AC2's report. A silent desync becomes visible: when either link is down, or the retry chain has ended, or the offline queue is non-empty, the status surface says so instead of saying `hosting`, and the transition into that state raises **one** `Notice` (German, §1). Recovery returns the surface to the healthy text **without a restart**, and the announcement re-arms.
   - **The role question, decided here — one definer, and it is NOT `session.info.role`.** `role` stays a verbatim passthrough of `settings.role` (the WP46-pinned quartet; the rig's identity contract depends on it), because *"which role has this peer persisted"* is a real and separate question. The qualified question — *"is that role backed by a live link"* — gets its **own named field** from the definer, and every consumer that means the second question reads the second field. **Consumers are not each left to check two things**: two independent checks at N call sites is how this defect got its second half, where `main.ts:985` and `control-handlers.ts:218` each answered a fragment of one question. **Recorded and NOT enacted:** `cleanupStaleFiles`' live-host check (WP80's premise) consumes a **remote** peer's `isHost` from `remoteUsers`, which is a different input from the local role and belongs to WP80's file — **WP82 defines the predicate and does not rewire that call site**, and the report must name it as WP80's to adopt.
   - **Observable (live, both vaults):** with AC3 holding a link broken, the status-bar text is read back through the rig and does **not** claim a healthy sharing state; the `Notice` is raised once; on restore the text returns to the healthy string and the queue depth returns to zero. Read on the vault whose current status bar says `Live Share: hosting` while `session.info` says `connected: false` — **that exact contradiction is the before-state and must be recorded as such.**
   - **Vacuity risk — named:** asserting the status text only in the healthy state, which is what it already says — the discriminating read is during a held break, and it must be shown to differ from the pre-WP82 build, where `connectionState` is not transitioned by any mux event at all. Second: introducing a **fourth** notion of connectivity beside the three in §3 Verification 5 — the AC is satisfied only if `connectionState`, the status bar and `updateOnlineState` all resolve through the one definer, asserted structurally (one exported predicate, its call sites enumerated) rather than by reading three agreeing values in one lucky state. Third: a banner or toast that fires on every backoff tick during an ordinary 300 ms reconnect, turning a healthy recovery into user-visible noise — the announcement is bound to the **state**, not to the retry.

**Definition of Done:** *"is this peer sharing, and on which link?"* is a question one call answers from the sockets — and a peer that has stopped sharing says so on its own screen, once, without being asked.

---

## 5. Constraints and Known Risks

- **Permission / environment limits:** Windows dev host. Run tests from the workspace root, never from a subdirectory; long-running invocations through `visible-console` `run_python` / `run_command` with **absolute** paths, never a Bash background process. **The two owner vaults, the two control ports (39431 / 39432) and `H:\tmp\liveshare_*.py` are shared with other work** — check `DISPATCHER_STATE.md` and the task registry before launching, installing, restoring or resetting anything, and never during another agent's run. **The relay is production and is shared**: `GET /healthz` is the only permitted relay interaction, no room is created or deleted, and no relay process is touched.

- **Known risks specific to this WP:**
  - **⚠ The most likely wrong implementation is to set the latch unconditionally.** "Mark it connected on `join-response`" makes the promotion case green and makes a genuinely dead control link report healthy — the defect inverted. The demotion row of AC1 and AC2's socket-derived `readyState` are the defences and may not be trimmed.
  - **⚠ The second is to redefine `connected` instead of repairing its operands.** It re-opens WP46, breaks every rig scenario that reads it, and would go green on a build whose latch is still broken. §2 forbids it.
  - **⚠ The third is to bundle the divergence.** The replicas are diverged and this WP does not converge them (§3 Verification 4). A criterion asserting convergence would be asserting something this charter has explicitly not established, in vaults where at least four other causes are live — **and it would produce a fix for one thing and a false sense of the other**, which is the exact failure the brief names.
  - **⚠ The fourth is to trust the incident narrative.** Three of its factual claims are false: the log is not silent (128 `[connection]` lines, 34 today), `autoReconnect` did not fail to fire (it is not a reconnect driver), and no connection dropped (both sockets are open). A test named after a disconnect that did not happen goes green for free. **Rule 12 applied here changed the subject of the charter; do not un-apply it.**
  - **⚠ The fifth is to treat vault B as the healthy control.** B's `connected: true` is the same latch, set under a role B no longer holds (§3 Verification 3). **Neither peer's `connected` is currently a measurement**, and a before/after that uses B as the baseline is comparing two broken values.
  - **⚠ The sixth is a break instrument that only closes.** A clean close is not a network partition; the half-dead shape is the one flaky Wi-Fi actually produces, it is the only one that exercises the pong watchdogs, and it is the shape under which the relay's `clients` count does **not** move. AC3's two shapes and their differing off-client controls are what keep this honest.
  - **⚠ Do not assume the unbuilt phases.** `useCanvasBinding` is `false` and frozen until P5. A criterion that would only pass once P4 or P5 lands is a criterion this WP cannot discharge.
  - **⚠ Do not mirror any generated test suite into `plugin/src/__tests__/` before this WP is implemented.** `tsc` typechecks `src/` including tests, so an unimplemented mirrored suite breaks `npm run build` **repo-wide** for every other WP. This has been violated once already in this run.
  - **⚠ Both vaults' `data.json` hold live credentials, and this WP's surface is closer to them than any so far** — the socket URLs carry `token`, `jwt` and `password` as query parameters (`control-ws.ts:74-77`, `sync/sync.ts:355-362`). **No socket URL, or any part of one, may reach a log line, an E2E response, an error message, a test name, a fixture, a report or a commit message.** Links are named, never addressed. Keys may be named; values may not.

- **Known flaky patterns:**
  - **The relay's host election is a coin flip** (S27, quantified as S37): 34 role transitions in one vault in two hours today, with no alternation. **No criterion may depend on which vault is host**, and every live row must record the role the instance actually resumed as, read from its own `[session] resuming as …` line.
  - No wall-clock sleeps. Backoff, ping intervals and pong deadlines are asserted with fake timers.
  - Do not assert on log strings as the primary oracle — **except** in AC4, where the log *is* the subject.
  - A test that asserts an absence — *"no second Notice"* — is suspect by default and is paired here with a counter that must have advanced.
  - **Every WP82 scenario must be idempotent**: per-run markers, no dependence on a previous run's log content, no dependence on a link's state at scenario entry, and a SKIP recorded as a SKIP. A scenario that leaves a link silenced has corrupted every scenario after it.

- **External dependency risks:** none permitted (D11).
- **Hard constraints:**
  - **The connected marking is a function of the link, under every ordering of socket-open, `join-response`, promotion and demotion.**
  - **`session.info`'s quartet — `clientId`, `role`, `roomId`, `connected` — is byte-unchanged. New fields are additive and optional on `E2EControlHost`.**
  - **Per-link `readyState` is read from the socket at call time. No field is a literal.**
  - **One definer, pure and zero-import; `main.ts` holds wiring and a read, no decision.**
  - **Two break shapes, each with an off-client positive control, and the two must differ on the relay-side counter. `restore` is required and its effect is asserted.**
  - **The break seam is unreachable in a production build and from every UI, command, setting and message handler.**
  - **No path leaves a retry chain without an observable outcome. The end of a chain announces once, then counts; recovery re-arms.**
  - **`autoReconnect`'s description states its real scope: auto-resume at plugin load.**
  - **No existing log signature, category, level or volume changes. New signatures are declared.**
  - **No socket URL, or fragment of one, in any log, response, message, test name, fixture, report or commit message.**
  - **No `server/**` edit. `useCanvasBinding` is not flipped. `cleanupStaleFiles`, `files/manifest.ts` and `__tests__/dataloss/**` are byte-unchanged. The plugin version is not bumped. `plugin/manifest.json` is not touched.**
  - **No `DONE` work package is re-opened; WP82 holds no §7 licence of any class.** A reddened inherited assertion — in particular in `wp46/test_legacy_fields_unchanged_visible.test.ts`, `control-ws.test.ts` or `sync.test.ts` — is an ESCALATE, left red.
  - **Not batched with WP80. `git status` re-read immediately before every commit (rule 14). No revert of a path this batch did not create.**

### Recorded, not repaired — this WP's own sweep

- **S35 — `/healthz`'s `clients` counts MUX sockets only.** `server/src/index.ts:74-82` → `ws-handler.ts:421-435` counts unique sockets in the **yjs** WSS room states; the control WSS is not counted anywhere. It has been read all week as "peers connected", including in the report that produced this charter, where `clients: 2` was recorded as contradicting vault A. **It contradicts nothing** — both mux sockets are genuinely alive. Not a product defect; a defect in what the number has been taken to mean. **`server/**`, unowned.**
- **S36 — `remoteUsers` is never pruned by staleness.** `presence-manager.ts:142-143` (`presence-leave`) and `main.ts:783` (`cleanupSession`) are the only removals. The relay does broadcast `presence-leave` on a control-socket close (`server/src/control-handler.ts:558-563`), so the ordinary case is covered — but a peer whose **own** control link is dead cannot receive those leaves and keeps every remote user, `isHost` included, indefinitely. That map is an input to WP80's live-host gate. **The local half is bounded by AC6's definer; the remote half is unowned.**
- **S37 — the relay's host election, quantified.** Vault A logged **34 role transitions in 2 h 05 min** on 2026-08-05 (8 `promoted to host`, 5 `demoted from host`, 21 `resuming as …`), with no alternation pattern. This is S27 with a number attached, and it is why the promotion path — previously thought exotic — is routine. Fix is server-side (`control-handler.ts:588`). **Unowned; out of scope.**
- **S38 — three silent exits from the retry chains.** `control-ws.ts:72` and `sync/sync.ts:352-353` are early `return`s that abandon a scheduled reconnect with no callback, state change or log; `new WebSocket(url)` is unguarded at `control-ws.ts:79` and `sync/sync.ts:363`, so a synchronous throw inside a reconnect timer terminates the chain permanently and invisibly. **Structural, not observed to have fired. Bounded by AC5.**
- **S39 — a first-connect network outage is reported to the user as an authentication problem.** `connect()` resets `everConnected = false` (`control-ws.ts:67`); exhaustion with `everConnected === false` routes to `auth-required` (`:138`), which raises `Live Share: authentication required - sign in via settings` and ends the session (`main.ts:998-1002`). **Named; repaired with its own criterion and evidence, or explicitly not repaired — AC5's disposition clause. Silently leaving it while implying AC5 covers it is the failure mode.**
- **S40 — `OfflineQueue` is unbounded.** `sync/offline-queue.ts` coalesces per path but has no cap; a peer stuck offline — which, before this WP, could be permanent — accumulates ops until the session ends. **Explicitly out of scope: a cap is a data-retention decision. AC2 makes the depth reportable and changes nothing about what it holds. Owner: none assigned.**
- **S41 — the incident report's three factual claims are all false, and the correction is recorded so it is not inherited.** The debug log is not silent (**128** `[connection]` lines, **34 dated 2026-08-05**, most recent `02:10:18.881Z` — not 38 ending 2026-08-01); `autoReconnect` did not fail to fire (it is not a reconnect driver, `main.ts:513-514`); and **no connection dropped** (both of A's sockets are `OPEN` and carrying frames, §3 Verification 2). **The defect is real and worse than reported; its reported mechanism is wrong in every particular.** Recorded because two batches this run have already inherited a Dispatcher premise and "independently confirmed" it.

---

## 6. Definition of Done Artifacts

- **Required changed files:**
  - `plugin/src/sync/control-handlers.ts` — the `join-response` latch on both role-transition branches
  - `plugin/src/sync/<new>.ts` — the pure, zero-import link-state definer
  - `plugin/src/sync/sync.ts` — the mux lifecycle narration and the observable chain exits
  - `plugin/src/sync/control-ws.ts` — the observable chain exits and the break seam
  - `plugin/src/main.ts` — **wiring and the status-surface read only**
  - `plugin/src/ui/settings.ts` — the `autoReconnect` description's true scope
  - `plugin/src/testing/e2e-control.ts` — the AC2 report command and the AC3 break command, additive, host methods optional on the interface
- **Already landed by Worker 2 with this charter — NOT implementor work:** the §9 WP82 row and the §7 / header counts (81 → 82), re-derived from §7 and §9 rather than edited independently. **The implementor does not edit `BUILD_SPEC_CanvasV2.md`.**
- **Required report:** `ImplementationReport_WP82.md` (in `workflowArtifacts/canvas-v2/`), which must additionally record: an explicit statement, at the top, that **no connection ever dropped** and that the reported log silence and `autoReconnect` failure did not occur (S41), with what was measured instead, so the correction is not lost; **AC1's four role rows** with the first shown red against the current tree, and the **role each live instance resumed as**, quoted from its own `[session] resuming as …` line; **AC2's live per-link report from both vaults**, including the one state where the peer's belief and the socket's `readyState` are shown to disagree, and the demonstration that no field is an echo of `muxConnected` / `controlConnected`; **AC3's two break shapes with their off-client positive controls**, including the relay `clients` delta for each shape (**one moves, one does not**) and the `restore` verification; **AC4's log excerpts** for both shapes, with the before/after line counts, and the declared new signatures; **AC5's once-then-count result** with counter values, the recovery re-arm, each silent exit driven and shown red before, and the **explicit disposition of S39**; **AC6's status-bar text read back during a held break** together with the recorded before-state contradiction (`Live Share: hosting` while `connected: false`), the structural enumeration of the definer's call sites, and the statement that `cleanupStaleFiles`' live-host check was **not** rewired and is named as WP80's to adopt; a positive statement that **`session.info`'s quartet is byte-unchanged** and `wp46/test_legacy_fields_unchanged_visible.test.ts` was not modified; that **no existing log signature, category, level or volume changed**; that `cleanupStaleFiles`, `files/manifest.ts` and `__tests__/dataloss/**` are byte-unchanged; the **executed test count** before and after with the statement that no existing test was deleted, weakened, retitled, skipped or amended and that **no §7 licence of any class was taken**; and, for every live run, which vault ports were used, that **no `data.json` value was read or printed**, that no socket URL or fragment reached any artefact, that the relay was contacted only by `GET /healthz`, that no link was left silenced, and that `canvas.simulateEdit` was not called.
- **BUILD_SPEC updates required:** no — the §9 row and the counts were entered when this charter was written. Anything further is an **ESCALATE** rather than a spec edit.
- **Gate status required at handover:** `npm run build` (tsc + esbuild) PASS and `npm test` 0 failed from `plugin/`, with the executed test count recorded. `npm run lint` advisory locally, gating in CI — do not mass-reformat. **The canvas E2E suite is expected to move off 13/18 once this lands; whatever it reads must be recorded as a measurement, not asserted as 19/19.**

---

## 7. Visible Test Cases / Producer Artifacts

*Filled by Worker 3. Worker 2 leaves this section empty.*

*⚠ **Blind sets are discontinued for new work** (owner's instruction, 2026-08-05): no `blind_set1`, no `blind_set2`, no falsification-injection requirement and no `BlindVerificationLedger` row is owed by this WP. Validation is W4 against two live Obsidian instances, with headless tests carrying the rows a live instance must not be abused to produce. E2E-plugin defects found while validating go back to **W3 as a revision** — and note that for this WP **both** E2E commands are part of the deliverable, so a defect in either is a defect in WP82.*

---

## 7b. W4 Test Targets (filled by Worker 3's Unit Test Sub-Agent, if any)

*Empty at handover.*

---

## 8. Autonomous Execution Plan (filled by Coder Sub-Agent, attempt 1)

- **Observed current behavior:**
- **Approach:**
- **Fallback path if all attempts fail:**

---

## 9. Handover Summary (filled by Coder Sub-Agent on completion)

- **What is complete:**
- **What remains open:**
- **Final status:**

---

## 10. Risk Notes for Worker 4 (filled by Worker 3 Core)

*Empty at handover.*
