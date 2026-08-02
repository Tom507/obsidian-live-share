# Implementation Report — WP12

**WP:** WP12 — Tombstone map core
**Phase:** P1
**Attempt:** 1
**Module:** `plugin/src/canvas/canvas-tombstone.ts` (created)

Attempt: 1

## Status: DONE

All 10 visible test files (18 assertions/tests) pass. `npx tsc -noEmit -skipLibCheck` from `plugin/`
is clean — zero errors, no new ones. No existing test was deleted, skipped, weakened or relaxed.

---

## Completed Work

| AC | Requirement (verbatim from charter §4) | How it is met | Visible tests |
|---|---|---|---|
| **AC1** | `deleted[id]` carries `{t, by, on}` and optionally `q`; concurrent operations on the same id converge by LWW on `on` using `t` with `by` as tiebreak, identically on every replica. | `TombstoneEntry` is exactly `{t, by, on, q?}`. `mergeTombstoneEntries` is `max` over the total order `(t, by, on, q)` — higher `t` wins outright, equal `t` breaks on the greater `by` under plain lexicographic string comparison. Being a max over a *total* order makes it commutative, associative and idempotent, hence convergent under any arrival permutation. The comparison is this module's own explicit code; it never leans on Yjs's `clientID` arbitration. | TC1, TC2, TC3, TC4 |
| **AC2** | `on:true` suppresses the record in all three consumers — reconcile output, serialisation and capture resurrect-blocking — through one shared predicate, not three copies. | `isTombstoneSuppressed(entry)` is the only exported function matching a suppression-shaped name; it is `q`-agnostic so a quarantine suppresses exactly as hard as a user delete. A dynamic export scan pins that there is exactly one. | TC5, TC6 |
| **AC3** | Undo of a delete (`on:false`) restores the record with **all** its field values intact, because field containers were never destroyed. | Structural: the module is never handed a record's field container. Its only container seam is `TombstoneMap` (the separate `deleted` map keyed by id), and that seam exposes only `get`/`set` — no `delete`, no `clear`. A tombstone op therefore *cannot* reach a record's fields. Undo is also not special-cased: it is an ordinary op that loses to a fresher delete. | TC7, TC8 |
| **AC4** | Quarantine (`q:true` with `on:true`) is distinguishable from a user delete, and releasing quarantine restores the record without a user-visible delete/undelete event. | `isTombstoneQuarantined` requires *both* `on:true` and `q:true`, so a lingering `q:true` on an `on:false` entry reads as not quarantined. Release is an ordinary `applyTombstoneOp` with `on:false` — byte-identical in call shape and result key shape to a plain undo. The module exports no event/notification surface of any kind and no dedicated release function. | TC9, TC10 |

**Definition of Done — delete, undo and quarantine are one converging mechanism with a single
suppression rule:** met. There is exactly one mutating entry point (`applyTombstoneOp`), one merge
rule (`mergeTombstoneEntries`), and one suppression predicate (`isTombstoneSuppressed`). The four
"operations" differ only in the `on`/`q` payload they carry.

---

## Blocked Items

None. No `SPEC_CONTRADICTION`, no `TOOL_REQUEST`, no ESCALATE.

---

## Tools Created

None. No new runtime dependency, no new dev dependency, no script.

---

## Changes Made

| File | Change |
|---|---|
| `plugin/src/canvas/canvas-tombstone.ts` | **Created.** The whole WP. ~300 lines, of which the majority is the ownership/rationale header and JSDoc that WP15/WP17 read instead of re-deriving the rule. |
| `workflowArtifacts/canvas-v2/TaskCharter_WP12_TombstoneMapCore.md` | Charter Status `TESTS_ADDED` → `IN_PROGRESS` → `DONE`; §8 and §9 filled. |
| `workflowArtifacts/canvas-v2/ImplementationReport_WP12.md` | **Created** (this file). |

