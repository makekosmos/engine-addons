#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertSequence, validateComponents } from "./validate-components.mjs";

export function preflight({ tag, existingTags = [], existingReleases = [], previous, candidate, now = new Date() }) {
  if (typeof tag !== "string" || !tag.trim()) throw new Error("release tag is required");
  if (!Array.isArray(existingTags) || !Array.isArray(existingReleases)) throw new Error("existing tag/release observations must be lists");
  if (existingTags.includes(tag)) throw new Error(`release tag already exists: ${tag}`);
  if (existingReleases.includes(tag)) throw new Error(`release already exists: ${tag}`);
  validateComponents(candidate, { now });
  assertSequence(previous, candidate);
  for (const component of candidate.components) {
    if (component.release_tag !== tag) throw new Error(`${component.id}: candidate release_tag does not bind the requested tag`);
    const expected = `/releases/download/${tag}/${component.file}`;
    if (!component.url.endsWith(expected)) throw new Error(`${component.id}: candidate URL does not bind the requested tag`);
  }
  return true;
}

async function githubState(repository, tag, token) {
  const headers = { "accept": "application/vnd.github+json", "user-agent": "engine-addons-preflight" };
  if (token) headers.authorization = `Bearer ${token}`;
  const encodedTag = tag.split("/").map(encodeURIComponent).join("/");
  const [tagResponse, releaseResponse] = await Promise.all([
    fetch(`https://api.github.com/repos/${repository}/git/ref/tags/${encodedTag}`, { headers }),
    fetch(`https://api.github.com/repos/${repository}/releases/tags/${encodedTag}`, { headers }),
  ]);
  if (![200, 404].includes(tagResponse.status) || ![200, 404].includes(releaseResponse.status)) throw new Error("unable to query existing tag/release");
  return { existingTags: tagResponse.status === 200 ? [tag] : [], existingReleases: releaseResponse.status === 200 ? [tag] : [] };
}

async function main() {
  const args = new Map();
  for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
  for (const flag of ["--tag", "--previous", "--candidate"]) if (!args.get(flag)) throw new Error(`${flag} is required`);
  const previous = JSON.parse(await readFile(args.get("--previous"), "utf8"));
  const candidate = JSON.parse(await readFile(args.get("--candidate"), "utf8"));
  const state = args.get("--state")
    ? JSON.parse(await readFile(args.get("--state"), "utf8"))
    : await githubState(args.get("--repository") || "makekosmos/engine-addons", args.get("--tag"), process.env.GITHUB_TOKEN);
  if (!state || typeof state !== "object" || !Array.isArray(state.existingTags) || !Array.isArray(state.existingReleases)) throw new Error("release state must list existingTags and existingReleases");
  preflight({ tag: args.get("--tag"), previous, candidate, existingTags: state.existingTags, existingReleases: state.existingReleases });
  console.log("Release/tag/sequence/timestamp preflight passed.");
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
