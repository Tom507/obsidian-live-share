# Worker 3 Handover — Canvas V2, Batch 8 / Phase P6

**Run:** batch 8 of 8, executed in parallel with the plugin batches.
**narrow_scope:** WP41, WP42 only. WP1–WP40 untouched by this run.
**Server gate (authoritative for this batch):** `npm run build` PASS · `npm test` **18 files / 149 tests / 0 failed**
(baseline 122 tests / 10 files + the 27 staged WP41 visible tests; **no pre-existing test deleted or weakened**).
**Plugin suite deliberately NOT run** — a concurrent batch is mutating `plugin/src/**`, so its result would be meaningless.

---

## Scope of This Run

- Tasks completed: **WP41, WP42** — both `DONE` on attempt 1 of 3.
- Tasks with risk flags: **none**.
- Escalations raised: **none**. Both Unit Test Sub-Agents ran the mandatory spec-contradiction check and cleared it.
- Attempts consumed: WP41 = 1/3, WP42 = 1/3. No retry, no tool request, no `TOOL_REQUEST`.

---

## Risk Summary

*(Worker 4 reads this table first — per-task detail below is only needed for HIGH-risk WPs)*

| WP | Status | risk_flag | W4 Test Targets | Priority for W4 |
|---|---|---|---|---|
| WP41 | DONE | NONE | 3 | NORMAL |
| WP42 | DONE | NONE | 2 | NORMAL |

Both WPs are NORMAL priority. The residual risk is **not** in the pure cores (which are heavily covered);
it is concentrated in the five `7b` wiring seams listed below, which by design have no committed unit test.

---

## Per-Task Detail

### WP41 — Relay per-`roomId:docId` blob store

- **Status:** DONE
- **Charter Status:** `DONE` · **W4 Test Targets:** 3
- **Changed files/modules** (all inside `server/`, the boundary lifted by BUILD_SPEC escalation 6):
  ├── `server/src/mux-protocol.ts`   ← additive: `MUX_CHECKPOINT = 11`, `MUX_REPLAY_END = 12`, `ReplayFrame`,
  │                                     `encode/decodeCheckpointBody`, `encode/decodeReplayEndBody`, `encodeReplay`
  ├── `server/src/persistence.ts`    ← `StoredFrame`, `BlobStore`, `createMemoryBlobStore()`,
  │                                     `createLevelBlobStore(dbPath = "./data/frames")`, `noopBlobStore`
  ├── `server/src/ws-handler.ts`     ← `createYjsWSS(blobStore = noopBlobStore)`; append after the read-only gate;
  │                                     `MUX_CHECKPOINT` routed to the store and never rebroadcast; replay on subscribe
  ├── `server/src/index.ts`          ← `createApp(persistence?, externalServer?, blobStore?)`; only the real
  │                                     entrypoint wires `createLevelBlobStore()` (env `BLOB_STORE_PATH`)
  └── `server/src/__tests__/wp41/`   ← 8 staged visible tests (permanent; charter §6 requires tests here)
- **Unit test status:**
  | Test Set | Files | Tests | PASS | FAIL |
  |---|---|---|---|---|
  | visible | 8 | 27 | 27 | 0 |
  | blind_set1 + blind_set2 (combined run) | 16 | 44 | 44 | 0 |
- **Risk flag:** NONE
- **Repeated failure points:** none — visible and both blind sets passed on the first attempt.
- **Known edge cases not covered:** `createLevelBlobStore` durability across a relay restart is not exercised
  headlessly (it is a property of the `liveshare-data` volume); tests inject `createMemoryBlobStore()`, per the
  existing `noopPersistence` precedent.
- **Open assumptions:** replay safety rests on the CRDT property that update delivery is idempotent and
  commutative. This is **tested, not assumed** — TP7/TP8 apply a stored sequence to a fresh doc in original order,
  in deterministically shuffled order, and with duplicates, and assert identical resulting state.
- **Priority for Worker 4:** NORMAL

### WP42 — Client-side checkpoint frame and replay handling

- **Status:** DONE
- **Charter Status:** `DONE` · **W4 Test Targets:** 2
- **Changed files/modules:**
  ├── `plugin/src/sync/mux-protocol.ts`  ← additive only; the pre-WP42 half is byte-unchanged. Adds the mirrored
  │                                         `MUX_CHECKPOINT`/`MUX_REPLAY_END` constants, the four body codecs,
  │                                         `encode/decodeCheckpointFrame`, `encodeReplayEndFrame`,
  │                                         `CHECKPOINT_UPDATE_THRESHOLD = 64`, `shouldEmitCheckpoint`,
  │                                         `createReplayGate` (with the `enabled` discrimination seam),
  │                                         `applyRecoveredUpdates`. Still imports only `lib0` — no Yjs, no
  │                                         Obsidian, no fs, no clock.
  ├── `plugin/src/sync/sync.ts`          ← additive and local: `handleSubscribed` opens the barrier;
  │                                         `handleMessage` routes frames through `gate.accept` and dispatches via
  │                                         `dispatchFrame` (the old switch, extracted verbatim + a
  │                                         `MUX_CHECKPOINT` case); `setSynced` / `ws.onclose` close an
  │                                         unterminated batch; `releaseDoc` emits a final checkpoint
  └── `plugin/src/__tests__/wp42/`       ← 7 staged visible tests (new directory — see the file-boundary note)
