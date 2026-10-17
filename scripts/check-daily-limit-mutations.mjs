import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
} from "node:fs";
import { resolve } from "node:path";
import { root } from "./processes.mjs";

const evidence = resolve(
  root,
  "artifacts/daily-limit-mutations",
  new Date().toISOString().replace(/[:.]/g, "-"),
);
const copies = resolve(root, "artifacts/daily-limit-mutants");
mkdirSync(evidence, { recursive: true });
mkdirSync(copies, { recursive: true });
const file = "internal/guild/service.go";
const source = readFileSync(resolve(root, file), "utf8");
const cases = [
  {
    name: "release-erases-completed-spending",
    from: 'g.Reserved -= amount\n\t\treturn s.save(ctx, g, "release", amount)',
    to: 'g.DailySpent = 0\n\t\tg.Reserved -= amount\n\t\treturn s.save(ctx, g, "release", amount)',
  },
  {
    name: "capacity-ignores-carried-holds",
    from: /if g\.DailyLimit > 0 && \(g\.DailySpent > g\.DailyLimit \|\|[\s\S]*?amount > g\.DailyLimit-g\.DailySpent-g\.Reserved\) \{/,
    to: "if g.DailyLimit > 0 && amount > g.DailyLimit-g.DailySpent {",
  },
  {
    name: "settlement-omits-completed-debit",
    from: "g.DailySpent += amount\n\t\tg.Reserved -= amount",
    to: "g.Reserved -= amount",
  },
];
const results = [];
for (const mutation of cases) {
  const normalized = source.replace(/\r\n/g, "\n");
  const changed = normalized.replace(mutation.from, mutation.to);
  if (changed === normalized)
    throw new Error(`Missing anchor: ${mutation.name}`);
  const scratch = mkdtempSync(resolve(copies, mutation.name + "-"));
  for (const path of ["go.mod", "go.sum", "internal", "migrations"])
    cpSync(resolve(root, path), resolve(scratch, path), { recursive: true });
  writeFileSync(resolve(scratch, file), changed);
  const args = [
    "test",
    "-v",
    "-count=1",
    "./internal/postgres",
    "-run",
    "^TestDailyLimitMixedAgeHoldsAndSettlement$",
  ];
  const result = spawnSync("go", args, {
    cwd: scratch,
    encoding: "utf8",
    timeout: 150000,
  });
  const log =
    (result.stdout || "") + (result.stderr || "") + (result.error || "");
  writeFileSync(resolve(evidence, `mutation-${mutation.name}.log`), log);
  const detected =
    result.status !== 0 &&
    log.includes("--- FAIL: TestDailyLimitMixedAgeHoldsAndSettlement") &&
    !log.includes("[build failed]");
  results.push({
    name: mutation.name,
    detected,
    exit: result.status,
    command: "go " + args.join(" "),
    file,
    mutated_source_sha256: createHash("sha256").update(changed).digest("hex"),
    log: `mutation-${mutation.name}.log`,
    failure: log
      .split(/\r?\n/)
      .filter((line) => line.includes("daily_limit_test.go:")),
  });
  console.log(`${detected ? "DETECTED" : "NOT DETECTED"} ${mutation.name}`);
}
// Keep the disposable copies for inspection. No mutation touches the candidate.
if (readFileSync(resolve(root, file), "utf8") !== source)
  throw new Error("Candidate source changed during mutation checks");
writeFileSync(
  resolve(evidence, "mutations.json"),
  JSON.stringify(
    { independent_human_review: "NOT_PERFORMED", results },
    null,
    2,
  ) + "\n",
);
if (results.some((entry) => !entry.detected)) process.exitCode = 1;
console.log(`Evidence: ${evidence}`);
