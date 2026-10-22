# Changelog

All notable changes are documented here. Format based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/). While the version is 0.x, the file format
and APIs may change in any release.

## [Unreleased]

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
