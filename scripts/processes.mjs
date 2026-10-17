import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { createServer } from "node:net";
export const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
export const bin = (name) =>
  resolve(
    root,
    "artifacts",
    name + (process.platform === "win32" ? ".exe" : ""),
  );
export function command(program, args, options = {}) {
  const r = spawnSync(program, args, {
    cwd: root,
    encoding: "utf8",
    stdio: "inherit",
    ...options,
  });
  if (r.error) throw r.error;
  if (r.status !== 0)
    throw new Error(`${program} ${args.join(" ")} exited ${r.status}`);
  return r.stdout?.trim();
}
export function child(program, args, options = {}) {
  const p = spawn(program, args, { cwd: root, stdio: "inherit", ...options });
  p.on("error", (e) => {
    console.error(e);
    process.exitCode = 1;
  });
  return p;
}
export function build(name, target) {
  mkdirSync(resolve(root, "artifacts"), { recursive: true });
  command("go", ["build", "-o", bin(name), target]);
  return bin(name);
}
export async function ready(url, timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Readiness deadline exceeded: ${url}`);
}
export function stop(p) {
  if (p && !p.killed) p.kill("SIGTERM");
}
export async function requireFreePorts(ports) {
  for (const port of ports)
    await new Promise((resolve, reject) => {
      const server = createServer();
      server.once("error", () =>
        reject(
          new Error(
            `Port ${port} is occupied. Stop or reconfigure its owner; no unrelated process was stopped.`,
          ),
        ),
      );
      server.listen(port, "127.0.0.1", () => server.close(resolve));
    });
}
