import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

function sql(query: string) {
  const lease = JSON.parse(
    readFileSync(resolve("../artifacts/e2e-container.json"), "utf8"),
  );
  if (!/^dragon-research-e2e-[a-f0-9]{8}$/.test(lease.name))
    throw new Error("Unexpected test container");
  return execFileSync(
    "docker",
    [
      "exec",
      lease.name,
      "psql",
      "-U",
      "research",
      "-d",
      "dragon_research_disposable",
      "-At",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      query,
    ],
    { encoding: "utf8" },
  ).trim();
}
async function nav(page: Page, name: string) {
  if (await page.getByRole("button", { name: "Toggle navigation" }).isVisible())
    await page.getByRole("button", { name: "Toggle navigation" }).click();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name, exact: true })
    .click();
}
async function item(page: Page, name: string, type: string, basePrice = 700) {
  await nav(page, "Marketplace");
  await page.getByRole("button", { name: "Create item", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Artifact name").fill(name);
  await dialog.getByLabel("Item type").selectOption(type);
  await dialog.getByLabel("Base price").fill(String(basePrice));
  await dialog.getByRole("button", { name: "Confirm item" }).click();
  await expect(dialog).not.toBeVisible();
  return page
    .locator("article")
    .filter({ has: page.getByRole("heading", { name, exact: true }) });
}

test("real purchase, explicit replay, auctions, cancellation and persisted SQL effects", async ({
  page,
  request,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Welcome to the realm." }),
  ).toBeVisible();
  await expect(page.locator(".source-line")).toContainText(
    "dragon_research_disposable",
  );
  await page
    .getByRole("combobox", { name: "Development Guild Switcher" })
    .selectOption("guild-seller");
  const artifact = await item(page, "Emberglass blade", "rare");
  await artifact.getByRole("button", { name: "Create listing" }).click();
  await page.getByRole("dialog").getByLabel("Listing price").fill("700");
  await page.getByRole("button", { name: "Confirm list", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page
    .getByRole("combobox", { name: "Development Guild Switcher" })
    .selectOption("guild-buyer");
  await nav(page, "Orders");
  await page.getByRole("button", { name: "Purchase", exact: true }).click();
  await page
    .getByRole("button", { name: "Confirm purchase", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(
    page.getByRole("cell", { name: "sold", exact: true }),
  ).toBeVisible();
  expect(sql("SELECT gold FROM guilds WHERE id='guild-buyer'")).toBe("9300");
  expect(sql("SELECT gold FROM guilds WHERE id='guild-seller'")).toBe("10700");
  expect(sql("SELECT owner_id FROM items WHERE name='Emberglass blade'")).toBe(
    "guild-buyer",
  );
  expect(sql("SELECT count(*) FROM wallet_transactions")).toBe("2");
  await nav(page, "Transaction Inspector");
  await page
    .getByRole("button", { name: "Repeat exact request with same key" })
    .click();
  await page
    .getByRole("button", { name: "Repeat with same key", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.locator(".metadata")).toContainText("true");
  expect(sql("SELECT gold FROM guilds WHERE id='guild-buyer'")).toBe("9300");
  expect(sql("SELECT count(*) FROM wallet_transactions")).toBe("2");
  expect(sql("SELECT count(*) FROM idempotency_records")).toBe("1");
  await page.screenshot({
    path: testInfo.outputPath("purchase-inspector.png"),
    fullPage: true,
  });
  await nav(page, "Wallet");
  await expect(page.getByTestId("wallet-total")).toContainText("93.00");
  await page
    .getByRole("combobox", { name: "Development Guild Switcher" })
    .selectOption("guild-seller");
  const legendary = await item(
    page,
    "Crown of the Astral Sovereign",
    "legendary",
  );
  await legendary.getByRole("button", { name: "Start auction" }).click();
  const auctionPrice = page
    .getByRole("dialog")
    .getByLabel("Auction base price");
  await expect(auctionPrice).toHaveValue("700");
  await auctionPrice.fill("0");
  await page
    .getByRole("button", { name: "Confirm auction", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(
    await auctionPrice.evaluate(
      (input: HTMLInputElement) => input.validity.rangeUnderflow,
    ),
  ).toBe(true);
  expect(sql("SELECT count(*) FROM auctions")).toBe("0");
  await auctionPrice.fill("500");
  await page
    .getByRole("button", { name: "Confirm auction", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(sql("SELECT base_price FROM auctions")).toBe("500");
  await page
    .getByRole("combobox", { name: "Development Guild Switcher" })
    .selectOption("guild-buyer");
  await nav(page, "Auctions");
  await expect(page.locator(".auction-card")).toContainText(
    "Auction base price:",
  );
  await expect(page.locator(".auction-card")).toContainText(
    "First bid must be at least 500",
  );
  await page.getByRole("button", { name: "Place bid", exact: true }).click();
  await page.getByRole("dialog").getByLabel("Bid amount").fill("1");
  await expect(
    page.getByRole("dialog").getByLabel("Bid amount"),
  ).toHaveAttribute("min", "500");
  await page.getByRole("button", { name: "Confirm bid", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(sql("SELECT count(*) FROM bids")).toBe("0");
  await page.getByRole("dialog").getByLabel("Bid amount").fill("500");
  await page.getByRole("button", { name: "Confirm bid", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(sql("SELECT reserved FROM guilds WHERE id='guild-buyer'")).toBe("500");
  // A below-increment bid exercises actual visible API error handling.
  await page
    .getByRole("combobox", { name: "Development Guild Switcher" })
    .selectOption("guild-bidder");
  await page.getByRole("button", { name: "Place bid", exact: true }).click();
  await page.getByRole("dialog").getByLabel("Bid amount").fill("501");
  await page.getByRole("button", { name: "Confirm bid", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "minimum bid",
  );
  await page.getByRole("dialog").getByLabel("Bid amount").fill("550");
  await page.getByRole("button", { name: "Confirm bid", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(sql("SELECT reserved FROM guilds WHERE id='guild-buyer'")).toBe("0");
  expect(sql("SELECT reserved FROM guilds WHERE id='guild-bidder'")).toBe(
    "550",
  );
  await page.getByText("Bid history on this page").click();
  await page
    .getByRole("button", { name: "Cancel highest bid", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm cancel bid", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(sql("SELECT reserved FROM guilds WHERE id='guild-bidder'")).toBe("0");
  await expect(page.locator(".auction-card")).toContainText(
    "First bid must be at least 500",
  );
  const snapshot = await (await request.get("/api/dev/snapshot")).json();
  const cancelled = snapshot.bids.find(
    (b: { status: string }) => b.status === "cancelled",
  );
  const invalid = await request.delete(
    `/api/auctions/${cancelled.auction_id}/bids/${cancelled.id}?bidder_id=guild-bidder`,
  );
  expect(invalid.status()).toBe(409);
  await page.screenshot({
    path: testInfo.outputPath("auction-history.png"),
    fullPage: true,
  });
  await nav(page, "Overview");
  await page.screenshot({
    path: testInfo.outputPath("overview-desktop.png"),
    fullPage: true,
  });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Welcome to the realm." }),
  ).toBeVisible();
  await expect(page.locator(".source-line")).toBeVisible();
  expect(errors).toEqual([]);
});

for (const selectedPrice of [undefined, 8765, 1]) {
  test(`auction price defaults exactly to item price and accepts ${selectedPrice ?? "the unchanged default"}`, async ({
    page,
  }) => {
    await page.goto("/");
    await page
      .getByRole("combobox", { name: "Development Guild Switcher" })
      .selectOption("guild-seller");
    const name = `Auction pricing ${selectedPrice ?? "default"}`;
    const artifact = await item(page, name, "legendary", 4321);
    await artifact.getByRole("button", { name: "Start auction" }).click();
    const dialog = page.getByRole("dialog");
    const price = dialog.getByLabel("Auction base price");
    await expect(price).toHaveValue("4321");
    if (selectedPrice !== undefined) await price.fill(String(selectedPrice));
    await dialog
      .getByRole("button", { name: "Confirm auction", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    expect(
      sql(
        `SELECT a.base_price,i.base_price FROM auctions a JOIN items i ON i.id=a.item_id WHERE i.name='${name}'`,
      ),
    ).toBe(`${selectedPrice ?? 4321}|4321`);
    await nav(page, "Auctions");
    await expect(
      page
        .locator(".auction-card")
        .filter({ has: page.getByRole("heading", { name, exact: true }) }),
    ).toContainText(
      `First bid must be at least ${selectedPrice ?? 4321} smallest units`,
    );
  });
}

test("guild creation and listing cancellation are real mutations", async ({
  page,
}) => {
  await page.goto("/#wallet");
  await page.getByRole("button", { name: "Create guild", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Guild ID")
    .fill("guild-browser-created");
  await page
    .getByRole("button", { name: "Confirm guild", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Development Guild Switcher" }),
  ).toHaveValue("guild-browser-created");
  expect(sql("SELECT gold FROM guilds WHERE id='guild-browser-created'")).toBe(
    "10000",
  );
  const card = await item(page, "Apothecary flask", "common");
  await card.getByRole("button", { name: "Create listing" }).click();
  const listingPrice = page.getByRole("dialog").getByLabel("Listing price");
  await listingPrice.fill("0");
  await page.getByRole("button", { name: "Confirm list", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(
    await listingPrice.evaluate(
      (input: HTMLInputElement) => input.validity.rangeUnderflow,
    ),
  ).toBe(true);
  expect(
    sql(
      "SELECT count(*) FROM limit_orders o JOIN items i ON i.id=o.item_id WHERE i.name='Apothecary flask'",
    ),
  ).toBe("0");
  await listingPrice.fill("700");
  await page.getByRole("button", { name: "Confirm list", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await nav(page, "Orders");
  await page
    .getByRole("row")
    .filter({ hasText: "Apothecary flask" })
    .getByRole("button", { name: "Cancel listing", exact: true })
    .click();
  await page.getByRole("button", { name: "Confirm cancel order" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(sql("SELECT status FROM items WHERE name='Apothecary flask'")).toBe(
    "free",
  );
});

test("mobile navigation, keyboard focus and refresh-safe routes", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#marketplace");
  await expect(
    page.getByRole("heading", { name: "Marketplace", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".source-line")).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Marketplace", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to content" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
  await nav(page, "Wallet");
  await expect(page.getByTestId("wallet-total")).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("wallet-mobile.png"),
    fullPage: true,
  });
  await nav(page, "System Status");
  await page.getByRole("button", { name: "Check services" }).click();
  await expect(
    page.getByText("Healthy · HTTP 200 · empty process response"),
  ).toBeVisible();
});

test("Research Lab A/B/D/E uses real endpoints and displays expected rejection", async ({
  page,
}) => {
  await page.goto("/#lab");
  await page.getByRole("button", { name: /Normal purchase/ }).click();
  await page.getByRole("button", { name: "Prepare unique fixture" }).click();
  await expect(page.getByText("Fixture ready")).toBeVisible();
  await page
    .getByRole("button", { name: "Submit purchase", exact: true })
    .click();
  await expect(page.locator(".scenario-panel pre")).toContainText(
    "Observed expected net transfer and ownership",
  );
  await expect(
    page.getByRole("button", {
      name: "Repeat exact purchase with same key",
      exact: true,
    }),
  ).toBeDisabled();
  await page.getByRole("button", { name: /Idempotent retry/ }).click();
  await page.getByRole("button", { name: "Prepare unique fixture" }).click();
  await expect(page.getByText("Fixture ready")).toBeVisible();
  await page
    .getByRole("button", { name: "Submit purchase", exact: true })
    .click();
  await expect(
    page.getByText("Observed expected net transfer and ownership", {
      exact: false,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Repeat exact purchase with same key",
      exact: true,
    })
    .click();
  await expect(page.locator(".scenario-panel pre")).toContainText(
    '"replayed": true',
  );
  await page.getByRole("button", { name: /Auction bidding/ }).click();
  await page.getByRole("button", { name: "Prepare unique fixture" }).click();
  await expect(page.getByText("Fixture ready")).toBeVisible();
  await page.getByRole("button", { name: "First bid · 100 units" }).click();
  await page.getByRole("button", { name: "Outbid · 110 units" }).click();
  await expect(page.locator(".scenario-panel pre")).toContainText(
    '"reserved": 110',
  );
  await page.getByRole("button", { name: /Bid cancellation/ }).click();
  await page.getByRole("button", { name: "Prepare unique fixture" }).click();
  await expect(page.getByText("Fixture ready")).toBeVisible();
  await page.getByRole("button", { name: "First bid · 100 units" }).click();
  await page.getByRole("button", { name: "Outbid · 110 units" }).click();
  await page
    .getByRole("button", { name: "Attempt invalid cancellation" })
    .click();
  await expect(page.locator(".scenario-panel pre")).toContainText(
    "Expected business-rule rejection",
  );
  await page
    .getByRole("button", { name: "Cancel highest bid", exact: true })
    .click();
  await expect(page.locator(".scenario-panel pre")).toContainText(
    '"reserved": 0',
  );
});

for (const name of [
  "Competing buyers",
  "Failure & rollback",
  "Auction settlement",
])
  test(`Research Lab ${name} executes isolated PostgreSQL assertions`, async ({
    page,
  }) => {
    await page.goto("/#lab");
    await page
      .getByRole("button", { name: new RegExp(name.replace("&", "&")) })
      .click();
    await page.getByRole("button", { name: "Run isolated scenario" }).click();
    await expect(page.locator(".scenario-panel h3")).toContainText("PASS", {
      timeout: 150000,
    });
    await expect(page.locator(".scenario-panel pre").first()).toContainText(
      "independent PostgreSQL reads",
    );
  });
