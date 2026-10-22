"use strict";
// Run with: node --test ui/selection-geom.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("./selection-geom.js");

const sq = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test("pointInPolygon: inside, outside, concave notch", () => {
  assert.equal(G.pointInPolygon({ x: 5, y: 5 }, sq), true);
  assert.equal(G.pointInPolygon({ x: 11, y: 5 }, sq), false);
  const u = [{ x: 0, y: 0 }, { x: 9, y: 0 }, { x: 9, y: 9 }, { x: 6, y: 9 }, { x: 6, y: 3 }, { x: 3, y: 3 }, { x: 3, y: 9 }, { x: 0, y: 9 }];
  assert.equal(G.pointInPolygon({ x: 4, y: 6 }, u), false, "inside the notch");
  assert.equal(G.pointInPolygon({ x: 1, y: 6 }, u), true);
  assert.equal(G.pointInPolygon({ x: 1, y: 1 }, []), false);
});

test("bounds / strokeBounds / unionBounds", () => {
  assert.equal(G.bounds([]), null);
  assert.deepEqual(G.bounds([{ x: 2, y: 5 }, { x: -1, y: 9 }]), { x: -1, y: 5, w: 3, h: 4 });
  assert.deepEqual(G.strokeBounds({ width: 4, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }), { x: -2, y: -2, w: 14, h: 4 });
  assert.deepEqual(G.unionBounds([{ x: 0, y: 0, w: 2, h: 2 }, null, { x: 5, y: -1, w: 1, h: 1 }]), { x: 0, y: -1, w: 6, h: 3 });
  assert.equal(G.unionBounds([null]), null);
});

test("rectPolygon works for any drag direction", () => {
  const poly = G.rectPolygon({ x: 10, y: 10 }, { x: 0, y: 0 });
  assert.equal(G.pointInPolygon({ x: 5, y: 5 }, poly), true);
  assert.equal(G.pointInPolygon({ x: 15, y: 5 }, poly), false);
});

test("nearPolyline / distToSegment", () => {
  const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }];
  close(G.distToSegment({ x: 5, y: 3 }, pts[0], pts[1]), 3);
  close(G.distToSegment({ x: 13, y: 4 }, pts[0], pts[1]), 5, "clamps to the endpoint");
  assert.equal(G.nearPolyline({ x: 5, y: 2 }, pts, 2.5), true);
  assert.equal(G.nearPolyline({ x: 5, y: 4 }, pts, 2.5), false);
  assert.equal(G.nearPolyline({ x: 1, y: 1 }, [{ x: 0, y: 0 }], 2), true, "single-point stroke (a dot)");
  close(G.distToSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 }), 5, "zero-length segment");
});

test("fractionInside", () => {
  const pts = [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 20, y: 20 }, { x: 30, y: 30 }];
  close(G.fractionInside(pts, sq), 0.5);
  assert.equal(G.fractionInside([], sq), 0);
});

test("transformPoint: translate, scale about a point, flip", () => {
  assert.deepEqual(G.transformPoint({ x: 1, y: 2 }, G.translate(3, -1)), { x: 4, y: 1 });
  assert.deepEqual(G.transformPoint({ x: 4, y: 4 }, G.scaleAbout(2, 2, 2)), { x: 6, y: 6 });
  assert.deepEqual(G.transformPoint({ x: 2, y: 2 }, G.scaleAbout(2, 2, 3)), { x: 2, y: 2 }, "anchor is fixed");
  const box = { x: 0, y: 0, w: 10, h: 4 };
  assert.deepEqual(G.transformPoint({ x: 1, y: 1 }, G.flipAbout(box, "h")), { x: 9, y: 1 });
  assert.deepEqual(G.transformPoint({ x: 1, y: 1 }, G.flipAbout(box, "v")), { x: 1, y: 3 });
});

test("flip twice is the identity", () => {
  const box = { x: -3, y: 2, w: 8, h: 6 }, p = { x: 1.5, y: 7 };
  for (const axis of ["h", "v"]) {
    const t = G.flipAbout(box, axis);
    const q = G.transformPoint(G.transformPoint(p, t), t);
    close(q.x, p.x); close(q.y, p.y);
  }
});

test("transformBox normalises flipped boxes", () => {
  const b = { x: 0, y: 0, w: 10, h: 4 };
  assert.deepEqual(G.transformBox(b, G.flipAbout({ x: 0, y: 0, w: 20, h: 4 }, "h")), { x: 10, y: 0, w: 10, h: 4 });
  assert.deepEqual(G.transformBox(b, G.scaleAbout(0, 0, 2)), { x: 0, y: 0, w: 20, h: 8 });
  assert.deepEqual(G.transformBox(b, G.translate(5, 5)), { x: 5, y: 5, w: 10, h: 4 });
});

