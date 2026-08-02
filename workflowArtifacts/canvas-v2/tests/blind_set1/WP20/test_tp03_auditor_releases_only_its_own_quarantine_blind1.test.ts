// WP20 AC2 blind1 — the record that is BOTH user-deleted AND schema-invalid.
//
// The visible test separates the two classes with a valid, deleted record. This
// one collides them, which is the state a real room reaches constantly: a peer
// deletes a card while its record is still half-written, or a card is deleted
// and a later partial delta damages what is left. The record is now suppressed
// AND fails the schema, so both of the auditor's rules have an opinion about it
// and they point in opposite directions if the release rule is written as "the
// record validates now → release" instead of "MY quarantine no longer applies →
// release".
//
// The invariant, whatever the auditor decides to write, is one sentence: THE
// RECORD STAYS HIDDEN. It was hidden before the audit by the user's own act, and
// no repair — not a quarantine, not a release, not both in sequence — may put it
// back on the board. That is asserted through WP12's shared predicate and
// through the projection, and it is asserted after SEVERAL passes, because the
// interesting failure is a quarantine on pass 1 followed by a release on pass 2.
//
// The second record is the same collision resolved the other way: user-deleted,
// invalid, and then REPAIRED by a peer. A record whose fields are complete again
// is still deleted, and the auditor's release must not double as an undo.

import { TFile } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { encodePos, encodeSize } from "../../../canvas/canvas-registers";
import type { SurfaceState } from "../../../canvas/canvas-shadow";
import { isTombstoneSuppressed, readTombstoneEntry } from "../../../canvas/canvas-tombstone";
import { CanvasSync, buildCanvasData, serializeCanvas } from "../../../files/canvas-sync";

const PATH = "collision.canvas";

function createVault() {
  const files = new Map<string, string>();
  return {
    files,
    read: vi.fn(async (file: { path: string }) => files.get(file.path) ?? ""),
    adapter: {
      write: vi.fn(async (p: string, c: string) => {
        files.set(p, c);
      }),
      read: vi.fn(async (p: string) => files.get(p) ?? ""),
      exists: vi.fn(async (p: string) => files.has(p)),
    },
    getAbstractFileByPath: vi.fn((p: string) => {
      if (!files.has(p)) return null;
      const f = new TFile();
      f.path = p;
      return f;
    }),
  };
}

function createSyncManager() {
  const docs = new Map<string, { doc: Y.Doc; text: Y.Text; awareness: unknown }>();
  return {
    docs,
    getDoc(docId: string) {
      if (!docs.has(docId)) {
        const doc = new Y.Doc();
        docs.set(docId, { doc, text: doc.getText("content"), awareness: {} });
      }
      return docs.get(docId) as { doc: Y.Doc; text: Y.Text; awareness: unknown };
    },
    releaseDoc: vi.fn(),
    waitForSync: vi.fn(async () => {}),
  };
}

async function auditingClient(path: string) {
  const vault = createVault();
  const syncManager = createSyncManager();
  const cs = new CanvasSync(
    vault as never,
    syncManager as never,
    { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() } as never,
  );
  cs.setLogger({ debug: () => {}, warn: () => {} });
  cs.setSurfaceStateProvider(
    (): SurfaceState => ({
      viewOpen: false,
      handedToView: { node: new Set<string>(), edge: new Set<string>() },
    }),
  );
  await cs.subscribe(path, "guest");
  return { cs, doc: syncManager.getDoc(`__canvas__:${path}`).doc };
}

function record(fields: Record<string, unknown>): Y.Map<unknown> {
  const map = new Y.Map<unknown>();
  for (const [key, value] of Object.entries(fields)) map.set(key, value);
  return map;
}

function makePeer(target: Y.Doc) {
  const peer = new Y.Doc();
  return (mutate: (doc: Y.Doc) => void) => {
    peer.transact(() => mutate(peer));
    Y.applyUpdate(target, Y.encodeStateAsUpdate(peer), "remote");
  };
}

function audit(): void {
  vi.runOnlyPendingTimers();
}

describe("WP20 AC2 blind1 — a record that is both deleted and invalid never comes back", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("stays hidden across repeated audits, and stays hidden even after a peer repairs its fields", async () => {
    const client = await auditingClient(PATH);
    const nodes = client.doc.getMap<Y.Map<unknown>>("nodes");
    const edges = client.doc.getMap<Y.Map<unknown>>("edges");
    const deleted = client.doc.getMap<unknown>("deleted");
    const push = makePeer(client.doc);

    push((peer) => {
      const space = peer.getMap<Y.Map<unknown>>("nodes");
      space.set(
        "onstage",
        record({
          id: "onstage",
          type: "text",
          pos: encodePos(0, 0),
          size: encodeSize(200, 100),
          text: "still here",
        }),
      );
      // Deleted AND invalid (a `link` node with no `url`).
      space.set(
        "gonebroken",
        record({ id: "gonebroken", type: "link", pos: encodePos(300, 0), size: encodeSize(200, 100) }),
      );
      // Deleted AND invalid, and about to be repaired by a peer.
      space.set(
        "gonemended",
        record({ id: "gonemended", type: "link", pos: encodePos(600, 0), size: encodeSize(200, 100) }),
      );
      const tombstones = peer.getMap<unknown>("deleted");
      tombstones.set("gonebroken", { t: 12, by: "peer-zeta", on: true });
      tombstones.set("gonemended", { t: 12, by: "peer-zeta", on: true });
    });

    for (const id of ["gonebroken", "gonemended"]) {
      expect(
        isTombstoneSuppressed(readTombstoneEntry(deleted, id)),
        `the user delete for ${id} never reached the doc`,
      ).toBe(true);
    }

    audit();
    audit();
    audit();

    for (const id of ["gonebroken", "gonemended"]) {
      expect(
        isTombstoneSuppressed(readTombstoneEntry(deleted, id)),
        `${id} was un-suppressed by the audit: a deleted record came back on its own`,
      ).toBe(true);
    }

    // A peer now completes one of them. Complete is not undeleted.
    push((peer) => {
      peer
        .getMap<Y.Map<unknown>>("nodes")
        .get("gonemended")
        ?.set("url", "https://example.invalid/repaired");
    });
    audit();
    audit();

    expect(
      isTombstoneSuppressed(readTombstoneEntry(deleted, "gonemended")),
      "repairing a DELETED record's fields un-deleted it — the release doubled as an undo",
    ).toBe(true);
    expect(
      isTombstoneSuppressed(readTombstoneEntry(deleted, "gonebroken")),
      "the untouched deleted record came back",
    ).toBe(true);

    expect(
      buildCanvasData(nodes, edges, deleted).nodes.map((node) => node.id),
      "a deleted record is rendered again",
    ).toEqual(["onstage"]);
    expect(
      (JSON.parse(serializeCanvas(nodes, edges, deleted)) as { nodes: { id: unknown }[] }).nodes.map(
        (node) => String(node.id),
      ),
      "a deleted record reached the user's file again",
    ).toEqual(["onstage"]);

    // …and neither of them was destroyed on the way through.
    for (const id of ["gonebroken", "gonemended"]) {
      expect(nodes.has(id), `${id} lost its key: the audit destroyed a deleted record`).toBe(true);
    }

    client.cs.destroy();
  });
});
