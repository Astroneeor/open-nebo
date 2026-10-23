"use strict";
// Snap to grid: pure helpers. Only the "grid" and "dot" backgrounds have a lattice to snap to; the lattice
// spacing is whatever the background currently draws (it doubles when zoomed far out), so snapping matches
// what is on screen. Used for smart-shape points and for moving a selection.
(function (root) {
  const B = typeof module !== "undefined" && module.exports ? require("./backgrounds.js") : root.Backgrounds;

  /** Grid spacing in world units for `style` at `zoom`, or 0 when the background has no grid. */
  function step(style, zoom) {
    if (!style || (style.pattern !== "grid" && style.pattern !== "dot")) return 0;
    return B.spacing(style.pattern, zoom);
  }

  const round = (v, s) => (s > 0 ? Math.round(v / s) * s : v);
  const point = (p, s) => ({ ...p, x: round(p.x, s), y: round(p.y, s) });

  /**
   * Snap a recognised shape's `points` (see Shape in model.rs). Corner kinds snap every corner; an
   * ellipse snaps its centre and rounds its radii to whole cells (at least one). If snapping would merge
   * two corners the original points are returned, so a shape never collapses.
   */
  function shapePoints(kind, points, s) {
    if (!(s > 0)) return points;
    if (kind === "ellipse") {
      const [c, r] = points;
      return [[round(c[0], s), round(c[1], s)], [Math.max(s, round(r[0], s)), Math.max(s, round(r[1], s))]];
    }
    const out = points.map(([x, y]) => [round(x, s), round(y, s)]);
    const distinct = (list) => new Set(list.map((p) => p.join(","))).size;
    return distinct(out) < distinct(points) ? points : out;
  }

  /** Adjust a move of `box` by (dx, dy) so its top-left corner ends on the grid. */
  function delta(box, dx, dy, s) {
    if (!(s > 0)) return { dx, dy };
    return { dx: round(box.x + dx, s) - box.x, dy: round(box.y + dy, s) - box.y };
  }

  const api = { step, round, point, shapePoints, delta };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.Snap = api;
})(typeof window !== "undefined" ? window : globalThis);
