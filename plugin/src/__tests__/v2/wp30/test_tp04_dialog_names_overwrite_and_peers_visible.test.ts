// WP30 / AC3, first half — "A confirmation dialog is shown first, naming what
// will be overwritten and whose work is affected".
//
// THE DIALOG TEXT IS A DELIVERABLE, NOT DECORATION. A test that asserts "a modal
// appeared" does not test AC3 at all: "Are you sure?" appears too, and it names
// neither what is destroyed nor who loses it. So the subject here is the STRING,
// and the assertions are about its content.
//
// HOW THE TEXT IS PINNED WITHOUT PINNING ONE WORDING. Freezing an exact sentence
// would make every later copy-edit a test failure and would still not prove the
// sentence says anything — an implementation could hard-code the fixture's own
// sentence and pass. Three independent families of assertion are used instead,
// and no single one of them can be satisfied by a constant:
//
//   ├── CONTAINMENT — the message must carry the DATA verbatim: the board path,
//   │   the live record count as a decimal, and every affected peer's display
//   │   name. A constant string carries none of them.
//   ├── SENSITIVITY — changing any ONE field of the summary must change the
//   │   message. This is the assertion a hard-coded sentence cannot survive, and
//   │   it is what makes "generic text" a detectable class rather than a taste
//   │   judgement.
//   └── FAMILY MEMBERSHIP — the message must contain a destructive verb from a
//       SET of acceptable words, never one exact word, so the wording stays free
//       while the meaning does not.
//
// Plus one coercion guard: no `undefined`, `null`, `NaN` or `[object Object]`
// may reach a dialog that is asking the user to authorise a destruction. WP28
// recorded exactly this class ("a file the user cannot find, or a notice
// pointing at nothing"); a dialog that says "overwrite undefined" is the same
// defect one function to the left.
//
// SPLIT WITH HUMAN_OBSERVABLE: the RENDERING of this dialog — that a modal
// actually opens, that the paragraph and the two buttons are on screen, that the
// warning styling reads as dangerous — is not unit-observable here (the Obsidian
// mock's `contentEl.createEl` returns `{}`), and is a W4 HUMAN_OBSERVABLE
// target. The TEXT is fully unit-testable and is tested here.
//
// PRODUCTION LINE <-> ASSERTION: `importConfirmationMessage` in
// `plugin/src/canvas/canvas-import-command.ts`, and the summary construction in
// `runImportFromFile` (`plugin/src/files/canvas-import.ts`). Returning any
// constant string reddens containment AND sensitivity; dropping the peers from
// the message reddens `names every affected peer`; building the summary from a
// hard-coded peer list instead of `env.peers(path)` reddens
// `the peer information reflects the peers who are actually there`.

import { describe, expect, it } from "vitest";

import {
  type ImportOverwriteSummary,
  importConfirmationMessage,
} from "../../../canvas/canvas-import-command";
import { runImportFromFile } from "../../../files/canvas-import";
import { CANVAS_PATH, canvasJson, createImportHarness, textNode } from "./harness";

const DESTRUCTIVE_VERBS = /overwrit|replac|discard|destro|lose|lost|erase|wipe/i;
const COERCION_ARTEFACTS = ["undefined", "null", "NaN", "[object Object]"];

function summary(overrides: Partial<ImportOverwriteSummary> = {}): ImportOverwriteSummary {
  return {
    canvasPath: CANVAS_PATH,
    liveRecordCount: 12,
    fileRecordCount: 3,
    peers: [{ displayName: "Ada Lovelace" }, { displayName: "Grace Hopper" }],
    ...overrides,
  };
}

