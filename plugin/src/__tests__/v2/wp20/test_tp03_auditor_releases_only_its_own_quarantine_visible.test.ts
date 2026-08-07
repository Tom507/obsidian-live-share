// WP20 / AC2 (the other edge of the same blade) — the auditor releases what IT
// quarantined, and NOTHING else.
//
// AC2 makes the auditor a writer of `on:false`. That is the one op in V2 that
// can bring a hidden record back, and WP12 built the `q` flag for exactly this
// reason: "quarantine is distinguishable from a user delete" (C12 AC4) is only
// worth anything if some consumer actually branches on it. WP20 is that
// consumer.
//
// A user-deleted record is SCHEMA-VALID — deleting a card does not damage it,
// WP19 keeps every field — so an auditor that reads "suppressed record that
// passes the schema → release" resurrects every card the user ever deleted, on
// every peer, at the next audit tick. That is a silent, unbounded data
// resurrection and it is invisible to any test that only ever quarantines.
//
// The two controls that make the assertion sharp:
//
//   ├── `erased` — a valid record the USER deleted (`on:true`, no `q`). It must
//   │      still be suppressed after the audit and its entry must not have
//   │      grown a `q`, and
//   └── `alive`  — a valid, undeleted record. It must have no entry at all: an
//          auditor that writes a tombstone per record would pass the first
//          check by accident.

import { TFile } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { encodePos, encodeSize } from "../../../canvas/canvas-registers";
import type { SurfaceState } from "../../../canvas/canvas-shadow";
import {
  isTombstoneQuarantined,
  isTombstoneSuppressed,
  readTombstoneEntry,
} from "../../../canvas/canvas-tombstone";
import { CanvasSync, buildCanvasData } from "../../../files/canvas-sync";

const PATH = "ledger.canvas";

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

describe("WP20 AC2 — the auditor never lifts a user delete, only its own quarantine", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("a valid, user-deleted record stays suppressed and un-flagged across repeated audits", async () => {
    const client = await auditingClient(PATH);
    const nodes = client.doc.getMap<Y.Map<unknown>>("nodes");
    const edges = client.doc.getMap<Y.Map<unknown>>("edges");
    const deleted = client.doc.getMap<unknown>("deleted");
    const push = makePeer(client.doc);

    // A peer sends three valid nodes, then deletes one of them the WP19 way:
    // a tombstone with `on:true` and NO `q`.
    push((peer) => {
      const space = peer.getMap<Y.Map<unknown>>("nodes");
      for (const [id, x] of [
        ["alive", 0],
        ["erased", 400],
        ["broken", 800],
      ] as const) {
        space.set(
          id,
          record({
            id,
            type: "text",
            pos: encodePos(x, 0),
            size: encodeSize(200, 100),
            text: `${id} card`,
          }),
        );
      }
      // `broken` is the positive control: genuinely invalid (INVALID_SIZE).
      space.get("broken")?.set("size", "300x200");
      peer.getMap<unknown>("deleted").set("erased", { t: 7, by: "peer-remote", on: true });
    });

    const erasedBefore = readTombstoneEntry(deleted, "erased");
    expect(erasedBefore?.on, "the user delete never reached the doc").toBe(true);
    expect(isTombstoneQuarantined(erasedBefore), "the seeded delete already carries `q`").toBe(
      false,
    );

    audit();
    audit();
    audit();

    const erasedAfter = readTombstoneEntry(deleted, "erased");
    expect(
      isTombstoneSuppressed(erasedAfter),
      "the auditor RESURRECTED a record the user deleted — a valid record is not a quarantine to lift",
    ).toBe(true);
    expect(
      isTombstoneQuarantined(erasedAfter),
      "the auditor re-labelled a user delete as its own quarantine",
    ).toBe(false);
    expect(erasedAfter?.t, "the auditor rewrote a user delete it had no reason to touch").toBe(7);
    expect(erasedAfter?.by, "the auditor took authorship of a user delete").toBe("peer-remote");

    // The valid, undeleted record is never spoken about at all.
    expect(
      readTombstoneEntry(deleted, "alive"),
      "the auditor wrote a tombstone for a healthy, visible record",
    ).toBeUndefined();

    // The positive control proves the audit actually ran and can tell the two apart.
    expect(
      isTombstoneQuarantined(readTombstoneEntry(deleted, "broken")),
      "the genuinely invalid record was not quarantined, so this test proved nothing",
    ).toBe(true);

    expect(
      buildCanvasData(nodes, edges, deleted).nodes.map((node) => node.id),
      "the rendered set is wrong: only the healthy, undeleted card may be visible",
    ).toEqual(["alive"]);

    client.cs.destroy();
  });
});
