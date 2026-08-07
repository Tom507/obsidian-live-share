// WP51 AC2 — blind set 2 (the instance is the writer).
//
// Angle: data safety. The scratch path is the ONLY thing the rig owns, and D16
// makes a run that touches anything else a failed run whatever else it proved.
// So this file drives `canvas.save` at the paths a mistake would actually reach
// — a real note, the plugin's own `data.json`, a traversal, an absolute path —
// on a vault seeded with the owner's files, and requires every one of them to be
// unchanged afterwards.
//
// Second angle: idempotence. Two saves of an unchanged view must leave the same
// bytes, so a rig can re-issue the command after a flaky step without changing
// the artefact it is about to fingerprint.
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  SCRATCH_FOLDER,
  type CanvasSaveChannelLike,
  type E2EPluginLike,
  buildPluginHost,
  routeCommand,
} from "../../testing/e2e-control";

const SCRATCH = `${SCRATCH_FOLDER}/e2e-scratch-20260803T131500Z-b2-safe.canvas`;
const sha = (s: string) => createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");

/** Files the owner already had. None of them may change. */
const OWNER_FILES: Record<string, string> = {
  "Inbox.md": "# Inbox\n",
  "Daily/2026-08-03.md": "- morning\n",
  "boards/Roadmap.canvas": '{"nodes":[{"id":"real"}],"edges":[]}',
  ".obsidian/plugins/live-share/data.json": '{"token":"REDACTED"}',
};

let viewText = "first";
const boardBytes = () => JSON.stringify({ nodes: [{ id: "n1", text: viewText }], edges: [] });

function rig() {
  const files = new Map<string, string>(Object.entries(OWNER_FILES));
  files.set(SCRATCH, '{"nodes":[],"edges":[]}');
  const fingerprint = () =>
    [...files.entries()]
      .filter(([p]) => p !== SCRATCH)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([p, c]) => `${p}:${sha(c)}`)
      .join("|");

  const adapter = {
    exists: async (p: string) => files.has(p),
    read: async (p: string) => files.get(p) ?? "",
    write: vi.fn(),
    mkdir: vi.fn(),
    remove: vi.fn(),
  };

  const channel: CanvasSaveChannelLike = {
    path: () => SCRATCH,
    requestSave: async () => {
      const bytes = boardBytes();
      files.set(SCRATCH, bytes);
      return bytes;
    },
  };

  const host = buildPluginHost(
    {
      settings: { clientId: "safe", roomId: "canvas-v2-t3", role: "host" },
      canvasSync: null,
      app: { vault: { adapter } },
      // Only the scratch canvas has an open view; every other path answers null.
      canvasSaveChannel: (p: string) => (p === SCRATCH ? channel : null),
    } as unknown as E2EPluginLike,
    { counters: { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 }, bump: () => {} },
  );
  return { host, files, adapter, fingerprint };
}

const OFF_LIMITS = [
  "Inbox.md",
  "Daily/2026-08-03.md",
  "boards/Roadmap.canvas",
  ".obsidian/plugins/live-share/data.json",
  `${SCRATCH_FOLDER}/../Inbox.md`,
  `/${SCRATCH_FOLDER}/e2e-scratch-x.canvas`,
  "H:\\Developement\\_NeuralAngels\\ObsidianOrga\\Inbox.md",
];

describe("WP51 AC2 (blind2) — the save reaches nothing but the scratch canvas", () => {
  it.each(OFF_LIMITS)("`canvas.save %s` changes nothing", async (path) => {
    const { host, files, adapter, fingerprint } = rig();
    const before = fingerprint();
    const out = await routeCommand(host, { cmd: "canvas.save", args: { path } });

    expect(out.status).toBe(400);
    expect(out.body.ok).toBe(false);
    expect(fingerprint()).toBe(before);
    expect(adapter.write).not.toHaveBeenCalled();
    expect(adapter.remove).not.toHaveBeenCalled();
    expect(files.get("Inbox.md")).toBe(OWNER_FILES["Inbox.md"]);
    // Positive control: the SAME host does save the board it has open, so the
    // refusal above is a refusal and not an absent command.
    expect((await routeCommand(host, { cmd: "canvas.save", args: { path: SCRATCH } })).status).toBe(
      200,
    );
  });

  it("the sanctioned save leaves every other file byte-identical", async () => {
    const { host, files, fingerprint } = rig();
    const before = fingerprint();
    viewText = "first";
    const out = await routeCommand(host, { cmd: "canvas.save", args: { path: SCRATCH } });
    expect(out.status).toBe(200);
    expect(fingerprint()).toBe(before);
    expect(files.get(SCRATCH)).toBe(boardBytes());
  });

  it("two saves of an unchanged view produce identical bytes", async () => {
    const { host, files } = rig();
    viewText = "steady";
    await routeCommand(host, { cmd: "canvas.save", args: { path: SCRATCH } });
    const first = files.get(SCRATCH);
    const second = await routeCommand(host, { cmd: "canvas.save", args: { path: SCRATCH } });
    expect(second.status).toBe(200);
    if (!second.body.ok) throw new Error("second save failed");
    const result = second.body.result as { sha256Before: string; sha256After: string; byInstance: boolean };
    expect(files.get(SCRATCH)).toBe(first);
    expect(result.sha256Before).toBe(result.sha256After);
    expect(result.byInstance).toBe(true); // the instance wrote these bytes
  });

  it("a changed view produces different bytes and a moved digest", async () => {
    const { host } = rig();
    viewText = "before";
    const a = await routeCommand(host, { cmd: "canvas.save", args: { path: SCRATCH } });
    viewText = "after";
    const b = await routeCommand(host, { cmd: "canvas.save", args: { path: SCRATCH } });
    if (!a.body.ok || !b.body.ok) throw new Error("save failed");
    const ra = a.body.result as { sha256After: string };
    const rb = b.body.result as { sha256Before: string; sha256After: string };
    expect(rb.sha256Before).toBe(ra.sha256After);
    expect(rb.sha256After).not.toBe(rb.sha256Before);
  });

  it("the command never fabricates a save for a path with no open view", async () => {
    const { host, files } = rig();
    const other = `${SCRATCH_FOLDER}/e2e-scratch-20260803T131500Z-b2-other.canvas`;
    files.set(other, '{"nodes":[],"edges":[]}');
    const before = files.get(other);
    const out = await routeCommand(host, { cmd: "canvas.save", args: { path: other } });
    expect(out.status).toBe(400);
    expect(files.get(other)).toBe(before);
    expect((await routeCommand(host, { cmd: "canvas.save", args: { path: SCRATCH } })).status).toBe(
      200,
    ); // positive control
  });
});
