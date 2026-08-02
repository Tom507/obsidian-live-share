# Worker 3 Handover — B11: Divergent-row amendments (WP60, WP61)

**Batch:** B11
**Scope:** WP60, WP61 **only**. WP59 and WP62 were **out of scope** for this run — the Dispatcher is
holding them until batch B3 closes.
**Status returned:** `HANDOVER_READY`

---

## Scope of This Run

Tasks completed: **WP60, WP61**
Tasks with risk flags: **none**

Both WPs are test-side amendments licensed under `BUILD_SPEC_CanvasV2.md` §7. **No production code was
changed by either.** The hard file boundary held: everything touched is under
`workflowArtifacts/canvas-v2/**`, plus read-only inspection of `plugin/src/testing/e2e-control.ts`.
Batch B3's territory (`plugin/src/canvas/**`, `plugin/src/files/**`, `plugin/src/sync/**`) was never
opened. No `ESCALATE_TO_WORKER2` was needed.

## Risk Summary

| WP | Status | risk_flag | Priority for W4 |
|---|---|---|---|
| WP60 | DONE | NONE | NORMAL |
| WP61 | DONE | NONE | NORMAL |

---

## Per-Task Detail

### WP60 — WP44 set2 import-surface pin amendment

- **Status:** DONE
- **Changed files:** `tests/blind_set2/WP44/test_tp12_no_server_no_port_blind2.test.ts` (one assertion
  + title + preamble prose); `BUILD_SPEC_CanvasV2.md` §7 (one row); `BlindVerificationLedger.md`
- **Amendment:** `toEqual(new Set(["node:http"]))` → `toEqual(new Set(["node:crypto", "node:http"]))`
- **Unit test status:**

  | Test Set | Collected | Pass | Fail |
  |---|---|---|---|
  | blind_set2 (vitest, depth 3) | 25 | 25 | 0 |

- **Test count:** 5 `it(...)` before, 5 after. Count unchanged; the other four tests byte-identical.
- **Risk flag:** NONE. The test reads the module as *text* and never imports it — immune to
  module-graph and timing effects.
- **Open assumption (one, and it is already someone's job):** the ruling depends on `src/testing/`
  continuing to tree-shake out of the production bundle. **Not assumed — measured by `W4-1`** in
  `TaskCharter_WP46` §7b, which Worker 4 must re-run. A non-zero match count there reopens this
  amendment. See "For Worker 4" below.
- **Priority for Worker 4:** NORMAL

### WP61 — WP49 quiescence blind amendments and fixture repairs

- **Status:** DONE
- **Changed files:** five blind test files under `tests/blind_set{1,2}/WP49/`;
  `T3_SharedContract.md` §6 (one contract statement); `BUILD_SPEC_CanvasV2.md` §7 (five rows);
  `BlindVerificationLedger.md` (two rows + the "2-key" → "4-key" correction)
- **Unit test status:**

  | Test Set | Collected | Pass | Fail |
  |---|---|---|---|
  | blind_set1 (vitest, depth 2) | 32 | 32 | 0 |
  | blind_set2 (vitest, depth 2) | 34 | 34 | 0 |

- **Test count:** 32 and 34, **identical before and after**. All 61 previously-passing tests across the
  two sets still pass, unmodified.
- **Risk flag:** NONE
- **Priority for Worker 4:** NORMAL

---

## Amendment ledger entries — file + line + why-stale + strictness after

All six are entered in `BUILD_SPEC_CanvasV2.md` §7. Summarised here; full text in the BUILD_SPEC and in
`ImplementationReport_WP60.md` / `ImplementationReport_WP61.md`.

| # | WP · class | File · line | Why stale / unsatisfiable | Strictness after |
|---|---|---|---|---|
| 1 | WP60 | `tests/blind_set2/WP44/test_tp12_no_server_no_port_blind2.test.ts:74-77` (+ preamble `:1-8`) | Self-imposed tightening beyond AC4, whose subject is `resolvePort` and whose dependency language means **runtime packages**. The visible counterpart's allow-list (`…visible.test.ts:111-131`) already skips every `node:` specifier; `node:crypto` has one use site, the `canvas.file` sha256 that `T3_SharedContract` §6.1 mandates. | Exact whole-set `toEqual` over both builtins. No subset / `arrayContaining` / pre-filter / skip. |
| 2 | WP61 · **A** | `tests/blind_set1/WP49/test_tp4_timeout_semantics_preserved_blind1.test.ts:71` (advances `:77`, `:82`) | Stale vs WP49 AC1's **deliberate** sleep-first poll. `timeoutMs 0` = expire at the earliest opportunity, still one 20 ms poll; the test advanced 10 ms so the promises never settled (died on vitest's 5 s timeout). | Both `toEqual` verdicts **verbatim**; only the advance moved 10 → 20 ms. |
| 3 | WP61 · **A** | `tests/blind_set2/WP49/test_tp1_peer_origin_blocks_quiescence_blind2.test.ts:49` (advances `:62`, `:69`) | Same cause; 5 ms advances against a 20 ms poll. | Both `toEqual` verdicts **verbatim**; advances 5 → 20 ms. |
| 4 | WP61 · **B** | `tests/blind_set2/WP49/test_tp3_control_edit_still_bumps_blind2.test.ts:83` (assertion `:87-92`) | Pinned the pre-WP46 four keys; `sessionInfo()` returns nine (`e2e-control.ts:832-850`), pinned in `T3_SharedContract:199` + §6.2. Third instance of a pattern licensed twice for WP46. | Whole-object exact `toEqual` over **all nine** keys with honest-degradation values; `E2E_BUILD_MARKER` imported, not hardcoded. **Stricter than before** — now also pins the AC3 degradation contract. |
| 5 | WP61 · **C** | `tests/blind_set2/WP49/test_tp2_user_origin_blocks_quiescence_blind2.test.ts:84` (fixture `:89-92`) | **Unsatisfiable as authored — arithmetic below.** | `{quiescent: false}` `toEqual` **verbatim**; fixture retimed only (budget 120 → 25 ms, pre-edit advance 20 → 10 ms). |
| 6 | WP61 · **C** | `tests/blind_set2/WP49/test_tp10_absent_file_not_created_blind2.test.ts:64` | **Unsatisfiable as authored — library path below.** | `toBeNull()` — admits exactly one value where the substring check admitted every non-`"stale"` string. **Strictly stronger.** |

