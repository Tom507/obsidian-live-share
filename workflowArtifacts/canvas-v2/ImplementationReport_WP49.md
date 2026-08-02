# Implementation Report — WP49: Real quiescence + file-level convergence oracle

**Status:** `DONE`
**WP:** WP49 (component C49, PHASE T3, phase P0)
**Attempt:** 1
**Changed files:** `plugin/src/testing/e2e-control.ts` (only)

---

## 1. Per-AC table

| AC | Statement (abridged) | State | Evidence |
|---|---|---|---|
| **AC1** | Quiescence observes document activity from **any** origin; a peer or user-interaction update keeps the instance non-quiescent until it settles | **MET** (headless half) | TC1–TC5, 15 tests. Relay-origin `Y.applyUpdate`, view-origin `doc.transact(..., "canvas-view-user")` and a 10-write drag burst all block quiescence; a control-initiated `simulateEdit` still behaves exactly as before; a doc the instance never opened does **not** block it. Real-host half is `INTEGRATION_SCOPE` (§7b.1, WP50/WP51). |
| **AC2** | Convergence assertable on the serialised `.canvas` bytes **in addition to** the doc; doc-green + disk-red **fails** under D17 | **MET** (pure half) | TC6–TC8, 9 tests. `evaluateCanvasConvergence` returns `{converged:false, docConverged:true, fileConverged:false, reason:"DOC_CONVERGED_FILE_DIVERGED"}` for the D17 class, `{converged:true, reason:null}` for honest green, and `{converged:false, reason:null}` for the inverse. Wiring it to two live endpoints is `INTEGRATION_SCOPE` (§7b.2). |
| **AC3** | The read-back reports what the plugin's writer produced and never writes, touches, re-serialises or normalises | **MET** (adapter-double half) | TC9–TC11, 8 tests over a real `mkdtempSync` temp dir. Every mutating adapter method is a throwing spy: none is called, bytes and `mtime` are unchanged, an absent file stays absent (no file, no folder), and a deliberately non-canonical `.canvas` (odd key order, unsorted ids, ragged whitespace, no trailing newline) comes back byte-for-byte with a digest over the bytes on disk. Real `DataAdapter` half is `INTEGRATION_SCOPE` (§7b.3). |
| **AC4** | Both oracles on the existing control protocol; no new transport, no new runtime dependency | **MET** | TC12, 6 tests. `canvas.file` routes through `routeCommand`/`parseAndRoute` on the existing `{ok:true,result}` / structured `400 {ok:false,error}` envelope. `plugin/package.json` dependency sets untouched (5 runtime deps). Module imports remain inside the allow-list; the one addition is the Node built-in `node:crypto`. Exactly one `createServer(` and one `.listen(` in the module. |

---

## 2. Blocked Items

**None for WP49.** No `TOOL_REQUEST`, no `ESCALATE`, no capability gap.

Three AC halves remain `INTEGRATION_SCOPE` by the charter's own §7b — they need a real
Obsidian instance and the two real vaults (WP50/WP51) and were never in this WP's reach.

### Inherited failures observed in the full suite — NOT caused by WP49

These are recorded so Worker 3 does not attribute them to this WP. WP49 changed no file
they touch, and none of them involves `sync.waitQuiescent` or `canvas.file`.

| Failing test | Cause | Owner |
|---|---|---|
| `src/__tests__/e2e-control.test.ts` → "sessionInfo maps settings + connection state" | `toEqual` on a four-field `session.info`; WP46 added the five §6.2 identity fields | WP46 |
| `src/__tests__/t3/wp44/test_tp11_resolveport_precedence_visible.test.ts` → "binds the numeric LIVESHARE_E2E port" | same four-field `session.info` `toEqual` | WP46 |
| `src/__tests__/v2/wp8/test_tp01..05` (5 files) | `Cannot find module '../../../canvas/canvas-schema'` — module not yet landed | other Worker 3 (`plugin/src/canvas/**`, out of bounds for WP49) |
| `src/__tests__/wp5/latency.test.ts` → "measurable RTT inside the 50–150 ms band" | wall-clock flake under parallel load: measured 154 ms vs a 150 ms ceiling. **Passes in isolation** (11/11) | legacy timing test |

No existing test was deleted, weakened, modified or skipped by WP49.

---

## 3. Changes Made

All in `plugin/src/testing/e2e-control.ts`. Every change is additive except the two noted
in §3.5.

### 3.1 AC1 — the activity seam moved from the command to the document

Before, `lastActivity` could only be moved from inside `canvas.simulateEdit`; both host
builders pass `bump = () => {}`, so a real instance reported itself settled while relay
deltas were still landing.

`buildPluginHost` now holds a `WeakSet<Y.Doc>` and subscribes `markActivity` to the
`update` event of the `Y.Doc` behind every canvas reached through `canvas.open` (and
through `simulateEdit`, so the two entry points agree on what "this instance's traffic"
means). Subscription is idempotent per doc and issues no transaction of its own.

