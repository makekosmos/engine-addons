# Mundus engine add-ons

This repository is the build and publication channel for heavy optional Engine components: local AI runtimes, models and similar assets that not every user needs. Component binaries are forbidden on the active source branch. New binaries must be immutable, versioned GitHub release assets described by an exact reviewed BOM.

## Trust model

No signing keys. The Engine compiles each component's URL, byte size and SHA-256 into its own binary and installs an archive only when both match — the same HTTPS + GitHub Releases + pinned-hash model the Engine self-updater (`latest.yml` sha512) and native apps (`SHA256SUMS.txt`) already use. The earlier Ed25519 manifest envelope was removed in KOS-321: it re-checked exactly the same constants and protected only one of three download paths.

Each release also carries `SHA256SUMS.txt` (sha256sum format) covering every uploaded asset, and `components.json`, the published catalogue of add-ons (id, kind, platform, version, file, size, sha256) — documentation and build input, not something the Engine fetches at runtime.

## Current release

`components.json` describes the immutable tag `runtime-v1.9.3`: reproducible CPU and Vulkan whisper.cpp builds from the full upstream v1.9.3 commit, with the compiler recipe, Vulkan SDK installer hash, complete archive allowlists, exact sizes and hashes pinned.

## Local verification

```powershell
bun install
bun run check
```

The repository has no package dependencies, so Bun intentionally produces no
lockfile. The pinned Bun 1.3.14 install configures repository-owned pre-commit
and pre-push hooks without downloading packages.
The dry-run is deterministic and offline: it validates the component list, runs the release preflight on a fixture candidate and emits the SHA256SUMS.txt payload. It uses no network and no secrets — there are none.

Archive validation uses only the Python standard library and rejects traversal, absolute/drive/backslash paths, symlinks, encryption, case collisions, undeclared files, ZIP bombs, missing licences, bad hash/size, and non-x64 PE entrypoints.

## Publication model

1. Review the release plan and its full upstream commit, toolchain inputs, allowlists, and expected hashes.
2. Import/build assets in a clean job; do not accept mutable branch URLs.
3. Run `inspect_archives.py` and Windows CPU/Vulkan/startup/shutdown smoke tests.
4. Query GitHub for an existing tag or release and compare the previous component sequence (`release-preflight.mjs`).
5. Create a draft, upload only the already-verified bytes — archives, `release-bom.v1.json`, `components.json`, `SHA256SUMS.txt` — and publish it under repository-enforced release immutability. Re-download and re-verify every asset against `SHA256SUMS.txt`.

Dispatch `Build and publish engine add-ons` with only `bom_ref=<full main commit SHA>`.

Detailed requirements are in [docs/publication-contract.md](docs/publication-contract.md). The consumer contract for the Engine is in [docs/cortex-agent-contract.md](docs/cortex-agent-contract.md). Do not edit Cortex from this repository.
