"use strict";
// Colour picker popover: HSB wheel (hue around, saturation outward), brightness + opacity
// sliders, hex field, recents and palettes. Writes the chosen colour to the hidden #color input
// as "#rrggbb" or "#rrggbbaa" so app.js keeps reading $("color").value unchanged.

const ColorMath = (() => {
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const h2 = (n) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, "0");

  // h in degrees [0,360), s and v in [0,1] -> r,g,b in [0,255]
  function hsbToRgb(h, s, v) {
    h = ((h % 360) + 360) % 360; s = clamp(s, 0, 1); v = clamp(v, 0, 1);
    const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
    const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
                    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
  }

  function rgbToHsb(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d) {
      h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h = (h * 60 + 360) % 360;
    }
    return [h, max ? d / max : 0, max];
  }

  // a in [0,1]; alpha is only written when below 1.
  const toHex = (r, g, b, a = 1) => "#" + h2(r) + h2(g) + h2(b) + (a < 1 ? h2(a * 255) : "");

  // Accepts #rgb, #rgba, #rrggbb, #rrggbbaa (leading # optional). Returns {r,g,b,a} or null.
  function parseHex(str) {
    let s = String(str).trim().replace(/^#/, "");
    if (!/^[0-9a-fA-F]+$/.test(s)) return null;
    if (s.length === 3 || s.length === 4) s = [...s].map((c) => c + c).join("");
    if (s.length !== 6 && s.length !== 8) return null;
    const n = (i) => parseInt(s.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: s.length === 8 ? Math.round((n(6) / 255) * 1000) / 1000 : 1 };
  }

  return { clamp, hsbToRgb, rgbToHsb, toHex, parseHex };
})();

const BUILTIN_PALETTES = [
  { name: "Basics", colors: ["#000000", "#4d4d4d", "#8c8c8c", "#cccccc", "#ffffff", "#e03131", "#f08c00", "#fcc419", "#2f9e44", "#1c7ed6", "#6741d9", "#d6336c"] },
  { name: "Pastel", colors: ["#ffc9c9", "#ffd8a8", "#fff3bf", "#d8f5a2", "#b2f2bb", "#99e9f2", "#a5d8ff", "#bac8ff", "#d0bfff", "#fcc2d7", "#e9ecef", "#dee2e6"] },
  { name: "Ink", colors: ["#0b0b0f", "#1e2a5a", "#0b5345", "#7b241c", "#4a235a", "#6e2c00", "#145a32", "#1b4f72", "#515a5a", "#7d6608", "#78281f", "#212f3d"] },
  { name: "Highlight", colors: ["#ffee0080", "#7cfc0080", "#00e5ff80", "#ff69b480", "#ffa50080", "#b388ff80"] },
];

if (typeof module !== "undefined") module.exports = { ColorMath, BUILTIN_PALETTES };

