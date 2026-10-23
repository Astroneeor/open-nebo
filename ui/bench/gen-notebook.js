"use strict";
// Generate a synthetic page with N strokes (default 50000), laid out as lines of handwriting-like squiggles.
// Usage: node ui/bench/gen-notebook.js [count] [out.json]   (prints to stdout when no out file)
const fs = require("node:fs");

function gen(n = 50000, seed = 1) {
  let r = seed >>> 0;
  const rnd = () => ((r = (r * 1664525 + 1013904223) >>> 0) / 4294967296);
  const cols = 100, strokes = [];
  for (let i = 0; i < n; i++) {
    const x0 = (i % cols) * 28, y0 = Math.floor(i / cols) * 36, pts = [];
    const m = 8 + Math.floor(rnd() * 24);
    for (let k = 0; k < m; k++) pts.push({ x: +(x0 + k * 0.7 + rnd() * 3).toFixed(2), y: +(y0 + Math.sin(k / 2) * 6 + rnd() * 2).toFixed(2), t: k * 8, p: 0.5 });
    strokes.push({ id: "s" + i, color: "#222222", width: 2, points: pts });
  }
  return { id: "bench", width: cols * 28, height: Math.ceil(n / cols) * 36 + 40, strokes, objects: [] };
}
module.exports = { gen };
if (require.main === module) {
  const json = JSON.stringify(gen(+process.argv[2] || 50000));
  if (process.argv[3]) fs.writeFileSync(process.argv[3], json); else process.stdout.write(json);
}
