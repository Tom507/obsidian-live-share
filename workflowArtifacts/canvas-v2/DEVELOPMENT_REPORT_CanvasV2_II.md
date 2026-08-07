# Development Report II — Canvas V2

**Subject:** everything that changed since `DEVELOPMENT_REPORT_CanvasV2.md` (`eb82767`, 2026-08-04) —
the first real Obsidian runs, the work that landed because of them, the claims those runs falsified,
and what a reader must not assume is finished.
**Date:** 2026-08-05 · **Branch:** `fix-bugs-and-raceconditions` · **HEAD at writing:** `5947d63`
**Predecessor:** `DEVELOPMENT_REPORT_CanvasV2.md`. This report is its **successor, not its replacement**;
its §1–§5 are still the record of drift from CONCEPT_V2 and are not restated here.

> **Tree note.** A sibling batch was live in this repo throughout. HEAD moved **twice** while this report
> was being written — `df2c672` → `5947d63` (between my first and second git call) → `364d7c3` (B39's
> sleep-as-wait sweep, which landed after §4 was drafted and **changed a number in it**; folded in at
> §4.2 and §7). All my own measurements were taken at `5947d63`, and every one names its commit.
> `workflowArtifacts/canvas-v2/WORKFLOW_ANALYSIS.md` is untracked and is not mine.

---

## 0. Provenance — what in this report I verified, and what I took from someone else

The predecessor's most valuable property was that it marked its own weakest section. That property is
kept, and this time the weakest section is a different one.

| Part | Provenance | Confidence |
|---|---|---|
| §1 The answer to the owner's question | My reading of the evidence in §2–§9. It is an argument, not a measurement | Judgement |
| §2 What shipped | **Independently verified.** 14 WP implementation reports + 5 non-WP deliverables enumerated by `git diff --name-status eb82767..HEAD`; all commit hashes resolved; all 87 charters listed from disk | High — primary artefacts |
| §3 What the first real run cost and returned | **Mixed.** The vault-side cost is **measured live by me today** (bundle size, plugin enable list, backup files, leftover fixtures, relay `/healthz`). The defect narrative is the batches' own reports | High for the cost, Medium for the narrative |
| §4 The numbers | **Measured live by me** for the unit suite (detached worktree at HEAD), the test-file counts (`git ls-tree`), `tsc`, and the WP-package recount. The canvas E2E figures are **quoted, not re-measured** — running them is out of scope | High for unit and the recount; **21/21 is a quotation, and §4.2b qualifies it** |
| §5 Defect classes | **The batches' own accounts**, cross-read against the state file. Not independently re-derived | Medium |
| §6 Corrections to earlier claims | Split. §6.1–§6.6 are the run's own recorded corrections (its account). **§6.7–§6.10 are mine, measured today against the tree** | High for §6.7–§6.10, Medium for the rest |
| §7 What is still open | **The Dispatcher's own account**, re-keyed and ranked by me. **This is the section to distrust** — it is assembled from a 2 123-line append-only file whose signal register has collided three times, so items may be duplicated under different keys or missing entirely | **Low–Medium. See the warning in §7** |
| §8 What is not established | **Independently verified** — charter statuses read from disk, absence of implementation reports, gate driver history | High |
| §9 Where the approach cost more than it returned | Dispatcher-adjacent judgement, mine | Judgement |

**§7 is the section to distrust**, and for a sharper reason than §2 of the predecessor. That section's
warning was *"an audit was cancelled, so the list may be incomplete."* This one's is worse: the register
the open items are keyed by is **provably broken** (§6.9), so two entries under `S50` are two different
findings and an entry may have been overwritten rather than merely omitted. An independent sweep is still
worth running, and it is now worth running *against the tree*, not against this file.

**What I measured myself, and when.** All on 2026-08-05, 12:30–12:50, at HEAD `5947d63`:
the unit suite and `tsc` in a fresh detached worktree at `H:/tmp/b40-report-verify`; `git` history and
file censuses; the two owner vaults' plugin directory listings and enable lists; boolean-only probes of
`data.json` (no value read, printed or stored); `GET /healthz` on the relay; and the source-line checks
in §6.7–§6.10. **No code was edited, no E2E script was run, no vault content was modified, and no
Obsidian instance was started or stopped.**

---

## 1. The owner's question, answered with the current evidence

The owner asked earlier why so much effort had produced so little visible product. The predecessor's
honest answer was: *because the effort went into discovering that the project's own evidence was not
evidence.* That answer was true and is now **incomplete, and its replacement is the single most
interesting thing in this report.**

**The real answer is that the product had never been run.**

On 2026-08-05 the plugin was installed into two real Obsidian vaults against the live relay for the
first time. Within minutes it produced a defect that **1 856 headless tests had never seen**: a canvas
that exists on the host never reaches the guest at all, because the only materialiser runs on open and
open requires the file. Within hours it produced **actual destruction of files on a real vault**. Neither
was a regression. Neither was subtle. Both had been sitting in a tree that was 1 856-for-1 856 green.

Since then, in one day, **14 work packages and 5 ruled sweeps landed**, and near enough all of them fixed
something the headless suite could not see. The two symptoms the owner had personally reported —
*"manchmal verschluckt er noch Buchstaben"* and no canvas on the guest — are **both closed and
demonstrated on two live editors**, character for character (`kolla1bo2ration` on both peers, both
files) and 0/3 → 3/3.

So the corrected answer is not *"the effort was spent on verification"*. It is:

> **The run had built a correct-looking product and an elaborate apparatus for doubting its tests, and
> the one cheap thing it had not done was start the program. An afternoon of running it returned more
> user-visible defects than weeks of headless verification, and the verification apparatus itself turned
> out to contain the defect it was built to find — at least twelve times, on eight distinct surfaces,
> including the anti-vacuity instrument, the rig, the installer, the console layer beneath the tests,
> and a diagnosis.**

That is a better answer than the predecessor's, and it is also a harsher one, because the corrective was
available at any point for the price of an afternoon.

**The counterweight, stated here so it is not buried:** the gate that would make *"it works"* an
automatic, reproducible verdict is **still unrun**, and the validation that replaced it is ~28 ad-hoc
scripts in `H:\tmp` which are, by the run's own liveness census, the *least* disciplined instruments in
the project (§9.2). The product is demonstrably alive; it is not demonstrably correct.

---

## 2. What shipped, and what it fixed

Measured: `git diff --name-status eb82767..HEAD` over `workflowArtifacts/canvas-v2/`. **98 commits ·
156 files changed · +45 862 / −774 lines.** Of `plugin/src`, **91 files**, of which **26 are production
source** and the rest tests.

### 2.1 The fourteen work packages

