# Task Charter — WP77: the borrowed `data.json` is unrenderable by type, and the byte-exact oracle survives it

<!-- Updated: chartered 2026-08-04 — carried up from WP70, which closed this defect class for the room token at its own tp02 and could not reach the inherited module that holds the OWNER's credentials. Verified independently against the current tree per hard-won rule 12, on branch `fix-bugs-and-raceconditions`: every line number, every record and every render vector below was MEASURED, headless, with a synthetic sentinel, not read off the escalation. The trace found four facts the escalation did not contain, and three of them change the shape of the repair (§5 S12, S13, S14). No real credential was read, printed, hashed into an artefact or placed in a fixture at any point. -->
**Charter Status:** `SPEC_COMPLETE`
**WP:** WP77
**Phase:** P0 (PHASE T3 group)
**task_mode:** `standard`
**Depends on:** WP70 (`DONE`)
**W4 Test Targets:** `0`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** the owner's live plugin credentials stop being renderable. `tools/obsidian_e2e/ports.py` holds the owner's `data.json` **bytes** in a field of a `@dataclass`, so the generated `__repr__` prints them — and `data.json` carries `encryptionPassphrase`, `encryptionSalt`, `jwt`, `serverPassword` and `token`. After this WP the value that carries those bytes **refuses to render, by type**, on every general-purpose stringification path; the byte-exact borrow/restore oracle that proves the owner's file is given back unchanged is **not weakened by one bit** in the process; and the same defect class is closed across the module rather than at its one reported instance.
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 9, work package **WP77**, and the §7 **data-safety gate** whose standing rule this WP makes structural: *"Their bytes, and every value read from them, are **never** printed, logged, echoed into a report, handover or commit message, written into a test fixture, or included in an error message."* Phase **P0** (PHASE T3 group).

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: modify, **one repository** (`obsidian-live-share`, branch `fix-bugs-and-raceconditions`). This WP is **not** cross-repo; nothing in the AgenticWorkspace MCP driver is touched.
  - Responsibility: make "a borrowed secret is never rendered" a **property of a type** rather than a promise about call sites. WP70 established the type; WP77 applies it where the *owner's* credentials live, in the module WP70's boundary excluded.
  - Scope summary: the field of `ports.BorrowState` that holds the owner's `data.json` bytes becomes unrenderable by type; the three restore/borrow comparisons that read it are re-expressed so they still compare **content**, not wrappers; the two sibling records in the package that hold file bytes behind a generated repr are closed the same way; the one place where `ports.py` silently **downgrades** a WP70 `RedactedMapping` back to a plain `dict` is repaired; and every one of those is falsified by a sentinel oracle that runs headless, with no Obsidian, no vault and no socket.
- **Out of scope / non-goals:**
  - **The restore contract itself.** Byte-exactness, the backup namespace, the marker's pinned field set, the four legal borrow shapes, `PROVISION_CONFLICT` vs. `SETTINGS_RESTORE_MISMATCH` — all WP44's, all `DONE`, all unchanged. **WP77 changes how a value is *held*, never what the module *does*.** A behavioural change to provisioning or restore is an ESCALATE.
  - **Re-opening WP70.** WP70's `Secret`, `RedactedMapping`, `SECRET_BEARING_KEYS`, `RelayRoom.token` and `reveal_token` are correct and are **read, not redesigned**. WP77 may **relocate** the definition site (see the ordering ruling below) but may not define a second one. **A second `Secret` class anywhere in the package is an abort criterion, not a design choice** — two redaction types is how one of them stops being applied.
  - **Re-opening WP44.** `ports.py` is WP44's module and WP44 is `DONE`. WP77 edits the file; it does not re-open the WP, and no WP44 acceptance criterion is restated, weakened or re-verified here. This is the same treatment WP70 gave WP44 when it added the `members` argument.
  - **Auditing call sites.** Do **not** deliver this WP as a sweep of `print`/`logging`/`f-string` sites plus a rule. That is the failure mode the type exists to replace, and WP70's own docstring states why (`relay.py:248-256`): *"Auditing call sites is a promise; a type is a guarantee."* A repair that leaves the field renderable and forbids rendering it is **not** this WP.
  - **`readiness.RawAnswer.body`.** It holds a raw HTTP response body behind a generated repr and is the same *shape*, but it is not the same *subject*: it carries what a control endpoint answered, not a file the rig borrowed from the owner, and its consumers (`_parse_session_info`, `readiness.py:220-237`) are a different contract. **Recorded as S14 and carried up; not repaired here.**
  - **`server/**`.** Untouched. §7 makes a `server/` edit outside WP41 an abort criterion.
  - **`plugin/**`.** Untouched. This WP is Python-only and adds **no** TypeScript. **No test suite of any kind is mirrored into `plugin/src/__tests__/`** — `tsc` typechecks `src/` including tests, so an unimplemented mirrored suite breaks `npm run build` repo-wide for every other WP. The rule is stated even though it cannot bite here, because it has been violated once already in this run.
