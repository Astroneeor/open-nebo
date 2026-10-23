"use strict";
// One undo/redo history for everything on a page (strokes, shapes, images, graphs, selection edits, erasing).
// An entry is a before/after snapshot of a page's `strokes`, `objects` and `layers` arrays. Snapshots copy each item one
// level deep (`{ ...item }`), so in-place field edits are captured; array fields (stroke points, shape points) are
// shared, so code must REPLACE those arrays rather than mutate them (selection.js and shapes.js already do).
// No DOM: loadable from node for tests. Needs bind() to find pages by id.
const History = (() => {
  const MAX = 300, COALESCE_MS = 1200;
  let undoS = [], redoS = [];
  let pageById = () => null, onSwitch = () => {}, now = () => Date.now();

  const copy = (list) => (list || []).map((x) => ({ ...x }));
  const snap = (pg) => ({ strokes: copy(pg.strokes), objects: copy(pg.objects), layers: copy(pg.layers) });

  function sameItem(a, b) {
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (const k of ka) if (a[k] !== b[k]) return false;
    return true;
  }
  const sameList = (a, b) => a.length === b.length && a.every((x, i) => sameItem(x, b[i]));
  const same = (a, b) => sameList(a.strokes, b.strokes) && sameList(a.objects, b.objects) && sameList(a.layers || [], b.layers || []);

  function restore(pg, s) {
    pg.strokes = copy(s.strokes); pg.objects = copy(s.objects);
    if (s.layers.length || pg.layers) pg.layers = copy(s.layers); }

  function push(entry) {
    undoS.push(entry);
    if (undoS.length > MAX) undoS.shift();
    redoS = [];
  }

  // Take `before` now, call commit(token, label) once the edit is done. Nothing is recorded if nothing changed.
  const begin = (pg) => ({ pg, before: snap(pg) });
  function commit(token, label, key) {
    if (!token) return false;
    const after = snap(token.pg);
    if (same(token.before, after)) return false;
    const last = undoS[undoS.length - 1], t = now();
    if (key && last && last.key === key && last.pageId === token.pg.id && t - last.t < COALESCE_MS && redoS.length === 0) {
      last.after = after; last.t = t; // keep editing the same field: one undo step
      if (same(last.before, last.after)) undoS.pop();
      return true;
    }
    push({ label, key: key || null, pageId: token.pg.id, before: token.before, after, t });
    return true;
  }

  // Runs fn() and records the page change it made.
  function record(pg, label, fn, key) {
    const tok = begin(pg);
    const r = fn();
    commit(tok, label, key);
    return r;
  }

  function step(from, to, which) {
    const e = from.pop();
    if (!e) return false;
    const pg = pageById(e.pageId);
    if (!pg) return step(from, to, which); // page is gone: skip the entry
    restore(pg, e[which]);
    to.push(e);
    onSwitch(pg);
    return true;
  }

  return {
    begin, commit, record,
    undo: () => step(undoS, redoS, "before"),
    redo: () => step(redoS, undoS, "after"),
    reset() { undoS = []; redoS = []; },
    depth: () => undoS.length,
    canUndo: () => undoS.length > 0,
    canRedo: () => redoS.length > 0,
    // getPage(id) -> page | null; switchTo(page) is called after an undo/redo so the UI can show that page.
    bind(getPage, switchTo) { pageById = getPage; onSwitch = switchTo || (() => {}); },
    _setClock(f) { now = f; },
  };
})();
if (typeof module !== "undefined" && module.exports) module.exports = History;