test("cornerScale: drag SE corner away from NW anchor", () => {
  const a = { x: 0, y: 0 }, c = { x: 10, y: 10 };
  close(G.cornerScale(a, c, { x: 20, y: 20 }), 2);
  close(G.cornerScale(a, c, { x: 5, y: 5 }), 0.5);
  close(G.cornerScale(a, c, { x: -50, y: -50 }), 0.05, "clamped, never flips");
  assert.equal(G.cornerScale(a, a, { x: 3, y: 3 }), 1, "degenerate corner");
});

test("scale then inverse scale restores points", () => {
  const anchor = { x: 3, y: 4 }, p = { x: 9, y: -2 };
  const q = G.transformPoint(G.transformPoint(p, G.scaleAbout(anchor.x, anchor.y, 2.5)), G.scaleAbout(anchor.x, anchor.y, 1 / 2.5));
  close(q.x, p.x); close(q.y, p.y);
});

// ---------- graph / shape objects ----------
const gr = { type: "graph", id: "g", x: 10, y: 20, size: 200, xmin: -5, xmax: 5, ymin: -5, ymax: 5 };
const ell = { type: "shape", id: "e", kind: "ellipse", width: 2, points: [[100, 100], [40, 20]] };
const tri = { type: "shape", id: "t", kind: "triangle", width: 2, points: [[0, 0], [100, 0], [50, 80]] };
const plain = (x) => JSON.parse(JSON.stringify(x));

test("objectBox covers images, graphs (aspect follows axis ranges) and shapes (padded by half the width)", () => {
  assert.deepEqual(plain(G.objectBox({ type: "image", x: 1, y: 2, w: 3, h: 4 })), { x: 1, y: 2, w: 3, h: 4 });
  assert.deepEqual(plain(G.objectBox({ ...gr, ymax: 15 })), { x: 10, y: 20, w: 200, h: 400 });
  assert.deepEqual(plain(G.objectBox(ell)), { x: 59, y: 79, w: 82, h: 42 });
  assert.deepEqual(plain(G.objectBox(tri)), { x: -1, y: -1, w: 102, h: 82 });
});

test("transformObject translates and scales graphs, shapes and images", () => {
  const sc = G.scaleAbout(10, 20, 2);
  assert.deepEqual(plain(G.transformObject(gr, sc)), { x: 10, y: 20, size: 400 });
  assert.deepEqual(plain(G.transformObject(ell, sc)), { points: [[190, 180], [80, 40]] });
  assert.deepEqual(plain(G.transformObject(tri, G.translate(5, 5))), { points: [[5, 5], [105, 5], [55, 85]] });
  assert.deepEqual(plain(G.transformObject({ type: "image", x: 0, y: 0, w: 10, h: 20 }, sc)), { x: -10, y: -20, w: 20, h: 40 });
});

test("graphs never shrink below the minimum size and flips only move them", () => {
  assert.equal(G.transformObject(gr, G.scaleAbout(0, 0, 0.05)).size, G.MIN_GRAPH);
  const f = G.transformObject(gr, G.flipAbout({ x: 0, y: 0, w: 220, h: 220 }, "h"));
  assert.equal(f.size, 200);
});

test("flipping a shape mirrors its vertices; ellipse radii stay positive", () => {
  const t = G.flipAbout({ x: 0, y: 0, w: 100, h: 100 }, "h");
  assert.deepEqual(plain(G.transformObject(tri, t).points), [[100, 0], [0, 0], [50, 80]]);
  assert.deepEqual(plain(G.transformObject(ell, t).points), [[0, 100], [40, 20]]);
});

test("nearShape hits outlines, not interiors", () => {
  assert.ok(G.nearShape(ell, { x: 140, y: 100 }, 2));
  assert.ok(!G.nearShape(ell, { x: 100, y: 100 }, 2));
  assert.ok(G.nearShape(tri, { x: 50, y: 1 }, 2));
  assert.ok(!G.nearShape(tri, { x: 50, y: 30 }, 2));
  const line = { kind: "line", width: 2, points: [[0, 0], [100, 0]] };
  assert.ok(G.nearShape(line, { x: 50, y: 4 }, 4));
  assert.ok(!G.nearShape(line, { x: 50, y: 10 }, 4));
});

test("shapeSamples and boxInsidePolygon", () => {
  assert.equal(G.shapeSamples(ell).length, 8);
  assert.equal(G.shapeSamples(tri).length, 3);
  const poly = G.rectPolygon({ x: 0, y: 0 }, { x: 100, y: 100 });
  assert.ok(G.boxInsidePolygon({ x: 10, y: 10, w: 50, h: 50 }, poly));
  assert.ok(!G.boxInsidePolygon({ x: 10, y: 10, w: 150, h: 50 }, poly));
});
