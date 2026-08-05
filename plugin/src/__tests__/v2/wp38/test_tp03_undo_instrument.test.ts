// WP38 / C38 AC6 — THE INSTRUMENT.
//
// The failure this criterion exists to prevent is already in the file it edits:
// `canvas.simulateEdit` returns a hardcoded `applied: true`, and that class has
// produced multiple false greens in this run. So the assertions here are not
// "the command answers ok" — they are:
//
//   ├── it INVOKES a REGISTERED command, by an id measured against the registry
//   ├── every number in the response is a DIFFERENCE between two readings taken
//   │   from the production undo registry either side of that invocation, and
//   └── the EMPTY-STACK call — the one invocation whose honest answer is
//       "nothing happened", which a literal cannot produce — is exercised, in
//       the same fixture that then produces a real pop.
//
// The registry underneath is the REAL `CanvasUndoRegistry` over a real `Y.Doc`,
// so the depths are not fixtured either.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  CANVAS_CAPTURE_ORIGIN,
  CANVAS_REDO_COMMAND_ID,
  CANVAS_UNDO_COMMAND_ID,
  CanvasUndoRegistry,
} from "../../../canvas/canvas-undo";
import {
  type E2EPluginLike,
  buildPluginHost,
  routeCommand,
} from "../../../testing/e2e-control";

const PATH = "deck.canvas";

/**
 * A plugin double whose undo surface is the REAL registry over a REAL doc, and
 * whose command registry is a real dispatch table: `executeCommandById` looks
 * the id up and runs the registered callback, exactly as Obsidian's does, and
 * returns `false` for an id it does not hold.
 */
function makePlugin(commandIdPrefix = "live-share") {
  const doc = new Y.Doc();
  const nodes = doc.getMap<Y.Map<unknown>>("nodes");
  const registry = new CanvasUndoRegistry();
  registry.attach(PATH, doc);

  const table = new Map<string, () => void>();
  const plugin: E2EPluginLike = {
    settings: { clientId: "c1", role: "host", roomId: "r1" },
    app: {
      appId: "vault-a",
      commands: {
        commands: Object.fromEntries([...table.keys()].map((k) => [k, {}])),
        executeCommandById: (id: string) => {
          const run = table.get(id);
          if (!run) return false;
          run();
          return true;
        },
      },
    },
    canvasUndoReport: () => registry.report(PATH),
    canvasUndoLastOutcome: () => registry.lastOutcome(),
  };

  const register = (suffix: string, run: () => void): void => {
    table.set(`${commandIdPrefix}:${suffix}`, run);
    (plugin.app as { commands: { commands: Record<string, unknown> } }).commands.commands =
      Object.fromEntries([...table.keys()].map((k) => [k, {}]));
  };

  return { doc, nodes, registry, plugin, register, table };
}

function host(plugin: E2EPluginLike) {
  return buildPluginHost(plugin, {
    counters: { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 },
    bump: () => {},
  });
}

async function callUndo(plugin: E2EPluginLike, redo = false) {
  const res = await routeCommand(host(plugin), { cmd: "canvas.undo", args: { redo } });
  return res;
}

describe("WP38 AC6 — the instrument invokes the REGISTERED command", () => {
  it("refuses, by name, when no command matching the id is registered", async () => {
    const p = makePlugin();
    const res = await callUndo(p.plugin);
    expect(res.status).toBe(200);
    const result = (res.body as { result: Record<string, unknown> }).result;
    expect(result.ok).toBe(false);
    expect(String(result.reason)).toContain("no registered command matching");
    expect(result.invoked).toBe(false);
    expect(result.commandId).toBeNull();
  });

  it("finds the full id from the registry rather than assembling a guessed one", async () => {
    const p = makePlugin("some-other-plugin-id");
    p.register(CANVAS_UNDO_COMMAND_ID, () => p.registry.undo(PATH));
    const result = (
      (await callUndo(p.plugin)).body as { result: Record<string, unknown> }
    ).result;
    // The prefix was never spelt in this module — it was measured.
    expect(result.commandId).toBe("some-other-plugin-id:undo-canvas-change");
    expect(result.invoked).toBe(true);
  });
});

