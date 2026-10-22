"use strict";
// Home screen: folder tree, notebook cards with thumbnails, breadcrumb, recent row and search.
// Structure only; colours/spacing come from CSS variables in library.css so the look can be
// restyled (icons included, see the data-icon attributes) without touching this file.
const Library = (() => {
  const A = window.__app;
  const tauri = window.__TAURI__;
  const call = (cmd, args) => tauri.core.invoke(cmd, args);
  const byId = (id) => document.getElementById(id);

  const THUMB_W = 320, THUMB_H = 240;
  const RECENT_COUNT = 6;

  function el(tag, props = {}, ...kids) {
    const { dataset, attrs, on, ...rest } = props;
    const n = Object.assign(document.createElement(tag), rest);
    if (dataset) Object.assign(n.dataset, dataset);
    if (attrs) for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (on) for (const [k, f] of Object.entries(on)) n.addEventListener(k, f);
    n.append(...kids.filter((k) => k != null));
    return n;
  }
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (_) { /* storage may be unavailable */ } };

  const L = {
    dir: null,            // folder being shown (absolute path)
    tree: null,           // { name, path, children }
    list: null,           // { path, folders, notebooks }
    query: "",
    expanded: new Set(JSON.parse(lsGet("libExpanded") || "[]")),
    drag: null,           // path being dragged
    seq: 0,               // guards against out-of-order refreshes
    thumbs: new Map(),    // "path|modified" -> Promise<{ url, pages, kind } | null>
  };

  const stem = (name) => name.replace(/\.[^./\\]+$/, "");
  const sepOf = (p) => (p.includes("\\") && !p.includes("/") ? "\\" : "/");
  const isRoot = (p) => p === A.S.vault;
  const fmtDate = (secs) => {
    if (!secs) return "";
    const d = new Date(secs * 1000), now = new Date();
    if (d.toDateString() === now.toDateString()) return "Today " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return d.toLocaleDateString([], { day: "numeric", month: "short", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
  };

  // ---------- small modals and the context menu ----------
  function modal({ title, message, fields = [], ok = "OK", danger = false }) {
    return new Promise((resolve) => {
      const inputs = fields.map((f) => {
        const input = f.options
          ? el("select", {}, ...f.options.map((o) => el("option", { value: o.value, textContent: o.label })))
          : el("input", { type: "text", value: f.value || "", placeholder: f.placeholder || "", autocomplete: "off", spellcheck: false });
        if (f.options) input.value = f.value ?? f.options[0]?.value ?? "";
        return { input, row: el("label", { className: "lib-field" }, f.label, input) };
      });
      const okBtn = el("button", { className: "lib-btn primary" + (danger ? " danger" : ""), type: "button", textContent: ok });
      const noBtn = el("button", { className: "lib-btn", type: "button", textContent: "Cancel" });
      const box = el("div", { className: "lib-dialog", attrs: { role: "dialog", "aria-modal": "true", "aria-label": title } },
        el("h3", { textContent: title }),
        message ? el("p", { className: "lib-dialog-msg", textContent: message }) : null,
        ...inputs.map((i) => i.row),
        el("div", { className: "lib-dialog-btns" }, noBtn, okBtn));
      const back = el("div", { className: "lib-dialog-back" }, box);
      const done = (v) => { back.remove(); document.removeEventListener("keydown", onKey, true); resolve(v); };
      const submit = () => {
        const vals = inputs.map((i) => i.input.value);
        if (fields.length && vals.some((v, k) => fields[k].required !== false && !String(v).trim())) return;
        done(vals);
      };
      const onKey = (ev) => {
        if (ev.key === "Escape") { ev.stopPropagation(); done(null); }
        else if (ev.key === "Enter" && ev.target.tagName !== "BUTTON") { ev.preventDefault(); submit(); }
      };
      okBtn.onclick = submit; noBtn.onclick = () => done(null);
      back.addEventListener("pointerdown", (ev) => { if (ev.target === back) done(null); });
      document.addEventListener("keydown", onKey, true);
      document.body.append(back);
      (inputs[0]?.input || okBtn).focus();
      if (inputs[0]?.input.select) inputs[0].input.select();
    });
  }

  let menuEl = null;
  function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }
  function showMenu(x, y, items) {
    closeMenu();
    menuEl = el("div", { className: "lib-menu", attrs: { role: "menu" } },
      ...items.map((it) => el("button", {
        type: "button", className: "lib-menu-item" + (it.danger ? " danger" : ""), textContent: it.label,
        dataset: { icon: it.icon || "" }, attrs: { role: "menuitem" },
        on: { click: () => { closeMenu(); it.run(); } },
      })));
    document.body.append(menuEl);
    const r = menuEl.getBoundingClientRect();
    menuEl.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + "px";
    menuEl.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + "px";
    menuEl.querySelector("button")?.focus();
  }
  document.addEventListener("pointerdown", (ev) => { if (menuEl && !menuEl.contains(ev.target)) closeMenu(); }, true);
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") closeMenu(); });
  window.addEventListener("blur", closeMenu);

  function notice(msg) {
    const b = byId("libBanner");
    if (!b) return;
    b.hidden = !msg; b.textContent = msg || "";
  }
  const fail = (e) => A.banner(String(e && e.message ? e.message : e));

  // ---------- actions ----------
  async function guard(fn) {
    try { A.banner(null); await fn(); } catch (e) { fail(e); }
  }

  function navigate(dir) {
    L.dir = dir; L.query = "";
    const s = byId("libSearch"); if (s) s.value = "";
    refresh();
  }

  const openNotebook = (path) => guard(() => A.openPath(path));

  async function newNotebook(canvas) {
    const v = await modal({
      title: canvas ? "New canvas" : "New notebook",
      fields: [{ label: "Name", value: canvas ? "Untitled canvas" : "Untitled notebook" }],
      ok: "Create",
    });
    if (!v) return;
    await guard(async () => {
      const path = await call("library_new_notebook", { dir: L.dir, title: v[0].trim(), canvas });
      await A.refreshList();
      await A.openPath(path);
    });
  }

  async function newFolder() {
    const v = await modal({ title: "New folder", fields: [{ label: "Name", value: "New folder" }], ok: "Create" });
    if (!v) return;
    await guard(async () => { await call("library_new_folder", { parent: L.dir, name: v[0].trim() }); await A.refreshList(); });
  }

  async function renameItem(path, isFolder, current) {
    const v = await modal({ title: isFolder ? "Rename folder" : "Rename notebook", fields: [{ label: "Name", value: current }], ok: "Rename" });
    if (!v || v[0].trim() === current) return;
    await guard(async () => { await call("library_rename", { path, name: v[0].trim() }); await A.refreshList(); });
  }

  const duplicateItem = (path) => guard(async () => { await call("library_duplicate", { path }); await A.refreshList(); });

  async function trashItem(path, label) {
    const v = await modal({ title: "Move to trash?", message: `"${label}" will be moved to the .trash folder inside your notebooks folder.`, ok: "Move to trash", danger: true });
    if (!v) return;
    await guard(async () => { await call("library_trash", { path }); await A.refreshList(); });
  }

  // Every folder that `path` may be moved into (not itself or anything below it), as { value, label }.
  function destinations(path, isFolder) {
    const out = [];
    const sep = sepOf(A.S.vault);
    const walk = (n, depth) => {
      if (isFolder && (n.path === path || n.path.startsWith(path + sep))) return;
      out.push({ value: n.path, label: (depth ? " ".repeat(depth) : "") + (depth ? n.name : "All notebooks") });
      n.children.forEach((c) => walk(c, depth + 1));
    };
    if (L.tree) walk(L.tree, 0);
    return out;
  }

  async function moveItem(path, isFolder) {
    const opts = destinations(path, isFolder);
    const v = await modal({ title: "Move to…", fields: [{ label: "Folder", options: opts, value: L.dir }], ok: "Move" });
    if (v) await moveTo(path, v[0]);
  }

  const moveTo = (path, dest) => guard(async () => { await call("library_move", { path, dest }); await A.refreshList(); });

  function itemMenu(it, x, y) {
    const items = it.folder
      ? [{ label: "Open", run: () => navigate(it.path) }]
      : [{ label: "Open", run: () => openNotebook(it.path) }];
    items.push({ label: "Rename…", run: () => renameItem(it.path, it.folder, it.folder ? it.name : stem(it.name)) });
    if (!it.folder) items.push({ label: "Duplicate", run: () => duplicateItem(it.path) });
    items.push({ label: "Move to…", run: () => moveItem(it.path, it.folder) });
    items.push({ label: "Delete", danger: true, run: () => trashItem(it.path, it.folder ? it.name : stem(it.name)) });
    showMenu(x, y, items);
  }

  // ---------- drag & drop (move) ----------
  function dropTarget(node, destPath) {
    node.addEventListener("dragover", (ev) => {
      if (!L.drag || L.drag === destPath) return;
      ev.preventDefault(); ev.dataTransfer.dropEffect = "move"; node.classList.add("drop");
    });
    node.addEventListener("dragleave", () => node.classList.remove("drop"));
    node.addEventListener("drop", (ev) => {
      node.classList.remove("drop");
      if (!L.drag) return;
      ev.preventDefault();
      const path = L.drag; L.drag = null;
      if (path !== destPath) moveTo(path, destPath);
    });
  }
  function draggable(node, path) {
    node.draggable = true;
    node.addEventListener("dragstart", (ev) => {
      L.drag = path; ev.dataTransfer.effectAllowed = "move"; ev.dataTransfer.setData("text/plain", path);
      node.classList.add("dragging");
    });
    node.addEventListener("dragend", () => { L.drag = null; node.classList.remove("dragging"); });
  }

  // ---------- thumbnails ----------
  let running = 0;
  const waiting = [];
  function limited(fn) {
    return new Promise((resolve, reject) => {
      const go = () => { running++; fn().then(resolve, reject).finally(() => { running--; waiting.shift()?.(); }); };
      if (running < 2) go(); else waiting.push(go);
    });
  }

  function contentBounds(pg) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const add = (x, y) => { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; };
    for (const s of pg.strokes || []) for (const p of s.points) add(p.x, p.y);
    for (const o of pg.objects || []) {
      if (o.type === "image") { add(o.x, o.y); add(o.x + o.w, o.y + o.h); }
      else if (o.type === "graph") { add(o.x, o.y); add(o.x + o.size, o.y + o.size * (o.ymax - o.ymin) / (o.xmax - o.xmin)); }
      else if (o.type === "shape") {
        if (o.kind === "ellipse") { const [[cx, cy], [rx, ry]] = o.points; add(cx - rx, cy - ry); add(cx + rx, cy + ry); }
        else for (const [x, y] of o.points) add(x, y);
      }
    }
    return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  // World rectangle shown in the thumbnail: the top of the page for notebooks, the fitted content for canvases.
  function viewFor(pg, canvas) {
    const b = canvas ? contentBounds(pg) : null;
    if (b && b.w > 1 && b.h > 1) {
      const pad = Math.max(b.w, b.h) * 0.06, bw = b.w + 2 * pad, bh = b.h + 2 * pad;
      const k = Math.min(THUMB_W / bw, THUMB_H / bh);
      return { k, x: b.x - pad - (THUMB_W / k - bw) / 2, y: b.y - pad - (THUMB_H / k - bh) / 2 };
    }
    return { k: THUMB_W / pg.width, x: 0, y: 0 };
  }

  const loadImage = (url) => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = url; });

  async function paintThumb(c, doc, entry) {
    const pg = doc.pages[0];
    const v = viewFor(pg, doc.kind === "canvas");
    c.setTransform(v.k, 0, 0, v.k, -v.x * v.k, -v.y * v.k);
    // Each layer is best-effort: a missing helper or broken image must not blank the whole card.
    const step = async (fn) => { try { await fn(); } catch (_) { /* skip this layer */ } };
    await step(() => {
      if (typeof Backgrounds === "undefined") return;
      const rect = { x0: v.x, y0: v.y, x1: v.x + THUMB_W / v.k, y1: v.y + THUMB_H / v.k };
      Backgrounds.draw(c, Backgrounds.resolve(doc, pg), rect, v.k);
    });
    await step(async () => {
      if (!pg.background) return;
      const bytes = await call("preview_media", { path: entry.path, name: pg.background });
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "image/png" }));
      try { c.drawImage(await loadImage(url), 0, 0, pg.width, pg.height); } finally { URL.revokeObjectURL(url); }
    });
    for (const o of pg.objects || []) {
      if (o.type !== "image") continue;
      await step(async () => c.drawImage(await loadImage(`data:${o.mime};base64,${o.data}`), o.x, o.y, o.w, o.h));
    }
    await step(() => { if (typeof Graphs !== "undefined") Graphs.draw(c, pg); });
    await step(() => pg.strokes.forEach((s) => A.drawStroke(s, c)));
    await step(() => { for (const o of pg.objects || []) if (o.type === "shape") Shapes.drawShape(c, o); });
  }

  async function makeThumb(entry) {
    const { doc, pages } = await call("preview_doc", { path: entry.path });
    const cv = el("canvas", { width: THUMB_W, height: THUMB_H });
    const c = cv.getContext("2d");
    c.fillStyle = "#fff"; c.fillRect(0, 0, THUMB_W, THUMB_H);
    if (doc.pages[0]) await paintThumb(c, doc, entry);
    return { url: cv.toDataURL("image/png"), pages, kind: doc.kind || null };
  }

  function thumbFor(entry, card) {
    const key = `${entry.path}|${entry.modified}`;
    let p = L.thumbs.get(key);
    if (!p) { p = limited(() => makeThumb(entry)).catch(() => null); L.thumbs.set(key, p); }
    p.then((t) => {
      if (!card.isConnected) return;
      const host = card.querySelector(".lib-thumb");
      if (!t) { host.classList.add("broken"); return; }
      host.querySelector(".lib-thumb-ph")?.remove();
      host.prepend(el("img", { src: t.url, alt: "", draggable: false }));
      if (t.kind === "canvas") host.append(el("span", { className: "lib-badge", textContent: "Canvas" }));
      card.querySelector(".lib-sub").textContent = [t.kind === "canvas" ? null : `${t.pages} page${t.pages === 1 ? "" : "s"}`, fmtDate(entry.modified)].filter(Boolean).join(" · ");
    });
  }

  let io = null;
  function observer() {
    io ??= new IntersectionObserver((hits) => {
      for (const h of hits) if (h.isIntersecting) { io.unobserve(h.target); thumbFor(h.target.__entry, h.target); }
    }, { root: byId("libBody"), rootMargin: "240px" });
    return io;
  }

  // ---------- rendering ----------
  function notebookCard(e, { showPath = false } = {}) {
    const title = stem(e.name);
    const card = el("article", {
      className: "lib-card" + (e.is_conflict ? " conflict" : ""), tabIndex: 0, title,
      dataset: { path: e.path }, attrs: { role: "button", "aria-label": `Open ${title}` },
    },
      el("div", { className: "lib-thumb" }, el("span", { className: "lib-thumb-ph" }),
         e.is_conflict ? el("span", { className: "lib-badge warn", textContent: "Conflict copy" }) : null),
      el("div", { className: "lib-meta" },
        el("div", { className: "lib-title", textContent: title }),
        el("div", { className: "lib-sub", textContent: fmtDate(e.modified) }),
        showPath ? el("div", { className: "lib-path", textContent: relDir(e.path) }) : null),
      el("button", { className: "lib-more", type: "button", textContent: "⋯", dataset: { icon: "more" }, attrs: { "aria-label": "Actions" },
        on: { click: (ev) => { ev.stopPropagation(); const r = ev.currentTarget.getBoundingClientRect(); itemMenu({ path: e.path, name: e.name, folder: false }, r.left, r.bottom + 4); } } }));
    card.__entry = e;
    card.addEventListener("click", () => openNotebook(e.path));
    card.addEventListener("keydown", (ev) => { if (ev.key === "Enter") openNotebook(e.path); else if (ev.key === "F2") renameItem(e.path, false, title); });
    card.addEventListener("contextmenu", (ev) => { ev.preventDefault(); itemMenu({ path: e.path, name: e.name, folder: false }, ev.clientX, ev.clientY); });
    draggable(card, e.path);
    observer().observe(card);
    return card;
  }

  function folderCard(f) {
    const card = el("article", {
      className: "lib-card lib-folder", tabIndex: 0, title: f.name, dataset: { path: f.path },
      attrs: { role: "button", "aria-label": `Open folder ${f.name}` },
    },
      el("div", { className: "lib-thumb" }, el("span", { className: "lib-folder-glyph", dataset: { icon: "folder" } })),
      el("div", { className: "lib-meta" },
        el("div", { className: "lib-title", textContent: f.name }),
        el("div", { className: "lib-sub", textContent: `${f.items} item${f.items === 1 ? "" : "s"}` })),
      el("button", { className: "lib-more", type: "button", textContent: "⋯", dataset: { icon: "more" }, attrs: { "aria-label": "Actions" },
        on: { click: (ev) => { ev.stopPropagation(); const r = ev.currentTarget.getBoundingClientRect(); itemMenu({ path: f.path, name: f.name, folder: true }, r.left, r.bottom + 4); } } }));
    card.addEventListener("click", () => navigate(f.path));
    card.addEventListener("keydown", (ev) => { if (ev.key === "Enter") navigate(f.path); else if (ev.key === "F2") renameItem(f.path, true, f.name); });
    card.addEventListener("contextmenu", (ev) => { ev.preventDefault(); itemMenu({ path: f.path, name: f.name, folder: true }, ev.clientX, ev.clientY); });
    draggable(card, f.path);
    dropTarget(card, f.path);
    return card;
  }

  // Folder part of an absolute notebook path, relative to the vault ("Maths / Year 1"), or "" at the top.
  function relDir(path) {
    const root = A.S.vault, sep = sepOf(root);
    const rel = path.startsWith(root + sep) ? path.slice(root.length + 1) : path;
    const parts = rel.split(/[\\/]/); parts.pop();
    return parts.join(" / ");
  }

  function section(title, content, cls = "lib-grid") {
    return el("section", { className: "lib-section" }, el("h2", { textContent: title }), el("div", { className: cls }, ...content));
  }

  function renderBody() {
    const body = byId("libBody");
    io?.disconnect();
    body.replaceChildren();
    const entries = A.S.entries || [];
    const q = L.query.trim().toLowerCase();
    if (q) {
      const hits = entries.filter((e) => stem(e.name).toLowerCase().includes(q));
      if (!hits.length) body.append(el("p", { className: "lib-empty", textContent: `No notebooks match "${L.query.trim()}".` }));
      else body.append(section(`Results (${hits.length})`, hits.map((e) => notebookCard(e, { showPath: true }))));
      return;
    }
    const recent = entries.filter((e) => !e.is_conflict).sort((a, b) => b.modified - a.modified).slice(0, RECENT_COUNT);
    if (recent.length) body.append(section("Recent", recent.map((e) => notebookCard(e, { showPath: true })), "lib-grid lib-recent"));
    const { folders, notebooks } = L.list || { folders: [], notebooks: [] };
    if (folders.length) body.append(section("Folders", folders.map(folderCard)));
    if (notebooks.length) body.append(section("Notebooks", notebooks.map((e) => notebookCard(e))));
    if (!folders.length && !notebooks.length) {
      body.append(el("div", { className: "lib-empty" },
        el("p", { textContent: isRoot(L.dir) ? "No notebooks yet." : "This folder is empty." }),
        el("p", { className: "lib-hint", textContent: "Create a notebook or canvas, or import a PDF, to get started." })));
    }
  }

  function renderCrumbs() {
    const nav = byId("libCrumbs");
    nav.replaceChildren();
    const root = A.S.vault; if (!root || !L.dir) return;
    const sep = sepOf(root);
    const rel = L.dir === root ? [] : L.dir.slice(root.length + 1).split(/[\\/]/);
    const crumb = (label, path, last) => {
      const b = el("button", { type: "button", className: "lib-crumb" + (last ? " current" : ""), textContent: label, on: { click: () => navigate(path) } });
      if (last) b.setAttribute("aria-current", "page"); else dropTarget(b, path);
      return b;
    };
    let acc = root;
    nav.append(crumb("All notebooks", root, rel.length === 0));
    rel.forEach((part, i) => { acc += sep + part; nav.append(el("span", { className: "lib-crumb-sep", textContent: "/", attrs: { "aria-hidden": "true" } }), crumb(part, acc, i === rel.length - 1)); });
  }

  function treeNode(n, depth) {
    const hasKids = n.children.length > 0;
    const open = depth === 0 || L.expanded.has(n.path);
    const row = el("div", {
      className: "lib-tree-row" + (n.path === L.dir ? " sel" : ""), dataset: { path: n.path },
      attrs: { role: "treeitem", "aria-selected": String(n.path === L.dir), ...(hasKids ? { "aria-expanded": String(open) } : {}) },
      style: `--depth:${depth}`,
    },
      depth && hasKids
        ? el("button", { type: "button", className: "lib-twirl", textContent: open ? "▾" : "▸", attrs: { "aria-label": open ? "Collapse" : "Expand" },
            on: { click: (ev) => { ev.stopPropagation(); open ? L.expanded.delete(n.path) : L.expanded.add(n.path); lsSet("libExpanded", JSON.stringify([...L.expanded])); renderTree(); } } })
        : el("span", { className: "lib-twirl spacer" }),
      el("span", { className: "lib-tree-icon", dataset: { icon: depth ? "folder" : "library" } }),
      el("span", { className: "lib-tree-name", textContent: depth ? n.name : "All notebooks" }));
    row.addEventListener("click", () => navigate(n.path));
    dropTarget(row, n.path);
    const wrap = el("div", { className: "lib-tree-node" }, row);
    if (hasKids && open) wrap.append(el("div", { className: "lib-tree-kids", attrs: { role: "group" } }, ...n.children.map((c) => treeNode(c, depth + 1))));
    return wrap;
  }

  function renderTree() {
    const t = byId("libTree");
    t.replaceChildren();
    if (L.tree) t.append(treeNode(L.tree, 0));
  }

  function render() {
    renderTree(); renderCrumbs(); renderBody();
    byId("libVault").textContent = A.S.vault || "";
  }

  async function refresh() {
    if (!A.S.vault) return;
    const seq = ++L.seq;
    if (!L.dir || !(L.dir === A.S.vault || L.dir.startsWith(A.S.vault))) L.dir = A.S.vault;
    try {
      let [tree, list] = await Promise.all([call("library_tree"), call("library_list", { dir: L.dir }).catch(() => null)]);
      if (!list) { L.dir = A.S.vault; list = await call("library_list", { dir: L.dir }); } // the folder vanished (e.g. synced away)
      if (seq !== L.seq) return;
      L.tree = tree; L.list = list;
      render();
    } catch (e) { if (seq === L.seq) fail(e); }
  }

  // ---------- switching between library and editor ----------
  function showEditor() {
    byId("library").hidden = true;
    byId("editor").hidden = false;
    byId("editor").classList.toggle("is-canvas", A.S.doc?.kind === "canvas");
    A.render();
  }

  async function showLibrary() {
    const { S } = A;
    if (S.dirty) await A.saveNow();
    if (S.conflict) {
      const v = await modal({ title: "Leave without saving?", message: "This notebook changed on disk, so your latest edits could not be saved.", ok: "Leave", danger: true });
      if (!v) return;
    }
    Object.assign(S, { path: null, doc: null, rev: null, dirty: false, conflict: false, page: 0, current: null });
    if (typeof History !== "undefined") History.reset();
    A.banner(null); A.status("");
    A.render();
    byId("editor").hidden = true;
    byId("library").hidden = false;
    await A.refreshList();
  }

  // ---------- build ----------
  function actionBtn(act, icon, label, primary) {
    return el("button", { type: "button", className: "lib-btn" + (primary ? " primary" : ""), textContent: label, dataset: { act, icon } });
  }

  function build() {
    const root = byId("library");
    root.append(
      el("aside", { className: "lib-side" },
        el("div", { className: "lib-brand", textContent: "Open Nebo" }),
        el("nav", { id: "libTree", className: "lib-tree", attrs: { role: "tree", "aria-label": "Folders" } }),
        el("div", { className: "lib-side-foot" },
          el("div", { id: "libVault", className: "lib-vault muted" }),
          el("button", { id: "libPick", type: "button", className: "lib-link", textContent: "Change folder…" }),
          el("button", { id: "libIgnore", type: "button", className: "lib-link", textContent: "Create .stignore" }))),
      el("div", { className: "lib-main" },
        el("header", { className: "lib-bar" },
          el("nav", { id: "libCrumbs", className: "lib-crumbs", attrs: { "aria-label": "Path" } }),
          el("input", { id: "libSearch", type: "search", className: "lib-search", placeholder: "Search notebooks", attrs: { "aria-label": "Search notebooks" } }),
          el("div", { className: "lib-actions" },
            actionBtn("new-notebook", "notebook-plus", "New notebook", true),
            actionBtn("new-canvas", "canvas-plus", "New canvas"),
            actionBtn("new-folder", "folder-plus", "New folder"),
            actionBtn("import-pdf", "file-import", "Import PDF"))),
        el("div", { id: "libBanner", className: "lib-banner", hidden: true, attrs: { role: "alert" } }),
        el("div", { id: "libBody", className: "lib-body" })));

    const act = {
      "new-notebook": () => newNotebook(false),
      "new-canvas": () => newNotebook(true),
      "new-folder": newFolder,
      "import-pdf": () => A.importPdf?.({ notebookOnly: true, dir: L.dir }),
    };
    root.querySelector(".lib-actions").addEventListener("click", (ev) => {
      const b = ev.target.closest("button[data-act]"); if (b) act[b.dataset.act]();
    });
    byId("libSearch").addEventListener("input", (ev) => { L.query = ev.target.value; renderBody(); });
    byId("libSearch").addEventListener("keydown", (ev) => { if (ev.key === "Escape") { ev.target.value = ""; L.query = ""; renderBody(); } });
    byId("libPick").onclick = () => guard(async () => {
      const d = await tauri.dialog.open({ directory: true });
      if (d) { L.dir = d; await A.setVault(d); }
    });
    byId("libIgnore").onclick = () => guard(async () => { await call("write_stignore", { dir: A.S.vault }); A.status("Wrote .stignore"); });
    byId("backLib").onclick = showLibrary;
    window.addEventListener("focus", () => { if (!byId("library").hidden) A.refreshList(); });
    A.hooks.opened = showEditor;
    // The editor's banner is hidden while the library is showing, so mirror messages into the library's own.
    A.hooks.banner = (msg) => { if (!byId("library").hidden) notice(msg); };
  }

  build();
  return { refresh, showLibrary, showEditor, navigate };
})();
