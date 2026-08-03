// WP30 / AC3 (the text) blind2 — attacked by SUBSTITUTION and by SCALE.
//
// SUBSTITUTION. The weakest way to pass a containment test is to interpolate one
// field and let the others be coincidentally present. So each field is replaced,
// one at a time, with a value that is ALREADY a substring of the base message —
// a board path that is also a peer's name, a peer name that is also the record
// count, a count whose digits already appear in the path. Containment cannot
// distinguish those cases; a message that actually renders each field can, and
// the discriminator used here is therefore "the message changed", never "the
// message contains".
//
// SCALE. A dialog that names two collaborators may name only two by
// construction — a template with two slots, a `slice(0, 2)`, a "and 1 other"
// that swallows the rest. Boards in this project routinely carry more, and the
// user whose work is about to be destroyed may be the fourth name. So the peer
// list is swept from 0 to 12 and every name is required at every size, together
// with strict growth of the message set: 13 sizes must produce 13 distinct
// messages.
//
// The third attack is REFERENTIAL TRANSPARENCY. The message must be a function
// of the summary VALUE, not of the object identity, not of call order, and not
// of anything ambient. Two structurally equal summaries built independently, and
// one round-tripped through JSON, must all render identically.

import { describe, expect, it } from "vitest";

import {
  type ImportOverwriteSummary,
  importConfirmationMessage,
} from "../../../../../plugin/src/canvas/canvas-import-command";

const BASE: ImportOverwriteSummary = {
  canvasPath: "vault/deck.canvas",
  liveRecordCount: 8,
  fileRecordCount: 2,
  peers: [{ displayName: "Nia" }, { displayName: "Ori" }],
};

describe("WP30 tp04 blind2 — substitution and scale", () => {
  it("changes when the board path changes to a string already in the message", () => {
    const base = importConfirmationMessage(BASE);
    const shifted = importConfirmationMessage({ ...BASE, canvasPath: "Nia/deck.canvas" });
    expect(shifted).not.toBe(base);
    expect(shifted).toContain("Nia/deck.canvas");
  });

  it("changes when a peer is renamed to a string already in the message", () => {
    const base = importConfirmationMessage(BASE);
    const shifted = importConfirmationMessage({
      ...BASE,
      peers: [{ displayName: "8" }, { displayName: "Ori" }],
    });
    expect(shifted).not.toBe(base);
  });

  it("changes when the live count changes to digits already in the path", () => {
    const path = "vault/deck-2026.canvas";
    const a = importConfirmationMessage({ ...BASE, canvasPath: path, liveRecordCount: 8 });
    const b = importConfirmationMessage({ ...BASE, canvasPath: path, liveRecordCount: 2026 });
    expect(a).not.toBe(b);
  });

  it("names every collaborator from 0 to 12, with no silent truncation", () => {
    const roster = Array.from({ length: 12 }, (_, i) => ({ displayName: `person-${i + 1}` }));
    const messages = new Set<string>();

    for (let size = 0; size <= roster.length; size++) {
      const peers = roster.slice(0, size);
      const message = importConfirmationMessage({ ...BASE, peers });
      for (const peer of peers) {
        expect(message, `size ${size} dropped ${peer.displayName}`).toContain(peer.displayName);
      }
      messages.add(message);
    }

    expect(messages.size).toBe(roster.length + 1);
  });

  it("names the LAST collaborator as reliably as the first", () => {
    // The one an "and N others" template loses, and the one most likely to be
    // the person actually holding unsaved work.
    for (let size = 1; size <= 12; size++) {
      const peers = Array.from({ length: size }, (_, i) => ({ displayName: `p${i}` }));
      const message = importConfirmationMessage({ ...BASE, peers });
      expect(message, `size ${size}`).toContain(`p${size - 1}`);
    }
  });

  it("is referentially transparent in the summary value", () => {
    const twin: ImportOverwriteSummary = {
      canvasPath: "vault/deck.canvas",
      liveRecordCount: 8,
      fileRecordCount: 2,
      peers: [{ displayName: "Nia" }, { displayName: "Ori" }],
    };
    const roundTripped = JSON.parse(JSON.stringify(BASE)) as ImportOverwriteSummary;

    expect(importConfirmationMessage(twin)).toBe(importConfirmationMessage(BASE));
    expect(importConfirmationMessage(roundTripped)).toBe(importConfirmationMessage(BASE));
  });

  it("does not depend on call order or on how many times it has run", () => {
    const first = importConfirmationMessage(BASE);
    for (let i = 0; i < 25; i++) {
      importConfirmationMessage({ ...BASE, canvasPath: `noise/${i}.canvas` });
    }
    expect(importConfirmationMessage(BASE)).toBe(first);
  });

  it("says something even about an empty board with nobody connected", () => {
    const message = importConfirmationMessage({
      canvasPath: "vault/deck.canvas",
      liveRecordCount: 0,
      fileRecordCount: 0,
      peers: [],
    });
    expect(message.trim().length).toBeGreaterThan(0);
    expect(message).toContain("vault/deck.canvas");
    expect(message).not.toContain("undefined");
    expect(message).not.toContain("NaN");
  });
});
