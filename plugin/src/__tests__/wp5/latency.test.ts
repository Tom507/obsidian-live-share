// WP5 — Latency E2E harness suite (US6, and the E2E gate for US1/US3/US4/US5).
//
// Real relay implementation (in-process) + real sync-core clients + injected
// 50–150 ms RTT. These are the tests localhost cannot produce: the races only
// appear once frames are actually in flight.
//
// AC → test mapping (US6 AC3 — every race-describing AC has a harness assertion):
//   US1 AC1/AC2  → "static caret is transferred to a mid-sync joiner ≤1000 ms (both directions)"
//   US1 AC3/AC4  → "static caret + idle lock survive >30 s (no y-protocols prune)"  [GAP-6]
//   US1 AC6/AC7  → "reconnect re-renders the caret and keeps a single identity"      [GAP-4]
//   US3 AC3/AC4  → "two clients claim one node in one RTT → lowest-clientID wins, loser reverts" [GAP-1/3]
//   US3 AC5      → "loser's canWriteNode is false after settle (no dual ownership)"
//   US3 AC6      → "remote delete of a locked node → holder aborts, no resurrect"    [GAP-2]
//   US4 AC2      → covered by the >30 s idle-lock survival test                       [GAP-6]
//   US4 AC3/AC4  → "reconnecting holder re-claims only still-free nodes (no split lock)" [GAP-4]
//   US5 AC1      → "concurrent edits to different nodes over latency do not clobber"
//   US6 AC1      → "the injected link delay is in effect and its RTT is inside the 50–150 ms band"
//   US6 AC2      → red-first control: "without the tiebreak, both raw claims coexist (race is real)"
//   US6 AC4      → tiebreak repeated 3× for determinism
//   US6 AC5      → "a zero-latency run is annotated as non-proof"

import { afterEach, describe, expect, it } from "vitest";

import { type AwarenessLike, CanvasPresence, holdersOf } from "../../canvas/canvas-presence";
import type { SyncManager } from "../../sync/sync";
import {
  type Relay,
  type Room,
  createRoom,
  installLatency,
  liveSockets,
  newClient,
  sleep,
  startRelay,
  waitUntil,
} from "./harness";

// linkDelay 20 ms/hop → one-way ≈2·20=40 ms, RTT ≈4·20=80 ms (mid-band).
const LINK_DELAY_MS = 20;
/** Hops on a one-way A→relay→B delivery: the sender's hold + the receiver's hold. */
const ONE_WAY_HOPS = 2;
/** Hops on a round trip A→relay→B→relay→A: the one-way path, twice. */
const RTT_HOPS = ONE_WAY_HOPS * 2;
const NOMINAL_ONE_WAY_MS = LINK_DELAY_MS * ONE_WAY_HOPS;
const NOMINAL_RTT_MS = LINK_DELAY_MS * RTT_HOPS;
const CANVAS_PATH = "board.canvas";

/** Whether a run at the given RTT is a valid proof of race resolution (US6 AC5). */
function isLatencyGating(rttMs: number): boolean {
  return rttMs > 0;
}

interface Scenario {
  relay: Relay;
  room: Room;
  clients: SyncManager[];
  restore: () => void;
}

const scenarios: Scenario[] = [];

async function setup(linkDelayMs = LINK_DELAY_MS): Promise<Scenario> {
  const restore = installLatency(linkDelayMs);
  const relay = await startRelay();
  const room = await createRoom(relay.port, `wp5-${Date.now()}`);
  const s: Scenario = { relay, room, clients: [], restore };
  scenarios.push(s);
  return s;
}

function client(s: Scenario, id: string): SyncManager {
  const sm = newClient(s.relay.port, s.room, id);
  s.clients.push(sm);
  return sm;
}

interface PresenceCtx {
  sm: SyncManager;
  awareness: AwarenessLike;
  presence: CanvasPresence;
  docId: string;
  reverted: string[];
}

