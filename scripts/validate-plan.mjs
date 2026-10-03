#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { validateComponents } from "./validate-components.mjs";

const plan = JSON.parse(await readFile(new URL("../release/runtime-v1.9.3.plan.json", import.meta.url), "utf8"));
if (!/^[a-f0-9]{40}$/.test(plan.upstream?.commit || "") || plan.upstream.repository !== "ggml-org/whisper.cpp") throw new Error("plan must pin whisper.cpp by full commit");
if (!/^https:\/\/sdk\.lunarg\.com\//.test(plan.vulkan_sdk?.url || "") || !/^[a-f0-9]{64}$/.test(plan.vulkan_sdk?.sha256 || "")) throw new Error("plan must pin the Vulkan SDK hash");
if (!/^https:\/\/huggingface\.co\/ggerganov\/whisper\.cpp\/resolve\/[a-f0-9]{40}\//.test(plan.smoke_model?.url || "") || !/^[a-f0-9]{64}$/.test(plan.smoke_model?.sha256 || "") || !Number.isSafeInteger(plan.smoke_model?.size)) throw new Error("plan must pin the smoke model bytes");
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
}, { now: new Date("2026-10-03T00:00:00Z") });
console.log(`Validated reviewed release plan with ${plan.runtimes.length} runtimes.`);
