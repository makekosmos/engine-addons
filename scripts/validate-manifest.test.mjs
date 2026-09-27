import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { preflight } from "./release-preflight.mjs";
import { assertSequence, validateManifest, verifyEnvelope } from "./validate-manifest.mjs";

const bytes = await readFile(new URL("../runtimes.manifest.json", import.meta.url));
const source = JSON.parse(bytes);
const fixedNow = new Date("2026-09-01T00:01:00Z");

test("accepts exact released metadata", () => assert.equal(validateManifest(source, { now: fixedNow }), true));

for (const [name, mutate, pattern] of [
  ["duplicate runtime IDs", (m) => m.runtimes.push(structuredClone(m.runtimes[0])), /duplicate runtime id/],
  ["archive traversal", (m) => { m.runtimes[0].entrypoints = ["../runtime.exe"]; }, /unsafe/],
  ["non-string entrypoint", (m) => { m.runtimes[0].entrypoints = [123]; }, /unique entrypoints/],
  ["wrong exact size", (m) => { m.runtimes[0].archive.size = 0; }, /exact size/],
  ["bad hash", (m) => { m.runtimes[0].archive.sha256 = "bad"; }, /SHA-256/],
  ["mutable release URL", (m) => { m.runtimes[0].archive.url = "https://raw.githubusercontent.com/makekosmos/local-ai-runtimes/main/x.zip"; }, /immutable versioned release/],
  ["future timestamp", (m) => { m.generated_at = "2026-09-02T00:00:00Z"; }, /future/],
  ["missing archive allowlist", (m) => { delete m.runtimes[0].archive.files; }, /allowlist/],
  ["unsafe archive allowlist member", (m) => { m.runtimes[0].archive.files.push("Release/whisper.dll:ads"); }, /unsafe/],
  ["entrypoint outside allowlist", (m) => { m.runtimes[0].entrypoints = ["Release/evil.exe"]; }, /allowlist/],
  ["licence outside allowlist", (m) => { m.runtimes[0].licences[0].path = "LICENSE.other.txt"; }, /allowlist/],
  ["backend/accelerator mismatch", (m) => { m.runtimes[0].accelerator = "vulkan"; }, /mismatch/],
  ["case-colliding allowlist", (m) => { m.runtimes[0].archive.files.push("release/ggml-base.DLL"); }, /case-colliding/],
  ["Windows device name in allowlist", (m) => { m.runtimes[0].archive.files.push("NUL.txt"); }, /unsafe/],
  ["release tag for a different version", (m) => { m.runtimes[0].archive.url = "https://github.com/makekosmos/local-ai-runtimes/releases/download/runtime-v11.9.3/whisper-cpu-bin-x64-v1.9.3.zip"; }, /immutable versioned release/],
]) test(name, () => assert.throws(() => {
  const manifest = structuredClone(source);
  mutate(manifest);
  validateManifest(manifest, { now: fixedNow });
}, pattern));

test("envelope binds exact bytes, size, trusted key ID, and signature", () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const signedBytes = Buffer.from('{"status":"release","signing_key_id":"test"}\n');
  const envelope = { schema_version: 1, payload_type: "application/vnd.makekosmos.runtime-manifest+json", payload_sha256: crypto.createHash("sha256").update(signedBytes).digest("hex"), payload_size: signedBytes.length, key_id: "test", signature: crypto.sign(null, signedBytes, privateKey).toString("base64") };
  assert.equal(verifyEnvelope(signedBytes, envelope, { test: publicKey.export({ type: "spki", format: "pem" }) }), true);
  assert.throws(() => verifyEnvelope(Buffer.concat([signedBytes, Buffer.from(" ")]), envelope, { test: publicKey.export({ type: "spki", format: "pem" }) }), /hash or size/);
  assert.throws(() => verifyEnvelope(signedBytes, { ...envelope, key_id: "unknown" }, {}), /not trusted/);
});

test("sequence increments exactly once and timestamp increases", () => {
  const candidate = structuredClone(source);
  candidate.sequence += 1;
  candidate.generated_at = "2026-09-01T00:00:01Z";
  assert.equal(assertSequence(source, candidate), true);
  candidate.sequence += 1;
  assert.throws(() => assertSequence(source, candidate), /exactly once/);
  assert.throws(() => assertSequence({ ...source, generated_at: "not-a-timestamp" }, { ...source, sequence: source.sequence + 1, generated_at: "2026-09-01T00:00:01Z" }), /timestamp must increase/);
});

test("preflight rejects existing release and tag before signing", () => {
  const candidate = structuredClone(source);
  candidate.status = "release";
  assert.throws(() => preflight({ tag: "v1", existingTags: ["v1"], previous: source, candidate, now: fixedNow }), /tag already exists/);
  assert.throws(() => preflight({ tag: "v1", existingReleases: ["v1"], previous: source, candidate, now: fixedNow }), /release already exists/);
});

test("preflight rejects non-list tag/release observations", () => {
  const candidate = structuredClone(source);
  assert.throws(() => preflight({ tag: "v1", existingTags: "v1", previous: source, candidate, now: fixedNow }), /must be lists/);
  assert.throws(() => preflight({ tag: "v1", existingReleases: null, previous: source, candidate, now: fixedNow }), /must be lists/);
});
