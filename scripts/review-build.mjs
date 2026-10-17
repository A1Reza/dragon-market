import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { root } from "./processes.mjs";
const directory = resolve(root, "artifacts/review-build");
mkdirSync(directory, { recursive: true });
const args = [
  "build",
  "-f",
  "Dockerfile.review",
  "-t",
  "dragon-market-review:local",
  ".",
];
const started_at = new Date().toISOString();
const result = spawnSync("docker", args, {
  cwd: root,
  encoding: "utf8",
  timeout: 900000,
  maxBuffer: 16 << 20,
});
writeFileSync(
  resolve(directory, "build.log"),
  String(result.stdout || "") +
    String(result.stderr || "") +
    String(result.error || ""),
);
const report = {
  command: "docker " + args.join(" "),
  started_at,
  finished_at: new Date().toISOString(),
  exit: result.status,
  status: result.status === 0 ? "PASS" : "FAIL",
  commit: spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).stdout.trim(),
  dirty_worktree: Boolean(
    spawnSync("git", ["status", "--porcelain"], {
      cwd: root,
      encoding: "utf8",
    }).stdout.trim(),
  ),
};
writeFileSync(
  resolve(directory, "results.json"),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
if (result.status !== 0) {
  console.error(String(result.stderr || result.error).slice(-3000));
  process.exitCode = 1;
}
