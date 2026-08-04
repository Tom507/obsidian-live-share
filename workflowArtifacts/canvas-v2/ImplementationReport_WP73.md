# Implementation Report — WP73 / C73

**Matrix driver: an unapplied gesture must be impossible to record as a pass**

Batch **B10b** · Worker 3 · 2026-08-04
Charter: `workflowArtifacts/canvas-v2/TaskCharter_WP73_MatrixDriverAppliedFlag.md`
Status: **DONE** · risk_flag: **NONE**

---

## 0. Location — the change is in a SECOND repository

Per the Dispatcher's 2026-08-04 ruling (`DISPATCHER_STATE.md`, "`liveshare_e2e_mcp_server.py` lives
in the AgenticWorkspace repo"), the charter's §3 `ESCALATE rather than choosing` is **discharged**:
the edit lands in the workspace repo, and the file does not move.

| | |
|---|---|
| Changed file | `h:\My Code\AgenticWorkspace\tools\MCPserver\liveshare_e2e_mcp_server.py` |
| Added file | `h:\My Code\AgenticWorkspace\tools\MCPserver\test_liveshare_e2e_mcp_server.py` |
| Repository | **AgenticWorkspace**, branch `toms_branch` (not a default branch) |
| This repo (`obsidian-live-share`) | **no source file changed by WP73** — only this report |

Both commit hashes are recorded in §7. §7 of the BUILD_SPEC's commit/abort accounting assumes one
repository and does not cover this by itself; the cross-repo edit is therefore declared here
explicitly, as the ruling requires.

The `tools/test_<name>.py` convention **is** honourable after all — `tools/MCPserver/` already holds
eleven `test_*.py` scripts beside their servers, so the verification script sits next to the file it
verifies. The charter's worry that it could not was written when the file's repository was recorded
wrongly.

---

## 1. The re-derived call-site count, and how it was obtained

The charter says *"do not repair by counting … re-derive it from the function, and state the number
you found."* Three independent derivations, all agreeing:

| Method | Result |
|---|---|
| `grep -n "_simulate(" liveshare_e2e_mcp_server.py` on the pre-repair file | 13 matches total: the `def` at `:122`, the `edit` tool's consuming call at `:258`, and **11** inside `_run_case` (`:340, 346, 349, 357, 359, 360, 368, 370, 378, 381, 389`) |
| Per-case decomposition, read off the branches | `initial-sync` 1 · `multi-edge-move` 2 · `bidirectional-drag` 3 · `add-node-edge` 2 · `delete-node-edge` 2 · `file-node` 1 = **11** |
| AST walk over `_run_case` in the repaired file, counting `gesture(...)` calls (`tp01a`/`tp01c`) | **11**, decomposing exactly as above |

**The measured count is eleven.** Six is the number of matrix *cases*. The five extra are
**setup** gestures — `multi-edge-move`'s hub-and-spokes seed, `bidirectional-drag`'s two-node seed,
`add-node-edge`'s first node, `delete-node-edge`'s two-nodes-and-edge seed, and
`bidirectional-drag`'s second concurrent move — and the falsification in §3 shows why a repair
scoped to six would have left the worst case open.

The count is now structurally irrelevant, which is the point: `_run_case` contains **exactly one**
`_simulate` call, inside the nested `gesture()` checkpoint, and `tp01b` asserts that from the AST.
A future call site cannot skip the check by construction rather than by review.

---

## 2. What changed

`liveshare_e2e_mcp_server.py`:

- **`_was_applied(result)`** — the only reading of a gesture's `applied` anywhere in the module.
  Identity-true: `result.get("applied") is True`. A missing key, `None`, `False`, `0`, `1` or
  `"true"` is **unapplied**. There is deliberately no default and no `bool()` coercion — *"a
  default-true read is the same defect wearing a default"*, and a cast is the same defect wearing a
  cast.
- **`GestureNotApplied`** — raised at the gesture site, carrying case · gesture · instance · the raw
  response. Raising rather than returning is what makes AC1 structural: the case **cannot** fall
  through to `_converge_and_check`, because control never reaches it.
