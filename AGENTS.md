# local-ai-runtimes: agent instructions

## Scope and entry points

Metadata and verification source for the managed local AI runtimes
(whisper.cpp builds consumed by the Engine's dictation). **Runtime binaries
are forbidden on the source branch** — assets are immutable, versioned
GitHub release artifacts described by a reviewed BOM plus a signed manifest
envelope.

- `runtimes.manifest.json` — the released signed manifest (sequence N for
  tag `runtime-vX.Y.Z`): upstream commit, toolchain recipe, archive
  allowlists, exact sizes and hashes.
- `release/*.plan.json` — reviewed release plans input to the pipeline.
- `trusted-keys.json` — public-key allowlist with `not_before`/`not_after`
  and revoked-sequence rules.
- `release-bom.schema.json` — BOM schema.
- `scripts/` — validation, signing dry-run, archive inspection (Python
  stdlib only), release resolution/preflight.
- `docs/publication-contract.md` — full publication requirements;
  `docs/cortex-agent-contract.md` — the consumer contract handed to Cortex.
- `.github/workflows/` — publish pipeline (`publish.yml`, dispatch-only with
  `bom_ref=<full main commit SHA>`) and quality gate. Keep them working.

## Setup and verification

```powershell
bun install        # installs repo-owned pre-commit/pre-push hooks
bun run check      # check:metadata + check:archive
```

`check:metadata` = `validate-manifest.mjs` + `validate-plan.mjs` +
`node --test scripts/*.test.mjs` + `check-json.mjs`. `check:archive` =
Python `unittest` suites + `dry-run.mjs` (deterministic, offline, RFC 8032
public test vector — never reads a production secret).

## Invariants

- Never commit binaries, archives, secrets, private keys, or captured data.
- Never rewrite a historical envelope or reuse a sequence number; each
  manifest binds a `key_id` and a monotonically increasing sequence.
- Assets must be immutable release artifacts built from full-commit-pinned
  sources — no mutable branch URLs.
- The signing private key exists only in the protected production
  environment; the Windows build job has no signing secret. Never widen
  secret exposure.
- Archive inspection must keep rejecting traversal, absolute/drive/
  backslash paths, symlinks, encryption, case collisions, undeclared files,
  ZIP bombs, missing licences, bad hash/size, non-x64 PE entrypoints.
- Do not edit Cortex from this repo — consumer integration goes through
  `docs/cortex-agent-contract.md`.

## Completion

- One logical change per commit; no drive-by refactors.
- `bun run check` green before pushing; hooks must not be bypassed.
- Report exact commands and PASS / FAIL / NOT_RUN with reasons.
- Do not dispatch the publish workflow, tag, or rotate keys unless
  explicitly authorized.
