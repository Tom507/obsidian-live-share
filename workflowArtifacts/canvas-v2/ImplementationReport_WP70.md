# Implementation Report — WP70

---

# Attempt 2 — Worker 3 Core's independent verification

*Everything below was measured by Core, not reported by the sub-agent. Where the two
differ, this section is the record.*

## Final counts — all executed, all non-zero (rule 9)

| Test set | files | collected | passed | failed |
|---|---|---|---|---|
| visible | 31 | **259** | **259** | **0** |
| blind_set1 | 31 | **345** | **345** | **0** |
| blind_set2 | 31 | **300** | 298 | **2** (escalated, see below) |

Attempt 1 for comparison, against the *complete* sets: **49 failed**. Consoles `688a6602`,
`f63afa5e`, `bedb9a3c`.

## The five `tp29` failures had never executed their assertion

`blind_set1/tp29`'s `make_vault(tmp_path, f"mismatch-{label}")` passed `"mismatch-bom"`
into a helper that uses its argument **both** as the directory suffix **and** as the
`FIXTURES` key, so it raised `KeyError` **inside the fixture helper** — in attempt 1 too.
Five tests had therefore never reached `pytest.raises(CommunityPluginsRestoreMismatch)`.

Corrected (batch-authored, D-1 precedent; pytest gives each parametrised invocation its own
`tmp_path`, so the plain label is already unique). **No assertion, matcher or title was
touched, and the change strictly increases strictness: five assertions that had never run
now run.** They pass — so the tp29 property is now *proven* rather than merely
*not-failing*: a re-serialised backup is refused across a BOM, CRLF-with-no-final-newline,
deep indentation, escaped non-ASCII and single-line spacing.

This is a **rule 11 instance in a hidden set**: a test that dies in setup is a test that
cannot fail for its own reason.

## ESCALATED — 2 `blind_set2/tp31` failures, deliberately NOT touched

