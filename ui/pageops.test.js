"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("./pageops.js");

test("reorder moves forward and backward without mutating", () => {
  const a = [0, 1, 2, 3];
  assert.deepEqual(P.reorder(a, 0, 2), [1, 2, 0, 3]);
  assert.deepEqual(P.reorder(a, 3, 1), [0, 3, 1, 2]);
  assert.deepEqual(a, [0, 1, 2, 3]);
});
test("reorder ignores bad indexes and same-position moves", () => {
  assert.deepEqual(P.reorder([0, 1], 1, 1), [0, 1]);
  assert.deepEqual(P.reorder([0, 1], -1, 0), [0, 1]);
  assert.deepEqual(P.reorder([0, 1], 0, 2), [0, 1]);
  assert.deepEqual(P.reorder([], 0, 0), []);
  assert.deepEqual(P.reorder([0, 1], 0.5, 1), [0, 1]);
});
test("indexAfterMove tracks the current page for every case", () => {
  for (const [from, to] of [[0, 3], [3, 0], [1, 2], [2, 1], [2, 2]]) {
    const ids = [0, 1, 2, 3], moved = P.reorder(ids, from, to);
    for (let cur = 0; cur < 4; cur++) assert.equal(moved[P.indexAfterMove(cur, from, to)], cur, `cur ${cur} move ${from}->${to}`);
  }
});
test("indexAfterDelete edge cases", () => {
  assert.equal(P.indexAfterDelete(2, 0, 4), 1);   // earlier page removed
  assert.equal(P.indexAfterDelete(1, 3, 4), 1);   // later page removed
  assert.equal(P.indexAfterDelete(1, 1, 4), 1);   // current removed: next slides in
  assert.equal(P.indexAfterDelete(3, 3, 4), 2);   // last current removed: new last
  assert.equal(P.indexAfterDelete(0, 0, 2), 0);
  assert.equal(P.indexAfterDelete(0, 0, 1), 0);   // never negative
});
test("duplicatePage gives unique ids everywhere and is a deep copy", () => {
  let n = 0; const newId = () => `n${++n}`;
  const pg = { id: "page-a", width: 1, height: 2, style: { pattern: "grid", color: "#fff" },
    strokes: [{ id: "s1", points: [{ x: 1, y: 2 }] }, { id: "s2", points: [] }],
    objects: [{ type: "image", id: "i1", data: "AAAA" }, { type: "shape", id: "o2", points: [{ x: 0, y: 0 }] }] };
  const c = P.duplicatePage(pg, newId);
  const ids = [pg.id, ...pg.strokes.map((s) => s.id), ...pg.objects.map((o) => o.id),
               c.id, ...c.strokes.map((s) => s.id), ...c.objects.map((o) => o.id)];
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(c.objects[0].data, "AAAA");
  c.strokes[0].points[0].x = 99; c.style.color = "#000";
  assert.equal(pg.strokes[0].points[0].x, 1);
  assert.equal(pg.style.color, "#fff");
  assert.equal(pg.id, "page-a");
});
test("duplicatePage tolerates pages without objects", () => {
  const c = P.duplicatePage({ id: "p", strokes: [] }, () => "x");
  assert.equal(c.id, "page-x");
  assert.equal(c.objects, undefined);
});
test("blankLike copies size and a separate style", () => {
  const base = { id: "p", width: 5, height: 6, style: { pattern: "dot", color: "#111" } };
  const b = P.blankLike(base, () => "z");
  assert.equal(b.width, 5); assert.deepEqual(b.style, base.style); assert.notEqual(b.style, base.style);
  assert.deepEqual(b.strokes, []);
});
