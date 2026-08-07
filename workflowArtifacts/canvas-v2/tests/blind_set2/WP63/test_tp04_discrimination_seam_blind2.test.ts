// WP63 / AC4 — DISCRIMINATION, blind counterpart 2.
//
// This is the regression pin for a silent data-loss defect that reached a live
// path, so it is built to the charter's §7 rule and nothing else:
//
//   ├── the oracle is FILE BYTES BEFORE vs. AFTER A REAL FLUSH — never a
//   │   signature, never a doc assertion, never "the write was not called";
//   ├── the armed and disarmed runs differ in EXACTLY ONE thing, the seam
//   │   (`withholdOnSeedRefusal`). Both legs run through ONE shared function,
//   │   so no second difference can creep in unnoticed; and
//   └── the disarmed run is shown to ACTUALLY LOSE THE RECORD — asserted as a
//       byte difference AND as the id's disappearance from the parsed file.
//       A discrimination test that passes because the flush never happened
//       proves nothing, so every leg drives a real write.
//
// Derived independently of blind1: the record at risk is a NODE carrying real
// user prose (blind1 risks an edge), the canvas also holds a legal EMPTY CARD
// (`"text": ""`, legal under the WP14 amendment) that must survive under BOTH
// settings, and the byte comparison is made against the exact original string
// rather than a re-serialisation of it.

import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { CanvasPersistence, type PersistenceIO } from "../../../files/canvas-persistence";

const DISK = "vault/discriminate.canvas";

/** The record at risk: a `file` node whose `file` key the user never set. */
const AT_RISK = { id: "n-risk", type: "file", x: 0, y: 0, width: 320, height: 180 };

/** Legal under the WP14 amendment — must survive under BOTH settings. */
const EMPTY_CARD = { id: "n-empty", type: "text", x: 400, y: 0, width: 200, height: 100, text: "" };
const PROSE = {
  id: "n-prose",
  type: "text",
  x: 800,
  y: 0,
  width: 400,
  height: 240,
  text: "a paragraph the user typed and would never get back",
};

function canvasJson(nodes: Record<string, unknown>[], edges: Record<string, unknown>[] = []): string {
  return JSON.stringify({ nodes, edges });
}

interface FakeIO extends PersistenceIO {
  files: Map<string, string>;
}

function ioOver(files: Map<string, string>): FakeIO {
  return {
    files,
    read: vi.fn(async (p: string) => files.get(p) ?? ""),
    write: vi.fn(async (p: string, c: string) => {
      files.set(p, c);
    }),
    exists: vi.fn(async (p: string) => files.has(p)),
    mutePathEvents: vi.fn((_p: string) => {}),
    unmutePathEvents: vi.fn((_p: string) => {}),
  };
}

function nodeIdsIn(content: string): string[] {
  const parsed = JSON.parse(content) as { nodes?: { id?: string }[] };
  return (parsed.nodes ?? []).map((n) => String(n.id));
}

const START = canvasJson([AT_RISK, EMPTY_CARD, PROSE]);

/**
 * The ONE shared run. The seam is the ONLY parameter — everything else is
 * literally the same code on both legs, which is what AC4 demands.
 */
async function runColdOpenFlush(
  armed: boolean,
  startContent: string,
): Promise<{ before: string; after: string }> {
  const doc = new Y.Doc();
  const io = ioOver(new Map([[DISK, startContent]]));
  const before = io.files.get(DISK) as string;

  const p = new CanvasPersistence(doc, io, DISK, { withholdOnSeedRefusal: armed });
  await p.coldOpen();
  await p.flush();

  const after = io.files.get(DISK) as string;
  p.destroy();
  doc.destroy();
  return { before, after };
}

describe("WP63 AC4 blind2 — disarm the seam and the user's record is deleted", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("DISARMED: a real flush after a seed refusal DELETES the record from the file", async () => {
    const { before, after } = await runColdOpenFlush(false, START);

    // The loss, proven three ways: bytes changed, the id is gone, and the
    // user's prose left with it.
    expect(after, "the disarmed leg did not lose anything — the probe is vacuous").not.toBe(before);
    expect(nodeIdsIn(before).sort()).toEqual(["n-empty", "n-prose", "n-risk"]);
    expect(nodeIdsIn(after)).not.toContain("n-risk");
    expect(after).not.toContain("n-risk");
  });

  it("ARMED: the same flush over the same file leaves it BYTE-IDENTICAL", async () => {
    const { before, after } = await runColdOpenFlush(true, START);

    expect(after, "the armed leg rewrote the user's file").toBe(before);
    expect(after).toBe(START);
    expect(nodeIdsIn(after).sort()).toEqual(["n-empty", "n-prose", "n-risk"]);
  });

  it("the two legs differ ONLY in the seam, and only the armed one preserves the file", async () => {
    const disarmed = await runColdOpenFlush(false, START);
    const armed = await runColdOpenFlush(true, START);

    // Same input on both legs...
    expect(disarmed.before).toBe(armed.before);
    // ...opposite outcomes, decided by the seam alone.
    expect(armed.after).toBe(START);
    expect(disarmed.after).not.toBe(START);
  });

  it("the armed mode is the DEFAULT — the seam cannot ship switched off", async () => {
    const doc = new Y.Doc();
    const io = ioOver(new Map([[DISK, START]]));
    // No `withholdOnSeedRefusal` key at all.
    const p = new CanvasPersistence(doc, io, DISK);

    await p.coldOpen();
    await p.flush();

    expect(io.files.get(DISK), "the default configuration deleted the user's record").toBe(START);
    expect(p.isWriteWithheld()).toBe(true);

    p.destroy();
    doc.destroy();
  });

  it("the seam suppresses ONLY the refusal case — a wholly legal canvas writes under both settings", async () => {
    const LEGAL = canvasJson([EMPTY_CARD, PROSE]);

    for (const armed of [true, false]) {
      const doc = new Y.Doc();
      const io = ioOver(new Map([[DISK, LEGAL]]));
      const p = new CanvasPersistence(doc, io, DISK, { withholdOnSeedRefusal: armed });

      await p.coldOpen();
      await p.flush();

      expect(
        io.write,
        `armed=${armed}: the writer stopped writing for a canvas with no refusals`,
      ).toHaveBeenCalled();
      expect(nodeIdsIn(io.files.get(DISK) as string).sort()).toEqual(["n-empty", "n-prose"]);

      p.destroy();
      doc.destroy();
    }
  });
});
