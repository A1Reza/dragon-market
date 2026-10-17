import {
  bin,
  build,
  child,
  command,
  ready,
  root,
  stop,
  requireFreePorts,
} from "./processes.mjs";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
// Explicit local values; never inherit a production database URL implicitly.
const processes = [];
const databasePort = process.env.WORKBENCH_DB_PORT || "15432";
if (
  !/^\d+$/.test(databasePort) ||
  Number(databasePort) < 1024 ||
  Number(databasePort) > 65535
)
  throw new Error("Invalid WORKBENCH_DB_PORT");
let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  processes.forEach(stop);
  console.log(
    "Local processes stopped. Compose data retained. Stop dependencies with docker compose stop.",
  );
  setTimeout(() => process.exit(), 500).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
try {
  if (!existsSync(resolve(root, "web/node_modules")))
    throw new Error("Install frontend dependencies first: npm --prefix web ci");
  await requireFreePorts([8080, 8090, 8082, 5173]);
  command("docker", ["compose", "up", "-d", "--wait", "postgres"], {
    env: { ...process.env, POSTGRES_PORT: databasePort },
  });
  build("dragon-server", "./cmd/server");
  build("dragon-oracle", "./cmd/mock-oracle");
  build("dragon-research-lab", "./cmd/research-lab");
  processes.push(child(bin("dragon-oracle"), []));
  processes.push(
    child(bin("dragon-server"), [], {
      env: {
        ...process.env,
        APP_ENV: "development",
        HTTP_ADDR: "127.0.0.1:8080",
        DATABASE_URL: `postgres://market:market@127.0.0.1:${databasePort}/market?sslmode=disable`,
        PRICE_ORACLE_URL: "http://127.0.0.1:8090",
      },
    }),
  );
  await ready("http://127.0.0.1:8080/healthz");
  processes.push(
    child(bin("dragon-research-lab"), [], {
      env: { ...process.env, RESEARCH_LAB: "1" },
    }),
  );
  processes.push(
    child(
      process.execPath,
      [
        resolve(root, "web/node_modules/vite/bin/vite.js"),
        "--host",
        "127.0.0.1",
      ],
      { cwd: resolve(root, "web") },
    ),
  );
  await ready("http://127.0.0.1:5173");
  console.log(
    `\nDragon Market — Aethoria: http://127.0.0.1:5173\nDevelopment database: market@127.0.0.1:${databasePort} · not authentication · Ctrl+C stops owned processes`,
  );
} catch (e) {
  console.error(e);
  process.exitCode = 1;
  shutdown();
}
