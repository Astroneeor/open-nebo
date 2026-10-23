"use strict";
// Headless wiring test: loads the real app.js with stubbed browser/Tauri globals and drives pen, eraser,
// shape-snap, Undo / Redo buttons and keyboard shortcuts. Run: node --test ui/app.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function boot() {
  const els = {};
  const mkEl = () => ({ dataset: {}, style: {}, children: [], hidden: false, value: "", textContent: "", classList: { add() {}, remove() {}, toggle() {} },
    append() {}, replaceChildren() {}, addEventListener() {}, setPointerCapture() {}, getContext: () => new Proxy({}, { get: () => () => {}, set: () => true }), clientWidth: 800, clientHeight: 600 });
  const getEl = (id) => (els[id] ||= mkEl());
  const listeners = { cv: {}, win: {} };
  const cv = getEl("cv");
  cv.addEventListener = (t, f) => { (listeners.cv[t] ||= []).push(f); };
  getEl("color").value = "#000000"; getEl("width").value = "2";
  const page = { id: "p1", width: 100, height: 100, strokes: [], objects: [] };
  const doc = { title: "t", pages: [page] };
  const sandbox = {
    console, structuredClone, Math, Promise, setTimeout, clearTimeout, performance: { now: () => 0 }, crypto: { randomUUID: (() => { let n = 0; return () => "id" + ++n; })() },
    window: null, localStorage: { getItem: () => null, setItem() {} },
    document: { getElementById: getEl, createElement: mkEl },
    V: { zoom: 1, x: 0, y: 0, sync() {}, begin() {}, end() {}, toWorld: (ev) => ({ x: ev.x, y: ev.y }), down: () => false, move: () => false, up: () => false,
         init() {}, zoomBy() {}, reset() {} },
    Pens: require("./pens.js"), Images: { draw() {} }, Selection: { overlay() {} },
    Shapes: { HOLD_MS: 500, HOLD_RADIUS: 4, recognize: (pts) => (pts.length === 3 ? { kind: "line", points: [[0, 0], [10, 10]] } : null), drawShape() {}, hitShape: (o, p) => o.id === "hit" },
  };
  sandbox.window = { __TAURI__: { core: { invoke: async (cmd) => (cmd === "list_vault" ? [] : cmd === "default_vault" ? "/v" : undefined) },
                                  event: { listen() {} }, dialog: {} },
                     addEventListener(t, f) { (listeners.win[t] ||= []).push(f); } };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "history.js"), "utf8").replace("const History", "var History"), ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "app.js"), "utf8").replace(/^const /gm, "var ").replace(/^function /gm, "function "), ctx);
  vm.runInContext("S.doc = null;", ctx);
  const run = (code) => vm.runInContext(code, ctx);
  run("S.doc = " + JSON.stringify(doc) + "; S.path = '/x.nebo'; S.rev = 'r';");
  const pg = () => run("S.doc.pages[0]");
  const fire = (kind, type, ev) => { const e = { pointerId: 1, preventDefault() {}, target: { tagName: "BODY" }, ...ev }; for (const f of listeners[kind][type] || []) f(e); };
  const pen = (pts, ev = {}) => {
    fire("cv", "pointerdown", { x: pts[0][0], y: pts[0][1], ...ev });
    for (const [x, y] of pts.slice(1)) fire("cv", "pointermove", { x, y, ...ev });
    fire("cv", "pointerup", { ...ev });
  };
  const key = (k, mods = {}) => fire("win", "keydown", { key: k, ctrlKey: true, ...mods });
  return { run, pg, pen, key, click: (id) => els[id].onclick(), els };
}
const ids = (l) => Array.from(l, (x) => x.id);

test("strokes undo and redo through the buttons and Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y", () => {
  const a = boot();
  a.pen([[0, 0], [10, 0]]); a.pen([[0, 5], [10, 5]]);
  assert.equal(a.pg().strokes.length, 2);
  a.click("undo");
  assert.equal(a.pg().strokes.length, 1);
  a.click("redo");
  assert.equal(a.pg().strokes.length, 2);
  a.key("z"); a.key("z");
  assert.equal(a.pg().strokes.length, 0);
  a.key("z", { shiftKey: true });
  assert.equal(a.pg().strokes.length, 1);
  a.key("y");
  assert.equal(a.pg().strokes.length, 2);
});

test("a new stroke after an undo discards the redo stack", () => {
  const a = boot();
  a.pen([[0, 0], [10, 0]]); a.click("undo");
  a.pen([[0, 9], [10, 9]]);
  a.click("redo");
  assert.equal(a.pg().strokes.length, 1);
});

test("erasing is undoable as one step and redoable", () => {
  const a = boot();
  a.pen([[0, 0], [10, 0]]); a.pen([[0, 5], [10, 5]]);
  a.click("eraser"); a.run("tool('eraser')");
  a.pen([[5, 0], [5, 5]]);                                  // one eraser drag through both strokes
  assert.equal(a.pg().strokes.length, 0);
  a.click("undo");
  assert.equal(a.pg().strokes.length, 2, "both strokes come back with one undo");
  a.click("redo");
  assert.equal(a.pg().strokes.length, 0);
});

test("a smart-shape snap is one undo step, and the stroke is not left behind", () => {
  const a = boot();
  a.run("S.smart = true");
  a.pen([[0, 0], [5, 5], [10, 10]]);                        // fake recognizer turns 3-point strokes into a line
  assert.equal(a.pg().strokes.length, 0);
  assert.deepEqual(ids(a.pg().objects.map((o) => ({ id: o.type }))), ["shape"]);
  a.click("undo");
  assert.equal(a.pg().objects.length, 0);
  a.click("redo");
  assert.equal(a.pg().objects.length, 1);
});

test("shortcuts are ignored while typing in an input", () => {
  const a = boot();
  a.pen([[0, 0], [10, 0]]);
  a.key("z", { target: { tagName: "INPUT" } });
  assert.equal(a.pg().strokes.length, 1);
});

test("undo with an empty history is a no-op, and a conflict blocks it", () => {
  const a = boot();
  a.click("undo"); a.click("redo");
  assert.equal(a.pg().strokes.length, 0);
  a.pen([[0, 0], [10, 0]]);
  a.run("S.conflict = true");
  a.click("undo");
  assert.equal(a.pg().strokes.length, 1);
});