async function canvasPresence(
  s: Scenario,
  sm: SyncManager,
  name: string,
  color: string,
): Promise<PresenceCtx> {
  const docId = `__canvas__:${CANVAS_PATH}`;
  const handle = sm.getDoc(docId);
  if (!handle) throw new Error("no canvas doc handle");
  await sm.waitForSync(docId);
  const awareness = handle.awareness as unknown as AwarenessLike;
  const reverted: string[] = [];
  const presence = new CanvasPresence({
    path: CANVAS_PATH,
    awareness,
    identity: { clientId: awareness.clientID, name, color },
    onRevert: (nodeId) => reverted.push(nodeId),
  });
  // Drive the WP3 reconnect policy through the REAL reconnect seam (US4 AC3).
  sm.onReconnect(() => presence.onReconnect());
  return { sm, awareness, presence, docId, reverted };
}

afterEach(async () => {
  for (const s of scenarios.splice(0)) {
    for (const sm of s.clients) sm.destroy();
    s.restore();
    await s.relay.close();
    await sleep(10);
  }
});

// ── US6 AC1 — the injected RTT is real and inside the target band ───────────
//
// S74 — WHAT THIS ROW ASSERTS, AND WHY IT NO LONGER ASSERTS AN UPPER BOUND ON
// THE CLOCK.
//
// It used to time a live one-way awareness delivery, double it, and require the
// result to be ≤150 ms. That assertion failed roughly two full-suite runs in
// three (`expected 440 to be less than or equal to 150`) and was green 11/11 in
// isolation, because it is not a statement about the harness at all: it is a
// statement about how promptly this host schedules a `setTimeout` while 369 test
// files run in parallel. Measured on the current tree, the live one-way figure
// sits at 58–62 ms against a 75 ms ceiling — the whole margin is host overhead,
// so any GC pause or scheduler excursion turns the row red for a reason that has
// nothing to do with the property it names. A red that arrives for an unrelated
// reason is worse than no check: it is how a genuine regression gets waved
// through as "just the flaky one".
//
// The property US6 AC1 is actually for is that the harness's injected latency IS
// IN EFFECT on the path the race tests run over — because localhost is ~0 ms and
// hides exactly those races (BUILD_SPEC §7). That decomposes into three claims,
// each asserted against the thing that can actually establish it:
//
//   1. THE CONFIGURED BAND — arithmetic over the harness constant and its hop
//      model. Deterministic, and the only honest place for an UPPER bound: the
//      band is a property of what the harness injects, never of what the host
//      managed to schedule.
//   2. THE INJECTION IS INSTALLED — the sockets the clients actually opened were
//      built by the latency wrapper, not by the platform `WebSocket`. This is the
//      anti-vacuity control: without it every timing figure below could be
//      produced by an uninjected run that merely happened to be slow.
//   3. THE INJECTION IS IN EFFECT — a live delivery takes AT LEAST the injected
//      one-way hold. A lower bound is causal rather than statistical: two
//      `setTimeout(linkDelayMs)` holds stand between the write and the read, so
//      load can only ever push this figure UP. A zero-latency run fails it, which
//      is precisely the run US6 AC5 calls a non-proof.
//
// Deliberately NOT a widened band: a band widened until it stops failing is a
// check that has stopped checking. The upper bound has not been loosened, it has
// been MOVED to the operand that can carry it.
describe("US6 — latency injection", () => {
  it("the injected link delay is in effect and its RTT is inside the 50–150 ms band (US6 AC1)", async () => {
    // (1) The configured band, both edges. Asserted against the harness's own
    // constant and its documented hop model, so a change to `LINK_DELAY_MS` that
    // leaves the target band is caught here regardless of what any clock says.
    expect(NOMINAL_ONE_WAY_MS).toBe(LINK_DELAY_MS * ONE_WAY_HOPS);
    expect(NOMINAL_RTT_MS).toBe(LINK_DELAY_MS * RTT_HOPS);
    expect(NOMINAL_RTT_MS).toBeGreaterThanOrEqual(50);
    expect(NOMINAL_RTT_MS).toBeLessThanOrEqual(150);

    const s = await setup();
    const host = client(s, "host");
    const guest = client(s, "guest");
    const h = host.getDoc("note.md")!;
    const g = guest.getDoc("note.md")!;
    await host.waitForSync("note.md");
    await guest.waitForSync("note.md");
    // Make sure both are mutually present before measuring.
    h.awareness.setLocalState({ user: { name: "Host" }, cursor: { anchor: 0, head: 0 } });
    await waitUntil(() => g.awareness.getStates().has(h.awareness.clientID));

    // (2) The injection is installed on the path these two clients just used.
    // `installLatency` swaps `globalThis.WebSocket` for the wrapper class, and
    // every wrapper instance registers itself in `liveSockets` at construction —
    // so a non-empty registry is a positive statement that the client sockets
    // went through the wrapper, not merely that a stub was assigned somewhere.
    expect(liveSockets.length).toBeGreaterThanOrEqual(2);
    // …and the class that produced them is the one still installed as the global,
    // so the install cannot have been restored before the measurement below.
    const installed = globalThis.WebSocket as unknown as new (url: string) => unknown;
    for (const socket of liveSockets) {
      expect(socket).toBeInstanceOf(installed);
    }

    // (3) The injection is in effect: time a fresh one-way delivery and hold it
    // to the injected FLOOR. `oneWay` is the interval between the local write and
    // the peer observing it; the wrapper holds the frame `linkDelayMs` outbound
    // and `linkDelayMs` inbound, so this interval cannot be shorter than
    // `NOMINAL_ONE_WAY_MS` however fast the host is, and load can only lengthen
    // it. The derived round trip is reported in the same terms the band is
    // written in, and is likewise bounded from below only.
    const t0 = Date.now();
    h.awareness.setLocalState({ user: { name: "Host" }, cursor: { anchor: 7, head: 7 } });
    await waitUntil(() => {
      const st = g.awareness.getStates().get(h.awareness.clientID) as
        | { cursor?: { anchor: number } }
        | undefined;
      return st?.cursor?.anchor === 7;
    });
    const oneWay = Date.now() - t0;
    const measuredRtt = oneWay * (RTT_HOPS / ONE_WAY_HOPS);

    expect(oneWay).toBeGreaterThanOrEqual(NOMINAL_ONE_WAY_MS); // not a ~0 ms link
    expect(measuredRtt).toBeGreaterThanOrEqual(50); // and it clears the band floor
  });

  it("a zero-latency run is annotated as non-proof (US6 AC5)", () => {
    expect(isLatencyGating(0)).toBe(false); // RTT=0 → race assertions must skip
    expect(isLatencyGating(NOMINAL_RTT_MS)).toBe(true); // the gating path
  });
});

