"use strict";
// Run: node --test ui/a11y.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Icons = require("./icons.js");
const read = (f) => fs.readFileSync(path.join(__dirname, f), "utf8");

test("every <button> in index.html has an accessible name", () => {
  const html = read("index.html");
  const bad = [];
  for (const m of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
    const [, attrs, inner] = m;
    if (!/\b(title|aria-label)="[^"]+"/.test(attrs) && !inner.replace(/<[^>]*>/g, "").trim()) bad.push(attrs.trim());
  }
  assert.deepEqual(bad, []);
});

test("every data-icon in index.html is a known icon", () => {
  const names = new Set(Icons.names());
  const html = read("index.html");
  for (const m of html.matchAll(/data-icon="([^"]+)"/g)) assert.ok(names.has(m[1]), `unknown icon ${m[1]}`);
});

test("#status is a polite live region", () => {
  assert.match(read("index.html"), /id="status"[^>]*role="status"[^>]*aria-live="polite"/);
});

test("style.css has focus-visible and reduced-motion rules", () => {
  const css = read("style.css");
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
});

// WCAG relative luminance contrast for the --fg-3 token against every background token, in both themes.
const lum = (h) => { const c = [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
function tokens(block) { const o = {}; for (const m of block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})\b/gi)) o[m[1]] = m[2]; return o; }

test("--fg-3 and --fg-2 reach 4.5:1 on all surfaces in both themes", () => {
  const css = read("style.css");
  const light = tokens(css.slice(css.indexOf(":root {"), css.indexOf("@media (prefers-color-scheme: dark)")));
  const dark = tokens(css.slice(css.indexOf(':root[data-theme="dark"]')));
  for (const [name, t] of [["light", light], ["dark", dark]]) {
    for (const fg of ["fg", "fg-2", "fg-3"]) for (const bg of ["bg", "surface", "surface-2", "surface-3"]) {
      assert.ok(t[fg] && t[bg], `${name}: missing ${fg}/${bg}`);
      assert.ok(ratio(t[fg], t[bg]) >= 4.5, `${name}: --${fg} on --${bg} is ${ratio(t[fg], t[bg]).toFixed(2)}`);
    }
  }
});
