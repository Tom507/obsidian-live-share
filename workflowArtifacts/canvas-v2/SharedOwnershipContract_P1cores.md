# Shared Ownership Contract — P1 cores (WP8–WP17)

> **Authority:** Worker 3 Core, batch 2 (P1 cores). This file is **binding on every sub-agent**
> working on WP8–WP17 and ranks below `BUILD_SPEC_CanvasV2.md` and the WP's own TaskCharter,
> but above any convention a sub-agent would otherwise choose for itself.
>
> **Why this file exists.** In an earlier batch two sub-agents independently picked *different*
> numbers for the same protocol constant, and **both test suites went green**. A constant that two
> work packages share must be defined in exactly one of them and imported by the other. Divergence
> here is not caught by tests — it is caught in production, expensively.

---

## 1. Module ownership — who defines what

Each row's **owner** creates the symbol. Every **consumer** must `import` it. A consumer that
re-declares an owned symbol — even with an identical value, even as a local `const`, even as an
inline string literal in a hot path — is violating this contract.

| Owned concept | Owner | Module (create at this exact path) | Consumers (import only) |
|---|---|---|---|
| V2 record field key names (`pos`, `size`, `from`, `to`, `ord`, `type`, `id`, …), the `V2Node` / `V2Edge` record types, the `pos`/`size` register types and their file↔doc codec | **WP9** | `plugin/src/canvas/canvas-registers.ts` | WP10, WP8, WP14, WP15, WP16, WP17 |
| `from`/`to` endpoint register type `{node, side, end?}` and its file↔doc codec (`fromNode`/`fromSide`/`fromEnd` + `to*`) | **WP10** | **append to** `plugin/src/canvas/canvas-registers.ts` | WP8, WP14, WP15, WP16, WP17 |
| The fractional-index **alphabet**, the allocator, the `ord` comparator, and the `(ord, id)` total-order comparator | **WP13** | `plugin/src/canvas/canvas-ord.ts` | WP8 (migration ord assignment), WP16, WP17 |
| `meta` container name, the `schemaVersion` key, `SUPPORTED_SCHEMA_MAJOR`, the version-gate predicate, the V1→V2 migration | **WP8** | `plugin/src/canvas/canvas-schema.ts` (+ wiring in `canvas-sync.ts`) | WP14 and any later WP needing the gate |
| The write-once `type` guard and its rejection signature | **WP11** | `plugin/src/canvas/canvas-type-guard.ts` | WP14 (composition), WP18 (later batch) |
| The `deleted` entry shape `{t, by, on, q?}`, its LWW merge, and **the single suppression predicate** | **WP12** | `plugin/src/canvas/canvas-tombstone.ts` | WP15 (tombstone view), WP17 (suppression) |
| Ingest validity rules and machine-readable reason codes | **WP14** | `plugin/src/canvas/canvas-ingest-schema.ts` | WP18 (later batch) |

**The two sharpest edges in this table, called out explicitly:**

1. **`ord` ordering is WP13's and only WP13's.** WP16 (`parseCanvas` order observation) and WP17
   (`(ord, id)` sort) both need to compare `ord` values, and WP8's migration needs to allocate them.
   All three **import WP13's comparator**. If WP16 sorts with `<` on raw strings while WP17 uses a
   comparator with different collation, both suites pass and replicas silently disagree on file
   byte order — which is precisely the property WP17 AC3 exists to guarantee.
2. **The tombstone suppression predicate is WP12's and only WP12's.** C12 AC2 requires it to
   suppress "in all three consumers … through one shared predicate, **not three copies**." WP17 AC2
   must call WP12's predicate, never re-implement "is this record deleted".

## 2. Value shapes — pinned by BUILD_SPEC §4.3, not open for design

These are copied from the spec so no sub-agent has to guess. Do not "improve" them.

| Field | Doc representation | File representation |
|---|---|---|
| `pos` | one LWW register, `[x, y]` (array as a **single** value) | `x`, `y` |
| `size` | one LWW register, `[w, h]` | `width`, `height` |
| `from` / `to` | one LWW register, `{node, side, end?}` | `fromNode`/`fromSide`/`fromEnd`, `toNode`/`toSide`/`toEnd` |
| `ord` | LWW register, fractional-index **string** | **never written to the file** |
| `deleted[id]` | `{t: lamport, by: clientID, on: boolean, q?: boolean}` | not written |
| `type` | write-once | `type` |

