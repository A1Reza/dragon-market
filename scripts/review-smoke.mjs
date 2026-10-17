// Exercise the actual hosted image against our own TLS-enabled disposable PG.
// Nothing here connects to a configured DATABASE_URL or an existing database.
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { root, ready } from "./processes.mjs";

const suffix = randomBytes(5).toString("hex");
const network = `dragon-review-smoke-${suffix}`;
const database = `${network}-pg`,
  app = `${network}-app`;
const image = "dragon-market-review:local";
const dir = resolve(root, "artifacts", network);
mkdirSync(dir, { recursive: true });
const password = randomBytes(24).toString("hex");
const commit = spawnSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).stdout.trim();
const env = {
  ...process.env,
  POSTGRES_PASSWORD: password,
  REVIEW_PASSWORD: password,
  DATABASE_URL: `postgres://review:${password}@review-pg:5432/dragon_review_disposable?sslmode=require`,
};
const report = {
  started_at: new Date().toISOString(),
  commit,
  dirty_worktree: Boolean(
    spawnSync("git", ["status", "--porcelain"], {
      cwd: root,
      encoding: "utf8",
    }).stdout.trim(),
  ),
  image,
  environment: "local Docker / TLS PostgreSQL 16 / real review gateway",
  checks: [],
};
function docker(args, options = {}) {
  const r = spawnSync("docker", args, {
    cwd: root,
    encoding: "utf8",
    env,
    timeout: 120000,
    ...options,
  });
  if (r.status !== 0)
    throw new Error(`Docker ${args[0]} failed: ${r.stderr || r.error}`);
  return r.stdout.trim();
}
function assert(value, name) {
  report.checks.push({ name, status: value ? "PASS" : "FAIL" });
  if (!value) throw new Error(name);
}
const authorization =
  "Basic " + Buffer.from(`reviewer:${password}`).toString("base64");
