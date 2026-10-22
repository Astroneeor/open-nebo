"use strict";
// Run with: node --test ui/
const test = require("node:test");
const assert = require("node:assert/strict");
const { recognize, hitShape } = require("./shapes.js");

let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296 - 0.5);

// Sample a polyline every ~4px with +-1.5px of hand jitter.
function trace(poly, jitter = 3) {
  const out = [];
  for (let i = 1; i < poly.length; i++) {
    const [a, b] = [poly[i - 1], poly[i]], n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 4));
    for (let k = 0; k < n; k++) {
      out.push({ x: a[0] + (b[0] - a[0]) * k / n + rnd() * jitter, y: a[1] + (b[1] - a[1]) * k / n + rnd() * jitter });
    }
  }
  const l = poly[poly.length - 1];
  out.push({ x: l[0] + rnd() * jitter, y: l[1] + rnd() * jitter });
  return out;
}

const circle = (cx, cy, rx, ry, a0 = 0, sweep = Math.PI * 2.05) =>
  Array.from({ length: 80 }, (_, i) => {
    const a = a0 + sweep * i / 79;
    return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)];
  });

const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} !~ ${b} (+-${tol})`);

test("straight line", () => {
  const r = recognize(trace([[100, 100], [400, 160]]));
  assert.equal(r.kind, "line");
  near(r.points[1][0], 400, 4); near(r.points[1][1], 160, 4);
});

test("near-horizontal line snaps flat", () => {
  const r = recognize(trace([[100, 100], [400, 108]], 0));
  assert.equal(r.kind, "line");
  assert.equal(r.points[0][1], r.points[1][1]);
});

test("circle becomes a circle", () => {
  const r = recognize(trace(circle(300, 300, 100, 100), 3));
  assert.equal(r.kind, "ellipse");
  near(r.points[0][0], 300, 6); near(r.points[1][0], 100, 8);
  assert.equal(r.points[1][0], r.points[1][1]);
});

test("wide ellipse keeps its radii", () => {
  const r = recognize(trace(circle(300, 300, 160, 70), 3));
  assert.equal(r.kind, "ellipse");
  near(r.points[1][0], 160, 10); near(r.points[1][1], 70, 10);
});

test("rectangle started mid-edge", () => {
  const r = recognize(trace([[250, 100], [400, 100], [400, 260], [100, 260], [100, 100], [255, 100]], 3));
  assert.equal(r.kind, "rect");
  assert.equal(r.points.length, 4);
  const xs = r.points.map((p) => p[0]), ys = r.points.map((p) => p[1]);
  near(Math.min(...xs), 100, 8); near(Math.max(...xs), 400, 8);
  near(Math.min(...ys), 100, 8); near(Math.max(...ys), 260, 8);
});

test("rotated rectangle stays rotated", () => {
  const rot = ([x, y]) => [300 + (x - 300) * Math.cos(0.5) - (y - 200) * Math.sin(0.5), 200 + (x - 300) * Math.sin(0.5) + (y - 200) * Math.cos(0.5)];
  const c = [[200, 150], [400, 150], [400, 250], [200, 250], [200, 150]].map(rot);
  const r = recognize(trace(c, 2));
  assert.equal(r.kind, "rect");
  assert.notEqual(r.points[0][1], r.points[1][1]);
});

test("triangle", () => {
  const r = recognize(trace([[200, 300], [350, 100], [500, 300], [202, 298]], 3));
  assert.equal(r.kind, "triangle");
  assert.equal(r.points.length, 3);
});

test("arrow: shaft then two barbs", () => {
  // shaft (100,200)->(400,200); barbs back from the tip at +-30deg
  const t = [400, 200], l = 50, a = Math.PI, d = 0.52;
  const b1 = [t[0] + l * Math.cos(a + d), t[1] + l * Math.sin(a + d)];
  const b2 = [t[0] + l * Math.cos(a - d), t[1] + l * Math.sin(a - d)];
  const r = recognize(trace([[100, 200], t, b1, t, b2], 2));
  assert.equal(r.kind, "arrow");
  near(r.points[1][0], 400, 6); near(r.points[0][0], 100, 6);
});

test("rejects scribbles, dots, S-curves and open arcs", () => {
  assert.equal(recognize([{ x: 5, y: 5 }, { x: 6, y: 6 }, { x: 7, y: 5 }, { x: 5, y: 6 }]), null);
  assert.equal(recognize(trace([[0, 0], [60, 80], [10, 90], [90, 20], [30, 5], [100, 100]], 3)), null);
  const s = Array.from({ length: 60 }, (_, i) => ({ x: i * 5, y: 60 * Math.sin(i / 6) }));
  assert.equal(recognize(s), null);
  assert.equal(recognize(trace(circle(300, 300, 100, 100, 0, Math.PI), 2)), null); // half circle
});

test("hitShape tests the outline, not the fill", () => {
  const rect = { kind: "rect", width: 2, color: "#000", points: [[0, 0], [100, 0], [100, 100], [0, 100]] };
  assert.ok(hitShape(rect, { x: 50, y: 2 }, 6));
  assert.ok(!hitShape(rect, { x: 50, y: 50 }, 6));
  const el = { kind: "ellipse", width: 2, color: "#000", points: [[50, 50], [40, 20]] };
  assert.ok(hitShape(el, { x: 90, y: 50 }, 6));
  assert.ok(!hitShape(el, { x: 50, y: 50 }, 6));
});