- **Known interfaces / dependencies:**
  - Input: WP70's `Secret` type and its `SECRET_BEARING_KEYS` list; WP44's borrow/restore contract; the `data.json` credential key names pinned in `constants.CREDENTIAL_SETTINGS_KEYS` (`constants.py:419-425`) and `SECRET_SETTINGS_KEYS` (`:501`)
  - Output: a `BorrowState` no rendering path can spell out; three comparisons that still compare content; two sibling records closed; one restored `RedactedMapping`
  - Depends on work packages: **WP70** only, and WP70 is `DONE`. Nothing planned is a prerequisite.
  - **WP7 depends on this WP.** See the ordering ruling in §5 — this is the one hard blocking relation and it is not on the gate's build order but on its **first execution**.

### Ordering ruling — parallel with the gate WPs, hard-blocking on WP7

**WP77 can land in parallel with WP71–WP76 and blocks none of them. It must land before WP7.** The argument, in the terms the WP75 and WP76 rulings used:

- **It is not on the critical path and does not serialise it.** The gate path is `WP70 → WP74 → WP75 → WP76 → WP71 → WP50/51 → WP7`. **Measured file overlap with every one of those: zero.** WP71 owns `lifecycle.py`; WP72 owns the plugin's `canvas.setFlag`; WP73/WP74/WP75/WP76 own `plugin/src/testing/e2e-control.ts` and the AgenticWorkspace driver; WP50/WP51 own the driver and the control surface. **Not one of them names a file in `tools/obsidian_e2e/`.** WP70 does own `provisioning.py`, `relay.py`, `constants.py` and `ports.py`'s `members` argument — and **WP70 is `DONE`**, so the overlap is with landed code, not with a live agent. There is no rule-10 contract to write.
- **It blocks WP7 absolutely, and the reason is execution, not compilation.** WP7 is the run, and it is the **first** thing in this project that points `capture_state` at the owner's two real vaults. Before that, the leak has never fired: no control endpoint has ever answered on this host and no gate has run, so every `BorrowState` ever constructed has held fixture bytes under `tmp_path`. The moment WP7 runs, the object holds the real file. **And WP7 is agent-mediated (C71)** — the agent executes each planned payload and feeds the outcome back — so a `provision_port` traceback, a failed byte assertion, or one debugging `print` during that run puts the owner's `encryptionPassphrase` into an agent transcript and, from there, into the run's own artefacts. §7's data-safety gate already forbids exactly that outcome and makes it an abort criterion for the WP that performs the run. **Landing WP77 after WP7 is landing it after the only event it protects against.**
- **It is not ranked against WP71–WP76 and no ranking is claimed.** Those make the gate's result *mean something*; this makes the gate *safe to run*. They are orthogonal properties of the same run, exactly as WP75 and WP76 are of each other. The Dispatcher may schedule WP77 at any point in the queue before WP7; the only ordering statement this charter makes is the WP7 one.
- **Recorded, not enacted:** nothing else in §9 changes. No existing dependency row is edited and no `planned` charter is back-dated (rule 5).

---

## 3. Architecture Context

*Task-local architecture guidance only.*

- **Component(s) being changed:** the borrow-state value types of `tools/obsidian_e2e/`, and the one member-set conversion that undoes WP70's redaction
- **Interfaces involved:**
  - Input: `capture_state(vault_path) -> BorrowState` (`ports.py:528`, exported at `:95`); `provision_port`'s `members` argument (`:635`)
  - Output: a borrow state whose content is reachable only through an explicit accessor; a `_with_port` input that is still a `RedactedMapping`

### Why a type and not an audit — stated plainly, because it is this charter's whole argument

A `@dataclass` synthesises a `__repr__` that prints **every** field. `str()` falls back to it. `%s` in a `logging` call interpolates **at emit time**, long after the call site was reviewed. `dataclasses.asdict` walks the object and hands the raw value to whatever renders the dict. `pytest`'s assertion rewriting reprs both operands of a failed comparison. A traceback frame renders its locals under `--showlocals`, `traceback.TracebackException(capture_locals=True)`, and any Sentry-shaped handler. **Each of those is a different call site, and every one of them reaches the same object.** An audit has to be right at all of them, forever, including the ones added next month; the object has to be right once.

That is not an argument this charter is making for the first time — **it is WP70's, in this repo, in the file this WP reads** (`relay.py:243-349`). WP70 closed the room-token leak with a value that refuses:

```text
├── __repr__ / __str__ / __format__ ─ redact, so f-strings, %s, .format(), print,
│   logging and traceback rendering all yield "<redacted>"
├── __bytes__ / __iter__ / __contains__ ─ refused outright, so nothing can spell the
│   value out one piece at a time
├── __copy__ / __deepcopy__ ─ return the wrapper, so dataclasses.asdict (which
│   deepcopies every leaf) cannot unwrap it
└── reveal() ─ the sole accessor, written at the call site, therefore greppable
```

