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

- **Targeted repaint — this is what actually fixes it today.** When a remote change is applied to a card, that
  card is repainted immediately. In live validation across three machines this fired **12 times** and every
  single call found genuinely stale pixels and corrected them.
- **A background repair sweep**, intended as a safety net for damage from paths we have not yet identified.
  **It does not currently work — see below.** It is inert, not harmful.

Both are suppressed while you are dragging a card or typing in one, so they cannot interfere with editing.

**The safety net is not working in 0.7.0.** Measured over 270 seconds on three peers: **0 repairs across 5538
sweep calls.** Two independent causes, both confirmed:

- The batch is filled from a priority list of off-screen cards that never empties, so the round-robin cursor
  never advances past its starting position — the sweep re-examines the same few cards forever.
- The 1-second timer is throttled by the browser engine to roughly **one tick per minute** when the window is
  not in the foreground, so even a working sweep would take minutes rather than seconds to cover a board.

**So: the visible improvement in 0.7.0 comes entirely from the targeted repaint.** That is a real fix for the
common path and it is doing the work. The safety net is a stub until repaired.

**Why this is still "mitigated" and not "fixed".** One producing path is named and open: a whole-board reload
(triggered by, among other things, moving a card that an arrow connects to) hands the entire board to Obsidian
at once and has no single card to repaint. It was meant to be covered by the sweep, and currently is not.

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
