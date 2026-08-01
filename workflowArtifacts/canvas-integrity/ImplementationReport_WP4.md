# ImplementationReport — WP4 (Node + edge locking, S1)

- **Batch:** C (first of WP4 → WP5 → WP6 → WP7)
- **Stories:** US2 (AC1–AC9), US6 rows `LOCK DENIED:` and `LOCK REVERT:`
- **Files changed:** `plugin/src/files/canvas-sync.ts`, `plugin/src/main.ts`, `plugin/src/__tests__/canvas-sync.test.ts`
- **Grounding:** degraded mode (`graphify_enabled: false`), anchors from the WP4 block; Graphify not run
- **Test delta:** `canvas-sync.test.ts` 27 → 33 tests (+6, all green). `canvas-presence.test.ts` 16 (unchanged), `canvas-matrix.test.ts` 6 (unchanged), `harness/two-peer.test.ts` 10 (unchanged)

---

## ACs Satisfied

| AC | How verified |
|---|---|
| **AC1** — edge writes gated by the lock seam, writable only when `canWriteNode(from) && canWriteNode(to)` | `applyLocalDiffToYMaps` is now called for edges WITH options (`canvas-sync.ts:505-509`, `kind: "edge"`); the gate itself is `canWriteEntity` (`:654-670`), which walks `fromNode`/`toNode` of every supplied record. Two tests: *"edge write is denied while a peer holds one of its endpoint nodes (US2 AC1)"* (RED-first, see § RED 1) and *"edge write is allowed while both endpoint nodes are free (US2 AC1, default-allow)"*. |
| **AC2** — a changed, still-present edge is merged per key, never replaced | The `new Y.Map()` edge re-create branch is deleted; both maps now fall through to `applyKeyDiff(existing, baseObj, obj)` (`:617`). Test *"a changed edge that still exists is merged per key, never re-created (US2 AC2)"* asserts the peer's concurrent `color` survives, our `toSide` lands, and the Y.Map **identity** is unchanged (`toBe(edgeItem)`) so no detach happened. **NOTE: this test was GREEN at HEAD** — see § ACs Not Satisfied / spec contradiction. |
| **AC3** — a remote-deleted edge is not resurrected (delete-wins) | The `baseObj && !existing` case is now a deliberate no-op for BOTH kinds (`:618-625` comment block). Test *"does NOT resurrect a remote-deleted EDGE when the local user edits it (US2 AC3)"* — RED-first, § RED 2. |
| **AC4** — any denial in a pass ⇒ `lastWrittenContent` not advanced | `deniedIds` accumulator (`:493`) is filled by every deny path in both maps; the advance at `:528` is now inside `else`. Test *"a denied write does NOT advance lastWrittenContent and stays observable (US2 AC4/AC5)"* — RED-first, § RED 3. Also re-asserted in the two-peer test (§ RED 4). |
| **AC5** — idempotent second pass: no CRDT mutation, no baseline advance, one `warn` line per pass naming path + denied ids | Same test, second phase: a second `handleLocalModify` on unchanged disk leaves `n1.x === 0`, leaves the baseline at `before`, and takes the `LOCK DENIED:` count from 1 → 2 (exactly one line per pass). Log signature: `LOCK DENIED: ${path} ids=[...] (baseline held)` at `:523-526`. |
| **AC6** — `mountCanvasPresence` passes `onRevert` | `main.ts:1209` — `onRevert: (nodeId: string) => this.revertCanvasNode(rawPath, nodeId, awareness)`. DoD grep: `grep -n "onRevert" plugin/src/main.ts` → line 1209. |
| **AC7** — the revert obtains `getCanvasSnapshot` and drives `reconcileLiveCanvas(..., { initial: true })`; a `null` snapshot is a no-op | `main.ts:1228-1244`: `getCanvasSnapshot(rawPath) ?? null` → `if (!snapshot) return;` → `reconcileLiveCanvas(rawPath, snapshot, { initial: true })`. The null branch is exercised in the two-peer test's `onRevert` replica (`if (!snapshot) return`) and is a plain early return in production. |
| **AC8** — called with the reverted `nodeId`, emits one `warn` with path, nodeId, winning clientId | Signature is `(nodeId: string) => void`, matching `canvas-presence.ts:231/:387`. Winner comes from the already-exported pure helper `resolveHolder(canonical, nodeId, awareness.getStates())` (lowest clientID among holders) — no new decision logic in `main.ts`. Line: `LOCK REVERT: ${canonical} node=${nodeId} winner=${winner ?? "unknown"}${noSnapshot}` at `main.ts:1240`. |
| **AC9** — two-peer: loser denied, baseline held, `onRevert("n1")` once, view ends at winner's coords | New `describe("CanvasSync + CanvasPresence loser-revert (US2 AC9)")` in `canvas-sync.test.ts` composes the real `CanvasSync` + two real `CanvasPresence` instances over one shared awareness map, wired exactly as `main.ts:766-773` does. Asserts `n1.x === 300` (winner's value stands), baseline `=== original`, one `LOCK DENIED:`, `reverted === ["n1"]`, the reverted view snapshot's `x === 300`, `A.isLockedByMe("n1") === false`, `B.isLockedByMe("n1") === true`. RED-first, § RED 4. |
| **AC7 (BUILD_SPEC list)** — idempotence | Covered by AC5 above (same test). |
| **AC8 (BUILD_SPEC list)** — cascade prune + dangling-edge serialization guard unchanged; `pruneEdgesForDeletedNodes` keeps `typeof from === "string"` | `pruneEdgesForDeletedNodes` and `buildCanvasData` are byte-identical to HEAD. Existing tests *"prunes edges in the shared doc when their endpoint node is locally deleted (GAP-5)"* and *"never serializes a dangling edge to disk (US5 AC3)"* still pass. |
| **AC9 (BUILD_SPEC list)** — no change to `GEOMETRY_KEYS` or `applyToYMap`'s delete guard | Both untouched (`GEOMETRY_KEYS` at `:29`, `applyToYMap` at `:140-158`). Verified by diff review; WP5's surface is clean. |
| **Default-allow preserved** | The gates still default to allow-all (`canWriteNode`/`canDeleteNode` initialise to `() => true`, `:218-219`) and `main.ts:766-773` still returns `true` when no presence is mounted. Test *"edge write is allowed while both endpoint nodes are free"* pins it for the new edge path. |

