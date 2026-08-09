# Investigation — canvas convergence: does a guest's edit reach the host's file?

**Investigator:** W4e · **Branch:** `fix-bugs-and-raceconditions` · **Date:** 2026-08-08, 10:50 – 11:30 local
**Build under measurement:** `93c65f06a347e6cc` on all three vaults, re-read at start and at cleanup. **Nothing was
rebuilt, redeployed or reinstalled.** No product code was changed. **No test suite was run**, in whole or in part.

**Rig:** A (`ObsidianOrga`, 39431) guest · B (`… - Kopie`, 39432) **host** · C (`… - W4TestC`, 39433) guest ·
room `90faf3d5-a6c6-4c13-8071-b8ac8dbd1411` · `sharedFolder` `_liveshare-test` on all three at every reading.
Roles were read from `session.info`, never assumed (`S139`).

**Condition, measured rather than labelled.** No throttling flags — the shape the owner runs. Renderer
`visibilityState` and a 30-hop chained-`setTimeout` probe at 10:53:

| | A (guest) | B (host) | C (guest) |
|---|---|---|---|
| `visibilityState` | `hidden` | `visible` | `hidden` |
| chained timer hops | **did not return in 90 s** | **4 ms/hop** | **770 ms/hop** |

So both guests were deeply clamped and the host was not. **That is the harshest possible arm for the headline
result below**: the peer that fails to update is the one that is *not* throttled.

---

## The three answers, before the evidence

1. **Q1 — a guest's edit does NOT reach the host's file, and this is the DEFAULT for a host-created canvas.**
   It is not a latency effect and it is not throttling. The host holds no CRDT→disk writer for a canvas it
   created and never opened, so its file is frozen at its authored bytes while its own shared document
   carries every remote edit. **It is repaired instantly and completely the moment the host OPENS the board.**
   `.md` notes converge in under a second in the same session, both directions.
2. **Q2 — the permanent divergence WP118 measured is serialisation only. The records are identical.**
   I verified it by parsing, field by field, on the host-created case WP117 predicted it for. It does **not**
   survive an edit in the way the hypothesis expected: a guest's edit makes the two files diverge in
   *records* as well, and neither divergence closes by itself.
3. **Q3 — adoption is not gated on the cursor, the focus or the view. It is gated on a mirror pass being
   re-armed, and only a manifest change re-arms one.** Measured directly: an originator sat unadopted for
   **240 s** with nothing else done, then adopted in **0.20 s** the moment the host created an unrelated
   note somewhere else in the share.

**And one thing I did not go looking for: a real, demonstrated destruction of 318 nodes of the owner's own
board, caused by my own gestures. It is disclosed in full in §6 and it is the most important thing in this
document.**

---

## Q1 — THE PRIORITY QUESTION

### 1.1 The decisive measurement (E5 §3, 11:20)

Host B creates a one-card `.canvas` through `app.vault.create`. **Nobody opens it on any peer.** Guest A then
edits it — moving the card to (111,222) and adding a second card. Everything below is read from disk in
Python, so the reader cannot wake a clamped renderer.

| | reading |
|---|---|
| the board reaches both guests | A **0.16 s**, C ≤0.16 s |
| `hasWriter` on the host for this path | **`false`** |
| `hasWriter` on both guests | `true` |
| **the host's file after the guest's edit** | **UNCHANGED after 45.12 s** |
| then **four unrelated manifest changes** by the host (each re-arms the mirror pass — proven in §3) | |
| **the host's file after those** | **STILL UNCHANGED after a further 60.16 s**, `hasWriter` still `false` |
| the host's mirror pass in that window | `role=host considered=14 published=14 materialised=0 adopted=0` |
| **the host's shared DOCUMENT** | `{h5n1:(111,222), h5n2:"W4E-E5-GUEST-CARD"}` — **it has the guest's edit** |
| parsed records, host vs guests | host: 1 node at (0,0) · guests: 2 nodes, `h5n1` at (111,222) |
| **then the host OPENS the board** | **file changed in 0.00 s**, guest's card present, all three at **305 B, one digest** |

The same shape, independently, in E2 (11:03) with a two-card board and a three-card edit: **the host's file did
not change in 240.11 s**, the oracle returned `DIVERGED` (`A=434 B=235 C=434`), and the instant the host opened
the board the product's own `convergence.judge` returned **`CONVERGED`, `peersAgree: true`, all three at 434 B,
digest `f7b201defbf7`**. A *second* guest edit, with the host's board now open, reached the host's disk in
**0.25 s**.

