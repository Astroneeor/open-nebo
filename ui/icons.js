"use strict";
// Icons are Lucide (https://lucide.dev, ISC licence, see vendor/LUCIDE-LICENSE), inlined so the app needs no network or font.
// Give any element data-icon="name" and Icons.apply() puts the SVG in it: icon-only by default (the old text becomes the
// aria-label), or icon + text for menu items and labelled buttons. A MutationObserver covers elements created later.
const Icons = (() => {
  const PATHS = {
    "pen": "<path d=\"M12 20h9\" /><path d=\"M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z\" />",
    "layers": '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" /><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65" /><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65" />',
    "eye": '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" /><circle cx="12" cy="12" r="3" />',
    "eye-off": '<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" /><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" /><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" /><path d="m2 2 20 20" />',
    "lock": '<rect width="18" height="11" x="3" y="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />',
    "unlock": '<rect width="18" height="11" x="3" y="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 9.9-1" />',
    "eraser": "<path d=\"m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21\" /><path d=\"M22 21H7\" /><path d=\"m5 11 9 9\" />",
    "select": "<path d=\"M7 22a5 5 0 0 1-2-4\" /><path d=\"M7 16.93c.96.43 1.96.74 2.99.91\" /><path d=\"M3.34 14A6.8 6.8 0 0 1 2 10c0-4.42 4.48-8 10-8s10 3.58 10 8a7.19 7.19 0 0 1-.33 2\" /><path d=\"M5 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4z\" /><path d=\"M14.33 22h-.09a.35.35 0 0 1-.24-.32v-10a.34.34 0 0 1 .33-.34c.08 0 .15.03.21.08l7.34 6a.33.33 0 0 1-.21.59h-4.49l-2.57 3.85a.35.35 0 0 1-.28.14z\" />",
    "magnet": "<path d=\"m6 15-4-4 6.75-6.77a7.79 7.79 0 0 1 11 11L13 22l-4-4 6.39-6.36a2.14 2.14 0 0 0-3-3L6 15\" /><path d=\"m5 8 4 4\" /><path d=\"m12 15 4 4\" />",
    "shapes": "<path d=\"M8.3 10a.7.7 0 0 1-.626-1.079L11.4 3a.7.7 0 0 1 1.198-.043L16.3 8.9a.7.7 0 0 1-.572 1.1Z\" /><rect x=\"3\" y=\"14\" width=\"7\" height=\"7\" rx=\"1\" /><circle cx=\"17.5\" cy=\"17.5\" r=\"3.5\" />",
    "undo": "<path d=\"M9 14 4 9l5-5\" /><path d=\"M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11\" />",
    "redo": "<path d=\"m15 14 5-5-5-5\" /><path d=\"M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13\" />",
    "insert": "<path d=\"M5 12h14\" /><path d=\"M12 5v14\" />",
    "background": "<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\" ry=\"2\" /><line x1=\"3\" x2=\"21\" y1=\"9\" y2=\"9\" /><line x1=\"3\" x2=\"21\" y1=\"15\" y2=\"15\" /><line x1=\"9\" x2=\"9\" y1=\"9\" y2=\"21\" /><line x1=\"15\" x2=\"15\" y1=\"9\" y2=\"21\" />",
    "width": "<circle cx=\"12\" cy=\"12\" r=\"10\" /><circle cx=\"12\" cy=\"12\" r=\"1\" />",
    "add-page": "<path d=\"M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z\" /><path d=\"M14 2v4a2 2 0 0 0 2 2h4\" /><path d=\"M9 15h6\" /><path d=\"M12 18v-6\" />",
    "chevron-down": "<path d=\"m6 9 6 6 6-6\" />",
    "chevron-left": "<path d=\"m15 18-6-6 6-6\" />",
    "chevron-right": "<path d=\"m9 18 6-6-6-6\" />",
    "chevron-up": "<path d=\"m18 15-6-6-6 6\" />",
    "zoom-in": "<circle cx=\"11\" cy=\"11\" r=\"8\" /><line x1=\"21\" x2=\"16.65\" y1=\"21\" y2=\"16.65\" /><line x1=\"11\" x2=\"11\" y1=\"8\" y2=\"14\" /><line x1=\"8\" x2=\"14\" y1=\"11\" y2=\"11\" />",
    "zoom-out": "<circle cx=\"11\" cy=\"11\" r=\"8\" /><line x1=\"21\" x2=\"16.65\" y1=\"21\" y2=\"16.65\" /><line x1=\"8\" x2=\"14\" y1=\"11\" y2=\"11\" />",
    "reset-view": "<path d=\"M3 7V5a2 2 0 0 1 2-2h2\" /><path d=\"M17 3h2a2 2 0 0 1 2 2v2\" /><path d=\"M21 17v2a2 2 0 0 1-2 2h-2\" /><path d=\"M7 21H5a2 2 0 0 1-2-2v-2\" />",
    "import-pdf": "<path d=\"M4 22h14a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v4\" /><path d=\"M14 2v4a2 2 0 0 0 2 2h4\" /><path d=\"M2 15h10\" /><path d=\"m9 18 3-3-3-3\" />",
    "export-pdf": "<path d=\"M14 2v4a2 2 0 0 0 2 2h4\" /><path d=\"M4 7V4a2 2 0 0 1 2-2 2 2 0 0 0-2 2\" /><path d=\"M4.063 20.999a2 2 0 0 0 2 1L18 22a2 2 0 0 0 2-2V7l-5-5H6\" /><path d=\"m5 11-3 3\" /><path d=\"m5 17-3-3h10\" />",
    "back": "<path d=\"m12 19-7-7 7-7\" /><path d=\"M19 12H5\" />",
    "library": "<path d=\"m16 6 4 14\" /><path d=\"M12 6v14\" /><path d=\"M8 8v12\" /><path d=\"M4 4v16\" />",
    "folder": "<path d=\"M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z\" />",
    "folder-plus": "<path d=\"M12 10v6\" /><path d=\"M9 13h6\" /><path d=\"M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z\" />",
    "notebook-plus": "<path d=\"M12 7v6\" /><path d=\"M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20\" /><path d=\"M9 10h6\" />",
    "canvas-plus": "<path d=\"M12 12c-2-2.67-4-4-6-4a4 4 0 1 0 0 8c2 0 4-1.33 6-4Zm0 0c2 2.67 4 4 6 4a4 4 0 0 0 0-8c-2 0-4 1.33-6 4Z\" />",
    "file-import": "<path d=\"M4 22h14a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v4\" /><path d=\"M14 2v4a2 2 0 0 0 2 2h4\" /><path d=\"M2 15h10\" /><path d=\"m9 18 3-3-3-3\" />",
    "search": "<circle cx=\"11\" cy=\"11\" r=\"8\" /><path d=\"m21 21-4.3-4.3\" />",
    "more": "<circle cx=\"12\" cy=\"12\" r=\"1\" /><circle cx=\"19\" cy=\"12\" r=\"1\" /><circle cx=\"5\" cy=\"12\" r=\"1\" />",
    "trash": "<path d=\"M3 6h18\" /><path d=\"M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6\" /><path d=\"M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2\" /><line x1=\"10\" x2=\"10\" y1=\"11\" y2=\"17\" /><line x1=\"14\" x2=\"14\" y1=\"11\" y2=\"17\" />",
    "duplicate": "<rect width=\"14\" height=\"14\" x=\"8\" y=\"8\" rx=\"2\" ry=\"2\" /><path d=\"M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2\" />",
    "move": "<path d=\"M2 9V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-1\" /><path d=\"M2 13h10\" /><path d=\"m9 16 3-3-3-3\" />",
    "rename": "<path d=\"M12 20h9\" /><path d=\"M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z\" /><path d=\"m15 5 3 3\" />",
    "open": "<path d=\"m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2\" />",
    "cut": "<circle cx=\"6\" cy=\"6\" r=\"3\" /><path d=\"M8.12 8.12 12 12\" /><path d=\"M20 4 8.12 15.88\" /><circle cx=\"6\" cy=\"18\" r=\"3\" /><path d=\"M14.8 14.8 20 20\" />",
    "copy": "<rect width=\"14\" height=\"14\" x=\"8\" y=\"8\" rx=\"2\" ry=\"2\" /><path d=\"M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2\" />",
    "paste": "<path d=\"M15 2H9a1 1 0 0 0-1 1v2c0 .6.4 1 1 1h6c.6 0 1-.4 1-1V3c0-.6-.4-1-1-1Z\" /><path d=\"M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2M16 4h2a2 2 0 0 1 2 2v2M11 14h10\" /><path d=\"m17 10 4 4-4 4\" />",
    "dup": "<line x1=\"15\" x2=\"15\" y1=\"12\" y2=\"18\" /><line x1=\"12\" x2=\"18\" y1=\"15\" y2=\"15\" /><rect width=\"14\" height=\"14\" x=\"8\" y=\"8\" rx=\"2\" ry=\"2\" /><path d=\"M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2\" />",
    "front": "<rect x=\"8\" y=\"8\" width=\"8\" height=\"8\" rx=\"2\" /><path d=\"M4 10a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2\" /><path d=\"M14 20a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2\" />",
    "send-back": "<rect x=\"14\" y=\"14\" width=\"8\" height=\"8\" rx=\"2\" /><rect x=\"2\" y=\"2\" width=\"8\" height=\"8\" rx=\"2\" /><path d=\"M7 14v1a2 2 0 0 0 2 2h1\" /><path d=\"M14 7h1a2 2 0 0 1 2 2v1\" />",
    "fliph": "<path d=\"m3 7 5 5-5 5V7\" /><path d=\"m21 7-5 5 5 5V7\" /><path d=\"M12 20v2\" /><path d=\"M12 14v2\" /><path d=\"M12 8v2\" /><path d=\"M12 2v2\" />",
    "flipv": "<path d=\"m17 3-5 5-5-5h10\" /><path d=\"m17 21-5-5-5 5h10\" /><path d=\"M4 12H2\" /><path d=\"M10 12H8\" /><path d=\"M16 12h-2\" /><path d=\"M22 12h-2\" />",
    "sun": "<circle cx=\"12\" cy=\"12\" r=\"4\" /><path d=\"M12 2v2\" /><path d=\"M12 20v2\" /><path d=\"m4.93 4.93 1.41 1.41\" /><path d=\"m17.66 17.66 1.41 1.41\" /><path d=\"M2 12h2\" /><path d=\"M20 12h2\" /><path d=\"m6.34 17.66-1.41 1.41\" /><path d=\"m19.07 4.93-1.41 1.41\" />",
    "moon": "<path d=\"M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z\" />",
    "x": "<path d=\"M18 6 6 18\" /><path d=\"m6 6 12 12\" />",
    "check": "<path d=\"M20 6 9 17l-5-5\" />",
    "palette": "<circle cx=\"13.5\" cy=\"6.5\" r=\".5\" fill=\"currentColor\" /><circle cx=\"17.5\" cy=\"10.5\" r=\".5\" fill=\"currentColor\" /><circle cx=\"8.5\" cy=\"7.5\" r=\".5\" fill=\"currentColor\" /><circle cx=\"6.5\" cy=\"12.5\" r=\".5\" fill=\"currentColor\" /><path d=\"M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z\" />",
    "plus": "<path d=\"M5 12h14\" /><path d=\"M12 5v14\" />",
    "folder-cog": "<circle cx=\"18\" cy=\"18\" r=\"3\" /><path d=\"M10.3 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v3.3\" /><path d=\"m21.7 19.4-.9-.3\" /><path d=\"m15.2 16.9-.9-.3\" /><path d=\"m16.6 21.7.3-.9\" /><path d=\"m19.1 15.2.3-.9\" /><path d=\"m19.6 21.7-.4-1\" /><path d=\"m16.8 15.3-.4-1\" /><path d=\"m14.3 19.6 1-.4\" /><path d=\"m20.7 16.8 1-.4\" />",
    "eye-off": "<path d=\"M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49\" /><path d=\"M14.084 14.158a3 3 0 0 1-4.242-4.242\" /><path d=\"M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143\" /><path d=\"m2 2 20 20\" />",
    "panel-left": "<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\" /><path d=\"M9 3v18\" /><path d=\"m16 15-3-3 3-3\" />",
    "panel-open": "<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\" /><path d=\"M9 3v18\" /><path d=\"m14 9 3 3-3 3\" />",
    "notebook": "<path d=\"M12 7v14\" /><path d=\"M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z\" />",
    "canvas": "<path d=\"M12 12c-2-2.67-4-4-6-4a4 4 0 1 0 0 8c2 0 4-1.33 6-4Zm0 0c2 2.67 4 4 6 4a4 4 0 0 0 0-8c-2 0-4 1.33-6 4Z\" />",
    "sheet": "<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\" ry=\"2\" /><line x1=\"3\" x2=\"21\" y1=\"9\" y2=\"9\" /><line x1=\"3\" x2=\"21\" y1=\"15\" y2=\"15\" /><line x1=\"9\" x2=\"9\" y1=\"9\" y2=\"21\" /><line x1=\"15\" x2=\"15\" y1=\"9\" y2=\"21\" />",
  };

  const NS = "http://www.w3.org/2000/svg";
  function svg(name, size = 20) {
    const inner = PATHS[name];
    if (inner == null) return null;
    const s = document.createElementNS(NS, "svg");
    s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("width", size); s.setAttribute("height", size);
    s.setAttribute("fill", "none"); s.setAttribute("stroke", "currentColor");
    s.setAttribute("stroke-width", "1.75"); s.setAttribute("stroke-linecap", "round"); s.setAttribute("stroke-linejoin", "round");
    s.setAttribute("aria-hidden", "true"); s.setAttribute("focusable", "false"); s.classList.add("icon");
    s.innerHTML = inner;
    return s;
  }

  // Elements that keep their text next to the icon; everything else becomes icon-only.
  const KEEP_TEXT = ".lib-menu-item, .lib-btn:not(.icon-only), .lib-link, .pop-item, [data-icon-label]";

  function decorate(el) {
    const name = el.dataset.icon;
    if (!name || el.dataset.iconDone === name) return;
    const icon = svg(name, +el.dataset.iconSize || 20);
    if (!icon) return;
    if (el.matches(KEEP_TEXT)) {
      el.querySelector(":scope > svg.icon")?.remove();
      el.prepend(icon);
    } else {
      // The accessible name comes from an existing aria-label, else the title, else the old text; the tooltip mirrors it.
      const label = el.getAttribute("aria-label") || el.title || el.textContent.trim();
      if (label && !el.hasAttribute("aria-label")) el.setAttribute("aria-label", label);
      if (label && !el.title && !el.matches(".lib-tree-icon, .lib-crumb-sep, .lib-folder-glyph, .lib-empty-icon")) el.title = label;
      el.replaceChildren(icon);
    }
    el.dataset.iconDone = name;
  }

  function apply(root = document) {
    if (root.nodeType === 1 && root.matches && root.matches("[data-icon]")) decorate(root);
    if (root.querySelectorAll) root.querySelectorAll("[data-icon]").forEach(decorate);
  }

  let queued = false;
  function watch() {
    new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; apply(document); });
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  const api = { PATHS, svg, apply, names: () => Object.keys(PATHS) };
  if (typeof document !== "undefined" && typeof window !== "undefined") {
    const go = () => { apply(document); watch(); };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", go); else go();
    window.Icons = api;
  }
  return api;
})();
if (typeof module !== "undefined") module.exports = Icons;
