import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { bin, build, child, command, ready, root, stop } from "./processes.mjs";
const name = "dragon-research-e2e-" + randomUUID().slice(0, 8);
const label = "dragon-market.disposable";
const processes = [];
let started = false,
  stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  processes.forEach(stop);
  if (started) {
    const value = command(
      "docker",
      ["inspect", "--format", `{{index .Config.Labels "${label}"}}`, name],
      { stdio: "pipe" },
    );
    if (value === "true") command("docker", ["rm", "-f", name]);
  }
  setTimeout(() => process.exit(), 300).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
try {
  build("dragon-e2e-server", "./cmd/server");
  build("dragon-e2e-lab", "./cmd/research-lab");
  command("docker", [
    "run",
    "-d",
    "--name",
    name,
    "--label",
    label + "=true",
    "-e",
    "POSTGRES_USER=research",
    "-e",
    "POSTGRES_PASSWORD=research",
    "-e",
    "POSTGRES_DB=dragon_research_disposable",
    "-p",
    "127.0.0.1::5432",
    "postgres:16-alpine",
  ]);
  started = true;
  writeFileSync(
    resolve(root, "artifacts/e2e-container.json"),
    JSON.stringify({ name, label, created_at: new Date().toISOString() }),
  );
  const deadline = Date.now() + 60000;
  while (true) {
    try {
      command(
        "docker",
        [
          "exec",
          name,
          "pg_isready",
          "-U",
          "research",
          "-d",
          "dragon_research_disposable",
        ],
        { stdio: "pipe" },
      );
      break;
    } catch (e) {
      if (Date.now() > deadline) throw e;
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  for (const file of readdirSync(resolve(root, "migrations/up"))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    command(
      "docker",
      [
        "exec",
        "-i",
        name,
        "psql",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        "research",
        "-d",
        "dragon_research_disposable",
      ],
      {
        input: readFileSync(resolve(root, "migrations/up", file)),
        stdio: ["pipe", "ignore", "inherit"],
      },
    );
  command(
    "docker",
    [
      "exec",
      "-i",
      name,
      "psql",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "research",
      "-d",
      "dragon_research_disposable",
    ],
    {
      input: readFileSync(resolve(root, "dev/seed.sql")),
      stdio: ["pipe", "ignore", "inherit"],
    },
  );
  const bindings = JSON.parse(
    command(
      "docker",
      ["inspect", "--format", "{{json .NetworkSettings.Ports}}", name],
      { stdio: "pipe" },
    ),
  );
  const port = bindings["5432/tcp"][0].HostPort;
  processes.push(
    child(bin("dragon-e2e-server"), [], {
      env: {
        ...process.env,
        APP_ENV: "development",
        HTTP_ADDR: "127.0.0.1:8085",
        PRICE_ORACLE_URL: "",
        DATABASE_URL: `postgres://research:research@127.0.0.1:${port}/dragon_research_disposable?sslmode=disable`,
      },
    }),
  );
  processes.push(
    child(bin("dragon-e2e-lab"), [], {
      env: { ...process.env, RESEARCH_LAB: "1", RESEARCH_LAB_PORT: "8087" },
    }),
  );
  await ready("http://127.0.0.1:8085/healthz");
  processes.push(
    child(
      process.execPath,
      [
        resolve(root, "web/node_modules/vite/bin/vite.js"),
        "--host",
        "127.0.0.1",
        "--port",
        "5175",
      ],
      {
        cwd: resolve(root, "web"),
        env: {
          ...process.env,
          API_TARGET: "http://127.0.0.1:8085",
          LAB_TARGET: "http://127.0.0.1:8087",
        },
      },
    ),
  );
  await ready("http://127.0.0.1:5175/api/dev/snapshot");
  console.log("E2E isolated stack ready on http://127.0.0.1:5175 · " + name);
} catch (e) {
  console.error(e);
  process.exitCode = 1;
  shutdown();
}
