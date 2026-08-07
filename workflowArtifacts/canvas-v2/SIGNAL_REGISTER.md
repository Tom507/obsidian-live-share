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
| **Next free number** | **S74** |
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

## 3a. Allocations made under this register

The first entries allocated the way §1 requires — described by the finder, numbered by the Dispatcher.

| signal | finding | status |
|---|---|---|
| **S62** | `readiness.RawAnswer.body` renders an **unbounded, externally-supplied** byte string verbatim on `repr`/`str`/`asdict`. Not a credential — the probe sends a frozen `session.info` body and that response carries none — but the probe knows a **port**, not a peer. Under `S57(installer)`, where something else answers where the rig assumed the plugin, that third party's bytes reach any diagnostic that renders the record. | **open**, low severity, recorded not fixed. Supersedes the withdrawn open-item 20 in Development Report II. |
| **S63** | **WP90's durable store keys by `diskPath` (`toLocalPath(canonical)`), which on Windows maps a few ASCII characters to fullwidth.** Stable per machine. A vault carried between Windows and macOS keys those paths differently, so the standing withhold is **not found** and the next cold open projects the doc over the user's file. | **open.** The mechanism WP90 built to stop I11 expiring with the *session* still expires with the *platform*, and silently. Reported by the implementor. |
| **S64** | **WP90's store writes are fire-and-forget**; nothing awaits `store.idle()` at plugin unload. A refusal recorded microseconds before a hard kill is lost. | **open**, low severity. Strictly no worse than WP63, which had no durability at all — but it is a real window and it is now the only one. |

| **S65** | **The debug log's stamp-to-flush lag reached ~58 s.** Every offset-based receipt reader in `H:\tmp` uses a **2–2.5 s** margin, so each one reads zero lines and reports the absence as a result. | **open, and the most serious of this block.** It does not merely threaten future measurements — it means any past conclusion of the form *"the signature never fired"* may have been reading a file the writer had not flushed. Caught only by the Rule 15 guard that requires a grep to prove it can match its target first. |
| **S66** | **`link.break shape="close"` is not a break.** A run scored **29/29 with the link nominally severed**; `autoReconnect` reversed it before anything could fail. | **open.** A negative control that cannot fail is worth less than no control, because it is quoted as evidence. `shape="mux"` does break the link — 15/29 with all fourteen dependent checks red. |
| **S67** | **The repo's committed `plugin/main.js` is not the installed bundle** (`85a29c85` vs `b672be50`). Anyone running the installer without `LS_EXPECT_SHA256` **silently changes the code under measurement**. | **open.** Distinct from `S57(installer)`, which is *installed bytes are not loaded bytes*; this is *committed bytes are not installed bytes*. Both are live, and they compose. |

| **S68** | **A SECOND re-arming settle window that B44 did not cite.** `noteExternalDiskWrite` (`canvas-sync.ts:3969-3977`) clears and re-arms its own independent `VAULT_EVENT_SETTLE_MS = 250` timer per write, the same shape as `armSettleRelease` and fed by the same `main.ts:2903` `onWritten` wiring. **Two** 250 ms timers are held across the burst, not one. | **open, and it scopes WP91.** A fix confined to `CanvasPersistence` bounds one window and leaves the other, so the swallow survives at roughly half the width — the most expensive kind of partial fix, because the measurement moves and the defect does not go. Found by B47 while chartering. |

| **S69** | **`onFileCreate` announces a sidecar FOLDER on the wire.** Its `folder-create` emit sits **above** the `skipsAutoTextSync` guard, so a folder under the sidecar dir is emitted verbatim. | **open.** It does **not** compose into a write — the inbound `folder-create` is refused by the strict all-paths gate — but it **publishes the existence and the name of a local replica-state directory to every peer**. Same surface WP68 exists to close, one op type over. Found by B46 while building `tp04`. |
| **S70** | **`wp88/test_ac1_route_census_derived_visible.test.ts` pins a whole-TEST-TREE property**: exactly one file in `plugin/src/__tests__/` may contain the literal `endSession`. | **open, and it will bite the next batch.** Any new suite with an inert teardown stub on a fake plugin reddens it, **and the failure names WP88 rather than the new suite** — so the batch that trips it looks for a defect in code it did not touch. It caught B46, which removed its stub rather than amend the pin. A census over a corpus other people are still writing needs an exemption mechanism or a failure message that names the newcomer. |

