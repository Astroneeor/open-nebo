"use strict";
// Headless behaviour test of selection.js with stubbed DOM/globals. Run: node --test ui/selection.test.js
const test = require("node:test");
const ids = (l) => Array.from(l, (s) => s.id);
const xs = (l) => Array.from(l, (s) => s.points[0].x);
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function setup() {
  const listeners = { cv: {}, doc: {} };
  const mk = () => ({ children: [], dataset: {}, style: {}, hidden: false, append(...n) { this.children.push(...n); }, addEventListener() {}, classList: { add() {}, remove() {} } });
  const cv = {
    clientWidth: 800, clientHeight: 600, style: {}, setPointerCapture() {},
    addEventListener(t, f) { (listeners.cv[t] = listeners.cv[t] || []).push(f); },
  };
  const pg = { id: "p1", strokes: [], objects: [] };
  const stroke = (id, pts, extra = {}) => ({ id, color: "#000000", width: 2, points: pts.map(([x, y]) => ({ x, y, t: 0, p: 0.5 })), ...extra });
  const S = { doc: { pages: [pg] }, page: 0, tool: "select", conflict: false };
  let n = 0, renders = 0, touches = 0;
  const stage = mk();
  const ctx = vm.createContext({
    console, structuredClone, Math, Promise, document: {
      createElement: mk, getElementById: () => mk(), addEventListener(t, f) { (listeners.doc[t] = listeners.doc[t] || []).push(f); },
    },
    S, cv, page: () => pg, pos: (ev) => ({ x: ev.x, y: ev.y }), render: () => { renders++; }, touch: () => { touches++; },
    status() {}, uid: () => "id" + ++n,
    Snap: require("./snap.js"), window: { __app: { snapStep: () => 0 } },
    $: (id) => (id === "stage" ? stage : mk()),
    V: { x: 0, y: 0, zoom: 1, down: () => false, move: () => false, up: () => false },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "selection-geom.js"), "utf8").replace("const Geom", "var Geom"), ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "history.js"), "utf8").replace("const History", "var History"), ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "layers.js"), "utf8").replace("const Layers", "var Layers"), ctx);
  const History = vm.runInContext("History", ctx);
  History.bind((id) => (id === pg.id ? pg : null));
  const Selection = vm.runInContext(fs.readFileSync(path.join(__dirname, "selection.js"), "utf8") + "\nSelection;", ctx);
  const fire = (kind, type, ev) => { const e = { shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, pointerId: 1, stopImmediatePropagation() {}, preventDefault() {}, ...ev };
    for (const f of listeners[kind][type] || []) f(e); };
  const mouse = {
    down: (x, y, o) => fire("cv", "pointerdown", { x, y, ...o }),
    move: (x, y, o) => fire("cv", "pointermove", { x, y, ...o }),
    up: (x, y, o) => fire("cv", "pointerup", { x, y, ...o }),
  };
  const undo = () => History.undo(), redo = () => History.redo();
  const g = { save() {}, restore() {}, strokeRect() {}, beginPath() {}, rect() {}, fill() {}, stroke() {}, setLineDash() {}, moveTo() {}, lineTo() {}, closePath() {} };
  return { pg, S, stroke, Selection, mouse, History, undo, redo, fire, g, counts: () => ({ renders, touches }) };
}

// A rectangular lasso around (x0,y0)-(x1,y1), drawn as freehand points.
function lassoRect(m, x0, y0, x1, y1) {
  m.mouse.down(x0, y0);
  for (const [x, y] of [[x1, y0], [x1, y1], [x0, y1], [x0, y0 + 1]]) m.mouse.move(x, y);
  m.mouse.up(x0, y0 + 1);
}

test("lasso selects enclosed strokes and images, not outside ones", () => {
  const m = setup();
  m.pg.strokes.push(m.stroke("a", [[10, 10], [30, 30]]), m.stroke("b", [[200, 200], [220, 220]]));
  m.pg.objects.push({ type: "image", id: "im1", x: 40, y: 40, w: 30, h: 30, mime: "image/png", data: "" });
  lassoRect(m, 0, 0, 100, 100);
  assert.equal(m.Selection.count(), 2);
});

test("ctrl-drag makes a rectangular marquee; tiny marquee just clears", () => {
  const m = setup();
  m.pg.strokes.push(m.stroke("a", [[10, 10], [30, 30]]));
  m.mouse.down(0, 0, { ctrlKey: true }); m.mouse.move(100, 100, { ctrlKey: true }); m.mouse.up(100, 100, { ctrlKey: true });
  assert.equal(m.Selection.count(), 1);
  m.mouse.down(300, 300, { ctrlKey: true }); m.mouse.up(301, 301, { ctrlKey: true });
  assert.equal(m.Selection.count(), 0);
});

