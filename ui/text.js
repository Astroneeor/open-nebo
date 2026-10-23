"use strict";
// Typed text boxes ({type:"text", id, x, y, w, text, size, color, bold, italic, layer}) on the infinite canvas.
// Text tool: click to place a box and type in a <textarea> that tracks pan/zoom; blur / Escape commits it to a
// TextObject (an empty box is dropped). With the Select tool, double-click a box to edit it. Selecting, moving,
// scaling, copying and deleting are selection.js's job (kind "text"); undo/redo is history.js's.
// Wrapping and box height come from textlayout.js. Loaded before app.js; uses its globals lazily.
const Text = (() => {
  const TL = typeof Textlayout !== "undefined" ? Textlayout : require("./textlayout.js");

  // All typed text on a page, in object (z) order, one box per paragraph block. For search.
  function plainText(pg) {
    return ((pg && pg.objects) || []).filter((o) => o.type === "text" && o.text).map((o) => o.text).join("\n");
  }

  let editingId = null;           // object being edited: not drawn on the canvas while its textarea is up

  // Draws one text object into canvas context g (world coordinates). Used by the screen and by PDF export.
  function draw(g, o) {
    if (o.id === editingId || !o.text) return;
    const { lines, lh } = TL.layout(o), size = o.size || TL.DEFAULTS.size;
    g.save();
    g.font = TL.font(o); g.fillStyle = o.color || "#000000"; g.textBaseline = "top";
    lines.forEach((ln, i) => { if (ln) g.fillText(ln, o.x, o.y + i * lh + (lh - size) / 2); });
    g.restore();
  }

  const api = { plainText, draw };
  if (typeof document === "undefined") return api;

  // ---------- editor (browser only) ----------
  const mctx = document.createElement("canvas").getContext("2d");
  TL.setMeasure((s, size, bold, italic) => { mctx.font = TL.font({ size, bold, italic }); return mctx.measureText(s).width; });

  const pref = { size: TL.DEFAULTS.size, bold: false, italic: false, w: TL.DEFAULTS.w };
  let ed = null;                  // { id|null, pg, x, y, w, size, color, bold, italic }
  let ta = null, bar = null, sizeIn = null, boldB = null, italicB = null, colorIn = null, cand = null, btn = null;

  const find = (pg, id) => (pg.objects || []).find((o) => o.type === "text" && o.id === id);
  const hexOnly = (c) => (/^#[0-9a-f]{6}/i.test(c || "") ? c.slice(0, 7) : "#000000");

  function textAt(p) {
    const list = (page().objects || []);
    for (let i = list.length - 1; i >= 0; i--) if (list[i].type === "text" && Geom.inBox(p, Geom.objectBox(list[i]))) return list[i];
    return null;
  }

  function build() {
    ta = document.createElement("textarea");
    ta.id = "textEdit"; ta.hidden = true; ta.spellcheck = false; ta.rows = 1;
    ta.setAttribute("aria-label", "Text box");
    ta.addEventListener("input", () => { fit(); });
    ta.addEventListener("blur", (ev) => { if (!(ev.relatedTarget && bar.contains(ev.relatedTarget))) commit(); });
    ta.addEventListener("keydown", (ev) => {
      ev.stopPropagation();
      if (ev.key === "Escape") { ev.preventDefault(); commit(); }
    });

    bar = document.createElement("div");
    bar.id = "textBar"; bar.hidden = true;
    const mk = (tag, props) => Object.assign(document.createElement(tag), props);
    const dec = mk("button", { type: "button", textContent: "A−", title: "Smaller text" });
    const inc = mk("button", { type: "button", textContent: "A+", title: "Larger text" });
    sizeIn = mk("input", { type: "number", min: 6, max: 400, step: 1, title: "Font size" });
    boldB = mk("button", { type: "button", textContent: "B", title: "Bold" }); boldB.dataset.act = "bold";
    italicB = mk("button", { type: "button", textContent: "I", title: "Italic" }); italicB.dataset.act = "italic";
    colorIn = mk("input", { type: "color", title: "Text colour" });
    const apply = () => {
      if (!ed) return;
      ed.size = Math.min(400, Math.max(6, Math.round(+sizeIn.value) || ed.size));
      pref.size = ed.size; pref.bold = ed.bold; pref.italic = ed.italic;
      style(); ta.focus();
    };
    dec.onclick = () => { sizeIn.value = Math.max(6, +sizeIn.value - 2); apply(); };
    inc.onclick = () => { sizeIn.value = Math.min(400, +sizeIn.value + 2); apply(); };
    sizeIn.onchange = apply;
    boldB.onclick = () => { if (ed) { ed.bold = !ed.bold; apply(); } };
    italicB.onclick = () => { if (ed) { ed.italic = !ed.italic; apply(); } };
    colorIn.oninput = () => { if (ed) { ed.color = colorIn.value; style(); } };
    colorIn.onchange = () => ta.focus();
    bar.append(dec, sizeIn, inc, boldB, italicB, colorIn);
    // keep the textarea focused when a button is pressed (inputs need focus to work)
    bar.addEventListener("mousedown", (ev) => { if (ev.target.tagName === "BUTTON") ev.preventDefault(); });
    bar.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    $("stage").append(ta, bar);
  }

  // Applies ed's font / colour / geometry to the textarea and the toolbar; called on every change and render.
  function style() {
    if (!ed) return;
    const z = V.zoom, fs = ed.size * z;
    Object.assign(ta.style, {
      left: (ed.x - V.x) * z + "px", top: (ed.y - V.y) * z + "px", width: ed.w * z + "px",
      font: TL.font({ size: fs, bold: ed.bold, italic: ed.italic }), lineHeight: TL.LINE_HEIGHT, color: ed.color,
    });
    fit();
    boldB.classList.toggle("on", ed.bold); italicB.classList.toggle("on", ed.italic);
    if (document.activeElement !== sizeIn) sizeIn.value = ed.size;
    colorIn.value = hexOnly(ed.color);
    const bw = bar.offsetWidth, sw = cv.clientWidth, top = parseFloat(ta.style.top), left = parseFloat(ta.style.left);
    const y = top - bar.offsetHeight - 8;
    bar.style.left = Math.max(4, Math.min(left, sw - bw - 4)) + "px";
    bar.style.top = (y < 4 ? top + ta.offsetHeight + 8 : y) + "px";
  }
  function fit() { ta.style.height = "0"; ta.style.height = Math.max(ta.scrollHeight, ed ? ed.size * V.zoom * TL.LINE_HEIGHT : 0) + "px"; }

  function start(spec) {
    if (ed) commit();
    if (!ta) build();
    ed = spec; editingId = spec.id;
    ta.value = spec.text || "";
    ta.hidden = false; bar.hidden = false;
    render();                     // hides the canvas copy of the box
    style(); setTimeout(() => { if (ed === spec) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } }, 0);
  }

  function create(p) {
    start({ id: null, pg: page(), x: p.x, y: p.y, w: pref.w, size: pref.size, color: hexOnly($("color").value), bold: pref.bold, italic: pref.italic });
  }
  function edit(o) {
    start({ id: o.id, pg: page(), x: o.x, y: o.y, w: o.w, size: o.size, color: o.color, bold: !!o.bold, italic: !!o.italic, text: o.text });
  }

  // Writes the textarea back to the document as one undo step; an empty box is removed (or never created).
  function commit() {
    if (!ed) return;
    const e = ed, text = ta.value.replace(/\s+$/, "");
    ed = null; editingId = null; ta.hidden = true; bar.hidden = true;
    const pg = e.pg, cur = e.id && find(pg, e.id);
    if (!S.doc || !S.doc.pages.includes(pg)) return render();
    if (!text.trim()) {
      if (cur) History.record(pg, "delete text", () => { pg.objects = (pg.objects || []).filter((o) => o !== cur); });
      else return render();
    } else if (cur) {
      const next = { ...cur, text, size: e.size, color: e.color, bold: e.bold, italic: e.italic };
      if (Object.keys(next).some((k) => next[k] !== cur[k])) History.record(pg, "edit text", () => { pg.objects = pg.objects.map((o) => (o === cur ? next : o)); });
    } else {
      const o = { type: "text", id: uid().replace(/[^A-Za-z0-9_-]/g, ""), x: e.x, y: e.y, w: e.w, text, size: e.size, color: e.color, bold: e.bold, italic: e.italic };
      if (typeof Layers !== "undefined") Layers.stamp(pg, o); // the active layer id, or none for the base layer
      History.record(pg, "add text", () => { pg.objects = [...(pg.objects || []), o]; });
    }
    touch(); render();
  }

  // ---------- tool ----------
  function activate() {
    if (!S.doc) return;
    S.tool = "text";
    for (const id of ["pen", "eraser", "selectTool"]) { const b = $(id); if (b) b.classList.remove("on"); }
    btn.classList.add("on"); cv.style.cursor = "text";
    render();
  }

  // Capturing handlers on the canvas (registered before app.js's), so the pen never draws in text mode.
  cv.addEventListener("pointerdown", (ev) => {
    if (S.tool !== "text" || !S.doc || S.conflict) return;
    ev.stopImmediatePropagation();
    cand = null;
    if (V.down(ev)) return render();
    if (ed) commit();
    cand = pos(ev);
  }, true);
  cv.addEventListener("pointermove", (ev) => {
    if (S.tool !== "text") return;
    ev.stopImmediatePropagation();
    if (V.move(ev)) cand = null;
  }, true);
  const up = (ev) => {
    if (S.tool !== "text") return;
    ev.stopImmediatePropagation();
    if (V.up(ev)) { cand = null; return; }
    const p = cand; cand = null;
    if (!p || ev.type === "pointercancel" || !S.doc) return;
    const hit = textAt(p);
    if (hit) edit(hit); else create(p);
  };
  cv.addEventListener("pointerup", up, true);
  cv.addEventListener("pointercancel", up, true);

  cv.addEventListener("dblclick", (ev) => {
    if (S.tool !== "select" || !S.doc || S.conflict) return;
    const hit = textAt(pos(ev));
    if (hit) { ev.preventDefault(); edit(hit); }
  });

  document.addEventListener("DOMContentLoaded", () => {
    btn = document.getElementById("textTool");
    if (btn) btn.addEventListener("click", activate);
    // any other tool button leaves text mode
    const pal = document.getElementById("palette");
    if (pal) pal.addEventListener("click", (ev) => {
      const b = ev.target.closest("button");
      if (!b || b === btn || !btn) return;
      btn.classList.remove("on");
      setTimeout(() => { if (S.tool !== "text") cv.style.cursor = S.tool === "select" ? "default" : "crosshair"; }, 0);
    }, true);
  });

  // render() calls this every frame: keep the editor glued to the box while panning / zooming.
  api.sync = () => {
    if (ed && page() !== ed.pg) return commit();
    if (ed) style();
    else if (btn && S.tool !== "text") btn.classList.remove("on");
  };
  api.edit = edit; api.commit = commit; api.activate = activate;
  return api;
})();
if (typeof module !== "undefined" && module.exports) module.exports = Text;