`test_the_borrow_is_real_for_every_shape[without_obsidian_git]` and
`test_a_list_without_obsidian_git_is_still_handed_back_unrewritten` both assert
`during != original` for a list that **does not contain `obsidian-git`** — i.e. they require
the borrow to **rewrite a file when there is nothing to remove** ("the rig rewrites the file
anyway"). That is unsatisfiable together with the byte-preservation property AC-level safety
depends on: a textual splice that removes nothing produces identical bytes, and gratuitously
re-writing is precisely what `tp29` forbids.

This is an **assertion-level dispute, not a fixture defect**, so the D-1 precedent does not
cover it and **WP70 holds no §7 licence**. Escalated for a ruling: *must a borrow rewrite the
file when the enabled set does not change?* The borrow **is** real either way — backup and
marker are written; the tests conflate "the borrow happened" with "the content changed".

## Structural claims — re-measured against the batch baseline, not against my own diff

`ports.py` compared function-by-function against `fd7de1f` (rule 4):

| function | verdict |
|---|---|
| `restore_port` | **UNCHANGED** |
| `_load_marker` | **UNCHANGED** |
| `_marker_blob` | **UNCHANGED** |
| `_with_port` | **CHANGED** — the one generalisation |

> The sub-agent reported two of the four fingerprint rows in `WP70_PinnedDecisions.md` §3 as
> unreproducible and suspected attempt 1 of transcribing rather than measuring `_marker_blob`.
> **Superseded:** the byte comparison above is against the baseline *source*, which is
> stronger than any recorded digest, and it confirms the AC1 boundary holds.

- **Rule 10:** `grep -rn 39441 tools/ --include=*.py` → **exactly one line**, `constants.py:353`.
- **No spawn:** the three `subprocess`/`Popen` grep hits in `relay.py`/`provisioning.py` are
  **docstring prose asserting their own absence**; neither module imports either. C45 AC4 /
  C71 AC4 hold for WP70's code.

## Pre-existing, proven — the 2 WP47 hidden failures are NOT a WP70 regression

`blind_set2/WP47/test_tp04_teardown_exit_paths_blind2.py` fails 2 of 11. Attribution was
established by checking out the batch baseline `fd7de1f` into a **separate git worktree** and
running the file there, with **no WP70 code present**: it fails identically, 2 failed /
9 passed. Rule 4 satisfied *without* stashing my own diff — which is the move that cost an
earlier batch its attribution. Worktree removed afterwards.

## Owner vaults — final

| Vault | `data.json` | `community-plugins.json` | rig artefacts |
|---|---|---|---|
| `ObsidianOrga` | **MATCH** `c2c4db2d…4162` | **MATCH** `42932112…1611` | none |
| `ObsidianOrga - Kopie` | **MATCH** `070e3f3a…030f` | **MATCH** `42932112…1611` | none |

## Still NOT executed — unchanged by attempt 2

No Obsidian session was started. No control endpoint has answered on this host. **No
propagation between the two vaults has been observed by any means**, so AC5's positive leg
remains WP7's to settle and a passing WP70 is not evidence that propagation was ever seen.
No bundle was installed; both vaults keep the production build. No relay was deployed. No
`server/` byte changed.

## Carried to the Dispatcher

- **`ports.BorrowState` is a dataclass holding `data.json` bytes**, so its generated `repr`
  leaks live credentials — the same defect class as the room token, in an **inherited**
  module outside WP70's boundary. Reported, not fixed.
- WP69's `install.py:101,458` still breaks the no-`subprocess` property C71 AC4 preserves.

---

# Attempt 2 — the generalisation pass (sub-agent record)

Attempt: 2 (of 3) · Batch **B10a** · Written by **Worker 3 Core** · 2026-08-04
Attempt 1 is retained **verbatim** below this section.

## Status: GENERALISED — visible **259/259**, hidden **49 → 7**, and all 7 are reported test defects

| Measurement | Executed | Result |
|---|---|---|
| visible, WP70 slice | **259 collected / 259 passed / 0 failed** | console `1f80bd3f` (baseline), re-run at handover |
| visible, whole tree | **593 collected / 593 passed / 0 failed** | console `6233b499` |
| hidden set, WP70 slice (`blind_set1` + `blind_set2`) | **645 collected / 638 passed / 7 failed** | was 49 failed at attempt 1's hand-over |
| hidden set, whole tree (both sets, all WPs) | **1503 collected / 1494 passed / 9 failed** | 7 WP70 + 2 **WP47's**, see below |
| independent property audit (Core's own, 359 checks) | **359 executed / 0 failed** | console `0790e225`, then re-run after each change |
| `ports.py` boundary | **0 violations**, proved by **byte comparison** against `abcab9a` *and* `fd7de1f` | see §"the boundary, re-measured" |

Interpreter `h:\My Code\AgenticWorkspace\.venv\Scripts\python.exe`, cwd
`H:\Developement\_NeuralAngels\liveshareCollab\obsidian-live-share`, explicit paths,
`-p no:cacheprovider`. Every count is executed and non-zero (rule 9).

**All 7 remaining WP70 failures, and both WP47 ones, are defects in the tests.** They are
reported below and **not one test file was touched** (WP70 holds no §7 licence of any
class). Two of the seven encode a requirement that is *mutually unsatisfiable* with another
test in the same batch; that is stated with the proof.

**Files written:** `tools/obsidian_e2e/relay.py`, `tools/obsidian_e2e/provisioning.py`,
`tools/obsidian_e2e/constants.py` (append-only), `workflowArtifacts/canvas-v2/T3_SharedContract.md`.
`git status --porcelain` shows exactly those three code files as modified and nothing else.
**`ports.py` was not opened for writing at all this attempt.**

---

## What was wrong with attempt 1, in one sentence

It satisfied the cases the visible tests *name* rather than the properties behind them —
so every check was as narrow as the example that motivated it, and each of the clusters
below is that same narrowness in a different place.

---

## Cluster by cluster — the property, then the change

### P1 · A value that carries a secret cannot be rendered

> **Property:** a value carrying a secret cannot be rendered by *any* general-purpose
> stringification, and cannot arrive in a message, a log record or a traceback by accident.

Attempt 1 had `RelayRoom` as a `@dataclass(frozen=True)` with `token: str`. The synthesised
`__repr__` prints every field, `str()` falls back to `repr()`, `logging`'s lazy `%s`
renders at emit time long after the call site was reviewed, and a traceback prints the
frame that holds the object. Those are four different call sites reaching one object, which
is why the fix is a **type** and not an audit: *an audit is a promise, a type is a
guarantee.*

- **`relay.Secret`** — redacting `__repr__` / `__str__` / `__format__`; `__bytes__`,
  `__iter__` and `__contains__` refused outright so the value cannot be spelled out one
  piece at a time; immutable; `reveal()` the **only** accessor, and it has to be written at
  the call site, which is what makes the two legitimate uses greppable. `__copy__` /
  `__deepcopy__` / `__reduce__` return the **wrapper**, so `dataclasses.asdict()` neither
  crashes nor unwraps — that was found by the audit, not by a test.
  Equality is deliberately *left open*: comparing a secret against a candidate the caller
  already holds discloses nothing, whereas rendering is the accidental act.
- **`RelayRoom.token`** is normalised into a `Secret` in `__post_init__`, so it is never
  stored in a renderable field; `reveal_token()` is the one legitimate reveal.
- **`relay.RedactedMapping`** — the same property one level up, applied to the two mappings
  that carry the token to a caller: the `POST /rooms` payload returned by `mint_room()` and
  the member set returned by `gate_settings_members()`. Subscripting still returns the real
  value; only the rendering is closed. A caller-supplied `members=` is *re-wrapped* rather
  than copied into a plain dict — redaction is a property of what the mapping holds, not of
  where it came from.
- **`relay.REDACTED`** — the placeholder as a module constant, so a check can assert that a
  rendering *was redacted*, which "the token is not in this string" does not distinguish
  from a rendering that dropped the field.
- **An evidence channel carrying any `SECRET_SETTINGS_KEYS` member is refused** at the
  boundary rather than redacted downstream, where one renderer that has not heard about it
  is enough.
- `constants.py` gained `SETTINGS_TOKEN_KEY` / `SECRET_SETTINGS_KEYS` with import-time drift
  assertions, so the redaction can never end up pointed at the wrong member set.

Audited and green (P1, 30 checks): `repr`, `str`, f-string, `.format()`, `%s`, `%r`,
`asdict`, nested containers, exception `args`, a rendered **traceback**, a `logging` record
with lazy `%s`, the minted payload, the member set, the provisioning record, the marker
file — and the positive control that the token *does* still reach the file the plugin reads.

**`data.json`-derived bytes:** `provisioning._CommunityState` held the owner's file in a
`@dataclass` whose generated repr would print it; it now has a fingerprint-only repr.
`ports.BorrowState` has the same defect for `data.json` and is **out of WP70's boundary** —
escalated below, not touched.

### P2 · The restore byte-exactness oracle

> **Property:** a restore is verified against the fingerprint **the marker recorded** —
> sha256 *and* exact byte length — before anything is written and again after, over **raw
> bytes**; any path that decodes, parses, re-serialises or normalises is not a restore, and
> a backup replaced by a semantically-equal but byte-different copy is a **mismatch**.

- **The corollary attempt 1 got wrong**, exactly where the brief said to look: the readback
  compared `len(written) != len(backup)` — against the bytes just written. That is true
  whenever the file system works and says nothing about whether the backup is still what
  was captured. Both halves of the readback now compare against `expected_size` /
  `expected_sha` **from the marker**.
- Pre-write verification split into two distinct refusals (digest, then length), matching
  `install.py`: a digest that matches while the recorded length does not can only come from
  a record edited after it was written, and a record that disagrees with itself is not a
  restore point. Same split added to the entry door.
- **The exit door now checks its own result as hard as the entry door.** The
  no-original branch removed the file and *reported* whatever it found; it now raises
  `COMMUNITY_PLUGINS_RESTORE_MISMATCH` if the file still exists, exactly as
  `ports.restore_port` does.
- **The modify path became a textual splice** (`_enabled_without_disabled`), the same
  discipline `ports.py::_with_port` applies to `data.json`. Attempt 1 re-serialised with
  `json.dumps(..., indent=2)`, which silently converted the owner's file to house style
  *for the duration of the borrow* — eating a UTF-8 BOM, CRLFs, tabs, indentation depth,
  single-line spacing, escaped non-ASCII and a missing trailing newline. The borrowed file
  is the owner's file too: their Obsidian may open it mid-run and a crashed run leaves it
  in place until the next teardown. The splice is **verified before the first write** (it
  must still parse, and parse to exactly the list the id filter says), so a list this
  module cannot narrow is a refusal with the vault byte-identical.

Audited over eight awkward encodings (UTF-8 BOM, CRLF without final newline, tabs without
final newline, deep indent, escaped non-ASCII, single-line spacing, BOM+CRLF+deep, trailing
blank lines) — byte-exact restore, and a re-serialised backup refused with the live file
untouched and the evidence kept, for every one.

#### The `disabled`-set question on the restore path — decided, with the rationale

**Decision: no.** A backup whose sha256 **and** byte length both match the marker is
restored even when the marker's `disabled` set names an id this rig never writes.

*Why.* The recorded sha256 and byte length **fully determine the bytes to be written back**.
The `disabled` set is a statement about what the *disable* step did; it has no bearing on
what the backup is. Refusing there would strand the owner's file behind a record they
cannot edit and would destroy recoverability rather than protect it — and the alternative
outcome is not "safer", it is "the owner's plugin list stays modified and a human has to
reconstruct the borrow by hand".

*Why this is not the asymmetry the brief warns about.* Refusals **are** symmetric at both
doors, and that symmetry was strengthened this attempt: the shared marker loader validates
every pinned field, so every *structurally contradictory* state — a backup with no marker,
a marker claiming an original whose backup is gone, a fingerprint disagreement, any
malformed field — is refused identically at both doors, both leaving the vault
byte-identical (audited: 21 doctorings × 2 doors × refusal + no-write). The `disabled`-set
check is not a structural-contradiction check. It answers a question that **only exists at
the entry door**: *may I adopt this leftover and continue it as mine?* The rig disables
exactly `DISABLED_PLUGIN_IDS`, so any other set means the borrow is not this rig's and
adopting it would mean restoring a file this rig never captured. Restore is not adoption;
restore is return. **Entry asks "may I take this over?", exit asks "what do I give back?"**

### P3 · Marker validation is total

> **Property:** every field of `COMMUNITY_PLUGINS_MARKER_FIELDS` is structurally validated
> or the claim is refused — a record is one statement, and a half-checked statement is not a
> weaker guarantee but a false one.

`_load_community_marker` checked three fields. It now matches `ports.py::_load_marker` and
`install.py::_load_marker`: non-empty strings for `runId` / `role` / `createdAt`, a `role`
that is a **real** role, a non-`bool` non-negative `pid`, an actual `bool` for
`hadOriginal`, a list of **distinct non-empty** ids for `disabled`, and a digest **and** a
byte length exactly when `hadOriginal` with **both** absent otherwise. **Shape** and
**content** stay apart — `_is_digest` asks "64 hex characters?", never "the right ones?" —
which is what preserves the `CONFLICT` vs `MISMATCH` discriminator that tells a human
whether the *record* or the *file* is wrong.

### P4 · A leftover the rig did not write is not adopted

> **Property:** the rig only ever disables `constants.DISABLED_PLUGIN_IDS`, so a marker
> recording any other `disabled` set was written by something else — that is a conflict, not
> an adoption. Adoption is only for a leftover that is recognisably **this rig's**.

Added at `_capture_community_state`, before any write.

### P5 · Port occupancy, readiness, stop

> **Property:** the port is checked before anything else happens and before anything reaches
> the console; a refusal is repeatable and never becomes an adoption; an overridden port is
> the one reported; and a free port reaches the console exactly once.

- **A probe that cannot answer is not a free port.** An exception out of the port probe is
  neither "free" nor "busy" — it is "not known", and it is folded into "occupied" in *both*
  callers. The unknowable case never becomes the permissive one: the rig does not start on a
  port it cannot establish as free, and does not report as released a port it cannot
  establish as free.
- **Single-shot.** A second `start()` while started is `GATE_ORDER_VIOLATION` — planning a
  second launch puts a second node on a port the first one holds and leaves the rig owning a
  console id it can no longer close. Audited: three consecutive refusals on an occupied
  port, zero console requests, no store directory, no state change.
- **`host=` / `port=` overrides**, threaded through the free probe, the launch payload's
  `PORT`, the health URL, the room URL, the stop probe, every refusal message and
  `RelayStopResult`. `39441` is still spelled once, in `constants.py`
  (`grep -rn 39441 tools/ --include=*.py` → **1 line**); an overridden base URL takes its
  scheme from the pinned URL rather than a second spelling of `http://`.
- **`RelayStopResult.probes`** — a `stopped=True` reached after **zero** probes is one
  inferred from the close call's return, and without the count a run record cannot tell the
  two apart.

> **Readiness property:** a refused connection, a socket timeout and a malformed body are
> each *"not ready yet"*, not errors; expiry names the awaited condition; readiness once
> established is not re-probed.

`_probe_health_once` absorbs `OSError` (which covers both `TimeoutError` and
`ConnectionRefusedError`), `http.client.HTTPException`, `ValueError` and
`UnicodeDecodeError` into "not ready yet" — node binds late by construction, and treating
any of them as an error turns that into a failed run. `wait_ready` returns the established
body without re-probing, so one dropped packet cannot un-ready a ready run.

> **Stop property, and the measured host fact behind it:** stopped means *"a connection no
> longer completes within a bounded budget"*, paired with the positive direction.

⚠ Re-stated because it is the batch's sharpest green-that-cannot-fail: **on this host a
closed port raises `TimeoutError`, never `ConnectionRefusedError`** — every unused port
drops the SYN and the connect consumes its whole timeout. An oracle written against refusal
could never fire here. The shipped oracle is bounded non-completion, and it is non-vacuous
because a live relay *was* measured accepting the connection and answering `/healthz` on
poll 1. Both halves are kept.

### P6 · Idempotence, single-shot, and where a failure is allowed to be a field

> **Property:** a second `mint_room` on the same relay is refused; and a teardown step
> finishes its own work and then reports its failure **by raising**, because "teardown runs
> to completion" is a property of the teardown *driver*, not a licence for a step to hide
> its own failure.

- `mint_room()` twice is `GATE_ORDER_VIOLATION`. This is correctness, not tidiness: the run's
  two peers are provisioned with **one** room id and **one** token, so a second room is a
  place half the run could end up pointed at — two peers connecting successfully to somewhere
  they cannot meet, which reads as a sync bug and is not one.
- **`release()` was swallowing `RelayNotStopped` into a returned `reason` field.** An
  orphaned listener is a *failed run*; a failure recorded in a field a caller may not read
  is not reported. `release()` now removes the store on **every** path — including an
  unexpected exception out of the console seam, which attempt 1 would have let skip the
  removal — and then re-raises. `run_teardown` is what makes a stuck relay not stop either
  vault's restore, and it can only do that for failures it is told about.

### P7 · Truthiness is not a verdict

> **Property:** validate the **type**, never the truthiness, for anything that decides a
> run's verdict — and then let the **value** decide the verdict.

That two-part split is the generalisation attempt 1 was missing, and it resolves what
otherwise looks like a contradiction:

- **The type decides whether this is a channel** — a wrongly-typed count, a non-`bool`
  `changed`, a channel that is a list or a string or empty, a window that is a `bool`, a
  string, `nan` or `inf`: all `PROPAGATION_EVIDENCE_UNAVAILABLE`. `0` is not `False`, `1` is
  not `True`, `""` is not "a short room id", and an empty channel is an **absent** channel.
- **The value decides the verdict** — an integer count that is too small, or even negative,
  is a *measurement that fails the criterion*: `positive_observed=False`, `satisfied=False`,
  reason `PROPAGATION_EVIDENCE_UNAVAILABLE`. Not an abort.
  Collapsing the two would either turn a legible "not enough traffic" into an exception or a
  malformed channel into a quiet zero, and those are precisely the two errors the split keeps
  apart.
- **A zero or negative window is refused**, not read as "no wait needed": a window of zero is
  a leg that was never given a chance to happen, and a negative one is a measurement that
  cannot have been taken. Attempt 1 accepted `positive=0.0, negative=0.0` as *satisfied*.

### P8 · A channel that cannot exist yet cannot be built

> **Property:** evidence built from a relay with no minted room, or one that was never ready,
> is `PROPAGATION_EVIDENCE_UNAVAILABLE`; a built channel carries every key of
> `RELAY_EVIDENCE_KEYS` and **no token**.

Attempt 1 had no builder at all — callers hand-assembled channels, which is exactly how a
vault-B observation gets dressed up as a relay-side one. `relay.relay_observation(local)`
(alias `build_relay_channel`, method `LocalRelay.propagation_channel`) builds it from **what
the relay itself holds**: its own `/healthz` body and a count of the frames its own
run-scoped store retained (`LocalRelay.retained_frames()`). Nothing a caller supplies can
inflate it — which is the whole asymmetry AC5 rests on, since a file-copying engine can
manufacture vault-B content and cannot manufacture a hermetic relay's own counts. Also
added: `build_negative_channel` (both members must be genuine booleans) and
`build_propagation_evidence`.

### P9 · The run record states the pinned order, not the caller's

> **Property:** a record's ordering is the pinned one, so two records of the same state
> compare identical.

`shared_surface_record` now orders its `vaults` entries by `constants.ROLES` rather than by
the order the caller happened to build the list in.

### P10 · A record states what was written, never a coercion of it

> **Property:** the provisioner writes the pinned member set with its pinned types or refuses
> before writing, and the record reports the values as written.

`verify_member_types` (new, raises `ValueError` — a call-site error, not a run outcome, the
same distinction `ports.default_port_for_role` already draws). `GateProvisionRecord` no
longer wraps its fields in `str()` / `bool()`: with the types established, a coercion could
only ever turn a value the record disagrees with into one it agrees with, which is exactly
the disagreement a record exists to surface.

### P11 · A refusal names itself

A vault with no `.obsidian/` directory used to fail with a bare `FileNotFoundError` from the
first write. It is now `CommunityConfigMissing`, reusing WP43's existing
`VAULT_PATH_MISSING`; no new reason was invented. The rig still never creates a
configuration directory inside a vault.

---

## The `ports.py` boundary, re-measured — and a correction to the pinned table

Proved by **byte comparison** of the extracted function segments against the baseline
file's own copies, not by a transcribed digest. Both `abcab9a` (the pinned §3 baseline,
whole file `e8d626c893ff7112…`, 35 871 bytes — **matches** §3) and `fd7de1f` (the batch
baseline) give the same answer:

| function | vs `abcab9a` | vs `fd7de1f` | permitted? |
|---|---|---|---|
| `restore_port` | **UNCHANGED** (byte-identical) | **UNCHANGED** | must be — OK |
| `_load_marker` | **UNCHANGED** | **UNCHANGED** | must be — OK |
| `_marker_blob` | **UNCHANGED** | **UNCHANGED** | must be — OK |
| `_with_port` | **CHANGED** | **CHANGED** | the one generalisation — OK |

**Boundary violations: 0.** `ports.py` was not opened for writing during attempt 2 at all;
the `_with_port` difference is attempt 1's single splice generalisation, plus the one added
keyword argument on `provision_port` / `provisioned_port` / `provision_pair`.

Segment digests, under a stated and reproducible convention (the `def` line through one line
past the function body):

| function | sha256 (first 32) | bytes |
|---|---|---|
| `restore_port` | `59c113a335b372d656b8cc0e936641fe` | 4 302 |
| `_load_marker` | `5ac26e4bbcb4e02a879d8ee82b0504b5` | 1 692 |
| `_marker_blob` | `d3acd943e2ee5998743f5867bc891997` | 700 |
| `_with_port` | `8da19a9450eb0253f2382cfbe90bc970` | 3 674 (baseline `ff5d0e4e…`, 1 819) |

> ### ⚠ FINDING — two of the four rows in `WP70_PinnedDecisions.md` §3 are not reproducible
> Under the convention that reproduces **`restore_port` (`59c113a3…`, 4 302)** and
> **`_load_marker` (`5ac26e4b…`, 1 692)** exactly as §3 records them, the *same* extraction
> of the *same* baseline file yields `_marker_blob` = `d3acd943…` / **700** bytes against
> §3's `2ed4b8c2…` / **881**, and `_with_port` = `ff5d0e4e…` / **1 819** against §3's
> `1856dc8a…` / **2 057**. The baseline file's own whole-file hash and size match §3
> exactly, so the file is right and two of the four *rows* were measured with a different
> segmentation.
>
> Attempt 1's report reproduced §3's `2ed4b8c2…` for `_marker_blob` and called it
> "UNCHANGED" — which means it **transcribed** that row rather than re-measuring it. That is
> the failure mode the fingerprints exist to prevent, so it is recorded rather than quietly
> corrected. The *claim* AC1 makes still holds and is now proved the stronger way, by
> byte comparison against the baseline file rather than against a number in a table.

---

## Tests I believe are wrong — reported, and NOT touched

WP70 holds **no BUILD_SPEC §7 licence of any class**. Nothing below was modified, deleted,
weakened, retitled or skipped. Attempt 2 did not edit a single test file.

### 1. `blind_set1/WP70/test_tp29 :: test_a_backup_replaced_by_a_reserialised_copy_is_a_mismatch` — 5 params, a `KeyError` in the test

```python
def make_vault(tmp_path, label):
    ...
    (vault / constants.COMMUNITY_PLUGINS_REL).write_bytes(FIXTURES[label])   # ← line 61
...
vault = make_vault(tmp_path, f"mismatch-{label}")     # ← passes a name that is not a key
```

`make_vault` indexes `FIXTURES[label]`, and the caller passes `f"mismatch-{label}"`. Every
parametrisation dies with `KeyError: 'mismatch-bom'` (etc.) **inside the fixture setup**,
before the implementation is reached at all. The behaviour the test intends to check is
implemented and independently verified: Core's audit runs exactly this scenario over eight
awkward encodings and gets `COMMUNITY_PLUGINS_RESTORE_MISMATCH` with the live file untouched
and both halves of the evidence kept, every time. **Fix is one character-range in the test:
`make_vault(tmp_path, label)`.** Not applied.

### 2. `blind_set2/WP70/test_tp31 :: test_a_list_without_obsidian_git_is_still_handed_back_unrewritten` and `test_the_borrow_is_real_for_every_shape[without_obsidian_git]` — mutually unsatisfiable with `tp29`

Both assert that a `community-plugins.json` which **does not contain `obsidian-git`** is
nevertheless byte-different during the borrow:

```python
assert (vault / constants.COMMUNITY_PLUGINS_REL).read_bytes() != original
```

The only way to satisfy that is for the modify path to rewrite a file it has **no reason to
change** — i.e. to re-serialise it into this module's house style. `blind_set1/WP70/tp29`
(and its own docstring, *"the owner's CRLFs and tabs are theirs whether or not an id was
removed"*) requires the opposite: that the borrow preserves the owner's bytes. **No
implementation satisfies both.** Byte-preservation is the property WP70's safety argument
rests on and the one `ports.py::_with_port` already establishes for the file next door, so
it is the one implemented. **Suggested fix: drop the `!= original` assertion for the
`without_obsidian_git` shape** — the borrow's reality is already established there by the
marker's presence, the backup's contents and the `record.had_original` assertion in the same
block. Not applied.

### 3. `blind_set2/WP47/test_tp04_teardown_exit_paths_blind2` — 2 failures, **not WP70's**

`test_the_inner_context_manager_unwinds_before_teardown_finishes` and
`test_forty_notes_are_all_still_there_after_an_interrupted_run`. That file imports only
`constants` and `scratch`; `scratch.py` is explicitly **out of bounds** for WP70
(`WP70_PinnedDecisions.md` §3) and was not touched. Reported to WP47's owner, not
investigated further here.

---

## What was NOT executed — nothing below may be read as observed

- **No Obsidian session was started**; no control endpoint answered on this host.
- **No propagation between the two vaults has been observed**, by any means. AC5's positive
  leg still needs two real Obsidian instances and is still WP7's run.
- **No relay was started during attempt 2 at all** — every probe, console and clock in every
  measurement above is injected. The live relay facts quoted (closed-port `TimeoutError`,
  `/healthz` on poll 1, `POST /rooms` → 201, the three stores under the run-scoped cwd) are
  attempt 1's measurements, re-stated, not re-run.
- **The owner's vaults were not touched during attempt 2.** No borrow ran against
  `ObsidianOrga` or `ObsidianOrga - Kopie`; every fixture is under a temporary directory and
  is asserted at construction to be neither vault, not inside one and not a parent of one.
  The live-vault verification in attempt 1's section stands as the record of that run.
- **No `server/` byte was changed**; `plugin/main.js` was not hashed for anything (untracked,
  shared, last-build-wins across concurrent batches).
- **No state-changing git command was run** — `git log`, `git status`, `git diff --stat` and
  `git show <commit>:<path>` only.

## Standing escalations, re-stated because they are still true

- **`ports.BorrowState` renders the owner's `data.json` bytes.** It is a
  `@dataclass(frozen=True)` with `original_bytes: Optional[bytes]`, and `capture_state()`
  returns it to any caller; its generated repr would print the file in full into any
  traceback that holds it. This is the same defect P1 fixed for the room token and for
  `provisioning._CommunityState`. It is **out of WP70's file boundary** (§3 permits the
  modify path only), so it is reported rather than fixed. Suggested fix: a fingerprint-only
  `__repr__`, one method, no behaviour change.
- **WP69 already broke the "no spawn under `tools/obsidian_e2e/`" property** —
  `install.py:101` imports `subprocess` and `:458` calls `subprocess.run`. C71 AC4 is still
  written to preserve a property that no longer holds. Not WP70's to fix, and the reason
  `relay.py` and `provisioning.py` take an **injected** console with no default spawning
  runner. Re-verified this attempt: `grep` for `subprocess|Popen|os.system|os.exec|shutil.which`
  across both WP70 modules returns **only docstring prose**.

---

# Attempt 1 (retained verbatim)

Attempt: 1 (of 3) · Batch **B10a** · Written by **Worker 3 Core**

## Status: RISKY/UNSTABLE — `risk_flag = HIGH`

Visible is green; **both blind sets are not**. The implementation is **overfit to the
visible set**, which is exactly the condition the blind sets exist to detect, and it is
reported rather than papered over (Worker 3 rule 4: a risk flag with detailed notes is a
better outcome than silently passing).

| Test set | collected | passed | failed |
|---|---|---|---|
| visible | **259** | **259** | **0** |
| blind_set1 | **284** | 261 | **23** |
| blind_set2 | **257** | 247 | **10** |

Every count is **executed and non-zero** (rule 9). Interpreter
`h:\My Code\AgenticWorkspace\.venv\Scripts\python.exe`, cwd
`H:\Developement\_NeuralAngels\liveshareCollab\obsidian-live-share` (the junction — pytest
**cannot** collect through `Projects\_external\`, see "environment" below), explicit paths,
`-p no:cacheprovider`, launched through `visible-console` `run_python`
(consoles `508dddd2`, `f3434757`, `5b0b30a3`).

⚠ **The blind sets are 29 files each, not 31.** The unit-test sub-agent was terminated by
an account spend limit while generating them, so `tp03` and one other point have no blind
counterpart in set 1, and likewise in set 2. The Review Gate's "exactly 2 blind
counterparts per visible test" is therefore **not** satisfied, and the 23/10 failures are
measured against an **incomplete** hidden set — the true failure count can only be ≥ these.

---

## Completed Work

| AC | Status | Notes |
|---|---|---|
| **AC1** — one borrow, one splice, byte-identical for the port-only case | **DONE (visible) / UNSTABLE (blind)** | The three structural claims are verified **independently by Core, by hash** — see below. `blind_set1/tp29` (6 failures) says the *restore-mismatch* discrimination is not yet right. |
| **AC2** — the shared surface is established and narrowed | **DONE** | `SETTINGS_SHARED_FOLDER is SCRATCH_FOLDER` (`_e2e-rig`) — the constant, not a re-spelling; `excludePatterns` provisioned empty. One blind failure (`tp09`, run-record role ordering). |
| **AC3** — relay built, started, proven ready, provably released | **PARTIAL** | The mechanism is **live-verified end to end by Core** (below). 11 blind failures across `tp13`/`tp15`/`tp17` mean the *refusal and readiness edge cases* are not yet general. |
| **AC4** — ordering stated, enforced, recorded | **PARTIAL** | Enforced at the boundaries per the pinned table; `blind_set1/tp19` and `blind_set2/tp22` show two ordering/teardown paths not yet general. |
| **AC5** — propagation evidence **mechanism** | **PARTIAL — and by charter it CANNOT be completed here** | 7 blind failures in `tp23`/`tp25`/`tp26`. **The positive leg needs two real Obsidian instances, which is WP7's run.** Nothing about propagation has been observed. |
| **`obsidian-git` precondition** (Dispatcher ruling, not a charter AC) | **DONE and LIVE-VERIFIED** | See the dedicated section — the one part of this WP exercised against the owner's real vaults. |

---

## The relay port constant

```python
RELAY_PORT = 39441          # tools/obsidian_e2e/constants.py:353
```

| Port | Owner | Kind |
|---|---|---|
| `39421` / `39422` | `HEADLESS_RIG_PORT_A/B` | headless **mock** rig |
| `39431` / `39432` | `REAL_CONTROL_PORT_A/B` | real rig control (D13) |
| **`39441`** | **`RELAY_PORT`** | the rig-started local relay |

Disjoint from all four, verified by assertion, and one decade above the real-control pair
so a transposed digit lands on nothing. **Rule 10 discharged by measurement:**
`grep -rn 39441 tools/ --include=*.py` returns **exactly one line**, `constants.py:353`.
It is spelled in no other module, no default argument, no docstring and no URL string.

---

## AC1 — the three structural claims, verified by hash rather than asserted

Baselines were taken by Core at commit `abcab9a`, **before** the implementation existed
(`WP70_PinnedDecisions.md` §3). Re-measured after:

| function | verdict | sha256 (first 32) |
|---|---|---|
| `restore_port` | **UNCHANGED** | `59c113a335b372d656b8cc0e936641fe` |
| `_load_marker` | **UNCHANGED** | `5ac26e4bbcb4e02a879d8ee82b0504b5` |
| `_marker_blob` | **UNCHANGED** | `2ed4b8c2c9bf83c0525b42d6c8ab892a` |
| `_with_port` | **CHANGED** (`1856dc8a…` → `9c0bf602…`) | the one generalisation |

Three unchanged and exactly one changed is what *"one generalisation, reached through one
added keyword argument"* looks like as a measurement rather than as a promise. The restore
path and the marker's pinned field set are **byte-identical**, as AC1 requires.

The provisioned key set is exactly the pinned ten, in the pinned order:

```
e2eControlPort · serverUrl · roomId · token · role
permission · sharedFolder · excludePatterns · autoReconnect · debugLogging
```

**No value from either `data.json` appears anywhere in this report**, and the four
credential keys (`encryptionPassphrase`, `encryptionSalt`, `jwt`, `serverPassword`) are
neither read nor written. Comparison is sha256-of-bytes only (S4).

> **Charter imprecision, recorded not acted on.** AC1 says all ten keys are *"an existing
> member of `LiveShareSettings`"*. Nine are. **`e2eControlPort` is not** — it is the
> pre-existing *hidden loose setting* WP44 already owns (`constants.py:83`,
> `plugin/src/types.ts:5–34` does not declare it). It is not an invented key, so the AC's
> intent holds; the wording is simply wrong about one member.

---

## `obsidian-git` disable / restore — the mechanism and its INDEPENDENT verification

**Ruling:** enabled in both vaults with `autoPullOnBoot: true` over dirty git work trees
with `origin` remotes. It fires at **launch** — the moment a gate starts Obsidian — and an
auto-pull onto a dirty tree can merge or check out over local state *before any Canvas V2
code runs*. A failure caused this way would look like a sync bug and would not be one.
**Precondition, not a disposition.**

**Where it lives.** A new module `tools/obsidian_e2e/provisioning.py`, deliberately **not**
`ports.py` (whose whole invariant is *one borrow over `data.json`*; a second borrow in that
module is the shape AC1 forbids) and **not** `relay.py` (a process lifecycle and nothing
else). Writing `community-plugins.json` is WP70's — WP69 AC4's prohibition binds WP69,
which is install-only.

**Mechanism** — the same reversible-borrow discipline as the `data.json` borrow:

```
capture (byte-exact backup + marker carrying sha256 AND byte length, never content)
  → modify (remove only the pinned DISABLED_PLUGIN_IDS; every other id keeps text and place)
  → restore (drive from the BACKUP verbatim; verify sha256 AND exact length before and after)
  → verify INDEPENDENTLY
```

Namespace: `.obsidian/community-plugins.json.e2e-original` +
`.obsidian/.e2e-community-plugins.json`. A contradictory leftover is
`COMMUNITY_PLUGINS_CONFLICT` with nothing written; a non-byte-exact restore is
`COMMUNITY_PLUGINS_RESTORE_MISMATCH` with the evidence left for a human. Restore runs on
every exit path — `borrowed_community_plugins.__exit__` covers `KeyboardInterrupt` and
`SystemExit`, which a teardown hung off `except Exception` would miss.

### The live run (console `ad2174a0`, both owner vaults, exit 0)

Guarded first: **0 `Obsidian.exe` processes** — the rig never acts on an instance it did
not start (D15/S2).

| | vault A `ObsidianOrga` | vault B `ObsidianOrga - Kopie` |
|---|---|---|
| `community-plugins.json` **before** | `42932112…d571611` | `42932112…d571611` |
| `disabled` / `enabled_after` | `('obsidian-git',)` / `('live-share',)` | same |
| **during** the borrow | `f6f63830cb8357b4…82c9039e` | `f6f63830cb8357b4…82c9039e` |
| **after** restore | `42932112…d571611` | `42932112…d571611` |

**Why this is not a green that cannot fail.** The file provably *changed* under the borrow
(`42932112 → f6f63830 → 42932112`) — rule 11's converse: a perturbation that changed
nothing would have been the finding. And the comparand is **independent**: `42932112…` was
measured by Core *before any WP70 code existed*, so the restore is graded against something
the rig did not produce, not against the rig's own backup.

Four checks, both vaults, all **OK**: restored == the pre-run measurement · restored == the
independent baseline · `data.json` still == the `T3_PREFLIGHT` baseline · **no rig artefact
left in the vault**.

> `lan-vault-sync` is installed but **NOT enabled** and was **not** dispositioned.
> `community-plugins.json` is the *enabled* list and contains exactly `obsidian-git` and
> `live-share`, byte-identically in both vaults.

---

## `data.json` — both vaults against the pre-flight baselines

| Vault | `T3_PREFLIGHT.md` baseline | measured at handover | |
|---|---|---|---|
| `ObsidianOrga` | `c2c4db2dc8eeb2fd183d0adea62ca6338d1a8e16a0acf2d092a54a1ca18e4162` | identical | **MATCH** |
| `ObsidianOrga - Kopie` | `070e3f3abe81a57f02e590e8d957438c56b828da11944dc9d0b0b6f30fa9030f` | identical | **MATCH** |

Checked at batch start **and** after the live borrow. The two differ from each other, which
is correct (per-vault identity keys) and was not "converged".

---

## The relay — live-verified before a line of `relay.py` existed

Core started a real relay, drove it and stopped it (consoles `89e3a37d`, `684386df`,
`b7e5bd5b`, `5b40d8a7`), so the design was measured rather than assumed:

- `server` `npm run build` (`tsc`) — exit 0, **terminates**; no watch trap on this side.
- readiness: `GET /healthz` → `{"ok": true, "uptime": 2.62, "sessions": 0, "documents": 0,
  "clients": 0}` on the **first** poll.
- `POST /rooms` → **HTTP 201**, keys `['id','name','token']`, `id` length 36 (uuid),
  `token` length 24 (nanoid24) — **minted server-side; neither value read or printed.**
- **all three** LevelDB stores landed under the run-scoped directory; the directory was
  removed and `git status` stayed clean.
- stop: `close_console` released the port on the **first** probe afterwards.

### ⚠ AC3's store claim needed correcting — env vars are NOT sufficient (rule 12)

The charter calls the relay *"configured entirely through environment variables it already
reads"*. Re-traced against the current tree:

| store | site | env-configurable? |
|---|---|---|
| blob / frames | `index.ts:204` — `process.env.BLOB_STORE_PATH \|\| "./data/frames"` | **yes** |
| room persistence | `getDefaultPersistence()` (`persistence.ts:84`) calls `createLevelPersistence()` with **no argument**; `"./data/yjs-docs"` is a *parameter default* | **no** |
| audit log | `index.ts` calls `initAuditLog()` with **no argument**; `"./data/audit"` likewise | **no** |

Adding an env var would be a `server/` edit — a §7 **abort criterion**. **Resolution needing
no `server/` change:** all three are *cwd-relative*, so the relay is started with its
**working directory set to the run-scoped store directory**. Node resolves `node_modules`
from the module file's directory, and `isMain` compares `resolve(process.argv[1])`, so an
absolute entry path still works. Measured: all three stores landed correctly.

This **contradicts charter §5's** *"Node commands run from `server/`"* — which would put the
stores in `server/data/**`, **inside the repository**, which AC3 forbids in the same
sentence. The AC wins; §5's intent (*never the repo root*) is honoured, as the cwd is neither.

### ⚠ A closed port on this host TIMES OUT — it does not refuse

Measured for `39441`, `39421`, `39431` and a certainly-unused `65000`: every one raises
**`TimeoutError`**, consuming the whole connect timeout (`0.05 s → 63 ms`, `2.0 s → 2016 ms`).
Something drops loopback SYNs to closed ports instead of sending RST.

**An AC3 stop oracle written `except ConnectionRefusedError` could never fire here** — it
would look correct only because a surrounding `except OSError` swallowed the timeout. The
oracle must be *"a connection no longer completes within a bounded budget"*, paired with the
measured positive direction (a live relay **did** accept, and answered `healthz` on poll 1)
so the two states stay distinguishable. `RELAY_STOPPED_CONNECT_TIMEOUT_S = 0.25` is pinned
small because every negative poll costs the full timeout.

**This retires "Windows graceful relay shutdown is unverified"** for the path the rig
actually uses (`close_console`, a process-tree kill of a console the rig itself started, so
D15/S2 holds). The *signal-based* graceful path remains unverified and is not used.

### ⚠ The `run_command` nested-quote trap — reproduced, not theorised

A rendered `node "H:\…\dist\index.js"` was wrapped as `cmd.exe /d /c "chcp 65001 > NUL && …"`
and reached node with **literal quotes inside the path**
(`Cannot find module 'C:\…\"H:\Developement\…"'`). It then failed as a *readiness timeout*
after 14 polls — which reads like a slow relay rather than a launch that never happened.
**A launch failure must be distinguishable from a readiness failure.** `run_python` with an
absolute path and list args worked first try. Related gap for WP71/C71: `PlanOnlyConsole`
emits an argv **list** for `run_command`, but the real MCP `run_command` takes a **string**,
so a mediating agent that renders the list re-enters this trap.

---

## AC5 — the mechanism, and what it explicitly does NOT establish

Built: a positive relay-side channel (`/healthz` `documents`/`clients` plus the frames the
relay's own store retained for the run's room), a negative control over a window **at least
as long** as the positive leg needed, and the two refusals —
`PROPAGATION_EVIDENCE_UNAVAILABLE` when a channel is absent and `NEGATIVE_CONTROL_LEAKED`
when the change arrives anyway (a **FAILED** run under its own name, never a stronger
result, never re-run until green).

**AC5's positive leg cannot be settled by this WP at all.** It needs two real Obsidian
instances, which is WP7's run. **Content appearing in vault B is not sufficient and has not
been observed.** This split is stated so a passing WP70 is never read as evidence that
propagation was seen. AC5 also holds *independently* of the `obsidian-git` disposition: a
precondition is a claim about what was configured, AC5 about what the relay observed.

**7 of the 33 blind failures are in this mechanism** (`tp23` ×7, `tp25` ×2, `tp26` ×2), so
even the parts that *can* be settled here are not yet general.

---

## Blind failure clusters — the rework targets, in priority order

**blind_set1 (23):** `tp29` restore byte-exactness / re-serialised-copy discrimination (**6**,
incl. BOM, CRLF-no-final-newline, deep indent, escaped non-ASCII, single-line) · `tp13`
occupied-port refusal (**5**) · `tp15` readiness probe: refused vs timeout vs
"not re-probed once established" (**4**) · `tp23` empty/wrongly-typed evidence channel (**2**)
· `tp26` zero/negative positive window (**2**) · `tp17` stop reporting/propagation (**2**) ·
`tp09` run-record role ordering (**1**) · `tp19` second `mint_room` refused (**1**).

**blind_set2 (10):** `tp23` evidence channel construction (**5**) · `tp25` "only boolean
`False` counts as no change" (**2**) · `tp02` minted room token redacted in the room's own
`repr` (**1**) · `tp22` a stuck relay must not stop either vault's restore (**1**).

`tp02` and `tp29` are the two that matter most: the first is a **credential-leak** surface
(a token in a `repr`), the second is the **restore** oracle this whole WP's safety rests on.

---

## Two visible-test fixture defects corrected — and why no §7 licence was needed

**WP70 holds no §7 licence of any class**, and none was used. Both files were authored **by
this batch**, and per the Dispatcher's **D-1 ruling** every §7 class governs *inherited*
tests (same precedent as WP26's type-annotation edit and WP27's own-test revision). **No
assertion, count, matcher or title claim was weakened.**

- **`tp17` (3 tests).** They set the port probe to *occupied* and then called `start()` —
  which correctly refuses an occupied port, AC3's own requirement, pinned by `tp13`. Making
  them pass by changing the implementation would have meant **deleting the occupied-port
  refusal**, a D15/S2 safety rule. Two passing siblings *in the same file* already used the
  right pattern (`listening = [False]` → `start()` → `listening[0] = True`); the three now
  match them. Every assertion is verbatim.
- **`tp03` (1 param).** The corpus self-audit asserts a naive JSON round-trip destroys each
  entry. `{}` is the one entry `json.dumps` reproduces exactly, so it cannot carry that
  property. It is **named** as degenerate and excluded from the **audit only**; it stays in
  `CORPUS`, and the byte-identity requirement still applies to it. `empty_object_padded`
  (`b"  {   }  \n"`) covers the same shape adversarially.

---

## `canvas.setFlag` — the interaction, now stateable rather than a caveat

WP70's borrow could be destroyed mid-run by `canvas.setFlag`, which called
`plugin.saveSettings()` for any name matching an existing settings key, rewriting the
borrowed `data.json` from the live in-memory copy. **WP72 landed in sibling batch B10b and
fixes it.** B10b's correction to the mechanism: the clobber branch was decided by
`hasOwnProperty` on the **live object**, not by the declared type — i.e. **broader** than the
original description.

WP70 does **not** depend on that fix for safety: the borrow's restore is verified against the
independent `T3_PREFLIGHT` baselines, so a clobber surfaces as a loud
`SETTINGS_RESTORE_MISMATCH` rather than a silent wrong restore. With WP72 landed, the
mid-run source is closed; AC4's `RESTART_REQUIRED_OPERATOR` refusal continues to cover the
*late-provisioning* source, which is a different one.

---

## Environment / foreign edits / what was NOT executed

- **pytest cannot collect from the workspace root.** `Projects/_external/FinaleAbgabe` is a
  dangling symlink to an absent drive; it is the **owner's thesis link — not deleted, not
  repaired**. Every run used the junction as cwd with explicit paths.
- **`plugin/main.js` is not a safe bundle oracle** (B10b): untracked, shared,
  last-build-wins across concurrent batches. **No WP70 verification hashes it.**
- **Pre-existing LevelDB debris in the repo, not created by this run:** `data/audit` and
  `data/yjs-docs` (2026-07-20) and an empty `server/data/` (2026-08-01), from earlier
  hand-run relays. Gitignored, dated before the batch baseline — and exactly the failure
  AC3 exists to prevent. Not WP70's to delete.
- **⚠ WP69 already broke the "no spawn in `tools/obsidian_e2e/`" property.**
  `install.py:101` imports `subprocess` and `:458` calls `subprocess.run` (landed
  `e27b352`). `DISPATCHER_STATE.md`, `T3_PREFLIGHT.md` and **C71 AC4** all still assert that
  property. It drives a *terminating build*, so C45 AC4's letter survives, but the
  structural grep C71 AC4 names now returns a hit. **Not WP70's to fix** — and the reason
  `relay.py`/`provisioning.py` take an **injected** console with no default spawning runner.
- **⚠ A concurrent Worker 2 committed WP70's files.** `b8a541e` ("spec(wp74) …") contains
  **97** files — their 5 plus **all 92 of WP70's** — so it was staged with `git add -A`
  / `commit -a` despite the shared-ownership rule. Nothing is lost and nothing was
  overwritten, but WP70's work is **attributed to a WP74 spec commit**. History was **not**
  rewritten (another agent is live on this branch). Also observed and never touched:
  `BUILD_SPEC_CanvasV2.md`, `TaskCharter_WP74_…` (Worker 2) and
  `plugin/src/testing/e2e-control.ts` (B10b/WP72, since committed).

### NOT executed — nothing below may be read as observed

- **No Obsidian session was started.** No control endpoint has answered on this host.
- **No propagation between the two vaults has been observed**, by any means.
- **No plugin bundle was installed** into either vault by WP70; both keep the production build.
- **No relay was deployed anywhere.** The gate is hermetic and local.
- No `server/` byte was changed. The relay **binds on all interfaces**
  (`index.ts:236`, `server.listen(port)` with no host argument), so it is network-reachable
  for a run's duration — **recorded and accepted** per §7, not repaired.
- The guest's `cleanupStaleFiles` will still trash rig-owned scratch artefacts inside the
  shared folder that the manifest lacks, including one from a crashed run. Under AC2's
  narrowed surface that is confined to the rig-owned `_e2e-rig`. Touches WP47 AC4. **Noted,
  not fixed.**
- `npm test` for the plugin suite was **not** re-run by WP70 (no `plugin/src/**` file is
  touched); `tsc --noEmit` was clean at `abcab9a` with B10b's edit present, which is the
  attribution baseline.

---

## Summary for Worker 3 / the Dispatcher

The gate now has a sync path the rig owns: a pinned relay port (`39441`, spelled once), a
relay whose whole lifecycle was **live-verified** before the module was written, a room the
rig mints, and a shared surface narrowed **by construction** to the rig-owned `_e2e-rig` —
which is the data-safety precondition that must hold before any session is ever started.
The `obsidian-git` precondition is mechanised and its restore is **independently verified on
both real vaults**, with both `data.json` hashes still matching the pre-flight baselines.

**It is not done.** 33 blind failures across two *incomplete* hidden sets say the
implementation is overfit to the visible set, and the two sharpest clusters are the restore
oracle (`tp29`) and a credential-leak surface (`tp02`). Attempt 2 should be a **generalisation**
pass, not a patch of the named tests, and the blind sets need their missing counterparts
generated first so the gate is measured against a complete set.
