use nebo_core::{package, vault, Document, Error, GraphObject, ImageObject, PageObject, Point, Shape, ShapeKind, Stroke, View};

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
fn stroke_colour_with_alpha_roundtrips() {
    let mut d = sample();
    let mut s = d.pages[0].strokes[0].clone();
    s.id = "s2".into();
    s.color = "#12345680".into();
    d.pages[0].strokes.push(s);
    let back = package::read(&package::write(&d).unwrap()).unwrap();
    assert_eq!(back.pages[0].strokes[1].color, "#12345680");
    assert_eq!(back, d);
}

#[test]
fn infinite_canvas_coords_and_view_roundtrip() {
    let mut d = sample();
    d.pages[0].strokes[0].points[0] = Point { x: -5000.5, y: 90000.0, t: 0, p: 0.5 };
    d.pages[0].view = Some(View { x: -120.0, y: 40.0, zoom: 0.25 });
    assert_eq!(package::read(&package::write(&d).unwrap()).unwrap(), d);
}

#[test]
fn old_ink_without_view_still_opens() {
    use std::io::Write;
    let mut zw = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    let o = zip::write::SimpleFileOptions::default();
    let mut put = |n: &str, b: &[u8]| { zw.start_file(n, o).unwrap(); zw.write_all(b).unwrap(); };
    put("mimeType", package::MIME.as_bytes());
    put("meta.json", br#"{"format-version":"1","title":"old","generator":"open-nebo"}"#);
    put("index.xml", br#"<document><pages><page id="p1"/></pages></document>"#);
    put("pages/p1/page.xml", br#"<page id="p1" width="800" height="600"><content/></page>"#);
    put("pages/p1/ink.jink", br#"{"strokes":[]}"#);
    let d = package::read(&zw.finish().unwrap().into_inner()).unwrap();
    assert_eq!((d.pages[0].width, d.pages[0].height, d.pages[0].view), (800.0, 600.0, None));
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

fn with_image() -> Document {
    use base64::Engine;
    let mut d = sample();
    d.pages[0].objects.push(PageObject::Image(ImageObject {
        id: "img1".into(), x: 10.0, y: 20.0, w: 100.0, h: 50.0, mime: "image/png".into(), source: None,
        data: base64::engine::general_purpose::STANDARD.encode([0x89, b'P', b'N', b'G', 1, 2, 3]),
    }));
    d
}

#[test]
fn image_objects_roundtrip() {
    let d = with_image();
    let bytes = package::write(&d).unwrap();
    let back = package::read(&bytes).unwrap();
    assert_eq!(back, d);
    assert!(back.opaque.is_empty(), "media must not leak into opaque members");
    let z = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
    assert!(z.file_names().any(|n| n == "media/img1.png"));
}

#[test]
fn documents_without_objects_still_load() {
    // pages written before objects existed have no objects.json
    let back = package::read(&package::write(&sample()).unwrap()).unwrap();
    assert!(back.pages[0].objects.is_empty());
}

#[test]
fn bad_image_input_rejected() {
    let mut d = with_image();
    let PageObject::Image(im) = &mut d.pages[0].objects[0] else { panic!() };
    im.id = "../x".into();
    assert!(matches!(package::write(&d), Err(Error::Invalid(_))));
    let mut d = with_image();
    let PageObject::Image(im) = &mut d.pages[0].objects[0] else { panic!() };
    im.mime = "image/svg+xml".into();
    assert!(matches!(package::write(&d), Err(Error::Invalid(_))));
    let mut d = with_image();
    let PageObject::Image(im) = &mut d.pages[0].objects[0] else { panic!() };
    im.data = "!!!".into();
    assert!(matches!(package::write(&d), Err(Error::Invalid(_))));
}

fn graph(id: &str, lo: f32, hi: f32) -> PageObject {
    PageObject::Graph(GraphObject {
        id: id.into(), x: 10.0, y: 20.0, size: 400.0,
        xmin: lo, xmax: hi, ymin: lo, ymax: hi, step: 1.0, labels: true, axes: true, grid: true,
    })
}

#[test]
fn graph_objects_roundtrip_alongside_images() {
    let mut d = with_image();
    d.pages[0].objects.push(graph("g1", -5.0, 5.0));
    d.pages[0].objects.push(graph("g2", -10.0, 10.0));
    assert_eq!(package::read(&package::write(&d).unwrap()).unwrap(), d);
}

#[test]
fn graph_flags_default_when_missing() {
    let o: PageObject = serde_json::from_str(
        r#"{"type":"graph","id":"g","x":0,"y":0,"size":100,"xmin":0,"xmax":5,"ymin":0,"ymax":5}"#,
    ).unwrap();
    let PageObject::Graph(g) = o else { panic!("not a graph") };
    assert!(g.labels && g.axes && g.grid);
    assert_eq!(g.step, 1.0);
}

#[test]
fn shape_objects_roundtrip_with_other_objects() {
    let mut d = with_image();
    d.pages[0].objects.push(graph("g1", -5.0, 5.0));
    d.pages[0].objects.push(PageObject::Shape(Shape {
        id: "s1".into(), kind: ShapeKind::Arrow, color: "#ff0000".into(), width: 3.0,
        points: vec![[0.0, 0.0], [50.0, 25.0]],
    }));
    assert_eq!(package::read(&package::write(&d).unwrap()).unwrap(), d);
}

#[test]
fn page_template_and_pdf_image_source_roundtrip() {
    let mut d = with_image();
    d.pages[0].template = Some("dotted".into());
    let PageObject::Image(im) = &mut d.pages[0].objects[0] else { panic!() };
    im.source = Some("pdf".into());
    let back = package::read(&package::write(&d).unwrap()).unwrap();
    assert_eq!(back, d);
    assert_eq!(back.pages[0].template.as_deref(), Some("dotted"));
}

#[test]
fn old_pages_have_no_template_and_unknown_values_rejected() {
    let back = package::read(&package::write(&sample()).unwrap()).unwrap();
    assert!(back.pages[0].template.is_none());
    let mut d = sample();
    d.pages[0].template = Some("<script>".into());
    assert!(matches!(package::write(&d), Err(Error::Invalid(_))));
    let mut d = with_image();
    let PageObject::Image(im) = &mut d.pages[0].objects[0] else { panic!() };
    im.source = Some("evil".into());
    assert!(matches!(package::write(&d), Err(Error::Invalid(_))));
}
