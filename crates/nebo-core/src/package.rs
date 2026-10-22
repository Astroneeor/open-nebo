//! iink-style package container.
//!
//! Layout (recovered from strings in the Nebo 6.3 DLLs, NOT yet verified
//! against a real file):
//!
//! ```text
//! mimeType                 application/vnd.myscript.nebo (stored, first)
//! meta.json                {"format-version": ..}
//! rel.json                 object relations
//! fileindex.json           per-file index
//! index.xml                document index (index.bdom is the binary form)
//! pages/<id>/page.xml      page tree        (page.bdom is the binary form)
//! pages/<id>/ink.jink      stroke data      (ink.bink is the binary form)
//! style.css
//! ```
//!
//! The `ink.jink` JSON schema written here is this project's own; the real
//! jink schema is unknown. Binary (`bdom`/`bink`) members are rejected with
//! [`Error::UnsupportedBinary`] instead of being guessed at.

use std::io::{Cursor, Read, Write};

use quick_xml::events::Event;
use quick_xml::Reader;
use serde::{Deserialize, Serialize};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use base64::Engine;

use crate::model::{Document, ImageObject, OpaqueEntry, Page, PageObject, Stroke};
use crate::Error;

pub const MIME: &str = "application/vnd.myscript.nebo";
pub const FORMAT_VERSION: &str = "1";
const INDEX_NS: &str = "http://www.myscript.com/ns/myscript/document";

#[derive(Serialize, Deserialize)]
struct Meta {
    #[serde(rename = "format-version")]
    format_version: String,
    title: String,
    generator: String,
}

#[derive(Serialize, Deserialize)]
struct InkFile {
    strokes: Vec<Stroke>,
}

/// `pages/<id>/objects.json`: object list with image bytes replaced by a `media` member path.
#[derive(Serialize, Deserialize)]
struct ObjectsFile {
    objects: Vec<ObjectMeta>,
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum ObjectMeta {
    Image { id: String, x: f32, y: f32, w: f32, h: f32, mime: String, media: String },
}

fn ext_for(mime: &str) -> Result<&'static str, Error> {
    match mime {
        "image/png" => Ok("png"),
        "image/jpeg" => Ok("jpg"),
        "image/gif" => Ok("gif"),
        "image/webp" => Ok("webp"),
        m => Err(Error::Invalid(format!("unsupported image type {m:?}"))),
    }
}

fn esc(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/// Page ids become path segments, so they must not be able to escape `pages/`.
fn safe_id(id: &str) -> Result<&str, Error> {
    let ok = !id.is_empty()
        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if ok { Ok(id) } else { Err(Error::Invalid(format!("unsafe page id {id:?}"))) }
}

pub fn write(doc: &Document) -> Result<Vec<u8>, Error> {
    let mut zw = ZipWriter::new(Cursor::new(Vec::new()));
    let stored = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
    let deflated = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

    zw.start_file("mimeType", stored)?;
    zw.write_all(MIME.as_bytes())?;

    let meta = Meta {
        format_version: FORMAT_VERSION.into(),
        title: doc.title.clone(),
        generator: "open-nebo".into(),
    };
    zw.start_file("meta.json", deflated)?;
    zw.write_all(&serde_json::to_vec_pretty(&meta)?)?;

    let mut index = format!("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<document xmlns=\"{INDEX_NS}\">\n  <pages>\n");
    let mut files = Vec::new();
    for p in &doc.pages {
        let id = safe_id(&p.id)?;
        index.push_str(&format!("    <page id=\"{}\"/>\n", esc(id)));
        files.push(format!("pages/{id}/page.xml"));
        files.push(format!("pages/{id}/ink.jink"));
    }
    index.push_str("  </pages>\n</document>\n");

    zw.start_file("index.xml", deflated)?;
    zw.write_all(index.as_bytes())?;
    zw.start_file("rel.json", deflated)?;
    zw.write_all(b"{}")?;
    zw.start_file("style.css", deflated)?;
    zw.write_all(b"")?;

    let mut media_written = std::collections::HashSet::new();
    for p in &doc.pages {
        let id = safe_id(&p.id)?;
        let page_xml = format!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<page id=\"{}\" width=\"{}\" height=\"{}\"><content/></page>\n",
            esc(id), p.width, p.height
        );
        zw.start_file(format!("pages/{id}/page.xml"), deflated)?;
        zw.write_all(page_xml.as_bytes())?;
        zw.start_file(format!("pages/{id}/ink.jink"), deflated)?;
        zw.write_all(&serde_json::to_vec(&InkFile { strokes: p.strokes.clone() })?)?;

        if !p.objects.is_empty() {
            let mut metas = Vec::new();
            for o in &p.objects {
                let PageObject::Image(im) = o;
                let image_id = safe_id(&im.id)?;
                let media = format!("media/{image_id}.{}", ext_for(&im.mime)?);
                let bytes = base64::engine::general_purpose::STANDARD
                    .decode(&im.data)
                    .map_err(|e| Error::Invalid(format!("image {image_id}: {e}")))?;
                if !media_written.insert(media.clone()) {
                    return Err(Error::Invalid(format!("duplicate image id {image_id:?}")));
                }
                zw.start_file(&media, deflated)?;
                zw.write_all(&bytes)?;
                files.push(media.clone());
                metas.push(ObjectMeta::Image {
                    id: im.id.clone(), x: im.x, y: im.y, w: im.w, h: im.h, mime: im.mime.clone(), media,
                });
            }
            zw.start_file(format!("pages/{id}/objects.json"), deflated)?;
            zw.write_all(&serde_json::to_vec(&ObjectsFile { objects: metas })?)?;
            files.push(format!("pages/{id}/objects.json"));
        }
    }

    for o in &doc.opaque {
        zw.start_file(&o.name, deflated)?;
        zw.write_all(&o.data)?;
    }

    let index_json = serde_json::json!({
        "files": files.iter().map(|f| serde_json::json!({"path": f})).collect::<Vec<_>>()
    });
    zw.start_file("fileindex.json", deflated)?;
    zw.write_all(&serde_json::to_vec_pretty(&index_json)?)?;

    Ok(zw.finish()?.into_inner())
}

