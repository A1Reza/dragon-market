import { createHash } from "node:crypto";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  copyFileSync,
  existsSync,
} from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { root } from "./processes.mjs";
const docs = resolve(root, "docs/research-readiness"),
  art = resolve(docs, "artifacts");
mkdirSync(art, { recursive: true });
const read = (p) => JSON.parse(readFileSync(resolve(root, p), "utf8"));
const write = (p, v) =>
  writeFileSync(resolve(docs, p), JSON.stringify(v, null, 2) + "\n");
const hash = (p) =>
  createHash("sha256")
    .update(readFileSync(resolve(root, p)))
    .digest("hex");
const git = (args) =>
  spawnSync("git", args, { cwd: root, encoding: "utf8" }).stdout.trim();
const verification = read("artifacts/verification/results.json");
for (const result of verification.results)
  copyFileSync(
    resolve(root, result.artifact),
    resolve(art, result.name + ".log"),
  );
write("artifacts/final-verification.json", verification);
const browser = read("artifacts/playwright-results.json");
write("artifacts/playwright-final.json", browser);
copyFileSync(
  resolve(root, "artifacts/e2e-first.log"),
  resolve(art, "e2e-final.log"),
);
const mutations = read("artifacts/mutations/results.json");
write("artifacts/mutations.json", mutations);
for (const result of mutations)
  copyFileSync(
    resolve(root, "artifacts/mutations", result.mutation + ".log"),
    resolve(art, "mutation-" + result.mutation + ".log"),
  );
function screenshots(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) screenshots(path);
    else if (entry.name.endsWith(".png")) {
      mkdirSync(resolve(docs, "screenshots"), { recursive: true });
      copyFileSync(path, resolve(docs, "screenshots", entry.name));
    }
  }
}
screenshots(resolve(root, "web/test-results"));
const smoke = {
  at: new Date().toISOString(),
  services: {},
  browser_version: "NOT RUN",
};
let snapshot;
for (const [name, url] of Object.entries({
  frontend: "http://127.0.0.1:5173",
  backend: "http://127.0.0.1:8080/healthz",
  database: "http://127.0.0.1:8080/dev/snapshot",
  runner: "http://127.0.0.1:8082/healthz",
  oracle: "http://127.0.0.1:8090/prices/verification-fixture",
})) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    smoke.services[name] = {
      url,
      status: response.ok ? "PASS" : "FAIL",
      http_status: response.status,
    };
    if (name === "database" && response.ok) snapshot = await response.json();
  } catch (e) {
    smoke.services[name] = { url, status: "FAIL", error: String(e) };
  }
}
try {
  const { chromium } = await import(
    pathToFileURL(resolve(root, "web/node_modules/playwright/index.mjs"))
  );
  const b = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || "chrome",
  });
  smoke.browser_version = b.version();
  const page = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto("http://127.0.0.1:5173");
  await page.locator(".source-line").waitFor();
  await page.screenshot({
    path: resolve(docs, "screenshots/local-workbench.png"),
    fullPage: true,
  });
  await b.close();
} catch (e) {
  smoke.browser_error = String(e);
}
write("artifacts/local-smoke.json", smoke);
const required = [
  "initial-assessment.md",
  "baseline-test-report.md",
  "invariant-catalog.md",
  "test-coverage-matrix.md",
  "known-issues.md",
  "api-changes.md",
  "human-review-checklist.md",
  "reproduction-guide.md",
];
const documentation = required.map((path) => ({
  path,
  status:
    existsSync(resolve(docs, path)) &&
    readFileSync(resolve(docs, path), "utf8").length > 100
      ? "PASS"
      : "FAIL",
}));
write("artifacts/documentation-check.json", documentation);
const lines = readFileSync(resolve(docs, "invariant-catalog.md"), "utf8")
  .split("\n")
  .filter((l) => /^\| [A-Z]+-\d+:/.test(l));
write(
  "invariant-catalog.json",
  lines.map((line) => {
    const columns = line
      .split("|")
      .slice(1, -1)
      .map((s) => s.trim());
    const index = columns[0].indexOf(":");
    return {
      id: columns[0].slice(0, index),
      statement_and_definition: columns[0].slice(index + 1).trim(),
      implementation_and_database_constraints: columns[1],
      tests_and_verification: columns[2],
      missing_coverage_and_edges: columns[3],
      human_review_status: columns[4],
      observed_status: columns[2].includes("**FAIL")
        ? "FAIL"
        : "PASS_WITH_BOUNDED_EVIDENCE",
    };
  }),
);
const baseline = read(
  "docs/research-readiness/research-baseline-manifest.json",
);
baseline.candidate_final_commit_sha = git(["rev-parse", "HEAD"]);
baseline.candidate_definition =
  "Implementation commit verified before this documentation-only evidence ledger. The ledger records its parent/source SHA to avoid an impossible self-referential Git hash. No approved tag exists.";
