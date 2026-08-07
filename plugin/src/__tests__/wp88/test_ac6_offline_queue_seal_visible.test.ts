// ===========================================================================
// WP88 AC6 — the offline queue stops growing when the chain has ended, and says
// so. NO CAP CONSTANT and NO RETENTION POLICY.
//
// C82 ruled that a cap is a data-retention decision and left it unowned (S40).
// That ruling stands and is not overturned here. What WP88 owns is the bound it
// REMOVES: before this WP the queue was bounded by the session being destroyed
// ~128 s after the link died — an accidental, destructive bound, but a bound.
// A repair that removes a bound without replacing it is a data-retention defect
// introduced by the repair, and hiding it behind C82's ruling would be exactly
// the move C82 refused.
//
// The structural answer needs no constant: once the carrier's chain has ended,
// the peer KNOWS it will not send these ops, so it stops ACCEPTING them, counts
// the refusals, and announces once. Nothing already queued is discarded.
// ===========================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const notices: string[] = [];

vi.mock("obsidian", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("../../__mocks__/obsidian");
  return {
    ...actual,
    Notice: class {
      constructor(message?: string) {
        notices.push(String(message ?? ""));
      }
    },
  };
});

const { FileOpsManager } = await import("../../files/file-ops");
const {
  acceptsIntoOfflineQueue,
  offlineQueueSealKey,
  FILE_OP_CARRIER_LINK,
  decideSharing,
  LINK_READY_STATE,
} = await import("../../sync/link-state");

/** A link snapshot with only the fields the definer reads. */
function snapshot(link: "control" | "mux", chainEnded: boolean) {
  return {
    link,
    hasSocket: false,
    readyState: LINK_READY_STATE.ABSENT,
    believedConnected: false,
    reconnectAttempts: chainEnded ? 10 : 3,
    maxReconnectAttempts: 10,
    retryChainEnded: chainEnded,
    lastChangeAt: null,
    silenced: false,
  };
}

function verdictWith(controlEnded: boolean, muxEnded = false) {
  return decideSharing({
    control: snapshot("control", controlEnded),
    mux: snapshot("mux", muxEnded),
    sessionActive: true,
    role: "guest",
    offlineQueueDepth: 0,
    connectionState: "disconnected",
  });
}

function manager() {
  const sent: unknown[] = [];
  const fileOps = new FileOpsManager({} as never, {} as never);
  fileOps.setSender((op) => sent.push(op));
  fileOps.setOnline(false);
  return { fileOps, sent };
}

/** A burst of N distinct deletes. Distinct paths, so `enqueue`'s own coalescing
 *  cannot make a growing queue look flat and produce a vacuous pass. */
