#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";

for (const file of ["components.json", "release-bom.schema.json", "release/runtime-v1.9.3.plan.json"]) {
  const url = new URL(`../${file}`, import.meta.url);
  const value = JSON.parse(await readFile(url, "utf8"));
  await writeFile(url, `${JSON.stringify(value, null, 2)}\n`);
}
