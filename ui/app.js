"use strict";
const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const dialog = window.__TAURI__.dialog;

const $ = (id) => document.getElementById(id);
const cv = $("cv"), ctx = cv.getContext("2d");

const S = { vault: null, entries: [], path: null, doc: null, rev: null, page: 0,
            dirty: false, tool: "pen", current: null, saveTimer: null, saving: false };

const status = (t) => { $("status").textContent = t; };
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));

function banner(msg) { $("banner").hidden = !msg; $("banner").textContent = msg || ""; }

// ---------- vault list ----------
async function refreshList() {
  S.entries = await invoke("list_vault", { dir: S.vault });
  const ul = $("list"); ul.replaceChildren();
  for (const e of S.entries) {
    const li = document.createElement("li");
    li.textContent = e.name.replace(/\.nebo$/i, "");
    if (e.is_conflict) li.classList.add("conflict");
    if (e.path === S.path) li.classList.add("sel");
    li.onclick = () => openPath(e.path);
    ul.append(li);
  }
}

async function setVault(dir) {
  S.vault = dir; $("vaultPath").textContent = dir;
  await invoke("watch_vault", { dir });
  await refreshList();
}

// ---------- document ----------
async function openPath(path) {
  if (S.dirty) await saveNow();
  try {
    const { doc, rev } = await invoke("open_doc", { path });
    Object.assign(S, { path, doc, rev, page: 0, dirty: false });
    banner(null); status(""); render(); refreshList();
  } catch (e) { banner("Cannot open: " + e); }
}

function page() { return S.doc.pages[S.page]; }

function fit() {
  const p = page();
  cv.width = p.width; cv.height = p.height;
  const scale = Math.min(1, ($("stage").clientWidth - 32) / p.width);
  cv.style.width = p.width * scale + "px"; cv.style.height = p.height * scale + "px";
}

function drawStroke(s) {
  if (!s.points.length) return;
  ctx.strokeStyle = s.color; ctx.lineCap = "round"; ctx.lineJoin = "round";
  const pts = s.points;
  if (pts.length === 1) { ctx.fillStyle = s.color; ctx.beginPath(); ctx.arc(pts[0].x, pts[0].y, s.width / 2, 0, 7); ctx.fill(); return; }
  for (let i = 1; i < pts.length; i++) {
    ctx.lineWidth = s.width * (0.4 + 1.2 * ((pts[i].p + pts[i - 1].p) / 2));
    ctx.beginPath(); ctx.moveTo(pts[i - 1].x, pts[i - 1].y); ctx.lineTo(pts[i].x, pts[i].y); ctx.stroke();
  }
}

function render() {
  if (!S.doc) { ctx.clearRect(0, 0, cv.width, cv.height); return; }
  fit();
  ctx.clearRect(0, 0, cv.width, cv.height);
  page().strokes.forEach(drawStroke);
  if (S.current) drawStroke(S.current);
  $("pageNo").textContent = `${S.page + 1} / ${S.doc.pages.length}`;
}

// ---------- saving (debounced, revision-checked) ----------
function touch() { S.dirty = true; status("Unsaved…"); clearTimeout(S.saveTimer); S.saveTimer = setTimeout(saveNow, 800); }

async function saveNow() {
  clearTimeout(S.saveTimer);
  if (!S.dirty || !S.doc || S.saving) return;
  S.saving = true;
  try {
    S.rev = await invoke("save_doc", { path: S.path, doc: S.doc, rev: S.rev });
    S.dirty = false; status("Saved");
  } catch (e) {
    banner(String(e) + " — your edits are kept on screen. Reload the synced version or save as a copy.");
    S.conflict = true;
  } finally { S.saving = false; }
}

// ---------- input ----------
function pos(ev) {
  const r = cv.getBoundingClientRect();
  return { x: (ev.clientX - r.left) * cv.width / r.width, y: (ev.clientY - r.top) * cv.height / r.height };
}