- **`_run_case`** — all eleven gestures now go through a nested `gesture(label, instance, change)`
  checkpoint. Each gesture gained a human-readable label (`setup-two-nodes-and-edge`,
  `move-shared-endpoint`, `b-moves-y`, …) so the verdict can name it.
- **`verdict()`** — every decided case now reports `status` (`pass` | `fail`), the `oracle` that
  decided it, and the `gestures` it actually applied (instance-qualified). AC2's *"'both snapshots
  were equal' can never again be reported without saying whether anything was ever done to them"* is
  discharged positively, not only by the negative path.
- **`run_matrix`** — catches `GestureNotApplied` and records the case as
  `{"status": "inconclusive", "oracle": "gesture-applied", "gesture": …, "instance": …,
  "reason": "gesture-not-applied", "pass": False}`. `allPass` now reduces on
  `c.get("status") == "pass"`, so a case that is inconclusive — or one that omits `status`
  altogether — is not a pass. `pass: False` is still carried on every non-passing case, so a caller
  reading only the legacy key is fail-closed rather than misled. A new `inconclusive: [names]` list
  is returned alongside.

**`inconclusive` is a third state, not a renamed failure.** A case whose oracles disagree is
`fail` with its oracle named; a case whose gesture never applied is `inconclusive` with the gesture
named. Collapsing them would lose exactly the information the gate needs.

### Extra finding, fixed: the same default-true shape one level up

`edit` — the MCP tool, not `_run_case` — read `bool(result.get("applied", True))`. **An absent
`applied` key was reported to the caller as an applied gesture.** This is the same defect the
charter's invariant names (*"a missing `applied` key is unapplied, not applied"*), outside the eleven
sites, and it would have survived a repair scoped to `_run_case`. Now `_was_applied(result)`. The
signature and argument shape are unchanged, so AC4 is not touched. Pinned by `tp12a`/`tp12b`.

---

## 3. AC3 — the falsification, in full

Harness: `h:\tmp\wp73_prerepair\falsify_wp73.py`, importing the committed test script's fake
endpoints verbatim so the canvas model and the injections are **identical** in both runs; the only
difference is the driver module. The unrepaired driver is a byte copy of the file taken at the B10b
batch baseline (commit `fd7de1f`, that file clean).

- pre-repair sha256 `39c3d4fc2d47821879582553396d19e268241f3b5feae123f31d24c077adc02b`
- post-repair sha256 `35cae493e7b6786fcfe653b50494c1ebd3b62c617bf1f51da5b8706269501caf`

**Control, both drivers, no injection: `allPass = True`, all six cases pass.** Without this the
injections would prove nothing.

Every injection is **targeted at a single gesture** (matched on the case-prefixed node ids in its
change payload), never global — hard-won rule 2.

| # | Injection | Unrepaired | Repaired | Neighbours |
|---|---|---|---|---|
| **F1** | `initial-sync`, its **sole** gesture `seed-two-nodes-and-edge` on **a** → `applied:false` | **`pass=True`, `allPass=True`** | `pass=False`, `status=inconclusive`, `gesture='seed-two-nodes-and-edge'`, `instance='a'`, `allPass=False` | all 5 stayed `pass` |
| **F2** | `delete-node-edge`, its **SETUP** gesture `setup-two-nodes-and-edge` on **a** → `applied:false` | **`pass=True`, `allPass=True`** | `pass=False`, `status=inconclusive`, `gesture='setup-two-nodes-and-edge'`, `instance='a'`, `allPass=False` | all 5 stayed `pass` |
| **F3** | `bidirectional-drag`, gesture `b-moves-y` on **b** → `applied:false` | `pass=False` (see below) | `pass=False`, `status=inconclusive`, `gesture='b-moves-y'`, `instance='b'` | all 5 stayed `pass` |
| **F4** | `initial-sync`, response with **no `applied` key at all** | **`pass=True`, `allPass=True`** | `pass=False`, `status=inconclusive` | all 5 stayed `pass` |