And a real canvas-UI gesture, for the record (E5 §4): with the host's board open, guest A moved a node through
the canvas's **own** interaction surface — `selectOnly` → `setDragging` → `moveTo` → `markViewportChanged` →
`requestSave`, the three methods `canvas-adapter.ts` patches — and **the host's file followed in 2.25 s**.

> **Instrument disclosure.** The guest edits above were driven by rewriting the guest's own `.canvas` on disk.
> That is not a shortcut: `useCanvasBinding` reads **`false` on all three vaults** (verified live), and with
> that flag off `plugin/src/files/vault-events.ts:405-407` routes a local canvas change to
> `CanvasSync.handleLocalModify` — **the same line Obsidian's own canvas `requestSave` ends in**. The disk door
> and the UI door are one door on this build, and the UI row above closes the gap by demonstration anyway.

### 1.2 The variable that decides it: **who created the canvas**

| | host-created board | guest-created board |
|---|---|---|
| does the HOST hold the single writer? | **no** (`hasWriter: false`) | **yes** (`hasWriter: true`) |
| a guest's edit reaches the host's file | **never, until the host opens it** | **0.25 s** (E3 §B, measured) |
| all three byte-identical afterwards | only after the host opens it | **yes**, 307 B, one digest, records equal |

That asymmetry is the whole defect, and it is visible in the code as a single missing call — see §5.

Two variables that do **not** change the answer: **whether the canvas is open on the guests** (it was closed
everywhere in every row above), and **throttling** (the peer that fails is the unthrottled one). The variable
that does change it is whether the board is open **on the host**.

### 1.3 The `.md` control — and it is a sharp result

Same session, same hour, same peers, note open nowhere:

| gesture | host's file on disk |
|---|---|
| host creates the note | reaches A in 0.06 s, C ≤0.06 s |
| **guest A edits it through its own editor** | **the host's file carries the guest's line at the first poll (0.00 s)**; C at 0.05 s |

**Notes converge in both directions in under a second while host-created canvases never converge at all.**

### 1.4 Is any edit LOST, or only late? — **both, and they are different edits**

- **The guest's edit is not lost.** It is in the shared document on every peer, including the host, within
  seconds. It is simply never written to the host's disk. The host's file is not *late* either, in any useful
  sense: nothing schedules the write, so the delay is unbounded and ends only when a human opens the board.
  Call it **withheld indefinitely**, not late.
- **The HOST's own content CAN be lost, and I demonstrated it destroying 318 nodes.** See §6. When the host's
  file and the shared document disagree, the document wins unconditionally at the moment a writer is finally
  attached (`canvas-persistence.ts` `coldOpen` → `docNonEmpty` → `doc-wins` → `flush()`), and for `.canvas`
  there is **no conflict copy** — the `sync.conflictCopies` machinery is the text arm. The longer the host's
  file stays writerless, the more divergence accumulates behind that trapdoor.

---

## Q2 — What diverges: records, or only serialisation?

### 2.1 The host-created case, parsed field by field — **WP117's claim is VERIFIED**

E1/E2/E4/E5, four independent boards. Immediately after materialisation, before any edit:

| | host B | guests A and C |
|---|---|---|
| bytes | 235 | 296 |
| nodes / edges | 2 / 0 | 2 / 0 |
| **parsed records equal?** | **YES — `recordsEqual=True`, zero field differences** | |

The raw bytes, quoted whole because that is the finding:

```
host  B :  {"nodes": [{"id": "w4e01", "type": "text", "text": "W4E-HC-ONE", "x": -400, …}], "edges": []}
guest A :  {\n\t"nodes": [\n\t\t{\n\t\t\t"id": "w4e01",\n\t\t\t"type": "text",\n\t\t\t"x": -400,\n…
```

Same records, different bytes — exactly WP117 §2's statement, now measured live on the host-created case it
was never checked on. Nothing is added, defaulted or reordered; it is whitespace. The peers' form is
`serializeCanvas` = `JSON.stringify(buildCanvasData(...), null, "\t")` (`files/canvas-sync.ts:1253`); the
host's form is whatever wrote the file. **`S150`/`S123`'s permanent 139/140 vs 173/174 is this and nothing
else.**

### 2.2 There is a THIRD spelling, and it is Obsidian's own

When guest A opened one of these boards, its file was rewritten to **218 B** — neither the host's 235 nor the
plugin's 296:

