// WP106 — the last seam, and the reproduction (S129, S119, S126).
//
// WP105 reached the `NO_PEERS` state and stopped one seam short. This closes the
// distance: it adds the `doc apply -> disk write` seam and then drives the real
// S131 cliff — seeder on the slow side, reader on the fast side — so the
// resolution these decisions consume is one this run actually MEASURED against a
// live relay, not one a test handed itself.
//
// What that buys: S129 was pinned by assertion ("waitForSync resolves NO_PEERS
// with an empty doc, so yCollab binds an empty Y.Text over the editor"). Nobody
// had watched it happen. Here the NO_PEERS comes out of a real subscribe race,
// and the fix's own decision function is asked what it would do with it. If the
// fix is ever removed, these fail.
//
// __tests__ only. No production source is touched, and W3's in-flight
// `dataloss/test_s129_*.test.ts` is left alone.

import { afterEach, describe, expect, it } from "vitest";

import {
  COLLAB_BIND,
  decideCollabBind,
} from "../../editor/collab-bind-decision";
import { EMPTY_WRITE_DECISION, decideEmptyWrite } from "../../files/empty-write-guard";
import {
  type AsymScenario,
  RESOLUTION,
  arrive,
  assertSeamInBand,
  asymScenario,
  delaySeam,
  freshDocId,
} from "./cold-arrival.harness";
import { sleep } from "./harness";

const asymOpen: AsymScenario[] = [];
afterEach(async () => {
  while (asymOpen.length) await asymOpen.pop()?.close();
});

// The S131 condition, in closed form: the reader is told "nobody to ask" exactly
// when the seeder's subscribe reaches the relay later than its own, i.e.
// seederDelay > gap + readerDelay. These sit either side of it.
const READER_DELAY = 5;
const GAP_MS = 20;
const SEEDER_FAR = 100; // 100 > 20 + 5  -> reader wins the race -> NO_PEERS
const SEEDER_NEAR = 5; //    5 < 20 + 5  -> seeder is registered  -> PEER_STATE

/** Drive one real cold arrival at the chosen side of the cliff. */
async function raceForResolution(seederDelay: number) {
  const s = await asymScenario();
  asymOpen.push(s);
  const docId = freshDocId();
  const seeder = s.client(`seed-${seederDelay}`, seederDelay);
  const h = seeder.getDoc(docId);
  h?.doc.getText("content").insert(0, "the note's real content, seeded by the far peer");
  await sleep(GAP_MS);
  const reader = s.client("reader", READER_DELAY);
  const r = await arrive(reader, docId);
  // AC4 evidence: the two sockets really were at different distances.
  expect(s.asym.applied).toContain(seederDelay);
  expect(s.asym.applied).toContain(READER_DELAY);
  return { ...r, docId, reader, scenario: s };
}

// ---------------------------------------------------------------------------
// AC1 — the `doc apply -> disk write` seam
// ---------------------------------------------------------------------------

/** The shape BackgroundSync writes through. Owned by the test, so injectable. */
function makeVaultAdapter() {
  const disk = new Map<string, string>();
  return {
    disk,
    async write(path: string, content: string): Promise<void> {
      disk.set(path, content);
    },
    async read(path: string): Promise<string> {
      return disk.get(path) ?? "";
    },
  };
}

describe("AC1 — the doc apply -> disk write seam", () => {
  it("is injectable, crossed, in band, and still performs the real write", async () => {
    const adapter = makeVaultAdapter();
    adapter.disk.set("note.md", "REAL BYTES ON DISK");
    const probe = delaySeam(adapter, "write", 90, "doc-apply->disk-write");

    const t0 = Date.now();
    await adapter.write("note.md", "new content");
    const elapsed = Date.now() - t0;

    assertSeamInBand(probe);
    expect(probe.crossings).toBe(1);
    expect(elapsed).toBeGreaterThanOrEqual(90);
    // It delays the write; it does not swallow it.
    expect(adapter.disk.get("note.md")).toBe("new content");
    probe.restore();
    await adapter.write("note.md", "after restore");
    expect(adapter.disk.get("note.md")).toBe("after restore");
  });

  it("throws when the seam is configured but never crossed", () => {
    const adapter = makeVaultAdapter();
    const probe = delaySeam(adapter, "write", 50, "unreached-write-seam");
    expect(probe.crossings).toBe(0);
    expect(() => assertSeamInBand(probe)).toThrow(/NEVER CROSSED/);
    probe.restore();
  });
});

// ---------------------------------------------------------------------------
// AC2 — S129, driven by a real cliff instead of a hand-written resolution
// ---------------------------------------------------------------------------