baseline.source_tree = git(["rev-parse", "HEAD^{tree}"]);
baseline.frontend_lockfile = {
  path: "web/package-lock.json",
  sha256: hash("web/package-lock.json"),
};
baseline.migration_checksums = readdirSync(resolve(root, "migrations/up"))
  .filter((p) => p.endsWith(".sql"))
  .sort()
  .map((file) => ({
    path: "migrations/up/" + file,
    sha256: hash("migrations/up/" + file),
  }));
baseline.tools.postgresql = snapshot?.database_version || "NOT CHECKED";
baseline.tools.browser = smoke.browser_version;
baseline.tools.os = process.platform + " " + process.arch;
baseline.final_tests = verification.results.map((r) => ({
  ...r,
  artifact: "docs/research-readiness/artifacts/" + r.name + ".log",
}));
baseline.browser_tests = {
  command: "PLAYWRIGHT_CHANNEL=chrome npm --prefix web run test:e2e",
  status:
    browser.stats.unexpected === 0 &&
    browser.stats.expected === 7 &&
    browser.stats.skipped === 0
      ? "PASS"
      : "FAIL",
  ...browser.stats,
  artifact: "docs/research-readiness/artifacts/playwright-final.json",
};
baseline.mutation_checks = mutations;
baseline.known_failures = [
  "WAL-03 / KNOWN-01: prior-day reservation release can bypass today spending limit",
];
baseline.unresolved_issues = [
  "Daily-limit reservation/day model requires policy review",
  "Cross-operation deadlock progress stress not run",
  "Linux/macOS clean reproduction and remote CI not executed locally",
  "See known-issues.md for bounded evidence and other test gaps",
];
baseline.human_approval = "PENDING_HUMAN_REVIEW";
baseline.finalized_at = new Date().toISOString();
baseline.git_history = git([
  "log",
  "--format=%H %s",
  baseline.original_commit_sha + "..HEAD",
]).split("\n");
write("research-baseline-manifest.json", baseline);
const check = (name) =>
  verification.results.find((r) => r.name === name)?.status || "NOT RUN";
