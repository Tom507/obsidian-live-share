// WP1 / AC4 — clearing under path keys that overlap textually.
//
// Angle of attack: the neighbours are chosen so that a prefix match, a `startsWith`
// guard or a "clear everything under this folder" shortcut would take them down
// with the target. `Vault/Board.canvas` is cleared while
// `Vault/Board.canvas.backup.canvas`, `Vault/Board 2.canvas` and
// `Vault/Board/inner.canvas` must survive completely.
//
// Second angle: the cleared path is repopulated afterwards and must come back with
// NO memory of its previous contents — including no leftover known-absent marks,
// which is the state most likely to survive a naive "clear the field maps" loop.

import { describe, expect, it } from "vitest";

import {
  type SurfaceShadow,
  advanceField,
  advanceRecord,
  clearPath,
  createSurfaceShadow,
  getField,
  getRecordFields,
  getRecordState,
  listPaths,
  markRecordAbsent,
} from "../../../canvas/canvas-shadow";

const TARGET = "Vault/Board.canvas";
const NEIGHBOURS = [
  "Vault/Board.canvas.backup.canvas",
  "Vault/Board 2.canvas",
  "Vault/Board/inner.canvas",
  "Vault/board.canvas",
];

function seeded(): SurfaceShadow {
  const shadow = createSurfaceShadow();
  for (const path of [TARGET, ...NEIGHBOURS]) {
    advanceRecord(shadow, path, "node", "keep", { x: 1, text: path });
    advanceRecord(shadow, path, "edge", "wire", { fromNode: "keep", toNode: "other" });
    markRecordAbsent(shadow, path, "node", "vanished");
  }
  return shadow;
}

describe("WP1 AC4 — clearing is exact-key, never prefix-based", () => {
  it("clears only the exact key and keeps every textual neighbour", () => {
    const shadow = seeded();

    clearPath(shadow, TARGET);

    expect(getRecordState(shadow, TARGET, "node", "keep")).toBe("unknown");
    expect(listPaths(shadow).sort()).toEqual([...NEIGHBOURS].sort());

    for (const path of NEIGHBOURS) {
      expect(getRecordFields(shadow, path, "node", "keep")).toEqual({ x: 1, text: path });
      expect(getRecordState(shadow, path, "edge", "wire")).toBe("present");
      expect(getRecordState(shadow, path, "node", "vanished")).toBe("absent");
    }
  });

  it("differs from a case-insensitive clear: `Vault/board.canvas` survives", () => {
    const shadow = seeded();

    clearPath(shadow, TARGET);

    expect(getRecordState(shadow, "Vault/board.canvas", "node", "keep")).toBe("present");
    expect(getField(shadow, "Vault/board.canvas", "node", "keep", "text")).toBe(
      "Vault/board.canvas",
    );
  });

  it("drops known-absent marks too — nothing of the path is remembered", () => {
    const shadow = seeded();

    clearPath(shadow, TARGET);

    expect(getRecordState(shadow, TARGET, "node", "vanished")).toBe("unknown");
    expect(getRecordState(shadow, TARGET, "edge", "wire")).toBe("unknown");
    expect(getRecordFields(shadow, TARGET, "node", "vanished")).toBeNull();
  });

  it("a repopulated path starts from nothing", () => {
    const shadow = seeded();

    clearPath(shadow, TARGET);
    advanceField(shadow, TARGET, "node", "fresh", "x", 1);

    const pathState = shadow.paths.get(TARGET);
    expect(pathState).toBeDefined();
    if (!pathState) throw new Error("unreachable");
    expect([...pathState.node.keys()]).toEqual(["fresh"]);
    expect([...pathState.edge.keys()]).toEqual([]);
    expect(getRecordState(shadow, TARGET, "node", "keep")).toBe("unknown");
    expect(getRecordState(shadow, TARGET, "node", "vanished")).toBe("unknown");
  });

  it("clearing the same path twice is idempotent", () => {
    const shadow = seeded();

    clearPath(shadow, TARGET);
    clearPath(shadow, TARGET);

    expect(listPaths(shadow).sort()).toEqual([...NEIGHBOURS].sort());
    expect(getRecordState(shadow, TARGET, "node", "keep")).toBe("unknown");
  });
});