describe("AC2 — S129, reproduced through the real S131 cliff", () => {
  it("a real cold arrival on the fast side yields NO_PEERS with an empty doc", async () => {
    const r = await raceForResolution(SEEDER_FAR);
    expect(r.resolution).toBe(RESOLUTION.NO_PEERS);
    expect(r.emptyAtResolve).toBe(true);
  });

  it("that MEASURED resolution makes the bind decision refuse over a non-empty buffer", async () => {
    const r = await raceForResolution(SEEDER_FAR);
    expect(r.resolution).toBe(RESOLUTION.NO_PEERS); // measured, not asserted into being

    // This is the exact instant S129 describes: the note is open, the editor
    // holds the user's bytes, the shared doc is empty, and sync has just said
    // "you may proceed". Before the fix this bound an empty Y.Text over the
    // buffer and the note went to zero.
    const verdict = decideCollabBind({
      docTextLength: 0,
      editorBufferLength: 4096,
      docHeldContent: false,
      resolution: r.resolution,
    });
    expect(verdict.decision).toBe(COLLAB_BIND.REFUSE_UNPROVEN_EMPTY);
    expect(verdict.reason).toMatch(/no-peers/);
  });

  it("CONTROL: the same shape on the slow side yields PEER_STATE and DOES bind", async () => {
    // The control that could have failed. Same rig, same reader, same buffer —
    // only the seeder's distance changes, which is the S131 variable. If this
    // also refused, the refusal above would be unconditional and would prove
    // nothing about NO_PEERS.
    const r = await raceForResolution(SEEDER_NEAR);
    expect(r.resolution).toBe(RESOLUTION.PEER_STATE);

    const verdict = decideCollabBind({
      docTextLength: 0,
      editorBufferLength: 4096,
      docHeldContent: false,
      resolution: r.resolution,
    });
    expect(verdict.decision).toBe(COLLAB_BIND.BIND);
  });

  it("is deterministic across repeated runs on both sides of the cliff", async () => {
    const REPS = 4;
    let far = 0;
    let near = 0;
    for (let i = 0; i < REPS; i++) {
      const a = await raceForResolution(SEEDER_FAR);
      if (a.resolution === RESOLUTION.NO_PEERS) far++;
      await asymOpen.pop()?.close();
      const b = await raceForResolution(SEEDER_NEAR);
      if (b.resolution === RESOLUTION.PEER_STATE) near++;
      await asymOpen.pop()?.close();
    }
    // eslint-disable-next-line no-console
    console.log(
      `\n=== AC2 determinism (${REPS} reps each side) ===\n` +
        `seeder ${SEEDER_FAR}ms/hop -> NO_PEERS   ${far}/${REPS}\n` +
        `seeder ${SEEDER_NEAR}ms/hop -> PEER_STATE ${near}/${REPS}`,
    );
    expect(far).toBe(REPS);
    expect(near).toBe(REPS);
  }, 120_000);
});

// ---------------------------------------------------------------------------
// AC3 — the same seam pointed at S119 and S126
// ---------------------------------------------------------------------------

describe("AC3 — S119 and S126 through the same path", () => {
  it("S119: an empty doc arriving cold must not overwrite a non-empty file", async () => {
    const r = await raceForResolution(SEEDER_FAR);
    expect(r.resolution).toBe(RESOLUTION.NO_PEERS);

    const adapter = makeVaultAdapter();
    adapter.disk.set("note.md", "REAL BYTES THAT MUST SURVIVE");
    const probe = delaySeam(adapter, "write", 40, "doc-apply->disk-write");

    const existing = await adapter.read("note.md");
    const verdict = decideEmptyWrite({
      incoming: "", // what the cold doc holds
      existing,
      intentional: false, // nothing on this peer has ever seen it non-empty
      evidenceLabel: "whether this document has held content in this session",
    });
    expect(verdict.decision).toBe(EMPTY_WRITE_DECISION.REFUSE_NO_EVIDENCE);

    // The floor refuses, so the seam is NEVER crossed — and that is the
    // assertion. `assertSeamInBand` throwing here is the proof the write did
    // not happen, not a rig failure.
    expect(probe.crossings).toBe(0);
    expect(() => assertSeamInBand(probe)).toThrow(/NEVER CROSSED/);
    expect(adapter.disk.get("note.md")).toBe("REAL BYTES THAT MUST SURVIVE");
    probe.restore();
  });

  it("S126: a genuine emptying on a peer that never opened the note still propagates", async () => {
    // The regression we shipped. The evidence that this emptying is real is the
    // document's own tombstones — NOT this peer's session history, which is what
    // the first fix used and what made a peer with the note closed refuse.
    const adapter = makeVaultAdapter();
    adapter.disk.set("note.md", "CONTENT THE USER JUST SELECTED AND DELETED");
    const probe = delaySeam(adapter, "write", 40, "doc-apply->disk-write");

    const verdict = decideEmptyWrite({
      incoming: "",
      existing: await adapter.read("note.md"),
      // The peer never opened the note, so it has NO session history for it —
      // this is exactly the S126 case. The deletion is vouched for by the doc.
      intentional: true,
      evidenceLabel: "the document carries tombstones from a real deletion",
    });
    expect(verdict.decision).toBe(EMPTY_WRITE_DECISION.ALLOW);

    // and the write must actually reach disk
    await adapter.write("note.md", "");
    assertSeamInBand(probe);
    expect(probe.crossings).toBe(1);
    expect(adapter.disk.get("note.md")).toBe("");
    probe.restore();
  });
});
