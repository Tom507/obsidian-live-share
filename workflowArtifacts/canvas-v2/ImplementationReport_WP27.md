# Implementation Report — WP27

**Attempt:** 1
**WP:** WP27 — GUID identity + rename + `getDoc` guards
**Phase:** P2

---

## Status

`DONE` — all 54 visible tests green, `tsc --noEmit` clean, WP24/WP26 undisturbed.

**One escalation is attached and it is not optional:** two pre-existing assertions in
`plugin/src/__tests__/w4-canvas-integrity.test.ts` are *inverse characterisations of AC4* —
they assert the two guards are ABSENT. They were green at the batch baseline and are red now.
WP27 holds no deletion or amendment licence, so they were left exactly as they are. See
**Blocked Items**.

---

## Completed Work

| AC | Status | Notes |
|---|---|---|
| **AC1** — docs addressed by `__canvas__:<guid>`; `meta.path` + manifest carry `path → guid`; a path-only client resolves the guid | DONE | `canvasDocId(guid)` is the single constructor and `CANVAS_DOC_PREFIX` is exported. Resolution order is manifest → sidecar `index.json` (scanned by VALUE). Host mints when unresolvable; guest refuses and opens nothing (the mixed-version rule). Identity is stamped into `meta` as `guid` / `path` / `epoch`. |
| **AC2** — a rename updates `meta.path`, the manifest mapping and `index.json`, creates no doc, orphans none, edits keep flowing | DONE | `CanvasSync.handleRename` re-keys every path-keyed structure, re-points the observer cell, re-stamps `meta.path`, then `bind(new)` → `unbind(old)`. It never touches `getDoc`-as-creation or `releaseDoc`; the `Y.Doc` is the same instance throughout. |
| **AC3** — registries, `canvasOwned` and the awareness shape stay path-keyed | DONE (by non-action + re-keying) | Nothing was re-keyed by guid. `canvas-presence.ts` untouched; `canvasPath` still carries the vault path. `vault-events.canvasOwned` untouched. The rename MOVES path keys, it does not replace them with guid keys. |
| **AC4** — the two bare-path `getDoc` sites can no longer reach a canvas doc, proven by an explicit test | DONE | Guard added immediately BEFORE each `getDoc`, both using the shared `skipsAutoTextSync` predicate. `BackgroundSync.subscribe` deliberately left open (R10 door, WP33's). |

### The four traps in the brief, and what was done about each

1. **Guards must be real, before the call.** Both guards are the statement immediately
   preceding their `getDoc`. Removing either reddens tp09 / tp10 through the call log, not
   through the returned handle.
2. **`setActiveFile` is at `:195`, not `:173`.** Located by name; every charter line number
   was treated as stale per Shared Ownership Contract §4.
3. **Stamping order.** Handled with TWO independent defences (below) — the ordering alone was
   judged insufficient, see *Changes Made → canvas-schema.ts*.
4. **Rename is not unsubscribe+subscribe.** `handleRename` performs no `getDoc`-as-creation
   and no `releaseDoc`; the observer closure is re-pointed through a mutable path cell.

---

## Blocked Items

### ESCALATION 1 — two pre-existing assertions characterise the ABSENCE of AC4's guards

`plugin/src/__tests__/w4-canvas-integrity.test.ts`, 46/46 green at the batch baseline,
now 44/46:

| Test | Assertion | Its own stated meaning |
|---|---|---|
| `M1 setActiveFile acquires a bare-path doc for a .canvas that was never subscribed` (`:1597`) | `expect(reached).toBe(true)` where `reached` = "`getDoc` was called with the `.canvas` path" | *"setActiveFile is a SECOND unguarded bare-path getDoc … W3's sweep claim is incomplete."* |
| `K5 CollabManager has no internal .canvas guard` (`:1666`) | `expect(reached).toBe(true)`, same shape | *"CollabManager has NO internal `.canvas` guard … Currently unreachable ONLY because main.ts gates on `getActiveViewOfType(MarkdownView)`, which no test covers."* |

These are **W4 revalidation characterisations of the R5 defect WP27 exists to close**. Both
messages read as findings, not as specifications — they were written to say *"this hole is
still open and nothing covers it"*. WP27 AC4 closes exactly those two holes, and the charter's
§7.0(c) names the same two lines. The two assertions and AC4 cannot both be satisfied.

**No action taken.** §7's licensed-deletion list is `WP4, WP18, WP21, WP22, WP33` and the
licensed-amendment list is `WP10, WP14, WP18, WP19, WP46, WP59, WP60, WP61`. WP27 is on
neither, and Shared Ownership Contract §6.4 makes an unenumerated rewrite an abort criterion.

**What is needed:** a licence to INVERT both assertions (`toBe(true)` → `toBe(false)`, with the
message rewritten to state that the guard now exists) — not to delete them. Inverted, they
become a second, independent pin on AC4 from a file WP27 does not own, which is strictly more
valuable than deleting them. tp09 and tp10 already cover the behaviour, so nothing is lost
while the licence is pending.

### ESCALATION 2 — WP27's seam is not wired into `main.ts`, and that is deliberate

`CanvasSync.setIdentityStore(...)` has **no production caller**. Without one, `CanvasSync`
falls back to pre-WP27 addressing (see *Changes Made → the two-mode design*), so AC1/AC2 are
true of the module and not yet of the shipped plugin.

This was not an oversight and is not something WP27 should decide alone:

- Charter §6's required-changed-files list is `canvas-sync.ts`, `manifest.ts`,
  `background-sync.ts`, `collab.ts` and the WP24 sidecar index. `main.ts` and `vault-events.ts`
  are not on it, and §7b states no AC is integration-scope.
- **Wiring it with `sidecar: null` would be a live regression.** `createCanvasIdentityStore`
  needs a `SidecarIO` implementation to resolve a guid offline, and WP24 shipped the interface
  without an adapter (WP25 owns that wiring). Manifest-only resolution means a guest that
  subscribes before the host's manifest entry has replicated resolves `null`, opens nothing,
  and drops to the R10 raw-text fallback for that canvas — with no automatic retry. That is a
  worse production state than the path-keyed status quo.
- `main.ts`'s `ensureCanvasPersistence` reaches `getCanvasDocHandle(rawPath)`, which under an
  injected store returns `null` for a path with no identity instead of creating a doc. That
  behaviour change needs to land together with the store, not before it.

**What is needed:** WP25 (which owns the `SidecarIO` adapter) should land the wiring —
`setIdentityStore(createCanvasIdentityStore({ manifest, sidecar }))` in `main.ts`, and
`await plugin.canvasSync?.handleRename(oldPath, file.path)` in the `vault-events.ts` rename
handler, after `manifestManager.renameFile`. Both are one line. Alternatively Worker 3 Core
grants WP27 explicit scope for `main.ts` + `vault-events.ts` once a sidecar adapter exists.

---

## Tools Created

None. No `TOOL_REQUEST` was needed.

---

## Changes Made

### `plugin/src/canvas/canvas-schema.ts`

- **Added** `GUID_KEY = "guid"`, `PATH_KEY = "path"`, `EPOCH_KEY = "epoch"`, in the same style
  and the same module as `META_MAP_NAME` / `SCHEMA_VERSION_KEY` (Shared Ownership Contract §1).
  `EPOCH_KEY` is declared only — no comparison, no monotonicity, no host-increment, no conflict
  handling. That is WP28's, per contract §2.
- **Added** `hasSchemaClaim(doc)` (module-private) and switched `migrateV1ToV2`'s one-shot guard
  from `readMeta(doc) !== undefined` to it.

  **This is the second, load-bearing defence against the tp11 defect.** The old marker was
  "`meta` is non-empty", and AC1 writes three keys into `meta` at subscribe time while the
  migration runs later inside `CanvasPersistence.coldOpen`. The new marker is "`meta` carries a
  key that is not one of the three identity keys" — a doc that has been *named* is not a doc
  that has been *translated*. WP8's own header already required this: *"this function must
  remain safe to run on a doc that already carries them"*.

  `isSchemaMajorMismatch` still uses `readMeta` and is behaviourally unchanged: identity-only
  `meta` has no `schemaVersion`, which reads `absent`, which is not a mismatch.

  Why this defence and not only the ordering: the ordering protects the docs *this* subscribe
  can see. `coldOpen`'s `seeded-from-file` branch seeds AFTER subscribe has returned, so an
  ordering-only fix would still have stranded exactly that branch — records with no `ord` and
  no `pos`/`size`, silently, with every oracle green.

### `plugin/src/files/manifest.ts`

- `FileEntry.guid?: string` — an attribute of the path's entry, never a second keyspace, so
  `renameFile` (which re-keys the whole entry object) carries it along for free (TC5.5).
- `setCanvasGuid(rawPath, guid)` — creates a minimal entry when the path has none. A **blank
  guid clears** the mapping and leaves the entry itself alone; that is the one spelling
  `CanvasIdentityStore.unbind` has available, given its
  `Pick<ManifestManager, "getCanvasGuid" | "setCanvasGuid">` (charter §7.0). Guarded before the
  write, so a no-op stamp emits no delta.
- `getCanvasGuid(rawPath): string | null`.
- **`carryGuid` helper, applied in `publishManifest` and `updateFile`.** Not pinned by any test,
  and a real defect otherwise: both writers rebuild the entry from what they just read off
  disk, so a single content republish would have dropped the guid and stranded every peer that
  resolves through the manifest.

### `plugin/src/files/canvas-sync.ts`

- **Exported** `CANVAS_DOC_PREFIX` (was a module-private `const`).
- **Added** `canvasDocId(guid)` — the sole doc-id constructor. Throws for a non-string, empty or
  blank guid. `${CANVAS_DOC_PREFIX}${...}` no longer appears anywhere in `src/` outside this
  function's body.
- **Added** `CanvasIdentityStore` and `createCanvasIdentityStore({ manifest, sidecar })`.
  `guidForPath` reads the manifest first, then the sidecar index by VALUE. `bind` writes both
  and enforces the mapping in both directions (one guid names one path, one path is named by
  one guid) so a rename cannot leave a stale second index row. `unbind` clears the manifest
  guid and drops every index row whose value is that path. Both idempotent; neither ever
  rewrites the index when nothing changed.
- **Added** `mintCanvasGuid()` (module-private) — 32 lowercase hex chars from
  `crypto.getRandomValues(new Uint8Array(16))`, `Math.random` only as a last-resort branch so a
  missing API cannot turn into a thrown subscribe. **Zero new dependencies; no uuid library.**
  Hex-only so a guid can never be mistaken for a path.
- **Class:** `setIdentityStore`, `getCanvasGuid`, `handleRename`, plus private
  `canvasDocIdFor`, `resolveGuidForSubscribe`, `stampIdentity`, `pathRefFor`, `rekeyPathState`.
- **All six doc-id sites** now route through `canvasDocIdFor(path)` → `canvasDocId(guid)`:
  `getCanvasDocHandle`, `getCanvasSnapshot`, `subscribe`, `unsubscribe`, `handleLocalModify`,
  `destroy`.
- **The observer and `afterTransaction` closures** read the path through a mutable cell
  (`observedPathRefs`) instead of capturing it, so `handleRename` re-points the live data path.

#### The two-mode design (read this before reviewing)

`CanvasSync` behaves differently depending on whether an identity store has been injected, and
that is the design, not an accident:

| | store injected | no store |
|---|---|---|
| doc id | `canvasDocId(guid)` | `canvasDocId(path)` — byte-identical to the pre-WP27 id, built by the same single constructor |
| `meta` stamp | `guid` / `path` / `epoch` | none |
| unresolvable path | guest opens NOTHING; host mints | n/a |
| `getCanvasDocHandle(unknown path)` | `null` | creates on demand, as before |

Identity is a **provided capability**, exactly as sidecar I/O is in WP24. With no provider,
`CanvasSync` does not invent an identity it cannot publish — writing the path into `meta.guid`
would be a claim it cannot honour and every peer would read it as one. This is also what keeps
~40 pre-existing test files (which address canvas docs as `__canvas__:<path>` and never inject
a store) green without a single test edit.

#### `subscribe` ordering, exactly

```text
canonicalise → isPathSafe → already-subscribed?
  └── subscribedPaths.add(path)          ← SYNCHRONOUS, before any await (US5 AC3:
  │                                         a pending subscribe already counts as owned)
  ├── resolveGuidForSubscribe(path, role)   ← identity BEFORE the doc: asking for
  │     └── null ⇒ delete the claim, return   an id is what CREATES the document
  ├── getDoc(canvasDocId(guid)) → waitForSync
  ├── host seed (applyCanvasToYMaps)      ← unchanged
  ├── stampIdentity(...)                  ← AFTER the seed. Never before.
  └── afterTransaction + observers, bound to the path CELL
```

#### `handleRename`, exactly

```text
guid = guidByPath.get(old)   → absent ⇒ not ours, no-op
rekeyPathState(old, new)     → subscribedPaths, guidByPath, observers, seqHandlers,
                                writeTimers, writeFirstScheduled, externalWriteSettleTimers,
                                lastWrittenContent, seedRefusalLedgers, remoteSeq,
                                recentDiskWrites, recentLocalEdits, shadow.paths,
                                and the observer path CELL
stampIdentity(doc, guid, new)→ reached by the UNCHANGED doc id; creates nothing
store.bind(guid, new)        → BIND FIRST, so the mapping is never absent from both
store.unbind(old)              stores at once (a peer resolving mid-rename must never
                               find nothing, or it would mint a second identity)
```

No `releaseDoc`, no `getDoc`-as-creation, no re-subscribe. The `Y.Doc` is the same object
before and after.

### `plugin/src/files/background-sync.ts`

- `setActiveFile`: `if (skipsAutoTextSync(oldActive)) return;` **immediately preceding**
  `const docHandle = this.syncManager.getDoc(oldActive);`.
- Updated the file-header contract comment: `setActiveFile` moved out of the "deliberately
  unguarded, justified by reachability" list, with the reason (AC4 rejects reachability
  arguments) recorded in place. `subscribe()` and `flushWrite()` remain unguarded and the
  reasons are unchanged — `subscribe()` is the R10 door and WP33 owns closing it.

