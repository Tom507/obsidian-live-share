# Task Charter — WP68: Sidecar exclusion at the file-op rename boundary

**Charter Status:** `SPEC_COMPLETE`
**WP:** WP68
**Phase:** P2
**task_mode:** `standard`
**Depends on:** WP26 (**landed**), WP24
**W4 Test Targets:** `0`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** a rename can no longer carry a path into, or out of, a client's local replica state over the file-op channel — in either direction, from either end of the link — and no refusal of one costs any peer its file.
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 5, component **C68 — Sidecar exclusion at the file-op rename boundary** (work package WP68); phase **P2**. C68 sits immediately after C30 at the end of the PHASE P2 block.

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: modify, in exactly two production files:
    - `plugin/src/files/file-ops.ts` — `FileOpsManager.onFileRename` (`:461–475` at chartering time; the emit site is the `emitOp({ type: "rename", … })` inside the queued task)
    - `plugin/src/sync/control-handlers.ts` — the inbound `file-op` admission gate for `op.type === "rename"` (`:48–53` at chartering time)
  - Responsibility: extend C26's guarantee — local replica state is never shared content — to the **file-operation channel**, in both the outbound and the inbound direction.
- **Out of scope / non-goals:**
  - **`plugin/src/files/vault-events.ts:190–194` — the either-side vault-`rename` gate. Do NOT tighten it.** It is the shared root of both arms and it is left admitting the event **deliberately**: `BackgroundSync.onFileRenamed` must still run the old path's full teardown (`releaseDoc`, timers, observer) and `ManifestManager.renameFile` must still delete the stale old key. Narrowing that gate would silently undo two landed, chartered behaviours (C26 AC1, and the `onFileRenamed` teardown TC3 pins) and would strand a manifest entry forever. If a coder believes the root must move, that is an **ESCALATE**, not an implementation choice.
  - **`ManifestManager.renameFile` and `isSharedPath`.** WP26 owns them, they are landed and they stay byte-identical. In particular `renameFile`'s destination-only guard, its `manifest.delete(normOld)` and its `releaseDoc(normOld)` are not touched. Merging the disk arm and the manifest arm into "one guard" breaks C26.
  - **`BackgroundSync.onFileRenamed`** — already guarded by C26, destination-side, and unchanged.
  - **`skipsAutoTextSync`** (`plugin/src/utils.ts`) — the text-sync predicate. Not the right predicate here: this boundary must keep passing an ordinary `.canvas`, exactly as `isSharedPath` and `handleLocalTextModify` do. Use `isSidecarPath` alone.
  - Every other `FileOp` type (`create`, `modify`, `delete`, `folder-create`, the four chunk types). Their inbound gate is already the strict `paths.some(path => !isSharedPath(path))` form and `isSharedPath` already refuses a sidecar path (C26 AC1) — the rename branch is the **only** one that admits on `.some()` rather than on all paths, and it is the only one in scope.
  - Any relay/server source, any deployment, any test-rig file under `plugin/src/testing/` or `tools/`.
- **Known interfaces / dependencies:**
  - Input: a local vault `rename` whose two endpoints straddle the sidecar boundary; and a `rename` `FileOp` arriving over the control channel with the same shape
  - Output: no file-op emitted outbound; no vault mutation inbound; both endpoints left exactly as they were
  - Depends on work packages: **WP26** (landed — its `isSidecarPath` consumer contract and its manifest guard are the ground this builds on), **WP24** (owns `SIDECAR_DIR` and `isSidecarPath`)

---

## 3. Architecture Context

*Task-local architecture guidance only.*

- **Component(s) being changed:** `FileOpsManager` (outbound emit) and the control-channel `file-op` handler (inbound admission).
- **The traced path this WP closes.** Measured against the tree as it stands with WP26 landed, not recalled:
  1. `files/vault-events.ts:190–194` admits the vault `rename` when **either** endpoint is shared. With C26 landed, `isSharedPath` now returns `false` for a sidecar path, so a rename of an ordinary shared note **into** the sidecar directory passes on the strength of `oldPath` alone.
  2. `files/vault-events.ts:205` calls `fileOpsManager.onFileRename(file, oldPath)`.
  3. `files/file-ops.ts:461–475` — `onFileRename` has **no path-class guard of any kind**. Its only conditions are `isPathMuted(localNew)`, `isPathMuted(localOld)` and the presence of a sender. A user-initiated rename is not muted (muting is applied only around remote-op application and manifest-driven renames), so it emits `{ type: "rename", oldPath, newPath }` through `emitOp` — which, when the client is offline, **queues it for delivery on reconnect** rather than dropping it.
  4. `sync/control-handlers.ts:29–38` sends it as `{ type: "file-op", op }`.
  5. On the receiving peer, `sync/control-handlers.ts:48–53` gates it with **the same either-side shape**: `if (!paths.some(isSharedPath)) return;`. The shared `oldPath` admits it.
  6. `files/file-ops.ts:179–181` checks `isPathSafe` on both endpoints. A sidecar path passes: it is relative and contains no `.` or `..` **segment** (the leading dot in `.obsidian` is part of a segment name, not a segment).
  7. `files/file-ops.ts:232–254`, `case "rename"`: the peer's own file is found at `oldPath`, `alreadyExists` is false, `ensureFolder` creates the sidecar directory if needed, and `vault.rename` **moves the peer's own copy of the shared note into the peer's own sidecar directory**.
  8. The `afterApply` hook (`control-handlers.ts:77–85`) is host-only and its manifest arm **is** already covered — `renameFile` carries C26's destination guard. **That is the whole point of this WP:** the arm that is closed and the arm that is open sit two lines apart in the same handler and look identical.
