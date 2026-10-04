#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const SHA256 = /^[a-f0-9]{64}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const COMPONENT_ID = /^[a-z0-9][a-z0-9._-]*$/;
const KIND = /^[a-z][a-z0-9-]*$/;
const RELEASE_URL = /^https:\/\/github\.com\/makekosmos\/engine-addons\/releases\/download\/([^/]+)\/([^/]+)$/;
const TAG_VERSION = /^(?:[A-Za-z0-9][A-Za-z0-9._-]*-)?v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;
const WINDOWS_DEVICES = new Set(["CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9"]);

function requiredString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`);
}

// components.json is the published catalogue of optional Engine add-ons:
// documentation and build input, never fetched or trusted by the Engine at
// runtime — the Engine compiles the URL, size and sha256 it downloads into
// its own binary.
export function validateComponents(manifest, { now = new Date(), maxFutureSkewMs = 5 * 60_000 } = {}) {
  if (!manifest || manifest.schema_version !== 2) throw new Error("unsupported components schema");
  if (!Number.isSafeInteger(manifest.sequence) || manifest.sequence <= 0) throw new Error("sequence must be a positive integer");
  if (!ISO_UTC.test(manifest.generated_at || "")) throw new Error("generated_at must be canonical UTC seconds");
  const generatedAt = Date.parse(manifest.generated_at);
  if (!Number.isFinite(generatedAt) || generatedAt > now.getTime() + maxFutureSkewMs) throw new Error("generated_at is invalid or too far in the future");
  if (!Array.isArray(manifest.components) || manifest.components.length === 0) throw new Error("components must be non-empty");

  const ids = new Set();
  const coordinates = new Set();
  for (const component of manifest.components) {
    requiredString(component?.id, "component id");
    if (!COMPONENT_ID.test(component.id)) throw new Error(`${component.id}: invalid component id`);
    if (ids.has(component.id)) throw new Error(`duplicate component id: ${component.id}`);
    ids.add(component.id);
    if (!KIND.test(component.kind || "")) throw new Error(`${component.id}: invalid kind`);
    if (!SEMVER.test(component.version || "")) throw new Error(`${component.id}: invalid version`);
    if (component.platform !== "windows" || component.architecture !== "x64") throw new Error(`${component.id}: unsupported platform/architecture`);
    if (!["cpu", "vulkan"].includes(component.backend) || !["none", "vulkan"].includes(component.accelerator)) throw new Error(`${component.id}: unsupported backend/accelerator`);
    if ((component.backend === "cpu") !== (component.accelerator === "none")) throw new Error(`${component.id}: backend/accelerator mismatch`);
    const coordinate = `${component.id}@${component.version}:${component.platform}:${component.architecture}:${component.kind}`;
    if (coordinates.has(coordinate)) throw new Error(`duplicate component coordinate: ${coordinate}`);
    coordinates.add(coordinate);
    if (!Array.isArray(component.entrypoints) || component.entrypoints.length === 0 || component.entrypoints.some((value) => typeof value !== "string") || new Set(component.entrypoints.map((value) => value.toLowerCase())).size !== component.entrypoints.length) throw new Error(`${component.id}: unique entrypoints are required`);
    for (const entrypoint of component.entrypoints) validateArchivePath(entrypoint, `${component.id}: entrypoint`);

    if (component.format !== "zip") throw new Error(`${component.id}: ZIP archive metadata is required`);
    validateArchivePath(component.file, `${component.id}: archive name`);
    if (component.file.includes("/")) throw new Error(`${component.id}: archive name must be flat`);
    if (!component.file.toLowerCase().endsWith(".zip")) throw new Error(`${component.id}: archive name must be a .zip basename`);
    if (!SHA256.test(component.sha256 || "")) throw new Error(`${component.id}: exact SHA-256 is required`);
    if (!Number.isSafeInteger(component.size) || component.size <= 0) throw new Error(`${component.id}: exact size is required`);
    if (!Array.isArray(component.files) || component.files.length === 0) throw new Error(`${component.id}: complete archive file allowlist is required`);
    component.files.forEach((file) => validateArchivePath(file, `${component.id}: archive file`));
    if (new Set(component.files.map((file) => file.toLowerCase())).size !== component.files.length) throw new Error(`${component.id}: duplicate/case-colliding archive file`);
    const declaredFiles = new Set(component.files);
    for (const entrypoint of component.entrypoints) if (!declaredFiles.has(entrypoint)) throw new Error(`${component.id}: entrypoint is not in the archive allowlist`);

    const match = RELEASE_URL.exec(component.url || "");
    const tagVersion = match && TAG_VERSION.exec(match[1]);
    if (!match || match[2] !== component.file || !tagVersion || tagVersion[1] !== component.version) throw new Error(`${component.id}: immutable versioned release URL is required`);
    if (component.release_tag !== match[1]) throw new Error(`${component.id}: release_tag must match the URL tag`);
    requiredString(component.source?.project, `${component.id}: source project`);
    requiredString(component.source?.version, `${component.id}: source version`);
    if (!/^[a-f0-9]{40}$/.test(component.source?.commit || "")) throw new Error(`${component.id}: immutable source commit is required`);
    requiredString(component.build?.recipe, `${component.id}: build recipe`);
    requiredString(component.build?.toolchain, `${component.id}: build toolchain`);
    if (!Array.isArray(component.licences) || component.licences.length === 0) throw new Error(`${component.id}: licence metadata is required`);
    component.licences.forEach((licence, index) => {
      requiredString(licence?.spdx, `${component.id}: licence ${index} SPDX`);
      validateArchivePath(licence?.path, `${component.id}: licence ${index} path`);
      if (!declaredFiles.has(licence.path)) throw new Error(`${component.id}: licence ${index} path is not in the archive allowlist`);
    });
  }
  return true;
}

export function validateArchivePath(value, label = "archive path") {
  requiredString(value, label);
  if (value.includes("\\") || value.includes("\0") || value.includes(":") || value.startsWith("/") || /[<>"|?*]/.test(value)) throw new Error(`${label} is unsafe`);
  const parts = value.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) throw new Error(`${label} is unsafe`);
  for (const part of parts) {
    const stripped = part.replace(/[. ]+$/, "");
    const stem = part.replace(/^[. ]+|[. ]+$/g, "").split(".", 1)[0].replace(/[. ]+$/, "").toUpperCase();
    if (part !== stripped || part.startsWith(" ") || WINDOWS_DEVICES.has(stem)) throw new Error(`${label} is unsafe`);
  }
  return true;
}

export function assertSequence(previous, candidate) {
  if (candidate.schema_version !== previous.schema_version) throw new Error("schema version cannot change in a sequence update");
  if (candidate.sequence !== previous.sequence + 1) throw new Error("candidate sequence must increment exactly once");
  const candidateAt = Date.parse(candidate.generated_at);
  const previousAt = Date.parse(previous.generated_at);
  if (!Number.isFinite(candidateAt) || !Number.isFinite(previousAt) || candidateAt <= previousAt) throw new Error("candidate timestamp must increase");
  return true;
}

// sha256sum-format content for a release: `<hex>  <file>` per line, sorted.
export function sha256sums(entries) {
  return entries
    .map(({ file, sha256 }) => `${sha256}  ${file}`)
    .sort()
    .join("\n") + "\n";
}

export function parseSha256sums(text) {
  const sums = new Map();
  for (const line of text.split("\n")) {
    if (!line) continue;
    const match = /^([0-9a-fA-F]{64}) [ *](.+)$/.exec(line);
    if (!match) throw new Error("SHA256SUMS.txt contains a malformed line");
    const file = match[2].trim();
    if (sums.has(file)) throw new Error(`SHA256SUMS.txt lists ${file} more than once`);
    sums.set(file, match[1].toLowerCase());
  }
  return sums;
}

export async function fileSha256(filePath) {
  const bytes = await readFile(filePath);
  return { sha256: crypto.createHash("sha256").update(bytes).digest("hex"), size: bytes.length };
}

async function main() {
  const bytes = await readFile(new URL("../components.json", import.meta.url));
  validateComponents(JSON.parse(bytes));
  console.log(`Validated exact ${bytes.length}-byte components manifest.`);
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
