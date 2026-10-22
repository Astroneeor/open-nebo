"use strict";
// "+ Page" stays a plain blank page; the arrow next to it opens a small menu of ruled templates.
(() => {
  const A = window.__app, $ = (id) => document.getElementById(id);
  const ITEMS = [["Blank", null], ["Lined", "lined"], ["Grid", "grid"], ["Dotted", "dotted"]];
  let menu = null;

  function addPage(template) {
    const { S } = A;
    if (!S.doc) return;
    const base = A.page();
    const pg = { id: `page-${A.uid()}`, width: base.width, height: base.height, strokes: [], objects: [] };
    if (template) pg.template = template;
    S.doc.pages.push(pg);
    S.page = S.doc.pages.length - 1; A.touch(); A.render();
  }

  function close() { if (menu) menu.hidden = true; $("pageMenu").setAttribute("aria-expanded", "false"); }

  function open() {
    if (!menu) {
      menu = document.createElement("div");
      menu.id = "pageMenuPop"; menu.hidden = true;
      for (const [label, t] of ITEMS) {
        const b = document.createElement("button");
        b.type = "button"; b.textContent = `${label} page`;
        b.onclick = () => { close(); addPage(t); };
        menu.append(b);
      }
      document.body.append(menu);
    }
    const r = $("pageMenu").getBoundingClientRect();
    menu.style.left = Math.max(8, r.left) + "px"; menu.style.top = r.bottom + 6 + "px";
    menu.hidden = false; $("pageMenu").setAttribute("aria-expanded", "true");
  }

  const btn = document.createElement("button");
  btn.id = "pageMenu"; btn.type = "button"; btn.textContent = "▾"; btn.title = "Add a blank, lined, grid or dotted page";
  btn.setAttribute("aria-haspopup", "menu"); btn.setAttribute("aria-expanded", "false");
  btn.onclick = (ev) => { ev.stopPropagation(); if (menu && !menu.hidden) close(); else open(); };
  $("addPage").after(btn);
  document.addEventListener("pointerdown", (ev) => { if (menu && !menu.hidden && !menu.contains(ev.target) && ev.target !== btn) close(); });
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") close(); });
})();
