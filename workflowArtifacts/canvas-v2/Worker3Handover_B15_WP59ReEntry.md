# Worker 3 Handover — Canvas V2, batch B15 (WP59 re-entry)

**Batch:** B15 · **Phase:** VI (Phase 7 re-entry — does not consume attempts) · **Scope:** WP59 only
**Date:** 2026-08-02 · **Returns:** `HANDOVER_READY`

> **WP59's DoD is now met.** Worker 2 extended the licence to the two `edges.bare` pins B13
> escalated; both are amended, both falsified, both sets re-measured green. **WP64 and WP65 were
> out of scope and were not touched.**

---

## Scope of This Run

| Task | Status |
|---|---|
| WP59 — the two `edges.bare` pins, one per WP3 blind set | **DONE** |
| Re-measure both WP3 sets + update `BlindVerificationLedger.md` | **DONE** |
| WP64, WP65 | **not in scope** — separately chartered, untouched |

**Production source touched: NONE.** `canvas-registers.ts` was perturbed twice for falsification
and restored **byte-clean, sha256 verified** against its pre-run hash. Nothing under `server/`,
`docker/`, `deploy/`, `plugin/main.js`, `manifest.json` or `package.json` was opened.

## Risk Summary

| WP | Status | risk_flag | Priority for W4 |
|---|---|---|---|
| WP59 | DONE | NONE | NORMAL (W4 Test Targets: `0`) |

---

## The one thing to read if you read nothing else

**The charter's named falsification was not sufficient, and the reason is B13's own lesson
recurring one level down.**

C59 §6 prescribes one perturbation: make `decodeEndpointToFile` emit `fields[keys.side] = ""`
unconditionally. It does redden both amended tests. But in **set2** it reddens the test at the
**`:98` assertion — B13's own amendment from the previous batch — which sits earlier in the same
test body and therefore masks the site I was sent to falsify.** Passing that off as falsification
would have recorded "this pin bites" on evidence that never reached the pin.

A second, narrower perturbation (emit `""` **only** when `side` is absent, leaving `full`'s real
side intact) isolates it: set2 goes red at exactly my amended assertion, 44/45. Both perturbations
are reported below and both are in the §7 ledger rows.

**A masked assertion is not a falsified assertion** — the same trap B13 named for *passing*
assertions applies just as well to *failing* ones. When a site sits behind another assertion in
the same test body, one perturbation cannot prove it bites.

---

## The two amended sites

### Site 1 — `blind_set1/WP3/test_file_shape_tabs_blind1.test.ts:79`

Test: `"stays readable by the unchanged parseCanvas, including edge-only content"`

- **Before:** `expect(parsed.edges["e-only"].fromNode).toBe("ghost-a");`
- **After:** read through the sanctioned inverse, plus two added pins:

```ts
const flat = decodeCanvasDataToFlat(parsed);

expect(Object.keys(parsed.nodes)).toEqual([]);
expect(Object.keys(parsed.edges)).toEqual(["e-only"]);
expect(flat.edges["e-only"].fromNode).toBe("ghost-a");
expect(Object.keys(flat.edges["e-only"]).sort()).toEqual(["fromNode", "id", "toNode"]);
expect(decodeEndpointToFile("from", parsed.edges["e-only"].from)).toEqual({
  fromNode: "ghost-a",
});
```

- **Why stale, not a defect:** WP10 AC5 made a side-less `{fromNode}` a **whole** endpoint
  register — `*Node` alone decides presence — so a bare edge reads `{from, id, to}`. The
  assertion previously passed **only because `toV2Edge` keeps an edge's flat keys when the
  endpoint register fails to build**: pre-AC5 a side-less endpoint failed to build, so `fromNode`
  survived. **The green was produced by the very defect AC5 exists to fix** — a fully-connected
  edge read as not-an-endpoint and written out of the user's `.canvas`. The file bytes are
  identical either way.
- **Strictness after:** rises. The single-field `toBe` is kept verbatim and joined by (a) an exact
  whole-collection `toEqual` over the bare edge's full flat key set and (b) an exact whole-object
  `toEqual` pinning that the side-less endpoint decodes to `{fromNode}` and **no** `*Side`/`*End`
  key — AC5's actual contract, which nothing pinned here before. Test count 5 → 5. Two imports
  added (`decodeCanvasDataToFlat`, `decodeEndpointToFile`).