```
{\n\t"nodes":[\n\t\t{"id":"w4e01","type":"text","x":-400,"y":-200,"width":260,"height":120,"text":"W4E-HC-ONE"},\n…
```

That is Obsidian's own canvas serialisation: one line per record. So a `.canvas` on this build has **three**
stable byte forms — the author's, the plugin's canonical, and Obsidian's — and **any peer with the board open
in Obsidian will diverge in bytes from any peer that does not**, permanently, for identical records.
Confirmed again at the end of E5: A `227 B` (board open, Obsidian's spelling) against B `305 B` (plugin's) for
the same board and the same records.

**Consequence for the next package: byte-identity is not a reachable convergence target for `.canvas` on this
build.** Record-identity is. Any oracle, any signal and any acceptance criterion that scores canvases on
`sha256` of the file will keep producing red for boards that are perfectly in sync — and, worse, green for
boards that are not, whenever the spellings happen to coincide.

### 2.3 Does the divergence survive an edit? — **the hypothesis is REFUTED**

The brief's hypothesis was that the host seeds the document from its own file, nothing changes, its writer
never fires, and the *first real edit* would close the divergence by itself. **The first half is exactly right
and the second half is false**, and the reason is that the writer is not merely un-fired — it does not exist.

Measured: after the guest's edit the two files diverge **in records as well as in bytes** (host 1 node at
(0,0); guests 2 nodes with the first at (111,222)), and four subsequent manifest changes do not close it. The
divergence does not shrink with the first edit; **it grows into a content divergence and stays there.**
**The defect is bigger than it looks, not smaller.**

---

## Q3 — S170: what discriminates the 0.22 s round from the 240 s rounds?

### 3.1 The measurement (E3, 11:12), gates applied one at a time

Guest A creates a one-card `.canvas`. It reaches B and C in 0.05 s and both write the canonical 164 B. A's own
file stays at its authored 130 B. `adoptionsArmed: 1`, `adoptionsCleared: 0`.

| gate applied | result |
|---|---|
| **nothing at all**, 150 s | **not adopted.** `adoptionsCleared: 0`, mirror `adopted: 0`, `skippedLocalFile: 10` |
| **(i) focus** — `Page.bringToFront` on the originator, a further 90 s | **not adopted** |
| **(iii) one unrelated manifest change** — the host creates a note elsewhere in the share | **ADOPTED in 0.20 s.** `adoptionsCleared` 0→1, mirror `adopted: 0`→`1`, all three at 164 B, oracle **`CONVERGED`** |

**The discriminator is a mirror pass being re-armed, and on this build only a manifest change re-arms one
mid-session.** Not the cursor, not focus, not an `activeFile` guard — there is no such guard on this path.

> **Honest limit on gate (i).** `Page.bringToFront` did **not** actually foreground A: its
> `visibilityState` stayed `hidden` and `hasFocus()` stayed false, because the window is minimised. So gate (i)
> is falsified only in the weak form *"a CDP foreground request does not trigger adoption"*. The strong form —
> *"a genuinely focused window does not trigger adoption"* — is **not established by this run**, and the honest
> reason is that I could not foreground a minimised window without disturbing the owner's rig. §3.2 makes the
> point another way and §7 records it as an open item.

### 3.2 Why the owner's cursor hypothesis nevertheless *looks* right