const ColorPicker = (() => {
  if (typeof document === "undefined") return null;
  const KEY_RECENT = "nebo.colors.recent", KEY_SAVED = "nebo.colors.saved";
  const MAX_RECENT = 12;
  const { hsbToRgb, rgbToHsb, toHex, parseHex } = ColorMath;

  const load = (k) => { try { const v = JSON.parse(localStorage.getItem(k)); return Array.isArray(v) ? v : []; } catch (_) { return []; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* storage blocked: session only */ } };

  const st = { h: 0, s: 0, v: 0, a: 1, recent: load(KEY_RECENT), saved: load(KEY_SAVED) };
  let input, swatch, pop, wheel, wctx, brightness, opacity, hex, preview, recentEl, palettesEl, savedEl;
  const SIZE = 180;

  const rgb = () => hsbToRgb(st.h, st.s, st.v);
  const current = () => toHex(...rgb(), st.a);
  const css = (c) => { const p = parseHex(c); return p ? `rgba(${p.r},${p.g},${p.b},${p.a})` : c; };

  function setFromHex(str, push = true) {
    const p = parseHex(str);
    if (!p) return false;
    [st.h, st.s, st.v] = rgbToHsb(p.r, p.g, p.b);
    st.a = p.a;
    if (push) apply(); else sync();
    return true;
  }

  function drawWheel() {
    const img = wctx.createImageData(SIZE, SIZE), R = SIZE / 2;
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
      const dx = x + 0.5 - R, dy = y + 0.5 - R, d = Math.hypot(dx, dy), i = (y * SIZE + x) * 4;
      if (d > R) continue;
      // Drawn dimmed by brightness but never black, so the colours stay visible while a dark colour is selected.
      const [r, g, b] = hsbToRgb((Math.atan2(dy, dx) * 180) / Math.PI, d / R, 0.5 + 0.5 * st.v);
      img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b;
      img.data[i + 3] = d > R - 1 ? Math.round((R - d) * 255) : 255; // soft edge
    }
    wctx.putImageData(img, 0, 0);
    // marker
    const ang = (st.h * Math.PI) / 180, mx = R + Math.cos(ang) * st.s * R, my = R + Math.sin(ang) * st.s * R;
    wctx.lineWidth = 2; wctx.strokeStyle = "#fff"; wctx.beginPath(); wctx.arc(mx, my, 7, 0, 7); wctx.stroke();
    wctx.lineWidth = 1; wctx.strokeStyle = "#000"; wctx.beginPath(); wctx.arc(mx, my, 8, 0, 7); wctx.stroke();
  }

  function sync() {
    const [r, g, b] = rgb(), full = toHex(r, g, b);
    brightness.value = Math.round(st.v * 100);
    brightness.style.background = `linear-gradient(90deg,#000,${toHex(...hsbToRgb(st.h, st.s, 1))})`;
    opacity.value = Math.round(st.a * 100);
    opacity.style.background = `linear-gradient(90deg,transparent,${full}), repeating-conic-gradient(#ccc 0 25%,#fff 0 50%) 0 0/10px 10px`;
    if (document.activeElement !== hex) hex.value = current();
    preview.style.background = css(current());
    swatch.style.setProperty("--c", css(current()));
    drawWheel();
  }

  function apply() {
    input.value = current();
    input.dispatchEvent(new Event("input", { bubbles: true }));
    sync();
  }

  function remember() {
    const c = current();
    st.recent = [c, ...st.recent.filter((x) => x !== c)].slice(0, MAX_RECENT);
    save(KEY_RECENT, st.recent); renderLists();
  }

  function chip(c, onPick, onRemove) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "chip"; b.title = c;
    b.style.setProperty("--c", css(c));
    b.onclick = () => onPick(c);
    if (onRemove) b.oncontextmenu = (ev) => { ev.preventDefault(); onRemove(c); };
    return b;
  }

  function renderLists() {
    recentEl.replaceChildren(...st.recent.map((c) => chip(c, (x) => { setFromHex(x); })));
    savedEl.replaceChildren(...st.saved.map((c) => chip(c, (x) => { setFromHex(x); remember(); }, (x) => {
      st.saved = st.saved.filter((y) => y !== x); save(KEY_SAVED, st.saved); renderLists();
    })));
    savedEl.parentElement.hidden = false;
  }

  function wheelPick(ev) {
    const r = wheel.getBoundingClientRect(), R = SIZE / 2;
    const dx = ((ev.clientX - r.left) / r.width) * SIZE - R, dy = ((ev.clientY - r.top) / r.height) * SIZE - R;
    st.h = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
    st.s = Math.min(1, Math.hypot(dx, dy) / R);
    apply();
  }

  function el(tag, cls, parent, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    if (parent) parent.append(e);
    return e;
  }

  function build() {
    pop = el("div", "cp-pop", document.body); pop.hidden = true;
    wheel = el("canvas", "cp-wheel", pop); wheel.width = SIZE; wheel.height = SIZE;
    wctx = wheel.getContext("2d");
    let down = false;
    wheel.addEventListener("pointerdown", (ev) => { down = true; wheel.setPointerCapture(ev.pointerId); wheelPick(ev); });
    wheel.addEventListener("pointermove", (ev) => { if (down) wheelPick(ev); });
    const up = () => { if (down) { down = false; remember(); } };
    wheel.addEventListener("pointerup", up); wheel.addEventListener("pointercancel", up);

    const mk = (label, cls) => {
      const row = el("label", "cp-row", pop); el("span", null, row, label);
      const r = el("input", "cp-slider " + cls, row); r.type = "range"; r.min = 0; r.max = 100;
      r.addEventListener("change", remember);
      return r;
    };
    brightness = mk("Brightness", "bri"); brightness.oninput = () => { st.v = brightness.value / 100; apply(); };
    opacity = mk("Opacity", "opa"); opacity.oninput = () => { st.a = opacity.value / 100; apply(); };

    const hr = el("div", "cp-row", pop);
    preview = el("span", "cp-preview", hr);
    hex = el("input", "cp-hex", hr); hex.spellcheck = false; hex.maxLength = 9; hex.placeholder = "#rrggbb";
    hex.addEventListener("input", () => { if (setFromHex(hex.value)) hex.classList.remove("bad"); else hex.classList.add("bad"); });
    hex.addEventListener("blur", () => { hex.classList.remove("bad"); hex.value = current(); remember(); });
    const add = el("button", null, hr, "Save"); add.type = "button"; add.title = "Add this colour to My colours";
    add.onclick = () => {
      const c = current();
      if (!st.saved.includes(c)) { st.saved.push(c); save(KEY_SAVED, st.saved); renderLists(); }
    };

    el("div", "cp-h", pop, "Recent"); recentEl = el("div", "cp-chips", pop);
    const sv = el("div", null, pop); const h = el("div", "cp-h", sv, "My colours"); h.title = "Right-click a saved colour to remove it"; savedEl = el("div", "cp-chips", sv);
    palettesEl = el("div", null, pop);
    for (const p of BUILTIN_PALETTES) {
      el("div", "cp-h", palettesEl, p.name);
      const row = el("div", "cp-chips", palettesEl);
      p.colors.forEach((c) => row.append(chip(c, (x) => { setFromHex(x); remember(); })));
    }
  }

  function place() {
    if (window.Chrome) return Chrome.placePopover(pop, swatch);
    const r = swatch.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(r.left, innerWidth - pop.offsetWidth - 8)) + "px";
    pop.style.top = Math.min(r.bottom + 6, Math.max(8, innerHeight - pop.offsetHeight - 8)) + "px";
  }

  function open() { pop.hidden = false; swatch.setAttribute("aria-expanded", "true"); sync(); place(); }
  function close() { if (pop.hidden) return; pop.hidden = true; swatch.setAttribute("aria-expanded", "false"); remember(); }

  function init(hiddenInput, swatchBtn) {
    input = hiddenInput; swatch = swatchBtn;
    build();
    setFromHex(input.value || "#000000", false);
    renderLists();
    swatch.addEventListener("click", () => (pop.hidden ? open() : close()));
    document.addEventListener("pointerdown", (ev) => { if (!pop.hidden && !pop.contains(ev.target) && !swatch.contains(ev.target)) close(); }, true);
    window.addEventListener("keydown", (ev) => { if (ev.key === "Escape") close(); });
    window.addEventListener("resize", () => { if (!pop.hidden) place(); });
  }

  return { init, set: (c) => setFromHex(c), get value() { return current(); } };
})();

if (ColorPicker && document.getElementById("color") && document.getElementById("colorBtn")) {
  ColorPicker.init(document.getElementById("color"), document.getElementById("colorBtn"));
}
