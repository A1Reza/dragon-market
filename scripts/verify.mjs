import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { root } from "./processes.mjs";
const full = !process.argv.includes("--fast");
const npmCli =
  process.env.npm_execpath ||
  resolve(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
if (!existsSync(npmCli))
  throw new Error(
    "npm CLI not found beside Node; run via npm or install standard Node.js",
  );
const checks = [
  ["go-build", "go", ["build", "./..."]],
  ["go-vet", "go", ["vet", "./..."]],
  [
    "go-tests",
    "go",
    [
      "test",
      "-count=1",
      ...(full
        ? ["./..."]
        : [
            "./internal/api",
            "./internal/auction",
            "./internal/guild",
            "./internal/item",
            "./internal/order",
            "./internal/idempotency",
            "./internal/oracle",
            "./cmd/research-lab",
          ]),
    ],
  ],
  ...(full ? [["go-race", "go", ["test", "-race", "-count=1", "./..."]]] : []),
  ...["typecheck", "lint", "test", "build"].map((name) => [
    "frontend-" + name,
    process.execPath,
    [npmCli, "run", name],
    "web",
  ]),
];
mkdirSync(resolve(root, "artifacts/verification"), { recursive: true });
const report = {
  started_at: new Date().toISOString(),
  commit: spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).stdout.trim(),
  platform: process.platform,
  node: process.version,
  scope: full ? "full" : "fast",
  results: [],
};
for (const [name, program, args, directory] of checks) {
  const start = new Date().toISOString();
  const result = spawnSync(program, args, {
    cwd: directory ? resolve(root, directory) : root,
    encoding: "utf8",
    timeout: 600000,
    env: process.env,
  });
  const log =
    String(result.stdout || "") +
    String(result.stderr || "") +
    String(result.error || "");
  const artifact = `artifacts/verification/${name}.log`;
  writeFileSync(resolve(root, artifact), log);
  const entry = {
    name,
    command:
      program === process.execPath
        ? "npm " + args.slice(1).join(" ")
        : program + " " + args.join(" "),
    cwd: directory || ".",
    started_at: start,
    finished_at: new Date().toISOString(),
    status: result.status === 0 ? "PASS" : "FAIL",
    exit: result.status,
    artifact,
  };
  report.results.push(entry);
  console.log(`${entry.status} ${entry.command}`);
  writeFileSync(
    resolve(root, "artifacts/verification/results.json"),
    JSON.stringify(report, null, 2),
  );
}
report.finished_at = new Date().toISOString();
writeFileSync(
  resolve(root, "artifacts/verification/results.json"),
  JSON.stringify(report, null, 2),
);
if (report.results.some((r) => r.status !== "PASS")) process.exitCode = 1;
