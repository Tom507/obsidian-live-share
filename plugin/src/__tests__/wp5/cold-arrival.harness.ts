// WP105 — the COLD-ARRIVAL harness (S130).
//
// WHY THIS EXISTS
// ---------------
// `waitForSync` appears in 81 test files; `installLatency` in 2. Every existing
// latency test awaits BOTH peers' `waitForSync` before racing anything, so it
// models delay BETWEEN CONNECTED PEERS and never FIRST ARRIVAL. The state
// `peerCount === 0` at subscribe time — where S119, S123, S126 and S129 all
// live — is one the harness could not produce. This file produces it.
//
// WHAT "COLD ARRIVAL" MEANS
// -------------------------
// A peer subscribes to a doc id NOBODY HAS EVER HELD. The relay answers the
// subscribe with peerCount 0, `SyncManager` resolves the doc synced under
// `SYNC_RESOLUTION.NO_PEERS`, and the document is empty — not because a peer
// said so, but because there was nobody to ask. Under latency the window in
// which that is true for a SECOND peer is exactly the injected one-way delay,
// which is why localhost hides it.
//
// SEAMS
// -----
// `installLatency` wraps `globalThis.WebSocket`, so it can only delay what
// crosses the wire. The ordering defects in this run are BELOW the socket and
// inside one process. `delaySeam` gives an injectable delay at an in-process
// seam by wrapping a method on an object the TEST owns — it never touches
// production source, and it records what it actually did so a scenario can
// prove the injection was in effect (AC4) instead of assuming it.
//
// NOT a *.test.ts file: vitest must not collect it.

import { SYNC_RESOLUTION, type SyncManager, type SyncResolution } from "../../sync/sync";
import { type Relay, type Room, createRoom, installLatency, newClient, sleep, startRelay } from "./harness";

// ---------------------------------------------------------------------------
// ASYMMETRIC latency — the reason the first sweep found no cliff
// ---------------------------------------------------------------------------
//
// MEASURED, and it is a limitation of the existing harness rather than a
// property of the product: `installLatency` gives EVERY client the same per-hop
// hold, so both peers' subscribes are delayed identically and the second peer
// still reaches the relay `gap` after the first, whatever the latency. A
// symmetric delay therefore CANNOT widen the first-arrival window — the first
// sweep showed the window shut by a 10 ms gap under a 40 ms one-way delay, which
// is the relay's ordering granularity, not the network.
//
// The window opens when peers are UNEQUALLY far from the relay: a seeder on a
// slow link and a reader on a fast one, which is the ordinary real deployment.
// This installs a wrapper whose per-hop hold is chosen PER SOCKET, from a value
// the test sets immediately before constructing that client.

const RealWebSocketForAsym: typeof WebSocket = globalThis.WebSocket;

export interface AsymLatency {
  /** Delay applied to the NEXT socket constructed, in ms per hop. */
  setNextDelay(ms: number): void;
  /** Per-socket delays actually applied, in construction order — AC4 evidence. */
  readonly applied: number[];
  restore(): void;
}

export function installAsymmetricLatency(defaultDelayMs: number): AsymLatency {
  const prev = globalThis.WebSocket;
  let nextDelay = defaultDelayMs;
  const applied: number[] = [];

  class AsymWebSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;

    readonly _real: WebSocket;
    private readonly delay: number;
    onopen: ((ev?: unknown) => void) | null = null;
    onclose: ((ev?: unknown) => void) | null = null;
    onmessage: ((ev: { data: unknown }) => void) | null = null;
    onerror: ((ev?: unknown) => void) | null = null;

    constructor(url: string) {
      this.delay = nextDelay;
      applied.push(this.delay);
      const real = new RealWebSocketForAsym(url);
      real.binaryType = "arraybuffer";
      this._real = real;
      Object.defineProperty(this, "binaryType", {
        get: () => real.binaryType,
        set: (v: BinaryType) => {
          real.binaryType = v;
        },
      });
      real.onopen = (ev) => this.onopen?.(ev);
      real.onerror = (ev) => this.onerror?.(ev);
      real.onclose = (ev) => this.onclose?.(ev);
      real.onmessage = (ev: MessageEvent) => {
        setTimeout(() => this.onmessage?.({ data: ev.data }), this.delay);
      };
    }

    get readyState(): number {
      return this._real.readyState;
    }

    send(data: ArrayBuffer | Uint8Array): void {
      const copy =
        data instanceof Uint8Array ? data.slice() : new Uint8Array(data as ArrayBuffer).slice();
      setTimeout(() => {
        try {
          if (this._real.readyState === RealWebSocketForAsym.OPEN) this._real.send(copy);
        } catch {
          /* closed mid-flight */
        }
      }, this.delay);
    }

    close(code?: number, reason?: string): void {
      this._real.close(code, reason);
    }
  }

  // biome-ignore lint/suspicious/noExplicitAny: test stub of the global.
  (globalThis as any).WebSocket = AsymWebSocket;
  return {
    setNextDelay(ms: number) {
      nextDelay = ms;
    },
    applied,
    restore() {
      // biome-ignore lint/suspicious/noExplicitAny: restore the global.
      (globalThis as any).WebSocket = prev;
    },
  };
}

// ---------------------------------------------------------------------------
// Seam injection
// ---------------------------------------------------------------------------

export interface SeamProbe {
  /** Human name of the seam, used in failure messages. */
  readonly name: string;
  /** How many times the seam was actually crossed. Zero means NOT INJECTED. */
  readonly crossings: number;
  /** Measured added delay per crossing, ms. */
  readonly observedMs: number[];
  /** The delay this seam was configured with. */
  readonly configuredMs: number;
  restore(): void;
}

