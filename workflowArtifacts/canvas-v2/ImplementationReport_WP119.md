# ImplementationReport — WP119: a selection is not an edit, and a revert of one node is not a reload of the board

**Branch:** `fix-bugs-and-raceconditions` · **Base:** `6a58211` (clean tree) · **Worker:** 3k, sole worker in this tree
**Touched production code:** `plugin/src/main.ts` only.
**Touched tests:** `plugin/src/__tests__/v2/selmove/test_selection_moves_nodes.test.ts` (WP119's own file) only.
**Rig:** NOT used. Nothing rebuilt, redeployed, installed or driven. The three vaults are untouched.
**Signals allocated:** none.

---

## 0. Verdict in one line

**The blast radius was the defect and it was one call.** `revertCanvasNode` received a node id, threw it away, and
handed the WHOLE snapshot to `reconcileLiveCanvas(..., {initial: true})`, which is an unconditional
`"structural"` and therefore `canvas.setData(entire board)`. It now keeps the id and reverts **that record**
through one `adapter.applyNodeGeometry`. **T4 passes as an ordinary test.**

**Two corrections to the charter, both load-bearing** — §1 (the revert's own stated justification has been false
since WP21) and §4 (charter A3 cannot be discharged inside this package: it is an initiative-wide ESCALATE, and
it is carried up unrepaired with a worked design).

---

## 1. CORRECTION 1 — the loser-revert's justification has not existed since WP21

`revertCanvasNode`'s own doc comment said, and the charter repeats:

> *"the lock seam denied its optimistic edit and that edit never reached the shared doc (canvas-sync holds its
> diff baseline back for the same reason)"*

**That is false on this tree, and it has been since WP21.** Measured off the source, not argued:

| # | Evidence | Where |
|---|---|---|
| 1 | *"the lock-seam gate lived here. It is REMOVED, not rewritten… Locks are now pure UX: they still colour rings and **still revert the loser's VIEW**, but they carry no write authority"* | `files/canvas-sync.ts:4411-4418` |
| 2 | *"there is no lock seam here any more. No branch consults a lock before writing, and no branch refuses an id on a lock's behalf."* | `files/canvas-sync.ts:3897-3898` |
| 3 | *"the ECHO baseline advances unconditionally. It used to be withheld…"* | `files/canvas-sync.ts:3705` |
| 4 | *"the claim is UX only — nothing reads it back here, and the write below is never gated on it"* | `files/canvas-sync.ts:4127-4130` |
| 5 | `CanvasPresence.canWriteNode` / `canDeleteNode` have **exactly two consumers in `plugin/src`**, both optional `CanvasBinding` options — and `mountCanvasPresence` supplies only `canWrite` (the path-level authorisation), never the per-node pair. `CanvasBinding` is additionally gated behind `useCanvasBinding`, default `false` (`types.ts:246`). | `canvas/canvas-binding.ts:56,58,290-291`; `main.ts:3828-3836` |

**Consequence.** The loser's edit **does** reach the shared doc. So the node a revert names is normally already
equal to shared truth and the per-node apply below is an honest `"unchanged"`. What survives is the VIEW
rollback WP21 deliberately kept — and **a view rollback of one node is a per-node operation**, which is exactly
what A1 asks for. The repair is therefore *more* justified after the correction, not less.

**Carried up, not repaired here:** whether the loser-revert should exist at all now that its justification has
gone is a question for the canvas convergence remodel. It is not WP119's to answer, and removing it would have
failed A4.

---

## 2. A1 — the repair

### 2.1 What changed

`main.ts`:

- **`revertCanvasNode`** now (a) resolves the winner and logs as before, (b) returns on a null snapshot as
  before, (c) **looks the node up in the snapshot by id**, returning with a named reason if shared truth does
  not carry it (deleted / never captured — `onRemoteNodeDeleted` owns the delete case), and (d) delegates to
  the new `applyCanvasNodeRevert` with that ONE record. It no longer calls `reconcileLiveCanvas` at all.
