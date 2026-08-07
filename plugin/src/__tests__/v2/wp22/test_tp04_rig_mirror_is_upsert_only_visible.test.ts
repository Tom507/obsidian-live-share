// WP22 / AC3 — "The `upsertRecord` mirror in the E2E control server is changed
// to the same semantics, so the rig cannot reproduce the old behaviour."
//
// The control server carries its own copy of the write shape (`upsertRecord`,
// e2e-control.ts) precisely because the rig must be able to drive the doc without
// the plugin. A copy that still deletes absent keys means the rig can still
// manufacture R1 by hand — so a live E2E run could "reproduce" a defect the
// production seam no longer has, and, worse, an E2E run of the FIXED code could
// still lose an edge's endpoints through `canvas.simulateEdit`.
//
// The oracle is the doc the rig drove, reached through the public command
// surface (`canvas.simulateEdit`) rather than by reaching into the private
// function: what matters is what the rig can DO, not how it is spelled.
//
// The discriminating half is that the rig keeps its explicit removals:
// `removeNodes` / `removeEdges` must still delete. AC3 removes deletion-by-
// omission, not deletion.

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  type BindingCounters,
  type E2EPluginLike,
  buildPluginHost,
  routeCommand,
} from "../../../testing/e2e-control";

const PATH = "Boards/Rig.canvas";

const EDGE = {
  id: "wire",
  fromNode: "sensor",
  fromSide: "bottom",
  toNode: "sink",
  toSide: "top",
};

const NODE = {
  id: "sensor",
  type: "text",
  text: "reads the line",
  x: 10,
  y: 20,
  width: 200,
  height: 100,
};

function fakePlugin(doc: Y.Doc): E2EPluginLike {
  const subscribed = new Set<string>();
  return {
    settings: { clientId: "rig", roomId: "room", role: "host" },
    muxConnected: true,
    controlConnected: true,
    saveSettings: () => {},
    canvasSync: {
      subscribe: async (path: string) => {
        subscribed.add(path);
      },
      isSubscribed: (path: string) => subscribed.has(path),
      getCanvasSnapshot: () => null,
      getCanvasDocHandle: (path: string) => (subscribed.has(path) ? { doc } : null),
    },
  };
}

function makeHost(doc: Y.Doc) {
  const counters: BindingCounters = {
    applyRemote: 0,
    captureLocal: 0,
    rePush: 0,
    originUpdates: 0,
  };
  return buildPluginHost(fakePlugin(doc), { counters, bump: () => {} });
}

function record(doc: Y.Doc, collection: "nodes" | "edges", id: string): unknown {
  return doc.getMap<Y.Map<unknown>>(collection).get(id)?.toJSON();
}

describe("WP22 AC3 — the rig's own write mirror cannot delete by omission", () => {
  it("`canvas.simulateEdit` with a partial edge leaves the endpoints connected", async () => {
    const doc = new Y.Doc();
    const host = makeHost(doc);
    await host.canvasOpen(PATH);

    await host.simulateEdit(PATH, { edges: [EDGE] });
    expect(record(doc, "edges", "wire"), "the rig could not seed a full edge").toEqual(EDGE);

    // The R1 shape, issued through the rig instead of through the binding.
    await host.simulateEdit(PATH, { edges: [{ id: "wire" }] });

    expect(
      record(doc, "edges", "wire"),
      "the rig deleted the endpoints of an edge it only mentioned by id — R1 is reproducible from the control channel",
    ).toEqual(EDGE);
  });

  it("a partial node edit through the router upserts the reported fields and keeps the rest", async () => {
    const doc = new Y.Doc();
    const host = makeHost(doc);
    await host.canvasOpen(PATH);
    await host.simulateEdit(PATH, { nodes: [NODE] });

    const response = await routeCommand(host, {
      cmd: "canvas.simulateEdit",
      args: { path: PATH, change: { nodes: [{ id: "sensor", x: 555 }] } },
    });

    expect(response.status, "the control command was refused").toBe(200);
    expect(response.body).toEqual({ ok: true, result: { applied: true } });
    expect(
      record(doc, "nodes", "sensor"),
      "a partial node edit through the rig stripped the unreported fields",
    ).toEqual({ ...NODE, x: 555 });
  });

  it("the rig keeps its EXPLICIT removals — this is not a licence to stop deleting", async () => {
    const doc = new Y.Doc();
    const host = makeHost(doc);
    await host.canvasOpen(PATH);
    await host.simulateEdit(PATH, { nodes: [NODE], edges: [EDGE] });

    await host.simulateEdit(PATH, { removeNodes: ["sensor"], removeEdges: ["wire"] });

    expect(
      doc.getMap<Y.Map<unknown>>("nodes").has("sensor"),
      "`removeNodes` no longer deletes — the removal went too far",
    ).toBe(false);
    expect(
      doc.getMap<Y.Map<unknown>>("edges").has("wire"),
      "`removeEdges` no longer deletes — the removal went too far",
    ).toBe(false);
  });

  it("the mirror's source carries no absent-key sweep", () => {
    // The behavioural checks above are the oracle; this is the anti-respelling
    // guard, scoped to the one function so an unrelated `delete` elsewhere in the
    // 1000-line module cannot trip it.
    const source = readMirrorSource();
    expect(
      source,
      "`upsertRecord` still deletes the keys absent from the incoming record",
    ).not.toMatch(/in\s+record\s*\)\s*\)?\s*ymap\.delete/);
    expect(
      source,
      "`upsertRecord` still contains a `delete` call at all — the mirror is not upsert-only",
    ).not.toMatch(/\.delete\s*\(/);
    // The upsert half must survive the removal.
    expect(source, "`upsertRecord` no longer writes anything").toMatch(/ymap\.set\s*\(/);
  });
});

/** The body of `upsertRecord` in e2e-control.ts, read straight from disk. */
function readMirrorSource(): string {
  const full = readFileSync(new URL("../../../testing/e2e-control.ts", import.meta.url), "utf8");
  const start = full.indexOf("function upsertRecord(");
  expect(start, "`upsertRecord` is no longer declared in e2e-control.ts").toBeGreaterThan(-1);
  const end = full.indexOf("\n}", start);
  return full.slice(start, end);
}
