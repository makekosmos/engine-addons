#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileSha256, sha256sums, validateComponents } from "./validate-components.mjs";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
for (const flag of ["--plan", "--assets", "--repository-commit", "--bom", "--components", "--sums"]) if (!args.get(flag)) throw new Error(`${flag} is required`);
const repositoryCommit = args.get("--repository-commit");
if (!/^[0-9a-f]{40}$/.test(repositoryCommit)) throw new Error("repository commit must be a full SHA");
const plan = JSON.parse(await readFile(args.get("--plan"), "utf8"));
const components = [];
for (const runtime of plan.runtimes ?? []) {
  const archivePath = path.join(args.get("--assets"), runtime.archive.name);
  const { sha256, size } = await fileSha256(archivePath);
  if (sha256 !== runtime.archive.sha256 || size !== runtime.archive.size) throw new Error(`${runtime.id}: reproducible archive hash or size mismatch`);
  components.push({
    id: runtime.id,
    kind: "runtime",
    version: runtime.version,
    platform: runtime.platform,
    architecture: runtime.architecture,
    backend: runtime.backend,
    accelerator: runtime.accelerator,
    release_tag: plan.release_tag,
    file: runtime.archive.name,
    url: runtime.archive.url,
    size: runtime.archive.size,
    sha256: runtime.archive.sha256,
    format: runtime.archive.format,
    entrypoints: runtime.entrypoints,
    files: runtime.archive.files,
    source: runtime.source,
    build: runtime.build,
    licences: runtime.licences,
  });
}
const bom = {
  schema_version: plan.schema_version,
  sequence: plan.sequence,
  generated_at: plan.generated_at,
  repository_commit: repositoryCommit,
  release_tag: plan.release_tag,
  runtimes: plan.runtimes,
};
const manifest = {
  schema_version: 2,
  sequence: plan.sequence,
  generated_at: plan.generated_at,
  components,
};
validateComponents(manifest);
await writeFile(args.get("--bom"), `${JSON.stringify(bom, null, 2)}\n`);
await writeFile(args.get("--components"), `${JSON.stringify(manifest, null, 2)}\n`);
// SHA256SUMS.txt in sha256sum format — the same contract native app releases
// use — covering every uploaded asset (archives + generated metadata).
const sums = [];
for (const { file } of components) sums.push({ file, sha256: (await fileSha256(path.join(args.get("--assets"), file))).sha256 });
sums.push({ file: path.basename(args.get("--bom")), sha256: (await fileSha256(args.get("--bom"))).sha256 });
sums.push({ file: path.basename(args.get("--components")), sha256: (await fileSha256(args.get("--components"))).sha256 });
await writeFile(args.get("--sums"), sha256sums(sums));
console.log(`Resolved ${components.length} reproducible component archives.`);