### Class C mechanism proofs (the conditional licence)

The §7 third class licences a repair **only if the mechanism is demonstrated**. Both are, and both were
*observed* in the pre-repair run rather than only reasoned about.

**#6 — `test_tp10:64`, `expect(result.content).not.toContain("stale")` on a `null` receiver.**
Line 63 already pins `content: null` — exactly what production returns (`e2e-control.ts:971-973`) and
what `T3_SharedContract` §6.1 mandates. The path through the installed libraries:
`@vitest/expect/dist/index.js:1245` skips the string/string fast path (receiver is not a string);
`:1249` (`actual != null`) skips the jest-compat `Array.from` conversion, so the object flag stays
`null`; `:1252` delegates to chai's `include`; `chai/index.js:2067-2074` matches no case for a `null`
object, enters `default`, and **`throw`s** because `val !== Object(val)` for the primitive `"stale"`.
It *throws* rather than routing through `this.assert()`, so chai's `negate` flag is never consulted —
**`.not` is irrelevant.** Observed verbatim pre-repair:
`AssertionError: the given combination of arguments (null and string) is invalid for this assertion`
at `@vitest/expect/dist/index.js:1252:15`. **The contradiction is internal to the test:** making line 64
pass requires returning a string, which breaks line 63 and violates §6.1.

**#5 — `test_tp2:84`, the poll-boundary race.**
Let t0 be the `waitQuiescent(120)` call. The preceding `advanceTimersByTimeAsync(400)` leaves
`lastActivity ≤ t0−400`; `deadline = t0+120`. The loop's first `setTimeout(r, 20)` fires at **exactly
t0+20** — the instant the next line's `advanceTimersByTimeAsync(20)` lands on — and that call drains
microtasks, so the poll body runs *inside* it: `idleFor = 420 ≥ quietWindowMs (50)` → returns
`{quiescent: true}` **before** the `put` on the following line executes. With the chartered
`pollMs = 20` / `quietWindowMs = 50` no implementation can answer `false`; a shorter poll answers
`true` sooner, and the pre-WP49 evaluate-before-sleeping ordering (which AC1 forbids) answers `true` at
t0, earlier still. Observed verbatim pre-repair:
`AssertionError: expected { quiescent: true } to deeply equal { quiescent: false }` at `:94`.
After the retiming: edit at t0+10 (before the first poll) → poll t0+20 sees `idleFor = 10 < 50` and
`20 < 25` so it waits; poll t0+40 sees `idleFor = 30 < 50` and `40 ≥ 25` so it answers `false`. The
**deadline** decides, which is exactly what the test's title claims.

---

## Falsification evidence — I tried to break my own work

Harness: `workflowArtifacts/canvas-v2/_falsify_b11.py`. Because `plugin/src/testing/e2e-control.ts`
carries **pre-existing uncommitted changes**, `git checkout --` is not a safe restore path; the harness
snapshots the exact bytes and asserts the sha256 after **every** perturbation.

| # | Perturbation | Expected red | Result |
|---|---|---|---|
| P1 | add a `node:util` import to `e2e-control.ts` | WP60 builtin pin | **red, nothing else** |
| P2 | `deadline = now + (timeoutMs \|\| 2000)` | class A #2 **and** #3 | **both red, nothing else** |
| P3 | `canvasSurface: false` | class B #4 | **red, nothing else** |
| P4 | absent-file `content: null` → `""` | class C #6 | **red** + 1 independent sibling |
| P5 | activity seam made origin-aware (WP49 AC1 violation) | class C #5 | **red** + 1 independent sibling |