// ── US1 — text caret awareness under latency ────────────────────────────────
describe("US1 — caret awareness (WP1)", () => {
  it("static caret is transferred to a mid-sync joiner ≤1000 ms, both directions (US1 AC1/AC2)", async () => {
    const s = await setup();
    const host = client(s, "host");
    const hDoc = host.getDoc("note.md")!;
    await host.waitForSync("note.md");
    // Host's caret is STATIC and set BEFORE the guest ever subscribes.
    hDoc.awareness.setLocalState({ user: { name: "Host" }, cursor: { anchor: 3, head: 3 } });
    await sleep(50);

    // Guest joins mid-session; time the caret transfer.
    const guest = client(s, "guest");
    const gDoc = guest.getDoc("note.md")!;
    const t0 = Date.now();
    await guest.waitForSync("note.md");
    gDoc.awareness.setLocalState({ user: { name: "Guest" }, cursor: { anchor: 1, head: 1 } });

    await waitUntil(
      () => {
        const st = gDoc.awareness.getStates().get(hDoc.awareness.clientID) as
          | { cursor?: { anchor: number } }
          | undefined;
        return st?.cursor?.anchor === 3;
      },
      { timeout: 1000 },
    );
    const joinMs = Date.now() - t0;
    expect(joinMs).toBeLessThanOrEqual(1000);

    // Symmetric: host renders the guest caret too, ≤1000 ms.
    await waitUntil(() => hDoc.awareness.getStates().get(gDoc.awareness.clientID) !== undefined, {
      timeout: 1000,
    });
    // The host caret never moved during the transfer.
    expect(hDoc.awareness.getLocalState()).toMatchObject({ cursor: { anchor: 3, head: 3 } });
  });

  it("reconnect re-renders the caret and keeps a single identity (US1 AC6/AC7, GAP-4)", async () => {
    const s = await setup();
    const host = client(s, "host");
    const guest = client(s, "guest");
    const hDoc = host.getDoc("note.md")!;
    const gDoc = guest.getDoc("note.md")!;
    await host.waitForSync("note.md");
    await guest.waitForSync("note.md");
    hDoc.awareness.setLocalState({ user: { name: "Host" }, cursor: { anchor: 5, head: 5 } });
    gDoc.awareness.setLocalState({ user: { name: "Guest" }, cursor: { anchor: 2, head: 2 } });
    const hostId = hDoc.awareness.clientID;
    await waitUntil(() => gDoc.awareness.getStates().has(hostId));

    // Abrupt network drop of the host socket (not a graceful disconnect).
    // Reach the private current socket via a test-only cast to force a drop.
    (host as unknown as { ws: { forceDrop(): void } }).ws.forceDrop();
    // The relay removes the host's awareness → guest drops the host caret.
    await waitUntil(() => !gDoc.awareness.getStates().has(hostId), { timeout: 3000 });

    // On reconnect the host clock-ticks and the caret re-renders on the guest.
    const t0 = Date.now();
    await waitUntil(() => gDoc.awareness.getStates().has(hostId), { timeout: 4000 });
    const reMs = Date.now() - t0;

    // Single stable identity: same clientID, exactly one entry for the host.
    expect(hDoc.awareness.clientID).toBe(hostId);
    const hostEntries = [...gDoc.awareness.getStates().keys()].filter((id) => id === hostId);
    expect(hostEntries).toHaveLength(1);
    // Re-render happened within a heartbeat of reconnect completing.
    expect(reMs).toBeLessThanOrEqual(2000);
  });
});

