# WP119 — A selection is not an edit, and a revert of one node is not a reload of the board

**Owner-reported, reproducible every time.** Fix authorised by the owner: *"try the fix first, then send the
tester."* · **Worker:** fresh context · **Branch:** `fix-bugs-and-raceconditions`

---

## 0. Read this first

`workflowArtifacts/canvas-v2/Investigation_SelectionMovesNodes.md` — the mechanism is **already traced end
to end with file and line**, and a **failing test already exists**. You are not looking for the defect. You
are repairing it without breaking what the presence system is for.

The owner's report: *"When I select cards on client one, other cards jump around on client 2… The arrows
stay in place but the nodes on the canvas move."*

## 1. The chain, as measured

```
select card → updateSelection (monkey-patched, canvas-adapter.ts:874)
            → acquireLock → emitLocalState()                    ← becomes peer-visible HERE
peer        → reconcileClaims(): a node I hold that a LOWER clientID also holds → onRevert(nodeId)
            → main.ts:3896 → revertCanvasNode(path, nodeId, awareness)
            → main.ts:3914  ⚠ THROWS THE NODE ID AWAY
            → reconcileLiveCanvas(path, WHOLE snapshot, {initial: true})
            → reconcile-plan.ts:166  `if (input.initial) return "structural";`   ← no diff consulted
            → canvas-adapter.ts:1159 → canvas.setData(ENTIRE BOARD)
```

**The defect in one line: the trigger is one card, the effect is every card.** The clicked card is usually
the only one that does *not* move — it is the one both peers already agree on.

**Why every time, not sporadic:** `canvas-sync.ts:4130` claims a presence lock for **every node a local
capture upserts** (via `main.ts:2505`), and those locks have **no release path** — the releaser can only
release ids it added itself. The clientID tiebreak is **fixed for the session**, so the losing peer loses
every contest.

**Why the arrows hold still** (`main.ts:3157-3161`): geometry is written without recomputing edge routing,
and `setData` reuses existing nodes. Keep this property in mind — it is also the user's tell that *the
plugin*, not a person, moved the cards.

## 2. The task

**A1 — A revert reverts THAT NODE.** `revertCanvasNode` receives a node id and must act on it. A
whole-board `setData` in response to one contested node is the defect. If a targeted revert cannot be
expressed through the current adapter, **say so with the reason** rather than narrowing the blast radius by
guesswork.

**A2 — A selection must not move any card on a peer.** The failing row already states it:
`test_selection_moves_nodes.test.ts` **T4** — *"a read-only selection on peer A must not move any card on
peer B"* — currently `expect(setDataCount).toBe(0)` receiving `1`. **Make it pass and convert it from
`it.fails` to an ordinary test.** Its SANITY and WITNESS rows exist so a pass is attributable; keep them.

**A3 — Give diff-inferred locks a release path**, or stop claiming them. A lock acquired for every upserted
node, which only its own adder can release, is why this never recovers. **Decide which and justify it** —
if you keep the claim, the release must be reachable in the ordinary case, not only on teardown.

**A4 — Do not break what presence is for.** The lock/claim system exists so two people do not fight over
one card. **A genuine contested edit must still be resolved**, and the loser must still converge. Assert
that, do not assume it — a fix that stops all reverting would pass A2 and be worse than the bug.

**A5 — `{initial: true}` deserves a look but is NOT yours to redesign.** `reconcile-plan.ts:166` returns
`"structural"` unconditionally. Your package is the **caller that passes it wrongly**. If you conclude the
flag itself is wrong, **report it** — the canvas convergence remodel is being chartered separately and that
is where it belongs.

## 3. Scope fence — read it, this is a live area

A separate investigation just landed (`Investigation_CanvasConvergence.md`) and a remodel will be chartered
from it. **Out of scope for you, and deliberately so:**

- the host attaching a CRDT→disk writer (`canvas-mirror.ts` / `canvas-mirror-decision.ts`)
- the `coldOpen` / `doc-wins` path — **it destroyed 318 nodes of the owner's board today**, and a conflict
  copy for it is being chartered. **Do not touch it, and do not make anything reach it more often.**
- serialisation spelling (`S150`), adoption arming (`S170`)

**If your fix would change how often `coldOpen`, `doc-wins`, or a canvas file write occurs, stop and say
so.** That path currently has no net under it.

## 4. Method and gate

**Falsifiability (Dispatcher Rule 11):** a break table — plant, RED **for the right reason**, restore
byte-identically by copy-aside, GREEN. Zero `.pre-v2-smoke` files at the end.

**Gate:** full `vitest` + `tsc` clean, bracketed, and `check_signal_register.py` exit 0. Baseline
**3243 tests / 427 files** plus WP119's new file, measured by the Dispatcher on a quiet tree.
**You are the only worker in this tree, so a failure you see is REAL** (`S146`) — but re-run any RED on its
own before attributing it. Known trap: **`S153`**, WP92's `no_collateral` goes red while your work is
uncommitted and green once committed. **Do not edit another package's test.**

**Rules:**

1. **Demonstrated beats argued.** The measured `setDataCount`, the node that did not move.
2. **No partial test doubles** — six packages lost to them. Drive the real object or state which paths your
   double does not exercise. The existing test drives `LiveSharePlugin.prototype`, so it measures shipped
   code; keep that property.
3. Every new test gets a positive control.
4. **Correct this charter if it is wrong.** Seven workers in a row have corrected the premise handed to
   them and all seven were right.
5. **Signal numbers: next free is S173, and you allocate none.** <!-- signal-register: meta -->

**Hard constraints:**

- **Do not rebuild, redeploy, or drive the three live vaults.** A tester takes the rig after you.
- **Never `npx biome check --write`** — it corrupts this tree.
- Never commit to a default branch. **Explicit path staging only.** `ARCHITECTURE.md`, `README.md`,
  `docs/security.md`, deleted `USER_STORIES.md` are the **owner's**.
- **`data.json` holds live credentials** — never print, log, echo or fixture a value.
- **Commit before you report.**

**Deliverable:** `workflowArtifacts/canvas-v2/ImplementationReport_WP119.md`.
