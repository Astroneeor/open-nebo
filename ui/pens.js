"use strict";
// Pen kinds and the partial ("point") eraser: pure helpers, no DOM. A stroke's `kind` is omitted for the plain
// pressure pen, so old documents render exactly as before.
(function (root) {
  const STYLES = {
    pen:         { label: "Pen",         icon: "pen",         width: 2,  pressure: 1.2, minP: 0.4, alpha: 1,    cap: "round", single: false, grain: false },
    highlighter: { label: "Highlighter", icon: "highlighter", width: 14, pressure: 0,   minP: 1,   alpha: 0.35, cap: "butt",  single: true,  grain: false },
    pencil:      { label: "Pencil",      icon: "pencil",      width: 1,  pressure: 0.5, minP: 0.75, alpha: 0.85, cap: "round", single: false, grain: true },
    marker:      { label: "Marker",      icon: "marker",      width: 5,  pressure: 0,   minP: 1,   alpha: 1,    cap: "round", single: false, grain: false },
  };
  const KINDS = Object.keys(STYLES);
  const ERASERS = {
    stroke:      { label: "Stroke eraser",       icon: "eraser" },
    point:       { label: "Point eraser",        icon: "scissors" },
    highlighter: { label: "Highlighter eraser",  icon: "highlighter" },
  };
  const ERASER_MODES = Object.keys(ERASERS);

  const kindOf = (s) => (s && STYLES[s.kind] ? s.kind : "pen");
  const style = (s) => STYLES[kindOf(s)];
  /** Opacity a stroke renders with: its own, else its kind's default. */
  const opacityOf = (s) => (typeof s.opacity === "number" ? s.opacity : style(s).alpha);
  /** Line width at pressure p (0..1). For the plain pen this is the original 0.4 + 1.2 p curve. */
  const widthAt = (s, p) => s.width * (style(s).minP + style(s).pressure * p);
  /** Fields a new stroke of `kind` records (nothing extra for the plain pen). */
  function newFields(kind) {
    if (!STYLES[kind] || kind === "pen") return {};
    return kind === "highlighter" ? { kind, opacity: STYLES.highlighter.alpha } : { kind };
  }

  const segDist = (p, a, b) => {
    const dx = b.x - a.x, dy = b.y - a.y, l = dx * dx + dy * dy;
    const t = l ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l)) : 0;
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  };

  /**
   * Remove the part of `stroke` inside the circle (c, r). Returns null when untouched, else an array of
   * replacement strokes (possibly empty) with new ids from `newId()`, keeping kind/color/width/opacity.
   */
  function splitStroke(stroke, c, r, newId) {
    const pts = stroke.points, n = pts.length;
    if (!n) return null;
    const bad = pts.map((q) => Math.hypot(q.x - c.x, q.y - c.y) < r);
    const cut = []; // cut[i]: segment i-1..i is crossed although both ends are outside
    for (let i = 1; i < n; i++) cut[i] = !bad[i] && !bad[i - 1] && segDist(c, pts[i - 1], pts[i]) < r;
    if (!bad.some(Boolean) && !cut.some(Boolean)) return null;
    const runs = []; let run = [];
    for (let i = 0; i < n; i++) {
      if (bad[i]) { if (run.length) runs.push(run); run = []; continue; }
      if (cut[i] && run.length) { runs.push(run); run = []; }
      run.push(pts[i]);
    }
    if (run.length) runs.push(run);
    return runs.map((points) => ({ ...stroke, id: newId(), points }));
  }

  /**
   * Apply an eraser at world point `p`, radius `r` to a stroke list. mode: stroke | point | highlighter.
   * Returns a new list, or null when nothing changed.
   */
  function eraseStrokes(strokes, p, r, mode, newId, editable) {
    const out = []; let changed = false;
    for (const s of strokes) {
      if (editable && !editable(s)) { out.push(s); continue; } // hidden/locked layers are untouchable
      if (mode === "point") {
        const parts = splitStroke(s, p, r, newId);
        if (parts) { changed = true; out.push(...parts); } else out.push(s);
        continue;
      }
      if (mode === "highlighter" && kindOf(s) !== "highlighter") { out.push(s); continue; }
      if (s.points.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < r + s.width)) changed = true; else out.push(s);
    }
    return changed ? out : null;
  }

  const api = { STYLES, KINDS, ERASERS, ERASER_MODES, kindOf, style, opacityOf, widthAt, newFields, splitStroke, eraseStrokes };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.Pens = api;
})(typeof window !== "undefined" ? window : globalThis);