### `plugin/src/editor/collab.ts`

- `activateForFile`: `if (skipsAutoTextSync(filePath)) { … return; }` **immediately preceding**
  `const docHandle = syncManager.getDoc(filePath);`. The early return takes the same shape as
  the existing `!docHandle` branch — drop the awareness reference and reconfigure the
  compartment to empty — so a previous file's binding is never left live over the canvas.
- Added `skipsAutoTextSync` to the existing `../utils` import. No private `endsWith(".canvas")`
  copy was created, in either file.

### Not changed, on purpose

`canvas-presence.ts`, `canvas-binding.ts`, `canvas-model-bridge.ts`, `vault-events.ts`
(`canvasOwned` included), `sync/sync.ts`, `canvas-persistence.ts`, `main.ts`, `server/`,
`docker/`, `deploy/`, `plugin/main.js`, `manifest.json`, `package.json`, `_run_blind.py`, and
every pre-existing test file.

---

## Visible Test Results

```text
cd plugin && npx vitest run src/__tests__/v2/wp27
  Test Files  11 passed (11)
       Tests  54 passed (54)
```

Baseline was 46 red / 8 green. The 8 AC3 characterisation and control tests (tp08 in full, plus
the positive and over-guard controls in tp09/tp10) **stayed green throughout** — no assertion in
that set was reddened at any point.

