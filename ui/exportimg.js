"use strict";
// PNG / SVG export of the current page or every page, plus the Export menu (PDF / PNG / SVG).
// SVG text comes from SvgExport.pageToSvg (pure, tested); PNG is composited on a canvas the way the screen draws it.
(function () {
  const { invoke } = window.__TAURI__.core;
  const dialog = window.__TAURI__.dialog;
  const A = window.__app;
  const $$ = (id) => document.getElementById(id);
  const MAX_PIXELS = 24e6;
  const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };

  // ---------- menu ----------
  const pop = el("div", { id: "exportMenuPop", hidden: true, className: "pop" });
  pop.setAttribute("role", "menu");
  const btn = $$("exportMenu");
  const close = () => { pop.hidden = true; btn.setAttribute("aria-expanded", "false"); };
  for (const [label, icon, act] of [["PDF", "export-pdf", () => $$("exportPdf").click()], ["PNG image", "image", () => ask("png")], ["SVG vector", "file-code", () => ask("svg")]]) {
    const b = el("button", { type: "button", textContent: label, onclick: () => { close(); act(); } });
    b.dataset.icon = icon; b.setAttribute("role", "menuitem");
    pop.append(b);
  }
  document.body.append(pop);
  btn.onclick = (ev) => {
    ev.stopPropagation();
    if (!pop.hidden) return close();
    pop.hidden = false; btn.setAttribute("aria-expanded", "true");
    if (window.Chrome) Chrome.placePopover(pop, btn);
  };
  document.addEventListener("pointerdown", (ev) => { if (!pop.hidden && !pop.contains(ev.target) && !btn.contains(ev.target)) close(); });
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") close(); });

  // ---------- options modal ----------
  // Resolves { all, background, grid, scale } or null when cancelled.
  function options(fmt) {
    return new Promise((resolve) => {
      const radio = (value, text, checked) => el("label", { className: "opt exp" }, el("input", { type: "radio", name: "exppages", value, checked }), el("span", {}, text));
      const check = (text, checked) => { const c = el("input", { type: "checkbox", checked }); return [c, el("label", { className: "opt exp" }, c, el("span", {}, text))]; };
      const [bg, bgL] = check("Include background", true);
      const [grid, gridL] = check("Include grid", true);
      bg.onchange = () => { grid.disabled = !bg.checked; };
      const scale = el("select", {}, ...[1, 2, 3].map((n) => el("option", { value: n, textContent: `${n}x`, selected: n === 2 })));
      const ok = el("button", { textContent: "Export", className: "on" }), no = el("button", { textContent: "Cancel" });
      const box = el("div", { className: "pdfdlg" },
        el("h3", { textContent: `Export ${fmt.toUpperCase()}` }),
        radio("cur", "Current page", true), radio("all", "All pages (one numbered file per page)", false),
        bgL, gridL, ...(fmt === "png" ? [el("label", {}, "Scale", scale)] : []),
        el("div", { className: "btns" }, no, ok));
      box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true");
      const back = el("div", { className: "pdfdlg-back" }, box);
      const done = (v) => { back.remove(); document.removeEventListener("keydown", onKey, true); resolve(v); };
      const onKey = (ev) => {
        if (ev.key === "Escape") { ev.stopPropagation(); done(null); }
        else if (ev.key === "Enter" && ev.target.tagName !== "SELECT") submit();
      };
      const submit = () => done({
        all: box.querySelector("input[name=exppages]:checked").value === "all",
        background: bg.checked, grid: grid.checked, scale: Number(scale.value),
      });
      ok.onclick = submit; no.onclick = () => done(null);
      back.addEventListener("pointerdown", (ev) => { if (ev.target === back) done(null); });
      document.addEventListener("keydown", onKey, true);
      document.body.append(back);
      ok.focus();
    });
  }

  // ---------- rendering ----------
  const loadImage = (url) => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = url; });
  const toBlob = (canvas, type) => new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("canvas export failed"))), type));

  async function mediaBytes(name) {
    return new Uint8Array(await invoke("read_media", { path: A.S.path, name }));
  }
  async function mediaDataUri(name) {
    const bytes = await mediaBytes(name);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return "data:image/png;base64," + btoa(bin);
  }

  function inkStroke(c, s, A) {
    const op = s.opacity != null && isFinite(s.opacity) ? Math.min(1, Math.max(0, s.opacity)) : s.kind === "highlighter" ? 0.4 : 1;
    if (op >= 1 || s.points.length < 2) { c.save(); c.globalAlpha = op; A.drawStroke(s, c); c.restore(); return; }
    // translucent ink: one path, so overlapping segments do not darken each other
    const avg = s.points.reduce((a, p) => a + (isFinite(p.p) ? p.p : 0.5), 0) / s.points.length;
    c.save();
    c.globalAlpha = op; c.strokeStyle = s.color; c.lineCap = c.lineJoin = "round"; c.lineWidth = s.width * (0.4 + 1.2 * avg);
    c.beginPath(); s.points.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y))); c.stroke();
    c.restore();
  }

  async function renderPng(pg, opt) {
    const hidden = new Set((pg.layers || []).filter((l) => l.visible === false).map((l) => l.id));
    const vis = (o) => !(o.layer && hidden.has(o.layer));
    const b = SvgExport.bounds(pg);
    let k = opt.scale;
    if (b.w * b.h * k * k > MAX_PIXELS) k = Math.sqrt(MAX_PIXELS / (b.w * b.h));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(b.w * k)); canvas.height = Math.max(1, Math.round(b.h * k));
    const c = canvas.getContext("2d");
    c.setTransform(k, 0, 0, k, -b.x0 * k, -b.y0 * k);
    if (opt.background) {
      let style = Backgrounds.resolve(A.S.doc, pg);
      if (!opt.grid) style = { pattern: "plain", color: style.color };
      Backgrounds.draw(c, style, { x0: b.x0, y0: b.y0, x1: b.x0 + b.w, y1: b.y0 + b.h }, k);
    }
    if (pg.background) {
      try {
        const url = URL.createObjectURL(new Blob([await mediaBytes(pg.background)], { type: "image/png" }));
        try { c.drawImage(await loadImage(url), 0, 0, pg.width, pg.height); } finally { URL.revokeObjectURL(url); }
      } catch (_) { /* missing media: export the rest alone */ }
    }
    const objs = (pg.objects || []).filter(vis);
    for (const o of objs) {
      if (o.type !== "image") continue;
      try { c.drawImage(await loadImage(`data:${o.mime};base64,${o.data}`), o.x, o.y, o.w, o.h); } catch (_) { /* skip undecodable */ }
    }
    if (typeof Graphs !== "undefined") Graphs.draw(c, { objects: objs });
    (pg.strokes || []).filter(vis).forEach((s) => s.points.length && inkStroke(c, s, A));
    for (const o of objs) if (o.type === "shape") Shapes.drawShape(c, o);
    for (const o of objs) {
      if (o.type !== "text") continue;
      const t = SvgExport.textBox(o);
      c.fillStyle = /^#[0-9a-fA-F]{3,8}$/.test(o.color) ? o.color : "#000000";
      c.font = `${o.italic ? "italic " : ""}${o.bold ? "bold " : ""}${t.size}px system-ui, sans-serif`;
      c.textAlign = "left"; c.textBaseline = "alphabetic";
      t.lines.forEach((l, i) => c.fillText(l, o.x, o.y + t.size + i * t.lh));
    }
    return new Uint8Array(await (await toBlob(canvas, "image/png")).arrayBuffer());
  }

  async function renderSvg(pg, opt) {
    let backgroundImage;
    if (pg.background) { try { backgroundImage = await mediaDataUri(pg.background); } catch (_) { /* skip */ } }
    const svg = SvgExport.pageToSvg(pg, { style: Backgrounds.resolve(A.S.doc, pg), background: opt.background, grid: opt.grid, backgroundImage });
    return new TextEncoder().encode('<?xml version="1.0" encoding="UTF-8"?>\n' + svg);
  }

  // ---------- writing ----------
  const hex = (s) => Array.from(new TextEncoder().encode(s), (b) => b.toString(16).padStart(2, "0")).join("");
  const writeFile = (path, bytes) => invoke("write_file", bytes, { headers: { "path-hex": hex(path) } });
  const safeName = (s) => (String(s || "notebook").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim() || "notebook");

  async function ask(fmt) {
    const { S } = A;
    if (!S.doc) return;
    try {
      const opt = await options(fmt);
      if (!opt) return;
      const pages = opt.all ? S.doc.pages : [S.doc.pages[S.page]];
      const title = safeName(S.doc.title), render = fmt === "png" ? renderPng : renderSvg;
      const filters = [{ name: fmt.toUpperCase(), extensions: [fmt] }];
      if (S.dirty) await A.saveNow();
      let target;
      if (opt.all) {
        const dir = await dialog.open({ directory: true, title: "Choose a folder for the exported pages" });
        if (!dir) return;
        const sep = String(dir).includes("\\") && !String(dir).includes("/") ? "\\" : "/";
        const width = String(pages.length).length;
        target = (i) => `${String(dir).replace(/[\\/]+$/, "")}${sep}${title}-${String(i + 1).padStart(width, "0")}.${fmt}`;
      } else {
        const out = await dialog.save({ defaultPath: `${title}.${fmt}`, filters });
        if (!out) return;
        target = () => out;
      }
      for (let i = 0; i < pages.length; i++) {
        A.status(`Exporting ${fmt.toUpperCase()} ${i + 1} / ${pages.length}…`);
        await writeFile(target(i), await render(pages[i], opt));
      }
      A.status(`Exported ${pages.length} ${fmt.toUpperCase()} file${pages.length === 1 ? "" : "s"}`);
    } catch (e) {
      A.banner(`${fmt.toUpperCase()} export failed: ` + (e && e.message ? e.message : e));
      A.status("");
    }
  }
})();
