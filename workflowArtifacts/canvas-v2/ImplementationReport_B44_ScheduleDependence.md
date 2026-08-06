# B44 — the canvas suite's schedule dependence: measured, attributed, and mostly a PRODUCT DEFECT

**Batch:** B44 (Worker 3, Execution) · **Branch:** `fix-bugs-and-raceconditions` ·
**Rig:** two live Obsidian vaults, bundle `b672be50…` (4 531 099 B), unchanged throughout.
**Predecessor:** B41, killed by the spend limit at *"Receipts obtained. Now pinning the threshold
with a focused sweep."* Its five scratch scripts survived in `H:\tmp` and are the reason this
batch started from a ladder rather than from a hypothesis.

---

## 0. The answer in one line

**The schedule dependence is a PRODUCT DEFECT — a silent, permanent local-write swallow — that an
undeclared inter-scenario gap in the suite was hiding. Two of the five checks are additionally
suite artefacts in their own right, and one of them could never have failed at all.**

---

## 1. The product defect: the swallow window

### What was measured

A local whole-file write to a shared `.canvas` that lands within **~0.8 s of a remote change having
been applied to that same path** is **dropped**. Not delayed — dropped.

| observation | value |
|---|---|
| the bytes on the writer's disk | **present** |
| the writer's OWN doc (`canvas.state`, same instance) | **absent** |
| the peer's file and doc | **absent** |
| state after a further 20 s | **unchanged — the edit is gone** |
| `local modify` receipt in the debug log | **none at all** — the event never reached `handleLocalModify` |

### The ladder

`liveshare_b41_observe_then_write.py`, runs `004534` / `005427` / `005600`. Each rung writes a
marker on one peer, **polls the other peer's file until it appears** (which is the instant that
peer's `CanvasPersistence` finished writing), waits `delta`, then makes the test write.

| delta | verdict |
|---|---|
| 0.0 / 0.1 / 0.2 / 0.3 / 0.5 s | **LOST 20/20**, across all four shapes (node-add on host, side-less edge, node-add on guest, node-delete) |
| 0.5 / 0.6 / 0.7 / 0.8 s | **LOST 11/12** |
| 0.9 / 1.0 s | **OK 4/4** |
| 1 / 2 / 3 / 5 / 8 s | **OK 5/5** |

The `CTRL_NODE_A` positive control is included in every block, and the script discards any rung
whose marker never arrived. The first sweep at delta ≤ 0.5 s lost **its own positive control**,
which by the script's stated rule invalidates that block as a *threshold* measurement — it is
reported here only as "everything at ≤ 0.5 s is lost", which is what it can support.

### Mechanism — cited at commit `fb631f8`, via `git show`, not the working tree

`file-ops.ts` carries a sibling's uncommitted change that moves `isPathMuted` to `:219`; citing the
tree would have produced a line number nobody else could reproduce (Rule 5).

| citation | what it does |
|---|---|
| `plugin/src/files/vault-events.ts:232` | `if (plugin.fileOpsManager.isPathMuted(file.path)) return;` — the vault `modify` event is dropped **outright**, before any content is examined, **and with no log line**. This is why the swallow leaves no receipt of any kind. |
| `plugin/src/files/file-ops.ts:196` | `isPathMuted` is a **bare per-path counter**. No content test, no origin test — a genuine user edit is indistinguishable from our own write echo. |
| `plugin/src/files/canvas-persistence.ts:53` | `DISK_WRITE_SETTLE_MS = 250` |
| `plugin/src/files/canvas-persistence.ts:451` | `acquireMute()` takes the mute for a write |
| `plugin/src/files/canvas-persistence.ts:463` | `armSettleRelease()` **clears and re-arms** the release on every write |
| `plugin/src/files/canvas-sync.ts:3065` | `if (this.recentDiskWrites.has(path)) return;` — a second, independent drop of the same shape in `handleLocalModify` |

**Why the window is ~0.8 s and not the 250 ms the constant reads:** `armSettleRelease()` postpones
the release on *every* write. Applying one remote change provokes a burst of local disk writes, and
the mute is therefore held for the whole burst **plus** 250 ms — not 250 ms per write. The constant
is not the window; the burst length is.

### Why this is a user-facing defect and not a test artefact

`useCanvasBinding` is `false`, so the live capture path for a real user editing a canvas in the
Obsidian UI is exactly the path this measures: `vault.on("modify")` → `handleLocalModify`. During
active co-editing, remote changes land constantly. **Any local edit a user makes within ~0.8 s of a
peer's change landing is silently and permanently lost** — their file keeps the bytes, the shared
document never sees them, and nothing ever reconciles the two. There is no notice, no log line and
no retry.

### Reproduction

```
python H:\tmp\liveshare_b41_observe_then_write.py
    LS_B41_SHAPES=CTRL_NODE_A  LS_B41_DELTAS=0.5,0.6,0.7,0.8,0.9,1.0  LS_B41_REPS=2
```

---

## 2. Per-check verdicts

