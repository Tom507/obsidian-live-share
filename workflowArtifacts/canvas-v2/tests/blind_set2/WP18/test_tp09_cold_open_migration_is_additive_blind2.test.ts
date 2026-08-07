// WP18 blind2 — additive and lossless where "lossless" is hardest to get
// right: every value in the record is FALSY.
//
// `x: 0`, `y: 0`, `color: ""`, `text: ""`, `flag: false` are all real values a
// user can produce — a card at the origin, a cleared colour, an empty note.
// Any carry-through written as `if (value) record.set(...)`, any "skip the
// empties" tidy-up, and any truthiness-guarded copy loses every one of them
// while passing a fixture built from non-empty strings and non-zero numbers.
//
// `encodePos(0, 0)` is also the case where a register is indistinguishable from
// "no register" to a truthiness check, so the geometry half is asserted through
// WP9's reader rather than by a boolean.

import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import {
  type V2RecordMap,
  readPosRegister,
  readSizeRegister,
} from "../../../canvas/canvas-registers";
import { CanvasPersistence, type PersistenceIO } from "../../../files/canvas-persistence";

const DISK = "falsy.canvas";

function asRecordMap(map: Y.Map<unknown>): V2RecordMap {
  return {
    get: (key: string) => map.get(key),
    set: (key: string, value: unknown) => map.set(key, value),
  };
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

const FALSY_NODE: Record<string, unknown> = {
  id: "origin-card",
  type: "text",
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  text: "",
  color: "",
  collapsed: false,
};

describe("WP18 blind2 — the cold-open migration keeps values a truthiness check would drop", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("zeroes, empty strings and `false` all survive, and the zero-valued registers are added", async () => {
    const doc = new Y.Doc();
    doc.transact(() => {
      const nodes = doc.getMap<Y.Map<unknown>>("nodes");
      const record = new Y.Map<unknown>();
      nodes.set("origin-card", record);
      for (const [key, value] of Object.entries(FALSY_NODE)) record.set(key, value);
    });

    const io = createIO({ [DISK]: JSON.stringify({ nodes: [], edges: [] }) });
    const persistence = new CanvasPersistence(doc, io, DISK, {
      logger: { debug: () => {}, warn: () => {} },
    });

    await persistence.coldOpen();

    const card = doc.getMap<Y.Map<unknown>>("nodes").get("origin-card");
    expect(card, "the record did not survive the cold open").toBeDefined();
    const record = card as Y.Map<unknown>;

    for (const [key, value] of Object.entries(FALSY_NODE)) {
      expect(record.has(key), `the migration dropped the falsy field \`${key}\``).toBe(true);
      expect(record.get(key), `the migration changed the falsy field \`${key}\``).toEqual(value);
    }

    expect(
      readPosRegister(asRecordMap(record)),
      "no `pos` register was written for a card sitting at the origin",
    ).toEqual([0, 0]);
    expect(
      readSizeRegister(asRecordMap(record)),
      "no `size` register was written for a zero-sized card",
    ).toEqual([0, 0]);

    persistence.destroy();
    doc.destroy();
  });
});
