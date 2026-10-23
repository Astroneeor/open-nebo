"use strict";
const test = require("node:test");
const assert = require("node:assert");
const B = require("./backgrounds.js");

function rec() {
  const calls = [];
  return new Proxy({}, { get: (_, k) => (k === "calls" ? calls : (...a) => { calls.push([k, a]); }), set: () => true });
}
const count = (c, name) => c.calls.filter(([k]) => k === name).length;
const R = { x0: -200, y0: -150, x1: 1000, y1: 700 };

test("luminance and darkness", () => {
  assert.strictEqual(B.luminance("#000000"), 0);
  assert.ok(Math.abs(B.luminance("#ffffff") - 1) < 1e-9);
  assert.ok(B.isDark("#1e1e1e") && B.isDark("#000000") && B.isDark("#10202f"));
  assert.ok(!B.isDark("#ffffff") && !B.isDark("#f6f1e4") && !B.isDark("#f1e4c8"));
  assert.strictEqual(B.luminance("not a colour"), 1);
});

test("ink is a lighter tint on dark bases and a darker tint on light bases", () => {
  for (const base of B.PRESETS.map((p) => p.color)) {
    for (const kind of ["line", "major", "dot"]) {
      const ink = B.inkFor(base, kind);
      assert.match(ink, /^#[0-9a-f]{6}$/, `${base} ${kind}`);
      if (B.isDark(base)) assert.ok(B.luminance(ink) > B.luminance(base), `${base} ${kind} should be lighter`);
      else assert.ok(B.luminance(ink) < B.luminance(base), `${base} ${kind} should be darker`);
    }
  }
});

test("ink strength ordering: line is subtler than major, dot is strongest", () => {
  for (const base of ["#ffffff", "#1e1e1e", "#f1e4c8"]) {
    const d = (k) => Math.abs(B.luminance(B.inkFor(base, k)) - B.luminance(base));
    assert.ok(d("line") < d("major") && d("major") < d("dot"), base);
  }
});

test("invalid colours fall back to white's ink instead of throwing", () => {
  assert.strictEqual(B.inkFor("red", "line"), B.inkFor("#ffffff", "line"));
});

test("pen colour flips with the base", () => {
  assert.strictEqual(B.penFor("#1e1e1e"), "#f2f2f2");
  assert.strictEqual(B.penFor("#ffffff"), "#000000");
});

test("presets: light/dark plain, paper, dot grid and grid, plus blueprint", () => {
  const ids = B.PRESETS.map((p) => p.id);
  for (const id of ["plain", "plain-dark", "paper", "paper-dark", "dot", "dot-dark", "grid", "grid-dark", "blueprint"]) assert.ok(ids.includes(id), id);
  assert.strictEqual(new Set(ids).size, ids.length);
  for (const p of B.PRESETS) {
    assert.ok(B.valid(p), p.id);
    assert.strictEqual(B.isDark(p.color), p.id.endsWith("-dark") || p.id === "blueprint", p.id);
  }
  assert.deepStrictEqual(B.PRESETS.slice(0, 6).map((p) => p.name),
    ["Light", "Dark", "Light paper", "Dark paper", "Light dot grid", "Dark dot grid"]);
});

test("blueprint lines are boosted so they read on the saturated blue", () => {
  const bp = B.PRESETS.find((p) => p.id === "blueprint").color;
  const lift = (base, k) => B.luminance(B.inkFor(base, k)) - B.luminance(base);
  assert.ok(lift(bp, "line") > lift("#1e1e1e", "line") * 1.5);
  assert.match(B.inkFor(bp, "major"), /^#[0-9a-f]{6}$/);
});

test("autoInk swaps only the two automatic colours, on strokes and shapes", () => {
  const mk = () => ({
    strokes: [{ color: "#000000" }, { color: "#ff0000" }, { color: "#F2F2F2" }],
    objects: [{ type: "shape", color: "#000000" }, { type: "image" }, { type: "graph" }],
  });
  const pg = mk();
  assert.strictEqual(B.autoInk(pg, true), 2);
  assert.deepStrictEqual(pg.strokes.map((s) => s.color), ["#f2f2f2", "#ff0000", "#F2F2F2"]);
  assert.strictEqual(pg.objects[0].color, "#f2f2f2");
  assert.strictEqual(B.autoInk(pg, false), 3); // back: both #f2f2f2 strokes (one was already light) and the shape
  assert.deepStrictEqual(pg.strokes.map((s) => s.color), ["#000000", "#ff0000", "#000000"]);
  assert.strictEqual(B.autoInk({}, true), 0);
});

test("resolve: page override, then notebook default, then plain white", () => {
  const doc = { style: { pattern: "grid", color: "#1e1e1e" } };
  assert.deepStrictEqual(B.resolve(doc, { style: { pattern: "dot", color: "#ffffff" } }), { pattern: "dot", color: "#ffffff" });
  assert.deepStrictEqual(B.resolve(doc, {}), doc.style);
  assert.deepStrictEqual(B.resolve({}, {}), B.DEFAULT);
  assert.deepStrictEqual(B.resolve(doc, { style: { pattern: "evil", color: "#fff" } }), doc.style);
  assert.deepStrictEqual(B.resolve(null, null), B.DEFAULT);
});

test("every draw fills the whole visible rect first, inside a save/restore pair", () => {
  for (const p of B.PATTERNS) {
    const c = rec();
    B.draw(c, { pattern: p, color: "#abcdef" }, R, 1);
    assert.strictEqual(c.calls[0][0], "save");
    assert.strictEqual(c.calls[c.calls.length - 1][0], "restore");
    const fill = c.calls.find(([k]) => k === "fillRect");
    assert.deepStrictEqual(fill[1], [R.x0, R.y0, R.x1 - R.x0, R.y1 - R.y0], p);
  }
});

test("plain draws no pattern, other patterns do", () => {
  const plain = rec();
  B.draw(plain, { pattern: "plain", color: "#ffffff" }, R, 1);
  assert.strictEqual(count(plain, "stroke") + count(plain, "fill"), 0);
  for (const p of ["paper", "grid", "dot"]) {
    const c = rec();
    B.draw(c, { pattern: p, color: "#ffffff" }, R, 1);
    assert.ok(count(c, "stroke") + count(c, "fill") > 0, p);
  }
});

test("patterns tile in world space: lines sit on multiples of the spacing", () => {
  const c = rec();
  B.draw(c, { pattern: "paper", color: "#ffffff" }, R, 1);
  const ys = c.calls.filter(([k]) => k === "moveTo").map(([, a]) => a[1]);
  assert.ok(ys.length > 10);
  for (const y of ys) assert.ok(y % B.spacing("paper", 1) === 0, `line at ${y}`); // === treats -0 as 0
  // scrolling the rect does not move existing lines
  const c2 = rec();
  B.draw(c2, { pattern: "paper", color: "#ffffff" }, { ...R, y0: R.y0 + 88, y1: R.y1 + 88 }, 1);
  const ys2 = new Set(c2.calls.filter(([k]) => k === "moveTo").map(([, a]) => a[1]));
  for (const y of ys) if (y >= R.y0 + 88 && y <= R.y1) assert.ok(ys2.has(y), `line ${y} kept`);
});

test("zoomed far out the spacing doubles so lines stay at least a few px apart, and work stays bounded", () => {
  for (const p of ["paper", "grid", "dot"]) {
    for (const z of [2, 1, 0.5, 0.1, 0.05]) {
      const s = B.spacing(p, z);
      assert.ok(s * z >= (p === "dot" ? 14 : 9), `${p}@${z}`);
      assert.strictEqual(Math.log2(s / { paper: 44, grid: 40, dot: 40 }[p]) % 1, 0);
    }
  }
  const big = rec();
  const w = 40000; // an absurdly large visible area
  B.draw(big, { pattern: "dot", color: "#ffffff" }, { x0: 0, y0: 0, x1: w, y1: w }, 1);
  assert.ok(count(big, "rect") <= 30000 * 1.01, `rect calls ${count(big, "rect")}`);
});

test("line width stays about one screen pixel at any zoom", () => {
  for (const z of [0.1, 1, 4]) {
    const widths = [];
    const c = new Proxy({}, { get: (_, k) => (...a) => {}, set: (_, k, v) => { if (k === "lineWidth") widths.push(v); return true; } });
    B.draw(c, { pattern: "grid", color: "#ffffff" }, R, z);
    assert.ok(widths.length && widths.every((w) => Math.abs(w * z - 1.25) < 1e-9), `zoom ${z}`);
  }
});

test("grid marks every fifth line with the stronger ink", () => {
  const inks = new Set();
  const c = new Proxy({}, { get: () => () => {}, set: (_, k, v) => { if (k === "strokeStyle") inks.add(v); return true; } });
  B.draw(c, { pattern: "grid", color: "#ffffff" }, R, 1);
  assert.ok(inks.has(B.inkFor("#ffffff", "line")) && inks.has(B.inkFor("#ffffff", "major")));
});

test("an invalid style draws as plain white", () => {
  const c = rec();
  B.draw(c, { pattern: "x", color: "nope" }, R, 1);
  assert.strictEqual(count(c, "stroke") + count(c, "fill"), 0);
  assert.strictEqual(c.calls.find(([k]) => k === "fillRect") !== undefined, true);
});
