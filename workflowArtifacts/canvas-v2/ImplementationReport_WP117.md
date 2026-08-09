# WP117 — Guest canvas creation, host-mediated (S122)

**Branch:** `fix-bugs-and-raceconditions` · **Base:** `e09b87e` · **Worker:** 3j, sole worker in this tree
**Deliverable:** the capability the owner required — *"let any guest initialise new canvases"*, *"new or imported"*.

---

## 0. Verdict in one line

**Implemented as sanctioned, and the residual closed with it.** A guest-authored or guest-imported
`.canvas` now reaches every peer byte-identically, the host remains the sole minter, sole seeder and sole
manifest writer, and the `NO_PEERS` guest-seed data-loss route is closed and **demonstrated** closed with the
condition induced rather than argued about.

**I did not implement the declined content-free variant and I do not think the sanctioned design is wrong.**
One thing about it needed adding that the spec does not name, and it is in §3: the host must project its own
new file from the document after seeding, or the host is the one peer whose bytes differ from everybody
else's for the same records.

---

## 1. Acceptance, criterion by criterion

| | Criterion | Verdict |
|---|---|---|
| **A1** | A guest-created `.canvas` becomes real for every peer, byte-identical, originator on the host's doc | **MET, with one named limitation** |
| **A2** | Import is covered | **MET** |
| **A3** | The host validates: `isPathSafe`, `isSharedPath`, `isProtectedPath`, a size bound | **MET, and widened** |
| **A4** | A refusal reaches the guest and is visible; counted and logged, every branch | **MET** |
| **A5** | Size — state what happens at the bound | **MET as stated; PARTIAL against spec requirement 3** |
| **A6** | The originating guest adopts rather than keeping a private copy | **MET** |
| **A7** | The residual demonstrated closed with `NO_PEERS` induced | **MET** |
| **A8** | WP83, host-only manifest authority and single-writer still hold, asserted | **MET, with a premise correction** |

### A1 — it becomes real for every peer · **MET, with one named limitation**

`test_tp02`, first row. Three peers in one world: host, the originating guest `g1`, a third guest `g2`. `g1`
plants a canvas, asks, and all three end holding the same bytes.

Scored with **WP116's oracle**, `judgeConvergence`, which is unreachable without an expectation. The
expectation's `origin` names the fixture this test wrote down before any frame was sent — never a reading
taken off a peer. `CONVERGED`, `violations: []`.

The identity every peer resolves is the **host's mint** (`g1` and `g2` read the same guid the host minted;
a guest never mints, so a resolvable guid is proof of who minted it).

**The limitation, pinned as its own test row rather than left in prose:** an **empty** canvas — Obsidian's
"New canvas" writes a file with no records — reaches the **host** (file created, manifest entry, guid minted,
originator adopted) but **not a third peer**, because `decideCanvasMirror` refuses to materialise from a doc
with no records. That refusal is deliberate and is not mine to reopen: *"an empty doc materialises no file …
because an empty file that then wins a reconcile is how the E2 cascade destroyed user data."* The first card
the user drops closes it, and the test measures that too.

### A2 — import · **MET**

`test_tp02`, the import row. The distinction between "new" and "imported" is **not a branch in this plugin**:
both raise one vault `create` carrying the file's bytes, and the door is on that event. What is different
about an import is that the bytes are somebody else's, so the row plants a 40-node / 20-edge board,
pretty-printed with a foreign key order, and judges it with the same oracle. `CONVERGED`.

### A3 — the host validates before it acts · **MET, and widened**

`files/canvas-create-decision.ts`, a pure zero-import core in the precedent of `canvas-mirror-decision.ts`.
Seven clauses, and the **order is part of the contract**:

1. **AUTHORITY** — `role === "host"`. Every peer receives the broadcast request; this is the clause that
   makes exactly one of them act.