| WP | What it closed | Evidence class |
|---|---|---|
| **WP79** | A canvas that exists only on the host **never reaches a guest**. `startAll`'s manifest replay skips `.canvas`; `coldOpen` is the only materialiser and runs on open; open needs the file. A closed cycle | Live RED 0/3 → GREEN 3/3, production receipt from the guest's own log |
| **(D1/D2/D3)** | The data-loss chain. **Not a WP** — an emergency batch. A missing guest→host **promotion** (not a demotion) walks a session monotonically to **zero hosts**; a hostless guest then trashes every shared file absent from a manifest nobody published | Canary file **destroyed** on the unmodified tree, survives after |
| **WP80** | A peer **promoted before its initial sync completes** publishes a truncated purging manifest that passes all three of the new gates. *Evidence of authority is not evidence of completeness* | 4 MB canary destroyed RED; positive control still purges |
| **WP86** | **The other door.** `registerManifestChangeHandler` trashed the local file for a vanished manifest key, for **every peer**, with no role guard, no evidence gate, no `instanceof TFile`. This is the route that actually destroyed the file in WP80's RED run | Destroyed **a folder and its contents on both vaults**, RED |
| **WP83** | A shared `.canvas` travelling as **raw bytes** over the file-op channel under a mute the CRDT never sees — a wholesale LWW overwrite invisible to the doc | Live, 1.0 s, both directions |
| **WP82** | **Silent desync.** `connected` was a latch written at two mutually-exclusive role-gated sites; a promoted guest missed both. Every file op routed into an unbounded `OfflineQueue` with no edge that could drain it — while the status bar read `Live Share: hosting` | RED with **both sockets OPEN**, `fileOpsOnline=FALSE`, 90 s stable |
| **WP88** | **The give-up destroys the session.** A ~128 s outage cleared **six** settings keys, and on a host it first issues `DELETE /rooms` — one peer's Wi-Fi drop deletes the room for everyone | Live on the guest, ceiling evidenced by the peer's own counter |
| **WP81** | The debug sink clears its buffer **before** the append and swallows the rejection; a view-level control mutes the file sink | RED 24/8 → GREEN 32/32 |
| **WP36** | Card text becomes a nested `Y.Text`, merged three-way. Whole-string LWW is gone | `kolla1bo2ration` on both live peers |
| **WP37** | The editing-aware busy/blur guard. **The owner's dropped-keystroke defect** | RED 29/5 → GREEN 32/2, live |
| **WP38** | `Y.UndoManager`, with the `Y.Text` conversion excluded from the undo scope. **P4 complete** | 66/0/0 live, both role orders |
| **WP87** | A peer's **blur commit** destroys another peer's live editor. Attributed by receipt to R-C before a line of repair | C37 AC3 satisfied end to end |
| **WP77** | `data.json` bytes unrenderable **by type** (`Secret`, `RedactedMapping`, `__deepcopy__` returning the wrapper) | A handwritten clean `repr` alongside an `asdict()` that returned raw credentials |
| **WP78** | The spawning `runner` default removed; `import subprocess` made function-local to one opt-in runner | 2 spawn nodes pinned, 28 call sites, 0 unguarded |

### 2.2 The five ruled sweeps (not work packages)

- **Text-oracle migration (B32)** — 13 assertions reddened by WP36 re-oracled, each with an executed RED
  control. The proof that the replacement is *stronger*: on the pre-WP36 build the new oracles report
  **204 violations, 111 of them "TWO AUTHORS … ONE OF THEM LOST"**, and in that same band **zero**
  `sec` / `bytes` / `schema` violations. **The project's central thesis, measured rather than argued.**
- **Representation-blindness sweep (B35)** — **302 candidates derived** by AST + type-checker taint over
  425 files; **7 members of the class in total**, **0 harmless**, 2 live in product. The live one
  un-migrates a record at both production seed boundaries, destroying the CRDT history that makes the
  *next* concurrent edit merge — *"it merged once and then stopped merging."*
- **Liveness sweep (B37)** — **197 waits derived** across TypeScript and Python. **2 members that cannot
  complete**, both live: `control-ws.ts:278` and its previously unnamed twin `sync.ts:539`.
- **Data-loss chain report** — the emergency batch above.
- **Sleep-as-wait sweep (B39, `364d7c3`)** — landed *during* this report. **91 `SLEEP-ORACLE` rows** in
  the `H:\tmp` scripts (not the 86 the liveness sweep counted — the population **grew by 5 in 75 minutes**
  because siblings were editing the files while it was being measured), **91/91 classified**, 49
  converted to bounded polls with 45/45 executed failure controls. Its verdict is in §4.2 and it is not
  comfortable.

### 2.3 The one structural change that is not code

The owner replaced the workflow on 2026-08-05: *"W3 implementiert, keine blackbox tests mehr, wir
validieren mit W4 direkt im e2e modus."* **Blind sets, ledger rows and falsification injections are
discontinued for new work.** Existing ledger rows stand as history. Every WP from WP77 onward was
delivered under the new rule, and every one of them carries a live RED→GREEN pair on two Obsidian
instances. That change is the reason this report exists at all.

---

## 3. What the first real run cost, and what it returned

### 3.1 The cost, measured today

| | Measured 2026-08-05 12:40 |
|---|---|
| Both vaults' `main.js` | **4 531 099 B** — an **instrumented e2e bundle**, not a production build. The 0.6.1 bundle survives as `main.js.pre-v2-smoke` (626 711 B) |
| `community-plugins.json`, both vaults | `["live-share"]` — **`obsidian-git` is still disabled**. Backup `["obsidian-git","live-share"]` present as `.pre-v2-smoke` |
| `data.json` backups left behind | three per vault: `.pre-v2-smoke`, `.wp88-b34.pre`, `.wp88-b34.armed` |
| Leftover fixtures | **8 files per vault** in `_liveshare-test/` (`hello.md`, `smoke.canvas`, `second-*.canvas`, `wp37probe-*`, four `wp79-*`) |
| `sharedFolder` | non-empty and `== "_liveshare-test"` in **both** vaults (boolean probe; no value printed) |
| Relay | `GET /healthz` → **200**, uptime **1 693 314 s ≈ 19.6 d**, `sessions 1, documents 59, clients 2` — a session is **still open right now** |
| Files actually destroyed | vault B lost `hello.md` and `second.canvas`; later runs destroyed a 4 MB canary, and a shared **folder with its contents on both vaults** |

**The blast radius was contained by exactly one decision made hours earlier** — scoping `sharedFolder`
from `""` to `_liveshare-test`. `manifest.ts:712` still reads `if (!this.settings.sharedFolder) return
true;` — verified in the tree today — so with `""`, which is **what both owner vaults shipped with**, the
whole of vault B would have gone to the Recycle Bin. The step labelled *"THE safety step"* in a setup
script was the difference between a lost fixture and a lost vault. Nothing in the product enforced it.

**Restore path is intact but not exercised.** `python H:\tmp\liveshare_smoke_setup.py --restore` restores
`data.json`, `community-plugins.json` and `main.js` from the `.pre-v2-smoke` namespace with a byte-exact
check, and refuses while Obsidian runs. The three later `.wp88-b34.*` files and the eight fixtures are
outside that namespace and **will be left behind**. I did not run it.

