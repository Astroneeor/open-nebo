"use strict";
// Background picker: a toolbar button that opens a popover of fixed presets (plain, paper, grids and perspective guides, grouped under headings) and an "Apply to all pages" switch. No colour or pattern settings. Changes apply live.
// Switching between a light and a dark background also swaps automatic ink (see Backgrounds.autoInk).
(() => {
  const A = window.__app, B = window.Backgrounds, $ = (id) => document.getElementById(id);
  let pop = null, btn = null, allPages = true;
  let presetBtns = [];

  const current = () => (A.S.doc ? B.resolve(A.S.doc, A.page()) : B.DEFAULT);

  function el(tag, cls, parent, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    if (parent) parent.append(e);
    return e;
  }

  /** Pen colour follows the base only while it is still on one of the two automatic colours. */
  function followPen(color) {
    const input = $("color");
    if (!input || typeof ColorPicker === "undefined" || !ColorPicker) return;
    const pen = (input.value || "").toLowerCase();
    if (pen === "#000000" || pen === "#f2f2f2") {
      const want = B.penFor(color);
      if (want !== pen) ColorPicker.set(want);
    }
  }

  function apply(style) {
    const { S } = A;
    if (!S.doc || !B.valid(style)) return;
    style = { pattern: style.pattern, color: style.color.toLowerCase() };
    const wasDark = S.doc.pages.map((p) => B.isDark(B.resolve(S.doc, p).color));
    if (allPages) {
      S.doc.style = style;
      for (const p of S.doc.pages) delete p.style;
    } else {
      A.page().style = style;
    }
    // Recorded through History so the undo stack's page snapshots stay consistent with the ink colours.
    S.doc.pages.forEach((p, i) => {
      const nowDark = B.isDark(B.resolve(S.doc, p).color);
      if (nowDark !== wasDark[i]) History.record(p, "background ink", () => B.autoInk(p, nowDark));
    });
    followPen(style.color);
    A.touch(); A.render();
    refresh();
  }

  // Each preset is drawn through a view window onto the infinite canvas: `z` is screen px per world unit and
  // (cx, cy) the world point at the tile centre. The guides need a wide window so their vanishing lines show.
  const THUMB_VIEW = { persp1: { z: 0.5, cx: 0, cy: 0 }, persp2: { z: 0.1, cx: 0, cy: 300 }, persp3: { z: 0.1, cx: 0, cy: 600 } };
  function thumb(style) {
    const W = 112, H = 80; // canvas px; shown at about half that, so it stays sharp on high-dpi screens
    const c = el("canvas", "bg-thumb");
    c.width = W; c.height = H;
    const g = c.getContext("2d");
    const v = THUMB_VIEW[style.pattern] || { z: 0.5, cx: W, cy: H };
    const x0 = v.cx - W / 2 / v.z, y0 = v.cy - H / 2 / v.z;
    g.scale(v.z, v.z); g.translate(-x0, -y0);
    B.draw(g, style, { x0, y0, x1: x0 + W / v.z, y1: y0 + H / v.z }, v.z);
    return c;
  }

  function refresh() {
    if (!pop) return;
    const cur = current();
    presetBtns.forEach(([b, p]) => b.classList.toggle("on", p.pattern === cur.pattern && p.color === cur.color));
    $("bgAll").checked = allPages;
  }

  function build() {
    pop = el("div", "bg-pop", document.body); pop.id = "bgPop"; pop.hidden = true;
    let grid = null, group = null;
    for (const p of B.PRESETS) {
      if (p.group !== group) { group = p.group; el("div", "bg-h", pop, group); grid = el("div", "bg-presets", pop); }
      const b = el("button", "bg-preset", grid); b.type = "button"; b.title = p.name;
      b.append(thumb(p)); el("span", null, b, p.name);
      b.onclick = () => apply(p);
      presetBtns.push([b, p]);
    }
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
  btn.title = "Canvas background";
  btn.setAttribute("aria-haspopup", "dialog"); btn.setAttribute("aria-expanded", "false");
  btn.onclick = (ev) => { ev.stopPropagation(); if (!A.S.doc) return; if (pop && !pop.hidden) close(); else open(); };
  ($("pageMenu") || $("addPage")).after(btn);
  document.addEventListener("pointerdown", (ev) => { if (pop && !pop.hidden && !pop.contains(ev.target) && ev.target !== btn) close(); }, true);
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") close(); });
  window.addEventListener("resize", () => { if (pop && !pop.hidden) place(); });
})();