describe("WP38 AC6 — THE EMPTY-STACK CASE, mandatory and measured", () => {
  it("reports no step popped, depth 0 -> 0, and leaves the canvas unchanged", async () => {
    const p = makePlugin();
    p.register(CANVAS_UNDO_COMMAND_ID, () => p.registry.undo(PATH));
    p.doc.transact(() => {
      const r = new Y.Map<unknown>();
      r.set("text", "untouched");
      p.nodes.set("c1", r);
    }, Symbol("some-untracked-origin"));
    expect(p.registry.report(PATH).undoDepth).toBe(0);

    const result = (
      (await callUndo(p.plugin)).body as { result: Record<string, unknown> }
    ).result;

    expect(result.ok).toBe(true);
    expect(result.available).toBe(true);
    expect(result.invoked).toBe(true);
    expect(result.undoDepthBefore).toBe(0);
    expect(result.undoDepthAfter).toBe(0);
    expect(result.popped).toBe(false);
    // The canvas is unchanged.
    expect(p.nodes.get("c1")?.get("text")).toBe("untouched");
    // The mechanism's own receipt agrees with the instrument's arithmetic. If
    // these two ever disagree, one of them is lying and the run can see it.
    const outcome = result.outcome as Record<string, unknown>;
    expect(outcome.popped).toBe(false);
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("empty stack");
  });

  it("the SAME fixture reports a step popped and n -> n-1 after a real capture", async () => {
    const p = makePlugin();
    p.register(CANVAS_UNDO_COMMAND_ID, () => p.registry.undo(PATH));
    p.doc.transact(() => {
      const r = new Y.Map<unknown>();
      r.set("text", "base");
      p.nodes.set("c1", r);
    }, Symbol("some-untracked-origin"));

    p.registry.noteCapture(PATH);
    p.doc.transact(() => p.nodes.get("c1")?.set("text", "edited"), CANVAS_CAPTURE_ORIGIN);
    expect(p.registry.report(PATH).undoDepth).toBe(1);

    const result = (
      (await callUndo(p.plugin)).body as { result: Record<string, unknown> }
    ).result;

    expect(result.undoDepthBefore).toBe(1);
    expect(result.undoDepthAfter).toBe(0);
    expect(result.popped).toBe(true);
    expect(p.nodes.get("c1")?.get("text")).toBe("base");
    const outcome = result.outcome as Record<string, unknown>;
    expect(outcome.popped).toBe(true);
    expect(outcome.changed).toBe(true);
    // The receipt is for THIS invocation — a stale one cannot pass for a fresh
    // one, because it carries its own sequence number.
    expect(outcome.seq).toBe(1);
  });

  it("redo rides the same command and reports the redo depths", async () => {
    const p = makePlugin();
    p.register(CANVAS_UNDO_COMMAND_ID, () => p.registry.undo(PATH));
    p.register(CANVAS_REDO_COMMAND_ID, () => p.registry.redo(PATH));
    p.doc.transact(() => {
      const r = new Y.Map<unknown>();
      r.set("text", "base");
      p.nodes.set("c1", r);
    }, Symbol("some-untracked-origin"));
    p.registry.noteCapture(PATH);
    p.doc.transact(() => p.nodes.get("c1")?.set("text", "edited"), CANVAS_CAPTURE_ORIGIN);

    await callUndo(p.plugin);
    expect(p.nodes.get("c1")?.get("text")).toBe("base");

    const result = (
      (await callUndo(p.plugin, true)).body as { result: Record<string, unknown> }
    ).result;
    expect(result.kind).toBe("redo");
    expect(result.redoDepthBefore).toBe(1);
    expect(result.redoDepthAfter).toBe(0);
    expect(result.popped).toBe(true);
    expect(p.nodes.get("c1")?.get("text")).toBe("edited");
  });
});

describe("WP38 AC6 — the response carries the scope, so a run can see it", () => {
  it("reports the allow-list by contents and the capture timeout", async () => {
    const p = makePlugin();
    p.register(CANVAS_UNDO_COMMAND_ID, () => p.registry.undo(PATH));
    const result = (
      (await callUndo(p.plugin)).body as { result: Record<string, unknown> }
    ).result;
    expect(result.trackedOrigins).toEqual(["canvas-capture-origin", "canvas-binding-origin"]);
    expect(result.captureTimeoutMs).toBe(500);
    expect(result.scope).toEqual(["nodes", "edges", "deleted"]);
    expect(result.managers).toBe(1);
    expect(result.path).toBe(PATH);
  });

  it("rejects a non-boolean `redo` at the command boundary", async () => {
    const p = makePlugin();
    const res = await routeCommand(host(p.plugin), {
      cmd: "canvas.undo",
      args: { redo: "yes" },
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toContain("'redo' must be a boolean");
  });

  it("a host without the capability answers a structured 400, never a crash", async () => {
    const res = await routeCommand({ canvasUndo: undefined } as never, { cmd: "canvas.undo" });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toContain("canvas.undo unavailable");
  });
});