### Site 2 — `blind_set2/WP3/test_value_preservation_blind2.test.ts:103`

Test: `"preserves an edge's optional fields and adds none"`
*(B13's handover called this `:79`; that was pre-amendment numbering — WP59's comment blocks
shifted it, and no separate `:79` site remains in set2.)*

- **Before:** `expect(Object.keys(parsed.edges.bare).sort()).toEqual(["fromNode", "id", "toNode"]);`
- **After:**

```ts
expect(Object.keys(flat.edges.bare).sort()).toEqual(["fromNode", "id", "toNode"]);
expect(decodeEndpointToFile("from", parsed.edges.bare.from)).toEqual({ fromNode: "a" });
```

- **Why stale, not a defect:** identical cause. This was also **the last site in the file still
  reading `parsed`** while its sibling at `:89`/`:91` already read `flat`.
- **Strictness after:** rises. The three-key `toEqual` is kept **verbatim** — only the subject
  moves from `parsed` to the already-bound `flat`, so **no new import and no new binding were
  needed**, exactly as the charter predicted. The added `decodeEndpointToFile` pin catches an
  implementation re-emitting `fromSide: null` or `fromSide: ""`, which would satisfy the key-set
  check but silently rewrite every side-less file on its first write. Test count 4 → 4.

No `toMatchObject`, `objectContaining`, `arrayContaining`, subset match, key-count/`toHaveLength`
softening, `skip`/`only`/`todo`, or destructuring in either file — audited by grep over both.

---

## Falsification verdict — performed, not asserted

