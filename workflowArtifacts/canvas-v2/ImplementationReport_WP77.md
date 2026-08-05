# Implementation Report — WP77: the borrowed `data.json` is unrenderable by type

**WP:** WP77 · **Charter:** `TaskCharter_WP77_UnrenderableBorrowedSettings.md` (`SPEC_COMPLETE`)
**Repo / branch:** `obsidian-live-share` · `fix-bugs-and-raceconditions`
**Batch:** B17 (Worker 3, autonomous mode) · **Date:** 2026-08-05
**Status:** `DONE` · **risk_flag:** `NONE`
**Batch baseline commit (the "pre-repair" reference used throughout):** `02aef92d251ac7a5fd6a764fd4204331dc934973`
**Implementation commit:** `20d45ee`

> **Workflow note.** The owner discontinued blind test sets, ledger rows and falsification
> injections on 2026-08-05 (*"keine blackbox tests mehr"*). This WP therefore delivers a
> **visible suite only** — no `blind_set1`/`blind_set2`, no `BlindVerificationLedger` row.
> The charter's AC5 "falsification" is retained in the form that is still honest and still
> cheap here: **every absence assertion is paired, in the same test, with a positive
> control, and every vector is additionally run against a byte copy of the pre-repair code
> so the vector is proved to fire.** WP77 is a type-level guarantee about `repr` — there is
> nothing about it a live editor could show that a unit test cannot, which is why ordinary
> tests are the right instrument for this WP specifically.

---

## 0. Data safety — stated first, because it is the subject

- **No value from either owner vault was read, printed, hashed into this report, or placed in a fixture.** Neither `H:\Developement\_NeuralAngels\ObsidianOrga` nor `…\ObsidianOrga - Kopie` was opened, listed, hashed, or pointed at by any test, script or command in this WP. Both are named only in `OWNER_VAULTS` guards that *assert a fixture is not one of them*.
- **Every sentinel is a synthetic literal** of the form `SENTINEL-WP77-<KEY>-DO-NOT-LEAK`. Key *names* (`encryptionPassphrase`, `encryptionSalt`, `jwt`, `serverPassword`, `token`) are public repository content — they are in `constants.py` and in the workspace docs. No key name is ever paired with a real value, here or anywhere this WP produced.
- **No secret passed through an agent tool**, a command string, a script argument or a commit message.
- **No live Obsidian instance, no real vault and no gate result is involved or claimed.** Nothing here was verified against one and nothing needs to be: the whole verification is in-process, against synthetic fixtures under `tmp_path`. No process was spawned by the package, no relay started, no socket opened. `test_i6` asserts this structurally over this WP's own test sources.

---

## 1. What was built, per AC

### AC1 — the borrowed bytes are held in a value that refuses to render, by type

`ports.BorrowState.original_bytes` is now `Optional[Secret]`. A frozen-dataclass
`__post_init__` normalises incoming `bytes` into the wrapper; `None` stays `None`, so
"the owner had no settings file" remains a plain fact about the vault and every `is None`
test in the module keeps working unchanged. `reveal_original_bytes()` is the sole
accessor, written at each of the four legitimate call sites.

The type is **WP70's `Secret`, reused, not re-derived**. It was *relocated* (§2 below);
its body is a **byte-identical copy** of WP70's — verified by diffing the class text
against `git show 02aef92:tools/obsidian_e2e/relay.py` (4502 chars, identical). There is
exactly **one** `class Secret` and one `class RedactedMapping` in the package;
`test_t10` re-derives that from the source files rather than asserting it.

**The repair is deliberately NOT a handwritten `__repr__`.** `BorrowState` still carries
the dataclass-*generated* repr (`__dataclass_params__.repr is True`, and the repr function
is `reprlib.recursive_repr`-wrapped with `co_filename` ending in `dataclasses.py`), and
that generated repr is safe because of what the *field* is. `test_t9` asserts exactly this,
and contrasts it against `provisioning._CommunityState.__repr__`, which has neither
property — the landed handwritten repair that §3 Verification 3 measured as insufficient.

