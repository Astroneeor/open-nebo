"use strict";
// "+ Page" adds a page in the notebook's current look; the arrow next to it offers a plain, paper, grid or dot page.
(() => {
  const A = window.__app, $ = (id) => document.getElementById(id);
  const ITEMS = [["Plain", "plain"], ["Paper", "paper"], ["Grid", "grid"], ["Dot", "dot"]];
  let menu = null;

  function addPage(pattern) {
    const { S } = A;
    if (!S.doc) return;
    const base = A.page();
    const pg = { id: `page-${A.uid()}`, width: base.width, height: base.height, strokes: [], objects: [] };
    // keep the colour of the page you are on, change only the pattern
    if (pattern) pg.style = { pattern, color: Backgrounds.resolve(S.doc, base).color };
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
    menu.hidden = false; $("pageMenu").setAttribute("aria-expanded", "true");
    if (window.Chrome) { Chrome.placePopover(menu, $("pageMenu")); return; }
    const r = $("pageMenu").getBoundingClientRect();
    menu.style.left = Math.max(8, r.left) + "px"; menu.style.top = r.bottom + 6 + "px";
  }

  const btn = document.createElement("button");
  btn.id = "pageMenu"; btn.type = "button"; btn.textContent = "▾"; btn.title = "Add a plain, paper, grid or dot page";
  btn.setAttribute("aria-haspopup", "menu"); btn.setAttribute("aria-expanded", "false");
  btn.onclick = (ev) => { ev.stopPropagation(); if (menu && !menu.hidden) close(); else open(); };
  $("addPage").after(btn);
  document.addEventListener("pointerdown", (ev) => { if (menu && !menu.hidden && !menu.contains(ev.target) && ev.target !== btn) close(); });
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") close(); });
})();
