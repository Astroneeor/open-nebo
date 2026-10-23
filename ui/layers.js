"use strict";
// Pure layer logic (no DOM). A page has `layers: [{id,name,visible,locked}]`, bottom to top, above an implicit base
// layer that has no entry. Strokes and objects point at a layer through their optional `layer` id; no `layer` (or an id
// that no longer exists) means the base layer. The base layer's hidden/locked state and the active layer are kept in
// memory per page id (not saved), because the schema has no entry for the base layer.
const Layers = (() => {
  const baseState = new Map();  // page id -> { visible, locked }
  const activeBy = new Map();   // page id -> layer id (null = base)

  const list = (pg) => (pg.layers || (pg.layers = []));
  const find = (pg, id) => (id ? (pg.layers || []).find((l) => l.id === id) || null : null);
  // Normalised layer id of an item: null for the base layer or an unknown id.
  const idOf = (pg, it) => (it && find(pg, it.layer) ? it.layer : null);
  const rank = (pg, id) => (id ? (pg.layers || []).findIndex((l) => l.id === id) + 1 : 0); // base = 0
  const base = (pg) => { let b = baseState.get(pg.id); if (!b) baseState.set(pg.id, b = { visible: true, locked: false }); return b; };

  const isVisible = (pg, id) => (id && find(pg, id) ? find(pg, id).visible !== false : base(pg).visible);
  const isLocked = (pg, id) => (id && find(pg, id) ? !!find(pg, id).locked : base(pg).locked);
  const itemVisible = (pg, it) => isVisible(pg, idOf(pg, it));
  // Can this item be hit, erased, selected or moved?
  const editable = (pg, it) => { const id = idOf(pg, it); return isVisible(pg, id) && !isLocked(pg, id); };
  const canDraw = (pg, id) => isVisible(pg, id) && !isLocked(pg, id);

  function active(pg) { const id = activeBy.get(pg.id) || null; return find(pg, id) ? id : null; }
  function setActive(pg, id) { if (id && !find(pg, id)) id = null; activeBy.set(pg.id, id); return id; }
  // Stamp a new item with the active layer (omitted for base).
  function stamp(pg, it) { const id = active(pg); if (id) it.layer = id; else delete it.layer; return it; }

  // Draw order: base items, then each layer bottom to top; hidden layers dropped; order within a layer is kept.
  // Returns views [{ id, strokes, objects }] shaped like a page, so existing draw functions can take them directly.
  function drawOrder(pg) {
    const ids = [null, ...(pg.layers || []).map((l) => l.id)];
    const out = [];
    for (const id of ids) {
      if (!isVisible(pg, id)) continue;
      const strokes = (pg.strokes || []).filter((s) => idOf(pg, s) === id);
      const objects = (pg.objects || []).filter((o) => idOf(pg, o) === id);
      if (strokes.length || objects.length) out.push({ ...pg, id: pg.id, strokes, objects, layerId: id });
    }
    return out;
  }

  function newId(pg) {
    let n = (pg.layers || []).length + 1;
    while (find(pg, "layer-" + n)) n++;
    return "layer-" + n;
  }
  function addLayer(pg, name, id) {
    const l = { id: id || newId(pg), name: name || "Layer " + (list(pg).length + 1), visible: true, locked: false };
    list(pg).push(l);
    return l;
  }
  function rename(pg, id, name) { const l = find(pg, id); name = String(name || "").trim(); if (l && name) l.name = name; return !!l && !!name; }
  function setVisible(pg, id, v) { const l = find(pg, id); if (l) l.visible = !!v; else if (!id) base(pg).visible = !!v; }
  function setLocked(pg, id, v) { const l = find(pg, id); if (l) l.locked = !!v; else if (!id) base(pg).locked = !!v; }

  // Moves every stroke/object on layer `from` to layer `to` (null = base).
  function reassign(pg, from, to) {
    for (const it of [...(pg.strokes || []), ...(pg.objects || [])]) {
      if (idOf(pg, it) === from || it.layer === from) { if (to) it.layer = to; else delete it.layer; }
    }
  }
  // Deleting never loses ink: its items drop to the layer below (or base).
  function deleteLayer(pg, id) {
    const i = (pg.layers || []).findIndex((l) => l.id === id);
    if (i < 0) return false;
    const below = i > 0 ? pg.layers[i - 1].id : null;
    reassign(pg, id, below);
    pg.layers.splice(i, 1);
    if (activeBy.get(pg.id) === id) activeBy.set(pg.id, below);
    return true;
  }
  const mergeDown = deleteLayer; // identical result: the layer's items join the layer below, the layer entry goes away

  // dir -1 = down (towards base), +1 = up.
  function move(pg, id, dir) {
    const ls = pg.layers || [], i = ls.findIndex((l) => l.id === id), j = i + dir;
    if (i < 0 || j < 0 || j >= ls.length) return false;
    [ls[i], ls[j]] = [ls[j], ls[i]];
    return true;
  }
  // Puts items (stroke/object records) on layer `id` (null = base).
  function moveItems(pg, items, id) {
    if (id && !find(pg, id)) return 0;
    for (const it of items) { if (id) it.layer = id; else delete it.layer; }
    return items.length;
  }

  const api = { list, find, idOf, rank, isVisible, isLocked, itemVisible, editable, canDraw, active, setActive, stamp, drawOrder,
                addLayer, rename, setVisible, setLocked, deleteLayer, mergeDown, move, moveItems, _reset() { baseState.clear(); activeBy.clear(); } };
  if (typeof window !== "undefined") window.Layers = api;
  return api;
})();
if (typeof module !== "undefined" && module.exports) module.exports = Layers;