describe("WP30 tp04 — the confirmation names what is overwritten and whose work is affected", () => {
  it("names the board that will be overwritten", () => {
    expect(importConfirmationMessage(summary())).toContain(CANVAS_PATH);
  });

  it("names how much live work is at stake", () => {
    const message = importConfirmationMessage(summary({ liveRecordCount: 12 }));
    expect(message).toMatch(/(^|\D)12(\D|$)/);
  });

  it("says, in one of several acceptable words, that this is destructive", () => {
    expect(importConfirmationMessage(summary())).toMatch(DESTRUCTIVE_VERBS);
  });

  it("names every affected peer", () => {
    const message = importConfirmationMessage(summary());
    expect(message).toContain("Ada Lovelace");
    expect(message).toContain("Grace Hopper");
  });

  it("still addresses the shared board when nobody else is connected", () => {
    const alone = importConfirmationMessage(summary({ peers: [] }));
    expect(alone).toContain(CANVAS_PATH);
    expect(alone).toMatch(DESTRUCTIVE_VERBS);
    expect(alone.trim().length).toBeGreaterThan(0);
    // and it must not invent a collaborator who is not there
    expect(alone).not.toContain("Ada Lovelace");
    expect(alone).not.toContain("Grace Hopper");
  });

  it("distinguishes the with-peers case from the alone case", () => {
    // The peer clause is REAL text, not an empty slot that renders the same
    // sentence either way. If these two agree, the dialog is not telling the
    // user whose work is affected — it is telling them nothing twice.
    expect(importConfirmationMessage(summary())).not.toBe(
      importConfirmationMessage(summary({ peers: [] })),
    );
  });

  it("is sensitive to EVERY field of the summary (a constant string is not)", () => {
    const base = importConfirmationMessage(summary());
    const variants: [string, ImportOverwriteSummary][] = [
      ["canvasPath", summary({ canvasPath: "decks/retro.canvas" })],
      ["liveRecordCount", summary({ liveRecordCount: 999 })],
      ["peers", summary({ peers: [{ displayName: "Katherine Johnson" }] })],
      ["no peers", summary({ peers: [] })],
    ];
    for (const [field, variant] of variants) {
      expect(importConfirmationMessage(variant), `insensitive to ${field}`).not.toBe(base);
    }
  });

  it("adding one more peer changes the message again", () => {
    const two = importConfirmationMessage(summary());
    const three = importConfirmationMessage(
      summary({
        peers: [
          { displayName: "Ada Lovelace" },
          { displayName: "Grace Hopper" },
          { displayName: "Katherine Johnson" },
        ],
      }),
    );
    expect(three).not.toBe(two);
    expect(three).toContain("Katherine Johnson");
  });

  it("never leaks a coercion artefact into a destructive confirmation", () => {
    for (const peers of [[], [{ displayName: "Ada Lovelace" }]]) {
      const message = importConfirmationMessage(summary({ peers, liveRecordCount: 0 }));
      for (const artefact of COERCION_ARTEFACTS) {
        expect(message, `leaked ${artefact}`).not.toContain(artefact);
      }
    }
  });

  it("refuses a malformed summary rather than rendering a plausible wrong sentence", () => {
    const malformed: unknown[] = [
      null,
      undefined,
      "boards/plan.canvas",
      { ...summary(), canvasPath: "" },
      { ...summary(), canvasPath: 7 },
      { ...summary(), liveRecordCount: -1 },
      { ...summary(), liveRecordCount: Number.NaN },
      { ...summary(), liveRecordCount: "12" },
      { ...summary(), peers: "Ada" },
      { ...summary(), peers: [{ displayName: "" }] },
      { ...summary(), peers: [{ displayName: undefined }] },
    ];
    for (const bad of malformed) {
      expect(
        () => importConfirmationMessage(bad as ImportOverwriteSummary),
        `accepted ${JSON.stringify(bad)}`,
      ).toThrow(TypeError);
    }
  });

  it("the dialog the import actually shows is this message, over the real summary", async () => {
    const harness = createImportHarness({
      liveNodes: [textNode("live-1", 0, "one"), textNode("live-2", 40, "two")],
      liveEdges: [],
      peers: [{ displayName: "Ada Lovelace" }, { displayName: "Grace Hopper" }],
      fileText: canvasJson([textNode("file-1", 10, "from the file")]),
      answer: false,
    });
    await runImportFromFile(CANVAS_PATH, harness.env);

    expect(harness.confirmCalls).toHaveLength(1);
    const call = harness.confirmCalls[0];
    expect(call.message).toBe(importConfirmationMessage(call.summary));
    expect(call.message).toContain(CANVAS_PATH);
    expect(call.message).toContain("Ada Lovelace");
    expect(call.message).toContain("Grace Hopper");
  });

  it("the summary reflects the LIVE board, not the file it will be replaced with", async () => {
    const harness = createImportHarness({
      liveNodes: [textNode("live-1", 0, "one"), textNode("live-2", 40, "two")],
      liveEdges: [],
      fileText: canvasJson([textNode("file-1", 10, "from the file")]),
      answer: false,
    });
    await runImportFromFile(CANVAS_PATH, harness.env);

    expect(harness.confirmCalls).toHaveLength(1);
    const { summary: shown } = harness.confirmCalls[0];
    expect(shown.canvasPath).toBe(CANVAS_PATH);
    expect(shown.liveRecordCount).toBe(2);
    expect(shown.fileRecordCount).toBe(1);
  });

  it("the peer information reflects the peers who are actually there", async () => {
    const withPeers = createImportHarness({
      peers: [{ displayName: "Ada Lovelace" }],
      answer: false,
    });
    await runImportFromFile(CANVAS_PATH, withPeers.env);
    expect(withPeers.confirmCalls).toHaveLength(1);
    expect(withPeers.confirmCalls[0].summary.peers).toEqual([{ displayName: "Ada Lovelace" }]);
    expect(withPeers.env.peers).toHaveBeenCalledWith(CANVAS_PATH);

    const alone = createImportHarness({ peers: [], answer: false });
    await runImportFromFile(CANVAS_PATH, alone.env);
    expect(alone.confirmCalls).toHaveLength(1);
    expect(alone.confirmCalls[0].summary.peers).toEqual([]);

    // The two runs differ ONLY in who is connected, and the dialog says so.
    expect(withPeers.confirmCalls[0].message).not.toBe(alone.confirmCalls[0].message);
  });
});
