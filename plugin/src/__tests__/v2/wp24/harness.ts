// WP24 — shared fixtures for the sidecar store core suite.
//
// The fake `SidecarIO` is deliberately a RECORDING one: AC1's ordering claim
// ("truncates the history only after the checkpoint is durably written — never
// the reverse order") cannot be checked from the end state, because the end
// state is identical whichever order the two effects happened in. The oracle
// therefore has to be the CALL SEQUENCE, which means the seam has to remember
// it. `calls` records a start and an end marker per operation, and `block(op)`
// lets a test hold one operation open and observe what the store does while it
// is still in flight.
//
// The fake also COPIES on write/append, exactly as a real disk does. That is
// what makes `tp13` (append must snapshot its input before its first await)
// able to fail: the bytes the store hands us are read at body time, i.e. after
// the await, so an implementation that frames its input lazily stores whatever
// the caller's buffer contains by then.
//
// `read` THROWS on a missing path, again on purpose. AC3 says load "never
// throws"; a store that reads without an `exists` guard would propagate that
// error, and a forgiving fake that returned empty bytes would hide it.

import * as Y from "yjs";

import type { SidecarIO } from "../../../files/canvas-sidecar";

export type IoOp = "ensureDir" | "exists" | "read" | "write" | "append" | "truncate" | "remove";

export interface IoCall {
  readonly op: IoOp;
  readonly path: string;
  readonly phase: "start" | "end";
}

export interface FakeSidecarIO extends SidecarIO {
  /** The disk, as bytes. */
  readonly files: Map<string, Uint8Array>;
  readonly dirs: Set<string>;
  readonly calls: IoCall[];
  /** `${op}:${phase}:${path}` in the order the operations actually happened. */
  trace(): string[];
  /** Only the mutating operations, `${op}:${phase}`, ignoring reads/probes. */
  mutationTrace(): string[];
  /** Hold every future call of `op` open until the returned release runs. */
  block(op: IoOp): () => void;
}

export function createFakeIO(initial: Record<string, Uint8Array> = {}): FakeSidecarIO {
  const files = new Map<string, Uint8Array>();
  for (const [path, bytes] of Object.entries(initial)) files.set(path, Uint8Array.from(bytes));
  const dirs = new Set<string>();
  const calls: IoCall[] = [];
  const gates = new Map<IoOp, Promise<void>>();

  async function run<T>(op: IoOp, path: string, body: () => T): Promise<T> {
    calls.push({ op, path, phase: "start" });
    const gate = gates.get(op);
    if (gate) await gate;
    else await Promise.resolve();
    const out = body();
    calls.push({ op, path, phase: "end" });
    return out;
  }

  const MUTATING: IoOp[] = ["write", "append", "truncate", "remove"];

  return {
    files,
    dirs,
    calls,
    trace: () => calls.map((c) => `${c.op}:${c.phase}:${c.path}`),
    mutationTrace: () =>
      calls.filter((c) => MUTATING.includes(c.op)).map((c) => `${c.op}:${c.phase}`),
    block(op: IoOp): () => void {
      let release = (): void => {};
      gates.set(
        op,
        new Promise<void>((resolve) => {
          release = () => {
            gates.delete(op);
            resolve();
          };
        }),
      );
      return () => release();
    },
    ensureDir: (dirPath: string) =>
      run("ensureDir", dirPath, () => {
        dirs.add(dirPath);
      }),
    exists: (filePath: string) => run("exists", filePath, () => files.has(filePath)),
    read: (filePath: string) =>
      run("read", filePath, () => {
        const found = files.get(filePath);
        if (found === undefined) throw new Error(`ENOENT: ${filePath}`);
        return Uint8Array.from(found);
      }),
    write: (filePath: string, data: Uint8Array) =>
      run("write", filePath, () => {
        files.set(filePath, Uint8Array.from(data));
      }),
    append: (filePath: string, data: Uint8Array) =>
      run("append", filePath, () => {
        const prev = files.get(filePath) ?? new Uint8Array(0);
        const next = new Uint8Array(prev.length + data.length);
        next.set(prev, 0);
        next.set(data, prev.length);
        files.set(filePath, next);
      }),
    truncate: (filePath: string) =>
      run("truncate", filePath, () => {
        files.set(filePath, new Uint8Array(0));
      }),
    remove: (filePath: string) =>
      run("remove", filePath, () => {
        files.delete(filePath);
      }),
  };
}

// --- the on-disk format, encoded/decoded INDEPENDENTLY of the module ---------
// Charter §7 pins `frame := u32BE payloadLength || payload`. These helpers are
// the test side's own implementation of that pin, so a store that invents a
// different framing goes red instead of agreeing with itself.

export function frame(payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + payload.length);
  const n = payload.length;
  out[0] = (n >>> 24) & 0xff;
  out[1] = (n >>> 16) & 0xff;
  out[2] = (n >>> 8) & 0xff;
  out[3] = n & 0xff;
  out.set(payload, 4);
  return out;
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Split a history file back into payloads. Throws on a malformed tail. */
export function readFrames(history: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  let at = 0;
  while (at < history.length) {
    if (at + 4 > history.length) throw new Error(`incomplete frame header at ${at}`);
    const n =
      ((history[at] << 24) >>> 0) + (history[at + 1] << 16) + (history[at + 2] << 8) + history[at + 3];
    if (at + 4 + n > history.length) throw new Error(`incomplete frame payload at ${at}`);
    out.push(history.slice(at + 4, at + 4 + n));
    at += 4 + n;
  }
  return out;
}

// --- Yjs fixtures ------------------------------------------------------------

/** Collect every update this doc emits, in order. */
export function recordUpdates(doc: Y.Doc): Uint8Array[] {
  const out: Uint8Array[] = [];
  doc.on("update", (update: Uint8Array) => {
    out.push(Uint8Array.from(update));
  });
  return out;
}

export function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * A GC-safe state oracle. Raw `encodeStateAsUpdate` bytes are NOT comparable
 * across two docs that reached the same state by different routes (Yjs may GC
 * deleted content differently), so the pin is: same state vector AND same
 * observable content.
 */
export function docSnapshot(doc: Y.Doc): { sv: string; nodes: unknown; edges: unknown } {
  return {
    sv: hex(Y.encodeStateVector(doc)),
    nodes: doc.getMap("nodes").toJSON(),
    edges: doc.getMap("edges").toJSON(),
  };
}

/** Bytes Yjs refuses to decode. Every test that uses these asserts that premise. */
export const GARBAGE_UPDATE = Uint8Array.from([
  0xff, 0x7f, 0x2a, 0xde, 0xad, 0xbe, 0xef, 0xff, 0xff, 0xff,
]);

export const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);
export const fromUtf8 = (b: Uint8Array): string => new TextDecoder().decode(b);
