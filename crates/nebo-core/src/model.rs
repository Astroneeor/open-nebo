use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Point {
    pub x: f32,
    pub y: f32,
    /// Milliseconds since stroke start.
    #[serde(default)]
    pub t: u32,
    /// Pen pressure, 0.0..=1.0.
    #[serde(default = "default_pressure")]
    pub p: f32,
}

fn default_pressure() -> f32 {
    0.5
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Stroke {
    pub id: String,
    #[serde(default = "default_color")]
    pub color: String,
    #[serde(default = "default_width")]
    pub width: f32,
    pub points: Vec<Point>,
}

fn default_color() -> String {
    "#000000".into()
}

fn default_width() -> f32 {
    2.0
}

/// Last pan/zoom of a page on the infinite canvas. `x`/`y` is the world point
/// at the top-left of the viewport; `zoom` is screen pixels per world unit.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct View {
    pub x: f32,
    pub y: f32,
    pub zoom: f32,
}

/// `width`/`height` are the size of the original paper sheet, kept for files
/// written before the canvas became infinite; strokes may now lie outside it
/// (negative coordinates included).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Page {
    pub id: String,
    pub width: f32,
    pub height: f32,
    pub strokes: Vec<Stroke>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub view: Option<View>,
    /// Non-ink objects, drawn in order (later = on top), beneath the strokes.
    /// x/y/w/h are in the same page coordinate space as stroke points.
    #[serde(default)]
    pub objects: Vec<PageObject>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum PageObject {
    Image(ImageObject),
    Graph(GraphObject),
}

/// A coordinate grid / graph-paper block. Height follows from `size` (the
/// width in page units) and the axis ranges, so cells stay square.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GraphObject {
    pub id: String,
    /// Top-left corner in page units.
    pub x: f32,
    pub y: f32,
    pub size: f32,
    pub xmin: f32,
    pub xmax: f32,
    pub ymin: f32,
    pub ymax: f32,
    #[serde(default = "default_step")]
    pub step: f32,
    #[serde(default = "yes")]
    pub labels: bool,
    #[serde(default = "yes")]
    pub axes: bool,
    #[serde(default = "yes")]
    pub grid: bool,
}

fn default_step() -> f32 {
    1.0
}

fn yes() -> bool {
    true
}


/// A pasted/dropped raster image. In memory (and over IPC) the bytes travel as
/// base64 in `data`; in the package they live in `media/<id>.<ext>`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ImageObject {
    pub id: String,
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
    /// image/png, image/jpeg, image/gif or image/webp.
    pub mime: String,
    #[serde(default)]
    pub data: String,
}

impl Page {
    pub fn new(id: impl Into<String>) -> Self {
        Self { id: id.into(), width: 1404.0, height: 1872.0, strokes: Vec::new(), view: None, objects: Vec::new() }
    }
}

/// An archive member this crate does not interpret. Kept verbatim so that
/// files written by other apps round-trip without losing data.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OpaqueEntry {
    pub name: String,
    pub data: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Document {
    pub title: String,
    pub pages: Vec<Page>,
    #[serde(skip)]
    pub opaque: Vec<OpaqueEntry>,
}

impl Document {
    pub fn new(title: impl Into<String>) -> Self {
        Self { title: title.into(), pages: vec![Page::new("page-1")], opaque: Vec::new() }
    }
}
