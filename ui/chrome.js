"use strict";
// Presentation glue loaded last. It does not change what the app does: it gives icons to buttons that other scripts create
// as plain text, lays the floating palette out, positions popovers, and owns the theme toggle.
const Chrome = (() => {
  const $ = (id) => document.getElementById(id);
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (_) { /* storage may be blocked */ } };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));

  // ---------- popover placement ----------
  // Popovers anchored to the left-edge palette open to its right, vertically centred on the button; anything else opens below
  // the anchor, flipping above when there is no room. Always kept inside the window.
  function placePopover(pop, anchor, gap = 10) {
    const r = anchor.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight, m = 10;
    let x, y;
    if (anchor.closest(".palette")) {
      x = r.right + gap; y = r.top + r.height / 2 - h / 2;
      if (x + w > innerWidth - m) x = r.left - w - gap;
    } else {
      x = r.left; y = r.bottom + gap - 2;
      if (y + h > innerHeight - m) y = r.top - h - gap + 2;
    }
    pop.style.left = clamp(x, m, Math.max(m, innerWidth - w - m)) + "px";
    pop.style.top = clamp(y, m, Math.max(m, innerHeight - h - m)) + "px";
  }

  // ---------- icons for buttons created by other scripts ----------
  const SEL_ICONS = { cut: "cut", copy: "copy", paste: "paste", dup: "dup", del: "trash", front: "front", back: "send-back", fliph: "fliph", flipv: "flipv" };
  function iconise(el, icon, title) {
    if (!el) return;
    if (title && (!el.title || el.dataset.chromeTitle)) { el.title = title; el.dataset.chromeTitle = "1"; }
    if (!el.dataset.icon) el.dataset.icon = icon;
    window.Icons?.apply(el);
  }
  function decorateDynamic() {
    iconise($("selectTool"), "select", "Select: lasso, click or Shift-click, then move, resize or edit");
    iconise($("insertBtn"), "insert", "Insert a graph, grid or axes");
    iconise($("pageMenu"), "chevron-down");
    iconise($("bgBtn"), "background", "Page background");
    const menu = $("selMenu");
    if (menu) {
      for (const b of menu.querySelectorAll("button[data-act]")) {
        const name = SEL_ICONS[b.dataset.act];
        if (name) iconise(b, name, b.dataset.label || b.textContent.trim() || b.title);
        if (!b.dataset.label) b.dataset.label = b.title;
      }
      const lab = menu.querySelector('label[data-act="color"]');
      if (lab && !lab.dataset.tidy) {
        for (const n of [...lab.childNodes]) if (n.nodeType === 3) n.remove();
        lab.dataset.tidy = "1"; lab.title = "Recolour the selected strokes and shapes";
      }
    }
  }

  // ---------- palette layout ----------
  function layoutPalette() {
    const palette = $("palette"), eraser = $("eraser"), widthBtn = $("widthBtn");
    const sel = $("selectTool"), ins = $("insertBtn");
    if (sel && eraser) eraser.after(sel);                                  // pen, eraser, select, shapes
    if (ins && widthBtn) {                                                 // colour, size, insert
      let rule = widthBtn.nextElementSibling;
      if (rule && rule.classList.contains("rule")) rule.before(ins); else widthBtn.after(ins);
    }
    const bg = $("bgBtn"), bar = $("bar"), undo = $("undo");
    if (bg && bar && undo && !bg.dataset.moved) {
      const grp = document.createElement("div");
      grp.className = "grp"; grp.append(bg);
      undo.closest(".grp").before(grp);
      bg.dataset.moved = "1";
    }
    return palette;
  }

  function wirePalette(palette) {
    const toggle = $("paletteToggle");
    const apply = (collapsed) => {
      palette.classList.toggle("collapsed", collapsed);
      toggle.dataset.icon = collapsed ? "panel-open" : "panel-left";
      toggle.title = collapsed ? "Show tools" : "Hide tools";
      toggle.setAttribute("aria-expanded", String(!collapsed));
      window.Icons?.apply(toggle);
    };
    apply(lsGet("paletteCollapsed") === "1");
    toggle.addEventListener("click", () => {
      const next = !palette.classList.contains("collapsed");
      apply(next); lsSet("paletteCollapsed", next ? "1" : "0");
    });
  }

  // ---------- pen size popover ----------
  function wireWidth() {
    const btn = $("widthBtn"), pop = $("widthPop"), range = $("width"), out = $("widthVal");
    const sync = () => {
      document.documentElement.style.setProperty("--w", range.value);
      btn.style.setProperty("--w", range.value); pop.style.setProperty("--w", range.value);
      out.textContent = range.value;
    };
    const close = () => { if (pop.hidden) return; pop.hidden = true; btn.setAttribute("aria-expanded", "false"); };
    const open = () => { pop.hidden = false; btn.setAttribute("aria-expanded", "true"); sync(); placePopover(pop, btn); };
    range.addEventListener("input", sync);
    btn.addEventListener("click", () => (pop.hidden ? open() : close()));
    document.addEventListener("pointerdown", (ev) => { if (!pop.hidden && !pop.contains(ev.target) && !btn.contains(ev.target)) close(); }, true);
    window.addEventListener("keydown", (ev) => { if (ev.key === "Escape") close(); });
    window.addEventListener("resize", () => { if (!pop.hidden) placePopover(pop, btn); });
    sync();
  }

  // ---------- theme ----------
  const html = document.documentElement;
  const systemDark = () => !!(window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches);
  const theme = () => html.dataset.theme || (systemDark() ? "dark" : "light");
  function paintThemeButtons() {
    const dark = theme() === "dark";
    for (const b of document.querySelectorAll(".theme-toggle")) {
      b.dataset.icon = dark ? "sun" : "moon";
      b.title = dark ? "Switch to light theme" : "Switch to dark theme";
      b.setAttribute("aria-label", b.title);
      window.Icons?.apply(b);
    }
  }
  function setTheme(t) { html.dataset.theme = t; lsSet("theme", t); paintThemeButtons(); }
  function addThemeButtons() {
    const mk = (cls) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "theme-toggle " + cls; b.addEventListener("click", () => setTheme(theme() === "dark" ? "light" : "dark"));
      return b;
    };
    const bar = $("bar"), acts = document.querySelector(".lib-actions");
    if (bar) { const g = document.createElement("div"); g.className = "grp"; g.append(mk("")); bar.append(g); }
    if (acts) acts.append(mk("lib-btn icon-only"));
    paintThemeButtons();
    if (window.matchMedia) matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", paintThemeButtons);
  }

  // ---------- accessibility ----------
  // aria-pressed mirrors the "on" class that app.js and selection.js toggle, so those scripts need no changes.
  const TOGGLES = ["pen", "eraser", "selectTool", "smart", "snapGrid", "textTool"];
  function syncPressed(b) { b.setAttribute("aria-pressed", String(b.classList.contains("on"))); }
  function wirePressed() {
    const seen = new WeakSet();
    const attach = () => {
      for (const id of TOGGLES) {
        const b = $(id);
        if (!b || seen.has(b)) continue;
        seen.add(b); syncPressed(b);
        new MutationObserver(() => syncPressed(b)).observe(b, { attributes: true, attributeFilter: ["class"] });
      }
    };
    attach();
    new MutationObserver(attach).observe($("editor"), { childList: true, subtree: true });
  }
  // Escape closes popovers in their own scripts; afterwards focus goes back to the button that opened them.
  const POP_TRIGGERS = ["widthBtn", "colorBtn", "bgBtn", "insertBtn", "pageMenu"];
  function wireEscapeFocus() {
    window.addEventListener("keydown", (ev) => {
      if (ev.key !== "Escape") return;
      const open = POP_TRIGGERS.map($).find((b) => b && b.getAttribute("aria-expanded") === "true");
      if (open) setTimeout(() => { if (open.getAttribute("aria-expanded") !== "true") open.focus(); }, 0);
    }, true);
  }

  function init() {
    wirePressed();
    wireEscapeFocus();
    const palette = layoutPalette();
    decorateDynamic();
    wirePalette(palette);
    wireWidth();
    addThemeButtons();
    // The selection menu and a few buttons are created lazily by their own scripts.
    new MutationObserver(() => decorateDynamic()).observe($("editor"), { childList: true, subtree: true });
    window.Icons?.apply(document);
  }

  const api = { placePopover, setTheme, theme, decorateDynamic };
  window.Chrome = api;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
  return api;
})();
