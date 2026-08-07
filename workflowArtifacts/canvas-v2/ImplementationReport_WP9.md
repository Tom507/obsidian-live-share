# Implementation Report — WP9
Attempt: 1

## Status: DONE

## Completed Work
| AC | Status | Notes |
|---|---|---|
| AC1 — `pos`/`size` round-trip losslessly to/from the file representation for integer geometry | DONE | `encodePos`/`decodePos` and `encodeSize`/`decodeSize` are exact for integer input; the same round trip also verified through a real `Y.Map` record via `writePos`/`readPos`. |
| AC2 — two concurrent moves converge to exactly one submitted position, never a mixture | DONE | A position is stored as **one** value under **one** key (`pos = [x, y]`), so Yjs's same-key tiebreak selects a whole author's pair. There is no `writeX`/`writeY` in the API, so a torn write cannot be expressed at all. |
| AC3 — concurrent move and resize survive independently | DONE | `pos` and `size` are separate keys, so move ⊥ resize commutes; both single-author registers land on all three replicas. |
| AC4 — `GEOMETRY_KEYS` keeps exactly `{x, y, width, height}` and stays exported | DONE | `canvas-sync.ts` untouched. The register module deliberately exports **no** `GEOMETRY_KEYS` and declares no mirror set of its own; its decode output emits exactly those four keys. |

## Blocked Items
| Item | Blocker | Workaround attempted |
|---|---|---|
| — | — | — |

## Tools Created (by Worker 3 this attempt)
| Tool | Type | Purpose |
|---|---|---|
| — | — | — |

## Changes Made
- **Created:** `plugin/src/canvas/canvas-registers.ts` — the whole work package. Zero-import pure core (no Obsidian, no filesystem, no clock, **no Yjs**), organised in three clearly separated parts: A = V2 record vocabulary (field key names + record types), B = pure file↔doc codec, C = doc accessors reaching the record through a structural `V2RecordMap` interface that `Y.Map<unknown>` satisfies as-is.
- **Not changed:** `plugin/src/files/canvas-sync.ts`. The charter listed it under "required changed files (type shapes only)", but the V2 record shape types are owned by this module per the Shared Ownership Contract §1, and `GEOMETRY_KEYS` is an ESCALATE-level invariant. No edit was needed to satisfy any AC, and rule 10 (land a pure core, minimum integration) argues against a cosmetic one.
- No wiring into write boundaries, parser or serializer (WP16/WP17/WP18). Nothing outside `plugin/src/canvas/` touched. Version not bumped; `plugin/main.js` not rebuilt (see Full-suite result).

## Exported API surface (for the WPs that will import this module)

All from `plugin/src/canvas/canvas-registers.ts`.

**Vocabulary (WP8, WP10, WP14, WP15, WP16, WP17 — import, never re-declare):**
```ts
const V2_FIELD: {                       // the single definition site for V2 doc field key names
  id, type, pos, size, from, to, ord,
  text, label, file, subpath, url, color, background, backgroundStyle
}                                       // all `as const`
type V2FieldKey = (typeof V2_FIELD)[keyof typeof V2_FIELD]
const POS_KEY: "pos"
const SIZE_KEY: "size"
const V2_NODE_FIELD_KEYS: readonly V2FieldKey[]
const V2_EDGE_FIELD_KEYS: readonly V2FieldKey[]

type PosRegister  = readonly [x: number, y: number]
type SizeRegister = readonly [width: number, height: number]
interface FilePos  { x: number; y: number }
interface FileSize { width: number; height: number }

interface V2Node { id, type, pos: PosRegister, size: SizeRegister,
                   ord?, color?, file?, subpath?, url?, text?, label?,
                   background?, backgroundStyle? }
interface V2Edge<TEndpoint = unknown> { id, from: TEndpoint, to: TEndpoint, ord?, color?, label? }
```

> **Seam for WP10:** `V2Edge` is generic over the endpoint value type with default `unknown`.
> WP10 owns `{node, side, end?}`; it appends its `EndpointRegister` type to this file and
> consumers then instantiate `V2Edge<EndpointRegister>`. WP9 does not re-declare that shape.
> The `from`/`to` **key names** are already here in `V2_FIELD`.

**Pure codec (no doc required):**
```ts
function encodePos(x: number, y: number): PosRegister          // rounds to whole px, -0 → 0, frozen
function encodeSize(width: number, height: number): SizeRegister
function decodePos(pos: PosRegister): FilePos                  // → { x, y }
function decodeSize(size: SizeRegister): FileSize              // → { width, height }
function isPosRegister(value: unknown): value is PosRegister   // whole 2-tuple of finite numbers
function isSizeRegister(value: unknown): value is SizeRegister
function asPosRegister(value: unknown): PosRegister | undefined
function asSizeRegister(value: unknown): SizeRegister | undefined
function posEquals(a: PosRegister, b: PosRegister): boolean    // whole-value, Object.is
function sizeEquals(a: SizeRegister, b: SizeRegister): boolean
```

