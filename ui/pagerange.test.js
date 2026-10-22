"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { parseRange } = require("./pagerange.js");

test("empty means all pages", () => assert.deepStrictEqual(parseRange("  ", 3).pages, [1, 2, 3]));
test("ranges and singles, sorted and deduped", () =>
  assert.deepStrictEqual(parseRange("5, 1-3,2", 6).pages, [1, 2, 3, 5]));
test("rejects out of range, backwards and junk", () => {
  assert.match(parseRange("0", 4).error, /between/);
  assert.match(parseRange("2-9", 4).error, /between/);
  assert.match(parseRange("3-1", 4).error, /backwards/);
  assert.match(parseRange("a", 4).error, /not a page/);
  assert.match(parseRange("1,,2", 4).error, /not a page/);
});
