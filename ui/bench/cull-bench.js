"use strict";
// Prints items drawn vs total at several zooms, using the same cull + level-of-detail rules as render() in app.js.
// Not part of the test suite. Usage: node ui/bench/cull-bench.js [count]
const Sp = require("../spatial.js");
const { gen } = require("./gen-notebook.js");

const n = +process.argv[2] || 50000, pg = gen(n);
const W = 1200, H = 800;
let t = process.hrtime.bigint();
Sp.query(pg, { x: 0, y: 0, w: 10, h: 10 });
console.log(`index build (first query): ${(Number(process.hrtime.bigint() - t) / 1e6).toFixed(1)} ms for ${n} strokes`);
console.log("zoom   strokes-in-view  drawn(after LOD)  total   drawn%   points-drawn%  query ms (trusted)");
const totalPts = pg.strokes.reduce((a, s) => a + s.points.length, 0);
for (const zoom of [2, 1, 0.5, 0.25, 0.1, 0.05]) {
  const x = 40 * 28 / 2 - W / zoom / 2, y = 20 * 36 - H / zoom / 2; // centred on the middle of the page
  const rect = Sp.viewRect(x, y, zoom, W, H, 64);
  t = process.hrtime.bigint();
  const stats = { touched: 0 };
  const q = Sp.query(pg, rect, { trust: true, stats });
  const ms = Number(process.hrtime.bigint() - t) / 1e6;
  let drawn = 0, pts = 0;
  q.strokes.forEach((s, i) => {
    const b = q.strokeBoxes[i];
    if (!Sp.visibleAtZoom(b, zoom)) return;
    drawn++; pts += Sp.decimate(s.points, Sp.lodStep(b, s.points.length, zoom)).length;
  });
  console.log(`${String(zoom).padEnd(6)} ${String(q.strokes.length).padStart(14)}  ${String(drawn).padStart(16)}  ${String(n).padStart(6)}  ${(100 * drawn / n).toFixed(2).padStart(6)}%  ${(100 * pts / totalPts).toFixed(2).padStart(12)}%  ${ms.toFixed(2)}`);
}