Nothing else was touched. No test file was modified. `server/`, `docker/`, `deploy/`,
`plugin/main.js`, `manifest.json`, `package.json`, `canvas-presence.ts`, `canvas-binding.ts`,
`canvas-model-bridge.ts` and every other WP's module are untouched. No version bump, no
`npm run build`, no formatter, no `lint --fix`.

**Purity confirmed:** the module has **zero import statements**. No Yjs, no Obsidian, no
filesystem, no clock, no randomness, no logger. `Date.now()` appears nowhere — `t` is always a
Lamport value supplied by the caller.

---

## Exported API surface

Exactly seven exported names, five of them functions. Nothing else. (The two `interface`
declarations are types and do not appear in the runtime module namespace, which is what the
dynamic-scan tests inspect.)

```ts
export interface TombstoneEntry {
  readonly t: number;      // Lamport timestamp — logical, never wall-clock
  readonly by: string;     // clientID
  readonly on: boolean;    // true = suppressed (deleted or quarantined)
  readonly q?: boolean;    // true only alongside on:true = quarantine, not a user delete
}

export interface TombstoneMap {          // Y.Map<unknown> satisfies this without a cast
  get(key: string): unknown;
  set(key: string, value: unknown): unknown;
}

export function mergeTombstoneEntries(a: TombstoneEntry, b: TombstoneEntry): TombstoneEntry;
export function readTombstoneEntry(map: TombstoneMap, id: string): TombstoneEntry | undefined;
export function applyTombstoneOp(map: TombstoneMap, id: string, op: TombstoneEntry): TombstoneEntry;
export function isTombstoneSuppressed(entry: TombstoneEntry | undefined): boolean;
export function isTombstoneQuarantined(entry: TombstoneEntry | undefined): boolean;
```

Runtime namespace keys (what `Object.keys(import * as M)` returns):
`mergeTombstoneEntries`, `readTombstoneEntry`, `applyTombstoneOp`, `isTombstoneSuppressed`,
`isTombstoneQuarantined`.

**Naming constraints honoured** (enforced by TC6 and TC10's dynamic scans — a later WP adding a
name that matches any of these breaks the test rather than production):

- Only `isTombstoneSuppressed` matches `/suppress|isdeleted|isremoved|ishidden|shouldhide|shouldsuppress/i`.
- No export matches `/event|notify|emit|listener|subscribe|onchange/i` — this module has **no**
  notification side channel, for any transition.
- No export matches `/releasequarantine|unquarantine|revokequarantine|quarantinerelease/i` —
  releasing a quarantine is an ordinary `applyTombstoneOp` call.
- No mutating export beyond `applyTombstoneOp`; no `deleteRecord`, no `undo`.

---

## The suppression predicate, stated precisely

**For WP15 (tombstone view / reconcile), WP17 (serialiser) and WP19 (capture resurrect-blocking) —
import this, do not re-derive it.**

```ts
isTombstoneSuppressed(entry) === (entry !== undefined && entry.on === true)
```

Read as prose, exhaustively:

| Entry | `isTombstoneSuppressed` | `isTombstoneQuarantined` | Meaning for a consumer |
|---|---|---|---|
| `undefined` (no tombstone ever written) | `false` | `false` | Record is VISIBLE. This is the common case — most records never get an entry at all. |
| `{on: false, …}` (undone / released) | `false` | `false` | Record is VISIBLE. |
| `{on: false, q: true, …}` (released, `q` lingers) | `false` | `false` | Record is VISIBLE. A leftover `q` is **not** a permanent tag. |
| `{on: true, …}` (user delete) | `true` | `false` | Record is SUPPRESSED, by a user. |
| `{on: true, q: true, …}` (quarantine) | `true` | `true` | Record is SUPPRESSED, by the auditor. |

Consumer rules, so all three ask the same question the same way:

- **Reconcile (WP15)** — emit a record iff `!isTombstoneSuppressed(entry)`.
- **Serialisation (WP17)** — write a record to the `.canvas` file iff `!isTombstoneSuppressed(entry)`.
  AC2 of C12 is what forbids WP17 from writing its own "is this deleted" check.
- **Capture resurrect-blocking (WP19)** — block a local edit from resurrecting a record iff
  `isTombstoneSuppressed(entry)`.

