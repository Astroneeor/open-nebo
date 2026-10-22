"use strict";
// Pasted / dropped images as page objects. Loaded before app.js; uses its globals
// (S, page, pos, render, touch, status, uid, cv, $) lazily, at event time.
// Image x/y/w/h live in page coordinates, the same space as stroke points.
const Images = (() => {
  const TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
  const MAX_BYTES = 25 * 1024 * 1024, MIN_SIZE = 20;
  const cache = new Map(); // object id -> { src, img }
  const sel = { id: null, pageId: null };
  let drag = null; // { mode: "move" | corner, start, before, obj, moved }
  let log = [], logPath = null;

  const imgs = (pg) => (pg.objects || []).filter((o) => o.type === "image");
  const find = (pg, id) => imgs(pg).find((o) => o.id === id);
  const src = (o) => `data:${o.mime};base64,${o.data}`;
  const scale = () => 1 / V.zoom; // world units per screen px

  function bitmap(o) {
    let c = cache.get(o.id);
    if (!c || c.data !== o.data) {
      c = { data: o.data, img: new Image() };
      c.img.onload = () => render();
      c.img.src = src(o);
      cache.set(o.id, c);
    }
    return c.img;
  }

  function draw(g, pg) {
    for (const o of imgs(pg)) {
      const im = bitmap(o);
      if (im.complete && im.naturalWidth) g.drawImage(im, o.x, o.y, o.w, o.h);
    }
  }

  const selected = () => (S.doc && sel.id && page().id === sel.pageId ? find(page(), sel.id) : null);

  function corners(o) {
    return { nw: [o.x, o.y], ne: [o.x + o.w, o.y], sw: [o.x, o.y + o.h], se: [o.x + o.w, o.y + o.h] };
  }

  function overlay(g, pg) {
    const o = selected();
    if (!o || S.tool !== "select") return;
    const k = scale();
    g.save();
    g.strokeStyle = "#2e7dff"; g.lineWidth = 2 * k; g.setLineDash([6 * k, 4 * k]);
    g.strokeRect(o.x, o.y, o.w, o.h);
    g.setLineDash([]); g.fillStyle = "#fff";
    for (const [cx, cy] of Object.values(corners(o))) {
      g.beginPath(); g.rect(cx - 6 * k, cy - 6 * k, 12 * k, 12 * k); g.fill(); g.stroke();
    }
    g.restore();
  }

  // ---------- undo ----------
  function resetLogIfNewDoc() { if (logPath !== S.path) { log = []; logPath = S.path; } }
  const pageById = (id) => S.doc && S.doc.pages.find((p) => p.id === id);
  function logStroke() { resetLogIfNewDoc(); log.push({ k: "stroke" }); }
  function push(e) { resetLogIfNewDoc(); log.push(e); }

  // Returns true when it handled the undo; false means "pop the last stroke as usual".
  function undo() {
    resetLogIfNewDoc();
    while (log.length && log[log.length - 1].k === "stroke" && S.doc && !page().strokes.length) log.pop();
    const e = log[log.length - 1];
    if (!e) return false;
    if (e.k === "stroke") { log.pop(); return false; }
    if (e.undo) { log.pop(); e.undo(); touch(); render(); return true; } // generic op pushed by selection.js
    log.pop();
    const pg = pageById(e.pageId);
    if (!pg) return true;
    pg.objects = pg.objects || [];
    if (e.k === "add") {
      pg.objects = pg.objects.filter((o) => o.id !== e.obj.id);
      if (sel.id === e.obj.id) sel.id = null;
    } else if (e.k === "del") {
      pg.objects.splice(Math.min(e.index, pg.objects.length), 0, e.obj);
    } else if (e.k === "xf") {
      const o = find(pg, e.id);
      if (o) Object.assign(o, e.before);
    }
    touch(); render();
    return true;
  }

  // ---------- adding ----------
  function setTool(t) {
    S.tool = t;
    $("pen").classList.toggle("on", t === "pen");
    $("eraser").classList.toggle("on", t === "eraser");
    $("selectTool").classList.toggle("on", t === "select");
    cv.style.cursor = t === "select" ? "default" : "crosshair";
    if (t !== "select") sel.id = null;
    render();
  }

  const readDataUrl = (blob) => new Promise((res, rej) => {
    const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob);
  });
  const natural = (url) => new Promise((res, rej) => {
    const i = new Image(); i.onload = () => res([i.naturalWidth, i.naturalHeight]); i.onerror = () => rej(new Error("not a readable image")); i.src = url;
  });

  // `at` is a point in page coordinates, or omitted to use the middle of the visible area.
  async function addBlob(blob, at) {
    if (!S.doc || S.conflict) return;
    if (!TYPES.includes(blob.type)) { status(`Unsupported image type ${blob.type || "(unknown)"}`); return; }
    if (blob.size > MAX_BYTES) { status("Image is larger than 25 MB"); return; }
    try {
      const url = await readDataUrl(blob);
      const [nw, nh] = await natural(url);
      const pg = page();
      const vw = cv.clientWidth / V.zoom, vh = cv.clientHeight / V.zoom; // visible world size
      const f = Math.min(1, (vw * 0.5) / nw, (vh * 0.5) / nh);
      const w = Math.max(MIN_SIZE, nw * f), h = Math.max(MIN_SIZE, nh * f);
      const c = at || visibleCenter();
      const o = { type: "image", id: uid().replace(/[^A-Za-z0-9_-]/g, ""), mime: blob.type,
                  data: url.slice(url.indexOf(",") + 1),
                  x: c.x - w / 2, y: c.y - h / 2, w, h };
      (pg.objects = pg.objects || []).push(o);
      push({ k: "add", pageId: pg.id, obj: o });
      sel.id = o.id; sel.pageId = pg.id;
      setTool("select"); touch();
    } catch (e) { status("Cannot add image: " + e.message); }
  }

  function visibleCenter() {
    return { x: V.x + cv.clientWidth / 2 / V.zoom, y: V.y + cv.clientHeight / 2 / V.zoom };
  }

  document.addEventListener("paste", (ev) => {
    if (/^(INPUT|TEXTAREA)$/.test((ev.target || {}).tagName || "")) return;
    const f = [...(ev.clipboardData ? ev.clipboardData.items : [])].find((i) => i.kind === "file" && i.type.startsWith("image/"));
    const blob = f && f.getAsFile();
    if (blob) { ev.preventDefault(); addBlob(blob); }
  });

  const stage = () => $("stage");
  document.addEventListener("DOMContentLoaded", () => {
    const b = document.createElement("button");
    b.id = "selectTool"; b.textContent = "Select"; b.title = "Select, move and resize images (Delete removes)";
    $("eraser").after(b);
    b.onclick = () => setTool("select");
    $("pen").addEventListener("click", () => setTool("pen"));
    $("eraser").addEventListener("click", () => setTool("eraser"));

    stage().addEventListener("dragover", (ev) => { if ([...ev.dataTransfer.types].includes("Files")) ev.preventDefault(); });
    stage().addEventListener("drop", (ev) => {
      const files = [...ev.dataTransfer.files].filter((f) => f.type.startsWith("image/"));
      if (!files.length) return;
      ev.preventDefault();
      const at = pos(ev);
      files.forEach((f, i) => addBlob(f, { x: at.x + i * 24, y: at.y + i * 24 }));
    });
  });

  // ---------- select / move / resize / delete ----------
  function hitHandle(o, p) {
    const k = scale() * 9;
    return Object.entries(corners(o)).find(([, [cx, cy]]) => Math.abs(p.x - cx) <= k && Math.abs(p.y - cy) <= k);
  }
  const hitImage = (pg, p) => imgs(pg).reverse().find((o) => p.x >= o.x && p.x <= o.x + o.w && p.y >= o.y && p.y <= o.y + o.h);

  cv.addEventListener("pointerdown", (ev) => {
    if (S.tool !== "select" || !S.doc || S.conflict) return;
    ev.stopImmediatePropagation();
    if (V.down(ev)) { drag = null; render(); return; } // pan / pinch gesture
    cv.setPointerCapture(ev.pointerId);
    const p = pos(ev), cur = selected();
    const hh = cur && hitHandle(cur, p);
    const o = hh ? cur : hitImage(page(), p);
    if (!o) { sel.id = null; render(); return; }
    sel.id = o.id; sel.pageId = page().id;
    drag = { mode: hh ? hh[0] : "move", start: p, obj: o, moved: false,
             before: { x: o.x, y: o.y, w: o.w, h: o.h } };
    render();
  }, true);

  cv.addEventListener("pointermove", (ev) => {
    if (S.tool !== "select") return;
    ev.stopImmediatePropagation();
    if (V.move(ev)) return;
    const p = pos(ev);
    if (!drag) {
      const cur = selected(), hh = cur && hitHandle(cur, p);
      cv.style.cursor = hh ? (hh[0] === "nw" || hh[0] === "se" ? "nwse-resize" : "nesw-resize")
                           : hitImage(page(), p) ? "move" : "default";
      return;
    }
    const { obj: o, before: b, start } = drag;
    if (drag.mode === "move") {
      o.x = b.x + p.x - start.x; o.y = b.y + p.y - start.y;
    } else {
      const east = drag.mode.endsWith("e"), south = drag.mode.startsWith("s");
      const ax = east ? b.x : b.x + b.w, ay = south ? b.y : b.y + b.h; // fixed opposite corner
      const w = Math.max(MIN_SIZE, Math.abs(p.x - ax)), h = w * (b.h / b.w);
      o.w = w; o.h = h;
      o.x = east ? ax : ax - w; o.y = south ? ay : ay - h;
    }
    drag.moved = true;
    render();
  }, true);

  const finish = () => {
    if (!drag) return;
    const { obj: o, before, moved } = drag;
    drag = null;
    if (moved) { push({ k: "xf", pageId: page().id, id: o.id, before }); touch(); }
    render();
  };
  const selEnd = (ev) => { if (S.tool === "select") { ev.stopImmediatePropagation(); if (!V.up(ev)) finish(); } };
  cv.addEventListener("pointerup", selEnd, true);
  cv.addEventListener("pointercancel", selEnd, true);

  document.addEventListener("keydown", (ev) => {
    if (/^(INPUT|TEXTAREA)$/.test((ev.target || {}).tagName || "")) return;
    const o = selected();
    if (!o || (ev.key !== "Delete" && ev.key !== "Backspace")) return;
    ev.preventDefault();
    const pg = page(), index = pg.objects.indexOf(o);
    pg.objects.splice(index, 1);
    push({ k: "del", pageId: pg.id, obj: o, index });
    sel.id = null; cache.delete(o.id); touch(); render();
  });

  function logAdd(pageId, obj) { resetLogIfNewDoc(); push({ k: "add", pageId, obj }); }
  // selection.js owns the Select tool; it adopts an image selected here (paste/drop) via takeSelection().
  const takeSelection = () => { const id = selected() ? sel.id : null; sel.id = null; return id; };

  return { draw, overlay, undo, logStroke, logAdd, push, takeSelection };
})();
