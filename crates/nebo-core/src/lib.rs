pub mod model;
pub mod package;
pub mod vault;

pub use model::{Document, Page, Point, Stroke};

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("zip: {0}")]
    Zip(#[from] zip::result::ZipError),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    #[error("invalid document: {0}")]
    Invalid(String),
    #[error("binary member {0} is not supported yet (file was written by Nebo?)")]
    UnsupportedBinary(String),
    #[error("{0} changed on disk since it was opened (probably synced from another device)")]
    Conflict(String),
}
