"use strict";
// Infinite-canvas viewport: world <-> screen transform, pan and zoom.
// `V.x`/`V.y` is the world point at the canvas's top-left, `V.zoom` is CSS px per world unit.
// app.js owns drawing; it calls V.begin(ctx) before drawing world-space content and V.end(ctx) after.
const V = (() => {
  const MIN = 0.05, MAX = 8;
  const st = { x: 0, y: 0, zoom: 1, pageId: null, space: false, panning: null, touches: new Map(), pinch: null };
  let cv, stage, onChange = () => {};

  const clamp = (z) => Math.min(MAX, Math.max(MIN, z));
  const local = (ev) => { const r = cv.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; };
  const persist = (page) => { if (page) page.view = { x: st.x, y: st.y, zoom: st.zoom }; };

  function zoomAt(sx, sy, z2) {
    z2 = clamp(z2);
    const wx = st.x + sx / st.zoom, wy = st.y + sy / st.zoom;
    st.zoom = z2; st.x = wx - sx / z2; st.y = wy - sy / z2;
  }

  const api = {
    get x() { return st.x; }, get y() { return st.y; }, get zoom() { return st.zoom; },
    get gesture() { return !!(st.panning || st.pinch); },

    init(canvas, stageEl, getPage, changed) {
      cv = canvas; stage = stageEl; onChange = changed; api.getPage = getPage;
      new ResizeObserver(() => onChange()).observe(stage);
      cv.addEventListener("wheel", (ev) => {
        ev.preventDefault();
        const p = local(ev);
        if (ev.ctrlKey) zoomAt(p.x, p.y, st.zoom * Math.exp(-ev.deltaY * 0.01));
        else { st.x += (ev.shiftKey ? ev.deltaY : ev.deltaX) / st.zoom; st.y += (ev.shiftKey ? 0 : ev.deltaY) / st.zoom; }
        persist(getPage()); onChange();
      }, { passive: false });
      window.addEventListener("keydown", (ev) => {
        if (ev.code !== "Space" || /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName)) return;
        ev.preventDefault(); st.space = true; cv.classList.add("pannable");
      });
      window.addEventListener("keyup", (ev) => {
        if (ev.code === "Space") { st.space = false; cv.classList.remove("pannable"); }
      });
    },

    /** Resize the backing store to the stage and restore this page's saved view (or fit width). */
    sync(page) {
      const w = stage.clientWidth, h = stage.clientHeight, dpr = window.devicePixelRatio || 1;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
        cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      }
      // While the editor is hidden (the library is showing) the stage has no size: fitting now would clamp to the minimum
      // zoom and stick. Wait for the first render after the editor is shown.
      if (!w || !h) return;
      if (page && st.pageId !== page.id) {
        st.pageId = page.id;
        if (page.view) Object.assign(st, { x: page.view.x, y: page.view.y, zoom: clamp(page.view.zoom) });
        else api.reset(page, true);
      }
    },

    /** Fit the original sheet's width into the viewport, top-left aligned with a small margin. */
    reset(page, silent) {
      const z = page ? Math.min(1, (stage.clientWidth - 32) / page.width) : 1;
      Object.assign(st, { zoom: clamp(z), x: -16 / z, y: -16 / z });
      if (!silent) { persist(page); onChange(); }
    },
    zoomBy(f) {
      zoomAt(cv.clientWidth / 2, cv.clientHeight / 2, st.zoom * f);
      persist(api.getPage()); onChange();
    },

    begin(ctx) {
      const d = (window.devicePixelRatio || 1) * st.zoom;
      ctx.save(); ctx.setTransform(d, 0, 0, d, -st.x * d, -st.y * d);
    },
    end(ctx) { ctx.restore(); },

    toWorld(ev) { const p = local(ev); return { x: st.x + p.x / st.zoom, y: st.y + p.y / st.zoom }; },

    /** Returns true when the event started/continued a pan or pinch and must not draw. */
    down(ev) {
      if (ev.pointerType === "touch") {
        st.touches.set(ev.pointerId, local(ev));
        if (st.touches.size === 2) { st.pinch = null; return true; }
        return st.touches.size > 2;
      }
      if (ev.button === 1 || (ev.button === 0 && st.space)) {
        ev.preventDefault(); cv.setPointerCapture(ev.pointerId);
        st.panning = { id: ev.pointerId, ...local(ev) }; cv.classList.add("panning"); return true;
      }
      return false;
    },
    /** Start a one-pointer pan (stylus button, or a single finger when touch only pans). move/up below continue it. */
    startPan(ev) {
      cv.setPointerCapture(ev.pointerId);
      st.panning = { id: ev.pointerId, ...local(ev) }; cv.classList.add("panning");
    },
    stopPan() { st.panning = null; if (cv) cv.classList.remove("panning"); },
    touchCount() { return st.touches.size; },
    move(ev) {
      if (st.panning && ev.pointerId === st.panning.id) {
        const p = local(ev);
        st.x -= (p.x - st.panning.x) / st.zoom; st.y -= (p.y - st.panning.y) / st.zoom;
        st.panning.x = p.x; st.panning.y = p.y; onChange(); return true;
      }
      if (ev.pointerType === "touch" && st.touches.has(ev.pointerId)) {
        st.touches.set(ev.pointerId, local(ev));
        if (st.touches.size >= 2) {
          const [a, b] = [...st.touches.values()];
          const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
          if (st.pinch) {
            st.x -= (mid.x - st.pinch.mid.x) / st.zoom; st.y -= (mid.y - st.pinch.mid.y) / st.zoom;
            zoomAt(mid.x, mid.y, st.zoom * dist / st.pinch.dist);
            onChange();
          }
          st.pinch = { mid, dist };
          return true;
        }
      }
      return false;
    },
    up(ev) {
      const was = api.gesture;
      if (st.panning && ev.pointerId === st.panning.id) { st.panning = null; cv.classList.remove("panning"); }
      if (ev.pointerType === "touch") {
        st.touches.delete(ev.pointerId);
        if (st.touches.size < 2) st.pinch = null;
      }
      if (was) persist(api.getPage());
      return was;
    },
  };
  return api;
})();
