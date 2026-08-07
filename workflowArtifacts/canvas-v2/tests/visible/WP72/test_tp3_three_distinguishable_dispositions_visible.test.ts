// WP72 / C72 AC3 — "the return value distinguishes the outcomes it currently
// conflates".
//
// `{set:true}` is returned only when the named flag was applied to a path that
// consumes it. A name that is refused, and a name accepted only into a store
// nothing reads, are each reported as their own outcome and never as success.
// "The criterion is falsified by calling `setFlag` with a name in each class and
// showing the three responses differ — a single response shape for all three is
// the defect, not a simplification."
//
// The charter's §5 warns that this is the AC most likely to be faked: a repair
// returning `{set:true}` / `{set:false}` / `{set:false}` has MERGED two of the
// three classes and has not satisfied AC3. So the oracle below compares all
// three whole responses pairwise, not a single negative case.
//
// The boundary is `routeCommand` — the only path a driver can reach — following
// the same split WP51's own generated suite states: the direct host method keeps
// its pre-existing behaviour, which `e2e-control.test.ts` pins and which this WP
// holds no §7 licence to change. Nothing here restates or re-implements C51 AC3's
// rejection rule: this WP owns only the truthfulness of the answer.
//
// Staging: copy into `plugin/src/__tests__/wp72/` (one level deep → `../../`).
import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { type E2EPluginLike, buildPluginHost, routeCommand } from "../../testing/e2e-control";

function host() {
  const doc = new Y.Doc();
  const plugin = {
    settings: {
      clientId: "e2e-a",
      roomId: "canvas-v2-t3",
      role: "host",
      useCanvasBinding: false,
    } as Record<string, unknown>,
    muxConnected: true,
    controlConnected: true,
    saveSettings: () => {},
    canvasSync: {
      subscribe: async () => {},
      isSubscribed: () => true,
      getCanvasSnapshot: () => null,
      getCanvasDocHandle: () => ({ doc }),
    },
  } as unknown as E2EPluginLike;
  return {
    plugin,
    host: buildPluginHost(plugin, {
      counters: { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 },
      bump: () => {},
    }),
  };
}

describe("WP72 AC3 — three classes, three distinguishable responses", () => {
  it("one call per class, and all three responses differ from each other", async () => {
    const h = host().host;

    // (1) APPLIED — an existing settings key: the value reaches state the plugin
    //     itself consumes.
    const applied = await routeCommand(h, {
      cmd: "canvas.setFlag",
      args: { name: "useCanvasBinding", value: true },
    });

    // (2) INERT — accepted only into a store nothing reads.
    const inert = await routeCommand(h, {
      cmd: "canvas.setFlag",
      args: { name: "madeUpFlag", value: 1 },
    });

    // (3) REFUSED — refused at the command boundary under a distinct named reason.
    const refused = await routeCommand(h, {
      cmd: "canvas.setFlag",
      args: { name: "useCanvasBinding", value: true, persist: true },
    });

    // Pairwise distinctness over the WHOLE response. A merged pair fails here even
    // if each individual expectation below would have passed.
    const seen = [applied, inert, refused].map((r) => JSON.stringify(r));
    expect(new Set(seen).size).toBe(3);

    // ...and each is the outcome it claims to be, not merely different.
    expect(applied).toEqual({ status: 200, body: { ok: true, result: { set: true } } });

    expect(inert.status).toBe(200);
    expect(inert.body).toMatchObject({ ok: true });
    const inertResult = (inert.body as { result: Record<string, unknown> }).result;
    expect(inertResult.set).toBe(false);
    expect(inertResult.disposition).toBe("inert");
    expect(inertResult.consumer).toBe(null);
    expect(typeof inertResult.reason).toBe("string");
    expect(String(inertResult.reason)).toContain("madeUpFlag");

    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject({ ok: false });
    expect(String((refused.body as { error: string }).error)).toContain("refused:");
  });

  it("success is reserved: only the applied class ever answers set:true", async () => {
    const h = host().host;
    for (const name of ["madeUpFlag", "canvasStale", "canvas.stale", "staleView", ""]) {
      const out = await routeCommand(h, { cmd: "canvas.setFlag", args: { name, value: true } });
      // An empty name is the pre-existing `requireString` 400; the others are inert.
      if (out.status === 200) {
        expect((out.body as { result: { set: boolean } }).result.set).toBe(false);
      } else {
        expect(out.status).toBe(400);
      }
    }
  });

  it("the classifier is read-only: asking does not apply anything", () => {
    const { plugin, host: h } = host();
    const before = JSON.stringify(plugin.settings);
    expect(h.flagConsumer("useCanvasBinding")).toBe("plugin.settings");
    expect(h.flagConsumer("madeUpFlag")).toBe(null);
    expect(h.flagConsumer("roomId")).toBe("plugin.settings");
    expect(JSON.stringify(plugin.settings)).toBe(before);
    // Nothing was stashed either — `clearFlags` has nothing to clear.
    expect(h.clearFlags()).toEqual({ restored: [], cleared: [] });
  });

  it("I11 REFUSAL NEVER DESTROYS — an inert report destroys nothing", async () => {
    const { plugin, host: h } = host();
    h.setFlag("roomId", "overridden");
    const before = JSON.stringify(plugin.settings);
    const out = await routeCommand(h, {
      cmd: "canvas.setFlag",
      args: { name: "madeUpFlag", value: 1 },
    });
    expect((out.body as { result: { set: boolean } }).result.set).toBe(false);
    // The unrelated override is untouched, and the reversal record survives.
    expect(JSON.stringify(plugin.settings)).toBe(before);
    expect(h.clearFlags().restored).toEqual(["roomId"]);
  });

  it("a host that cannot classify keeps its pre-WP72 answer verbatim", async () => {
    // This is what keeps every hand-rolled fake host in the inherited tests valid.
    const legacy = {
      sessionInfo: () => ({ clientId: "c", role: "host", roomId: "r", connected: true }),
      canvasOpen: async () => ({ opened: true, subscribed: true }),
      canvasState: () => ({ nodes: [], edges: [] }),
      bindingCounters: () => ({ applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 }),
      simulateEdit: async () => ({ applied: true }),
      setFlag: () => ({ set: true }),
      waitQuiescent: async () => ({ quiescent: true }),
    };
    const out = await routeCommand(legacy, {
      cmd: "canvas.setFlag",
      args: { name: "anything", value: 1 },
    });
    expect(out).toEqual({ status: 200, body: { ok: true, result: { set: true } } });
  });
});
