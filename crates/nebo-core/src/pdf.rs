//! Minimal PDF writer for exporting notebook pages.
//!
//! Each page is a JPEG (background and ink already composited by the UI) drawn
//! full-bleed. No external PDF dependency is needed for that.

use std::fmt::Write as _;

use crate::Error;

/// Exported PDF page width in points (A4); height follows the notebook page aspect.
const PAGE_W_PT: f32 = 595.28;

pub struct PdfPage {
    pub width_px: u32,
    pub height_px: u32,
    pub jpeg: Vec<u8>,
}

pub fn build(pages: &[PdfPage]) -> Result<Vec<u8>, Error> {
    if pages.is_empty() {
        return Err(Error::Invalid("no pages to export".into()));
    }
    for p in pages {
        if p.width_px == 0 || p.height_px == 0 || !p.jpeg.starts_with(&[0xFF, 0xD8]) {
            return Err(Error::Invalid("page image is not a JPEG".into()));
        }
    }

    let mut out: Vec<u8> = b"%PDF-1.4\n%\xE2\xE3\xCF\xD3\n".to_vec();
    let mut offsets: Vec<usize> = Vec::new(); // offsets[i] is object i+1
    let mut obj = |out: &mut Vec<u8>, body: &[u8]| {
        offsets.push(out.len());
        let n = offsets.len();
        out.extend_from_slice(format!("{n} 0 obj\n").as_bytes());
        out.extend_from_slice(body);
        out.extend_from_slice(b"\nendobj\n");
    };

    // Objects: 1 catalog, 2 pages, then per page: page, content, image.
    obj(&mut out, b"<< /Type /Catalog /Pages 2 0 R >>");
    let kids: String = (0..pages.len()).fold(String::new(), |mut s, i| {
        let _ = write!(s, "{} 0 R ", 3 + i * 3);
        s
    });
    obj(&mut out, format!("<< /Type /Pages /Count {} /Kids [{kids}] >>", pages.len()).as_bytes());

    for (i, p) in pages.iter().enumerate() {
        let (w, h) = (PAGE_W_PT, PAGE_W_PT * p.height_px as f32 / p.width_px as f32);
        let base = 3 + i * 3;
        obj(
            &mut out,
            format!(
                "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {w:.2} {h:.2}] \
                 /Resources << /XObject << /Im0 {} 0 R >> >> /Contents {} 0 R >>",
                base + 2,
                base + 1
            )
            .as_bytes(),
        );
        let content = format!("q {w:.2} 0 0 {h:.2} 0 0 cm /Im0 Do Q");
        obj(&mut out, format!("<< /Length {} >>\nstream\n{content}\nendstream", content.len()).as_bytes());
        let mut img = format!(
            "<< /Type /XObject /Subtype /Image /Width {} /Height {} /ColorSpace /DeviceRGB \
             /BitsPerComponent 8 /Filter /DCTDecode /Length {} >>\nstream\n",
            p.width_px,
            p.height_px,
            p.jpeg.len()
        )
        .into_bytes();
        img.extend_from_slice(&p.jpeg);
        img.extend_from_slice(b"\nendstream");
        obj(&mut out, &img);
    }

    let xref = out.len();
    let mut tail = format!("xref\n0 {}\n0000000000 65535 f \n", offsets.len() + 1);
    for o in &offsets {
        let _ = writeln!(tail, "{o:010} 00000 n ");
    }
    let _ = write!(
        tail,
        "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n",
        offsets.len() + 1
    );
    out.extend_from_slice(tail.as_bytes());
    Ok(out)
}
