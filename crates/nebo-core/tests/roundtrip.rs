use nebo_core::{package, vault, Document, Error, Point, Stroke};

fn sample() -> Document {
    let mut d = Document::new("Notes & <ideas>");
    d.pages[0].strokes.push(Stroke {
        id: "s1".into(),
        color: "#ff0000".into(),
        width: 3.0,
        points: vec![Point { x: 1.0, y: 2.0, t: 0, p: 0.4 }, Point { x: 5.5, y: 6.5, t: 16, p: 0.9 }],
    });
    d
}

#[test]
fn roundtrip_preserves_content() {
    let d = sample();
    assert_eq!(package::read(&package::write(&d).unwrap()).unwrap(), d);
}

#[test]
fn foreign_entries_survive_roundtrip() {
    let mut d = sample();
    d.opaque.push(nebo_core::model::OpaqueEntry { name: "extra/blob.bin".into(), data: vec![1, 2, 3] });
    let back = package::read(&package::write(&d).unwrap()).unwrap();
    assert_eq!(back.opaque, d.opaque);
}

#[test]
fn mimetype_is_first_and_stored() {
    let bytes = package::write(&sample()).unwrap();
    let mut z = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
    let f = z.by_index(0).unwrap();
    assert_eq!(f.name(), "mimeType");
    assert_eq!(f.compression(), zip::CompressionMethod::Stored);
}

#[test]
fn path_traversal_page_id_rejected() {
    let mut d = sample();
    d.pages[0].id = "../evil".into();
    assert!(matches!(package::write(&d), Err(Error::Invalid(_))));
}

#[test]
fn binary_variants_report_unsupported() {
    use std::io::Write;
    let mut zw = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    let o = zip::write::SimpleFileOptions::default();
    zw.start_file("mimeType", o).unwrap();
    zw.write_all(package::MIME.as_bytes()).unwrap();
    zw.start_file("index.bdom", o).unwrap();
    zw.write_all(b"BDOM").unwrap();
    let bytes = zw.finish().unwrap().into_inner();
    assert!(matches!(package::read(&bytes), Err(Error::UnsupportedBinary(_))));
}

#[test]
fn stale_revision_is_a_conflict() {
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("a.nebo");
    let rev1 = vault::save(&p, &sample(), None).unwrap();

    // Simulate Syncthing delivering a newer version from another device.
    let mut other = sample();
    other.title = "from phone".into();
    vault::write_atomic(&p, &package::write(&other).unwrap()).unwrap();

    assert!(matches!(vault::save(&p, &sample(), Some(&rev1)), Err(Error::Conflict(_))));
    let (loaded, rev2) = vault::load(&p).unwrap();
    assert_eq!(loaded.title, "from phone");
    vault::save(&p, &loaded, Some(&rev2)).unwrap();
}

#[test]
fn new_file_does_not_overwrite_existing() {
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("a.nebo");
    vault::save(&p, &sample(), None).unwrap();
    assert!(matches!(vault::save(&p, &sample(), None), Err(Error::Conflict(_))));
}

#[test]
fn list_skips_hidden_and_flags_conflicts() {
    let dir = tempfile::tempdir().unwrap();
    let bytes = package::write(&sample()).unwrap();
    for n in ["a.nebo", "a.sync-conflict-20260101-000000-ABC.nebo", ".syncthing.a.nebo.tmp", "note.txt"] {
        std::fs::write(dir.path().join(n), &bytes).unwrap();
    }
    let l = vault::list(dir.path()).unwrap();
    assert_eq!(l.len(), 2);
    assert_eq!(l.iter().filter(|e| e.is_conflict).count(), 1);
}

#[test]
fn no_temp_file_left_after_save() {
    let dir = tempfile::tempdir().unwrap();
    vault::save(&dir.path().join("a.nebo"), &sample(), None).unwrap();
    let names: Vec<_> = std::fs::read_dir(dir.path()).unwrap().map(|e| e.unwrap().file_name()).collect();
    assert_eq!(names.len(), 1);
}

#[test]
fn shapes_roundtrip() {
    use nebo_core::{PageObject, Shape, ShapeKind};
    let mut d = sample();
    d.pages[0].objects.push(PageObject::Shape(Shape {
        id: "sh1".into(),
        kind: ShapeKind::Ellipse,
        color: "#00ff00".into(),
        width: 4.0,
        points: vec![[10.0, 20.0], [5.0, 7.5]],
    }));
    let back = package::read(&package::write(&d).unwrap()).unwrap();
    assert_eq!(back, d);
}

#[test]
fn ui_shaped_json_deserializes() {
    // Exactly what ui/app.js sends for a recognised rectangle.
    let json = serde_json::json!({
        "id": "p", "width": 10.0, "height": 10.0, "strokes": [],
        "objects": [{"type": "shape", "id": "x", "kind": "rect", "color": "#000000", "width": 2,
                     "points": [[0, 0], [10, 0], [10, 5], [0, 5]]}]
    });
    let page: nebo_core::Page = serde_json::from_value(json).unwrap();
    assert_eq!(page.objects.len(), 1);
}

#[test]
fn pages_without_objects_still_open() {
    // Pages written before `objects` existed (and pages the UI creates without it).
    let json = serde_json::json!({"id": "p", "width": 10.0, "height": 10.0, "strokes": []});
    let page: nebo_core::Page = serde_json::from_value(json).unwrap();
    assert!(page.objects.is_empty());
    // And a package with no objects writes none and reads back empty.
    let back = package::read(&package::write(&sample()).unwrap()).unwrap();
    assert!(back.pages[0].objects.is_empty());
}