/**
 * Hold every call to `obj[key]` for `ms` BEFORE delegating, and record how long
 * the hold actually lasted.
 *
 * AC4 — the probe is the proof. `crossings === 0` means the seam was never
 * reached and any verdict that rests on it is void; `observedMs` lets a test
 * assert the delay landed inside its band. A knob that does not turn is S113 in
 * a new place, so the knob reports on itself.
 */
export function delaySeam<T extends object>(
  obj: T,
  key: keyof T & string,
  ms: number,
  name = `${obj.constructor?.name ?? "obj"}.${key}`,
): SeamProbe {
  const original = obj[key];
  if (typeof original !== "function") {
    throw new Error(`delaySeam: ${name} is not a function; cannot inject`);
  }
  const observedMs: number[] = [];
  const probe = {
    name,
    configuredMs: ms,
    observedMs,
    get crossings() {
      return observedMs.length;
    },
    restore() {
      (obj as Record<string, unknown>)[key] = original as unknown;
    },
  };
  (obj as Record<string, unknown>)[key] = async function patched(this: unknown, ...args: unknown[]) {
    const t0 = Date.now();
    await sleep(ms);
    observedMs.push(Date.now() - t0);
    return (original as (...a: unknown[]) => unknown).apply(this ?? obj, args);
  };
  return probe;
}

/** AC4 — every configured seam must have been crossed and landed inside its band. */
export function assertSeamInBand(probe: SeamProbe, slackMs = 60): void {
  if (probe.crossings === 0) {
    throw new Error(
      `seam '${probe.name}' was configured for ${probe.configuredMs}ms but was NEVER CROSSED — ` +
        "the injection did nothing, so any result resting on it is void",
    );
  }
  const worst = Math.max(...probe.observedMs);
  const best = Math.min(...probe.observedMs);
  if (best < probe.configuredMs || worst > probe.configuredMs + slackMs) {
    throw new Error(
      `seam '${probe.name}' delay out of band: observed ${best}..${worst}ms, ` +
        `expected ${probe.configuredMs}..${probe.configuredMs + slackMs}ms`,
    );
  }
}

// ---------------------------------------------------------------------------
// Cold-arrival scenario
// ---------------------------------------------------------------------------

export interface ColdScenario {
  relay: Relay;
  room: Room;
  clients: SyncManager[];
  linkDelayMs: number;
  /** One-way A→relay→B, in ms, given the per-hop hold. */
  oneWayMs: number;
  client(id: string): SyncManager;
  close(): Promise<void>;
}

const ONE_WAY_HOPS = 2;

export async function coldScenario(linkDelayMs: number): Promise<ColdScenario> {
  const restore = installLatency(linkDelayMs);
  const relay = await startRelay();
  const room = await createRoom(relay.port, `wp105-${Date.now()}-${Math.random()}`);
  const clients: SyncManager[] = [];
  return {
    relay,
    room,
    clients,
    linkDelayMs,
    oneWayMs: linkDelayMs * ONE_WAY_HOPS,
    client(id: string) {
      const sm = newClient(relay.port, room, id);
      clients.push(sm);
      return sm;
    },
    async close() {
      for (const c of clients) c.destroy();
      await relay.close();
      restore();
    },
  };
}

/**
 * A cold scenario whose clients can sit at DIFFERENT distances from the relay.
 * `client(id, delayMs)` sets the per-hop hold for that client's socket only.
 */
export interface AsymScenario extends Omit<ColdScenario, "client"> {
  asym: AsymLatency;
  client(id: string, delayMs: number): SyncManager;
}

export async function asymScenario(defaultDelayMs = 20): Promise<AsymScenario> {
  const asym = installAsymmetricLatency(defaultDelayMs);
  const relay = await startRelay();
  const room = await createRoom(relay.port, `wp105a-${Date.now()}-${Math.random()}`);
  const clients: SyncManager[] = [];
  return {
    relay,
    room,
    clients,
    asym,
    linkDelayMs: defaultDelayMs,
    oneWayMs: defaultDelayMs * ONE_WAY_HOPS,
    client(id: string, delayMs: number) {
      asym.setNextDelay(delayMs);
      const sm = newClient(relay.port, room, id);
      clients.push(sm);
      return sm;
    },
    async close() {
      for (const c of clients) c.destroy();
      await relay.close();
      asym.restore();
    },
  };
}

/** A doc id no peer has ever subscribed to. THE point of the harness. */
export function freshDocId(kind: "note" | "canvas" = "note"): string {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return kind === "canvas" ? `__canvas__:cold-${id}.canvas` : `cold-${id}.md`;
}

export interface ArrivalResult {
  resolution: SyncResolution;
  /** Wall time from `getDoc` to `waitForSync` resolving. */
  elapsedMs: number;
  /** Records the doc held at the instant it was declared synced. */
  emptyAtResolve: boolean;
}

/**
 * Subscribe `sm` to `docId` and report WHICH REASON resolved it.
 *
 * This is the assertion no test could express before S128: not "did it sync"
 * but "was there anybody to ask". Also captures whether the doc was empty at
 * that instant, because that pair — resolved AND empty AND nobody asked — is
 * the exact precondition of the four data-loss defects.
 */
export async function arrive(
  sm: SyncManager,
  docId: string,
  timeoutMs = 8000,
): Promise<ArrivalResult> {
  const t0 = Date.now();
  const handle = sm.getDoc(docId);
  if (!handle) throw new Error(`no doc handle for ${docId}`);
  const resolution = await sm.waitForSync(docId, timeoutMs);
  const elapsedMs = Date.now() - t0;
  const text = handle.doc.getText("content").toString();
  const nodes = handle.doc.getMap("nodes").size;
  return { resolution, elapsedMs, emptyAtResolve: text.length === 0 && nodes === 0 };
}

export const RESOLUTION = SYNC_RESOLUTION;
