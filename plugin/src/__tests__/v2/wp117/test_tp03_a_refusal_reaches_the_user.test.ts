// WP117 / A4 + A5 — a refusal reaches the guest and is VISIBLE, every branch is
// counted including the ones that do nothing, and the size bound has a stated
// behaviour rather than a shrug.
//
// A4's failure mode has a name in this project: `S114`'s shape — the user made a
// canvas, nothing happened, and nothing said why. Three things therefore have to
// be true of every refusal, and each is asserted separately below because a
// refusal can satisfy any two of them and still be invisible:
//
//   ├── the guest is TOLD, in a sentence naming the file;
//   ├── the refusal is COUNTED, by its own token; and
//   └── the do-nothing branches are counted too (`S155`) — a ledger in which
//       "was never called" and "ran and declined" read the same is the defect
//       that cost this project a whole round.
//
// PRODUCTION LINES <-> ASSERTIONS: `CanvasCreateCoordinator.requestCreate` (the
// seven local branches), `.handleRequest` (the host's verdict and its answer),
// `.handleResult` (the notice), `CANVAS_CREATE_MAX_BYTES`.

import { describe, expect, it } from "vitest";

import {
  CANVAS_CREATE_LOCAL_REFUSAL,
  CANVAS_CREATE_MAX_BYTES,
} from "../../../files/canvas-create";
import { CANVAS_CREATE_VERDICT } from "../../../files/canvas-create-decision";
import {
  type World,
  canvasJson,
  canvasPath,
  createWorld,
  settle,
  textNode,
} from "./harness";

const PATH = canvasPath("plan");
const AUTHORED = canvasJson([textNode("a", 0, "one card")]);

async function world(guestFiles: Record<string, string>, options: {
  maxBytes?: number;
  timeoutMs?: number;
} = {}): Promise<World> {
  const w = await createWorld();
  await w.add({ id: "host", role: "host" });
  await w.add({ id: "g1", role: "guest", files: guestFiles, ...options });
  return w;
}

async function ask(w: World, path: string): Promise<void> {
  await w.peer("g1").coordinator.requestCreate(path);
  await settle();
}

