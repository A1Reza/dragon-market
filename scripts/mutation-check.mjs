import {
  mkdtempSync,
  cpSync,
  readFileSync,
  writeFileSync,
  rmSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { root } from "./processes.mjs";
const cases = [
  {
    name: "missing-audit",
    file: "internal/guild/service.go",
    from: "if recorder, ok := s.guildRepository.(transactionRecorder); ok {",
    to: "if recorder, ok := s.guildRepository.(transactionRecorder); ok && false {",
  },
  {
    name: "missing-buyer-debit",
    file: "internal/order/service.go",
    from: "s.walletSvc.Spend(ctx, buyerID, o.Price)",
    to: "s.walletSvc.Spend(ctx, buyerID, 1)",
  },
];
mkdirSync(resolve(root, "artifacts/mutations"), { recursive: true });
const results = [];
for (const mutation of cases) {
  const scratch = mkdtempSync(resolve(tmpdir(), "dragon-mutation-"));
  try {
    for (const path of ["go.mod", "go.sum", "internal", "migrations"])
      cpSync(resolve(root, path), resolve(scratch, path), { recursive: true });
    const path = resolve(scratch, mutation.file),
      source = readFileSync(path, "utf8");
    if (!source.includes(mutation.from))
      throw new Error("Mutation anchor missing: " + mutation.name);
    writeFileSync(path, source.replace(mutation.from, mutation.to));
    const args = [
      "test",
      "-count=1",
      "./internal/postgres",
      "-run",
      "^TestHTTPPurchaseIdempotencyPersistedEffects$",
    ];
    const execution = spawnSync("go", args, {
      cwd: scratch,
      encoding: "utf8",
      timeout: 150000,
    });
    const output = execution.stdout + execution.stderr;
    writeFileSync(
      resolve(root, "artifacts/mutations", mutation.name + ".log"),
      output,
    );
    const detected =
      execution.status !== 0 &&
      output.includes(
        "--- FAIL: TestHTTPPurchaseIdempotencyPersistedEffects",
      ) &&
      !output.includes("[build failed]");
    results.push({
      mutation: mutation.name,
      status: detected ? "PASS" : "FAIL",
      meaning: detected
        ? "Persisted-effect test detected the injected defect"
        : "Mutation not validly detected",
      command: "go " + args.join(" "),
      exit: execution.status,
    });
  } finally {
    const checked = resolve(scratch);
    if (
      !checked.startsWith(resolve(tmpdir()) + sep) ||
      !checked.includes("dragon-mutation-")
    )
      throw new Error("Unsafe temporary cleanup target");
    rmSync(checked, { recursive: true, force: true });
  }
}
writeFileSync(
  resolve(root, "artifacts/mutations/results.json"),
  JSON.stringify(results, null, 2),
);
console.log(JSON.stringify(results, null, 2));
if (results.some((r) => r.status !== "PASS")) process.exitCode = 1;