### AC2 — the byte-exact oracles still compare content, and still go red

Every read of the borrowed bytes is now expressed over the explicit accessor:

| site (pre-repair line) | before | after |
|---|---|---|
| `ports.py:695` splice input | `_with_port(state.original_bytes, …)` | `_with_port(state.reveal_original_bytes(), …)` |
| `ports.py:711` backup write | `state.original_bytes or b""` | `state.reveal_original_bytes() or b""` |
| `ports.py:737` recorded size | `len(state.original_bytes)` | `len(state.reveal_original_bytes())` |
| `install.py:833` recorded size | `len(state.original_bytes)` | `len(state.reveal_original_bytes())` |
| `install.py:847` backup write | `state.original_bytes or b""` | `state.reveal_original_bytes() or b""` |
| `install.py:888` verified length | `len(verified.original_bytes)` | `len(verified.reveal_original_bytes())` |
| `provisioning.py:1015` narrow input | `state.original_bytes or b""` | `state.reveal_original_bytes() or b""` |
| `provisioning.py:1025` backup write | `state.original_bytes or b""` | `state.reveal_original_bytes() or b""` |
| `provisioning.py:1034`, `:1052` sizes | `len(state.original_bytes)` | `len(state.reveal_original_bytes())` |

`restore_port` (`:750-851`) and `restore_community_plugins` were **not touched**: they read
the backup file into a plain local and never consult a `BorrowState`, so their sha256-and-
exact-length verification is byte-for-byte the code it was. `test_c9a` proves restore is
still independent of the modify path by making `_with_port` explode and showing the restore
still reproduces the file.

**Per-comparison one-byte perturbation — the before/after, measured.** The perturbation
lands inside a string *value* so the file stays structurally valid JSON (a perturbation
that broke the parse would be refused for the wrong reason and prove nothing):

| comparison | unperturbed (positive control) | one byte perturbed | verdict |
|---|---|---|---|
| C1 splice input | provisioned bytes reproduce the fixture | provisioned bytes differ, and differ by exactly one byte | **RED on difference** |
| C2 backup write | backup `== ORIGINAL` | backup `== PERTURBED`, `!= ORIGINAL` | **RED** |
| C3 recorded sha/size | sha matches `sha256(ORIGINAL)` | sha moves; size unchanged by design, so the sha is the discriminator | **RED** |
| C4 `capture_state` sha check | re-capture succeeds, holds content | `ProvisionConflict` / `PROVISION_CONFLICT` | **RED** |
| C5 `restore_port` sha+length | `restored=True`, file `== ORIGINAL` | `SettingsRestoreMismatch`, settings file untouched, backup+marker left in place | **RED** |
| C6 `install_bundle` restore point | install succeeds, backup `== BUNDLE` | `BundleRestoreMismatch`, `main.js` still the owner's | **RED** |
| C7 community borrow | backup byte-exact, restore byte-exact | recorded sha moves; perturbed backup → `CommunityPluginsRestoreMismatch` | **RED** |