The update origin is **never inspected**, which is the whole point: relay, canvas view and
control channel are equally visible. A doc the instance never opened is never observed, so
the negative control in TC5 holds — quiescence is an instance property, not a global one.
`hooks.bump()` now fires for any-origin activity, which is the widening of the `bump` seam
the charter asks for; the bootstrap hook itself stays `() => {}`.

### 3.2 AC1 — a wait now covers the interval it was asked about

`waitQuiescent` evaluated the idle window **before** its first sleep, so it answered out of
pre-call history: a caller that began waiting during an idle instant was told `true` even
if activity then continued for the whole timeout. The poll loop now sleeps first and
evaluates afterwards.

Unchanged: the command name, the `timeoutMs` argument, the router default of **2000**
(including the non-numeric/negative fallback), the 50 ms quiet window, the 20 ms poll, and
the `{quiescent}` result envelope.

### 3.3 AC2 — the pure convergence verdict

New exports:

- `DOC_CONVERGED_FILE_DIVERGED` — the T3 contract §7 enum string verbatim, so tests and
  the Python side import it instead of hardcoding a literal.
- `CanvasFileResult`, `CanvasObservation`, `CanvasConvergenceVerdict` — the shapes.
- `evaluateCanvasConvergence(a, b)` → `{converged, docConverged, fileConverged, reason}`.

Doc comparison is id-keyed and order-independent in both dimensions (array order and record
key order), mirroring `_compare` in the MCP driver; a record without a string `id` falls
back to its position so it can never silently match a different one. File comparison is
`exists`/`sha256`/`size`/`content` exact — **nothing is normalised**, because normalisation
is precisely what would hide the divergence this oracle exists to catch.

`reason` is the named constant **only** when `docConverged && !fileConverged`. When the docs
already disagree the doc oracle catches it, so the D17 name stays reserved for the run a
doc-only oracle would have passed — which is what makes it a diagnosis rather than a label.

### 3.4 AC3 — `canvas.file`, a read-back that structurally cannot write

- `CanvasFileAdapterLike` declares `exists` plus `readBinary?`/`read?` and **no mutating
  member at all**. That is the type-level half of AC3: no code path below can reach a
  writer even by accident.
- `resolveCanvasFileAdapter` narrows `plugin.app?.vault?.adapter` structurally, so the real
  `LiveSharePlugin` satisfies it as-is and `main.ts` needs no wiring (charter §7 note).
- `readCanvasBytes` prefers `readBinary` (exact) and falls back to `read` decoded back to
  the same bytes.
- Absent path → `{exists:false, sha256:"", size:0, content:null}`, resolved never rejected,
  with no further filesystem call. `content:null` is what distinguishes a missing file from
  an empty one and is never softened to `""`.
- Present path → `sha256` = lowercase hex over the raw bytes, `size` = their byte length,
  `content` = the bytes decoded as UTF-8. Nothing is parsed, re-serialised, sorted or
  re-indented; `mtime` is never touched; `stat` is not called.

### 3.5 The two non-additive lines, stated plainly

1. `waitQuiescent`'s poll loop was reordered (§3.2) — WP4-era code, in this WP's scope.
2. `buildPluginHost`'s **return type annotation** changed from `E2EScratchControlHost` to
   `E2EFileControlHost`. This was unavoidable: the visible tests call `host.canvasFile(...)`
   on the value `buildPluginHost` returns, which requires the member to be non-optional
   there, while `E2EControlHost` must keep it optional or the three pre-WP49 hand-rolled
   `fakeHost()` literals stop compiling. `E2EFileControlHost extends E2EScratchControlHost`,
   so WP47's contract is intact — anything that accepted the scratch host still accepts
   this one, and `E2EScratchControlHost` itself is byte-identical.

### 3.6 AC4 — one case, one built-in import

`case "canvas.file"` sits in the existing `routeCommand` switch after WP47's two scratch
cases and before `default`, validating `path` with the existing `requireString` (so a
missing `path` is the existing structured 400) and treating an absent host method as a
structured 400 rather than a crash. The only new import is `node:crypto`.

### 3.7 WP46 / WP47 preservation

Verified by exact-substring match against the pre-change text, all present and unmodified:
`E2E_BUILD_MARKER`; the five optional identity fields on `E2EControlHost.sessionInfo()`;
the `sessionInfo` body; WP46's resolvers; WP47's `SCRATCH_*` constants, `isScratchPath()`,
`ScratchAdapterLike`, the optional `scratchCreate?`/`scratchRemove?` members,
`E2EScratchControlHost`, `requireScratchPath()`, the two router cases, `scratchAdapter?`,
`isScratchAdapter()`/`resolveScratchAdapter()` and both method bodies. WP47's suite is
green (see §4). The single exception is the `buildPluginHost` return-type annotation
documented in §3.5.