describe("WP117 A4 — a host refusal is spoken, counted and attributed", () => {
  it("a protected path: refused before any byte, told to the user, counted by token", async () => {
    const bad = ".obsidian/plugins/evil.canvas";
    const w = await world({ [bad]: AUTHORED });
    await ask(w, bad);

    const g1 = w.peer("g1");
    const host = w.peer("host");

    // The guest's OWN gate refuses first — the path is not in the shared tree —
    // so this row is really about the local half, and it says so.
    expect(g1.coordinator.getStats().declinedByReason["outside-share"]).toBe(1);
    expect(host.disk(bad)).toBeUndefined();
    expect(w.bus.frames).toHaveLength(0);

    w.peers.forEach((p) => p.destroy());
  });

  it("a request the guest's own gate lets through and the HOST refuses: the user is told", async () => {
    // Reaching the host's refusal needs a request the guest thinks is fine. The
    // sharpest one is a collision: the host already holds the path, which the
    // guest cannot know before it asks.
    const w = await createWorld();
    await w.add({ id: "host", role: "host", files: { [PATH]: canvasJson([textNode("h", 0, "the host's board")]) } });
    await w.add({ id: "g1", role: "guest", files: { [PATH]: AUTHORED } });

    const host = w.peer("host");
    const g1 = w.peer("g1");
    const hostBytesBefore = host.disk(PATH);

    await ask(w, PATH);

    // 1. REFUSED, by the right clause.
    expect(host.coordinator.getStats().decided["refuse-already-exists"]).toBe(1);
    expect(host.coordinator.getStats().materialised).toBe(0);
    // 2. I11 — A REFUSAL NEVER DESTROYS. Scored on disk bytes, both sides.
    expect(host.disk(PATH)).toBe(hostBytesBefore);
    expect(g1.disk(PATH)).toBe(AUTHORED);
    // 3. THE USER IS TOLD, and the sentence names the file and gives a reason.
    expect(g1.notices).toHaveLength(1);
    expect(g1.notices[0]).toContain(PATH);
    expect(g1.notices[0]).toContain("already exists");
    expect(g1.notices[0]).toContain("still in your vault");
    // 4. COUNTED, by the host's token rather than by prose.
    expect(g1.coordinator.getStats().refused).toBe(1);
    expect(g1.coordinator.getStats().refusedByReason[CANVAS_CREATE_VERDICT.ALREADY_EXISTS]).toBe(1);

    w.peers.forEach((p) => p.destroy());
  });

  it("a host-side failure mid-materialisation is ALSO reported — an accepted request that broke is the worst silence", async () => {
    const w = await createWorld();
    await w.add({ id: "host", role: "host" });
    await w.add({ id: "g1", role: "guest", files: { [PATH]: AUTHORED } });
    const host = w.peer("host");
    const g1 = w.peer("g1");

    // Break the step AFTER validation: the file is created and the manifest
    // write then throws. The user's canvas is in their vault and in nobody
    // else's, which is the one case where silence would be indefensible.
    host.vault.create = (async () => {
      throw new Error("disk is full");
    }) as never;

    await ask(w, PATH);

    expect(host.coordinator.getStats().decided.materialise).toBe(1);
    expect(host.coordinator.getStats().materialised).toBe(0);
    expect(host.coordinator.getStats().materialiseFailed).toBe(1);
    expect(g1.notices).toHaveLength(1);
    expect(g1.notices[0]).toContain("disk is full");
    // …and no adoption was armed, so the next mirror pass does not adopt a
    // document that was never created.
    expect(g1.coordinator.originatedHere(PATH)).toBe(false);

    w.peers.forEach((p) => p.destroy());
  });

  it("SILENCE is reported too: no answer inside the timeout is a notice, not a shrug", async () => {
    const w = await world({ [PATH]: AUTHORED }, { timeoutMs: 1000 });
    // An old relay, or a session with no host: the frame goes out and nothing
    // comes back. This is the mixed-version case, and it is the one shape the
    // protocol cannot report on its own.
    w.bus.dropped.add("canvas-create-request");
    await ask(w, PATH);
    const g1 = w.peer("g1");

    expect(g1.coordinator.getStats().requested).toBe(1);
    expect(g1.notices).toHaveLength(0);
    // The timer is a countable object on the injected scheduler, so "a timeout
    // was armed" is observable before it fires.
    expect(g1.scheduler.pending()).toBe(1);
    g1.scheduler.runAll();

    expect(g1.coordinator.getStats().timedOut).toBe(1);
    expect(g1.notices).toHaveLength(1);
    expect(g1.notices[0]).toContain(PATH);
    expect(g1.notices[0]).toContain("no answer from the host");
    // I11 again: the file is untouched.
    expect(g1.disk(PATH)).toBe(AUTHORED);

    w.peers.forEach((p) => p.destroy());
  });

  it("an ANSWERED request disarms the timeout — the notice does not arrive late", async () => {
    const w = await world({ [PATH]: AUTHORED }, { timeoutMs: 1000 });
    await ask(w, PATH);
    const g1 = w.peer("g1");
    expect(g1.coordinator.getStats().accepted).toBe(1);
    expect(g1.scheduler.pending()).toBe(0);
    g1.scheduler.runAll();
    expect(g1.coordinator.getStats().timedOut).toBe(0);
    expect(g1.notices).toHaveLength(0);

    w.peers.forEach((p) => p.destroy());
  });
});

describe("WP117 A4 / S155 — every guest-side branch is counted, including the do-nothing ones", () => {
  it("the host asking itself declines `not-guest`, and the decline is a number", async () => {
    const w = await world({});
    const host = w.peer("host");
    host.files.set(PATH, AUTHORED);
    const outcome = await host.coordinator.requestCreate(PATH);
    expect(outcome).toBe(CANVAS_CREATE_LOCAL_REFUSAL.NOT_GUEST);
    expect(host.coordinator.getStats().declinedByReason["not-guest"]).toBe(1);
    expect(host.coordinator.getStats().requested).toBe(0);
    expect(w.bus.frames).toHaveLength(0);

    w.peers.forEach((p) => p.destroy());
  });

  it("a `.md` in the same folder declines `not-canvas` — the door is canvas-only", async () => {
    const note = `${canvasPath("x").replace("/x.canvas", "")}/note.md`;
    const w = await world({ [note]: "hello" });
    const outcome = await w.peer("g1").coordinator.requestCreate(note);
    expect(outcome).toBe(CANVAS_CREATE_LOCAL_REFUSAL.NOT_CANVAS);
    expect(w.peer("g1").coordinator.getStats().declinedByReason["not-canvas"]).toBe(1);

    w.peers.forEach((p) => p.destroy());
  });

  it("a canvas the SESSION delivered declines `already-shared` — no request loop", async () => {
    // This is the echo guard. Without it, every canvas the mirror pass writes on
    // a guest raises a `create` and the guest asks the host to create the file
    // the host already gave it — an `already-exists` refusal and a notice, per
    // canvas, per join.
    const w = await world({ [PATH]: AUTHORED });
    await ask(w, PATH);
    const g1 = w.peer("g1");
    expect(g1.coordinator.getStats().requested).toBe(1);

    const outcome = await g1.coordinator.requestCreate(PATH);
    expect(outcome).toBe(CANVAS_CREATE_LOCAL_REFUSAL.ALREADY_SHARED);
    expect(g1.coordinator.getStats().declinedByReason["already-shared"]).toBe(1);
    expect(g1.coordinator.getStats().requested).toBe(1);

    w.peers.forEach((p) => p.destroy());
  });

  it("an unreadable file declines `unreadable` rather than sending an empty canvas", async () => {
    const w = await world({});
    const outcome = await w.peer("g1").coordinator.requestCreate(PATH);
    expect(outcome).toBe(CANVAS_CREATE_LOCAL_REFUSAL.UNREADABLE);
    expect(w.peer("g1").coordinator.getStats().declinedByReason.unreadable).toBe(1);
    expect(w.bus.frames).toHaveLength(0);

    w.peers.forEach((p) => p.destroy());
  });

  it("a result this peer never asked for is `unmatched`, and it is the ORDINARY case", async () => {
    // Every peer receives every result, because the relay broadcasts. A peer
    // that treated an unmatched result as a problem would report one per guest
    // per creation for the life of the session.
    const w = await createWorld();
    await w.add({ id: "host", role: "host" });
    await w.add({ id: "g1", role: "guest", files: { [PATH]: AUTHORED } });
    await w.add({ id: "g2", role: "guest" });
    await ask(w, PATH);

    const g2 = w.peer("g2");
    expect(g2.coordinator.getStats().results).toBe(1);
    expect(g2.coordinator.getStats().unmatchedResults).toBe(1);
    expect(g2.coordinator.getStats().refused).toBe(0);
    expect(g2.notices).toHaveLength(0);

    w.peers.forEach((p) => p.destroy());
  });
});

