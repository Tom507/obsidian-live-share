# Shared Ownership Contract — Batch B3 / P1 wiring (WP18–WP23)

**Binding on every sub-agent in this batch — test-generator and coder alike.**

Batch B2 prevented a real, expensive failure mode with a contract like this one: two work
packages independently choosing the same constant, **both suites passing while replicas
disagreed**. B3 wires five modules into one live path plus a fuzzer that asserts on all of
them, so the exposure is higher, not lower.

**The rule:** where two WPs in this batch share a constant, enum, key name or sort key, it is
**defined in exactly one module and imported by the other**. Re-declaring a shared value —
even with an identical literal — is a contract violation, not a style preference.

---

## 1. Ownership table

| Owned concept | Owner WP | Module | Consumers that MUST import it |
|---|---|---|---|
| The doc-level `deleted` container **name** | **WP19** | `plugin/src/canvas/canvas-tombstone.ts` (append) | WP20, WP23 |
| Lamport `t` allocation for tombstone ops | **WP19** | same | WP20, WP23 |
| The `by` client-identity string for tombstone ops | **WP19** | same | WP20, WP23 |
| Tombstone entry shape, LWW merge, suppression + quarantine predicates | WP12 *(frozen)* | `canvas-tombstone.ts` | WP19, WP20, WP23 |
| Ingest validity verdict + reason codes | WP14 *(frozen)* | `canvas-ingest-schema.ts` | **WP18, WP20** |
| Write-once `type` guard | WP11 *(frozen)* | `canvas-type-guard.ts` | WP18 |
| `meta`, `schemaVersion`, `migrateV1ToV2` | WP8 *(frozen)* | `canvas-schema.ts` | **WP18** |
| `ord` alphabet, allocator, `compareOrd`, `compareOrdId` | WP13 *(frozen)* | `canvas-ord.ts` | WP23 |
| V2 field keys, registers, codecs | WP9/WP10 *(frozen)* | `canvas-registers.ts` | WP18, WP19, WP23 |
| Rejection signature format (boundary + reason) | **WP18** | `canvas-sync.ts` | WP20 (quarantine/release signatures stay **distinct strings**, shared formatter only) |
| Fuzzer op registry + replica harness | **WP23** | new test-side module | — |

**Frozen** = landed in an earlier batch. Import it; do not modify it; do not re-implement it.

---

## 2. The three highest-risk shared values in this batch

### 2.1 The `deleted` map name — WP19 owns it

WP19 introduces the `deleted` container into the **production** path (nothing passes a
`deletedMap` today — WP17 left the parameter optional and unused). WP20 then writes
**quarantine** entries into **the same container**. If WP19 spells it `"deleted"` inline and
WP20 spells it `"deleted"` inline too, they agree today and diverge silently the first time
either is edited.

**Required:** WP19 exports a single named constant from `canvas-tombstone.ts`, e.g.

```ts
export const CANVAS_DELETED_MAP = "deleted";
```

WP20 and WP23 import it. **No string literal `"deleted"` may appear in WP20 or WP23.**

### 2.2 Lamport `t` and `by` — WP19 owns them

WP12's `t` is a **logical** clock, not `Date.now()` (the module contains no clock import and
must keep none). WP19 (user delete / undo) and WP20 (quarantine / release) **both** write
tombstone ops, so both allocate `t` and `by`. Two allocators = two clocks = non-convergence
that only shows up under concurrency.

**Required:** one allocator, owned by WP19, imported by WP20 and WP23. Every write goes
through WP12's `applyTombstoneOp` — **no WP may hand-build a `TombstoneEntry` and `set` it**.

### 2.3 The validity predicate — WP14 owns it, WP18 and WP20 share it

WP18 rejects invalid **local** records at the write boundary. WP20 quarantines invalid records
**already in the doc**. These must be the *same* judgement: a record WP18 would reject and WP20
would tolerate (or vice versa) is a live inconsistency.

**Required:** both call WP14's validator. Neither re-derives "is this record valid".

> **WP14 AC3 carries a trap that WP18 must respect:** `IngestInvalid.reject` is computed in one
> place as `origin === "local"`, and `IngestValid` has no `reject` key at all. **WP18 must obey
> `verdict.reject`, not re-derive rejection from the origin at the call site.** That
> re-derivation is precisely the bug WP14 AC3 exists to catch — and it is also how WP18 AC4
> ("remote deltas are never rejected at ingest") gets violated.

---

## 3. Defect classes this batch must not reintroduce

- **I6 / reference equality (found and fixed by WP15).** `encodePos`/`encodeSize` freeze a
  **new array on every call**, so a same-pixel restatement compared by reference reads as
  *fresh intent* — which is pushed to the CRDT and overwrites newer peer state. That is the
  corruption cascade this whole initiative exists to kill, and the register work reintroduced
  it once already. **Compare register values structurally, never by reference.**
- **Ordering hidden behind byte equality (found by WP17).** `canonicalizeCanvasData`'s
  array-level sort is **id-only**, so routing records through it discards `ord` order *while
  still producing byte-identical files on every replica*. **A byte-equality assertion cannot
  detect this class.** Any WP asserting on serialization must assert on the **emitted order**,
  not only on the bytes. This binds WP23 directly.
- **Asserting on a concurrent value.** Yjs tie-breaks concurrent same-key writes on
  `clientID = random.uint32()`, so an assertion on *which* value won passes ~50% of runs. An
  assertion on a specific value is legitimate **only** when that value has a single author or a
  causal predecessor chain. **Order concurrent writes; never assert on them.** This binds WP23
  with special force and has already bitten this project twice.
- **Under-advancing the shadow.** Corrected in project memory: the two ways to be wrong are
  **symmetric**, not asymmetric. Under-advancing is *not* a harmless redundant
  reclassification — it makes the next restatement of a confirmed value read as fresh intent.
  Resolve ambiguity by being **exact**, never by defaulting to "do not advance".

---

## 4. Constants that must NOT change

- `GEOMETRY_KEYS` keeps exactly `{x, y, width, height}` and stays exported — changing
  membership or removing the export is an **ESCALATE**, not a refactor.
- `PROTECTED_KEYS` **stays exported with unchanged membership** even after WP18 retires its
  last reader on the seed path. It is defence in depth per WP20's charter, and two live tests
  read it as a constant (`w4-canvas-integrity` A8; WP3 `blind_set1/test_geometry_keys_drift`).
  Deleting it would break tests that have nothing to do with the seam being removed.
- `canvas-presence.ts` is **byte-unchanged** by this entire batch (WP21 AC2). Modifying it is
  an abort criterion.
- `useCanvasBinding` stays `false`. `canvas-binding.ts` is frozen except WP22's one narrow
  removal.

---

## 5. Deletion discipline

**Licensed deleters in this batch: WP21 and WP22 only** (BUILD_SPEC §7 list: WP4, WP21, WP22,
WP33), plus the one named retirement the **WP18 charter itself** orders — see the batch
handover's ledger section, which records that §7's list omits WP18 and flags it for Worker 2
ratification.

- WP19, WP20, WP23 have **no** deletion licence and delete nothing.
- A licensed deletion is licensed **only** when the WP enumerates each removed test **by name**
  in its implementation report. An unenumerated drop is an abort criterion.
- Removing code is real work with real risk: **confirm the removed seam has no surviving
  callers** rather than assuming the type-checker will catch them.
- No test may be weakened, `.skip`'d, `.only`'d or relaxed to make a suite green.
