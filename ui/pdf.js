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

A.hooks.page = (pg) => {
  const cvEl = $$("cv");
  if (!pg.background) { cvEl.style.backgroundImage = ""; return; }
  const path = A.S.path;
  mediaUrl(path, pg.background).then((u) => {
    if (A.page() === pg) { cvEl.style.backgroundImage = `url(${u})`; cvEl.style.backgroundSize = "100% 100%"; }
  }).catch(() => { cvEl.style.backgroundImage = ""; });
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
$$("importPdf").onclick = async () => {
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

    const pages = [], sizes = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const pg = await pdf.getPage(i);
      const vp = pg.getViewport({ scale: 1 });
      let scale = IMPORT_WIDTH / vp.width;
      if (IMPORT_WIDTH * vp.height * scale > MAX_PIXELS) scale = Math.sqrt(MAX_PIXELS / (vp.width * vp.height));
      pages.push({ pg, scale });
      sizes.push([Math.round(vp.width * scale), Math.round(vp.height * scale)]);
    }

    const title = file.split(/[\\/]/).pop().replace(/\.pdf$/i, "");
    const { path, doc } = await invoke("begin_pdf_import", { dir: S.vault, title, sizes });

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
    A.status(`Imported ${pages.length} page${pages.length === 1 ? "" : "s"}`);
  } catch (e) {
    A.banner("PDF import failed: " + (e && e.message ? e.message : e));
    A.status("");
  } finally { if (task) task.destroy(); }
};

// ---------- export ----------
function loadImage(url) {
  return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = url; });
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
      const pg = S.doc.pages[i];
      canvas.width = Math.round(pg.width); canvas.height = Math.round(pg.height);
      const c = canvas.getContext("2d");
      c.fillStyle = "#fff"; c.fillRect(0, 0, canvas.width, canvas.height);
      if (pg.background) {
        try { c.drawImage(await loadImage(await mediaUrl(S.path, pg.background)), 0, 0, canvas.width, canvas.height); }
        catch (_) { /* missing media: export the ink alone */ }
      }
      pg.strokes.forEach((s) => A.drawStroke(s, c));
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