test("click selects top stroke; shift-click toggles; click empty clears", () => {
  const m = setup();
  m.pg.strokes.push(m.stroke("a", [[0, 0], [100, 0]]), m.stroke("b", [[0, 50], [100, 50]]));
  m.mouse.down(50, 1); m.mouse.up(50, 1);
  assert.equal(m.Selection.count(), 1);
  m.mouse.down(50, 50, { shiftKey: true }); m.mouse.up(50, 50, { shiftKey: true });
  assert.equal(m.Selection.count(), 2);
  m.mouse.down(50, 50, { shiftKey: true }); m.mouse.up(50, 50, { shiftKey: true });
  assert.equal(m.Selection.count(), 1);
  m.mouse.down(500, 500); m.mouse.up(500, 500);
  assert.equal(m.Selection.count(), 0);
});

test("dragging moves the selection and undo restores exact points", () => {
  const m = setup();
  m.pg.strokes.push(m.stroke("a", [[10, 10], [30, 30]]));
  m.mouse.down(20, 20); m.mouse.move(70, 45); m.mouse.up(70, 45);
  assert.deepEqual(Array.from(m.pg.strokes[0].points, (p) => [p.x, p.y]), [[60, 35], [80, 55]]);
  assert.equal(m.History.depth(), 1);
  m.undo();
  assert.deepEqual(Array.from(m.pg.strokes[0].points, (p) => [p.x, p.y]), [[10, 10], [30, 30]]);
});

test("a click without movement pushes no undo entry", () => {
  const m = setup();
  m.pg.strokes.push(m.stroke("a", [[10, 10], [30, 30]]));
  m.mouse.down(20, 20); m.mouse.up(20, 20);
  assert.equal(m.History.depth(), 0);
});

test("corner handle scales uniformly about the opposite corner, widths too; undo restores", () => {
  const m = setup();
  m.pg.strokes.push(m.stroke("a", [[10, 10], [50, 50]], { width: 2 })); // padded box 9..51
  m.mouse.down(20, 20); m.mouse.up(20, 20); // select
  m.mouse.down(51, 51);                      // se handle
  m.mouse.move(93, 93);                      // anchor (9,9): factor 84/42 = 2
  m.mouse.up(93, 93);
  const s = m.pg.strokes[0];
  assert.deepEqual(Array.from(s.points, (p) => [p.x, p.y]), [[11, 11], [91, 91]]);
  assert.equal(s.width, 4);
  m.undo();
  const u = m.pg.strokes[0]; // undo restores copies, so look the stroke up again
  assert.deepEqual(Array.from(u.points, (p) => [p.x, p.y]), [[10, 10], [50, 50]]);
  assert.equal(u.width, 2);
});

test("delete removes strokes+images; undo reinserts at original indices", () => {
  const m = setup();
  m.pg.strokes.push(m.stroke("a", [[0, 0], [5, 5]]), m.stroke("b", [[20, 20], [25, 25]]), m.stroke("c", [[0, 2], [5, 7]]));
  lassoRect(m, -30, -30, 12, 12);                     // selects a and c (starts away from any ink)
  assert.equal(m.Selection.count(), 2);
  m.fire("doc", "keydown", { key: "Delete", target: { tagName: "BODY" } });
  assert.deepEqual(ids(m.pg.strokes), ["b"]);
  m.undo();
  assert.deepEqual(ids(m.pg.strokes), ["a", "b", "c"]);
});

test("to front / to back reorder strokes and undo restores order", () => {
  const m = setup();
  m.pg.strokes.push(m.stroke("a", [[0, 0], [5, 5]]), m.stroke("b", [[50, 50], [55, 55]]), m.stroke("c", [[100, 100], [105, 105]]));
  m.mouse.down(2, 2); m.mouse.up(2, 2);               // select a
  m.Selection.ops.reorder(true);
  assert.deepEqual(ids(m.pg.strokes), ["b", "c", "a"]);
  m.Selection.ops.reorder(false);
  assert.deepEqual(ids(m.pg.strokes), ["a", "b", "c"]);
  m.undo(); assert.deepEqual(ids(m.pg.strokes), ["b", "c", "a"]);
  m.undo(); assert.deepEqual(ids(m.pg.strokes), ["a", "b", "c"]);
});

test("ctrl+a selects everything; dragging any selected item moves them all", () => {
  const m = setup();
  m.pg.strokes.push(m.stroke("a", [[0, 0], [40, 40]]), m.stroke("b", [[100, 100], [140, 140]]));
  m.fire("doc", "keydown", { key: "a", ctrlKey: true, target: { tagName: "BODY" } });
  assert.equal(m.Selection.count(), 2);
  m.mouse.down(120, 120); m.mouse.move(130, 120); m.mouse.up(130, 120);
  assert.deepEqual(xs(m.pg.strokes), [10, 110]);
  assert.equal(m.Selection.count(), 2);
});