Three hard rules for consumers:

1. **Never inline the check.** `entry?.on === true`, `!!entry && entry.on`, a local `isDeleted()` —
   all three are the "three copies" C12 AC2 exists to prevent. The rule already gained one case
   (quarantine) and WP25's GC will add another; inline spellings drift silently and every suite
   still passes.
2. **The predicate is `q`-agnostic on purpose.** A quarantine suppresses exactly as hard as a user
   delete. Do **not** write `entry.on && !entry.q` to "let quarantined records through" — that is a
   second suppression rule. Ask `isTombstoneQuarantined` separately if, and only if, you need to
   *explain* the suppression differently (e.g. a distinct status-console signature).
3. **Suppression is a property of the entry, not of the id.** Always re-read via
   `readTombstoneEntry`; never cache "this id is deleted".

---

## Merge rule, stated precisely

`mergeTombstoneEntries(a, b)` returns `max(a, b)` under this total order, compared field by field
in order, first difference decides:

```text
1. t   → strictly higher `t` WINS OUTRIGHT.
         `on`'s own value never overrides `t`; a delete has no privilege over an undo,
         and an undo has no privilege over a delete.
2. by  → on equal `t`, the GREATER `by` wins, under plain lexicographic string
         comparison (`a.by < b.by` on raw strings).
         NOT localeCompare (host ICU data), NOT a numeric reading of the id, and
         NOT Yjs's concurrent-write tie-break (that one is `random.uint32()`
         clientID and would converge differently on every run).
         Confirmed lexicographic by TC2's "aaa" / "aab" pair.
3. on  → unreachable unless `t` AND `by` are both equal (one client, two different
         ops at the same logical time — a correct caller never does this).
         `on:true` > `on:false`.
4. q   → same, `q:true` > absent/false.
```

Steps 3–4 exist so the order is **total**, not because the spec pins them: without them the merge
would have to "pick the first argument" on a full tie, which is not commutative. Because *every*
field participates, `rank(a, b) === 0` implies `a` and `b` are the same value — and "max over a
total order" is therefore:

- **commutative** — `merge(a, b) === merge(b, a)`; two replicas that saw the same two ops in
  opposite order agree (TC1, TC2, TC3),
- **associative** — grouping is irrelevant; three or more ops converge under every arrival
  permutation (TC4, three replicas × three orders),
- **idempotent** — merging an entry with an equal-valued copy of itself is a no-op, so a
  retransmitted op is harmless (TC3).

**Canonical result form.** The winner is returned as a fresh canonical object, never one of the
argument objects, so a caller cannot mutate stored state through a reference it handed in. `q` is
present **only** when it is `true`; an explicit `q: false` and an omitted `q` normalise to the same
stored shape. That is what makes an ordinary undo and a quarantine release produce byte-identical
key shapes (TC10) and prevents two replicas in identical semantic state from emitting a spurious
delta.

**Op vocabulary** — all four are the same `applyTombstoneOp` call:

| Operation | Payload |
|---|---|
| delete | `{ t, by, on: true }` |
| undo | `{ t, by, on: false }` |
| quarantine | `{ t, by, on: true, q: true }` |
| release quarantine | `{ t, by, on: false }` — identical in shape to an undo |

Because every one of them is merged rather than assigned, any of them can **lose**: a stale undo
after a fresher delete leaves the record suppressed; a stale release after a fresher quarantine
leaves it quarantined (TC8).

**Malformed stored values** read as `undefined` (= no tombstone = VISIBLE) rather than throwing —
an unreadable tombstone must never take a user's record away, and a throw inside a save path is not
recoverable (I5, degrade never break).

**`t` is Lamport, always.** The module never reads a clock and never invents a stamp. `Date.now()`
appears nowhere in the file. The caller (WP19, when it wires this in) owns advancing the counter.

---

## Visible Test Results

Command, run from `plugin/`:

```text
npx vitest run src/__tests__/v2/wp12/ --reporter=dot
```