- **The reachability statement, and where it is honest and where it is not.**
  - The **inbound** arm is reachable by construction and needs nothing unusual to happen locally: any peer — an older build, a differently-configured vault, or a hostile one — can put such an op on the wire, and today's gate admits it. This is why AC2 is asserted with **no sender-side guard in the picture**.
  - The **outbound** arm depends on Obsidian emitting a vault `rename` event whose destination lies under `.obsidian/`. WP26's landed contract comment and C26's ledgered reasoning both assert that reachability, and WP26's manifest guard was accepted on that basis — but it has **not** been observed in a real Obsidian instance and cannot be until the T3 gate (WP7/WP50/WP51) runs. AC1 is therefore written against `onFileRename` **directly**, at the seam it actually guards, so it is falsifiable today; the unverified step is confined to how that seam gets called. Do not write an AC1 test that depends on Obsidian's event behaviour, and do not report the outbound direction as observed end-to-end.
- **The second direction is not symmetric decoration.** `index.json` is a **fixed filename every peer holds** (`.obsidian/liveshare/state/index.json`). A rename whose *source* is a sidecar path and whose destination is shared therefore names a path that exists on every peer, and a peer applying it would move **its own** sidecar index out into the shared tree — publishing local replica state *and* destroying its own index in one operation. Both directions are in scope for that reason, not for tidiness.
- **Interfaces involved:**
  - Input: `TAbstractFile` + `oldPath` (outbound); a `rename` `FileOp` with `{oldPath, newPath}` (inbound)
  - Output: emitted-op stream (must contain nothing), vault mutations (must be none)
- **Constraints from BUILD_SPEC (invariants — what must not change):**
  - **I11 REFUSAL NEVER DESTROYS** is binding here and is AC3. This run has already found one silent `.canvas` data-loss bug of exactly the refuse-then-delete shape (C63/WP63); a refusal that degrades into a delete is the failure mode this charter most expects and most forbids.
  - **I5 DEGRADE** — a refusal is per-path and non-fatal. Other paths keep syncing; the session does not break; nothing throws out of the handler.
  - Invariants I1–I5 (`ARCHITECTURE.md`) and I6–I11 (CONCEPT_V2 Teil 3 + §4.6) are binding and must not be weakened.
  - `CanvasPersistence` remains the single CRDT→disk writer; it emits zero CRDT writes; `coldOpen` runs after `waitForSync` and before `start()`.
  - **Zero new runtime dependencies.**
  - `GEOMETRY_KEYS` keeps exactly `{x, y, width, height}` and stays exported. `plugin/src/canvas/canvas-presence.ts` is not modified. `plugin/src/main.ts` may hold wiring only, never logic. `canvas-binding.ts` / `canvas-model-bridge.ts` stay frozen and `useCanvasBinding` stays `false`.
  - Do not bump the plugin version. Do not hand-edit `plugin/main.js` or `server/dist/`. Do not read or edit `plugin/manifest.json` (broken symlink).
  - `server/` source is off limits. Deployment, `docker/.env` and any secret are out of scope entirely.
- **Technology / framework / config constraints:**
  - TypeScript + Yjs (`yjs ^13.6.0`). No new constants, no new module: the predicate already exists.
  - **Schema impact:** none. No wire-format change, no manifest-shape change, no `schemaVersion` movement. An older peer that still sends the op is handled by AC2 rather than by a protocol version.
- **Entry points / relevant files:**
  - `plugin/src/files/file-ops.ts:461` — `onFileRename`
  - `plugin/src/sync/control-handlers.ts:48` — the inbound rename admission gate
  - `plugin/src/files/canvas-sidecar.ts:78` — `isSidecarPath` (WP24; import it, never re-spell it)
  - `plugin/src/files/vault-events.ts:188–221` — the caller, **read-only context, not a target**
  - `plugin/src/files/manifest.ts:310–342` — `renameFile`, the arm C26 already closed, **read-only context, not a target**
