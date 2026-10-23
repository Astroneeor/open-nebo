"use strict";
// Run: node --test ui/searchui.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("./searchui.js");

const joined = (runs) => runs.map((r) => (r.hit ? `[${r.text}]` : r.text)).join("");

test("highlights every occurrence of every word, case-insensitively", () => {
  assert.equal(joined(S.splitHighlight("Apple pie and APPLE tart", "apple tart")), "[Apple] pie and [APPLE] [tart]");
});
test("accent-insensitive and keeps the original text intact", () => {
  const runs = S.splitHighlight("Une Crème Brûlée", "creme brulee");
  assert.equal(joined(runs), "Une [Crème] [Brûlée]");
  assert.equal(runs.map((r) => r.text).join(""), "Une Crème Brûlée");
});
test("no query or no match gives a single plain run; empty text gives none", () => {
  assert.deepEqual(S.splitHighlight("abc", ""), [{ text: "abc", hit: false }]);
  assert.deepEqual(S.splitHighlight("abc", "zzz"), [{ text: "abc", hit: false }]);
  assert.deepEqual(S.splitHighlight("", "a"), []);
});
test("astral characters and markup are treated as plain text", () => {
  assert.equal(joined(S.splitHighlight("a 😀 <b>x</b>", "x 😀")), "a [😀] <b>[x]</b>");
});
test("debounce collapses bursts and can be cancelled", () => {
  const q = []; let now = 0, n = 0;
  const timers = {
    setTimeout: (f, ms) => { q.push({ f, at: now + ms, id: q.length + 1, live: true }); return q.length; },
    clearTimeout: (id) => { q[id - 1].live = false; },
  };
  const advance = (ms) => { now += ms; q.forEach((t) => { if (t.live && t.at <= now) { t.live = false; t.f(); } }); };
  const calls = [];
  const d = S.debounce((x) => calls.push(x), 250, timers);
  d("a"); advance(100); d("ab"); advance(100); d("abc");
  advance(249); assert.deepEqual(calls, []);
  advance(1); assert.deepEqual(calls, ["abc"]);
  d("x"); d.cancel(); advance(1000); assert.deepEqual(calls, ["abc"]);
  void n;
});