function eraseAt(p) {
  const r = 14, strokes = page().strokes;
  const keep = strokes.filter((s) => !s.points.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < r + s.width));
  if (keep.length !== strokes.length) { page().strokes = keep; touch(); render(); }
}

cv.addEventListener("pointerdown", (ev) => {
  if (!S.doc || S.conflict) return;
  cv.setPointerCapture(ev.pointerId);
  const p = pos(ev);
  if (S.tool === "eraser") { S.erasing = true; eraseAt(p); return; }
  S.t0 = performance.now();
  S.current = { id: uid(), color: $("color").value, width: +$("width").value,
                points: [{ ...p, t: 0, p: ev.pressure || 0.5 }] };
  render();
});
cv.addEventListener("pointermove", (ev) => {
  const evs = ev.getCoalescedEvents ? ev.getCoalescedEvents() : [ev];
  if (S.erasing) { evs.forEach((e) => eraseAt(pos(e))); return; }
  if (!S.current) return;
  for (const e of evs) S.current.points.push({ ...pos(e), t: Math.round(performance.now() - S.t0), p: e.pressure || 0.5 });
  render();
});
const end = () => {
  S.erasing = false;
  if (S.current) { page().strokes.push(S.current); S.current = null; touch(); render(); }
};
cv.addEventListener("pointerup", end); cv.addEventListener("pointercancel", end);

// ---------- toolbar ----------
function tool(t) { S.tool = t; $("pen").classList.toggle("on", t === "pen"); $("eraser").classList.toggle("on", t === "eraser"); }
$("pen").onclick = () => tool("pen"); $("eraser").onclick = () => tool("eraser");
$("undo").onclick = () => { if (S.doc && page().strokes.pop()) { touch(); render(); } };
$("prev").onclick = () => { if (S.doc && S.page > 0) { S.page--; render(); } };
$("next").onclick = () => { if (S.doc && S.page < S.doc.pages.length - 1) { S.page++; render(); } };
$("addPage").onclick = () => {
  if (!S.doc) return;
  const base = page();
  S.doc.pages.push({ id: `page-${uid()}`, width: base.width, height: base.height, strokes: [] });
  S.page = S.doc.pages.length - 1; touch(); render();
};
$("newBtn").onclick = () => { $("newForm").hidden = false; $("newName").value = ""; $("newName").focus(); };
$("newForm").onsubmit = async (ev) => {
  ev.preventDefault();
  const title = $("newName").value.trim();
  $("newForm").hidden = true;
  if (!title) return;
  try {
    await invoke("new_doc", { dir: S.vault, title });
    await refreshList();
    const e = S.entries.find((x) => x.name === title.replace(/[^\p{L}\p{N} _-]/gu, "_") + ".nebo");
    if (e) openPath(e.path);
  } catch (e) { banner("Cannot create: " + e); }
};
$("pickVault").onclick = async () => {
  const d = await dialog.open({ directory: true });
  if (d) setVault(d);
};
$("stignore").onclick = async () => {
  try { await invoke("write_stignore", { dir: S.vault }); status("Wrote .stignore"); } catch (e) { banner(String(e)); }
};
window.addEventListener("resize", render);
window.addEventListener("beforeunload", () => { if (S.dirty) saveNow(); });

// ---------- Syncthing-driven changes ----------
let watchTimer;
listen("vault-changed", () => {
  clearTimeout(watchTimer);
  // Wait for Syncthing to finish renaming the file into place before reading.
  watchTimer = setTimeout(async () => {
    await refreshList();
    if (!S.path || S.saving) return;
    if (S.dirty || S.conflict) return; // local edits win until the user decides
    try {
      const { doc, rev } = await invoke("open_doc", { path: S.path });
      if (rev !== S.rev) {
        Object.assign(S, { doc, rev, page: Math.min(S.page, doc.pages.length - 1) });
        status("Updated from sync"); render();
      }
    } catch (_) { /* file may be mid-replace; the next event retries */ }
  }, 600);
});

(async () => {
  try { await setVault(await invoke("default_vault")); } catch (e) { banner(String(e)); }
  render();
})();
