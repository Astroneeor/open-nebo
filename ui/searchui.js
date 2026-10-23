"use strict";
// Full-text search results for the library home screen. The pure helpers (highlight splitting,
// debounce) are unit-tested; the DOM part only ever uses textContent / text nodes, never innerHTML,
// because snippets are notebook content.
const SearchUI = (() => {
  const DEBOUNCE_MS = 250;

  // One code point in, one code point out: lowercase with the (Latin) diacritic dropped.
  function foldChar(ch) {
    const d = ch.normalize("NFD");
    const base = Array.from(d)[0] || ch;
    return /\s/u.test(base) ? " " : base.toLowerCase();
  }
  const fold = (s) => Array.from(s, foldChar);
  const terms = (q) => String(q || "").split(/\s+/u).filter(Boolean).slice(0, 16).map(fold);

  // Splits text into [{ text, hit }] runs; every occurrence of any query word is a hit.
  function splitHighlight(text, query) {
    const chars = Array.from(String(text || ""));
    const hay = chars.map(foldChar);
    const mark = new Array(chars.length).fill(false);
    for (const t of terms(query)) {
      for (let i = 0; i + t.length <= hay.length; i++) {
        let ok = true;
        for (let j = 0; j < t.length; j++) if (hay[i + j] !== t[j]) { ok = false; break; }
        if (ok) for (let j = 0; j < t.length; j++) mark[i + j] = true;
      }
    }
    const out = [];
    chars.forEach((c, i) => {
      const last = out[out.length - 1];
      if (last && last.hit === mark[i]) last.text += c; else out.push({ text: c, hit: mark[i] });
    });
    return out;
  }

  // Trailing-edge debounce. `timers` is injectable for tests.
  function debounce(fn, ms = DEBOUNCE_MS, timers = globalThis) {
    let id = null;
    const d = (...args) => {
      if (id != null) timers.clearTimeout(id);
      id = timers.setTimeout(() => { id = null; fn(...args); }, ms);
    };
    d.cancel = () => { if (id != null) { timers.clearTimeout(id); id = null; } };
    return d;
  }

  const api = { DEBOUNCE_MS, foldChar, splitHighlight, debounce };
  if (typeof document === "undefined") return api;

  function highlighted(text, query, tag = "span") {
    const n = document.createElement(tag);
    for (const run of splitHighlight(text, query)) {
      if (run.hit) { const m = document.createElement("mark"); m.textContent = run.text; n.append(m); }
      else n.append(document.createTextNode(run.text));
    }
    return n;
  }

  // The "In notebooks" section. open(hit) is called when a result is activated.
  function section(hits, query, open) {
    const sec = document.createElement("section");
    sec.className = "lib-section lib-fts";
    const h = document.createElement("h2");
    h.textContent = `In notebooks (${hits.length})`;
    const list = document.createElement("ul");
    list.className = "lib-fts-list";
    for (const hit of hits) {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button"; btn.className = "lib-fts-hit";
      const head = document.createElement("span");
      head.className = "lib-fts-head";
      head.append(highlighted(hit.title, query, "strong"));
      const pg = document.createElement("span");
      pg.className = "lib-fts-page"; pg.textContent = `Page ${hit.page_index + 1}`;
      head.append(pg);
      const snip = highlighted(hit.snippet, query);
      snip.className = "lib-fts-snippet";
      btn.append(head, snip);
      btn.addEventListener("click", () => open(hit));
      li.append(btn); list.append(li);
    }
    sec.append(h, list);
    return sec;
  }

  api.section = section;
  window.SearchUI = api;
  return api;
})();
if (typeof module !== "undefined" && module.exports) module.exports = SearchUI;
