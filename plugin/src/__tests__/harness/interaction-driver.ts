// WP1 — Synthetic interaction driver for the CanvasDouble.
//
// CRUX (BUILD_SPEC §3 decision 1, US1 AC3): every geometry/structure mutation is
// PAIRED with the real private-API interaction signal the adapter hooks, and the
// signal is fired by calling the method through `canvas.*` so the adapter's monkey-
// patch wrapper runs. This is why the harness tests the real *capture* wiring
// (local-intent detection) and not just the *apply* path — calling `moveAndResize`
// directly would give a false-green on capture.
//
// Signal pairings (the adapter only hooks these two triggers):
//   * drag / resize → `setDragging(true)` with `nodeInteractionLayer.target` set to
//     the node → mutate geometry → `setDragging(false)`.
//   * any change that alters what is "held" (add / delete / text edit) → set
//     `canvas.selection` then call `updateSelection`.

import type { CanvasDouble, DoubleEdgeRecord, DoubleNodeRecord } from "./canvas-double";

/** Partial geometry for a drag (position) or resize (size ± position). */
export interface GeometryPatch {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export interface DriveOptions {
  /**
   * Invoked mid-interaction — after geometry is mutated and while
   * `setDragging(true)` is still active (before `setDragging(false)`). Lets a test
   * observe `isBusy() === true` and `applyNodeGeometry(...) === "interacting"`.
   */
  during?: () => void;
}

export class InteractionDriver {
  constructor(private readonly double: CanvasDouble) {}

  private get canvas() {
    return this.double.canvas;
  }

  // ---- low-level drag bracket primitives ------------------------------------

  /** Begin a drag on a node: set the interaction target, then fire setDragging(true). */
  beginDrag(nodeId: string): void {
    this.canvas.nodeInteractionLayer.target = { id: nodeId };
    // Called through canvas.* so the adapter's wrapper fires (signal injection).
    this.canvas.setDragging(true);
  }

  /** End the current drag: fire setDragging(false), then clear the target. */
  endDrag(): void {
    this.canvas.setDragging(false);
    this.canvas.nodeInteractionLayer.target = null;
  }

  // ---- selection primitive --------------------------------------------------

  /** Set the live selection to the given ids and fire updateSelection. */
  select(ids: string[]): void {
    this.canvas.selection = new Set(ids.map((id) => ({ id })));
    this.canvas.updateSelection();
  }

  // ---- driver ops (US1 AC3) -------------------------------------------------

  /**
   * Drag a node to new coordinates. Fires the real drag signal bracket around the
   * geometry mutation. Selection is left NOT containing the node so drag-end emits
   * an interaction-END for it (matching US1 AC4).
   */
  driveDrag(nodeId: string, geo: { x: number; y: number }, opts: DriveOptions = {}): void {
    this.driveInteraction(nodeId, { x: geo.x, y: geo.y }, opts);
  }

  /**
   * Resize (and optionally reposition) a node. Same real signal bracket as a drag —
   * a resize is a node interaction (US1 AC3: "setDragging bracket for drag/resize").
   */
  driveResize(nodeId: string, geo: GeometryPatch, opts: DriveOptions = {}): void {
    this.driveInteraction(nodeId, geo, opts);
  }

  /**
   * Add a node structurally and pair it with a real selection signal (the new node
   * becomes selected, as it does on real creation).
   */
  driveAddNode(record: DoubleNodeRecord): void {
    this.double.upsertNode(record);
    this.canvas.requestFrame();
    this.select([record.id]);
  }

  /**
   * Add an edge structurally and pair it with a real selection signal (the new edge
   * becomes selected).
   */
  driveEdge(record: DoubleEdgeRecord): void {
    this.double.upsertEdge(record);
    this.canvas.requestFrame();
    this.select([record.id]);
  }

  /**
   * Delete a node, prune its incident (now-dangling) edges, and pair the structural
   * change with a real selection signal (selection collapses off the removed node).
   */
  driveDeleteNode(nodeId: string): { removedEdges: string[] } {
    const removedEdges = this.double.incidentEdgeIds(nodeId);
    for (const edgeId of removedEdges) this.double.removeEdge(edgeId);
    this.double.removeNode(nodeId);
    this.canvas.requestFrame();
    // Deselect the removed node (empty selection here) via the real signal.
    this.select([]);
    return { removedEdges };
  }

  /**
   * Edit a node's text. The node is selected while edited, so the change is paired
   * with the real selection signal.
   */
  driveTextEdit(nodeId: string, text: string): void {
    const node = this.double.getNode(nodeId);
    if (node) node.text = text;
    this.canvas.requestFrame();
    this.select([nodeId]);
  }

  // ---- shared drag/resize implementation ------------------------------------

  private driveInteraction(nodeId: string, geo: GeometryPatch, opts: DriveOptions): void {
    this.beginDrag(nodeId);
    const node = this.double.getNode(nodeId);
    if (node) {
      node.moveAndResize({
        x: geo.x ?? node.x,
        y: geo.y ?? node.y,
        width: geo.width ?? node.width,
        height: geo.height ?? node.height,
      });
    }
    if (opts.during) opts.during();
    this.endDrag();
  }
}