// ── US3 — per-card locking (WP3, highest risk) ──────────────────────────────
describe("US3 — per-card locking (WP3)", () => {
  async function raceForNode(s: Scenario) {
    const host = client(s, "host");
    const guest = client(s, "guest");
    const H = await canvasPresence(s, host, "Host", "#f00");
    const G = await canvasPresence(s, guest, "Guest", "#00f");
    H.presence.start();
    G.presence.start();
    // Both mutually present.
    await waitUntil(() => H.awareness.getStates().size >= 2 && G.awareness.getStates().size >= 2);
    // Both grab the SAME node inside one RTT (before either frame lands).
    H.presence.acquireLock("n1");
    G.presence.acquireLock("n1");

    const lowest = Math.min(H.awareness.clientID, G.awareness.clientID);
    // Converge to exactly one holder = lowest clientID on BOTH sides.
    await waitUntil(
      () => {
        const hs = holdersOf(CANVAS_PATH, "n1", H.awareness.getStates());
        const gs = holdersOf(CANVAS_PATH, "n1", G.awareness.getStates());
        return hs.length === 1 && gs.length === 1 && hs[0] === lowest && gs[0] === lowest;
      },
      { timeout: 5000 },
    );
    return { H, G, lowest };
  }

  it("two clients claim one node in one RTT → lowest-clientID wins, loser reverts (US3 AC3/AC4, GAP-1/3)", async () => {
    const s = await setup();
    const { H, G, lowest } = await raceForNode(s);
    const winner = H.awareness.clientID === lowest ? H : G;
    const loser = H.awareness.clientID === lowest ? G : H;

    expect(winner.presence.isLockedByMe("n1")).toBe(true);
    expect(loser.presence.isLockedByMe("n1")).toBe(false); // released
    expect(loser.reverted).toContain("n1"); // optimistic edit rolled back
    // No dual ownership: loser cannot write, winner can (US3 AC5).
    expect(loser.presence.canWriteNode("n1")).toBe(false);
    expect(winner.presence.canWriteNode("n1")).toBe(true);
  });

  it("tiebreak is deterministic across repeated runs (US6 AC4)", async () => {
    for (let i = 0; i < 3; i++) {
      const s = await setup();
      const { H, G, lowest } = await raceForNode(s);
      const winner = H.awareness.clientID === lowest ? H : G;
      const loser = H.awareness.clientID === lowest ? G : H;
      expect(winner.presence.isLockedByMe("n1")).toBe(true);
      expect(loser.presence.isLockedByMe("n1")).toBe(false);
      // clean up between iterations (afterEach only fires at test end).
      for (const sm of s.clients) sm.destroy();
      s.restore();
      await s.relay.close();
      scenarios.pop();
      await sleep(10);
    }
  });

  it("red-first control: without the tiebreak, both raw claims coexist (US6 AC2)", async () => {
    // Proves the harness reproduces a REAL race: two raw awareness locks (no
    // CanvasPresence reconcile) genuinely converge to DUAL ownership over the
    // wire. This is the state the WP3 tiebreak must resolve — so the passing
    // tiebreak test above is not a false green.
    const s = await setup();
    const host = client(s, "host");
    const guest = client(s, "guest");
    const hDoc = host.getDoc(`__canvas__:${CANVAS_PATH}`)!;
    const gDoc = guest.getDoc(`__canvas__:${CANVAS_PATH}`)!;
    await host.waitForSync(`__canvas__:${CANVAS_PATH}`);
    await guest.waitForSync(`__canvas__:${CANVAS_PATH}`);

    const raw = (name: string) => ({
      canvasPath: CANVAS_PATH,
      nodeId: "n1",
      x: 0,
      y: 0,
      lockedNodes: { n1: { color: "#000", name } },
    });
    hDoc.awareness.setLocalState(raw("Host"));
    gDoc.awareness.setLocalState(raw("Guest"));

    await waitUntil(
      () =>
        holdersOf(CANVAS_PATH, "n1", hDoc.awareness.getStates() as never).length === 2 &&
        holdersOf(CANVAS_PATH, "n1", gDoc.awareness.getStates() as never).length === 2,
      { timeout: 4000 },
    );
    // Dual ownership WITHOUT the tiebreak — the race is real and latency-visible.
    expect(holdersOf(CANVAS_PATH, "n1", hDoc.awareness.getStates() as never)).toHaveLength(2);
  });

  it("remote delete of a locked node → holder aborts, no resurrect (US3 AC6, GAP-2)", async () => {
    const s = await setup();
    const host = client(s, "host");
    const guest = client(s, "guest");
    const H = await canvasPresence(s, host, "Host", "#f00");
    const G = await canvasPresence(s, guest, "Guest", "#00f");
    H.presence.start();
    G.presence.start();
    await waitUntil(() => H.awareness.getStates().size >= 2 && G.awareness.getStates().size >= 2);

    // Seed n1 in the shared canvas doc and let it converge.
    const hNodes = host.getDoc(H.docId)!.doc.getMap("nodes");
    const gNodes = guest.getDoc(G.docId)!.doc.getMap("nodes");
    host.getDoc(H.docId)!.doc.transact(() => {
      const n = new (hNodes.constructor as typeof import("yjs").Map)();
      hNodes.set("n1", n as never);
    });
    await waitUntil(() => gNodes.has("n1"));

    // Host holds n1; wire the "remote delete → abort" observer as main.ts does.
    H.presence.acquireLock("n1");
    hNodes.observeDeep(() => {
      if (!hNodes.has("n1")) H.presence.onRemoteNodeDeleted("n1");
    });
    await waitUntil(() => holdersOf(CANVAS_PATH, "n1", G.awareness.getStates()).length === 1);

    // Guest deletes n1 remotely (delete-wins).
    guest.getDoc(G.docId)!.doc.transact(() => gNodes.delete("n1"));

    // Node stays deleted on the host (no resurrect) and the host lock is released.
    await waitUntil(() => !hNodes.has("n1"), { timeout: 3000 });
    await waitUntil(() => !H.presence.isLockedByMe("n1"), { timeout: 3000 });
    await sleep(NOMINAL_RTT_MS * 3);
    expect(hNodes.has("n1")).toBe(false); // never resurrected
    expect(H.presence.isLockedByMe("n1")).toBe(false);
  });
});