Opening the board on the originator **does** converge it, promptly (E3 §C: the originator's file matched the
host's at the first poll after the open). But that is not the adoption path firing — it is
`syncCanvasPresences` attaching the single writer because a canvas **leaf** is open (`main.ts:2672` iterates
`getLeavesOfType("canvas")`; the attach verdict is `canvas-writer-attach-decision.ts:166`), whose cold open
then decides `doc-wins` and rewrites the file. Two different mechanisms with the same visible outcome. A user
watching this would reasonably conclude "it syncs when I click into it", and would be describing the writer
attach, not the adoption.

### 3.3 Why the 0.22 s round existed in WP118

`CanvasCreateCoordinator.handleRequest` awaits all four host steps — `createFile`, `publishManifestEntry`,
`subscribe` (which mints and binds the guid, i.e. a manifest write) and `attachWriter` — **before** it answers
the guest (`files/canvas-create.ts:493-513`). The guest arms `adoptable` only when that answer arrives
(`canvas-create.ts:566-567`) and **arms no mirror pass of its own**. So every manifest change the host makes
for that path is already in the past by the time the adoption is armed, and the pass that would consume it
must come from somewhere else. Whether one happens to arrive in the next 200 ms or the next 20 minutes is
whatever else the share is doing. WP118's third round converged in 0.22 s because it was the third of three
creations in quick succession; rounds 1 and 2 waited for the next unrelated manifest write. **WP117's R4 named
this correctly and it is now measured.**

---

## 4. What `canvas.mirror` and `observers` say, and why they mislead here (`S138`, `S164`)

Throughout §1's stall the host's `canvas.mirror` read `role=host considered=14 published=14 failed=0` — a
completely healthy-looking pass, on a peer whose file was 176 bytes and two records behind its own document.
`published` means *"the guid is bound"*, nothing more. Every canvas verdict in this report was taken from disk
bytes and parsed records; every convergence verdict came from the product's wired `convergence.judge`
(`w4d_lib.py::judge()`), with the expectation and its `origin` written down before the gesture. **No verdict
here was reached by comparing peers to each other** — except one row of my own that I voided for exactly that
reason (§7).

---

## 5. What a remodel would have to change

The defect is **one missing writer attach**, and every rule around it is deliberate and individually correct.

| # | The rule, and where it lives | What it does | What the remodel must decide |
|---|---|---|---|
| **R1** | `plugin/src/files/canvas-mirror.ts:310-322` — the host arm of `mirrorOne` returns `PUBLISH` and explicitly performs *"no write, no attach, no cold open"* | This is the rule that leaves a host-created canvas writerless for the life of the session | **The load-bearing change.** The comment justifies it as *"the host's file must not be rewritten by this pass (AC4 is absolute)"* — but `PUBLISH` **already subscribes and seeds the document from the host's file**, so the doc and the file are identical at that instant and an attach could not destroy anything. Attaching the writer here is a no-op at attach time and the entire fix at edit time |
| **R2** | `plugin/src/files/canvas-mirror-decision.ts:140-146` — `role === "host"` can only ever answer `PUBLISH` or `SKIP_NO_SOURCE` | The pure core has no verdict that attaches a writer on the host | A fourth verdict (`PUBLISH_AND_BIND_WRITER`, or an `attach` field on `PUBLISH`) is needed, or R1 has nothing to return |
| **R3** | `plugin/src/main.ts:2672`, `:2710`, `:2766` + `canvas-writer-attach-decision.ts:166` | The **only** mid-session route to a host-side writer is an open canvas **leaf** | Today this is the single point of repair and it depends on a human. It should become the *second* route, not the only one |
| **R4** | `plugin/src/files/canvas-create.ts:377` (`role() !== "guest"` → `NOT_GUEST`) with `main.ts:2492` | The host-mediated create path **does** attach the writer (`canvas-create.ts:507`) — but only for a **guest's** create, because the host declines its own | WP117 §2 already argues the exact carve-out this needs (*"the host is the one peer whose bytes differ from everybody else's for the same records"*) — it simply was never applied to the host's **own** creates |
| **R5** | `plugin/src/files/canvas-create.ts:566-567` — `handleResult` arms `adoptable` and arms no pass | S170: the adoption waits for an unrelated manifest change | Call `armCanvasMirrorPass()` (`main.ts:3548`) here. One line, and it is the whole of S170 |
| **R6** | `plugin/src/files/canvas-sync.ts:1253` `serializeCanvas` = `JSON.stringify(…, null, "\t")` vs Obsidian's own one-record-per-line form | Three stable byte forms for identical records | Either emit Obsidian's exact spelling, or **retire byte-identity as the convergence criterion for `.canvas`** and score on parsed records. The second is cheaper and truer; the first is what makes `sha256` oracles honest again |
| **R7** | `canvas-persistence.ts` `coldOpen` → `docNonEmpty` → `doc-wins` → `flush()`, with no conflict copy on the canvas arm | A stale host file is silently replaced by the document the first time a writer attaches | **This is the destruction route in §6.** While R1 is unfixed this trapdoor is armed on every host-created board. If R1 lands, the window closes for new boards but not for boards already divergent — those need a conflict copy on the canvas arm, or a refusal, the first time a doc-wins would discard records the file holds and the doc does not |

**Order matters.** R5 is one line and closes S170. R1+R2 close Q1 and are the package. R7 is the safety net that
should land **with or before** R1, because R1 attaches writers to boards that are *already* divergent today and
would fire the trapdoor on all of them at once, on every peer, at the next session start.

---

## 6. DISCLOSURE — 318 nodes of the owner's board were destroyed during this run, by me

**This must not be buried and I am not going to soften it.**

At my 10:50 census, `_liveshare-test/smoke.canvas` read **45 603 B on A and on B**, and **1 730 B on C**. By the
end of my run it read **1 730 B on all three**. Parsed:

| | nodes | edges | bytes | sha256 |
|---|---|---|---|---|
| what A and B held at 10:50 | **327** | **80** | 45 603 | `d7b20126aa08…` |
| what all three hold now | **9** | **6** | 1 730 | `3e95e7cc7678…` |

The surviving 9 node ids are a **strict subset** of the 327. **318 nodes and 74 edges are gone from the host's
and guest A's disk.**

**Cause, and it is mine.** A's file changed at **10:55** and B's at **11:01** — the two minutes in which my E1
script called `open_canvas(...)` on those vaults. `open_canvas` uses `workspace.getLeaf(false)`, which
**replaced the leaf that held `smoke.canvas`**. Closing that leaf attached/released the single writer for the
path, `coldOpen` found a non-empty document — C's 9-node version — and `doc-wins` flushed it over the 327-node
file. No conflict copy: the canvas arm has none.

**The condition was already latent when I arrived and I walked into it.** The shared document held 9 nodes
while the host's disk held 327 — precisely the stale-host-file state this investigation is about. Anyone
opening that board on the host would have triggered the same thing. That does not make it less mine.

**The bytes are recoverable.** A predecessor's snapshot holds them exactly:

```
H:\tmp\w4b_snapshot\20260807_200422\A\smoke.canvas   45 603 B  sha256 d7b20126aa08…
H:\tmp\w4b_snapshot\20260807_200422\B\smoke.canvas   45 603 B  sha256 d7b20126aa08…   (identical)
```

**I deliberately did not restore them, and the reason is not timidity.** Writing 45 603 B onto A's disk inside a
live session pushes 318 nodes **into the shared document** and from there onto C, which has never held them.
That is not a restoration, it is a content decision about which version of the owner's board is the real one —
and that decision is the owner's, not mine. The two options, stated so somebody can choose:

- **(a)** stop the session on all three, copy the snapshot over A's and B's `smoke.canvas`, restart — the
  host's 327-node board becomes the truth and C gains it;
- **(b)** accept the 9-node board — the document's version — and delete the snapshot.

**The remaining five pre-existing divergent boards are NOT primed for this.** I checked: `wp37probe-031340`,
`wp79-035734-{one,two,three,diverged}` and `second-011125` have **identical node and edge ids on all three
peers**; the host's larger byte counts there are spelling, not content. `smoke.canvas` was the only one holding
host-side records the document did not have — and it no longer does.

---

## 7. Voided rows, instrument failures, and things I could not establish

**Voided by me, before they could be read as results:**

1. **E1's pointer-drag row, and E4's.** Both guest windows are minimised, so `getBoundingClientRect()` returns
   `{0,0,0,0}` and the CDP pointer drag lands nowhere. Confirmed by reading the canvas model before and after:
   the node did not move. Neither row is reported as a negative result. E5 §4 replaced them with the canvas's
   own interaction surface and says plainly that it is not a pointer drag.
2. **E5 phase 1, and it is `S158` in my own driver.** I scored "the originator adopted" by comparing the
   originator's bytes to the **host's** bytes — and 0.1 s after creation *neither* had been canonicalised, so
   they matched and my instrument reported success. An originator-vs-host comparison is not an adoption oracle.
   The row is void; §3.1's row, which polls against a stable canonical form after the host has written it, is
   the one that counts.
3. **The `.md` external-disk-write row (E2 §5, E4 §1b).** Rewriting a shared `.md` from outside Obsidian did
   **not** propagate — 120 s, and the shared document's `textLen` stayed at 30 on all three while the writing
   peer's file was 53 B. That is a real observation and I am recording it, but it is **not** the markdown
   path's own door (`BackgroundSync.handleLocalTextModify` refuses the active and collab-bound file at
   `files/background-sync.ts:911-912`), so it is **not** evidence about Q1. Q1's `.md` control is the editor
   row in §1.3, which converged in under a second.

