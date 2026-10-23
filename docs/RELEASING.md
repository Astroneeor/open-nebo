# Releasing Open Nebo

## Steps

1. Pick the version `x.y.z` (SemVer; while 0.x the file format and APIs may change in any release).
2. Bump the version in **all three** places, which must agree:
   - `src-tauri/Cargo.toml` (`version`)
   - `src-tauri/tauri.conf.json` (`version`)
   - `crates/nebo-core/Cargo.toml` (`version`), then run `cargo build` so `Cargo.lock` updates.
3. In `CHANGELOG.md`, rename `## [Unreleased]` content into a new `## [x.y.z] - YYYY-MM-DD`
   section (keep an empty `[Unreleased]` above it). The release job publishes exactly this
   section as the GitHub release notes.
4. Run the tests: `cd ui && node --test` and `cargo test -p nebo-core`.
5. Commit, merge to `main`, then tag and push: `git tag vX.Y.Z && git push origin vX.Y.Z`.

## What CI produces

The `build` workflow runs `cargo clippy` and `cargo test` for `nebo-core` and `node --test` for the
UI. If both pass it bundles on Ubuntu 22.04 and Windows. On a `v*` tag the `release` job then:

- fails if the tag differs from the version in `src-tauri/Cargo.toml` or `src-tauri/tauri.conf.json`;
- creates a GitHub release (marked pre-release while the version is 0.x) with the CHANGELOG
  section as notes, or GitHub-generated notes if the section is missing;
- attaches Linux `.deb`, `.AppImage`, `.rpm`, Windows `.msi` and NSIS `.exe`, plus `SHA256SUMS.txt`
  (verify with `sha256sum -c SHA256SUMS.txt`).

Installers are unsigned, so Windows SmartScreen will warn on first run.

## Auto-update

Auto-update (the Tauri updater plugin) is intentionally not configured. It requires a private
signing key stored as a CI secret and a hosted update manifest, and shipping it without that key
management would either fail or ship an insecure updater. Users update by installing the new
release. Revisit once code signing and a key custody plan exist.