- **Unit test status:**
  | Test Set | Files | Tests | PASS | FAIL |
  |---|---|---|---|---|
  | visible | 7 | 44 | 44 | 0 |
  | blind_set1 + blind_set2 (combined run) | 14 | 73 | 73 | 0 |
  | targeted seam regression (coder-run, not the full suite) | 7 | 145 | 145 | 0 |
- **Typecheck:** `npx tsc -noEmit -skipLibCheck` → exit 0, zero diagnostics. Nothing attributable to WP42 and
  nothing attributable to the concurrent agent at the moment it ran.
- **Risk flag:** NONE
- **Known edge cases not covered:** the two `7b` integration residues (below). No checkpoint is emitted in an
  E2E room at all — see decision 3.
- **Open assumptions:** the sidecar from WP24/WP25 does not exist yet and is modelled purely as an **injected
  seam** (an injectable array of prior updates). Nothing under `plugin/src/files/` is imported, created or
  depended on. When the real sidecar lands, the composition contract must be re-checked against it.
- **Priority for Worker 4:** NORMAL

---

## File Boundary — explicit confirmation

**Files touched outside `server/`:**

| Path | Permitted by | Note |
|---|---|---|
| `plugin/src/sync/mux-protocol.ts` | WP42 charter §6 — named seam | additive only |
| `plugin/src/sync/sync.ts` | WP42 charter §6 — named seam | additive + one verbatim switch extraction |
| `plugin/src/__tests__/wp42/` (7 files) | **judgement call — disclose** | see below |
| `workflowArtifacts/canvas-v2/**` | artifact folder for this run | charters, reports, `tests/` |

**The one judgement call:** WP42's charter §6 names no test location, and the batch rule was "nothing under
`plugin/src/**` beyond the named seam". I created the **new** directory `plugin/src/__tests__/wp42/` anyway,
because leaving WP42's visible tests only in `workflowArtifacts/` would make its four ACs invisible to CI.
It is a brand-new path no other agent writes to, so it cannot collide, and it only *adds* tests (an unexplained
**drop** in test count is the abort criterion, not a rise). If the Dispatcher prefers the strict reading, it
reverts with `rm -r plugin/src/__tests__/wp42` at zero cost to the production code.

**Not touched, as instructed:** `docker/`, `deploy/`, `server/dist/`, `plugin/main.js`, `plugin/manifest.json`,
`plugin/package.json` (no version bump), any other `plugin/src/**` file, `workflowArtifacts/` outside `canvas-v2/`.
No `npm install`, no new dependency, no Docker build, no ssh, no repo-wide formatter or refactor.
All temporary blind-test staging directories were removed — verified, none remain.

**Test artifacts** were written to `workflowArtifacts/canvas-v2/tests/{visible,blind_set1,blind_set2}/WP4{1,2}/`
rather than `workflowArtifacts/tests/…`, to stay inside this batch's artifact folder. This matches where the
concurrent batches are already writing their WP1/WP3 sets.

---

## Risk Notes for Worker 4

Neither WP is RISKY, so the notes below are **probe guidance**, not failure reports.

1. **The five `7b` wiring seams are the only untested surface.** Both cores are covered three times over
   (visible + 2 blind); the wiring that connects them to a live socket is not covered by any committed test.
   WP41's coder smoke-checked all three of its seams over a real socket during development and deleted the
   harness deliberately so W4 owns the integration oracle. Probe: (a) the replay batch reaches a joiner before
   any live frame, (b) a wire `MUX_CHECKPOINT` routes to `blobStore.checkpoint` and is **not** rebroadcast,
   (c) a frame suppressed by the read-only gate is **not** appended, (d) `SyncManager` really routes
   `handleMessage` through the gate and calls `beginReplay` from `handleSubscribed` over a real socket,
   (e) against a pre-WP41 relay, no `Notice`, banner or console error is surfaced.

2. **Checkpoint payload shape — the highest-value probe.** WP41 stores only the checkpoint's **opaque tail**, so
   a replayed `MUX_CHECKPOINT` carries a *bare* Yjs update, not the enveloped form. `handleCheckpoint` applies
   the payload directly and tolerates the enveloped form silently. Probe **both** shapes; a mismatch here would
   be silent (the doc simply fails to advance) rather than loud.

3. **Legacy-relay valve (WP42 decision 2).** The charter's `setSynced` close trigger deadlocks on a legacy relay
   when peers are present: the SYNC_STEP2 frame that fires `setSynced` is itself buffered, so `waitForSync`
   rejects and the user sees an error — which AC3 forbids. The coder added a **frame-driven** (not timer-driven,
   no new timing constant) valve: close the barrier on SYNC_STEP2 while no `MUX_REPLAY_END` marker has ever been
   seen on the connection; it retires permanently at the first marker, so a WP41 relay still gets the strict
   barrier. **W4's AC2 harness must subscribe once before measuring**, or it will observe the legacy path.

