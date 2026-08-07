// WP20 AC2 blind2 — the two suppression classes on EDGES, and the user's undo
// as the discriminator.
//
// A user delete and a quarantine are both `on:true`; WP12 says they are told
// apart by `q`. This test makes that distinction load-bearing from the OTHER
// side: instead of asking the auditor to leave a user delete alone, it asks the
// USER to undo a delete and checks that the auditor did not quietly convert it
// into a quarantine along the way.
//
// If the audit had re-written the user's delete as its own `{on:true, q:true}`
// at some higher Lamport stamp, the undo — issued by the peer at a stamp above
// the ORIGINAL delete — would lose the `(t, by)` merge and the arrow would stay
// invisible. The user would press undo and nothing would happen, on every peer,
// with no error anywhere. That is a failure only an undo can reveal; reading
// `entry.q` alone would show a plausible-looking tombstone.
//
// Edges rather than nodes, and three arrows, so the cascade cannot be confused
// with either mechanism: `looped` is deleted by the user, `stub` is genuinely
// endpoint-less, `mainline` is untouched.

import { TFile } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { encodeEndpoint, encodePos, encodeSize } from "../../../canvas/canvas-registers";
import type { SurfaceState } from "../../../canvas/canvas-shadow";
import {
  isTombstoneQuarantined,
  isTombstoneSuppressed,
  readTombstoneEntry,
} from "../../../canvas/canvas-tombstone";
import { CanvasSync, buildCanvasData } from "../../../files/canvas-sync";

const PATH = "undo/arrows.canvas";

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

describe("WP20 AC2 blind2 — the auditor leaves a user's delete undoable", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("the undo of a user-deleted arrow still works after the audit, while the endpoint-less arrow stays hidden", async () => {
    const client = await auditingClient(PATH);
    const nodes = client.doc.getMap<Y.Map<unknown>>("nodes");
    const edges = client.doc.getMap<Y.Map<unknown>>("edges");
    const deleted = client.doc.getMap<unknown>("deleted");
    const push = makePeer(client.doc);

    push((peer) => {
      const nodeSpace = peer.getMap<Y.Map<unknown>>("nodes");
      for (const [id, x] of [
        ["start", 0],
        ["finish", 700],
      ] as const) {
        nodeSpace.set(
          id,
          record({
            id,
            type: "text",
            pos: encodePos(x, 0),
            size: encodeSize(260, 130),
            text: `${id}!`,
          }),
        );
      }
      const edgeSpace = peer.getMap<Y.Map<unknown>>("edges");
      edgeSpace.set(
        "mainline",
        record({
          id: "mainline",
          from: encodeEndpoint("start", "right"),
          to: encodeEndpoint("finish", "left"),
        }),
      );
      edgeSpace.set(
        "looped",
        record({
          id: "looped",
          from: encodeEndpoint("finish", "bottom"),
          to: encodeEndpoint("start", "bottom"),
          label: "feedback",
        }),
      );
      edgeSpace.set("stub", record({ id: "stub", to: encodeEndpoint("finish", "top") }));
      // The user deletes the feedback arrow. Ordinary WP19 tombstone, no `q`.
      peer.getMap<unknown>("deleted").set("looped", { t: 4, by: "peer-user", on: true });
    });

    audit();
    audit();

    const loopedAfterAudit = readTombstoneEntry(deleted, "looped");
    expect(
      isTombstoneQuarantined(loopedAfterAudit),
      "the audit re-labelled the user's delete as its own quarantine",
    ).toBe(false);
    expect(
      isTombstoneQuarantined(readTombstoneEntry(deleted, "stub")),
      "the endpoint-less arrow was not quarantined, so this test proved nothing",
    ).toBe(true);
    expect(
      readTombstoneEntry(deleted, "mainline"),
      "the untouched arrow acquired a tombstone",
    ).toBeUndefined();

    // THE UNDO — issued by the peer at one stamp above its OWN delete, exactly
    // as WP19's undo path does. It must win.
    push((peer) => {
      peer.getMap<unknown>("deleted").set("looped", { t: 5, by: "peer-user", on: false });
    });
    audit();
    audit();

    expect(
      isTombstoneSuppressed(readTombstoneEntry(deleted, "looped")),
      "the user's undo lost the merge — the audit had pushed the delete's stamp beyond the undo's reach",
    ).toBe(false);
    expect(
      buildCanvasData(nodes, edges, deleted).edges.map((edge) => edge.id).sort(),
      "the undone arrow did not come back, or the endpoint-less one came back with it",
    ).toEqual(["looped", "mainline"]);
    expect(edges.get("looped")?.get("label"), "the undone arrow lost its label").toBe("feedback");

    expect(
      isTombstoneQuarantined(readTombstoneEntry(deleted, "stub")),
      "the undo of an unrelated arrow released the endpoint-less one",
    ).toBe(true);

    client.cs.destroy();
  });
});
