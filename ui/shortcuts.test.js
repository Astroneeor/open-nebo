"use strict";
// Run: node --test ui/shortcuts.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("./shortcuts.js");

test("parse and format round-trip", () => {
  assert.equal(S.format("ctrl+shift+z"), "Ctrl+Shift+Z");
  assert.equal(S.format("Cmd+Z"), "Ctrl+Z");
  assert.equal(S.canon("Ctrl++"), "Ctrl++");
  assert.equal(S.canon("ctrl+plus"), "Ctrl++");
  assert.equal(S.canon("esc"), "Escape");
  assert.equal(S.canon("shift+?"), "?");
  assert.equal(S.parse(""), null);
  assert.equal(S.parse("Bogus+Z"), null);
  assert.equal(S.parse("Ctrl"), null);
});

test("fromEvent normalizes", () => {
  assert.equal(S.fromEvent({ key: "z", ctrlKey: true, shiftKey: true }), "Ctrl+Shift+Z");
  assert.equal(S.fromEvent({ key: "Z", metaKey: true }), "Ctrl+Z");
  assert.equal(S.fromEvent({ key: "?", shiftKey: true }), "?");
  assert.equal(S.fromEvent({ key: "+", ctrlKey: true, shiftKey: true }), "Ctrl++");
  assert.equal(S.fromEvent({ key: "Shift", shiftKey: true }), null);
  assert.equal(S.fromEvent({ key: " " }), "Space");
  assert.equal(S.fromEvent({ key: "PageDown" }), "PageDown");
});

test("match finds the command", () => {
  const b = { undo: ["Ctrl+Z"], redo: ["Ctrl+Shift+Z", "Ctrl+Y"] };
  assert.equal(S.match(b, "Ctrl+Y"), "redo");
  assert.equal(S.match(b, "ctrl+shift+z"), "redo");
  assert.equal(S.match(b, "Ctrl+Q"), null);
});

test("conflicts are detected", () => {
  assert.deepEqual(S.conflicts({ a: ["Ctrl+Z"], b: ["Ctrl+Y"] }), []);
  const c = S.conflicts({ a: ["Ctrl+Z"], b: ["ctrl+z"], c: ["X"] });
  assert.equal(c.length, 1);
  assert.deepEqual(c[0].ids, ["a", "b"]);
  assert.deepEqual(S.conflictsWith({ a: ["P"], b: ["E"] }, "b", "p"), ["a"]);
});

test("default registry is conflict-free and has the required commands", () => {
  assert.deepEqual(S.conflicts(S.DEFAULTS), []);
  for (const id of ["pen","eraser","select","text","undo","redo","zoomIn","zoomOut","zoomReset","nextPage","prevPage","addPage","smart","snap","background","export"]) assert.ok(S.DEFAULTS[id]?.length, id);
  assert.deepEqual(S.DEFAULTS.redo, ["Ctrl+Shift+Z", "Ctrl+Y"]);
});

test("overrides serialize minimally and apply safely", () => {
  const d = { a: ["P"], b: ["Ctrl+Z", "Ctrl+Y"] };
  assert.deepEqual(S.serializeOverrides(d, d), {});
  const o = S.serializeOverrides({ a: ["q"], b: ["Ctrl+Z", "Ctrl+Y"] }, d);
  assert.deepEqual(o, { a: ["Q"] });
  assert.deepEqual(S.applyOverrides(d, JSON.stringify(o)), { a: ["Q"], b: ["Ctrl+Z", "Ctrl+Y"] });
  assert.deepEqual(S.applyOverrides(d, "not json"), { a: ["P"], b: ["Ctrl+Z", "Ctrl+Y"] });
  assert.deepEqual(S.applyOverrides(d, { zzz: ["X"], a: "bad" }), { a: ["P"], b: ["Ctrl+Z", "Ctrl+Y"] });
  assert.deepEqual(S.applyOverrides(d, { a: [] }).a, []); // explicitly unassigned
});

test("isTyping", () => {
  assert.ok(S.isTyping({ tagName: "INPUT" }));
  assert.ok(S.isTyping({ tagName: "DIV", isContentEditable: true }));
  assert.ok(!S.isTyping({ tagName: "BUTTON" }));
  assert.ok(!S.isTyping(null));
});
