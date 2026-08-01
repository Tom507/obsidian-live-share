# Implementation Report — WP42
Attempt: 1

## Status: DONE

## Completed Work

| AC | Status | Notes |
|---|---|---|
| AC1 — client emits a checkpoint frame carrying full state as one update, on a documented trigger, wire-compatible | DONE | `MUX_CHECKPOINT = 11` / `MUX_REPLAY_END = 12` mirror WP41 exactly; `encodeCheckpointFrame` = `encodeMuxMessage(docId, 11, varUint upToSeq ‖ Y.encodeStateAsUpdate(doc))`. `shouldEmitCheckpoint` implements the `sole-peer-sync` / `update-threshold` / `release` rules with `CHECKPOINT_UPDATE_THRESHOLD = 64` (an update count, not a timing constant). Types 0–10 keep their numbers and bytes, `5` stays unclaimed. |
| AC2 — replayed frames applied before live traffic; state identical to a live peer | DONE | `createReplayGate` is a readiness barrier, not a type filter: everything between `beginReplay` and `MUX_REPLAY_END` is buffered and released at once in arrival order, the marker is consumed and never forwarded, `lastSeq` is recorded. Wired in `handleSubscribed` / `handleMessage`. |
| AC3 — a relay without blob support still works, no error surfaced | DONE | A WP41 relay is recognised by the marker (present even with `lastSeq = 0`, so "capable but empty" ≠ "no support"); a legacy relay is recognised by its absence, and the barrier is closed from the existing sync-completion path with `endReplay(docId, "unsupported")`. No timer, no timing constant, no `Notice`, no console error. Plus a deadlock guard — see "Deviations". |
| AC4 — sidecar and relay persistence compose, no duplicate application | DONE | `applyRecoveredUpdates(apply, { sidecar, replay }, { dedupe })` applies sidecar first, then replay, through an injected doc writer. Dedupe skips byte-identical updates; with `dedupe: false` the state is still identical, so the guarantee rests on the CRDT and not on the bookkeeping. |

## Blocked Items

| Item | Blocker | Workaround attempted |
|---|---|---|
| none | — | — |

## Tools Created (by Worker 3 this attempt)

| Tool | Type | Purpose |
|---|---|---|
| none | — | — |

## Changes Made

- **`plugin/src/sync/mux-protocol.ts`** (modified, additive) — two frame-type constants and the
  pure WP42 API surface from charter section 7: `encodeCheckpointBody` / `decodeCheckpointBody`,
  `encodeReplayEndBody` / `decodeReplayEndBody`, `encodeCheckpointFrame` /
  `encodeReplayEndFrame` / `decodeCheckpointFrame`, `CHECKPOINT_UPDATE_THRESHOLD` +
  `shouldEmitCheckpoint`, `createReplayGate` (with the injected `enabled` discrimination seam),
  and `applyRecoveredUpdates`. Everything pre-WP42 in the file is byte-unchanged; imports are
  still only `lib0/encoding` and `lib0/decoding` (no Yjs, no Obsidian, no clock, no fs).
- **`plugin/src/sync/sync.ts`** (modified, additive and local) — one gate instance plus four
  small maps of bookkeeping; `handleSubscribed` opens the barrier and records the peer count;
  `handleMessage` records the marker, routes every frame through the gate and dispatches the
  released frames through `dispatchFrame` (the pre-WP42 switch, extracted verbatim and given a
  `MUX_CHECKPOINT` case); `setSynced(_, true)` and `ws.onclose` close an unterminated batch;
  `releaseDoc` emits a final checkpoint before unsubscribing and clears the doc's bookkeeping;
  a per-doc update counter drives the threshold trigger. No existing method was reorganised,
  renamed or reformatted, and no existing behaviour path was removed.
- **`plugin/src/__tests__/wp42/*.test.ts`** (new, 7 files) — the staged visible tests, copied
  verbatim from `workflowArtifacts/canvas-v2/tests/visible/WP42/` with only the filename
  changed (`_visible.ts` → `_visible.test.ts`) so Vitest's default include glob collects them.
  No assertion was edited; the `../../sync/…js` import depth resolved as written.

### Deviations from the charter's section-7 wiring sketch (both deliberate, both documented in charter §9)

1. **Replayed checkpoints carry a bare Yjs update, not an enveloped body.** WP41's
   `handleCheckpoint` decodes the envelope and stores only the opaque tail
   (`blobStore.checkpoint(room, doc, upToSeq, body)`), so `encodeReplay` re-emits
   `encodeMuxMessage(docId, MUX_CHECKPOINT, <bare update>)`. `handleCheckpoint` on the client
   therefore applies the payload directly and falls back to the enveloped form, both inside a
   silent try/catch. The charter's sentence ("apply `decodeCheckpointFrame(...).update`") would
   have mis-parsed every real replayed checkpoint.
2. **A legacy-relay deadlock guard on top of the `setSynced` close trigger.** With a pre-WP41
   relay and peers present, the optimistic barrier buffers the SYNC_STEP2 frame that would have
   called `setSynced` — the documented close trigger can therefore never fire, `waitForSync`
   rejects after 10 s and the user sees an error, which AC3 forbids. `handleMessage` also
   closes the barrier on a SYNC_STEP2 frame *while no `MUX_REPLAY_END` has ever been seen on
   this connection*; the buffer is dispatched first, so arrival order is preserved. It is
   driven by a frame, not a clock (no `setTimeout`, no new constant), and it retires
   permanently at the first marker, so against a WP41 relay the strict barrier is what runs.
