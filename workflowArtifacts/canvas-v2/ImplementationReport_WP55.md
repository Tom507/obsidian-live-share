# Implementation Report — WP55: Blind-set execution integrity

**Status:** DONE · **Changed file:** `workflowArtifacts/canvas-v2/_run_blind.py` (rewritten)
**New tooling:** `_sweep_blind.py` (WP56/WP57 driver), `_gen_ledger.py`, `_run_visible.py`
**Records:** `_blind_records/*.json` + `_blind_records/index.jsonl`

---

## 1. The structural guarantee

`PASS` is assigned in exactly one function, `_finish()`, and only when a **structured reporter
artefact** reports a non-zero collected count with zero failures. Everything else is a named
failure. A process exit code of 0 is never by itself accepted as evidence.

Named failure reasons: `ZERO_COLLECTION`, `IMPORT_UNRESOLVED`, `NON_NORMALISABLE`,
`NO_STRUCTURED_OUTPUT`, `NO_SUCH_SET`, `RUNNER_ERROR`, `FAIL`.

Counts come from `vitest --reporter=json --outputFile=<abs>` and `pytest --junit-xml=<abs>`.
No count is parsed from reporter prose. If the structured file is missing or unparseable, that
is `NO_STRUCTURED_OUTPUT` — a hard failure, not an absence of problems.

---

## 2. How each of the three defect classes is now closed

### Defect 1 — filename glob

**Before:** filenames copied verbatim; `test_foo_blind1.ts` matches no vitest glob.
**Now:** `normalise_ts_name()` inserts `.test` before the extension when the name does not
already match `\.(test|spec)\.[cm]?[jt]sx?$`. Normalisation is **name-only and enforced, not
promised**: every staged copy is sha256-compared against its source and a mismatch aborts the
run. Files under `tests/blind_set*/` are never written to. A file that cannot be made
discoverable is named individually under `NON_NORMALISABLE` and fails the run rather than being
silently excluded.

Files requiring renaming, measured: WP41 8+8, WP42 7+7, WP46-TS 4+4 = **38**.

> **Correction to the charter and to workflow memory.** §3 of this charter, and the
> corresponding workflow-memory entry, state **46** files project-wide. The correct figure is
> **38** (16 + 14 + 8). The three affected sets and their per-set file counts in the charter are
> right; only the sum is wrong.

### Defect 2 — staging depth is a per-set property

**Before:** depth hardcoded at 3 levels below `<pkg>/src`.
**Now:** `derive_placement()` searches candidate `(package, depth)` pairs and selects the one
where **every** relative import specifier resolves to a file that exists on disk. This is a
filesystem search, not a heuristic, and the distinction matters:

- **WP5 mixes depths** — `../../../canvas/…` *and* `../../harness/canvas-double`. A max-depth or
  min-depth rule picks wrong. Only depth 3 satisfies both, because `../../harness/…` then
  resolves to the real `plugin/src/__tests__/harness/`. A set can therefore constrain the path
  *components*, not just the depth, which is why the staged path keeps `__tests__` as its first
  component.
- Depth-5 specifiers (WP10/13/16, `../../../../../plugin/src/…`) are repo-root-relative and also
  satisfied at depth 3 — correctly derived rather than special-cased.

Derived placements (all 40 TS set-instances, verified against a hand-computed table):

| Sets | Package | Depth |
|---|---|---|
| WP1–WP5, WP8–WP16 | plugin | 3 |
| WP44 (TS) | plugin | 3 |
| WP46, WP47, WP49 (TS) | plugin | **2** |
| WP42 | plugin | **2** |
| WP41 | **server** | **2** |

**The sets that worked before still work: WP1–WP16 remain at depth 3 and were not disturbed.**

> **Second finding beyond the three declared classes.** **WP47 and WP49's TypeScript halves need
> depth 2**, which the old runner never used. Their files are named `*.test.ts`, so they *were*
> discoverable — but their imports could not resolve at depth 3. They were broken by defect 2
> alone, independently of defect 1. The charter lists WP44 and WP47 as the depth-affected TS
> sets; WP44 is in fact at depth 3 (unaffected) and **WP49** is affected and unlisted.

### Defect 3 — hardcoded `plugin/` target

**Before:** `PLUGIN = REPO / "plugin"`, always.
**Now:** the package is an output of the same resolution search. WP41 resolves uniquely to
`server` (its `../../mux-protocol.js` and `../../persistence.js` match `server/src/*.ts` and
nothing under `plugin/`), and is run against `server/`'s own vitest project. A `.js` specifier is
mapped to its `.ts` source during resolution.