- **`applyCanvasNodeRevert(canonical, nodeId, desired, who)`** — new private method. Availability guard →
  shadow guard → **WP87 editing/drag guard** (§2.3) → geometry validity → one
  `adapter.applyNodeGeometry(nodeId, {x,y,width,height})` → the WP5 receipt (`buildApplyReceipt` with
  `plan: "geometry"`, one node, no edges) → `surfaceState.noteHandover`.

### 2.2 Why it is not a call into `reconcileLiveCanvas` with a narrowed payload

Because that would have been worse than the defect. `planReconcile` compares the desired id set against the
**live** id set (`reconcile-plan.ts:170-171`), so a single-node payload is a membership difference ⇒
`"structural"` ⇒ `setData({nodes: [one]})`, i.e. **the other cards deleted**. And the `movedEndpoint`
escalation (`main.ts:3227-3231`) would re-issue exactly that reload for any node that is an edge endpoint —
which `n1`/`n3` are on a typical board. A scoped-pass option inside `reconcileLiveCanvas` would have needed
both of those suppressed inside the hot path shared by every remote delta. A separate, isolated method cannot
reach the main reconcile path at all, and it **re-uses** the availability guard, the editing predicate and the
receipt seam rather than duplicating them (rule 10).

### 2.3 A real defect the tree's own census caught in my first draft

My first draft called `applyNodeGeometry` **without consulting the editing predicate**, and
`v2/wp87/test_tp01_surface_route_census` went red with:

```
an unguarded path from a remote change to a live canvas surface:
  canvas/canvas-adapter.ts#applyNodeGeometry (via moveAndResize;
    callers main.ts#applyCanvasNodeRevert,main.ts#reconcileLiveCanvas)
```

That census derives sinks and their guards **from the tree**, and `applyNodeGeometry` is `GUARDED-BY-CALLER`:
every live caller must consult the one definer and act on the answer. My new caller was a route from a peer's
selection straight onto a card the local user was typing in — **WP87's destruction class, re-opened by a
repair**. Fixed by consulting the same `classifyBusyGate({busy: adapter.isBusy(), editingNodeId:
adapter.getEditingNodeId?.() ?? null})` and taking the two early exits (`defer-drag`, `editing`). No second
predicate was introduced.

**Honest note on that census's granularity:** in break-table row **B2** I deleted only the `gate === "editing"`
arm and the census stayed GREEN — its `guards()` test is structural (calls a predicate ∧ mentions a verdict
literal ∧ has a `return`), and the surviving `"defer-drag"` arm satisfies it. The two behavioural GUARD rows I
added are what actually discriminate. Reported, not filed as a signal (I allocate none).

### 2.4 No mute, and that is a decision

The geometry branch of `reconcileLiveCanvas` brackets itself with `mutePathEvents`/`armMuteRelease`.
`applyCanvasNodeRevert` deliberately does **not**, because for a canvas-owned path that bracket is inert:

> *"WP91 (C91 AC1) — **THE MUTE AND THE DISK-WRITE WINDOW ARE NOT ASKED HERE**"* — `files/vault-events.ts:379`

The vault `modify` gate takes the canvas branch and calls `handleLocalModify` directly; the decision is the
byte echo breaker, not the mute (the same thing `main.ts:3276-3284` and Investigation §2 both say). Arming a
mute a canvas path never consults would have added a refcount only the ceiling releases **and a release site to
WP93's derived census** (`main.ts×5 → ×6`) in exchange for nothing. Dropping it kept that census green without
touching another package's test.

### 2.5 A1's expressibility limit, stated rather than guessed

`CanvasAdapter` has exactly **one** per-record write: `applyNodeGeometry` (x/y/width/height). A per-node revert
of `text`, `color`, `type`, or of an edge field, is **not expressible** through it — the only route is
`reloadCanvasData`, which is the whole board, i.e. the defect. So such a difference is **measured and reported,
never applied**: `applyCanvasNodeRevert` diffs the snapshot record against `adapter.getNodeFields(nodeId)` and
names the non-geometry keys in the `LOCK REVERT:` line. Since WP21 the loser's non-geometry edit is in the
shared doc anyway, so there is nothing to roll back. **Residual R2 below.**