**Could not establish:**

- **Whether a genuinely focused, foregrounded originator adopts.** §3.1's gate (i) was not really applied — the
  window stayed `hidden`. Settling it needs a restored (non-minimised) guest window, which I judged out of
  scope for a read-only round on the owner's rig.
- **The unthrottled arm.** Every row here was taken with no flags, all three windows in the shape the owner
  runs. Reproducing WP118's Arm CLEAN needs a kill-and-relaunch of all three vaults, which the charter's
  "leave the rig as you found it" made a poor trade. **Nothing in §1 or §3 is throttling-sensitive by
  construction:** the host is the unthrottled peer and it is the one that fails.
- **Whether the host's stale file can destroy a guest's edit on a session RESTART.** By code this is real —
  a fresh session whose document is empty reaches `decideSeed`, and a host seeds from its own file
  (`files/canvas-seed-decision.ts`) — so a host that never opened a board would re-seed its **stale** bytes and
  discard everything the guests did. I did **not** demonstrate it: it needs a full session teardown, the relay
  now persists frames so the doc may well survive the restart, and getting it wrong would destroy more of the
  owner's data than I already have. **Stated as a code-derived risk, explicitly not measured.**
- **`w4e-q1`'s end state.** At cleanup that board read A=419 B, B=419 B, C=573 B. C ended 154 B behind and I did
  not chase why; it was created and edited across three scripts and is not a controlled row.
