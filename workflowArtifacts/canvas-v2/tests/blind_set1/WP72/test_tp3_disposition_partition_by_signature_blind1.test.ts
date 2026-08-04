// WP72 / C72 AC3 (blind set 1) — "the return value distinguishes the outcomes it
// currently conflates".
//
// ANGLE (different mechanism from the visible set): the visible test takes one
// call per class and compares the three responses pairwise. That is the charter's
// own recipe, so repeating it would prove nothing new. Here the oracle is an
// EQUIVALENCE PARTITION over a table of twelve calls spanning the three classes:
// every response is reduced to a name-normalised signature (the name is erased
// from every string in the body, so a response that merely quotes its argument
// cannot masquerade as a distinct outcome), and the assertion is about the
// induced partition:
//   ├── all four APPLIED calls must collapse to ONE signature
//   ├── all four INERT calls must collapse to ONE signature
//   ├── all four REFUSED calls must collapse to ONE signature
//   └── the three signatures must be pairwise distinct → exactly three cells
// This is strictly stronger than "the three differ": it also fails a repair that
// makes the answer differ *per name* rather than *per class*, which would look
// distinguishable in a three-call test while telling a driver nothing about the
// disposition.
//
// The file closes by running the SAME oracle over the exact fake the charter §5
// warns about — `{set:true}` / `{set:false}` / `{set:false}` — and showing it
// collapses to two cells. That is this test's own proof that it can fail.
//
// The boundary under test is `routeCommand`, the only path a driver can reach.
// The direct host method keeps its inherited pre-WP72 behaviour, which
// `plugin/src/__tests__/e2e-control.test.ts` pins and which WP72 holds no licence
// to change; nothing here asserts anything about it. Nothing here restates or
// re-implements C51 AC3's rejection rule either — that is WP51's.
//
// DATA SAFETY: no file is opened at all in this test; no vault is touched.
//
// Staging: copy into `plugin/src/__tests__/wp72blind1/` (→ `../../testing/...`).
import { describe, expect, it } from "vitest";

import {
  type CommandResult,
  type E2EFileControlHost,
  type E2EPluginLike,
  buildPluginHost,
  routeCommand,
} from "../../testing/e2e-control";

type Response = { status: number; body: CommandResult };

function makeHost(): { plugin: E2EPluginLike; host: E2EFileControlHost } {
  const settings: Record<string, unknown> = {
    clientId: "blind1-client",
    roomId: "blind1-room",
    role: "host",
    sharedFolder: "_e2e-rig",
    useCanvasBinding: false,
    showCanvasPresence: true,
  };
  const plugin = {
    settings,
    muxConnected: true,
    controlConnected: true,
    saveSettings: () => {},
    canvasSync: null,
  } as unknown as E2EPluginLike;
  return {
    plugin,
    host: buildPluginHost(plugin, {
      counters: { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 },
      bump: () => {},
    }),
  };
}

/**
 * A canonical, NAME-ERASED, key-order-independent signature of a whole response.
 *
 * Erasing the name is the point: a response whose only variation is that it
 * echoes its own argument carries no disposition information, and this oracle
 * refuses to count that as a distinction. Sorting keys means a reordered result
 * object is the same signature, so the partition is about content, not layout.
 */