An import that resolves nowhere is `IMPORT_UNRESOLVED`, naming the specifier — never a
collection error reported as a pass, never a silent zero-collection.

### AC4 — Python path and cleanup

The Python sets are run **in place**, and this is a deliberate correction to the charter's
staging model. 60 of the 124 Python blind files locate the repo with
`Path(__file__).resolve().parents[5] / "tools"`, which is correct **only at their authored
path**; staging them anywhere else silently breaks that resolution. They are already named
`test_*.py`, which *is* pytest's discovery pattern, so neither reason staging exists for
TypeScript applies. pytest is invoked from the repo root (never the workspace root, which aborts
collection on the dangling `FinaleAbgabe` junction). The same `ZERO_COLLECTION` rule applies.

Cleanup is unchanged in strength and stronger in reach: a `finally` block removes **all four**
possible staging roots (two shapes × two packages) after every run, on success, failure and
interrupt, and `main()` re-asserts their absence and returns 99 if any survives.

The runner is now encoding-safe on its own (`reconfigure(encoding="utf-8")` on stdout/stderr,
`PYTHONIOENCODING=utf-8` in the child env), so it can no longer die with `UnicodeEncodeError`
while reporting a failure.

---

## 3. Falsification — the acceptance criterion that cannot be met by inspection

`python _run_blind.py --selftest`, verbatim:

```
======================================================================
WP55 FALSIFICATION: a set that executes nothing must not report PASS
======================================================================

[1] nonexistent set WP99999      -> NO_SUCH_SET: no such set on disk: ...\tests\blind_set1\WP99999

[2] unresolvable-import set      -> IMPORT_UNRESOLVED: no (package, depth) placement resolves
    every relative import. Best candidate plugin/depth2 left unresolved:
    ../../this/module/does/not/exist

[3] control set (should PASS >0) -> PASS: collected=1

[4] staging dirs after all runs  -> all absent

======================================================================
FALSIFICATION RESULT: PASS - a non-executed set cannot report green
======================================================================
```

Leg [3] is the one that makes the other legs mean something: **a runner that fails every set is
as useless as one that passes every set.** The control set is byte-identical to the leg-[2]
fixture except that its import resolves, and it runs and passes with a recorded count of 1.

---

## 4. Before / after on a set that previously could not execute

**Before** — the original runner (recoverable via
`git show HEAD:workflowArtifacts/canvas-v2/_run_blind.py`) against WP42 `set1`:

```
== WP42 blind_set1  (exit 1)
 RUN  v4.0.18 .../plugin
No test files found, exiting with code 1
filter:  src/__tests__/v2blind/wp42_set1/
include: **/*.{test,spec}.?(c|m)[jt]s?(x)
```

**After** — the repaired runner, same set:

```
== WP42 blind_set1 [vitest] -> PASS
   package/depth : plugin / 2
   files staged  : 7
   collected     : 28
   passed/failed : 28 / 0
   reason        : 28 of 28 tests passed
```

### A correction that matters more than the fix

The premise recorded in the charter's defect table and in workflow memory is that a
non-discoverable set **"exits 0"** and is therefore "reported as a pass". **That does not
reproduce.** Vitest 4.0.18 exits **1** on zero discovery, and neither `plugin/vitest.config.ts`
nor `server/vitest.config.ts` sets `passWithNoTests`. The old runner propagated that exit code,
so a non-discoverable set surfaced as a **loud red**, not a silent green.

This matters for two reasons, and it cuts both ways:

1. The three defects are **real as causes** — those sets genuinely could not execute, and the
   repair is necessary and correct. Nothing here weakens the case for WP55.
2. But the *mechanism of concealment* was mis-stated, and that changes what WP57 had to explain.
   If the committed runner went loudly red on WP41/WP42, then B8/P6's green for those sets cannot
   have come from it — which is precisely the thread WP57 pulled. See
   `ImplementationReport_WP57.md`.

Independently of which premise was right, the repaired runner no longer *depends* on the exit
code: zero collection is a hard failure whether the framework exits 0, 1, or anything else.

---

## 5. Scope discipline

- No file under `tests/blind_set1/` or `tests/blind_set2/` was edited, renamed in place or
  deleted. Normalisation happens on the staged copy and is sha256-verified byte-identical.
- `vitest.config.ts` was not widened, in either package.
- `tests/blind_set2/WP47/test_tp04_teardown_exit_paths_blind2.py` was left defective and
  unmodified, as instructed.
- No product code, no visible test and no test assertion was touched by this WP.
- `plugin/src/canvas/**` and `plugin/src/files/**` were not touched (batch B2 is live there).
