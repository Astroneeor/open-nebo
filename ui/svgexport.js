"use strict";
// Pure page -> SVG string serializer (no DOM). Used by the SVG export, and its bounds/text layout are shared with the PNG export.
// Every string that reaches the output is escaped or validated (colours, mime types, base64), so a hostile notebook cannot inject markup.
(function (root) {
  const BG = typeof require !== "undefined" ? require("./backgrounds.js") : root.Backgrounds;
  const GRID = "#b9c2d0", AXIS = "#1b1b1f", TXT = "#3a3a42";
  const FONT = "system-ui, sans-serif";
  const LINE_H = 1.3;

  const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const n = (v) => { v = Number(v); return Number.isFinite(v) ? String(Math.round(v * 100) / 100) : "0"; };
  const colour = (c, d = "#000000") => (typeof c === "string" && /^#[0-9a-fA-F]{3,8}$/.test(c) ? c : d);
  const unit = (v) => Math.min(1, Math.max(0, Number(v)));
  const MIMES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
  const B64 = /^[A-Za-z0-9+/=\s]*$/;
  const fmt = (v) => parseFloat(v.toFixed(6)).toString().replace("-", "−");

  /** Word-wrap `text` into lines no wider than `w` (estimated: 0.55em per character, 0.6 bold). */
  function layoutText(text, w, size, bold) {
    const cw = size * (bold ? 0.6 : 0.55), max = Math.max(1, Math.floor(w / cw));
    const lines = [];
    for (const para of String(text ?? "").split(/\r?\n/)) {
      let cur = "";
      for (let word of para.split(" ")) {
        while (word.length > max) { // a word longer than the box is broken
          if (cur) { lines.push(cur); cur = ""; }
          lines.push(word.slice(0, max)); word = word.slice(max);
        }
        if (!cur) cur = word;
        else if ((cur + " " + word).length <= max) cur += " " + word;
        else { lines.push(cur); cur = word; }
      }
      lines.push(cur);
    }
    return lines;
  }
  const textBox = (o) => {
    const size = o.size > 0 ? o.size : 24, w = o.w > 0 ? o.w : 200;
    return { size, w, lines: layoutText(o.text, w, size, o.bold), lh: size * LINE_H };
  };
  const graphH = (g) => g.size * (g.ymax - g.ymin) / (g.xmax - g.xmin);

  const hiddenLayers = (pg) => new Set((pg.layers || []).filter((l) => l.visible === false).map((l) => l.id));
  const shown = (hid) => (o) => !(o.layer && hid.has(o.layer));

  /** World rectangle: the page sheet plus anything lying outside it. */
  function bounds(pg) {
    let x0 = 0, y0 = 0, x1 = pg.width > 0 ? pg.width : 0, y1 = pg.height > 0 ? pg.height : 0;
    const add = (x, y) => { if (!Number.isFinite(x) || !Number.isFinite(y)) return; if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; };
    const vis = shown(hiddenLayers(pg));
    for (const s of (pg.strokes || []).filter(vis)) for (const p of s.points || []) add(p.x, p.y);
    for (const o of (pg.objects || []).filter(vis)) {
      if (o.type === "image") { add(o.x, o.y); add(o.x + o.w, o.y + o.h); }
      else if (o.type === "graph") { add(o.x, o.y); add(o.x + o.size, o.y + graphH(o)); }
      else if (o.type === "text") { const t = textBox(o); add(o.x, o.y); add(o.x + t.w, o.y + t.lines.length * t.lh); }
      else if (o.type === "shape") {
        if (o.kind === "ellipse") { const [[cx, cy], [rx, ry]] = o.points; add(cx - rx, cy - ry); add(cx + rx, cy + ry); }
        else for (const [x, y] of o.points) add(x, y);
      }
    }
    const X0 = Math.floor(x0), Y0 = Math.floor(y0);
    return { x0: X0, y0: Y0, w: Math.max(1, Math.ceil(x1 - X0)), h: Math.max(1, Math.ceil(y1 - Y0)) };
  }

  function backgroundSvg(style, b, id) {
    const st = BG.valid(style) ? style : BG.DEFAULT;
    const c = colour(st.color, BG.DEFAULT.color), rect = (fill) => `<rect x="${b.x0}" y="${b.y0}" width="${b.w}" height="${b.h}" fill="${fill}"/>`;
    const base = rect(c);
    if (st.pattern === "paper") {
      const s = BG.spacing("paper", 1), ink = BG.inkFor(c, "line");
      return `<defs><pattern id="${id}" width="${s}" height="${s}" patternUnits="userSpaceOnUse"><path d="M0 0H${s}" stroke="${ink}" stroke-width="1.25" fill="none"/></pattern></defs>${base}${rect(`url(#${id})`)}`;
    }
    if (st.pattern === "grid") {
      const s = BG.spacing("grid", 1), S = s * 5, m = BG.inkFor(c, "major"), l = BG.inkFor(c, "line");
      let d = "";
      for (let i = 1; i < 5; i++) d += `M${i * s} 0V${S}M0 ${i * s}H${S}`;
      return `<defs><pattern id="${id}" width="${S}" height="${S}" patternUnits="userSpaceOnUse"><path d="${d}" stroke="${l}" stroke-width="1.25" fill="none"/><path d="M0 0V${S}M0 0H${S}" stroke="${m}" stroke-width="1.25" fill="none"/></pattern></defs>${base}${rect(`url(#${id})`)}`;
    }
    if (st.pattern === "dot") {
      const s = BG.spacing("dot", 1);
      return `<defs><pattern id="${id}" width="${s}" height="${s}" patternUnits="userSpaceOnUse"><circle cx="0" cy="0" r="1.5" fill="${BG.inkFor(c, "dot")}"/><circle cx="${s}" cy="0" r="1.5" fill="${BG.inkFor(c, "dot")}"/><circle cx="0" cy="${s}" r="1.5" fill="${BG.inkFor(c, "dot")}"/><circle cx="${s}" cy="${s}" r="1.5" fill="${BG.inkFor(c, "dot")}"/></pattern></defs>${base}${rect(`url(#${id})`)}`;
    }
    return base; // plain, or a pattern this exporter does not draw: solid colour
  }

  function strokeSvg(s) {
    const pts = (s.points || []).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
    if (!pts.length) return "";
    const col = colour(s.color), w = s.width > 0 ? s.width : 2;
    let op = s.opacity != null && Number.isFinite(Number(s.opacity)) ? unit(s.opacity) : s.kind === "highlighter" ? 0.4 : 1;
    const opa = op < 1 ? ` stroke-opacity="${n(op)}"` : "";
    if (pts.length === 1) return `<circle cx="${n(pts[0].x)}" cy="${n(pts[0].y)}" r="${n(w / 2)}" fill="${col}"${op < 1 ? ` fill-opacity="${n(op)}"` : ""}/>`;
    const avg = pts.reduce((a, p) => a + (Number.isFinite(p.p) ? p.p : 0.5), 0) / pts.length;
    const d = pts.map((p, i) => `${i ? "L" : "M"}${n(p.x)} ${n(p.y)}`).join("");
    return `<path d="${d}" fill="none" stroke="${col}" stroke-width="${n(w * (0.4 + 1.2 * avg))}" stroke-linecap="round" stroke-linejoin="round"${opa}/>`;
  }

  function shapeSvg(o) {
    const col = colour(o.color), w = n(o.width > 0 ? o.width : 2);
    const common = `stroke="${col}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`;
    const P = o.points || [];
    if (!Array.isArray(P) || !P.every((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite))) return "";
    if (o.kind === "ellipse" && P.length === 2) return `<ellipse cx="${n(P[0][0])}" cy="${n(P[0][1])}" rx="${n(P[1][0])}" ry="${n(P[1][1])}" fill="none" ${common}/>`;
    if ((o.kind === "line" || o.kind === "arrow") && P.length === 2) {
      const [[x1, y1], [x2, y2]] = P;
      let out = `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" ${common}/>`;
      if (o.kind === "arrow") {
        const a = Math.atan2(y2 - y1, x2 - x1), L = Math.max(12, (o.width || 2) * 4), sp = 0.45;
        const hp = (t) => `${n(x2 - L * Math.cos(a + t))} ${n(y2 - L * Math.sin(a + t))}`;
        out += `<path d="M${hp(-sp)}L${n(x2)} ${n(y2)}L${hp(sp)}" fill="none" ${common}/>`;
      }
      return out;
    }
    if ((o.kind === "rect" && P.length === 4) || (o.kind === "triangle" && P.length === 3))
      return `<polygon points="${P.map((p) => n(p[0]) + "," + n(p[1])).join(" ")}" fill="none" ${common}/>`;
    return "";
  }

  function graphSvg(g) {
    const xr = g.xmax - g.xmin, yr = g.ymax - g.ymin;
    if (!(xr > 0 && yr > 0 && g.size > 0)) return "";
    const w = g.size, h = graphH(g), x = g.x, y = g.y, step = g.step > 0 ? g.step : 1, eps = 1e-6;
    const X = (v) => x + (v - g.xmin) / xr * w, Y = (v) => y + h - (v - g.ymin) / yr * h;
    const i0 = Math.ceil(g.xmin / step - eps), i1 = Math.floor(g.xmax / step + eps);
    const j0 = Math.ceil(g.ymin / step - eps), j1 = Math.floor(g.ymax / step + eps);
    let out = "";
    if (g.grid && i1 - i0 < 500 && j1 - j0 < 500) {
      let d = "";
      for (let i = i0; i <= i1; i++) d += `M${n(X(i * step))} ${n(y)}V${n(y + h)}`;
      for (let j = j0; j <= j1; j++) d += `M${n(x)} ${n(Y(j * step))}H${n(x + w)}`;
      out += `<path d="${d}" stroke="${GRID}" stroke-width="1" fill="none"/><rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" stroke="${GRID}" stroke-width="1" fill="none"/>`;
    }
    const hasX = g.ymin <= 0 && g.ymax >= 0, hasY = g.xmin <= 0 && g.xmax >= 0;
    if (g.axes) {
      let d = "", head = "";
      if (hasX) { d += `M${n(x)} ${n(Y(0))}H${n(x + w)}`; head += `M${n(x + w + 6)} ${n(Y(0))}L${n(x + w - 4)} ${n(Y(0) - 4)}L${n(x + w - 4)} ${n(Y(0) + 4)}Z`; }
      if (hasY) { d += `M${n(X(0))} ${n(y)}V${n(y + h)}`; head += `M${n(X(0))} ${n(y - 6)}L${n(X(0) - 4)} ${n(y + 4)}L${n(X(0) + 4)} ${n(y + 4)}Z`; }
      out += `<path d="${d}" stroke="${AXIS}" stroke-width="2" fill="none"/><path d="${head}" fill="${AXIS}"/>`;
    }
    if (g.labels) {
      const cell = Math.min(w * step / xr, h * step / yr), f = Math.min(14, Math.max(9, cell * 0.4));
      const lx = Math.max(1, Math.ceil(30 / (w * step / xr))), ly = Math.max(1, Math.ceil(f * 1.6 / (h * step / yr)));
      const ax = Math.min(x + w, Math.max(x, X(0))), ay = Math.min(y + h, Math.max(y, Y(0)));
      const t = (s, px, py, anchor, base) => `<text x="${n(px)}" y="${n(py)}" text-anchor="${anchor}" dominant-baseline="${base}" font-family="${FONT}" font-size="${n(f)}" fill="${TXT}" stroke="#fff" stroke-width="3" stroke-linejoin="round" paint-order="stroke">${esc(s)}</text>`;
      for (let i = i0; i <= i1; i++) if (i !== 0 && i % lx === 0) out += t(fmt(i * step), X(i * step), ay + 3, "middle", "hanging");
      for (let j = j0; j <= j1; j++) if (j !== 0 && j % ly === 0) out += t(fmt(j * step), ax - 5, Y(j * step), "end", "central");
      if (hasX && hasY) out += t("0", ax - 4, ay + 3, "end", "hanging");
    }
    return out;
  }

  function textSvg(o) {
    const t = textBox(o);
    const attrs = `font-family="${FONT}" font-size="${n(t.size)}" fill="${colour(o.color)}"${o.bold ? ' font-weight="bold"' : ""}${o.italic ? ' font-style="italic"' : ""}`;
    const spans = t.lines.map((l, i) => `<tspan x="${n(o.x)}" dy="${i ? n(t.lh) : 0}" xml:space="preserve">${esc(l)}</tspan>`).join("");
    return `<text x="${n(o.x)}" y="${n(o.y + t.size)}" ${attrs}>${spans}</text>`;
  }

  function imageSvg(o) {
    if (!MIMES.includes(o.mime) || typeof o.data !== "string" || !B64.test(o.data) || !o.data) return "";
    return `<image x="${n(o.x)}" y="${n(o.y)}" width="${n(o.w)}" height="${n(o.h)}" preserveAspectRatio="none" href="data:${o.mime};base64,${o.data.replace(/\s/g, "")}"/>`;
  }

  /**
   * Serialize one page. opts: { style (BackgroundStyle; default plain white), background (default true),
   * grid (default true: draw the pattern, else just the colour), backgroundImage (data: URI of the page's PDF/media background) }.
   */
  function pageToSvg(pg, opts = {}) {
    const b = bounds(pg), vis = shown(hiddenLayers(pg));
    let style = opts.style || BG.DEFAULT;
    if (opts.grid === false && BG.valid(style)) style = { pattern: "plain", color: style.color };
    let body = opts.background === false ? "" : backgroundSvg(style, b, "nebo-bg");
    const bgImg = opts.backgroundImage;
    if (typeof bgImg === "string" && /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(bgImg))
      body += `<image x="0" y="0" width="${n(pg.width)}" height="${n(pg.height)}" preserveAspectRatio="none" href="${bgImg}"/>`;
    const objs = (pg.objects || []).filter(vis);
    body += objs.filter((o) => o.type === "image").map(imageSvg).join("");
    body += objs.filter((o) => o.type === "graph").map(graphSvg).join("");
    body += (pg.strokes || []).filter(vis).map(strokeSvg).join("");
    body += objs.filter((o) => o.type === "shape").map(shapeSvg).join("");
    body += objs.filter((o) => o.type === "text").map(textSvg).join("");
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${b.w}" height="${b.h}" viewBox="${b.x0} ${b.y0} ${b.w} ${b.h}">${body}</svg>`;
  }

  const api = { esc, layoutText, textBox, bounds, pageToSvg };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.SvgExport = api;
})(typeof window !== "undefined" ? window : globalThis);
