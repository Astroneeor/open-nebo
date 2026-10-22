"use strict";
// Page-range text ("1-3, 5") -> sorted unique 1-based page numbers. Empty text means every page.
(function (root) {
  function parseRange(text, total) {
    const src = String(text ?? "").trim();
    if (!src) return { pages: Array.from({ length: total }, (_, i) => i + 1) };
    const set = new Set();
    for (const raw of src.split(",")) {
      const part = raw.trim();
      const m = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(part);
      if (!m) return { error: `"${part}" is not a page or range` };
      const a = +m[1], b = m[2] === undefined ? a : +m[2];
      if (a < 1 || b > total) return { error: `Pages must be between 1 and ${total}` };
      if (a > b) return { error: `Range ${a}-${b} is backwards` };
      for (let i = a; i <= b; i++) set.add(i);
    }
    return { pages: [...set].sort((x, y) => x - y) };
  }
  const api = { parseRange };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.PageRange = api;
})(typeof window !== "undefined" ? window : globalThis);
