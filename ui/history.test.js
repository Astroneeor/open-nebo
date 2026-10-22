"use strict";
// Run: node --test ui/history.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const History = require("./history.js");

const stroke = (id, x = 0) => ({ id, color: "#000000", width: 2, points: [{ x, y: 0 }] });
function fresh(extra = {}) {
  const pages = { p1: { id: "p1", strokes: [], objects: [] }, p2: { id: "p2", strokes: [], objects: [] }, ...extra };
  let shown = null;
  History.reset();
  History.bind((id) => pages[id] || null, (pg) => { shown = pg.id; });
  History._setClock(() => 0);
  return { pages, pg: pages.p1, shown: () => shown };
}
const ids = (l) => l.map((x) => x.id);

test("undo and redo walk back and forth through strokes", () => {
  const { pg } = fresh();
  History.record(pg, "stroke", () => pg.strokes.push(stroke("a")));
  History.record(pg, "stroke", () => pg.strokes.push(stroke("b")));
  assert.deepEqual(ids(pg.strokes), ["a", "b"]);
  assert.ok(History.undo());
  assert.deepEqual(ids(pg.strokes), ["a"]);
  assert.ok(History.undo());
  assert.deepEqual(ids(pg.strokes), []);
  assert.equal(History.undo(), false, "nothing left to undo");
  assert.ok(History.redo());
  assert.ok(History.redo());
  assert.deepEqual(ids(pg.strokes), ["a", "b"]);
  assert.equal(History.redo(), false);
});

test("a new action clears the redo stack", () => {
  const { pg } = fresh();
  History.record(pg, "stroke", () => pg.strokes.push(stroke("a")));
  History.undo();
  assert.ok(History.canRedo());
  History.record(pg, "stroke", () => pg.strokes.push(stroke("b")));
  assert.equal(History.canRedo(), false);
  assert.deepEqual(ids(pg.strokes), ["b"]);
});

test("an edit that changes nothing is not recorded", () => {
  const { pg } = fresh();
  pg.strokes.push(stroke("a"));
  History.record(pg, "noop", () => {});
  History.record(pg, "same", () => { pg.strokes[0].color = "#000000"; });
  assert.equal(History.depth(), 0);
});

test("in-place field edits and object kinds are restored", () => {
  const { pg } = fresh();
  pg.strokes.push(stroke("a"));
  pg.objects.push({ type: "shape", id: "s", kind: "line", color: "#000000", width: 2, points: [[0, 0], [10, 0]] });
  pg.objects.push({ type: "graph", id: "g", x: 0, y: 0, size: 200, xmin: -5, xmax: 5, ymin: -5, ymax: 5 });
  History.record(pg, "recolor", () => { pg.strokes[0].color = "#ff0000"; pg.objects[0].color = "#00ff00"; });
  History.record(pg, "scale", () => { pg.objects[1].size = 400; pg.objects[0].points = [[0, 0], [20, 0]]; });
  History.undo();
  assert.equal(pg.objects[1].size, 200);
  assert.deepEqual(pg.objects[0].points, [[0, 0], [10, 0]]);
  assert.equal(pg.objects[0].color, "#00ff00");
  History.undo();
  assert.equal(pg.strokes[0].color, "#000000");
  assert.equal(pg.objects[0].color, "#000000");
  History.redo();
  assert.equal(pg.strokes[0].color, "#ff0000");
});

test("erasing is one undo step covering strokes and objects", () => {
  const { pg } = fresh();
  pg.strokes.push(stroke("a"), stroke("b"), stroke("c"));
  pg.objects.push({ type: "shape", id: "s", kind: "line", color: "#000", width: 2, points: [[0, 0], [1, 1]] });
  const tok = History.begin(pg);
  pg.strokes = pg.strokes.filter((s) => s.id !== "b");   // several eraser moves, one pointer stroke
  pg.strokes = pg.strokes.filter((s) => s.id !== "a");
  pg.objects = [];
  assert.ok(History.commit(tok, "erase"));
  assert.equal(History.depth(), 1);
  History.undo();
  assert.deepEqual(ids(pg.strokes), ["a", "b", "c"], "original order restored");
  assert.deepEqual(ids(pg.objects), ["s"]);
  History.redo();
  assert.deepEqual(ids(pg.strokes), ["c"]);
});

test("restored items are copies, so later edits do not corrupt the history", () => {
  const { pg } = fresh();
  History.record(pg, "stroke", () => pg.strokes.push(stroke("a")));
  History.undo(); History.redo();
  pg.strokes[0].color = "#123456";            // edit outside the history
  History.undo(); History.redo();
  assert.equal(pg.strokes[0].color, "#000000", "redo restores the recorded state");
});

test("undo on another page switches to it", () => {
  const { pages, shown } = fresh();
  History.record(pages.p1, "stroke", () => pages.p1.strokes.push(stroke("a")));
  History.record(pages.p2, "stroke", () => pages.p2.strokes.push(stroke("b")));
  History.undo();
  assert.equal(shown(), "p2");
  History.undo();
  assert.equal(shown(), "p1");
  assert.deepEqual(ids(pages.p1.strokes), []);
});

test("entries for a page that no longer exists are skipped", () => {
  const { pages, pg } = fresh();
  History.record(pg, "stroke", () => pg.strokes.push(stroke("a")));
  History.record(pages.p2, "stroke", () => pages.p2.strokes.push(stroke("b")));
  delete pages.p2;
  assert.ok(History.undo());
  assert.deepEqual(ids(pg.strokes), []);
});

test("repeated edits of one field coalesce into a single step", () => {
  const { pg } = fresh();
  pg.objects.push({ type: "graph", id: "g", x: 0, y: 0, size: 200, xmin: -5, xmax: 5, ymin: -5, ymax: 5 });
  for (const v of [6, 7, 8]) History.record(pg, "edit graph", () => { pg.objects[0].xmax = v; }, "graph:g:xmax");
  assert.equal(History.depth(), 1);
  History.undo();
  assert.equal(pg.objects[0].xmax, 5);
  History.redo();
  assert.equal(pg.objects[0].xmax, 8);
});

test("coalescing stops when the value goes back to where it started, and after a pause", () => {
  const { pg } = fresh();
  pg.objects.push({ type: "graph", id: "g", x: 0, y: 0, size: 200, xmin: -5, xmax: 5, ymin: -5, ymax: 5 });
  History.record(pg, "edit graph", () => { pg.objects[0].xmax = 6; }, "k");
  History.record(pg, "edit graph", () => { pg.objects[0].xmax = 5; }, "k");
  assert.equal(History.depth(), 0, "net no-op leaves no entry");
  let t = 0;
  History._setClock(() => t);
  History.record(pg, "edit graph", () => { pg.objects[0].xmax = 6; }, "k");
  t = 5000;
  History.record(pg, "edit graph", () => { pg.objects[0].xmax = 7; }, "k");
  assert.equal(History.depth(), 2);
});

test("the history is capped", () => {
  const { pg } = fresh();
  for (let i = 0; i < 350; i++) History.record(pg, "stroke", () => pg.strokes.push(stroke("s" + i)));
  assert.equal(History.depth(), 300);
});

test("reset forgets everything", () => {
  const { pg } = fresh();
  History.record(pg, "stroke", () => pg.strokes.push(stroke("a")));
  History.undo();
  History.reset();
  assert.equal(History.canUndo(), false);
  assert.equal(History.canRedo(), false);
});