**WP77 reuses that type. It does not invent a second one.** The reasons WP70 gives are the reasons here, one file over, with the owner's credentials instead of the rig's token — and the owner's are the ones the rig did not create and cannot re-mint.

### Verified against the current tree (rule 12), 2026-08-04 — measured, given, do not re-derive

Every statement below was produced by executing the package headless against a fixture vault under `h:\tmp`, with a **synthetic** sentinel string standing in for each credential. **No value from either owner vault was read.**

**Verification 1 — the defect is real, and the positive control holds.**
`ports.BorrowState` is declared `@dataclass(frozen=True)` at `ports.py:210-211` with five fields (`:218-222`); `original_bytes: Optional[bytes]` (`:221`) is the owner's `data.json`, verbatim, as read by `_read_bytes_or_none` (`:269-281`). The field genuinely holds the sentinel — that is the positive control, and it is asserted first, because **an absence test over an object that never held the value passes trivially.** With the sentinel confirmed present, **six render paths spell it out in full, unconditionally, with no flag and no configuration:**

| path | leaks? | conditional on anything? |
|---|---|---|
| `repr(state)` | **yes** | no |
| `str(state)` | **yes** | no |
| `f"{state}"` / `format(state)` | **yes** | no |
| `"%s" % (state,)` — the `logging` lazy form | **yes** | no |
| `dataclasses.asdict(state)` then any rendering | **yes** | no |
| `pytest` assertion diff on a failed comparison | **yes** | **no** — truncated at default verbosity, rendered **in full at `-vv`**, and named in the drill-down and the short summary |
| traceback frame locals | **yes** | **yes** — needs `--showlocals`/`-l`, `capture_locals=True`, or a locals-capturing handler |

The last row is stated with its condition rather than as an unqualified vector, because overstating it would be the same overclaim rule 12 exists to catch. The first six need nothing.

**Verification 2 — the blast radius, measured rather than estimated.**
A systematic walk of every `@dataclass` in `tools/obsidian_e2e/` for a field that is `bytes`-typed or named for a credential returns **five records**:

| record | field | what it holds | state today |
|---|---|---|---|
| `ports.BorrowState` (`:210-222`) | `original_bytes` (`:221`) | the owner's `data.json` — **the credential file** | **generated repr; leaks on all six unconditional paths** |
| `install.BundleState` (`:252-264`) | `original_bytes` (`:263`) | the owner's `main.js` plugin bundle | **generated repr; leaks.** Not credential-bearing — shipped code |
| `provisioning._CommunityState` (`:685-698`) | `original_bytes` (`:698`) | `community-plugins.json` | `repr=False` + handwritten `__repr__`/`__str__` (`:700-709`) — **repr closed, `dataclasses.asdict` still leaks (measured)** |
| `readiness.RawAnswer` (`:107-123`) | `body` (`:122`) | a control endpoint's HTTP response body | generated repr; leaks. **Different subject — S14, carried up** |
| `relay.RelayRoom` (`:397-406`) | `token` (`:398`) | the minted room token | **`Secret`-typed — closed by WP70. The working precedent.** |

So: **one credential-bearing record, one secret-bearing field of its five** (`marker`, `:222`, is the pinned seven-key marker dict — `runId`, `role`, `port`, `hadOriginal`, `originalSha256`, `pid`, `createdAt` — a fingerprint and structure only, and it is **not** in scope), **three construction sites** (all inside `capture_state`, at `:554-560`, `:575-581`, `:588-594`), **six unconditional render paths plus one conditional**, **two holders** (the public return of `capture_state`, exported in `__all__` at `:95`; and the local `state` in `provision_port` at `:688`, live across five subsequent statements of which four can raise), and **three reads of the bytes** that must keep working (`:695` into `_with_port`, `:711` into the backup write, `:737` into `original_size`).

**Verification 3 — S12, NEW and the single most instructive fact in this trace: the handwritten repr is already known to be insufficient, and there is a landed example.**
`provisioning._CommunityState` is the same defect, one file over, and **WP70 already repaired it — by hand.** `repr=False` on the decorator and a `__repr__` that prints the fingerprint and the size. **That repair holds for `repr()` and fails for `dataclasses.asdict()`**, measured: `asdict` does not consult `__repr__` at all, it walks the fields and deep-copies each leaf, so the raw bytes come straight back out. **This is the audit-versus-type argument demonstrated inside this repository, on a real attempt, by the same WP whose type this charter tells the implementor to reuse.** A `BorrowState` repaired the `_CommunityState` way would be **half-repaired in exactly the same place**, and its sentinel test over `repr` would pass while the leak stayed open. AC1 and AC5 are written around this.

**Verification 4 — S13, NEW: `ports.py` silently downgrades WP70's `RedactedMapping` to a plain `dict`.**
`gate_settings_members` (`provisioning.py:265-...`) deliberately returns a `relay.RedactedMapping` and says why: it *"carries the minted room token — a live credential — and a member set is exactly the kind of thing a caller prints while debugging a provisioning."* That mapping is handed to `provision_port(members=…)`. At **`ports.py:677`** it meets:

```python
resolved_members = dict(members)
```

`dict(x)` constructs a **plain `dict`**, not a copy of the subclass. Measured: the redaction is gone and `repr(resolved_members)` prints the token. The value then lives as a local in `provision_port` and as the `members` parameter of `_with_port` — two frames, both of which can be on a traceback, and both reachable by any `repr` a debugging caller writes. **This is a landed WP70 protection being undone by an inherited line one module away, which is the same relationship WP77 has to WP70's own tp02 finding.** It is in scope because it is a credential-disclosure defect in this WP's own file, in this WP's own class.

**Verification 5 — S15, the constraint that decides where the type may live: `ports.py` cannot import `relay.py`.**
`relay.py:88` reads `from .ports import ProvisionError`. **`relay` already depends on `ports`.** An `import` of `relay` from `ports` therefore closes a cycle at module-import time and breaks the package for every consumer, including `provisioning.py:71-73` and `teardown.py:59`. `constants.py` imports **nothing** from the package (`:16-19`, standard library only) and is below both. **The implementor must resolve this and it is the one architecture decision this WP contains.** Two shapes are admissible and no third is:

- **(a)** move `REDACTED` (`relay.py:152`), `Secret` (`:243-349`) and `RedactedMapping` (`:351-372`) down into `constants.py`, and **re-export them from `relay.py`** so that `relay.Secret`, `relay.REDACTED`, `relay.RedactedMapping` and `relay.SECRET_BEARING_KEYS` remain working import paths with identical behaviour;
- **(b)** the same move into a **new** module that imports nothing from the package, with the same re-export from `relay.py`.

**Either way `relay.Secret` must still resolve to the same class object, `relay.__all__` must not lose a name, and `SECRET_BEARING_KEYS` must still be `constants.SECRET_SETTINGS_KEYS` (`relay.py:146`) rather than a second list.** A relocation that breaks an existing import, or that leaves two classes named `Secret`, is an abort. Note that `constants.py:506-507` already carries the drift guard asserting the token key is provisioned and the four credential keys are provisioned by nobody — it fails at import rather than at a leak, and it must keep doing so.

**Verification 6 — the credential keys are named in this repo already, so naming them here discloses nothing.**
`constants.CREDENTIAL_SETTINGS_KEYS` (`:419-425`) is `encryptionPassphrase`, `encryptionSalt`, `jwt`, `serverPassword`; `SETTINGS_TOKEN_KEY` (`:500`) is `token`; `SECRET_SETTINGS_KEYS` (`:501`) is their union. `plugin/src/session/session.ts:59-60,104-106` is where three of them are generated or accepted from an invite. **Key *names* are public repository content. Key *values* are not, and no value appears in this charter, in any test this WP produces, or in any artefact it writes.**

- **Constraints from BUILD_SPEC (invariants — what must not change):**
  - **The byte-exact restore oracle is not weakened by one bit.** `ports.py`'s borrow is what proves the owner's `data.json` is handed back byte-for-byte. Three comparisons read the bytes today (`:695`, `:711`, `:737`) and `restore_port` verifies by sha256 **and** exact byte length (`:797-816`). **A comparison that silently starts comparing wrappers instead of content is a broken oracle that still looks green**, and it is the most dangerous way this WP can be got wrong. A sha256 over `reveal()`, or a length over `reveal()`, is a correct oracle; `wrapper_a == wrapper_b` resolving to a wrapper identity check is not. **Every comparison the WP touches must be shown to still fail when the content differs.**
  - **`restore_port` does not depend on the modify path and must not begin to.** It reads the backup file and copies it verbatim (`:750-851`). WP77 changes how a value is held in `capture_state`/`provision_port`; it must not introduce a dependency from restore onto either.
  - **No parse/serialise round trip is introduced anywhere on the restore path.** Tab indentation, CRLF endings, BOM, key order, number formatting and non-ASCII escaping are part of "the owner's file" (module docstring, `:31-35`).
  - **The no-prior-file case still restores to *no file at all*** — not an empty file, not `{}` (`:43`, `:837-851`).
  - **The marker still carries a fingerprint and structure only, never content** (`:597-621`), and `PROVISION_MARKER_FIELDS` does not change membership.
  - **No `ProvisionError` message gains content.** Every abort names a reason from `constants.py` and carries paths, hashes, sizes and the reason (`:114-127`). A redaction that makes it *safe* to put bytes in a message does not make it *permitted*.
  - **`os.environ` still does not appear in `ports.py`** — the module docstring makes that a structural claim (`:19-20`), not an incidental one.
  - **One `Secret` class in the package.** WP70 defines it; WP77 relocates the definition site at most. A second definition is an abort.
  - **Zero new runtime dependencies.** `ports.py` is standard library plus `constants`; it stays that way.
  - **Data safety (§7 data-safety gate).** No file in either owner vault is read, opened, hashed into an artefact or pointed at by any test. **Every test fixture is synthetic, under `tmp_path`, and every sentinel is an obviously-fake literal.** No real key name is ever paired with a real value anywhere.
  - **No secret through an agent tool**, in any command string, script argument or commit message.