test("recolor changes only strokes and undo restores", () => {
  const m = setup();
  m.pg.strokes.push(m.stroke("a", [[0, 0], [5, 5]]));
  m.pg.objects.push({ type: "image", id: "im", x: 0, y: 0, w: 30, h: 30, mime: "image/png", data: "" });
  m.Selection.selectAll();
  m.Selection.ops.recolor("#ff0000");
  assert.equal(m.pg.strokes[0].color, "#ff0000");
  m.undo();
  assert.equal(m.pg.strokes[0].color, "#000000");
});

test("copy, paste and duplicate create independent copies with new ids; undo removes them", () => {
  const m = setup();
  m.pg.strokes.push(m.stroke("a", [[10, 10], [30, 30]]));
  m.mouse.down(20, 20); m.mouse.up(20, 20);
  m.fire("doc", "keydown", { key: "d", ctrlKey: true, target: { tagName: "BODY" } });
  assert.equal(m.pg.strokes.length, 2);
  assert.notEqual(m.pg.strokes[1].id, "a");
  assert.notEqual(m.pg.strokes[1].points, m.pg.strokes[0].points);
  assert.equal(m.Selection.count(), 1, "the duplicate becomes the selection");
  m.undo();
  assert.equal(m.pg.strokes.length, 1);

  m.mouse.down(20, 20); m.mouse.up(20, 20);
  m.fire("doc", "keydown", { key: "x", ctrlKey: true, target: { tagName: "BODY" } }); // cut
  assert.equal(m.pg.strokes.length, 0);
  let prevented = false;
  m.fire("doc", "paste", { clipboardData: { items: [] }, target: { tagName: "BODY" }, preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(m.pg.strokes.length, 1);
  assert.equal(m.pg.strokes[0].width, 2);
});

test("paste yields to a system image on the clipboard", () => {
  const m = setup();
  m.pg.strokes.push(m.stroke("a", [[10, 10], [30, 30]]));
  m.mouse.down(20, 20); m.mouse.up(20, 20);
  m.fire("doc", "keydown", { key: "c", ctrlKey: true, target: { tagName: "BODY" } });
  m.fire("doc", "paste", { clipboardData: { items: [{ kind: "file", type: "image/png" }] }, target: { tagName: "BODY" } });
  assert.equal(m.pg.strokes.length, 1, "images.js owns system-image pastes");
});

test("selection is dropped when the tool changes away from select", () => {
  const m = setup();
  m.pg.strokes.push(m.stroke("a", [[10, 10], [30, 30]]));
  m.mouse.down(20, 20); m.mouse.up(20, 20);
  assert.equal(m.Selection.count(), 1);
  m.S.tool = "pen";
  m.Selection.overlay(m.g, m.pg);
  assert.equal(m.Selection.count(), 0);
});

test("handlers ignore the pen tool", () => {
  const m = setup();
  m.S.tool = "pen";
  m.pg.strokes.push(m.stroke("a", [[10, 10], [30, 30]]));
  m.mouse.down(20, 20); m.mouse.up(20, 20);
  assert.equal(m.Selection.count(), 0);
});

// ---------- graphs and shapes ----------
const plain = (x) => JSON.parse(JSON.stringify(x)); // objects built inside the vm have a foreign prototype
const graph = (id, extra = {}) => ({ type: "graph", id, x: 100, y: 100, size: 200, xmin: -5, xmax: 5, ymin: -5, ymax: 5, step: 1, labels: true, axes: true, grid: true, ...extra });
const shape = (id, kind, points, extra = {}) => ({ type: "shape", id, kind, color: "#000000", width: 2, points, ...extra });

test("tapping a graph selects it, dragging from an unselected graph lassos instead", () => {
  const m = setup();
  m.pg.objects.push(graph("g1"));
  m.pg.strokes.push(m.stroke("a", [[150, 150], [170, 170]]));        // ink on top of the graph
  m.mouse.down(280, 280); m.mouse.up(280, 280);                        // tap on empty graph area
  assert.deepEqual(plain(m.Selection.selected()), [{ kind: "graph", id: "g1" }]);
  m.Selection.clear();
  lassoRect(m, 120, 120, 200, 200);                                    // lasso over the ink, starting on the graph
  assert.deepEqual(plain(m.Selection.selected()), [{ kind: "stroke", id: "a" }], "the graph is not grabbed by a partial lasso");
});

test("a lasso only takes a graph when it fully encloses it", () => {
  const m = setup();
  m.pg.objects.push(graph("g1"));
  lassoRect(m, 50, 50, 400, 400);
  assert.deepEqual(plain(m.Selection.selected()), [{ kind: "graph", id: "g1" }]);
});

test("a selected graph moves and scales as a vector object; undo and redo restore it", () => {
  const m = setup();
  m.pg.objects.push(graph("g1"));
  m.mouse.down(280, 280); m.mouse.up(280, 280);
  m.mouse.down(280, 280); m.mouse.move(300, 290); m.mouse.up(300, 290);   // drag inside the selected graph
  let g = m.pg.objects[0];
  assert.equal(g.type, "graph"); assert.equal(g.x, 120); assert.equal(g.y, 110);
  m.mouse.down(320, 310); m.mouse.move(420, 410); m.mouse.up(420, 410);   // se handle: anchor (120,110), 200 -> 300
  g = m.pg.objects[0];
  assert.equal(g.size, 300);
  m.undo(); m.undo();
  assert.deepEqual([m.pg.objects[0].x, m.pg.objects[0].size], [100, 200]);
  m.redo();
  assert.deepEqual([m.pg.objects[0].x, m.pg.objects[0].size], [120, 200]);
  m.redo();
  assert.equal(m.pg.objects[0].size, 300);
});

test("copy/paste and duplicate keep graphs and shapes as vector objects with new ids", () => {
  const m = setup();
  m.pg.objects.push(graph("g1"), shape("s1", "rect", [[0, 0], [40, 0], [40, 30], [0, 30]]));
  m.Selection.selectAll();
  m.fire("doc", "keydown", { key: "d", ctrlKey: true, target: { tagName: "BODY" } });
  assert.equal(m.pg.objects.length, 4);
  const [g2, s2] = m.pg.objects.slice(2);
  assert.equal(g2.type, "graph"); assert.equal(s2.type, "shape");
  assert.notEqual(g2.id, "g1"); assert.notEqual(s2.id, "s1");
  assert.equal(g2.size, 200);
  assert.notEqual(s2.points, m.pg.objects[1].points);
  assert.equal(s2.points[0][0], 24, "shape moved by the paste offset");
  assert.equal(m.Selection.count(), 2);
  m.undo();
  assert.equal(m.pg.objects.length, 2);
  m.redo();
  assert.equal(m.pg.objects.length, 4);
});

test("shapes are selectable by click and lasso, move, scale (ellipse radii), recolor and delete", () => {
  const m = setup();
  m.pg.objects.push(shape("e", "ellipse", [[100, 100], [40, 20]]), shape("l", "line", [[300, 300], [400, 300]]));
  m.mouse.down(140, 100); m.mouse.up(140, 100);                            // on the ellipse outline
  assert.deepEqual(plain(m.Selection.selected()), [{ kind: "shape", id: "e" }]);
  m.mouse.down(140, 100); m.mouse.move(150, 120); m.mouse.up(150, 120);
  assert.deepEqual(plain(m.pg.objects[0].points), [[110, 120], [40, 20]]);
  // box is x 69..151, y 99..141 (padded by half the line width); se handle scaled about nw
  m.mouse.down(151, 141); m.mouse.move(233, 183); m.mouse.up(233, 183);
  assert.deepEqual(plain(m.pg.objects[0].points[1]), [80, 40]);
  m.Selection.ops.recolor("#ff0000");
  assert.equal(m.pg.objects[0].color, "#ff0000");
  m.Selection.ops.del();
  assert.deepEqual(ids(m.pg.objects), ["l"]);
  for (let i = 0; i < 4; i++) m.undo();
  assert.deepEqual(plain(m.pg.objects[0].points), [[100, 100], [40, 20]]);
  assert.equal(m.pg.objects[0].color, "#000000");
  lassoRect(m, 280, 280, 420, 320);
  assert.deepEqual(plain(m.Selection.selected()), [{ kind: "shape", id: "l" }]);
});

test("flip mirrors a shape's geometry about the selection centre", () => {
  const m = setup();
  m.pg.objects.push(shape("l", "arrow", [[0, 0], [100, 0]], { width: 2 }));
  m.mouse.down(50, 0); m.mouse.up(50, 0);
  m.Selection.ops.flip("h");
  return new Promise((r) => setTimeout(r, 0)).then(() => {
    assert.deepEqual(plain(m.pg.objects[0].points), [[100, 0], [0, 0]]);
  });
});

test("front/back reorders mixed objects", () => {
  const m = setup();
  m.pg.objects.push(shape("s1", "line", [[0, 0], [50, 0]]), shape("s2", "line", [[0, 100], [50, 100]]), graph("g", { x: 500, y: 500 }));
  m.mouse.down(25, 0); m.mouse.up(25, 0);
  m.Selection.ops.reorder(true);
  assert.deepEqual(ids(m.pg.objects), ["s2", "g", "s1"]);
  m.undo();
  assert.deepEqual(ids(m.pg.objects), ["s1", "s2", "g"]);
});