**Every amended assertion went red under the perturbation of the surface it pins.** Two runs also
reddened an *untouched* test; both are independent pre-existing pins firing on a genuine contract
violation, not amendment damage:

- P4 also hit `test_tp9_file_read_is_readonly_blind2.test.ts`, which carries its own
  `expect(missing.content).toBeNull()` — the same §6.1 value, redundantly pinned. (This is also
  corroboration that `toBeNull()` is the house-correct strict form for repair #6, not an invention.)
- P5 also hit the *other* test in `test_tp2`, which likewise depends on user-origin activity marking.

**Restore:** all three sets re-run **green (0 failures)** on the restored tree, and
`e2e-control.ts` hashes to `6101d642…8c9fc` — byte-identical to the snapshot. **Confirmed restored
byte-clean.**

---

## Test counts for my scope, with foreign failures stated separately

Every count below is an **executed** count from the WP55 runner's structured reporter artefact, per the
blind-set execution gate. No set is reported green without one.

| Gate | Collected | Pass | Fail |
|---|---|---|---|
| WP44 blind_set2 (vitest) | **25** | 25 | 0 |
| WP49 blind_set1 (vitest) | **32** | 32 | 0 |
| WP49 blind_set2 (vitest) | **34** | 34 | 0 |
| Visible regression gate (`_run_visible.py`: `e2e-control` + wp46/wp47/wp49/t3-wp44) | **158** | 158 | 0 |
| `npx tsc -noEmit` (plugin) | — | exit 0, **0 errors** | — |

**Foreign failures in my scope: none.** All three blind sets and the visible gate are fully green.

Two environment facts confirmed rather than assumed:

1. **The WP58 build blocker does not reproduce.** `tsc -noEmit` measured **0 errors**, run with no
   blind run in flight. No `v2blind` / `_blind[12]` path appeared, so nothing was misrecorded as a
   build failure.
2. **The staging hazard is real and was respected** — every `tsc` and every blind run in this batch was
   serialised, never overlapped.

---

## For Worker 4

- **`W4-1` (in `TaskCharter_WP46` §7b) is now load-bearing for WP60.** It measures that `src/testing/`
  tree-shakes out of the production bundle (guard grep `e2e-control|LIVESHARE_E2E|e2eControlPort` → **0
  matches** in the production `main.js`). WP60's ruling — that `node:crypto` is not a forbidden
  dependency — holds *because* the whole testing tree leaves the bundle. **If `W4-1` returns a non-zero
  match count, WP60's amendment must be revisited.** This is the one open assumption in the batch and
  it is already chartered as W4-1; no new WP is needed.
- Nothing else here needs probing. Both WPs are test-side restatements with unchanged counts, and every
  amended site has been individually falsified.

## Still open, deliberately, outside this batch

- **WP59 and WP62** — held by the Dispatcher until B3 closes (they touch B3's live territory).
- **WP47's double-`pytest.raises`** (`tests/blind_set2/WP47/test_tp04_teardown_exit_paths_blind2.py`,
  2 points) — the **Python twin** of the class-C defect repaired here. Explicitly out of WP61's scope
  (§2). §7's third class now gives it a route; it needs its own charter. It is tracked as **OPEN** in
  the §7 third-class table.
- After this batch the blind ledger stands at **51 CONFIRMED / 1 DIVERGENT**; the single remaining
  DIVERGENT row is `WP3 set2`, which is WP59's job.

## Summary for Worker 4 Entry Point

Nothing new is observable at runtime — this batch changed no production behaviour. What changed is the
**evidence base**: three blind sets that were DIVERGENT are now CONFIRMED with recorded executed counts
(25 / 32 / 34), and the six restated assertions are enumerated in the §7 amendment ledger with file,
line, why-stale and post-amendment strictness. The one genuinely new artefact is a **contract
statement**: `T3_SharedContract.md` §6 now pins `timeoutMs = 0` semantics — *expire at the earliest
opportunity, answered after the first poll, never from pre-call history, costing one 20 ms poll* —
which closes the spec gap that let a blind test and the implementation each hold a defensible but
incompatible reading. The user-visible consequence is stated rather than buried: a zero-budget
quiescence probe costs 20 ms rather than returning for free, so rig code that assumed a free probe pays
that per call.

## Automation candidates

`_falsify_b11.py` generalises. It is a snapshot → perturb → run → restore → sha256-verify loop over a
table of `(anchor, replacement, expected-red-titles)` triples, and it caught two *desirable* collateral
reds that a looser check would have missed. Worth promoting to a standing tool alongside
`_run_blind.py --selftest` for any future amendment batch: an amendment that cannot be falsified is
indistinguishable from a weakening.