### 3.2 The return

Everything in §2, plus this, which is the part worth generalising: **six of the fourteen work packages
exist only because someone opened the program.** WP79, WP80, WP82, WP83, WP86 and WP87 have no
plausible headless origin — each was found by watching a real editor do something wrong, and each was
then reproduced RED on the unmodified tree before repair. The five sweeps are second-order: four of
them exist because a *live* finding generalised.

**The exchange rate is the finding.** One afternoon of running the product against 1 856 green tests
yielded: one closed cycle that made canvas sharing impossible, three independent routes from a manifest
event to a destroyed user file, a raw-bytes door onto a CRDT-owned path, a connectivity latch that made
a peer silently offline while claiming to host, and a session-destroying give-up that a host's Wi-Fi drop
can trigger for every participant.

---

## 4. The numbers, and why they changed

### 4.1 The unit suite — I measured this

| | |
|---|---|
| Predecessor's figure | **303 files / 1 856 tests / 0 failed** at `eb82767` |
| **Measured by me at HEAD `5947d63`** | **347 files / 2 471 tests / 0 failed** |
| Method | fresh detached worktree `H:/tmp/b40-report-verify`, `plugin/node_modules` and `server/node_modules` symlinked from the main tree, `npx vitest run`, 12:35–12:36 |
| `tsc -noEmit -skipLibCheck` | **exit 0** in the same worktree |
| Test-file count, both ends | `git ls-tree -r --name-only <rev> -- plugin/src \| grep -c '\.test\.ts$'` → **303** at `eb82767`, **347** at HEAD |

**WP38's `2471 / 2471, 347 files` is exact.** It is the only figure in the state file I was able to
reproduce independently, and it reproduces to the test.

**A trap I walked into and am recording because the run has the same one.** My first worktree run
reported **2 456 / 345 files, 2 files failed to load** — `e2e/two-host.test.ts` and `wp5/latency.test.ts`,
which import from `server/` and cannot resolve `cors`/`express` in a worktree with no `server/node_modules`.
Those two files hold exactly **15 tests**. 2 456 + 15 = 2 471. **A detached-worktree measurement of this
suite is 15 tests short unless `server/node_modules` is linked too**, and it reports that shortfall as
two *failed files*, not as a smaller total. See §6.10 for where this bit the run.

### 4.2 The canvas E2E baseline — three numbers, one measurement

This is the number the brief flagged, and the history is worth stating precisely because two of the three
figures were never measurements of the product at all.

| Quoted | Where | What it actually was |
|---|---|---|
| **19/19** | data-loss chain report, WP79 report, `DISPATCHER_STATE:213`, `:281` | **Never a product measurement.** The suite reached its canvases via `canvas.open`, which subscribes **directly** — no leaf, no handover helper — and the leaf-open writer attach is gated on `!isSubscribed`, so calling it **permanently disabled the seam that would have attached the disk writer**. Every file-level assertion downstream measured the rig. Recorded as **S45** |
| **13/18** | WP37, WP80, WP83, WP86 reports; `DISPATCHER_STATE:584` | **The same artefact, one step worse.** WP85 measured it with a live probe: **both peers' docs byte-identical at 25 nodes while both files sat at 18–19**, no writer attached on either peer. WP85's own before/after was 12/18 → 13/18 **with the five failures identical name for name** — *no product change can move those rows while the suite reaches its canvases that way* |
| **21/21** | WP88 report §, WP87 report, `DISPATCHER_STATE:1987` | **The first product measurement.** Taken after S45's fix, once the preflight opens a **real leaf** via `canvas.typeInNode{open:true}`. It is **21 checks, not 19** — so the earlier figure was wrong in its *value and its count* |

**Two attributions were also wrong along the way, and both were corrected by measurement rather than
argument.** The Dispatcher first attributed 13/18 to WP82's connectivity latch; WP82 falsified that by
measuring it **with both peers `connected: true`**, which makes those five absences non-vacuous and
leaves the figure attributable to no WP. It was then handed to WP85 as a live question — *with the
instruction that establishing it is not WP85 would be as useful as establishing that it is*, which is
the right way to hand out a diagnosis and is the reason the answer is trustworthy.

**Status of 21/21.** It is a quotation, not my measurement. It was taken on the WP88 bundle; WP87 then
caused a regression (21/21 → 19/21), **found it with a control run rather than assuming it pre-existing,
attributed it, and closed it** (→ 21/21). The representation-blindness sweep separately notes the
baseline **owes another re-run** with its members 1 and 3 on the list, and did not run one.

### 4.2b The fourth thing that happened to this number, three hours ago

B39's sleep-as-wait sweep (`364d7c3`) landed while this report was being written, and it qualifies 21/21
in a way that must not be lost:

| band | verdict | runtime |
|---|---|---|
| original driver, contaminated by a sibling suite | 19/21 | 70.4 s |
| original driver, clean window | **21/21** | 70.5 s |
| converted driver, **shipped default** (sleeps retained as schedule) | **21/21**, 9 observed, 0 timeouts | 70.0 s |
| converted driver, `LS_S56_FAST=1` (each wait ends when its own state is observed) | **16/20**, 3 timeouts | 26.8 s |
| same, **reproduced** — byte-identical failures | **16/20** | 26.8 s |

Same build, same budgets, same predicates, both peers `connected: true`, nothing rebuilt or reinstalled.
In the SCHEDULE band every one of the nine conditions is observed in **0.0–0.4 s** of budgets totalling
61 s — *1.4 s of state bought with 61 s of budget*. What differs between the bands is only the **gap
between scenarios**.

> **B39's conclusion, and I would not soften it:** *five checks of the canvas suite are green because of
> elapsed wall-clock time between scenarios, not because the product produced the state within the budget
> the scenario itself declares. A green that requires the schedule is measuring the schedule.*

The leading hypothesis — every failing scenario is a **second whole-file write to the same `.canvas`
shortly after a previous one**, against Obsidian's debounced `requestSave` — is **labelled a hypothesis
and was not acted on**, which is correct, and has since been dispatched as **B41** on that basis.

Two details from the sweep that sharpen the picture rather than soften it: only **5 of 61** in-scope
sleeps were legitimate margins, and **all five protect a *negative* assertion** (*"no resurrection"*,
*"destroyed nothing"*) — **a negative cannot be polled for**, so those five are the irreducible floor and
everything else was the rig failing to ask a question it could already answer. And the batch **tuned no
timeout and redefined no baseline**: every poll's budget equals the sleep it replaced, byte for byte,
which is precisely what makes the moved verdict evidence rather than noise.

**Dispatcher's ruling, landed at `8458167` after this section was drafted:** *"21/21 remains the reported
figure, and is now recorded as schedule-dependent in five checks. That dependence is a finding to
investigate, not a property to preserve."* I reached §4.2b independently and agree with it.