3. **No checkpoint is emitted in an E2E room.** Section 7 explicitly allowed "either encrypt it
   or not emit it"; encrypting would require a new envelope, so `maybeEmitCheckpoint` returns
   early when `e2e.enabled`. The room then behaves exactly like the AC3 legacy path: sidecar +
   peers, nothing surfaced. This is why no ESCALATE was raised for that interaction.

## Files Touched Outside `plugin/src/sync/`

- `plugin/src/__tests__/wp42/` — 7 staged visible test files (permitted deliverable, item 3 of
  the file boundary).
- `workflowArtifacts/canvas-v2/TaskCharter_WP42_ClientCheckpointReplay.md` — Charter Status +
  sections 8 and 9 (item 4).
- `workflowArtifacts/canvas-v2/ImplementationReport_WP42.md` — this file (item 5).

Nothing else. No file under `server/`, `docker/`, `deploy/`, no other file under `plugin/src/`,
no `plugin/main.js`, no `plugin/manifest.json`, no version bump, no `npm install`, no new
dependency, no formatter run.

## Visible Test Results

Command (from `plugin/`): `npx vitest run src/__tests__/wp42 --reporter=dot` — **7 files, 44
assertions, 44 passed, 0 failed, 0.7 s.**

| Test | Status | Notes |
|---|---|---|
| TC1 `test_checkpoint_emit_visible` | PASS | 7/7 — trigger rules + a five-delta history collapsed into one frame that restores the source snapshot. |
| TC2 `test_wire_compat_visible` | PASS | 7/7 — golden bytes `[0,9]` / `[5,100,111,99,45,49,2]`, byte-exact agreement with the independent lib0 reference encoder for all ten existing types, `5` unclaimed. |
| TC3 `test_unknown_type_tolerance_visible` | PASS | 5/5 — the pre-WP42 dispatcher ignores 11/12 without error and keeps processing; `decodeCheckpointFrame` returns `null` for every other type. |
| TC4 `test_replay_before_live_visible` (DISCRIMINATION) | PASS | 7/7 — batch held, released in arrival order, marker not forwarded, and the barrier verifiably disappears with `createReplayGate({ enabled: false })`. |
| TC5 `test_replay_equals_live_peer_visible` | PASS | 4/4 — replay, compacted checkpoint and replay-then-live all reach the live peer's snapshot. |
| TC6 `test_no_blob_support_fallback_visible` | PASS | 7/7 — marker with `lastSeq 0` recognised as capable-but-empty; `endReplay(_, "unsupported")` releases with `fallback: true`, `lastSeq: null`, nothing thrown, no checkpoint into a blob-less relay. |
| TC7 `test_sidecar_replay_compose_visible` | PASS | 5/5 — replay-only / sidecar-only / both converge; `applied + skippedDuplicates == sidecarCount + replayCount`; convergence holds with `dedupe: false`. |

**Regression check on the touched seam** (not the full suite — the concurrent agent is mutating
`plugin/src/**`): `mux-protocol.test.ts`, `sync.test.ts`, `background-sync.test.ts`,
`collab.test.ts`, `regression.test.ts`, `w4-canvas-integrity.test.ts` and `e2e/two-host.test.ts`
→ **7 files, 145 assertions, all pass.** `e2e/two-host` runs a real relay process, so the
barrier is already exercised end-to-end against the live WP41 server, not only in unit form.
`npm test` and `npm run build` were deliberately NOT run.

## Typecheck Result

`npx tsc -noEmit -skipLibCheck` (from `plugin/`) → **exit 0, zero diagnostics.** Nothing to
attribute: no errors in WP42's files (`sync/mux-protocol.ts`, `sync/sync.ts`,
`__tests__/wp42/**`), and none anywhere else in `plugin/src/**` at the time of the run, so the
concurrent agent's in-flight work was also clean at that moment.

## Summary for Worker 3

The client now speaks WP41's checkpoint protocol. On subscribe it opens a readiness barrier for
that doc, holds every inbound frame (replayed and live are indistinguishable by type, exactly as
WP41 emits them), and releases the whole batch in arrival order when the relay's
`MUX_REPLAY_END` arrives — so a newcomer's doc is never observed half-replayed, and its state
equals that of a peer present throughout. Blob support is detected by the marker itself, so a
pre-WP41 relay simply never terminates the batch and the barrier is released by the ordinary
sync-completion path with `fallback: true`: no timer, no `Notice`, no console error, and the
room continues over the sidecar + peer path. To trigger a checkpoint by hand: enter a room as
the only peer with a relay that has blob support — the checkpoint fires right after the replay
batch closes; otherwise it fires after 64 updates or on `releaseDoc` (file closed / disconnect).
Rough edges, all listed in charter §9: E2E rooms emit no checkpoint at all (the deliberate
"don't emit plaintext" branch of the choice section 7 offered); the legacy deadlock guard means
that on a relay whose capability is not yet proven, one SYNC_STEP2 frame can release the barrier
early — correctness is unaffected (order is preserved, and that is exactly the pre-WP42
behaviour) but W4's AC2 harness should subscribe once before measuring so the marker has proven
capability; and `applyRecoveredUpdates` has no production caller until the WP24/WP25 sidecar
exists, which is intentional — it is the injected seam that sidecar will use, and no
`plugin/src/files/` module is imported or created here.
