# Changelog

All notable changes are documented here. Format based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/). While the version is 0.x, the file format
and APIs may change in any release.

## [Unreleased]

### Changed
- Notebooks are now `.onb` files ("Open Nebo Book") with MIME `application/vnd.opennebo+zip`.
  The package no longer claims MyScript's `application/vnd.myscript.nebo`, and the app's file
  association is `.onb` only (it no longer registers `.nebo`).
- Legacy `.nebo` files written by 0.1.x still open (the old MIME is accepted on read). Saving one
  writes the same-named `.onb` beside it and leaves the original untouched; the notebook list hides
  a `.nebo` once its `.onb` exists. Conflict copies are listed for both extensions.
- The `index.xml` namespace is now Open Nebo's own. Real Nebo compatibility is out of scope.

### Added
- Insert menu with coordinate grids (10x10 for -5..5, 20x20 for -10..10), blank axes and
  configurable graph paper. Graphs are vector page objects (`pages/<id>/objects.json`) that
  can be selected, moved, resized, duplicated, deleted and edited (ranges, step, grid/axes/numbers).
- Select tool.
- PDF import: each PDF page becomes a notebook page with the rendered page as a background
  (`media/page-N.png` in the package, preserved on roundtrip). Rendering uses a vendored pdf.js.
- PDF export: pages are composited (background + ink) and written as a PDF.
- `Page.background` (optional, backwards compatible).
- Redo (button, Ctrl+Shift+Z, Ctrl+Y) on one shared history (`ui/history.js`) that covers strokes,
  shape snaps, erasing, image/graph/shape add, move, scale, delete, paste, reorder, flip, recolor and
  graph parameter edits. A new action clears the redo stack.
- The Select tool (lasso, marquee, click, Shift-click) now covers graphs and shapes as well as strokes and
  images. They stay vector objects through copy, cut, paste and duplicate. Shapes can be recoloured.
  A tap selects a graph; a drag that starts on an unselected graph is a lasso, so you can still select ink
  written on it. The graph parameter panel follows the selection.

- Canvas backgrounds: plain, paper (lined), grid and dot patterns over any base colour, with presets for each
  in light and dark. The line/dot ink is derived from the base colour (a darker tint on light bases, a lighter
  one on dark bases). Set per notebook (`Document.style`, `meta.json`) with an optional per-page override
  (`Page.style`, `pattern`/`bgcolor` attributes in `page.xml`). Drawn in world space so it tiles across the
  infinite canvas and thins out when zoomed far out. A Background popover (presets, pattern, swatches, custom
  colour, "Apply to all pages") and PDF export both use it.

### Changed
- The page `template` field (lined/grid/dotted) is replaced by the background style. Old files with a
  `template` attribute still open and are mapped to `paper`/`grid`/`dot` on white; they are saved in the new form.

### Fixed
- Strokes did not render after the PDF merge: `strokes.forEach(drawStroke)` passed the index as
  `drawStroke`'s new canvas-context parameter.
- Erasing was not undoable.

## [0.1.1] - 2026-10-22

First packaged release (same feature set as 0.1.0; installers for Linux and Windows).

## [0.1.0] - 2026-10-20

### Added
- `nebo-core`: reader/writer for an iink-style `.nebo` ZIP package (text variants only),
  preserving unknown archive members.
- Syncthing-safe vault handling: atomic saves, revision-checked overwrites, conflict-copy listing.
- Tauri 2 desktop app: pen with pressure, eraser, undo, pages, autosave, reload on sync.
- CI for Linux and Windows bundles.

### Known limitations
- Compatibility with files written by the real Nebo is unverified (no sample file tested).
- Binary `.bdom`/`.bink` members are rejected. No handwriting recognition.

[Unreleased]: https://github.com/Astroneeor/open-nebo/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/Astroneeor/open-nebo/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Astroneeor/open-nebo/releases/tag/v0.1.0
