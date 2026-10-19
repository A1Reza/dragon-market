import { z } from "zod";
const amount = z.number().int().safe().nonnegative();
export const WalletSchema = z
  .object({
    id: z.string(),
    gold: amount,
    reserved: amount,
    available: amount,
    daily_limit: amount,
    daily_spent: amount,
    daily_spent_on: z.string().optional(),
  })
  .refine(
    (w) => w.gold - w.reserved === w.available,
    "Inconsistent wallet response",
  );
export const ItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(["common", "rare", "legendary"]),
  owner_id: z.string(),
  status: z.enum(["free", "listed_in_order", "listed_in_auction"]),
  base_price: amount,
});
export const OrderSchema = z.object({
  id: z.string(),
  item_id: z.string(),
  seller_id: z.string(),
  buyer_id: z.string().nullable(),
  price: amount,
  status: z.enum(["listed", "sold", "canceled"]),
  listed_at: z.string(),
});
export const AuctionSchema = z.object({
  id: z.string(),
  item_id: z.string(),
  seller_id: z.string(),
  base_price: amount.positive(),
  ends_at: z.string(),
  status: z.enum(["active", "ended"]),
});
export const BidSchema = z.object({
  id: z.string(),
  auction_id: z.string(),
  bidder_id: z.string(),
  amount: amount,
  status: z.enum(["active", "outbid", "cancelled", "winning"]),
  placed_at: z.string(),
});
export const AuditSchema = z.object({
  id: amount,
  guild_id: z.string(),
  operation: z.string(),
  amount,
  gold_after: amount,
  reserved_after: amount,
  created_at: z.string(),
});
export const SnapshotSchema = z.object({
  observed_at: z.string(),
  environment: z.literal("development"),
  database: z.string(),
  database_address: z.string(),
  database_version: z.string(),
  backend_commit: z.string(),
  limit: z.number(),
  offset: z.number(),
  counts: z.record(z.string(), z.number()),
  guilds: z.array(WalletSchema),
  items: z.array(ItemSchema),
  orders: z.array(OrderSchema),
  auctions: z.array(AuctionSchema),
  bids: z.array(BidSchema),
  audit: z.array(AuditSchema),
});
export type Wallet = z.infer<typeof WalletSchema>;
export type Item = z.infer<typeof ItemSchema>;
export type Order = z.infer<typeof OrderSchema>;
export type Auction = z.infer<typeof AuctionSchema>;
export type Bid = z.infer<typeof BidSchema>;
export type Snapshot = z.infer<typeof SnapshotSchema>;
export type Mutation = {
  method: "POST" | "DELETE";
  path: string;
  body?: unknown;
  key?: string;
  actor: string;
  label: string;
  target?: string;
};
export type Reply<T = unknown> = {
  status: number;
  data: T;
  requestId: string | null;
  replayed: boolean;
};
export type Trace = {
  id: string;
  at: string;
  request: Mutation;
  reply?: Reply;
  error?: string;
  before?: Snapshot;
  after?: Snapshot;
  observationError?: string;
};
