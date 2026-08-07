// WP20 AC4 blind2 — the new signatures must be distinct from the OLD ones too.
//
// `auditCanvasState` already emits three telemetry lines: `SCATTER signature:`,
// `DETACH signature:` and `NO TYPE signature:`. WP18 added a fourth,
// `INGEST REJECTED signature:`, and its own comment reserves "distinct strings"
// for WP20's pair. So "distinct" is not only quarantine-vs-release: a
// quarantine signature that is really just the SCATTER line the auditor was
// already printing tells the operator nothing new, and it makes the transition
// from detection to repair invisible in the very log that is supposed to show
// it.
//
// The record here is chosen to trip the LEGACY telemetry as well: a node with
// neither `type` nor geometry fires SCATTER and NO TYPE, and it is also
// schema-invalid, so all of it happens at once. The claim is that a
// quarantine-specific line appears IN ADDITION, and that neither it nor the
// release line is one of the legacy lines.
//
// The repair is done in two deltas (geometry, then type) so that the pass which
// releases the record is not the pass in which SCATTER stopped firing — an
// implementation that recycled a legacy line as its release signature would
// otherwise look coincidentally correct.
//
// Doc state is asserted at every step first; the log is the secondary claim.

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

const PATH = "telemetry.canvas";
const VICTIM = "wreck";
const LEGACY = ["SCATTER signature:", "DETACH signature:", "NO TYPE signature:", "INGEST REJECTED signature:"];

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

function isLegacy(line: string): boolean {
  return LEGACY.some((prefix) => line.includes(prefix));
}

/** `<NAME> signature: …` lines about `id` that are NOT pre-existing telemetry. */
function newSignaturesFor(lines: readonly string[], id: string): string[] {
  return lines.filter(
    (line) => /\bsignature:/.test(line) && line.includes(id) && !isLegacy(line),
  );
}

describe("WP20 AC4 blind2 — the repair signatures are distinct from the detection telemetry that preceded them", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("emits its own quarantine and release lines alongside SCATTER / NO TYPE, and never reuses one of them", async () => {
    const client = await auditingClient(PATH);
    const deleted = client.doc.getMap<unknown>("deleted");
    const push = makePeer(client.doc);

    push((peer) => {
      const space = peer.getMap<Y.Map<unknown>>("nodes");
      space.set(
        "intact",
        record({
          id: "intact",
          type: "text",
          pos: encodePos(0, 0),
          size: encodeSize(200, 100),
          text: "intact",
        }),
      );
      // No geometry AND no type: SCATTER and NO TYPE both fire for this record,
      // and it is schema-invalid on two conjuncts at once.
      space.set(VICTIM, record({ id: VICTIM, text: "salvageable" }));
    });

    client.warns.length = 0;
    audit();
    const raisePass = [...client.warns];

    expect(
      isTombstoneQuarantined(readTombstoneEntry(deleted, VICTIM)),
      "the invalid record was not quarantined",
    ).toBe(true);
    expect(
      raisePass.some((line) => isLegacy(line)),
      `the legacy detection telemetry did not fire, so this test cannot show the new lines are distinct from it; the pass logged: ${JSON.stringify(raisePass)}`,
    ).toBe(true);
    const raiseLines = newSignaturesFor(raisePass, VICTIM);
    expect(
      raiseLines.length,
      `the quarantine emitted no signature of its own — only the pre-existing detection lines; the pass logged: ${JSON.stringify(raisePass)}`,
    ).toBeGreaterThan(0);

    // REPAIR 1 — geometry only. Still typeless, so still quarantined.
    audit();
    client.warns.length = 0;
    push((peer) => {
      const victim = peer.getMap<Y.Map<unknown>>("nodes").get(VICTIM);
      victim?.set("pos", encodePos(400, 400));
      victim?.set("size", encodeSize(300, 200));
    });
    audit();

    expect(
      isTombstoneSuppressed(readTombstoneEntry(deleted, VICTIM)),
      "the record was released while it still had no `type` — SCATTER falling silent is not a repair",
    ).toBe(true);

    // REPAIR 2 — the type. Now it is whole.
    audit();
    client.warns.length = 0;
    push((peer) => {
      peer.getMap<Y.Map<unknown>>("nodes").get(VICTIM)?.set("type", "text");
    });
    audit();
    const releasePass = [...client.warns];

    expect(
      isTombstoneSuppressed(readTombstoneEntry(deleted, VICTIM)),
      "the fully repaired record was not released",
    ).toBe(false);

    const releaseLines = newSignaturesFor(releasePass, VICTIM);
    expect(
      releaseLines.length,
      `the release emitted no signature of its own; the pass logged: ${JSON.stringify(releasePass)}`,
    ).toBeGreaterThan(0);
    expect(
      releaseLines.filter((line) => raiseLines.includes(line)),
      "the release re-emitted the quarantine's own line",
    ).toEqual([]);

    const blank = (line: string) => line.split(VICTIM).join("<id>");
    const raiseShapes = new Set(raiseLines.map(blank));
    expect(
      releaseLines.map(blank).filter((shape) => raiseShapes.has(shape)),
      "quarantine and release share a signature shape and differ only in the record id",
    ).toEqual([]);

    client.cs.destroy();
  });
});
