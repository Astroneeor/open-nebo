const test = require("node:test"), assert = require("node:assert/strict");
const { ColorMath: M, BUILTIN_PALETTES } = require("./colorpicker.js");

test("hsbToRgb primaries and greys", () => {
  assert.deepEqual(M.hsbToRgb(0, 1, 1), [255, 0, 0]);
  assert.deepEqual(M.hsbToRgb(120, 1, 1), [0, 255, 0]);
  assert.deepEqual(M.hsbToRgb(240, 1, 1), [0, 0, 255]);
  assert.deepEqual(M.hsbToRgb(60, 1, 1), [255, 255, 0]);
  assert.deepEqual(M.hsbToRgb(0, 0, 0.5), [128, 128, 128]);
  assert.deepEqual(M.hsbToRgb(360, 1, 1), [255, 0, 0]);
  assert.deepEqual(M.hsbToRgb(-120, 1, 1), [0, 0, 255]);
});

test("rgbToHsb known values", () => {
  assert.deepEqual(M.rgbToHsb(255, 0, 0), [0, 1, 1]);
  assert.deepEqual(M.rgbToHsb(0, 0, 0), [0, 0, 0]);
  assert.deepEqual(M.rgbToHsb(255, 255, 255), [0, 0, 1]);
  assert.deepEqual(M.rgbToHsb(0, 0, 255), [240, 1, 1]);
});

test("rgb -> hsb -> rgb round trips over a sample of the cube", () => {
  for (let r = 0; r < 256; r += 51) for (let g = 0; g < 256; g += 51) for (let b = 0; b < 256; b += 51) {
    assert.deepEqual(M.hsbToRgb(...M.rgbToHsb(r, g, b)), [r, g, b]);
  }
});

test("toHex omits alpha when opaque and writes it otherwise", () => {
  assert.equal(M.toHex(255, 0, 128), "#ff0080");
  assert.equal(M.toHex(255, 0, 128, 1), "#ff0080");
  assert.equal(M.toHex(0, 0, 0, 0.5), "#00000080");
  assert.equal(M.toHex(300, -4, 0), "#ff0000");
});

test("parseHex accepts 3/4/6/8 digits, with or without #", () => {
  assert.deepEqual(M.parseHex("#f00"), { r: 255, g: 0, b: 0, a: 1 });
  assert.deepEqual(M.parseHex("0f08"), { r: 0, g: 255, b: 0, a: 0.533 });
  assert.deepEqual(M.parseHex("#1e2a5a"), { r: 30, g: 42, b: 90, a: 1 });
  assert.deepEqual(M.parseHex("#00000080"), { r: 0, g: 0, b: 0, a: 0.502 });
  for (const bad of ["", "#", "#12", "#12345", "#1234567", "#ggg", "red", "#12345g"]) assert.equal(M.parseHex(bad), null, bad);
});

test("alpha survives hex round trip", () => {
  const p = M.parseHex("#12345680");
  assert.equal(M.toHex(p.r, p.g, p.b, p.a), "#12345680");
});

test("built-in palettes are valid colours", () => {
  for (const p of BUILTIN_PALETTES) for (const c of p.colors) assert.ok(M.parseHex(c), `${p.name} ${c}`);
});