- **Technology / framework / config constraints:**
  - Python, standard library only. **The package has no `pytest.ini`, no `pyproject.toml`, no `setup.cfg`, no `tox.ini` and no `conftest.py`** — measured. There is no `addopts`, so nothing is enabled by default that a test can lean on; a test that needs `-vv` or `--showlocals` must invoke it explicitly and say so.
  - Run tests from the workspace root, never from a subdirectory (workspace Python convention). Long-running invocations go through `visible-console` `run_python` with an **absolute** script path — never a Bash background process.
  - **Schema impact:** none. No file format, no marker format, no wire format changes.
- **Entry points / relevant files:**
  - `tools/obsidian_e2e/ports.py` — `BorrowState` (`:210-222`); `capture_state` (`:528-594`) and its three construction sites (`:554-560`, `:575-581`, `:588-594`); `provision_port` (`:629-742`), specifically `resolved_members = dict(members)` (`:677`), `state = capture_state(vault)` (`:688`), and the three reads at `:695`, `:711`, `:737`; `restore_port`'s verification (`:797-816`); `__all__` (`:82-96`)
  - `tools/obsidian_e2e/install.py` — `BundleState` (`:252-264`)
  - `tools/obsidian_e2e/provisioning.py` — `_CommunityState` (`:685-709`), the handwritten repr that S12 shows is insufficient
  - `tools/obsidian_e2e/relay.py` — `SECRET_BEARING_KEYS` (`:146`), `REDACTED` (`:152`), `Secret` (`:243-349`), `RedactedMapping` (`:351-372`), and the `from .ports import ProvisionError` at `:88` that forbids the reverse import
  - `tools/obsidian_e2e/constants.py` — `CREDENTIAL_SETTINGS_KEYS` (`:419-425`), `SETTINGS_TOKEN_KEY` (`:500`), `SECRET_SETTINGS_KEYS` (`:501`), the drift-guard asserts (`:506-507`)
  - Read-only context, not modified: `tools/obsidian_e2e/readiness.py` `RawAnswer` (`:107-123`); `tools/obsidian_e2e/teardown.py:924-943`
- **Files this WP may NOT touch:** anything under `plugin/`, anything under `server/`, anything under `tools/MCPserver/`, `tools/obsidian_e2e/readiness.py`, `tools/obsidian_e2e/lifecycle.py`, `tools/obsidian_e2e/vaults.py`, `tools/obsidian_e2e/scratch.py`, `tools/obsidian_e2e/teardown.py`, and any existing test under `workflowArtifacts/canvas-v2/tests/`. **If the repair appears to require reaching outside `tools/obsidian_e2e/`, that is an ESCALATE, not a judgement call.**
- **Structure references:** *(intentionally empty — no Graphify graph exists for this project; FALLBACK mode is declared in the BUILD_SPEC section 3. Worker 3 fills this in after implementation. Do not invent paths here.)*

If structure references conflict with the BUILD_SPEC or explicit task scope, the BUILD_SPEC and TaskCharter win. Escalate instead of following the map.

---

## 4. Acceptance Criteria

*Each criterion is followed by the statement of what would make it vacuous. This run has found ten-plus instances of a green test that cannot fail; a criterion that does not name its own vacuity risk is incomplete.*

1. **The owner's `data.json` bytes are held in a value that refuses to render, and the refusal is a property of the type rather than of any call site.** The field of `ports.BorrowState` that carries the borrowed file becomes unrenderable: `__repr__`, `__str__` and `__format__` yield a redaction placeholder; `__bytes__`, `__iter__` and `__contains__` refuse outright, so nothing can spell the value out one element at a time; `__copy__` and `__deepcopy__` return the wrapper, so `dataclasses.asdict` — which deep-copies every leaf — **cannot unwrap it**; and a single explicit accessor is the only way to the content, written at the call site so the legitimate uses stay greppable. **The type is WP70's, reused, not re-derived** — one class in the package, relocated at most (§3 Verification 5), with `relay.Secret` still resolving to it. **A handwritten `__repr__` on the dataclass does NOT satisfy this criterion**, and the reason is measured rather than asserted: the landed `_CommunityState` repair is exactly that shape and `dataclasses.asdict` walks straight past it (§3 Verification 3).
   - **Vacuous if:** the test asserts a sentinel is absent from `repr()` alone. `repr` is one of at least seven paths and it is the one a handwritten fix already closes. **Also vacuous if** the object under test never held the sentinel — see AC5's positive control, which is not optional.
