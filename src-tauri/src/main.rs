#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use nebo_core::model::OpaqueEntry;
use nebo_core::pdf::PdfPage;
use nebo_core::{library, package, vault, Document};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{Emitter, State};

#[derive(Default)]
struct AppState {
    watcher: Mutex<Option<RecommendedWatcher>>,
    /// Archive members we don't interpret, kept per open file so saves don't drop them.
    opaque: Mutex<HashMap<PathBuf, Vec<OpaqueEntry>>>,
    /// Notebook currently receiving imported page images (see `begin_pdf_import`).
    import_path: Mutex<Option<PathBuf>>,
    /// Page images collected for a PDF export (see `export_pdf_*`).
    export_pages: Mutex<Vec<PdfPage>>,
    /// The notebook folder chosen in the UI; every library command is confined to it.
    root: Mutex<Option<PathBuf>>,
}

#[derive(Serialize)]
struct Opened {
    doc: Document,
    rev: String,
}

#[derive(Serialize)]
struct ImportStarted {
    path: String,
    doc: Document,
}

type Res<T> = Result<T, String>;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

#[tauri::command]
fn default_vault() -> Res<String> {
    let dir = dirs::document_dir().or_else(dirs::home_dir).ok_or("no home directory")?.join("Nebo");
    std::fs::create_dir_all(&dir).map_err(err)?;
    Ok(dir.display().to_string())
}

#[tauri::command]
fn list_vault(dir: String) -> Res<Vec<vault::Entry>> {
    vault::list(Path::new(&dir)).map_err(err)
}

#[tauri::command]
fn open_doc(path: String, state: State<AppState>) -> Res<Opened> {
    let (mut doc, rev) = vault::load(Path::new(&path)).map_err(err)?;
    state.opaque.lock().unwrap().insert(path.into(), std::mem::take(&mut doc.opaque));
    Ok(Opened { doc, rev })
}

/// `rev` is `None` for a new file. Returns the new revision.
#[tauri::command]
fn save_doc(path: String, mut doc: Document, rev: Option<String>, state: State<AppState>) -> Res<String> {
    let p = PathBuf::from(&path);
    if let Some(o) = state.opaque.lock().unwrap().get(&p) {
        doc.opaque = o.clone();
    }
    vault::save(&p, &doc, rev.as_deref()).map_err(err)
}

fn safe_title(title: &str) -> Res<String> {
    let safe: String = title
        .chars()
        .map(|c| if c.is_alphanumeric() || c == ' ' || c == '-' || c == '_' { c } else { '_' })
        .collect();
    let safe = safe.trim().to_string();
    if safe.is_empty() || safe.starts_with('.') {
        return Err("invalid title".into());
    }
    Ok(safe)
}

#[tauri::command]
fn new_doc(dir: String, title: String) -> Res<Opened> {
    let safe = safe_title(&title)?;
    let path = Path::new(&dir).join(format!("{safe}.{}", vault::EXT));
    let doc = Document::new(title);
    let rev = vault::save(&path, &doc, None).map_err(err)?;
    Ok(Opened { doc, rev })
}

/// Webviews that can't use the binary IPC channel deliver the bytes as a JSON number array.
fn raw_body(req: &Request<'_>) -> Res<Vec<u8>> {
    match req.body() {
        InvokeBody::Raw(b) => Ok(b.clone()),
        InvokeBody::Json(serde_json::Value::Array(a)) => a
            .iter()
            .map(|v| v.as_u64().and_then(|n| u8::try_from(n).ok()).ok_or_else(|| "bad byte in body".to_string()))
            .collect(),
        _ => Err("expected a binary body".into()),
    }
}

fn header_num<T: std::str::FromStr>(req: &Request<'_>, name: &str) -> Res<T> {
    req.headers()
        .get(name)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse().ok())
        .ok_or_else(|| format!("missing header {name}"))
}

/// Reads a user-chosen PDF so the UI can render it. Raw bytes, not a JSON array.
#[tauri::command]
fn read_pdf(path: String) -> Res<Response> {
    let p = Path::new(&path);
    if !p.extension().is_some_and(|x| x.eq_ignore_ascii_case("pdf")) {
        return Err("not a .pdf file".into());
    }
    Ok(Response::new(std::fs::read(p).map_err(err)?))
}

