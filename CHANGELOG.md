# Changelog

All notable changes are documented here. Format based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/). While the version is 0.x, the file format
and APIs may change in any release.

## [Unreleased]

## [0.2.0] - 2026-10-22

Tablet-readiness release: more pen types, layers, text, a page sidebar, richer backgrounds,
export, shortcuts, search and rendering that scales. None of the new interface has been used
with a physical pen or touch device yet, and the Windows build is unverified.

### Added
- **Pen types:** highlighter (one translucent path, no overlap darkening), pencil and marker next to the
  pressure pen, each with its own default width; the last choice is remembered. Strokes record `kind` and
  `opacity` (files from 0.1.x read as plain pens).
- **Eraser variants:** stroke, point (splits a stroke at the erased part) and highlighter-only.
- **Layers:** a layers panel (add, rename, reorder, hide, lock, move selection, merge down). Hidden layers are
  not drawn, exported or hit-tested; locked layers cannot be edited or erased. Layer edits are undoable.
  Stored as `Page.layers` plus an optional `layer` id on every item.
- **Text tool:** typed, wrapped text boxes (size, bold, italic, colour) that select, move, scale, copy and
  export to PDF like other objects. Stored as `text` page objects.
- **Page sidebar:** live thumbnails with drag-to-reorder, duplicate, delete, insert before and add after.
  The "+ Page" button now inserts after the current page.
- **Backgrounds:** nine fixed presets (light and dark plain, paper, dot grid and grid, plus blueprint), five
  more lattices and guides (isometric, triangle, one-, two- and three-point perspective), a generated paper
  grain, and **automatic ink**: switching between a light and a dark background swaps black and light ink.
- **Snap to grid** for smart shapes and moved selections on grid, dot and triangle backgrounds.
- **PNG and SVG export** (current page or all pages; background, grid and scale options) beside PDF.
- **Keyboard shortcuts** editor (click to record, conflict warnings, reset) and an accessibility pass
  (focus rings, `aria-pressed`, Escape returns focus, status live region, contrast-checked text colours).
- **Stylus input:** palm rejection, touch-pans-once-a-pen-is-seen, barrel-button and eraser-end actions, and a
  settings popover with a pointer diagnostics line.
- **Search** of typed text across all notebooks in the library, with page-level results.
- **Rendering for big notebooks:** a spatial index with viewport culling, level of detail when zoomed out and
  frame coalescing. On a synthetic 50,000-stroke page about 2% of strokes are drawn at 100% zoom.
- CI runs the JavaScript tests and clippy, release notes come from this file, and releases ship `SHA256SUMS.txt`
  and `.rpm`/`.AppImage` bundles in addition to `.deb`, `.msi` and `.exe`. See `docs/RELEASING.md`.

### Changed
- Visual redesign: a slim top bar, a floating, collapsible tool palette and icons in place of text
  buttons (Lucide, ISC licence, vendored as `ui/icons.js`). One design system in `ui/style.css`
  (colour, radius, shadow and type tokens) with light and dark themes that follow the system and a
  manual toggle (remembered). Popovers, menus and dialogs share one look. The library has compact
  folder tiles, a search field with an icon and a **New** menu. The canvas colour still comes from the
  notebook's background setting, not the theme.
- The pen size slider moved into a popover with a live preview.
- Notebooks are now `.onb` files ("Open Nebo Book") with MIME `application/vnd.opennebo+zip`.
  The package no longer claims MyScript's `application/vnd.myscript.nebo`, and the app's file
  association is `.onb` only (it no longer registers `.nebo`).
- Legacy `.nebo` files written by 0.1.x still open (the old MIME is accepted on read). Saving one
  writes the same-named `.onb` beside it and leaves the original untouched; the notebook list hides
  a `.nebo` once its `.onb` exists. Conflict copies are listed for both extensions.
- The `index.xml` namespace is now Open Nebo's own. Real Nebo compatibility is out of scope.

### Fixed
- A stroke whose pointer event reported an empty coalesced-event list ended up a single dot; it now falls back
  to the event itself.
- A notebook opened from the library was fitted to a zero-width hidden editor, so it came up at 5% zoom
  (the minimum) and stayed there. The view now waits until the editor is visible.
- The colour wheel is no longer drawn solid black while a black colour is selected.

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

- Canvas backgrounds: plain, paper (lined), grid and dot patterns, with presets for each in light and dark. The line/dot ink is derived from the base colour (a darker tint on light bases, a lighter
  one on dark bases). Set per notebook (`Document.style`, `meta.json`) with an optional per-page override
  (`Page.style`, `pattern`/`bgcolor` attributes in `page.xml`). Drawn in world space so it tiles across the
  infinite canvas and thins out when zoomed far out. A Background popover (fixed presets and "Apply to all
  pages", no colour settings) and PDF export both use it.

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

[Unreleased]: https://github.com/Astroneeor/open-nebo/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/Astroneeor/open-nebo/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/Astroneeor/open-nebo/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Astroneeor/open-nebo/releases/tag/v0.1.0