**`initial-sync` was among those falsified — F1 and F4.** It is the sharp case: it has **no** content
predicate at all, so `converged` is its entire verdict, and the unrepaired driver recorded `pass`
having demonstrated nothing whatever. A falsification confined to cases with content predicates would
have chosen the easy target.

**F2 is the subtle one and it behaved exactly as the charter predicted.** `delete-node-edge`'s
`node_gone` predicate is *satisfied by the node never having been created*, so an unapplied **setup**
made the case's own oracle vacuously true rather than merely unprotected — the unrepaired driver
reported a clean `pass` on a case in which nothing was ever created and nothing was ever deleted.
This is the site a repair scoped to "six" would have left open.

**F3 was expected to move `pass → inconclusive` and instead moved `fail → inconclusive`. That is a
finding, recorded rather than smoothed over.** `bidirectional-drag`'s `both` content predicate
already sees its *final* gesture fail, so the unrepaired driver did redden — but it reddened as an
**oracle disagreement with no attribution**: "the snapshots disagree", with nothing saying whether
anything had been done to them. The repair converts that into an attributed `inconclusive` naming
`b-moves-y` on instance `b`. This is the *other* half of C50 AC3 (a case that failed vs. a case that
could not be decided) and it is why `inconclusive` had to be a third state. My first harness asserted
`pass → inconclusive` for all four and reported F3 as NOT CONFIRMED; the expectation was wrong, not
the repair. Both runs are recorded above.

**Neighbouring cases stayed green in every one of the four runs** (explicit per-case states printed by
the harness), so no injection was global and no narrowing was required.

---

## 4. Verification

`python tools/MCPserver/test_liveshare_e2e_mcp_server.py`, launched through `visible-console`
`run_python` with an absolute path — **40 checks, 40 PASS, exit 0** (console `a4fa2f14`).

| TP | AC | What it pins |
|---|---|---|
| tp01 a/b/c | AC1 | eleven gesture sites re-derived from the AST · the only `_simulate` in `_run_case` is inside the checkpoint · the 1+2+3+2+2+1 decomposition |
| tp02 a–d | — | control: with no injection all six cases pass, `allPass` true, nothing inconclusive |
| tp03 a–i | AC1, AC2 | unapplied **setup** gesture → inconclusive, naming case + gesture + instance + oracle; `allPass` false; `inconclusive` list; neighbours green |
| tp04 a–f | AC1, AC3 | unapplied **sole** gesture of `initial-sync` → inconclusive; no converged verdict; neighbours green |
| tp05 a/b | AC1 | it never falls through: no `canvas.state` and no `sync.waitQuiescent` between the refused gesture and the next case |
| tp06 a/b | AC1 | a response with **no** `applied` key is unapplied |
| tp07 a/b | AC1 | `applied:"true"`, `1`, `False`, `{}`, `None` are all unapplied — identity-true only |
| tp08 a–c | AC2 | attribution names instance **b** when b's gesture is the one that failed, not "a" by default |
| tp09 a/b | AC1 | `allPass` reduces on `status == "pass"` and no longer on the bare legacy `pass` key (AST, docstring stripped) |
| tp10 a–c | AC2 | every passing case reports its applied gestures (instance-qualified) and names its oracle |
| tp11 a–c | AC4 | six `MATRIX_CASES` identifiers · seven tool signatures unchanged (AST, parameter-by-parameter) · stdlib-only imports |
| tp12 a/b | — | `edit` no longer defaults a missing `applied` to `True` |

Three oracles were initially written against the **source text** and were false-failing on the
module's own docstrings (which quote `_simulate(...)` and `result.get("applied", True)` verbatim).
They were rewritten to read the **AST** with docstrings stripped — a prose mention can now neither
satisfy nor break them. Recorded because it is the same class as "assert on state, not on log
strings".

### Gate status

