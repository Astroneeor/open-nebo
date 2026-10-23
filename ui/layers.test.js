"use strict";
// Run: node --test ui/layers.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const Layers = require("./layers.js");

const st = (id, layer) => ({ id, points: [], ...(layer ? { layer } : {}) });
function page() {
  Layers._reset();
  return { id: "p", strokes: [st("a", "L2"), st("b"), st("c", "L1"), st("d", "L2")], objects: [{ type: "shape", id: "s", layer: "L1" }, { type: "image", id: "i" }],
           layers: [{ id: "L1", name: "One", visible: true, locked: false }, { id: "L2", name: "Two", visible: true, locked: false }] };
}
const ids = (l) => l.map((x) => x.id);

test("draw order: base, then layers bottom to top, original order within a layer", () => {
  const v = Layers.drawOrder(page());
  assert.deepEqual(v.map((x) => x.layerId), [null, "L1", "L2"]);
  assert.deepEqual(ids(v[0].strokes), ["b"]); assert.deepEqual(ids(v[0].objects), ["i"]);
  assert.deepEqual(ids(v[1].strokes), ["c"]); assert.deepEqual(ids(v[1].objects), ["s"]);
  assert.deepEqual(ids(v[2].strokes), ["a", "d"]);
});
test("hidden layers are not drawn; hidden base too", () => {
  const pg = page();
  Layers.setVisible(pg, "L1", false);
  assert.deepEqual(Layers.drawOrder(pg).map((x) => x.layerId), [null, "L2"]);
  Layers.setVisible(pg, null, false);
  assert.deepEqual(Layers.drawOrder(pg).map((x) => x.layerId), ["L2"]);
});
test("unknown layer id counts as base", () => {
  const pg = page(); pg.strokes.push(st("z", "gone"));
  assert.equal(Layers.idOf(pg, pg.strokes.at(-1)), null);
  assert.ok(ids(Layers.drawOrder(pg)[0].strokes).includes("z"));
});
test("editable: locked and hidden layers are skipped", () => {
  const pg = page();
  assert.ok(Layers.editable(pg, pg.strokes[0]));
  Layers.setLocked(pg, "L2", true);
  assert.equal(Layers.editable(pg, pg.strokes[0]), false);
  Layers.setLocked(pg, "L2", false); Layers.setVisible(pg, "L2", false);
  assert.equal(Layers.editable(pg, pg.strokes[0]), false);
  Layers.setLocked(pg, null, true);
  assert.equal(Layers.editable(pg, pg.strokes[1]), false);
  assert.equal(Layers.canDraw(pg, null), false);
});
test("stamp uses the active layer and omits it for base", () => {
  const pg = page();
  Layers.setActive(pg, "L2");
  assert.equal(Layers.stamp(pg, {}).layer, "L2");
  Layers.setActive(pg, null);
  assert.equal("layer" in Layers.stamp(pg, { layer: "x" }), false);
  assert.equal(Layers.setActive(pg, "nope"), null);
});
test("delete reassigns to the layer below, or base, and loses nothing", () => {
  const pg = page();
  Layers.setActive(pg, "L2");
  assert.ok(Layers.deleteLayer(pg, "L2"));
  assert.deepEqual(ids(pg.layers), ["L1"]);
  assert.equal(pg.strokes[0].layer, "L1"); assert.equal(pg.strokes[3].layer, "L1");
  assert.equal(Layers.active(pg), "L1");
  Layers.deleteLayer(pg, "L1");
  assert.equal(pg.layers.length, 0);
  assert.ok(pg.strokes.every((s) => !s.layer) && pg.objects.every((o) => !o.layer));
  assert.equal(pg.strokes.length, 4);
  assert.equal(Layers.deleteLayer(pg, "L1"), false);
});
test("reorder swaps neighbours and stops at the ends", () => {
  const pg = page();
  assert.ok(Layers.move(pg, "L1", 1)); assert.deepEqual(ids(pg.layers), ["L2", "L1"]);
  assert.equal(Layers.move(pg, "L1", 1), false);
  assert.equal(Layers.move(pg, "L2", -1), false);
  assert.deepEqual(Layers.drawOrder(pg).map((x) => x.layerId), [null, "L2", "L1"]);
});
test("add, rename, moveItems", () => {
  const pg = page();
  const l = Layers.addLayer(pg, "Notes");
  assert.equal(pg.layers.at(-1), l); assert.equal(l.id, "layer-3");
  assert.ok(Layers.rename(pg, l.id, "  Marks "));
  assert.equal(l.name, "Marks"); assert.equal(Layers.rename(pg, l.id, " "), false);
  Layers.moveItems(pg, [pg.strokes[1]], l.id); assert.equal(pg.strokes[1].layer, l.id);
  Layers.moveItems(pg, [pg.strokes[1]], null); assert.equal("layer" in pg.strokes[1], false);
  assert.equal(Layers.moveItems(pg, [pg.strokes[1]], "nope"), 0);
  const e = { id: "e", strokes: [], objects: [] };
  assert.equal(Layers.addLayer(e).name, "Layer 1");
});
