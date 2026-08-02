// WP8 AC1 — third angle: identity must survive a THIRD call that is
// interleaved with (a) replicating the doc to a peer and (b) an unrelated
// local mutation (a brand-new node), so the test cannot be satisfied by an
// implementation that only special-cases "the very next call".
//
// The peer replica is also checked: once it receives the update it must
// converge to the SAME schemaVersion value, proving the stamped meta is
// real shared CRDT state and not a local-only side channel.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  META_MAP_NAME,
  SCHEMA_VERSION_KEY,
  SUPPORTED_SCHEMA_MAJOR,
  migrateV1ToV2,
} from "../../../canvas/canvas-schema";

function push(from: Y.Doc, to: Y.Doc): void {
  Y.applyUpdate(to, Y.encodeStateAsUpdate(from, Y.encodeStateVector(to)), "peer");
}

describe("WP8 AC1 — identity survives replication and interleaved unrelated writes", () => {
  it("meta stays the same instance across three calls, across a peer push, and after an unrelated node write", () => {
    const doc = new Y.Doc();
    migrateV1ToV2(doc);
    const metaA = doc.getMap<unknown>(META_MAP_NAME);
    metaA.set("__probe__", "still-here");

    migrateV1ToV2(doc);
    const metaB = doc.getMap<unknown>(META_MAP_NAME);
    expect(metaB).toBe(metaA);

    // Replicate to a peer, then keep mutating the ORIGINAL doc.
    const peer = new Y.Doc();
    push(doc, peer);

    doc.getMap<Y.Map<unknown>>("nodes").set("unrelated", new Y.Map<unknown>());

    migrateV1ToV2(doc);
    const metaC = doc.getMap<unknown>(META_MAP_NAME);

    expect(metaC, "identity must survive a third call interleaved with unrelated writes").toBe(
      metaA,
    );
    expect(metaC.get("__probe__")).toBe("still-here");
    expect(metaC.get(SCHEMA_VERSION_KEY)).toBe(SUPPORTED_SCHEMA_MAJOR);

    push(doc, peer);
    expect(peer.getMap<unknown>(META_MAP_NAME).get(SCHEMA_VERSION_KEY)).toBe(
      SUPPORTED_SCHEMA_MAJOR,
    );

    doc.destroy();
    peer.destroy();
  });
});
