# WP109 — A note born during a session is published but never subscribed

**Signal:** S134 (P0) · **Worker:** W3c, fresh context · **Branch:** `fix-bugs-and-raceconditions` ·
**Base:** `26581d2`

---

## 1. The defect, as measured in three real vaults

A note created **during** a live session propagates its BYTES (manifest, 0.00–0.15 s) and its PATH, but
**no peer ever subscribes the document.**

Measured on all three clients, same session, same build:

| | `observers` | `synced` |
|---|---|---|
| file present at session start | `true` | `true (peer-state)` |
| file created mid-session | **`false`** | **`false`** |

The consequence chain, all of it read in code and observed live:

1. `editor/collab.ts:169` — `await syncManager.waitForSync(filePath)` rejects at its 10 s timeout.
2. The `catch` immediately below **reconfigures the CodeMirror compartment to EMPTY** and shows
   `Live Share: sync timed out`.
3. `collabBoundFile` is assigned **synchronously, before the await**, so it is still set. **Every internal
   indicator reports "bound".**
4. Three peers then edit three unlinked copies of one shared note. **Nothing counts a refusal, logs a line,
   or moves a counter.**

**Creating a note during a session is the ordinary case.** This is the most reachable defect in the product.

### The control that makes it a result

A `Leave` / `Start` / `Join` cycle turns those same files into session-start files. The **identical**
concurrent-edit arm then converges in **0.54 s** with `synced: true` everywhere — same file, same peers,
same build. Only the file's birth-time relative to the session differs.

### What this is NOT

- **Not S119.** S119's floor exempts the editor path by design (`background-sync.ts` returns for
  `activeFile`).
- **Not S129.** S129 is the *fall-through* after the bounded wait. Here the empty bind comes from the
  **catch**, on a path S129 never reaches.
- **Not S128.** `waitForSync` here does not resolve wrongly — it **rejects**, correctly, because the
  document genuinely never synced.

---

## 2. Where to start, and what is already known

These are anchors, **not a diagnosis**. Confirm or refute each before building on it.

- `files/background-sync.ts:256` — `onFileAdded(rawPath)`: canonicalises, `isTextFile` gate,
  `skipsAutoTextSync` gate, then `await this.subscribe(path)`. **Subscription for a mid-session file is
  supposed to happen here.**
- Its callers: `files/vault-events.ts:191` (local create), `main.ts:1176`, `main.ts:1191`, `main.ts:1212`,
  `sync/control-handlers.ts:209`. **The call sites exist** — so "nobody calls it" is the cheap hypothesis
  and is probably wrong. Establish which of these fires for a mid-session inbound file and what
  `subscribe()` does when it does.
- `sync/sync.ts:510` — `waitForSync`, and its `SyncResolution` reasons (S128's work). A `PEER_STATE` /
  `NO_PEERS` / `ALREADY_SYNCED` discriminator already exists and may be the cheapest instrument here.
- `editor/collab.ts:102` — `activateForFile`, and `:169` the await whose catch does the damage.

**Open question worth answering early:** is `observers: false` a *missed subscribe call*, a subscribe that
**returned early**, or a subscribe that ran but whose observer was later torn down (`onFileRemoved` /
`onFileRenamed` both `unobserve()` and `releaseDoc`)? These need different repairs and the report must say
which one it was, with the evidence.

---

## 3. The task

**AC1 — The mechanism, demonstrated.** A test that reproduces the divergence: a document created
mid-session is not subscribed, and an editor activation on it lands in the catch. RED before your fix,
GREEN after, and the RED must fail **for this reason** — assert the mechanism, not just an outcome.

**AC2 — The fix.** A note created during a session subscribes and syncs like a session-start file.
Do not paper over it in `activateForFile`: if the document was never subscribed, making the editor wait
longer is not a repair.

**AC3 — The bind must not lie.** When `waitForSync` rejects and the compartment is reconfigured to empty,
`collabBoundFile` must not still claim the file is bound, **and the event must be counted and logged to the
debug log** — not only shown as a Notice. This is the half that made the defect invisible for a whole day
and it stands on its own even if AC2's repair is complete: it is what will catch the next member of this
family.

**AC4 — Falsifiability, per Dispatcher Rule 11.** A break table: for each fix, plant a break, show the test
goes RED **for the right reason**, restore byte-identically by copy-aside, show GREEN. Every `.pre-v2-smoke`
copy-aside removed by the end — the run is not clean until zero remain.

**AC5 — Gate.** `vitest` full suite and `tsc` clean, both **bracketed** (figures before your first change
and after your last), plus `python workflowArtifacts/canvas-v2/check_signal_register.py` exit 0. Baseline
at `26581d2` is **3000 tests / 407 files**. If a deliberate pin reddens (WP93's census pin has form here),
**update the pin with written justification and without weakening the property** — that is part of the
package, not a follow-up.

---

## 4. Method rules — these are not optional

1. **No partial test doubles.** A double that implements half a collaborator silently skips whole code
   paths; this has cost **four** packages in this run. Either drive the real object or state in the report
   exactly which paths your double does not exercise.
2. **Demonstrated beats argued.** "The guard now covers it" is not a result. The executed loop, the
   observed state transition, or the measured byte is.
3. **A green that could not have gone red is not a measurement.** Every new test gets its positive control.
4. **Report S134 in its own section** with its own evidence. If you find something adjacent, report it —
   do not silently fold it in.
5. **Signal numbers: next free is S141, and you allocate none.** <!-- signal-register: meta -->
   Report new findings in prose; the Dispatcher numbers them.
6. **Correct the charter if it is wrong.** Previous workers have corrected the Dispatcher's arithmetic and
   premises and were right to. Say so in the report rather than quietly working around it.

---

## 5. Hard constraints

- **Do not rebuild or deploy the plugin.** Live rig is pinned at build `d8f98603ad6ddb1c`; W4 owns the
  vaults. Your work is code + unit/harness tests only.
- **Never run `npx biome check --write`** — it corrupts this tree.
- **Commits:** never to a default branch. **Explicit path staging only — never `git add -A`.**
  `ARCHITECTURE.md`, `README.md`, `docs/security.md` and the deleted `USER_STORIES.md` are the **owner's**
  — never stage, revert or touch them. Never stage secrets, `.env`, or build output.
- **`data.json` in the vaults holds live credentials.** Never print, log, echo or fixture a value from it.
  Naming a key is fine; naming a value is not. **No secret through any agent tool.**
- Commit at the checkpoint the workflow defines, and **commit before you report** — a predecessor was
  killed on the step before committing and cost a whole rescue.

---

## 6. Deliverable

`workflowArtifacts/canvas-v2/ImplementationReport_WP109.md` — the mechanism with its evidence, the break
table, the bracketed gate figures, what you rejected and why, and any residual you deliberately left.
