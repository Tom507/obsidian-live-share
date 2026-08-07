# Implementation Report — WP92 (C92): the durable withhold is keyed by the DOCUMENT

**Batch:** B57 · **Worker:** 3 (execution) · **Branch:** `fix-bugs-and-raceconditions`
**Baseline HEAD at start:** `fec039d` (working tree clean)
**Commits:** `65bb358` (the repair + the six test files) · `71fbd2b` (three tests the falsification pass proved were missing)
**Charter:** `TaskCharter_WP92_TheDurableWithholdStillExpiresWithThePlatform.md`

---

## 1. AC1 — the key choice, in one sentence, with both rejects named

**The store keys by the canvas GUID — WP27's stable identity token, the same one `canvasDocId`, `<guid>.yhistory`, `<guid>.ycheckpoint` and `index.json`'s KEYS are built from — because it is the only candidate that survives BOTH a rename and a host.**

| candidate | chosen? | measured cost |
|---|---|---|
| **the canvas guid** | ✅ | `CanvasSync.getCanvasGuid` (`canvas-sync.ts:2499`) is **cached and synchronous**, so the charter's "`guidForPath` is async and may answer `null`" cost **does not apply at this seam** — measured, see §1.1. Zero extra I/O, zero new failure mode. |
| the canonical path | ❌ | Agrees with every neighbour (`subscribedPaths`, `recentDiskWrites`, the manifest, `index.json`) and **still dies at the first rename** — a rename changes the canonical path too. Fixes the falsified half and leaves the reachable one open. |
| both, with a migration | ❌ | Puts a **second vocabulary inside the one file this WP exists to give one vocabulary**, and doubles the failure surface of every lookup. |

### 1.1 The charter's stated cost for the guid does not apply — measured

The charter warns that a guid-keyed hydrate "may have to wait for or fail over an identity resolution that `coldOpen` currently does not depend on". It does not, and the reason is a precondition already in the code:

`attachCanvasWriter` (`main.ts:2854`) returns early unless `getCanvasDocHandle(rawPath)` answers. `getCanvasDocHandle` → `canvasDocIdFor(path)` (`canvas-sync.ts:2519`) answers `null` **unless** `guidByPath` holds the path, **or** `identityStore === null` — in which case `resolveGuidForSubscribe` (`:2584`) returns the canonical path as the identity token and `subscribe` binds it. So on the one production line a writer can reach, the guid is already resolved and cached. No new await, no new `null` branch on the hot path.

### 1.2 Where it is applied

`main.ts`, **one line, at the one attach site**:

```ts
refusalIdentity: this.canvasSync?.getCanvasGuid(canonical) ?? null,
```

`CanvasPersistence` gained one option and one field; `hydrateDurableRefusals` is the only consumer.

### 1.3 `omitted` ≠ `null` — and why the default cannot be reached by the product

WP90's six test files construct `CanvasPersistence` with `durableRefusals` and no identity, and **no existing test may be amended**. So the option follows this file's own landed precedent (`seedKnowledge`: *"only an OMITTED probe defaults"*):

- **omitted** → the caller predates WP92; the key stays `diskPath`; every pre-WP92 caller behaves exactly as it did. `wp90/**` and `wp63/**` pass **byte-unmodified**.
- **`null`** → the caller ASKED and there is no stable identity → **I5 DEGRADE**: the store is not consulted for that path at all, narrated, for that path only. It does **not** fall back to the path — that would re-arm the orphan under a key nothing would migrate.

`tp01` asserts structurally that production never omits it, and **B9** (removing that one line from `main.ts`) reddens it.

---

## 2. AC2 — disposition: **MIGRATE**, with the version stamp moved

**MIGRATE**, not RE-DERIVE. The cheap answer — "old entries just stop matching" — is the defect this WP exists to close.

