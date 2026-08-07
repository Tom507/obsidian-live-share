// WP20 / AC4 (second half) — "each quarantine/release emits a distinct
// signature."
//
// STATE IS THE ORACLE; the signature is for a human. So this test establishes
// the doc-state transition FIRST (quarantined → released) and only then asks
// what the operator was told, because a suite that judged the repair by its log
// line would go green on an auditor that narrates and repairs nothing.
//
// "Distinct" is asserted as weakly as the word allows and no weaker:
//
//   ├── each transition produces a line in this file's established
//   │      `<NAME> signature: …` shape (WP18 owns that shape and its own
//   │      comment reserves "distinct strings" for WP20), naming the record,
//   ├── no line is shared between the two transitions, and
//   └── the difference survives blanking the record id — two transitions that
//          differ ONLY in which record they mention are the SAME signature
//          reported twice, and an operator reading them cannot tell a raise
//          from a lift.
//
// The exact wording is deliberately NOT pinned: the implementer chooses it.
//
// The fault is MISSING_TYPE_SPECIFIC on a `text` node with intact geometry and
// type, so none of the three legacy telemetry lines (SCATTER / DETACH /
// NO TYPE) can fire and be mistaken for the new signature — this class is
// exactly the one they were blind to.

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
import { CanvasSync } from "../../../files/canvas-sync";

const PATH = "narration.canvas";
const VICTIM = "drifter";

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
  const warns: string[] = [];
  const cs = new CanvasSync(
    vault as never,
    syncManager as never,
    { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() } as never,
  );
  cs.setLogger({ debug: () => {}, warn: (_c: string, message: string) => warns.push(message) });
  cs.setSurfaceStateProvider(
    (): SurfaceState => ({
      viewOpen: false,
      handedToView: { node: new Set<string>(), edge: new Set<string>() },
    }),
  );
  await cs.subscribe(path, "guest");
  return { cs, warns, doc: syncManager.getDoc(`__canvas__:${path}`).doc };
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

/** The `<NAME> signature: …` lines about one record, from one audit pass. */
function signaturesFor(lines: string[], id: string): string[] {
  return lines.filter((line) => /\bsignature:/.test(line) && line.includes(id));
}

describe("WP20 AC4 — the quarantine and the release are told apart in the narration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("raising and lifting a quarantine emit signatures that differ by more than the record id", async () => {
    const client = await auditingClient(PATH);
    const deleted = client.doc.getMap<unknown>("deleted");
    const push = makePeer(client.doc);

    push((peer) => {
      peer.getMap<Y.Map<unknown>>("nodes").set(
        VICTIM,
        record({
          id: VICTIM,
          type: "text",
          pos: encodePos(120, 240),
          size: encodeSize(260, 140),
        }),
      );
    });

    client.warns.length = 0;
    audit();

    // STATE first — the signature only means anything if the repair happened.
    expect(
      isTombstoneQuarantined(readTombstoneEntry(deleted, VICTIM)),
      "the invalid record was not quarantined, so there is no quarantine to narrate",
    ).toBe(true);
    const raiseLines = signaturesFor(client.warns, VICTIM);
    expect(
      raiseLines.length,
      `the quarantine emitted no '<NAME> signature: …' line naming ${VICTIM}; warns were: ${JSON.stringify(client.warns)}`,
    ).toBeGreaterThan(0);

    // Let the doc settle so the next pass's lines belong to the release alone.
    audit();
    client.warns.length = 0;

    push((peer) => {
      peer.getMap<Y.Map<unknown>>("nodes").get(VICTIM)?.set("text", "repaired by a peer");
    });
    audit();

    expect(
      isTombstoneSuppressed(readTombstoneEntry(deleted, VICTIM)),
      "the repaired record was not released, so there is no release to narrate",
    ).toBe(false);
    const releaseLines = signaturesFor(client.warns, VICTIM);
    expect(
      releaseLines.length,
      `the release emitted no '<NAME> signature: …' line naming ${VICTIM}; warns were: ${JSON.stringify(client.warns)}`,
    ).toBeGreaterThan(0);

    // DISTINCT — no line is shared between the two transitions…
    const shared = releaseLines.filter((line) => raiseLines.includes(line));
    expect(
      shared,
      "the release re-emitted the quarantine's own signature line verbatim",
    ).toEqual([]);

    // …and the difference is not merely which record is named.
    const blank = (line: string) => line.split(VICTIM).join("<id>");
    const raiseShapes = new Set(raiseLines.map(blank));
    const releaseShapes = releaseLines.map(blank).filter((shape) => raiseShapes.has(shape));
    expect(
      releaseShapes,
      "quarantine and release emit the SAME signature shape and differ only in the record id — an operator cannot tell a raise from a lift",
    ).toEqual([]);

    client.cs.destroy();
  });
});
