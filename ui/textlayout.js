"use strict";
// Pure text layout for typed text boxes ({x, y, w, text, size, bold, italic}). No DOM; loadable from node for tests.
// wrap() breaks text into lines no wider than a width, given a measure function (string -> pixel width).
// layout()/height() use a measure that text.js swaps for a real canvas measureText; the default is an estimate.
const Textlayout = (() => {
  const LINE_HEIGHT = 1.3;          // line box height as a multiple of the font size
  const FAMILY = 'system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
  const DEFAULTS = { w: 360, size: 24 };
  const cache = new Map();

  const estimate = (str, size, bold) => str.length * size * (bold ? 0.58 : 0.52);
  let measureFn = estimate;
  const setMeasure = (fn) => { measureFn = fn || estimate; cache.clear(); };

  const font = (o) => `${o.italic ? "italic " : ""}${o.bold ? "bold " : ""}${o.size || DEFAULTS.size}px ${FAMILY}`;

  // Greedy word wrap. Explicit newlines always break; a word wider than the box is split by characters.
  // Whitespace at a soft wrap is dropped; the text is never lost.
  function wrap(text, width, measure) {
    const out = [];
    for (const para of String(text).split(/\r\n|\r|\n/)) {
      if (para === "") { out.push(""); continue; }
      let line = "";
      for (const word of para.split(/(?<=\s)(?=\S)|(?<=\S)(?=\s)/)) {
        const tentative = line + word;
        if (measure(tentative.replace(/\s+$/, "")) <= width) { line = tentative; continue; }
        if (/^\s+$/.test(word)) continue;                   // trailing space at a wrap point
        if (line.trim() !== "") { out.push(line.replace(/\s+$/, "")); line = ""; }
        let w = word;
        while (measure(w) > width && w.length > 1) {         // break an over-long word
          let n = 1;
          while (n < w.length && measure(w.slice(0, n + 1)) <= width) n++;
          out.push(w.slice(0, n)); w = w.slice(n);
        }
        line = w;
      }
      out.push(line.replace(/\s+$/, ""));
    }
    return out;
  }

  // { lines, lh, h } for text object o: lh is the line height in world units, h the whole box height.
  function layout(o) {
    const size = o.size || DEFAULTS.size, w = o.w || DEFAULTS.w;
    const key = `${o.text}\u0000${w}|${size}|${o.bold ? 1 : 0}${o.italic ? 1 : 0}`;
    let r = cache.get(key);
    if (!r) {
      const lines = wrap(o.text || "", w, (s) => measureFn(s, size, !!o.bold, !!o.italic));
      r = { lines, lh: size * LINE_HEIGHT, h: Math.max(1, lines.length) * size * LINE_HEIGHT };
      if (cache.size > 500) cache.clear();
      cache.set(key, r);
    }
    return r;
  }
  const height = (o) => layout(o).h;
  const box = (o) => ({ x: o.x, y: o.y, w: o.w || DEFAULTS.w, h: height(o) });

  return { LINE_HEIGHT, FAMILY, DEFAULTS, wrap, layout, height, box, font, setMeasure };
})();
if (typeof module !== "undefined" && module.exports) module.exports = Textlayout;
