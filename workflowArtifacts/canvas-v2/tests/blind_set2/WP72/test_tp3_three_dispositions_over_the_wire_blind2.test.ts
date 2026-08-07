// WP72 / C72 AC3 (blind set 2) — "the return value distinguishes the outcomes it
// currently conflates".
//
// ANGLE (different mechanism from the visible set and from blind set 1): those
// call `routeCommand` in-process and inspect the object it returns. A driver
// never sees that object. It sees an HTTP response: a status line and a body of
// bytes. This test therefore stands the REAL control server up on 127.0.0.1 with
// an ephemeral port, sends one genuine `POST /command` per class, and compares
// what actually came back over the socket — status code, `Content-Type`, and the
// decoded body — because "distinguishable" is a property of what reaches the
// caller, not of an internal return value. An in-process test cannot see a
// transport that flattens 400 into 200, drops the disposition fields on
// serialisation, or answers with a body a driver cannot decode; this one can.
//
// It then drives the reversal over the same socket, which is what AC2's
// "reversible THROUGH THE PROTOCOL" means in the end.
//
// No timing constant, no sleep, no polling: the port is taken from the server's
// own `onListening` callback and every request is awaited on its `end` event.
//
// WOULD REDDEN IF: two of the three classes came back as the same (status, body)
// pair — the `{set:true}`/`{set:false}`/`{set:false}` repair the charter §5 warns
// about collapses the two 200s and fails the pairwise-distinctness assertion; if
// the refusal stopped being a 4xx; if the inert disposition were dropped on the
// way through the JSON envelope; or if the applied class stopped answering
// `{set:true}`.
//
// DATA SAFETY: no file is opened at all; the socket binds 127.0.0.1 on an
// ephemeral port and is closed in `afterEach`. No vault is touched.
//
// Staging: copy into `plugin/src/__tests__/wp72blind2/` (→ `../../testing/...`).
import { afterEach, describe, expect, it } from "vitest";
import { request } from "node:http";

import {
  type ControlServerHandle,
  type E2EFileControlHost,
  type E2EPluginLike,
  buildPluginHost,
  createControlServer,
} from "../../testing/e2e-control";

const LOADED: Record<string, unknown> = {
  clientId: "blind2-client",
  roomId: "blind2-room",
  role: "host",
  sharedFolder: "_e2e-rig",
  useCanvasBinding: false,
};

interface WireResponse {
  status: number;
  contentType: string;
  body: unknown;
}

let open: ControlServerHandle | null = null;

afterEach(() => {
  open?.close();
  open = null;
});

/** Stand the real server up and resolve once it is actually bound. */
function listen(host: E2EFileControlHost): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    try {
      open = createControlServer(host, { port: 0, onListening: (bound) => resolve(bound) });
    } catch (err) {
      reject(err);
    }
  });
}

/** One real `POST /command`, resolved on the response's `end` event. */
function post(port: number, payload: unknown): Promise<WireResponse> {
  const raw = JSON.stringify(payload);
  return new Promise<WireResponse>((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port,
        path: "/command",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(raw),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          try {
            resolve({
              status: res.statusCode ?? 0,
              contentType: String(res.headers["content-type"] ?? ""),
              body: JSON.parse(text) as unknown,
            });
          } catch (err) {
            reject(new Error(`undecodable response body: ${String(err)}`));
          }
        });
      },
    );
    req.on("error", reject);
    req.end(raw);
  });
}

function fixture(): { settings: Record<string, unknown>; host: E2EFileControlHost } {
  const settings: Record<string, unknown> = { ...LOADED };
  const plugin = {
    settings,
    muxConnected: true,
    controlConnected: true,
    saveSettings: () => {
      throw new Error("AC1 violation: the wire path must never persist");
    },
    canvasSync: null,
  } as unknown as E2EPluginLike;
  return {
    settings,
    host: buildPluginHost(plugin, {
      counters: { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 },
      bump: () => {},
    }),
  };
}

