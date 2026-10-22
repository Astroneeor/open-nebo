"use strict";
// Graph objects: coordinate grids, graph paper and blank axes, plus the Insert
// menu and the Select tool used to move/resize/edit them. Loaded before app.js;
// it reaches app.js globals (S, cv, pos, render, touch, uid, status, $) only at
// call time. Objects live in page().objects as {type:"graph", ...}.
const Graphs = (() => {
  const GRID = "#b9c2d0", AXIS = "#1b1b1f", TXT = "#3a3a42", ACC = "#2e7dff";
  const stage = $("stage");
  let sel = null, drag = null, panel = null, menu = null, selBtn = null, insBtn = null;

  const graphs = () => (S.doc ? (page().objects || []).filter((o) => o.type === "graph") : []);
  const current = () => graphs().find((o) => o.id === sel) || null;
  const dims = (g) => ({ w: g.size, h: g.size * (g.ymax - g.ymin) / (g.xmax - g.xmin) });
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const fmt = (v) => parseFloat(v.toFixed(6)).toString().replace("-", "−");
  const scale = () => V.zoom; // screen px per world unit

  // ---------- drawing ----------
  function drawCore(ctx, g, x, y, w, h) {
    const xr = g.xmax - g.xmin, yr = g.ymax - g.ymin, step = g.step > 0 ? g.step : 1, eps = 1e-6;
    const X = (v) => x + (v - g.xmin) / xr * w, Y = (v) => y + h - (v - g.ymin) / yr * h;
    const i0 = Math.ceil(g.xmin / step - eps), i1 = Math.floor(g.xmax / step + eps);
    const j0 = Math.ceil(g.ymin / step - eps), j1 = Math.floor(g.ymax / step + eps);
    ctx.save();
    ctx.lineCap = "butt";
    if (g.grid && i1 - i0 < 500 && j1 - j0 < 500) {
      ctx.strokeStyle = GRID; ctx.lineWidth = 1; ctx.beginPath();
      for (let i = i0; i <= i1; i++) { const px = X(i * step); ctx.moveTo(px, y); ctx.lineTo(px, y + h); }
      for (let j = j0; j <= j1; j++) { const py = Y(j * step); ctx.moveTo(x, py); ctx.lineTo(x + w, py); }
      ctx.stroke();
      ctx.strokeRect(x, y, w, h);
    }
    const hasX = g.ymin <= 0 && g.ymax >= 0, hasY = g.xmin <= 0 && g.xmax >= 0;
    if (g.axes) {
      ctx.strokeStyle = AXIS; ctx.fillStyle = AXIS; ctx.lineWidth = 2;
      ctx.beginPath();
      if (hasX) { ctx.moveTo(x, Y(0)); ctx.lineTo(x + w, Y(0)); }
      if (hasY) { ctx.moveTo(X(0), y); ctx.lineTo(X(0), y + h); }
      ctx.stroke();
      ctx.beginPath();
      if (hasX) { const ay = Y(0); ctx.moveTo(x + w + 6, ay); ctx.lineTo(x + w - 4, ay - 4); ctx.lineTo(x + w - 4, ay + 4); }
      if (hasY) { const ax = X(0); ctx.moveTo(ax, y - 6); ctx.lineTo(ax - 4, y + 4); ctx.lineTo(ax + 4, y + 4); }
      ctx.fill();
    }
    if (g.labels) {
      const cell = Math.min(w * step / xr, h * step / yr);
      const f = clamp(cell * 0.4, 9, 14);
      const lx = Math.max(1, Math.ceil(30 / (w * step / xr))), ly = Math.max(1, Math.ceil(f * 1.6 / (h * step / yr)));
      const ax = clamp(X(0), x, x + w), ay = clamp(Y(0), y, y + h);
      ctx.font = `${f}px system-ui, sans-serif`; ctx.fillStyle = TXT;
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 3; ctx.lineJoin = "round";
      const put = (t, px, py) => { ctx.strokeText(t, px, py); ctx.fillText(t, px, py); };
      ctx.textAlign = "center"; ctx.textBaseline = "top";
      for (let i = i0; i <= i1; i++) if (i !== 0 && i % lx === 0) put(fmt(i * step), X(i * step), ay + 3);
      ctx.textAlign = "right"; ctx.textBaseline = "middle";
      for (let j = j0; j <= j1; j++) if (j !== 0 && j % ly === 0) put(fmt(j * step), ax - 5, Y(j * step));
      if (hasX && hasY) { ctx.textBaseline = "top"; put("0", ax - 4, ay + 3); }
    }
    ctx.restore();
  }

  function drawGraph(ctx, g) {
    const { w, h } = dims(g);
    drawCore(ctx, g, g.x, g.y, w, h);
  }

  function draw(ctx, pg) {
    for (const o of pg.objects || []) if (o.type === "graph") drawGraph(ctx, o);
  }

  function handles(g) {
    const { w, h } = dims(g);
    return [[g.x, g.y], [g.x + w, g.y], [g.x, g.y + h], [g.x + w, g.y + h]];
  }

  function drawOverlay(ctx) {
    const g = current();
    if (!g) { if (sel) { sel = null; syncPanel(); } return; }
    const { w, h } = dims(g), hs = 6 / scale();
    ctx.save();
    ctx.strokeStyle = ACC; ctx.lineWidth = 1.5 / scale(); ctx.setLineDash([6 / scale(), 4 / scale()]);
    ctx.strokeRect(g.x, g.y, w, h);
    ctx.setLineDash([]); ctx.fillStyle = "#fff";
    for (const [hx, hy] of handles(g)) { ctx.fillRect(hx - hs, hy - hs, hs * 2, hs * 2); ctx.strokeRect(hx - hs, hy - hs, hs * 2, hs * 2); }
    ctx.restore();
  }

  // ---------- select tool ----------
  function setSelectTool(on) {
    if (on) {
      S.tool = "select";
      $("pen").classList.remove("on"); $("eraser").classList.remove("on");
      cv.style.cursor = "default";
    } else {
      sel = null; drag = null; cv.style.cursor = ""; syncPanel();
      if (S.doc) render();
    }
    selBtn.classList.toggle("on", on);
  }

  function hitCorner(g, p) {
    const r = 12 / scale();
    return handles(g).findIndex(([hx, hy]) => Math.abs(p.x - hx) <= r && Math.abs(p.y - hy) <= r);
  }

  stage.addEventListener("pointerdown", (ev) => {
    if (S.tool !== "select" || ev.target !== cv || !S.doc || S.conflict) return;
    const p = pos(ev), cur = current();
    const corner = cur ? hitCorner(cur, p) : -1;
    const over = graphs().slice().reverse().find((o) => {
      const { w, h } = dims(o);
      return p.x >= o.x && p.x <= o.x + w && p.y >= o.y && p.y <= o.y + h;
    });
    // Not on a graph: leave the event to the image / pan handlers.
    if (corner < 0 && !over) { if (sel) { sel = null; syncPanel(); render(); } return; }
    ev.stopPropagation();
    if (V.down(ev)) { drag = null; render(); return; } // pan / pinch gesture
    cv.setPointerCapture(ev.pointerId);
    if (cur && corner >= 0) {
      const { w, h } = dims(cur), opp = handles(cur)[3 - corner];
      drag = { mode: "resize", corner, ax: opp[0], ay: opp[1], ratio: h / w, g: cur };
    } else {
      const hit = graphs().reverse().find((o) => {
        const { w, h } = dims(o);
        return p.x >= o.x && p.x <= o.x + w && p.y >= o.y && p.y <= o.y + h;
      });
      sel = hit ? hit.id : null;
      drag = hit ? { mode: "move", dx: p.x - hit.x, dy: p.y - hit.y, g: hit, moved: false } : null;
      syncPanel();
    }
    render();
  }, true);

  stage.addEventListener("pointermove", (ev) => {
    if (S.tool !== "select" || ev.target !== cv || !drag) return;
    ev.stopPropagation();
    const p = pos(ev), g = drag.g;
    if (drag.mode === "move") {
      g.x = p.x - drag.dx; g.y = p.y - drag.dy; drag.moved = true;
    } else {
      const w = Math.max(60, Math.abs(p.x - drag.ax)), h = w * drag.ratio;
      g.size = w;
      g.x = drag.corner % 2 === 0 ? drag.ax - w : drag.ax;
      g.y = drag.corner < 2 ? drag.ay - h : drag.ay;
      drag.moved = true;
    }
    refreshPanel(); render();
  }, true);

  const up = (ev) => {
    if (S.tool !== "select" || ev.target !== cv || !drag) return;
    ev.stopPropagation();
    V.up(ev);
    if (drag.moved) touch();
    drag = null;
  };
  stage.addEventListener("pointerup", up, true);
  stage.addEventListener("pointercancel", up, true);

  function remove() {
    const g = current();
    if (!g) return;
    page().objects = page().objects.filter((o) => o !== g);
    sel = null; syncPanel(); touch(); render();
  }

  window.addEventListener("keydown", (ev) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((ev.target || {}).tagName || "");
    if (ev.key === "Escape") { closeMenu(); if (sel) { sel = null; syncPanel(); render(); } return; }
    if (!typing && sel && (ev.key === "Delete" || ev.key === "Backspace")) { ev.preventDefault(); remove(); }
  });

  // ---------- parameters panel ----------
  const el = (tag, props = {}, kids = []) => {
    const e = Object.assign(document.createElement(tag), props);
    e.append(...kids);
    return e;
  };

  const FIELDS = [["xmin", "x min"], ["xmax", "x max"], ["ymin", "y min"], ["ymax", "y max"], ["step", "step"], ["size", "width"]];
  const FLAGS = [["grid", "Grid"], ["axes", "Axes"], ["labels", "Numbers"]];

  function valid(g) {
    const step = g.step;
    return g.xmax > g.xmin && g.ymax > g.ymin && step > 0 && g.size >= 40 &&
      (g.xmax - g.xmin) / step <= 400 && (g.ymax - g.ymin) / step <= 400;
  }

  function buildPanel() {
    panel = el("div", { id: "graphPanel", hidden: true });
    panel.append(el("strong", { textContent: "Graph" }));
    for (const [key, label] of FIELDS) {
      const inp = el("input", { type: "number", step: "any" });
      inp.dataset.key = key;
      inp.oninput = () => {
        const g = current(), v = parseFloat(inp.value);
        if (!g || !isFinite(v)) return;
        const old = g[key];
        g[key] = v;
        if (!valid(g)) { g[key] = old; inp.classList.add("bad"); return; }
        inp.classList.remove("bad"); touch(); render();
      };
      panel.append(el("label", {}, [label, inp]));
    }
    for (const [key, label] of FLAGS) {
      const cb = el("input", { type: "checkbox" });
      cb.dataset.key = key;
      cb.onchange = () => { const g = current(); if (g) { g[key] = cb.checked; touch(); render(); } };
      panel.append(el("label", { className: "flag" }, [cb, label]));
    }
    panel.append(
      el("button", { textContent: "Duplicate", onclick: duplicate }),
      el("button", { textContent: "Delete", className: "danger", onclick: remove }),
    );
    $("stage").append(panel);
  }

  function refreshPanel() {
    const g = current();
    if (!g || !panel) return;
    for (const inp of panel.querySelectorAll("input")) {
      if (inp === document.activeElement) continue;
      const v = g[inp.dataset.key];
      if (inp.type === "checkbox") inp.checked = !!v; else inp.value = parseFloat(Number(v).toFixed(4));
      inp.classList.remove("bad");
    }
  }

  function syncPanel() {
    if (!panel) return;
    panel.hidden = !current();
    refreshPanel();
  }

  function duplicate() {
    const g = current();
    if (!g) return;
    const c = { ...g, id: uid(), x: g.x + 24, y: g.y + 24 };
    page().objects.push(c); sel = c.id; syncPanel(); touch(); render();
  }

  // ---------- insert ----------
  function viewCentre() {
    return { x: V.x + cv.clientWidth / 2 / V.zoom, y: V.y + cv.clientHeight / 2 / V.zoom };
  }

  const PRESETS = {
    grid10: { name: "Coordinate grid", sub: "10 × 10, −5 to 5", lo: -5, hi: 5, size: 440 },
    grid20: { name: "Coordinate grid", sub: "20 × 20, −10 to 10", lo: -10, hi: 10, size: 560 },
    axes: { name: "Blank axes", sub: "−5 to 5, no grid", lo: -5, hi: 5, size: 440, grid: false },
  };

  function insert(spec) {
    if (!S.doc || S.conflict) { status("Open a notebook first"); return; }
    const g = { type: "graph", id: uid(), step: 1, labels: true, axes: true, grid: true, ...spec };
    const { w, h } = dims({ ...g, x: 0, y: 0 });
    const c = viewCentre();
    g.x = c.x - w / 2; g.y = c.y - h / 2;
    (page().objects || (page().objects = [])).push(g);
    sel = g.id; setSelectTool(true); syncPanel(); touch(); render();
  }

  function insertPreset(key) {
    const p = PRESETS[key];
    insert({ xmin: p.lo, xmax: p.hi, ymin: p.lo, ymax: p.hi, size: p.size, grid: p.grid !== false });
  }

  function insertPaper(rows, cols) {
    rows = clamp(Math.round(rows) || 5, 1, 60); cols = clamp(Math.round(cols) || 5, 1, 60);
    insert({ xmin: 0, xmax: cols, ymin: 0, ymax: rows, size: Math.min(cols * 40, 900), axes: false, labels: false });
  }

  function thumb(spec) {
    const c = el("canvas", { width: 56, height: 56 });
    const x = c.getContext("2d"), g = { step: 1, labels: false, axes: true, grid: true, ...spec };
    const s = 52 / Math.max(g.xmax - g.xmin, g.ymax - g.ymin);
    drawCore(x, g, 2, 2, (g.xmax - g.xmin) * s, (g.ymax - g.ymin) * s);
    return c;
  }

  function closeMenu() { if (menu) { menu.hidden = true; insBtn.classList.remove("on"); } }

  function buildMenu() {
    menu = el("div", { id: "insertMenu", hidden: true });
    const item = (key) => {
      const p = PRESETS[key];
      const b = el("button", { className: "item", onclick: () => { closeMenu(); insertPreset(key); } },
        [thumb({ xmin: p.lo, xmax: p.hi, ymin: p.lo, ymax: p.hi, grid: p.grid !== false }),
         el("span", {}, [el("b", { textContent: p.name }), el("small", { textContent: p.sub })])]);
      return b;
    };
    const rows = el("input", { type: "number", min: 1, max: 60, value: 5 });
    const cols = el("input", { type: "number", min: 1, max: 60, value: 5 });
    const paper = el("div", { className: "item paper" }, [
      thumb({ xmin: 0, xmax: 5, ymin: 0, ymax: 5, axes: false }),
      el("span", {}, [el("b", { textContent: "Graph paper" }),
        el("small", {}, [rows, " rows × ", cols, " cols"])]),
      el("button", { textContent: "Insert", onclick: () => { closeMenu(); insertPaper(+rows.value, +cols.value); } }),
    ]);
    menu.append(el("div", { className: "head", textContent: "Insert" }), item("grid10"), item("grid20"), item("axes"), paper);
    document.body.append(menu);
  }

  function toggleMenu() {
    if (!menu.hidden) { closeMenu(); return; }
    const r = insBtn.getBoundingClientRect();
    menu.style.left = Math.max(8, r.left) + "px"; menu.style.top = r.bottom + 6 + "px";
    menu.hidden = false; insBtn.classList.add("on");
  }

  document.addEventListener("pointerdown", (ev) => {
    if (menu && !menu.hidden && !menu.contains(ev.target) && ev.target !== insBtn) closeMenu();
  });

  // ---------- setup ----------
  function init() {
    selBtn = $("selectTool") || el("button", { id: "selectTool", textContent: "Select" });
    selBtn.addEventListener("click", () => setSelectTool(true));
    insBtn = el("button", { id: "insertBtn", textContent: "Insert ▾", title: "Insert a graph", onclick: toggleMenu });
    if (!selBtn.isConnected) $("eraser").after(selBtn);
    $("eraser").after(insBtn);
    for (const id of ["pen", "eraser"]) $(id).addEventListener("click", () => setSelectTool(false));
    buildMenu(); buildPanel();
  }
  init();

  return { draw, drawOverlay, insertPreset, insertPaper };
})();
