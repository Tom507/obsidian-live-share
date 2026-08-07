// WP18 blind2 — the migration call site on a PARTIALLY migrated doc.
//
// A room with mixed builds produces exactly this: a record that already carries
// a `pos` register written by a newer peer, while its flat `x`/`y` still hold
// the older values the two never reconciled. The registers disagree with the
// flat keys, and the disagreement is not this call site's to resolve.
//
// The correct outcome is conservative and asymmetric:
//   ├── an existing register is NEVER recomputed from the flat keys — the peer
//   │   authored it, and overwriting it would silently move a card back, which
//   │   is the corruption cascade this whole initiative exists to kill;
//   └── a register the record does NOT yet have is added from whole flat keys.
//
// A call site that migrated "everything, to be sure" fails the first half; one
// that skipped any record already holding a register fails the second.

import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import {
  META_MAP_NAME,
  SCHEMA_VERSION_KEY,
  SUPPORTED_SCHEMA_MAJOR,
} from "../../../canvas/canvas-schema";
import {
  V2_FIELD,
  type V2RecordMap,
  encodePos,
  readPosRegister,
  readSizeRegister,
} from "../../../canvas/canvas-registers";
import { CanvasPersistence, type PersistenceIO } from "../../../files/canvas-persistence";

const DISK = "mixed-room.canvas";

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

describe("WP18 blind2 — cold open completes a half-migrated record without overwriting it", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("an existing `pos` register survives untouched while the missing `size` register is added", async () => {
    const doc = new Y.Doc();
    doc.transact(() => {
      const nodes = doc.getMap<Y.Map<unknown>>("nodes");
      const halfMigrated = new Y.Map<unknown>();
      nodes.set("moved", halfMigrated);
      halfMigrated.set(V2_FIELD.id, "moved");
      halfMigrated.set(V2_FIELD.type, "text");
      // The newer peer already moved this card and wrote the register.
      halfMigrated.set(V2_FIELD.pos, encodePos(900, 900));
      // The stale flat coordinates from before the move are still lying around.
      halfMigrated.set("x", 10);
      halfMigrated.set("y", 10);
      halfMigrated.set("width", 220);
      halfMigrated.set("height", 110);
      halfMigrated.set(V2_FIELD.text, "moved by a peer");

      const untouched = new Y.Map<unknown>();
      nodes.set("plain", untouched);
      untouched.set("id", "plain");
      untouched.set("type", "text");
      untouched.set("x", 0);
      untouched.set("y", 0);
      untouched.set("width", 100);
      untouched.set("height", 100);
      untouched.set("text", "plain");
    });

    expect(doc.share.has(META_MAP_NAME), "the fixture is already stamped").toBe(false);

    const io = createIO({ [DISK]: JSON.stringify({ nodes: [], edges: [] }) });
    const persistence = new CanvasPersistence(doc, io, DISK, {
      logger: { debug: () => {}, warn: () => {} },
    });

    expect(await persistence.coldOpen()).toBe("doc-wins");
    expect(
      doc.getMap<unknown>(META_MAP_NAME).get(SCHEMA_VERSION_KEY),
      "cold open left the doc unstamped",
    ).toBe(SUPPORTED_SCHEMA_MAJOR);

    const nodes = doc.getMap<Y.Map<unknown>>("nodes");
    const moved = nodes.get("moved") as Y.Map<unknown>;
    const plain = nodes.get("plain") as Y.Map<unknown>;

    expect(
      readPosRegister(asRecordMap(moved)),
      "the peer's `pos` register was recomputed from the stale flat keys — the card jumped back",
    ).toEqual([900, 900]);
    expect(
      readSizeRegister(asRecordMap(moved)),
      "the half-migrated record was skipped entirely: its missing `size` register was never added",
    ).toEqual([220, 110]);
    expect(moved.get("x"), "the stale flat key was deleted rather than carried through").toBe(10);

    expect(readPosRegister(asRecordMap(plain))).toEqual([0, 0]);
    expect(readSizeRegister(asRecordMap(plain))).toEqual([100, 100]);

    for (const [id, record] of nodes) {
      expect(typeof record.get(V2_FIELD.ord), `record ${id} was migrated without an ord`).toBe(
        "string",
      );
    }

    persistence.destroy();
    doc.destroy();
  });
});