describe("WP72 AC3 blind2 — three classes, three responses, measured on the socket", () => {
  it("one real request per class, and the three wire responses are pairwise distinct", async () => {
    const { settings, host } = fixture();
    const port = await listen(host);
    expect(port).toBeGreaterThan(0);

    const applied = await post(port, {
      cmd: "canvas.setFlag",
      args: { name: "useCanvasBinding", value: true },
    });
    const inert = await post(port, {
      cmd: "canvas.setFlag",
      args: { name: "madeUpFlag", value: 1 },
    });
    const refused = await post(port, {
      cmd: "canvas.setFlag",
      args: { name: "useCanvasBinding", value: true, persist: true },
    });

    // Pairwise distinct as WHOLE wire responses. A merged pair — the charter §5
    // fake — makes two of these three identical and fails here.
    const wire = [applied, inert, refused].map((r) => JSON.stringify(r));
    expect(new Set(wire).size).toBe(3);

    // ...and the distinction survives at the level a driver actually branches on.
    expect([applied.status, inert.status, refused.status]).toEqual([200, 200, 400]);
    expect(JSON.stringify(applied.body)).not.toBe(JSON.stringify(inert.body));
    for (const r of [applied, inert, refused]) {
      expect(r.contentType).toContain("application/json");
    }

    // APPLIED — the unchanged shape, pinned whole.
    expect(applied.body).toEqual({ ok: true, result: { set: true } });
    expect(settings.useCanvasBinding).toBe(true);

    // INERT — a success envelope carrying a NON-success disposition. Key set
    // pinned exactly; the free-text reason is not the oracle.
    const inertBody = inert.body as { ok: boolean; result: Record<string, unknown> };
    expect(inertBody.ok).toBe(true);
    expect(Object.keys(inertBody.result).sort()).toEqual([
      "consumer",
      "disposition",
      "reason",
      "set",
    ]);
    expect({
      set: inertBody.result.set,
      disposition: inertBody.result.disposition,
      consumer: inertBody.result.consumer,
    }).toEqual({ set: false, disposition: "inert", consumer: null });
    expect("madeUpFlag" in settings).toBe(false);

    // REFUSED — a different envelope entirely: `ok:false`, no `result` at all.
    const refusedBody = refused.body as Record<string, unknown>;
    expect(refusedBody.ok).toBe(false);
    expect("result" in refusedBody).toBe(false);
    expect(String(refusedBody.error)).toContain("refused:");
  });

  it("the refusal reached nothing: the wire says 400 and the instance is unchanged", async () => {
    const { settings, host } = fixture();
    const port = await listen(host);

    const before = { ...settings };
    const out = await post(port, {
      cmd: "canvas.setFlag",
      args: { name: "roomId", value: "clobbered", persist: true },
    });

    expect(out.status).toBe(400);
    expect({ ...settings }).toStrictEqual(before);
    // I11 REFUSAL NEVER DESTROYS: nothing to reverse either.
    const cleared = await post(port, { cmd: "canvas.clearFlags" });
    expect(cleared.status).toBe(200);
    expect(cleared.body).toEqual({ ok: true, result: { restored: [], cleared: [] } });
  });

  it("apply and reverse over the same socket, with no file anywhere in the path", async () => {
    const { settings, host } = fixture();
    const port = await listen(host);

    await post(port, { cmd: "canvas.setFlag", args: { name: "roomId", value: "elsewhere" } });
    await post(port, { cmd: "canvas.setFlag", args: { name: "useCanvasBinding", value: true } });
    await post(port, { cmd: "canvas.setFlag", args: { name: "madeUpFlag", value: 1 } });
    expect(settings.roomId).toBe("elsewhere");

    const cleared = await post(port, { cmd: "canvas.clearFlags" });
    expect(cleared.status).toBe(200);
    const result = (cleared.body as { result: { restored: string[]; cleared: string[] } }).result;
    expect([...result.restored].sort()).toEqual(["roomId", "useCanvasBinding"]);
    expect(result.cleared).toEqual(["madeUpFlag"]);
    expect({ ...settings }).toStrictEqual({ ...LOADED });
    // The fixture's `saveSettings` throws; reaching it anywhere on this path
    // would have surfaced as a 400 on one of the requests above.
  });

  it("the surface is still one endpoint on one socket — nothing else answers", async () => {
    const { host } = fixture();
    const port = await listen(host);

    // A wrong path is a 404, not a second command channel that quietly accepts
    // flags. This is the transport-level half of "no new command family".
    const notFound = await new Promise<number>((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port, path: "/setFlag", method: "POST" }, (res) => {
        res.on("data", () => {});
        res.on("end", () => resolve(res.statusCode ?? 0));
      });
      req.on("error", reject);
      req.end("{}");
    });
    expect(notFound).toBe(404);
  });
});
