"use strict";
const test = require("node:test");
const assert = require("node:assert");
const Templates = require("./templates.js");

function rec() {
  const calls = [];
  return new Proxy({}, { get: (_, k) => (k === "calls" ? calls : (...a) => { calls.push(k); }), set: () => true });
}

test("no template or unknown template draws nothing", () => {
  const c = rec();
  Templates.draw(c, { width: 100, height: 100 });
  Templates.draw(c, { width: 100, height: 100, template: "evil" });
  assert.strictEqual(c.calls.length, 0);
});

test("each template draws within a save/restore pair", () => {
  for (const t of Templates.NAMES) {
    const c = rec();
    Templates.draw(c, { width: 400, height: 400, template: t });
    assert.strictEqual(c.calls[0], "save");
    assert.strictEqual(c.calls[c.calls.length - 1], "restore");
    assert.ok(c.calls.length > 6, t);
  }
});
