"use strict";
// PDF import (pdf.js, vendored in ./vendor) and export (pages composited to JPEG,
// assembled into a PDF by the Rust side). Page backgrounds live in the .nebo as media/*.png.
const { invoke } = window.__TAURI__.core;
const dialog = window.__TAURI__.dialog;
const A = window.__app;
const $$ = (id) => document.getElementById(id);

const IMPORT_WIDTH = 1404; // matches the default page width so ink sizes feel the same
const MAX_PIXELS = 24e6;

// ---------- backgrounds ----------
const urls = new Map(); // "path|media/x.png" -> Promise<blobUrl>

function mediaUrl(path, name) {
  const key = `${path}|${name}`;
  if (!urls.has(key)) {
    urls.set(key, invoke("read_media", { path, name })
      .then((buf) => URL.createObjectURL(new Blob([new Uint8Array(buf)], { type: "image/png" })))
      .catch((e) => { urls.delete(key); throw e; }));
  }
  return urls.get(key);
}

// Background images are drawn in world coordinates (inside the viewport transform), so they pan/zoom with the ink.
const bgImgs = new Map(); // "path|media/x.png" -> HTMLImageElement (once loaded)
A.hooks.bg = (c, pg) => {
  const cvEl = $$("cv"), style = Backgrounds.resolve(A.S.doc, pg);
  cvEl.style.background = style.color; // behind the canvas, so a resize never flashes white
  Backgrounds.draw(c, style, { x0: V.x, y0: V.y, x1: V.x + cvEl.clientWidth / V.zoom, y1: V.y + cvEl.clientHeight / V.zoom }, V.zoom);
  if (!pg.background) return;
  const key = `${A.S.path}|${pg.background}`;
  const img = bgImgs.get(key);
  if (img) { if (img.complete && img.naturalWidth) c.drawImage(img, 0, 0, pg.width, pg.height); return; }
  const el = new Image();
  bgImgs.set(key, el);
  mediaUrl(A.S.path, pg.background).then((u) => { el.onload = () => A.render(); el.src = u; })
    .catch(() => bgImgs.delete(key));
};

let pdfjsP;
function pdfjs() {
  pdfjsP ??= import("./vendor/pdf.min.mjs").then((m) => {
    m.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdf.worker.min.mjs", import.meta.url).href;
    return m;
  });
  return pdfjsP;
}

const toBlob = (canvas, type, q) => new Promise((res, rej) =>
  canvas.toBlob((b) => (b ? res(b) : rej(new Error("canvas export failed"))), type, q));

// ---------- import ----------
const MAX_CANVAS_PAGES = 40; // canvas-placed pages live in the notebook file as base64 images

// Ask how to import. Resolves { mode: "notebook" | "canvas", pages: [1-based] } or null if cancelled.
function askImport(total, canPlace, notebookOnly = false) {
  return new Promise((resolve) => {
    const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };
    const mk = (mode, title, hint, checked, disabled) => {
      const r = el("input", { type: "radio", name: "pdfmode", value: mode, checked, disabled });
      return el("label", { className: "opt" }, r, el("span", {}, title, el("small", { textContent: hint })));
    };
    const range = el("input", { type: "text", placeholder: `All ${total} pages  (e.g. 1-3, 5)` });
    const err = el("div", { className: "err" });
    const ok = el("button", { textContent: "Import", className: "on" }), no = el("button", { textContent: "Cancel" });
    const box = el("div", { className: "pdfdlg" },
      el("h3", { textContent: `Import PDF (${total} page${total === 1 ? "" : "s"})` }),
      mk("notebook", "As notebook pages", "A new notebook, one page per PDF page", true, false),
      ...(notebookOnly ? [] : [mk("canvas", "Place on canvas", canPlace ? "Drop the pages onto the current canvas as movable images" : "Open a notebook first", false, !canPlace)]),
      el("label", {}, "Pages", range), err,
      el("div", { className: "btns" }, no, ok));
    box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true");
    const back = el("div", { className: "pdfdlg-back" }, box);
    const done = (v) => { back.remove(); document.removeEventListener("keydown", onKey, true); resolve(v); };
    const onKey = (ev) => { if (ev.key === "Escape") { ev.stopPropagation(); done(null); } else if (ev.key === "Enter") submit(); };
    const submit = () => {
      const r = PageRange.parseRange(range.value, total);
      if (r.error) { err.textContent = r.error; return; }
      const mode = box.querySelector("input[name=pdfmode]:checked").value;
      if (mode === "canvas" && r.pages.length > MAX_CANVAS_PAGES) { err.textContent = `Place at most ${MAX_CANVAS_PAGES} pages on the canvas at once`; return; }
      done({ mode, pages: r.pages });
    };
    ok.onclick = submit; no.onclick = () => done(null);
    back.addEventListener("pointerdown", (ev) => { if (ev.target === back) done(null); });
    document.addEventListener("keydown", onKey, true);
    document.body.append(back);
    range.focus();
  });
}

