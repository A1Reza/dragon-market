import { afterEach, describe, expect, it, vi } from "vitest";
import {
  APIError,
  canList,
  gold,
  integer,
  mutate,
  newKey,
  nextBid,
  request,
} from "./api";
import { WalletSchema } from "./contracts";
afterEach(() => vi.unstubAllGlobals());
describe("real contract boundaries (mocked HTTP)", () => {
  it("maps empty 204 and replay header", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(null, {
            status: 204,
            headers: { "Idempotency-Replayed": "true", "X-Request-ID": "req" },
          }),
        ),
    );
    expect(await request("/orders/o/buy")).toEqual({
      status: 204,
      data: null,
      requestId: "req",
      replayed: true,
    });
  });
  it("preserves plain-text business rejections", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("daily limit reached\n", { status: 409 }),
        ),
    );
    await expect(request("/orders/o/buy")).rejects.toThrow(
      "daily limit reached",
    );
  });
  it("rejects malformed JSON success", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("{broken", {
            headers: { "Content-Type": "application/json" },
          }),
        ),
    );
    await expect(request("/items")).rejects.toBeInstanceOf(APIError);
  });
  it("sends an identical key and body for an explicit replay without automatic retries", async () => {
    const fetcher = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(new Response(null, { status: 204 })),
      );
    vi.stubGlobal("fetch", fetcher);
    const operation = {
      method: "POST" as const,
      path: "/orders/o/buy",
      body: { buyer_id: "buyer" },
      key: newKey(),
      actor: "buyer",
      label: "purchase",
    };
    await mutate(operation);
    await mutate(operation);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0][1].headers).toEqual(
      fetcher.mock.calls[1][1].headers,
    );
    expect(fetcher.mock.calls[0][1].body).toEqual(
      fetcher.mock.calls[1][1].body,
    );
    expect(newKey()).not.toEqual(operation.key);
  });
  it("does not retry a failed mutation", async () => {
    const f = vi.fn().mockRejectedValue(new Error("network"));
    vi.stubGlobal("fetch", f);
    await expect(
      mutate({
        method: "POST",
        path: "/items",
        actor: "seller",
        label: "create",
      }),
    ).rejects.toThrow();
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("passes cancellation through", async () => {
    const f = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", f);
    const controller = new AbortController();
    await request("/healthz", { signal: controller.signal });
    expect(f.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
});
describe("wallet and action mapping", () => {
  it("uses hundredths and authoritative available values", () => {
    expect(gold(12345)).toBe("123.45");
    expect(
      WalletSchema.parse({
        id: "g",
        gold: 1000,
        reserved: 200,
        available: 800,
        daily_limit: 0,
        daily_spent: 0,
      }).available,
    ).toBe(800);
  });
  it("rejects inconsistent wallets and unsafe int64 amounts", () => {
    expect(
      WalletSchema.safeParse({
        id: "g",
        gold: 1000,
        reserved: 200,
        available: 1000,
        daily_limit: 0,
        daily_spent: 0,
      }).success,
    ).toBe(false);
    expect(
      WalletSchema.safeParse({
        id: "g",
        gold: 1e18,
        reserved: 0,
        available: 1e18,
        daily_limit: 0,
        daily_spent: 0,
      }).success,
    ).toBe(false);
  });
  it("validates integer input, zero-limit semantics and display-only minimum", () => {
    expect(integer("100")).toBe(100);
    expect(integer("0", false)).toBe(0);
    for (const v of ["", "0", "1.5", "-1", "9007199254740992"])
      expect(() => integer(v)).toThrow();
    expect(nextBid(101)).toBe(107);
  });
  it("shows listing actions only for free owned items", () => {
    expect(canList({ owner_id: "g", status: "free", type: "rare" }, "g")).toBe(
      true,
    );
    expect(
      canList({ owner_id: "g", status: "listed_in_order", type: "rare" }, "g"),
    ).toBe(false);
    expect(
      canList({ owner_id: "other", status: "free", type: "legendary" }, "g"),
    ).toBe(false);
  });
});
