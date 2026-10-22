use nebo_core::model::OpaqueEntry;
use nebo_core::pdf::{build, PdfPage};
use nebo_core::{package, Document, Error};

fn with_background() -> Document {
    let mut d = Document::new("Imported");
    d.pages[0].background = Some("media/page-1.png".into());
    d.opaque.push(OpaqueEntry { name: "media/page-1.png".into(), data: vec![9, 8, 7] });
    d
}

#[test]
fn page_background_and_media_roundtrip() {
    let d = with_background();
    let back = package::read(&package::write(&d).unwrap()).unwrap();
    assert_eq!(back, d);
    assert_eq!(back.opaque, d.opaque);
}

#[test]
fn background_outside_media_rejected() {
    let mut d = with_background();
    for bad in ["../x.png", "pages/p/ink.jink", "media/../x", "media/"] {
        d.pages[0].background = Some(bad.into());
        assert!(matches!(package::write(&d), Err(Error::Invalid(_))), "{bad}");
    }
}

#[test]
fn old_pages_without_background_still_load() {
    let p: nebo_core::Page =
        serde_json::from_str(r#"{"id":"a","width":10.0,"height":20.0,"strokes":[]}"#).unwrap();
    assert_eq!(p.background, None);
}

#[test]
fn pdf_export_structure() {
    let jpeg = vec![0xFF, 0xD8, 0xFF, 0xD9];
    let pages = vec![
        PdfPage { width_px: 1404, height_px: 1872, jpeg: jpeg.clone() },
        PdfPage { width_px: 100, height_px: 100, jpeg },
    ];
    let pdf = build(&pages).unwrap();
    let s = String::from_utf8_lossy(&pdf);
    assert!(s.starts_with("%PDF-1.4") && s.trim_end().ends_with("%%EOF"));
    assert!(s.contains("/Count 2"));
    let at: usize = s.rsplit("startxref\n").next().unwrap().lines().next().unwrap().parse().unwrap();
    assert!(pdf[at..].starts_with(b"xref"));
    assert!(build(&[]).is_err());
    assert!(build(&[PdfPage { width_px: 1, height_px: 1, jpeg: vec![1] }]).is_err());
}
