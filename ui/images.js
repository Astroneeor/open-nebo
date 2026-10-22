"use strict";
// Pasted / dropped images as page objects ({type:"image", x, y, w, h, mime, data}). Drawing, paste and drop live
// here; selecting, moving, resizing and deleting them is selection.js's job, and undo/redo is history.js's.
// Loaded before app.js; uses its globals (S, page, pos, render, touch, status, uid, cv, $, V) lazily.
// Image x/y/w/h live in world coordinates, the same space as stroke points.
const Images = (() => {
  const TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
  const MAX_BYTES = 25 * 1024 * 1024, MIN_SIZE = 20;
  const cache = new Map(); // object id -> { data, img }

  const imgs = (pg) => (pg.objects || []).filter((o) => o.type === "image");
  const src = (o) => `data:${o.mime};base64,${o.data}`;

  function bitmap(o) {
    let c = cache.get(o.id);
    if (!c || c.data !== o.data) {
      c = { data: o.data, img: new Image() };
      c.img.onload = () => render();
      c.img.src = src(o);
      cache.set(o.id, c);
    }
    return c.img;
  }

  function draw(g, pg) {
    for (const o of imgs(pg)) {
      const im = bitmap(o);
      if (im.complete && im.naturalWidth) g.drawImage(im, o.x, o.y, o.w, o.h);
    }
  }

  function setTool(t) {
    S.tool = t;
    $("pen").classList.toggle("on", t === "pen");
    $("eraser").classList.toggle("on", t === "eraser");
    $("selectTool").classList.toggle("on", t === "select");
    cv.style.cursor = t === "select" ? "default" : "crosshair";
    render();
  }

  const readDataUrl = (blob) => new Promise((res, rej) => {
    const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob);
  });
  const natural = (url) => new Promise((res, rej) => {
    const i = new Image(); i.onload = () => res([i.naturalWidth, i.naturalHeight]); i.onerror = () => rej(new Error("not a readable image")); i.src = url;
  });

  // `at` is a world point, or omitted to use the middle of the visible area.
  async function addBlob(blob, at) {
    if (!S.doc || S.conflict) return;
    if (!TYPES.includes(blob.type)) { status(`Unsupported image type ${blob.type || "(unknown)"}`); return; }
    if (blob.size > MAX_BYTES) { status("Image is larger than 25 MB"); return; }
    try {
      const url = await readDataUrl(blob);
      const [nw, nh] = await natural(url);
      const pg = page();
      const vw = cv.clientWidth / V.zoom, vh = cv.clientHeight / V.zoom; // visible world size
      const f = Math.min(1, (vw * 0.5) / nw, (vh * 0.5) / nh);
      const w = Math.max(MIN_SIZE, nw * f), h = Math.max(MIN_SIZE, nh * f);
      const c = at || visibleCenter();
      const o = { type: "image", id: uid().replace(/[^A-Za-z0-9_-]/g, ""), mime: blob.type,
                  data: url.slice(url.indexOf(",") + 1),
                  x: c.x - w / 2, y: c.y - h / 2, w, h };
      History.record(pg, "add image", () => { (pg.objects = pg.objects || []).push(o); });
      setTool("select"); Selection.select([{ kind: "image", id: o.id }]); touch();
    } catch (e) { status("Cannot add image: " + e.message); }
  }

  function visibleCenter() {
    return { x: V.x + cv.clientWidth / 2 / V.zoom, y: V.y + cv.clientHeight / 2 / V.zoom };
  }

  document.addEventListener("paste", (ev) => {
    if (/^(INPUT|TEXTAREA)$/.test((ev.target || {}).tagName || "")) return;
    const f = [...(ev.clipboardData ? ev.clipboardData.items : [])].find((i) => i.kind === "file" && i.type.startsWith("image/"));
    const blob = f && f.getAsFile();
    if (blob) { ev.preventDefault(); addBlob(blob); }
  });

  const stage = () => $("stage");
  document.addEventListener("DOMContentLoaded", () => {
    const b = document.createElement("button");
    b.id = "selectTool"; b.textContent = "Select"; b.title = "Select, move, resize and edit anything (lasso, click, Shift-click)";
    $("eraser").after(b);
    b.onclick = () => setTool("select");
    $("pen").addEventListener("click", () => setTool("pen"));
    $("eraser").addEventListener("click", () => setTool("eraser"));

    stage().addEventListener("dragover", (ev) => { if ([...ev.dataTransfer.types].includes("Files")) ev.preventDefault(); });
    stage().addEventListener("drop", (ev) => {
      const files = [...ev.dataTransfer.files].filter((f) => f.type.startsWith("image/"));
      if (!files.length) return;
      ev.preventDefault();
      const at = pos(ev);
      files.forEach((f, i) => addBlob(f, { x: at.x + i * 24, y: at.y + i * 24 }));
    });
  });

  return { draw, setTool };
})();
