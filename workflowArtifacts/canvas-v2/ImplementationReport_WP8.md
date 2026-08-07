# Implementation Report — WP8

**WP:** WP8 — `meta` + schemaVersion + V1→V2 migration
**Phase:** P1
**Attempt:** 1

## Status: DONE

All 5 visible tests pass. `tsc -noEmit -skipLibCheck` is clean (zero errors, including no new ones
under `src/__tests__/wp49/`). The four existing canvas-sync-adjacent suites named in the brief pass
unchanged, and the whole `src/__tests__/v2/` bucket is green. No test was deleted, skipped, `.todo`'d,
`.only`'d, commented out, weakened or relaxed.

---

## Completed Work

| AC | Requirement | Status | How it is satisfied |
|---|---|---|---|
| AC1 | `meta` created once per doc, carries `schemaVersion`, never replaced by a new container | DONE | `meta` is only ever reached through `doc.getMap(META_MAP_NAME)`, which returns the same `Y.Map` instance for the doc's lifetime. There is no `set(name, new Y.Map())` anywhere in the module (the forbidden operation, BUILD_SPEC §4.2). `guid`/`epoch`/`path` are documented as P2 and deliberately not written, so the function stays safe to run on a doc that already carries them. |
| AC2 | One transaction; `x/y`→`pos`, `width/height`→`size`, endpoint keys→`from`/`to`, an `ord` on every record, **no record loses a value** | DONE | Exactly one `doc.transact(...)` wraps the meta stamp + both record maps (TC2 counts one `afterTransaction`). Translation runs through WP9/WP10's codecs. `ord` is allocated with WP13's `allocateOrd` and folded with `compareOrd`. **No-value-loss is structural, not a checklist:** the migration only ever ADDS the register a recognised key set translates into; it never deletes a key, never reconstructs a record from an allowlist, and never reads or writes an unrecognised key. |
| AC3 | Idempotent — **zero delta**, not "same values" | DONE | The `meta`-exists guard sits **before** `doc.transact`, so a second call opens no transaction, fires no `update` event and produces no delta at all. Verified by TC4's update-delta oracle (byte-identical to an empty doc's update) plus a zero-`update`-event assertion. |
| AC4 | Foreign schema major detected → local capture disabled for that path while persistence continues; never writes a guess into shared state | DONE (local half) | `isSchemaMajorMismatch(docHandle.doc)` guard in `CanvasSync.handleLocalModify`, returning before any write reaches `nodesMap`/`edgesMap`. `CanvasPersistence` is not referenced or modified, so the CRDT→disk direction keeps running. The persistence-continues half is Worker 4's integration target per TaskCharter §7b. |

---

## Blocked Items

None. No `TOOL_REQUEST`, no `SPEC_CONTRADICTION`.

The Shared Ownership Contract §3 forward-compat constraint (P4 moving node `text` / edge `label` to
a nested `Y.Text` **within major 2**) is satisfied without tension: the migration never reads,
normalises or type-asserts `text` or `label` — they are carried through untouched, so both the
plain-string and the `Y.Text` shape survive it byte-identically, and `SUPPORTED_SCHEMA_MAJOR` stays
at 2.

### Open decision for Worker 3 (not a blocker)

`migrateV1ToV2` is **not yet called from a production entry point.** This is deliberate, and it is a
correctness argument rather than a scope dodge:

- WP7 moved the guest seed out of `CanvasSync.subscribe` into `CanvasPersistence.coldOpen()`, which
  the wiring layer runs **after** `subscribe` resolves. Calling `migrateV1ToV2` inside `subscribe`
  would stamp `meta` on a doc that is still **empty**, and the records `coldOpen` seeds a moment
  later would then be permanently unmigrated — the guard would see `meta` and correctly refuse to
  run again. That is worse than not migrating at all.
- In P1 the capture path (`canvas-sync.ts`) and the persistence path still read and write the flat
  V1 keys. Shared Ownership Contract §3 explicitly says not to wire these cores into the write
  boundaries yet, and to land "pure, independently testable cores plus the *minimum* integration
  your own ACs demand". AC4's gate is that minimum, and it **is** wired.

