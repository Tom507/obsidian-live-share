// WP6 — Two lightweight-plugin-host launcher harness (US6).
//
// Boots TWO lightweight plugin hosts against ONE local relay so an external
// driver (the `liveshare-e2e` MCP, WP5) can run a real two-instance canvas
// convergence session. Each host = a real `SyncManager` client (plugin/src/sync)
// + a real flag-gated control server (plugin/src/testing/e2e-control.ts) on a
// distinct `e2eControlPort`, subscribed to the SAME relay room.
//
// This is the "lightweight plugin host" model from BUILD_SPEC §5 A2 — NOT two
// full Obsidian instances (real Obsidian = T3, out of scope). It deliberately
// REUSES the `wp5/harness.ts` real-relay/real-client bring-up (`createApp`
// (noopPersistence) + `server.listen(0)` + real `SyncManager` via `newClient`)
// rather than standing up a parallel connection stack (BUILD_SPEC §5 A2 / US6 AC2).
//
// NOTE: not named *.test.ts so vitest does not collect it as a suite. It is
// imported by two-host.test.ts (verification) and by launch-entry.ts (launcher).

import * as Y from "yjs";
import { SyncManager } from "../../sync/sync";
import {
  buildPluginHost,
  type ControlServerHandle,
  createControlServer,
  type E2EPluginLike,
} from "../../testing/e2e-control";
import { createRoom, newClient, type Relay, type Room, startRelay } from "../wp5/harness";

// ---------------------------------------------------------------------------
// Lightweight canvasSync — the minimal `E2EPluginLike.canvasSync` surface the
// WP4 control host drives, backed by a real SyncManager's per-canvas Y.Doc.
// ---------------------------------------------------------------------------

/** Canvas doc id convention shared with the plugin + wp5 latency suite. */
function canvasDocId(path: string): string {
  return `__canvas__:${path}`;
}

type CanvasRecord = Record<string, unknown>;

/** Read a `Y.Map<Y.Map>` collection into flat plain records. */
function readCollection(doc: Y.Doc, key: "nodes" | "edges"): CanvasRecord[] {
  const map = doc.getMap<Y.Map<unknown>>(key);
  const out: CanvasRecord[] = [];
  for (const [id, ymap] of map.entries()) {
    const rec: CanvasRecord = { id };
    for (const [k, v] of (ymap as Y.Map<unknown>).entries()) rec[k] = v;
    out.push(rec);
  }
  return out;
}

/** Snapshot the shared canvas doc, pruning dangling edges (endpoint missing). */
function snapshotFromDoc(doc: Y.Doc): { nodes: CanvasRecord[]; edges: CanvasRecord[] } {
  const nodes = readCollection(doc, "nodes");
  const edges = readCollection(doc, "edges");
  const nodeIds = new Set(nodes.map((n) => String(n.id)));
  const liveEdges = edges.filter(
    (e) => nodeIds.has(String(e.fromNode)) && nodeIds.has(String(e.toNode)),
  );
  return { nodes, edges: liveEdges };
}

/** Build the lightweight `canvasSync` surface over a live SyncManager. */
function makeCanvasSync(sm: SyncManager): NonNullable<E2EPluginLike["canvasSync"]> {
  const subscribed = new Set<string>();
  return {
    async subscribe(path: string, _role: "host" | "guest"): Promise<void> {
      const id = canvasDocId(path);
      const handle = sm.getDoc(id); // creates + subscribes when connected
      if (!handle) return;
      subscribed.add(path);
      // Best-effort settle. The first host to open a fresh canvas has nothing to
      // receive, so a timeout here is not an error — never throw into the view.
      try {
        await sm.waitForSync(id, 5_000);
      } catch {
        /* no peer state yet — fine */
      }
    },
    isSubscribed(path: string): boolean {
      return subscribed.has(path);
    },
    getCanvasSnapshot(path: string) {
      const handle = sm.getDoc(canvasDocId(path));
      return handle ? snapshotFromDoc(handle.doc) : null;
    },
    getCanvasDocHandle(path: string) {
      const handle = sm.getDoc(canvasDocId(path));
      return handle ? { doc: handle.doc } : null;
    },
  };
}

// ---------------------------------------------------------------------------
// Host + boot types
// ---------------------------------------------------------------------------