| # | Perturbation | set1 | set2 | `wp17` TP13 |
|---|---|---|---|---|
| **A** | `decodeEndpointToFile` emits `fields[keys.side] = ""` **unconditionally** (the charter's named one) | **RED 55/56** at the new pin *directly and alone*: `expected { fromNode: 'ghost-a', fromSide: '' } to deeply equal { fromNode: 'ghost-a' }` | **RED 44/45**, but at `:98` — **masks** the amended site | **RED, 4 of 5 tests fail**, incl. the byte-identity pin |
| **B** | `""` emitted **only when `side` is absent** (isolating perturbation, mine) | — | **RED 44/45** at exactly the amended pin: `expected [ 'fromNode', 'fromSide', 'id', …(2) ] to deeply equal [ 'fromNode', 'id', 'toNode' ]` | — |

**`wp17` TP13's behaviour — the escalation condition was NOT triggered.** Under perturbation A,
`test_tp13_sideless_edge_file_byte_identical_round_trip_visible.test.ts` goes **red, 4 of 5**,
failing on the byte-identity assertion (`expect(once).toBe(FIXTURE)`) with the diff showing
`"toSide": ""` and a spurious `"fromSide": ""` injected into the serialized file. **TP13 detects
its own subject**, so the empirical basis of Worker 2's ruling holds and I proceeded. After
restore it is **green 5/5** again.

**Restore verified by hash, not by assertion:**

```
canvas/canvas-registers.ts  553c846442d99127725dab7bda84ae65ed3ad677283bdc7cbba0ebe763d8b748
files/canvas-sync.ts        b259085539b94f97deb1d7a5b9dc43ba7b22fc6972dd3fceca50b281cb880438
canvas/canvas-canonical.ts  f9945674100f52a7e949d682301055c3bf2302727f18fa4d2bf501f411a9b644
```

All three byte-identical to their pre-run values; `canvas-registers.ts` and `canvas-sync.ts` also
match the hashes B13 recorded, confirming no drift between the two batches.

---

## Re-measured counts — verbatim from `_blind_records/*.json`

Read from the JSON records, not from console prose. Staging depth derived per set by the runner
(both depth 3), not hardcoded.

| WP | Set | Files staged | Collected | Pass | Fail | Verdict |
|---|---|---|---|---|---|---|
| WP3 | set1 | 10 | **56** | 56 | 0 | **PASS → CONFIRMED** |
| WP3 | set2 | 10 | **45** | 45 | 0 | **PASS → CONFIRMED** |

Collected counts **unmoved** (56 and 45, same as the failing measurements). No `ZERO_COLLECTION`.
Runner reported `no v2blind staging dirs present` after every run.

---

## Ledger tally

| | Before B15 | After B15 |
|---|---|---|
| Rows | 58 | **58** |
| CONFIRMED | 56 | **58** |
| DIVERGENT | 2 | **0** |
| VACUOUS | 0 | 0 |
| UNRUNNABLE | 0 | 0 |

**This is the expected 58 / 58 / 0.** No row was added or removed — two verdicts changed.

### Provenance, per the new §7 standing rule

Both rows I touched are written as **measurements, not timeless facts**: each names *who* measured
it (B15), *when* (2026-08-02), *what tree state* (production byte-identical to the recorded
hashes), and that the verdict was falsified before being recorded. The top-of-file worked example
now carries a note that B15's own green is subject to the same rule.

**I did not build `measured_at` / `tree_rev` tooling** — that is WP65's job and it is out of my
scope. The provenance above is prose in the rows, not machine-readable fields, and it does not
close the root gap B13 identified: `_blind_records/*.json` still carries no timestamp and no tree
revision, and every re-run overwrites it.

### Coverage boundary — unchanged from B13, and still not a pass

Rows cover **26 of 31** folders per set. Still uncovered: `WP19` (deliberate), `WP20`–`WP23`.
Absence of a row is not readable as a pass.

---

## Tree state at handover

| Gate | Result |
|---|---|
| `tsc --noEmit` (plugin) | **clean, exit 0** — measured with no blind run in flight |
| WP3 blind sets | **both PASS**, 56/56/0 and 45/45/0 |
| `wp17` TP13 | **green 5/5** after restore |
| Staging hygiene | clean — `no v2blind staging dirs present` after every run |
| Production source | byte-identical to baseline, sha256 verified |
| Test counts in touched files | set1 5 → 5, set2 4 → 4 |

### B14's edits and the 8 WP19 reds are FOREIGN — not B15's

Batch B14 was live throughout this run applying the WP19 amendments. Its in-flight edits appear in
`git status` and I stayed out of every one of them:

`plugin/src/__tests__/canvas-sync.test.ts` · `w4-canvas-integrity.test.ts` ·
`v2/wp6/chaos_degraded_adapter.test.ts` · `v2/wp5v2/` · `v2/wp4/` · `v2/wp18/`

**I did not run the full plugin suite**, deliberately: with B14 mid-edit in those files, a suite
count would conflate its in-flight state with mine and would not be a meaningful measurement of
either. **B14's 8 WP19 delete-oracle reds are not folded into any count in this handover**, and
none of them is in a blind set or in WP3. My own measurement surface is the two WP3 blind sets and
`tsc`, both reported above.

The `wp5/latency.test.ts` RTT-band intermittent B13 flagged is also still outstanding and is not
mine.

---

## Note for Worker 4

**W4 Test Targets: `0`.** WP59 produces no runtime behaviour — it amends unit-level blind test
expectations and documentation artefacts. There is nothing to observe in a running system.

**Staging hygiene:** a `v2blind` / `_blind[12]` path in a build error is a transient staging
artefact of a concurrent blind run — re-check before diagnosing. It is never a build failure.

## Summary for Worker 4 Entry Point

Nothing new is observable at runtime. The verifiable outputs are:

- `python workflowArtifacts/canvas-v2/_run_blind.py WP3 both` → **PASS**, 56 and 45 collected
- `npx vitest run src/__tests__/v2/wp17/test_tp13_sideless_edge_file_byte_identical_round_trip_visible.test.ts`
  → 5/5 green
- `BlindVerificationLedger.md` — 58 rows, 58 CONFIRMED, 0 DIVERGENT; the coverage claim
  (31 folders, 62 pairs, 26 covered, 5 named uncovered) checks against a directory listing
- `BUILD_SPEC_CanvasV2.md` §7 — the two `WP59 (bare edge)` rows now carry falsification evidence