let browser;
try {
  docker([
    "network",
    "create",
    "--label",
    "dragon-market.review-smoke=true",
    network,
  ]);
  docker([
    "run",
    "--rm",
    "--user",
    "0",
    "--entrypoint",
    "openssl",
    "-v",
    `${dir}:/out`,
    image,
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    "/out/server.key",
    "-out",
    "/out/server.crt",
    "-days",
    "1",
    "-subj",
    "/CN=review-pg",
  ]);
  docker([
    "run",
    "-d",
    "--name",
    database,
    "--label",
    "dragon-market.review-smoke=true",
    "--network",
    network,
    "--network-alias",
    "review-pg",
    "-e",
    "POSTGRES_USER=review",
    "-e",
    "POSTGRES_PASSWORD",
    "-e",
    "POSTGRES_DB=dragon_review_disposable",
    "-v",
    `${dir}:/tls:ro`,
    "--entrypoint",
    "sh",
    "postgres:16-alpine",
    "-c",
    "cp /tls/server.key /tmp/server.key && cp /tls/server.crt /tmp/server.crt && chown postgres:postgres /tmp/server.key && chmod 600 /tmp/server.key && exec docker-entrypoint.sh postgres -c ssl=on -c ssl_cert_file=/tmp/server.crt -c ssl_key_file=/tmp/server.key",
  ]);
  const limit = Date.now() + 60000;
  while (true) {
    try {
      docker([
        "exec",
        database,
        "psql",
        "-h",
        "127.0.0.1",
        "-U",
        "review",
        "-d",
        "dragon_review_disposable",
        "-Atc",
        "SELECT 1",
      ]);
      break;
    } catch (e) {
      if (Date.now() > limit) throw e;
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  docker([
    "run",
    "-d",
    "--name",
    app,
    "--label",
    "dragon-market.review-smoke=true",
    "--network",
    network,
    "-p",
    "127.0.0.1::10000",
    "-e",
    "DATABASE_URL",
    "-e",
    "REVIEW_USERNAME=reviewer",
    "-e",
    "REVIEW_PASSWORD",
    "-e",
    "REVIEW_DISPOSABLE_DATABASE=dragon_review_disposable",
    "-e",
    `REVIEW_COMMIT=${commit}`,
    image,
  ]);
  const port = docker(["port", app, "10000/tcp"]).split(":").at(-1);
  let base = `http://127.0.0.1:${port}`;
  await ready(base + "/healthz", 90000);
  for (const path of ["/", "/api/dev/snapshot", "/review/config"]) {
    const r = await fetch(base + path);
    assert(r.status === 401, `unauthenticated ${path} rejected`);
  }
  const get = async (path) =>
    fetch(base + path, { headers: { Authorization: authorization } });
  let state = await (await get("/api/dev/snapshot")).json();
  assert(
    state.guilds.length === 3 && state.database === "dragon_review_disposable",
    "original seed and dedicated DB visible through gated real snapshot",
  );
  const config = await (await get("/review/config")).json();
  assert(
    config.commit === commit &&
      config.approval === "PENDING_HUMAN_REVIEW" &&
      config.isolated_runner === false,
    "deployed identity and pending review truthful",
  );
  const post = async (path, body, key) =>
    fetch(base + path, {
      method: "POST",
      headers: {
        Authorization: authorization,
        Origin: base,
        "Content-Type": "application/json",
        ...(key ? { "Idempotency-Key": key } : {}),
      },
      body: JSON.stringify(body),
    });
  const itemResponse = await post("/api/items", {
    name: `Human review ${suffix}`,
    type: "rare",
    owner_id: "guild-seller",
    base_price: 500,
  });
  assert(itemResponse.status === 201, "item creation through gateway");
  const item = await itemResponse.json();
  const listingResponse = await post("/api/orders", {
    item_id: item.id,
    owner_id: "guild-seller",
    base_price: 500,
  });
  assert(listingResponse.status === 201, "listing creation through gateway");
  const listing = await listingResponse.json();
  const key = `review-smoke-${suffix}`;
  const purchase = await post(
    `/api/orders/${listing.id}/buy`,
    { buyer_id: "guild-buyer" },
    key,
  );
  const replay = await post(
    `/api/orders/${listing.id}/buy`,
    { buyer_id: "guild-buyer" },
    key,
  );
  assert(
    purchase.status === 204 &&
      replay.status === 204 &&
      replay.headers.get("Idempotency-Replayed") === "true",
    "purchase and explicit same-key replay",
  );
  const sql = docker([
    "exec",
    database,
    "psql",
    "-U",
    "review",
    "-d",
    "dragon_review_disposable",
    "-Atc",
    `SELECT (SELECT gold FROM guilds WHERE id='guild-buyer'),(SELECT gold FROM guilds WHERE id='guild-seller'),(SELECT count(*) FROM wallet_transactions),(SELECT owner_id FROM items WHERE id='${item.id}'),(SELECT count(*) FROM idempotency_records)`,
  ]);
  assert(
    sql === "9500|10500|2|guild-buyer|1",
    "independent SQL verifies one debit, credit, owner transfer and idempotency record",
  );
  const harness = await post("/lab/run", { scenario: "rollback" });
  assert(harness.status === 404, "no hosted test execution endpoint");
  const csrf = await fetch(base + "/api/guilds", {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ id: "unsafe", gold: 1, daily_limit: 0 }),
  });
  assert(csrf.status === 403, "mutation without same-origin rejected");
  const { chromium } =
    await import("../web/node_modules/@playwright/test/index.mjs");
  browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || "chrome",
    headless: true,
  });
  const context = await browser.newContext({
    httpCredentials: { username: "reviewer", password },
    viewport: { width: 1440, height: 1080 },
  });
  const page = await context.newPage();
  const browserErrors = [];
  page.on("pageerror", (e) => browserErrors.push(e.message));
  await page.goto(base);
  await page
    .getByRole("region", { name: "Human review deployment" })
    .getByText(commit, { exact: true })
    .waitFor();
  await page.getByTestId("wallet-total").waitFor();
  await page.screenshot({
    path: resolve(dir, "desktop-review.png"),
    fullPage: true,
  });
  await page.goto(base + "/#lab");
  await page.getByRole("button", { name: /Competing buyers/i }).click();
  assert(
    await page
      .getByRole("button", { name: "Local harness required" })
      .isDisabled(),
    "hosted Lab explains unavailable runner",
  );
  await page.reload();
  await page.getByRole("button", { name: /Competing buyers/i }).click();
  await page.getByRole("button", { name: "Local harness required" }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: resolve(dir, "mobile-review.png"),
    fullPage: true,
  });
  assert(
    browserErrors.length === 0,
    "real browser desktop/mobile and hash refresh without JavaScript errors",
  );
  await browser.close();
  browser = undefined;
  docker(["restart", app]);
  // Docker may allocate a new host port when restarting an ephemeral mapping.
  const restartedPort = docker(["port", app, "10000/tcp"]).split(":").at(-1);
  base = `http://127.0.0.1:${restartedPort}`;
  await ready(base + "/healthz", 90000);
  state = await (await get("/api/dev/snapshot")).json();
  assert(
    state.guilds.find((g) => g.id === "guild-buyer").gold === 9500,
    "restart verifies migration ledger and preserves changed balances",
  );
  assert(
    docker([
      "exec",
      app,
      "sh",
      "-c",
      "test ! -e /app/research-lab && test ! -e /var/run/docker.sock && id -u",
    ]) === "65532",
    "image nonroot, no test runner or Docker socket",
  );
  report.status = "PASS";
} catch (e) {
  report.status = "FAIL";
  report.error = e.message;
  throw e;
} finally {
  if (browser) await browser.close();
  for (const name of [app, database]) {
    try {
      if (
        docker([
          "inspect",
          "--format",
          '{{index .Config.Labels "dragon-market.review-smoke"}}',
          name,
        ]) === "true"
      )
        docker(["rm", "-fv", name]);
    } catch {}
  }
  try {
    if (
      docker([
        "network",
        "inspect",
        "--format",
        '{{index .Labels "dragon-market.review-smoke"}}',
        network,
      ]) === "true"
    )
      docker(["network", "rm", network]);
  } catch {}
  report.finished_at = new Date().toISOString();
  writeFileSync(resolve(dir, "results.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