---

## 3. A2 — T4 passes as an ordinary test

`it.fails("a read-only selection on peer A must not move any card on peer B")` → `it(...)`. It drives
`LiveSharePlugin.prototype` (all three real methods bound onto the fake `this`), so it still measures shipped
code. Its companions are kept and now carry the attribution:

| Row | What it is for |
|---|---|
| **SANITY** | the world is wired and B's board starts where it started — a green cannot come from an exception in the harness |
| **WITNESS** (rewritten) | the contest was still **RESOLVED**: `reverted === ["n2"]` and `bPresence.isLockedByMe("n2") === false`. A green on the headline row cannot come from a dead sync. |
| **WITNESS (A4)** (new) | shared truth disagrees about the **clicked** card ⇒ B converges on it (`n2` → 777/555) with `setDataCount === 0` and `n1`/`n3` unmoved |

The old WITNESS asserted the defect positively (`setDataCount === 1`, `n1 → -900`). It could not survive the
repair; it was **replaced in role, not deleted** — the two rows above cover both halves of what it guaranteed.

---

## 4. CORRECTION 2 / A3 — ESCALATE. The leak is real, unrepaired, and out of this package's boundary

**I implemented A3, measured it green, and then reverted it.** The reason:

> **BUILD_SPEC_CanvasV2.md §7 Quality Gates, Abort criteria:**
> *"`canvas-presence.ts` is modified (WP21 AC2 requires it byte-unchanged) — **ESCALATE**."*

That block is §7, i.e. **initiative-wide**, not WP21-scoped (its neighbours pin `useCanvasBinding`, the plugin
version and `server/`). It is enforced live by a byte+SHA-256 digest pin in
`v2/wp21/test_tp04_awareness_liveness_unchanged_visible.test.ts`, which went red on my change
(`22551 → 28942` bytes). BUILD_SPEC §7 also states that rewriting an existing assertion to green a suite is
itself an abort. So A3 as chartered has no legal home inside WP119, and the charter is wrong to ask for it here.

**The A3 design, worked and measured before it was reverted** (hand it to the remodel, it is ~60 lines):

- `LockOrigin = "gesture" | "inferred"`, tracked in a private `lockMeta` map **beside** `lockedNodes` so the
  awareness wire shape is unchanged.
- `acquireLock(nodeId, origin = "gesture")`; `onDiffInferredChange` acquires as `"inferred"` and **refreshes**
  `touchedAt` when the claim is already its own inferred one.
- `expireIdleInferredLocks(): string[]` — drops inferred claims idle for `INFERRED_LOCK_IDLE_MS`. Gesture
  claims are never expired: their release is the interaction END, and expiring one would drop the ring off a
  card the user is holding.
- Called at the head of the awareness `change` listener, **before** `reconcileClaims()`. No timer is needed:
  an uncontested stale claim harms nobody, and the only moment it can harm is a moment that listener runs — so
  the claim is retired by the very event that would otherwise have made it a contest.
- `15_000 ms`, justified rather than picked: capture runs on a 200 ms trailing debounce capped at a 500 ms max
  wait (`canvas-sync.ts:318-319`), so a user still working on a card refreshes twice a second; 15 s is 30× that
  ceiling and far short of a session.
- Clock and budget injected (`now`, `inferredLockIdleMs`) on the `CanvasAdapterOpts.now` precedent, so the
  release is asserted by advancing a number, never by sleeping. Six test rows existed and were green
  (idle-release, not-yet-idle control, refresh control, gesture-never-expires control, whole-board sweep).

**Why it is provably safe** (this is the part the remodel should keep): since WP21 a lock carries **no** write
authority, so releasing one cannot cause a doc write, a file write, or a `coldOpen`. It can only make this
client claim **less**, i.e. strictly **fewer** reverts.

