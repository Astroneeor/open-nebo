"use strict";
// Select tool: lasso / marquee selection of strokes and images, a bounding box with corner handles,
// move / scale, and a floating menu above the selection. World coordinates throughout (V.toWorld / V.zoom).
//
// Must load BEFORE images.js: both register capturing pointer listeners on the canvas, and ours has to run
// first so that it can stop images.js's older image-only select handlers (it stops propagation in select mode).
// Uses app.js / images.js globals (S, page, pos, render, touch, status, uid, cv, $, Images, V, Geom) lazily.
//
// Items are { kind: "stroke" | "image", id }. Images always draw beneath strokes, so "front/back" reorders
// within each kind. Other object types (graphs, shapes) are not selectable here yet.
const Selection = (() => {
  const MIN_IMG = 20, PASTE_STEP = 24;
  let items = [], pageId = null; // current selection
  let drag = null;               // { mode: "move"|"nw"|"ne"|"sw"|"se", start, before, box, moved }
  let lasso = null;              // { pts, rect, add }
  let clip = null, pasteN = 0;   // internal clipboard: { strokes: [], images: [] } (deep copies)
  let menu = null, colorIn = null, busy = false;

  const imgId = () => uid().replace(/[^A-Za-z0-9_-]/g, "");
  const objs = (pg) => (pg.objects || []).filter((o) => o.type === "image");
  const lookup = (pg, it) => (it.kind === "stroke" ? pg.strokes.find((s) => s.id === it.id) : objs(pg).find((o) => o.id === it.id));
  const live = () => {
    if (!S.doc || pageId !== page().id) return [];
    const pg = page();
    return items.filter((it) => lookup(pg, it));
  };
  const objOf = (it) => lookup(page(), it);
  const has = (it) => items.some((x) => x.kind === it.kind && x.id === it.id);
  const setSel = (list) => { items = list; pageId = S.doc ? page().id : null; };
  const clear = () => { items = []; drag = null; };
  const itemBox = (it) => { const o = objOf(it); return it.kind === "stroke" ? Geom.strokeBounds(o) : { x: o.x, y: o.y, w: o.w, h: o.h }; };
  const selBox = () => Geom.unionBounds(live().map(itemBox));

  // ---------- snapshots (for drag-from-original transforms and undo) ----------
  function snap(list) {
    return list.map((it) => {
      const o = objOf(it);
      return it.kind === "stroke"
        ? { it, color: o.color, width: o.width, points: o.points.map((p) => ({ ...p })) }
        : { it, x: o.x, y: o.y, w: o.w, h: o.h, data: o.data, mime: o.mime };
    });
  }
  function restore(snaps, pg) {
    for (const s of snaps) {
      const o = lookup(pg, s.it);
      if (!o) continue;
      if (s.it.kind === "stroke") { o.color = s.color; o.width = s.width; o.points = s.points.map((p) => ({ ...p })); }
      else Object.assign(o, { x: s.x, y: s.y, w: s.w, h: s.h, data: s.data, mime: s.mime });
    }
  }
  // Applies transform t to the snapshot's originals; `k` scales stroke widths.
  function applyFrom(snaps, t, k = 1) {
    const pg = page();
    for (const s of snaps) {
      const o = lookup(pg, s.it);
      if (!o) continue;
      if (s.it.kind === "stroke") {
        o.points = s.points.map((p) => ({ ...p, ...Geom.transformPoint(p, t) }));
        o.width = Math.max(0.5, s.width * k);
      } else Object.assign(o, Geom.transformBox(s, t));
    }
  }
  const pushOp = (undo) => Images.push({ k: "op", undo });
  function pushRestore(snaps, pg) { pushOp(() => restore(snaps, pg)); touch(); }

  // ---------- hit testing ----------
  function hitItem(p) {
    const pg = page(), tol = (k) => Math.max(k, 8 / V.zoom);
    for (let i = pg.strokes.length - 1; i >= 0; i--) {
      const s = pg.strokes[i];
      if (Geom.nearPolyline(p, s.points, tol((s.width || 2) * 0.8))) return { kind: "stroke", id: s.id };
    }
    const im = objs(pg).reverse().find((o) => Geom.inBox(p, o));
    return im ? { kind: "image", id: im.id } : null;
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
      if (!l.add) setSel([]);
      return render();
    }
    const pg = page(), found = [];
    for (const s of pg.strokes) if (Geom.fractionInside(s.points, pts) >= 0.5) found.push({ kind: "stroke", id: s.id });
    for (const o of objs(pg)) if (Geom.pointInPolygon(Geom.boxCenter(o), pts)) found.push({ kind: "image", id: o.id });
    setSel([...base, ...found.filter((f) => !base.some((b) => b.kind === f.kind && b.id === f.id))]);
    render();
  }

  // ---------- pointer handling (capturing; runs before images.js) ----------
  cv.addEventListener("pointerdown", (ev) => {
    if (S.tool !== "select" || !S.doc || S.conflict) return;
    ev.stopImmediatePropagation();
    if (V.down(ev)) { drag = null; lasso = null; render(); return; } // pan / pinch gesture
    cv.setPointerCapture(ev.pointerId);
    const p = pos(ev), cur = live(), box = cur.length ? selBox() : null;
    const hh = box && hitHandle(box, p);
    if (hh) {
      drag = { mode: hh[0], start: p, box, before: snap(cur), moved: false };
      return render();
    }
    const hit = hitItem(p);
    if (hit) {
      if (ev.shiftKey) { setSel(has(hit) ? cur.filter((x) => !(x.kind === hit.kind && x.id === hit.id)) : [...cur, hit]); return render(); }
      if (!has(hit)) setSel([hit]);
      drag = { mode: "move", start: p, box: selBox(), before: snap(live()), moved: false };
      return render();
    }
    if (box && Geom.inBox(p, box) && !ev.shiftKey) { // empty space inside the bounding box still drags the selection
      drag = { mode: "move", start: p, box, before: snap(cur), moved: false };
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
    if (drag.mode === "move") applyFrom(drag.before, Geom.translate(p.x - drag.start.x, p.y - drag.start.y));
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
      if (d.moved) pushRestore(d.before, page());
      render();
    }
  };
  cv.addEventListener("pointerup", selEnd, true);
  cv.addEventListener("pointercancel", selEnd, true);

  // ---------- operations ----------
  function del() {
    const cur = live();
    if (!cur.length) return;
    const pg = page(), removed = [];
    pg.strokes.forEach((s, i) => { if (cur.some((c) => c.kind === "stroke" && c.id === s.id)) removed.push({ list: "strokes", item: s, index: i }); });
    (pg.objects || []).forEach((o, i) => { if (cur.some((c) => c.kind === "image" && c.id === o.id)) removed.push({ list: "objects", item: o, index: i }); });
    pg.strokes = pg.strokes.filter((s) => !removed.some((r) => r.item === s));
    pg.objects = (pg.objects || []).filter((o) => !removed.some((r) => r.item === o));
    pushOp(() => { // reinsert ascending so the recorded indices line up again
      for (const r of removed.slice().sort((a, b) => a.index - b.index)) (pg[r.list] = pg[r.list] || []).splice(Math.min(r.index, pg[r.list].length), 0, r.item);
    });
    setSel([]); touch(); render();
  }

  function copy() {
    const cur = live();
    if (!cur.length) return false;
    const pg = page();
    clip = { strokes: pg.strokes.filter((s) => cur.some((c) => c.kind === "stroke" && c.id === s.id)).map((s) => structuredClone(s)),
             images: objs(pg).filter((o) => cur.some((c) => c.kind === "image" && c.id === o.id)).map((o) => structuredClone(o)) };
    pasteN = 0; status(`Copied ${cur.length} item${cur.length > 1 ? "s" : ""}`);
    return true;
  }

  function insertCopies(src, dx, dy) {
    const pg = page(), t = Geom.translate(dx, dy), added = [];
    pg.objects = pg.objects || [];
    for (const s of src.strokes) {
      const c = structuredClone(s);
      c.id = uid(); c.points = c.points.map((p) => ({ ...p, ...Geom.transformPoint(p, t) }));
      pg.strokes.push(c); added.push({ kind: "stroke", id: c.id });
    }
    for (const o of src.images) {
      const c = structuredClone(o);
      c.id = imgId(); c.x += dx; c.y += dy;
      pg.objects.push(c); added.push({ kind: "image", id: c.id });
    }
    pushOp(() => {
      pg.strokes = pg.strokes.filter((s) => !added.some((a) => a.kind === "stroke" && a.id === s.id));
      pg.objects = pg.objects.filter((o) => !added.some((a) => a.kind === "image" && a.id === o.id));
    });
    setSel(added); touch(); render();
  }

  function duplicate() {
    const cur = live();
    if (!cur.length) return;
    const pg = page(), ids = (k) => cur.filter((c) => c.kind === k).map((c) => c.id);
    const src = { strokes: pg.strokes.filter((s) => ids("stroke").includes(s.id)), images: objs(pg).filter((o) => ids("image").includes(o.id)) };
    const d = PASTE_STEP / V.zoom;
    insertCopies(src, d, d);
  }

  function paste() {
    if (!clip || !(clip.strokes.length || clip.images.length)) return;
    if (S.tool !== "select") $("selectTool").click();
    const b = Geom.unionBounds([...clip.strokes.map(Geom.strokeBounds), ...clip.images.map((o) => ({ x: o.x, y: o.y, w: o.w, h: o.h }))]);
    const c = Geom.boxCenter(b), view = { x: V.x + cv.clientWidth / 2 / V.zoom, y: V.y + cv.clientHeight / 2 / V.zoom };
    const step = (pasteN++ * PASTE_STEP) / V.zoom;
    insertCopies(clip, view.x - c.x + step, view.y - c.y + step);
  }

  function cut() { if (copy()) del(); }

  function reorder(toFront) {
    const cur = live();
    if (!cur.length) return;
    const pg = page(), beforeS = pg.strokes.slice(), beforeO = (pg.objects || []).slice();
    const part = (list, kind) => {
      const inSel = list.filter((o) => cur.some((c) => c.kind === kind && c.id === o.id));
      const rest = list.filter((o) => !inSel.includes(o));
      return toFront ? [...rest, ...inSel] : [...inSel, ...rest];
    };
    pg.strokes = part(pg.strokes, "stroke");
    pg.objects = part(pg.objects || [], "image");
    pushOp(() => { pg.strokes = beforeS; pg.objects = beforeO; });
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
      applyFrom(before, Geom.flipAbout(box, axis));
      for (const s of before) if (s.it.kind === "image") { const o = objOf(s.it); if (o) { o.data = baked.get(s.it.id); o.mime = "image/png"; } }
      pushRestore(before, pg); render();
    } catch (e) { status("Cannot flip: " + e.message); }
    finally { busy = false; }
  }

  function recolor(color) {
    const cur = live().filter((c) => c.kind === "stroke");
    if (!cur.length) return;
    const pg = page(), before = snap(cur);
    if (before.every((s) => s.color === color)) return;
    for (const s of before) objOf(s.it).color = color;
    pushRestore(before, pg); render();
  }

  function selectAll() {
    if (!S.doc) return;
    const pg = page();
    setSel([...pg.strokes.map((s) => ({ kind: "stroke", id: s.id })), ...objs(pg).map((o) => ({ kind: "image", id: o.id }))]);
    render();
  }

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
    lab.dataset.act = "color"; lab.title = "Recolor selected strokes"; lab.textContent = "Colour ";
    colorIn = document.createElement("input"); colorIn.type = "color"; colorIn.value = "#000000";
    colorIn.onchange = () => recolor(colorIn.value);
    lab.append(colorIn); menu.append(lab);
    menu.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    $("stage").append(menu);
  }

  function updateMenu() {
    if (!menu) return;
    const cur = S.doc && S.tool === "select" ? live() : [];
    const canPaste = !!clip && (clip.strokes.length || clip.images.length);
    if (drag || lasso || (!cur.length && !canPaste)) { menu.hidden = true; return; }
    menu.hidden = false;
    for (const b of menu.children) {
      const act = b.dataset.act;
      b.hidden = !cur.length && act !== "paste";
      if (act === "paste") b.disabled = !canPaste;
      if (act === "color") b.hidden = !cur.some((c) => c.kind === "stroke");
    }
    const st = cur.map((c) => objOf(c)).find((o, i) => cur[i].kind === "stroke");
    if (st && /^#[0-9a-f]{6}$/i.test(st.color)) colorIn.value = st.color;
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

  // ---------- overlay (called from render() inside V.begin/V.end, i.e. in world units) ----------
  function overlay(g) {
    if (S.tool !== "select") { if (items.length) clear(); updateMenu(); return; }
    const adopted = Images.takeSelection(); // an image just pasted / dropped via images.js
    if (adopted) setSel([{ kind: "image", id: adopted }]);
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
  return { overlay, selectAll, clear: () => { clear(); render(); }, count: () => live().length,
           ops: { del, copy, cut, paste, duplicate, reorder, flip, recolor } };
})();
