import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  copyFileSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import { root } from "./processes.mjs";

// Separate evidence directory: the original workbench ledger is historical.
const directory = resolve(
  root,
  "docs/transactional-correctness-baseline/evidence",
);
mkdirSync(directory, { recursive: true });
const run = (program, args) =>
  spawnSync(program, args, {
    cwd: root,
    encoding: "utf8",
    timeout: 600000,
    maxBuffer: 16 * 1024 * 1024,
  });
const git = (...args) => {
  const result = run("git", args);
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
};
const paths = [
  ...new Set(
    (
      git("ls-files") +
      "\n" +
      git("ls-files", "--others", "--exclude-standard")
    ).split(/\r?\n/),
  ),
]
  .filter((path) =>
    /^(internal\/|cmd\/|migrations\/|web\/src\/|web\/package|scripts\/|go\.(mod|sum)$|docker-compose\.yml$)/.test(
      path,
    ),
  )
  .filter((path) => existsSync(resolve(root, path)))
  .sort();
const report = {
  title: "Dragon Market — Transactional Correctness Baseline Review",
  started_at: new Date().toISOString(),
  source_commit: git("rev-parse", "HEAD"),
  source_dirty: git("status", "--porcelain", "--", ...paths).length > 0,
  original_baseline: "162c5cab9fa886445dd102f4a99961027f90aebb",
  human_approval: "PENDING_HUMAN_REVIEW",
  independent_human_review: "NOT_PERFORMED",
  platform: `${process.platform}/${process.arch}`,
  go: run("go", ["version"]).stdout.trim(),
  node: process.version,
  source_sha256: Object.fromEntries(
    paths.map((path) => [
      path,
      createHash("sha256")
        .update(readFileSync(resolve(root, path)))
        .digest("hex"),
    ]),
  ),
  results: [],
};
const checks = [
  [
    "regression-after",
    "go",
    [
      "test",
      "-v",
      "-count=1",
      "./internal/guild",
      "./internal/postgres",
      "-run",
      "^TestDailyLimit",
    ],
  ],
  ["go-build", "go", ["build", "./..."]],
  ["go-vet", "go", ["vet", "./..."]],
  ["go-tests", "go", ["test", "-count=1", "./..."]],
  ["go-race", "go", ["test", "-race", "-count=1", "./..."]],
];
if (process.argv.includes("--frontend") || process.argv.includes("--browser")) {
  const npm = [
    process.env.npm_execpath,
    resolve(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"),
    resolve(
      dirname(process.execPath),
      "../lib/node_modules/npm/bin/npm-cli.js",
    ),
    resolve(dirname(process.execPath), "../share/nodejs/npm/bin/npm-cli.js"),
  ].find((path) => path && existsSync(path));
  if (!npm) throw new Error("npm CLI not found");
  for (const task of process.argv.includes("--frontend")
    ? ["typecheck", "lint", "test", "build"]
    : []) {
    checks.push([
      `frontend-${task}`,
      process.execPath,
      [npm, "--prefix", "web", "run", task],
    ]);
  }
  if (process.argv.includes("--browser"))
    checks.push([
      "browser",
      process.execPath,
      [npm, "--prefix", "web", "run", "test:e2e"],
    ]);
}
for (const [name, program, args] of checks) {
  const started_at = new Date().toISOString();
  const result = run(program, args);
  writeFileSync(
    resolve(directory, `${name}.log`),
    (result.stdout || "") + (result.stderr || "") + (result.error || ""),
  );
  const entry = {
    name,
    command:
      program === process.execPath
        ? `npm ${args.slice(1).join(" ")}`
        : `${program} ${args.join(" ")}`,
    started_at,
    finished_at: new Date().toISOString(),
    exit: result.status,
    status: result.status === 0 ? "PASS" : "FAIL",
    log: `${name}.log`,
  };
  report.results.push(entry);
  writeFileSync(
    resolve(directory, "verification.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(`${entry.status} ${entry.command}`);
  if (
    name === "browser" &&
    existsSync(resolve(root, "artifacts/playwright-results.json"))
  )
    copyFileSync(
      resolve(root, "artifacts/playwright-results.json"),
      resolve(directory, "browser-results.json"),
    );
}
if (report.results.some((entry) => entry.status !== "PASS"))
  process.exitCode = 1;
