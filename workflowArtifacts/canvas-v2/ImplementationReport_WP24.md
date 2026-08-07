# Implementation Report — WP24

**Attempt:** 1
**WP:** WP24 — Sidecar store core (C24), phase P2
**Module created:** `plugin/src/files/canvas-sidecar.ts`

## Status: DONE

All 13 visible test files (76 tests) pass. `npx tsc --noEmit -skipLibCheck` is clean. Full
plugin suite: **1424 passed / 0 failed / 244 test files**, 0 pre-existing tests red.

---

## Completed Work

| AC | Status | Notes |
|---|---|---|
| AC1 — append to `<guid>.yhistory`, full-state checkpoint to `<guid>.ycheckpoint`, truncate only after the checkpoint is durable | DONE | `append` issues exactly one `io.append` of one `u32BE-length ‖ payload` frame; the history path is never the target of `write`/`read`/`remove`. `checkpoint` encodes `Y.encodeStateAsUpdate(doc)` synchronously, `await`s `io.write`, and only then issues `io.truncate` — sequentially, never `Promise.all`. A rejected write propagates and leaves the history untouched. |
| AC2 — load reconstructs the pre-unload state; loading is idempotent | DONE | Checkpoint + every history frame are merged with `Y.mergeUpdates` and applied in ONE `Y.applyUpdate(doc, merged, SIDECAR_LOAD_ORIGIN)`. Idempotence comes from Yjs plus a strictly read-only load: `exists`/`read` only, no `ensureDir`, no repair write. |
| AC3 — missing / truncated / corrupt is a defined degradation, never a throw, never a partial doc | DONE | Everything is decoded and validated against a throwaway probe `Y.Doc` *before* the caller's doc is touched; on any non-`NONE` verdict nothing is applied at all. `load` and `readIndex` are total functions — every path is wrapped so no byte sequence and no IO failure escapes as an exception. |
| AC4 — all file I/O injected; imports neither Obsidian nor `node:fs` | DONE | Single import: `import * as Y from "yjs"`. No filesystem, no Obsidian, no host global, no clock. Every byte moves through `SidecarIO`. |

### API surface (exactly the §7.0 contract, nothing more)

`SIDECAR_DIR`, `SIDECAR_HISTORY_EXT`, `SIDECAR_CHECKPOINT_EXT`, `SIDECAR_INDEX_FILENAME`,
`sidecarHistoryPath`, `sidecarCheckpointPath`, `sidecarIndexPath`, `isSidecarPath`,
`SidecarIO`, `SIDECAR_DEGRADATION`, `SidecarDegradation`, `SidecarLoadResult`,
`isSidecarDegraded`, `SIDECAR_LOAD_ORIGIN`, `SidecarIndex`, `SidecarStore`,
`createSidecarStore`. No other export is present.

### Per-guid serialisation (the gap no test catches)

`createSidecarStore` holds a `Map<string, Promise<unknown>>` of promise chains and runs every
mutating operation through `enqueue(key, task)`, where `key` is `doc:<guid>` for
`append`/`checkpoint`/`truncate`/`load` and a separate `index` key for
`readIndex`/`writeIndex`. The chain advances with `previous.then(task, task)` so a rejected
operation cannot wedge the guid's queue, the stored tail is `.then(noop, noop)` so no
unhandled rejection is created, and the map entry is deleted once it is the settled tail (no
unbounded growth). Two different guids never block each other.

`checkpoint`'s internal truncate calls a private `truncateHistory(guid)` rather than the
public `truncate()` — re-entering the queue from inside a task that holds it would deadlock.

**Falsified, not assumed.** A temporary counterfactual (`enqueue` degraded to `return task()`)
plus a temporary scratch test proved the failure the queue prevents: an `append` issued while
a checkpoint's `write` is still in flight lands in the history *before* the truncate, and the
truncate then destroys it — that update is absent from the checkpoint too, so it is lost
outright. Under the counterfactual the scratch test went red **while all 76 visible tests
stayed green**, confirming the batch brief's warning that the visible fakes cannot see this.
The counterfactual was reverted and the scratch test deleted; both are gone from the tree.

---

## Blocked Items

None.

---

## Tools Created

None. No `TOOL_REQUEST` was needed.

---

## Changes Made

| File | Change |
|---|---|
| `plugin/src/files/canvas-sidecar.ts` | **Created.** ~370 lines. The whole WP. Zero runtime dependencies added; `yjs` only. |
| `workflowArtifacts/canvas-v2/TaskCharter_WP24_SidecarStoreCore.md` | Charter Status `TESTS_ADDED` → `IN_PROGRESS` → `DONE`; §8 and §9 filled. |
| `workflowArtifacts/canvas-v2/ImplementationReport_WP24.md` | **Created** (this file). |

No existing production module was edited. No test file was created, edited or deleted.
`npm run build` was deliberately **not** run: it regenerates `plugin/main.js`, which is on the
batch's do-not-touch list. `tsc --noEmit` covers the compile gate without that side effect.

### Design notes worth carrying into WP25

- **Frame format** is `u32 BIG-ENDIAN payloadLength ‖ payload`, one frame per `io.append`.
  A zero-length frame is defined as corruption (no valid Yjs update is zero bytes), which is
  what lets a run of `0x00` bytes be told apart from a legitimate empty region.
- **`append` snapshots synchronously.** `encodeFrame` copies the caller's bytes before the
  first `await`, because the `Uint8Array` from `doc.on("update", …)` is a view Yjs owns and
  WP25 will forward socket-frame buffers straight through. This is the same defect the relay
  blob store already shipped once.