`GEOMETRY_KEYS` keeps exactly `{x, y, width, height}` and stays exported — it now describes the
**file** schema (BUILD_SPEC §3.1 S2). Changing its membership or removing its export is an ESCALATE.

## 3. Forward-compatibility constraints you must not contradict

- **P4 / `Y.Text` (Worker 2, escalation 5):** moving node `text` and edge `label` to a nested
  `Y.Text` stays **within schema major 2**, and reads must tolerate **both** the plain-string and the
  `Y.Text` shape. If WP8's migration or WP14's validator would make that impossible — e.g. by
  asserting `typeof text === "string"` as a hard validity condition, or by bumping the major — that
  is a `SPEC_CONTRADICTION`. **Escalate; do not improvise a compromise.**
- **P3 / mixed versions:** a client whose **major** differs from the doc's goes to
  Receive-and-Persist rather than guessing. P1 only needs the *local* half (capture disabled for
  that path, persistence continues). Do not build the room-level mode — that is WP32.
- **WP18–WP23 are a later batch.** Do not wire these cores into the write boundaries, do not build
  the quarantine auditor, do not remove the lock write-denial seam or `writeRecordMinimal` key
  deletion, and do not write the fuzzer. Land pure, independently testable cores plus the *minimum*
  integration your own ACs demand.

## 4. Test rules — non-negotiable

- **No WP in this batch is licensed to delete, skip, `.todo`, `.only`, comment out, weaken or relax
  a single existing test.** The licensed deleters for the whole initiative are **WP4, WP21, WP22,
  WP33 only** (BUILD_SPEC §7). The baseline bucket is **671** and the full suite is **926**. An
  unexplained count drop is a **failure**, not a cleanup.
  - If an existing test genuinely cannot survive a correct implementation, that is a
    **SPEC_CONTRADICTION → escalate**. Adjusting a test so it declares its precondition through a
    documented seam is acceptable *only* when no assertion is removed or relaxed.
- **Never assert on a value produced by concurrent same-key CRDT writes.** Yjs breaks those ties on
  `clientID`, which is `random.uint32()`, so such an assertion passes roughly half the time. An
  assertion on a specific value is legitimate **only** when that value has a single author or a
  causal predecessor chain. Concurrent same-key writes get **ordered** ("the result is one of the
  two submitted values, and all replicas agree"), never pinned to a specific one.
  - This is exactly how C9 AC2, C10 AC2 and C12 AC1 are worded — "converge to exactly **one of** the
    two submitted values … on every replica". Test them that way: assert cross-replica agreement and
    membership in the submitted set, not a hardcoded winner.
- **Never reason from two peers only.** Interleaving classes from three peers upward are distinct.
- **No wall-clock sleeps and no timing constants in new tests.** Delay must be structural (drain a
  pending queue), never temporal. The 33.5 s sleeper in `wp5/latency.test.ts` is legacy, not a
  pattern to copy.
- **State is the oracle; log signatures are for humans.** Do not assert on a log string as the
  primary oracle.

## 5. Runner facts — do not re-derive

- Run all plugin commands from `plugin/`, never the repo root.
- `npm test` = `vitest run`. Runner is **Vitest 4.0.18**; Vitest 4 **removed the `basic` reporter** —
  `--reporter=basic` fails with `ERR_LOAD_URL`. Use the default or `--reporter=dot`.
- Budget **≥90 s** for any automated `npm test`; ~41 s is the floor because of the legacy sleeper.
  A 40-second run is not a hang.
- `npx vitest run src/__tests__/v2` also matches `v2blind` by substring. **Always use the trailing
  slash:** `src/__tests__/v2/`.
- `npm run build` = `tsc -noEmit -skipLibCheck && node esbuild.config.mjs production`.
- Biome reports a whole-file `format` finding per touched file (a CRLF environment artifact).
  Advisory locally, **gating in CI**. Do not mass-reformat and do not run a repo-wide `lint --fix`.

## 6. Hard file boundary

Do not touch `server/`, `docker/`, `deploy/`, the built `plugin/main.js`, `manifest.json` or
`package.json`. `plugin/src/canvas/canvas-presence.ts` is frozen. `canvas-binding.ts` and
`canvas-model-bridge.ts` stay frozen. `plugin/src/main.ts` may hold wiring only, never logic.
Do not bump the plugin version.