**So the honest statement is now:** *21/21 is the only canvas figure this project has produced that
measures the product rather than the rig — and five of its twenty-one checks are, as of today,
measured to be schedule-dependent. It is one day old and already two sweeps out of date.*

**One more thing B39 measured that belongs here:** a **sibling E2E suite running against the same two
Obsidian instances cost the canvas suite 2 checks and wp86 1 check** (19/21 vs 21/21; 37/1/4 vs 38/0/4),
and the loser is recorded as a **product failure**. Every clean figure above was taken behind a 30-second
no-change watch over both shared trees. **Two E2E suites driving one pair of instances do not compose**,
and nothing in the rig enforces that they do not.

### 4.3 Work-package accounting — I recounted this

| | Predecessor | **Now, counted from disk** |
|---|---|---|
| Chartered | 76 | **87 live** (WP1–WP83, WP85–WP88; **WP84 withdrawn**, counted zero, number not re-used) |
| Charters present on disk | — | **87 files**, `TaskCharter_WP{1..88}` minus WP84 |
| Implemented | 54 (53 accepted) | **67** — every WP with an implementation report, **excluding WP7**, whose report is a `BLOCKED` assessment (§6.8) |
| Not implemented | 23 | **20** — WP7, 31–35, 39, 40, 50–54, 65, 66, 68, 71, 74, 75, 76. All `SPEC_COMPLETE` |
| Unit suite | 303 / 1 856 / 0 | **347 / 2 471 / 0** (measured) |
| Real-Obsidian gate (WP7) | never run | **still never run** |

67 + 20 = 87. It reconciles, and it is worth showing the arithmetic because **the predecessor's did not**:
its `54 implemented + 23 not implemented = 77` against a stated `76` chartered. The cause is that
`WP1–30` and the not-implemented list **both contain WP7** — the same double-count I nearly made, for the
same reason (a `BLOCKED` assessment report sitting in the implementation-report namespace). Minor, and
recorded because §4 exists to check numbers rather than inherit them.

---

## 5. Defect classes found, and their generalisations

The predecessor named nine instances of *"a green test that cannot fail"*. The count is now well past
twelve, and — this is the important part — the class **left the test suite**.

### 5.1 The surface census

The run's own enumeration, from the representation-blindness sweep and extended by the liveness sweep:

```text
an oracle (×2)                    ← B32, the two checks WP36's Y.Text change blinded
a product write path              ← the seed boundaries un-migrating records
a diagnostic                      ← the Dispatcher's own grep (below)
a latent write path
the anti-vacuity instrument       ← WP86's census deriver returned EMPTY, and both
                                     "every derived site is pinned" assertions passed on it
the rig                           ← canvas.open (S45); the installer polling /cmd (S46-adjacent)
a criterion's precondition        ← link.break{silence} could not reach a ceiling
a suppression policy              ← onopen ungated by `silenced` on both links (8th, liveness sweep)
```

Not in that list, and belonging in any honest count: **the console layer beneath the tests** —
`run_command` without an explicit `session_key` was answered `"reused"` against an unrelated console and
`await_console` then reported **`completed / exit 0` for the previous run while nothing executed**. And
**the spec**: C36 AC2 specified a two-way diff that computes a peer's merged characters as a *deletion*,
converging both replicas on truncated text while byte-equality, SEC and the fuzzer all stay green.

### 5.2 The three generalisations worth keeping

**(a) Absence of information, executed as a destructive assertion.** This is I11 one level up, and the
run has now found it **four times** in a week: a manifest that does not list a file ⇒ *"it was deleted"*;
a read failure in `publishManifest` ⇒ an entry deletion; a peer that never received a file ⇒ a purge; a
retired parent-directory entry ⇒ `trashFile(TFolder)`. Its highest form is WP88's: **losing the
connection is a fact about the network; losing `roomId`/`token`/`role` is a fact the client manufactures
about itself.**

**(b) A representation change silently retires a correct check.** No bad test and no bad code are
required. WP36's `string → Y.Text` change blinded a stale-push discriminant and turned an admission check
into a convergence check. The sweep's sharpest finding: **member 4 is precisely the check that would have
caught member 3** — one representation change retired a whole layer of protection. And the Dispatcher's
framing of the class was **too narrow**: the largest sink family is **truthiness (38 rows, 32 in class)**,
because an empty `Y.Text` is truthy where `""` was falsy — invisible to any `Object.is`-shaped search.

**(c) An instrument that hangs is strictly worse than one that cannot fail.** A test that cannot fail at
least returns an answer. `link.break{shape:"silence"}` could not drive a link to its ceiling because
`onopen` was ungated, so every retry reset the chain: **a criterion waiting on it would hang, not fail.**
The generalisation the liveness sweep drew is better than the defect: *nothing in the system knows a
suppression flag is meant to be exhaustive.* Four of five paths consulted `silenced`; the fifth was
covered only by inspection, in the same commit.

### 5.3 The control pattern that came out of it

Three derivers were built this stretch and the third is the model:

- it derives from the tree (AST/type-checker), never from a hand list;
- it **exits 3 without emitting a census** if its input set is empty — the WP86 failure mode made
  structurally impossible;
- its positive control has **two halves and exits 4 if it can show neither**, because after a repair
  *"the class is empty"* and *"the deriver went blind"* would otherwise produce the same output.

That last point is the most transferable engineering artefact this run has produced.

---

## 6. Corrections to earlier claims

### 6.1 The Dispatcher's own, recorded by the Dispatcher

- **D1 was diagnosed backwards.** *"A host demotes itself"* → the real cause is a **missing promotion**:
  `isHost === false` demoted, `isHost === true` did nothing, so every disagreement walked monotonically
  toward guest and the fixed point is a session with zero hosts. Pinned to **11 ms** in the plugin's log.
- **Presence does not need P5.** Cursors worked; the reason presence looked broken is that **no second
  peer was ever subscribed, because the canvas never reached the guest**. WP79 was masking it.
- **Scenario `[07]` did not confirm the canvas defect.** It created the canvas *mid-session*, which
  works. *"The green test that cannot fail, committed by me, in the suite built to escape it."*
- **WP81's reported symptom was falsified — and the cause was the Dispatcher's own script.** There was no
  logger silence; `liveshare_fix_debuglog.py` had moved the file an hour earlier. **Two batches
  independently "reproduced" it** by inheriting the premise. *Independent confirmation of a shared false
  premise is not independent confirmation.*
- **All three of the desync incident's supporting facts were false** (no drop, 128 `[connection]` lines
  not 38, `autoReconnect` is not a reconnect driver) while the conclusion survived. The cause: a grep for
  `reconnect|disconnect|socket|close|websocket` over a log whose most common connection line is
  `control channel connected`. This produced **rule 15**, and its cousin after `grep -o "link.break"`
  returned two false hits because `.` is a wildcard.