| Suite | Result |
|---|---|
| `src/__tests__/v2/wp27` | **54 / 54 green** |
| `src/__tests__/v2/wp24` + `wp26` | **122 / 122 green** (76 + 46, unchanged) |
| `npx tsc --noEmit -skipLibCheck` | **clean, zero diagnostics** |
| full plugin suite | **1524 total, 1522 pass, 2 fail** (baseline: 1524 total, 1478 pass, 46 fail) |

Delta: **+44 passing, −44 failing.** The 46 WP27 failures are gone; 2 new failures appeared,
both in `w4-canvas-integrity.test.ts` (`M1`, `K5`) and both covered under **Escalation 1**.
That file was verified at 46/46 with the working tree stashed, so the two are attributable to
this diff and to nothing else in the batch.

**Foreign edits observed, not touched:** `src/utils.ts` and
`src/__tests__/v2/wp26/test_tp04_sync_from_manifest_visible.test.ts` carry WP26's uncommitted
changes. Batch B16 activity was not observed in any file WP27 touched.

### Fuzzer wiring (Shared Ownership Contract §7)

Not wired, and the contract itself says so: *"WP26/WP27/WP30 are structural and are not"*
fuzzer-shaped. WP27 changes what a document is CALLED and where its name is written down; it
expresses no "which of two states wins" rule, so it has no op class to register. The mechanism
that will be fuzzer-shaped is WP28's epoch rule, which consumes `EPOCH_KEY` from here.

