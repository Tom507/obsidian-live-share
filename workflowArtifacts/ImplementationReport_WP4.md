# Implementation Report — WP4 — Latency-tolerant editing
Date: 2026-07-17
Status (text path): DONE

## Part 1 — Text path (background-sync.ts)

### ACs Satisfied (US5 AC1 text-half, AC4, AC5)

- **US5 AC1 (text path) — version/sequence-gated flush.** The local whole-file disk flush now
  YIELDs to in-flight remote deltas via an explicit per-file monotonic remote-sequence gate,
  instead of racing on the wall-clock debounce. A remote (non-local) Y.Text transaction bumps
  `remoteSeq[path]` in the doc observer. Every disk-flush snapshots that sequence together with
  its content (no interleaving await), and `doWriteToDisk` yields — skipping the write — when the
  live sequence has ADVANCED past the snapshot value. The check runs twice: once before the async
  `vault.read` and again immediately before `vault.adapter.write`, so a delta that lands during the
  read still wins. Result: a stale local snapshot can never overwrite a remote delta that was
  integrated into Y.Text after the snapshot; the observer that integrated the remote delta
  schedules its own flush of the newer content, so convergence and eventual write are preserved.
- **US5 AC4 — single-writer text invariant intact.** The `collabBoundFile` / active-file gates in
  `handleLocalTextModify` (early return on `path === activeFile` / `path === collabBoundFile`) and
  in the doc observer (same two returns before scheduling any disk write) are UNCHANGED. The
  sequence bump in the observer is placed BEFORE those gate returns, so it never introduces a new
  disk write for the active/collab-bound file — the version bump advances but no flush is scheduled
  or performed for yCollab-owned files. A dedicated regression test asserts no disk echo and that
  `handleLocalTextModify` still refuses to push a disk edit of the active file into Y.Text.
- **US5 AC5 — no Round-1 regressions.** No change touches ghost-caret handling (`ws-handler.ts`) or
  the per-key canvas diff (`canvas-sync.ts`); only `background-sync.ts` (text path) was modified.
  The full pre-existing background-sync regression set (frontmatter/single-writer/Bug-B, debounce,
  active-file suppression, path-traversal, destroy-flush) stays green (23/23 in
  `background-sync.test.ts`).

### ACs Not Satisfied

- None in the text-path scope. (US5 AC2 drop-unflushed-on-remote-lock and AC3 edge cascade/prune are
  the canvas half of WP4 — `canvas-sync.ts` — owned by the Wave-2 canvas agent and intentionally NOT
  touched here to avoid a write conflict. See "## Part 2 — Canvas path", appended later.)

### Files Changed

- `plugin/src/files/background-sync.ts` — added `remoteSeq: Map<string, number>` state +
  `currentSeq(path)` helper; observer bumps the sequence on every non-local (remote) Y.Text
  transaction; `writeToDisk` / `doWriteToDisk` take an optional `expectedSeq` and yield when the
  live sequence has advanced past it (two-point check); flush drivers (`scheduleDiskWrite` timer,
  `flushWrite`, `setActiveFile`) snapshot and pass the sequence; `remoteSeq` cleared/deleted in
  `destroy`, `onFileRemoved`, `onFileRenamed`. Seed/initial-sync writes (subscribe, rename) remain
  ungated by design (they write current remote content).
- `plugin/src/__tests__/background-sync.test.ts` — added 4 targeted tests:
  (a) a stale local flush yields to an in-flight remote delta (remote change survives, not
  clobbered); (b) a remote non-local delta advances the per-file sequence; (c) a flush whose
  sequence still matches writes normally; (d) the version gate does NOT weaken active/collab
  single-writer gating.

### Quality Gates

- **Build** (`npm run build` = `tsc -noEmit -skipLibCheck && esbuild`): PASS (exit 0). My TypeScript
  typechecks clean and bundles.
