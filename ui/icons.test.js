"use strict";
// Run: node --test ui/icons.test.js
// Every icon name used by the markup or the scripts must exist in icons.js, otherwise the button would render empty.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Icons = require("./icons.js");

const read = (f) => fs.readFileSync(path.join(__dirname, f), "utf8");
const quoted = (s) => [...s.matchAll(/"([a-z][a-z0-9-]*)"/g)].map((m) => m[1]); // names start with a letter ("14" is a size)

function used() {
  const found = new Map(); // name -> where
  const add = (name, where) => { if (name && !found.has(name)) found.set(name, where); };
  for (const m of read("index.html").matchAll(/data-icon="([^"]+)"/g)) add(m[1], "index.html");

  const lib = read("library.js");
  for (const m of lib.matchAll(/\bicon:\s*([^}\n]*)/g)) quoted(m[1]).forEach((n) => add(n, "library.js"));
  for (const m of lib.matchAll(/actionBtn\("[^"]+",\s*"([^"]+)"/g)) add(m[1], "library.js actionBtn");
  for (const m of lib.matchAll(/dataset:\s*\{\s*icon:\s*([^}]*)\}/g)) quoted(m[1]).forEach((n) => add(n, "library.js dataset"));

  const chrome = read("chrome.js");
  for (const m of chrome.matchAll(/iconise\([^,]+,\s*"([^"]+)"/g)) add(m[1], "chrome.js iconise");
  const sel = chrome.match(/SEL_ICONS = \{([^}]*)\}/);
  for (const m of sel[1].matchAll(/:\s*"([^"]+)"/g)) add(m[1], "chrome.js SEL_ICONS");
  for (const m of chrome.matchAll(/dataset\.icon\s*=\s*([^;]+);/g)) quoted(m[1]).forEach((n) => add(n, "chrome.js dataset.icon"));
  return found;
}

test("the icon set is non-trivial and every entry is SVG markup", () => {
  assert.ok(Icons.names().length >= 40);
  for (const [name, inner] of Object.entries(Icons.PATHS)) assert.match(inner, /^<[a-z]/, `${name} should be SVG elements`);
});

test("every icon name referenced by the app exists", () => {
  const have = new Set(Icons.names());
  const missing = [...used()].filter(([name]) => !have.has(name)).map(([name, where]) => `${name} (${where})`);
  assert.deepEqual(missing, []);
});

test("the scan actually finds the icons (guards against the regexes silently matching nothing)", () => {
  assert.ok(used().size >= 25, `only found ${used().size}`);
});
