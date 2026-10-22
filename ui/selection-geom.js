"use strict";
// Pure geometry for lasso selection. No DOM; also loadable from node for tests.
// Boxes are { x, y, w, h }. A transform is { ox, oy, sx, sy, dx, dy }: scale about (ox, oy), then translate.
const Geom = (() => {
  function pointInPolygon(p, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }

  function bounds(points) {
    if (!points.length) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of points) {
      if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
      if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  const pad = (b, r) => ({ x: b.x - r, y: b.y - r, w: b.w + 2 * r, h: b.h + 2 * r });
  const strokeBounds = (s) => (s.points.length ? pad(bounds(s.points), (s.width || 2) / 2) : null);

  function unionBounds(boxes) {
    const bs = boxes.filter(Boolean);
    if (!bs.length) return null;
    const x0 = Math.min(...bs.map((b) => b.x)), y0 = Math.min(...bs.map((b) => b.y));
    const x1 = Math.max(...bs.map((b) => b.x + b.w)), y1 = Math.max(...bs.map((b) => b.y + b.h));
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  const boxCenter = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
  const inBox = (p, b) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
  const rectPolygon = (a, b) => [{ x: a.x, y: a.y }, { x: b.x, y: a.y }, { x: b.x, y: b.y }, { x: a.x, y: b.y }];

  function distToSegment(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  }

  function nearPolyline(p, pts, tol) {
    if (pts.length === 1) return Math.hypot(p.x - pts[0].x, p.y - pts[0].y) <= tol;
    for (let i = 1; i < pts.length; i++) if (distToSegment(p, pts[i - 1], pts[i]) <= tol) return true;
    return false;
  }

  function fractionInside(points, poly) {
    if (!points.length) return 0;
    let n = 0;
    for (const p of points) if (pointInPolygon(p, poly)) n++;
    return n / points.length;
  }

  const translate = (dx, dy) => ({ ox: 0, oy: 0, sx: 1, sy: 1, dx, dy });
  const scaleAbout = (ox, oy, s) => ({ ox, oy, sx: s, sy: s, dx: 0, dy: 0 });
  // axis "h" mirrors left-right, "v" mirrors top-bottom, both about the centre of box b.
  function flipAbout(b, axis) {
    const c = boxCenter(b);
    return { ox: c.x, oy: c.y, sx: axis === "h" ? -1 : 1, sy: axis === "v" ? -1 : 1, dx: 0, dy: 0 };
  }

  const transformPoint = (p, t) => ({ x: t.ox + (p.x - t.ox) * t.sx + t.dx, y: t.oy + (p.y - t.oy) * t.sy + t.dy });

  function transformBox(b, t) {
    const a = transformPoint({ x: b.x, y: b.y }, t), c = transformPoint({ x: b.x + b.w, y: b.y + b.h }, t);
    return { x: Math.min(a.x, c.x), y: Math.min(a.y, c.y), w: Math.abs(c.x - a.x), h: Math.abs(c.y - a.y) };
  }

  // Uniform scale factor for dragging corner `c0` (original position) to `p` while the opposite corner `anchor` stays put.
  function cornerScale(anchor, c0, p, min = 0.05) {
    const vx = c0.x - anchor.x, vy = c0.y - anchor.y, len2 = vx * vx + vy * vy;
    if (!len2) return 1;
    return Math.max(min, ((p.x - anchor.x) * vx + (p.y - anchor.y) * vy) / len2);
  }

  return { pointInPolygon, bounds, strokeBounds, unionBounds, boxCenter, inBox, rectPolygon, distToSegment,
           nearPolyline, fractionInside, translate, scaleAbout, flipAbout, transformPoint, transformBox, cornerScale };
})();
if (typeof module !== "undefined" && module.exports) module.exports = Geom;