- **`skipsAutoTextSync`'s "exhaustive in both directions" claim is TRUE**, scoped to the `isSidecarPath`
  block — the Dispatcher told a worker it was false. The misleading block is the other, unenforced one.
- **`isSharedPath`'s prefix match: settled negative.** There is no bug; `normalizePath` here is a local
  helper that preserves trailing slashes. The lesson was recorded as being about *how it was filed* — a
  hedge naming its own evidence class prevented a WP against a defect that does not exist.

### 6.2 Corrections the workers made to the Dispatcher

- **WP82** falsified all three supporting measurements the Dispatcher briefed three agents with.
- **WP85** established that 13/18 was the rig, contradicting the Dispatcher's latch attribution.
- **WP86's census** found **three routes where the Dispatcher pointed at one**, and the worst was not the
  one found.
- **WP88's census** found **five routes, not one**, including a bare `catch` with no ceiling that a text
  search for `endSession` cannot see; **six settings keys, not three**; and that on a host the give-up
  is **not local** — it `DELETE`s the room for everyone first.
- **WP2 refused WP84** as already subsumed by WP80 and recorded the row as `withdrawn`, which spent zero
  work packages instead of one.
- **B32 found two of the Dispatcher's own ruling's premises wrong** — *"the value is correct in every
  case"* was false in 2 of 13, because WP36 had read vitest's truncated `YText{…}` display and never
  rendered it.

### 6.3 Corrections the workers made to their own charters

WP37's charter had the chain right and the **granularity** wrong (`setData` alone loses nothing —
Obsidian reuses cards). WP86's charter had producer 5 traced to the rename arm, and the arm is
**unreachable**, because an `await` between the two writes ends the implicit Yjs transaction — so
`trashFile(TFolder)` was not one of two possible outcomes, **it was the only one**. WP80's AC4 caught a
lobotomy in its own first implementation, live.

### 6.4 A claim in the tree that was false and load-bearing

`main.ts`'s *"Obsidian never reloads a canvas from an external write"* — **measured false on both vaults,
on an unshared board, with no plugin path involved.** It reloads, the reload is a **rebuild** rather than
`setData`'s node reuse, and unflushed characters go with it. An untested comment had been load-bearing
for the design of two work packages. See §6.7 — the correction is incomplete.

### 6.5 Two claims that survived re-measurement

WP80's *"`removeFile` is unaffected"* was verified true at both ends, and WP38's pre-tag origin
measurement predicted the tag would be inert and **nothing reddened**. Recording these matters: in a
week where most re-measurements falsified something, the two that held are evidence the method works
rather than that everything is broken.

### 6.6 Something the run reported honestly that it could have hidden

WP36 left a known limit as a **visible failing check** — a single-span diff from a stale base can
re-author one peer character (`kolla1bo22ratio`): nothing lost, replicas agree, but **a value nobody
typed**. WP82 **declined** AC5's live row with a stated reason rather than faking it. WP86 shipped
**4 honest skips** with their reasons. WP38 stated the cost of excluding the conversion from undo rather
than hiding it. That is the behaviour the workflow was built for, and it appeared without prompting.

---

### The four corrections below are mine, measured today

### 6.7 `canvas-sync.ts:3785-3789` does not say what the run says it says — and the residue is bigger

`DISPATCHER_STATE:2105` records: *"`canvas-sync.ts:3785-3789` still asserts it — unowned"*, propagated
verbatim from `ImplementationReport_WP87.md:362`. **Measured at HEAD:**

- `grep -F "external write"` over `plugin/src/files/canvas-sync.ts` → **0 hits**. The same `grep -F`
  pattern matches two known-present lines elsewhere (`canvas/canvas-editing-deferral.ts:324`,
  `main.ts:2947`), so the pattern works and the absence is real (rule 15).
- `canvas-sync.ts:3780-3800` is a **WP29 comment about delete-by-omission**. Nothing about reloads.
- `git diff 860e2a9..HEAD -- plugin/src/files/canvas-sync.ts` is **empty**. The file is byte-identical to
  WP87's own handover commit, so **the citation was wrong when it was written**, not drifted since.

**The claim does survive in that file — at four sites, in different words**, found with the ERE
`reload|re-read|refresh|external` (15 hits in the file; positive control: 31 hits in `main.ts`):

| line | text |
|---|---|
| `:2028` | *"patch the OPEN Obsidian canvas view (which **ignores external file writes**)"* |
| `:2265` | *"(Obsidian's open canvas **ignores external .canvas writes** …)"* |
| `:2798-2799` | *"…**external .canvas writes while the view is open**, so a file-only sync leaves the view stale/scattered until a full reload"* |
| `:3863` | inside `noteExternalDiskWrite` (`:3855`): *"an **open canvas ignores external file writes**, so only a confirmed apply is a receipt there"* |

**And it is not only a comment.** The `:3863` sentence is the stated justification for a live branch:

```ts
if (this.surfaceStateProvider(path).viewOpen === false) {
  this.advanceShadowFromContent(path, content, true);
}
```

— i.e. **when the view is open the Surface-Shadow is deliberately not advanced**, on the strength of a
premise WP87 measured false. There is also a whole `externalWriteSettleTimers` mechanism (10 references)
built on the same premise. Whether the branch is still *correct* under WP87's measurement I did not
determine — that needs a live run and is out of my scope. **Traced, not measured. It needs an owner, and
the item as filed points at the wrong line and understates the scope by three sites and one branch.**

### 6.8 `ImplementationReport_WP7.md` still says Obsidian is not installed

It exists on disk and reads `## Status: BLOCKED`, with AC1 blocked because *"Obsidian is not installed;
and the named rig does not drive real Obsidian"*. The first half has been false since 2026-08-05. The
report is not wrong about WP7's status — the gate is still unrun — but a reader listing implementation
reports will count WP7 as implemented, and the stated reason for its blockage is now obsolete. Its AC4
result (production tree-shakes `src/testing/` out) was separately retired by the `__LS_E2E__` finding.

### 6.9 The signal register collided again — three times, after the rule that fixed it

`DISPATCHER_STATE:609-614` rules: *"`S1`–`S41` are ambiguous and MUST be cited with their source
document"* and *"**`S42`+ are globally unique and allocated by the Dispatcher only**."* Measured against
that file with `grep -nF`:

| key | meaning A | meaning B |
|---|---|---|
| **S50** | `:1711` — producer 5's producing-side fix (WP86) | `:1817` — the mirror pass runs its host arm after a demotion is decided (WP85) |
| **S56** | `:2073` — 116 of 197 waits are a bare `sleep` (liveness sweep) | `:2108` — WP37's protection was structurally inert on guests (WP87) |
| **S57** | `:2120` — a substituted record advanced the shadow to unflushed editor text | `:2146` — installed bytes are not evidence of loaded bytes |

