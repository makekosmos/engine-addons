# Engine-side consumer contract

This document describes what the Engine (cortex `runtime/src/dictation/local_models/`) does with the assets published from this repository. **Do not change this repository contract while implementing Cortex.**

## Trust model

There is no signing. Each component zip's URL, byte size and SHA-256 are compile-time constants inside the released Engine binary — the strongest trust anchor available, since Engine updates themselves are hash-verified (`latest.yml` sha512). An archive installs only when **both** the pinned size and the pinned sha256 match (`crate::file_hash::verify_size_and_sha256`, the single verifier shared with native apps and the updater).

Downloads must use versioned `https://github.com/makekosmos/engine-addons/releases/download/<tag>/<file>` URLs. Runtime downloads may only complete on the allowlisted GitHub release hosts (`github.com`, `release-assets.githubusercontent.com`); a redirect anywhere else fails closed. Streaming enforces a hard byte limit equal to the pinned size, rejects HTML/JSON error bodies, and resumes through `.part` files with `Range` requests.

## Install state machine (whisper.cpp runtime)

Any failure before the commit leaves the previous install untouched; a failed archive or staging result is moved to `.<dir>.quarantine[.zip]` for inspection.

1. Download the pinned URL to a sibling `.<name>.download` file with the byte limit.
2. Verify exact byte size, then SHA-256; on mismatch the archive is quarantined and nothing is installed.
3. Inspect the ZIP before extraction: exact allowlist of member names, no traversal/backslash/ADS/NUL/duplicates/case-collisions, regular files only, per-entry and total size limits, decompression-ratio cap, and x64 PE machine type on every `.exe`/`.dll`.
4. Extract into a fresh `.<dir>.staging` directory with create-new semantics; write `.runtime-version` and `.runtime-integrity.json` (per-file sha256 set); run `whisper-cli.exe --version` as a smoke test.
5. Atomically swap `staging → <dir>` under a `.<dir>.transaction` marker so a crash mid-swap is recovered on the next install attempt.

## Reinstall checks

A present runtime is reused only when `.runtime-version` matches the compiled version and every file's sha256 matches `.runtime-integrity.json`. A Vulkan install without `whisper-server.exe` is treated as outdated and re-downloaded.

## Adding new components

New heavy components get a `kind` + pinned coordinate in the Engine source and an entry in `components.json`. This file is documentation/build input — the Engine never fetches it.