- `hydrateDurableRefusals` reads the identity key; if it answers `[]`, it reads the **legacy key** (`this.diskPath`, WP90's exact expression) **read-only**; on a hit it restores and then calls **`store.migrate(legacyKey, key)`**, an explicitly named write.
- **`load()` still performs no write.** Property 5 survives: an ordinary hydrate — every hydrate after the first upgraded open — touches the file **zero times** (`tp06` case 5, driven with `io.write` call-counting on a **populated** store).
- **Idempotent on the FILE, not on an object.** A second `migrate` finds the legacy key gone and returns before serialising; even if it serialised, `lastQueued` compares **bytes**. `tp02` asserts `written.length` unchanged **and** byte-identical file content.
- **Other paths, including an unparseable one, survive.** The fixture carries three keys, one of them deliberately `{ not: "a list" }`. Both survive the rewrite (`tp02`).
- **Quarantine wins.** A store whose read failed migrates **nothing** and its bytes are left intact (`tp02`, `tp06` case 4).
- **Collision rule stated:** migrating onto an occupied identity key keeps the **current** entry and drops the legacy one — the legacy entry is the older statement of the same fact.

**Version stamp: `SEED_REFUSAL_STORE_VERSION` moved `1 → 2`.** A key-vocabulary change *is* an on-disk shape change. It is a **statement, not a gate**: the legacy fallback is deliberately **not** conditioned on the version, because a version-2 file can still carry an unmigrated version-1 key for any canvas not yet reopened. `storedVersion()` now exposes the stamp that was read. The charter's recorded finding — *nothing ever compares the version* — is **still open and not closed here**; `loadFile` still substitutes the constant rather than comparing.

---

## 3. AC3 — the unmatched census, and **which number it is quoting**

Two senses, kept apart, because conflating them is how a census becomes a lie:

| accessor | sense | quoted where |
|---|---|---|
| `unmatchedEntries()` | **stored, and never asked in this process** | the `SEED REFUSAL UNMATCHED:` signature and the number below |
| `askedButAbsent()` | **asked, and the store had no entry** | reported separately, never merged |
| `askedEntries()` | the census's denominator | tests |

**The number quoted by the signature is the FIRST sense: "stored entries no `load()` in this process has named".** A vault whose canvases are simply closed reports them, and that is correct — the count is a **prompt, never a verdict**. AC3(d)'s fifty-canvases-one-open-board failure mode is avoided by *naming* which sense is being quoted rather than by guessing.

- **One production emitter**, in `seed-refusal-store.ts`: `SEED REFUSAL UNMATCHED: <n> stored entr(y|ies) never looked up — <path>[, …]`. **Path and count only** — asserted in `tp03` that the line does **not** contain the refusal's node id.
- **The primary observable is a positive non-zero** (AC3(a)'s trap): three entries, two asked → **exactly 1**, and the two matched are shown to have **decremented** it. **No zero anywhere** is offered as evidence the fix works.
- **A quarantined store answers `[]` because there is no root**, and says so — never "the file is clean".

### Census over a real vault's store

**Not run.** Reading a real vault's `seed-refusals.json` is live-vault work, which W4 owns and which this batch was told not to do. The instrument is landed and headless-proven; the number is W4's to take.

---

## 4. AC4 / S64 — **NARROWED, NOT CLOSED**

Stated plainly, because it is the question the Dispatcher asked:

> **S64 is NARROWED, not closed.** The *in-process* window is closed: nothing that this process can still act on is now fire-and-forget at teardown. The *hard-kill* window is **irreducible from inside the process** — a `SIGKILL`, a renderer crash or a power loss between `queue` being extended and `adapter.write` resolving still loses that write, and no amount of awaiting inside `onunload` can change that. Closing it completely would need a write-ahead journal, which is a new artefact and out of scope.

What landed:

| call site | how | file |
|---|---|---|
| plugin unload | **`async onunload()`** → `await this.flushSeedRefusals()`, appended **after** the entire pre-existing synchronous teardown so nothing moved behind an await that was not already | `main.ts` |
| writer detach (**and therefore session cleanup**) | `teardownCanvasPresences()` → `void this.flushSeedRefusals()`, **joined** at unload via the `seedRefusalFlush` chain. This method is the one both destroy paths (`onunload` **and** `cleanupSession`) go through, which is why it is wired here rather than in each | `main.ts` |
| the migration | the same chain — `migrate()` extends `queue` synchronously, exactly as `save()` does | `seed-refusal-store.ts` |

**AC4(d) answered explicitly:** the migration **is** wired into the awaited path. `tp04` case 2 holds `io.write` on an unresolved promise across a `migrate()` and asserts the flush does not resolve until it lands, then asserts the file's keys.

**The bound.** `flushSeedRefusalStore(store, opts)` races `idle()` against `SEED_REFUSAL_FLUSH_TIMEOUT_MS = 2000`, with an **injected timer** so the sequence is *measured*, not read off the constant (AC4(c)). It never rejects. Under **S71** a `setTimeout` bound can itself stretch on a clamped renderer, so **what the user sees in the worst case is "unload waits for one animation-frame-clamped timer", not 2 s** — and if it does expire, the line says the in-flight refusal write may be lost.

**One new timing constant was added.** §3's blanket "zero new timing constants" is overridden by AC4's explicit licence (*"a `setTimeout` race here is acceptable and is the one place in this WP a timer is permitted"*). **No clock reaches an entry's validity.** There is no TTL, no age sweep, no "stale entry" notion anywhere.

---

## 5. AC5 — the sidecar artefact census, derived, with **both halves** of the control firing

Derived by `wp92/census.ts` from `canvas-sidecar.ts`'s own path-builder **signatures**, not from the charter's table. The charter's reading was treated as an input and **it holds**:

| artefact | keyed by | platform-dependent? | followed on rename? |
|---|---|---|---|
| `<guid>.yhistory` | **guid**, in the filename | no | n/a — the guid is stable |
| `<guid>.ycheckpoint` | **guid**, in the filename | no | n/a |
| `index.json` | guid → path as a **VALUE** | the *value* is a canonical path (**S76**) | **yes** — `store.bind` / `store.unbind`, both derived from `handleRename`'s own body |
| `seed-refusals.json` | **was** `diskPath`; **now** the identity token | **no longer** | **needs no follower** — the key is not a path, so a rename has nothing to re-point |

**Positive control, both halves shown firing:**

- **Half A — it can find one.** The same store-key deriver, run over `PRE_REPAIR_HYDRATE` (a literal of WP90's three landed call sites), reports **`this.diskPath`** — the known-present, platform-dependent key. It also finds **both classes** of artefact (two key-in-filename, two whole-vault-file), so it has demonstrated it can find two rather than one (AC5(b)).
- **Half B — it refuses to answer on nothing.** `deriveStoreKeyCensus(new Map())` and `deriveSidecarArtefacts("")` both **throw**.
- **A third control**, over a *modified source string* rather than the shared tree (rule 14): removing `await store.unbind(oldPath)` from a copy of `handleRename` makes the rename-follower derivation drop `store.unbind`.

**Disposition honoured:** nothing outside `seed-refusals.json` was repaired. `index.json` is WP24/WP27 territory and is carried up, not touched.

---

## 6. The break table — every AC falsified on a **named** assertion

Restored **byte-identically by copy-aside**, sha256-verified on every restore. No `git checkout`, no `git stash`, no revert on any path (`H:\tmp\wp92_breaks.py`, `H:\tmp\wp92_breaks2.py`).

| # | break planted | verdict | what reddened, on its own named assertion |
|---|---|---|---|
| **B1** | AC1 — revert the sink to `store.save(this.diskPath, …)` | **RED** | *"more than one expression is written under"* (`['key','this.diskPath']`) · *"the other host's build did not find the standing withhold"* · *"nothing is being withheld — 'no write' means nothing"* · *"the standing withhold did not survive the rename"* — **6 assertions, 4 files** |
| **B2** | AC2 — delete the legacy-key fallback in `hydrateDurableRefusals` | **RED** | *"a WP90-era store file stopped matching after the key change"* · *"the legacy read probe changed shape"* |
| **B3** | AC2 — keep the fallback, drop the `migrate()` call | **RED** | *"the entry was found but never re-keyed — the store still speaks two vocabularies"* |
| **B4** | AC3 — `unmatchedEntries()` returns `[]` | **RED** | *"exactly one entry was never looked up"* · *"the orphan is not reported — the census cannot see the defect it exists for"* |
| **B5** | AC4 — `await this.flushSeedRefusals()` → `void …` | **RED** | *"the unload no longer AWAITS the store's queue (S64 reopened)"* |
| **B6** | AC4 — remove the `Promise.race` bound | **RED (hang, 5 s)** | *"a write that NEVER SETTLES is bounded"* — the test hung, which is the defect |
| **B7** | AC4 — remove `flushSeedRefusalStore`'s `.catch` | **⚠ first run: STILL GREEN → now RED** | see §6.1 |
| **B8** | AC6 — let `load()` write | **RED** | *"reading the store wrote to it"* · *"the quarantine was bypassed by the new write path"* |
| **B9** | AC1 — `main.ts` stops supplying `refusalIdentity` | **RED** | *"the one production attach site stopped supplying a document identity"* |
| **B10** | AC3 — never record `askedKeys` | **RED** | 4 assertions incl. *"the rename left an orphan behind"* |

### 6.1 The break that reddened NOTHING — reported, not dropped

**B7 was green on the first pass, and that is a finding.** Removing the rejection `catch` from `flushSeedRefusalStore` changed no test's colour, because **WP90's `save()` already swallows every rejection into the queue's own catch** — so a rejecting `io.write` can never reach `idle()`, and the existing "a REJECTING write does not reject the unload" case was green whether or not the flush handled a rejection at all. The `catch` was **defence in depth against a state no test could produce**, which is the same shape as an AC written against an unreachable reproduction.

**Fixed rather than reported away:** a case was added that drives the rejection at the seam `flushSeedRefusalStore` actually consumes (an `idle()` that rejects). B7 re-run: **RED**, on *"a poisoned queue took the unload down with it"*. Two other tests were added for the same reason (§7).

---

## 7. Three tests the falsification pass proved were missing (commit `71fbd2b`)

1. **AC2 at the seam.** `tp02` drove the store directly, so deleting the hydrate fallback reddened nothing — the product could silently stop finding a WP90-era withhold with the suite fully green.
2. **AC4's rejection arm** (§6.1).
3. **AC6's attribution anchor.** `git diff HEAD` became empty the moment WP92 committed — and then **a sibling batch committed and moved `HEAD` off WP92's own commit**, so every `HEAD` reference silently stopped seeing its own subject. The change set is now located from the commit that **ADDED** `v2/wp92/`, and the marker regex is shown **firing** on this WP's own in-scope file. *(This is a reusable lesson for every derived test in a shared tree: `HEAD` is not a stable reference to your own work.)*

---

## 8. AC6 — no collateral

- **WP90's five properties, all driven on POPULATED fixtures**, each with the vacuity guard named: ids/reasons/boundaries only (an extra field never reaches the bytes) · nothing re-injected (a withheld flush produces **no** bytes) · local-only (`isSidecarPath` asserted over the paths **actually written**) · defined degradation (**a migration cannot launder a failed read**) · hydration ≠ persistence (**zero** writes on a hydrate that **found** something).
- **`wp63/**` empty-diff statement, with its positive control:** `wp63/` is **not** in WP92's change set, and `git ls-files plugin/src/__tests__/v2/wp63` returns **a non-empty list** — so the claim is a measurement, not a free pass. Same for `wp90/`.
- **WP91's cap intact:** `MAX_MUTE_MS = MAX_WAIT_MS + DISK_WRITE_SETTLE_MS`, and `DISK_WRITE_SETTLE_MS = 250` — **both terms pinned**, not just the sum, so a compensating pair of edits still reddens.
- **Out-of-scope files.** ⚠ In a shared tree "not in the diff" is not a statement one batch can make about a file a sibling is live in — **and three of them were live during this batch**. The instrument is therefore **ATTRIBUTION**: a forbidden file may appear in the diff, but **not one added line in it may carry a WP92 marker**. `utils.ts` is asserted absent outright (it has no sibling excuse).

### `canvas-persistence.ts` — line-by-line, on WP90's precedent

```
plugin/src/files/canvas-persistence.ts | 99 insertions(+), 6 deletions(-)
```

The **6 deletions** are, exactly: the `let stored` declaration line (re-declared with two new locals beside it), the three `store.load/save(this.diskPath …)` argument spellings, and the two lines the legacy-fallback block replaced. **`coldOpen`'s three outcomes and their order, the `doc-wins` "never read the file" rule, `writeIsWithheld`, `armSettleRelease`, `acquireMute`/`releaseMute`, the write queue, the debounce and WP91's `MAX_MUTE_MS` are byte-unchanged.**

### Files changed by this WP

| file | status |
|---|---|
| `plugin/src/files/seed-refusal-store.ts` | modified |
| `plugin/src/files/canvas-persistence.ts` | modified (`hydrateDurableRefusals` + the opt/field only) |
| `plugin/src/main.ts` | modified (**wiring only** — one attach line, one field, one method, `onunload` made `async`, one `void` at the writer detach) |
| `plugin/src/__tests__/v2/wp92/**` | **new** — 2 support + 6 test files, 40 cases |

**Not changed:** `utils.ts`, `canvas-sidecar.ts`, `canvas-sync.ts`, `file-ops.ts`, `vault-events.ts`, `control-handlers.ts`, `canvas/**`, `__tests__/v2/wp63/**`, `__tests__/v2/wp90/**`, `server/**`.

---

## 9. The gate

**Baseline, measured by me at the start of this batch (12:38, HEAD `fec039d`, tree clean):**
`tsc -noEmit -skipLibCheck` exit 0 · **378/378 files, 2717/2717 tests, 0 failures**, 42.62 s.
**S74 did not fire in this run** — `wp5/latency.test.ts` was green 11/11, including US6 AC1. Recorded because S74 says it fails 2 of 3 full-suite runs; this was the third.

### ⭐ **After — WP92's own gate figure, MEASURED IN ISOLATION: 2757/2757 tests, 384/384 files, exit 0.**

Taken in a **detached worktree at `71fbd2b`** (WP92 landed, the sibling's uncommitted work absent), with `plugin/node_modules` **and** `server/node_modules` both junctioned so the charter's *"a detached-worktree measurement is 15 tests short"* caveat does **not** apply — and it did not: **zero failed files, zero failed tests.**

The arithmetic closes exactly:

```
baseline   378 files / 2717 tests   (HEAD fec039d, clean tree, 12:38)
WP92       +6 files  /  +40 tests
           ────────────────────────
           384 files / 2757 tests   ✅ measured, exit 0
```

**S74 did not fire in either measurement** — `wp5/latency.test.ts` was green 11/11 in both the baseline and this run. Recorded by name as the charter requires; it is not being used as cover, because there was nothing to cover.

### 9.2 The SHARED-TREE gate figure, and why it differs

Run against the live shared working tree at the same moment: **9 failed files / 17 failed tests, 378 passed files / 2772 passed tests (387 / 2789)**.

**Every one of those 17 is a sibling batch's (WP95), and that is a MEASUREMENT, not a reading.** The same nine files, run in the detached worktree at `71fbd2b`, are **25 files / 204 tests, all passing, exit 0** — so the reds require WP95's uncommitted work to be present and are not produced by anything WP92 landed.

### 9.1 Failures observed in the shared tree, and who owns them

⚠ **The working tree stopped being clean during this batch.** A sibling batch (**WP95**, `S94`'s protected-path repair) landed live edits to `manifest.ts`, `control-handlers.ts`, `background-sync.ts`, `canvas-sync.ts`, `file-ops.ts`, `manifest-removal-decision.ts`, `testing/e2e-control.ts` and added `protected-paths.ts` + `__tests__/v2/wp95/`, **and committed `4ee9e55` onto the branch**, all inside this batch's window.

| failed file | tests | failing assertion names | owner |
|---|---|---|---|
| `wp26/test_tp06_manifest_membership_gate` | 2 | `isSharedPath` on a sidecar path | **WP95** |
| `wp68/test_tp02_inbound_rename_performs_zero_mutation` | 6 | *expected `'PROTECTED PATH REFUSED: arm=file-op-g…'` to match `/refused remote rename/i`* | **WP95** |
| `wp68/test_tp04_no_collateral` | 2 | *`.obsidian/liveshare/stateful/… → … was refused`* | **WP95** |
| `wp83/test_tp02_callsite_coherence` | 1 | *the block names a function that is not a call site in the current tree* | **WP95** |
| `wp86/test_tp01_vanished_key_sink_census` | 2 | derived census over the live tree gained a member | **WP95** |
| `wp90/test_tp06_the_durable_record_is_peer_unreachable` | 1 | *"MANIFEST MEMBERSHIP … **positive control**"* | **WP95** — see below |
| `wp93/test_tp01`, `tp03`, `tp05` | 3 | derived censuses over `background-sync.ts` / `manifest.ts` / `file-ops.ts` | **WP95 + S88** |
| `tsc` — `wp95/test_tp02…` *"Value of type 'Mock<…>' is not callable"* | — | a sibling test file, mid-edit | **WP95** |

### 9.3 ⚠ AFTER WP95 COMMITTED (`2aabc4c`) — the S88 reds cleared, **11 did not**

Re-measured on the branch with **both** WP92 (`940edaa`) and WP95 (`2aabc4c`) committed and the tree clean:

```
Test Files  4 failed | 383 passed (387)
Tests      11 failed | 2778 passed (2789)
```

| file | tests | was it S88? |
|---|---|---|
| `wp83/test_tp02`, `wp86/test_tp01`, `wp93/test_tp01`/`tp03`/`tp05` | 6 | **YES — CLEARED.** Derived censuses reading the live working copy mid-edit. Green once the sibling's saves settled. |
| `wp26/test_tp06` ×2, `wp68/test_tp02` ×6, `wp68/test_tp04` ×2, `wp90/test_tp06` ×1 | **11** | **NO — STILL RED, and they will not clear themselves.** |

**This separates the two classes cleanly and it is the single most useful thing in this section: 6 of the 17 were S88 and evaporated; 11 are a genuine semantic collision between WP95 and WP26/WP68/WP90 and are now committed on the branch.** They are not WP92's, they are not load, and they are not mid-edit. See §14.1.

**Not one of the 17 names a WP92 symbol** — no `seed-refusal`, no `canvas-persistence`, no `refusalIdentity`, no `SEED REFUSAL UNMATCHED:`. Every one names `PROTECTED PATH REFUSED:`, `isProtectedPath`, or a derived census over a file WP95 is live in. **And all nine files pass at `71fbd2b`.**

**`tsc -noEmit -skipLibCheck` over WP92's own files: exit 0**, verified repeatedly through the batch and clean in the isolated worktree.

**The `wp90/test_tp06` red deserves its own line** because it is *not* S88's mid-edit shape and will not clear itself: WP95 added `if (isProtectedPath(path)) { … return false; }` to `ManifestManager.isSharedPath`, and WP90's third configuration case asserts, as its **positive control**, that a `sharedFolder` pointing **into** `.obsidian` re-admits the subtree — *"the configuration that re-admits the whole subtree, and the one the run's own confirmed data loss showed is not hypothetical"*. WP95 now refuses it unconditionally. **The two work packages disagree about whether `.obsidian/**` may ever be shared, and one of them is wrong.** Carried up in §14.1.

---

## 10. Does my own probe agree with §3.2? **Yes, exactly** — and it is now a landed test

Run in `tp01` by **fixturing `Platform.isWin`** and letting the **real** `toLocalPath`/`toCanonicalPath` execute (AC1(c): stubbing `toLocalPath` would test the stub):

| on-disk name | `toLocalPath(toCanonicalPath(x))` on Win | on posix | round-trips? |
|---|---|---|---|
| `plain.canvas` | `plain.canvas` | `plain.canvas` | ✅ |
| `Q3：plan.canvas` *(fullwidth)* | identical | identical | ✅ |
| `meeting｜notes.canvas` *(fullwidth)* | identical | identical | ✅ |
| `Q3:plan.canvas` *(ASCII colon)* | differs | — | ❌ |
| `meeting\|notes.canvas` *(ASCII pipe)* | differs | — | ❌ |

**The composition is the identity for every name Windows can actually hold.** S63's *mechanism* is real and is closed here on discipline grounds; its *stated reproduction* is not reachable, and **no acceptance criterion in this work was written against it**. The two platform arms use the two **mismatching** rows, which are the only inputs where the old key ever differed.

---

## 11. S76 — did the collision become more reachable? **No. It is unchanged, and one consumer moved out of its blast radius.**

Measured, and pinned as a test in `tp01` so a future change to it reddens here.

- **Before:** the store keyed by `toLocalPath(toCanonicalPath(raw))`. Two distinct on-disk files that alias under S76 produced **one** store key. Collision reachable.
- **After:** the store keys by the guid, which is resolved through `guidByPath` — itself keyed by the **canonical** path. Two aliasing files therefore still resolve to **one** guid.

**So the collision is neither widened nor narrowed by WP92 — it is inherited unchanged from the identity layer one level up, which is exactly where S76 says it lives.** What did change: `seed-refusals.json` is **no longer a second, independent place** where the aliasing has to be reasoned about; it now has whatever identity `guidByPath` gave it, like `.yhistory`, `.ycheckpoint` and `index.json` already did. One consumer fewer to audit when S76 is repaired.

**Explicitly: I did not silently widen it, and I did not touch `utils.ts`.**

---

## 12. Data safety

No Obsidian instance was launched. No vault file was read or written. **No `data.json` was opened, read, printed, logged, hashed or fixtured** — not even for a key name. No relay was contacted (not even `GET /healthz`). No E2E script was run. `npm run build` was **not** run, so the shared gitignored `plugin/main.js` was not touched. No credential of any kind appears in this report, in any test, in any commit message, or in any file this batch created.

The `SEED REFUSAL UNMATCHED:` signature carries **path and count only** — asserted in `tp03` that it does not contain a refusal's node id, and it never carries a reason string or file bytes.

---

## 13. Compliance statements

- **No existing test was deleted, weakened, retitled, skipped or amended.** `wp63/**` and `wp90/**` are byte-unmodified and pass — the compatibility default on `refusalIdentity` exists precisely so that stayed true.
- **No §7 licence of any class was taken.**
- **Rule 3 honoured:** every falsification break was restored by **copy-aside**, sha256-verified. No `git checkout`, no `git restore`, no `git stash`, no revert on any path.
- **Rule 4 honoured:** every commit staged **explicit paths**. Nothing under a vault, no `.env`, no build output was ever staged. Both commits contain **only** WP92 files, verified with `git diff --cached --name-only` before committing, with `git status` re-read immediately before each stage.
- **Rule 5 honoured:** every line number the charter named was **re-verified before editing**. Several had moved: `handleRename` `3114-3145 → 3238-3269`, `main.ts:2850 → :2871`, `onunload` `1386 → 1393`, the store call sites `650/674/677 → 650/739/742`. Cited numbers in this report are the ones I found.
- **Rule 6 honoured:** **no signal number was allocated.** New findings are described in §14 for the Dispatcher. `python workflowArtifacts/canvas-v2/check_signal_register.py` → **exit 0** (*"clean - no NEW violations"*, 213 files scanned, control: all classes proved).
- **No new runtime dependency.** One new timing constant, licensed explicitly by AC4 and scoped to a teardown. **No clock reaches an entry's validity; no TTL; no age sweep.**
- **No live vault work** — W4 owns it and was running.

---

## 14. Findings for the Dispatcher to number — **described, not numbered**

1. **⚠ A SIBLING'S REPAIR (WP95) REDDENS 17 TESTS ACROSS 9 LANDED FILES, AND AT LEAST ONE IS A SEMANTIC COLLISION RATHER THAN A MID-EDIT ARTEFACT.** Measured: `wp26×2`, `wp68×8`, `wp83×1`, `wp86×2`, `wp90×1`, `wp93×3` — **all nine files pass at `71fbd2b`** (WP92 without WP95), so the reds require WP95's work to be present. The sharpest is `wp90/test_tp06`: WP95 added an unconditional `isProtectedPath` refusal to `ManifestManager.isSharedPath`, and WP90's third configuration — *"`sharedFolder` pointing INTO the config directory … the configuration that re-admits the whole subtree, and the one the run's own confirmed data loss showed is not hypothetical"* — asserts `isSharedPath(".obsidian/notes/hello.md") === true` as its **positive control**. It is now `false`. **This is not S88** (S88 is a census reading a file mid-save; this survives any save). It is a real disagreement about whether `.obsidian/**` may ever be shared, and **one of the two work packages is wrong about it**. Likewise `wp68/test_tp02×6` and `test_tp04×2`: WP68's own signature `refused remote rename` has been superseded by `PROTECTED PATH REFUSED:`, and `.obsidian/liveshare/stateful/**` renames WP68 asserts are *admitted* are now refused. **These reds do not clear themselves and will be misattributed by whoever runs the gate next.**
2. **`HEAD` IS NOT A STABLE REFERENCE TO YOUR OWN WORK IN THIS TREE, AND A DERIVED TEST THAT USES IT SILENTLY GOES BLIND.** My AC6 attribution check anchored on `git show HEAD -- <file>`; a sibling committed mid-batch, `HEAD` moved off WP92's commit, and the check began reporting "no WP92 lines found anywhere" — i.e. it **passed for the wrong reason** and its own positive control caught it. This is S88's family (a derived census over a shared tree) but a **different mechanism**: not the working copy moving, the *commit graph* moving. Any test in this run that reads `HEAD`, or `git diff HEAD`, has the same defect. The instrument that fixes it is to locate your own commit by the artefact only you added.
3. **A `catch` THAT NO TEST COULD REACH.** `flushSeedRefusalStore`'s rejection handler was unreachable through `save()`, because WP90's queue catch already swallows every rejection — so removing it reddened nothing. Found only by planting the break. **The general shape is worth a number: a defence-in-depth handler behind another handler is, by construction, a green that cannot fail**, and this run has at least one landed instance of it in a module it audited twice.
4. **⚠⚠ I DAMAGED THE SHARED `plugin/node_modules`, AND THE MECHANISM IS A TRAP THIS RUN WILL HIT AGAIN.** To attribute §9.2's reds by **measurement** I made a detached worktree and junctioned `plugin/node_modules` and `server/node_modules` into it — the charter's own recommended instrument. `git worktree remove --force` then **followed the junctions and deleted files inside the REAL `plugin/node_modules`**, emptying `node_modules/.bin` entirely and stripping `@rollup/rollup-win32-x64-msvc`'s `package.json`. Every `vitest`/`tsc` invocation in the shared tree failed with `MODULE_NOT_FOUND` until I repaired it with **`npm ci`** (exit 0, 69 binaries restored, **`package.json` and `package-lock.json` byte-untouched** — verified with `git diff`, no version drift, so the 7-day rule is not engaged). **Total outage ≈4 minutes; no source file, no commit and no sibling's work was lost.** The lesson is general and belongs in the register: **the charter names a detached worktree as the instrument for a parked baseline, and the obvious way to make one runnable — junction `node_modules` — turns `git worktree remove` into `rm -rf` on the shared dependency tree.** Remove the junctions with `cmd /c rmdir` (never PowerShell's `Remove-Item`, which threw a `NullReferenceException` here and left them in place) **and verify they are gone** before `git worktree remove`, or use `--no-checkout` copies instead.
5. **`SEED_REFUSAL_STORE_VERSION` is still never compared** (the charter's own recorded finding). WP92 moved the stamp `1 → 2` and exposed `storedVersion()`, but `loadFile` still substitutes the current constant rather than comparing, so a future version-3 file would be read silently by this build. **Not closed here** — deliberately, because gating on it would break the very legacy files AC2 exists to migrate.

---

## 15. Live rows (§7b) — **NOT RUN BY THIS BATCH**

Both are W4's, and this batch was instructed to build and prove headless. Neither was attempted; **no bundle hash, no resumed role and no installer run is claimed**, because none occurred.

- **Row 1 — the rename orphan in the real editor.** ⚠ **Its headless equivalent is already GREEN, both ways** (`tp03`): the orphan is produced by the pre-repair key and reported by the census, and the repaired key makes the withhold follow the rename with the user's record intact. W4's row remains valuable as live confirmation. Its **second step** (the projection destroying the record) still needs a genuine refusal and therefore still needs **S73**.
- **Row 2 — the withhold survives a restart under the new key.** **Requires S73 resolved.** ⚠ Note for the Dispatcher: `SIGNAL_REGISTER.md` records B56 as having **CLOSED S81 live**, with *"the durable withhold restored"* (`1a3210d`). If that means a live `SEED REFUSED:` was produced, **S73 may now be resolvable** and this row may be runnable — which would also settle whether WP63/WP90/WP92's severity survives. I did not verify that claim; it is outside this batch's scope and I am flagging it rather than asserting it.

---

## 16. Definition of Done — met

> *A standing withhold is found for the record it protects whatever the path's spelling, whatever the host, and **after a rename**; an entry nobody ever asks for is **counted and named** instead of sitting silently in a file; and the store's writes have **landed before the process can end**.*

All three, headless, with the rename arm driven end to end through the **production** `handleRename` and the pre-repair build as a negative control that shows the user's record actually being destroyed.