/// Starts a notebook for an imported PDF: one page per entry of `sizes`, each with
/// `media/page-N.png` as background. Not saved yet; the UI stages the images with
/// `put_media` and then saves with `save_doc` and no revision.
#[tauri::command]
fn begin_pdf_import(dir: String, title: String, sizes: Vec<(f32, f32)>, state: State<AppState>) -> Res<ImportStarted> {
    if sizes.is_empty() || sizes.len() > 2000 {
        return Err("PDF has no pages (or too many)".into());
    }
    let safe = safe_title(&title)?;
    let mut path = Path::new(&dir).join(format!("{safe}.{}", vault::EXT));
    let mut n = 2;
    while path.exists() {
        path = Path::new(&dir).join(format!("{safe} {n}.{}", vault::EXT));
        n += 1;
    }
    let mut doc = Document::new(title);
    doc.pages.clear();
    for (i, (w, h)) in sizes.iter().enumerate() {
        let mut pg = nebo_core::Page::new(format!("page-{}", i + 1));
        pg.width = *w;
        pg.height = *h;
        pg.background = Some(format!("media/page-{}.png", i + 1));
        doc.pages.push(pg);
    }
    state.opaque.lock().unwrap().insert(path.clone(), Vec::new());
    *state.import_path.lock().unwrap() = Some(path.clone());
    Ok(ImportStarted { path: path.display().to_string(), doc })
}

/// Raw body = image bytes; header `name` = archive path under `media/`.
#[tauri::command]
fn put_media(request: Request<'_>, state: State<AppState>) -> Res<()> {
    let name = request
        .headers()
        .get("name")
        .and_then(|v| v.to_str().ok())
        .ok_or("missing header name")?
        .to_string();
    package::safe_media(&name).map_err(err)?;
    let data = raw_body(&request)?;
    let path = state.import_path.lock().unwrap().clone().ok_or("no import in progress")?;
    let mut map = state.opaque.lock().unwrap();
    let entries = map.get_mut(&path).ok_or("no import in progress")?;
    entries.retain(|e| e.name != name);
    entries.push(OpaqueEntry { name, data });
    Ok(())
}

#[tauri::command]
fn read_media(path: String, name: String, state: State<AppState>) -> Res<Response> {
    package::safe_media(&name).map_err(err)?;
    let map = state.opaque.lock().unwrap();
    let e = map
        .get(&PathBuf::from(&path))
        .and_then(|v| v.iter().find(|e| e.name == name))
        .ok_or("media not found")?;
    Ok(Response::new(e.data.clone()))
}

#[tauri::command]
fn export_pdf_begin(state: State<AppState>) {
    state.export_pages.lock().unwrap().clear();
}

/// Raw body = JPEG of one composited page; headers `width`, `height` in pixels.
#[tauri::command]
fn export_pdf_page(request: Request<'_>, state: State<AppState>) -> Res<()> {
    let page = PdfPage {
        width_px: header_num(&request, "width")?,
        height_px: header_num(&request, "height")?,
        jpeg: raw_body(&request)?,
    };
    state.export_pages.lock().unwrap().push(page);
    Ok(())
}

#[tauri::command]
fn export_pdf_finish(path: String, state: State<AppState>) -> Res<()> {
    let p = PathBuf::from(&path);
    if !p.extension().is_some_and(|x| x.eq_ignore_ascii_case("pdf")) {
        return Err("export path must end in .pdf".into());
    }
    let pages = std::mem::take(&mut *state.export_pages.lock().unwrap());
    let bytes = nebo_core::pdf::build(&pages).map_err(err)?;
    vault::write_atomic(&p, &bytes).map_err(err)
}

// ---------- library (home screen) ----------

fn root_of(state: &State<AppState>) -> Res<PathBuf> {
    state.root.lock().unwrap().clone().ok_or_else(|| "no notebook folder selected".to_string())
}

/// Forget in-memory state for a path that was renamed, moved or trashed.
fn forget(state: &State<AppState>, path: &str) {
    state.opaque.lock().unwrap().remove(&PathBuf::from(path));
}

fn path_str(p: PathBuf) -> String {
    p.display().to_string()
}

#[tauri::command]
fn library_tree(state: State<AppState>) -> Res<library::FolderNode> {
    library::folder_tree(&root_of(&state)?).map_err(err)
}

#[tauri::command]
fn library_list(dir: String, state: State<AppState>) -> Res<library::Listing> {
    library::list_dir(&root_of(&state)?, Path::new(&dir)).map_err(err)
}

