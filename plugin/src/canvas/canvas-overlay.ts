// WP2 (owns) + WP3 (reuses) — the net-new DOM overlay rendered on the canvas
// surface. It is a DUMB renderer: it accepts a snapshot of remote cursor markers
// AND per-node held-highlights and paints them. All awareness/lock logic lives in
// canvas-presence.ts. Built to serve BOTH WP2 (cursors + here/typing indicator)
// and WP3 (held-highlight) so the overlay DOM is written once.
//
// The overlay is decoupled from the real DOM through a tiny structural interface
// (`OverlayHost`/`OverlayNode`) so it is unit-testable in a node environment with
// a fake element; at runtime main.ts passes a real Obsidian HTMLElement (cast).

export interface OverlayNode {
  setText(text: string): void;
  addClass(...cls: string[]): void;
  removeClass(...cls: string[]): void;
  remove(): void;
  style: Record<string, string>;
  createDiv(o?: { cls?: string }): OverlayNode;
}

export interface OverlayHost {
  empty(): void;
  createDiv(o?: { cls?: string }): OverlayNode;
}

export interface CursorMarker {
  clientId: number;
  x: number;
  y: number;
  color: string;
  name: string;
  /** true when this peer is actively editing a node (the "typing" half of here/typing). */
  typing: boolean;
}

export interface HeldHighlight {
  nodeId: string;
  color: string;
  name: string;
  // Screen-space box, when the presence layer could resolve it from the adapter.
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export interface OverlaySnapshot {
  cursors: CursorMarker[];
  highlights: HeldHighlight[];
}

export class CanvasOverlay {
  constructor(private host: OverlayHost) {}

  render(snapshot: OverlaySnapshot): void {
    this.host.empty();

    for (const cursor of snapshot.cursors) {
      const marker = this.host.createDiv({ cls: "ls-canvas-cursor" });
      marker.style.left = `${cursor.x}px`;
      marker.style.top = `${cursor.y}px`;
      marker.style.color = cursor.color;
      marker.style.borderColor = cursor.color;

      // Dot + label; the label carries name and (WP2 AC3) the here/typing state.
      const dot = marker.createDiv({ cls: "ls-canvas-cursor-dot" });
      dot.style.background = cursor.color;

      const label = marker.createDiv({ cls: "ls-canvas-cursor-label" });
      label.style.background = cursor.color;
      label.setText(cursor.typing ? `${cursor.name} (typing)` : cursor.name);
      if (cursor.typing) marker.addClass("is-typing");
    }

    for (const held of snapshot.highlights) {
      const box = this.host.createDiv({ cls: "ls-canvas-held" });
      box.style.borderColor = held.color;
      box.style.background = `${held.color}22`;
      if (held.x !== undefined) box.style.left = `${held.x}px`;
      if (held.y !== undefined) box.style.top = `${held.y}px`;
      if (held.width !== undefined) box.style.width = `${held.width}px`;
      if (held.height !== undefined) box.style.height = `${held.height}px`;

      const tag = box.createDiv({ cls: "ls-canvas-held-label" });
      tag.style.background = held.color;
      tag.setText(held.name);
    }
  }

  destroy(): void {
    this.host.empty();
  }
}