---

## Summary for Worker 3

WP27 is complete against its four ACs and its 54 visible tests, with `tsc` clean and WP24/WP26
untouched. Two items need a decision from you.

1. **Licence request (blocking for a clean full-suite run).** `w4-canvas-integrity.test.ts`
   `M1` and `K5` assert that AC4's two guards do NOT exist — they are W4's characterisation of
   the R5 hole, written when it was still open. AC4 and those two assertions are mutually
   exclusive. WP27 holds no licence, so both were left untouched and both are red. The right
   fix is to **invert** them (`toBe(true)` → `toBe(false)` plus a rewritten message), which
   turns them into a second independent pin on AC4 from a file WP27 does not own. Please
   escalate to Worker 2 for the amendment licence.

2. **Wiring handover to WP25.** `setIdentityStore` has no production caller, deliberately:
   `createCanvasIdentityStore` needs a `SidecarIO` adapter that does not exist yet (WP24 shipped
   the interface, WP25 owns the wiring), and wiring manifest-only would drop a guest that
   subscribes before the host's manifest entry replicates into the R10 text fallback with no
   retry. WP25 should land two one-line calls: `setIdentityStore(...)` in `main.ts` and
   `handleRename(...)` in the `vault-events.ts` rename handler.

Two notes for the WPs downstream:

