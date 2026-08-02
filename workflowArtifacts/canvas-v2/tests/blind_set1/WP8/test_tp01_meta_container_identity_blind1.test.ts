// WP8 AC1 — same guarantee as the visible test, attacked from a different
// angle: the container is first created by a REAL migration of a V1-shaped
// doc (not an empty fresh doc), so `meta` is born alongside live node/edge
// data. The second, idempotent call must not disturb either the container
// identity or the data it migrated.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  META_MAP_NAME,
  SCHEMA_VERSION_KEY,
  SUPPORTED_SCHEMA_MAJOR,
  migrateV1ToV2,
} from "../../../canvas/canvas-schema";

function v1Node(doc: Y.Doc, id: string, fields: Record<string, unknown>): void {
  const nodes = doc.getMap<Y.Map<unknown>>("nodes");
  const record = new Y.Map<unknown>();
  for (const [key, value] of Object.entries(fields)) record.set(key, value);
  nodes.set(id, record);
}

describe("WP8 AC1 — container identity survives idempotent re-migration of real data", () => {
  it("meta stays the same instance and a planted probe survives a second call after a real V1 migration", () => {
    const doc = new Y.Doc();
    v1Node(doc, "card-1", {
      id: "card-1",
      type: "text",
      x: 10,
      y: 20,
      width: 300,
      height: 150,
      text: "hello",
    });

    migrateV1ToV2(doc);
    const metaA = doc.getMap<unknown>(META_MAP_NAME);
    expect(metaA.get(SCHEMA_VERSION_KEY)).toBe(SUPPORTED_SCHEMA_MAJOR);
    metaA.set("__probe__", { marker: 42 });

    // Idempotent re-run on already-migrated data.
    migrateV1ToV2(doc);
    const metaB = doc.getMap<unknown>(META_MAP_NAME);

    expect(metaB).toBe(metaA);
    expect(metaB.get("__probe__")).toEqual({ marker: 42 });
    expect(metaB.get(SCHEMA_VERSION_KEY)).toBe(SUPPORTED_SCHEMA_MAJOR);

    // The migrated record itself must still be intact (identity check should
    // never be satisfiable by an implementation that happens to wipe data).
    const record = doc.getMap<Y.Map<unknown>>("nodes").get("card-1");
    expect(record?.get("id")).toBe("card-1");
    expect(record?.get("type")).toBe("text");

    doc.destroy();
  });
});
