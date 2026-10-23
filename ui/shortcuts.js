"use strict";
// Keyboard shortcuts: a pure keymap layer (parse / format / match / conflicts / overrides, unit-tested in Node) and a
// small DOM layer that owns the command registry, the global dispatcher and the "Keyboard shortcuts" dialog.
// Commands mostly click the existing toolbar buttons, so this file never needs to know how the tools work.
const Shortcuts = (() => {
  // ---------- pure keymap layer ----------
  const MODS = ["Ctrl", "Alt", "Shift"];
  const ALIAS = { esc: "Escape", space: " ", spacebar: " ", plus: "+", del: "Delete", return: "Enter", pgup: "PageUp", pgdn: "PageDown",
                  up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight", cmd: "Ctrl", meta: "Ctrl", control: "Ctrl", mod: "Ctrl", option: "Alt" };
  const isLetter = (k) => k.length === 1 && k.toLowerCase() !== k.toUpperCase();

  function normKey(k) {
    if (k == null) return "";
    const a = ALIAS[String(k).toLowerCase()];
    if (a && !MODS.includes(a)) return a;
    if (String(k).length === 1) return isLetter(k) ? k.toUpperCase() : k;
    return String(k)[0].toUpperCase() + String(k).slice(1);
  }

  /** "Ctrl+Shift+Z" -> { ctrl, alt, shift, key } (Cmd/Meta count as Ctrl). Returns null for junk. */
  function parse(str) {
    if (typeof str !== "string" || !str.trim()) return null;
    let s = str.trim(), key;
    if (s === "+") return { ctrl: false, alt: false, shift: false, key: "+" };
    if (s.endsWith("++")) { key = "+"; s = s.slice(0, -2); } else { const i = s.lastIndexOf("+"); key = i < 0 ? s : s.slice(i + 1); s = i < 0 ? "" : s.slice(0, i); }
    const out = { ctrl: false, alt: false, shift: false, key: normKey(key) };
    if (!out.key) return null;
    for (const m of s.split("+").filter(Boolean)) {
      const n = ALIAS[m.toLowerCase()] || m[0].toUpperCase() + m.slice(1).toLowerCase();
      if (n === "Ctrl") out.ctrl = true; else if (n === "Alt") out.alt = true; else if (n === "Shift") out.shift = true; else return null;
    }
    if (MODS.includes(out.key)) return null;
    // A shifted symbol ("?", "+") already says Shift in the character itself.
    if (out.key.length === 1 && !isLetter(out.key)) out.shift = false;
    return out;
  }

  /** Canonical string for a parsed combo (or for a string, after round-tripping). */
  function format(p) {
    if (typeof p === "string") p = parse(p);
    if (!p) return "";
    const key = p.key === " " ? "Space" : p.key;
    return [p.ctrl && "Ctrl", p.alt && "Alt", p.shift && "Shift", key].filter(Boolean).join("+");
  }
  const canon = (s) => format(parse(s));

  /** Combo for a KeyboardEvent, or null for a bare modifier press. */
  function fromEvent(ev) {
    if (!ev || MODS.includes(normKey(ev.key)) || ["Meta", "Control", "Shift", "Alt", "AltGraph", "Dead"].includes(ev.key)) return null;
    return format(parse2({ ctrl: !!(ev.ctrlKey || ev.metaKey), alt: !!ev.altKey, shift: !!ev.shiftKey, key: normKey(ev.key) }));
  }
  function parse2(p) { if (p.key.length === 1 && !isLetter(p.key)) p.shift = false; return p; }

  /** bindings: { id: [combo,...] }. Returns [{ combo, ids }] for every combo bound to more than one command. */
  function conflicts(bindings) {
    const by = new Map();
    for (const [id, list] of Object.entries(bindings)) for (const c of list || []) {
      const k = canon(c); if (!k) continue;
      if (!by.has(k)) by.set(k, []);
      if (!by.get(k).includes(id)) by.get(k).push(id);
    }
    return [...by].filter(([, ids]) => ids.length > 1).map(([combo, ids]) => ({ combo, ids }));
  }
  /** Other commands already using combo (ignoring `id` itself). */
  function conflictsWith(bindings, id, combo) {
    const k = canon(combo);
    return Object.keys(bindings).filter((o) => o !== id && (bindings[o] || []).some((c) => canon(c) === k));
  }
  /** Id of the first command bound to the combo, or null. */
  function match(bindings, combo) {
    const k = canon(combo);
    if (!k) return null;
    for (const [id, list] of Object.entries(bindings)) if ((list || []).some((c) => canon(c) === k)) return id;
    return null;
  }
  /** Only what differs from the defaults, ready for JSON.stringify. */
  function serializeOverrides(bindings, defaults) {
    const out = {};
    for (const id of Object.keys(defaults)) {
      const cur = (bindings[id] || []).map(canon).filter(Boolean), def = defaults[id].map(canon);
      if (cur.join("|") !== def.join("|")) out[id] = cur;
    }
    return out;
  }
  /** defaults + a saved overrides object (or JSON string); unknown ids and junk combos are dropped. */
  function applyOverrides(defaults, saved) {
    let o = saved;
    if (typeof o === "string") { try { o = JSON.parse(o); } catch (_) { o = null; } }
    const out = {};
    for (const id of Object.keys(defaults)) {
      const v = o && typeof o === "object" && Array.isArray(o[id]) ? o[id].map(canon).filter(Boolean) : null;
      out[id] = v || defaults[id].map(canon);
    }
    return out;
  }
  /** Ignore keystrokes meant for form controls and editable text. */
  function isTyping(t) {
    if (!t) return false;
    return /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || "") || !!t.isContentEditable;
  }

  const DEFAULT_KEYS = {
    pen: ["P"], eraser: ["E"], select: ["V"], text: ["T"], undo: ["Ctrl+Z"], redo: ["Ctrl+Shift+Z", "Ctrl+Y"],
    zoomIn: ["Ctrl+=", "Ctrl++"], zoomOut: ["Ctrl+-"], zoomReset: ["Ctrl+0"], nextPage: ["PageDown"], prevPage: ["PageUp"],
    addPage: ["Alt+N"], smart: ["S"], snap: ["G"], background: ["B"], export: ["Ctrl+Shift+E"], help: ["?"],
  };
  const DEFAULTS = Object.fromEntries(Object.entries(DEFAULT_KEYS).map(([k, v]) => [k, v.map(canon)]));
  const pure = { DEFAULTS, parse, format, canon, fromEvent, conflicts, conflictsWith, match, serializeOverrides, applyOverrides, isTyping };
  if (typeof document === "undefined" || typeof window === "undefined") return pure;

  // ---------- registry ----------
  const $ = (id) => document.getElementById(id);
  const click = (...ids) => () => { for (const id of ids) { const b = $(id); if (b && !b.disabled) { b.click(); return; } } };
  const COMMANDS = [
    { id: "pen", label: "Pen", run: click("pen") },
    { id: "eraser", label: "Eraser", run: click("eraser") },
    { id: "select", label: "Select", run: click("selectTool") },
    { id: "text", label: "Text", run: click("textTool", "text") },
    { id: "undo", label: "Undo", run: click("undo") },
    { id: "redo", label: "Redo", run: click("redo") },
    { id: "zoomIn", label: "Zoom in", run: click("zoomIn") },
    { id: "zoomOut", label: "Zoom out", run: click("zoomOut") },
    { id: "zoomReset", label: "Reset zoom", run: click("resetView") },
    { id: "nextPage", label: "Next page", run: click("next") },
    { id: "prevPage", label: "Previous page", run: click("prev") },
    { id: "addPage", label: "Add page", run: click("addPage") },
    { id: "smart", label: "Toggle smart shapes", run: click("smart") },
    { id: "snap", label: "Toggle snap to grid", run: click("snapGrid") },
    { id: "background", label: "Open background picker", run: click("bgBtn") },
    { id: "export", label: "Export as PDF", run: click("exportPdf") },
    { id: "help", label: "Keyboard shortcuts", run: () => toggleDialog(), global: true },
  ];
  for (const c of COMMANDS) c.keys = DEFAULTS[c.id];
  const byId = Object.fromEntries(COMMANDS.map((c) => [c.id, c]));
  const KEY = "shortcuts";
  const lsGet = () => { try { return localStorage.getItem(KEY); } catch (_) { return null; } };
  const lsSet = (v) => { try { localStorage.setItem(KEY, v); } catch (_) { /* storage may be blocked */ } };
  let bindings = applyOverrides(DEFAULTS, lsGet());
  const save = () => lsSet(JSON.stringify(serializeOverrides(bindings, DEFAULTS)));

  let recording = false, dlg = null, lastFocus = null;

  // ---------- dispatcher ----------
  window.addEventListener("keydown", (ev) => {
    if (recording || ev.defaultPrevented || ev.isComposing || isTyping(ev.target)) return;
    const combo = fromEvent(ev);
    if (!combo) return;
    const id = match(bindings, combo), cmd = id && byId[id];
    if (!cmd) return;
    const editorUp = $("editor") && !$("editor").hidden;
    if (!cmd.global && !editorUp) return;
    if (dlg && !dlg.hidden && !cmd.global) return;
    ev.preventDefault();
    cmd.run();
  });

  // ---------- dialog ----------
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const pretty = (c) => c.split("+").join(" + ").replace("Ctrl", /Mac/.test(navigator.platform || "") ? "Ctrl/Cmd" : "Ctrl");

  function build() {
    dlg = el("div", "pdfdlg-back kbd-back"); dlg.hidden = true;
    const box = el("div", "pdfdlg kbd-dlg");
    box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true"); box.setAttribute("aria-label", "Keyboard shortcuts");
    dlg.append(box);
    dlg.addEventListener("pointerdown", (ev) => { if (ev.target === dlg) closeDialog(); });
    dlg.addEventListener("keydown", (ev) => {
      if (recording) return;
      if (ev.key === "Escape") { ev.stopPropagation(); closeDialog(); }
      else if (ev.key === "Tab") {
        const f = [...box.querySelectorAll("button")].filter((b) => !b.disabled);
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
        else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
      }
    });
    document.body.append(dlg);
  }

  function renderDialog(focusId) {
    const box = dlg.firstChild;
    box.replaceChildren();
    box.append(el("h2", null, "Keyboard shortcuts"));
    box.append(el("p", "kbd-hint", "Click a shortcut, then press the new keys. Escape cancels."));
    const clashes = new Set(conflicts(bindings).flatMap((c) => c.ids));
    const list = el("ul", "kbd-list");
    for (const cmd of COMMANDS) {
      const li = el("li", "kbd-row");
      li.append(el("span", "kbd-name", cmd.label));
      const keys = el("span", "kbd-keys");
      (bindings[cmd.id].length ? bindings[cmd.id] : [""]).forEach((c, i) => {
        const b = el("button", "kbd-key", c ? pretty(c) : "Unassigned");
        b.type = "button"; b.dataset.cmd = cmd.id; b.dataset.idx = i;
        b.setAttribute("aria-label", `${cmd.label}: ${c ? pretty(c) : "unassigned"}. Click to change.`);
        b.addEventListener("click", () => record(cmd.id, i, b));
        keys.append(b);
      });
      li.append(keys);
      const reset = el("button", "kbd-reset", "Reset"); reset.type = "button";
      reset.setAttribute("aria-label", `Reset ${cmd.label} to default`);
      reset.disabled = bindings[cmd.id].join("|") === DEFAULTS[cmd.id].join("|");
      reset.addEventListener("click", () => { bindings[cmd.id] = DEFAULTS[cmd.id].slice(); save(); renderDialog(); });
      li.append(reset);
      if (clashes.has(cmd.id)) {
        const others = conflicts(bindings).filter((c) => c.ids.includes(cmd.id)).map((c) => `${pretty(c.combo)} is also used by ${c.ids.filter((x) => x !== cmd.id).map((x) => byId[x].label).join(", ")}`);
        li.classList.add("conflict");
        li.append(el("span", "kbd-warn", "Conflict: " + others.join("; ")));
      }
      list.append(li);
    }
    box.append(list);
    const foot = el("div", "btns");
    const all = el("button", null, "Reset all"); all.type = "button";
    all.addEventListener("click", () => { bindings = applyOverrides(DEFAULTS, null); save(); renderDialog(); });
    const done = el("button", "primary", "Done"); done.type = "button"; done.addEventListener("click", closeDialog);
    foot.append(all, done); box.append(foot);
    window.Icons?.apply(box);
    const target = focusId ? box.querySelector(`[data-cmd="${focusId}"]`) : done;
    (target || done).focus();
  }

  function record(id, idx, btn) {
    recording = true;
    btn.textContent = "Press keys…"; btn.classList.add("rec");
    const stop = () => { recording = false; window.removeEventListener("keydown", onKey, true); };
    const onKey = (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      if (ev.key === "Escape") { stop(); renderDialog(id); return; }
      const combo = fromEvent(ev);
      if (!combo) return; // bare modifier: keep waiting
      stop();
      const list = bindings[id].slice();
      if (idx < list.length) list[idx] = combo; else list.push(combo);
      bindings[id] = [...new Set(list)];
      save(); renderDialog(id);
    };
    window.addEventListener("keydown", onKey, true);
    btn.addEventListener("blur", () => { if (recording) { stop(); renderDialog(id); } }, { once: true });
  }

  function openDialog() {
    if (!dlg) build();
    lastFocus = document.activeElement;
    dlg.hidden = false; renderDialog();
  }
  function closeDialog() {
    if (!dlg || dlg.hidden) return;
    recording = false; dlg.hidden = true;
    const b = $("shortcutsBtn");
    try { (lastFocus && document.contains(lastFocus) ? lastFocus : b)?.focus(); } catch (_) { /* ignore */ }
  }
  function toggleDialog() { if (dlg && !dlg.hidden) closeDialog(); else openDialog(); }

  document.addEventListener("click", (ev) => { if (ev.target.closest && ev.target.closest("#shortcutsBtn")) openDialog(); });

  return Object.assign({ COMMANDS, DEFAULTS, bindings: () => ({ ...bindings }), open: openDialog, close: closeDialog }, pure, { __pure: pure });
})();
if (typeof module !== "undefined") module.exports = Shortcuts;
