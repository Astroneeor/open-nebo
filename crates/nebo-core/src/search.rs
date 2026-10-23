//! Full-text search of typed text across every notebook in the vault.
//!
//! Only `meta.json`, `index.xml` and each page's `objects.json` are read from the
//! packages (never images or ink), each with a hard byte cap so a hostile archive
//! cannot exhaust memory. Unreadable or malformed files are skipped. Symlinks and
//! hidden entries are not followed, and the search root is checked with
//! [`library::resolve`].

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use quick_xml::events::Event;
use quick_xml::Reader;
use serde::Serialize;
use zip::ZipArchive;

use crate::library;
use crate::vault::is_notebook_name;
use crate::Error;

const MAX_META: u64 = 64 * 1024;
const MAX_INDEX: u64 = 1024 * 1024;
const MAX_OBJECTS: u64 = 8 * 1024 * 1024;
const MAX_FILE_SIZE: u64 = 1 << 30;
const MAX_PAGES: usize = 5000;
const MAX_FILES: usize = 20_000;
const MAX_DEPTH: usize = 16;
const CONTEXT: usize = 40;
const SNIPPET_MAX: usize = 120;

#[derive(Debug, Clone, Serialize)]
pub struct Hit {
    pub path: PathBuf,
    pub title: String,
    pub page_index: usize,
    pub page_id: String,
    pub snippet: String,
}

/// Lowercases one char and strips the diacritic from common Latin letters (1 char in, 1 char out).
pub fn fold_char(c: char) -> char {
    let l = c.to_lowercase().next().unwrap_or(c);
    match l {
        'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' | 'ā' | 'ă' | 'ą' => 'a',
        'ç' | 'ć' | 'č' | 'ĉ' | 'ċ' => 'c',
        'ď' | 'đ' => 'd',
        'è' | 'é' | 'ê' | 'ë' | 'ē' | 'ĕ' | 'ė' | 'ę' | 'ě' => 'e',
        'ĝ' | 'ğ' | 'ġ' | 'ģ' => 'g',
        'ì' | 'í' | 'î' | 'ï' | 'ĩ' | 'ī' | 'ĭ' | 'į' | 'ı' => 'i',
        'ĺ' | 'ļ' | 'ľ' | 'ł' => 'l',
        'ñ' | 'ń' | 'ņ' | 'ň' => 'n',
        'ò' | 'ó' | 'ô' | 'õ' | 'ö' | 'ø' | 'ō' | 'ŏ' | 'ő' => 'o',
        'ŕ' | 'ŗ' | 'ř' => 'r',
        'ś' | 'ŝ' | 'ş' | 'š' => 's',
        'ţ' | 'ť' => 't',
        'ù' | 'ú' | 'û' | 'ü' | 'ũ' | 'ū' | 'ŭ' | 'ů' | 'ű' | 'ų' => 'u',
        'ý' | 'ÿ' => 'y',
        'ź' | 'ż' | 'ž' => 'z',
        c if c.is_whitespace() => ' ',
        c => c,
    }
}

fn fold(s: &str) -> Vec<char> {
    s.chars().map(fold_char).collect()
}

fn find(hay: &[char], needle: &[char]) -> Option<usize> {
    if needle.is_empty() || needle.len() > hay.len() {
        return None;
    }
    hay.windows(needle.len()).position(|w| w == needle)
}

/// Returns the char index of the first term's match if every term occurs in `hay`.
fn match_all(hay: &[char], terms: &[Vec<char>]) -> Option<(usize, usize)> {
    let mut first = None;
    for t in terms {
        let p = find(hay, t)?;
        if first.is_none() {
            first = Some((p, t.len()));
        }
    }
    first
}

fn snippet(original: &str, at: usize, len: usize) -> String {
    // `fold` is char-for-char, so indices line up with the original text.
    let chars: Vec<char> = original.chars().map(|c| if c.is_whitespace() { ' ' } else { c }).collect();
    let start = at.saturating_sub(CONTEXT);
    let end = (at + len + CONTEXT).min(chars.len()).min(start + SNIPPET_MAX.max(len + 2 * CONTEXT));
    let mut s: String = chars[start..end].iter().collect::<String>().trim().to_string();
    if start > 0 {
        s.insert(0, '…');
    }
    if end < chars.len() {
        s.push('…');
    }
    s
}

fn read_capped<R: Read + std::io::Seek>(zip: &mut ZipArchive<R>, name: &str, cap: u64) -> Option<Vec<u8>> {
    let f = zip.by_name(name).ok()?;
    let mut buf = Vec::new();
    f.take(cap + 1).read_to_end(&mut buf).ok()?;
    (buf.len() as u64 <= cap).then_some(buf)
}