| Gate | Result |
|---|---|
| `python tools/MCPserver/test_liveshare_e2e_mcp_server.py` | **40/40, exit 0** |
| `npm run build` from `plugin/` | **PASS** (`BUILD_EXIT=0`) |
| `npm test` from `plugin/` | **1833 passed / 0 failed / 299 files** — identical to the batch baseline. WP73 touches no TypeScript, so this is the no-regression check the charter asks for. |
| New runtime dependencies | **zero** — `json`, `urllib`, `typing`, `__future__`, plus the pre-existing `mcp` (pinned by `tp11c`) |

---

## 5. Acceptance criteria

| AC | Status | Evidence |
|---|---|---|
| **AC1** — every gesture's `applied` consumed at every call site; unapplied ⇒ `inconclusive` naming case, gesture and instance; never falls through to a snapshot comparison; never counted as a pass; a missing key is unapplied | **MET** | tp01 (11 sites, single checkpoint), tp03, tp04, tp05, tp06, tp07, tp09 |
| **AC2** — the verdict names the oracle *and* the gesture | **MET** | tp03c/d/f, tp08b/c, tp10a/b/c. **Partial-scope note:** the *inconclusive* path names its oracle (`gesture-applied`) and its gesture; passing/failing cases now also carry `oracle` and `gestures`. C50 AC3's own per-case oracle reporting for the pass/fail paths remains **WP50's**, and this WP supplies the datum it needs rather than implementing it. |
| **AC3** — falsified by injecting exactly the condition it fixes; targeted; run against the unrepaired driver; both results recorded; `initial-sync` included; neighbours reported | **MET** | §3 — four injections, pre- and post-repair, `initial-sync` in two of them, neighbours green in all four |
| **AC4** — tool surface, argument shapes and case names unchanged; `inconclusive` inside the existing per-case shape; no new dependency | **MET** | tp11a/b/c; `inconclusive` is added keys on the existing per-case dict (which already added `diff`/`error` conditionally), not a new tool |

---

## 6. Risks and open items for Worker 4

- **Nothing has been executed against a live endpoint.** No control endpoint has ever answered on
  this host. Every criterion above is decided against fake endpoints, and no statement about a live
  instance is made or implied.
- The fake canvas model is a *perfect* convergence model. It is honest about what it is: its job is
  to make the control run green so an injected gesture is the only thing that can change a verdict.
  It is not evidence that real peers converge.
- **`_wait_both` and `_open` still discard their results.** `canvas.open` returns
  `{opened, subscribed}` and `sync.waitQuiescent` returns `{quiescent}`, and `_run_case` /
  `run_matrix` consume neither. A case that ran against a canvas that was never opened, or that
  settled only because the wait timed out, is still possible. **This is out of WP73's scope** (its
  subject is `applied`) but it is the same class one seam over, and it belongs to WP50 or to a
  follow-up. Recorded rather than fixed.
- **`_converge_and_check`'s 2000 ms default** is unexercised on real hardware.

---

## 7. Commits — both repositories

| Repo | Branch | Commit | Contents |
|---|---|---|---|
| **AgenticWorkspace** | `toms_branch` | **`50b0cf4`** (`50b0cf459a86f5da413829529da7c2a01816e75e`) | `tools/MCPserver/liveshare_e2e_mcp_server.py`, `tools/MCPserver/test_liveshare_e2e_mcp_server.py` |
| **obsidian-live-share** | `fix-bugs-and-raceconditions` | see `Worker3Handover_B10b.md` §Commits | this report (+ WP72's changes, same commit) |

The workspace-repo commit staged **exactly those two paths**; the eight unrelated files already dirty
in that tree (`Coding/CONTEXT.md`, `tools/telemetry_log.json`, the `workflow-config-extension`
sources and its `.vsix`) were left untouched and unstaged. No `__pycache__`, no secret, no build
output.

Explicit path staging in both; no `git add -A`. No vault content, secret, build output or
`__pycache__` staged. `h:\tmp\wp73_prerepair\` (the pre-repair snapshot and the falsification
harness) is deliberately **not** committed — it is a measurement scaffold, and the measurements it
produced are recorded above.
