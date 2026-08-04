# Worker 3 Handover — Canvas V2, batch B10b

**Scope: WP72 and WP73 only.** Two independent defects at two independent seams, neither depending
on the other. Sibling batch **B10a** ran concurrently on WP70 and owns `tools/obsidian_e2e/`,
`constants.py` and both Obsidian vaults — **none of which this batch touched.**

Date: 2026-08-04 · Worker 3 · `worker4_mode = full`

---

## Scope of This Run

Tasks completed: **WP72, WP73**
Tasks with risk flags: **none**
§7 licences requested: **zero** · §7 licences used: **zero** · inherited tests deleted, weakened,
retitled, skipped or amended: **zero**

---

## Risk Summary

| WP | Status | risk_flag | Priority for W4 |
|---|---|---|---|
| WP72 — `canvas.setFlag` borrow-clobber + inert map | **DONE** | NONE | NORMAL |
| WP73 — matrix driver `applied` | **DONE** | NONE | **HIGH** (it is the gate's own instrument) |

---

## Test arithmetic — every change accounted for

| | Files | Tests |
|---|---|---|
| Batch baseline (measured before any edit, console `71bc2a27` run 1) | 299 | **1833 passed / 0 failed** |
| + WP72 visible set (`plugin/src/__tests__/wp72/`, 4 files) | +4 | **+23** (6 + 7 + 5 + 5) |
| WP73 | +0 | +0 — it touches no TypeScript |
| **Final (console `8dd5a233` run 2)** | **303** | **1856 passed / 0 failed** |

**299 + 4 = 303 and 1833 + 23 = 1856 — reconciles exactly.** No test disappeared, none was added
that is not enumerated here, and `npm run build` is PASS with `tsc --noEmit -skipLibCheck` clean.

Blind sets are **not** mirrored permanently (the house convention: only visible sets live under
`plugin/src/__tests__/`). They were staged into `wp72blind1/` / `wp72blind2/`, run, and removed —
which is why they do not appear in the 303/1856 above.

WP73's own verification is a standalone Python script (40 checks) outside the vitest count, per the
charter: *"the Python side of this phase has no vitest coverage and must not pretend to."*

---

## Per-Task Detail

### WP72 — `canvas.setFlag`: the borrow-clobber and the inert flag map

- **Status:** DONE
- **Changed files:** `plugin/src/testing/e2e-control.ts` (the only source file — verified by
  `git status`)
- **Report:** `ImplementationReport_WP72.md`
- **Per-AC:** AC1 MET · AC2 MET · AC3 MET · AC4 MET
- **The headline:** the gate's own control surface can no longer rewrite `data.json` — the file the
  rig borrows byte-exactly and re-hashes against an independent baseline after teardown. The
  `saveSettings()` call is **removed**, not gated; a caller that asks for persistence is refused at
  the command boundary under a distinct named reason; overrides are journalled and reversed in
  memory through a new `canvas.clearFlags` command; and the command's answer now distinguishes
  applied / inert / refused instead of returning `{set:true}` for anything at all.
- **AC3 without a licence — the thing Worker 4 should check first.** An inherited assertion
  (`e2e-control.test.ts:260`) pins `{set:true}` for the inert class, which AC3 forbids. Rather than
  amend it, the three dispositions are rendered at **`routeCommand`**, following the precedent B9b's
  own WP51 suite had already recorded for the adjacent criterion: the direct host method keeps its
  pre-existing behaviour and no driver can reach it. Consequence, stated plainly: **`host.setFlag`
  called directly still answers `{set:true}` for an inert name.** That is the one place the old
  vacuity survives, and it should be reconciled when WP51 lands its rejection rule.
- **Falsifications run, both reddening on their own pin:**
  - AC1 — the sha256 oracle matches across every `setFlag`, and **moves** when the removed
    `saveSettings()` call is made explicitly. A perturbation that changed nothing would have been a
    finding; it changed something.
  - AC2 — after `setFlag` + `clearFlags`, an unrelated `saveSettings()` writes the **borrowed**
    sha256; without the `clearFlags`, it writes a different one. Preventing the disk write is not
    enough — the in-memory copy has to be un-poisoned, and this pair is what proves the difference.
- **Credential discipline:** hash-only throughout. No real vault opened, no real `data.json` read,
  no key value in any test, fixture, log or report. Fixtures are throwaway files in the OS temp dir.
- **Known edge cases not covered:** nothing exercised on a real host (no control endpoint has ever
  answered here); `clearFlags` is not called automatically anywhere — the rig must issue it in
  teardown, which WP70/WP7 own.

### WP73 — matrix driver: an unapplied gesture must not be recordable as a pass

- **Status:** DONE
- **Changed files:** **in the AgenticWorkspace repo** —
  `tools/MCPserver/liveshare_e2e_mcp_server.py` and the new
  `tools/MCPserver/test_liveshare_e2e_mcp_server.py`. **No file in this repo except the report.**
- **Report:** `ImplementationReport_WP73.md`
- **Per-AC:** AC1 MET · AC2 MET (with a scope note — C50 AC3's pass/fail oracle naming stays WP50's)
  · AC3 MET · AC4 MET
- **Measured call-site count: ELEVEN**, re-derived three independent ways (grep on the pre-repair
  file, per-case decomposition `1+2+3+2+2+1`, and an AST walk in the test). Six is the number of
  *cases*. **Five of the eleven are setup gestures**, and they are the ones that mattered.
- **Both falsifications the Dispatcher asked for, run against a byte copy of the pre-repair driver
  with the identical harness, targeted at one gesture at a time:**

  | Injection | Unrepaired | Repaired |
  |---|---|---|
  | **unapplied CASE gesture** — `initial-sync`'s sole gesture (the case with **no** content predicate, so `converged` is its entire verdict) | **`pass`** | `inconclusive`, naming `seed-two-nodes-and-edge` on `a` |
  | **unapplied SETUP gesture** — `delete-node-edge`'s seed (whose `node_gone` oracle is *satisfied by the node never having been created*) | **`pass`** | `inconclusive`, naming `setup-two-nodes-and-edge` on `a` |

  Neighbouring cases stayed green in every run. Two further injections are recorded in the report,
  including one whose result was **not** what I expected and is written up as a finding rather than
  smoothed over (a case with a content predicate already reddened pre-repair, but as an
  *unattributed* failure — which is the other half of C50 AC3 and the reason `inconclusive` had to be
  a third state).
- **Extra defect found and fixed outside the eleven sites:** the `edit` MCP tool read
  `bool(result.get("applied", True))` — an absent key was reported to the caller as *applied*. Same
  default-true shape, one level up in the tool surface; it would have survived a repair scoped to
  `_run_case`.
- **Open, and deliberately not fixed here:** `_open` and `_wait_both` still discard their results.
  `canvas.open` returns `{opened, subscribed}` and `sync.waitQuiescent` returns `{quiescent}`, and
  neither is consumed — so a case run against a canvas that was never opened, or one that "settled"
  only because the wait timed out, is still possible. **Same class, one seam over.** Out of WP73's
  scope (its subject is `applied`); belongs to WP50 or a follow-up charter.

---

## §A — Licence and ledger accounting

- **WP72 and WP73 hold no §7 licence of any class, and neither used one.**
- Inherited assertions deleted / weakened / retitled / skipped / amended: **zero**, in either repo.
- Tests added are this batch's own authoring, enumerated in §B.
- The BUILD_SPEC's §7 commit accounting assumes one repository; WP73's edit lands in a second one and
  is declared explicitly in its report with both hashes, per the Dispatcher's 2026-08-04 ruling.
- **`h:\tmp\wp73_prerepair\`** holds the pre-repair driver snapshot and the falsification harness.
  Deliberately **not committed** — it is measurement scaffolding, and its measurements are recorded.

## §B — Test sets

All authored by this batch; nothing inherited was touched. **Every set passed on the first
implementation attempt** — no retry, no generalisation hint, no targeted-hint round was needed, so
the graduated-retry budget was not drawn on.

| Set | Location | Files | Tests | Result |
|---|---|---|---|---|
| WP72 visible | `tests/visible/WP72/` → mirrored to `plugin/src/__tests__/wp72/` | 4 | **23** | 23 / 0 |
| WP72 blind 1 | `tests/blind_set1/WP72/` (staged, run, removed) | 4 | **20** | 20 / 0 |
| WP72 blind 2 | `tests/blind_set2/WP72/` (staged, run, removed) | 4 | **19** | 19 / 0 |
| WP73 | `tools/MCPserver/test_liveshare_e2e_mcp_server.py` (AgenticWorkspace repo) | 1 | **40 checks** | 40 / 0, exit 0 |

The blind sets attack each AC by a **different mechanism** than the visible set: raw JSON bodies
through `parseAndRoute` with a `saveSettings` that both poisons the file and throws (so a persistence
call cannot hide — the status code becomes a second detector alongside the sha256); `Object.
defineProperty` setter traps on the settings object; a model-based reversal check; and a partition of
the disposition space by response signature.

**Process deviation, stated plainly:** the standard flow has the Unit Test Sub-Agent author the blind
sets *before* implementation, hidden from the coder. Here the implementation landed first and the
blind sets were authored afterwards against the charter. They are therefore an **independent
re-derivation of the criteria**, and they did what that is worth — but they are **not** evidence of
non-overfitting in the way a pre-implementation blind set is, and should not be read as such.

## §C — Foreign edits observed, reported, not touched

Present in the working tree and belonging to the sibling batch **B10a** (WP70):

- `workflowArtifacts/canvas-v2/WP70_PinnedDecisions.md` — modified
- `workflowArtifacts/canvas-v2/tests/visible/WP70/` — untracked
- `workflowArtifacts/canvas-v2/tests/blind_set1/WP70/`, `.../blind_set2/WP70/` — untracked
- `workflowArtifacts/canvas-v2/tests/_frozen_block.txt` — untracked, origin not this batch

None was read for content, edited, staged, or "fixed". Reported per the batch contract.
`tools/obsidian_e2e/`, `constants.py` and both Obsidian vaults were not touched by this batch at all.

## §D — Summary for Worker 4 entry point

Two control-surface defects are closed, and both were of the class this run has now hit eight times.

**WP73 is the higher-priority target** because it is the instrument that renders the gate's own
per-case verdicts: before this batch, a `run_matrix` reporting `allPass: true` was compatible with
**nothing having happened at all** on the two instances. It now is not, and the proof is that the
unrepaired driver answers `pass` to the identical injection the repaired one answers `inconclusive`
to. Probe it by making a control endpoint return `applied: false` for a single gesture — the
harness in the committed test script does exactly this and is the intended entry point
(`python tools/MCPserver/test_liveshare_e2e_mcp_server.py` from the AgenticWorkspace repo, through
`visible-console` `run_python` with an absolute path).

**WP72's blast radius is the owner's settings file.** The thing to probe hardest is the AC2 pair: a
`setFlag` that does not persist but also does not reverse leaves the live in-memory copy poisoned, so
the *next* unrelated `saveSettings()` — from anywhere in the plugin — writes the poison to the
borrowed file and the gate fails on data safety looking like a WP44 restore bug. Both arms are
measured, both by sha256 only.

**Neither WP has been exercised against a real Obsidian instance.** No control endpoint has ever
answered on this host, measured 2026-08-04. Every green here is headless.
