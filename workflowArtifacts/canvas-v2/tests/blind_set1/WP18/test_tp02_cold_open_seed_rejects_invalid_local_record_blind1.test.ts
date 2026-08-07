// WP18 AC1 blind1 — the cold-open seed boundary, approached from the opposite
// side of the schema: the file's records fail on the TYPE-SPECIFIC conjunct
// and on the ID conjunct's neighbours rather than on `type` itself.
//
// Two invalid records, two different reason families, one file:
//   ├── a `file` node with no `file` value      → the type-specific requirement
//   └── a node whose `type` is not a string     → an ill-typed core conjunct
//
// And one record that MUST survive: a `group` node carrying nothing but the
// four core fields. `group` has no type-specific requirement at all, so a
// boundary that rejects "anything without a payload" fails here — which is the
// point. Silence in the type table means "nothing further is demanded", never
// "unknown, therefore refuse".

import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { CanvasPersistence, type PersistenceIO } from "../../../files/canvas-persistence";

const DISK = "groups.canvas";
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
    // Valid: a frame that holds nothing of its own.
    { id: "frame", type: "group", x: 0, y: 0, width: 800, height: 600, label: "Sprint" },
    // Invalid: a file node with no file.
    { id: "orphan-file", type: "file", x: 20, y: 20, width: 200, height: 100 },
    // Invalid: `type` present but not a string.
    { id: "numeric-type", type: 7, x: 300, y: 20, width: 200, height: 100, text: "?" },
  ],
  edges: [],
});

describe("WP18 AC1 blind1 — the cold-open seed refuses type-specific and ill-typed failures", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("both invalid nodes are refused while the payload-free `group` node is seeded", async () => {
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

    expect(
      [...nodes.keys()],
      "the cold-open seed did not filter the file's invalid records to exactly the valid one",
    ).toEqual(["frame"]);
    expect(
      nodes.get("frame")?.get("label"),
      "the surviving record lost its payload on the way in",
    ).toBe("Sprint");

    for (const refused of ["orphan-file", "numeric-type"]) {
      const signature = lines.find((line) => line.includes(refused));
      expect(signature, `no rejection signature was emitted for \`${refused}\``).toBeDefined();
      expect(signature ?? "", "the signature does not name the boundary").toMatch(/seed/i);
      expect(signature ?? "", "the signature does not name the reason").toMatch(REASON_CODE);
    }

    persistence.destroy();
    doc.destroy();
  });
});
