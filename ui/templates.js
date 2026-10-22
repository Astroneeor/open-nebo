"use strict";
// Built-in page backgrounds (lined / grid / dotted), drawn in world coordinates over the page
// rectangle (0,0,width,height), under the ink. Nothing is stored in the file but the template name.
(function (root) {
  const NAMES = ["lined", "grid", "dotted"];
  const LINE = "#c5d3ea", EDGE = "#d4d9e2", TOP = 140, GAP = 44, CELL = 40;

  function draw(ctx, pg) {
    if (!pg || !NAMES.includes(pg.template)) return;
    const { width: w, height: h } = pg;
    ctx.save();
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = EDGE; ctx.lineWidth = 2; ctx.strokeRect(0, 0, w, h);
    ctx.strokeStyle = LINE; ctx.fillStyle = LINE; ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (pg.template === "lined") {
      for (let y = TOP; y < h; y += GAP) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
      ctx.stroke();
    } else if (pg.template === "grid") {
      for (let x = CELL; x < w; x += CELL) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
      for (let y = CELL; y < h; y += CELL) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
      ctx.stroke();
    } else {
      for (let y = CELL; y < h; y += CELL) for (let x = CELL; x < w; x += CELL) { ctx.moveTo(x + 2, y); ctx.arc(x, y, 2, 0, Math.PI * 2); }
      ctx.fill();
    }
    ctx.restore();
  }

  const api = { NAMES, draw };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.Templates = api;
})(typeof window !== "undefined" ? window : globalThis);
