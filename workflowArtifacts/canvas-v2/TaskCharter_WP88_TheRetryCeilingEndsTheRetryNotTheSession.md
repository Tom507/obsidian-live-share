# Task Charter — WP88: the retry ceiling ends the retry, not the session

<!-- Updated: chartered 2026-08-05 (B33) from WP82's carried-up item ("the give-up destroys the session"), re-verified independently against the current tree per rule 12 on branch `fix-bugs-and-raceconditions` at `386e595`. ⚠ THE DEFECT IS REAL AND IS WORSE THAN CARRIED UP, IN THREE MEASURED RESPECTS. (1) It is not three keys. `SessionManager.endSession` clears SIX settings keys and persists them — `roomId`, `token`, `encryptionPassphrase`, `encryptionSalt`, `role` and `permission` (`session/session.ts:134-140`) — so for a room that uses a passphrase a fresh invite is not sufficient recovery: the invite carries only `r` and `t` (`session.ts:102-103`) and the client has just erased its only copy of the passphrase. (2) On a HOST it is not local at all. `session.ts:116-133` issues `DELETE {serverUrl}/rooms/{roomId}` with the bearer token BEFORE clearing anything, so a host whose Wi-Fi drops for ~128 s destroys the room for EVERY participant, all of whom are connected fine — a one-peer network fault escalated into a whole-session destruction, and it is irreversible from the client because `server/**` is a §7 abort criterion outside WP41. (3) The ceiling is not the only route. A census over the tree finds FIVE routes from a connectivity failure to session-identity destruction, one of which — `main.ts:1110-1112`, a bare `catch` around the whole plugin-load resume — reaches it with no retry ceiling involved at all. On the two owner vaults `encryptionPassphrase` and `encryptionSalt` are both empty (recorded in `DISPATCHER_STATE.md`'s identity-key table, measured by hash, values never read), so clearing them is observationally a no-op HERE and would not be in a room that uses a passphrase — stated as traced, not measured on a populated room. No Obsidian was launched for this charter, no vault file was read or written, no E2E script was run, no `data.json` was opened, no relay was contacted, no `plugin/src/**` file was edited, and no credential value was read, hashed, printed or inferred: every line number below was measured by reading the tree. -->
**Charter Status:** `SPEC_COMPLETE`
**WP:** WP88
**Phase:** P0
**task_mode:** `standard`
**Depends on:** WP82 (`DONE`, `73b7f35`/`95df1c4`) — its definer, its `link.report` and its `link.break`/`link.restore` seam are **consumed, never duplicated**. **MUST NOT be batched with WP87 or any other `main.ts` work — see §2 Ordering.**
**W4 Test Targets:** `0`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** a client that cannot reach the relay **stops sharing and keeps its identity**. Today the end of a retry chain calls `endSession()`, which erases the session credentials from `data.json` and — on a host — deletes the room from the relay. After this WP the end of a retry chain produces a **named, reported, recoverable state**; `endSession()` keeps exactly one meaning, the one it was written for: **the user ended the session.**
- **The question this charter answers, because it was asked rather than assumed:** *what should a client do when it cannot reach the relay for two minutes?* **Ruling: stop transmitting, say so, and retain the session identity.** The full argument is in §3, but the shape of it is this — **losing the connection is a fact about the network; losing `roomId` / `token` / `role` is a fact the client manufactures about itself.** The first is unavoidable and honest. The second converts a transient network failure into permanent, user-visible data-entry work, and on a host into the destruction of a room that every other peer is still happily connected to.
- **The ruling this WP inherits and extends.** WP81's landed ruling — *a swallowed failure may drop data, but may not drop the fact that it dropped data* — has a WP82 form (*a peer that is not transmitting may fail to transmit; it may not report that it is transmitting*) and a WP88 form: **a client may stop sharing; it may not discard the identity that would let it resume.** All three are the same sentence about the same failure: an absence of information being converted into a positive act. Here the absence is *"I cannot reach the relay"* and the act is *"discard the credentials, and if I am host, delete the room"* — which is **D2's shape exactly**, one layer up from the file system: *the manifest does not list it* read as *it was deleted*, when it means *nobody told me*.
- **Why it is P0.** It is the only defect in the backlog whose failure mode is **unrecoverable from inside the product**. Every other one this week destroyed something a restore, a resync or a re-type could bring back. This one takes the room away from every peer at once and leaves the user with a settings dialog. It is also why **WP82 declined its own AC5 live row** — the instrument to reproduce it exists and firing it on a shared vault would log it out permanently with no in-rig way back. **AC4 exists to remove that as a permanent blocker on the rig, which is a second reason this is P0.**
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 9, work package **WP88**; section 7 (Quality Gates), whose live two-instance gate cannot currently exercise a retry ceiling at all. Phase **P0**, on WP81's and WP82's precedent: it is diagnostic-and-recovery integrity, and every phase's live evidence depends on a session that survives the instrument used to test it.

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: modify, **one repository** (`obsidian-live-share`, branch `fix-bugs-and-raceconditions`), **`plugin/src/` only**.
  - Responsibility: derive from the tree the **complete set of routes from a connectivity failure to session-identity destruction**; sever the destructive act from every one of them; give the resulting state the name WP82's definer already computes; make recovery possible without a fresh invite and demonstrate it live **without destroying the owner's session**; and bound the growth this change would otherwise unleash on the offline queue.
  - Scope summary: the census, derived · `endSession()` reserved for the user · the ceiling produces `"gave-up"` and retains the six keys · a re-arm affordance · **S39** dispositioned in both halves · **S40**'s coupling bounded structurally, without a cap constant.