- **WP28** — `EPOCH_KEY` is exported from `canvas-schema.ts` and WP27 stamps `0` on a doc that
  has none, once, guarded, inside `CanvasSync.stampIdentity`. There is no comparison anywhere.
  Note that `hasSchemaClaim` treats `epoch` as an identity key, so writing an epoch does not
  arm the migration marker.
- **WP25 / WP28 / WP30** — import `CANVAS_DOC_PREFIX`, `canvasDocId`, `CanvasIdentityStore` and
  `createCanvasIdentityStore` from `files/canvas-sync.ts`, and `GUID_KEY` / `PATH_KEY` /
  `EPOCH_KEY` from `canvas/canvas-schema.ts`. Nothing builds a doc id by hand and no call site
  inlines `"guid"`, `"path"` or `"epoch"`.

---

## Licensed amendments (Dispatcher ruling)

**Licence scope:** an *amendment* licence for exactly two assertions in
`plugin/src/__tests__/w4-canvas-integrity.test.ts` (`M1`, `K5`) and nothing else. Both tests
survive; neither is deleted, skipped or relaxed. **`BUILD_SPEC_CanvasV2.md` was NOT edited** —
the §7 register entry for this licence is Worker 2's to write. This section is the enumeration
only.

**Test count for the file: 46 before, 46 after.** No test was added or removed; the file went
from 44 green / 2 red to **46 green**. The whole-plugin total is unchanged at 1524 collected,
which independently rules out an addition or a deletion anywhere in the tree.

### The two amended assertions, in §7 form

