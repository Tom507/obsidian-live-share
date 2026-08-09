# Known issues

Current as of **v0.7.0**.

---

## 1. A shared canvas can paint a card in the wrong place (mitigated, not fixed)

**Severity:** cosmetic — **your data is never affected.**

**What you may see.** On a shared canvas, after someone moves a card, another peer's screen can show a
different card sitting somewhere it does not belong. Move a few more cards and the picture can look badly
scrambled.

**What is actually happening.** Nothing is wrong with the board. Measured across three live vaults with the
canvas open on all of them: the moved card reaches every peer's **shared document** and every peer's
**`.canvas` file on disk** correctly and identically, and it is the only record that changes. The defect is in
**rendering only** — Obsidian updates a card's stored coordinates and, on certain paths, never repaints the
element, so the pixels lag a document that is entirely correct.

**Why it looked like it was getting worse.** Each mis-paint persists until something repaints that card, so
they accumulate on screen while the underlying board stays perfectly in sync.

**What v0.7.0 does about it.**

- **Targeted repaint** — when a remote change is applied to a card, that card is repainted immediately. This
  closes the common path.
- **A background repair sweep** — a few cards per second, round-robin, are checked and repainted if their
  pixels disagree with their stored position. This is a *restoring force*: damage from any path we have not
  yet identified is repaired continuously instead of accumulating.

Both are suppressed while you are dragging a card or typing in one, so they cannot interfere with editing.

**Why this is "mitigated" and not "fixed".** In live validation the sweep still found and repaired real
mis-paints that the targeted repaint did not prevent — so **a producing path remains unidentified.** The board
looks correct because the repair is running, not because the defect is gone. One path is already named and
open: a whole-board reload (triggered by, among other things, moving a card that an arrow connects to) hands
the entire board to Obsidian at once and has no single card to repaint, so it relies on the sweep rather than
being repaired instantly.

**Workaround if you ever see it.** Close the canvas tab and reopen it. A remount rebuilds every card from the
document, which is always correct.

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
