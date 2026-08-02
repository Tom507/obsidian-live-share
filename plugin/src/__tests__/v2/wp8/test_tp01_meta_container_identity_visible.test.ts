// WP8 / AC1 — "`meta` is created once per doc ... it is never replaced by a
// new container."
//
// The weak version of this test would just check `meta` exists after a
// second call. That would also pass a buggy implementation that quietly
// swaps in a FRESH `Y.Map` on every call (e.g. re-deriving it from
// `doc.share` instead of caching), as long as it re-stamps `schemaVersion`
// each time — nothing downstream would notice until a concurrent peer's
// write to the old container silently stopped merging into the new one.
//
// The oracle here is CONTAINER IDENTITY, not mere existence:
//   ├── reference equality of the returned `Y.Map` across calls, and
//   └── a probe value planted directly on the container between calls
//       survives the next call untouched — a "replace" would silently drop
//       it, exactly like a real guid/epoch value (P2) would be dropped.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  META_MAP_NAME,
  SCHEMA_VERSION_KEY,
  SUPPORTED_SCHEMA_MAJOR,
  migrateV1ToV2,
} from "../../../canvas/canvas-schema";

describe("WP8 AC1 — meta container is created once and never replaced", () => {
  it("a second migrateV1ToV2 call returns the SAME meta container and preserves a planted probe value", () => {
    const doc = new Y.Doc();

    // First call: fresh doc, no records — this is the "ensure meta" case.
    migrateV1ToV2(doc);
    const metaA = doc.getMap<unknown>(META_MAP_NAME);
    expect(metaA.get(SCHEMA_VERSION_KEY)).toBe(SUPPORTED_SCHEMA_MAJOR);

    // Plant a probe directly on the container — stands in for a value a later
    // WP (guid/epoch, P2) would have written. A "replace" bug drops it.
    metaA.set("__identityProbe__", "sentinel-A");

    // Second call: meta already exists — must be idempotent AND must not
    // swap the container for a new instance.
    migrateV1ToV2(doc);
    const metaB = doc.getMap<unknown>(META_MAP_NAME);

    expect(metaB, "meta must be the SAME Y.Map instance across calls").toBe(metaA);
    expect(
      metaB.get("__identityProbe__"),
      "a replaced container would silently drop this value",
    ).toBe("sentinel-A");
    expect(metaB.get(SCHEMA_VERSION_KEY)).toBe(SUPPORTED_SCHEMA_MAJOR);

    doc.destroy();
  });
});
