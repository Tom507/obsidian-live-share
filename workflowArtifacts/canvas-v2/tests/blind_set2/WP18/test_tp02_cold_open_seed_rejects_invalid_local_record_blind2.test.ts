// WP18 AC1 blind2 — the cold-open seed boundary where EVERY edge in the file
// is broken and every node is sound.
//
// The asymmetry is the angle: a boundary that refuses per-record leaves the
// nodes map fully seeded and the edges map completely EMPTY, which is a state
// no "reject the whole file" and no "accept the whole file" implementation can
// produce. The three edges also fail in three different ways, so a boundary
// that happened to catch one shape does not pass by accident.

import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { CanvasPersistence, type PersistenceIO } from "../../../files/canvas-persistence";

const DISK = "broken-wires.canvas";
const REASON_CODE = /\b(MISSING|INVALID)_[A-Z_]+\b/;

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

const FILE_CONTENT = JSON.stringify({
  nodes: [
    { id: "alpha", type: "text", x: 0, y: 0, width: 100, height: 100, text: "alpha" },
    { id: "beta", type: "text", x: 200, y: 0, width: 100, height: 100, text: "beta" },
    { id: "gamma", type: "group", x: 400, y: 0, width: 100, height: 100 },
  ],
  edges: [
    // no `toNode` at all
    { id: "w-no-to", fromNode: "alpha", fromSide: "right" },
    // no `fromNode` at all
    { id: "w-no-from", toNode: "beta", toSide: "left" },
    // both present, but the endpoint is not a node reference
    { id: "w-numeric", fromNode: 12, fromSide: "right", toNode: "gamma", toSide: "left" },
  ],
});

describe("WP18 AC1 blind2 — a file of sound nodes and broken edges seeds only the nodes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("the edges map stays empty, the nodes map is complete, and each refusal is signed", async () => {
    const doc = new Y.Doc();
    const io = createIO({ [DISK]: FILE_CONTENT });
    const lines: string[] = [];
    const persistence = new CanvasPersistence(doc, io, DISK, {
      logger: {
        debug: (_c: string, m: string) => lines.push(m),
        warn: (_c: string, m: string) => lines.push(m),
      },
    });

    await persistence.coldOpen();

    const nodes = doc.getMap<Y.Map<unknown>>("nodes");
    const edges = doc.getMap<Y.Map<unknown>>("edges");

    expect([...nodes.keys()].sort(), "a sound node was refused along with the edges").toEqual([
      "alpha",
      "beta",
      "gamma",
    ]);
    expect(
      [...edges.keys()],
      "a broken edge was seeded: the cold-open boundary does not consult the validator",
    ).toEqual([]);
    expect(edges.size, "husk containers were left behind for the refused edges").toBe(0);

    for (const refused of ["w-no-to", "w-no-from", "w-numeric"]) {
      const signature = lines.find((line) => line.includes(refused));
      expect(signature, `no rejection signature was emitted for \`${refused}\``).toBeDefined();
      expect(signature ?? "", "the signature does not name the boundary").toMatch(/seed/i);
      expect(signature ?? "", "the signature does not name the reason").toMatch(REASON_CODE);
    }

    persistence.destroy();
    doc.destroy();
  });
});
