"use strict";
// Layers panel: a floating list (top layer first, "Background layer" last) opened from the palette's layers button.
// All layer-list edits go through History.record so they undo with everything else. Pure logic lives in layers.js.
(() => {
  const A = window.__app, { S } = A, $ = (id) => document.getElementById(id);
  const btn = $("layersBtn");
  if (!btn) return;
  const pop = document.createElement("div");
  pop.id = "layerPanel"; pop.className = "pop"; pop.hidden = true;
  pop.setAttribute("role", "dialog"); pop.setAttribute("aria-label", "Layers");
  document.body.append(pop);
  let sig = "", renaming = null;

  const pg = () => (S.doc ? A.page() : null);
  const mk = (tag, cls, props = {}) => Object.assign(document.createElement(tag), { className: cls || "", ...props });
  function iconBtn(icon, title, fn, on) {
    const b = mk("button", "lp-btn" + (on ? " on" : ""), { type: "button", title });
    b.dataset.icon = icon; b.setAttribute("aria-label", title);
    b.onclick = (ev) => { ev.stopPropagation(); fn(); };
    return b;
  }
  const textBtn = (label, title, fn, disabled) => {
    const b = mk("button", "lp-txt", { type: "button", title, textContent: label, disabled: !!disabled });
    b.onclick = fn; return b;
  };
  function edit(label, fn) {
    const p = pg(); if (!p) return;
    History.record(p, label, () => fn(p));
    A.touch(); A.render(); refresh(true);
  }

  function row(p, l) {
    const id = l ? l.id : null, act = Layers.active(p) === id;
    const r = mk("div", "lp-row" + (act ? " active" : "") + (id && !Layers.isVisible(p, id) ? " dim" : ""));
    r.dataset.layer = id || "";
    r.onclick = () => { Layers.setActive(p, id); refresh(true); };
    const vis = Layers.isVisible(p, id), lock = Layers.isLocked(p, id);
    const toggleVis = () => { if (l) edit(vis ? "hide layer" : "show layer", () => Layers.setVisible(p, id, !vis)); else { Layers.setVisible(p, null, !vis); A.render(); refresh(true); } };
    const toggleLock = () => { if (l) edit(lock ? "unlock layer" : "lock layer", () => Layers.setLocked(p, id, !lock)); else { Layers.setLocked(p, null, !lock); refresh(true); } };
    r.append(iconBtn(vis ? "eye" : "eye-off", vis ? "Hide layer" : "Show layer", toggleVis, !vis));
    if (l && renaming === id) {
      const inp = mk("input", "lp-name", { type: "text", value: l.name });
      const done = (ok) => { renaming = null; if (ok && inp.value.trim() && inp.value.trim() !== l.name) edit("rename layer", () => Layers.rename(p, id, inp.value)); else refresh(true); };
      inp.onclick = (e) => e.stopPropagation();
      inp.onkeydown = (e) => { if (e.key === "Enter") done(true); else if (e.key === "Escape") done(false); e.stopPropagation(); };
      inp.onblur = () => done(true);
      r.append(inp); setTimeout(() => { inp.focus(); inp.select(); });
    } else {
      const name = mk("span", "lp-label", { textContent: l ? l.name : "Background layer", title: l ? "Double-click to rename" : "The page itself: cannot be renamed or deleted" });
      if (l) name.ondblclick = (e) => { e.stopPropagation(); renaming = id; refresh(true); };
      r.append(name);
    }
    r.append(iconBtn(lock ? "lock" : "unlock", lock ? "Unlock layer" : "Lock layer", toggleLock, lock));
    if (l) {
      const i = p.layers.indexOf(l);
      const up = iconBtn("chevron-up", "Move layer up", () => edit("reorder layer", () => Layers.move(p, id, 1)));
      const down = iconBtn("chevron-down", "Move layer down", () => edit("reorder layer", () => Layers.move(p, id, -1)));
      up.disabled = i === p.layers.length - 1; down.disabled = i === 0;
      r.append(up, down, iconBtn("trash", "Delete layer (its ink moves to the layer below)", () => edit("delete layer", () => Layers.deleteLayer(p, id))));
    }
    return r;
  }

  function refresh(force) {
    const p = pg();
    const s = p ? p.id + JSON.stringify(p.layers || []) + Layers.active(p) + Layers.isVisible(p, null) + Layers.isLocked(p, null) + renaming : "";
    if (!force && s === sig) return;
    sig = s; pop.textContent = "";
    if (!p) return;
    const head = mk("div", "lp-head"); head.append(mk("strong", "", { textContent: "Layers" }));
    pop.append(head);
    const list = mk("div", "lp-list");
    for (const l of [...(p.layers || [])].reverse()) list.append(row(p, l));
    list.append(row(p, null));
    pop.append(list);
    const act = Layers.active(p), foot = mk("div", "lp-foot");
    foot.append(
      textBtn("Add layer", "Add a layer above the active one", () => {
        let made; edit("add layer", (q) => { made = Layers.addLayer(q); }); Layers.setActive(p, made.id); refresh(true);
      }),
      textBtn("Merge down", "Merge the active layer into the one below", () => edit("merge layer", () => Layers.mergeDown(p, act)), !act));
    pop.append(foot);
    pop.append(mk("p", "lp-note", { textContent: "Draw on the highlighted layer. The background layer's hide/lock is not saved." }));
    if (window.Icons) Icons.apply(pop);
  }

  function place() {
    const r = btn.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(r.right + 10, innerWidth - pop.offsetWidth - 8)) + "px";
    pop.style.top = Math.max(8, Math.min(r.top, innerHeight - pop.offsetHeight - 8)) + "px";
  }
  function open(v) {
    pop.hidden = !v; btn.classList.toggle("on", v); btn.setAttribute("aria-expanded", String(v));
    if (v) { refresh(true); place(); }
  }
  btn.onclick = () => open(pop.hidden);
  document.addEventListener("pointerdown", (ev) => { if (!pop.hidden && !pop.contains(ev.target) && !btn.contains(ev.target)) open(false); });
  window.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && !pop.hidden && renaming === null) open(false); });
  // Undo/redo, page changes and "To active layer" can change layers behind our back; a cheap signature check keeps the list honest.
  setInterval(() => { if (!pop.hidden) refresh(false); }, 250);
  A.hooks.layersChanged = () => { if (!pop.hidden) refresh(true); };
})();