| **S71** | **The renderer's timers are clamped to 60.00 s ± 0.02.** Measured over 84 batches on both live vaults: flush lag `min 0.011 / median 0.988 / p90 59.986 / max 60.823 s`, with **44 % at 0.50–0.60 s** and **26 % at 40–61 s**. The floor matches `FLUSH_DELAY_MS = 500` to the millisecond, so the constant is honoured in the normal regime. **The cause is not the logger:** `SyncManager`'s `setInterval(4000)` stretches to 60.00 s at the same moments, in a different module, and reports it itself — `AWARENESS GAP: 59998ms … source=tick`. Two independent timers clamped simultaneously to a whole minute is a **host wake-up clamp**, not I/O. | **open, and it is the widest of these.** It is **bigger than S65, which found it**: every `setTimeout`-derived guarantee in the product is exposed, including WP91's settle-window ceiling. Historically ~0.7 % of 18 600 pulses — a **fat tail, not the steady state**, which is exactly why nothing caught it. Cause not confirmed: doing so needs a window-focus change on a rig a sibling was using, and B49 declined to take it. |
| **S72** | **The awareness prune window is 30 s against a measured 60 s pulse gap.** Under S71's clamp **a live peer is routinely older than its own prune horizon.** | **open, product-facing.** A peer that is present, connected and healthy can be pruned as stale because the host's clock stretched, not because the peer went away. This is the presence layer's version of *absence of information translated into a destructive action*. |
| **S73** | **`SEED REFUSED:` has NEVER fired.** Zero occurrences across **79 185 lines** in both vaults' entire retained history — verified by the Dispatcher — while `CANVAS WRITER:` fires 975 / 821 times in the same files, so the sink works and the canvas path is live. `SEED RESTORED:` and `SEED REFUSAL STORE:` are also zero. | **open, and it is the one to resolve before trusting WP63 or WP90.** Two readings, and nothing on hand distinguishes them: either no malformed record has ever been present (benign, and likely, since the fixtures are well-formed) **or the refusal path is unreachable in the live wiring** — in which case two work packages, one of them *the oldest open P0*, protect against something that cannot happen. **Either way the mechanism has zero live evidence.** W4 must plant a malformed record and produce a live `SEED REFUSED:`; until it does, no absence claim on that signature is admissible and WP90's own AC1 RED remains unrun. |

**S68's arithmetic closes, and that is a falsifiable prediction rather than a flourish:**
`MAX_WAIT_MS = 500` (`canvas-sync.ts:309`) + `DISK_WRITE_SETTLE_MS = 250` = **750 ms**, against a measured
boundary of lost ≤ 0.8 s / OK ≥ 0.9 s. **If the implementor measures a materially higher ceiling, there is
a third timer nobody has found**, and that is how they will know.

**S63 is the one to schedule** of the WP90 block. It is the same defect as WP90's own premise — *a protection with a lifetime is
not "never", it is "not yet"* — surviving the repair with its lifetime rewritten from "the session" to "the
platform". A durable I11 protection that evaporates when the vault moves machines is the failure mode the
work package exists to prevent, and the loss is silent: nothing reports a store entry that was never matched.

**Why this one is worth reading as a method note:** open-item 20 asserted a credential leak in this field
and called it unowned. Both halves were false — WP77 had enumerated the class, ruled this member a
deliberate carry-up under `S14`, and pinned it with a test asserting it is *still renderable*, precisely so
a later reader could tell a decision from an oversight. **That pin worked.** The finding survived contact
with the check, shrank to its true size, and got a number of its own instead of re-opening a settled one.

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
