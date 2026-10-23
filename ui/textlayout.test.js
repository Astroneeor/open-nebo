"use strict";
// Run with: node --test ui/textlayout.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("./textlayout.js");

const m = (s) => s.length * 10; // 10px per character

test("wrap: breaks at spaces and keeps all words", () => {
  assert.deepEqual(T.wrap("hello world foo", 110, m), ["hello world", "foo"]);
  assert.deepEqual(T.wrap("hello world", 1000, m), ["hello world"]);
});

test("wrap: explicit newlines and blank lines are kept", () => {
  assert.deepEqual(T.wrap("a\n\nb", 100, m), ["a", "", "b"]);
  assert.deepEqual(T.wrap("", 100, m), [""]);
});

test("wrap: over-long words are split by characters", () => {
  assert.deepEqual(T.wrap("abcdefghij", 40, m), ["abcd", "efgh", "ij"]);
  assert.deepEqual(T.wrap("xx abcdefgh", 40, m), ["xx", "abcd", "efgh"]);
});

test("wrap: never loops on a width smaller than one character", () => {
  assert.equal(T.wrap("abc", 1, m).join(""), "abc");
});

test("layout: height follows line count and size", () => {
  const o = { x: 0, y: 0, w: 100, text: "aaaa bbbb cccc", size: 10, bold: false, italic: false };
  T.setMeasure((s, size) => s.length * size); // 10px per char at size 10
  const l = T.layout(o);
  assert.equal(l.lines.length, 2);
  assert.equal(l.h, 2 * 10 * T.LINE_HEIGHT);
  assert.deepEqual(T.box(o), { x: 0, y: 0, w: 100, h: l.h });
  assert.equal(T.height({ ...o, text: "" }), 10 * T.LINE_HEIGHT, "an empty box is one line tall");
  T.setMeasure(null);
});

test("layout: bigger size wraps into more lines", () => {
  T.setMeasure((s, size) => s.length * size);
  const o = { x: 0, y: 0, w: 120, text: "aaa bbb ccc", size: 10 };
  assert.equal(T.layout(o).lines.length, 1);
  assert.equal(T.layout({ ...o, size: 20 }).lines.length, 3);
  T.setMeasure(null);
});

test("font string reflects bold and italic", () => {
  assert.match(T.font({ size: 20, bold: true, italic: true }), /^italic bold 20px /);
  assert.match(T.font({ size: 20 }), /^20px /);
});