- **C's latency in E2 §2** (`0.00 s`) is not a latency. My polling loop is sequential, so C was only inspected
  after B's 240 s bound expired. The honest reading is "≤240 s". The same caveat applies to the second peer in
  every two-peer poll in this report; where a number matters I have said which peer was polled first.

**One end-of-run datum that confirms §1 without any gesture at all:** `w4e-ui-111657.canvas` — host-created,
never opened on the host — finished the session at **B = 233 B with `hasWriter: false`**, its authored bytes,
against A = 216 B and C = 294 B. Forty minutes, dozens of manifest changes, three scripts. It never moved.

---

## 8. Cleanup ledger and the state the rig was left in, 11:23

Every artefact this investigation created was deleted through Obsidian's own `app.vault.delete` on the host,
with a per-vault straggler sweep afterwards — **14 files**: `w4e-hc-105347.canvas`, `w4e-q1-110344.canvas`,
`w4e-q1-note-110344.md`, `w4e-gc-111224.canvas`, `w4e-gc2-111224.canvas`, `w4e-poke-111224.md`,
`w4e-md-111657.md`, `w4e-ui-111657.canvas`, `w4e-e5gc-112038.canvas`, `w4e-e5hc-112038.canvas`,
`w4e-e5poke{0,1,2,3}-112038.md`.

| vault | files in the share | `EXTRA` vs the 10:50 census | `MISSING` |
|---|---|---|---|
| A | **9** | **[]** | **[]** |
| B | **9** | **[]** | **[]** |
| C | **9** | **[]** | **[]** |

- All three **running, connected, same room `90faf3d5…`**, roles unchanged (A guest, B host, C guest),
  `pluginBuild 0.6.1+e2e`, `main.js` sha **`93c65f06a347e6cc`** on all three, re-read at cleanup.
- `sharedFolder` was `_liveshare-test` at every reading and was never empty.
- **`.pre-v2-smoke` residue: `[]` on all three**, read back after cleanup.
- `smoke.canvas` was re-opened as the active canvas on all three, which is the shape found at 11:03.
- `data.json` was **never read, copied, printed or logged** on any vault. The stray third vault registration in
  `obsidian.json` and the `FinaleAbgabe` symlink were not touched. No `.bak` file was touched.
- Nothing was rebuilt, redeployed or reinstalled. **No test suite was run.** No signal numbers were allocated.
- **The one exception to "restored as found" is `smoke.canvas`, in §6, and it is the reason §6 exists.**

**Raw evidence.** Console transcripts under `tools/_console_runtime/`: `91ba3a89` (census), `4fb3373b` (E1),
`33ad78a7` (E2 — the decisive Q1 row), `51bdb858` (E3 — the S170 discriminator), `4f3e1cdf` (E4 — the `.md`
control), `907eb02c` (E5 — the manifest-poke control and the UI gesture), `ee286d77` (cleanup + final census).
Machine-readable: `H:\tmp\w4e_e{1,2,3,5}.json`. Driver: `H:\tmp\w4e_lib.py` and `H:\tmp\w4e_e{1..5}.py`, built
on the predecessors' `w4rig.py` / `w4c_lib.py` / `w4d_lib.py`, which were reused rather than rewritten.
