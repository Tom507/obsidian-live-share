# Signal Register — canonical allocation authority

> **This file is the register.** `DISPATCHER_STATE.md` and the development reports *cite* signals; they no
> longer define them. Where they disagree with this file, this file wins.
>
> **Enforced by `check_signal_register.py`** — not by anybody remembering. That is the entire point of this
> file existing, and §4 explains why.

---

## 0. Why this file exists

The register has been declared repaired **twice** and broken **both times**.

- Round 1: two batches allocated independently and **five numbers collided** (S25, S28, S29, S30, S31). The
  fix was a rule — *"S42+ are globally unique and allocated by the Dispatcher only"*.
- Round 2, **after** that rule: **S50, S56 and S57 each collided again**, and **S58 and S60 were never
  allocated at all**. `DISPATCHER_STATE:1874` even recorded a *third* S50 misuse and allocated S54 for it,
  while leaving the two live S50 entries undisambiguated.

The rule was correct and it did not work, because **a rule with no instrument is a hope**. Development
Report II's judgement, which I accept: *a register with duplicate keys is not a register* — the identifier
stopped distinguishing the things it names, and nothing detected that until a fourth party tried to use it.

**This is the "green test that cannot fail" class relocated into bookkeeping.** The register asserted
uniqueness; nothing ever evaluated the assertion. §4 is the evaluation.

---

## 1. Allocation rule

| | |
|---|---|
| **Next free number** | **S62** |
| **Who may allocate** | The **Dispatcher only**. A worker that finds something new **describes it and asks**; it does not pick a number. |
| **Never reused** | A number is burned forever once used, **withdrawn, or skipped**. See §3. |
| **Citation form** | Bare `S<n>` is legal **only** for the numbers not listed in §2. |

**Why numbers are never reclaimed, including ones that were never used:** a reader holding an older
charter, commit message or code comment cannot tell a *fresh* allocation from a *stale* one. This is the
WP65 / WP84 lesson — WP84 was refused as subsumed and its row recorded as `withdrawn` precisely so the
number could not be silently re-used. Reclaiming a skipped number is the same failure with a cheaper alibi.

---

## 2. AMBIGUOUS NUMBERS — bare citation is a defect in the citing document

Each of these names **two different things**. Renumbering is **not** the fix: these identifiers are already
committed in charters, implementation reports, commit messages and source comments, and rewriting the
register would silently re-point live citations at the wrong finding. The **qualifier** is canonical
instead, in the form Development Report II already uses: `S50(WP86)`, `S56(liveness)`.

### 2.1 Round 1 — the B20 set vs. the WP37/WP79 report set

| bare | ✅ qualified | meaning |
|---|---|---|
| S25 | `S25(host-churn)` | server-side host-identity churn |
| | `S25(fileops)` | `FileOpsManager.onFileCreate` — the fifth unguarded door → **WP83** |
| S28 | `S28(manifest)` | a per-file read failure in `publishManifest` becomes a deletion → **subsumed by WP80** |
| | `S28(no-leaf)` | `canvas.open` opens no leaf, so no disk writer attaches → **superseded by S45** |
| S29 | `S29(logger)` | the logger silence — **FALSIFIED**, see §3 |
| | `S29(converge)` | an open canvas does not converge to the file → **WP85** |
| S30 | `S30(debuglog)` | unbounded debug-log growth — **OPEN** |
| | `S30(13-18)` | the canvas E2E reading 13/18 — **retired**, it was S45 |
| S31 | `S31(dupblocks)` | duplicated historical blocks in the logs |
| | `S31(selector)` | a canvas editor is unreachable via a `contenteditable` selector |

### 2.2 Round 2 — allocated *after* the rule that was supposed to prevent this

| bare | ✅ qualified | meaning | status |
|---|---|---|---|
| S50 | `S50(WP86)` | producer 5's **producing** side: a parent-directory entry is still retired when a folder stops being empty | **OPEN**, unowned |
| | `S50(mirror)` | the mirror pass runs its **host arm after a demotion is already decided** | raised by WP85 |
| | ~~`S50(third)`~~ | a third misuse — **already re-keyed to S54** | closed |
| S56 | `S56(liveness)` | 116 of 197 waits are a bare `sleep` | **partly closed** by B39 `364d7c3`; residue is Tier 4 |
| | `S56(WP87)` | a guest's open canvas never received a `CanvasAdapter`, so WP37's protection was structurally inert there | instance repaired; **class unowned** |
| S57 | `S57(shadow)` | a substituted record advanced the Surface-Shadow to the user's **unflushed** editor text | |
| | `S57(installer)` | installed bytes are **not** evidence of loaded bytes | **OPEN**; every install-then-measure rests on it |

**`S1`–`S41` inherit the round-1 rule**: cite with the source document, never bare, unless listed above
with a qualifier.

---

## 3. Burned numbers — allocate none of these

| number | why burned |
|---|---|
| **S58** | never allocated. A gap in a sequence that batches were allocating from concurrently cannot be proved unused — an uncommitted transcript may hold it. |
| **S60** | never allocated. Same reason. |
| **S29(logger)** | **the finding itself was falsified.** The debug logger never went silent; `liveshare_fix_debuglog.py` had moved the file an hour before the reported stop, so every later reader watched a path that no longer existed. **Two batches "independently reproduced" it** — they inherited the premise from the brief. The number stays burned so the falsification is not lost. |
| **S45** | not burned — **live and load-bearing.** Recorded here because it *supersedes* three earlier readings: `canvas.open` subscribes without opening a leaf and permanently disables the writer-attach seam, so `S28(no-leaf)`, `S30(13-18)` and the 19/19 and 13/18 canvas figures were all **the suite measuring itself**. |

---

## 4. The instrument

`check_signal_register.py`, beside this file. It greps the canvas-v2 corpus and **exits non-zero** on:

1. a **bare** citation of any number listed in §2;
2. a citation of any number in §3;
3. a citation **at or above** the next-free number in §1 — i.e. an allocation this file does not know about,
   which is exactly the event that broke the register twice.

**It carries a positive control.** Before reporting anything it plants each of the three violations in an
in-memory sample and requires all three to be caught; if the control does not fire it exits non-zero with
`POSITIVE CONTROL FAILED` and reports nothing. **A census that returns "0 violations" without having proved
it can find one is not a measurement** — this run has produced twelve-plus instances of that class across
eight surfaces, and a checker written to police the bookkeeping is the last place to add a thirteenth.

**Known and deliberate limits**, stated rather than discovered later:

- It checks **citation hygiene**, not truth. It cannot tell whether `S50(WP86)` describes what §2 says it
  describes. Nothing automatic can.
- It reads the corpus, **not** git history. Numbers cited only in commit messages are invisible to it.
- Prose that *discusses* the collisions must be able to say `S50` bare. Lines are exempt when they carry an
  explicit marker (§5), so the exemption is a decision recorded in the text, not a silent tolerance.

---

## 5. How to cite

```text
✅  S50(WP86) — producer 5's producing side is still unowned
✅  S61 — getEditingNodeId() over-reports          (S61 is unambiguous)
✅  WP85 fixed it                                   (a finding that became a WP is cited by WP number)
❌  S50 — the producing-side fix                    (which S50?)
❌  S62 — <anything>                                (not allocated; ask the Dispatcher)
```

To write about an ambiguous number as a *number* — as this file and the reports do — mark the line
`<!-- signal-register: meta -->` or put it inside a fenced block. Both are exempt.