- **Out of scope / non-goals — each of these is an ESCALATE, not a judgement call:**
  - **⚠ `server/**`.** Untouched. A `server/` edit outside WP41 is a §7 abort criterion. **This is load-bearing here rather than boilerplate:** the host arm's `DELETE /rooms/{roomId}` is irreversible from the client precisely because the relay cannot be edited or asked to undo it, and the relay is **production** and **shared** (`https://liveshare.neuralangels.de`). `GET /healthz` is the only permitted relay interaction. **No criterion may create, delete or mutate a room.**
  - **⚠ Redesigning the reconnect policy's constants.** `MAX_RECONNECT_ATTEMPTS` **10** (`sync/control-ws.ts:19`) / **15** (`sync/sync.ts:37`), `RECONNECT_BASE_MS` **300** / **100**, `RECONNECT_MAX_MS` **30 000**, the backoff curve and the ping/pong deadlines keep their current values. **WP88 changes what happens AT the ceiling, not where the ceiling is.** Moving it is a product decision with no measurement behind it and is not made here — C82 §2 declined it for the same reason and this WP does not quietly take it.
  - **⚠ A second definer.** `sync/link-state.ts` is **the** definer: `decideSharing` (`:172`), `SharingState` including `"gave-up"` (`:145`, reached at `:186`), `announcementKey` (`:266`), `nextAnnouncement` (`:299`), `sharingStatusText` (`:229`), `sharingNoticeText` (`:249`), `describeLifecycle` (`:357`). **WP88 consumes them.** Authoring a second predicate for *"has this peer given up"* is **hard-won rule 10** and an abort criterion — the state is already computed, in one pure zero-import module, and reported through `linkReport()` (`main.ts:351-388`) as `state`, `retryChainEnded`, `sharing` and `roleBacked`. The defect is that **nothing consults it before destroying the session.**
  - **⚠ Changing `session.info`'s legacy quartet — `clientId`, `role`, `roomId`, `connected`.** WP46 pins it (`__tests__/wp46/test_legacy_fields_unchanged_visible.test.ts`) and every rig scenario reads it. New fields are additive and **optional on `E2EControlHost`**, on the landed `vaultId` precedent (`testing/e2e-control.ts:346-349`). Note the direction of travel: retaining `role` and `roomId` makes the quartet **more** stable, not less — but nothing about its shape or its computation may change.
  - **⚠ An `OfflineQueue` CAP CONSTANT or a retention policy.** C82 ruled a cap is a data-retention decision and left it unowned (**S40**). That ruling stands and WP88 does not overturn it. **What WP88 does own is the coupling it creates** — see AC6 and the ruling in §3.
  - **⚠ The user-initiated session end.** `main.ts:2645` and `:2657` (the two confirmed "end session" affordances) and `main.ts:1422-1450` `endSession()` itself must keep working **exactly** as they do, including the host's `DELETE /rooms/{roomId}` and the `session-end` broadcast (`main.ts:1439-1441`). **AC5's anti-lobotomy control is that arm.** A repair that makes the user unable to end a session has replaced one defect with a worse one.
  - **⚠ WP80's `cleanupStaleFiles`, `files/manifest.ts`, `plugin/src/__tests__/dataloss/**`.** Byte-unchanged. `manifest.ts` is additionally WP86's subject.
  - **⚠ `useCanvasBinding`, `canvas-binding.ts`, `canvas-model-bridge.ts`, `canvas-presence.ts`.** Frozen; flipping the flag or editing those files is a §7 abort criterion.
  - **⚠ `canvas.simulateEdit`.** Not used, not extended, not repaired. Its shape — a side effect (`testing/e2e-control.ts:995-1005`) plus a hardcoded `applied: true` (`:1023`) — is **explicitly forbidden** for anything this WP adds.
  - **⚠ `canvas.open`.** Not called by any criterion (**S45**). WP88 has no canvas subject, and the prohibition is stated so no scenario reaches for it out of habit.
  - **⚠ `plugin/manifest.json`** — a broken symlink to another machine (**S23**). Not read, not edited, not repaired.
  - **⚠ Any new runtime dependency.** D11 — an ESCALATE.
- **Known interfaces / dependencies:**
  - Input: WP82's `PeerLinkFacts` / `SharingVerdict` (`sync/link-state.ts`), the two retry chains' `gave-up` lifecycle events (`sync/control-ws.ts:225-240`, `:307-318`; `sync/sync.ts:593-604`), `SessionManager.isActive` (`session/session.ts:142`), the settings object
  - Output: the derived route census; a severed destructive act; a re-arm affordance; **at most two additive** E2E surfaces — one read-only extension of the landed `link.report`, and one re-arm trigger if AC4 cannot be satisfied through the existing `link.restore`
  - **Blocks nothing, and it unblocks the rig:** with it, a retry ceiling becomes a state a live scenario may enter and leave, which C82 AC5 could not.

### Ordering — what must NOT be batched together

Measured at charter time (`git status`, `386e595`), and stated as a measurement, not a timeless fact (rule 5):

1. **`plugin/src/main.ts` is contended by nearly everything.** WP80, WP82, WP85, WP86 and now **WP87** all edit it, and WP85's charter already forbids batching three of them together. **WP88 edits `main.ts`'s session-lifecycle region and must not be in flight with any other WP that edits `main.ts`.** Rule 14 makes region-disjointness insufficient: a sibling reverted a shared path between WP81's edit and its stage (**S34**) and it was caught **only** by re-reading `git status` immediately before the commit.
2. **WP87 and WP88 share no file except `main.ts`.** WP87's surface is `canvas/**` plus `main.ts`'s reconcile region; WP88's is `sync/**` plus `session/session.ts` plus `main.ts`'s session region. **They may not be batched together, and that is the only relation between them.** Neither depends on the other and either order is correct.
3. **B32 is live in the test tree and in one production file.** At `386e595` the working tree carries modifications to `plugin/src/files/canvas-sync.ts` and to seven test files under `plugin/src/__tests__/` (`canvas-persistence.test.ts`, `v2/wp21/**`, `v2/wp4/**`, `v2/wp5v2/**`, `v2/wp6/**`, `w4-canvas-integrity.test.ts`), plus the untracked `plugin/src/__tests__/harness/collab-text.ts`. **None of those is WP88's** and the footprint was observed to grow during this charter's own authoring, so the implementor re-measures rather than trusting this list. WP88 touches no canvas file.
4. **`plugin/src/testing/e2e-control.ts` is contended by WP37, WP38, WP80, WP81 and WP82.** WP88's additions are **additive and optional on the host interface**, and any new module they need is reached by **dynamic `import()`** on WP37's landed precedent — never by amending the frozen import allow-list, and **never mentioned in a comment**, because the allow-list regex reads comments and has already reddened three tests that way.

### §7 disposition — no `DONE` work package is re-opened, and no §7 licence of any class is taken

1. **WP82 is CONSUMED, not re-opened.** C82 §2 states in its own words that *"choosing when to give up is a product decision with no measurement behind it today and is not made here"*, and C82 AC5's declared deliverable is that the **end of a chain is observable**, not that it ends the session. WP88 takes precisely the work C82 named as not its own. The definer, the `link.report` fields, the break seam and the once-then-count announcement discipline are **reused verbatim** (rule 10).
2. **No inherited assertion pins the destruction, and this was measured rather than assumed.** Pattern `endSession`, `grep -rn` over `plugin/src/__tests__/`: **1 file, 1 line** — `wp82/test_ac1_connected_marking_is_role_independent_visible.test.ts:109`, and it is `async endSession() {}`, a **no-op stub on a fake plugin**, not an assertion. **Positive control:** the same pattern over `plugin/src/main.ts` matches **8** known-present production lines (`:1306`, `:1422`, `:1447`, `:1468`, `:1535`, `:1542`, `:2645`, `:2657`), so the detector is proven able to find what it is looking for. **Therefore no §7 licence of any class is required.** If an assertion does redden, that is an **ESCALATE with the measured before/after, left red** — not a rewrite.
3. **WP46 is protected rather than amended.** The legacy quartet stays byte-unchanged; every new `session.info` / `link.report` field is **optional on `E2EControlHost`**, or roughly two dozen fake hosts across `__tests__/wp46/**`, `__tests__/wp47/**`, `__tests__/wp49/**`, `__tests__/t3/wp44/**` and `__tests__/e2e/two-host-harness.ts` stop compiling and `npm run build` breaks repo-wide.
4. **`main.ts` gains wiring and a verdict read only.** §3.1 S11 and the §7 abort criterion are absolute: no decision about what a ceiling means is written in `main.ts`. The decision is `sync/link-state.ts`'s, which already computes it.
5. **`session/session.ts` is modified only to the extent that a route no longer reaches it.** `endSession()`'s **body** — the host `DELETE`, the six clears, the persist — is preserved for the user-initiated path. **Making `endSession` conditional on why it was called would put the decision inside the destructive function**, which is the shape that made this defect invisible: the same call answers *"I chose to leave"* and *"my Wi-Fi died"*. The severing happens at the **caller**, and the report states so explicitly.
6. **If a type is added to `types.ts` it goes at the TOP**, beside `StaleReconcileDecision` — the WP22 dormancy-test comment-strip trap. Inherited verbatim from WP80, WP81, WP82 and WP85.

