"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Pens = require("./pens.js");

let n = 0; const id = () => "n" + ++n;
const line = (xs, extra = {}) => ({ id: "s", color: "#f00", width: 3, ...extra, points: xs.map((x) => ({ x, y: 0, t: 0, p: 0.5 })) });

test("style table: every kind has an icon and a default width", () => {
  for (const k of Pens.KINDS) { assert.ok(Pens.STYLES[k].icon); assert.ok(Pens.STYLES[k].width > 0); }
  assert.ok(Pens.STYLES.highlighter.width > Pens.STYLES.pen.width);
});

test("plain pen keeps the original pressure curve; unknown kind falls back to pen", () => {
  const s = { width: 2, points: [] };
  assert.equal(Pens.widthAt(s, 0.5), 2 * (0.4 + 1.2 * 0.5));
  assert.equal(Pens.kindOf({ kind: "bogus" }), "pen");
});

test("highlighter and marker ignore pressure; pencil is lightly sensitive", () => {
  for (const kind of ["highlighter", "marker"]) assert.equal(Pens.widthAt({ kind, width: 4 }, 0.1), Pens.widthAt({ kind, width: 4 }, 1));
  const a = Pens.widthAt({ kind: "pencil", width: 2 }, 0), b = Pens.widthAt({ kind: "pencil", width: 2 }, 1);
  assert.ok(b > a && b / a < 1.8);
});

test("newFields omits kind for pen, sets opacity for highlighter", () => {
  assert.deepEqual(Pens.newFields("pen"), {});
  assert.deepEqual(Pens.newFields("marker"), { kind: "marker" });
  assert.equal(Pens.newFields("highlighter").opacity, 0.35);
  assert.equal(Pens.opacityOf({ kind: "highlighter" }), 0.35);
  assert.equal(Pens.opacityOf({ kind: "highlighter", opacity: 0.5 }), 0.5);
  assert.equal(Pens.opacityOf({}), 1);
});

test("splitStroke: untouched returns null", () => {
  assert.equal(Pens.splitStroke(line([0, 10, 20]), { x: 100, y: 100 }, 5, id), null);
});

test("splitStroke: erasing the middle makes two pieces with new ids and kept style", () => {
  const s = line([0, 10, 20, 30, 40], { kind: "highlighter", opacity: 0.35 });
  const parts = Pens.splitStroke(s, { x: 20, y: 0 }, 5, id);
  assert.equal(parts.length, 2);
  assert.deepEqual(parts.map((p) => p.points.map((q) => q.x)), [[0, 10], [30, 40]]);
  for (const p of parts) { assert.notEqual(p.id, "s"); assert.equal(p.kind, "highlighter"); assert.equal(p.opacity, 0.35); assert.equal(p.color, "#f00"); assert.equal(p.width, 3); }
  assert.notEqual(parts[0].id, parts[1].id);
});

test("splitStroke: a sparse segment crossed by the circle is still cut", () => {
  const parts = Pens.splitStroke(line([0, 100]), { x: 50, y: 0 }, 5, id);
  assert.equal(parts.length, 2);
  assert.equal(parts[0].points.length, 1);
});

test("splitStroke: erasing everything yields no pieces; ends just trim", () => {
  assert.deepEqual(Pens.splitStroke(line([0, 2]), { x: 1, y: 0 }, 50, id), []);
  const parts = Pens.splitStroke(line([0, 10, 20]), { x: 0, y: 0 }, 5, id);
  assert.equal(parts.length, 1);
  assert.deepEqual(parts[0].points.map((q) => q.x), [10, 20]);
});

test("eraseStrokes: stroke mode removes whole stroke; point mode splits; highlighter mode only highlighters", () => {
  const pen = line([0, 10, 20]), hl = line([0, 10, 20], { id: "h", kind: "highlighter" });
  const at = { x: 10, y: 0 };
  assert.deepEqual(Pens.eraseStrokes([pen, hl], at, 4, "stroke", id), []);
  assert.deepEqual(Pens.eraseStrokes([pen, hl], at, 4, "highlighter", id), [pen]);
  assert.equal(Pens.eraseStrokes([pen], at, 4, "highlighter", id), null);
  const split = Pens.eraseStrokes([pen, hl], at, 4, "point", id);
  assert.equal(split.length, 4);
  assert.equal(Pens.eraseStrokes([pen], { x: 500, y: 500 }, 4, "point", id), null);
});
