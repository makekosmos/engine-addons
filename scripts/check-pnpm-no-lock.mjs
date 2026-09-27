import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const pnpm = process.platform === "win32" ? process.env.ComSpec ?? "cmd.exe" : "pnpm";
const pnpmArgs = (args) =>
  process.platform === "win32" ? ["/d", "/s", "/c", "pnpm.cmd", ...args] : args;

execFileSync(pnpm, pnpmArgs(["--config.lockfile=false", "install", "--ignore-scripts"]), {
  stdio: "inherit",
});
execFileSync(pnpm, pnpmArgs(["--config.lockfile=false", "run", "check"]), {
  stdio: "inherit",
});

if (existsSync("pnpm-lock.yaml")) {
  throw new Error("No-lock policy failed: pnpm-lock.yaml was created");
}

const prePush = readFileSync(".githooks/pre-push", "utf8");
if (!prePush.includes("pnpm run check") || /\bbun\b/i.test(prePush)) {
  throw new Error("Hook policy failed: .githooks/pre-push must invoke pnpm run check");
}

console.log("pnpm no-lock policy passed");