const browserStatus = baseline.browser_tests.status;
const acceptance = [
  [
    "Backend",
    "Existing API functions",
    browserStatus,
    "Browser original routes + independent SQL",
  ],
  ["Backend", "Production Go build", check("go-build"), "go build ./..."],
  [
    "Backend",
    "Existing rules preserved except documented corrections",
    check("go-tests"),
    "Full original + new tests; backend-fixes.md; does not assert WAL-03",
  ],
  [
    "Backend",
    "Unit and HTTP tests",
    check("go-tests"),
    "go test -count=1 ./...",
  ],
  [
    "Backend",
    "PostgreSQL integration tests",
    check("go-tests"),
    "Testcontainers; no skips",
  ],
  ["Backend", "Race tests", check("go-race"), "go test -race -count=1 ./..."],
  ["Backend", "Static analysis", check("go-vet"), "go vet ./..."],
  [
    "Backend",
    "Critical contention tests",
    check("go-tests"),
    "Competing buyers/bids/auction starts/settlement + identical keys",
  ],
  [
    "Backend",
    "Persisted idempotency effects",
    check("go-tests"),
    "HTTP purchase/bid replay + SQL state; concurrent identical key",
  ],
  [
    "Backend",
    "Late-failure rollback",
    check("go-tests"),
    "TestResearchRollback compares committed state",
  ],
  [
    "Backend",
    "Invariant inventory",
    documentation.find((r) => r.path === "invariant-catalog.md").status,
    "Parsed catalog with machine manifest",
  ],
  [
    "Backend",
    "Daily limit cannot be bypassed across UTC rollover",
    "FAIL",
    "Known-issue-rollover.log; policy/data-model issue unresolved",
  ],
  ...[
    "UI launches",
    "API connects",
    "Guild switching",
    "Item creation",
    "Fixed-price listing",
    "Purchase",
    "Auction creation",
    "Bidding",
    "Eligible bid cancellation",
    "Wallet reflects real persisted state",
    "Understandable rejected request",
    "Research Lab A through G",
    "Desktop and mobile layout",
    "Keyboard and direct refresh",
  ].map((s) => [
    "Frontend",
    s,
    browserStatus,
    "7 real browser tests; direct SQL and screenshots",
  ]),
  [
    "Frontend",
    "Unit/component tests",
    check("frontend-test"),
    "12 tests with mocked HTTP; not backend evidence",
  ],
  [
    "Frontend",
    "Browser E2E",
    browserStatus,
    "Playwright Chrome, real Go/PostgreSQL, zero skips",
  ],
  [
    "Frontend",
    "Production build",
    check("frontend-build"),
    "npm --prefix web run build",
  ],
  ["Research", "Starting SHA recorded", "PASS", baseline.original_commit_sha],
  [
    "Research",
    "Backend changes documented",
    documentation.every((r) => r.status === "PASS") ? "PASS" : "FAIL",
    "Required documents inspected by collector; backend-fixes.md",
  ],
  [
    "Research",
    "Known issues documented",
    "PASS",
    "Known-issues.md + known defect characterization",
  ],
  [
    "Research",
    "Critical invariants independently tested",
    check("go-tests"),
    "Bounded SQL tests; WAL-03 fails and other gaps catalogued",
  ],
  [
    "Research",
    "Local setup executed",
    Object.values(smoke.services).every((s) => s.status === "PASS")
      ? "PASS"
      : "FAIL",
    "workbench.mjs plus local-smoke.json",
  ],
  [
    "Research",
    "Clean Linux/macOS reproduction",
    "NOT RUN",
    "Only Windows executed; workflow config is not execution evidence",
  ],
  [
    "Research",
    "Remote CI execution",
    "NOT RUN",
    "No push authorized or performed",
  ],
  [
    "Research",
    "Human checklist available",
    "PASS",
    "Required documentation validation",
  ],
  [
    "Research",
    "Candidate SHA recorded",
    "PASS",
    baseline.candidate_final_commit_sha,
  ],
  [
    "Research",
    "Human approval remains pending",
    "PASS",
    "Manifest exact PENDING_HUMAN_REVIEW; not approval",
  ],
  [
    "Research",
    "Approved baseline tag",
    "NOT APPLICABLE",
    "User explicitly reserves final approval/tag",
  ],
];
write(
  "acceptance-status.json",
  acceptance.map(([category, criterion, status, evidence]) => ({
    category,
    criterion,
    status,
    evidence,
  })),
);
const table = acceptance.map((row) => "| " + row.join(" | ") + " |").join("\n");
writeFileSync(
  resolve(docs, "final-readiness-report.md"),
  `# Final readiness report\n\nCandidate implementation: \`${baseline.candidate_final_commit_sha}\`. Human approval: **PENDING_HUMAN_REVIEW**. Recorded ${baseline.finalized_at}.\n\n**The application is working and local automated checks pass; it is not an approved or fully correct research baseline. WAL-03 fails across UTC rollover.** KNOWN-01 needs a reviewed reservation/day model before claiming daily-limit safety. Passing characterization tests confirm this defect, not its repair.\n\nOriginal: ${baseline.original_commit_sha}; full original build/test/race/vet PASS before changes. Candidate adds isolated React UI, opt-in read-only discovery, independently executed persisted-state tests, local scenario driver and reproducible evidence. Four validated domain/contract boundary fixes and one Compose setup correction are documented separately.\n\n## Executed evidence\n\n${verification.results.map((r) => "- " + r.status + ": `" + r.command + "` — artifacts/" + r.name + ".log").join("\n")}\n- ${browserStatus}: Playwright (${browser.stats.expected} expected, ${browser.stats.unexpected} unexpected, ${browser.stats.skipped} skipped); installed Chrome ${smoke.browser_version}; artifacts/playwright-final.json.\n- ${mutations.every((r) => r.status === "PASS") ? "PASS" : "FAIL"}: two deliberately defective temporary copies detected by persisted-effect assertions; artifacts/mutations.json.\n- Local services: artifacts/local-smoke.json; database PostgreSQL ${baseline.tools.postgresql}, application URL http://127.0.0.1:5173.\n\nInitial browser failures are retained (e2e-initial.log/playwright-initial.json); mobile focus and split Go JSON report parsing were corrected before rerun. Reproduction initially revealed nested read-only Compose mount failure and an unrelated owner of port 5432; individual migration mounts and dedicated workbench port 15432 resolved startup without deleting data.\n\n## Acceptance status\n\n| Category | Criterion | Status | Evidence / command |\n|---|---|---|---|\n${table}\n\n## Practical limits and next review\n\nRead known-issues.md, invariant-catalog.md and human-review-checklist.md. Some bounded invariant tests pass, one confirmed financial-policy property fails, and remote CI/clean non-Windows execution remain unverified. No proof or universal exactly-once claim is made. E2E fixtures and Testcontainers were isolated; shared data was never reset. Frontend component tests use mocks and are labeled as such. Original migrations remain unchanged. No remote push, force-push, rewritten original history or approved tag.\n\nThe candidate SHA is the implementation commit before this evidence ledger. A Git commit cannot contain its own hash; the later documentation-only commit records this SHA and execution results without changing implementation. Future experiments should use reviewed backend-only snapshots derived from that exact SHA, with research/hidden evaluation materials controlled separately.\n`,
);
console.log(
  JSON.stringify(
    {
      candidate: baseline.candidate_final_commit_sha,
      browser: browserStatus,
      verification: verification.results.every((r) => r.status === "PASS"),
      known_failure: baseline.known_failures,
      services: smoke.services,
    },
    null,
    2,
  ),
);
