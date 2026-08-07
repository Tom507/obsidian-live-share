# Worker 4 Fix Request — WP6

## Summary

The `.canvas` single-owner guard exists **only in `BackgroundSync.startAll`**. `onFileAdded` and
`onFileRenamed` have no equivalent guard, and `vault-events.ts` calls both for *any* `isTextFile`
path — and `"canvas"` is in `TEXT_EXTENSIONS`. A `.canvas` **created or renamed during a live
session** therefore still gets a second, independent raw-`Y.Text` CRDT for bytes `CanvasSync`
already owns, and that document's observer is a **second CRDT→disk writer** for the same file.
This violates US5 AC1 and US5 AC13 and re-opens the exact defect class the round exists to close.

Confirmed by execution, not by reading. Four probes RED in
`plugin/src/__tests__/w4-canvas-integrity.test.ts`.

---

## Failures

### F1 — `create` of a `.canvas` mid-session builds a raw `Y.Text` document for it

- **Severity:** HIGH
- **Affected flow:** US5 AC1 / AC2 — "a shared `.canvas` path is synced through exactly one subsystem at any instant"
- **Test level:** integration (Level 4, focused regression on WP6)
- **Test executed:** `npx vitest run src/__tests__/w4-canvas-integrity.test.ts -t "J1"`
- **Step that failed:** the real `registerVaultEvents` `create` handler, role `host`
- **Expected behavior:** `syncManager.getDoc("board.canvas")` is never called — no `Y.Text` doc for a `.canvas`
- **Observed behavior:** `syncManager.docs.has("board.canvas") === true`
- **Reproduction steps:**
  1. Register the real vault events with a real `BackgroundSync`, `settings.role = "host"`.
  2. Emit `vault.on("create")` for `board.canvas`.
  3. Inspect the sync manager's doc registry for the **bare** path (not `__canvas__:`).
- **Code path:** `vault-events.ts:151-153` → `BackgroundSync.onFileAdded` (`background-sync.ts:188-192`) → `subscribe(path)`. `onFileAdded` checks only `isTextFile(path)`; there is no `path.endsWith(".canvas")` skip.
- **Suspected problem class:** missing integration (guard applied at one of three entry points)
- **Regression hint:** WP6 added `if (path.endsWith(".canvas")) continue;` at `background-sync.ts:64` inside `startAll` only.

### F2 — `rename` to a `.canvas` does the same, and is **not** role-gated

- **Severity:** HIGH
- **Affected flow:** US5 AC1
- **Test level:** integration
- **Test executed:** `... -t "J2"`
- **Step that failed:** the real `rename` handler with `settings.role = "guest"`
- **Expected behavior:** no `Y.Text` doc for `board2.canvas`
- **Observed behavior:** `syncManager.docs.has("board2.canvas") === true`
- **Why it is worse than F1:** the `create` path's `onFileAdded` call sits inside `if (role === "host")`. The rename path's `plugin.backgroundSync.onFileRenamed(oldPath, file.path)` (`vault-events.ts:207`) sits **outside** that check, so **every** peer that observes an unmuted rename creates the doc. `onFileRenamed` (`background-sync.ts:211+`) gates on `isPathSafe` and `isTextFile` only, then calls `getDoc(normNew)` and `attachObserver`.
- **Suspected problem class:** missing integration

### F3 — the exclusivity invariant is observably broken

- **Severity:** HIGH
- **Affected flow:** US5 AC1 (the invariant itself)
- **Test level:** integration
- **Test executed:** `... -t "J3"`
- **Step that failed:** with `CanvasSync` genuinely subscribed (`canvasOwned(path, cs) === true`), a `create` event for the same path
- **Expected behavior:** `canvasOwned(path) && syncManager.docs.has(path)` is never both-true
- **Observed behavior:** both true simultaneously
- **Note:** this is the state BUILD_SPEC § 6.1 declares impossible. It also invalidates the stated rationale for accepting **R10** — the handover justifies the raw-text fallback as *"exclusive (never concurrent with `CanvasSync`)"*. On this path it is concurrent.

### F4 — BLAST RADIUS: the leaked document actually writes the `.canvas` to disk

