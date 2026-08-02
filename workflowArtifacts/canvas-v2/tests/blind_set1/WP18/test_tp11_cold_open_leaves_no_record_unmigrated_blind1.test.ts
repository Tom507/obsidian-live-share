// WP18 blind1 — the cold-open post-condition, checked on the record kinds and
// the field families the visible probe does not use.
//
// Same claim: when `coldOpen` resolves, nothing in the doc is still
// unmigrated, on either branch. Different pressure:
//
//   ├── the nodes are `link` and `file` typed, so the type-specific conjunct of
//   │   the ingest schema is live rather than trivially satisfied by `text`;
//   ├── the edge carries `fromEnd` / `toEnd`, so the endpoint translation has
//   │   a third component to carry rather than two; and
//   ├── the post-condition is asked through WP9/WP10's READERS as well as
//   │   through the validator, so "valid" cannot be satisfied by a record that
//   │   validates for a reason unrelated to the registers.
//
// The intermediate vocabulary the seed writes is not asserted: the WP16 decode
// bridge is a P1 scaffold, not a WP18 acceptance criterion.

import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { validateEdgeIngest, validateNodeIngest } from "../../../canvas/canvas-ingest-schema";
import {
  V2_FIELD,
  type V2RecordMap,
  readFrom,
  readPosRegister,
  readSizeRegister,
  readTo,
} from "../../../canvas/canvas-registers";
import {
  META_MAP_NAME,
  SCHEMA_VERSION_KEY,
  SUPPORTED_SCHEMA_MAJOR,
} from "../../../canvas/canvas-schema";
import { CanvasPersistence, type PersistenceIO } from "../../../files/canvas-persistence";

const DISK = "mixed.canvas";

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

const FILE_CONTENT = JSON.stringify({
  nodes: [
    {
      id: "ln",
      type: "link",
      x: 5,
      y: -5,
      width: 400,
      height: 300,
      url: "https://example.invalid/page",
    },
    {
      id: "fn",
      type: "file",
      x: 600,
      y: -5,
      width: 250,
      height: 150,
      file: "vault/note.md",
      subpath: "#heading",
    },
  ],
  edges: [
    {
      id: "arc",
      fromNode: "ln",
      fromSide: "bottom",
      fromEnd: "none",
      toNode: "fn",
      toSide: "top",
      toEnd: "arrow",
    },
  ],
});

function expectFullyMigrated(doc: Y.Doc): void {
  expect(
    doc.getMap<unknown>(META_MAP_NAME).get(SCHEMA_VERSION_KEY),
    "cold open returned with the doc still unstamped",
  ).toBe(SUPPORTED_SCHEMA_MAJOR);

  const nodes = doc.getMap<Y.Map<unknown>>("nodes");
  const edges = doc.getMap<Y.Map<unknown>>("edges");
  expect(nodes.size, "no node survived — the probe would be vacuous").toBeGreaterThan(0);

  for (const [id, record] of nodes) {
    expect(
      validateNodeIngest(asRecordMap(record), "local").valid,
      `node ${id} is still unmigrated after cold open returned`,
    ).toBe(true);
    expect(readPosRegister(asRecordMap(record)), `node ${id} has no readable pos`).toBeDefined();
    expect(readSizeRegister(asRecordMap(record)), `node ${id} has no readable size`).toBeDefined();
    expect(typeof record.get(V2_FIELD.ord), `node ${id} has no ord`).toBe("string");
  }
  for (const [id, record] of edges) {
    expect(
      validateEdgeIngest(asRecordMap(record), "local").valid,
      `edge ${id} is still unmigrated after cold open returned`,
    ).toBe(true);
    expect(readFrom(asRecordMap(record)), `edge ${id} has no readable from`).toBeDefined();
    expect(readTo(asRecordMap(record)), `edge ${id} has no readable to`).toBeDefined();
    expect(typeof record.get(V2_FIELD.ord), `edge ${id} has no ord`).toBe("string");
  }
}

describe("WP18 blind1 — cold open leaves nothing unmigrated, on either branch", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("seed branch: typed nodes and a three-component endpoint all come out V2", async () => {
    const doc = new Y.Doc();
    const io = createIO({ [DISK]: FILE_CONTENT });
    const persistence = new CanvasPersistence(doc, io, DISK, {
      logger: { debug: () => {}, warn: () => {} },
    });

    expect(await persistence.coldOpen()).toBe("seeded-from-file");
    expect([...doc.getMap<Y.Map<unknown>>("nodes").keys()].sort()).toEqual(["fn", "ln"]);
    expectFullyMigrated(doc);

    // The type-specific payloads and the third endpoint component travelled.
    const nodes = doc.getMap<Y.Map<unknown>>("nodes");
    expect(nodes.get("ln")?.get(V2_FIELD.url)).toBe("https://example.invalid/page");
    expect(nodes.get("fn")?.get(V2_FIELD.file)).toBe("vault/note.md");
    expect(nodes.get("fn")?.get(V2_FIELD.subpath)).toBe("#heading");
    const arc = doc.getMap<Y.Map<unknown>>("edges").get("arc") as Y.Map<unknown>;
    expect(readTo(asRecordMap(arc))).toEqual({ node: "fn", side: "top", end: "arrow" });

    persistence.destroy();
    doc.destroy();
  });

  it("doc-wins branch: a V1 doc of typed nodes comes out V2 without a seed", async () => {
    const doc = new Y.Doc();
    doc.transact(() => {
      const nodes = doc.getMap<Y.Map<unknown>>("nodes");
      const record = new Y.Map<unknown>();
      nodes.set("relay", record);
      for (const [k, v] of Object.entries({
        id: "relay",
        type: "link",
        x: 1,
        y: 2,
        width: 300,
        height: 200,
        url: "https://example.invalid/relay",
      })) {
        record.set(k, v);
      }
    });

    const io = createIO({ [DISK]: FILE_CONTENT });
    const persistence = new CanvasPersistence(doc, io, DISK, {
      logger: { debug: () => {}, warn: () => {} },
    });

    expect(await persistence.coldOpen()).toBe("doc-wins");
    expect(
      [...doc.getMap<Y.Map<unknown>>("nodes").keys()],
      "the file leaked into the doc on the doc-wins branch",
    ).toEqual(["relay"]);
    expectFullyMigrated(doc);

    persistence.destroy();
    doc.destroy();
  });
});
