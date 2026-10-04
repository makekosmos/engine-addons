import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validatePlan } from "./validate-plan.mjs";

const plan = JSON.parse(await readFile(new URL("../release/runtime-v1.9.3.plan.json", import.meta.url)));
const fixedNow = new Date("2026-10-03T00:00:00Z");

test("accepts the exact reviewed release plan", () => assert.equal(validatePlan(plan, { now: fixedNow }), true));

for (const [name, mutate, pattern] of [
  ["Vulkan SDK URL escaping the shell quote", (p) => { p.vulkan_sdk.url = "https://sdk.lunarg.com/sdk/x.exe'; throw 'pwned'; '"; }, /quote-safe URL/],
  ["smoke model URL escaping the shell quote", (p) => { p.smoke_model.url += "'; throw 'pwned'; '"; }, /quote-safe URL/],
  ["smoke model URL with embedded whitespace", (p) => { p.smoke_model.url += " x.bin"; }, /quote-safe URL/],
  ["Vulkan SDK URL from a mutable host", (p) => { p.vulkan_sdk.url = "https://example.com/sdk.exe"; }, /Vulkan SDK/],
  ["smoke model resolved by branch not commit", (p) => { p.smoke_model.url = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin"; }, /smoke model/],
  ["unpinned upstream commit", (p) => { p.upstream.commit = "v1.9.3"; }, /full commit/],
  ["runtime source drifting from pinned upstream", (p) => { p.runtimes[0].source.commit = "c".repeat(40); }, /pinned upstream/],
]) test(`rejects ${name}`, () => assert.throws(() => {
  const candidate = structuredClone(plan);
  mutate(candidate);
  validatePlan(candidate, { now: fixedNow });
}, pattern));