fn page_ids(xml: &[u8]) -> Vec<String> {
    let mut reader = Reader::from_reader(xml);
    let (mut buf, mut ids) = (Vec::new(), Vec::new());
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) | Ok(Event::Empty(e)) if e.local_name().as_ref() == b"page" => {
                for a in e.attributes().flatten() {
                    if a.key.as_ref() == b"id" {
                        ids.push(String::from_utf8_lossy(&a.value).into_owned());
                    }
                }
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
        if ids.len() >= MAX_PAGES {
            break;
        }
        buf.clear();
    }
    ids
}

fn page_text(json: &[u8]) -> String {
    let Ok(v) = serde_json::from_slice::<serde_json::Value>(json) else { return String::new() };
    let Some(objs) = v.get("objects").and_then(|o| o.as_array()) else { return String::new() };
    objs.iter()
        .filter(|o| o.get("type").and_then(|t| t.as_str()) == Some("text"))
        .filter_map(|o| o.get("text").and_then(|t| t.as_str()))
        .filter(|t| !t.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn search_file(path: &Path, terms: &[Vec<char>], out: &mut Vec<Hit>, limit: usize) {
    let Ok(md) = fs::symlink_metadata(path) else { return };
    if !md.is_file() || md.len() > MAX_FILE_SIZE {
        return;
    }
    let Ok(file) = fs::File::open(path) else { return };
    let Ok(mut zip) = ZipArchive::new(file) else { return };
    let ids = read_capped(&mut zip, "index.xml", MAX_INDEX).map(|x| page_ids(&x)).unwrap_or_default();
    let title = read_capped(&mut zip, "meta.json", MAX_META)
        .and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok())
        .and_then(|v| v.get("title").and_then(|t| t.as_str()).map(str::to_string))
        .filter(|t| !t.trim().is_empty())
        .unwrap_or_else(|| path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default());

    if match_all(&fold(&title), terms).is_some() && out.len() < limit {
        out.push(Hit { path: path.to_path_buf(), title: title.clone(), page_index: 0, page_id: ids.first().cloned().unwrap_or_default(), snippet: title.clone() });
    }
    for (i, id) in ids.iter().enumerate() {
        if out.len() >= limit {
            return;
        }
        // Ids come from the archive: only look up well-formed ones.
        if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
            continue;
        }
        let Some(bytes) = read_capped(&mut zip, &format!("pages/{id}/objects.json"), MAX_OBJECTS) else { continue };
        let text = page_text(&bytes);
        if let Some((at, len)) = match_all(&fold(&text), terms) {
            out.push(Hit { path: path.to_path_buf(), title: title.clone(), page_index: i, page_id: id.clone(), snippet: snippet(&text, at, len) });
        }
    }
}

fn walk(dir: &Path, depth: usize, terms: &[Vec<char>], out: &mut Vec<Hit>, limit: usize, seen: &mut usize) {
    if depth > MAX_DEPTH || out.len() >= limit {
        return;
    }
    let Ok(rd) = fs::read_dir(dir) else { return };
    let mut entries: Vec<_> = rd.filter_map(Result::ok).collect();
    entries.sort_by_key(|e| e.file_name());
    for e in entries {
        if out.len() >= limit || *seen >= MAX_FILES {
            return;
        }
        let name = e.file_name().to_string_lossy().into_owned();
        // Hidden entries (.trash, .stfolder) are skipped; `file_type` does not follow symlinks.
        if name.starts_with('.') {
            continue;
        }
        let Ok(ft) = e.file_type() else { continue };
        if ft.is_dir() {
            walk(&e.path(), depth + 1, terms, out, limit, seen);
        } else if ft.is_file() && is_notebook_name(&name) {
            *seen += 1;
            search_file(&e.path(), terms, out, limit);
        }
    }
}

/// Searches notebook titles and typed text under `root`. All whitespace-separated words must match
/// (case- and accent-insensitively) within the title, or within one page.
pub fn search(root: &Path, query: &str, limit: usize) -> Result<Vec<Hit>, Error> {
    let root = library::resolve(root, root)?;
    let terms: Vec<Vec<char>> = query.split_whitespace().take(16).map(fold).collect();
    let mut out = Vec::new();
    if terms.is_empty() || limit == 0 {
        return Ok(out);
    }
    walk(&root, 0, &terms, &mut out, limit, &mut 0);
    Ok(out)
}
