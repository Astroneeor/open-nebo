"use strict";
// Select tool: lasso / marquee / click selection of strokes, images, graphs and shapes, a bounding box with
// corner handles, move / scale, and a floating menu above the selection. World coordinates throughout.
//
// Items are { kind: "stroke" | "image" | "graph" | "shape" | "text", id }. Strokes live in page().strokes, the rest in
// page().objects (their `type`). Everything stays a vector/object of its own kind; nothing is rasterised
// except Flip on images (the file format has no flip flag).
// Draw order is images, graphs, strokes, shapes, so "front/back" reorders within each list.
// A tap on a graph selects it, but a drag that starts on an unselected graph is a lasso (graphs are big and
// usually written over). Edits are recorded through History (history.js); the graph parameter panel is
// driven by Graphs.setSelected().
// Uses app.js globals (S, page, pos, render, touch, status, uid, cv, $, V, Geom, History) lazily.
const Selection = (() => {
  const MIN_IMG = 20, PASTE_STEP = 24;
  let items = [], pageId = null; // current selection
  let drag = null;               // { mode: "move"|"nw"|"ne"|"sw"|"se", start, before, box, moved, tok }
  let lasso = null;              // { pts, rect, add, tap }
  let clip = null, pasteN = 0;   // internal clipboard: { strokes: [], objects: [] } (deep copies)
  let menu = null, colorIn = null, busy = false;

  const newId = () => uid().replace(/[^A-Za-z0-9_-]/g, "");
  const objs = (pg) => pg.objects || [];
  const lookup = (pg, it) => (it.kind === "stroke" ? pg.strokes.find((s) => s.id === it.id) : objs(pg).find((o) => o.type === it.kind && o.id === it.id));
  const live = () => {
    if (!S.doc || pageId !== page().id) return [];
    const pg = page();
    return items.filter((it) => lookup(pg, it));
  };
  const objOf = (it) => lookup(page(), it);
  const same = (a, b) => a.kind === b.kind && a.id === b.id;
  const has = (it) => items.some((x) => same(x, it));
  const setSel = (list) => { items = list; pageId = S.doc ? page().id : null; };
  const clear = () => { items = []; drag = null; };
  const inSel = (cur, kind, id) => cur.some((c) => c.kind === kind && c.id === id);
  const itemBox = (it) => { const o = objOf(it); return it.kind === "stroke" ? Geom.strokeBounds(o) : Geom.objectBox(o); };
  const selBox = () => Geom.unionBounds(live().map(itemBox));

  // ---------- snapshots (so a drag recomputes from the original, not from the last frame) ----------
  const snap = (list) => list.map((it) => ({ it, o: { ...objOf(it) } }));
  // Applies transform t to the snapshot's originals; `k` is the uniform scale factor (for line widths).
  function applyFrom(snaps, t, k = 1) {
    const pg = page();
    for (const s of snaps) {
      const o = lookup(pg, s.it);
      if (!o) continue;
      if (s.it.kind === "stroke") {
        o.points = s.o.points.map((p) => ({ ...p, ...Geom.transformPoint(p, t) }));
        o.width = Math.max(0.5, s.o.width * k);
      } else {
        Object.assign(o, Geom.transformObject(s.o, t));
        if (s.it.kind === "shape") o.width = Math.max(0.5, s.o.width * k);
      }
    }
  }

  // ---------- hit testing ----------
  function hitItem(p) {
    const pg = page(), tol = (k) => Math.max(k, 8 / V.zoom), list = objs(pg);
    for (let i = list.length - 1; i >= 0; i--) if (list[i].type === "shape" && Geom.nearShape(list[i], p, tol(0))) return { kind: "shape", id: list[i].id };
    for (let i = pg.strokes.length - 1; i >= 0; i--) {
      const s = pg.strokes[i];
      if (Geom.nearPolyline(p, s.points, tol((s.width || 2) * 0.8))) return { kind: "stroke", id: s.id };
    }
    for (const kind of ["text", "graph", "image"]) {
      for (let i = list.length - 1; i >= 0; i--) if (list[i].type === kind && Geom.inBox(p, Geom.objectBox(list[i]))) return { kind, id: list[i].id };
    }
    return null;
  }
  function corners(b) { return { nw: { x: b.x, y: b.y }, ne: { x: b.x + b.w, y: b.y }, sw: { x: b.x, y: b.y + b.h }, se: { x: b.x + b.w, y: b.y + b.h } }; }
  const opposite = { nw: "se", ne: "sw", sw: "ne", se: "nw" };
  function hitHandle(b, p) {
    const r = 10 / V.zoom;
    return Object.entries(corners(b)).find(([, c]) => Math.abs(p.x - c.x) <= r && Math.abs(p.y - c.y) <= r);
  }

  // ---------- lasso ----------
  function finishLasso() {
    const l = lasso; lasso = null;
    if (!l) return;
    const pts = l.rect ? Geom.rectPolygon(l.pts[0], l.pts[l.pts.length - 1]) : l.pts;
    const base = l.add ? live() : [];
    if (pts.length < 3 || (l.rect && Math.hypot(pts[2].x - pts[0].x, pts[2].y - pts[0].y) * V.zoom < 4) || (!l.rect && l.pts.length < 4)) {
      if (l.tap) setSel(l.add ? [...base, l.tap] : [l.tap]);   // a tap on a graph selects it
      else if (!l.add) setSel([]);
      return render();
    }
    const pg = page(), found = [];
    for (const s of pg.strokes) if (Geom.fractionInside(s.points, pts) >= 0.5) found.push({ kind: "stroke", id: s.id });
    for (const o of objs(pg)) {
      let hit = false;
      if (o.type === "shape") hit = Geom.fractionInside(Geom.shapeSamples(o), pts) >= 0.5;
      else if (o.type === "graph") hit = Geom.boxInsidePolygon(Geom.objectBox(o), pts); // only when fully enclosed
      else if (o.type === "image" || o.type === "text") hit = Geom.pointInPolygon(Geom.boxCenter(o), pts);
      if (hit) found.push({ kind: o.type, id: o.id });
    }
    setSel([...base, ...found.filter((f) => !base.some((b) => same(b, f)))]);
    render();
  }

  // ---------- pointer handling (capturing, so it runs before app.js's pen handlers) ----------
  cv.addEventListener("pointerdown", (ev) => {
    if (S.tool !== "select" || !S.doc || S.conflict) return;
    ev.stopImmediatePropagation();
    if (V.down(ev)) { drag = null; lasso = null; render(); return; } // pan / pinch gesture
    cv.setPointerCapture(ev.pointerId);
    const p = pos(ev), cur = live(), box = cur.length ? selBox() : null;
    const hh = box && hitHandle(box, p);
    if (hh) {
      drag = { mode: hh[0], start: p, box, before: snap(cur), moved: false, tok: History.begin(page()) };
      return render();
    }
    const hit = hitItem(p);
    if (hit && hit.kind === "graph" && !has(hit) && !(box && Geom.inBox(p, box))) { // tap selects, drag lassos
      lasso = { pts: [p], rect: ev.ctrlKey || ev.metaKey || ev.altKey, add: ev.shiftKey, tap: hit };
      if (!ev.shiftKey) setSel([]);
      return render();
    }
    if (hit) {
      if (ev.shiftKey) { setSel(has(hit) ? cur.filter((x) => !same(x, hit)) : [...cur, hit]); return render(); }
      if (!has(hit)) setSel([hit]);
      drag = { mode: "move", start: p, box: selBox(), before: snap(live()), moved: false, tok: History.begin(page()) };
      return render();
    }
    if (box && Geom.inBox(p, box) && !ev.shiftKey) { // empty space inside the bounding box still drags the selection
      drag = { mode: "move", start: p, box, before: snap(cur), moved: false, tok: History.begin(page()) };
      return render();
    }
    lasso = { pts: [p], rect: ev.ctrlKey || ev.metaKey || ev.altKey, add: ev.shiftKey };
    if (!ev.shiftKey) setSel([]);
    render();
  }, true);

  cv.addEventListener("pointermove", (ev) => {
    if (S.tool !== "select") return;
    ev.stopImmediatePropagation();
    if (V.move(ev)) return;
    const p = pos(ev);
    if (lasso) { lasso.pts.push(p); return render(); }
    if (!drag) {
      const cur = live(), box = cur.length ? selBox() : null, hh = box && hitHandle(box, p);
      cv.style.cursor = hh ? (hh[0] === "nw" || hh[0] === "se" ? "nwse-resize" : "nesw-resize")
                           : hitItem(p) || (box && Geom.inBox(p, box)) ? "move" : "crosshair";
      return;
    }
    if (drag.mode === "move") {
      const d = Snap.delta(drag.box, p.x - drag.start.x, p.y - drag.start.y, window.__app.snapStep());
      applyFrom(drag.before, Geom.translate(d.dx, d.dy));
    }
    else {
      const c = corners(drag.box), a = c[opposite[drag.mode]];
      const f = Geom.cornerScale(a, c[drag.mode], p);
      applyFrom(drag.before, Geom.scaleAbout(a.x, a.y, f), f);
      // images keep a minimum size so they stay grabbable
      for (const s of drag.before) if (s.it.kind === "image") { const o = objOf(s.it); if (o && o.w < MIN_IMG) { o.h *= MIN_IMG / o.w; o.w = MIN_IMG; } }
    }
    drag.moved = true;
    render();
  }, true);

  const selEnd = (ev) => {
    if (S.tool !== "select") return;
    ev.stopImmediatePropagation();
    if (V.up(ev)) return;
    if (lasso) return finishLasso();
    if (drag) {
      const d = drag; drag = null;
      if (d.moved) { History.commit(d.tok, d.mode === "move" ? "move" : "scale"); touch(); }
      render();
    }
  };
  cv.addEventListener("pointerup", selEnd, true);
  cv.addEventListener("pointercancel", selEnd, true);

  // ---------- operations (each one is a single undo step) ----------
  function del() {
    const cur = live();
    if (!cur.length) return;
    const pg = page();
    History.record(pg, "delete", () => {
      pg.strokes = pg.strokes.filter((s) => !inSel(cur, "stroke", s.id));
      pg.objects = objs(pg).filter((o) => !inSel(cur, o.type, o.id));
    });
    setSel([]); touch(); render();
  }

  function copy() {
    const cur = live();
    if (!cur.length) return false;
    const pg = page();
    clip = { strokes: pg.strokes.filter((s) => inSel(cur, "stroke", s.id)).map((s) => structuredClone(s)),
             objects: objs(pg).filter((o) => inSel(cur, o.type, o.id)).map((o) => structuredClone(o)) };
    pasteN = 0; status(`Copied ${cur.length} item${cur.length > 1 ? "s" : ""}`);
    return true;
  }

  function insertCopies(src, dx, dy) {
    const pg = page(), t = Geom.translate(dx, dy), added = [];
    History.record(pg, "paste", () => {
      pg.objects = objs(pg);
      for (const s of src.strokes) {
        const c = structuredClone(s);
        c.id = uid(); c.points = c.points.map((p) => ({ ...p, ...Geom.transformPoint(p, t) }));
        pg.strokes.push(c); added.push({ kind: "stroke", id: c.id });
      }
      for (const o of src.objects) {
        const c = structuredClone(o);
        c.id = newId(); Object.assign(c, Geom.transformObject(c, t));
        pg.objects.push(c); added.push({ kind: c.type, id: c.id });
      }
    });
    setSel(added); touch(); render();
  }

  function duplicate() {
    const cur = live();
    if (!cur.length) return;
    const pg = page();
    const src = { strokes: pg.strokes.filter((s) => inSel(cur, "stroke", s.id)), objects: objs(pg).filter((o) => inSel(cur, o.type, o.id)) };
    const d = PASTE_STEP / V.zoom;
    insertCopies(src, d, d);
  }

  const clipBoxes = () => [...clip.strokes.map(Geom.strokeBounds), ...clip.objects.map(Geom.objectBox)];
  const clipFull = () => !!clip && (clip.strokes.length > 0 || clip.objects.length > 0);

  function paste() {
    if (!clipFull()) return;
    if (S.tool !== "select") $("selectTool").click();
    const c = Geom.boxCenter(Geom.unionBounds(clipBoxes())), view = { x: V.x + cv.clientWidth / 2 / V.zoom, y: V.y + cv.clientHeight / 2 / V.zoom };
    const step = (pasteN++ * PASTE_STEP) / V.zoom;
    insertCopies(clip, view.x - c.x + step, view.y - c.y + step);
  }

  function cut() { if (copy()) del(); }

  function reorder(toFront) {
    const cur = live();
    if (!cur.length) return;
    const pg = page();
    const part = (list, hit) => {
      const picked = list.filter(hit), rest = list.filter((o) => !picked.includes(o));
      return toFront ? [...rest, ...picked] : [...picked, ...rest];
    };
    History.record(pg, "reorder", () => {
      pg.strokes = part(pg.strokes, (s) => inSel(cur, "stroke", s.id));
      pg.objects = part(objs(pg), (o) => inSel(cur, o.type, o.id));
    });
    touch(); render();
  }

  const loadImage = (o) => new Promise((res, rej) => {
    const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("image not readable")); i.src = `data:${o.mime};base64,${o.data}`;
  });
  // Mirrors the pixels (the file format has no flip flag), re-encoded as PNG.
  async function mirrorPixels(o, axis) {
    const im = await loadImage(o), c = document.createElement("canvas");
    c.width = im.naturalWidth; c.height = im.naturalHeight;
    const g = c.getContext("2d");
    g.translate(axis === "h" ? c.width : 0, axis === "v" ? c.height : 0);
    g.scale(axis === "h" ? -1 : 1, axis === "v" ? -1 : 1);
    g.drawImage(im, 0, 0);
    const url = c.toDataURL("image/png");
    return url.slice(url.indexOf(",") + 1);
  }

  async function flip(axis) {
    const cur = live();
    if (!cur.length || busy) return;
    busy = true;
    try {
      const pg = page(), before = snap(cur), box = selBox();
      const baked = new Map();
      for (const s of before) if (s.it.kind === "image") baked.set(s.it.id, await mirrorPixels(objOf(s.it), axis));
      if (page() !== pg) return;
      History.record(pg, "flip", () => {
        applyFrom(before, Geom.flipAbout(box, axis));
        for (const s of before) if (s.it.kind === "image") { const o = objOf(s.it); if (o) { o.data = baked.get(s.it.id); o.mime = "image/png"; } }
      });
      touch(); render();
    } catch (e) { status("Cannot flip: " + e.message); }
    finally { busy = false; }
  }

  const colourable = (c) => c.kind === "stroke" || c.kind === "shape" || c.kind === "text";
  function recolor(color) {
    const cur = live().filter(colourable);
    if (!cur.length) return;
    const pg = page();
    History.record(pg, "recolor", () => { for (const it of cur) objOf(it).color = color; });
    touch(); render();
  }

  function selectAll() {
    if (!S.doc) return;
    const pg = page();
    setSel([...pg.strokes.map((s) => ({ kind: "stroke", id: s.id })), ...objs(pg).map((o) => ({ kind: o.type, id: o.id }))]);
    render();
  }

  // Programmatic selection (used after inserting / pasting an image or graph).
  function select(list) { setSel(list); render(); }

  // ---------- floating menu ----------
  const BUTTONS = [
    ["cut", "Cut", cut], ["copy", "Copy", copy], ["paste", "Paste", paste], ["dup", "Duplicate", duplicate], ["del", "Delete", del],
    ["front", "To front", () => reorder(true)], ["back", "To back", () => reorder(false)],
    ["fliph", "Flip H", () => flip("h")], ["flipv", "Flip V", () => flip("v")],
  ];
  function buildMenu() {
    menu = document.createElement("div");
    menu.id = "selMenu"; menu.hidden = true;
    for (const [id, label, fn] of BUTTONS) {
      const b = document.createElement("button");
      b.dataset.act = id; b.textContent = label;
      b.onclick = () => { fn(); };
      menu.append(b);
    }
    const lab = document.createElement("label");
    lab.dataset.act = "color"; lab.title = "Recolor selected strokes and shapes"; lab.textContent = "Colour ";
    colorIn = document.createElement("input"); colorIn.type = "color"; colorIn.value = "#000000";
    colorIn.onchange = () => recolor(colorIn.value);
    lab.append(colorIn); menu.append(lab);
    menu.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    $("stage").append(menu);
  }

  function updateMenu() {
    if (!menu) return;
    const cur = S.doc && S.tool === "select" ? live() : [];
    const canPaste = clipFull();
    if (drag || lasso || (!cur.length && !canPaste)) { menu.hidden = true; return; }
    menu.hidden = false;
    for (const b of menu.children) {
      const act = b.dataset.act;
      b.hidden = !cur.length && act !== "paste";
      if (act === "paste") b.disabled = !canPaste;
      if (act === "color") b.hidden = !cur.some(colourable);
    }
    const first = cur.find(colourable), fo = first && objOf(first);
    if (fo && /^#[0-9a-f]{6}$/i.test(fo.color)) colorIn.value = fo.color;
    const mw = menu.offsetWidth, mh = menu.offsetHeight, sw = cv.clientWidth;
    let x, y;
    if (cur.length) {
      const b = selBox(), cx = (b.x + b.w / 2 - V.x) * V.zoom, top = (b.y - V.y) * V.zoom, bottom = (b.y + b.h - V.y) * V.zoom;
      x = cx - mw / 2; y = top - mh - 14;
      if (y < 4) y = Math.min(bottom + 14, cv.clientHeight - mh - 4);
    } else { x = (sw - mw) / 2; y = 8; } // nothing selected: a lone Paste chip at the top
    menu.style.left = Math.max(4, Math.min(x, sw - mw - 4)) + "px";
    menu.style.top = Math.max(4, y) + "px";
  }

  // The graph parameter panel follows the selection: shown only while exactly one graph is selected.
  function syncGraphPanel(cur) {
    if (typeof Graphs === "undefined" || !Graphs.setSelected) return;
    Graphs.setSelected(cur.length === 1 && cur[0].kind === "graph" ? cur[0].id : null);
  }

  // ---------- overlay (called from render() inside V.begin/V.end, i.e. in world units) ----------
  function overlay(g) {
    if (S.tool !== "select") { if (items.length) clear(); syncGraphPanel([]); updateMenu(); return; }
    const cur = live(), k = 1 / V.zoom;
    g.save();
    g.strokeStyle = "#2e7dff"; g.fillStyle = "#fff"; g.lineWidth = 1.5 * k;
    if (cur.length > 1) { g.setLineDash([3 * k, 3 * k]); for (const it of cur) { const b = itemBox(it); g.strokeRect(b.x, b.y, b.w, b.h); } }
    if (cur.length) {
      const b = selBox();
      g.lineWidth = 2 * k; g.setLineDash([6 * k, 4 * k]); g.strokeRect(b.x, b.y, b.w, b.h); g.setLineDash([]);
      for (const c of Object.values(corners(b))) { g.beginPath(); g.rect(c.x - 6 * k, c.y - 6 * k, 12 * k, 12 * k); g.fill(); g.stroke(); }
    }
    if (lasso && lasso.pts.length > 1) {
      const pts = lasso.rect ? Geom.rectPolygon(lasso.pts[0], lasso.pts[lasso.pts.length - 1]) : lasso.pts;
      g.setLineDash([5 * k, 4 * k]); g.lineWidth = 1.5 * k; g.fillStyle = "rgba(46,125,255,0.08)";
      g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
      g.closePath(); g.fill(); g.stroke();
    }
    g.restore();
    syncGraphPanel(cur);
    updateMenu();
  }

  // ---------- keyboard / clipboard ----------
  const typing = (ev) => /^(INPUT|TEXTAREA|SELECT)$/.test((ev.target || {}).tagName || "");
  document.addEventListener("keydown", (ev) => {
    if (typing(ev) || !S.doc || S.tool !== "select") return;
    const mod = ev.ctrlKey || ev.metaKey, key = ev.key.toLowerCase();
    if (ev.key === "Delete" || ev.key === "Backspace") { if (live().length) { ev.preventDefault(); del(); } }
    else if (ev.key === "Escape") { clear(); lasso = null; render(); }
    else if (mod && key === "a") { ev.preventDefault(); selectAll(); }
    else if (mod && key === "c") { if (copy()) ev.preventDefault(); }
    else if (mod && key === "x") { if (live().length) { ev.preventDefault(); cut(); } }
    else if (mod && key === "d") { if (live().length) { ev.preventDefault(); duplicate(); } }
  });

  // Ctrl+V: system images are images.js's job; otherwise paste our internal clipboard.
  document.addEventListener("paste", (ev) => {
    if (typing(ev) || !S.doc) return;
    const sysImage = [...(ev.clipboardData ? ev.clipboardData.items : [])].some((i) => i.kind === "file" && i.type.startsWith("image/"));
    if (sysImage || !clip) return;
    ev.preventDefault(); paste();
  });

  document.addEventListener("DOMContentLoaded", buildMenu);
  return { overlay, select, selectAll, clear: () => { clear(); render(); }, count: () => live().length,
           selected: () => live().map((c) => ({ ...c })),
           ops: { del, copy, cut, paste, duplicate, reorder, flip, recolor } };
})();
