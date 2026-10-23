"use strict";
// Run with: node --test ui/spatial.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const Sp = require("./spatial.js");

const stroke = (id, x, y, len = 10, width = 2) => ({ id, width, points: Array.from({ length: 5 }, (_, i) => ({ x: x + (i * len) / 4, y: y + (i * len) / 4 })) });
const R = (x, y, w, h) => ({ x, y, w, h });

function bigPage(n) {
  const strokes = [];
  const side = Math.ceil(Math.sqrt(n));
  for (let i = 0; i < n; i++) strokes.push(stroke("s" + i, (i % side) * 20, Math.floor(i / side) * 20, 8));
  return { id: "p", strokes, objects: [] };
}

test("query returns intersecting items in original draw order", () => {
  const pg = { strokes: [stroke("a", 500, 500), stroke("b", 0, 0), stroke("c", 5, 5), stroke("d", 900, 0)], objects: [] };
  const r = Sp.query(pg, R(-10, -10, 60, 60));
  assert.deepEqual(r.strokes.map((s) => s.id), ["b", "c"]);
});

test("stroke bounds are padded by width/2", () => {
  const pg = { strokes: [stroke("a", 100, 100, 0, 20)], objects: [] }; // degenerate point cloud, half-width 10
  assert.equal(Sp.query(pg, R(85, 85, 10, 10)).strokes.length, 1);
  assert.equal(Sp.query(pg, R(60, 60, 10, 10)).strokes.length, 0);
});

test("objects (image, shape, text, graph) are indexed via objectBox", () => {
  const pg = { strokes: [], objects: [
    { id: "i", type: "image", x: 1000, y: 1000, w: 50, h: 50 },
    { id: "sh", type: "shape", kind: "line", width: 2, points: [[0, 0], [30, 30]] },
    { id: "t", type: "text", x: 400, y: 400, w: 100, size: 16, text: "hi" },
    { id: "g", type: "graph", x: 2000, y: 2000, size: 100, xmin: -1, xmax: 1, ymin: -1, ymax: 1 },
  ] };
  assert.deepEqual(Sp.query(pg, R(990, 990, 100, 100)).objects.map((o) => o.id), ["i"]);
  assert.deepEqual(Sp.query(pg, R(0, 0, 50, 50)).objects.map((o) => o.id), ["sh"]);
  assert.deepEqual(Sp.query(pg, R(405, 405, 10, 10)).objects.map((o) => o.id), ["t"]);
  assert.deepEqual(Sp.query(pg, R(2010, 2010, 10, 10)).objects.map((o) => o.id), ["g"]);
});

test("added, removed, replaced and edited-in-place items are noticed", () => {
  const pg = { strokes: [stroke("a", 0, 0)], objects: [] };
  assert.equal(Sp.query(pg, R(0, 0, 20, 20)).strokes.length, 1);
  pg.strokes.push(stroke("b", 5, 5));
  assert.equal(Sp.query(pg, R(0, 0, 20, 20)).strokes.length, 2, "push");
  pg.strokes = pg.strokes.filter((s) => s.id !== "a"); // History / eraser replace the array
  assert.deepEqual(Sp.query(pg, R(0, 0, 20, 20)).strokes.map((s) => s.id), ["b"], "replace");
  for (const p of pg.strokes[0].points) { p.x += 1000; p.y += 1000; } // in-place move (selection drag)
  assert.equal(Sp.query(pg, R(0, 0, 20, 20)).strokes.length, 0, "moved away");
  assert.equal(Sp.query(pg, R(1000, 1000, 40, 40)).strokes.length, 1, "moved here");
  pg.strokes.splice(0, 1, stroke("z", 0, 0)); // same length, different item
  assert.deepEqual(Sp.query(pg, R(0, 0, 20, 20)).strokes.map((s) => s.id), ["z"]);
});

test("invalidate forces a rebuild; trust skips per-item revalidation", () => {
  const pg = { strokes: [stroke("a", 0, 0)], objects: [] };
  Sp.query(pg, R(0, 0, 20, 20));
  pg.strokes[0].points.forEach((p) => { p.x += 5000; });
  assert.equal(Sp.query(pg, R(0, 0, 20, 20), { trust: true }).strokes.length, 1, "stale by design under trust");
  Sp.invalidate(pg);
  assert.equal(Sp.query(pg, R(0, 0, 20, 20), { trust: true }).strokes.length, 0);
});

test("very large items (bigger than the cell budget) are still found", () => {
  const pg = { strokes: [{ id: "huge", width: 2, points: [{ x: 0, y: 0 }, { x: 100000, y: 100000 }] }], objects: [] };
  assert.equal(Sp.query(pg, R(50000, 50000, 10, 10)).strokes.length, 1);
  assert.equal(Sp.query(pg, R(500, 90000, 10, 10)).strokes.length, 1); // bbox hit (index is bbox-based)
});

test("50k strokes: a viewport query touches a tiny fraction and matches a brute-force scan", () => {
  const pg = bigPage(50000);
  const rect = R(1000, 1000, 800, 600);
  const stats = { touched: 0 };
  const r = Sp.query(pg, rect, { stats });
  const brute = pg.strokes.filter((s) => s.points.some(() => true) && (() => {
    const xs = s.points.map((p) => p.x), ys = s.points.map((p) => p.y), h = s.width / 2;
    return Math.min(...xs) - h <= rect.x + rect.w && Math.max(...xs) + h >= rect.x && Math.min(...ys) - h <= rect.y + rect.h && Math.max(...ys) + h >= rect.y;
  })());
  assert.deepEqual(r.strokes.map((s) => s.id), brute.map((s) => s.id));
  assert.ok(r.strokes.length > 100);
  assert.ok(stats.touched < pg.strokes.length / 10, `touched ${stats.touched} of ${pg.strokes.length}`);
  const t2 = { touched: 0 };
  Sp.query(pg, rect, { stats: t2, trust: true });
  assert.ok(t2.touched < 5000 && t2.touched >= r.strokes.length);
});

test("level of detail: tiny strokes skipped, small zoomed-out strokes decimated, ends kept", () => {
  assert.equal(Sp.visibleAtZoom({ x: 0, y: 0, w: 10, h: 10 }, 0.1), false);
  assert.equal(Sp.visibleAtZoom({ x: 0, y: 0, w: 10, h: 10 }, 1), true);
  const box = { x: 0, y: 0, w: 100, h: 100 };
  assert.equal(Sp.lodStep(box, 100, 1), 1);
  assert.equal(Sp.lodStep(box, 100, 0.1), 5);
  assert.equal(Sp.lodStep(box, 6, 0.1), 1, "short strokes untouched");
  assert.equal(Sp.lodStep({ x: 0, y: 0, w: 2000, h: 5 }, 100, 0.1), 1, "large on screen: full detail");
  const pts = Array.from({ length: 23 }, (_, i) => ({ x: i, y: 0 }));
  const d = Sp.decimate(pts, 5);
  assert.equal(d[0], pts[0]); assert.equal(d[d.length - 1], pts[22]);
  assert.ok(d.length < pts.length);
  assert.equal(Sp.decimate(pts, 1), pts);
});

test("viewRect grows by a screen-pixel margin", () => {
  assert.deepEqual(Sp.viewRect(100, 100, 2, 800, 600, 64), { x: 68, y: 68, w: 464, h: 364 });
});