**Doc accessors:**
```ts
interface V2RecordMap { get(key: string): unknown; set(key: string, value: unknown): unknown }
                                          // `Y.Map<unknown>` satisfies this with no cast

function readPosRegister(record: V2RecordMap): PosRegister | undefined
function readSizeRegister(record: V2RecordMap): SizeRegister | undefined
function readPos(record: V2RecordMap): FilePos | undefined      // file shape { x, y }
function readSize(record: V2RecordMap): FileSize | undefined    // file shape { width, height }
function writePosRegister(record: V2RecordMap, pos: PosRegister): void
function writeSizeRegister(record: V2RecordMap, size: SizeRegister): void
function writePos(record: V2RecordMap, x: number, y: number): void
function writeSize(record: V2RecordMap, width: number, height: number): void
```

Design decisions consumers should know about:

- **There is no `writeX` / `writeY` / per-coordinate comparison, and there never will be.** Offering one would reintroduce the tearing this component exists to make unrepresentable.
- **`encodePos`/`encodeSize` round finite input to whole pixels** (BUILD_SPEC §4.4, and C9's "rounding integration"). It is idempotent, so a caller that already rounded via `roundCanvasGeometry` (`canvas-canonical.ts`) sees no change; a caller that forgot cannot put sub-pixel geometry into the doc. Non-finite values pass through unmangled and are then rejected at the read boundary.
- **Register values are frozen arrays.** Patching one coordinate of a value held in the doc throws instead of silently tearing.
- **Reads are whole-or-nothing.** A malformed value (`[1]`, `[NaN, 3]`, `{x,y}`, a bare number) yields `undefined`, never a half-read register.
- **No `delete` in the API** — a register is replaced, never removed (I7).

## Visible Test Results
| Test | Status | Notes |
|---|---|---|
| `wp9/test_tp01_lossless_roundtrip_visible.test.ts` (3 tests) | PASS | Pure codec + real `Y.Map` write/read cycle over zero/positive/negative cases. |
| `wp9/test_tp02_concurrent_move_convergence_visible.test.ts` (1 test) | PASS | 3 replicas, 2 concurrent authors, full-mesh merge; agreement + membership + both torn combinations ruled out. |
| `wp9/test_tp03_move_resize_independence_visible.test.ts` (1 test) | PASS | 3 replicas, sole `pos` author and sole `size` author; both land everywhere. |
| `wp9/test_tp04_geometry_keys_pin_visible.test.ts` (3 tests) | PASS | `GEOMETRY_KEYS` intact after import; decode output keys == `GEOMETRY_KEYS`; module exports no competing `GEOMETRY_KEYS`. |

`npx vitest run src/__tests__/v2/wp9/ --reporter=dot` → **4 files / 8 tests / 8 passed / 0 failed** (0.5 s).

## Full-suite result
`npm test` from `plugin/` → **85 test files / 934 tests / 934 passed / 0 failed**, 43.6 s (the legacy 33.5 s `wp5/latency.test.ts` sleeper dominates).

Baseline was **81 files / 926 tests, 0 failed**. The delta is exactly the four WP9 visible files and their eight tests (81 + 4 = 85, 926 + 8 = 934). **No existing test was deleted, skipped, `.todo`'d, `.only`'d, commented out, weakened or relaxed.**

`npx tsc -noEmit -skipLibCheck` from `plugin/` → clean, exit 0.

> `npm run build` was **not** run end to end. Its first half (`tsc -noEmit -skipLibCheck`) is green as reported above; its second half (`node esbuild.config.mjs production`) rewrites the committed `plugin/main.js`, which this work package is explicitly forbidden to touch. Nothing in this WP is reachable from the bundle entry point yet (the module has no importer), so the bundle cannot have changed.

## Summary for Worker 3

`plugin/src/canvas/canvas-registers.ts` now exists and is the shared V2 vocabulary the rest of P1 will import: field key names, `V2Node`/`V2Edge`, the `pos`/`size` register types, and the file↔doc codec. What is observable today is the register semantics themselves — trigger them with `npx vitest run src/__tests__/v2/wp9/ --reporter=dot` from `plugin/`, which exercises the pure codec and three-replica Yjs merges in memory. Nothing is wired: no parser, serializer, shadow or write boundary imports the module yet, so the plugin's runtime behaviour is byte-identical to before this WP and the full suite is unchanged apart from the four new files. Two things worth flagging for the next sub-agents rather than hiding in the diff. **First**, `V2Edge` is generic over its endpoint type with default `unknown` — that is the deliberate seam for WP10, which owns `{node, side, end?}`; the alternative was for WP9 to inline a shape the ownership contract assigns to WP10, which the contract forbids explicitly. **Second**, `encodePos`/`encodeSize` round to whole pixels. BUILD_SPEC §4.4 says rounding happens "before the register write" while C9's own interface list says the component provides "rounding integration"; I read those together as "the encode step is that boundary", and made it idempotent so it can never conflict with a caller that already rounded through `roundCanvasGeometry`. If Worker 3 or WP17 intends the register to store fractional geometry faithfully instead, that is the one decision here worth revisiting, and it is a two-line change confined to `normalizeGeometryScalar`. The charter also listed `plugin/src/files/canvas-sync.ts` as a required changed file "type shapes only"; it was left untouched, because the V2 record types live in the module the ownership contract assigns them to and no AC required an edit there.
