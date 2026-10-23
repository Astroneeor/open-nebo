"use strict";
// Page sidebar: a collapsible strip of live thumbnails. Click to go to a page, drag to reorder, right-click (or the
// "..." button / context-menu key) for move up/down, duplicate, insert and delete. Hidden for infinite-canvas documents.
(() => {
  const A = window.__app, $ = (id) => document.getElementById(id);
  const side = $("pageSidebar"), list = $("pageThumbs"), toggle = $("sidebarToggle");
  const TW = 112; // thumbnail width in CSS px
  const thumbs = new Map(); // page id -> { li, cv, sig, drawn }
  let lastDoc = null, order = "", open = lsGet("pageSidebar") !== "0", menu = null, dragFrom = -1, timer = null;
  const pending = new Set();

  function lsGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* storage may be unavailable */ } }
  const isCanvas = () => !A.S.doc || A.S.doc.kind === "canvas";
  const visible = () => !!A.S.doc && !isCanvas() && open;

  const io = typeof IntersectionObserver === "function"
    ? new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) { const id = e.target.dataset.id; pending.add(id); schedule(40); } }, { root: list })
    : null;

  // Cheap fingerprint of what a page looks like, so unchanged thumbnails are not redrawn.
  function sig(pg) {
    const st = pg.strokes || [], last = st[st.length - 1];
    const objs = (pg.objects || []).map((o) => [o.id, o.x, o.y, o.w, o.h, o.points && o.points.length, o.points && o.points[0] && o.points[0].x, o.color].join(","));
    return [pg.width, pg.height, JSON.stringify(pg.style || null), pg.background || "", st.length, last && last.id, last && last.points.length, objs.join(";")].join("|");
  }

  function drawThumb(pg, t) {
    const k = TW / pg.width, c = t.cv.getContext("2d");
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, t.cv.width, t.cv.height);
    const dpr = t.cv.width / TW;
    c.setTransform(dpr * k, 0, 0, dpr * k, 0, 0);
    c.save();
    c.beginPath(); c.rect(0, 0, pg.width, pg.height); c.clip();
    const style = Backgrounds.resolve(A.S.doc, pg);
    try { Backgrounds.draw(c, style, { x0: 0, y0: 0, x1: pg.width, y1: pg.height }, k); } catch (_) { /* keep going: ink matters more */ }
    try { Images.draw(c, pg); } catch (_) { /* image not decoded yet */ }
    try { if (typeof Graphs !== "undefined") Graphs.draw(c, pg); } catch (_) { /* ignore */ }
    for (const s of pg.strokes || []) A.drawStroke(s, c);
    for (const o of pg.objects || []) if (o.type === "shape") Shapes.drawShape(c, o);
    c.restore();
    t.sig = sig(pg); t.drawn = true;
  }

  function schedule(ms) { clearTimeout(timer); timer = setTimeout(flush, ms); }

  function flush() {
    if (!visible()) return;
    const pages = A.S.doc.pages;
    for (const id of [...pending]) {
      const t = thumbs.get(id), pg = pages.find((p) => p.id === id);
      pending.delete(id);
      if (!t || !pg) continue;
      if (t.sig !== sig(pg) || !t.drawn) {
        drawThumb(pg, t);
        if ((pg.objects || []).some((o) => o.type === "image") && !t.retried) { t.retried = true; pending.add(id); schedule(600); }
      }
    }
  }

  function closeMenu() { if (menu) { menu.remove(); menu = null; } }

  function openMenu(i, anchor, x, y) {
    closeMenu();
    const n = A.S.doc.pages.length, P = A.pageActions;
    menu = document.createElement("div");
    menu.id = "thumbMenu"; menu.setAttribute("role", "menu");
    const items = [
      ["Move up", "chevron-up", i > 0, () => P.move(i, i - 1)],
      ["Move down", "chevron-down", i < n - 1, () => P.move(i, i + 1)],
      ["Insert page before", "add-page", true, () => P.add(null, i)],
      ["Add page after", "add-page", true, () => P.add(null, i + 1)],
      ["Duplicate", "duplicate", true, () => P.duplicate(i)],
      ["Delete", "trash", n > 1, () => P.remove(i)],
    ];
    for (const [label, icon, on, fn] of items) {
      const b = document.createElement("button");
      b.type = "button"; b.setAttribute("role", "menuitem"); b.disabled = !on;
      b.dataset.icon = icon; b.textContent = label;
      b.onclick = () => { closeMenu(); fn(); };
      menu.append(b);
    }
    document.body.append(menu);
    if (window.Icons) Icons.apply(menu);
    const r = anchor ? anchor.getBoundingClientRect() : null;
    const px = x != null ? x : r.right, py = y != null ? y : r.bottom;
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    menu.style.left = Math.max(8, Math.min(px, innerWidth - mw - 8)) + "px";
    menu.style.top = Math.max(8, Math.min(py, innerHeight - mh - 8)) + "px";
    const first = menu.querySelector("button:not(:disabled)"); if (first) first.focus();
  }

  function go(i) { A.S.page = i; A.render(); }

  function makeItem(pg) {
    const li = document.createElement("li");
    li.className = "thumb"; li.dataset.id = pg.id; li.draggable = true;
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "thumb-btn";
    const cv = document.createElement("canvas");
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(TW * dpr); cv.height = Math.round(TW * dpr * pg.height / pg.width);
    cv.style.width = TW + "px"; cv.style.height = Math.round(TW * pg.height / pg.width) + "px";
    const num = document.createElement("span"); num.className = "thumb-no";
    btn.append(cv, num);
    const more = document.createElement("button");
    more.type = "button"; more.className = "thumb-more"; more.dataset.icon = "more"; more.title = "Page actions";
    more.setAttribute("aria-haspopup", "menu");
    li.append(btn, more);
    const idx = () => A.S.doc.pages.findIndex((p) => p.id === pg.id);
    btn.onclick = () => go(idx());
    more.onclick = (ev) => { ev.stopPropagation(); openMenu(idx(), more); };
    li.addEventListener("contextmenu", (ev) => { ev.preventDefault(); openMenu(idx(), null, ev.clientX, ev.clientY); });
    btn.addEventListener("keydown", (ev) => {
      const i = idx();
      if (ev.altKey && ev.key === "ArrowUp") { ev.preventDefault(); A.pageActions.move(i, i - 1); focusAfter(pg.id); }
      else if (ev.altKey && ev.key === "ArrowDown") { ev.preventDefault(); A.pageActions.move(i, i + 1); focusAfter(pg.id); }
      else if (ev.key === "Delete") { ev.preventDefault(); A.pageActions.remove(i); }
      else if (ev.key === "ArrowUp" && li.previousElementSibling) { ev.preventDefault(); li.previousElementSibling.querySelector(".thumb-btn").focus(); }
      else if (ev.key === "ArrowDown" && li.nextElementSibling) { ev.preventDefault(); li.nextElementSibling.querySelector(".thumb-btn").focus(); }
    });
    li.addEventListener("dragstart", (ev) => {
      dragFrom = idx(); li.classList.add("dragging");
      ev.dataTransfer.effectAllowed = "move"; try { ev.dataTransfer.setData("text/plain", pg.id); } catch (_) { /* ignore */ }
    });
    li.addEventListener("dragend", () => { dragFrom = -1; li.classList.remove("dragging"); clearMarks(); });
    li.addEventListener("dragover", (ev) => {
      if (dragFrom < 0) return;
      ev.preventDefault(); ev.dataTransfer.dropEffect = "move";
      clearMarks(); li.classList.add(after(ev, li) ? "drop-after" : "drop-before");
    });
    li.addEventListener("drop", (ev) => {
      if (dragFrom < 0) return;
      ev.preventDefault();
      const target = idx(), from = dragFrom;
      let to = after(ev, li) ? target + 1 : target; // slot in the original list
      if (from < to) to -= 1;
      dragFrom = -1; clearMarks();
      A.pageActions.move(from, to);
    });
    io && io.observe(li);
    return { li, cv, num, sig: "", drawn: false };
  }
  const after = (ev, li) => { const r = li.getBoundingClientRect(); return ev.clientY > r.top + r.height / 2; };
  const clearMarks = () => list.querySelectorAll(".drop-before,.drop-after").forEach((e) => e.classList.remove("drop-before", "drop-after"));
  function focusAfter(id) { requestAnimationFrame(() => { const t = thumbs.get(id); if (t) t.li.querySelector(".thumb-btn").focus(); }); }

  // Called after every render: rebuild the list when the page order changed, then update highlight and stale thumbnails.
  function sync() {
    if (A.S.doc !== lastDoc) { lastDoc = A.S.doc; order = ""; thumbs.clear(); list.replaceChildren(); pending.clear(); }
    const show = !!A.S.doc && !isCanvas();
    toggle.hidden = !show;
    side.hidden = !visible();
    if (side.hidden) return;
    const pages = A.S.doc.pages, key = pages.map((p) => p.id).join(",");
    if (key !== order) {
      order = key;
      for (const [id, t] of thumbs) if (!pages.some((p) => p.id === id)) { io && io.unobserve(t.li); thumbs.delete(id); }
      const frag = document.createDocumentFragment();
      for (const pg of pages) {
        let t = thumbs.get(pg.id);
        if (!t) { t = makeItem(pg); thumbs.set(pg.id, t); }
        frag.append(t.li);
      }
      list.replaceChildren(frag);
      if (window.Icons) Icons.apply(list);
    }
    pages.forEach((pg, i) => {
      const t = thumbs.get(pg.id);
      t.num.textContent = String(i + 1);
      const cur = i === A.S.page;
      t.li.classList.toggle("current", cur);
      t.li.firstChild.setAttribute("aria-current", cur ? "page" : "false");
      t.li.firstChild.setAttribute("aria-label", `Page ${i + 1} of ${pages.length}`);
      if (cur && t.sig !== sig(pg)) { pending.add(pg.id); }
    });
    const cur = thumbs.get(pages[A.S.page].id);
    if (cur) {
      const r = cur.li.getBoundingClientRect(), lr = list.getBoundingClientRect();
      if (r.top < lr.top || r.bottom > lr.bottom) cur.li.scrollIntoView({ block: "nearest" });
    }
    if (pending.size) schedule(350); // debounce: stroke-by-stroke rendering during a drag would be wasteful
  }

  function applyOpen() {
    toggle.classList.toggle("on", open);
    toggle.setAttribute("aria-expanded", String(open));
    $("editor").classList.toggle("has-sidebar", visible());
    sync();
    if (open) for (const id of thumbs.keys()) pending.add(id);
    schedule(60);
    A.render(); // the stage resized
  }
  toggle.onclick = () => { open = !open; lsSet("pageSidebar", open ? "1" : "0"); applyOpen(); };

  document.addEventListener("pointerdown", (ev) => { if (menu && !menu.contains(ev.target)) closeMenu(); });
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") closeMenu(); });

  const prev = A.hooks.rendered;
  A.hooks.rendered = () => {
    prev && prev();
    $("editor").classList.toggle("has-sidebar", visible());
    sync();
  };
  toggle.classList.toggle("on", open);
  toggle.setAttribute("aria-expanded", String(open));
  window.PageSidebar = { sync, sig };
})();
