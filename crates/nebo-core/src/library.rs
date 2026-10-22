//! Library operations for the home screen: folders, rename, move, duplicate, trash.
//!
//! Every operation takes the vault `root` and refuses to touch anything outside
//! it: no `..`, no absolute paths elsewhere, no symlinks leading out, and no
//! hidden components such as `.stfolder` or `.trash`. No lock files are created;
//! moves and renames are plain `rename(2)` calls, which Syncthing sees as
//! ordinary file events, and new files are written atomically.

use std::fs;
use std::path::{Component, Path, PathBuf};

use serde::Serialize;

use crate::vault::{is_conflict_name, is_notebook_name, save, write_atomic, Entry, EXT};
use crate::{Document, Error};

pub const TRASH_DIR: &str = ".trash";

fn bad(msg: impl Into<String>) -> Error {
    Error::Invalid(msg.into())
}

fn modified_secs(md: &fs::Metadata) -> u64 {
    md.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_secs())
}

/// Turns a user-typed name into a single safe path component (letters, digits,
/// space, `-`, `_`, `(`, `)`; everything else becomes `_`). Never empty and never
/// starts with a dot.
pub fn sanitize_name(name: &str) -> Result<String, Error> {
    let s: String = name
        .chars()
        .map(|c| if c.is_alphanumeric() || matches!(c, ' ' | '-' | '_' | '(' | ')') { c } else { '_' })
        .collect();
    let s: String = s.trim().chars().take(120).collect();
    let s = s.trim().to_string();
    if s.is_empty() || s.starts_with('.') {
        return Err(bad("invalid name"));
    }
    Ok(s)
}

fn clean(p: &Path) -> Result<PathBuf, Error> {
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            Component::ParentDir => return Err(bad("path escapes the notebook folder")),
            Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    Ok(out)
}

/// Resolves `p` (absolute, or relative to `root`) and checks that it lies inside
/// `root`. `root` itself is allowed; hidden components below it are not.
pub fn resolve(root: &Path, p: &Path) -> Result<PathBuf, Error> {
    let root_c = clean(root)?;
    let full = clean(&if p.is_absolute() { p.to_path_buf() } else { root_c.join(p) })?;
    let rel = full.strip_prefix(&root_c).map_err(|_| bad("path is outside the notebook folder"))?;
    if rel.components().any(|c| c.as_os_str().to_string_lossy().starts_with('.')) {
        return Err(bad("hidden paths are not part of the library"));
    }
    // Symlinks: the deepest existing ancestor must still resolve inside the root.
    let croot = fs::canonicalize(&root_c)?;
    let mut anc = full.as_path();
    while !anc.exists() {
        anc = anc.parent().ok_or_else(|| bad("path is outside the notebook folder"))?;
    }
    if !fs::canonicalize(anc)?.starts_with(&croot) {
        return Err(bad("path is outside the notebook folder"));
    }
    Ok(full)
}

/// Like [`resolve`], but the vault root itself is refused (it can't be renamed, moved or deleted).
fn resolve_item(root: &Path, p: &Path) -> Result<PathBuf, Error> {
    let full = resolve(root, p)?;
    if full == clean(root)? {
        return Err(bad("cannot change the notebook folder itself"));
    }
    Ok(full)
}

fn resolve_dir(root: &Path, p: &Path) -> Result<PathBuf, Error> {
    let full = resolve(root, p)?;
    if !full.is_dir() {
        return Err(bad("not a folder"));
    }
    Ok(full)
}

/// `dir/stem.ext`, or `dir/stem 2.ext`, `stem 3.ext`, ... if taken.
fn unique_path(dir: &Path, stem: &str, ext: Option<&str>) -> PathBuf {
    let name = |s: &str| match ext {
        Some(e) => format!("{s}.{e}"),
        None => s.to_string(),
    };
    let first = dir.join(name(stem));
    if !first.exists() {
        return first;
    }
    (2..)
        .map(|n| dir.join(name(&format!("{stem} {n}"))))
        .find(|p| !p.exists())
        .expect("unbounded range")
}

#[derive(Debug, Clone, Serialize)]
pub struct FolderNode {
    pub name: String,
    pub path: PathBuf,
    pub children: Vec<FolderNode>,
}

const MAX_TREE_DEPTH: usize = 16;

/// The folder hierarchy under `root` (hidden folders such as `.stfolder` and `.trash` left out).
pub fn folder_tree(root: &Path) -> Result<FolderNode, Error> {
    fn walk(dir: &Path, depth: usize) -> Result<Vec<FolderNode>, Error> {
        if depth >= MAX_TREE_DEPTH {
            return Ok(Vec::new());
        }
        let mut out = Vec::new();
        for e in fs::read_dir(dir)? {
            let e = e?;
            let name = e.file_name().to_string_lossy().into_owned();
            // `file_type` does not follow symlinks, so linked folders are not descended into.
            if name.starts_with('.') || !e.file_type()?.is_dir() {
                continue;
            }
            out.push(FolderNode { children: walk(&e.path(), depth + 1)?, path: e.path(), name });
        }
        out.sort_by_key(|n| n.name.to_lowercase());
        Ok(out)
    }
    let root = resolve(root, root)?;
    let name = root.file_name().map_or_else(|| "Notebooks".into(), |n| n.to_string_lossy().into_owned());
    Ok(FolderNode { children: walk(&root, 0)?, path: root, name })
}