function signature(name: string, res: Response): string {
  const erase = (v: unknown): unknown => {
    if (typeof v === "string") return name.length > 0 ? v.split(name).join("<NAME>") : v;
    if (Array.isArray(v)) return v.map(erase);
    if (v !== null && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        out[k] = erase((v as Record<string, unknown>)[k]);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify({ status: res.status, body: erase(res.body) });
}

/** APPLIED — existing settings keys: the value reaches state the plugin consumes. */
const APPLIED_NAMES = ["useCanvasBinding", "roomId", "sharedFolder", "showCanvasPresence"];
/** INERT — accepted only into a store nothing reads. */
const INERT_NAMES = ["madeUpFlag", "canvasStaleView", "someUnreadFlag", "zzzNoReader"];
/** REFUSED — refused at the command boundary under a distinct named reason. */
const REFUSED_NAMES = ["useCanvasBinding", "roomId", "madeUpFlag", "zzzNoReader"];

async function call(host: E2EFileControlHost, name: string, persist?: boolean): Promise<Response> {
  const args: Record<string, unknown> = { name, value: "v" };
  if (persist !== undefined) args.persist = persist;
  return routeCommand(host, { cmd: "canvas.setFlag", args });
}

describe("WP72 AC3 blind1 — the responses partition into exactly three cells", () => {
  it("twelve calls, three classes: one signature per class, three signatures in all", async () => {
    const { host } = makeHost();

    const applied: string[] = [];
    for (const name of APPLIED_NAMES) applied.push(signature(name, await call(host, name)));

    const inert: string[] = [];
    for (const name of INERT_NAMES) inert.push(signature(name, await call(host, name)));

    const refused: string[] = [];
    for (const name of REFUSED_NAMES) refused.push(signature(name, await call(host, name, true)));

    // Each class is internally uniform: the answer is about the DISPOSITION, not
    // about which name happened to be asked.
    expect(new Set(applied).size).toBe(1);
    expect(new Set(inert).size).toBe(1);
    expect(new Set(refused).size).toBe(1);

    // ...and the three classes are pairwise disjoint. Exactly three cells: a
    // merged pair gives 2 and fails here, which is the charter §5 defect.
    const cells = new Set([...applied, ...inert, ...refused]);
    expect(cells.size).toBe(3);
  });

  it("each cell is the outcome it claims to be, pinned as a whole object", async () => {
    const { host } = makeHost();

    // APPLIED — the shape is UNCHANGED from before WP72, whole-object pinned.
    expect(await call(host, "useCanvasBinding")).toEqual({
      status: 200,
      body: { ok: true, result: { set: true } },
    });

    // INERT — 200 (nothing was destroyed, I11) but never `set:true`, and it
    // carries its own named disposition. The exact key set is pinned, so an
    // extra or missing field is a failure; the free-text `reason` is checked for
    // type and provenance only, never used as the oracle.
    const inert = await call(host, "madeUpFlag");
    expect(inert.status).toBe(200);
    const result = (inert.body as { ok: true; result: Record<string, unknown> }).result;
    expect(Object.keys(result).sort()).toEqual(["consumer", "disposition", "reason", "set"]);
    expect({
      set: result.set,
      disposition: result.disposition,
      consumer: result.consumer,
    }).toEqual({ set: false, disposition: "inert", consumer: null });
    expect(typeof result.reason).toBe("string");

    // REFUSED — a different TRANSPORT-level outcome, not merely a different
    // field: status 400 with `ok:false`, so it is not even the same body union
    // member as the other two.
    const refused = await call(host, "roomId", true);
    expect(refused.status).toBe(400);
    expect(refused.body.ok).toBe(false);
    expect("result" in refused.body).toBe(false);
  });

  it("success is reserved: no non-applied call anywhere in the table answers set:true", async () => {
    const { host } = makeHost();
    for (const name of INERT_NAMES) {
      const body = (await call(host, name)).body;
      expect(body.ok).toBe(true);
      expect((body as { ok: true; result: { set?: unknown } }).result.set).not.toBe(true);
    }
    for (const name of REFUSED_NAMES) {
      const body = (await call(host, name, true)).body;
      expect(body.ok).toBe(false);
    }
  });

  it("classifying is free of side effects — the disposition report changes no state", async () => {
    const { plugin, host } = makeHost();
    const snapshot = { ...(plugin.settings as Record<string, unknown>) };

    // An inert report and a refusal both leave the settings object exactly as it
    // was, and neither leaves anything behind for the reversal to undo.
    await call(host, "madeUpFlag");
    await call(host, "roomId", true);
    expect({ ...(plugin.settings as Record<string, unknown>) }).toStrictEqual(snapshot);
    expect(host.clearFlags()).toEqual({ restored: [], cleared: ["madeUpFlag"] });
    expect({ ...(plugin.settings as Record<string, unknown>) }).toStrictEqual(snapshot);
  });

  it("FALSIFICATION: the same partition oracle rejects the {true}/{false}/{false} repair", () => {
    // The exact fake the charter §5 warns about, built by hand and fed to the
    // SAME signature + partition machinery used above. If this collapsed to
    // three cells, every assertion in this file would be worthless.
    const fake: Record<"applied" | "inert" | "refused", Response> = {
      applied: { status: 200, body: { ok: true, result: { set: true } } },
      inert: { status: 200, body: { ok: true, result: { set: false } } },
      refused: { status: 200, body: { ok: true, result: { set: false } } },
    };
    const sigs = new Set(
      (Object.keys(fake) as Array<keyof typeof fake>).map((k) => signature("madeUpFlag", fake[k])),
    );
    expect(sigs.size).toBe(2); // two of the three classes merged → AC3 not met

    // And a "distinguishable per NAME rather than per CLASS" repair — the other
    // way to look green against a three-call test — is erased to one signature,
    // so it can never manufacture a third cell.
    const echoA: Response = { status: 200, body: { ok: true, result: { set: false, name: "aaa" } } };
    const echoB: Response = { status: 200, body: { ok: true, result: { set: false, name: "bbb" } } };
    expect(signature("aaa", echoA)).toBe(signature("bbb", echoB));
  });
});