- **Structure references:** *(intentionally empty — no Graphify graph exists for this project; FALLBACK mode is declared in the BUILD_SPEC section 3. Worker 3 fills this in after implementation. Do not invent paths here.)*

If structure references conflict with the BUILD_SPEC or explicit task scope, the BUILD_SPEC and TaskCharter win. Escalate instead of following the map.

---

## 4. Acceptance Criteria

*Exact copy from BUILD_SPEC section 5, component C68. No paraphrasing.*

1. `FileOpsManager.onFileRename` emits **no** `rename` file-op when **either** endpoint is a sidecar path, in either direction (shared → sidecar and sidecar → shared). Observed on the injected op sink **and** on the offline queue, so a client that is offline at the time cannot deliver it on reconnect. The membership test is `isSidecarPath` imported from `files/canvas-sidecar.ts`.
2. The **receiver refuses independently of the sender**, and this is asserted with no sender-side guard in the picture — by handing a hand-built `rename` `FileOp` straight to the inbound path, because a peer on an older or hostile build is precisely the case the receiver has to survive. A `rename` whose `oldPath` or `newPath` is a sidecar path performs **zero vault mutation**: no `rename`, no `createFolder`/`ensureFolder` under the sidecar directory, no `create`, no `modify` — even though its other endpoint is shared and today's gate admits it on that basis.
3. **I11 REFUSAL NEVER DESTROYS.** A refused rename costs no file, at either end. The file at `oldPath` is still present and byte-identical afterwards; `trashFile`, `delete` and `modify` are called for neither endpoint; and no sidecar file is unlinked or truncated by the refusal. Degrading the refusal to a delete, to a delete-then-recreate, or to "the file left the shared tree so drop it" is the defect this criterion exists to forbid, not an acceptable simplification. **WP26's manifest behaviour is explicitly untouched and must stay so:** `ManifestManager.renameFile` still deletes the old key and still declines a sidecar destination. This criterion governs **the file on disk**, not manifest membership, and a WP that "simplifies" the two into one has broken C26.
4. **No collateral.** Every rename with neither endpoint under the sidecar directory behaves exactly as it does today, outbound and inbound — including a `.canvas`, a deep path, the backslash spelling a Windows or remote caller produces, and the prefix-sharing near miss `.obsidian/liveshare/stateful/…`, which is **not** a sidecar path. The per-path bookkeeping is unchanged for admitted renames and is not left unbalanced by a refusal: `sendQueues`/`opQueues` acquire and release as before, and every `mutePathEvents` still has its matching `unmutePathEvents`. A refusal that strands a mute count is a silent freeze of that path.
5. **One predicate, one definition** (the C26 AC3 rule, extended to these two boundaries). Both guards consult `isSidecarPath` from `files/canvas-sidecar.ts`; no module re-spells `SIDECAR_DIR`, writes its own prefix or suffix test, or introduces a second constant, and the guard is placed at the two named boundaries rather than duplicated per op type. Verified against the source, in the same style and with the same discipline as C26 AC3 — the claim is checked by running an extraction over the source, not by reading it.

**Definition of Done:** no rename can carry a path into, or out of, a client's local replica state over the file-op channel — in either direction, from either end of the link — and no refusal of one costs any peer its file.

---

## 5. Constraints and Known Risks

- **Permission / environment limits:** Windows dev host; run all plugin commands from `plugin/` (never the repo root). Runner is Vitest 4.0.18 — the `basic` reporter was removed, use the default or `--reporter=dot`. Budget **≥90 s** for any automated `npm test` invocation (a deliberate 33.5 s sleeper in `wp5/latency.test.ts` makes ≈41 s the floor, not a hang). No Graphify graph exists for this project (declared FALLBACK mode) — `workflowArtifacts/RepoMap.md` is the structural map.
- **Concurrency:** batch **B4** is live in P2 production source (WP24–WP30) in the same working tree. `plugin/src/files/manifest.ts`, `background-sync.ts` and `utils.ts` are B4's; `file-ops.ts` and `control-handlers.ts` are not currently touched by it, but **line numbers in this charter may have shifted** — re-locate every seam by symbol name, never by line number, and attribute gate results per §7's concurrent-batch attribution rule rather than assuming a red is yours.
- **Verification must be by targeted injection of this WP's own class.** A green here is worth nothing unless removing the guard reddens the test **on its own named assertion**. The project has found five distinct classes of test that cannot fail; the two that apply directly here are:
  - **A guard whose test never reaches it.** A test that drives a `.yhistory` path proves little — `isTextFile` already stops `.yhistory` one line early at several seams, and this run has already shipped one suite that would have been green against an untouched tree for exactly that reason. Use `index.json` or a `.md` **under** the sidecar directory as the discriminating input.
  - **A hollow scenario.** Assert on the emitted-op stream and on the vault, and confirm the ordinary control case in the **same run** actually did emit / did move. An assertion that "nothing was emitted" passes trivially against a harness that emits nothing ever.