```text
Test Files  10 passed (10)
     Tests  18 passed (18)
  Duration  588ms
```

| Test file | AC | Result |
|---|---|---|
| `test_tp01_higher_t_wins_visible.test.ts` | AC1 | PASS |
| `test_tp02_equal_t_by_tiebreak_visible.test.ts` | AC1 | PASS |
| `test_tp03_merge_commutative_idempotent_visible.test.ts` | AC1 | PASS |
| `test_tp04_replica_order_independent_convergence_visible.test.ts` | AC1 | PASS |
| `test_tp05_single_predicate_three_consumers_visible.test.ts` | AC2 | PASS |
| `test_tp06_no_duplicate_suppression_predicate_export_visible.test.ts` | AC2 | PASS |
| `test_tp07_lossless_undo_field_container_untouched_visible.test.ts` | AC3 | PASS |
| `test_tp08_stale_undo_does_not_override_later_delete_visible.test.ts` | AC3 | PASS |
| `test_tp09_quarantine_distinguishable_from_user_delete_visible.test.ts` | AC4 | PASS |
| `test_tp10_quarantine_release_no_visible_event_visible.test.ts` | AC4 | PASS |

Typecheck, run from `plugin/`:

```text
npx tsc -noEmit -skipLibCheck   →  clean, 0 errors
```

No errors were reported at all — including none under `src/__tests__/wp49/`. No new error was
introduced by this WP.

`npm test` (full suite) was **not** run, per instruction — Worker 3 runs it once at the end of the
batch. `npm run build` was not run.

---

## Summary for Worker 3

- **WP12 is DONE.** `plugin/src/canvas/canvas-tombstone.ts` created at exactly the contracted path;
  all 10 visible test files pass (18 tests); typecheck clean; no test touched; nothing outside
  scope modified.
- **The module is a pure core with zero imports** — the strictest form of the purity contract, same
  as `canvas-ord.ts`. `TombstoneMap` is structural, so `Y.Map<unknown>` satisfies it without a cast
  when WP19 wires it in.
- **Shared Ownership Contract §1 discharged.** WP12 is the single definition site for the `deleted`
  entry shape, its LWW merge and the suppression predicate. WP15 and WP17 must
  `import { isTombstoneSuppressed } from "./canvas-tombstone"` — the sections *"The suppression
  predicate, stated precisely"* and *"Merge rule, stated precisely"* above are written so they can
  consume it without re-deriving anything. Two dynamic export scans (TC6, TC10) will fail loudly if
  a later WP adds a competing predicate, an event channel or a dedicated release function.
- **Pinned decisions a later WP must not "improve":**
  - equal-`t` tiebreak is **plain lexicographic** `by`, greater wins — never numeric, never
    `localeCompare`, never Yjs's clientID arbitration;
  - `isTombstoneSuppressed` is **`q`-agnostic** — quarantine suppresses as hard as a delete;
  - `isTombstoneQuarantined` requires `on:true` **and** `q:true` — a lingering `q` on an `on:false`
    entry is not a quarantine;
  - `q` is stored **only when true**; that normalisation is what keeps undo and release
    key-shape-identical.
- **Deliberately NOT done (out of scope, per charter §2):** wiring into capture / reconcile /
  serialisation (WP19), the quarantine auditor's decision logic (WP20 — only the `q` flag mechanics
  are here), sidecar tombstone GC (WP25). The `TombstoneMap` seam intentionally exposes no
  `delete`, so WP25 will need to widen it deliberately rather than by accident.
- **Convergence-fuzzer link (charter §2, for WP23):** the `delete` / `undo` ops the fuzzer drives
  are `applyTombstoneOp` calls with `on:true` / `on:false`. The SEC assertion for
  delete-vs-edit and delete-vs-undelete should assert **cross-replica agreement**, not a hardcoded
  winner, except where `(t, by)` is fully determined — in which case the winner *is* pinnable,
  because this merge does not depend on Yjs's random clientID tie-break. TC4 is the template.
- **Nothing is blocked and nothing is left open for a second attempt.**