const blobToBase64 = (blob) => new Promise((res, rej) => {
  const fr = new FileReader();
  fr.onload = () => res(String(fr.result).slice(String(fr.result).indexOf(",") + 1));
  fr.onerror = () => rej(fr.error);
  fr.readAsDataURL(blob);
});

async function placeOnCanvas(pdf, pageNumbers) {
  const { S } = A;
  const target = A.page();
  const vw = V.zoom ? cv.clientWidth / V.zoom : IMPORT_WIDTH;           // visible world width
  const cx = V.x + cv.clientWidth / 2 / V.zoom, cy = V.y + cv.clientHeight / 2 / V.zoom;
  const dispW = Math.max(100, Math.min(IMPORT_WIDTH, vw * 0.8)), gap = 24;
  const canvas = document.createElement("canvas");
  const made = [];
  let y = null;
  for (let n = 0; n < pageNumbers.length; n++) {
    A.status(`Placing page ${n + 1} / ${pageNumbers.length}…`);
    const pg = await pdf.getPage(pageNumbers[n]);
    const vp0 = pg.getViewport({ scale: 1 });
    let scale = IMPORT_WIDTH / vp0.width;
    if (IMPORT_WIDTH * vp0.height * scale > MAX_PIXELS) scale = Math.sqrt(MAX_PIXELS / (vp0.width * vp0.height));
    const vp = pg.getViewport({ scale });
    canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
    const c = canvas.getContext("2d");
    c.fillStyle = "#fff"; c.fillRect(0, 0, canvas.width, canvas.height);
    await pg.render({ canvasContext: c, viewport: vp }).promise;
    const data = await blobToBase64(await toBlob(canvas, "image/png"));
    pg.cleanup();
    const h = dispW * canvas.height / canvas.width;
    if (y === null) y = cy - h / 2;
    made.push({ type: "image", id: A.uid().replace(/[^A-Za-z0-9_-]/g, ""), mime: "image/png", data, source: "pdf",
                x: cx - dispW / 2, y, w: dispW, h });
    y += h + gap;
  }
  (target.objects ||= []).push(...made);
  if (typeof Images !== "undefined" && Images.logAdd) for (const o of made) Images.logAdd(target.id, o);
  A.touch(); A.render();
  A.status(`Placed ${made.length} page${made.length === 1 ? "" : "s"} on the canvas`);
}

// `notebookOnly` (the library's Import PDF) always creates a new notebook, in `dir`;
// from inside a notebook the dialog also offers placing the pages on the canvas.
async function importPdf({ notebookOnly = false, dir } = {}) {
  const { S } = A;
  if (!S.vault) return;
  let task;
  try {
    const file = await dialog.open({ filters: [{ name: "PDF", extensions: ["pdf"] }] });
    if (!file) return;
    if (S.dirty) await A.saveNow();
    A.banner(null);
    A.status("Reading PDF…");
    const lib = await pdfjs();
    const data = new Uint8Array(await invoke("read_pdf", { path: file }));
    task = lib.getDocument({ data, isEvalSupported: false });
    const pdf = await task.promise;

    const choice = await askImport(pdf.numPages, !!S.doc && !S.conflict, notebookOnly);
    if (!choice) { A.status(""); return; }
    if (choice.mode === "canvas") { await placeOnCanvas(pdf, choice.pages); return; }

    const pages = [], sizes = [];
    for (const i of choice.pages) {
      const pg = await pdf.getPage(i);
      const vp = pg.getViewport({ scale: 1 });
      let scale = IMPORT_WIDTH / vp.width;
      if (IMPORT_WIDTH * vp.height * scale > MAX_PIXELS) scale = Math.sqrt(MAX_PIXELS / (vp.width * vp.height));
      pages.push({ pg, scale });
      sizes.push([Math.round(vp.width * scale), Math.round(vp.height * scale)]);
    }

    const title = file.split(/[\\/]/).pop().replace(/\.pdf$/i, "");
    const { path, doc } = await invoke("begin_pdf_import", { dir: dir || S.vault, title, sizes });

    const canvas = document.createElement("canvas");
    for (let i = 0; i < pages.length; i++) {
      A.status(`Importing page ${i + 1} / ${pages.length}…`);
      const { pg, scale } = pages[i];
      const vp = pg.getViewport({ scale });
      canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
      const c = canvas.getContext("2d");
      c.fillStyle = "#fff"; c.fillRect(0, 0, canvas.width, canvas.height);
      await pg.render({ canvasContext: c, viewport: vp }).promise;
      const png = new Uint8Array(await (await toBlob(canvas, "image/png")).arrayBuffer());
      await invoke("put_media", png, { headers: { name: doc.pages[i].background } });
      pg.cleanup();
    }

    Object.assign(S, { path, doc, rev: null, page: 0, dirty: true, conflict: false });
    A.render();
    await A.saveNow();
    await A.refreshList();
    A.hooks.opened?.();
    A.status(`Imported ${pages.length} page${pages.length === 1 ? "" : "s"}`);
  } catch (e) {
    A.banner("PDF import failed: " + (e && e.message ? e.message : e));
    A.status("");
  } finally { if (task) task.destroy(); }
}
A.importPdf = importPdf;
$$("importPdf").onclick = () => importPdf();

