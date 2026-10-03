# Engine add-ons publication contract

## Immutable inputs

The reviewed BOM is the sole build/publication input. It pins the repository commit, upstream source commit, release tag, sequence, timestamp, toolchain, recipe, complete archive allowlist, entrypoints, SPDX licence files, exact SHA-256, and exact byte size. Branch names, `latest` URLs, workflow source edits, and discovered files are forbidden inputs.

## Ordered gates

The production job MUST execute these gates in order and stop on the first failure:

1. Checkout the exact 40-character BOM commit and verify a clean tree.
2. Validate BOM schema, unique component coordinates, canonical UTC timestamp (not more than five minutes in the future), and `previous.sequence + 1`.
3. Resolve/import upstream material by the exact source commit and build with the declared recipe/toolchain.
4. Inspect each ZIP with `scripts/inspect_archives.py`; verify allowlisted paths, no traversal/symlinks/encryption/collisions/bombs, x64 PE entrypoints, licence files, SHA-256, and byte size.
5. On Windows, smoke-test `--version`, startup, clean shutdown, CPU inference, Vulkan capability, and documented CPU fallback.
6. Query GitHub and reject an existing tag or release. Run `release-preflight.mjs` against the previous published `components.json`.
7. Create an immutable release, upload the already-hashed bytes, `components.json`, `SHA256SUMS.txt`, provenance statement, and BOM. Re-download all assets and re-verify every file against `SHA256SUMS.txt` before marking the run successful.

The release must fail closed if the hosting platform cannot guarantee immutability. A rerun uses a new tag and sequence; it never edits an existing release.

## Trust anchor

There is no signing step and no trusted-keys material. The Engine does not read `components.json` or `SHA256SUMS.txt` at runtime for the whisper.cpp zips — it compiles the URL, byte size and SHA-256 into the Engine binary itself and installs an archive only when both match. `SHA256SUMS.txt` follows the same format native app releases use and is what post-publish re-verification and any future runtime-checked components consume.

## Rollback

Releases are append-only. Rollback selects a previously published, non-superseded component coordinate; it does not replace an asset or decrement the published sequence. A bad component is superseded by a later release with a new sequence pointing to the corrected artifact.