// ── US4 — crash-safe / reconnect lock lifecycle (WP1 + WP3) ─────────────────
describe("US4 — lock lifecycle under drop/reconnect (WP1+WP3)", () => {
  it("reconnecting holder re-claims only still-free nodes — no split lock (US4 AC3/AC4, GAP-4)", async () => {
    // US4 AC3/AC4 must hold for ANY clientID ordering. Deterministically exercise
    // the adversarial case: the RECONNECTING holder has the LOWER canvas-awareness
    // clientID than the peer that grabs the node during the outage — because the
    // lowest-id tiebreak (GAP-1) is what a returning holder can abuse to steal a
    // node back. Retry client creation until host.clientID < guest.clientID (both
    // are random 32-bit ids), so this test is a stable RED, not order-flaky.
    let s: Scenario;
    let host: SyncManager;
    let guest: SyncManager;
    for (let attempt = 0; ; attempt++) {
      s = await setup();
      host = client(s, "host");
      guest = client(s, "guest");
      const hId = host.getDoc(`__canvas__:${CANVAS_PATH}`)!.awareness.clientID;
      const gId = guest.getDoc(`__canvas__:${CANVAS_PATH}`)!.awareness.clientID;
      if (hId < gId) break;
      for (const sm of s.clients) sm.destroy();
      s.restore();
      await s.relay.close();
      scenarios.pop();
      if (attempt > 40) throw new Error("could not order clientIDs");
      await sleep(5);
    }
    const H = await canvasPresence(s, host, "Host", "#f00");
    const G = await canvasPresence(s, guest, "Guest", "#00f");
    H.presence.start();
    G.presence.start();
    await waitUntil(() => H.awareness.getStates().size >= 2 && G.awareness.getStates().size >= 2);

    // Host holds n1 and n2.
    H.presence.acquireLock("n1");
    H.presence.acquireLock("n2");
    await waitUntil(() =>
      holdersOf(CANVAS_PATH, "n1", G.awareness.getStates()).includes(H.awareness.clientID),
    );

    // Host drops. The relay clears the host's ephemeral awareness (auto-release).
    // Reach the private current socket via a test-only cast to force a drop.
    (host as unknown as { ws: { forceDrop(): void } }).ws.forceDrop();
    await waitUntil(
      () => !holdersOf(CANVAS_PATH, "n1", G.awareness.getStates()).includes(H.awareness.clientID),
      { timeout: 4000 },
    );

    // While the host is gone, the guest grabs n1 unopposed.
    G.presence.acquireLock("n1");
    await sleep(NOMINAL_RTT_MS * 2);

    // Host reconnects → the WP1 onReconnect seam fires the WP3 re-claim policy.
    await waitUntil(() => H.awareness.getStates().size >= 2 && G.awareness.getStates().size >= 2, {
      timeout: 5000,
    });
    await sleep(NOMINAL_RTT_MS * 4);

    // No split lock: the guest holds n1; the host did NOT steal it back; the host
    // keeps its still-free n2.
    const holders = holdersOf(CANVAS_PATH, "n1", G.awareness.getStates());
    expect(holders).toEqual([G.awareness.clientID]);
    expect(H.presence.isLockedByMe("n1")).toBe(false);
    expect(H.presence.isLockedByMe("n2")).toBe(true);
  });
});

