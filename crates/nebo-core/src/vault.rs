//! Safe handling of `.nebo` files inside a folder synced by Syncthing.
//!
//! * Saves are atomic: write `.syncthing.<name>.tmp` (a name Syncthing never
//!   syncs), fsync, rename over the target.
//! * Every load returns a content revision; saving with a stale revision fails
//!   with [`Error::Conflict`] instead of clobbering a file Syncthing replaced.
//! * `*.sync-conflict-*` files created by Syncthing are discoverable.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::{package, Document, Error};

pub const EXT: &str = "nebo";

pub fn revision(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

pub fn load(path: &Path) -> Result<(Document, String), Error> {
    let bytes = fs::read(path)?;
    Ok((package::read(&bytes)?, revision(&bytes)))
}

/// Saves `doc` to `path`. `base_rev` is the revision from the last load/save
/// (`None` for a brand new file, which must not already exist). Returns the new revision.
pub fn save(path: &Path, doc: &Document, base_rev: Option<&str>) -> Result<String, Error> {
    match (fs::read(path), base_rev) {
        (Ok(cur), Some(rev)) if revision(&cur) != rev => {
            return Err(Error::Conflict(path.display().to_string()))
        }
        (Ok(_), None) => return Err(Error::Conflict(path.display().to_string())),
        (Err(e), Some(_)) if e.kind() == std::io::ErrorKind::NotFound => {
            return Err(Error::Conflict(path.display().to_string()))
        }
        _ => {}
    }

    let bytes = package::write(doc)?;
    write_atomic(path, &bytes)?;
    Ok(revision(&bytes))
}

pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), Error> {
    let name = path
        .file_name()
        .ok_or_else(|| Error::Invalid("path has no file name".into()))?
        .to_string_lossy();
    let tmp = path.with_file_name(format!(".syncthing.{name}.tmp"));
    {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
    }
    if let Err(e) = fs::rename(&tmp, path) {
        let _ = fs::remove_file(&tmp);
        return Err(e.into());
    }
    if let Some(dir) = path.parent() {
        // Best effort: persist the rename. Not supported on Windows.
        if let Ok(d) = fs::File::open(dir) {
            let _ = d.sync_all();
        }
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
pub struct Entry {
    pub path: PathBuf,
    pub name: String,
    pub modified: u64,
    pub is_conflict: bool,
}

pub fn is_conflict_name(name: &str) -> bool {
    name.contains(".sync-conflict-")
}

/// Lists `.nebo` files under `root` (recursively), conflict copies included and flagged.
pub fn list(root: &Path) -> Result<Vec<Entry>, Error> {
    let mut out = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        for e in fs::read_dir(&dir)? {
            let e = e?;
            let name = e.file_name().to_string_lossy().into_owned();
            // .stfolder, .stversions and our own temp files are not notebooks.
            if name.starts_with('.') {
                continue;
            }
            let ft = e.file_type()?;
            if ft.is_dir() {
                stack.push(e.path());
            } else if Path::new(&name).extension().is_some_and(|x| x.eq_ignore_ascii_case(EXT)) {
                let modified = e
                    .metadata()?
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map_or(0, |d| d.as_secs());
                out.push(Entry { path: e.path(), is_conflict: is_conflict_name(&name), name, modified });
            }
        }
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

/// Content for a `.stignore` that keeps app state and temp files out of sync.
pub const STIGNORE: &str = "// open-nebo\n.open-nebo-state\n(?d).syncthing.*.tmp\n";