---

## 3. Architecture Context

*Task-local architecture guidance only.*

### Verified against the current tree (rule 12), 2026-08-05, branch `fix-bugs-and-raceconditions` at `386e595` — measured, given, do not re-derive

**Verification 1 — the destructive act, in one place, key by key. No value was read.**

`SessionManager.endSession()` — `plugin/src/session/session.ts:113-141`:

| line | what it does |
|---|---|
| `:116` | `if (settings.role === "host" && settings.roomId && settings.token)` — **the host arm** |
| `:117-133` | `DELETE {serverUrl}/rooms/{roomId}` with an `Authorization: Bearer` header, `throw: false`, wrapped in a `try` whose `catch` is a comment (*"Best-effort cleanup, server may already be gone"*) |
| `:134` | `settings.roomId = ""` |
| `:135` | `settings.token = ""` |
| `:136` | `settings.encryptionPassphrase = ""` |
| `:137` | `settings.encryptionSalt = ""` |
| `:138` | `settings.role = null` |
| `:139` | `settings.permission = "read-write"` |
| `:140` | `await this.plugin.saveSettings()` — **persisted to `data.json`** |

**Three corrections to the carried-up account, all measured:**

- **It is six keys, not three.** `encryptionPassphrase` and `encryptionSalt` are the end-to-end material. A fresh invite does **not** restore them: `joinSession` reads only `parsedInvite.r` and `parsedInvite.t` into `roomId` and `token` (`session.ts:102-103`), and the passphrase is entered out of band. So for an encrypted room the recovery story is not *"paste a new invite"*, it is *"obtain the passphrase again from whoever has it"* — **stated as traced from the code, not measured on a populated room**: on the two owner vaults both keys are empty (`DISPATCHER_STATE.md`'s identity-key table, measured by hash, values never read), so today the clear is observationally a no-op **here**.
- **On a host it is not a local act.** The `DELETE` runs **before** anything is cleared and it takes the room away from **every** participant, including the ones whose network is fine. It is irreversible from the client. **A host closing a laptop lid for two minutes is sufficient** — the same reachability argument C82 made for the latch, and the relay's own auto-election means the host role moves around freely (**S37**: 34 role transitions on one vault in 2 h 05 min).
- **The `catch` at `:130-132` swallows the DELETE's failure.** That is not repaired here and is not a defect of this WP's shape — but it means a host that *did* reach the relay and a host that did not are indistinguishable afterwards, and the report should not claim otherwise.

**Verification 2 — the census: five routes from a connectivity failure to that function, and one of them has no ceiling.**

| # | Route | Chain | Time to fire |
|---|---|---|---|
| **E1** | control retry **exhausted**, `everConnected === true` | `control-ws.ts:308-318` → `stateChangeCallback("disconnected")` → `main.ts:1538-1543` → `this.endSession()` | 10 attempts, 300 ms base ×2 capped 30 s ⇒ **≈128 100 ms** |
| **E2** | control retry **exhausted**, `everConnected === false` (**first connect**) | same site, `:318` selects `"auth-required"` → `main.ts:1530-1536` → `Notice("Live Share: authentication required - sign in via settings")` → `this.endSession()` | same ≈128 s — **this is S39** |
| **E3** | `new WebSocket(url)` **throws inside a reconnect timer** | `control-ws.ts:223-240`, `gave-up` with `cause: "socket-construction-threw"` → `:238` same two branches | immediate |
| **E4** | mux retry **exhausted** | `sync.ts:593-604` → `onMaxReconnectCallback` → `main.ts:1465-1469` → `Notice("Live Share: sync connection lost, ending session")` → `this.endSession()` | 15 attempts, 100 ms base ×2 capped 30 s |
| **E5** | **plugin-load resume throws — any reason** | `main.ts:1110-1112`, a bare `catch` around the whole resume → `abortSession(...)` → `main.ts:1299-1308` → `sessionManager.endSession()` | **no ceiling at all** |
| **U1/U2** | the **user** ends the session | `main.ts:2645`, `:2657` → `main.ts:1422-1450` → `sessionManager.endSession()` | on demand — **legitimate, and AC5's control** |

`abortSession` has three further callers (`main.ts:1337`, `:1377`, `:1414` — start/join failures) which are **not** connectivity give-ups and are **not** WP88's subject; they are recorded so the census can be shown complete rather than convenient.

**E5 is the one the carried-up account did not contain, and it is the sharpest.** A `catch {}` around the entire resume — which includes `cleanupStaleFiles`, `syncFromManifest`, `backgroundSync.startAll` and the canvas mirror pass — routes **any** throw at plugin load to the destruction of the session identity, on a host including the room `DELETE`. That is not a retry ceiling; it is an unclassified exception treated as a decision to leave.

**Verification 3 — WP82 already computes the right state and nothing consults it.**

`sync/link-state.ts:145` declares `SharingState = "no-session" | "connecting" | "retrying" | "gave-up" | "connected"`, and `decideSharing` (`:172`) resolves `"gave-up"` at `:186`. `linkReport()` (`main.ts:351-388`) already returns `state`, `sharing`, `roleBacked`, `retryChainEnded` per link, `offlineQueueDepth`, `fileOpsOnline` and the live `statusBarText`. **The plugin therefore already knows, in one pure module, that a chain has ended — and the five routes above destroy the session without asking it.** That is the whole shape of the repair: not new knowledge, a missing consultation. C82's own §2 note applies verbatim — *"two independent checks at N call sites is how this defect got its second half"*.

**Verification 4 — what the `"gave-up"` state must be able to do, and why retention alone is not enough.**

Retaining the six keys is necessary and insufficient: a peer sitting at `shouldConnect = false` with `retryChainEnded = true` has **no edge that can re-arm it**. `control-ws.ts` sets `shouldConnect = false` at `:225`, `:309` and `:379`, and the only thing that clears `retryChainEnded` is a successful `onopen` (`:246`). WP82 landed `restoreLink()` for the rig, and its own comment records the constraint that matters here — it *"re-arms a retry chain that has ended, **WITHOUT** touching `everConnected` (resetting it is S39, which routes a network outage to `auth-required`)"* (`control-ws.ts:142-143`). **So a re-arm affordance exists in `testing/` and there is none for the user.** AC3 requires one that is reachable from the product, not only from the rig.

- **Component(s) being changed:** `plugin/src/main.ts` (**wiring and a verdict read only** — the five call sites stop reaching the destructive function), `plugin/src/sync/link-state.ts` (**at most** the terminal-state's consumers; the state itself already exists), `plugin/src/sync/control-ws.ts` and `plugin/src/sync/sync.ts` (the re-arm affordance's production entry, if the repair needs one), `plugin/src/session/session.ts` (**only if** a non-destructive `leaveWithoutForgetting` seam is required — `endSession`'s body is preserved for the user path), `plugin/src/ui/settings.ts` and/or the status surface (the affordance and its German string), `plugin/src/testing/e2e-control.ts` (**additive, optional**).
- **Constraints from BUILD_SPEC (invariants — what must not change):**
  - **I11 is the governing invariant:** a refusal never destroys. *"I cannot reach the relay"* is a refusal by the network and must not be converted into a destructive act by the client.
  - **I5:** degradation is per-surface and honest, never a feature break. `"gave-up"` is a degraded state that says what it is; it is not a silent half-session.
  - **One definer.** `sync/link-state.ts` decides; `main.ts` reads and forwards.
  - **`session.info`'s legacy quartet is byte-unchanged.** New fields are additive and **optional on `E2EControlHost`**.
  - **Announce once, then count.** The landed WP82 discipline (`announcementKey` `:266`, `nextAnnouncement` `:299`): one `Notice`, subsequent occurrences counted not repeated, recovery re-arms. A toast per retry at 300 ms base backoff is a worse defect than the silence.
  - **`enabled === false` is not a failure**, and the five states must not collapse into two — WP82's constraint, inherited.
  - **No secret reaches any log, response, report, fixture or commit message.** The socket URLs carry `token`, `jwt` and `password` as query parameters (`control-ws.ts:74-77`-region, `sync/sync.ts` connect region). **A link is identified by name (`control` / `mux`), never by URL. Keys may be named; values may not — and this WP's subject IS those keys, so the discipline is absolute:** an assertion about `roomId` is an assertion about **presence, length or a sha256 prefix**, never about content.
  - **Zero new runtime dependencies** (D11). New user-visible strings are **German** (§1). Log signatures are uppercase ASCII machine contracts — **no existing signature, category, level or volume changes**; a new one is declared in §10.
  - No wall-clock sleeps in headless tests: backoff, ping and pong deadlines are asserted with **fake timers**.
  - Biome reports a whole-file `format` finding per touched file (CRLF artefact). Advisory locally, gating in CI — do not mass-reformat.
- **Entry points / relevant files:**
  - `plugin/src/session/session.ts` — `endSession` `:113-141` (the host `DELETE` `:116-133`, the six clears `:134-139`, the persist `:140`), `startSession`'s writes `:56-58`, `joinSession`'s writes `:102-107`, `isActive` `:142-144`
  - `plugin/src/main.ts` — the resume `catch` `:1110-1112`, `abortSession` `:1299-1308`, `endSession` `:1422-1450`, the mux give-up `:1465-1469`, the control-state callback's four branches `:1500-1545` (`auth-required` `:1530-1536`, terminal `:1538-1543`), `linkReport()` `:351-388`, `peerLinkFacts()` `:322-332`, `getSharingVerdict()` `:337-340`, the two user affordances `:2645`, `:2657`
  - `plugin/src/sync/control-ws.ts` — constants `:17-19`, `everConnected` `:32`/`:192`/`:245`, the construction throw `:223-240`, `onclose` `:295-303`, `scheduleReconnect` `:307-330`, the restore comment `:142-143`, `shouldConnect = false` `:225`/`:309`/`:379`
  - `plugin/src/sync/sync.ts` — constants `:35-37`, `scheduleReconnect` / give-up `:593-612`
  - `plugin/src/sync/link-state.ts` — `SharingState` `:145`, `decideSharing` `:172-` (`"gave-up"` at `:186`), `sharingStatusText` `:229`, `sharingNoticeText` `:249`, `announcementKey` `:266`, `nextAnnouncement` `:299`, `LinkLifecycleEvent` `:332-337`, `describeLifecycle` `:357`
  - `plugin/src/sync/offline-queue.ts` — the whole file (64 lines); `enqueue` `:13`, depth `:54`, `isEmpty` `:58`
  - `plugin/src/files/file-ops.ts` — `isOnline`, `setOnline`, `emitOp`'s enqueue branch
  - `plugin/src/testing/e2e-control.ts` — `link.report` `:816-821`, `link.break` `:828-841`, `link.restore` `:842-850`, `session.info` `:639`, the `E2EControlHost` optional-field precedent `:346-349`, the anti-pattern `simulateEdit` `:995-1023`
  - Read-only context: `plugin/src/__tests__/wp82/**`, `plugin/src/__tests__/wp46/test_legacy_fields_unchanged_visible.test.ts`, `server/src/control-handler.ts` (**READ-ONLY, not edited**)
- **Files this WP may NOT touch:** everything under `server/`, `plugin/src/canvas/**`, `plugin/src/files/canvas-*.ts`, `plugin/src/files/manifest.ts`, `plugin/src/main.ts`'s `cleanupStaleFiles`, `plugin/src/__tests__/dataloss/**`, `plugin/src/__tests__/v2/wp23/**`, `plugin/src/__tests__/harness/**`, the `DEFAULT_SETTINGS` block of `plugin/src/types.ts`, and `plugin/manifest.json`. **If the repair appears to require reaching into any of these, that is an ESCALATE, not a judgement call.**
- **Structure references:** *(intentionally empty — no Graphify graph exists for this project; FALLBACK mode is declared in BUILD_SPEC §3. Worker 3 fills this in after implementation. Do not invent paths here.)*

If structure references conflict with the BUILD_SPEC or explicit task scope, the BUILD_SPEC and TaskCharter win. Escalate instead of following the map.

### THE RULING — what a client should do when it cannot reach the relay for two minutes

**Stop transmitting. Say so, once. Keep the identity. Offer a way back.** Four parts, and each is a decision with a reason rather than a preference:

1. **Stop transmitting — yes.** The retry chain ending is correct behaviour. Retrying a dead endpoint forever costs battery, hides the failure behind motion, and is what the ceiling exists to prevent. **WP88 does not move the ceiling** and takes no position on whether 10 attempts is the right number.
2. **Say so, once — already built, not consulted.** `decideSharing` computes `"gave-up"`; `sharingNoticeText`/`announcementKey`/`nextAnnouncement` carry the once-then-count discipline; `linkReport` exposes it. The user learns their peer has stopped sharing **without also learning that their session has been deleted.**
3. **Keep the identity — this is the change.** `roomId`, `token`, `encryptionPassphrase`, `encryptionSalt`, `role` and `permission` are **retained**. The argument, stated so it can be attacked:
   - **Discarding them is not a safety measure.** It protects nothing. A stale `roomId` on a client that is not connected is inert; the relay is authoritative about whether the room still exists and answers that question at the next join.
   - **It is an information-destroying act taken on an absence of information.** The client does not know the room is gone. It knows it could not reach the relay. **Those are different facts and the code renders the second as the first** — D2's shape, I11's prohibition, and the third instance of this exact class in this run.
   - **It is asymmetric in cost.** Retaining credentials that turn out to be stale costs one failed join and a clear error. Discarding credentials that were fine costs a fresh invite for every peer, out-of-band passphrase recovery for an encrypted room, and — on a host — a room that no longer exists for anybody.
   - **The host arm converts one peer's network fault into everyone's data loss.** That alone decides it. A client may not take an action whose blast radius is the whole session on evidence that is local, negative and momentary.
4. **Offer a way back — required, because retention without a re-arm is a worse state than today's.** A peer that keeps its credentials and can never use them again has a session that looks alive and is not — **which is WP82's defect, re-created by WP88's repair**, and the reason AC3 and AC4 are paired. The affordance is explicit (a command or a settings action), reachable by the user, and it re-arms the chain **without** resetting `everConnected` (`control-ws.ts:142-143`, and see S39 below).

**And the corollary, which is the standing principle transposed:** *a swallowed failure may drop data but may not drop the fact that it dropped data* → **a client may lose the connection; it may not lose the session identity.** Losing the link is a fact about the world. Losing `roomId` is a claim about the world that the client is not entitled to make.

### Disposition — S39 (a first-connect outage reported as an authentication failure)

**IN SCOPE, both halves, with the live row explicitly declined and the reason stated.** The reasoning, since C82 deliberately left it for its own disposition:

- **The destructive half is the same call at the same ceiling.** E2 is E1 with `everConnected === false` — one selector at `control-ws.ts:238` / `:300` / `:318` choosing between two branches that **both** call `endSession()`. **Repairing E1 and not E2 would leave a network outage still clearing credentials on the first-connect path**, which is a repair of one arm of a two-arm branch and would be indistinguishable from an oversight. It is not annexation; it is the same defect.
- **The mislabelling half is also in, and it is not cosmetic after the repair — it is actively misleading.** `main.ts:1533` tells the user *"authentication required - sign in via settings"*. After WP88 the credentials are **still present and still valid**, so the message instructs the user to fix something that is not broken, for a session that has not ended. The two conditions must be told apart: **"the relay rejected these credentials"** (a server answer) and **"the relay was never reached"** (no answer at all). That distinction is the same one this whole run keeps making.
- **The live row is DECLINED, with its reason, not skipped.** The rig cannot manufacture the state: `restoreLink()` **deliberately** does not reset `everConnected` (`control-ws.ts:142-143`, in the code's own words), and a live instance has by definition already connected once. Reaching it would require either editing `data.json` (live credentials — forbidden outright) or a cold start against an unreachable relay, which needs an OS-level network change on the owner's machine that would break the sibling agent's instances. **Headless rows carry it, and the report says so plainly.** WP81's M3 precedent: name it, do not imply a criterion covered it.

### Disposition — S40 (the unbounded `OfflineQueue`)

**PARTIALLY IN, and the part that is in exists because WP88 creates it.** The reasoning:

- **C82's ruling stands: a cap is a data-retention decision and does not belong inside another WP.** WP88 does **not** introduce a cap constant and does **not** decide what to discard. That question stays unowned.
- **But WP88 removes the bound that currently exists, and it must not do so silently.** Today the offline queue is bounded by the fact that **the session is destroyed ~128 s after the link dies** — an accidental, destructive bound, but a bound. After WP88 a peer can sit in `"gave-up"` indefinitely with `FileOpsManager.isOnline === false`, enqueuing every file operation into an uncapped `OfflineQueue` (`sync/offline-queue.ts`, 64 lines, no cap, no eviction). **A repair that removes a bound without replacing it is a data-retention defect introduced by this WP**, and hiding it behind C82's ruling would be exactly the move C82 refused.
- **The structural answer, which needs no constant and no policy: stop accepting.** Once the chain that carries file operations has ended (`retryChainEnded === true`, already computed), a peer **knows** it will not send these ops. Continuing to enqueue them is the same lie the status bar told before WP82. So: **enqueuing stops at the ceiling, the refusals are counted and reported, and the transition is announced once.** Nothing already queued is discarded — no retention decision is taken — and the growth term is bounded by the ceiling rather than by a magic number. **This is a bound by construction, in the shape the run has now accepted three times** (`Secret`, the required `runner`, the `Map`-keyed deferral queue): *a structural property beats a constant that the next edit outgrows.*
- **The residue, named and left unowned:** what should happen to the ops **already** queued when a peer re-arms and reconnects hours later, and whether an eviction policy is ever wanted, are still S40 and still nobody's.

---

## 4. Acceptance Criteria

*Each criterion names **the observable that proves it** and **what would make it vacuous**.*

*Acceptance evidence is **two LIVE Obsidian instances** driven through the E2E rig — `POST http://127.0.0.1:39431/command` (vault A) / `:39432` (vault B) — **except where a live row would destroy the owner's session, which is the whole difficulty of this WP and is decided per row below rather than left to the implementor.** **Blind sets are discontinued** — no `blind_set1`, no `blind_set2`, no falsification injection and no `BlindVerificationLedger` row is owed. **Every live row records the role its instance actually resumed as, quoted from its own `[session] resuming as …` line** (S37). **No `data.json` value is read, printed, logged, hashed into a report or fixtured; assertions about credential keys are about presence, length or a sha256 prefix, never content.** `canvas.simulateEdit` and `canvas.open` are never called.*

1. **The route census is DERIVED FROM THE TREE, and it finds the route that has no ceiling.**
   - **Deliverable:** a test that enumerates, from the parsed tree rather than from a hand-written list, every production path that reaches `SessionManager.endSession` — **including transitively**, so `abortSession` (`main.ts:1299-1308`) is found rather than missed — and classifies each as *connectivity-driven* (E1–E5) or *user-initiated* (U1/U2). The set is pinned; a new member cannot join it unnoticed.
   - **Observable (headless, structural):** the derived set contains **all seven** rows of §3 Verification 2 with their sites, and each connectivity row is shown to reach the destructive function **before** the repair and not after. **A mandatory reverse assertion:** the deriver, run against a module with no such path, finds nothing — and, run against the real tree, finds a member known to exist.
   - **Observable (rule 15, both directions):** the claim *"no inherited test pins the destruction"* is restated with its pattern, its tool and its positive control. The charter's own measurement is the baseline: `grep -rn "endSession"` over `plugin/src/__tests__/` gives **1 file, 1 line**, and it is a **no-op stub** (`wp82/test_ac1_…:109`), against **8** production matches in `main.ts` as the positive control. The report states which tool it used; **`grep -F` for literals, and `grep -o` is forbidden** — its `.` wildcard produced two false hits in this run.
   - **Vacuity risk — named:** **S53, the recursive one** — WP86's census deriver returned an **empty** set and *"every derived site is classified"* passed perfectly on it. The reverse assertion is the only defence and may not be trimmed. Second: enumerating the literal string `endSession` and stopping there, which finds six of seven and **misses E5 entirely**, because E5 reaches it through `abortSession` one hop away — the census must be **reachability**, not text. Third: a hand-written list dressed as a derivation, which cannot catch the route the next work package adds.

2. **The destruction is measured key by key at the seam — with sentinels, never with a live vault.**
   - **Deliverable:** a headless row at `SessionManager.endSession` with an injected settings object carrying **synthetic sentinel values** and an injected `requestUrl` double.
   - **Observable (headless):** the six keys are named and shown cleared — `roomId`, `token`, `encryptionPassphrase`, `encryptionSalt`, `role`, `permission` (`session.ts:134-139`) — **and `saveSettings` is shown to have been called**, so the clear is shown to be *persisted* and not merely in-memory. Separately, the **host arm** is shown to issue `DELETE {serverUrl}/rooms/{roomId}` (`:117-133`) and the **guest arm** is shown **not** to. Each of these rows is shown **red against the repaired build for the connectivity routes and green for the user route** — that is the whole point of the pairing.
   - **This AC never runs against a live vault, and that is a criterion, not a convenience.** No `data.json` is opened, read, copied for inspection or hashed for a report. Sentinels only.
   - **Vacuity risk — named:** asserting the fields are cleared without asserting the persist — an in-memory clear that never reaches disk is a different defect and would recover on restart. Second: asserting the DELETE without a guest-arm control, which cannot distinguish *"the host deletes the room"* from *"everybody does"*. Third: reaching for the real `data.json` to "check" — **forbidden outright**; the seam takes an injected object precisely so it never has to.

3. **The end of a retry chain produces the definer's `"gave-up"` state, retains all six keys, and is re-armable — asserted at every route in the census.**
   - **Deliverable:** each of **E1, E2, E3, E4 and E5** stops reaching the destructive function. The state entered is `sync/link-state.ts`'s existing `"gave-up"` (`:145`, `:186`) — **not a new one** (rule 10). A **user-reachable re-arm affordance** exists, reachable from the product and not only from `testing/`, which re-arms the chain **without** resetting `everConnected` (`control-ws.ts:142-143`).
   - **Observable (headless, fake timers, injected sockets):** driving each route past its trigger leaves **all six settings keys byte-unchanged** and `saveSettings` **not called for them**; `linkReport()` then returns `state: "gave-up"`, `retryChainEnded: true` for the ended link and `false` for the other, `sessionActive: true`, `roleBacked: false`, and `sharing: false`. The announcement fires **once** and subsequent occurrences **count** without a second `Notice` (WP82's landed discipline, reused). The re-arm is then driven and the chain is shown to reconnect, with the announcement **re-arming**.
   - **Observable (headless, E5 specifically):** a throw injected into the plugin-load resume leaves the six keys intact — the route with no ceiling is asserted in its own row, because it is the one the carried-up account did not contain.
   - **Vacuity risk — named:** retaining the keys and leaving the peer unable to ever use them — **that is WP82's defect re-created by this repair**, a session that reports itself alive with no edge that can restore it, and it is why the re-arm is in the same criterion rather than a later one. Second: asserting `sessionActive: true` without asserting that anything can act on it. Third: introducing a **sixth** sharing state or a parallel "severed" flag beside `"gave-up"` — the AC is satisfied only if the state is the definer's, asserted structurally (one `SharingState` union, its call sites enumerated), not by reading agreeing values in one lucky state. Fourth: asserting on the *count* of `Notice` calls alone, which passes on a build that announces nothing — it is paired with the counter that must have advanced.

4. **Recovery without a fresh invite, demonstrated LIVE — on the guest peer only, on the repaired build, behind a restore path that has been exercised before the row is armed.**
   - **This is the headline constraint of the WP and the protocol is specified here rather than left to the implementor, because WP82 declined this exact row and its reason has not gone away.** Five conditions, all mandatory, in this order:
     1. **The row runs on the peer that resumed as GUEST**, recorded from its own `[session] resuming as …` line. **The host arm is FORBIDDEN live**, because `session.ts:116-133` issues `DELETE {serverUrl}/rooms/{roomId}`, which destroys the room for the other peer, is irreversible from the client, and cannot be undone by anything in scope (`server/**` is a §7 abort criterion). If the election leaves both peers claiming host, the row **SKIPs with that reason recorded** — WP82's landed guard shape.
     2. **A byte-exact backup of both vaults' `data.json` is taken first**, by **file copy** through the existing `H:\tmp\liveshare_smoke_setup.py` backup mechanism. **No value is read, printed or inspected**; verification is sha256-of-bytes only. A copy is not a read.
     3. **The restore is executed once, as a drill, and verified — before the destructive row is armed.** A backup that has never been restored is a claim, not a way back. The drill's verification is the digest comparison plus `session.info` reporting the same `role` and `roomIdPresent: true` afterwards.
     4. **The row runs on the REPAIRED bundle only.** The unrepaired (RED) counterpart is carried **headless** by AC2 and AC3. **No live vault is ever driven to a retry ceiling on a build that would destroy its session** — that is the trade WP82 could not make and this protocol is what makes it unnecessary.
     5. **The installed bytes are grepped for a marker unique to this batch's own change before the row is trusted** — a digest proves *which* build, not *whose* (**S46**, which has fired three times in this run).
   - **Observable (live, guest peer, repaired build):** `link.break{link:"control", shape:"silence"}` with the restore **withheld past the measured ceiling** (10 attempts, 300 ms base ×2 capped 30 s ⇒ ≈128 s). The ceiling is evidenced **by the peer's own report** — `link.report` showing `retryChainEnded: true` and `reconnectAttempts: 10` for the control link — **not by elapsed wall-clock time.** Then: `session.info` reports the **same `role`** and `roomIdPresent: true`; the re-arm affordance is invoked; the peer re-establishes **with no invite pasted anywhere**, evidenced by its own `[session]` line and by `link.report` returning to `sharing: true`. `link.restore` is called in a `finally`, and the run's last act re-restores every link on both vaults.
   - **Observable (off-client positive control, mandatory, inherited from C82 AC3):** the `silence` shape must leave the relay's `GET /healthz` `clients` count **unchanged** across the outage — proving the break was the half-dead shape and not a close, and proving the outage was real rather than asserted.
   - **Vacuity risk — named, and this is the row the whole WP turns on:** *"the peer recovered"* passes trivially if the ceiling was never reached. **The ceiling must be evidenced by the peer's own `retryChainEnded` / `reconnectAttempts`, never by a sleep.** Second: asserting `roomIdPresent: true` on a peer that never lost its link — the break's effect is asserted, not assumed, with its off-client control. Third: reporting a `roomId` **value**, a length that is a fingerprint, or any part of a socket URL — **absolutely forbidden**; the field is a boolean and, at most, a sha256 prefix. Fourth: running it on the host and discovering the `DELETE` empirically. Fifth: leaving a link silenced after an aborted run — `silenced` lives on the channel, not the socket, so a link silenced and then closed comes back **still silenced** (WP82's own risk note).

5. **The user can still end a session, and the host still deletes its room when the user says so.**
   - **Deliverable:** U1/U2 (`main.ts:2645`, `:2657` → `main.ts:1422-1450` → `session.ts:113-141`) behave **exactly** as before, host `DELETE` included, `session-end` broadcast included (`main.ts:1439-1441`).
   - **Observable (headless):** the user route is driven and **all six keys are cleared and persisted** and the host arm **does** issue the DELETE — the same assertions AC2 makes, with the opposite expected outcome, in the same run. **This is the anti-lobotomy control** and it is the row that distinguishes *"the give-up no longer destroys"* from *"nothing destroys any more"*.
   - **Vacuity risk — named:** asserting only the connectivity routes, which is satisfied by a build in which `endSession` no longer works at all — a lobotomy, and the failure mode the data-loss batch's own S2 control was built to catch. Second: asserting the user route only in the **guest** arm, which never issues the DELETE and so cannot show it survived.

6. **The offline queue stops growing when the chain has ended, and says so — with no cap constant and no retention policy.**
   - **Deliverable:** once the link that carries file operations has `retryChainEnded === true`, `FileOpsManager` **stops accepting** into `OfflineQueue`; the refusals are **counted** and reported beside the landed `offlineQueueDepth` in `link.report` (`main.ts:374`); the transition is announced **once** under WP82's discipline. **Nothing already queued is discarded**, no cap constant is introduced, and no eviction policy is chosen.
   - **Observable (headless):** with the chain **not** ended, a driven burst of file operations **does** enqueue and the depth advances — the mandatory positive control. With the chain ended, the depth **stops advancing** under an identical burst, the refusal count advances instead, and the previously queued entries are still present and unchanged.
   - **Vacuity risk — named:** asserting the depth stopped growing in a run where nothing was enqueued — the paired positive control is what forbids it, and it is exactly the shape of the vacuous greens this run has found eleven times. Second: introducing a cap constant and calling it the bound, which takes the retention decision C82 ruled out of scope and which the next field addition outgrows. Third: asserting the refusal count without asserting that the existing entries survived — *"stopped accepting"* and *"threw away what it had"* are different behaviours and only one of them is chartered.

**Definition of Done:** a peer whose network dies for two minutes comes back **as itself** — same room, same role, no invite, no re-typed passphrase — and a peer that was never the reason for the outage does not lose its room because someone else's laptop lid closed.

---

## 5. Constraints and Known Risks

- **Permission / environment limits:** Windows dev host. Run tests from the workspace root, never from a subdirectory; long-running invocations through `visible-console` `run_python` / `run_command` with **absolute** paths and an **explicit `session_key`**, never a Bash background process. **`run_command` without an explicit `session_key` has been answered `"reused"` against an unrelated console, after which `await_console` reported `completed / exit 0` for a run that never happened** — verify the artefact, never the exit status. **The two owner vaults, the two control ports (39431 / 39432) and `H:\tmp\liveshare_*.py` are shared with other work** — check `DISPATCHER_STATE.md` and the task registry before launching, installing, restoring or resetting anything, and never during another agent's run. **The relay is production and is shared:** `GET /healthz` is the only permitted interaction; **no room is created, deleted or mutated, and no relay process is touched.**

- **Known risks specific to this WP:**
  - **⚠ The most dangerous mistake in this WP is a live RED row.** Reproducing the destruction on a live vault is one `link.break` away and it would log a shared vault out permanently — WP82 measured that and declined. **AC2 and AC3 carry every RED row headless, and AC4's live row runs on the repaired build only, on the guest, behind a rehearsed restore.** Any deviation from that protocol is an abort criterion, not a judgement call.
  - **⚠ The second is putting the decision inside `endSession`.** *"Only clear the credentials if the user asked"* is a two-line change to the destructive function and it is wrong: it makes the function's behaviour depend on a caller-supplied intent, which is precisely the ambiguity that hid this defect — one call answering both *"I chose to leave"* and *"my Wi-Fi died"*. **Sever at the caller.**
  - **⚠ The third is a second definer.** `"gave-up"` already exists in one pure module and is already reported. A parallel `severed` boolean, or a second predicate on the plugin, is **rule 10** and an abort criterion.
  - **⚠ The fourth is retention with no way back.** A peer that keeps its credentials and can never re-arm has a session that lies about being alive — WP82's defect, rebuilt. AC3 pairs them for that reason.
  - **⚠ The fifth is moving the ceiling.** It is tempting and it is not chartered. The constants stay.
  - **⚠ The sixth is annexing S40.** A cap constant is out of scope; only the coupling WP88 itself creates is in. Read the §3 disposition before writing AC6's code.
  - **⚠ The seventh is E5.** It is easy to repair the four ceilings and miss the bare `catch` at `main.ts:1110-1112`, which reaches the same destruction with no ceiling at all and through a different function. AC1's census is reachability-based for exactly this reason.
  - **⚠ Both vaults' `data.json` hold live credentials, and this WP's subject IS those keys.** They are never printed, logged, echoed into a report, a test name, a fixture or a commit message. **Keys may be named; values may not.** Backups are file copies verified by sha256; assertions are about presence, length class or a digest prefix. **No socket URL or fragment of one may reach any artefact** — they carry `token`, `jwt` and `password` as query parameters.
  - **⚠ Do not mirror any generated test suite into `plugin/src/__tests__/` before this WP is implemented.** `tsc` typechecks `src/` including tests, so an unimplemented mirrored suite breaks `npm run build` **repo-wide**. Violated once already in this run.
  - **⚠ A digest guard proves WHICH build, not WHOSE (S46).** Grep the installed bytes for a marker unique to this batch's own change before trusting any live row.

- **Known flaky patterns:**
  - **The relay's host election is a coin flip** (S27 / S37): 34 role transitions on one vault in 2 h 05 min. **No criterion may depend on which vault is host**, every live row records the role its instance resumed as, and AC4's guest-only requirement means a run may legitimately **SKIP** — a SKIP with a recorded reason is the guard working, not a failure.
  - No wall-clock sleeps. Backoff, ping intervals, pong deadlines and the ceiling are asserted with **fake timers** headless, and by the peer's own `retryChainEnded` / `reconnectAttempts` live.
  - Do not assert on log strings as the primary oracle; state is the oracle. New signatures are declared, not improvised.
  - A test that asserts an absence — *"no second Notice"*, *"the keys were not cleared"* — is suspect by default and is paired here with the positive assertion that must have advanced.
  - **Every WP88 scenario must be idempotent** and must leave **no link silenced**: `silenced` lives on the channel, not the socket, so a silenced-then-closed link returns still silenced. `link.restore` in a `finally`, and a final re-restore of every link on both vaults.
- **External dependency risks:** none permitted (D11).
- **Hard constraints:**
  - **The census is derived from the tree by reachability, with a mandatory reverse assertion (S53) and a positive control for every absence and presence claim (rule 15 and its cousin). `grep -F` for literals; `grep -o` is forbidden.**
  - **No connectivity route reaches `SessionManager.endSession`. The user route still does, unchanged, host `DELETE` included.**
  - **The six keys — `roomId`, `token`, `encryptionPassphrase`, `encryptionSalt`, `role`, `permission` — are retained at every ceiling, and the retention is asserted through `saveSettings` not having been called for them.**
  - **One definer: `sync/link-state.ts`'s `"gave-up"`. No second state, no parallel flag (rule 10).**
  - **A user-reachable re-arm exists and does not reset `everConnected`.**
  - **S39 is repaired in both halves, its live row DECLINED with the reason recorded, and the headless rows carry it.**
  - **S40: enqueuing stops at the ceiling and is counted and announced. No cap constant, no eviction, nothing already queued discarded.**
  - **AC4's live row: GUEST only, REPAIRED build only, byte-exact `data.json` backup taken and its restore REHEARSED first, ceiling evidenced by the peer's own report, off-client positive control mandatory, `link.restore` in a `finally`.**
  - **No `data.json` value is read, printed, logged, hashed into a report or fixtured. No socket URL, or fragment of one, in any log, response, message, test name, fixture, report or commit message.**
  - **`session.info`'s quartet is byte-unchanged; new fields are additive and optional on `E2EControlHost`.**
  - **No `server/**` edit; no room created, deleted or mutated. `useCanvasBinding` is not flipped. `cleanupStaleFiles`, `files/manifest.ts`, `__tests__/dataloss/**` and every canvas file are byte-unchanged. The plugin version is not bumped. `plugin/manifest.json` is not touched.**
  - **No existing log signature, category, level or volume changes. New signatures are declared.**
  - **No `DONE` work package is re-opened; WP88 holds no §7 licence of any class.** A reddened inherited assertion — in particular in `wp46/test_legacy_fields_unchanged_visible.test.ts` or under `__tests__/wp82/` — is an **ESCALATE with the measured before/after, left red.**
  - **Not batched with WP87 or any other `main.ts` WP. `git status` re-read immediately before every commit (rule 14). No `git checkout --`, `git restore` or `git stash` on any path this batch did not create.**

### Recorded, not repaired — this WP's own sweep

- **The `DELETE /rooms/{roomId}` failure is swallowed** (`session/session.ts:130-132`, a `catch` whose body is a comment). After the user ends a session, a host that reached the relay and a host that did not are indistinguishable. **Same class as WP81's swallowed `.catch(() => {})` on a persistent sink** — it may fail; it may not fail silently. **Not repaired here** (the user path's body is deliberately preserved byte-for-byte) and **unowned**. Allocate a signal.
- **`abortSession`'s three non-connectivity callers** (`main.ts:1337`, `:1377`, `:1414` — start and join failures) also destroy the six keys on a failure. For `startSession` and `joinSession` there may be nothing to retain, which is why they are **not** WP88's subject — but the shape is the same and nobody has decided it. **Recorded, unowned.**
- **`encryptionPassphrase` / `encryptionSalt` are not recoverable from an invite** (`session.ts:102-103` reads only `r` and `t`). Traced, **not measured on a populated room** — both keys are empty on the two owner vaults. If the product ever ships passphrase-encrypted rooms, this is the difference between "re-join" and "phone a colleague". **Recorded so the next reader does not have to re-derive it.**
- **`shouldConnect = false` is set at three sites** (`control-ws.ts:225`, `:309`, `:379`) and cleared by nothing but a fresh `connect()`. AC3's re-arm must reach all three states or it will work for the ceiling and not for the construction throw. **Named here rather than discovered at implementation time.**

---

## 6. Definition of Done Artifacts

- **Required changed files:**
  - `plugin/src/main.ts` — **wiring and a verdict read only**: the five connectivity call sites stop reaching the destructive function
  - `plugin/src/sync/link-state.ts` — **at most** the terminal state's consumers; `SharingState` already carries `"gave-up"`
  - `plugin/src/sync/control-ws.ts` and/or `plugin/src/sync/sync.ts` — the production re-arm entry, if one is needed
  - `plugin/src/session/session.ts` — **only if** a non-destructive leave seam is required; `endSession`'s body is preserved for the user path
  - `plugin/src/files/file-ops.ts` and/or `plugin/src/sync/offline-queue.ts` — AC6's stop-accepting boundary and its counter
  - the status surface / `plugin/src/ui/settings.ts` — the re-arm affordance and its German string
  - `plugin/src/testing/e2e-control.ts` — additive, optional host methods only
- **Already landed by Worker 2 with this charter — NOT implementor work:** the §9 WP88 row and the §7 / header counts (85 → 87 live, entered together with WP87), re-derived from §7 and §9 rather than edited independently. **The implementor does not edit `BUILD_SPEC_CanvasV2.md`.**
- **Required report:** `ImplementationReport_WP88.md` (in `workflowArtifacts/canvas-v2/`), which must additionally record: at the top, the **corrected account** — six keys not three, the host `DELETE` that destroys the room for every peer, and E5's no-ceiling route — with what was measured for each; **AC1's derived census** with all seven rows, its reverse assertion, its patterns, the tool used for each and the positive control for every absence and presence claim; **AC2's key-by-key seam measurement with sentinels**, the persist shown, the host/guest DELETE control, and an explicit statement that **no `data.json` was opened**; **AC3's five routes** each driven and each shown to retain all six keys, with `linkReport()`'s `state` / `retryChainEnded` / `sessionActive` / `roleBacked` / `sharing` quoted, the once-then-count counters, the re-arm and the re-armed announcement, and E5 in its own row; **AC4's live protocol in full** — the role each instance resumed as, that the row ran on the **guest**, the backup taken and its **restore drill executed and verified before the row was armed**, the marker grepped from the installed bytes (S46), the ceiling evidenced by `retryChainEnded: true` / `reconnectAttempts: 10` rather than by elapsed time, the relay `clients` count unchanged across the `silence` (the off-client control), the recovery **with no invite**, and the confirmation that no link was left silenced; **AC5's anti-lobotomy control** showing the user route still clears and still deletes; **AC6's paired burst** with the depth advancing on a live chain and not on an ended one, the refusal count, and the queued entries shown intact; the **explicit disposition of S39** — both halves repaired, live row **declined with its reason** (`restoreLink()` does not reset `everConnected`, `control-ws.ts:142-143`) — and of **S40** (structurally bounded, no cap, residue named); a positive statement that **`session.info`'s quartet is byte-unchanged** and `wp46/test_legacy_fields_unchanged_visible.test.ts` was not modified; that **no existing log signature, category, level or volume changed**; that no room was created, deleted or mutated and the relay was contacted only by `GET /healthz`; that **no `data.json` value and no socket URL or fragment of one** reached any artefact; the **executed test count** before and after with every failure attributed by owner (**the 13 WP36-superseded red assertions are B32's, not this WP's**); and the statement that no existing test was deleted, weakened, retitled, skipped or amended and that **no §7 licence of any class was taken**.
- **BUILD_SPEC updates required:** no — the §9 row and the counts were entered when this charter was written. Anything further is an **ESCALATE** rather than a spec edit.
- **Gate status required at handover:** `npm run build` (tsc + esbuild) PASS and `npm test` from `plugin/` with the executed count recorded and every failure attributed. `npm run lint` advisory locally, gating in CI — do not mass-reformat. **The canvas E2E baseline is NOT 19/19 and is not to be claimed as one** (WP85 established that the figure quoted all week was measuring the rig); whatever it reads is recorded as a measurement.

---

## 7. Visible Test Cases / Producer Artifacts

*Filled by Worker 3. Worker 2 leaves this section empty.*

*⚠ **Blind sets are discontinued for new work** (owner's instruction, 2026-08-05): no `blind_set1`, no `blind_set2`, no falsification-injection requirement and no `BlindVerificationLedger` row is owed by this WP. Validation is W4 against two live Obsidian instances **within the protocol AC4 specifies**, with headless tests carrying every row a live instance must not be abused to produce. E2E-plugin defects found while validating go back to **W3 as a revision**.*

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