- **Test** (`npm test` = `vitest run`): 375 passed / 1 failed / 376 total.
  - `background-sync.test.ts`: 23/23 PASS, including the 4 new WP4 tests.
  - The single red — `sync.test.ts > SyncManager > reconnect ticks the awareness clock`
    ("infinite loop, 10000 timers" at `vi.runAllTimers()`) — is PRE-EXISTING and OUTSIDE WP4 text
    scope. Proven by stashing the two WP4 files and re-running: `sync.test.ts` still fails
    identically (17 pass / 1 fail). Both `sync.ts` and `sync.test.ts` are already modified in the
    working tree by a sibling WP (WP1 reconnect/awareness), which I must not touch.
- **Lint** (`npm run lint` = `biome check .`): red at baseline for ENVIRONMENT reasons only, not my
  code: (1) `plugin/manifest.json` is a committed git symlink that materialized on this Windows
  checkout as a plain file containing the Linux path `/home/mewski/.../manifest.json` → 87 JSON
  parse errors; (2) every `.ts` file (incl. untouched `file-ops.ts`) fails biome's formatter with
  CRLF line-ending diffs from git autocrlf. Scoping biome to my two files shows only the same
  whole-file CRLF format diff on pre-existing (unedited) lines — zero lint-rule violations
  attributable to my additions.

### Risk Notes

- **Degraded grounding (no graph).** Structural grounding was degraded — no code graph was
  available; `load_context` returned an empty `workflow_brief.hits`. Grounded instead on BUILD_SPEC
  §9 (WP4) + §5 (background-sync.ts entry) and USER_STORIES US5, plus a full read of the target
  file. Anchor `background-sync.ts:365-391` (the `doWriteToDisk` disk-write funnel) was the primary
  seam; confirmed accurate.
- **Suite not 100% green due to a pre-existing, out-of-scope failure.** `sync.test.ts` reconnect
  test is red independent of WP4 (proven by stash). Fixing it would require editing `sync.ts`
  (WP1 territory), which is out of WP4 scope and would risk a write conflict. Flagged rather than
  touched.
- **Lint gate is environment-red, not code-red.** manifest.json symlink + CRLF line endings on the
  Windows checkout. A Linux/LF checkout with an intact manifest.json symlink would lint clean for
  these files. No formatting/lint fix was applied because normalizing line endings would rewrite
  entire pre-existing files (noise/conflict risk) and manifest.json is not a code artifact.
- **Convergence argument.** The gate only skips a write when a strictly newer remote delta exists;
  that delta's own observer already scheduled a flush of the fresher content, so no write is lost
  and the disk converges to the latest Y.Text. Local edits (applied to Y.Text via LOCAL
  transactions) never bump the sequence, so local flushes are never spuriously yielded.

## Part 2 — Canvas path (canvas-sync.ts)
Date: 2026-07-17
Status (canvas path): DONE (delivered with the Wave-2 WP2+WP3+WP4-canvas batch)

### ACs Satisfied (US5 AC2, AC3, and the canvas half of AC1)

- **US5 AC1 (canvas half) — version/sequence-gated canvas flush.** The canvas disk flush now uses
  the SAME discipline already proven on the text path in `background-sync.ts`. A per-path monotonic
  `remoteSeq` counter is bumped on every NON-LOCAL canvas transaction via a single
  `doc.on("afterTransaction", tr => if (!tr.local) bump)` handler (registered once per subscribed
  canvas, so a remote delta touching both the nodes and edges maps counts once — not twice like the
  two deep observers would). `scheduleDiskWrite` snapshots `currentSeq` together with the serialized
  content (no interleaving await); `writeToDisk(path, content, expectedSeq)` YIELDs — skipping the
  write — when the live sequence has ADVANCED past the snapshot. The check runs three times (before
  the async folder-ensure, after it, and it is strict `>` not `!=` so a `destroy()` reset to 0 is
  never misread as staleness). A stale whole-file `.canvas` flush can no longer clobber an in-flight
  remote delta. Seed/initial-sync writes (subscribe guest) pass no `expectedSeq` and stay ungated by
  design. Verified: a flush snapshotted at seq 0, after a remote delta advanced the sequence, does
  NOT reach disk; a flush whose snapshot still matches writes normally.
