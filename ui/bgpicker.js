"use strict";
// Background picker: a toolbar button that opens a popover of fixed presets (light/dark plain, paper, dot grid,
// grid, blueprint) and an "Apply to all pages" switch. No colour or pattern settings. Changes apply live.
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

  function thumb(style) {
    const c = el("canvas", "bg-thumb");
    c.width = 112; c.height = 80;
    const g = c.getContext("2d");
    g.scale(2, 2); // draw at zoom 0.5 so the pattern is visible in a 56x40 swatch
    B.draw(g, style, { x0: 0, y0: 0, x1: 112, y1: 80 }, 0.5);
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
    const grid = el("div", "bg-presets", pop);
    for (const p of B.PRESETS) {
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