fn read_entry(zip: &mut ZipArchive<Cursor<&[u8]>>, name: &str) -> Result<Vec<u8>, Error> {
    let mut f = zip.by_name(name).map_err(|_| Error::Invalid(format!("missing {name}")))?;
    let mut buf = Vec::new();
    f.read_to_end(&mut buf)?;
    Ok(buf)
}

fn page_ids_from_index(xml: &[u8]) -> Result<Vec<String>, Error> {
    let mut reader = Reader::from_reader(xml);
    let mut buf = Vec::new();
    let mut ids = Vec::new();
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) | Ok(Event::Empty(e)) if e.local_name().as_ref() == b"page" => {
                for a in e.attributes().flatten() {
                    if a.key.as_ref() == b"id" {
                        ids.push(String::from_utf8_lossy(&a.value).into_owned());
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(Error::Invalid(format!("index.xml: {e}"))),
            _ => {}
        }
        buf.clear();
    }
    Ok(ids)
}

fn page_dims(xml: &[u8]) -> Option<(f32, f32)> {
    let mut reader = Reader::from_reader(xml);
    let mut buf = Vec::new();
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) | Ok(Event::Empty(e)) if e.local_name().as_ref() == b"page" => {
                let (mut w, mut h) = (None, None);
                for a in e.attributes().flatten() {
                    let v = String::from_utf8_lossy(&a.value).parse::<f32>().ok();
                    match a.key.as_ref() {
                        b"width" => w = v,
                        b"height" => h = v,
                        _ => {}
                    }
                }
                return w.zip(h);
            }
            Ok(Event::Eof) | Err(_) => return None,
            _ => {}
        }
        buf.clear();
    }
}

const KNOWN: [&str; 6] = ["mimeType", "meta.json", "rel.json", "fileindex.json", "index.xml", "style.css"];

pub fn read(bytes: &[u8]) -> Result<Document, Error> {
    let mut zip = ZipArchive::new(Cursor::new(bytes))?;

    let mime = String::from_utf8_lossy(&read_entry(&mut zip, "mimeType")?).trim().to_string();
    if mime != MIME {
        return Err(Error::Invalid(format!("unexpected mimeType {mime:?}")));
    }

    for i in 0..zip.len() {
        let n = zip.by_index(i)?.name().to_string();
        if n == "index.bdom" || n.ends_with("/page.bdom") || n.ends_with("/ink.bink") {
            return Err(Error::UnsupportedBinary(n));
        }
    }

    let meta: Meta = serde_json::from_slice(&read_entry(&mut zip, "meta.json")?)?;
    let ids = page_ids_from_index(&read_entry(&mut zip, "index.xml")?)?;

    let mut pages = Vec::new();
    let mut claimed: Vec<String> = KNOWN.iter().map(|s| s.to_string()).collect();
    for id in &ids {
        safe_id(id)?;
        let (px, ink) = (format!("pages/{id}/page.xml"), format!("pages/{id}/ink.jink"));
        let (w, h) = page_dims(&read_entry(&mut zip, &px)?).unwrap_or((1404.0, 1872.0));
        let strokes = serde_json::from_slice::<InkFile>(&read_entry(&mut zip, &ink)?)?.strokes;
        claimed.push(px);
        claimed.push(ink);

        let mut objects = Vec::new();
        let obj_path = format!("pages/{id}/objects.json");
        if zip.file_names().any(|n| n == obj_path) {
            let file: ObjectsFile = serde_json::from_slice(&read_entry(&mut zip, &obj_path)?)?;
            claimed.push(obj_path);
            for ObjectMeta::Image { id: image_id, x, y, w, h, mime, media } in file.objects {
                let ext = ext_for(&mime)?;
                if media != format!("media/{}.{ext}", safe_id(&image_id)?) {
                    return Err(Error::Invalid(format!("image {image_id}: bad media path {media:?}")));
                }
                let data = base64::engine::general_purpose::STANDARD.encode(read_entry(&mut zip, &media)?);
                claimed.push(media);
                objects.push(PageObject::Image(ImageObject { id: image_id, x, y, w, h, mime, data }));
            }
        }
        pages.push(Page { id: id.clone(), width: w, height: h, strokes, objects });
    }

    let mut opaque = Vec::new();
    for i in 0..zip.len() {
        let mut f = zip.by_index(i)?;
        if f.is_dir() || claimed.iter().any(|c| c == f.name()) {
            continue;
        }
        let name = f.name().to_string();
        let mut data = Vec::new();
        f.read_to_end(&mut data)?;
        opaque.push(OpaqueEntry { name, data });
    }

    Ok(Document { title: meta.title, pages, opaque })
}
