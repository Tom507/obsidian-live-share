// S120 — A FILE OP INSIDE THE MUTE WINDOW WAS DROPPED, PERMANENTLY.
//
// Live: a rename, move or delete issued within ~1 s of that same file arriving
// from a peer was silently and permanently dropped. Three clients held three
// different filenames five minutes later, with no self-healing. The identical
// gestures after a measured quiescence propagated in <=0.11 s — that contrast
// is the control, and it says the transport was never the problem.
//
// AC1 — THE ANSWER IS YES: AN EXACT DISCRIMINATOR EXISTS, AND IT WAS ALREADY
// RECORDED. The mute exists to break ECHOES — a write we made coming back as a
// vault event. Every armed release already carries `consumes`: the exact set of
// vault-event kinds the applied op can legitimately produce. A remote `create`
// arms `["create","modify"]`. A `rename` arriving in that window CANNOT be its
// echo, because applying a create never emits a rename.
//
// `isPathMuted` could not see any of that — it is a bare refcount, and it
// answers `true` for a path with no idea what the mute was taken for.
// `noteVaultEvent` has matched on `consumes` all along. The ledger held the
// answer; the gate asked the wrong question.
//
// This is the same move `handleLocalModify` already makes for the canvas
// branch, where `vault-events.ts` says the byte compare "is exact, it has no
// window, and it is strictly stronger than either timer". Here the exact fact
// is the event KIND rather than the bytes.

import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { FileOpsManager } from "../../../files/file-ops";

const PATH = "notes/hello.md";

function manager() {
  const scheduler = {
    now: () => Date.now(),
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>),
  };
  return new FileOpsManager(
    { getAbstractFileByPath: vi.fn(() => null) } as never,
    undefined as never,
    { scheduler } as never,
  );
}

describe("S120 AC1 — the mute is asked what it is muted FOR", () => {
  it("🚨 a rename is NOT suppressed by a mute armed for a create", () => {
    // The live defect, in one assertion. Applying a remote create can emit a
    // `create` or a `modify` — never a `rename`. So a rename in that window is
    // the user, not an echo.
    const m = manager();
    m.mutePathEvents(PATH);
    m.armMuteRelease(PATH, { consumes: ["create", "modify"] });

    expect(m.isPathMuted(PATH)).toBe(true); // the old, type-blind answer
    expect(m.isPathMutedFor(PATH, "rename")).toBe(false); // the new, exact one
    expect(m.isPathMutedFor(PATH, "delete")).toBe(false);
  });

  it("the echo it WAS armed for is still suppressed", () => {
    // VACUITY CONTROL: if this went false the mute would stop working entirely
    // and every echo would loop back onto the wire.
    const m = manager();
    m.mutePathEvents(PATH);
    m.armMuteRelease(PATH, { consumes: ["create", "modify"] });

    expect(m.isPathMutedFor(PATH, "create")).toBe(true);
    expect(m.isPathMutedFor(PATH, "modify")).toBe(true);
  });

  it("a rename echo IS suppressed when a rename was what we applied", () => {
    const m = manager();
    m.mutePathEvents(PATH);
    m.armMuteRelease(PATH, { consumes: ["rename", "delete"] });
    expect(m.isPathMutedFor(PATH, "rename")).toBe(true);
    expect(m.isPathMutedFor(PATH, "create")).toBe(false);
  });

  it("an unmuted path is not muted for anything", () => {
    const m = manager();
    for (const kind of ["create", "modify", "delete", "rename"] as const) {
      expect(m.isPathMutedFor(PATH, kind)).toBe(false);
    }
  });

  it("FAIL-CLOSED: a mute with no armed entry suppresses everything, as before", () => {
    // Three release sites still take a refcount with a bare `setTimeout` and no
    // armed entry (`background-sync`, `canvas-sync`, `manifest`). For those
    // there is no `consumes` to consult, so the answer must stay exactly what
    // was already shipping — conservative — rather than becoming permissive.
    const m = manager();
    m.mutePathEvents(PATH);
    for (const kind of ["create", "modify", "delete", "rename"] as const) {
      expect(m.isPathMutedFor(PATH, kind)).toBe(true);
    }
  });

  it("a completed release stops constraining, and the refcount then decides", () => {
    const m = manager();
    m.mutePathEvents(PATH);
    m.armMuteRelease(PATH, { consumes: ["create"] });
    // The consuming event arrives and releases the entry.
    m.noteVaultEvent(PATH, "create");
    // The entry is done; with the refcount still held and no live entry, the
    // conservative branch applies.
    expect(m.isPathMutedFor(PATH, "rename")).toBe(m.isPathMuted(PATH));
  });
});

describe("S120 AC2 — a dropped gesture is never silent", () => {
  it("drops are counted by kind and readable", () => {
    const m = manager();
    expect(m.getMuteDrops()).toEqual({ total: 0, byKind: {} });
    m.noteMuteDrop("rename");
    m.noteMuteDrop("rename");
    m.noteMuteDrop("delete");
    const drops = m.getMuteDrops();
    expect(drops.total).toBe(3);
    expect(drops.byKind).toEqual({ rename: 2, delete: 1 });
    // The ledger records the KIND, never the path — matching every sibling
    // ledger in this file.
    expect(JSON.stringify(drops)).not.toContain(PATH);
  });
});

/**
 * AC4 — THE CENSUS, DERIVED FROM THE SOURCE.
 *
 * Every arm that early-returns on a mute check must ask the KIND-AWARE
 * question and must count what it drops. Derived rather than hand-listed, so a
 * seventh gate appearing is a failure rather than a silent addition — the WP86
 * precedent, and the answer to `S89`'s lesson that a hand-written census goes
 * stale the moment somebody adds a door.
 */
describe("S120 AC4 — every vault-event gate is kind-aware and counted", () => {
  const source = readFileSync(
    new URL("../../../files/vault-events.ts", import.meta.url).pathname.replace(
      /^\/([A-Za-z]:)/,
      "$1",
    ),
    "utf8",
  );

  it("no gate in vault-events.ts uses the type-blind predicate any more", () => {
    // `isPathMuted(` with no `For` — the old question.
    const blind = [...source.matchAll(/isPathMuted\(/g)];
    expect(blind).toHaveLength(0);
  });

  it("every kind-aware gate is paired with a drop counter", () => {
    const gates = [...source.matchAll(/isPathMutedFor\(/g)];
    const drops = [...source.matchAll(/noteMuteDrop\(/g)];
    // Six gate expressions (the rename gate tests two endpoints in one `if`),
    // five gates, five drop counters.
    expect(gates.length).toBeGreaterThanOrEqual(5);
    expect(drops).toHaveLength(5);
  });

  it("every drop also emits a log line", () => {
    expect([...source.matchAll(/MUTE DROP:/g)]).toHaveLength(5);
  });
});
