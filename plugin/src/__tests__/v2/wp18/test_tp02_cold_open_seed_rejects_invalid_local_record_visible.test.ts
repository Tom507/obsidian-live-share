// WP18 / AC1 — the SECOND local seed boundary: `CanvasPersistence.coldOpen()`
// (doc empty → the file is parsed once and seeded through
// `seedDocFromCanvasData`).
//
// The two seed boundaries are separate code paths (`canvas-sync.ts`'s
// `applyCanvasToYMaps` and `canvas-persistence.ts`'s `seedDocFromCanvasData`),
// so AC1's "EVERY local write boundary" is only satisfied when both consult
// the validator. Wiring one and not the other is exactly the failure this
// probe exists to catch.
//
// State is the oracle; the signature is the AC's own secondary requirement.

import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { CanvasPersistence, type PersistenceIO } from "../../../files/canvas-persistence";

const DISK = "board.canvas";

const REASON_CODE = /\b(MISSING|INVALID)_[A-Z_]+\b/;

function canvasJson(
  nodes: Record<string, unknown>[],
  edges: Record<string, unknown>[] = [],
): string {
  return JSON.stringify({ nodes, edges });
}

function createIO(initial: Record<string, string> = {}) {
  const files = new Map<string, string>(Object.entries(initial));
  const io = {
    files,
    read: vi.fn(async (p: string) => files.get(p) ?? ""),
    write: vi.fn(async (p: string, c: string) => {
      files.set(p, c);
    }),
    exists: vi.fn(async (p: string) => files.has(p)),
    mutePathEvents: vi.fn((_p: string) => {}),
    unmutePathEvents: vi.fn((_p: string) => {}),
  };
  return io satisfies PersistenceIO & { files: Map<string, string> };
}

const VALID_NODE = {
  id: "n-ok",
  type: "text",
  x: 0,
  y: 0,
  width: 120,
  height: 60,
  text: "survivor",
};
/** No `type` — WP14 `MISSING_TYPE`, spelt identically in both vocabularies. */
const TYPELESS_NODE = { id: "n-bad", x: 300, y: 0, width: 120, height: 60, text: "refused" };

describe("WP18 AC1 — the cold-open seed consults the ingest validator before writing", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("a type-less node in the file is never seeded into the empty doc; the valid one is", async () => {
    const doc = new Y.Doc();
    const io = createIO({ [DISK]: canvasJson([VALID_NODE, TYPELESS_NODE]) });
    const lines: string[] = [];
    const persistence = new CanvasPersistence(doc, io, DISK, {
      logger: {
        debug: (_c: string, m: string) => lines.push(m),
        warn: (_c: string, m: string) => lines.push(m),
      },
    });

    const result = await persistence.coldOpen();
    const nodes = doc.getMap<Y.Map<unknown>>("nodes");

    expect(result, "the cold open did not take the seed branch — this probe would be vacuous").toBe(
      "seeded-from-file",
    );
    expect(
      nodes.has("n-bad"),
      "an invalid LOCAL record was seeded: coldOpen does not consult the validator",
    ).toBe(false);
    expect(nodes.get("n-bad"), "an empty container was left behind for the rejected id").toBeUndefined();
    expect(nodes.has("n-ok"), "the valid record was not seeded at all").toBe(true);

    const signature = lines.find((line) => line.includes("n-bad"));
    expect(signature, "no rejection signature was emitted at the cold-open boundary").toBeDefined();
    expect(signature ?? "", "the signature does not name the boundary").toMatch(/seed/i);
    expect(signature ?? "", "the signature does not name the reason").toMatch(REASON_CODE);
    expect(signature ?? "", "the reason is not the one WP14 diagnoses").toContain("MISSING_TYPE");

    persistence.destroy();
    doc.destroy();
  });
});