| # | File · line | Why stale | Post-amendment strictness | Falsification result |
|---|---|---|---|---|
| **A1** | `plugin/src/__tests__/w4-canvas-integrity.test.ts` · `:1665` (`M1`) | An **inverse characterisation of the defect AC4 exists to close**. Its own message read as a finding, not a specification — *"setActiveFile is a SECOND unguarded bare-path getDoc … W3's sweep claim is incomplete"*. It was true when written, and WP27 AC4 made it false by requiring precisely this call site to be guarded. Charter §7.0(c) names the same line. | `toBe(true)` → `toBe(false)` **plus** a new second assertion pinning that `skipsAutoTextSync` was CONSULTED for that exact path and returned the skip verdict. Strictness rises, it does not fall: a bare `toBe(false)` would also be satisfied by a broken harness, a renamed method or an unrelated early return, and the consult assertion is red in every one of those cases. No `toMatchObject`, no `objectContaining`, no subset matching, no `.skip` / `.only`, nothing removed. | **F1** — removed `if (skipsAutoTextSync(oldActive)) return;` from `BackgroundSync.setActiveFile`. **Exactly 1 of 46 red: `M1`, on its own pin** (`expected true to be false`). Zero neighbour reddening, no narrowing needed. **F1b** — replaced the shared predicate with a private `oldActive.endsWith(".canvas")` copy, so the guard still works and `reached` is still `false`. **Exactly 1 of 46 red: `M1`, on the NEW assertion** (`expected [] to deeply equal [ true ]`). That is a class a bare `toBe(false)` cannot see at all, and it is the regression this module has already grown twice. |
| **A2** | `plugin/src/__tests__/w4-canvas-integrity.test.ts` · `:1747` (`K5`) | Same class. Its message read *"CollabManager has NO internal `.canvas` guard … currently unreachable ONLY because main.ts gates on getActiveViewOfType(MarkdownView), which no test covers"* — i.e. exactly the reachability argument AC4 rejects in as many words. WP27 added the guard the message says does not exist. | Identical treatment: `toBe(true)` → `toBe(false)` plus the predicate-consult assertion. Same no-weakening constraints observed. | **F2** — removed the `if (skipsAutoTextSync(filePath)) { … }` block from `CollabManager.activateForFile`. **Exactly 1 of 46 red: `K5`, on its own pin** (`expected true to be false`). No neighbour reddened. **F2b** — private `filePath.endsWith(".canvas")` copy. **Exactly 1 of 46 red: `K5`, on the NEW assertion.** |

### Titles and messages, rewritten

Licence condition 4: no message may survive that asserts the hole is still open.

- `M1` title: *"setActiveFile acquires a bare-path doc for a .canvas that was never subscribed"* → *"setActiveFile **GUARDS** the bare-path getDoc for a .canvas that was never subscribed"*.
- `K5` title: *"CollabManager has **no** internal .canvas guard — protection is main.ts's MarkdownView gate"* → *"CollabManager **HAS** an internal .canvas guard — protection no longer relies on main.ts's MarkdownView gate"*.
- Both assertion messages were rewritten to describe the R5 damage a *missing* guard would cause, instead of reporting the guard's absence as a finding.
- The `W4 REVALIDATION M` header comment block, and a new comment above `K5`, record in place that the original finding was correct **when written** and that AC4 closed it — so a future batch reading the surviving narrative cannot mistake it for a live finding. That is the failure mode this run has already been bitten by twice.

### How the guard became observable (the instrumentation)

`w4-canvas-integrity.test.ts` now mocks `../utils` through a `vi.hoisted` recorder that
**delegates to the real `skipsAutoTextSync`** and appends `{ path, verdict }` to a plain array.
Behaviour is byte-identical for every other test in the file — all 44 previously-green tests
stayed green through every run of this amendment, including the four falsification runs. The
recorder is a plain array rather than a `vi.fn`, precisely so the file-wide
`vi.restoreAllMocks()` in `afterEach` cannot silently disarm the oracle; each consumer clears it
immediately before driving its site.

`skipsAutoTextSync` is the right thing to instrument because it is the ONE predicate both AC4
sites consult (Shared Ownership Contract §1/§5, charter §7.0(c)) — there is no private
`endsWith(".canvas")` copy at either site, and F1b / F2b are what keep it that way.

---

## Blind-oracle strengthening — `blind_set1/WP27/test_tp05…blind1.test.ts`

**Test:** *"clientID and state vector are unchanged across the rename"* — subject, file, name and
set size all unchanged (**41 collected, 41 passed**, before and after). One assertion restated;
nothing relaxed, skipped or deleted.