## ACs Not Satisfied

**None functionally** — but one AC's *red-first premise* was factually wrong and could not be honoured as written:

- **US2 AC2 / BUILD_SPEC WP4 AC2 ("was confirmed RED against current HEAD")** — the AC2 test is **GREEN at HEAD**. The destructive `new Y.Map()` branch at HEAD (`:581-586`) sits in an `else if` chain *after* `} else if (existing) { … applyKeyDiff(…) }`, so it is only reachable when the edge is **absent from the CRDT** (`baseObj` truthy, `existing` falsy) — i.e. only the remote-delete/resurrect case, which is AC3. A changed-and-present edge already went through `applyKeyDiff` at HEAD, so a peer's concurrent `color` already survived. The dispatcher briefing's claim ("reached both for a changed-and-present edge and for a remotely-deleted one") is incorrect on the first half.
  - **What was done instead:** the AC2 test was written and kept as a regression guard (it now also pins Y.Map identity), and the fourth RED observation was taken from **US2 AC1** — edge writes consulting the lock seam at all — which is unambiguously red at HEAD and is an AC this WP owns. Four RED observations are recorded; none was faked, and none was obtained by reverting the tree.

## RED-First Observations

All reds were observed by writing the test first and running it against the **unmodified** production tree (no `git stash` / `checkout` / `reset` / `restore` was used at any point). Runs 1 and 2 below are the same test file at HEAD; run 2 re-filters to `-t denied` because the AC3 failure dumps a multi-thousand-line Yjs object that truncated the reporter output.