// ── US5 — latency-tolerant editing (WP4) ────────────────────────────────────
describe("US5 — concurrent editing under latency (WP4)", () => {
  it("concurrent edits to different nodes over latency do not clobber (US5 AC1)", async () => {
    const s = await setup();
    const host = client(s, "host");
    const guest = client(s, "guest");
    const docId = `__canvas__:${CANVAS_PATH}`;
    const hDoc = host.getDoc(docId)!;
    const gDoc = guest.getDoc(docId)!;
    await host.waitForSync(docId);
    await guest.waitForSync(docId);

    type YMap = import("yjs").Map<unknown>;
    const hNodes = hDoc.doc.getMap<YMap>("nodes");
    const gNodes = gDoc.doc.getMap<YMap>("nodes");
    const MapCtor = hNodes.constructor as { new (): YMap };

    // Seed n1 and n2 from the host, let both converge.
    hDoc.doc.transact(() => {
      const n1 = new MapCtor();
      n1.set("x", 0);
      hNodes.set("n1", n1);
      const n2 = new MapCtor();
      n2.set("y", 0);
      hNodes.set("n2", n2);
    });
    await waitUntil(() => gNodes.has("n1") && gNodes.has("n2"));

    // Concurrent edits to DIFFERENT nodes, issued within one RTT.
    hDoc.doc.transact(() => (hNodes.get("n1") as YMap).set("x", 111));
    gDoc.doc.transact(() => (gNodes.get("n2") as YMap).set("y", 222));

    // Both edits survive on both replicas — no clobber (per-node LWW).
    await waitUntil(
      () =>
        (gNodes.get("n1") as YMap)?.get("x") === 111 &&
        (hNodes.get("n2") as YMap)?.get("y") === 222,
      { timeout: 4000 },
    );
    expect((hNodes.get("n1") as YMap).get("x")).toBe(111);
    expect((gNodes.get("n2") as YMap).get("y")).toBe(222);
    expect((hNodes.get("n2") as YMap).get("y")).toBe(222);
    expect((gNodes.get("n1") as YMap).get("x")).toBe(111);
  });
});