**What WP119 did instead, and why it is enough for the owner's report:** the leak's *cost* changed. A stale
claim now buys one per-node `applyNodeGeometry` — almost always `"unchanged"` — instead of a whole-board
`setData`. **The claim still leaks; it is no longer destructive.** T3's two rows are kept exactly as the
investigation committed them, with an ESCALATE banner above them, because the leak they measure is still real.

---

## 5. A4 — how "a contested edit still resolves" was proved, not assumed

Four rows, at two different levels, and one break-table plant:

1. **T2 POSITIVE CONTROL** — `revertCanvasNode(PATH, "n2")` against a snapshot where n2 itself disagrees:
   n2 → (777, 555), `setDataCount === 0`, n1/n3 unmoved.
2. **T4 WITNESS (A4)** — the same, end to end from peer A's gesture through the real `onRevert` seam.
3. **T4 WITNESS** — the claim is still dropped (`isLockedByMe("n2") === false`) and `onRevert` still fired.
4. **T1** (unchanged, 4 rows) — the tiebreak still fires, still does not fire for the lower-id peer, still does
   not fire for an uncontested card, and still fans out over a multi-select.

**Plant B3** is the discriminator: I planted the exact non-fix A4 warns about — an unconditional early return
in `revertCanvasNode` — and **the headline T4 row still passed** while the four A4/GUARD rows went red on
`expected 400 to be 777`. That is the measured proof that a fix which simply stopped reverting could not pass
this file.

---

## 6. A5 — `{initial: true}` was NOT redesigned, and here is what I found about it

`reconcile-plan.ts` is **byte-untouched**. `if (input.initial) return "structural";` still stands. WP119 is
the caller that passed it wrongly and it no longer passes it at all.

**Reported for the remodel, not acted on:** `initial: true` conflates two callers with genuinely different
needs. The **fresh mount** (`main.ts:3851`) legitimately wants the whole board authoritatively. The
**loser-revert** wanted one node and had no way to say so, so it borrowed the mount's flag and took the mount's
blast radius with it. The flag is not wrong; the vocabulary was missing a per-record authoritative pass. That
is a `reconcile-plan.ts` design question and belongs to the convergence remodel.

---

## 7. Break table (Dispatcher Rule 11)

Method: `cp main.ts main.ts.pre-v2-smoke` → plant → measure → `cp` back → `sha256sum` → re-measure.
Restore hash, all three rows: `d27756858acdc09a6ca9a63f109fd54b0156d086cb0440ae4ddbc4f3b09eeec8`.

| # | Plant | Expected to break | RED — and on what | Restored byte-identical | GREEN after |
|---|---|---|---|---|---|
| **B1** | `revertCanvasNode` delegates to `reconcileLiveCanvas(rawPath, snapshot, {initial:true})` again — i.e. the pre-WP119 body | A1 + A2 | **4 red.** T4 headline `expected 1 to be +0` (`setDataCount`); T4 WITNESS(A4), T2 headline `expected -900 to be +0` (n1 moved — the collateral), T2 positive control | ✅ hash match | 17/17 |
| **B2** | the `gate === "editing"` early exit removed from `applyCanvasNodeRevert` | the WP87 guard | **1 red.** `GUARD: a revert is WITHHELD while an inline editor is open`, `expected 777 to be 400` — the card was reseated under the open editor. ⚠ the WP87 **census stayed green** (§2.3) | ✅ hash match | 17/17 |
| **B3** | unconditional `return` at the top of `revertCanvasNode` — the "just stop reverting" non-fix | A4 | **4 red**, all `expected 400 to be 777`: T2 positive control, T4 WITNESS(A4), both GUARD rows. **The headline T4 row still PASSED** — which is the point of the plant | ✅ hash match | 17/17 |

`find . -name "*.pre-v2-smoke" -not -path "*/node_modules/*" | wc -l` → **0**.

---

## 8. Gate (bracketed, whole tree, sole worker)