`:1874` records a **third** S50 misuse and allocates S54 for it — **but leaves the two live S50 entries
undisambiguated**, and S56/S57 collided afterwards. **S58 and S60 are never allocated at all.** So the
register the open-items list is keyed by has, after being declared repaired, three duplicate keys and two
gaps. This is why §7 carries the provenance warning it does: *a register with duplicate keys is not a
register*, and this is the second time this run has proved it with its own bookkeeping.

### 6.10 One measured baseline in a report is 15 tests short, and the arithmetic proves it

`ImplementationReport_WP38.md` quotes: *"Detached-worktree baseline at `05ac138`: **2 383 / 2 383**,
0 failed, **342 files**."* `ImplementationReport_LivenessSweep.md`, measuring **the same commit** with the
same file count, reports **2 398 / 2 398, 342 files**.

The gap is **exactly 15**, and 15 is exactly the number of tests in `e2e/two-host.test.ts` +
`wp5/latency.test.ts` — the two files that cannot load in a detached worktree without
`server/node_modules`, which I reproduced today (§4.1). **The liveness sweep's 2 398 is the true figure;
WP38's baseline is a worktree artefact**, and WP38's implied delta (2 383 → 2 471 = +88) should read
2 398 → 2 471 = **+73**. Nothing is wrong with WP38's work — its own additions reconcile (2 398 + 35 WP38
+ 37 WP87 = 2 470, and WP87's later ceiling commit accounts for the last one). But **a detached worktree
reports this shortfall as two failed *files*, not as a smaller total**, so it is easy to read past, and
the run's own rule — *a measurement is not a timeless fact* — has a companion it has not written down:
**a measurement is not portable between environments either.**

---

## 7. What is still open, ranked by what a user would notice

> **⚠ Provenance warning.** This list is the Dispatcher's own account, re-keyed and ranked by me, drawn
> from a 2 123-line append-only file whose signal register is broken in three places (§6.9). Items may be
> duplicated under different keys or lost entirely. **It is not an audit and should not be read as one.**
> Where I verified an item against the tree, it says so.

### Tier 0 — the product cannot be installed by anyone

- **`plugin/manifest.json` is a broken symlink.** Git mode **120000**, target
  `/home/mewski/Projects/obsidian-live-share/manifest.json` — verified today. On Windows it checks out as
  a 55-byte text file, so **the repo cannot produce an installable plugin folder**. Worked around by
  installing only `main.js` into vaults that already had a 0.6.1 manifest. **No owner.** Nothing else in
  this list matters for a release until this is fixed.

### Tier 1 — a user loses work

1. **I11's protection expires with the session. P0-class, product, live, UNOWNED.** A record refused at
   ingest is correctly withheld from deletion in session 1; on the next cold open the doc arrives
   non-empty, the file is never read, and `flush()` projects the doc over it. **The record is gone —
   deleted as a consequence of a refusal, which is I11 verbatim.** Verified in the tree today:
   `canvas-sync.ts:1458` still documents the ledger as per-SESSION; `canvas-persistence.ts:478` still
   reads *"Doc wins. Never read the file."*; `grep -lF "SeedRefusalLedger"` over all 87 charters returns
   **three, all DONE** (WP30, WP63, WP79). **No charter owns it.** The host is *accidentally* safe.
2. **WP68 — the file-op rename sidecar boundary.** Chartered `SPEC_COMPLETE`, unbuilt. A peer-reachable
   write into `.obsidian/**` of an Electron process is a **code-execution surface**. Already ruled to
   block release and to outrank P3/P4/P5.
3. **S50(WP86) — producer 5's producing side.** The consuming side now refuses, but a parent-directory
   entry is still *retired* when a folder stops being empty. The fix is producing-side. Unowned.
4. **S52** — an empty folder published mid-session is never materialised on a guest.
5. **Representation sweep, member-1 residue** — a seed proposing a *genuinely different* string still
   flattens. Pinned by a control test; the sweep says it **deserves a WP**. Reachable because of WP85.

### Tier 2 — it silently stops working, and says nothing

6. **S61 — `getEditingNodeId()` over-reports an editor on boards nobody is typing in.** Bounded by a
   ceiling, not repaired. **It silently widens every deferral in the system.** WP87 named it as the
   highest-value follow-up, and it is the one I would schedule first after Tier 1.
7. **S56(WP87) — a race that is never retried.** A guest's open canvas never received a `CanvasAdapter`
   (3/3 occurrences), so WP37's protection was structurally inert there. The instance was repaired in one
   line of wiring; **the class is unowned.**
8. **S36 — `remoteUsers` is never pruned by staleness.** A peer whose control link is dead keeps every
   `isHost` claim indefinitely — **and that is an input to WP80's completeness gate.**
9. **S40 — the `OfflineQueue` is uncapped.** WP88 stops it accepting after the chain ends; there is still
   no cap constant and no retention policy.
10. **S27 / S37 — the relay's host election is a coin flip**, measured at **34 role transitions in
    2 h 05 min** with no alternation. Non-destructive since the data-loss fix, but **every restart-based
    E2E scenario is a lottery**, and the fix is `server/**`, outside every current WP's scope.
11. **S59** — the P5 binding path reaches the view mutators and consults the editing predicate **zero**
    times. Admitted as `FROZEN-BEHIND-FLAG`; **live the day P5 flips it.**

### Tier 3 — the user is misled but loses nothing

12. **A first-connect failure cannot be classified from the client** — *"the relay rejected these
    credentials"* and *"the relay was never reached"* are indistinguishable; no close code is captured
    anywhere. WP88 stopped *claiming* one; it cannot *tell*.
13. **`DELETE /rooms`'s failure is swallowed** by a `catch` whose body is a comment — after a
    user-initiated end, a host that reached the relay and one that did not are indistinguishable.
14. **`abortSession`'s three non-connectivity callers** still destroy six settings keys on a start/join
    failure. Probably right; **nobody has decided it.**
15. **The falsified external-write premise still governs a live branch** — §6.7. Filed against the wrong
    line, and three sites plus one branch wider than recorded.
16. **`isPathSafe` does not exclude the config directory**, and the rename branch is still the only op
    gated with `paths.some(...)` rather than the strict all-paths form.

### Tier 4 — verification and rig debt, invisible to users, load-bearing for every green

17. ~~**S56(liveness) — 116 of 197 waits are a bare `sleep`**~~ — **partly closed today by B39**
    (`364d7c3`), and the residue is worse than the item was. 91 rows classified 91/91, 49 converted,
    45/45 failure controls executed. Only **5 of 61** in-scope sleeps were genuine settle margins;
    **49 of 61 stood in for a state the rig could already observe and simply did not ask about.**
    **Open residue:** (a) five canvas-suite checks are **schedule-dependent** (§4.2b) and unattributed —
    the hypothesis is named but untested; (b) the conversions in `dataloss`, `wp85`, `wp79`, `wp82`,
    `wp36`, `wp37` and `wp83` are **proved at the helper level and never validated live**, because
    running them would destroy the instances two sibling batches were using — B39's words: *"a real gap
    and it is not dressed up as anything else"*; (c) **two E2E suites driving one pair of instances do
    not compose**, and nothing enforces it.