// ── US1 AC3/AC4 + US4 AC2 — no y-protocols 30 s prune (GAP-6) ────────────────
// This one exercises REAL elapsed time: the y-protocols outdated-timeout is 30 s
// wall-clock, so a faithful E2E must idle past it. The 12 s awareness heartbeat
// must keep both the static caret AND the idle lock alive on the peer.
describe("US1/US4 — static caret + idle lock survive >30 s (GAP-6)", () => {
  it("static caret and idle lock survive a >30 s idle window on the peer", async () => {
    const s = await setup();
    const host = client(s, "host");
    const guest = client(s, "guest");

    // Text caret (US1 AC3): host sets it once and never moves it.
    const hText = host.getDoc("note.md")!;
    const gText = guest.getDoc("note.md")!;
    await host.waitForSync("note.md");
    await guest.waitForSync("note.md");
    const hostTextId = hText.awareness.clientID;
    hText.awareness.setLocalState({ user: { name: "Host" }, cursor: { anchor: 4, head: 4 } });

    // Idle lock (US4 AC2): host holds n1 on the canvas awareness, then goes idle.
    const H = await canvasPresence(s, host, "Host", "#f00");
    const G = await canvasPresence(s, guest, "Guest", "#00f");
    H.presence.start();
    G.presence.start();
    await waitUntil(() => H.awareness.getStates().size >= 2 && G.awareness.getStates().size >= 2);
    H.presence.acquireLock("n1");

    // Both the caret and the lock are visible on the guest before idling.
    await waitUntil(() => gText.awareness.getStates().has(hostTextId));
    await waitUntil(() =>
      holdersOf(CANVAS_PATH, "n1", G.awareness.getStates()).includes(H.awareness.clientID),
    );

    // Idle for 33 s (> the 30 s prune window) with NO local movement. The 12 s
    // heartbeat re-emits the full state (caret + lockedNodes) twice in this window.
    await sleep(33_000);

    // Caret survived the prune (US1 AC3), lock survived (US4 AC2), and the guest
    // still cannot write the held node.
    expect(gText.awareness.getStates().has(hostTextId)).toBe(true);
    expect(holdersOf(CANVAS_PATH, "n1", G.awareness.getStates())).toContain(H.awareness.clientID);
    expect(G.presence.canWriteNode("n1")).toBe(false);
  }, 45_000);
});