// ---------- export ----------
function loadImage(url) {
  return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = url; });
}

// World-space rectangle covering the page sheet plus any content (strokes, images, graphs, shapes)
// that lies outside it, so things placed on the infinite canvas are not cropped away.
function exportBounds(pg) {
  let x0 = 0, y0 = 0, x1 = pg.width, y1 = pg.height;
  const add = (x, y) => { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; };
  for (const s of pg.strokes) for (const p of s.points) add(p.x, p.y);
  for (const o of pg.objects || []) {
    if (o.type === "image") { add(o.x, o.y); add(o.x + o.w, o.y + o.h); }
    else if (o.type === "graph") { add(o.x, o.y); add(o.x + o.size, o.y + o.size * (o.ymax - o.ymin) / (o.xmax - o.xmin)); }
    else if (o.type === "text") { const b = Geom.objectBox(o); add(b.x, b.y); add(b.x + b.w, b.y + b.h); }
    else if (o.type === "shape") {
      if (o.kind === "ellipse") { const [[cx, cy], [rx, ry]] = o.points; add(cx - rx, cy - ry); add(cx + rx, cy + ry); }
      else for (const [x, y] of o.points) add(x, y);
    }
  }
  return { x0: Math.floor(x0), y0: Math.floor(y0), w: Math.ceil(x1 - Math.floor(x0)), h: Math.ceil(y1 - Math.floor(y0)) };
}

// Composite one page the way the screen does: background style, PDF background, images, graphs, ink, shapes.
async function paintPage(pg, canvas) {
  const { S } = A;
  const b = exportBounds(pg);
  const k = b.w * b.h > MAX_PIXELS ? Math.sqrt(MAX_PIXELS / (b.w * b.h)) : 1;
  canvas.width = Math.max(1, Math.round(b.w * k)); canvas.height = Math.max(1, Math.round(b.h * k));
  const c = canvas.getContext("2d");
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.setTransform(k, 0, 0, k, -b.x0 * k, -b.y0 * k);
  Backgrounds.draw(c, Backgrounds.resolve(S.doc, pg), { x0: b.x0, y0: b.y0, x1: b.x0 + b.w, y1: b.y0 + b.h }, k);
  if (pg.background) {
    try { c.drawImage(await loadImage(await mediaUrl(S.path, pg.background)), 0, 0, pg.width, pg.height); }
    catch (_) { /* missing media: export the rest alone */ }
  }
  for (const o of pg.objects || []) {
    if (o.type !== "image") continue;
    try { c.drawImage(await loadImage(`data:${o.mime};base64,${o.data}`), o.x, o.y, o.w, o.h); }
    catch (_) { /* undecodable image: skip it */ }
  }
  if (typeof Graphs !== "undefined") Graphs.draw(c, pg);
  pg.strokes.forEach((s) => A.drawStroke(s, c));
  for (const o of pg.objects || []) { if (o.type === "shape") Shapes.drawShape(c, o); else if (o.type === "text") Text.draw(c, o); }
}

$$("exportPdf").onclick = async () => {
  const { S } = A;
  if (!S.doc) return;
  try {
    if (S.dirty) await A.saveNow();
    const out = await dialog.save({
      defaultPath: `${S.doc.title || "notebook"}.pdf`,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (!out) return;
    await invoke("export_pdf_begin");
    const canvas = document.createElement("canvas");
    for (let i = 0; i < S.doc.pages.length; i++) {
      A.status(`Exporting page ${i + 1} / ${S.doc.pages.length}…`);
      await paintPage(S.doc.pages[i], canvas);
      const jpeg = new Uint8Array(await (await toBlob(canvas, "image/jpeg", 0.92)).arrayBuffer());
      await invoke("export_pdf_page", jpeg, { headers: { width: String(canvas.width), height: String(canvas.height) } });
    }
    await invoke("export_pdf_finish", { path: out });
    A.status("Exported PDF");
  } catch (e) {
    A.banner("PDF export failed: " + (e && e.message ? e.message : e));
    A.status("");
  }
};