The five schedule-dependent checks are forced arithmetically by the reported `21/21` vs `16/20`:
four recorded failures plus one check that **was not recorded at all**.

| # | check | verdict | the measurement that decides it |
|---|---|---|---|
| 1 | `[02] B received the side-less edge` | **PRODUCT DEFECT**, surfaced | the write is swallowed at ≤ 0.8 s; the check is right to go red, and its green under the hold is bought by the gap, not by the product |
| 2 | `[02] endpoints survived intact` | **SUITE ARTEFACT** | guarded by `if edge in eb:` — when the edge failed to arrive the check **was not recorded at all**. This is the entire reason the denominator moved 21 → 20. A check that can vanish cannot fail. |
| 3 | `[04] host received the guest's node` | **PRODUCT DEFECT**, surfaced | same swallow, guest side; `NODE_B` rungs lost at every delta ≤ 0.8 s |
| 4 | `[06] B: node gone` | **SUITE ARTEFACT** | the precondition named **A only**. With per-run ids, absence is the default state, so if `[03]` failed to propagate the node was never on B and *"it is not on B"* was true for free — a green that cannot fail, sitting in the scenario that tests deletion. Demonstrated: under the falsification injection the old form passes, the new form refuses. |
| 5 | `[06] no resurrection after a further settle` | **SUITE ARTEFACT** | a bare `time.sleep(5)` and one look. It could not say how much of the window it observed, it would miss a node that reappeared and vanished inside it, and when the deletion had **never propagated** it failed with *"no resurrection"* — accusing the product of resurrecting a node it had never deleted. |

**It is a mix, and the mix is 2 product / 3 suite** — but the two suite artefacts in `[06]` and the
one in `[02]` were *masking* the same single product defect that checks 1 and 3 surface.

---

## 3. What changed in the suite, and the red state observed for each

`H:\tmp\liveshare_e2e.py`, committed to `workflowArtifacts/canvas-v2/tools/e2e/liveshare_e2e.py`
so it stops living only in a scratch directory — B41's near-loss is the argument.

### 3.1 `write_and_confirm_capture()` — capture and propagation are now separate questions

The suite never had an oracle for *its own* write. `canvas.state` answers about the Y.Doc of the
instance being asked, which separates

- *"my own edit was never captured"* — the writer's doc lacks it, **from**
- *"captured here, never arrived there"* — the writer's doc has it, the peer's file does not.

Every failure this suite ever reported conflated the two, and the swallow defect lives **entirely**
in the first. A swallowed write is now reported as a swallowed write, is **not retried**, and is not
slept around — retrying would re-issue the `modify` event outside the mute window and turn the
defect back into a green, which is the move that hid it for the life of this suite.

**Observed red, live and unprompted**, on the first back-to-back re-run:

```
>>> FAIL  A: the local write was CAPTURED (move x=777)
>>> FAIL  B received the move
RESULT: 26/28 checks passed   [band: state-ending (default)]
```

The geometry reset immediately preceding `[01]` had put that write inside the swallow window. The
suite named the cause correctly on its first opportunity.

### 3.2 The band default is inverted

Default now **ends every wait on its state**. `LS_S56_KEEP_SCHEDULE=1` restores the hold and is kept
**only as a control**: a check that is green under the hold and red without it is measuring the
clock. Measured: control band **28/28**; state-ending band 28/28 or 26/28 depending on whether a
write lands in the window. That difference *is* the schedule dependence, now attributed rather than
merely observed.

### 3.3 `LS_E2E_BREAK` — the falsification injection

`link.break` on the guest (WP82). **The first attempt used `shape="close"` and scored 29/29 with the
link nominally severed** — `autoReconnect` re-established the socket inside the scenario and the
injection measured nothing. That is recorded in the source, because an injection that does not
inject is the same defect class the suite exists to catch. `shape="silence"` leaves the socket open
and stops delivery, which is the condition the checks actually depend on.

**Red state under `LS_E2E_BREAK=mux`: 15/29, with all fourteen dependent checks red**, including
every one of the five:

```
FAIL  B received the move
FAIL  B received the side-less edge
FAIL  endpoints survived intact
        [the edge never reached B, so its endpoints cannot be intact —
         this is a FAILURE, not an inapplicable check]
FAIL  B received the empty card
FAIL  host received the guest's node
FAIL  A's edit survived on both / B's edit survived on both / the two replicas converged
FAIL  empty-card-<RUN> present on BOTH peers to delete
        [A=True B=False — refusing to measure a deletion that cannot be
         distinguished from a node that was never there]
FAIL  A: node gone / B: node gone / no resurrection   [NOT ADJUDICATED — …]
FAIL  guest received a canvas it never had
```

The capture checks stay **green** under the injection, which is correct and is the separation
working: a silenced relay does not stop local capture.

### 3.4 The denominator can no longer move

Every check is unconditional, `[06]`'s dependents are recorded as explicit `NOT ADJUDICATED`
failures rather than skipped, and `main()` asserts the total against `EXPECTED_CHECKS`. A run whose
denominator moves now says so in bold:

> *A check that is absent has not passed and has not failed — it has escaped adjudication, and this
> run is NOT comparable to another.*

This is what makes `21/21` and `16/20` comparable at all; they never were.

### 3.5 `reset_canvas()` now exists

The old docstring promised that `reset_canvas()` *"puts the canvas back to a known shape before
anything is measured"*. **No such function was ever written.** The sweep removed ids but never
geometry, so `[01]` asserted `x==777` against a canvas still carrying `[05]`'s `x=1111` from the
previous run — which in the fast band produced `A kept the move  A.x=1111`, a failure that looks
exactly like a product defect and is a leftover. A promise in a docstring is a citation (Rule 16).

---

## 4. Is the suite idempotent now?

**Yes, for its own artefacts — with one honest caveat.** Consecutive runs: `28/28`, `28/28`,
`26/28`, `28/28`, and a control-band `28/28`. The sweep + `reset_canvas()` + the new
`the run starts from a stated, converged canvas (idempotency)` check make the starting shape
**stated and verified on both replicas** rather than inherited.

The caveat: `26/28` is **not** a non-idempotency. It is the product defect firing. The suite is now
correctly **intermittently red on a real defect**, which is the desired behaviour and must not be
mistaken for flakiness in the instrument.

---

## 5. WP89 — **UNBLOCKED, and its premise is not what this defect is about**

WP89's open question: `classifyBusyGate`'s `defer-drag` arm defers the view apply but leaves the
disk write running, which under WP87's measurement rebuilds the open view.

**WP89 is unblocked and can be chartered as written.** The schedule dependence is *not* caused by
the `defer-drag` arm, and WP89 does not need to wait on this result:

- the swallow is on the **capture** side (`vault.on("modify")` never fires into `handleLocalModify`),
  whereas WP89's arm is on the **apply** side;
- the swallow produces **no** `reconcile` and **no** view rebuild — it produces *nothing at all*,
  which is precisely its signature;
- `CANVAS WRITE HELD:` and `SHADOW STALE:` had **zero** hits in every measurement window, each
  proved matchable against a present line first (Rule 15), so no busy-gate hold is implicated.

**But WP89 inherits one fact from this batch:** the disk write it leaves running is itself what
opens the mute burst that swallows the user's next edit. The `defer-drag` arm therefore has a second
cost that its charter does not currently name — not just a rebuilt view, but a **deafened path** for
the duration of the burst it starts. That belongs in WP89's charter as a consequence, not as a
blocker.

---

## 6. Out of scope — found, reported, NOT fixed

1. **The relay room had been deleted server-side.** The rig could not connect at all:
   `403 Invalid room or token` on `/control/<room>`, against a bare `403 Forbidden` for a room id
   that cannot exist — two different answers from the same route, which is what makes the first one
   mean something. Re-provisioned via `POST /rooms` + `/rooms/<id>/join`
   (`liveshare_b44_reprovision_room.py`). **The old room is gone; every prior run's doc history with
   it.**
2. **`plugin/main.js` in the repo is NOT the bundle the vaults are running.** Repo
   `85a29c85…` (4 500 305 B, built 2026-08-05 13:27) vs installed `b672be50…` (4 531 099 B,
   12:07). The installer was deliberately **not** run — the vaults hold the exact bundle B41
   characterised. Anyone running `liveshare_e2e_install.py` without `LS_EXPECT_SHA256` will silently
   change the code under measurement (S46).
3. **The debug log's stamp-to-flush lag reached ~58 s** (`FLUSH_DELAY_MS = 500`), and every
   receipt-reader in `H:\tmp` uses a byte offset plus a 2–2.5 s margin. A short margin yields **zero
   matched lines** and would licence an unsound absence claim. Caught only because the Rule 15 guard
   fired: `<< NO HIT — no absence may be claimed from this pattern >>`.
4. **`link.break shape="close"` is not a break** — `autoReconnect` reverses it within the scenario.
   Any existing test using `close` as a severance injection is measuring nothing.
5. Vault A's `_liveshare-test` still carries leftovers from long-dead runs (`from-guest`,
   `edge-sideless`, `wp79-*`, `wp37probe-*`) that the sweep's prefix rules do not match.

---

## 7. Rig state left behind

- **Both vaults live and connected**, room `85ecd0cc-32bd-4d28-bc3c-6f1bde23a66a`,
  A = host / 39431, B = guest / 39432, bundle `b672be50…` in both.
- `sharedFolder` = `_liveshare-test` in both, verified before **and** after the room swap.
- `data.json` backed up to `data.json.pre-v2-smoke-b44` in both vaults; the owner's
  `.pre-v2-smoke` backups untouched.
- Pre-swap snapshot of both shared trees at `H:\tmp\b44_shared_snapshot\20260807_004046\{A,B}`.
  Nothing was lost in the swap — both trees verified byte-identical afterwards.
- No product code was modified by this batch. No rebuild was performed.
