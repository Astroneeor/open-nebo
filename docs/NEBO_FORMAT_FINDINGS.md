# Nebo (.nebo) reverse-engineering findings

Target: `VisionObjects.MyScriptNebo_6.3.17303.0` (MSIX bundle, x64), SHA-256 of the
supplied zip: `a020c7e6b75093b552bc5b6c8f8c22761658650839f8813b8c6e52fdc1a7e4be`.

Method so far: package inventory + string extraction from the native DLLs.
**No decompilation yet, and no real `.nebo` sample was available** (none is
bundled in the package). Everything below is inference from strings unless noted.

## Application

- WinUI/C++-CX app (`MyScript.Nebo.dll`, native PE, not .NET) with SQLite (`e_sqlite3.dll`),
  SkiaSharp, WebView2, PDFTron (`PDFNetC.dll`) for PDF import/export.
- Recognition: MyScript iink engine (`MyScriptText/Math/Shape/Gesture/Analyzer/Engine/Ink/Document.dll`)
  with proprietary `.res` models under `resources/` and `conf/*.conf`. **Not reusable or
  reimplementable here**; the open version must use a pluggable recognizer.
- Registers the `.nebo` extension; MIME `application/vnd.myscript.nebo`
  (`application/vnd.myscript.neboversion` also appears in `MyScript.Atk.dll`).
- Cloud sync (AWS SDK, Google OAuth redirect) exists in the app. It is unrelated to
  Syncthing syncing of plain files and is not needed for this project.

## Container (from `MyScriptDocument.dll` / `MyScriptEngine.dll` / `MyScriptInk.dll`)

`.nebo` is a MyScript iink document package, registered next to `.iink`
(`application/vnd.myscript.iink`) and `.notes`. It is a ZIP (`zip://` URLs, `voZipExtractor`).
Entry names seen as strings:

| Entry | Notes |
|---|---|
| `mimeType` | Package MIME type, `application/vnd.myscript.nebo` |
| `meta.json` | Contains `format-version` |
| `rel.json` | Relations between document objects |
| `fileindex.json` | Index of object files (`contentType`, `deleted`, `refCount`, `removed`, `title`) |
| `index.xml` or `index.bdom` | Document index (namespace `http://www.myscript.com/ns/myscript/document`) |
| `pages/<id>/page.xml` or `page.bdom` | Page content tree (`/page/content`, `/page/layout/layers/layer`) |
| `pages/<id>/ink.jink` or `ink.bink` | Stroke data. JSON-ish "jink"/"jinkson" vs binary "bink" |
| `style.css` | Styles |

- `.bdom` (`application/vnd.myscript.bdom`) and `.bink` (`application/vnd.myscript.bink`) are
  binary encodings; `.bink` has `compression-level=1..3`. Their layouts are **unknown**.
- Whether Nebo 6.3 writes the XML/JSON or the binary variants is **unknown** until a real file is seen.
- Document corruption checks listed in the engine hint at structure rules: pages need a content node,
  content fields need unique tag IDs, a file index needs `document` and `pages`/`objects` nodes.

## Open questions (need a real .nebo sample or decompilation)

1. XML/JSON vs bdom/bink variants in files written by Nebo.
2. Exact `bink` and `bdom` binary layouts.
3. Nebo-specific entries beyond the generic iink package (notebook hierarchy, covers, page backgrounds,
   `neboversion`).
4. Whether pre-6.x notebooks use a different layout (the app has a `MigrationAssistant`).

## Syncthing approach (design, not yet built)

Syncthing syncs plain folders, so the app needs no sync protocol, only to be safe in a synced folder:
atomic saves (write temp, fsync, rename), no lock files inside the vault, a file watcher to reload on
external change, a debounce so half-synced files are not opened, and handling of
`*.sync-conflict-*` files. Keep app state outside the synced folder.