2. **The byte-exact borrow and restore oracles still compare content, and each is shown to still fail when the content differs.** Every comparison, length and hash that reads the borrowed bytes today — the splice input, the backup write, the recorded original size, and `restore_port`'s sha256-**and**-exact-length verification — continues to decide on the **content**. Where a comparison now sits behind the wrapper, it is expressed over the explicit accessor (a sha256 over the revealed bytes is correct); **a comparison that resolves to a wrapper-identity check, or that compares two wrappers and reports equal because both are wrappers, is a broken oracle and is an abort criterion, not an implementation detail.** `restore_port` remains independent of the modify path, no parse/serialise round trip is introduced, and the no-prior-file case still restores to no file at all.
   - **Vacuous if:** the restore tests are run only on the happy path. **Each touched comparison must be shown to go red under a one-byte perturbation of the content** — that is the only evidence distinguishing "still compares content" from "now compares wrappers and always agrees".
3. **The defect class is closed across the package, not repaired at its one reported instance.** The sibling record that holds the owner's plugin bundle behind a generated repr (`install.BundleState`) is closed by the same type, and the partially-repaired record (`provisioning._CommunityState`) has its remaining `dataclasses.asdict` hole closed by the same type rather than by a second handwritten method. **The precedent for insisting on this is WP70's own:** its `_run_case`-shaped repair scoped to the reported count left the worst sites open, and this run has now made the same correction five times. The record that is a different subject rather than the same defect (`readiness.RawAnswer`) is **named, justified and carried up**, not silently swept in and not silently omitted.
   - **Vacuous if:** the sweep is delivered as a claim ("checked, none others") without the enumeration it was derived from. The report must name **every** dataclass in the package that carries a `bytes`-typed or credential-named field, with its disposition, so a later reader can tell an absence from an oversight.
4. **`ports.py` no longer downgrades a redacted member set to a plain `dict`.** The member set handed to `provision_port` keeps its rendering protection through the module: a `RedactedMapping` in is a mapping that still redacts when it reaches `_with_port` and when it sits as a local in either frame. **Subscripting, iteration, ordering and the emitted JSON are unchanged** — this closes the rendering path, not the use — so `_with_port`'s textual splice, its member ordering, its `json.dumps` value emission and its byte-identity property are bit-for-bit what they were. The empty-member-set refusal and the `None`-means-provision-the-port-only default keep their present behaviour.
   - **Vacuous if:** the test passes a plain `dict` in and asserts the output is redacted — that tests nothing about the downgrade. **The test must pass a `RedactedMapping` carrying a sentinel under a secret-bearing key and assert the sentinel is absent from the rendering of the value at the point it reaches the splice**, with a positive control proving the sentinel is retrievable by subscript at that same point.
5. **Every criterion is falsified separately and headless, with a positive control first, no Obsidian, no vault and no socket.** The whole verification runs against synthetic fixtures under `tmp_path` in-process. For each criterion, one injection at a time with the rest unchanged, each recorded as **not a pass** under the repaired code and shown to produce the pre-repair outcome against a byte copy of the pre-repair code under an identical harness: **(i)** each of the six unconditional render paths — `repr`, `str`, `format`, `%s`, `dataclasses.asdict`, and a deliberately-failed `pytest` comparison at `-vv` — over an object **proved** to hold the sentinel; **(ii)** a one-byte perturbation of the borrowed content, which must carry each touched comparison to a failure; **(iii)** an `asdict` over the record whose handwritten repr already passes the `repr` check, which must **not** yield the sentinel after the repair and must be shown to yield it before; **(iv)** a `RedactedMapping` sentinel through `provision_port`, absent from every rendering and present under subscript. **The positive control is a criterion, not a courtesy:** every absence assertion is preceded, in the same test, by an assertion that the sentinel **is** in the object — an absence test over an object that never held the value passes trivially and is the exact hollow-fixture class WP66 exists to sweep. Injections are targeted, never global (rule 2), and the report states whether neighbouring behaviour stayed green. **A perturbation that changes nothing is a finding, not a null result.**
   - **Vacuous if:** the "before" harness is not a byte copy of the pre-repair code, or if the positive control and the absence assertion live in different tests — a positive control that can be skipped independently of the assertion it licenses is not a control.

**Definition of Done:** the owner's credentials cannot be rendered by any general-purpose stringification in this package, the proof that their file comes back byte-exact is unweakened and demonstrably still able to fail, and no test in this WP could pass over an object that never held the value.

---

## 5. Constraints and Known Risks

- **Permission / environment limits:** Windows dev host. Python, standard library only, run from the workspace root with the workspace venv. The package has **no** pytest configuration file and **no** `conftest.py` — measured — so nothing is enabled by default. Long-running invocations through `visible-console` `run_python` with an absolute script path, never a Bash background process. No Graphify graph exists for this project (declared FALLBACK mode).