export interface HostHandle {
  label: "a" | "b";
  clientId: string;
  role: "host" | "guest";
  /** Bound control-server port (127.0.0.1). */
  controlPort: number;
  sync: SyncManager;
  control: ControlServerHandle;
  /** Tear down control server + sync client. Safe to call once. */
  close(): void;
}

export interface TwoHostBoot {
  /** In-process relay when the launcher owns it; null when using an external relay. */
  relay: Relay | null;
  relayPort: number;
  room: Room;
  hosts: [HostHandle, HostHandle];
  /** Stop both hosts and (if owned) the relay, freeing both control ports. */
  close(): Promise<void>;
}

export interface BootOptions {
  /** Requested control port for host A (0 = ephemeral). */
  portA?: number;
  /** Requested control port for host B (0 = ephemeral). */
  portB?: number;
  /**
   * When set, connect both hosts to an already-running LOCAL relay on this port
   * (a `server/` dev instance or the dockerized `server/`) instead of booting one
   * in-process. Omit to boot the relay in-process (BUILD_SPEC §5 A2 preferred path).
   */
  externalRelayPort?: number;
  /** Room name (cosmetic). */
  roomName?: string;
  /** Called once each control server is listening, with its bound port. */
  onHostListening?: (label: "a" | "b", port: number) => void;
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

function buildHost(
  label: "a" | "b",
  relayPort: number,
  room: Room,
  requestedPort: number,
  onListening?: (port: number) => void,
): HostHandle {
  const clientId = `e2e-${label}`;
  const role: "host" | "guest" = label === "a" ? "host" : "guest";

  // Real SyncManager client against the real relay room (wp5 pattern).
  const sync = newClient(relayPort, room, clientId);

  const plugin: E2EPluginLike = {
    settings: { clientId, roomId: room.id, role },
    muxConnected: false,
    controlConnected: false,
    canvasSync: makeCanvasSync(sync),
    saveSettings: () => {},
  };

  // Lightweight host has a single relay socket; mirror its state onto both the
  // mux + control flags so `session.info.connected` reflects reality.
  sync.onConnectionChange((connected: boolean) => {
    plugin.muxConnected = connected;
    plugin.controlConnected = connected;
  });

  const counters = { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 };
  const host = buildPluginHost(plugin, { counters, bump: () => {} });

  let controlPort = requestedPort;
  const control = createControlServer(host, {
    port: requestedPort,
    onListening: (bound) => {
      controlPort = bound;
      onListening?.(bound);
    },
  });

  return {
    label,
    clientId,
    role,
    get controlPort() {
      return control.port() || controlPort;
    },
    sync,
    control,
    close() {
      try {
        control.close();
      } catch {
        /* ignore */
      }
      try {
        sync.destroy();
      } catch {
        /* ignore */
      }
    },
  };
}

/** Wait until a control server reports a non-zero bound port. */
async function waitForBoundPort(host: HostHandle, timeoutMs = 5_000): Promise<number> {
  const start = Date.now();
  for (;;) {
    const p = host.control.port();
    if (p > 0) return p;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`control server for host ${host.label} did not bind within ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

/**
 * Boot two lightweight plugin hosts (A + B) on distinct control ports against a
 * single local relay room. Returns once both control servers are bound.
 */
export async function bootTwoHosts(opts: BootOptions = {}): Promise<TwoHostBoot> {
  const roomName = opts.roomName ?? `liveshare-e2e-${Date.now()}`;

  let relay: Relay | null = null;
  let relayPort: number;
  if (typeof opts.externalRelayPort === "number" && opts.externalRelayPort > 0) {
    relayPort = opts.externalRelayPort;
  } else {
    relay = await startRelay();
    relayPort = relay.port;
  }

  // ONE room → both hosts share it → identical roomId (US6 AC3).
  const room = await createRoom(relayPort, roomName);

  const hostA = buildHost("a", relayPort, room, opts.portA ?? 0, (p) =>
    opts.onHostListening?.("a", p),
  );
  const hostB = buildHost("b", relayPort, room, opts.portB ?? 0, (p) =>
    opts.onHostListening?.("b", p),
  );

  await Promise.all([waitForBoundPort(hostA), waitForBoundPort(hostB)]);

  return {
    relay,
    relayPort,
    room,
    hosts: [hostA, hostB],
    async close() {
      hostA.close();
      hostB.close();
      if (relay) await relay.close();
    },
  };
}