- **Verdict precedence in `load`:** checkpoint first and its verdict wins; then the history is
  frame-walked front to back, so whichever fault appears first in the file names the verdict.
  A tear (short header, or a declared payload running past EOF) is `TRUNCATED`; a structurally
  complete but undecodable frame, or a zero-length one, is `CORRUPT`. An empty *history* is
  `NONE` — that is a compacted sidecar, not a lost one, and WP29's seed decision depends on
  the distinction.
- **`isSidecarPath` is a `/`-boundary directory test**, not an extension test: `\` → `/`, one
  leading `./` or `/` stripped, case-sensitive, and the directory itself / its trailing-slash
  form / prefix-sharing siblings (`.../stateful/`) are all false. WP26 imports this and must
  not write its own predicate.

---

## Visible Test Results

`cd plugin && npx vitest run src/__tests__/v2/wp24` → **13 files / 76 tests, all PASS.**

| Test point | File | Result |
|---|---|---|
| TC1 — constants, path helpers, `isSidecarPath` | `test_tp01_path_and_predicate_contract_visible.test.ts` | PASS |
| TC2 — history is append-only | `test_tp02_append_is_append_only_visible.test.ts` | PASS |
| TC3 — checkpoint durable before truncate | `test_tp03_checkpoint_before_truncate_order_visible.test.ts` | PASS |
| TC4 — checkpoint is full state, not a delta | `test_tp04_checkpoint_is_full_state_visible.test.ts` | PASS |
| TC5 — load reconstructs the pre-unload state | `test_tp05_load_reconstructs_pre_unload_state_visible.test.ts` | PASS |
| TC6 — load is idempotent and read-only | `test_tp06_load_is_idempotent_visible.test.ts` | PASS |
| TC7 — missing sidecar degradation | `test_tp07_missing_sidecar_degradation_visible.test.ts` | PASS |
| TC8 — truncated history degradation | `test_tp08_truncated_history_degradation_visible.test.ts` | PASS |
| TC9 — corrupt bytes degradation | `test_tp09_corrupt_bytes_degradation_visible.test.ts` | PASS |
| TC10 — no partially applied doc | `test_tp10_no_partial_application_visible.test.ts` | PASS |
| TC11 — `index.json` round trip + degradation | `test_tp11_index_degradation_and_round_trip_visible.test.ts` | PASS |
| TC12 — injected IO / module purity | `test_tp12_injected_io_module_purity_visible.test.ts` | PASS |
| TC13 — append snapshots input before await | `test_tp13_append_snapshots_input_before_await_visible.test.ts` | PASS |

### Gates

| Gate | Result |
|---|---|
| `npx vitest run src/__tests__/v2/wp24` | 76 / 76 PASS |
| `npx tsc --noEmit -skipLibCheck` | clean, exit 0 |
| `npx vitest run` (full plugin suite) | **1424 passed / 0 failed / 244 test files**, 41.8 s |

**Delta vs. the stated pre-batch baseline (1346 passed / 0 failed).** 1424 − 76 (this WP) =
1348, i.e. **+2 tests this WP did not add**. Nothing went red. The most likely source is the
concurrent batch B16 (WP64), which the Shared Ownership Contract §6.6 says is editing
pre-existing test files in this same tree; `git status` shows 14 modified and 1 deleted
pre-existing test files that are not mine (including the licensed WP4 `tp08` deletion). Per
the brief those edits are foreign — reported, not touched. The baseline's "587 suites" figure
does not correspond to any number this runner reports (`--reporter=dot` reports 244 *test
files*), so the file-count comparison is not meaningful; the pass/fail comparison is.

---

## Summary for Worker 3

`plugin/src/files/canvas-sidecar.ts` now exists and is the single owner of the sidecar
directory, its three filenames, the path predicate WP26 consumes, the injected `SidecarIO`
seam and the `SidecarStore` API — exactly the §7.0 contract block, with no extra export. To
exercise it: `createSidecarStore(io)` over any object satisfying `SidecarIO`, then
`append(guid, update)` per Yjs update, `checkpoint(guid, doc)` to compact, `load(guid, doc)`
on cold open, and `readIndex()`/`writeIndex()` for the guid→path mapping. The observable
behaviour is: an append-only frame log, a full-state checkpoint that is written and *awaited*
before the history is truncated, and a load that either reconstructs the doc in one
origin-stamped transaction or applies nothing at all and hands back a `SidecarLoadResult`
naming the degradation. Rough edges for downstream: (1) the store also serialises `load`
behind the same per-guid queue as the mutating ops — the contract only pins the mutating
three, so WP25 should know a `load` will wait behind an in-flight `checkpoint` rather than
racing it; (2) an IO failure inside `load` is reported as `CORRUPT` (with a `detail` string)
rather than as a distinct verdict, because the pinned enum has no `IO_ERROR` member —
consumers must not treat `CORRUPT` as proof that bytes on disk are bad; (3) `checkpoint` and
`writeIndex` call `ensureDir` before writing, which is not in the pinned semantics but is
required for a first-ever checkpoint on a vault that has never had a sidecar; no test forbids
it and no assertion in this suite sees it. Per the contract §7, the sidecar is I/O lifecycle
and was deliberately **not** expressed as a WP23 fuzzer op class — it has no "which of two
states wins" question for the intent-trace oracle to judge.