4. **WP41 wiring deviation, identical observable contract.** Charter §7 says the replay batch is sent "before the
   client is added to the live fan-out set". Doing that literally opens a window where a frame produced by
   another peer lands in neither the replay snapshot nor the fan-out — a silent lost update. The coder registers
   the client immediately and buffers its **outbound** live traffic (`RoomState.replayQueues`) until the batch is
   written. Wire order is unchanged: stored frames → `MUX_REPLAY_END` → live.

5. **Unbounded growth until checkpoints flow.** No client emits `MUX_CHECKPOINT` in an E2E room (WP42 decision 3:
   §7 offered "encrypt it or don't emit it"; not emitting avoids handing the relay plaintext, so no ESCALATE was
   raised). Consequence: in E2E rooms the stored stream never truncates. `SyncStep1` *request* frames are also
   stored, because distinguishing them would require parsing a payload the relay may not parse — compaction is
   the client's job by design.

6. **Deployment-adjacent, explicitly out of scope this run:** `createLevelBlobStore` needs its own LevelDB
   directory (`./data/frames`) because `createLevelPersistence` locks `./data/yjs-docs`. Durability is a property
   of the `liveshare-data` volume. Nothing was deployed, built or shipped.

7. **Concurrency caveat for the Dispatcher, not for W4.** `TaskCharter_WP27`'s *change type* line names
   `sync.ts:200–252`, although `sync.ts` is **not** in WP27's "Required changed files". If the WP27 batch does
   edit it, it will collide with WP42's seam. `plugin/src/sync/sync.ts` already showed as modified at the start
   of this run, but its mtime (Jul 26) predates the concurrent batches — that is pre-existing branch state, not a
   live collision. Worth a merge check before the batches are combined.

8. **Trust architecture is unchanged and was verified as a property.** The relay reads only the mux *envelope*
   (docId, msgType, and the checkpoint's envelope-level `upToSeq` varUint) and never decodes, decrypts,
   validates or inspects a payload. TP1/TP2 prove random and deliberately non-Yjs "encrypted" payloads round-trip
   byte-identically. Payloads are defensively copied in both directions; store keys length-prefix both ids so
   colon-bearing room/doc ids cannot collide. Rooms, permissions, auth and audit-log behaviour are untouched —
   all 122 pre-existing server tests still pass.

---

## Cross-WP finding worth recording

The WP42 Unit Test Sub-Agent independently chose frame type `5` for the checkpoint, while WP41 had already pinned
`MUX_CHECKPOINT = 11` / `MUX_REPLAY_END = 12`. Two internally consistent, fully-green specs that would have
shipped a client unable to talk to its own relay. It was caught only because WP42's charter was read against
WP41's *already updated* charter. WP42 was realigned to WP41 (a deliberate hole at `5` beats an interop break),
and the AC2 tests were reworked accordingly: because WP41 replays each stored frame under its **original**
msgType, replayed and live frames are indistinguishable client-side, so the client mechanism is a readiness
**barrier**, not a type-based reorder buffer. Frame type `5` is left unclaimed and a test asserts it.

---

## Summary for Worker 4 Entry Point

P6 is now observable end to end in source. A relay started with a blob store (`createLevelBlobStore()`, wired
only in the real entrypoint via `BLOB_STORE_PATH`) appends every `MUX_SYNC` / `MUX_SYNC_ENCRYPTED` frame it
fans out, keyed per `roomId:docId`, storing bytes it cannot read. When a client subscribes, `handleSubscribe`
writes the stored batch to it in ascending seq order and terminates it with `MUX_REPLAY_END`, buffering the
joiner's live traffic until the batch is on the wire. On the client, `createReplayGate` holds every frame until
that marker arrives, then releases the whole batch into the normal dispatch path — so replayed state lands
before live traffic without the client having to tell the two apart. A client emits `MUX_CHECKPOINT` (full state
as one update, plus an envelope-level `upToSeq`) at `CHECKPOINT_UPDATE_THRESHOLD = 64` updates and on
`releaseDoc`, which lets the relay drop everything that checkpoint supersedes. Against an older relay, no marker
ever arrives, the frame-driven valve opens on SYNC_STEP2, and the client falls back to the sidecar + peer path
with nothing surfaced to the user. To exercise it: run a relay from `server/` with a blob store, connect a
client, edit, disconnect **all** peers, then reconnect one — the doc must come back. The disable seam for the
whole client mechanism is `createReplayGate({ enabled: false })`, and at least one committed test fails when it
is flipped.

**Automation candidates (telemetry):** both coder sub-agents independently hit the same trap — the mandated
`test_<id>_visible.ts` filenames do not match either package's `*.test.ts` collection glob, so a naive run
collects nothing and looks green. A stage-and-rename helper would remove a recurring, silently-wrong step from
every future TDD-enabled Worker 3 run.
