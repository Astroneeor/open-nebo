"use strict";
// Smart-shape recognition: pure geometry fitting, no ML, no DOM except drawShape(ctx).
//
// recognize(points) -> { kind, points } | null, where points is [{x, y}, ...] and the result
// matches the page-object shape stored by nebo-core (see model.rs `Shape`):
//   line / arrow  [[x1,y1],[x2,y2]]            arrow head at the second point
//   rect          4 corners in order           (rotated rectangles are kept rotated)
//   triangle      3 corners
//   ellipse       [[cx,cy],[rx,ry]]            axis-aligned; circles get rx == ry
(function (root) {
  const MIN_LEN = 40;          // strokes shorter than this (path length, px) are never snapped
  const HOLD_MS = 500;         // pen held still this long at the end of a stroke -> snap preview
  const HOLD_RADIUS = 4;       // px of movement that still counts as "held still"

  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  function pathLength(pts) {
    let l = 0;
    for (let i = 1; i < pts.length; i++) l += dist(pts[i - 1], pts[i]);
    return l;
  }

  function bbox(pts) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
  }

  // distance from p to the line through a,b (not the segment)
  function lineDev(p, a, b) {
    const l = dist(a, b);
    if (l === 0) return dist(p, a);
    return Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / l;
  }

  function segDist(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
    if (l2 === 0) return dist(p, a);
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  }

  // Ramer-Douglas-Peucker, returns the kept vertices (endpoints included).
  function rdp(pts, eps) {
    if (pts.length < 3) return pts.slice();
    const keep = new Uint8Array(pts.length);
    keep[0] = keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
      const [s, e] = stack.pop();
      let max = 0, idx = -1;
      for (let i = s + 1; i < e; i++) {
        const d = segDist(pts[i], pts[s], pts[e]);
        if (d > max) { max = d; idx = i; }
      }
      if (idx >= 0 && max > eps) { keep[idx] = 1; stack.push([s, idx], [idx, e]); }
    }
    return pts.filter((_, i) => keep[i]);
  }

  // Direction change (degrees, 0..180) at vertex b between a->b and b->c.
  function turn(a, b, c) {
    const a1 = Math.atan2(b.y - a.y, b.x - a.x), a2 = Math.atan2(c.y - b.y, c.x - b.x);
    let d = Math.abs(a2 - a1);
    if (d > Math.PI) d = 2 * Math.PI - d;
    return d * 180 / Math.PI;
  }

  // Cyclically drop vertices that are nearly straight until none remain.
  function pruneRing(v) {
    v = v.slice();
    for (;;) {
      if (v.length <= 3) return v;
      let worst = -1, min = 25;
      for (let i = 0; i < v.length; i++) {
        const t = turn(v[(i + v.length - 1) % v.length], v[i], v[(i + 1) % v.length]);
        if (t < min) { min = t; worst = i; }
      }
      if (worst < 0) return v;
      v.splice(worst, 1);
    }
  }

  function ringErr(pts, ring) {
    let sum = 0;
    for (const p of pts) {
      let m = Infinity;
      for (let i = 0; i < ring.length; i++) m = Math.min(m, segDist(p, ring[i], ring[(i + 1) % ring.length]));
      sum += m;
    }
    return sum / pts.length;
  }

  const xy = (p) => [p.x, p.y];

  function recognizeLine(pts, D) {
    const a = pts[0], b = pts[pts.length - 1], chord = dist(a, b);
    if (chord < MIN_LEN) return null;
    // measure meander on a simplified path so per-sample jitter does not inflate the length
    if (pathLength(rdp(pts, 0.03 * chord)) > chord * 1.2) return null;
    let dev = 0;
    for (const p of pts) dev = Math.max(dev, lineDev(p, a, b));
    if (dev > 0.07 * chord) return null;
    let e = { x: b.x, y: b.y }, s = { x: a.x, y: a.y };
    // snap near-horizontal / near-vertical lines
    const ang = Math.atan2(e.y - s.y, e.x - s.x) * 180 / Math.PI;
    const near = (t) => Math.abs(((ang - t + 540) % 360) - 180) < 3;
    if (near(0) || near(180)) e.y = s.y; else if (near(90) || near(-90)) e.x = s.x;
    return { kind: "line", points: [xy(s), xy(e)] };
  }

  // One-stroke arrow: straight shaft to the tip, then back out along two barbs.
  function recognizeArrow(pts, D) {
    const simp = rdp(pts, 0.05 * D);
    if (simp.length < 4) return null;
    const start = simp[0];
    let far = 0;
    for (const p of simp) far = Math.max(far, dist(start, p));
    // the pen returns to the tip between barbs, so take the first vertex that is (nearly) farthest
    let k = 1;
    while (dist(start, simp[k]) < 0.92 * far) k++;
    const tip = simp[k], shaft = dist(start, tip);
    if (shaft < MIN_LEN) return null;
    for (let i = 1; i < k; i++) if (lineDev(simp[i], start, tip) > 0.08 * shaft) return null;
    const barbs = simp.slice(k + 1).filter((p) => dist(p, tip) > 0.08 * shaft);
    if (barbs.length < 2) return null;
    const back = Math.atan2(start.y - tip.y, start.x - tip.x);
    const sides = new Set();
    for (const p of barbs) {
      const d = dist(p, tip);
      if (d > 0.6 * shaft) return null;
      let rel = Math.atan2(p.y - tip.y, p.x - tip.x) - back;
      rel = Math.atan2(Math.sin(rel), Math.cos(rel));
      const deg = Math.abs(rel) * 180 / Math.PI;
      if (deg < 10 || deg > 70) return null;
      sides.add(Math.sign(rel));
    }
    if (sides.size < 2) return null;
    return { kind: "arrow", points: [xy(start), xy(tip)] };
  }

  function recognizeRect(ring) {
    for (let i = 0; i < 4; i++) {
      const t = turn(ring[(i + 3) % 4], ring[i], ring[(i + 1) % 4]);
      if (t < 60 || t > 120) return null;
    }
    let li = 0;
    for (let i = 1; i < 4; i++) if (dist(ring[i], ring[(i + 1) % 4]) > dist(ring[li], ring[(li + 1) % 4])) li = i;
    const e = ring[(li + 1) % 4], s = ring[li];
    let th = Math.atan2(e.y - s.y, e.x - s.x) * 180 / Math.PI;
    th = ((th % 90) + 90) % 90;
    if (th < 8 || th > 82) th = 0;
    const r = th * Math.PI / 180, u = { x: Math.cos(r), y: Math.sin(r) }, v = { x: -Math.sin(r), y: Math.cos(r) };
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const p of ring) {
      const a = p.x * u.x + p.y * u.y, b = p.x * v.x + p.y * v.y;
      u0 = Math.min(u0, a); u1 = Math.max(u1, a); v0 = Math.min(v0, b); v1 = Math.max(v1, b);
    }
    let w = u1 - u0, h = v1 - v0;
    if (Math.abs(w - h) / Math.max(w, h) < 0.1) { // square
      const m = (w + h) / 2, cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
      u0 = cu - m / 2; u1 = cu + m / 2; v0 = cv - m / 2; v1 = cv + m / 2;
    }
    const at = (a, b) => [a * u.x + b * v.x, a * u.y + b * v.y];
    return { kind: "rect", points: [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)] };
  }

  function recognizeEllipse(pts) {
    const bb = bbox(pts);
    const cx = (bb.x0 + bb.x1) / 2, cy = (bb.y0 + bb.y1) / 2;
    let rx = bb.w / 2, ry = bb.h / 2;
    if (rx < 8 || ry < 8) return null;
    let err = 0, swept = 0, prev = null;
    for (const p of pts) {
      err += Math.abs(Math.hypot((p.x - cx) / rx, (p.y - cy) / ry) - 1);
      const a = Math.atan2(p.y - cy, p.x - cx);
      if (prev !== null) { let d = a - prev; d = Math.atan2(Math.sin(d), Math.cos(d)); swept += d; }
      prev = a;
    }
    err /= pts.length;
    if (Math.abs(swept) < 5.2) return null;
    if (Math.abs(rx - ry) / Math.max(rx, ry) < 0.12) rx = ry = (rx + ry) / 2;
    return { err, shape: { kind: "ellipse", points: [[cx, cy], [rx, ry]] } };
  }

  const POLY_TOL = 0.035;     // mean distance to polygon / bbox diagonal
  const ELLIPSE_TOL = 0.12;   // mean |normalised radius - 1|

  function recognize(input) {
    const pts = [];
    for (const p of input) if (!pts.length || dist(p, pts[pts.length - 1]) >= 1) pts.push({ x: p.x, y: p.y });
    if (pts.length < 4) return null;
    const L = pathLength(pts);
    if (L < MIN_LEN) return null;
    const bb = bbox(pts), D = Math.hypot(bb.w, bb.h);
    if (D < 1) return null;

    const gap = dist(pts[0], pts[pts.length - 1]);
    if (gap >= 0.22 * L) return recognizeArrow(pts, D) || recognizeLine(pts, D);

    // closed stroke: polygon (triangle / rectangle) or ellipse, whichever fits better
    let v = rdp(pts, 0.06 * D);
    v.pop(); // the closing vertex coincides with (or overshoots) the start
    const ring = pruneRing(v);
    let best = null, bestScore = 1;
    if (ring.length === 3 || ring.length === 4) {
      const score = ringErr(pts, ring) / D / POLY_TOL;
      let shape = null;
      if (ring.length === 3) {
        const per = dist(ring[0], ring[1]) + dist(ring[1], ring[2]) + dist(ring[2], ring[0]);
        const min = Math.min(dist(ring[0], ring[1]), dist(ring[1], ring[2]), dist(ring[2], ring[0]));
        if (min > 0.12 * per) shape = { kind: "triangle", points: ring.map(xy) };
      } else {
        shape = recognizeRect(ring);
      }
      if (shape && score < bestScore) { best = shape; bestScore = score; }
    }
    const el = recognizeEllipse(pts);
    if (el && el.err / ELLIPSE_TOL < bestScore) best = el.shape;
    return best;
  }

  // ---- rendering and hit-testing for stored shape objects ----

  function drawShape(ctx, s) {
    const P = s.points;
    ctx.strokeStyle = s.color; ctx.lineWidth = s.width; ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.beginPath();
    if (s.kind === "ellipse") {
      ctx.ellipse(P[0][0], P[0][1], P[1][0], P[1][1], 0, 0, Math.PI * 2);
    } else if (s.kind === "line" || s.kind === "arrow") {
      ctx.moveTo(P[0][0], P[0][1]); ctx.lineTo(P[1][0], P[1][1]);
      if (s.kind === "arrow") {
        const a = Math.atan2(P[0][1] - P[1][1], P[0][0] - P[1][0]);
        const len = Math.min(Math.max(14, s.width * 5), 0.4 * Math.hypot(P[1][0] - P[0][0], P[1][1] - P[0][1]));
        for (const d of [0.5, -0.5]) {
          ctx.moveTo(P[1][0], P[1][1]);
          ctx.lineTo(P[1][0] + len * Math.cos(a + d), P[1][1] + len * Math.sin(a + d));
        }
      }
    } else {
      P.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])));
      ctx.closePath();
    }
    ctx.stroke();
  }

  // True if point p is within r (plus half the line width) of the shape's outline.
  function hitShape(s, p, r) {
    const P = s.points, tol = r + s.width / 2;
    if (s.kind === "ellipse") {
      const rx = P[1][0], ry = P[1][1];
      const n = Math.hypot((p.x - P[0][0]) / rx, (p.y - P[0][1]) / ry);
      return Math.abs(n - 1) * Math.min(rx, ry) < tol;
    }
    const closed = s.kind === "rect" || s.kind === "triangle";
    const m = closed ? P.length : P.length - 1;
    for (let i = 0; i < m; i++) {
      const a = P[i], b = P[(i + 1) % P.length];
      if (segDist(p, { x: a[0], y: a[1] }, { x: b[0], y: b[1] }) < tol) return true;
    }
    return false;
  }

  const api = { recognize, drawShape, hitShape, rdp, HOLD_MS, HOLD_RADIUS };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.Shapes = api;
})(typeof window !== "undefined" ? window : globalThis);
