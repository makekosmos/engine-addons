#!/usr/bin/env node
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { preflight } from "./release-preflight.mjs";
import { sha256sums, validateComponents } from "./validate-components.mjs";

// Deterministic, secret-free dry-run: validate the published component list,
// build a fixture candidate on top of it, run the release preflight and emit
// the SHA256SUMS.txt payload — no network, no keys (there are none anymore).
const previousBytes = await readFile(new URL("../components.json", import.meta.url));
const previous = JSON.parse(previousBytes);
validateComponents(previous);

const previousAt = Date.parse(previous.generated_at);
if (!Number.isFinite(previousAt)) throw new Error("previous manifest timestamp is invalid");
const candidateAt = previousAt + 1000;
const candidateStamp = new Date(candidateAt).toISOString().replace(/\.\d{3}Z$/, "Z");

const tag = "component-v2.0.0";
const candidate = {
  schema_version: 2,
  sequence: previous.sequence + 1,
  generated_at: candidateStamp,
  components: [{
    id: "fixture-component", kind: "runtime", version: "2.0.0", platform: "windows", architecture: "x64", backend: "cpu", accelerator: "none",
    release_tag: tag,
    entrypoints: ["bin/runtime.exe"],
    file: "fixture-component.zip",
    url: `https://github.com/makekosmos/engine-addons/releases/download/${tag}/fixture-component.zip`,
    sha256: "a".repeat(64), size: 123, format: "zip",
    files: ["bin/runtime.exe", "LICENSE.txt"],
    source: { project: "fixture/upstream", version: "2.0.0", commit: "b".repeat(40) },
    build: { recipe: "fixtures/build.ps1", toolchain: "fixture-msvc" },
    licences: [{ spdx: "MIT", path: "LICENSE.txt" }],
  }],
};
preflight({ tag, existingTags: [], existingReleases: [], previous, candidate, now: new Date(candidateAt + 59_000) });

const sums = sha256sums(candidate.components.map(({ file, sha256 }) => ({ file, sha256 })));
const fingerprint = crypto.createHash("sha256").update(JSON.stringify({ candidate, sums })).digest("hex");
console.log(`Deterministic secret-free dry-run passed: ${fingerprint}`);