18. **S57(installer) — installed bytes are not loaded bytes.** A live instance answered
    `unknown cmd: canvas.undo` for two scenarios though the installer had verified the digest minutes
    earlier. Not reproduced, cause unidentified; mitigated by a preflight gate. **Every
    install-then-measure in this run rests on that gap.**
19. **S55** — ~~8~~ `subprocess.run` calls with no `timeout=`, including the E2E bundle build itself.
    **Re-censused by AST walk, and both the count and the framing needed correcting:**
    - **In the repo: 10, not 8** — three outside tests (`tools/launch_liveshare_e2e.py:142`,
      `tools/obsidian_e2e/install.py:527`, `workflowArtifacts/canvas-v2/_falsify_b11.py:55`) and seven
      inside the WP77 / WP78 visible suites. **134 across the whole census**, but 124 of those are in
      `H:/tmp` — throwaway batch scripts and stale worktree copies, none of which ships.
    - **The one that matters is `install.py:527`, and it is a RECORDED DECISION, not an oversight.** Its
      docstring states it: *"The build terminates on its own; no timeout is used as an oracle and nothing
      is killed."* **That reasoning is right and it does not cover the hazard.** A timeout as an
      **oracle** — deciding the bundle is good because the build finished in time — is the sleep-as-wait
      class and must stay refused. A timeout as a **liveness bound** — turning a hung `npm` into
      `E2EBuildFailed`, a named failure that decides nothing about the bundle — is the opposite, and the
      docstring does not argue against it. **These are two different changes and the recorded decision
      only forbids one of them.**
    - **Not repaired here.** It is the package's most carefully reasoned function and it is guarded by a
      byte-level baseline in WP78; overriding a recorded decision on the strength of an open-items line
      is exactly what item 20 just demonstrated the cost of. **Charter it, with the oracle/bound
      distinction as its first acceptance criterion.**
    - **Side finding:** the census counted **twelve** stale worktree/snapshot copies of this repo under
      `H:/tmp`, where the cleanup list records three. Corrected in `DISPATCHER_STATE.md`.
20. ~~**`readiness.RawAnswer.body`** still leaks credentials on `repr`/`str`/`asdict` — measured, and the
    **only remaining member of that class** in the rig package. Unowned.~~ — **WITHDRAWN, wrong in both
    halves.** Checked before scheduling it, which is the only reason this was caught.
    - **Not a credential.** The field holds a `session.info` response, whose field set is pinned
      *exhaustively* by three landed assertions: `clientId`, `role`, `roomId`, `connected`, `vaultId`,
      `vaultName`, `vaultPath`, `pluginBuild`, `canvasSurface`. No credential among them, and
      `_SESSION_INFO_BODY` is a module constant, so no code path can make the probe send anything else.
      The rig's `Secret` discipline exists for **owner-vault file bytes**, and all four of those —
      `install.BundleState`, `ports.BorrowState`, `provisioning._CommunityState`, `relay.RelayRoom.token`
      — are closed.
    - **Not unowned.** WP77 enumerated the class by walking the package AST, ruled this member a
      *deliberate carry-up* under `S14`, and pinned it: `T1` fails if the class gains a member, `T5`
      asserts this record is **still renderable** so a later reader can tell a decision from an oversight.
      Reversing it is a decision to re-open, not a gap to close — and the recorded reason is better than
      my reason for reversing it. Measured today: **50/50 green**.
    - **What is real, and it is narrower:** newly allocated **S62**. The probe knows a *port*, not a
      peer. Under `S57(installer)` — something else answering where the rig assumed the plugin — the body
      is an arbitrary third party's response rendered verbatim into any diagnostic. Low severity,
      recorded rather than fixed.
    - **This is the third time the open-items list has been wrong when checked**, which is what §0's
      provenance warning predicted about §7. The list is a set of leads. Verify before scheduling.
21. **S18 / S19** — `LocalRelay(room_minter=None)`, the only optional default doing a *write-shaped*
    network op; `__all__` omits three landed modules.
22. **S30** — the debug log grows unbounded inside `.obsidian/` (+33 234 B / +28 633 B in one day).
23. **The canvas E2E baseline owes a re-run** with representation-sweep members 1 and 3 on its list.
24. **Relay binds on all interfaces** (`server.listen(port)`, no host argument). **Undecided.**
25. **Both owner vaults are left on a 4.5 MB instrumented e2e build with `obsidian-git` disabled**, three
    `data.json` backups and eight fixtures each (§3.1). Restore is one command and has not been run.

---

## 8. What is NOT established

**A reader must not close this report believing the product is finished. It is not, and the gaps are
structural, not cosmetic.**

### 8.1 The gate has not moved one step

The chain is **WP50 → WP74 → WP75 → WP76 → WP51 → WP71 → WP7**, and **not one of the seven has been
implemented.** Verified: no implementation report exists for any of them, all seven charters read
`SPEC_COMPLETE`, and `tools/MCPserver/liveshare_e2e_mcp_server.py` — the file WP50 owns and WP74/75/76
edit — has not changed since `50b0cf4` (WP73). CONCEPT_V2 Teil 14 makes a green two-vault run a release
condition **from P0 onward**; the predecessor's ruling that the deviation is *acknowledged, not
retroactively authorised* **stands unchanged**, now across more phases.

The 2026-08-05 sessions do **not** discharge it. They were manual, human-observed, or driven by
per-WP scripts. There is no matrix, no discrimination variant, no intent-trace convergence measurement,
no path-evidence oracle, and the driver defects the gate WPs exist to fix (`_open` and `_wait_both`
discarding their results; `applied` a constant on the real host; two vaults indistinguishable from one)
are **all still present in that driver**.

### 8.2 A quarter of the redesign is unbuilt

- **P3 (WP31–35)** — mode consensus, receive-and-persist. Chartered, zero implementation.
- **P5 (WP39–40, WP52–54)** — op-capture promotion. Zero implementation. This is why there is still no
  presence overlay and no *"who is editing which card"*: `useCanvasBinding` is `false` in both vaults
  (verified today), and the renderer is only constructed when it is on.
- **I8 atomicity is not in force on the live capture path** — geometry still merges as independent `x`/`y`
  LWW keys, the exact defect WP9/WP10 exist to make unrepresentable. Owner is WP39, unbuilt.
- **P4 is the exception** and is now complete (WP36/37/38).

### 8.3 The amendment set is recorded and not scheduled

`AMENDMENT_DISPOSITION.md` is unchanged since 2026-08-04. **Roughly half of Ä1–Ä17 is already true** and
must be rewritten past-tense or it will charter work that costs nothing to discover costs nothing. The
dangerous ones are the **partially** satisfied: **Ä2 at 2 of its 4 boundaries, Ä9 at 2 of 4 surfaces** —
the ones a quick read most easily mistakes for complete. Nothing here is chartered.

