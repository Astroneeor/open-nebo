"use strict";
const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const dialog = window.__TAURI__.dialog;

const $ = (id) => document.getElementById(id);
const cv = $("cv"), ctx = cv.getContext("2d");

const S = { vault: null, entries: [], path: null, doc: null, rev: null, page: 0,
            dirty: false, tool: "pen", current: null, saveTimer: null, saving: false,
            smart: lsGet("smartShapes") === "1", gridSnap: lsGet("gridSnap") === "1", snap: null, holdTimer: null };
function lsGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* storage may be unavailable */ } }

const status = (t) => { $("status").textContent = t; };
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));

function banner(msg) {
  $("banner").hidden = !msg; $("banner").textContent = msg || "";
  window.__app?.hooks.banner?.(msg);
}

// ---------- vault ----------
// The library (ui/library.js) owns the home screen; this keeps the flat recursive list it uses
// for Recent and search.
async function refreshList() {
  S.entries = await invoke("list_vault", { dir: S.vault });
  if (typeof Library !== "undefined") Library.refresh();
}

async function setVault(dir) {
  S.vault = dir;
  await invoke("watch_vault", { dir });
  await refreshList();
}

// ---------- document ----------
async function openPath(path) {
  if (S.dirty) await saveNow();
  try {
    const { doc, rev } = await invoke("open_doc", { path });
    Object.assign(S, { path, doc, rev, page: 0, dirty: false });
    History.reset();
    banner(null); status(""); render(); window.__app.hooks.opened?.();
  } catch (e) { banner("Cannot open: " + e); }
}

function page() { return S.doc.pages[S.page]; }

function drawStroke(s, c = ctx) {
  if (!s.points.length) return;
  const st = Pens.style(s), pts = s.points;
  c.strokeStyle = s.color; c.fillStyle = s.color; c.lineCap = st.cap; c.lineJoin = "round";
  c.save(); c.globalAlpha = Pens.opacityOf(s);
  if (pts.length === 1) { c.beginPath(); c.arc(pts[0].x, pts[0].y, s.width / 2, 0, 7); c.fill(); }
  else if (st.single) { // one translucent path, so overlapping segments do not darken
    c.lineWidth = s.width; c.beginPath(); c.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) c.lineTo(pts[i].x, pts[i].y);
    c.stroke();
  } else for (let i = 1; i < pts.length; i++) {
    c.lineWidth = Pens.widthAt(s, (pts[i].p + pts[i - 1].p) / 2);
    if (st.grain) c.globalAlpha = Pens.opacityOf(s) * (0.55 + 0.45 * ((Math.sin(pts[i].x * 12.9898 + pts[i].y * 78.233) * 43758.5453) % 1 + 1) % 1);
    c.beginPath(); c.moveTo(pts[i - 1].x, pts[i - 1].y); c.lineTo(pts[i].x, pts[i].y); c.stroke();
  }
  c.restore();
}

function render() {
  V.sync(S.doc && page());
  ctx.clearRect(0, 0, cv.width, cv.height);
  if (!S.doc) return;
  V.begin(ctx);
  window.__app?.hooks.bg?.(ctx, page());
  Images.draw(ctx, page());
  if (typeof Graphs !== "undefined") Graphs.draw(ctx, page());
  page().strokes.forEach((s) => drawStroke(s)); // not forEach(drawStroke): the index would land in drawStroke's ctx parameter
  (page().objects || []).forEach((o) => { if (o.type === "shape") Shapes.drawShape(ctx, o); });
  if (S.snap) Shapes.drawShape(ctx, S.snap);
  else if (S.current) drawStroke(S.current);
  if (S.current && typeof InputUI !== "undefined") InputUI.drawPredicted(ctx, S.current); // display only, never saved
  Selection.overlay(ctx, page());
  V.end(ctx);
  $("pageNo").textContent = `${S.page + 1} / ${S.doc.pages.length}`;
}

// ---------- saving (debounced, revision-checked) ----------
function touch() { S.dirty = true; status("Unsaved…"); clearTimeout(S.saveTimer); S.saveTimer = setTimeout(saveNow, 800); }