**Command (run 1, all four reds visible):**
```
npx vitest run src/__tests__/canvas-sync.test.ts
```
Result at HEAD: `src/__tests__/canvas-sync.test.ts (33 tests | 4 failed)` — the four failures are exactly the four ACs below; the other 29 (27 pre-existing + AC1-allow + AC2) passed.

**Command (run 2, clean text for the reds whose block was truncated):**
```
npx vitest run src/__tests__/canvas-sync.test.ts -t denied
```

### RED 1 — US2 AC1 (edge writes never consult the lock seam at HEAD)

```
 FAIL  src/__tests__/canvas-sync.test.ts > CanvasSync > edge write is denied while a peer holds one of its endpoint nodes (US2 AC1)
AssertionError: expected 'right' to be 'left' // Object.is equality

Expected: "left"
Received: "right"

 ❯ src/__tests__/canvas-sync.test.ts:713:66
    713|     expect((edgesMap.get("e1") as Y.Map<unknown>).get("toSide")).toBe(…
```
At HEAD the edge write lands even though a peer holds endpoint `n2`, and no `LOCK DENIED:` line is emitted.

**GREEN after:** test passes; `toSide` stays `"left"` and exactly one `LOCK DENIED:` line naming `e1` is emitted.

### RED 2 — US2 AC3 (remote-deleted edge is resurrected at HEAD)

```
 FAIL  src/__tests__/canvas-sync.test.ts > CanvasSync > does NOT resurrect a remote-deleted EDGE when the local user edits it (US2 AC3)
AssertionError: expected YMap{ _item: Item{ …(11) }, …(8) } to be undefined

- Expected:
undefined

+ Received:
YMap {
  "_dEH": EventHandler {
…
```
(the `Received:` block is a full recursive Yjs `YMap`/`Doc` dump, ~2 000 lines, elided here — the assertion line above is verbatim)

**GREEN after:** `edgesMap.get("e1")` stays `undefined` and `edgesMap.size === 0`.

### RED 3 — US2 AC4/AC5 (denied write still advanced the baseline at HEAD)

```
 FAIL  src/__tests__/canvas-sync.test.ts > CanvasSync > a denied write does NOT advance lastWrittenContent and stays observable (US2 AC4/AC5)
AssertionError: expected '{"nodes":[{"id":"n1","x":999,"y":0}],…' to be '{"nodes":[{"id":"n1","x":0,"y":0}],"e…' // Object.is equality

Expected: "{"nodes":[{"id":"n1","x":0,"y":0}],"edges":[]}"
Received: "{"nodes":[{"id":"n1","x":999,"y":0}],"edges":[]}"

 ❯ src/__tests__/canvas-sync.test.ts:790:39
    790|     expect(baselineOf("test.canvas")).toBe(before); // AC4: baseline H…
```
At HEAD the rejected `x: 999` became the new diff baseline — permanent divergence, exactly the § 12 GAP the story describes.

**GREEN after:** baseline held at `before`; second pass re-detects the denial (1 → 2 `LOCK DENIED:` lines, no CRDT mutation); after the lock is released the held-back edit finally reaches the doc (`x === 999`) and the baseline advances.

### RED 4 — US2 AC9 (two-peer composed seam)

```
 FAIL  src/__tests__/canvas-sync.test.ts > CanvasSync + CanvasPresence loser-revert (US2 AC9) > the tiebreak loser is denied, holds its baseline, reverts once, and lands on the winner's coords
AssertionError: expected '{"nodes":[{"id":"n1","x":50,"y":0,"wi…' to be '{"nodes":[{"id":"n1","x":0,"y":0,"wid…' // Object.is equality

Expected: "{"nodes":[{"id":"n1","x":0,"y":0,"width":100,"height":60}],"edges":[]}"
Received: "{"nodes":[{"id":"n1","x":50,"y":0,"width":100,"height":60}],"edges":[]}"

 ❯ src/__tests__/canvas-sync.test.ts:924:7
    924|     ).toBe(original);
```
Honest scoping of this red: the failing assertion is the **baseline hold**, which is the half of AC9 a unit test can observe. `onRevert` fires at HEAD *when supplied by the test*, because the option/field/call site already exist in `canvas-presence.ts`; what did not exist at HEAD is a **production** supplier, and `main.ts` has no test file, so that half is evidenced by the DoD grep (`main.ts:1209`) rather than by a red.