- **Known risks specific to this WP:**
  - **⚠ The most likely wrong implementation is the handwritten `__repr__`, and there is a landed example of it failing in this very package.** It is the obvious fix, it closes the one path the escalation names, and `dataclasses.asdict` walks straight past it — measured against `provisioning._CommunityState` (§3 Verification 3). **If the diff for AC1 consists of `repr=False` plus a `def __repr__`, the WP is wrong.**
  - **⚠ The second most likely wrong implementation is a broken byte oracle that stays green.** Wrapping the field and leaving `a.original_bytes == b.original_bytes` in place gives a comparison that may compare wrappers, may compare identities, and will agree far more often than the content does. **A restore oracle that cannot fail is strictly worse than the leak** — it is the failure mode the entire run exists to eliminate, applied to the one check that stands between a run and the owner's data. AC2's per-comparison perturbation is the guard and it is not optional.
  - **⚠ The third is the absence test with no positive control.** `assert SENTINEL not in repr(state)` passes if `state` is empty, if the fixture wrote a different key, if the field is `None`, and if `capture_state` silently returned the no-marker shape. **Every absence assertion is preceded in the same test by its positive control.**
  - **⚠ Do not import `relay` from `ports`.** `relay.py:88` already imports from `ports`, so the reverse closes a cycle and breaks the package at import time for `provisioning.py` and `teardown.py`. §3 Verification 5 names the two admissible shapes; **a third is an ESCALATE**, and so is any relocation that leaves `relay.Secret` unresolvable or duplicates the class.
  - **⚠ Do not change what the module does.** WP77 changes how a value is held. Provisioning behaviour, restore behaviour, the marker's field set, the four legal borrow shapes and the failure-reason mapping are WP44's and are `DONE`. **A behavioural change is an ESCALATE.**
  - **⚠ Do not put a real value anywhere, ever.** Not in a fixture, not in a test name, not in a report, not in a commit message, not in an error message, not in a comparison the rig prints. Sentinels are obviously-synthetic literals. `data.json` is compared by sha256 of bytes only. **Naming the *keys* is fine — the workspace docs and `constants.py` already do. Naming a *value* is not.**
  - **⚠ The leak has never fired, and that is not a mitigation.** No control endpoint has ever answered on this host, no gate has run, and every `BorrowState` ever constructed has held fixture bytes under `tmp_path`. **WP7 is the first execution that points `capture_state` at the owner's real vaults**, and it is agent-mediated, so its output reaches a transcript. That is the ordering ruling in §2, and it is the whole reason this is a work package rather than a note.
  - **⚠ No statement about a live Obsidian instance, a real vault or a gate result may appear in any artefact of this WP.** Nothing here is verified against one and nothing needs to be.

### Recorded, not repaired — this WP's own sweep

*None of the following is in WP77's scope. Each is recorded so it is not rediscovered as a finding, with its owner named where one exists.*

- **S12 — the handwritten-repr repair is already landed and already insufficient.** `provisioning._CommunityState` (`:685-709`) carries `repr=False` and a handwritten `__repr__`/`__str__` that print the fingerprint and the size. Measured: `repr()` is clean, `dataclasses.asdict()` returns the raw bytes. **Not carried up — it is an input to AC1 and AC3 and is repaired here**, because it is the same defect class in the same package and a sweep that left it would be the scoped-to-the-reported-count failure this run has corrected five times. `community-plugins.json` is an enabled-plugin list, so the *disclosure* severity is low; the *evidentiary* value is high, because it is the audit-versus-type argument demonstrated on a real landed attempt.
- **S13 — `ports.py:677` downgrades a `RedactedMapping` to a plain `dict`.** WP70 built that mapping precisely so a caller debugging a provisioning cannot print the minted room token; `dict(members)` constructs a plain `dict` and the protection is gone, in two live frames. **Not carried up — it is AC4**, because it is a credential-disclosure defect in this WP's own file and class. **WP70 is not re-opened:** WP70's code is correct and this is an inherited line in a module WP70's boundary excluded, which is the identical relationship WP77 itself has to WP70's tp02 finding.
- **S14 — `readiness.RawAnswer.body` holds a raw HTTP response body behind a generated repr.** `readiness.py:107-123`; constructed at `:204`, `:210`, `:212`; consumed by `_parse_session_info` (`:220-237`). It is the same *shape* — bytes in a dataclass field — and it leaks on the same six paths. It is **not** the same *subject*: it carries what a control endpoint answered, not a file borrowed from the owner, and its consumers are a different contract. **Whether a control endpoint can ever answer with a credential-bearing value has NOT been established here and is not claimed** — the driver's `session.info` payload is WP75's subject and `canvas.file` returns canvas content, neither of which is a `data.json` value; but no exhaustive proof was attempted. **Carried up. Owner: none assigned.** A reader deciding it needs one should note it is the only remaining member of the class after this WP.
- **S16 — the package has no pytest configuration of any kind.** No `pytest.ini`, `pyproject.toml`, `setup.cfg`, `tox.ini` or `conftest.py` anywhere in the repository — measured. Consequence recorded so it is not mistaken for an oversight: there is **no** `addopts`, so `--showlocals` is not on, and the traceback-frame-locals vector is genuinely conditional today. It is also a standing hazard — **anyone adding `addopts = --showlocals` to a future config would silently turn a conditional vector into an unconditional one across the whole suite.** Closed by AC1 either way, since a value that refuses to render refuses in a frame local too. **Owner: none assigned; inventory note.**

