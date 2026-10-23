"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("./svgexport.js");

const page = (extra = {}) => ({ id: "p", width: 1404, height: 1872, strokes: [], objects: [], ...extra });
const stroke = (o = {}) => ({ id: "s", color: "#112233", width: 4, points: [{ x: 10, y: 10, p: 0.5 }, { x: 50, y: 60, p: 0.5 }], ...o });

test("escape handles markup characters", () => {
  assert.equal(S.esc(`<a href="x">&'`), "&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
});

test("empty page: valid svg with sheet bounds and white background", () => {
  const s = S.pageToSvg(page());
  assert.match(s, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="1404" height="1872" viewBox="0 0 1404 1872">/);
  assert.match(s, /fill="#ffffff"/);
  assert.ok(s.endsWith("</svg>"));
});

test("transparent when background is off", () => {
  assert.doesNotMatch(S.pageToSvg(page(), { background: false }), /<rect/);
});

test("bounds grow to include content outside the sheet, incl. text", () => {
  const b = S.bounds(page({ strokes: [stroke({ points: [{ x: -100, y: -50, p: 1 }, { x: 2000, y: 10, p: 1 }] })] }));
  assert.deepEqual([b.x0, b.y0, b.w], [-100, -50, 2100]);
  const t = S.bounds(page({ objects: [{ type: "text", x: 0, y: 1800, w: 100, text: "aaa bbb ccc ddd eee fff ggg", size: 20 }] }));
  assert.ok(t.h > 1872);
});

test("stroke: path with colour; highlighter and opacity become stroke-opacity", () => {
  assert.match(S.pageToSvg(page({ strokes: [stroke()] })), /<path d="M10 10L50 60" fill="none" stroke="#112233"/);
  assert.doesNotMatch(S.pageToSvg(page({ strokes: [stroke()] })), /stroke-opacity/);
  assert.match(S.pageToSvg(page({ strokes: [stroke({ kind: "highlighter" })] })), /stroke-opacity="0.4"/);
  assert.match(S.pageToSvg(page({ strokes: [stroke({ opacity: 0.25 })] })), /stroke-opacity="0.25"/);
});

test("single-point stroke is a dot; hidden layers are skipped", () => {
  assert.match(S.pageToSvg(page({ strokes: [stroke({ points: [{ x: 5, y: 5, p: 1 }] })] })), /<circle cx="5"/);
  const pg = page({ layers: [{ id: "L", name: "L", visible: false }], strokes: [stroke({ layer: "L" })] });
  assert.doesNotMatch(S.pageToSvg(pg), /<path/);
});

test("shapes render natively", () => {
  const sh = (kind, points) => ({ type: "shape", id: "x", kind, color: "#ff0000", width: 3, points });
  const out = (o) => S.pageToSvg(page({ objects: [o] }));
  assert.match(out(sh("line", [[0, 0], [10, 10]])), /<line x1="0"/);
  assert.match(out(sh("arrow", [[0, 0], [100, 0]])), /<line[^>]*\/><path d="M/);
  assert.match(out(sh("ellipse", [[50, 50], [20, 10]])), /<ellipse cx="50" cy="50" rx="20" ry="10"/);
  assert.match(out(sh("rect", [[0, 0], [10, 0], [10, 10], [0, 10]])), /<polygon points="0,0 10,0 10,10 0,10"/);
  assert.match(out(sh("triangle", [[0, 0], [10, 0], [5, 9]])), /<polygon points="0,0 10,0 5,9"/);
  assert.doesNotMatch(out(sh("rect", [[0, 0]])), /polygon/);
});

test("text objects wrap into tspans and are escaped", () => {
  const o = { type: "text", x: 10, y: 20, w: 100, size: 20, text: "hello <script>alert(1)</script> world & more", color: "#000000" };
  const s = S.pageToSvg(page({ objects: [o] }));
  assert.ok((s.match(/<tspan/g) || []).length > 1);
  assert.doesNotMatch(s, /<script/);
  assert.match(s, /&lt;script&gt;/);
});

test("hostile attributes cannot break out", () => {
  const s = S.pageToSvg(page({
    strokes: [stroke({ color: '"/><script>x</script>' })],
    objects: [{ type: "image", x: 0, y: 0, w: 5, h: 5, mime: 'image/png"onload="x', data: "AAAA" },
              { type: "image", x: 0, y: 0, w: 5, h: 5, mime: "image/png", data: 'A"/><script>' },
              { type: "image", x: 0, y: 0, w: 5, h: 5, mime: "image/png", data: "iVBORw0KGgo=" }],
  }), { backgroundImage: 'data:image/png;base64,AA"onload="x' });
  assert.doesNotMatch(s, /<script|onload/);
  assert.equal((s.match(/<image/g) || []).length, 1);
  assert.match(s, /href="data:image\/png;base64,iVBORw0KGgo="/);
});

test("graph draws grid, axes and escaped labels", () => {
  const g = { type: "graph", x: 0, y: 0, size: 200, xmin: -2, xmax: 2, ymin: -2, ymax: 2, step: 1, grid: true, axes: true, labels: true };
  const s = S.pageToSvg(page({ objects: [g] }));
  assert.match(s, /stroke="#b9c2d0"/);
  assert.match(s, /stroke="#1b1b1f"/);
  assert.match(s, />−1<\/text>/);
});

test("background patterns: grid/dot/paper use <pattern>, unknown falls back to solid", () => {
  const sty = (pattern) => ({ style: { pattern, color: "#ffffff" } });
  for (const p of ["grid", "dot", "paper"]) assert.match(S.pageToSvg(page(), sty(p)), /<pattern id="nebo-bg"/);
  assert.doesNotMatch(S.pageToSvg(page(), sty("isometric")), /<pattern/);
  assert.match(S.pageToSvg(page(), sty("isometric")), /fill="#ffffff"/);
  assert.doesNotMatch(S.pageToSvg(page(), { ...sty("grid"), grid: false }), /<pattern/);
});