**GREEN after:** all assertions pass — winner's `x === 300` stands, baseline `=== original`, one `LOCK DENIED:`, `reverted === ["n1"]` (exactly once), reverted view snapshot `x === 300`, loser released, winner still holding.

## Files Changed

```
plugin/src/files/canvas-sync.ts
├── :489-528   handleLocalModify: new `deniedIds` accumulator; both maps called with
│              `{ path, kind, denied }` (nodes additionally `deleted`); the baseline
│              advance is now `else`-guarded and a denied pass emits
│              `LOCK DENIED: <path> ids=[…] (baseline held)`  (US2 AC1/AC4/AC5, US6)
├── :560-646   applyLocalDiffToYMaps: `opts` is now required and kind-aware
│              (`"node" | "edge"`); `onLocalNodeChange` fires for nodes only; every
│              create/change/delete consults `canWriteEntity` and records denials
│              (:590-593, :607-613, :630-643); the destructive `new Y.Map()` edge
│              re-create is GONE (both kinds now reach `applyKeyDiff` at :617); the
│              `baseObj && !existing` case is a documented no-op for both kinds
│              (:619-625, delete-wins)  (US2 AC1/AC2/AC3)
└── :648-668   NEW `canWriteEntity(opts, id, ...records)`: node → `canWriteNode(id)`;
               edge → `canWriteNode(fromNode) && canWriteNode(toNode)` across the
               intended AND previous record, `typeof === "string"` guarded  (US2 AC1)

plugin/src/main.ts   (wiring only — no test file, per WP rule 9)
├── :12        import adds the already-exported pure helper `resolveHolder`
├── :1195      hoisted `const awareness = handle.awareness as unknown as AwarenessLike`
│              (used by both the presence options and the revert glue)
├── :1209      NEW `onRevert: (nodeId: string) => this.revertCanvasNode(rawPath, nodeId, awareness)`
└── :1222-1244 NEW `private revertCanvasNode(rawPath, nodeId, awareness)`: winner via
               `resolveHolder`, `LOCK REVERT:` warn, `getCanvasSnapshot` → early return
               on null → `reconcileLiveCanvas(rawPath, snapshot, { initial: true })`

plugin/src/__tests__/canvas-sync.test.ts   (27 → 33 tests, 933 lines)
├── :5         import `{ type AwarenessLike, CanvasPresence }`
├── :671-698   local helpers `baselineOf`, `captureWarnings`, `twoNodesOneEdge`
├── :700-807   5 new tests in describe("CanvasSync"): AC1 deny, AC1 allow/default-allow,
│              AC2 per-key merge + identity, AC3 edge delete-wins, AC4/AC5 baseline hold
└── :809-933   NEW `makeAwarenessNetwork()` (:823) + describe("CanvasSync +
               CanvasPresence loser-revert (US2 AC9)") (:853) with the composed
               two-peer test
```

Not touched: `plugin/src/canvas/canvas-presence.ts` (read-only, as required), `GEOMETRY_KEYS`, `applyToYMap`, `pruneEdgesForDeletedNodes`, `buildCanvasData`, `reconcileLiveCanvas`'s classification, `plugin/src/types.ts` (`useCanvasBinding` still `false`), version (still 0.6.0), `server/`, `docker/`, deploy files, manifests, `plugin/main.js`.

## Quality Gates