2. **SHAPE** — a `.canvas`, and `isPathSafe`.
3. **PROTECTION** — `isProtectedPath`, asked **before** membership so the answer never depends on how the
   share happens to be configured.
4. **MEMBERSHIP** — `isSharedPath`, evaluated on the **host**.
5. **SIZE** — before the parse, so an oversized payload is never walked.
6. **CONTENT** — the bytes parse as a canvas document (`parseCanvasReport(...).degraded === false`).
7. **COLLISION** — the host already holds a file there. **Refused, never overwritten** (I11).

Two additions beyond the four the charter names, and both are load-bearing: **content validity** (bytes that
are not a canvas would seed nothing and leave a file no peer could resolve) and **collision** (a request that
overwrote a host file would be a peer-driven destruction of a user's board).

**Collision is last on purpose.** It is the only clause whose answer describes the host's own disk, so a
request refused for any of the six reasons above it is refused without that answer being derivable from the
reply. `test_tp01` asserts that ordering directly.

`test_tp01` runs each clause **in both directions** — the row that refuses, and the same observation with only
that field repaired, which must then reach the *next* clause. A guard that refuses everything satisfies every
one-sided refusal row ever written. Fail-closed is asserted per field: deleting any one of the nine fields
refuses with that field's own verdict, and a non-object argument refuses rather than throwing.

### A4 — a refusal reaches the guest and is visible · **MET**

Three separate things, asserted separately, because a refusal can satisfy any two and still be invisible:

- **The user is told.** `new Notice` (not `plugin.notify`, which a preference can suppress), in a sentence
  naming the file, the reason, and the fact that the file is still in their vault.
- **It is counted, by token.** `CanvasCreateStats.refusedByReason[<verdict>]`, and on the host
  `decided[<verdict>]`.
- **Every branch is counted, including the do-nothing ones (S155).** Seven named guest-side declines
  (`not-guest`, `not-canvas`, `outside-share`, `already-shared`, `unreadable`, `too-large`, `no-channel`),
  nine host-side verdicts including `refuse-not-host`, and `unmatchedResults` for the ordinary case of a
  peer receiving another peer's result. `requestCreate` **returns** its branch, so "declined" and "never
  called" differ at the call site as well as in the ledger.

Three silences that would otherwise have been `S114`'s shape are covered:

- **A host-side failure mid-materialisation.** An accepted request that then throws is the one case where
  silence would be indefensible — the user's canvas is in their vault and in nobody else's. Counted as
  `materialiseFailed`, and the guest is sent a refusal carrying the error text. `test_tp03` breaks
  `vault.create` and reads the notice.
- **No answer at all** — an absent host, an older relay, a peer on an older build. A `CANVAS_CREATE_TIMEOUT_MS`
  (30 s) timer on the injected scheduler fires one notice and counts `timedOut`. An answered request disarms
  it, which is a separate row.
- **A refusal that never reaches the wire.** The oversized case notifies locally (below).

Live-readable surface: `LiveSharePlugin.getCanvasCreateStats()`, plus `CANVAS CREATE REQUESTED/REFUSED/
MATERIALISED/UNANSWERED/ACCEPTED` log lines.

### A5 — size · **MET as stated; PARTIAL against spec requirement 3**

**`CANVAS_CREATE_MAX_BYTES = 512 KB`**, and it is derived from a measurement rather than guessed: the relay's
control `WebSocketServer` is constructed with **`maxPayload: 2 MB`** (`server/src/control-handler.ts`), the
file-transfer path chunks at 512 KB for the same reason, and end-to-end encryption expands a payload by
base64 plus an IV (~1.4×). `test_tp06` reads the relay's literal out of the source and asserts
`CANVAS_CREATE_MAX_BYTES * 3 < ceiling`, so the bound cannot drift into the ceiling unnoticed.

**What happens at the bound**, stated because the charter asks:

- **At or below**: the request is sent as one frame.
- **Above**: the **guest refuses locally, before a frame is sent**, shows a notice naming the file, its size
  in KB, the limit, and what to do instead ("ask the host to add it to the shared folder"), and counts
  `too-large`. `test_tp03` asserts **zero frames on the wire** for that arm. The alternative — sending it —
  is a frame the relay drops with a 1009 close, i.e. `S114`'s silence with a dead link on top.
- **The host enforces the same bound independently.** A guest's word on size is not evidence; an older or
  hostile build sends whatever it likes. `test_tp03` runs a host with a 100-byte bound against a guest with a
  1 MB one and reads the host's `refuse-too-large`.

**Where this is PARTIAL.** Spec §7 requirement 3 says large canvases "must not be assumed small" and notes the
binary transfer chunks to 50 MB. 512 KB is over **ten times** the 45 KB the owner's own boards reach, but it
is not 50 MB. A canvas above it is refused with a visible explanation rather than transferred. **The chunked
variant is a residual, and the reason it is not in this package is specific** — see §6, R1.

### A6 — the originator adopts · **MET**

`decideCanvasMirror` gains one verdict, `ADOPT_LOCAL_FILE`, reachable **only** when
`role === "guest" && localFileExists !== false && originatedHere === true && identityResolves === true`.
It licenses no write of its own: like `MATERIALISE` it hands the path to the one existing writer, whose cold
open then decides (`doc-wins` rewrites the file; an empty doc writes nothing).

`test_tp05` enumerates the pre-WP117 table's **sixteen** rows and asserts every one answers what it answered
before, both with the flag absent and with it explicitly `false`; then it computes which rows the flag changes
and pins the answer to exactly the two named guest rows. Fail-closed is asserted for nine non-`true` spellings
of `originatedHere` (`"yes"`, `1`, `{}`, …) — truthiness would admit all of them.

**Scored on disk bytes, not on the verdict (S138).** The mirror's adopt arm re-reads the file after the
attach, and `test_tp02`'s strongest row for this criterion does not look at a verdict at all: it edits the
**host's** document after the creation and watches the **originator's file** follow. A guest holding a private
replica cannot pass that row however byte-identical its file was a moment earlier.

**One-shot.** `noteAdopted` clears the flag, so a later pass over the same path is an ordinary
`skip-local-file` and the writer attach is not re-entered for the life of the session. Counted as
`adoptionsArmed` / `adoptionsCleared`.

### A7 — the residual, demonstrated closed with `NO_PEERS` induced · **MET**

`test_tp04`. Nothing in that file is argued.

**The condition is induced.** The harness's relay answers the sync step by the product's own rule —
`peerCount === 0` means nobody else holds this doc — and keeps a ledger. The test reads that ledger and
asserts the guest's first sync step for the canvas returned **`NO_PEERS`**, then asserts what `subscribe`
recorded: `{sidecarKnowsDoc: false, peerKnowsDoc: false}`. A **positive control** row asserts that with those
two witnesses false and no role, `decideSeed` **does** return `SEED_FROM_FILE` — without it the two arms below
would agree because nothing ever seeds.

**The scenario is the spec's, made concrete.** A previous session published the canvas's guid; nobody holds the
document. The host's board holds one card; the guest's week-old copy holds that card **and one the user
deleted**. The guest wins the subscribe race.

**Control arm** (`stampSeedRole: false` — the pre-WP117 `seedKnowledge` line, byte for byte, one field
different and nothing else in the world): the guest seeds, the host arrives second, `doc-wins`, and
**`deleted-last-week` is written into the host's own `.canvas` on disk.** Real data loss, measured on disk
bytes.

**Repaired arm:** the guest's shared document holds **zero** nodes after its cold open, the host's disk keeps
exactly the records it had, and the guest converges onto the host's document rather than keeping its stale
copy.

**The repair.** `decideSeed` gains an **authority** clause asked ahead of both evidence witnesses: a role that
was *stated* and is not `"host"` refuses. An **omitted** role keeps WP29's table exactly, which is asserted in
both directions for all four rows. The role is stamped at `main.ts`'s `attachCanvasWriter` from the live
session role rather than recorded in `CanvasSync.subscribe` — deliberately, because `subscribe` has early
exits that never reach the recording line, and a path that left by one of those answers `NOTHING_KNOWS_DOC`,
which has no role. Stamping at the one place every cold open passes through covers those too. `canvas-sync.ts`
therefore keeps WP29's object shape unchanged (two measurements, no policy), and its comment says why.

**Attribution (S155).** `explainSeed` returns the decision **and** the clause that produced it, from a closed
set of five rules; `decideSeed` is exactly `explainSeed(...).decision`, asserted over all twelve inputs.
`coldOpen` logs `SEED DECISION: <path> decision=… rule=…`, so "a guest was refused the seed" and "this line
was never reached" stop being the same reading in a live log.

### A8 — the three invariants · **MET, with a premise correction**

- **WP83 — a `.canvas` is never synced as raw text.** `test_tp02` asserts the complete wire trace of a
  creation is `["canvas-create-request", "canvas-create-result"]` — one structured frame each way, no
  `file-op`, no `file-chunk-*`. `skipsAutoTextSync` and both of its consulting sites are byte-unchanged.
  The new types are deliberately **not** `FileOp` members, so `applyRemoteOpInner`, the offline queue, the
  chunk assembler and WP83's own emission census never see a canvas payload. The census is unchanged
  (verified: it stayed green), and `canvas-create.ts` imports `isCanvasPath` rather than spelling
  `endsWith(".canvas")` privately — WP83's private-speller census caught that during development, by name,
  which is exactly what it is for.
- **Host-only manifest authority.** Asserted in the shape it actually holds — see the correction below.
- **Single writer.** Exactly one peer seeds and it is the same peer that always did. `test_tp02` asserts both
  guests reached `doc-wins` (the branch that never reads a file) and that `explainSeed` refuses a seed for
  either of them.

**PREMISE CORRECTION — the charter's and the spec's door table is wrong about one door.** Both say
*"manifest `updateFile` | `role === "host"` | correct"*. **`ManifestManager.updateFile` has no role test at
all** — its only guards are `this.manifest` and `isSharedPath`. The `role === "host"` gate is at the **call
sites** in `files/vault-events.ts` (the create / modify / delete arms). Measured, not argued: `test_tp02` calls
a guest's `updateFile` directly and the entry lands, and that measurement is pinned so the correction cannot
go stale. The invariant itself is untouched — no guest *calls* it — but the guard is one layer further out
than both documents say, which matters for anything that adds a new caller. **This feature adds one, and it is
on the host.**

---

## 2. How the handoff works

```text
GUEST   vault `create` for a `.canvas` in the shared folder
        └── seven local branches, all counted; the survivor sends
            canvas-create-request {requestId, path, content}   ← ONE frame, encrypted
HOST    re-derives every claim against ITS OWN vault → decideCanvasCreate
        ├── refuse  → canvas-create-result {accepted:false, reason, detail}
        └── accept  → 1. vault.create(path, content)
                      2. manifest.updateFile(file, content)
                      3. canvasSync.subscribe(path, "host")   ← mints, binds, seeds
                      4. attachCanvasWriter(path)             ← canonical projection
                      → canvas-create-result {accepted:true}
BOTH    the relay broadcasts the result; exactly one peer recognises the id
GUEST   accepted → the path becomes ADOPTABLE
        next mirror pass → adopt-local-file → the one existing writer → doc-wins
OTHERS  next mirror pass → materialise (unchanged)
```

**Step 4 is not in the spec and it is necessary.** Without it the host's disk keeps the **guest's**
serialisation while every mirroring peer writes the **canonical** one (`serializeCanvas` over the doc) — same
records, different bytes, from the moment of creation. It is not the case WP79's "a host's file is never
rewritten by a pass" rule protects: the file did not exist a moment ago, it was created by this operation out
of bytes this host still holds, and the doc it is projected from was seeded from exactly those bytes. Break
row **B10** removes it and `test_tp02`'s convergence row goes red.

**Ordering is the design.** Reversing 1 and 3 seeds an empty document and then writes a file nothing is
subscribed to.

**No path mute on the host's own create**, and that is a decision rather than an omission. Every other
remote-originated write takes one; here all three consumers of the resulting vault event are already correct
without one, each at a line a test can point at (`onFileCreate` refuses via `skipsAutoTextSync`;
`BackgroundSync.onFileAdded` refuses with the same predicate; `requestCanvasCreate` declines `not-guest`).
A mute would buy nothing and cost something real: the create would be counted as a `MUTE DROP` on the ledger
a live validator reads for swallowed user gestures (S120), where it would be a false positive.

**Transport.** Two new `ControlMessage` types, precedent `sync-request`. Consequences, each deliberate:

- **I8 holds** — `canvas-create-request` is on the encryptable list and **both** its `path` and its `content`
  are encrypted; `requestId` is a random uuid carrying no user data and travels in the clear so it stays
  usable as the correlation key. Break row **B12** removes it and `test_tp06` goes red.
- **The relay treats the request as a file WRITE**, so a read-only guest cannot reach the host with one; and
  `canvas-create-result` is in `HOST_ONLY_TYPES`, so only the host can answer even if a client never runs the
  plugin's own `not-host` clause. Two independent guards on purpose.
- **The relay must be redeployed** before this can be live-verified — the allow-list is a closed set. Stated
  as a handoff fact in §6, R5.

---

## 3. What I rejected, and why

**The content-free variant** (announce the path, let the originating guest seed from its own file). Not
implemented, and I agree with the two declines: it hands seeding to guests, which makes the A7 residual
*worse* rather than closable, and it would have required the guest to mint or the host to mint blind.

**Carrying the request as a new `FileOp` inside the existing `file-op` envelope.** Tempting — no server change
at all, and `encryptAndSend` already encrypts `op.content`. Rejected because it puts a canvas payload into the
union `applyRemoteOpInner`, the offline queue, the chunk assembler and **WP83's emission census** all consume.
The cost of the road not taken is one relay deploy; the cost of the other road is a canvas payload inside the
raw-write machinery WP83 exists to keep it out of.

**Reusing the existing chunk transfer verbatim** for large canvases. Its terminal action is a raw
`vault.create` / `vault.modify` **on every peer that receives it** — precisely WP83's forbidden shape. It needs
its own assembly path that terminates in the canvas-create handler instead of a disk write, which is a package
of its own. See R1.

**Adding a path mute around the host's create** — see §2.

**Recording the role in `CanvasSync.subscribe`'s seed knowledge.** Written, then reverted: `subscribe` has
early exits that never reach that line, so it would have left the pre-WP117 table in force on exactly the
paths whose subscribe went wrong. Stamping at the writer attach covers those. It also kept WP29's
`test_tp03` green without editing it.

**Editing WP93's `armMuteRelease` producer census and the S116 teardown-window test.** Both reddened during
development. Neither was edited: the mute was dropped for the reason in §2, and the teardown comment was
shortened so the other package's 2000-character window still holds. **No test belonging to another package was
modified in this work package.**

---

## 4. Break table (Dispatcher Rule 11)

Harness: `workflowArtifacts/canvas-v2/wp117_break_table.py`. Each row copies the file aside, plants **one**
defect, runs the named tests, restores from the copy, and verifies the restore with **sha256**. A row whose
restore does not compare equal aborts the run.

**13 rows planted · 13 RED · 13 restored byte-identically (sha256 equal) · script exit 0.**

| Row | File | Defect | Result |
|---|---|---|---|
| B1 | `canvas-create-decision.ts` | the AUTHORITY clause | RED — tp01+tp02, 12 failed / 9 passed |
| B2 | `canvas-create-decision.ts` | the PROTECTED clause | RED — tp01, 4 failed / 9 passed |
| B3 | `canvas-create-decision.ts` | the SIZE clause (host) | RED — tp01+tp03, 5 failed / 21 passed |
| B4 | `canvas-create-decision.ts` | the COLLISION clause | RED — tp01+tp03, 4 failed / 22 passed |
| B5 | `canvas-seed-decision.ts` | **the residual's repair** | RED — tp04, 3 failed / 3 passed |
| B6 | `canvas-mirror-decision.ts` | the ADOPT verdict | RED — tp05+tp02, 9 failed / 7 passed |
| B7 | `canvas-mirror-decision.ts` | ADOPT in the admission gate | RED — tp05+tp02, 7 failed / 9 passed |
| B8 | `canvas-create.ts` | the guest-side size bound | RED — tp03, 1 failed / 12 passed |
| B9 | `canvas-create.ts` | the refusal notice (A4) | RED — tp03, 3 failed / 10 passed |
| B10 | `canvas-create.ts` | the host's own projection | RED — tp02, 3 failed / 5 passed |
| B11 | `vault-events.ts` | the vault-event door | RED — tp06, 1 failed / 9 passed |
| B12 | `control-ws.ts` | I8, the encryptable list | RED — tp06, 1 failed / 9 passed |
| B13 | `canvas-create.ts` | the `already-shared` echo guard | RED — tp03, 1 failed / 12 passed |

Every row went red **on assertions about the thing it broke**, named in the harness output. **Zero
`.pre-v2-smoke` files at the end** (`find` over the tree: none).

---

## 5. Gate

| | Figure |
|---|---|
| `plugin/ npx vitest run` | **427 files / 3243 tests, 0 failed** (baseline 421 / 3184 → +6 files, +59 tests, all mine) |
| `plugin/ npx tsc --noEmit -skipLibCheck` | clean |
| `server/ npx tsc --noEmit` | clean |
| `server/ npx vitest run` | 18 files / 149 tests, 0 failed |
| `check_signal_register.py` | exit 0 — *"clean - no NEW violations"*, 233 files scanned |
| Break table | 13/13 RED, 13/13 restored sha256-equal, exit 0 |
| `.pre-v2-smoke` files | 0 |

**S153 note:** WP92's `no_collateral` did **not** go red while this work was uncommitted, unlike the three
previous reports. My changes touch none of the files it attributes on, which is consistent with the signal's
mechanism rather than a contradiction of it. **Post-commit re-run at `a81b4ee`: 427 files / 3243 tests, 0
failed — identical to the pre-commit figure, and the working tree is clean.**

**Not in the gate:** `biome check` reports diagnostics on my new files **and on pre-existing ones**
(`canvas-sync.ts`, `manifest.ts`), so it is not a clean gate in this tree. `biome check --write` was never
run — the charter forbids it and it corrupts this tree.

---

## 6. Residuals

**R1 — canvases above 512 KB are refused, not chunked.** The chunked variant needs its own assembly path
(transferId, resume, staleness) whose terminal action is the canvas-create handler and **not** a disk write.
Reusing the existing chunk machinery would land raw `.canvas` bytes on every peer, which is WP83's forbidden
shape. This is the honest partial against spec requirement 3, and it is a package of its own.

**R2 — an empty guest-created canvas does not reach a third peer** until it holds a record. Pinned as a test
row (§A1). Closing it would mean reopening WP79's empty-doc refusal, which protects against the E2 cascade;
it should not be reopened without its own package.

**R3 — the timeout is a `setTimeout` and is therefore clampable (S71).** The consequence of a clamp is a
**late** notice and never a wrong action: nothing but the notice hangs off it. `timer-clamp.ts` was not used —
the scheduler is injected and the test drives it directly, which is strictly stronger than a clamp fixture for
this timer. If a live round wants a clamped-arm measurement, the seam is `CanvasCreateEnv.scheduler`.

**R4 — the adoption arms on the ACCEPT and is cleared by the next mirror pass.** If no mirror pass runs before
the session ends (no manifest change reaches this peer), the adoption is lost and the guest keeps its file
until the next session's join pass. Not observed in any test; stated because it is a real ordering
dependency.

**R5 — the relay must be redeployed before live verification.** `ALLOWED_TYPES` is a closed set, so the
current build on the pinned rig (`1ddad2155341adbd`) drops both new message types. The plugin needs a rebuild
for the feature in any case; the relay is the extra step. **Nothing was rebuilt or deployed and no vault was
touched.**

**R6 — no live verification.** Everything here is headless. The harness drives the real coordinator, the real
decisions, the real `CanvasSync.subscribe` (real mint, real bind, real host seed), real `ManifestManager`s
sharing one replicated `__manifest__` document, the real mirror pass and the real `CanvasPersistence`. The
**relay, the vault, the control channel and the sidecar are doubles**, and the harness header says so in as
many words, including what each one does not exercise. In particular no vault EVENT is raised in this world —
`vault-events.ts`'s routing is covered by a source-derived row in tp06, not behaviourally.

**R7 — `getEntries()` as the guest-side echo guard.** `manifestKnows` reads manifest membership. A guest whose
manifest replay has not landed yet would answer `false` and could ask the host to create a canvas the session
already holds; the host then refuses `already-exists` and the user sees one avoidable notice. Nothing is
destroyed. A `manifestSynced`-aware guard is the tidy fix and was out of scope here.

**R8 — the `?.` on `plugin.requestCanvasCreate`.** Ten harnesses build partial `plugin` doubles and a hard
call turns each into a `TypeError`, so the call is optional — the precedent and the wording are
`vault-events.ts`'s own, for `noteMuteConsumed`. `test_tp06` pins that the real `LiveSharePlugin` declares the
method, so the optionality can tolerate a double without becoming a silent absence in the product (break row
B11).

---

## 7. Files

**New (production):**
`plugin/src/files/canvas-create-decision.ts` · `plugin/src/files/canvas-create.ts`

**Changed (production):**
`plugin/src/main.ts` (coordinator wiring, `requestCanvasCreate`, `getCanvasCreateStats`, mirror deps, seed-role
stamp, teardown) · `plugin/src/files/vault-events.ts` (the create-event door) ·
`plugin/src/files/canvas-mirror-decision.ts` (`ADOPT_LOCAL_FILE`) · `plugin/src/files/canvas-mirror.ts` (the
adopt arm, `adopted` count, two new deps) · `plugin/src/files/canvas-seed-decision.ts` (`role`, `explainSeed`,
`SEED_RULE`) · `plugin/src/files/canvas-persistence.ts` (narrate the seed rule) ·
`plugin/src/files/canvas-sync.ts` (comment only — states why the role is **not** recorded there) ·
`plugin/src/sync/control-handlers.ts` (two handlers) · `plugin/src/sync/control-ws.ts` (encrypt the request) ·
`plugin/src/types.ts` (two message types) · `server/src/control-handler.ts` (allow-list, write class,
host-only result)

**New (tests):** `plugin/src/__tests__/v2/wp117/` — `harness.ts`, `test_tp01`…`test_tp06`, 59 tests.

**New (artifact):** `workflowArtifacts/canvas-v2/wp117_break_table.py`, `ImplementationReport_WP117.md`.

**Not touched:** `ARCHITECTURE.md`, `README.md`, `docs/security.md`, `USER_STORIES.md`, any vault, any
`data.json`. No signal numbers allocated.