### 3.8 Data safety

No vault path and nothing under `%APPDATA%\obsidian\` was opened. No `data.json` content
was read, printed or logged. The filesystem-touching tests use `mkdtempSync` under
`tmpdir()` and remove it in `afterEach`. Nothing was written into either owner vault.

---

## 4. Visible Test Results

Run from `plugin/` with `npx vitest run src/__tests__/wp49 --reporter=dot` (Vitest 4.0.18):

```text
Test Files  12 passed (12)
     Tests  36 passed (36)
  Duration  1.08 s
```

| TC | File | Tests | Result |
|---|---|---|---|
| TC1 | `test_tp1_peer_origin_blocks_quiescence_visible.test.ts` | 2 | PASS |
| TC2 | `test_tp2_user_origin_blocks_quiescence_visible.test.ts` | 2 | PASS |
| TC3 | `test_tp3_control_edit_still_bumps_visible.test.ts` | 3 | PASS |
| TC4 | `test_tp4_timeout_semantics_preserved_visible.test.ts` | 4 | PASS |
| TC5 | `test_tp5_multi_canvas_activity_tracked_visible.test.ts` | 2 | PASS |
| TC6 | `test_tp6_doc_converged_file_diverged_visible.test.ts` | 3 | PASS |
| TC7 | `test_tp7_honest_green_convergence_visible.test.ts` | 3 | PASS |
| TC8 | `test_tp8_files_agree_doc_diverges_visible.test.ts` | 3 | PASS |
| TC9 | `test_tp9_file_read_is_readonly_visible.test.ts` | 2 | PASS |
| TC10 | `test_tp10_absent_file_not_created_visible.test.ts` | 3 | PASS |
| TC11 | `test_tp11_no_normalisation_bytes_verbatim_visible.test.ts` | 3 | PASS |
| TC12 | `test_tp12_existing_protocol_no_new_dependency_visible.test.ts` | 6 | PASS |

No visible test was edited. None contradicts the charter.

### Type check

`npx tsc -noEmit -skipLibCheck` from `plugin/`:

| | Before | After |
|---|---|---|
| errors in `src/__tests__/wp49/**` | **17** | **0** |
| errors elsewhere | 4 (`v2/wp8`, missing `canvas/canvas-schema`) | 4 (unchanged, not WP49's) |

### Build

`node esbuild.config.mjs production` → exit 0. `main.js` is **651991 bytes before and
after**, and `grep -c -E "e2e-control|LIVESHARE_E2E|e2eControlPort" main.js` → **0**. The
production footprint of this WP is exactly zero; the module still tree-shakes out whole.
`npm run build` as a whole cannot pass only because its `tsc` step hits the four
pre-existing `v2/wp8` errors above, which belong to another worker.

### Full plugin suite

`npx vitest run` → **1096 passed, 4 failed (1100)**. All four failures are the inherited
ones itemised in §2; the `wp5/latency` one passes in isolation (11/11).

---

## 5. Summary for Worker 3

WP49 is complete and green. Quiescence is no longer a statement about the control channel —
it is a statement about the shared document, so a peer delta or a user's drag now keeps the
instance non-quiescent exactly as a control-initiated edit does, and a wait now covers the
interval it was asked about rather than the instant it was asked in. `canvas.file` gives the
run a second, durable projection: it reports the bytes the plugin's own writer produced,
through an adapter view that has no mutating member on it at all, and
`evaluateCanvasConvergence` fails a run that agrees in the doc but not on disk under the
named `DOC_CONVERGED_FILE_DIVERGED`. Both ride the existing `POST /command` envelope; the
only new import in the whole WP is the Node built-in `node:crypto`, and the production
bundle is byte-for-byte the same size it was.

Three things worth carrying forward:

1. **The `buildPluginHost` return type is now `E2EFileControlHost`** (extends
   `E2EScratchControlHost`). Anyone adding a further optional host method should follow the
   same ladder rather than making the member required on `E2EControlHost` — that is what
   keeps the pre-WP46 `fakeHost()` literals compiling.
2. **Two existing tests are red because of WP46, not WP49** (`e2e-control.test.ts` and
   `t3/wp44/test_tp11_...`). Both assert a four-field `session.info` with `toEqual`. They
   need a decision from Worker 3: either WP46 updates them, or the batch accepts them as a
   known break. WP49 deliberately left them untouched.
3. **The headless half of every AC is as far as unit tests reach.** The remaining halves
   (real relay/view paths, two live vaults, Obsidian's real `DataAdapter`) are §7b
   `INTEGRATION_SCOPE` and blocked on WP50/WP51 installing a dev build — the currently
   installed build is production and has no control server at all (T3 contract §1.1).
