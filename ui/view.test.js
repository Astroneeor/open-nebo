"use strict";
// Run: node --test ui/view.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function load() {
  const sandbox = { window: { devicePixelRatio: 1, addEventListener() {} }, ResizeObserver: class { observe() {} } };
  return vm.runInNewContext(fs.readFileSync(path.join(__dirname, "view.js"), "utf8") + "\n;V", sandbox);
}
function setup(width, height) {
  const V = load();
  const stage = { clientWidth: width, clientHeight: height };
  const cv = { width: 0, height: 0, addEventListener() {}, classList: { add() {}, remove() {} }, getBoundingClientRect: () => ({ left: 0, top: 0 }) };
  V.init(cv, stage, () => null, () => {});
  return { V, stage, cv };
}
const page = { id: "p1", width: 1404, height: 1872 };

test("a fresh page is fitted to the stage width, capped at 100%", () => {
  const { V } = setup(1000, 700);
  V.sync(page);
  assert.ok(Math.abs(V.zoom - (1000 - 32) / 1404) < 1e-9);
});

test("a hidden stage (library showing) must not bind the page at the minimum zoom", () => {
  const { V, stage } = setup(0, 0);
  V.sync(page);               // the editor is still hidden: nothing to fit against yet
  stage.clientWidth = 1000; stage.clientHeight = 700; // the editor is shown
  V.sync(page);
  assert.ok(V.zoom > 0.5, `zoom should be fitted to the visible stage, got ${V.zoom}`);
});

test("a saved view is restored once the stage is visible", () => {
  const { V } = setup(1000, 700);
  V.sync({ ...page, view: { x: 10, y: 20, zoom: 2 } });
  assert.equal(V.zoom, 2);
  assert.equal(V.x, 10);
});
