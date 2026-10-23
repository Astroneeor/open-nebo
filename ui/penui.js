"use strict";
// Pen-type and eraser-variant choosers. The pen/eraser palette buttons show the current variant's icon; clicking
// the button while its tool is already active opens a small popover to pick another. Loaded after app.js.
(function () {
  const A = window.__app; if (!A) return;
  const S = A.S, $ = (id) => document.getElementById(id);
  const get = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
  const set = (k, v) => { try { localStorage.setItem(k, v); } catch (_) { /* unavailable */ } };

  S.penKind = Pens.KINDS.includes(get("penKind")) ? get("penKind") : "pen";
  S.eraserMode = Pens.ERASER_MODES.includes(get("eraserMode")) ? get("eraserMode") : "stroke";

  const pop = document.createElement("div");
  pop.id = "penPop"; pop.className = "pop"; pop.hidden = true; pop.setAttribute("role", "menu");
  pop.style.cssText += ";display:flex;flex-direction:row;gap:4px;padding:6px";
  document.body.appendChild(pop);

  function paintButtons() {
    const pb = $("pen"), eb = $("eraser"), ps = Pens.STYLES[S.penKind], es = Pens.ERASERS[S.eraserMode];
    pb.dataset.icon = ps.icon; pb.title = ps.label + " (click again to change type)";
    eb.dataset.icon = es.icon; eb.title = es.label + " (click again to change type)";
    for (const b of [pb, eb]) { b.setAttribute("aria-label", b.title); b.textContent = ""; window.Icons?.apply(b); }
  }

  function setWidth(kind) {
    const saved = +get("penWidth." + kind), w = saved > 0 ? saved : Pens.STYLES[kind].width;
    const r = $("width"); r.value = w; r.dispatchEvent(new Event("input"));
  }
  function pickPen(kind) {
    if (S.penKind !== kind) { try { set("penWidth." + S.penKind, $("width").value); } catch (_) { /* ignore */ } }
    S.penKind = kind; set("penKind", kind); setWidth(kind); paintButtons();
  }
  function pickEraser(mode) { S.eraserMode = mode; set("eraserMode", mode); paintButtons(); }

  let anchor = null;
  function close() { pop.hidden = true; anchor = null; }
  function open(btn, items, current, pick) {
    pop.textContent = "";
    for (const [key, def] of items) {
      const b = document.createElement("button");
      b.type = "button"; b.dataset.icon = def.icon; b.title = def.label; b.setAttribute("role", "menuitemradio");
      b.setAttribute("aria-checked", String(key === current));
      b.style.cssText = "width:40px;height:40px;min-width:40px;padding:0;border-radius:13px";
      if (key === current) b.classList.add("on");
      b.addEventListener("click", () => { pick(key); close(); });
      pop.appendChild(b);
    }
    window.Icons?.apply(pop);
    pop.hidden = false; anchor = btn;
    const r = btn.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
    pop.style.left = Math.max(10, Math.min(r.right + 10, innerWidth - w - 10)) + "px";
    pop.style.top = Math.max(10, Math.min(r.top + r.height / 2 - h / 2, innerHeight - h - 10)) + "px";
  }

  // capture phase: runs before app.js's own click handlers, which then switch the tool as usual
  function wire(id, tool, items, current, pick) {
    $(id).addEventListener("click", () => {
      if (S.tool === tool && pop.hidden) open($(id), items, current(), pick);
      else if (!pop.hidden && anchor === $(id)) close();
      else close();
    }, true);
  }
  wire("pen", "pen", Object.entries(Pens.STYLES), () => S.penKind, pickPen);
  wire("eraser", "eraser", Object.entries(Pens.ERASERS), () => S.eraserMode, pickEraser);
  document.addEventListener("pointerdown", (ev) => { if (!pop.hidden && !pop.contains(ev.target) && ev.target !== anchor && !anchor?.contains(ev.target)) close(); }, true);
  window.addEventListener("keydown", (ev) => { if (ev.key === "Escape") close(); });

  paintButtons();
  if (S.penKind !== "pen" || get("penWidth." + S.penKind)) setWidth(S.penKind);
})();