async function burst(fileOps: InstanceType<typeof FileOpsManager>, n: number, prefix: string) {
  for (let i = 0; i < n; i++) {
    fileOps.onFileDelete({ path: `_liveshare-test/${prefix}-${i}.md` } as never);
  }
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  notices.length = 0;
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("WP88 AC6 — bounded by construction, not by a constant", () => {
  it("THE DECISION lives in the definer, over the definer's own verdict", () => {
    // No second predicate for "has this peer given up" (rule 10): the answer is
    // read off `SharingVerdict.endedLinks`, which `decideSharing` already
    // computes, and the carrier is named once.
    expect(FILE_OP_CARRIER_LINK).toBe("control");
    expect(acceptsIntoOfflineQueue(verdictWith(false))).toBe(true);
    expect(acceptsIntoOfflineQueue(verdictWith(true))).toBe(false);
    // A MUX chain ending does not seal the file-op queue: file ops travel on
    // the control link, and sealing on the wrong link would refuse work the
    // peer could still do.
    expect(acceptsIntoOfflineQueue(verdictWith(false, true))).toBe(true);
    expect(offlineQueueSealKey(verdictWith(false))).toBeNull();
    expect(offlineQueueSealKey(verdictWith(true))).toBe("queue-sealed:control");
  });

  it("POSITIVE CONTROL — with the chain ALIVE, a burst DOES enqueue and the depth advances", async () => {
    // Mandatory. Without this row, "the depth stopped growing" passes on a run
    // in which nothing was ever produced — the shape of the vacuous greens this
    // run has found eleven times.
    const { fileOps } = manager();
    fileOps.setQueueAccepting(acceptsIntoOfflineQueue(verdictWith(false)));
    expect(fileOps.getOfflineState().queueDepth).toBe(0);
    await burst(fileOps, 5, "alive");
    expect(fileOps.getOfflineState().queueDepth).toBe(5);
    expect(fileOps.getOfflineState().refusedWhileSealed).toBe(0);
    expect(fileOps.getOfflineState().acceptingIntoQueue).toBe(true);
    fileOps.destroy();
  });

  it("with the chain ENDED, the depth stops advancing and the refusal count advances instead", async () => {
    const { fileOps } = manager();
    // Phase 1: five ops queued while the chain is alive.
    fileOps.setQueueAccepting(true);
    await burst(fileOps, 5, "before");
    const depthBefore = fileOps.getOfflineState().queueDepth;
    expect(depthBefore).toBe(5);

    // Phase 2: the ceiling. IDENTICAL burst, different outcome.
    fileOps.setQueueAccepting(acceptsIntoOfflineQueue(verdictWith(true)));
    await burst(fileOps, 5, "after");

    const state = fileOps.getOfflineState();
    expect(state.acceptingIntoQueue).toBe(false);
    expect(state.queueDepth).toBe(depthBefore); // stopped growing
    expect(state.refusedWhileSealed).toBe(5); // and SAID it stopped
    fileOps.destroy();
  });

  it("NOTHING ALREADY QUEUED IS DISCARDED — the entries survive the seal, verbatim", async () => {
    // "stopped accepting" and "threw away what it had" are different
    // behaviours, and only one of them is chartered. Asserted on the drained
    // CONTENT, not just on the count.
    const { fileOps, sent } = manager();
    fileOps.setQueueAccepting(true);
    await burst(fileOps, 3, "kept");
    fileOps.setQueueAccepting(false);
    await burst(fileOps, 4, "refused");

    expect(fileOps.getOfflineState().queueDepth).toBe(3);
    expect(fileOps.getOfflineState().refusedWhileSealed).toBe(4);

    // Coming back online drains exactly what was queued, unchanged.
    fileOps.setOnline(true);
    const paths = sent.map((op) => (op as { path: string }).path);
    expect(paths).toEqual([
      "_liveshare-test/kept-0.md",
      "_liveshare-test/kept-1.md",
      "_liveshare-test/kept-2.md",
    ]);
    fileOps.destroy();
  });

  it("re-opening the queue resets the refusal counter, so a later seal reports ITS OWN refusals", async () => {
    const { fileOps } = manager();
    fileOps.setQueueAccepting(false);
    await burst(fileOps, 2, "outage-one");
    expect(fileOps.getOfflineState().refusedWhileSealed).toBe(2);
    fileOps.setQueueAccepting(true);
    expect(fileOps.getOfflineState().refusedWhileSealed).toBe(0);
    fileOps.setQueueAccepting(false);
    await burst(fileOps, 1, "outage-two");
    expect(fileOps.getOfflineState().refusedWhileSealed).toBe(1);
    fileOps.destroy();
  });

  it("NO CAP CONSTANT and NO EVICTION were introduced — derived from the source", async () => {
    // The second vacuity risk AC6 names by hand: introducing a cap constant and
    // calling it the bound takes the retention decision C82 ruled out of scope.
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const { stripComments } = await import("./route-census");
    const here = dirname(fileURLToPath(import.meta.url));
    const queue = stripComments(
      readFileSync(join(here, "..", "..", "sync", "offline-queue.ts"), "utf8"),
    );
    const fileOpsSrc = stripComments(
      readFileSync(join(here, "..", "..", "files", "file-ops.ts"), "utf8"),
    );
    // `offline-queue.ts` is byte-unchanged by this WP: no cap, no eviction.
    expect(queue).not.toMatch(/MAX_QUEUE|QUEUE_CAP|QUEUE_LIMIT|maxQueue/i);
    expect(queue).not.toMatch(/\bshift\(\)|\bevict/);
    // POSITIVE CONTROL for the detector: it DOES find the queue's real members,
    // so a null result above is an absence and not a broken pattern.
    expect(queue).toMatch(/\benqueue\b/);
    expect(queue).toMatch(/\bdrain\b/);
    // And the boundary in `file-ops.ts` is a boolean gate, not a numeric cap.
    expect(fileOpsSrc).toMatch(/acceptingIntoQueue/);
    expect(fileOpsSrc).not.toMatch(/MAX_OFFLINE|OFFLINE_QUEUE_CAP/i);
  });
});