### 8.4 What the live runs do and do not prove

They prove the product **works at all in the real editor** — which nothing before them did, and which the
predecessor explicitly listed as unestablished. They prove specific defects were present and are now
absent, each with a RED control on the unmodified tree, most with role-symmetry controls.

They do **not** prove the correctness properties P0/P1 were built to guarantee. They ran a handful of
scenarios on two instances on one machine against one relay, with instruments that this same run has
found to be defective **six** separate ways in five days (`canvas.open`; the installer's route check;
the installer's bundle identity; `link.break{silence}`; the console layer; and now the schedule
dependence in §4.2b). **21/21 is a floor, not a ceiling — and five of its checks are, measured today,
resting on wall-clock gaps rather than on the product.** The honest statement of status is now:

> *It runs, and it is verified to the limit of headless testing plus roughly twenty observed live
> scenarios driven by instruments the run does not yet trust.*

---

## 9. Where the approach cost more than it returned

The predecessor ruled against the Dispatcher's own governance choice. This section is the equivalent, and
it rules against more than one thing.

### 9.1 The blind-set apparatus was not worth its price, and the owner had to say so

Weeks went into blind sets, ledger rows, falsification injections and a §7 licence regime. The regime is
genuinely good work — 58 ledger rows, 0 divergent, 0 unlicensed deletions across the whole run — and it
caught real vacuity. But **the defect that mattered most was found in minutes by opening the program**,
and the apparatus was never going to find it, because the apparatus tests the code and the defect was in
the *shape of the system*. The correction did not come from inside the run. It came from the owner, in
one sentence, on 2026-08-05. **A verification regime that cannot notice it is verifying an unexecuted
program is not a verification regime; it is a very careful proofreader.**

### 9.2 The run built a rigorous gate it does not use and validates with an unrigorous one it does

Seven work packages of gate preconditions — WP50, 71, 74, 75, 76, plus WP51 and WP7 — exist, are
chartered in detail, and are unrun. Meanwhile **all** live validation this stretch went through **28
ad-hoc `H:\tmp\liveshare_*.py` scripts**. The run's own liveness census found **86 of the 116 bare
`sleep`s-standing-in-for-waits inside those scripts** — and when B39 went to fix them today it found
**91, because the population grew by five in the 75 minutes since the count**, and then found that
**5 of the canvas suite's 21 checks are green on the schedule rather than on the product** (§4.2b).
The most disciplined instrument in the project is idle; the least disciplined one produced every number
in §4.2 and every RED→GREEN pair in §2. **That inversion is the largest unaddressed process risk in the
run**, and it is larger than any single item in §7. B39 narrowed it by one dimension today; the four
suites that could not be re-run live, and the unattributed schedule dependence, are what is left.

### 9.3 Line-number citations keep being wrong, and rule 5 has not fixed it

`main.ts` citations drifted by 2, 24 and 20 lines once; `log-view.ts:71` was `:72`; `canvas-sync.ts:2819`
was `:3019`, off by 200; WP87's `canvas-sync.ts:3785-3789` points at an unrelated comment in a file that
has not changed since (§6.7). Rule 5 — *a line number is a measurement, not a name* — is stated, agreed
and repeatedly broken. The countermeasure that has actually worked, exactly once, is **citing by symbol
with a rule-15 pattern**; the countermeasure that has not worked is remembering to re-measure.

### 9.4 The bookkeeping failed twice, the second time after the rule that fixed it

§6.9. The cost so far is one mid-charter disambiguation and three ambiguous agent briefs. The cost if it
is not fixed is that **§7 of this report is unreliable**, which it now is.

### 9.5 What was worth its price

For balance, because the above is one-sided:

- **Reproduce-first.** Every WP this stretch produced a RED on the unmodified tree before repair.
  It killed three repairs that would have been aimed at working components.
- **Attribution by receipt before repair (WP87's AC1).** Three repairs in this run were aimed by
  inference and two were aimed wrong. WP87 enumerated four candidate routes with discriminating receipts,
  measured which one fired, and only then wrote code. **This should be a standing rule.**
- **Positive controls that fail in both directions** (§5.3). Cheap, and they turned two derivers from
  decoration into evidence.
- **The role-symmetry control.** The relay's election is a coin flip that cannot be made deterministic,
  so the batches ran RED and GREEN under **opposite** role assignments and turned a confound into a
  control. That is the right way to use an environment you cannot fix.

---

## 10. Closing assessment

**The product works in real Obsidian.** Two vaults, a real relay, real editors: text files sync, the V2
canonical serializer runs on the owner's disk, canvases now reach guests, two people can type in the same
card and both sets of characters survive on both peers and in both `.canvas` files, undo works and does
not eat a peer's text. The two defects the owner personally reported are closed and demonstrated, not
argued. That was not true when the last report was written, and it is the single biggest change.

**The cost of getting there was a week of finding out that almost every confident statement in this
project needed re-measuring** — including the Dispatcher's diagnoses, the workers' own charters, the
comments in the source, the baseline numbers, the signal register, and the instruments themselves. The
run's honest score on its own claims this stretch is roughly: **two survived re-measurement intact, and I
can count at least a dozen that did not.**

**The three things I would act on, in order:**

1. **Fix `plugin/manifest.json`.** It is a broken symlink to a stranger's Linux home directory. Until it
   is a real file, nothing in this repo can be installed by anyone who is not running an install script
   written by this run. Everything else in §7 is downstream of that.
2. **Own the I11 session-expiry defect.** It is P0-class, it is in the product, it is live, the mechanism
   is verbatim in the tree today, and **no charter has it.** It destroys exactly the class of record the
   entire I11 invariant was created to protect, one restart later.
3. **Either run the gate chain or retire it.** Seven chartered work packages of gate preconditions are
   sitting idle while every real number comes from scripts the run's own census says are its weakest
   instruments. Both answers are defensible. Leaving it as it is — a rigorous unused gate and an
   unrigorous used one — is the one option that is not. The cheapest first move is not a WP: **attribute
   the five schedule-dependent canvas checks (§4.2b)** — **already dispatched as B41** while this report
   was being written. B39 reduced it to a single named hypothesis and a two-band reproduction, and the
   answer either exonerates the product or is the next real defect. Nothing else in this list is that
   close to an answer.

**And the assessment a reader should carry away, in one sentence:**

> *Canvas V2 is a working collaborative canvas with a demonstrated core, a quarter of its redesign
> unbuilt, at least a dozen unowned live defects, no automated acceptance gate, no installable package,
> and a single honest acceptance figure of which five checks were shown today to be measuring the clock —
> and the most valuable thing it produced this week was not the fixes, but the measured demonstration
> that running a program for one afternoon can outperform 1 856 tests that cannot.*
