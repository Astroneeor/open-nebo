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
    /// Archive member under `media/` drawn behind the ink (e.g. an imported PDF page).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub background: Option<String>,
    /// Per-page override of the notebook's canvas background style.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style: Option<BackgroundStyle>,
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
    Shape(Shape),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ShapeKind {
    Line,
    Arrow,
    Ellipse,
    Rect,
    Triangle,
}

/// A clean geometric shape produced by smart-shape recognition.
///
/// `points` by kind: `line`/`arrow` = `[start, end]` (arrow head at `end`);
/// `rect` = 4 corners in order; `triangle` = 3 corners;
/// `ellipse` = `[center, [rx, ry]]` (axis-aligned).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Shape {
    pub id: String,
    pub kind: ShapeKind,
    #[serde(default = "default_color")]
    pub color: String,
    #[serde(default = "default_width")]
    pub width: f32,
    pub points: Vec<[f32; 2]>,
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
    /// Where the image came from, e.g. `pdf` for pages placed on the canvas by PDF import.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

/// Patterns accepted for `BackgroundStyle::pattern`.
pub const PATTERNS: [&str; 4] = ["plain", "paper", "grid", "dot"];

/// Canvas background: a pattern drawn over a base colour. The line/dot ink is derived from the
/// base colour by the UI, so only these two values are stored.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BackgroundStyle {
    /// One of [`PATTERNS`].
    pub pattern: String,
    /// Base colour as `#rrggbb`.
    pub color: String,
}

impl BackgroundStyle {
    pub fn is_valid(&self) -> bool {
        let c = self.color.as_bytes();
        PATTERNS.contains(&self.pattern.as_str())
            && c.len() == 7
            && c[0] == b'#'
            && c[1..].iter().all(u8::is_ascii_hexdigit)
    }
}

impl Page {
    pub fn new(id: impl Into<String>) -> Self {
        Self { id: id.into(), width: 1404.0, height: 1872.0, background: None, style: None, strokes: Vec::new(), view: None, objects: Vec::new() }
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
    /// Notebook default background; pages without their own `style` use it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style: Option<BackgroundStyle>,
    #[serde(skip)]
    pub opaque: Vec<OpaqueEntry>,
}

impl Document {
    pub fn new(title: impl Into<String>) -> Self {
        Self { title: title.into(), pages: vec![Page::new("page-1")], style: None, opaque: Vec::new() }
    }
}
