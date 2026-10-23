"use strict";
// Pure page-list operations for the sidebar: reorder, duplicate with fresh ids, and where the current page ends up.
// No DOM; loadable from node for tests.
(function (root) {
  const clampIdx = (i, len) => Math.max(0, Math.min(len - 1, i));

  // Returns a new array with the item at `from` moved so it ends up at index `to`. Out-of-range input is a no-op copy.
  function reorder(list, from, to) {
    const out = list.slice();
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || from >= out.length || to < 0 || to >= out.length) return out;
    const [x] = out.splice(from, 1);
    out.splice(to, 0, x);
    return out;
  }

  // Index of the page that was at `cur` after moving the page at `from` to `to`.
  function indexAfterMove(cur, from, to) {
    if (cur === from) return to;
    if (from < to && cur > from && cur <= to) return cur - 1;
    if (from > to && cur >= to && cur < from) return cur + 1;
    return cur;
  }

  // Current index after deleting index `del` from a list of `len` pages (len is the length BEFORE deleting).
  function indexAfterDelete(cur, del, len) {
    const n = len - 1;
    if (n <= 0) return 0;
    if (del < cur) return cur - 1;
    return clampIdx(cur, n); // deleting the current page selects the page that slides into its place (or the new last)
  }

  // Deep copy of a page with a new id and a new id on every stroke and object. Image payloads are strings, so they are
  // shared by value. `newId()` must return a fresh string on each call.
  function duplicatePage(pg, newId) {
    const copy = JSON.parse(JSON.stringify(pg));
    copy.id = `page-${newId()}`;
    for (const s of copy.strokes || []) s.id = newId();
    for (const o of copy.objects || []) o.id = newId();
    return copy;
  }

  // Page to build when inserting a blank page next to `base`: same size, same background look.
  function blankLike(base, newId) {
    const pg = { id: `page-${newId()}`, width: base.width, height: base.height, strokes: [], objects: [] };
    if (base.style) pg.style = { ...base.style };
    return pg;
  }

  const api = { reorder, indexAfterMove, indexAfterDelete, duplicatePage, blankLike };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.PageOps = api;
})(typeof window !== "undefined" ? window : globalThis);