- **US5 AC2 — drop-unflushed-on-remote-lock (GAP-3, WP4 half).** When a remote peer holds a node,
  the advisory `canWriteNode(path,nodeId)` gate (WP3) returns false, and the per-node diff path
  DROPS the local write for that node rather than pushing it; the baseline still advances so the
  dropped edit is not retried — the remote holder's value stands. Verified: with a remote holder on
  `n1` and an un-flushed local edit to `n1`, the local edit is discarded and the holder's value
  (x=999) remains in the shared doc.
- **US5 AC3 — cascade/prune dangling edges (GAP-5).** Two-layer prune: (1) on a LOCAL node delete,
  `pruneEdgesForDeletedNodes` removes, within the same transaction, every edge in the shared edges
  map whose `fromNode`/`toNode` is a just-deleted node (keeps the CRDT clean for both peers);
  (2) `serializeCanvas` filters out any edge referencing a node id not present in the nodes map, so
  NO serialized `.canvas` edge can reference a non-existent node — this also covers the remote-delete
  case at write time. Verified: a local endpoint delete cascade-prunes the edge from the shared doc;
  a remote-added edge to a non-existent node never appears in the serialized `.canvas`.

### ACs Not Satisfied

- None in the canvas-path scope. Single-writer text invariant (AC4) and Round-1 no-regression (AC5)
  were already covered by Part 1 (text path) and remain green (full suite 401 passed / 0 failed).

### Files Changed

- `plugin/src/files/canvas-sync.ts` — `remoteSeq` map + `currentSeq` helper + per-path
  `afterTransaction` seq-bump handler (cleaned up in `unsubscribe`/`destroy`); `scheduleDiskWrite`
  snapshots the sequence; `writeToDisk` takes `expectedSeq` and yields on advance (two-point check);
  `serializeCanvas` prunes dangling edges; `applyLocalDiffToYMaps` gains the `{path,deleted}` opts to
  collect locally-deleted node ids; `pruneEdgesForDeletedNodes` prunes their edges in the CRDT. The
  live per-key canvas diff (`:104-119,300-303`) was NOT re-touched beyond the reconcile-clobber
  window; `background-sync.ts` (the text path) was NOT touched.
- `plugin/src/__tests__/canvas-sync.test.ts` — added drop-unflushed-on-remote-lock, edge
  cascade-prune (CRDT), no-dangling-edge-on-serialize, and the canvas flush version-gate tests.

### Quality Gates

- **Build**: PASS (exit 0, `tsc` + esbuild production). **Test**: **401 passed / 0 failed** across 21
  files (baseline 376 → +25 Wave-2 canvas tests). Run via visible-console session `wave2-gate`.

### Risk Notes

- **Degraded grounding (no graph)** — grounded on BUILD_SPEC §9 (WP4) + §5 (canvas-sync entry) +
  USER_STORIES US5 + full reads of `canvas-sync.ts` and the text-path pattern in `background-sync.ts`.
  Anchors `canvas-sync.ts:409-429` (disk funnel) and `:242-318`/`:284-318` (diff seam) confirmed
  accurate.
- **Consistency with the text path** — the canvas seq gate mirrors the `background-sync.ts` design
  (strict `>` monotonic gate, snapshot-with-content) noted in workflow memory, including the
  destroy-reset gotcha (reset to 0 must not read as staleness).
- **Live in-flight timing** — the version-gate logic is unit-green via a direct `writeToDisk(...,0)`
  call after a remote delta (same technique the text-path WP4 tests use). The full concurrent
  guest/host in-flight survival under 50–150 ms RTT is RISKY and is asserted by the WP5 harness:
  "verified by W4 WP5 harness".
