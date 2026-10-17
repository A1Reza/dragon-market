import { readFileSync, existsSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { command, root } from "./processes.mjs";
export default function cleanup() {
  const lease = resolve(root, "artifacts/e2e-container.json");
  if (!existsSync(lease)) return;
  const { name, label } = JSON.parse(readFileSync(lease, "utf8"));
  if (
    !/^dragon-research-e2e-[a-f0-9]{8}$/.test(name) ||
    label !== "dragon-market.disposable"
  )
    throw new Error("Refusing unknown cleanup target");
  let value;
  try {
    value = command(
      "docker",
      ["inspect", "--format", `{{index .Config.Labels "${label}"}}`, name],
      { stdio: "pipe" },
    );
  } catch {
    unlinkSync(lease);
    return;
  }
  if (value !== "true")
    throw new Error("Refusing container without disposable label");
  command("docker", ["rm", "-f", name]);
  unlinkSync(lease);
}
if (process.argv[1]?.endsWith("e2e-cleanup.mjs")) cleanup();
