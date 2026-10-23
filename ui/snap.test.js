"use strict";
// Run: node --test ui/snap.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const B = require("./backgrounds.js");
const Snap = require("./snap.js");

test("step: only the square lattices (grid, dot, triangle) snap", () => {
  assert.equal(Snap.step({ pattern: "triangle", color: "#ffffff" }, 1), 40);
  for (const p of ["isometric", "persp1", "persp2", "persp3"]) assert.equal(Snap.step({ pattern: p, color: "#ffffff" }, 1), 0, p);
  assert.equal(Snap.step({ pattern: "grid", color: "#ffffff" }, 1), 40);
  assert.equal(Snap.step({ pattern: "dot", color: "#ffffff" }, 1), 40);
  assert.equal(Snap.step({ pattern: "paper", color: "#ffffff" }, 1), 0);
  assert.equal(Snap.step({ pattern: "plain", color: "#ffffff" }, 1), 0);
  assert.equal(Snap.step(null, 1), 0);
});

test("step doubles with the drawn spacing when zoomed out", () => {
  const g = { pattern: "grid", color: "#ffffff" };
  assert.equal(Snap.step(g, 0.1), B.spacing("grid", 0.1));
  assert.ok(Snap.step(g, 0.1) > 40);
  assert.equal(Snap.step(g, 0.1) % 40, 0);
});

test("round and point", () => {
  assert.equal(Snap.round(59, 40), 40);
  assert.equal(Snap.round(61, 40), 80);
  assert.equal(Snap.round(-21, 40), -40);
  assert.equal(Snap.round(13, 0), 13);
  assert.deepEqual(Snap.point({ x: 45, y: 95, t: 3 }, 40), { x: 40, y: 80, t: 3 });
});

test("shapePoints: line, rect and triangle corners land on the grid", () => {
  assert.deepEqual(Snap.shapePoints("line", [[3, 4], [118, 83]], 40), [[0, 0], [120, 80]]);
  assert.deepEqual(
    Snap.shapePoints("rect", [[2, 3], [198, 3], [198, 121], [2, 121]], 40),
    [[0, 0], [200, 0], [200, 120], [0, 120]]);
  assert.deepEqual(Snap.shapePoints("triangle", [[1, 1], [79, 2], [41, 79]], 40), [[0, 0], [80, 0], [40, 80]]);
});

test("shapePoints: ellipse snaps the centre and rounds radii to at least one cell", () => {
  assert.deepEqual(Snap.shapePoints("ellipse", [[98, 61], [57, 5]], 40), [[80, 80], [40, 40]]);
});

test("shapePoints: corners that would merge keep the original points", () => {
  const tiny = [[2, 2], [9, 3]];
  assert.equal(Snap.shapePoints("line", tiny, 40), tiny);
});

test("shapePoints: no step means no change", () => {
  const pts = [[3, 4], [118, 83]];
  assert.equal(Snap.shapePoints("line", pts, 0), pts);
});

test("delta puts the box top-left on the grid", () => {
  const box = { x: 13, y: 27, w: 50, h: 50 };
  const d = Snap.delta(box, 30, 30, 40);
  assert.equal((box.x + d.dx) % 40, 0);
  assert.equal((box.y + d.dy) % 40, 0);
  assert.deepEqual(Snap.delta(box, 30, 30, 0), { dx: 30, dy: 30 });
});
