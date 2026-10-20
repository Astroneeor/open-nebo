#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use nebo_core::model::OpaqueEntry;
use nebo_core::{vault, Document};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{Emitter, State};

#[derive(Default)]
struct AppState {
    watcher: Mutex<Option<RecommendedWatcher>>,
    /// Archive members we don't interpret, kept per open file so saves don't drop them.
    opaque: Mutex<HashMap<PathBuf, Vec<OpaqueEntry>>>,
}

#[derive(Serialize)]
struct Opened {
    doc: Document,
    rev: String,
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

#[tauri::command]
fn new_doc(dir: String, title: String) -> Res<Opened> {
    let safe: String = title
        .chars()
        .map(|c| if c.is_alphanumeric() || c == ' ' || c == '-' || c == '_' { c } else { '_' })
        .collect();
    let safe = safe.trim();
    if safe.is_empty() || safe.starts_with('.') {
        return Err("invalid title".into());
    }
    let path = Path::new(&dir).join(format!("{safe}.{}", vault::EXT));
    let doc = Document::new(title);
    let rev = vault::save(&path, &doc, None).map_err(err)?;
    Ok(Opened { doc, rev })
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
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            default_vault, list_vault, open_doc, save_doc, new_doc, write_stignore, watch_vault
        ])
        .run(tauri::generate_context!())
        .expect("error while running Open Nebo");
}