| Gate | Result |
|---|---|
| `npx vitest run` (from `plugin/`) | **428 files · 3260 tests · 3260 passed · 0 failed** |
| `npx tsc --noEmit -skipLibCheck` | exit **0** |
| `npm run build` | exit **0** |
| `python workflowArtifacts/canvas-v2/check_signal_register.py` | exit **0** — *"clean - no NEW violations"*, 239 files scanned, control: all classes proved |

**Arithmetic against the charter's baseline.** Charter: `3243 / 427` plus WP119's file. The investigation's file
carried 12 rows ⇒ pre-WP119 baseline `3255 / 428`. WP119 takes that file 12 → 17 rows ⇒ **3260 / 428**. Exact,
no unexplained delta, nothing added or lost elsewhere.

**S146 discipline.** Every red seen in this run was re-measured on its own file before being attributed, and
every one turned out to be **real and mine**: the WP21 digest pin, the two WP87 census rows and the two WP93
census rows were all caused by my edits, not by a neighbour. **S153 did not fire** — `v2/wp93`'s
`no_collateral` was green both uncommitted and after commit, because my touched set is two files and neither is
the one it watches. **No other package's test was edited.** The only test file changed is WP119's own.

---

## 9. Does anything here change how often a canvas file gets written? — **NO. Strictly fewer, never more.**

Answered against the scope fence, in three parts:

1. **The reconcile route.** The replaced call was `canvas.setData(entire board)` via `reloadCanvasData`, which
   re-lays out every card and (per Investigation §2, traced) can provoke Obsidian's own `requestSave`. The
   replacement is one `applyNodeGeometry` on one card, and on the dominant case (§1: the loser's edit already
   reached the doc) it is `"unchanged"` — **no mutation at all**. Strictly fewer writes.
2. **The mute.** Removing the mute (§2.4) does **not** create a write. The mute suppresses our *reading* of a
   `modify` event, and for a canvas-owned path the gate never consults it in the first place
   (`files/vault-events.ts:379`). What decides is the byte echo breaker, untouched.
3. **`coldOpen` / `doc-wins` / the CRDT→disk writer / adoption arming.** Not touched, not called, and not made
   reachable. `canvas-mirror.ts`, `canvas-mirror-decision.ts`, `canvas-persistence.ts` and `canvas-sync.ts` are
   **byte-unchanged**; `git status` shows exactly two modified files. Nothing in the new code path can raise the
   rate at which any of them is entered — `applyCanvasNodeRevert`'s only outward calls are
   `adapter.isBusy`, `adapter.getEditingNodeId`, `adapter.getNodeFields`, `adapter.applyNodeGeometry`,
   `advanceFromReceipt`/`buildApplyReceipt` and `surfaceState.noteHandover`.

By the same argument the **A3 design in §4** is also write-neutral (locks carry no write authority since WP21),
so the remodel can take it without re-opening this question.

---

## 10. What I rejected, and why

