#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateComponents } from "./validate-components.mjs";

// Plan URLs are interpolated verbatim into single-quoted workflow shell
// strings, so they must full-match a charset that cannot escape the quote.
const SAFE_URL = /^[0-9A-Za-z:./_?&=%~+-]+$/;
const VULKAN_SDK_URL = /^https:\/\/sdk\.lunarg\.com\//;
const MODEL_URL = /^https:\/\/huggingface\.co\/ggerganov\/whisper\.cpp\/resolve\/[a-f0-9]{40}\//;

export function validatePlan(plan, { now = new Date() } = {}) {
  if (!/^[a-f0-9]{40}$/.test(plan.upstream?.commit || "") || plan.upstream.repository !== "ggml-org/whisper.cpp") throw new Error("plan must pin whisper.cpp by full commit");
  if (!VULKAN_SDK_URL.test(plan.vulkan_sdk?.url || "") || !SAFE_URL.test(plan.vulkan_sdk?.url || "") || !/^[a-f0-9]{64}$/.test(plan.vulkan_sdk?.sha256 || "")) throw new Error("plan must pin the Vulkan SDK hash and a quote-safe URL");
  if (!MODEL_URL.test(plan.smoke_model?.url || "") || !SAFE_URL.test(plan.smoke_model?.url || "") || !/^[a-f0-9]{64}$/.test(plan.smoke_model?.sha256 || "") || !Number.isSafeInteger(plan.smoke_model?.size)) throw new Error("plan must pin the smoke model bytes and a quote-safe URL");
  for (const runtime of plan.runtimes ?? []) {
    if (runtime.source?.commit !== plan.upstream.commit || runtime.source?.version !== plan.upstream.version) throw new Error(`${runtime.id}: source differs from pinned upstream`);
  }
  validateComponents({
    schema_version: 2,
    sequence: plan.sequence,
    generated_at: plan.generated_at,
    components: plan.runtimes.map((runtime) => ({
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
    })),
  }, { now });
  return true;
}

async function main() {
  const plan = JSON.parse(await readFile(new URL("../release/runtime-v1.9.3.plan.json", import.meta.url), "utf8"));
  validatePlan(plan, { now: new Date("2026-10-03T00:00:00Z") });
  console.log(`Validated reviewed release plan with ${plan.runtimes.length} runtimes.`);
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
