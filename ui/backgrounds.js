"use strict";
// Canvas backgrounds: a pattern (plain / paper / grid / dot) over a base colour, drawn in world
// coordinates under the ink so it pans and zooms with the infinite canvas. The line and dot ink is
// derived from the base colour: a darker tint on light bases, a lighter tint on dark ones.
(function (root) {
  const PATTERNS = ["plain", "paper", "grid", "dot"];
  const DEFAULT = { pattern: "plain", color: "#ffffff" };

  // The fixed choices offered by the picker. Blueprint is a grid on a deep blue; its lines are boosted (BOOST)
  // because a 14% tint barely shows on a saturated base.
  const BLUEPRINT = "#1d3f7a";
  const PRESETS = [
    { id: "plain", name: "Light", pattern: "plain", color: "#ffffff" },
    { id: "plain-dark", name: "Dark", pattern: "plain", color: "#1e1e1e" },
    { id: "paper", name: "Light paper", pattern: "paper", color: "#f6f1e4" },
    { id: "paper-dark", name: "Dark paper", pattern: "paper", color: "#2a2a2e" },
    { id: "dot", name: "Light dot grid", pattern: "dot", color: "#ffffff" },
    { id: "dot-dark", name: "Dark dot grid", pattern: "dot", color: "#1e1e1e" },
    { id: "grid", name: "Light grid", pattern: "grid", color: "#ffffff" },
    { id: "grid-dark", name: "Dark grid", pattern: "grid", color: "#1e1e1e" },
    { id: "blueprint", name: "Blueprint", pattern: "grid", color: BLUEPRINT },
  ];
  const BOOST = { [BLUEPRINT]: 1.9 };

  // World-unit spacing of each pattern at zoom 1, and the smallest on-screen gap (CSS px) before the
  // pattern doubles its spacing. Doubling keeps lines aligned to world multiples, so nothing swims.
  const GAP = { paper: 44, grid: 40, dot: 40 };
  const MIN_PX = { paper: 9, grid: 9, dot: 14 };
  const MAX_DOTS = 30000;

  const HEX = /^#[0-9a-fA-F]{6}$/;
  const isHex = (c) => typeof c === "string" && HEX.test(c);

  function parseHex(c) {
    if (!isHex(c)) return null;
    return [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  }
  const toHex = (rgb) => "#" + rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("");

  /** WCAG relative luminance, 0 (black) .. 1 (white). */
  function luminance(c) {
    const rgb = parseHex(c);
    if (!rgb) return 1;
    const [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  const isDark = (c) => luminance(c) < 0.2;

  function mix(a, b, t) {
    const x = parseHex(a), y = parseHex(b);
    return toHex(x.map((v, i) => v + (y[i] - v) * t));
  }

  /**
   * Ink for the pattern on `base`: kind "line" (paper/grid), "major" (every fifth grid line) or "dot".
   * Dark bases get a lighter tint, light bases a darker one; never alpha, so crossings don't double up.
   */
  function inkFor(base, kind) {
    if (!isHex(base)) base = DEFAULT.color;
    const dark = isDark(base);
    const amount = ({ line: dark ? 0.14 : 0.12, major: dark ? 0.24 : 0.2, dot: dark ? 0.32 : 0.3 }[kind] ?? 0.12) * (BOOST[base.toLowerCase()] || 1);
    return mix(base, dark ? "#ffffff" : "#000000", Math.min(amount, 0.85));
  }

  /** Pen colour that reads on `base` (used only while the pen is still on its default). */
  const penFor = (base) => (isDark(base) ? "#f2f2f2" : "#000000");

  const valid = (s) => !!s && PATTERNS.includes(s.pattern) && isHex(s.color);

  /** The style in force for a page: its own override, else the notebook default, else plain white. */
  function resolve(doc, pg) {
    if (pg && valid(pg.style)) return pg.style;
    if (doc && valid(doc.style)) return doc.style;
    return DEFAULT;
  }

  // Paper grain: a fixed 256px tile of speckle (seeded, so it never changes), tiled in world space so it pans
  // with the sheet. Dark speckle on light paper, light speckle on dark. Browser only; node tests skip it.
  const grainTiles = {};
  function grainTile(dark) {
    const key = dark ? "d" : "l";
    if (grainTiles[key] || typeof document === "undefined") return grainTiles[key] || null;
    const c = document.createElement("canvas"); c.width = c.height = 256;
    const g = c.getContext("2d"), img = g.createImageData(256, 256);
    let a = dark ? 0x9e3779b9 : 0x7f4a7c15; // mulberry32
    const rnd = () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    for (let i = 0; i < 256 * 256; i++) {
      const r = rnd(), speck = r > 0.55 ? (r - 0.55) / 0.45 : 0;
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = dark ? 255 : 0;
      img.data[i * 4 + 3] = Math.round(speck * speck * (dark ? 22 : 30));
    }
    g.putImageData(img, 0, 0);
    return (grainTiles[key] = c);
  }
  function drawGrain(ctx, style, rect) {
    const tile = grainTile(isDark(style.color));
    if (!tile || !ctx.createPattern) return;
    const pat = ctx.createPattern(tile, "repeat");
    if (!pat) return;
    ctx.fillStyle = pat;
    ctx.fillRect(rect.x0, rect.y0, rect.x1 - rect.x0, rect.y1 - rect.y0);
  }

  /**
   * Automatic ink: when a page flips between a light and a dark background, black ink becomes light (and back).
   * Only the two automatic colours are swapped; any other colour the user picked is left alone. Returns how
   * many items changed. Strokes and shapes are the only coloured items.
   */
  const AUTO_LIGHT = "#000000", AUTO_DARK = "#f2f2f2";
  function autoInk(pg, toDark) {
    const from = toDark ? AUTO_LIGHT : AUTO_DARK, to = toDark ? AUTO_DARK : AUTO_LIGHT;
    let n = 0;
    const swap = (o) => { if (typeof o.color === "string" && o.color.toLowerCase() === from) { o.color = to; n++; } };
    (pg.strokes || []).forEach(swap);
    (pg.objects || []).forEach((o) => { if (o.type === "shape") swap(o); });
    return n;
  }

  function spacing(pattern, zoom) {
    let s = GAP[pattern];
    while (s * zoom < MIN_PX[pattern]) s *= 2;
    return s;
  }

  /**
   * Fill `rect` ({x0,y0,x1,y1}, world units) with the background. `zoom` is screen px per world unit,
   * so line widths stay about one screen pixel at every zoom and fine patterns thin out when zoomed far out.
   */
  function draw(ctx, style, rect, zoom) {
    if (!valid(style)) style = DEFAULT;
    const { x0, y0, x1, y1 } = rect;
    ctx.save();
    ctx.fillStyle = style.color;
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    if (style.pattern === "paper") drawGrain(ctx, style, rect);
    if (style.pattern === "plain" || !(zoom > 0)) { ctx.restore(); return; }

    let s = spacing(style.pattern, zoom);
    const w1 = 1.25 / zoom;
    if (style.pattern === "dot") {
      while (((x1 - x0) / s) * ((y1 - y0) / s) > MAX_DOTS) s *= 2;
      const r = 1.5 / zoom;
      ctx.fillStyle = inkFor(style.color, "dot");
      ctx.beginPath();
      for (let y = Math.ceil(y0 / s) * s; y <= y1; y += s)
        for (let x = Math.ceil(x0 / s) * s; x <= x1; x += s) ctx.rect(x - r, y - r, 2 * r, 2 * r);
      ctx.fill();
      ctx.restore();
      return;
    }

    ctx.lineWidth = w1;
    const major = style.pattern === "grid" ? 5 : 0;
    const strokeLines = (kind, pick, vertical) => {
      ctx.strokeStyle = inkFor(style.color, kind);
      ctx.beginPath();
      const lo = vertical ? x0 : y0, hi = vertical ? x1 : y1;
      for (let i = Math.ceil(lo / s); i * s <= hi; i++) {
        if (!pick(i)) continue;
        const p = i * s;
        if (vertical) { ctx.moveTo(p, y0); ctx.lineTo(p, y1); } else { ctx.moveTo(x0, p); ctx.lineTo(x1, p); }
      }
      ctx.stroke();
    };
    const minor = (i) => !major || i % major !== 0;
    strokeLines("line", minor, false);
    if (style.pattern === "grid") strokeLines("line", minor, true);
    if (major) {
      strokeLines("major", (i) => i % major === 0, false);
      strokeLines("major", (i) => i % major === 0, true);
    }
    ctx.restore();
  }

  const api = { PATTERNS, DEFAULT, PRESETS, isHex, parseHex, luminance, isDark, inkFor, penFor, autoInk, valid, resolve, spacing, draw };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.Backgrounds = api;
})(typeof window !== "undefined" ? window : globalThis);
