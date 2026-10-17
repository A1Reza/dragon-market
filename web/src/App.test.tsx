import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { App } from "./App";
const base = {
  observed_at: "2026-10-17T08:00:00Z",
  environment: "development",
  database: "test",
  database_address: "local:5432",
  database_version: "16",
  backend_commit: "test",
  limit: 200,
  offset: 0,
  counts: { guilds: 2, items: 0 },
  guilds: [
    {
      id: "guild-seller",
      gold: 10000,
      reserved: 0,
      available: 10000,
      daily_limit: 5000,
      daily_spent: 0,
    },
    {
      id: "guild-buyer",
      gold: 9000,
      reserved: 1000,
      available: 8000,
      daily_limit: 5000,
      daily_spent: 1000,
    },
  ],
  items: [],
  orders: [],
  auctions: [],
  bids: [],
  audit: [],
};
afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
  location.hash = "";
});
it("shows loading, then switches to the selected persisted wallet (mocked API)", async () => {
  let resolve!: (r: Response) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(
      () =>
        new Promise<Response>((r) => {
          resolve = r;
        }),
    ),
  );
  render(<App />);
  expect(screen.getByRole("status")).toHaveTextContent("Reading the realm");
  resolve(
    new Response(JSON.stringify(base), {
      headers: { "Content-Type": "application/json" },
    }),
  );
  expect(await screen.findByTestId("wallet-total")).toHaveTextContent("100.00");
  fireEvent.change(
    screen.getByRole("combobox", { name: "Development Guild Switcher" }),
    { target: { value: "guild-buyer" } },
  );
  expect(screen.getByTestId("wallet-total")).toHaveTextContent("90.00");
  expect(sessionStorage.getItem("aethoria-guild")).toBe("guild-buyer");
});
it("renders actionable backend errors (mocked API)", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(new Response("snapshot unavailable", { status: 503 })),
  );
  render(<App />);
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent("snapshot unavailable"),
  );
  expect(
    screen.getByRole("button", { name: "Retry connection" }),
  ).toBeInTheDocument();
});
