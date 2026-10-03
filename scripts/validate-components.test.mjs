import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { preflight } from "./release-preflight.mjs";
import { assertSequence, parseSha256sums, sha256sums, validateComponents } from "./validate-components.mjs";

const bytes = await readFile(new URL("../components.json", import.meta.url));
const source = JSON.parse(bytes);
const fixedNow = new Date("2026-10-03T00:01:00Z");

test("accepts exact released metadata", () => assert.equal(validateComponents(source, { now: fixedNow }), true));

for (const [name, mutate, pattern] of [
  ["duplicate component IDs", (m) => m.components.push(structuredClone(m.components[0])), /duplicate component id/],
  ["archive traversal", (m) => { m.components[0].entrypoints = ["../runtime.exe"]; }, /unsafe/],
  ["non-string entrypoint", (m) => { m.components[0].entrypoints = [123]; }, /unique entrypoints/],
  ["wrong exact size", (m) => { m.components[0].size = 0; }, /exact size/],
  ["bad hash", (m) => { m.components[0].sha256 = "bad"; }, /SHA-256/],
  ["mutable release URL", (m) => { m.components[0].url = "https://raw.githubusercontent.com/makekosmos/engine-addons/main/x.zip"; }, /immutable versioned release/],
  ["future timestamp", (m) => { m.generated_at = "2026-10-04T00:00:00Z"; }, /future/],
  ["missing archive allowlist", (m) => { delete m.components[0].files; }, /allowlist/],
  ["unsafe archive allowlist member", (m) => { m.components[0].files.push("Release/whisper.dll:ads"); }, /unsafe/],
  ["entrypoint outside allowlist", (m) => { m.components[0].entrypoints = ["Release/evil.exe"]; }, /allowlist/],
  ["licence outside allowlist", (m) => { m.components[0].licences[0].path = "LICENSE.other.txt"; }, /allowlist/],
  ["backend/accelerator mismatch", (m) => { m.components[0].accelerator = "vulkan"; }, /mismatch/],
  ["case-colliding allowlist", (m) => { m.components[0].files.push("release/ggml-base.DLL"); }, /case-colliding/],
  ["Windows device name in allowlist", (m) => { m.components[0].files.push("NUL.txt"); }, /unsafe/],
  ["Windows reserved char in allowlist", (m) => { m.components[0].files.push("Release/evil?.dll"); }, /unsafe/],
  ["Windows device stem with whitespace", (m) => { m.components[0].files.push("NUL .txt"); }, /unsafe/],
  ["leading-space allowlist member", (m) => { m.components[0].files.push(" Release/ggml.dll"); }, /unsafe/],
  ["release tag for a different version", (m) => { m.components[0].url = "https://github.com/makekosmos/engine-addons/releases/download/runtime-v11.9.3/whisper-cpu-bin-x64-v1.9.3.zip"; }, /immutable versioned release/],
  ["release_tag not matching the URL tag", (m) => { m.components[0].release_tag = "runtime-v11.9.3"; }, /release_tag/],
  ["missing kind", (m) => { delete m.components[0].kind; }, /invalid kind/],
]) test(name, () => assert.throws(() => {
  const manifest = structuredClone(source);
  mutate(manifest);
  validateComponents(manifest, { now: fixedNow });
}, pattern));

test("sha256sums emits sha256sum format and parses back", () => {
  const text = sha256sums([
    { file: "b.zip", sha256: "b".repeat(64) },
    { file: "a.zip", sha256: "a".repeat(64) },
  ]);
  assert.equal(text, `${"a".repeat(64)}  a.zip\n${"b".repeat(64)}  b.zip\n`);
  const parsed = parseSha256sums(text);
  assert.equal(parsed.get("a.zip"), "a".repeat(64));
  assert.equal(parsed.get("b.zip"), "b".repeat(64));
});

test("sequence increments exactly once and timestamp increases", () => {
  const candidate = structuredClone(source);
  candidate.sequence += 1;
  candidate.generated_at = "2026-10-03T00:00:01Z";
  assert.equal(assertSequence(source, candidate), true);
  candidate.sequence += 1;
  assert.throws(() => assertSequence(source, candidate), /exactly once/);
  assert.throws(() => assertSequence({ ...source, generated_at: "not-a-timestamp" }, { ...source, sequence: source.sequence + 1, generated_at: "2026-10-03T00:00:01Z" }), /timestamp must increase/);
});

test("preflight rejects existing release and tag before publishing", () => {
  const candidate = structuredClone(source);
  assert.throws(() => preflight({ tag: "v1", existingTags: ["v1"], previous: source, candidate, now: fixedNow }), /tag already exists/);
  assert.throws(() => preflight({ tag: "v1", existingReleases: ["v1"], previous: source, candidate, now: fixedNow }), /release already exists/);
});

test("preflight rejects non-list tag/release observations", () => {
  const candidate = structuredClone(source);
  assert.throws(() => preflight({ tag: "v1", existingTags: "v1", previous: source, candidate, now: fixedNow }), /must be lists/);
  assert.throws(() => preflight({ tag: "v1", existingReleases: null, previous: source, candidate, now: fixedNow }), /must be lists/);
});
