//! `.onb` extension / MIME and reading of legacy `.nebo` files written by 0.1.x.

use nebo_core::{package, vault, Document, Error};
use std::io::Write;

/// A minimal package as Open Nebo 0.1.x wrote it (MyScript MIME, `.nebo`).
fn legacy_bytes(title: &str) -> Vec<u8> {
    let mut zw = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    let o = zip::write::SimpleFileOptions::default();
    let mut put = |n: &str, b: &[u8]| {
        zw.start_file(n, o).unwrap();
        zw.write_all(b).unwrap();
    };
    put("mimeType", package::LEGACY_MIME.as_bytes());
    put("meta.json", format!(r#"{{"format-version":"1","title":"{title}","generator":"open-nebo"}}"#).as_bytes());
    put("index.xml", br#"<document><pages><page id="p1"/></pages></document>"#);
    put("pages/p1/page.xml", br#"<page id="p1" width="800" height="600"><content/></page>"#);
    put("pages/p1/ink.jink", br#"{"strokes":[]}"#);
    zw.finish().unwrap().into_inner()
}

fn mime_of(bytes: &[u8]) -> String {
    let mut z = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
    let mut s = String::new();
    std::io::Read::read_to_string(&mut z.by_name("mimeType").unwrap(), &mut s).unwrap();
    s
}

#[test]
fn constants_are_ours_not_myscripts() {
    assert_eq!(vault::EXT, "onb");
    assert_eq!(package::MIME, "application/vnd.opennebo+zip");
    assert_ne!(package::MIME, package::LEGACY_MIME);
}

#[test]
fn new_packages_use_the_new_mime_and_reread() {
    let bytes = package::write(&Document::new("t")).unwrap();
    assert_eq!(mime_of(&bytes), package::MIME);
    assert_eq!(package::read(&bytes).unwrap().title, "t");
}

#[test]
fn legacy_mime_still_reads() {
    let d = package::read(&legacy_bytes("old")).unwrap();
    assert_eq!(d.title, "old");
    assert_eq!((d.pages[0].width, d.pages[0].height), (800.0, 600.0));
    // Re-saving upgrades the MIME.
    assert_eq!(mime_of(&package::write(&d).unwrap()), package::MIME);
}

#[test]
fn foreign_mime_is_rejected() {
    let mut zw = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    zw.start_file("mimeType", zip::write::SimpleFileOptions::default()).unwrap();
    zw.write_all(b"application/zip").unwrap();
    assert!(matches!(package::read(&zw.finish().unwrap().into_inner()), Err(Error::Invalid(_))));
}

#[test]
fn legacy_binary_variants_still_report_unsupported() {
    let mut zw = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    let o = zip::write::SimpleFileOptions::default();
    zw.start_file("mimeType", o).unwrap();
    zw.write_all(package::LEGACY_MIME.as_bytes()).unwrap();
    zw.start_file("pages/p1/ink.bink", o).unwrap();
    zw.write_all(b"BINK").unwrap();
    assert!(matches!(package::read(&zw.finish().unwrap().into_inner()), Err(Error::UnsupportedBinary(_))));
}

#[test]
fn legacy_file_opens_and_saves_as_onb_next_to_it() {
    let dir = tempfile::tempdir().unwrap();
    let legacy = dir.path().join("old.nebo");
    let original = legacy_bytes("old");
    std::fs::write(&legacy, &original).unwrap();

    let (mut doc, rev) = vault::load(&legacy).unwrap();
    doc.title = "edited".into();
    let rev2 = vault::save(&legacy, &doc, Some(&rev)).unwrap();

    let onb = dir.path().join("old.onb");
    assert!(onb.exists(), "saved as the same-named .onb");
    assert_eq!(std::fs::read(&legacy).unwrap(), original, "original .nebo left untouched");
    assert_eq!(vault::migrated_path(&legacy), onb);
    assert_eq!(mime_of(&std::fs::read(&onb).unwrap()), package::MIME);

    // Further loads/saves via the legacy path follow the .onb (no stale reload, no false conflict).
    let (again, rev3) = vault::load(&legacy).unwrap();
    assert_eq!((again.title.as_str(), rev3.as_str()), ("edited", rev2.as_str()));
    vault::save(&legacy, &again, Some(&rev3)).unwrap();
}

#[test]
fn legacy_save_conflicts_if_an_onb_twin_changed() {
    let dir = tempfile::tempdir().unwrap();
    let legacy = dir.path().join("old.nebo");
    std::fs::write(&legacy, legacy_bytes("old")).unwrap();
    let (doc, rev) = vault::load(&legacy).unwrap();
    // Another device delivers old.onb before we save.
    let mut other = Document::new("from phone");
    other.title = "from phone".into();
    std::fs::write(dir.path().join("old.onb"), package::write(&other).unwrap()).unwrap();
    assert!(matches!(vault::save(&legacy, &doc, Some(&rev)), Err(Error::Conflict(_))));
}

#[test]
fn list_shows_both_extensions_and_hides_migrated_legacy() {
    let dir = tempfile::tempdir().unwrap();
    let new = package::write(&Document::new("n")).unwrap();
    std::fs::write(dir.path().join("fresh.onb"), &new).unwrap();
    std::fs::write(dir.path().join("only-legacy.nebo"), legacy_bytes("l")).unwrap();
    std::fs::write(dir.path().join("both.nebo"), legacy_bytes("l")).unwrap();
    std::fs::write(dir.path().join("both.onb"), &new).unwrap();
    std::fs::create_dir(dir.path().join("sub")).unwrap();
    std::fs::write(dir.path().join("sub").join("deep.ONB"), &new).unwrap();

    let names: Vec<String> = vault::list(dir.path()).unwrap().into_iter().map(|e| e.name).collect();
    assert_eq!(names, ["both.onb", "deep.ONB", "fresh.onb", "only-legacy.nebo"]);
}

#[test]
fn conflict_copies_are_listed_and_flagged_for_both_extensions() {
    let dir = tempfile::tempdir().unwrap();
    let new = package::write(&Document::new("n")).unwrap();
    for n in [
        "a.onb",
        "a.sync-conflict-20260101-000000-ABC.onb",
        "b.nebo",
        "b.sync-conflict-20260101-000000-DEF.nebo",
        ".syncthing.a.onb.tmp",
    ] {
        std::fs::write(dir.path().join(n), &new).unwrap();
    }
    let l = vault::list(dir.path()).unwrap();
    assert_eq!(l.len(), 4);
    assert_eq!(l.iter().filter(|e| e.is_conflict).count(), 2);
    assert!(vault::is_conflict_name("a.sync-conflict-20260101-000000-ABC.onb"));
    assert!(vault::is_notebook_name("a.sync-conflict-20260101-000000-ABC.onb"));
    assert!(!vault::is_notebook_name("note.txt"));
    assert!(!vault::is_notebook_name("a.onb.tmp"));
}

#[test]
fn new_notebooks_are_written_with_the_onb_extension() {
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join(format!("fresh.{}", vault::EXT));
    vault::save(&p, &Document::new("fresh"), None).unwrap();
    let names: Vec<_> = std::fs::read_dir(dir.path()).unwrap().map(|e| e.unwrap().file_name().into_string().unwrap()).collect();
    assert_eq!(names, ["fresh.onb"]);
}
