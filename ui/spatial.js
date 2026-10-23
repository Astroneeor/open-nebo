"use strict";
// Per-page uniform-grid spatial index for viewport culling. Pure (no DOM); also loadable from node.
// Items are strokes (bounds from points, padded by width/2) and objects (Geom.objectBox). query() returns the
// items whose cached bounds intersect a rect, in original array (= draw) order.
// Cache is keyed by page object and revalidated cheaply: array identity + length, plus (unless `trust`) a
// per-item numeric signature, so in-place edits (move/resize/erase-replace/History restore) are noticed.
const Spatial = (() => {
  const G = typeof Geom !== "undefined" ? Geom : typeof require !== "undefined" ? require("./selection-geom.js") : null;
  const CELL = 256, BIG_CELLS = 64, OFF = 1 << 20, SPAN = 1 << 21;
  const cellKey = (cx, cy) => (cx + OFF) * SPAN + (cy + OFF);

  function strokeSig(s) {
    const p = s.points, n = p.length;
    if (!n) return 0;
    const a = p[0], b = p[n - 1], m = p[n >> 1];
    return n * 1.000003 + a.x * 1.7 + a.y * 2.3 + b.x * 3.1 + b.y * 4.7 + m.x * 5.3 + m.y * 6.1 + (s.width || 0) * 7.9;
  }
  function objSig(o) {
    let h = (o.x || 0) * 1.7 + (o.y || 0) * 2.3 + (o.w || 0) * 3.1 + (o.h || 0) * 4.7 + (o.size || 0) * 5.3 + (o.width || 0) * 6.1;
    if (o.points) { h += o.points.length * 7.7; for (const p of o.points) h += Array.isArray(p) ? p[0] * 0.31 + p[1] * 0.17 : 0; }
    if (typeof o.text === "string") h += o.text.length * 8.9;
    if (o.xmin !== undefined) h += o.xmin + o.xmax * 1.3 + o.ymin * 1.7 + o.ymax * 1.9;
    return h;
  }
  const strokeBox = (s) => (s.points && s.points.length ? G.strokeBounds(s) : null);
  const objBox = (o) => { try { return G.objectBox(o); } catch (_) { return null; } };

  // One grid over one array.
  function makeGrid(items, boxOf, sigOf) {
    const g = { items, len: items.length, boxes: new Array(items.length), sigs: new Float64Array(items.length), cells: new Map(), big: [], stamp: new Uint32Array(items.length), tick: 0 };
    for (let i = 0; i < items.length; i++) { g.boxes[i] = boxOf(items[i]); g.sigs[i] = sigOf(items[i]); insert(g, i); }
    return g;
  }
  function insert(g, i) {
    const b = g.boxes[i];
    if (!b) return;
    const x0 = Math.floor(b.x / CELL), x1 = Math.floor((b.x + b.w) / CELL), y0 = Math.floor(b.y / CELL), y1 = Math.floor((b.y + b.h) / CELL);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > BIG_CELLS) { g.big.push(i); return; }
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
      const k = cellKey(cx, cy);
      let c = g.cells.get(k);
      if (!c) g.cells.set(k, c = []);
      c.push(i);
    }
  }
  // Does the cache still describe `items`? Returns false when the grid must be rebuilt.
  function valid(g, items, sigOf, trust) {
    if (g.items !== items || g.len !== items.length) return false;
    if (!trust) for (let i = 0; i < items.length; i++) if (sigOf(items[i]) !== g.sigs[i]) return false;
    return true;
  }
  function queryGrid(g, r, stats) {
    const x0 = Math.floor(r.x / CELL), x1 = Math.floor((r.x + r.w) / CELL), y0 = Math.floor(r.y / CELL), y1 = Math.floor((r.y + r.h) / CELL);
    const tick = ++g.tick, hit = [];
    const test = (i) => {
      if (g.stamp[i] === tick) return;
      g.stamp[i] = tick;
      if (stats) stats.touched++;
      const b = g.boxes[i];
      if (b && b.x <= r.x + r.w && b.x + b.w >= r.x && b.y <= r.y + r.h && b.y + b.h >= r.y) hit.push(i);
    };
    const nCells = (x1 - x0 + 1) * (y1 - y0 + 1);
    if (nCells > g.cells.size) { for (const c of g.cells.values()) for (const i of c) test(i); } // huge rect: walk occupied cells instead
    else for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) { const c = g.cells.get(cellKey(cx, cy)); if (c) for (const i of c) test(i); }
    for (const i of g.big) test(i);
    hit.sort((a, b) => a - b);
    return hit;
  }

  const pages = new WeakMap(); // page -> { s: grid, o: grid }
  const touchStats = { touched: 0 };

  /** Items of `pg` whose bounds intersect rect {x,y,w,h}, in draw order: { strokes, objects, ids }.
   *  opts.trust skips per-item revalidation (use while nothing can be editing, e.g. mid pan/zoom).
   *  opts.stats ({touched}) accumulates how many candidate items were bounds-tested. */
  function query(pg, rect, opts) {
    const o = opts || {};
    let e = pages.get(pg);
    if (!e) pages.set(pg, e = {});
    const strokes = pg.strokes || [], objects = pg.objects || [];
    if (!e.s || !valid(e.s, strokes, strokeSig, o.trust)) e.s = makeGrid(strokes, strokeBox, strokeSig);
    if (!e.o || !valid(e.o, objects, objSig, o.trust)) e.o = makeGrid(objects, objBox, objSig);
    const st = o.stats || touchStats;
    const si = queryGrid(e.s, rect, st), oi = queryGrid(e.o, rect, st);
    return { strokes: si.map((i) => strokes[i]), objects: oi.map((i) => objects[i]),
             strokeBoxes: si.map((i) => e.s.boxes[i]) };
  }
  /** Drop a page's cache (rarely needed: query revalidates itself). */
  function invalidate(pg) { pages.delete(pg); }

  // ---- level of detail (pure) ----
  const MIN_SCREEN_PX = 1.5, SMALL_PX = 80;
  /** Skip strokes smaller than ~1.5 screen px. `box` is the padded stroke bounds. */
  const visibleAtZoom = (box, zoom) => !!box && Math.max(box.w, box.h) * zoom >= MIN_SCREEN_PX;
  /** Every-Nth-point step for a stroke: 1 unless zoomed out and the stroke is small on screen. Keeps >= 8 points. */
  function lodStep(box, npts, zoom) {
    if (!box || npts <= 8 || zoom >= 0.5 || Math.max(box.w, box.h) * zoom > SMALL_PX) return 1;
    return Math.max(1, Math.min(Math.floor(0.5 / zoom), Math.floor((npts - 1) / 7)));
  }
  /** Every `step`th point, always keeping first and last. */
  function decimate(pts, step) {
    if (step <= 1 || pts.length <= 2) return pts;
    const out = [];
    for (let i = 0; i < pts.length; i += step) out.push(pts[i]);
    if (out[out.length - 1] !== pts[pts.length - 1]) out.push(pts[pts.length - 1]);
    return out;
  }

  /** Visible world rect for a viewport {x,y,zoom} and canvas CSS size, grown by `margin` screen px. */
  function viewRect(x, y, zoom, cssW, cssH, margin) {
    const m = (margin == null ? 64 : margin) / zoom;
    return { x: x - m, y: y - m, w: cssW / zoom + 2 * m, h: cssH / zoom + 2 * m };
  }

  const api = { CELL, query, invalidate, visibleAtZoom, lodStep, decimate, viewRect, MIN_SCREEN_PX };
  if (typeof window !== "undefined") window.Spatial = api;
  return api;
})();
if (typeof module !== "undefined" && module.exports) module.exports = Spatial;
