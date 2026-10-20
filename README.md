# Open Nebo

An open-source, cross-platform (Linux + Windows) notebook app that reads and writes
`.nebo`-style MyScript iink packages and is built to live in a folder synced by
[Syncthing](https://syncthing.net), the same way an Obsidian vault does.

**Status: early.** Ink capture, pages, eraser, undo, autosave and the sync-safety
layer work. See limitations below before pointing it at real Nebo notebooks.

## Layout

- `crates/nebo-core` — package format + vault/sync-safety logic (tested, no GUI).
- `src-tauri` — Tauri 2 desktop shell. `ui/` — plain HTML/JS canvas front end.
- `docs/NEBO_FORMAT_FINDINGS.md` — what was recovered about the Nebo format, and what's unknown.

## Syncing with Syncthing

Point Syncthing at your notebook folder (default `~/Documents/Nebo`) on each device and
choose the same folder in the app. The app:

- saves atomically via `.syncthing.<name>.tmp` + rename, so half-written files never sync;
- refuses to overwrite a file whose contents changed on disk since you opened it
  (revision check) and tells you instead of clobbering a synced version;
- reloads open notebooks when Syncthing delivers a newer version and you have no unsaved edits;
- lists `*.sync-conflict-*` copies, flagged;
- keeps no lock files in the folder. "Create .stignore" adds a minimal ignore file.

## Build

```
cargo test -p nebo-core
cd src-tauri && cargo tauri dev        # needs: cargo install tauri-cli --version "^2"
cargo tauri build
```

Linux needs `webkit2gtk-4.1`. Windows builds come from the GitHub Actions workflow
(`.github/workflows/build.yml`, `windows-latest`, WebView2); they have not been built or run yet.

## Limitations (important)

- **Compatibility with files saved by the real Nebo is unverified.** The container layout
  was inferred from strings in the Nebo 6.3 binaries; no real `.nebo` file has been tested.
  The `ink.jink` JSON schema written here is this project's own.
- Files using Nebo's binary members (`*.bdom`, `*.bink`) are rejected with a clear error,
  not guessed at. Unknown archive members are preserved on save.
- No handwriting recognition. MyScript's engine is proprietary; a recognizer plug-in point is future work.
- No PDF import/export, shapes, math, or text-block editing.
- Not tested with a physical pen/touch device.

## Disclaimer

Open Nebo is an independent project and is not affiliated with or endorsed by MyScript /
Myscript SAS. "Nebo" and "MyScript" are trademarks of their owners. No MyScript code, models
or assets are included; file-format notes come from inspecting a publicly distributed app
package for interoperability. Licensed under MIT (see `LICENSE`).
