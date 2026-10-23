"use strict";
// Run with: node --test ui/text.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const Text = require("./text.js");

test("plainText joins typed text in object order and ignores other objects", () => {
  const pg = { strokes: [], objects: [
    { type: "text", id: "a", text: "first" },
    { type: "shape", id: "s", kind: "rect", points: [] },
    { type: "text", id: "b", text: "second\nline" },
    { type: "text", id: "c", text: "" },
  ] };
  assert.equal(Text.plainText(pg), "first\nsecond\nline");
  assert.equal(Text.plainText({ strokes: [] }), "");
  assert.equal(Text.plainText(null), "");
});