- **Severity:** HIGH
- **Affected flow:** US5 AC13 — "CRDT→disk has exactly one implementation for a canvas-owned path"
- **Test level:** integration
- **Test executed:** `... -t "J4"`
- **Step that failed:** a remote delta on the leaked `Y.Text` doc, with `CanvasPersistence` attached to the same path
- **Expected behavior:** 0 `adapter.write` calls for `board.canvas` from `BackgroundSync`
- **Observed behavior:** 1 write — `expected 1 to be +0`
- **Mechanism:** `attachObserver` (`background-sync.ts`) → `scheduleDiskWrite` → `writeToDisk` → `adapter.write`, running concurrently with `CanvasPersistence`'s own write queue. The two writers have **independent** debounces, **independent** `lastWrittenContent` baselines and **independent** write queues, so nothing orders them.
- **Escalation path to the original corruption:** once two peers are both on that `Y.Text` — reachable when one peer's `CanvasSync.subscribe` fails and takes the announced R10 fallback, or when a second peer performs its own create/rename — `applyMinimalYTextUpdate` character-merges two concurrently-rewritten JSON files. That is the byte-interleaving that produced the unparseable canvas in `canvas-single-writer.test.ts`'s HEAD red.

---

## Fix Priority

| Fix ID | Severity | Suspected root cause | Recommended approach |
|---|---|---|---|
| F1 | HIGH | `BackgroundSync.onFileAdded` has no `.canvas` skip | Apply the same guard `startAll` already has |
| F2 | HIGH | `BackgroundSync.onFileRenamed` has no `.canvas` skip, and its caller is not role-gated | Same guard on the new path |
| F3 | HIGH | Consequence of F1/F2 — the invariant has no single chokepoint | Consider centralising the skip in `BackgroundSync.subscribe` so every entry point inherits it |
| F4 | HIGH | Consequence of F1/F2 | Covered by fixing F1/F2 |

**Recommended shape.** The narrowest correct fix is a guard in `BackgroundSync.subscribe(rawPath)`
itself, so all three entry points (`startAll`, `onFileAdded`, `onFileRenamed`) inherit it — **but**
`subscribe` is *also* the deliberate R10 fallback entry point (`subscribeCanvasWithHandover` calls
`backgroundSync.subscribe(path)` on a failed CanvasSync subscribe, and
`background-sync.test.ts:134` pins that behaviour). So a blanket guard there would break the
fallback. Two options for W3:

- **Option A (minimal, mirrors the existing pattern):** add `if (path.endsWith(".canvas")) return;`
  to `onFileAdded`, and the equivalent early return to `onFileRenamed` after its cleanup of the old
  path but before `getDoc(normNew)`. Leaves `subscribe` as the single explicit fallback door.
- **Option B (stronger invariant):** give `subscribe` an explicit `opts: { allowCanvasFallback?: boolean }`
  and require the fallback caller to pass it. Makes the exclusivity structural rather than
  by-convention, at the cost of touching the handover helper's call.

W3 owns the choice. Do not simply delete `background-sync.test.ts:134` — that case pins a real
required behaviour.

---

## Notes for Worker 3

- The **steady-state flow is correct** and is fully covered: an existing `.canvas` listed in the
  manifest and opened during a session goes through `startAll`'s skip, is canvas-owned, has exactly
  one disk writer, and converged cleanly in the live two-instance rig. This defect is confined to
  the **create** and **rename** entry points.
- `onFileRenamed` needs care: it performs teardown of the OLD path (timers, observer, `releaseDoc`)
  before deciding about the new path. The early return must come **after** that cleanup, or a
  rename away from a text file will leak the old observer.
- Regression coverage for this now exists in `plugin/src/__tests__/w4-canvas-integrity.test.ts`
  (`J1`–`J4`). They are written to go green when the guard is added; no test change should be
  needed. Please do not weaken them into "the doc exists but is unused" assertions — F4 proves the
  doc is not unused.
- Two adjacent coverage gaps were found in the same sweep but are **not** defects and are **not**
  part of this fix request: the `MAX_WAIT_MS` cap was untested (it works — new probe `G5` proves a
  write lands mid-churn), and the third `GEOMETRY_KEYS` copy at `canvas-model-bridge.ts:94` is not
  in the drift guard (dormant while `useCanvasBinding` is `false`).