| Command | Result |
|---|---|
| `npx tsc -noEmit -skipLibCheck` | **PASS** (exit 0, no diagnostics; `TSC_EXIT_OK` echoed after the `&&`) |
| `npx vitest run src/__tests__/canvas-sync.test.ts src/__tests__/canvas-presence.test.ts src/__tests__/canvas-matrix.test.ts src/__tests__/harness/two-peer.test.ts` | **PASS** — `Test Files 4 passed (4)`, `Tests 65 passed (65)`, exit 0 |
| `npx biome lint src/files/canvas-sync.ts src/main.ts src/__tests__/canvas-sync.test.ts` | **1 finding — no increase.** The single `lint/style/useTemplate` is pre-existing on the untouched `local modify` telemetry line (`canvas-sync.ts:549`). A new `useTemplate` finding introduced by the first draft of the `LOCK REVERT:` line was removed before completion by extracting the suffix into a local. |
| `npx biome check <same 3 files>` | 5 findings = the 1 lint above + 1 whole-file `format` diff per file, which is the **known CRLF environment red** (every file in the repo shows a full-file diff) — pre-existing, not increased. |
| `npm run build` | **NOT RUN, by dispatcher instruction** (its esbuild step writes `plugin/main.js` while three batches run concurrently). `tsc -noEmit` covers the typecheck half of gate 1. |
| `npm test` (whole suite) | **NOT RUN, by dispatcher instruction** (targeted runs only). Suite delta is additive: +6 tests, 0 previously-passing tests failed in the four files run. Expected whole-suite count 526 → 532. |

## Risk Notes

1. **`applyToYMap` on the `!baseObj && existing` branch is a second, still-open destructive edge path (HIGH, out of scope, hand to WP5/W4).** `canvas-sync.ts:598-602` (unchanged from HEAD) full-merges the local record into the existing Y.Map via `applyToYMap`, which **deletes every key the local record lacks** (only `GEOMETRY_KEYS` are exempt, and those are node-only). Reachable for edges: a remote peer adds/updates edge `e1`, our `reconcileLiveCanvas` structural reload makes Obsidian re-save the file, and that save is diffed while `lastWrittenContent` has not yet caught up ⇒ our stale copy of `e1` wipes the peer's concurrent `color`/`label`. This is precisely the data loss US2 AC2 describes, at a line the WP4 scope does not name. Not fixed and **not tested** here (an un-fixable failing test may not be left in the suite); recommend W2 route it as an explicit WP5 or follow-up AC.
2. **Edge deletes are now gated too.** AC1 says "edge writes are gated"; a local edge removal is a write, so `canWriteEntity` guards it using the *base* record's endpoints. Consequence: while a peer holds an endpoint, a local edge deletion is deferred (and the baseline held) instead of applied. The GAP-5 cascade prune stays deliberately ungated because it follows an already-permitted node delete. If W2 intended edge deletes to remain unguarded, this is the one branch to revisit (`canvas-sync.ts:637-643`).
3. **Baseline holding changes disk-rollback timing.** With the baseline held, the rejected local edit stays on the user's disk until the next remote-driven flush rewrites the file from the CRDT. Until then the local view/file disagree with the shared doc — but *visibly and recoverably*, which is the point of AC4. The `LOCK REVERT:` path shortens that window for the open-canvas case only.
4. **`main.ts` remains untested.** `revertCanvasNode` is thin glue over one existing pure helper (`resolveHolder`) plus two existing methods, and the two-peer test pins a *replica* of that glue, not the instance. A future regression in `mountCanvasPresence`'s options object would not be caught by any test.
5. **US6 AC6 (the `ARCHITECTURE.md` appendix table) is not done for my two rows.** `ARCHITECTURE.md` is outside my permitted file list, so `LOCK DENIED:` / `LOCK REVERT:` are not yet documented there. Whoever owns the appendix (or a wrap-up WP) must append both rows.
6. **GAP-7 lock epoch** remains unimplemented (explicitly out of scope, § 12 R3, P2): the advisory gates are still bounded-LWW, so a write can be denied on stale awareness within one RTT.
7. **Tooling:** the `visible-console` launcher hit the known intermittent `WinError 5` on `status.json` three times; the affected console stopped consuming queued requests silently (two commands never ran and `await_console` returned a stale tail). Workaround used: a fresh `session_key` suffix per run and reading the raw `console.log` instead of trusting `log_tail`. Also `--reporter=basic` is not a valid vitest 4 reporter.
