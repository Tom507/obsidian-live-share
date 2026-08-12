# Known issues

Current as of **v0.7.3**.

---

## Fixed in v0.7.3 — a shared canvas painting cards in the wrong place

This was issue §1 in v0.7.0–v0.7.2, where it was recorded as *"mitigated, not fixed — a producing path
remains unidentified"*. **The producing path has been identified and removed.** The entry is kept here, rather
than deleted, because the earlier releases described the symptom at length and anyone who read that
description deserves to know what it actually was.

**What you saw.** On a shared canvas, when another peer grabbed a card, some of *your* cards jumped out of
place. Panning made it worse and rearranged things differently each time. Cards would sometimes snap back
into place on their own, only to come apart again on the next action.

**What it actually was.** A single CSS declaration, in this plugin, in `plugin/styles.css`.

The highlight ring drawn around a card that a remote peer is holding was applied as a class on Obsidian's own
card element, and that class declared `position: relative`. Obsidian lays its canvas out with
`.canvas-node { position: absolute; width: 0; height: 0 }` and writes each card's real geometry as an
*inline* transform and inline width/height. Forcing one card to `position: relative` put it back into the
normal document flow at its real height, which pushed every card *after it in DOM order* down by exactly that
card's height.

That also explains the two things that made it look random. Obsidian re-appends a card to the end of the DOM
whenever it scrolls back into view, so **panning re-orders the DOM** — a different set of cards ended up
"after" the held card each time. And when the held card itself happened to be re-appended last, there was
nothing after it, so the board **snapped back to correct** until the next change.

**Why it took so long to find.** The symptom looked exactly like a sync failure, and it was not: the shared
document, every peer's model, and every `.canvas` file on disk were correct and identical throughout. Several
rounds of work went into repainting cards that were never painted wrong. The instrument that compared a
card's *stored* position with its *inline transform* agreed in every one of 650 measurements — because that
comparison was never where the fault was. The fault was one layer further out, between the transform and the
pixels the browser actually laid out, and the one reading that did show it had been dismissed as a
measurement error.

**Your data was never affected at any point,** in any version. This was always a rendering defect.

**The fix** is the removal of that one declaration. The ring looks exactly the same — `outline`,
`box-shadow` and `border-radius` do not affect layout, which is why the ring is drawn with those and nothing
else.

---

## 1. The background repair sweep is inert

**Severity:** low — it is dead weight, not a hazard. Nothing depends on it any more.

v0.7.0 added a background "repair sweep" as a safety net against mis-painted cards. Measurement shows it has
never repaired anything: across 48 diagnostic records, **72,961 sweep attempts and 0 repairs**, and the
structural-repaint path recorded **0 attempts**. Two confirmed causes: the batch is filled from a priority
list of off-screen cards that never empties, so the round-robin cursor never advances; and its 1-second timer
is throttled by the browser engine to roughly one tick per minute when the window is not in the foreground.

This mattered a great deal while the canvas was believed to be mis-painting, because the sweep was thought to
be holding the line. It was not — and now that the actual cause is gone, there is nothing for it to repair.
It is left in place, and recorded here, rather than removed in the same change that fixed the rendering
defect. Removing it is its own piece of work.

---

## 2. Arrows between cards are not checked (unexamined)

**Severity:** unknown — not observed in practice.

Everything above concerns **cards**. Nothing currently verifies that an **arrow** is drawn to the right place.
Moving a card that an arrow connects to can leave that arrow's stored attachment sides stale, which would make
it look detached from the card it points at.

A board whose cards are all correct but whose arrows are mis-routed would currently pass every check we have.
This is recorded rather than repaired, at the maintainer's direction, because it has not been observed.

---

## 3. The vault name is missing from diagnostics (cosmetic, developer-facing)

Diagnostic output reports a blank vault name, so captures are identified by port number alone. It affects
troubleshooting output only and has no effect on syncing.

---

## 4. Convergence checks cannot see a rendering defect (developer-facing)

The end-to-end convergence tooling compares the **shared document** — node and edge records — and reports
agreement between peers. It does not read a single pixel. A board whose cards are all painted in the wrong
place still reports as converged, because by that definition it *is*.

This is worth stating plainly because it is how the v0.7.0–v0.7.2 defect above stayed hidden for so long:
every automated check agreed the board was fine, and every one of them was answering a different question
than the one being asked. A rendering fault needs an oracle that measures laid-out geometry.
