#!/usr/bin/env node
// Re-verify downloaded release assets: every file covered by SHA256SUMS.txt
// must hash to its listed value, and every component archive must appear in
// the sums file. Replaces the removed signature/envelope check — the trust
// anchor is HTTPS + GitHub Releases + the pinned hashes in this file set.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileSha256, parseSha256sums, validateComponents } from "./validate-components.mjs";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
for (const flag of ["--dir", "--components", "--sums"]) if (!args.get(flag)) throw new Error(`${flag} is required`);
const dir = args.get("--dir");
const components = JSON.parse(await readFile(path.join(dir, args.get("--components")), "utf8"));
validateComponents(components);
const sums = parseSha256sums(await readFile(path.join(dir, args.get("--sums")), "utf8"));
if (sums.size === 0) throw new Error("SHA256SUMS.txt is empty or malformed");
for (const component of components.components) {
  const listed = sums.get(component.file);
  if (!listed) throw new Error(`${component.id}: ${component.file} is missing from SHA256SUMS.txt`);
  if (listed !== component.sha256) throw new Error(`${component.id}: SHA256SUMS.txt hash differs from the component list`);
}
for (const [file, expected] of sums) {
  const filePath = path.join(dir, file);
  if (path.dirname(file) !== ".") throw new Error(`SHA256SUMS.txt entry must be flat: ${file}`);
  const { sha256 } = await fileSha256(filePath);
  if (sha256 !== expected) throw new Error(`downloaded asset hash mismatch: ${file}`);
}
const listed = new Set(sums.keys());
for (const extra of await readdir(dir)) {
  if (extra !== args.get("--sums") && !listed.has(extra)) throw new Error(`unexpected downloaded asset: ${extra}`);
}
console.log(`Verified ${sums.size} release assets against SHA256SUMS.txt.`);