describe("WP117 A5 — the size bound, and what happens at it", () => {
  it("the default bound is 512 KB, over ten times the largest board in this project's vault", () => {
    expect(CANVAS_CREATE_MAX_BYTES).toBe(512 * 1024);
  });

  it("AT the bound the request is sent; ONE unit over it is refused BEFORE a frame goes out", async () => {
    // The refusal is the guest's, deliberately: the relay's control socket is
    // constructed with `maxPayload: 2 MB` and drops — with a 1009 close — a
    // frame above it. Refusing locally is the difference between a stated limit
    // and a killed link.
    const maxBytes = 4_000;
    const filler = (bytes: number) => canvasJson([textNode("big", 0, "x".repeat(bytes))]);
    const atBound = filler(maxBytes - canvasJson([textNode("big", 0, "")]).length);
    expect(atBound.length).toBeLessThanOrEqual(maxBytes);

    const w = await world({ [PATH]: atBound }, { maxBytes });
    await ask(w, PATH);
    expect(w.peer("g1").coordinator.getStats().requested).toBe(1);
    expect(w.bus.framesOfType("canvas-create-request")).toHaveLength(1);
    w.peers.forEach((p) => p.destroy());

    const over = filler(maxBytes);
    expect(over.length).toBeGreaterThan(maxBytes);
    const w2 = await world({ [PATH]: over }, { maxBytes });
    await ask(w2, PATH);
    const g1 = w2.peer("g1");

    expect(g1.coordinator.getStats().requested).toBe(0);
    expect(g1.coordinator.getStats().declinedByReason["too-large"]).toBe(1);
    // NOT A BYTE ON THE WIRE. This is the whole point of refusing locally.
    expect(w2.bus.frames).toHaveLength(0);
    // THE USER IS TOLD WHAT TO DO INSTEAD, and the file is untouched.
    expect(g1.notices).toHaveLength(1);
    expect(g1.notices[0]).toContain(PATH);
    expect(g1.notices[0]).toContain("Ask the host");
    expect(g1.disk(PATH)).toBe(over);

    w2.peers.forEach((p) => p.destroy());
  });

  it("the HOST enforces the same bound independently — a peer's word on size is not evidence", async () => {
    // The guest-side refusal is a courtesy to the user and to the link. The
    // host's is the guard: an older build, or a hostile one, sends whatever it
    // likes.
    const w = await createWorld();
    await w.add({ id: "host", role: "host", maxBytes: 100 });
    await w.add({ id: "g1", role: "guest", files: { [PATH]: AUTHORED }, maxBytes: 1_000_000 });
    await ask(w, PATH);

    expect(w.peer("g1").coordinator.getStats().requested).toBe(1);
    expect(w.peer("host").coordinator.getStats().decided["refuse-too-large"]).toBe(1);
    expect(w.peer("host").disk(PATH)).toBeUndefined();
    expect(w.peer("g1").notices[0]).toContain("larger than a single control-channel transfer");

    w.peers.forEach((p) => p.destroy());
  });
});