async function saveNow() {
  clearTimeout(S.saveTimer);
  if (!S.dirty || !S.doc || S.saving) return;
  S.saving = true;
  try {
    S.rev = await invoke("save_doc", { path: S.path, doc: S.doc, rev: S.rev });
    S.dirty = false; status("Saved");
  } catch (e) {
    banner(String(e) + " — your edits are kept on screen. Reload the synced version or save as a copy.");
    S.conflict = true;
  } finally { S.saving = false; }
}

// ---------- input ----------
const pos = (ev) => V.toWorld(ev);

function eraseAt(p) {
  const r = 14 / V.zoom, strokes = page().strokes;
  const keep = Pens.eraseStrokes(strokes, p, r, S.eraserMode || "stroke", uid) || strokes;
  const objs = page().objects || [];
  const keepObjs = S.eraserMode === "highlighter" ? objs : objs.filter((o) => !(o.type === "shape" && Shapes.hitShape(o, p, r)));
  if (keep !== strokes || keepObjs.length !== objs.length) {
    page().strokes = keep; page().objects = keepObjs; touch(); render();
  }
}

// ---------- smart shapes ----------
// Grid spacing in world units while "snap to grid" is on and the background has a grid, else 0.
const snapStep = () => (S.gridSnap && S.doc ? Snap.step(Backgrounds.resolve(S.doc, page()), V.zoom) : 0);
function snapOf(stroke) {
  const r = Shapes.recognize(stroke.points);
  const s = snapStep();
  return r && { type: "shape", id: uid(), kind: r.kind, color: stroke.color, width: stroke.width,
                points: s > 0 ? Snap.shapePoints(r.kind, r.points, s) : r.points };
}
function cancelHold() { clearTimeout(S.holdTimer); S.holdTimer = null; S.snap = null; }
function armHold() {
  clearTimeout(S.holdTimer);
  S.holdTimer = setTimeout(() => {
    if (!S.current) return;
    S.snap = snapOf(S.current);
    if (S.snap) render();
  }, Shapes.HOLD_MS);
}

cv.addEventListener("pointerdown", (ev) => {
  if (!S.doc || S.conflict) return;
  if (V.down(ev)) { S.current = null; S.erasing = false; render(); return; }
  cv.setPointerCapture(ev.pointerId);
  const p = pos(ev);
  if (S.tool === "eraser") { S.erasing = true; S.eraseTok = History.begin(page()); eraseAt(p); return; }
  S.t0 = performance.now();
  S.current = { id: uid(), color: $("color").value, width: +$("width").value, ...Pens.newFields(S.penKind),
                points: [{ ...p, t: 0, p: ev.pressure || 0.5 }] };
  S.holdOrigin = p; cancelHold(); if (S.smart) armHold();
  render();
});
cv.addEventListener("pointermove", (ev) => {
  if (V.move(ev)) return;
  const evs = ev.getCoalescedEvents ? ev.getCoalescedEvents() : [ev];
  if (S.erasing) { evs.forEach((e) => eraseAt(pos(e))); return; }
  if (!S.current) return;
  for (const e of evs) S.current.points.push({ ...pos(e), t: Math.round(performance.now() - S.t0), p: e.pressure || 0.5 });
  if (S.smart) {
    // moving on after the hold-snap preview cancels it; otherwise re-arm the hold timer
    const q = S.current.points[S.current.points.length - 1];
    if (Math.hypot(q.x - S.holdOrigin.x, q.y - S.holdOrigin.y) > Shapes.HOLD_RADIUS) { S.holdOrigin = q; cancelHold(); armHold(); }
  }
  render();
});
const end = (ev) => {
  if (V.up(ev)) return;
  if (S.erasing && S.eraseTok) { History.commit(S.eraseTok, "erase"); S.eraseTok = null; }
  S.erasing = false;
  const s = S.current;
  if (!s) return;
  const shape = S.smart ? (S.snap || snapOf(s)) : null;
  cancelHold(); S.current = null;
  const pg = page();
  History.record(pg, shape ? "shape" : "stroke", () => {
    if (shape) (pg.objects || (pg.objects = [])).push(shape); else pg.strokes.push(s);
  });
  touch(); render();
};
cv.addEventListener("pointerup", end); cv.addEventListener("pointercancel", end);