#[derive(Debug, Clone, Serialize)]
pub struct FolderInfo {
    pub name: String,
    pub path: PathBuf,
    pub modified: u64,
    /// Notebooks and sub-folders directly inside.
    pub items: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct Listing {
    pub path: PathBuf,
    pub folders: Vec<FolderInfo>,
    pub notebooks: Vec<Entry>,
}

/// The contents of one folder: its sub-folders and notebooks (conflict copies flagged).
pub fn list_dir(root: &Path, dir: &Path) -> Result<Listing, Error> {
    let dir = resolve_dir(root, dir)?;
    let (mut folders, mut notebooks) = (Vec::new(), Vec::new());
    for e in fs::read_dir(&dir)? {
        let e = e?;
        let name = e.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        let ft = e.file_type()?;
        let modified = modified_secs(&e.metadata()?);
        if ft.is_dir() {
            let items = fs::read_dir(e.path())?
                .filter_map(Result::ok)
                .filter(|c| {
                    let n = c.file_name().to_string_lossy().into_owned();
                    !n.starts_with('.') && (c.file_type().is_ok_and(|t| t.is_dir()) || is_notebook_name(&n))
                })
                .count();
            folders.push(FolderInfo { path: e.path(), name, modified, items });
        } else if is_notebook_name(&name) {
            notebooks.push(Entry { path: e.path(), is_conflict: is_conflict_name(&name), name, modified });
        }
    }
    folders.sort_by_key(|f| f.name.to_lowercase());
    notebooks.sort_by_key(|n| n.name.to_lowercase());
    Ok(Listing { path: dir, folders, notebooks })
}

pub fn create_folder(root: &Path, parent: &Path, name: &str) -> Result<PathBuf, Error> {
    let parent = resolve_dir(root, parent)?;
    let path = parent.join(sanitize_name(name)?);
    fs::create_dir(&path).map_err(|e| match e.kind() {
        std::io::ErrorKind::AlreadyExists => bad("a folder or notebook with that name already exists"),
        _ => e.into(),
    })?;
    Ok(path)
}

/// Creates a new, empty notebook (or canvas) in `dir` with a unique file name. Returns its path.
pub fn create_notebook(root: &Path, dir: &Path, title: &str, canvas: bool) -> Result<PathBuf, Error> {
    let dir = resolve_dir(root, dir)?;
    let title = title.trim();
    let path = unique_path(&dir, &sanitize_name(title)?, Some(EXT));
    let doc = if canvas { Document::new_canvas(title) } else { Document::new(title) };
    save(&path, &doc, None)?;
    Ok(path)
}

/// Renames a notebook (keeping its extension) or a folder. Returns the new path.
pub fn rename(root: &Path, path: &Path, new_name: &str) -> Result<PathBuf, Error> {
    let src = resolve_item(root, path)?;
    let dst = if src.is_dir() {
        src.with_file_name(sanitize_name(new_name)?)
    } else {
        let typed = new_name.trim();
        let suffix = format!(".{EXT}");
        let stem = typed
            .len()
            .checked_sub(suffix.len())
            .filter(|&i| typed.is_char_boundary(i) && typed[i..].eq_ignore_ascii_case(&suffix))
            .map_or(typed, |i| &typed[..i]);
        src.with_file_name(format!("{}.{EXT}", sanitize_name(stem)?))
    };
    if dst == src {
        return Ok(src);
    }
    if dst.exists() {
        return Err(bad("something with that name already exists"));
    }
    fs::rename(&src, &dst)?;
    Ok(dst)
}

/// Moves a notebook or folder into the folder `dest`. Returns the new path.
pub fn move_to(root: &Path, path: &Path, dest: &Path) -> Result<PathBuf, Error> {
    let src = resolve_item(root, path)?;
    let dest = resolve_dir(root, dest)?;
    if src.is_dir() && dest.starts_with(&src) {
        return Err(bad("cannot move a folder into itself"));
    }
    let dst = dest.join(src.file_name().ok_or_else(|| bad("path has no file name"))?);
    if dst == src {
        return Ok(src);
    }
    if dst.exists() {
        return Err(bad("something with that name already exists in the destination"));
    }
    fs::rename(&src, &dst)?;
    Ok(dst)
}

/// Copies a notebook next to the original as "<name> copy". Returns the copy's path.
pub fn duplicate(root: &Path, path: &Path) -> Result<PathBuf, Error> {
    let src = resolve_item(root, path)?;
    let name = src.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    if !src.is_file() || !is_notebook_name(&name) {
        return Err(bad("only notebooks can be duplicated"));
    }
    let stem = Path::new(&name).file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    // A copy of a Syncthing conflict file is simply a copy of the notebook.
    let stem = stem.split(".sync-conflict-").next().unwrap_or(&stem).to_string();
    let dst = unique_path(src.parent().unwrap_or(root), &format!("{stem} copy"), Some(EXT));
    write_atomic(&dst, &fs::read(&src)?)?;
    Ok(dst)
}

/// Moves a notebook or folder into `<root>/.trash` (nothing is deleted). Returns where it went.
pub fn trash(root: &Path, path: &Path) -> Result<PathBuf, Error> {
    let src = resolve_item(root, path)?;
    let trash_dir = clean(root)?.join(TRASH_DIR);
    fs::create_dir_all(&trash_dir)?;
    let name = src
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .ok_or_else(|| bad("path has no file name"))?;
    let (stem, ext) = match name.rsplit_once('.') {
        Some((s, e)) if src.is_file() => (s, Some(e)),
        _ => (name.as_str(), None),
    };
    let dst = unique_path(&trash_dir, stem, ext);
    fs::rename(&src, &dst)?;
    Ok(dst)
}
