import { describe, expect, it } from "vitest";

import { CanvasOverlay, type OverlayHost, type OverlayNode } from "../canvas/canvas-overlay";

// Minimal fake element implementing the OverlayHost/OverlayNode structural
// interface, so the overlay is testable in a plain node environment (no jsdom).
function makeNode(
  cls?: string,
): OverlayHost &
  OverlayNode & { cls?: string; children: OverlayNode[]; text: string; classes: Set<string> } {
  const node = {
    cls,
    children: [] as OverlayNode[],
    text: "",
    classes: new Set<string>(),
    style: {} as Record<string, string>,
    setText(t: string) {
      this.text = t;
    },
    addClass(...c: string[]) {
      for (const x of c) this.classes.add(x);
    },
    removeClass(...c: string[]) {
      for (const x of c) this.classes.delete(x);
    },
    remove() {},
    empty() {
      this.children = [];
    },
    createDiv(o?: { cls?: string }) {
      const child = makeNode(o?.cls);
      this.children.push(child);
      return child;
    },
  };
  return node;
}

describe("CanvasOverlay", () => {
  it("renders a remote cursor marker carrying the peer color and name (US2 AC1/AC2)", () => {
    const host = makeNode("root");
    const overlay = new CanvasOverlay(host);

    overlay.render({
      cursors: [{ clientId: 2, x: 10, y: 20, color: "#ff0000", name: "Alice", typing: false }],
      highlights: [],
    });

    expect(host.children).toHaveLength(1);
    const marker = host.children[0] as ReturnType<typeof makeNode>;
    expect(marker.cls).toBe("ls-canvas-cursor");
    expect(marker.style.left).toBe("10px");
    expect(marker.style.top).toBe("20px");
    expect(marker.style.color).toBe("#ff0000");

    const label = marker.children.find(
      (c) => (c as ReturnType<typeof makeNode>).cls === "ls-canvas-cursor-label",
    ) as ReturnType<typeof makeNode>;
    expect(label.text).toBe("Alice");
  });

  it("marks the here/typing state on an actively-editing peer (US2 AC3)", () => {
    const host = makeNode("root");
    const overlay = new CanvasOverlay(host);

    overlay.render({
      cursors: [{ clientId: 2, x: 0, y: 0, color: "#00ff00", name: "Bob", typing: true }],
      highlights: [],
    });

    const marker = host.children[0] as ReturnType<typeof makeNode>;
    expect(marker.classes.has("is-typing")).toBe(true);
    const label = marker.children.find(
      (c) => (c as ReturnType<typeof makeNode>).cls === "ls-canvas-cursor-label",
    ) as ReturnType<typeof makeNode>;
    expect(label.text).toBe("Bob (typing)");
  });

  it("renders a held-highlight box in the holder color (US3 AC1)", () => {
    const host = makeNode("root");
    const overlay = new CanvasOverlay(host);

    overlay.render({
      cursors: [],
      highlights: [{ nodeId: "n1", color: "#0000ff", name: "Carol" }],
    });

    const box = host.children[0] as ReturnType<typeof makeNode>;
    expect(box.cls).toBe("ls-canvas-held");
    expect(box.style.borderColor).toBe("#0000ff");
    const tag = box.children.find(
      (c) => (c as ReturnType<typeof makeNode>).cls === "ls-canvas-held-label",
    ) as ReturnType<typeof makeNode>;
    expect(tag.text).toBe("Carol");
  });

  it("clears prior markers on each render", () => {
    const host = makeNode("root");
    const overlay = new CanvasOverlay(host);
    overlay.render({
      cursors: [{ clientId: 2, x: 1, y: 1, color: "#111", name: "A", typing: false }],
      highlights: [],
    });
    overlay.render({ cursors: [], highlights: [] });
    expect(host.children).toHaveLength(0);
  });
});