// ---------- toolbar ----------
function tool(t) { S.tool = t; $("pen").classList.toggle("on", t === "pen"); $("eraser").classList.toggle("on", t === "eraser"); }
$("pen").onclick = () => tool("pen"); $("eraser").onclick = () => tool("eraser");
function stepHistory(redo) {
  if (!S.doc || S.conflict) return;
  if (!(redo ? History.redo() : History.undo())) { status(redo ? "Nothing to redo" : "Nothing to undo"); return; }
  touch(); render();
}
$("undo").onclick = () => stepHistory(false);
$("redo").onclick = () => stepHistory(true);
window.addEventListener("keydown", (ev) => {
  if (!(ev.ctrlKey || ev.metaKey) || /^(INPUT|TEXTAREA|SELECT)$/.test((ev.target || {}).tagName || "")) return;
  const k = ev.key.toLowerCase();
  if (k === "z") { ev.preventDefault(); stepHistory(ev.shiftKey); }
  else if (k === "y") { ev.preventDefault(); stepHistory(true); }
});
$("smart").classList.toggle("on", S.smart);
$("smart").onclick = () => {
  S.smart = !S.smart; lsSet("smartShapes", S.smart ? "1" : "0");
  $("smart").classList.toggle("on", S.smart); if (!S.smart) cancelHold(); render();
};
$("snapGrid").classList.toggle("on", S.gridSnap);
$("snapGrid").onclick = () => {
  S.gridSnap = !S.gridSnap; lsSet("gridSnap", S.gridSnap ? "1" : "0");
  $("snapGrid").classList.toggle("on", S.gridSnap); render();
};
$("prev").onclick = () => { if (S.doc && S.page > 0) { S.page--; render(); } };
$("next").onclick = () => { if (S.doc && S.page < S.doc.pages.length - 1) { S.page++; render(); } };
$("addPage").onclick = () => {
  if (!S.doc) return;
  const base = page();
  S.doc.pages.push({ id: `page-${uid()}`, width: base.width, height: base.height, strokes: [] });
  S.page = S.doc.pages.length - 1; touch(); render();
};
$("zoomIn").onclick = () => V.zoomBy(1.25); $("zoomOut").onclick = () => V.zoomBy(0.8);
$("resetView").onclick = () => S.doc && V.reset(page());
History.bind((id) => S.doc && S.doc.pages.find((p) => p.id === id), (pg) => { S.page = S.doc.pages.indexOf(pg); });
V.init(cv, $("stage"), () => S.doc && page(), () => { render(); $("zoomPct").textContent = Math.round(V.zoom * 100) + "%"; });
window.addEventListener("resize", render);
window.addEventListener("beforeunload", () => { if (S.dirty) saveNow(); });

// ---------- Syncthing-driven changes ----------
let watchTimer;
listen("vault-changed", () => {
  clearTimeout(watchTimer);
  // Wait for Syncthing to finish renaming the file into place before reading.
  watchTimer = setTimeout(async () => {
    await refreshList();
    if (!S.path || S.saving) return;
    if (S.dirty || S.conflict) return; // local edits win until the user decides
    try {
      const { doc, rev } = await invoke("open_doc", { path: S.path });
      if (rev !== S.rev) {
        Object.assign(S, { doc, rev, page: Math.min(S.page, doc.pages.length - 1) });
        History.reset();
        status("Updated from sync"); render();
      }
    } catch (_) { /* file may be mid-replace; the next event retries */ }
  }, 600);
});

// Extension surface for feature modules loaded after this script (ui/pdf.js, ...).
window.__app = { S, hooks: {}, snapStep, render, touch, saveNow, openPath, refreshList, setVault, drawStroke, page, status, banner, uid };

(async () => {
  try { await setVault(await invoke("default_vault")); } catch (e) { banner(String(e)); }
  render();
})();