- **Known flaky patterns:**
  - No timing-based echo suppression: no new `setTimeout` waits and no new timing constants.
  - No wall-clock sleeps in new tests.
  - Do not assert on log strings as the primary oracle; state is the oracle, signatures are for humans.
  - Never reason from two peers only where a third would behave differently.
  - Biome reports a whole-file `format` finding per touched file (CRLF environment artefact). Advisory locally, gating in CI — do not mass-reformat.
- **Known risks specific to this WP:**
  - **The refuse-then-delete trap (AC3) is the most likely wrong answer.** "The file has left the shared tree, so remove the peer's copy" is a coherent-sounding reading of the rename's *intent*, and it is exactly the shape of the silent `.canvas` data loss this run already found and closed at three depths (C63/WP63, I11). Divergence — the peer keeps its copy at `oldPath` while the local vault has moved its own — is the **accepted** outcome; deletion is an abort criterion.
  - **Do not "fix it at the root".** Tightening `vault-events.ts:190–194` looks like the smaller diff and would silently break two landed behaviours. See §2.
  - **Do not merge the two arms.** The manifest arm (C26) and the disk arm (this WP) have deliberately *different* answers on the same event: `renameFile` still deletes the old manifest key, while the disk refusal keeps the peer's file. Anyone unifying them will break one of the two.
  - **`emitOp` has two exits.** Guarding only the online send leaves the offline queue as a delayed delivery of the same op; AC1 names the queue explicitly for that reason.
- **External dependency risks:** No new runtime dependency is permitted. Obsidian's `Vault`/`FileManager` surfaces used here (`rename`, `getAbstractFileByPath`, `trashFile`, `createFolder`) are public API and stable; the private Canvas API is not involved.
- **Hard constraints:**
  - Invariants I1–I5 and I6–I11 are binding and must not be weakened; **I11 in particular is an acceptance criterion, not advice.**
  - `plugin/src/files/vault-events.ts`, `plugin/src/files/manifest.ts` and `plugin/src/files/background-sync.ts` are **not modified by this WP**. If implementation appears to require it, ESCALATE.
  - No existing test is deleted, weakened, retitled, skipped or amended. WP68 holds **no** §7 licence of any class, and an unenumerated deletion or assertion rewrite is an abort criterion.
  - `SIDECAR_DIR` stays spelt in exactly one production module.

---

## 6. Definition of Done Artifacts

- **Required changed files:**
  - `plugin/src/files/file-ops.ts`
  - `plugin/src/sync/control-handlers.ts`
- **Required report:** `ImplementationReport_WP68.md` (in `workflowArtifacts/canvas-v2/`), containing: the guard placement at each of the two boundaries; the per-AC falsification (guard neutralised → which test reddens, on which named assertion, and whether any neighbouring pre-existing oracle also reddened); the before/after full-suite counts with foreign edits attributed; and an explicit statement of which direction of AC1 was observed at the seam versus which remains unobserved end-to-end in real Obsidian.
- **BUILD_SPEC updates required:** no — C68 and the §9 row are already written. If implementation invalidates an architecture decision, ESCALATE rather than editing the spec.
- **Gate status required at handover:** `npm run build` PASS and `npm test` with 0 failures, run from `plugin/`, with results attributed against whatever batch is concurrently live. All visible tests PASS.

---

## 7. Visible Test Cases / Producer Artifacts

*Empty — filled by Worker 3's producer sub-agent. Worker 2 does not generate tests.*

---

## 7b. W4 Test Targets (filled by Worker 3's Unit Test Sub-Agent, if any)

*Empty at handover.* All five criteria are decided at unit seams inside `plugin/src/` — `FileOpsManager.onFileRename` with an injected sender, the control-channel handler with a hand-built `FileOp` and a vault stub, and the module source for AC5. None requires a live relay, a second Obsidian instance or the T3 rig. The one thing the unit suite cannot settle is *whether Obsidian emits the vault event that reaches AC1's seam*, which is why AC1 is written at the seam rather than at the event; that residue is a T3 observation, not an INTEGRATION_SCOPE acceptance criterion, and it is recorded in §3 rather than deferred to Worker 4.

---

## 8. Autonomous Execution Plan (filled by Coder Sub-Agent, attempt 1)

*Empty at handover.*

---

## 9. Handover Summary (filled by Coder Sub-Agent on completion)

*Empty at handover.*

---

## 10. Risk Notes for Worker 4 (filled by Worker 3 Core)

*Empty at handover.*
