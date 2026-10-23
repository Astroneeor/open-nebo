"use strict";
// Pointer / stylus input decisions. Pure: no DOM, no clock (callers pass `now`), so it is unit-tested with node.
// classify() says what a pointerdown should do; app.js only acts on the answer.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(); else root.Input = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const PALM_MS = 1000; // touches this soon after a pen was last seen are treated as a resting palm

  // touch: auto = draws until a pen has been seen, then pans only | draw | pan | pen (touch ignored entirely)
  // eraserEnd / barrel: erase | select | pan | none
  const DEFAULTS = { touch: "auto", eraserEnd: "erase", barrel: "none" };
  const CHOICES = {
    touch: ["auto", "draw", "pan", "pen"],
    eraserEnd: ["erase", "select", "pan", "none"],
    barrel: ["erase", "select", "pan", "none"],
  };

  function sanitize(s) {
    const out = { ...DEFAULTS };
    for (const k of Object.keys(DEFAULTS)) if (s && CHOICES[k].includes(s[k])) out[k] = s[k];
    return out;
  }

  /** Tracker for pen presence: `contact` = pen pointer ids currently down, `lastSeen` = time of last pen event, `seenEver`. */
  const newTracker = () => ({ contact: new Set(), lastSeen: -Infinity, seenEver: false });

  /** Feed every pointer event (any type) through this. type: "down" | "move" | "up". */
  function observe(tr, ev, type, now) {
    if (ev.pointerType !== "pen") return tr;
    tr.seenEver = true; tr.lastSeen = now;
    if (type === "down") tr.contact.add(ev.pointerId);
    else if (type === "up") tr.contact.delete(ev.pointerId);
    return tr;
  }

  const penNear = (tr, now) => tr.contact.size > 0 || now - tr.lastSeen < PALM_MS;

  /** Which stylus button is active: "eraserEnd", "barrel" or null. Eraser end wins (buttons bit 32 / button 5; barrel is bit 2 / button 2). */
  function penButton(ev) {
    const b = ev.buttons | 0;
    if (b & 32 || ev.button === 5) return "eraserEnd";
    if (b & 2 || ev.button === 2) return "barrel";
    return null;
  }

  /**
   * Decision for a pointerdown. Returns one of:
   *  { action: "draw" }                      use the current tool as normal
   *  { action: "tool", tool: "erase"|"select", button }  draw with this tool while the button is held, then restore
   *  { action: "pan" }                       single-pointer pan (stylus button)
   *  { action: "view" }                      touch: hand to the view code (two-finger pan / pinch zoom), never draw
   *  { action: "ignore" }                    palm or disabled touch
   */
  function classify(ev, settings, tr, now) {
    const s = sanitize(settings);
    const t = ev.pointerType;
    if (t === "touch") {
      if (s.touch === "pen") return { action: "ignore" };
      if (s.touch === "draw") return { action: "draw" };
      const rejecting = s.touch === "pan" || (s.touch === "auto" && tr.seenEver);
      if (!rejecting) return { action: "draw" };
      return penNear(tr, now) ? { action: "ignore" } : { action: "view" };
    }
    if (t === "pen") {
      const btn = penButton(ev);
      const a = btn && s[btn];
      if (!a || a === "none") return { action: "draw" };
      if (a === "pan") return { action: "pan", button: btn };
      return { action: "tool", tool: a, button: btn };
    }
    return { action: "draw" }; // mouse and anything unknown always draws
  }

  /** Short diagnostics string for the settings popover. */
  function describe(ev) {
    if (!ev) return "No pointer events yet. Touch the canvas with your pen.";
    const p = typeof ev.pressure === "number" ? ev.pressure.toFixed(2) : "?";
    return `${ev.pointerType || "?"} | pressure ${p} | buttons ${ev.buttons | 0}`;
  }

  return { PALM_MS, DEFAULTS, CHOICES, sanitize, newTracker, observe, penNear, penButton, classify, describe };
});
