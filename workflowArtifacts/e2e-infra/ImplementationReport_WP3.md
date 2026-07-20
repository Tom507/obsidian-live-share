# Implementation Report — WP3 (SPEC_04 matrix as tests)

> Worker 3 Coder artifact. Batch A, depends on WP2 (DONE). Native sub-agent,
> built-in tools only. Companion to `BUILD_SPEC_CanvasE2EInfra.md` §9 WP3 and
> `USER_STORIES.md` US3/US7.

---

## 1. Summary

Created `plugin/src/__tests__/canvas-matrix.test.ts` encoding the six SPEC_04
convergence matrix cases as two-peer tests on the WP1 `CanvasDouble` + interaction
driver and the WP2 `makeTwoPeer` harness. Every case originates all local intent
through the WP1 `InteractionDriver`, settles via `waitQuiescent` (no sleep), ends in
`assertConverged`, and asserts the receiver's zero-re-push invariant.

**Gate outcome:** build PASS; full plugin vitest suite **507 passed / 29 files / 0
failed**; matrix file **6 passed / 0 failed**; runner did not crash.

**Headline finding (escalation-worthy — see §5):** all six cases are **GREEN**, not
red. No `.skip`/`.todo` used and no assertion was weakened. This is the "all pass
unexpectedly" branch the WP3 charter anticipated: the WP2 harness supplies the
`CanvasDoubleBridge` model-capture glue that is the headless equivalent of SPEC_04
Phase 3, so the capture↔apply loop is genuinely closed and convergence really works.
The BUILD_SPEC §9 WP3 AC4 premise ("real, currently-FAILING reds") assumed the matrix
runs against production `main.ts` adapter→binding wiring that does not exist — but WP3
scope is explicitly the headless harness, where nothing is red. This is a genuine
conflict with US3 AC4 and is escalated to W2 below. Reds were NOT faked.

---

## 2. What was implemented

Single new file: `plugin/src/__tests__/canvas-matrix.test.ts` (no production code, no
harness change, no new dependency). Case `it(...)` names begin with the stable slugs
that mirror WP5 `run_matrix`:

| # | Case slug | Scenario | Local origination | Key strict assertions |
|---|---|---|---|---|
| 1 | `initial-sync` | Both peers start empty; A populates 2 nodes + 1 edge; B converges | `driveAddNode` ×2, `driveEdge` | `assertConverged`; B node/edge id sets; no dangling edge; `b.rePush===0` |
| 2 | `multi-edge-move` | Node `c` is endpoint of 3 edges; A drags `c` | `driveDrag` | converged; B `c` geometry `{600,600}`; all 3 edges present + non-dangling; `b.rePush===0` |
| 3 | `bidirectional-drag` | A moves `nx`, B moves `ny` concurrently (before exchange) | `driveDrag` on both peers | converged; both moves survive on both peers; each peer `rePush===1` (integration added zero) |
| 4 | `add-node-edge` | A adds node + edge referencing it | `driveAddNode`, `driveEdge` | converged; B has both; edge non-dangling; `b.rePush===0` |
| 5 | `delete-node-edge` | A deletes middle node `n2` with 2 incident edges | `driveDeleteNode` | `removedEdges===[e1,e2]`; converged; B nodes `[n1,n3]`, edges `[]`; no dangling; `b.rePush===0` |
| 6 | `file-node` | `type:"file"` node with `file` field round-trips | `driveAddNode` | converged; B node preserves `type`+`file`+geometry (no field loss); `b.rePush===0` |

All node records carry full geometry (`x/y/width/height`) per the matrix contract.

---

## 3. Per-case red/green result (authoritative)

| # | Case | Result | Why |
|---|---|---|---|
| 1 | `initial-sync` | **GREEN** | Empty B integrates A's seeded node/edge upserts via `applyRemote`; converges; B never captures → `rePush===0`. |
| 2 | `multi-edge-move` | **GREEN** | Moving `c` writes only `c`'s node record; edges reference by id and are untouched, so all 3 stay valid; geometry converges. |
| 3 | `bidirectional-drag` | **GREEN** | `waitQuiescent` snapshots both state vectors before applying either (models true concurrency); disjoint nodes merge cleanly at the Y.Map key level; no lost update; each peer re-pushes only its own edit. |
| 4 | `add-node-edge` | **GREEN** | `applyRemote` reconciles nodes before edges, so the edge is never dangling on B; converges. |
| 5 | `delete-node-edge` | **GREEN** | `driveDeleteNode` prunes incident edges into the same signal-diff capture; both deletes propagate; B converges with no dangling edge. |
| 6 | `file-node` | **GREEN** | Records are flat primitive maps; `type`/`file` survive the CRDT round-trip via `writeRecordMinimal`/`ymapToRecord`; converges without field loss. |