So the correct invocation site is the one that also moves the read/write boundary to the registers
(WP18+ / WP32, where `writeRecordMinimal`'s key deletion also lives). Flagging it explicitly so it is
a scheduled decision rather than a forgotten call.

---

## Tools Created

None.

---

## Changes Made

| File | Change | Size |
|---|---|---|
| `plugin/src/canvas/canvas-schema.ts` | **new** — the whole WP8 owned surface | ~340 lines incl. rationale comments |
| `plugin/src/files/canvas-sync.ts` | **modified** — one import + the AC4 gate in `handleLocalModify` | +21 lines, 0 removed |
| `workflowArtifacts/canvas-v2/TaskCharter_WP8_MetaSchemaVersionMigration.md` | Charter Status → `DONE`, §8 and §9 filled | — |

Nothing else was touched. No changes to `server/`, `docker/`, `deploy/`, `plugin/main.js`,
`manifest.json`, `package.json`, `canvas-presence.ts`, `canvas-binding.ts`, `canvas-model-bridge.ts`
or `plugin/src/main.ts`. No version bump, no `npm run build`, no repo-wide formatter, no `lint --fix`.

`npx biome check` on the two touched files reports **zero findings for `canvas-schema.ts`** and, for
`canvas-sync.ts`, only the two pre-existing findings that were already there (`lint/style/useTemplate`
at line 698, in untouched code, plus the known whole-file CRLF `format` artifact).

---

## Exported API surface

`plugin/src/canvas/canvas-schema.ts` — exactly the charter §7 contract, nothing more:

```ts
export const META_MAP_NAME = "meta";
export const SCHEMA_VERSION_KEY = "schemaVersion";
export const SUPPORTED_SCHEMA_MAJOR = 2;

/** Fresh | V1 | already-V2, uniformly. ONE transaction. No-op with ZERO delta and
 *  ZERO `update` events when `meta` already exists. Never replaces `meta`. */
export function migrateV1ToV2(doc: Y.Doc): void;

/** True only when `meta` EXISTS and its schemaVersion's major differs from
 *  SUPPORTED_SCHEMA_MAJOR. `meta` absent → false (that is the migration case). */
export function isSchemaMajorMismatch(doc: Y.Doc): boolean;
```

Module-private (deliberately **not** exported, so WP8 claims no ownership it was not given):
`RECORD_MAP_NAMES` (`"nodes"` / `"edges"` — no P1 core owns these container names; they are inline
literals in `canvas-sync.ts`, and importing them from there would create a real cycle because that
module now imports this one) and the four flat file geometry key names, which are typed as
`keyof FilePos` / `keyof FileSize` so they are compile-time-checked against WP9's file-shape types
rather than being loose literals. `canvas-sync.ts`'s exported `GEOMETRY_KEYS` covers the same four
names but as an unordered `Set` used as a delete guard — it cannot say which member is the
x-coordinate, and it is untouched (membership and export unchanged; no ESCALATE).

### Two semantics worth pinning explicitly

- **"`meta` exists"** means: registered in `doc.share` **and** non-empty. `doc.getMap(name)` is a
  *definition*, not a read — calling it on a doc without `meta` registers an empty container as a
  side effect. `readMeta` probes `doc.share.has(...)` first and treats an empty container as absence,
  so neither predicate can change the answer to the next question, and a doc that was merely
  *inspected* before migration still migrates correctly.
- **`isSchemaMajorMismatch` on an unreadable version** returns `true`. A number is truncated to its
  major (`2.4` → 2, so a *minor* bump never gates a client out) and a `"2.4"`-style string is
  accepted; anything else is a mismatch, because "I cannot tell what this doc is" and "I know I
  cannot read this doc" have the same correct response — stop writing. A `meta` with no
  `schemaVersion` at all returns `false`: nothing claims a major, so nothing conflicts.

---

## Symbols imported rather than redefined (WP9/WP10/WP13)

Every V2 key name, every value shape and every ord operation is imported. The module defines no
competing constant, no local `const`, and no inline string literal for anything it does not own.

| Symbol | Owner | Used for |
|---|---|---|
| `V2_FIELD` (`pos`, `size`, `ord`, `type`, …) | WP9 | every V2 doc key name — no `"pos"` / `"ord"` literal exists in this module |
| `encodePos` / `encodeSize` | WP9 | file `x,y` / `width,height` → the atomic register value (incl. WP9's §4.4 rounding and `-0` normalisation) |
| `writePosRegister` / `writeSizeRegister` | WP9 | the single-`set` whole-register write |
| `FilePos` / `FileSize` (types) | WP9 | compile-time check of the four flat file geometry key names |
| `ENDPOINT_SLOTS` | WP10 | exhaustive `from` + `to` iteration |
| `ENDPOINT_FILE_KEYS` | WP10 | the six flat file endpoint key names — not one of them is spelled here |
| `encodeEndpointFromFile` | WP10 | flat file keys → the composite `{node, side, end?}` register, incl. its whole-or-nothing rule |
| `writeEndpointRegister` | WP10 | the single-`set` whole-endpoint write |
| `allocateOrd` | WP13 | **every** `ord` this migration assigns |
| `compareOrd` | WP13 | the running upper bound while appending. **No `<` on raw ord strings and no `localeCompare` anywhere in this module** — a migration that invented its own ord order would make every suite pass while replicas silently disagreed on file byte order. |

`ord` allocation detail: each record map is its own order domain; records are appended with
`allocateOrd(highest, undefined, String(doc.clientID))`, where `highest` is the maximum ord seen so
far **under `compareOrd`**. A record that already carries a non-empty string `ord` keeps it (an `ord`
is immutable, WP13 AC4) and is folded into that bound instead of being reallocated.

---

## Migration semantics, stated precisely

### Translated (a new key is ADDED; the source keys are left in place)

| V1 source keys | V2 register written | Condition |
|---|---|---|
| `x`, `y` | `pos` = `encodePos(x, y)` | both present and finite numbers, and `pos` not already present |
| `width`, `height` | `size` = `encodeSize(width, height)` | both present and finite numbers, and `size` not already present |
| `fromNode`, `fromSide`, `fromEnd?` | `from` = `encodeEndpointFromFile("from", …)` | WP10's codec returns a WHOLE endpoint, and `from` not already present |
| `toNode`, `toSide`, `toEnd?` | `to` = `encodeEndpointFromFile("to", …)` | as above |
| — | `ord` = `allocateOrd(...)` | the record has no non-empty string `ord` yet |

### Carried through untouched (never read, never written, therefore never lost)

`id`, `type`, `text`, `label`, `file`, `subpath`, `url`, `color`, `background`, `backgroundStyle`,
**and every unknown or forward-compat key whatsoever.** The migration has no allowlist and never
rebuilds a record — the container is the same `Y.Map` it always was. `text` / `label` are singled out
because they must keep tolerating a future nested `Y.Text` (Shared Ownership Contract §3): they are
not inspected at all.

### Never touched

- **Nothing is ever deleted.** Not one key, including the flat V1 keys that were just translated.
  Two independent reasons, either sufficient on its own:
  1. **A deletion is not undone by a state vector.** `Y.encodeStateAsUpdate(doc, sv)` always carries
     the doc's *whole* delete set, so a single `delete()` during migration makes every subsequent
     encoded update non-empty forever — the doc could never again demonstrate "no delta" (AC3). This
     is not theoretical: the first implementation did delete the translated flat keys and TC4 failed
     with a 12-byte delta consisting purely of the delete set, against the 2-byte empty reference.
  2. **P1's capture and persistence paths still read and write the flat keys.** Removing them is the
     write boundary's job when it moves to the registers (WP18+, the `writeRecordMinimal`
     key-deletion seam) — not a migration's, which must be survivable by a client that has not yet
     made that move. `.canvas` on disk is unchanged either way.
- A **half-present or non-numeric** geometry, and a **half-populated** endpoint, are left exactly as
  found — no drop, no "repair" into a plausible value, no register that claims more than the file
  said.
- An **already-present** register is never overwritten. A doc holding both shapes keeps both rather
  than having one silently chosen for it.
- A container value that is **not a `Y.Map`** is skipped. This migration translates a doc; it does
  not repair one.
- The `meta` **container** itself is never replaced, and `guid` / `epoch` / `path` are never written
  (P2).

---

## Visible Test Results

Command (from `plugin/`, trailing slash as required):

```
npx vitest run src/__tests__/v2/wp8/ --reporter=dot
```

```
 Test Files  5 passed (5)
      Tests  5 passed (5)
```

| TC | AC | File | Result |
|---|---|---|---|
| TC1 | 1 | `test_tp01_meta_container_identity_visible.test.ts` | PASS — same `Y.Map` instance across calls, planted probe survives |
| TC2 | 2 | `test_tp02_migration_field_translation_single_tx_visible.test.ts` | PASS — `decodePos`/`decodeSize`/`decodeEndpoint` round-trip, well-formed `ord`, exactly 1 `afterTransaction` |
| TC3 | 2 | `test_tp03_migration_no_data_loss_visible.test.ts` | PASS — text/file/group nodes + fully-populated edge, both unknown forward-compat keys survive verbatim |
| TC4 | 3 | `test_tp04_migration_idempotent_no_delta_visible.test.ts` | PASS — second-call delta byte-identical to the empty-doc reference, 0 `update` events |
| TC5 | 4 | `test_tp05_major_mismatch_disables_capture_visible.test.ts` | PASS — mismatched path's `x` stays 0, matching-major path on the same instance captures 777 |

---

## Existing-suite regression check

```
npx vitest run src/__tests__/canvas-sync.test.ts src/__tests__/w4-canvas-integrity.test.ts \
  src/__tests__/canvas-single-writer.test.ts src/__tests__/canvas-persistence.test.ts \
  src/__tests__/v2/wp8/ --reporter=dot
```

```
 Test Files  9 passed (9)
      Tests  128 passed (128)
```

Additionally, the full V2 bucket (which includes the WP9/WP10/WP13 suites this WP imports from):

```
npx vitest run src/__tests__/v2/ --reporter=dot
 Test Files  59 passed (59)
      Tests  253 passed (253)
```

Typecheck:

```
npx tsc -noEmit -skipLibCheck      →  clean, zero output
```

Per rule 10 the full `npm test` was **not** run — Worker 3 runs it once at the end of the batch.

---

## Summary for Worker 3

- WP8 is **DONE** on attempt 1. `plugin/src/canvas/canvas-schema.ts` is new and owns exactly the
  charter §7 surface; `canvas-sync.ts` gained a 21-line AC4 gate and nothing else.
- **The one design decision that could have gone the other way, and why it did not:** the migration
  is purely **additive** — it never deletes the translated flat V1 keys. TC4's update-delta oracle
  makes this mandatory (Yjs always ships the whole delete set in an encoded update, so any deletion
  permanently destroys the "zero delta" property), and it is independently right for P1, where the
  capture/persistence paths still speak the flat keys. Key removal belongs to the write-boundary WPs.
- **One scheduling item, flagged not resolved:** `migrateV1ToV2` has no production call site yet.
  Wiring it into `subscribe` in P1 would be a real bug — WP7's `coldOpen` seeds the guest doc *after*
  `subscribe`, so `meta` would be stamped on an empty doc and the records seeded afterwards would
  never migrate. The call belongs with WP18+/WP32. See "Open decision for Worker 3" above.
- **For Worker 4:** the outstanding AC4 half is "persistence continues" (TaskCharter §7b). The seam
  it must exercise is that `handleLocalModify` returns early on mismatch **without touching
  `CanvasPersistence`** — the module is not imported, referenced or modified by this WP, so a real
  `CanvasPersistence` + `CanvasSync` stack should show a normal CRDT→disk flush for a
  mismatched-major path while local edits to that same path are refused.
- **For WP14 and later gate consumers:** import `isSchemaMajorMismatch` / `SUPPORTED_SCHEMA_MAJOR`
  from `canvas-schema.ts`. Note that "`meta` absent" is `false` (the migration case) and an
  *unreadable* version is `true` — the two "no `meta`" situations and the "unknown version" situation
  are three distinct conditions, and the module keeps them distinct on purpose.
