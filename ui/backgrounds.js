"use strict";
// Canvas backgrounds: a pattern (plain / paper / grid / dot / isometric / triangle / perspective guides) over a base colour, drawn in world
// coordinates under the ink so it pans and zooms with the infinite canvas. The line and dot ink is
// derived from the base colour: a darker tint on light bases, a lighter tint on dark ones.
(function (root) {
  const PATTERNS = ["plain", "paper", "grid", "dot", "isometric", "triangle", "persp1", "persp2", "persp3"];
  const DEFAULT = { pattern: "plain", color: "#ffffff" };

  // The fixed choices offered by the picker. Blueprint is a grid on a deep blue; its lines are boosted (BOOST)
  // because a 14% tint barely shows on a saturated base.
  const BLUEPRINT = "#1d3f7a";
  // `group` is the picker heading (Plain / Paper / Grids / Guides); presets are listed in group order.
  const PRESETS = [
    { id: "plain", name: "Light", pattern: "plain", color: "#ffffff", group: "Plain" },
    { id: "plain-dark", name: "Dark", pattern: "plain", color: "#1e1e1e", group: "Plain" },
    { id: "paper", name: "Light paper", pattern: "paper", color: "#f6f1e4", group: "Paper" },
    { id: "paper-dark", name: "Dark paper", pattern: "paper", color: "#2a2a2e", group: "Paper" },
    { id: "dot", name: "Light dot grid", pattern: "dot", color: "#ffffff", group: "Grids" },
    { id: "dot-dark", name: "Dark dot grid", pattern: "dot", color: "#1e1e1e", group: "Grids" },
    { id: "grid", name: "Light grid", pattern: "grid", color: "#ffffff", group: "Grids" },
    { id: "grid-dark", name: "Dark grid", pattern: "grid", color: "#1e1e1e", group: "Grids" },
    { id: "blueprint", name: "Blueprint", pattern: "grid", color: BLUEPRINT, group: "Grids" },
    { id: "isometric", name: "Isometric", pattern: "isometric", color: "#ffffff", group: "Grids" },
    { id: "triangle", name: "Triangle", pattern: "triangle", color: "#ffffff", group: "Grids" },
    { id: "persp1", name: "Perspective 1pt", pattern: "persp1", color: "#ffffff", group: "Guides" },
    { id: "persp2", name: "Perspective 2pt", pattern: "persp2", color: "#ffffff", group: "Guides" },
    { id: "persp3", name: "Perspective 3pt", pattern: "persp3", color: "#ffffff", group: "Guides" },
  ];
  const BOOST = { [BLUEPRINT]: 1.9 };

  // World-unit spacing of each pattern at zoom 1, and the smallest on-screen gap (CSS px) before the
  // pattern doubles its spacing. Doubling keeps lines aligned to world multiples, so nothing swims.
  const GAP = { paper: 44, grid: 40, dot: 40, isometric: 40, triangle: 40 };
  const MIN_PX = { paper: 9, grid: 9, dot: 14, isometric: 9, triangle: 9 };
  const MAX_DOTS = 30000;
  const MAX_LINES = 4000; // cap on slanted lines per draw, so a huge rect can never stall
  const SLOPE30 = 1 / Math.sqrt(3); // tan 30deg: the isometric diagonals

  // Perspective guides live in world space (they do not scale with a spacing): each vanishing point
  // radiates LINES lines (so twice as many rays) at evenly spaced angles, plus one horizon at y = 0.
  const PERSP = {
    persp1: { vps: [[0, 0]], lines: 24 },
    persp2: { vps: [[-1200, 0], [1200, 0]], lines: 18 },
    persp3: { vps: [[-1200, 0], [1200, 0], [0, 1800]], lines: 16 },
  };

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

  /** World spacing of a lattice pattern at `zoom`; 0 for patterns without a lattice (plain, perspective). */
  function spacing(pattern, zoom) {
    let s = GAP[pattern];
    if (!s) return 0;
    while (s * zoom < MIN_PX[pattern]) s *= 2;
    return s;
  }

  /** Isometric (verticals plus +-30deg) and triangle (square grid plus one 45deg diagonal) lattices. */
  function drawSlanted(ctx, style, rect, s) {
    const { x0, y0, x1, y1 } = rect, iso = style.pattern === "isometric";
    const w = x1 - x0, h = y1 - y0;
    // Perpendicular spacing is s for every family, so the 30deg lines are 2s/sqrt(3) apart vertically.
    const t = iso ? SLOPE30 : 1, stepOf = (s) => (iso ? (2 * s) / Math.sqrt(3) : s);
    const est = (s) => w / s + (iso ? 2 : 1) * (h + t * w) / stepOf(s) + (iso ? 0 : h / s);
    while (est(s) > MAX_LINES) s *= 2;
    const step = stepOf(s);
    ctx.strokeStyle = inkFor(style.color, "line");
    ctx.beginPath();
    for (let i = Math.ceil(x0 / s); i * s <= x1; i++) { ctx.moveTo(i * s, y0); ctx.lineTo(i * s, y1); }
    if (!iso) for (let i = Math.ceil(y0 / s); i * s <= y1; i++) { ctx.moveTo(x0, i * s); ctx.lineTo(x1, i * s); }
    // y = t*x + c (down-right in screen space, since y grows downward)
    for (let j = Math.ceil((y0 - t * x1) / step); j * step <= y1 - t * x0; j++) {
      const c = j * step; ctx.moveTo(x0, t * x0 + c); ctx.lineTo(x1, t * x1 + c);
    }
    if (iso) for (let j = Math.ceil((y0 + t * x0) / step); j * step <= y1 + t * x1; j++) {
      const c = j * step; ctx.moveTo(x0, -t * x0 + c); ctx.lineTo(x1, -t * x1 + c);
    }
    ctx.stroke();
  }

  /** The visible part of the infinite line through (px,py) with direction (dx,dy), or null. */
  function clipLine(px, py, dx, dy, r) {
    let lo = -Infinity, hi = Infinity;
    for (const [p, d, a, b] of [[px, dx, r.x0, r.x1], [py, dy, r.y0, r.y1]]) {
      if (Math.abs(d) < 1e-12) { if (p < a || p > b) return null; continue; }
      let t0 = (a - p) / d, t1 = (b - p) / d;
      if (t0 > t1) [t0, t1] = [t1, t0];
      lo = Math.max(lo, t0); hi = Math.min(hi, t1);
    }
    return lo < hi ? [px + dx * lo, py + dy * lo, px + dx * hi, py + dy * hi] : null;
  }

  function drawPersp(ctx, style, rect, w1, cfg) {
    ctx.lineWidth = w1;
    ctx.strokeStyle = inkFor(style.color, "line");
    ctx.beginPath();
    for (const [vx, vy] of cfg.vps) {
      for (let k = 0; k < cfg.lines; k++) {
        const a = (k + 0.5) * Math.PI / cfg.lines; // offset so no ray lies exactly on the horizon
        const seg = clipLine(vx, vy, Math.cos(a), Math.sin(a), rect);
        if (seg) { ctx.moveTo(seg[0], seg[1]); ctx.lineTo(seg[2], seg[3]); }
      }
    }
    ctx.stroke();
    const hz = clipLine(0, 0, 1, 0, rect);
    if (hz) {
      ctx.strokeStyle = inkFor(style.color, "major");
      ctx.beginPath(); ctx.moveTo(hz[0], hz[1]); ctx.lineTo(hz[2], hz[3]); ctx.stroke();
    }
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

    const w1 = 1.25 / zoom;
    if (PERSP[style.pattern]) { drawPersp(ctx, style, rect, w1, PERSP[style.pattern]); ctx.restore(); return; }
    let s = spacing(style.pattern, zoom);
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
    if (style.pattern === "isometric" || style.pattern === "triangle") { drawSlanted(ctx, style, rect, s); ctx.restore(); return; }
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