**Reds: 0. Greens: 6.** No case is skipped or todo'd; the file is fully collected by
vitest and reports pass/fail per case (US3 AC5 satisfied).

---

## 4. Quality gates (BUILD_SPEC §7)

- **Build** (`npm run build` = `tsc -noEmit -skipLibCheck && esbuild production`):
  **PASS** (exit 0). The new test file typechecks under strict TS.
- **Full suite** (`npx vitest run` from `plugin/`): **507 passed / 29 test files / 0
  failed**, runner did not crash. Includes WP1 self-tests (canvas-double 12,
  two-peer 10), WP4 (e2e-control 22), wp5/latency (11), and the new matrix (6).
- **Isolation:** there are zero reds anywhere, so the "reds isolated to
  canvas-matrix.test.ts" requirement is trivially satisfied; pre-existing suite
  (incl. WP1/WP2 harness self-tests) stays green — no regression.
- **No production footprint:** no `plugin/src/canvas/*` change; no new dependency; no
  harness capability added.

> Tooling note: a `visible-console` run hit the known intermittent
> `[WinError 5] status.json` file-lock (documented in `Skill_WindowsShellSyntax.md`
> as a launcher race, not a process failure). The build + matrix-only runs completed
> cleanly in the visible console; the authoritative full-suite count above was
> confirmed with a foreground `npx vitest run` after the lock aborted that one
> launcher invocation.

---

## 5. Escalation — ESCALATE_TO_W2 (US3 AC4 conflict)

**Conflict:** BUILD_SPEC §9 WP3 AC4 and US3 AC4 require the redesign-dependent matrix
cases to be "real, collectable, currently-FAILING tests (not skipped)" — the intended
acceptance gate that turns green as the redesign lands. In the delivered WP1+WP2
harness, **none of the six cases can be red without faking**, because:

- WP2 was explicitly tasked (BUILD_SPEC §5 interface-impedance risk; US2 AC1) with
  supplying the `CanvasDouble → CanvasModelBridge` glue itself. `CanvasDoubleBridge`
  (in `harness/two-peer.ts`) implements interaction-signal + snapshot-diff **model
  capture** — the exact behavior SPEC_04 Phase 3 (SPEC_02 §4) delivers in production.
- Therefore the headless capture↔apply loop is already closed, and `CanvasBinding`
  (SPEC_01 Phase 0, already merged) genuinely converges for every matrix scenario.
  The WP2 self-test already demonstrates single-move, add+edge, delete+prune, and
  bidirectional convergence green.
- The BUILD_SPEC's "red until redesign lands" reasoning is sound only against
  **production** wiring (`main.ts` adapter→binding), which does not exist. But WP3
  scope is the **headless harness**, where there is nothing left unimplemented to be
  red about.

**Action taken:** honest, strict, unweakened tests were written and they pass. Reds
were NOT fabricated (the charter forbids it). The tests are authored to function as a
real standing **regression** gate — exact geometry, non-dangling-edge checks, field
preservation, and zero-re-push — so a future regression in `CanvasBinding` or the
bridge glue will turn the relevant case red.

**Gate-effectiveness caveat (flagged per charter):** as written, this file does not
gate any *unimplemented* redesign behavior — the headless contract it locks is already
met. If W2 intends the matrix to gate the *production* redesign path, that requires
WP3 to run against `main.ts` adapter→binding wiring (out of current scope and
non-existent today), or a follow-up WP once SPEC_04 Phases 2–4 wire the binding into
`main.ts`. Recommend W2 confirm whether the WP3 deliverable should be (a) accepted as
the headless regression gate it now is (recommended — matches actual scope), or (b)
re-scoped to await production wiring.

---

## 6. Handover summary (for BUILD_SPEC §9 WP3)

- File: `plugin/src/__tests__/canvas-matrix.test.ts`, 6 cases, all GREEN, collected by
  vitest, no `.skip`/`.todo`.
- Case slugs (stable, mirror WP5 `run_matrix`): `initial-sync`, `multi-edge-move`,
  `bidirectional-drag`, `add-node-edge`, `delete-node-edge`, `file-node`.
- Build PASS; full suite 507/29 green, 0 fail, no crash; no regression; no production
  or dependency change.
- US3 AC1/AC2/AC3/AC5 satisfied. US3 AC4 ("currently-FAILING") is in conflict with the
  delivered harness state — see §5 escalation; reds not faked.
