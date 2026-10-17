// Explicit, additive fixtures via original application endpoints. No SQL/reset.
const base = "http://127.0.0.1:8080";
async function api(path, body) {
  const response = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok)
    throw new Error(`${path}: ${response.status} ${await response.text()}`);
  return response.status === 204 ? null : response.json();
}
const state = await api("/dev/snapshot");
if (state.environment !== "development" || state.database !== "market")
  throw new Error(
    "Fixtures require the explicit local development market database",
  );
if (!state.guilds.some((g) => g.id === "guild-seller"))
  throw new Error("Seed guild-seller first");
const fixtures = [
  ["Emberglass blade", "rare", 700, "order"],
  ["Moonshard compass", "rare", 450, "order"],
  ["Apothecary vial", "common", 200, "free"],
  ["Crown of the Astral Sovereign", "legendary", 1200, "auction"],
  ["Wayfarer lantern", "common", 300, "free"],
];
for (const [name, type, price, listing] of fixtures) {
  if (state.items.some((i) => i.name === name)) {
    console.log("Retained existing " + name);
    continue;
  }
  const item = await api("/items", {
    name,
    type,
    owner_id: "guild-seller",
    base_price: price,
  });
  if (listing === "order")
    await api("/orders", {
      item_id: item.id,
      owner_id: "guild-seller",
      base_price: price,
    });
  if (listing === "auction")
    await api("/auctions", { item_id: item.id, seller_id: "guild-seller" });
  console.log(`Created real ${type} item: ${name}`);
}
console.log("Additive fixtures complete. Existing rows and balances retained.");