**Verdict on the premise: AGREED — the oracle was wrong, the implementation is correct.**
Verified against the tree rather than accepted on assertion: AC2 requires the rename to update
`meta.path`; `meta` is the Yjs map `META_MAP_NAME`; `CanvasSync.handleRename` reaches the doc by
its *unchanged* id and calls `stampIdentity(doc, guid, newPath)`, whose body writes
`meta.set(PATH_KEY, newPath)` inside a single `doc.transact`. The guid is unchanged and `epoch`
is already present from subscribe, so `writeGuid` and `writeEpoch` are both false and **exactly
one `Y.Map` item is created — one clock tick**, which is precisely the delta observed
(`…, 19]` → `…, 20]`). "State vector unchanged" is satisfiable only by an implementation that
does *not* perform AC2's update. No correct implementation can pass it.

### Strictness delta

| Before | After |
|---|---|
| `expect(Array.from(Y.encodeStateVector(after))).toEqual(vectorBefore)` — one opaque byte-array equality meaning *"nothing happened"*. Unsatisfiable, and therefore **unable to discriminate anything**: it was already red against the correct implementation, against a spurious extra write and against a re-seed alike. | Four assertions over `Y.decodeStateVector(...)` (`Map<clientID, clock>`) stating *"the history was EXTENDED, never REPLACED, by exactly AC2's one write"*: (1) the client-entry key set is identical — a re-created doc has no entry for `clientIdBefore`; (2) no clock ever moves backwards — the strict-ancestor claim; (3) no **peer**'s clock moved — the rename authors nothing on anyone else's behalf; (4) this replica advanced by **exactly** `RENAME_CRDT_WRITES = 1`. |

Kept from the old form: a re-created doc, and a re-created-and-refilled doc, are still rejected.
**Gained:** an implementation that performs spurious extra writes, or that re-seeds records
during the rename, is now rejected — two classes "unchanged" could not distinguish from correct
behaviour. The `clientID` identity assertion was left exactly as it was, still compared to
itself and never to a literal.

### Falsification (both on the new pin, perturbing `plugin/src/files/canvas-sync.ts`)

| Perturbation | Result |
|---|---|
| **(a) spurious extra write** — one additional `meta.set("renamedAt", 1)` in `handleRename` after the stamp | **1 of 41 red**, on assertion (4): *"the rename is not exactly one CRDT write … `expected 2 to be 1`"*. |
| **(b) re-seed the records** — `handleRename` replaces every `nodes` record with a fresh `Y.Map` carrying the same entries (same doc, same `clientID`, same key set) | **1 of 41 red**, on assertion (4): `expected 17 to be 1`. This survives both a doc-key-set comparison and the `clientID` check — the old "unchanged" oracle could not have distinguished it, and the sibling test *"the canvas namespace holds exactly one doc before and after"* stayed green throughout. |

**Neighbours:** in both perturbations the other two `it` blocks in the same file stayed green, as
did the other ten `blind_set1` files (40 / 41 passing in each run — the single failure was the
intended assertion each time). No masking occurred and no narrowing was required. Both
perturbations were reverted and `canvas-sync.ts` re-verified free of any `FALSIFY` marker.

### Verification after both jobs

| Check | Result |
|---|---|
| `npx vitest run src/__tests__/w4-canvas-integrity.test.ts` | **46 / 46 green** (count unchanged from the 46 baseline) |
| `npx vitest run src/__tests__/v2/wp27` | **54 / 54 green** |
| `npx vitest run src/__tests__/v2/wp24 src/__tests__/v2/wp26` | **122 / 122 green** (76 + 46) |
| `npx tsc --noEmit -skipLibCheck` | **clean, zero diagnostics** |
| `python _run_blind.py 27 both` | set1 **41 collected / 41 passed**; set2 **47 collected / 47 passed** |
| full plugin suite (`npx vitest run`) | **264 files, 1524 / 1524 green** (was 1522 / 1524 — the two reds were `M1` and `K5`) |

**No production source file was modified by this amendment.** `background-sync.ts`, `collab.ts`
and `canvas-sync.ts` were perturbed only inside falsification runs and restored to their WP27
state, verified by inspection of the guard lines and by the absence of any `FALSIFY` marker.
`BUILD_SPEC_CanvasV2.md` was not touched. No test file other than the two named in the licence
was touched. **Escalation 1 above is hereby RESOLVED**; Escalation 2 (the WP25 wiring) remains
open and is unaffected.
