"use strict";
// "+ Page" adds a page in the notebook's current look; the arrow next to it offers a plain, paper, grid or dot page.
(() => {
  const A = window.__app, $ = (id) => document.getElementById(id);
  const ITEMS = [["Plain", "plain"], ["Paper", "paper"], ["Grid", "grid"], ["Dot", "dot"]];
  let menu = null;

  const isCanvas = () => A.S.doc && A.S.doc.kind === "canvas";

  // Insert a blank page at `at` (default: right after the current one). `pattern` changes only the pattern, keeping the colour.
  function addPage(pattern, at) {
    const { S } = A;
    if (!S.doc || isCanvas()) return;
    const base = A.page();
    const pg = PageOps.blankLike(base, A.uid);
    // keep the colour of the page you are on, change only the pattern
    if (pattern) pg.style = { pattern, color: Backgrounds.resolve(S.doc, base).color };
    const i = at == null ? S.page + 1 : Math.max(0, Math.min(S.doc.pages.length, at));
    S.doc.pages.splice(i, 0, pg);
    S.page = i; A.touch(); A.render();
  }

  function duplicatePage(i) {
    const { S } = A;
    if (!S.doc || isCanvas() || !S.doc.pages[i]) return;
    S.doc.pages.splice(i + 1, 0, PageOps.duplicatePage(S.doc.pages[i], A.uid));
    S.page = i + 1; A.touch(); A.render();
  }

  async function confirmDelete() {
    const msg = "Delete this page and everything on it?";
    try { if (window.__TAURI__?.dialog?.ask) return await window.__TAURI__.dialog.ask(msg, { title: "Delete page", kind: "warning" }); } catch (_) { /* fall through */ }
    return window.confirm(msg);
  }

  async function deletePage(i) {
    const { S } = A;
    if (!S.doc || isCanvas() || !S.doc.pages[i]) return;
    if (S.doc.pages.length < 2) { A.status("A notebook needs at least one page"); return; }
    if (!(await confirmDelete())) return;
    if (!S.doc.pages[i]) return;
    const len = S.doc.pages.length, cur = S.page;
    S.doc.pages.splice(i, 1);
    S.page = PageOps.indexAfterDelete(cur, i, len); A.touch(); A.render();
  }

  function movePage(from, to) {
    const { S } = A;
    if (!S.doc || isCanvas() || !S.doc.pages[from] || to < 0 || to >= S.doc.pages.length || from === to) return;
    S.doc.pages = PageOps.reorder(S.doc.pages, from, to);
    S.page = PageOps.indexAfterMove(S.page, from, to); A.touch(); A.render();
  }

  A.pageActions = { add: addPage, duplicate: duplicatePage, remove: deletePage, move: movePage };
  $("addPage").onclick = () => addPage();

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
      const sep = document.createElement("span"); sep.className = "rule"; sep.setAttribute("role", "separator"); menu.append(sep);
      for (const [label, fn] of [
        ["Insert page before", () => addPage(null, A.S.page)],
        ["Duplicate page", () => duplicatePage(A.S.page)],
        ["Move page up", () => movePage(A.S.page, A.S.page - 1)],
        ["Move page down", () => movePage(A.S.page, A.S.page + 1)],
        ["Delete page", () => deletePage(A.S.page)]]) {
        const b = document.createElement("button");
        b.type = "button"; b.textContent = label; b.dataset.pageOp = "1";
        b.onclick = () => { close(); fn(); };
        menu.append(b);
      }
      document.body.append(menu);
    }
    for (const b of menu.querySelectorAll("[data-page-op]")) b.hidden = !!isCanvas();
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
