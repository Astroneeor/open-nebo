"use strict";
// Browser wiring for input.js: capturing pointer listeners on the canvas (registered before selection.js and app.js) that
// reject palms, route touch to the view code, map stylus buttons to temporary tools, plus the Settings popover.
const InputUI = (() => {
  const $ = (id) => document.getElementById(id);
  const KEY = "input.settings";
  const LABELS = {
    touch: ["Touch", { auto: "Automatic (pans once a pen is seen)", draw: "Draws", pan: "Pans only", pen: "Pen only (ignore touch)" }],
    eraserEnd: ["Stylus eraser end", { erase: "Erase", select: "Select / lasso", pan: "Pan", none: "Nothing" }],
    barrel: ["Stylus barrel button", { erase: "Erase while held", select: "Select / lasso while held", pan: "Pan", none: "Nothing" }],
  };
  let settings = Input.DEFAULTS, last = null, pred = [], restore = null;
  try { settings = Input.sanitize(JSON.parse(localStorage.getItem(KEY))); } catch (_) { settings = Input.sanitize(null); }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch (_) { /* storage may be blocked */ } };

  const tracker = Input.newTracker();
  const routed = new Map(); // pointerId -> "touch" | "pan": pointers this module owns until they lift
  const toolBtn = { pen: "pen", erase: "eraser", select: "selectTool" };
  const curTool = () => (S.tool === "eraser" ? "erase" : S.tool === "select" ? "select" : "pen");
  const setTool = (t) => { const b = $(toolBtn[t]); if (b) b.click(); };

  function diag(ev) {
    last = ev && { pointerType: ev.pointerType, pressure: ev.pressure, buttons: ev.buttons };
    const el = $("inputDiag"); if (el && !$("inputPop").hidden) el.textContent = Input.describe(last);
  }
  const stop = (ev) => { ev.stopImmediatePropagation(); ev.preventDefault(); };

  function down(ev) {
    const now = performance.now();
    Input.observe(tracker, ev, "down", now); diag(ev);
    if (!S.doc || S.conflict) return;
    const d = Input.classify(ev, settings, tracker, now);
    if (d.action === "ignore") { routed.set(ev.pointerId, "ignore"); stop(ev); return; }
    if (d.action === "view") {
      routed.set(ev.pointerId, "touch"); stop(ev);
      S.current = null; S.erasing = false;
      V.down(ev);
      if (V.touchCount() === 1) V.startPan(ev); else V.stopPan(); // one finger pans, a second turns it into pinch-zoom
      return;
    }
    if (d.action === "pan") { routed.set(ev.pointerId, "pan"); stop(ev); V.startPan(ev); return; }
    if (d.action === "tool") {
      if (!restore) restore = curTool();
      setTool(d.tool); // before selection.js / app.js see this same event
    }
  }
  function move(ev) {
    Input.observe(tracker, ev, "move", performance.now()); diag(ev);
    const r = routed.get(ev.pointerId);
    if (r === "ignore") { stop(ev); return; }
    if (r) { stop(ev); V.move(ev); return; }
    pred = [];
    if (S.current && ev.pointerType === "pen" && ev.getPredictedEvents) {
      try { pred = ev.getPredictedEvents().map((e) => V.toWorld(e)); } catch (_) { pred = []; }
    }
  }
  function up(ev) {
    Input.observe(tracker, ev, "up", performance.now());
    pred = [];
    const r = routed.get(ev.pointerId);
    if (r) {
      routed.delete(ev.pointerId); stop(ev);
      if (r !== "ignore") { V.up(ev); if (r === "pan" || V.touchCount() === 0) V.stopPan(); }
    }
    if (restore && ev.pointerType === "pen") {
      const t = restore; restore = null;
      setTimeout(() => setTool(t), 0); // after selection.js / app.js finish handling this pointerup
    }
  }

  /** Faint extension of the live stroke to where the pen is predicted to go. Display only: never added to the stroke. */
  function drawPredicted(c, stroke) {
    if (!pred.length || !stroke.points.length) return;
    const p0 = stroke.points[stroke.points.length - 1];
    c.save(); c.globalAlpha = 0.45; c.strokeStyle = stroke.color; c.lineWidth = stroke.width; c.lineCap = "round"; c.lineJoin = "round";
    c.beginPath(); c.moveTo(p0.x, p0.y); for (const q of pred) c.lineTo(q.x, q.y); c.stroke(); c.restore();
  }

  // ---------- settings popover ----------
  function buildPop() {
    const pop = document.createElement("div");
    pop.id = "inputPop"; pop.className = "pop"; pop.hidden = true; pop.setAttribute("role", "dialog"); pop.setAttribute("aria-label", "Input settings");
    for (const [key, [label, opts]] of Object.entries(LABELS)) {
      const l = document.createElement("label"); l.textContent = label;
      const sel = document.createElement("select"); sel.id = "in_" + key;
      for (const [v, text] of Object.entries(opts)) { const o = document.createElement("option"); o.value = v; o.textContent = text; sel.appendChild(o); }
      sel.value = settings[key];
      sel.addEventListener("change", () => { settings = Input.sanitize({ ...settings, [key]: sel.value }); save(); });
      l.appendChild(sel); pop.appendChild(l);
    }
    const p = document.createElement("p"); p.id = "inputDiag"; p.className = "diag"; p.textContent = Input.describe(last);
    pop.appendChild(p);
    document.body.appendChild(pop);
    return pop;
  }
  function init() {
    const cv = $("cv"), btn = $("inputBtn");
    if (!cv) return;
    for (const [t, f] of [["pointerdown", down], ["pointermove", move], ["pointerup", up], ["pointercancel", up]]) cv.addEventListener(t, f, true);
    if (!btn) return;
    const pop = buildPop();
    const close = () => { pop.hidden = true; btn.setAttribute("aria-expanded", "false"); };
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!pop.hidden) return close();
      pop.hidden = false; btn.setAttribute("aria-expanded", "true");
      $("inputDiag").textContent = Input.describe(last);
      if (window.Chrome && Chrome.placePopover) Chrome.placePopover(pop, btn);
    });
    document.addEventListener("pointerdown", (e) => { if (!pop.hidden && !pop.contains(e.target) && e.target !== btn && !btn.contains(e.target)) close(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  }
  if (typeof document !== "undefined" && document.getElementById) init();
  return { drawPredicted, settings: () => settings };
})();