#[tauri::command]
fn library_new_folder(parent: String, name: String, state: State<AppState>) -> Res<String> {
    library::create_folder(&root_of(&state)?, Path::new(&parent), &name).map(path_str).map_err(err)
}

/// Creates an empty notebook (or, with `canvas`, a single infinite board). Returns its path.
#[tauri::command]
fn library_new_notebook(dir: String, title: String, canvas: bool, state: State<AppState>) -> Res<String> {
    library::create_notebook(&root_of(&state)?, Path::new(&dir), &title, canvas).map(path_str).map_err(err)
}

#[tauri::command]
fn library_rename(path: String, name: String, state: State<AppState>) -> Res<String> {
    let new = library::rename(&root_of(&state)?, Path::new(&path), &name).map_err(err)?;
    forget(&state, &path);
    Ok(path_str(new))
}

#[tauri::command]
fn library_move(path: String, dest: String, state: State<AppState>) -> Res<String> {
    let new = library::move_to(&root_of(&state)?, Path::new(&path), Path::new(&dest)).map_err(err)?;
    forget(&state, &path);
    Ok(path_str(new))
}

#[tauri::command]
fn library_duplicate(path: String, state: State<AppState>) -> Res<String> {
    library::duplicate(&root_of(&state)?, Path::new(&path)).map(path_str).map_err(err)
}

/// Moves to `<folder>/.trash`; nothing is deleted.
#[tauri::command]
fn library_trash(path: String, state: State<AppState>) -> Res<String> {
    let new = library::trash(&root_of(&state)?, Path::new(&path)).map_err(err)?;
    forget(&state, &path);
    Ok(path_str(new))
}

#[derive(Serialize)]
struct Preview {
    /// Only the first page is sent; the card thumbnail is drawn from it.
    doc: Document,
    pages: usize,
}

/// Loads a notebook for its card thumbnail without registering it as open.
#[tauri::command]
fn preview_doc(path: String, state: State<AppState>) -> Res<Preview> {
    let p = library::resolve(&root_of(&state)?, Path::new(&path)).map_err(err)?;
    let (mut doc, _) = vault::load(&p).map_err(err)?;
    let pages = doc.pages.len();
    doc.pages.truncate(1);
    doc.opaque.clear();
    Ok(Preview { doc, pages })
}

/// Raw bytes of one media member (e.g. the page-1 PDF background) for a thumbnail.
#[tauri::command]
fn preview_media(path: String, name: String, state: State<AppState>) -> Res<Response> {
    package::safe_media(&name).map_err(err)?;
    let p = library::resolve(&root_of(&state)?, Path::new(&path)).map_err(err)?;
    let (doc, _) = vault::load(&p).map_err(err)?;
    let e = doc.opaque.into_iter().find(|e| e.name == name).ok_or("media not found")?;
    Ok(Response::new(e.data))
}

#[tauri::command]
fn write_stignore(dir: String) -> Res<()> {
    let p = Path::new(&dir).join(".stignore");
    if p.exists() {
        return Ok(());
    }
    std::fs::write(p, vault::STIGNORE).map_err(err)
}

#[tauri::command]
fn watch_vault(dir: String, app: tauri::AppHandle, state: State<AppState>) -> Res<()> {
    let mut w = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(ev) = res {
            // Our own and Syncthing's temp files are noise; the UI debounces the rest.
            let relevant = ev.paths.iter().any(|p| {
                p.file_name().is_some_and(|n| {
                    let n = n.to_string_lossy();
                    !n.starts_with('.') && n.ends_with(".nebo") || n.contains(".sync-conflict-")
                })
            });
            if relevant {
                let _ = app.emit("vault-changed", ev.paths.iter().map(|p| p.display().to_string()).collect::<Vec<_>>());
            }
        }
    })
    .map_err(err)?;
    w.watch(Path::new(&dir), RecursiveMode::Recursive).map_err(err)?;
    *state.watcher.lock().unwrap() = Some(w);
    *state.root.lock().unwrap() = Some(PathBuf::from(&dir));
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            default_vault, list_vault, open_doc, save_doc, new_doc, write_stignore, watch_vault,
            read_pdf, begin_pdf_import, put_media, read_media, export_pdf_begin, export_pdf_page, export_pdf_finish,
            library_tree, library_list, library_new_folder, library_new_notebook, library_rename, library_move,
            library_duplicate, library_trash, preview_doc, preview_media
        ])
        .run(tauri::generate_context!())
        .expect("error while running Open Nebo");
}
