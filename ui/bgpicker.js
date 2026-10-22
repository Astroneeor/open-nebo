"use strict";
// Background picker: a toolbar button that opens a popover with presets, a pattern choice, base-colour
// swatches and a custom colour, plus an "Apply to all pages" switch. Changes apply live.
(() => {
  const A = window.__app, B = window.Backgrounds, $ = (id) => document.getElementById(id);
  const PATTERN_LABEL = { plain: "Plain", paper: "Paper", grid: "Grid", dot: "Dot" };
  let pop = null, btn = null, allPages = true, sliding = false;
  let presetBtns = [], patternBtns = [], swatchBtns = [];
  let hue, sat, bri, hex, preview;

  const current = () => (A.S.doc ? B.resolve(A.S.doc, A.page()) : B.DEFAULT);

  function el(tag, cls, parent, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    if (parent) parent.append(e);
    return e;
  }

  /** Pen colour follows the base only while it is still on one of the two defaults. */
  function followPen(color) {
    const input = $("color");
    if (!input || typeof ColorPicker === "undefined" || !ColorPicker) return;
    const pen = (input.value || "").toLowerCase();
    if (pen === "#000000" || pen === "#f2f2f2") {
      const want = B.penFor(color);
      if (want !== pen) ColorPicker.set(want);
    }
  }

  function apply(style, { push = true } = {}) {
    const { S } = A;
    if (!S.doc || !B.valid(style)) return;
    style = { pattern: style.pattern, color: style.color.toLowerCase() };
    if (allPages) {
      S.doc.style = style;
      for (const p of S.doc.pages) delete p.style;
    } else {
      A.page().style = style;
    }
    followPen(style.color);
    if (push) { A.touch(); A.render(); }
    refresh();
  }

  function thumb(style) {
    const c = el("canvas", "bg-thumb");
    c.width = 112; c.height = 80;
    const g = c.getContext("2d");
    g.scale(2, 2); // draw at zoom 0.5 so the pattern is visible in a 56x40 swatch
    B.draw(g, style, { x0: 0, y0: 0, x1: 112, y1: 80 }, 0.5);
    return c;
  }

  function syncCustom(color) {
    const rgb = B.parseHex(color);
    if (!rgb || typeof ColorMath === "undefined") return;
    // While a slider is being dragged keep its own values: round-tripping through hex would snap the
    // hue back to 0 whenever saturation is 0.
    const [h, s, v] = sliding ? [+hue.value, sat.value / 100, bri.value / 100] : ColorMath.rgbToHsb(...rgb);
    if (!sliding) { hue.value = Math.round(h); sat.value = Math.round(s * 100); bri.value = Math.round(v * 100); }
    sat.style.background = `linear-gradient(90deg,${color === "#000000" ? "#000" : ColorMath.toHex(...ColorMath.hsbToRgb(h, 0, v))},${ColorMath.toHex(...ColorMath.hsbToRgb(h, 1, v))})`;
    bri.style.background = `linear-gradient(90deg,#000,${ColorMath.toHex(...ColorMath.hsbToRgb(h, s, 1))})`;
    if (document.activeElement !== hex) hex.value = color;
    hex.classList.remove("bad");
    preview.style.background = color;
  }

  function refresh() {
    if (!pop) return;
    const cur = current();
    presetBtns.forEach(([b, p]) => b.classList.toggle("on", p.pattern === cur.pattern && p.color === cur.color));
    patternBtns.forEach(([b, name]) => b.classList.toggle("on", name === cur.pattern));
    swatchBtns.forEach(([b, c]) => b.classList.toggle("on", c === cur.color));
    syncCustom(cur.color);
    $("bgAll").checked = allPages;
  }

  function build() {
    pop = el("div", "bg-pop", document.body); pop.id = "bgPop"; pop.hidden = true;

    el("div", "bg-h", pop, "Presets");
    const grid = el("div", "bg-presets", pop);
    for (const p of B.PRESETS) {
      const b = el("button", "bg-preset", grid); b.type = "button"; b.title = p.name;
      b.append(thumb(p)); el("span", null, b, p.name);
      b.onclick = () => apply(p);
      presetBtns.push([b, p]);
    }

    el("div", "bg-h", pop, "Pattern");
    const row = el("div", "bg-row", pop);
    for (const name of B.PATTERNS) {
      const b = el("button", null, row, PATTERN_LABEL[name]); b.type = "button";
      b.onclick = () => apply({ pattern: name, color: current().color });
      patternBtns.push([b, name]);
    }

    el("div", "bg-h", pop, "Colour");
    const sw = el("div", "bg-swatches", pop);
    for (const c of B.SWATCHES) {
      const b = el("button", "bg-swatch", sw); b.type = "button"; b.title = c; b.style.background = c;
      b.onclick = () => apply({ pattern: current().pattern, color: c });
      swatchBtns.push([b, c]);
    }

    const slider = (label, max, onInput) => {
      const r = el("label", "bg-row", pop); el("span", "bg-lbl", r, label);
      const i = el("input", "cp-slider", r); i.type = "range"; i.min = 0; i.max = max; i.oninput = onInput;
      return i;
    };
    const fromSliders = () => {
      const [r, g, b] = ColorMath.hsbToRgb(+hue.value, sat.value / 100, bri.value / 100);
      sliding = true;
      try { apply({ pattern: current().pattern, color: ColorMath.toHex(r, g, b) }); } finally { sliding = false; }
    };
    hue = slider("Hue", 360, fromSliders);
    hue.style.background = "linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)";
    sat = slider("Saturation", 100, fromSliders);
    bri = slider("Brightness", 100, fromSliders);

    const hr = el("div", "bg-row", pop);
    preview = el("span", "cp-preview", hr);
    hex = el("input", "cp-hex", hr); hex.spellcheck = false; hex.maxLength = 7; hex.placeholder = "#rrggbb";
    hex.addEventListener("input", () => {
      if (B.isHex(hex.value)) { hex.classList.remove("bad"); apply({ pattern: current().pattern, color: hex.value }); }
      else hex.classList.add("bad");
    });
    hex.addEventListener("blur", () => { hex.value = current().color; hex.classList.remove("bad"); });

    const lab = el("label", "bg-all", pop);
    const cb = el("input", null, lab); cb.type = "checkbox"; cb.id = "bgAll"; cb.checked = allPages;
    cb.onchange = () => { allPages = cb.checked; };
    el("span", null, lab, "Apply to all pages");
    el("small", "bg-note", pop, "Off: only this page changes.");
  }

  function place() {
    if (window.Chrome) return Chrome.placePopover(pop, btn);
    const r = btn.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(r.left, innerWidth - pop.offsetWidth - 8)) + "px";
    pop.style.top = Math.min(r.bottom + 6, Math.max(8, innerHeight - pop.offsetHeight - 8)) + "px";
  }
  function open() { if (!pop) build(); pop.hidden = false; btn.setAttribute("aria-expanded", "true"); refresh(); place(); }
  function close() { if (!pop || pop.hidden) return; pop.hidden = true; btn.setAttribute("aria-expanded", "false"); }

  btn = el("button", null, null, "Background"); btn.id = "bgBtn"; btn.type = "button";
  btn.title = "Canvas background: pattern and colour";
  btn.setAttribute("aria-haspopup", "dialog"); btn.setAttribute("aria-expanded", "false");
  btn.onclick = (ev) => { ev.stopPropagation(); if (!A.S.doc) return; if (pop && !pop.hidden) close(); else open(); };
  ($("pageMenu") || $("addPage")).after(btn);
  document.addEventListener("pointerdown", (ev) => { if (pop && !pop.hidden && !pop.contains(ev.target) && ev.target !== btn) close(); }, true);
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") close(); });
  window.addEventListener("resize", () => { if (pop && !pop.hidden) place(); });
})();
