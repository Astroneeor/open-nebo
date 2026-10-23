"use strict";
// Run: node --test ui/input.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const I = require("./input.js");

const ev = (pointerType, buttons = 0, extra = {}) => ({ pointerType, buttons, button: 0, pointerId: 1, ...extra });
const withPen = (now = 0) => { const tr = I.newTracker(); I.observe(tr, ev("pen"), "move", now); return tr; };
const act = (e, s, tr, now = 0) => I.classify(e, s, tr, now).action;

test("mouse always draws regardless of settings", () => {
  for (const touch of I.CHOICES.touch) assert.equal(act(ev("mouse", 1), { touch }, withPen()), "draw");
});
test("touch before any pen: auto draws", () => {
  assert.equal(act(ev("touch"), {}, I.newTracker(), 0), "draw");
});
test("touch after a pen has been seen: auto pans only (view), once the palm window passed", () => {
  const tr = withPen(0);
  assert.equal(act(ev("touch"), {}, tr, I.PALM_MS + 1), "view");
});
test("palm window: touch ignored while pen in contact and for ~1s after", () => {
  const tr = I.newTracker();
  I.observe(tr, ev("pen"), "down", 100);
  assert.equal(act(ev("touch"), {}, tr, 5000), "ignore"); // still in contact, however long
  I.observe(tr, ev("pen"), "up", 5000);
  assert.equal(act(ev("touch"), {}, tr, 5000 + I.PALM_MS - 1), "ignore");
  assert.equal(act(ev("touch"), {}, tr, 5000 + I.PALM_MS), "view");
});
test("touch=draw disables palm rejection", () => {
  const tr = I.newTracker(); I.observe(tr, ev("pen"), "down", 0);
  assert.equal(act(ev("touch"), { touch: "draw" }, tr, 10), "draw");
});
test("touch=pan never draws, even with no pen seen", () => {
  assert.equal(act(ev("touch"), { touch: "pan" }, I.newTracker(), 0), "view");
});
test("touch=pen ignores touch entirely", () => {
  assert.equal(act(ev("touch"), { touch: "pen" }, I.newTracker(), 0), "ignore");
});
test("observe only tracks pen events", () => {
  const tr = I.newTracker(); I.observe(tr, ev("touch"), "down", 0); I.observe(tr, ev("mouse"), "down", 0);
  assert.equal(tr.seenEver, false); assert.equal(I.penNear(tr, 0), false);
});
test("penButton decoding", () => {
  assert.equal(I.penButton(ev("pen", 0)), null);
  assert.equal(I.penButton(ev("pen", 1)), null);
  assert.equal(I.penButton(ev("pen", 2)), "barrel");
  assert.equal(I.penButton(ev("pen", 1 | 2)), "barrel");
  assert.equal(I.penButton(ev("pen", 32)), "eraserEnd");
  assert.equal(I.penButton(ev("pen", 0, { button: 5 })), "eraserEnd");
  assert.equal(I.penButton(ev("pen", 2 | 32)), "eraserEnd");
});
test("defaults: eraser end erases, barrel does nothing", () => {
  const tr = withPen();
  assert.deepEqual(I.classify(ev("pen", 32), {}, tr, 0), { action: "tool", tool: "erase", button: "eraserEnd" });
  assert.equal(act(ev("pen", 2), {}, tr), "draw");
  assert.equal(act(ev("pen", 1), {}, tr), "draw");
});
test("configured stylus button actions", () => {
  const tr = withPen();
  assert.deepEqual(I.classify(ev("pen", 2), { barrel: "select" }, tr, 0), { action: "tool", tool: "select", button: "barrel" });
  assert.deepEqual(I.classify(ev("pen", 2), { barrel: "erase" }, tr, 0), { action: "tool", tool: "erase", button: "barrel" });
  assert.equal(act(ev("pen", 2), { barrel: "pan" }, tr), "pan");
  assert.equal(act(ev("pen", 32), { eraserEnd: "pan" }, tr), "pan");
  assert.equal(act(ev("pen", 32), { eraserEnd: "none" }, tr), "draw");
});
test("pen buttons do not affect mouse or touch", () => {
  const tr = withPen();
  assert.equal(act(ev("mouse", 2), { barrel: "erase" }, tr), "draw");
  assert.equal(act(ev("touch", 32), { touch: "draw", eraserEnd: "erase" }, tr), "draw");
});
test("sanitize rejects junk and fills defaults", () => {
  assert.deepEqual(I.sanitize(null), I.DEFAULTS);
  assert.deepEqual(I.sanitize({ touch: "bogus", barrel: "pan" }), { ...I.DEFAULTS, barrel: "pan" });
});
test("describe", () => {
  assert.match(I.describe(null), /No pointer/);
  assert.equal(I.describe({ pointerType: "pen", pressure: 0.5, buttons: 2 }), "pen | pressure 0.50 | buttons 2");
});