| Rejected | Why |
|---|---|
| Narrow the payload and keep calling `reconcileLiveCanvas` | membership check ⇒ `"structural"` ⇒ `setData({nodes:[one]})` **deletes the rest of the board**; `movedEndpoint` re-issues it anyway (§2.2) |
| Add a `revertNodeId`/scope option to `reconcileLiveCanvas` | needs the plan forced AND the `movedEndpoint` escalation suppressed inside the hot path every remote delta uses. More surface, more ways to be wrong, for no gain over an isolated method |
| Escalate to a whole-board reload when a non-geometry field differs | that IS the defect. Reported instead (§2.5) |
| Stop claiming diff-inferred locks (A3's second option) | it is the ONLY acquisition path when the private Canvas API is unavailable (US3 AC2). Removing it disables per-card presence for those peers entirely |
| Keep the A3 idle-release in `canvas-presence.ts` | BUILD_SPEC §7 ESCALATE (§4) |
| Update the WP21 digest pin so my A3 change would fit | BUILD_SPEC §7: *"Weakening a test to make a suite green is an abort, never a fix — leave it failing and escalate instead."* Also forbidden by the charter |
| Update WP93's `main.ts×5` producer pin | avoided the need for it instead, by not arming a mute the canvas path never consults (§2.4) |
| Remove the loser-revert now that its justification has gone (§1) | would have passed A2 and failed A4. It is the remodel's call |
| Touch the rig | forbidden; a tester takes it next |

---

## 11. Residuals

| # | Residual | Severity | Owner |
|---|---|---|---|
| **R1** | **A3 UNREPAIRED — ESCALATE.** Diff-inferred claims still have no release. The design is in §4 and was measured green before being reverted for BUILD_SPEC §7. Cost is now bounded (one per-node apply, usually `"unchanged"`), so this is no longer destructive — but a peer's ring stays on every card the user has ever edited, for the session | medium | convergence remodel / whoever owns the WP21 AC2 invariant |
| **R2** | **A per-node revert of a NON-GEOMETRY field is not expressible** through `CanvasAdapter` (§2.5). Measured and named in the log line; not applied. Harmless while §1 holds (the loser's edit is in the doc), and it becomes real again if anyone re-introduces write-denial | low | convergence remodel |
| **R3** | **`{initial: true}` still conflates the fresh mount with a per-record authoritative pass** (§6). Not mine to redesign | low | convergence remodel |
| **R4** | **WP87's census `guards()` is structural and can be satisfied by a surviving sibling arm** — B2 deleted a real guard arm and the census stayed green (§2.3). My two behavioural GUARD rows cover this one sink; the class is not swept | low | reported, no signal allocated |
| **R5** | **The arrows are still unwitnessed.** The `CanvasDouble` has no renderer, so "arrows stay put while nodes move" remains traced, not measured. With the blast radius removed the symptom should not arise, but that is an inference | low | the tester on the rig |
| **R6** | **`S150` is untouched and still applies.** The reconcile→save→capture→push loop the investigation traced in §2 is not addressed by WP119; the repair reduces how often a reconcile fires, it does not terminate that loop | out of scope (fenced) | S150's rule owner |
| **R7** | **No live verification.** Everything here is headless. The owner's report is reproduced and repaired against `LiveSharePlugin.prototype`, not against Obsidian | — | the tester |

---

## 12. Files changed

```
plugin/src/main.ts
  ├── import          RECONCILE_GEOMETRY_KEYS added to the reconcile-plan import
  ├── revertCanvasNode        rewritten: keeps the node id, looks the record up,
  │                           delegates. Doc comment corrected (§1) with its evidence.
  └── applyCanvasNodeRevert   NEW private method (guarded per-node revert + WP5 receipt)

plugin/src/__tests__/v2/selmove/test_selection_moves_nodes.test.ts   12 rows -> 17
  ├── header                rewritten: EVIDENCE -> regression fence, chain updated
  ├── bindShippedMethods    NEW helper; binds all three prototype methods (shipped code)
  ├── harness               returns the adapter + a driver; subscribes so the lazy
  │                         monkey-patches are installed (else `isBusy()` cannot answer)
  ├── T2                    headline row INVERTED to the repaired behaviour;
  │                         + POSITIVE CONTROL (A4), + absent-node control,
  │                         + 2 GUARD rows (editing / dragging)
  ├── T3                    KEPT VERBATIM + ESCALATE banner (the leak is unrepaired)
  └── T4                    `it.fails` -> `it`; SANITY kept; WITNESS rewritten;
                            + WITNESS (A4)
```

`plugin/src/canvas/canvas-presence.ts`, `reconcile-plan.ts`, `canvas-adapter.ts`, `canvas-sync.ts`,
`canvas-persistence.ts`, `canvas-mirror*.ts` and `server/**` are **byte-unchanged**. `ARCHITECTURE.md`,
`README.md`, `docs/security.md` and `USER_STORIES.md` were not touched. No `data.json` was read, printed or
fixtured. `npx biome check --write` was never run.
