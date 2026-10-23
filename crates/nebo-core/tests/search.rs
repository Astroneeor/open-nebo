use std::io::Write;
use std::path::Path;

use nebo_core::model::TextObject;
use nebo_core::{package, search::search, Document, Page, PageObject};

fn text(id: &str, s: &str) -> PageObject {
    PageObject::Text(TextObject {
        id: id.into(), x: 0.0, y: 0.0, w: 300.0, text: s.into(), size: 24.0, color: "#000000".into(),
        bold: false, italic: false, layer: None,
    })
}

fn doc(title: &str, pages: &[&[&str]]) -> Document {
    let mut d = Document::new(title);
    d.pages = pages
        .iter()
        .enumerate()
        .map(|(i, texts)| {
            let mut p = Page::new(format!("p{i}"));
            p.objects = texts.iter().enumerate().map(|(j, t)| text(&format!("t{i}-{j}"), t)).collect();
            p
        })
        .collect();
    d
}

fn put(dir: &Path, name: &str, d: &Document) {
    std::fs::write(dir.join(name), package::write(d).unwrap()).unwrap();
}

#[test]
fn finds_text_case_and_accent_insensitive_with_page_and_snippet() {
    let t = tempfile::tempdir().unwrap();
    put(t.path(), "a.onb", &doc("Alpha", &[&["nothing here"], &["Crème Brûlée recipe: sugar", "second box"]]));
    let hits = search(t.path(), "creme BRULEE", 50).unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].page_index, 1);
    assert_eq!(hits[0].page_id, "p1");
    assert_eq!(hits[0].title, "Alpha");
    assert!(hits[0].snippet.contains("Crème Brûlée"));
}

#[test]
fn multi_word_and_requires_all_words_on_one_page() {
    let t = tempfile::tempdir().unwrap();
    put(t.path(), "a.onb", &doc("A", &[&["apple pie"], &["banana split"], &["apple banana"]]));
    let hits = search(t.path(), "apple banana", 50).unwrap();
    assert_eq!(hits.iter().map(|h| h.page_index).collect::<Vec<_>>(), vec![2]);
}

#[test]
fn matches_titles_and_unicode_text() {
    let t = tempfile::tempdir().unwrap();
    std::fs::create_dir(t.path().join("sub")).unwrap();
    put(&t.path().join("sub"), "n.onb", &doc("Straße Notes", &[&["日本語のメモ and Ωmega"]]));
    assert_eq!(search(t.path(), "notes", 50).unwrap().len(), 1);
    assert_eq!(search(t.path(), "日本語", 50).unwrap().len(), 1);
    assert_eq!(search(t.path(), "ωMEGA", 50).unwrap()[0].page_index, 0);
}

#[test]
fn limit_empty_query_and_hidden_dirs() {
    let t = tempfile::tempdir().unwrap();
    for i in 0..5 {
        put(t.path(), &format!("n{i}.onb"), &doc("N", &[&["needle"]]));
    }
    std::fs::create_dir(t.path().join(".trash")).unwrap();
    put(&t.path().join(".trash"), "gone.onb", &doc("G", &[&["needle"]]));
    assert_eq!(search(t.path(), "needle", 3).unwrap().len(), 3);
    assert_eq!(search(t.path(), "needle", 100).unwrap().len(), 5);
    assert!(search(t.path(), "   ", 10).unwrap().is_empty());
}

#[cfg(unix)]
#[test]
fn symlinks_are_not_followed() {
    let t = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    put(outside.path(), "x.onb", &doc("X", &[&["needle"]]));
    std::os::unix::fs::symlink(outside.path(), t.path().join("link")).unwrap();
    std::os::unix::fs::symlink(outside.path().join("x.onb"), t.path().join("l.onb")).unwrap();
    assert!(search(t.path(), "needle", 10).unwrap().is_empty());
}

#[test]
fn root_outside_or_with_parent_dir_is_refused() {
    let t = tempfile::tempdir().unwrap();
    assert!(search(&t.path().join("..").join("x"), "a", 10).is_err());
}

fn raw_zip(entries: &[(&str, Vec<u8>)]) -> Vec<u8> {
    let mut zw = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    let o = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    for (n, d) in entries {
        zw.start_file(*n, o).unwrap();
        zw.write_all(d).unwrap();
    }
    zw.finish().unwrap().into_inner()
}

#[test]
fn hostile_and_broken_files_are_skipped() {
    let t = tempfile::tempdir().unwrap();
    put(t.path(), "good.onb", &doc("Good", &[&["needle"]]));
    std::fs::write(t.path().join("garbage.onb"), b"not a zip at all").unwrap();
    std::fs::write(t.path().join("empty.onb"), b"").unwrap();
    // Page ids that try to escape the archive layout, and malformed json.
    let idx = br#"<document><pages><page id="../../etc/passwd"/><page id="p1"/><page id="p2"/></pages></document>"#.to_vec();
    std::fs::write(
        t.path().join("evil.onb"),
        raw_zip(&[
            ("meta.json", br#"{"title":"Evil"}"#.to_vec()),
            ("index.xml", idx),
            ("pages/p1/objects.json", b"{ not json".to_vec()),
            ("pages/p2/objects.json", br#"{"objects":[{"type":"text","text":"needle in evil"}, {"type":"text","text":5}, 7]}"#.to_vec()),
            ("pages/../../evil/objects.json", br#"{"objects":[{"type":"text","text":"needle"}]}"#.to_vec()),
        ]),
    )
    .unwrap();
    let hits = search(t.path(), "needle", 50).unwrap();
    let mut names: Vec<_> = hits.iter().map(|h| (h.title.clone(), h.page_index)).collect();
    names.sort();
    assert_eq!(names, vec![("Evil".to_string(), 2), ("Good".to_string(), 0)]);
}

#[test]
fn oversized_entries_are_ignored_without_reading_everything() {
    let t = tempfile::tempdir().unwrap();
    // 40 MB of text inside objects.json (compresses to almost nothing): over the 8 MB cap.
    let big = format!(r#"{{"objects":[{{"type":"text","text":"needle {}"}}]}}"#, "a".repeat(40 * 1024 * 1024));
    std::fs::write(
        t.path().join("big.onb"),
        raw_zip(&[
            ("meta.json", br#"{"title":"Big"}"#.to_vec()),
            ("index.xml", br#"<document><pages><page id="p1"/></pages></document>"#.to_vec()),
            ("pages/p1/objects.json", big.into_bytes()),
        ]),
    )
    .unwrap();
    put(t.path(), "ok.onb", &doc("Ok", &[&["needle"]]));
    let hits = search(t.path(), "needle", 50).unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].title, "Ok");
}

#[test]
fn long_text_snippet_is_bounded_with_context() {
    let t = tempfile::tempdir().unwrap();
    let body = format!("{} needle {}", "x ".repeat(500), "y ".repeat(500));
    put(t.path(), "l.onb", &doc("L", &[&[body.as_str()]]));
    let h = &search(t.path(), "needle", 5).unwrap()[0];
    assert!(h.snippet.contains("needle"));
    assert!(h.snippet.chars().count() < 200);
    assert!(h.snippet.starts_with('…') && h.snippet.ends_with('…'));
}