- **Known flaky patterns:**
  - No wall-clock sleeps. Every wait is bounded and names the condition it was waiting for on expiry.
  - Do not assert on log strings as the primary oracle; state is the oracle.
  - A test that asserts an absence is suspect by default. Ask what it would take for it to fail, and write that down.
- **External dependency risks:** none permitted. `ports.py` is standard library plus `constants` and stays that way. If a dependency looks unavoidable, that is an ESCALATE, not a judgement call.
- **Hard constraints:**
  - **The byte-exact restore oracle is not weakened by one bit, and every touched comparison is shown to still fail on a one-byte perturbation.**
  - **One `Secret` class in the package.** WP70 defines it; WP77 relocates the definition site at most. A second definition is an abort criterion.
  - **`ports.py` never imports `relay.py`** — the reverse edge already exists at `relay.py:88`.
  - **`relay.Secret`, `relay.REDACTED`, `relay.RedactedMapping` and `relay.SECRET_BEARING_KEYS` all still resolve**, to the same objects, after any relocation; `relay.__all__` loses no name; `SECRET_BEARING_KEYS` is still `constants.SECRET_SETTINGS_KEYS`, never a second list; `constants.py:506-507`'s drift guard still fails at import rather than at a leak.
  - **No behavioural change to provisioning or restore**, no parse/serialise round trip on the restore path, no change to `PROVISION_MARKER_FIELDS`, no `ProvisionError` message gains content, and `os.environ` still does not appear in `ports.py`.
  - **Every absence assertion carries its positive control in the same test.**
  - **No real credential value in any fixture, test, artefact, error message or commit message**, and no file in either owner vault is read or pointed at.
  - **No file outside `tools/obsidian_e2e/` is modified**; no `plugin/**`, no `server/**`, no `tools/MCPserver/**`; **no test suite is mirrored into `plugin/src/__tests__/`**.
  - No existing test is deleted, weakened, retitled, skipped or amended. **WP77 holds no §7 licence of any class**; an unenumerated deletion or assertion rewrite is an abort criterion.
  - **No secret through an agent tool**, in any command string, script argument or commit message.

---

## 6. Definition of Done Artifacts

- **Required changed files:**
  - `tools/obsidian_e2e/ports.py` — this repo, branch `fix-bugs-and-raceconditions`
  - `tools/obsidian_e2e/install.py`
  - `tools/obsidian_e2e/provisioning.py`
  - `tools/obsidian_e2e/relay.py` and/or `tools/obsidian_e2e/constants.py` — **only** as required by the §3 Verification 5 relocation, and only to move and re-export, never to redefine
- **Required report:** `ImplementationReport_WP77.md` (in `workflowArtifacts/canvas-v2/`), which must additionally record: the **complete enumeration** of every dataclass in `tools/obsidian_e2e/` carrying a `bytes`-typed or credential-named field, with each one's disposition (repaired / carried up / already closed) and the reason, so an absence is distinguishable from an oversight; which of the two admissible relocation shapes was taken and the evidence that `relay.Secret` and its three siblings still resolve to the same objects with `relay.__all__` intact; **for every comparison that reads the borrowed bytes, the before/after of a one-byte perturbation**, proving the oracle still fails on differing content rather than agreeing because both sides are wrappers; the AC5 falsification in full, per injection, naming the pre-repair and post-repair result for each and stating explicitly that the "before" harness was a **byte copy** of the pre-repair code; an explicit statement that **every absence assertion is preceded by its positive control in the same test**, with the mechanism named; an explicit statement that **no value from either owner vault was read, printed, hashed into this report, or placed in a fixture**, and that every sentinel is a synthetic literal; confirmation that nothing outside `tools/obsidian_e2e/` was modified and that no suite was mirrored into `plugin/src/__tests__/`; and a statement that **no live Obsidian instance, no real vault and no gate result is involved or claimed**.
- **BUILD_SPEC updates required:** no — the §9 row and the header count were entered when this charter was written. Anything further is an ESCALATE rather than a spec edit.
- **Gate status required at handover:** the WP's own headless verification script passes, launched through `visible-console` `run_python` with an absolute path. `npm run build` and `npm test` from `plugin/` are **unaffected by this WP** and must be shown still green — this WP adds no TypeScript, so an unchanged result is the expected evidence, not a formality.

---

## 7. Visible Test Cases / Producer Artifacts

*Filled by Worker 3's Unit Test Sub-Agent. Worker 2 leaves this section empty.*

---

## 7b. W4 Test Targets (filled by Worker 3's Unit Test Sub-Agent, if any)

*Empty at handover.*

---

## 8. Autonomous Execution Plan (filled by Coder Sub-Agent, attempt 1)

- **Observed current behavior:**
- **Approach:**
- **Fallback path if all attempts fail:**

---

## 9. Handover Summary (filled by Coder Sub-Agent on completion)

- **What is complete:**
- **What remains open:**
- **Final status:**

---

## 10. Risk Notes for Worker 4 (filled by Worker 3 Core)

*Empty at handover.*