**One sub-clause could not be isolated by a content perturbation and is reported as such
rather than faked.** `install_bundle`'s reconciliation is `sha mismatch OR presence
mismatch OR length mismatch`; a one-byte perturbation always trips the sha clause first, so
the length clause is exercised directly on two constructed `BundleState`s in `test_c6b` —
`len(shorter.reveal_original_bytes()) != original_size` is True, `len(state.reveal…()) ==
original_size` is True, and `len(state.original_bytes)` (the shape that would have been the
silent failure) raises `TypeError` rather than agreeing.

**The "compares wrappers and always agrees" failure mode is closed twice over.** Every site
is written over `reveal()`, *and* `Secret.__eq__` is content-based, so even a site that had
been missed would still compare content. `test_c8` pins that: two distinct `Secret` objects
over the same bytes compare equal, two over one-byte-different bytes compare unequal.

**Invariants re-verified:** no parse/serialise round trip (BOM, CRLF, tabs, `\u00e9` escape
and key order all survive a provision+restore cycle byte-for-byte — `test_c9b`); the
no-prior-file case still restores to *no file at all*, not an empty file and not `{}`
(`test_c9c`); `PROVISION_MARKER_FIELDS` unchanged; no `ProvisionError` message gained
content (every refusal message was asserted sentinel-free); `os.environ` still does not
appear in `ports.py` — checked over the **AST** rather than the text, because the module
docstring says the words "os.environ" in a sentence about not having one.

### AC3 — the defect class is closed across the package

The enumeration is **derived, not claimed**: `test_t1` walks the AST of every module in
`tools/obsidian_e2e/` for a `@dataclass` field that is `bytes`-typed, `Secret`-typed or
credential-named, and compares the result against a pinned disposition table. A record
added later that holds file bytes behind a generated repr therefore **fails this test**
instead of quietly joining the class.

| module | record | field | annotation now | disposition |
|---|---|---|---|---|
| `ports.py` | `BorrowState` | `original_bytes` | `Optional[Secret]` | **repaired** — the owner's `data.json`, the reported instance |
| `install.py` | `BundleState` | `original_bytes` | `Optional[Secret]` | **repaired** — the owner's `main.js`; shipped code, so low disclosure severity, identical defect |
| `provisioning.py` | `_CommunityState` | `original_bytes` | `Optional[Secret]` | **repaired** — S12; the `asdict` hole the handwritten repr could not close |
| `readiness.py` | `RawAnswer` | `body` | `Optional[bytes]` | **carried up (S14)** — different subject, different consumers, and `readiness.py` is on this charter's may-not-touch list |
| `relay.py` | `RelayRoom` | `token` | `Secret` | **already closed by WP70** — the working precedent, read not redesigned |

That is the complete set: five records across five modules. Nothing else in the package
has a `bytes`-typed, `Secret`-typed or credential-named `@dataclass` field.

### AC4 — `ports.py` no longer downgrades a redacted member set

`resolved_members = dict(members)` (`ports.py:677`) is gone. `provision_port` now builds a
`RedactedMapping` in **both** branches — the caller-supplied set *and* the port-only
default — and `_with_port` normalises its `members` parameter to a `RedactedMapping` at the
top of the frame, so **both live frames** hold a redacting mapping. Closing the class
rather than the one reported instance is deliberate.

`RedactedMapping` is a `dict` subclass, so **use is unchanged**: `test_t3` shows ordering,
equality, `json.dumps` output and the **byte identity of the provisioned file** are the
same whether a plain `dict` or a `RedactedMapping` goes in. The empty-member-set `ValueError`
and the `None`-means-port-only default are unchanged (`test_t5`).

The AC4 vacuity clause is obeyed literally: `test_t1` passes a **`RedactedMapping`** carrying
a sentinel under `SETTINGS_TOKEN_KEY`, captures the object **at the point it reaches
`_with_port`**, asserts the sentinel is retrievable **by subscript at that same point**
(the positive control), and only then asserts it is absent from `repr`/`str`/`%s`/`format`
of that object. `test_t4` additionally renders a real traceback with `capture_locals=True`
out of the splice frame and asserts both `resolved_members` and `member_set` render
redacted.

### AC5 — falsified separately, headless, positive control first

Every injection was run **twice under an identical harness**: once against a byte copy of
the pre-repair package, once against the repaired one.

| injection | pre-repair result | post-repair result |
|---|---|---|
| I1 `repr(state)` | **sentinel present** | absent; `<redacted>` present |
| I1 `str(state)` | **sentinel present** | absent; `<redacted>` present |
| I1 `format(state)` | **sentinel present** | absent; `<redacted>` present |
| I1 `"%s" % (state,)` | **sentinel present** | absent; `<redacted>` present |
| I1 `repr(dataclasses.asdict(state))` | **sentinel present** | absent; `<redacted>` present |
| I1 `json.dumps(asdict(state), default=str)` | **sentinel present** | absent |
| AC1/T6 failed pytest comparison at `-vv` | **sentinel present in captured output** | absent; record rendered as `BorrowState(… original_bytes=Secret(<redacted>) …)` |
| AC1/T7 traceback frame locals (`capture_locals=True`) | (vector confirmed live: frame and locals really rendered) | absent |
| I2 one-byte perturbation → `restore_port` | `SettingsRestoreMismatch` | `SettingsRestoreMismatch` — **deliberately the same**; see below |
| I3 `asdict` over `_CommunityState` | `repr` already clean, **`asdict` returned the raw bytes** | `asdict` returns the wrapper; `repr` still clean |
| I4 `RedactedMapping` through `provision_port` | type at the splice = **`dict`**, `repr` **leaked** the token | type = `RedactedMapping`, `repr` redacted, subscript still returns the value |

**I2 is the one place where before and after must AGREE, and the agreement is the result,
not a null.** Every other injection is a before/after difference; the byte oracle was able
to fail before WP77 and must still be able to fail after it. A *difference* there would
mean the repair changed what the module decides, which is an abort criterion.

**The "before" harness is a byte copy — measured, not asserted.** `_prerepair.py` reads the
baseline package out of git's object store (`git ls-tree -r` for blob ids, `git cat-file
blob` for bytes), writes it to a temp package, and **re-derives git's own object id from
each written file** (`sha1("blob <len>\0" + bytes)`), asserting it matches. `test_i5`
re-runs that verification and additionally proves the copy really is the *pre*-repair code
(it contains `resolved_members = dict(members)` and `original_bytes: Optional[bytes]`, and
has no `reveal_original_bytes`) while the repaired tree contains none of that.

Baseline blob ids used:

| file | blob |
|---|---|
| `constants.py` | `837e78cdce58ac3775bc7fbdde103cf4acf7fccb` |
| `install.py` | `aac3392a54ae5ad36213ef0f3142dda648237ac2` |
| `ports.py` | `b584357c9c7077565ea35bb6ee6dd6888332a4de` |
| `provisioning.py` | `6fd85b0733ece0db332ce7e26ac4939bb12cd4f6` |
| `readiness.py` | `bf50744b5f7a266876c31595385e28126a89a669` |
| `relay.py` | `4216f9d4e11139299eab6378b691621faa21ed25` |

*One honest qualification, since AC5 turns on the word "byte":* the copy is byte-identical
to what **git stored**. This checkout normalises line endings, so the worktree file at the
baseline had CRLF where the blob has LF. Python's tokenizer treats them identically and no
assertion in this WP depends on a line ending. The qualification is written into
`_prerepair.py`'s own header so it cannot be lost.

**Positive controls.** *Every absence assertion in this WP is preceded, in the same test
function, by an assertion that the sentinel IS in the object.* The mechanism is named
explicitly: in AC1 it is the module-level `positive_control(state)` helper, called as the
first statement of every test and asserting `reveal_original_bytes() == ORIGINAL_BYTES`,
each sentinel present in those bytes, and `had_original is True`; in AC2 it is the
unperturbed run executed first in the same test; in AC3/AC5 it is an inline
`assert SENTINEL.encode() in <reveal>` on **both** the before and the after object; in AC4
it is `seen["subscript"] == SENTINEL_TOKEN`, taken at the exact point the assertion is made.
A positive control that could be skipped independently of the assertion it licenses is not
a control, so none of them lives in a separate test.

**Injections were targeted, never global** (rule 2), and neighbouring behaviour stayed
green: the full visible suite went 593/593 → 643/643 with the 50 WP77 tests added and
**zero pre-existing tests broken**.

---

## 2. The one architecture decision — the §3 Verification 5 relocation

**Shape (a) was taken:** `REDACTED`, `Secret` and `RedactedMapping` moved **down** from
`relay.py` into `constants.py` (new §10.3), and are **re-exported** from `relay.py`.

Why (a) and not (b): shape (b) requires a new module that "imports nothing from the
package", but `RedactedMapping.SECRET_KEYS` must be `constants.SECRET_SETTINGS_KEYS` and
**never a second list**. A new module would have to import `constants` to satisfy that,
which is not the letter of (b); `constants.py` itself imports nothing from the package
(stdlib only) and already sits below both `ports` and `relay`, so (a) satisfies every hard
constraint with no new module and no second list.

**Evidence that nothing moved semantically** (`test_t10`, run green):

- `relay.Secret is constants.Secret` · `relay.RedactedMapping is constants.RedactedMapping` · `relay.REDACTED is constants.REDACTED` · `relay.SECRET_BEARING_KEYS is constants.SECRET_SETTINGS_KEYS` · `constants.RedactedMapping.SECRET_KEYS is constants.SECRET_SETTINGS_KEYS`
- `[name for name in relay.__all__ if not hasattr(relay, name)] == []` — `relay.__all__` lost no name and its text is unchanged.
- The relocated `Secret` body is **byte-identical** to WP70's. The relocated `RedactedMapping` differs in **exactly one line** — `SECRET_KEYS = SECRET_BEARING_KEYS` → `SECRET_KEYS = SECRET_SETTINGS_KEYS`, the same tuple object under its owning name instead of relay's alias for it. That single diff was produced by `difflib` against the baseline blob and is reproduced here rather than described.
- `constants.py:506-507`'s drift guard is untouched and still fires at **import** rather than at a leak; `test_t10` re-asserts both of its conditions.
- `ports.py` does **not** import `relay` (`test_t10b` asserts the exact import list) and gained **zero runtime dependencies** — stdlib plus `constants`, exactly as the module docstring claims.
- Every module still imports standalone in a fresh interpreter (`test_t7`, parametrised over all six).

---

## 3. Scope discipline

- **Files modified:** `tools/obsidian_e2e/constants.py`, `relay.py`, `ports.py`, `install.py`, `provisioning.py`. **Nothing else.** `test_t6` asks git rather than asserting it: `git diff --name-only <baseline> -- tools/ server/ plugin/` contains nothing outside `tools/obsidian_e2e/` except `plugin/src/**`, which belongs to the sibling B16a agent working in this same tree and is explicitly excluded rather than silently tolerated.
- **No suite was mirrored into `plugin/src/__tests__/`.** This WP adds **zero** TypeScript. `test_t6` also globs that directory for any `*WP77*` file and asserts there is none.
- **`readiness.py` untouched** — confirmed by an empty `git diff` against the baseline.
- **WP78's territory respected:** `install.py`'s `_default_runner`, `build_e2e_bundle` and `__all__` were not touched. The only `install.py` change is `BundleState` plus the three call sites that read its field, and one added import line.
- **No existing test was deleted, weakened, retitled, skipped or amended.**
- **No behavioural change to provisioning or restore.** The provisioned bytes, the marker's pinned field set, the four legal borrow shapes and the failure-reason mapping are what WP44 and WP70 left. The one behavioural *addition* is that a plain-`dict` member set is upgraded to `RedactedMapping` — a rendering property only, shown byte-identical in output.

---

## 4. Measured results

| suite | command | result |
|---|---|---|
| WP77 visible | `python -m pytest workflowArtifacts/canvas-v2/tests/visible/WP77 --rootdir=. -q` | **50 passed** |
| — AC1 | `…/test_ac1_*.py` | 11 passed |
| — AC2 | `…/test_ac2_*.py` | 11 passed |
| — AC3 | `…/test_ac3_*.py` | 12 passed |
| — AC4 | `…/test_ac4_*.py` | 5 passed |
| — AC5 | `…/test_ac5_*.py` | 11 passed |
| full visible suite (post) | `python -m pytest workflowArtifacts/canvas-v2/tests/visible --rootdir=. -q` | **643 passed** |
| full visible suite (baseline, pre-WP77) | same, before any edit | **593 passed** |
| legacy blind sets (regression only) | `python -m pytest …/blind_set1 …/blind_set2 --rootdir=. -q` | 1501 passed, **2 failed** |
| `plugin/` typecheck+build | `npm run build` (via `visible-console`) | **exit 0 — green** |
| `plugin/` unit tests | `npx vitest run` | **1865 passed / 304 files** |

**The two blind-set failures are pre-existing and are not WP77's.** Both are in
`blind_set2/WP47/test_tp04_teardown_exit_paths_blind2.py`
(`test_the_inner_context_manager_unwinds_before_teardown_finishes`,
`test_forty_notes_are_all_still_there_after_an_interrupted_run`). Verified by running that
file in a detached `git worktree` at the **baseline commit**, where it fails identically:
`2 failed, 9 passed`. Blind sets are discontinued for new work; they were run only as a
regression check.

**Two flakes seen and resolved, recorded so they are not rediscovered:**

1. The first `npm run build` reported 15 `TS2339` errors on
   `plugin/src/__tests__/dataloss/test_stale_reconcile_evidence_gate.test.ts`. It had raced
   the sibling B16a agent's in-flight edit of `plugin/src/files/manifest.ts`; the immediate
   re-run was **exit 0**, and the methods it complained about (`getPublication`,
   `hasFreshPublication`) are present in `manifest.ts` at HEAD. **Not a WP77 effect** — this
   WP adds no TypeScript.
2. The first `npx vitest run` reported `1 failed / 1864 passed`; the immediate re-run
   reported `1865 passed / 0 failed`. Recorded as a flake in a suite this WP does not
   touch, not as a result.

---

## 5. Carried up

- **S14 — `readiness.RawAnswer.body`.** Named, justified, **not repaired**, per the charter. `readiness.py` is on this WP's may-not-touch list and the subject is different: it carries what a control endpoint answered, not a file borrowed from the owner, and its consumer (`_parse_session_info`, `readiness.py:220-237`) is a different contract. **Measured and reported rather than assumed** (`test_t5`): the record is still renderable — `repr`, `str` and `dataclasses.asdict` all spell a sentinel body out in full — and `readiness.py` is byte-unchanged from the baseline. It is now the **only remaining member of this defect class in the package**, and the test that says so will start failing if anyone changes its shape without deciding about it. **Owner: none assigned.**
- **S16 — the package still has no pytest configuration of any kind.** No `pytest.ini`, `pyproject.toml`, `setup.cfg`, `tox.ini` or `conftest.py` — re-confirmed; every invocation in this WP passes an explicit path plus `--rootdir=.`, and the `-vv` vector is invoked explicitly by the test that needs it. Consequence unchanged: adding `addopts = --showlocals` to a future config would turn the conditional frame-locals vector into an unconditional one suite-wide. AC1 closes it either way, since a value that refuses to render refuses in a frame local too (`test_t7`).
- **Note for whoever runs the full tree:** pytest still cannot collect from the workspace root — `Projects/_external/FinaleAbgabe` is a dangling symlink and is the owner's. Every command in this report passes an explicit path and `--rootdir`. The symlink was not touched.

---

## 6. Charter checklist

| Requirement | Status |
|---|---|
| Complete enumeration of byte-bearing dataclasses with dispositions | §1/AC3 — and *derived by AST at test time*, not transcribed |
| Which relocation shape, with evidence the four `relay.*` names still resolve | §2 — shape (a); five `is`-identity assertions + `__all__` intact |
| Before/after one-byte perturbation for every comparison reading the borrowed bytes | §1/AC2 — seven comparisons, plus the one sub-clause reported as un-isolatable and exercised directly |
| AC5 falsification in full, per injection, before and after | §1/AC5 — eleven rows |
| Explicit statement that the "before" harness was a byte copy | §1/AC5 — verified against git's own object ids, with the CRLF/LF qualification stated |
| Explicit statement that every absence assertion has its positive control in the same test, mechanism named | §1/AC5 |
| No owner-vault value read, printed, hashed or fixtured; sentinels synthetic | §0 |
| Nothing outside `tools/obsidian_e2e/` modified; no suite mirrored into `plugin/src/__tests__/` | §3 — checked against git, not asserted |
| No live Obsidian, real vault or gate result involved or claimed | §0 |
| `npm run build` / `npm test` shown still green | §4 |
