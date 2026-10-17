# Initial architecture assessment

Inspected original revision `ac599ff4da21b31171c277c96c7ae808dac012a5` (clean `master`), 2026-10-17. Candidate work belongs on `feat/visual-research-workbench`. Human review: PENDING_HUMAN_REVIEW.

## Architecture and contracts

Go module `market-dragon`, language version 1.25.0; Chi, pgx through database/sql. `cmd/server` wires HTTP handlers to domain services and SQL repositories. Context-carried SQL transactions compose wallet, item, order, auction and idempotency operations. A minute worker settles auctions; optional oracle refresh runs immediately and every 30 seconds. PostgreSQL 16 Compose migrations initialize fresh volumes. No authentication or frontend exists.

All JSON writes require application/json, reject unknown fields and trailing JSON. Errors are plain text, not JSON. Routes at this revision:

| Route | Request | Actual success response |
|---|---|---|
| GET /healthz | none | 200, empty; process availability only |
| POST /guilds | id, gold, daily_limit | 201: id,gold,reserved,daily_spent,daily_limit,available |
| GET /guilds/{id}/wallet | none | 200: same wallet fields |
| POST /items | name,type,owner_id,base_price | 201: id,name,type,owner_id,status,base_price |
| GET /items | none | 200: array of **free** items only |
| GET /items/{id} | none | 200: item |
| POST /orders | item_id,owner_id,base_price; optional unused name | 201: id plus empty name/owner_id/status and zero base_price (mapping defect) |
| POST /orders/{id}/buy | buyer_id; Idempotency-Key required | 204; Idempotency-Replayed:true on replay |
| DELETE /orders/{id} | seller_id JSON body | 200, empty |
| POST /auctions | item_id,seller_id | 201: id,item_id,seller_id,ends_at,status |
| GET /auctions/{id} | none | 200: auction |
| POST /auctions/{id}/bids | bidder_id,amount; Idempotency-Key required | 201: id,auction_id,bidder_id,amount,placed_at,status |
| GET /bids/{id} | none | 200: bid |
| DELETE /auctions/{auctionID}/bids/{bidID}?bidder_id=… | none | 204 |

There are no discovery routes for guilds/orders/auctions/bids, nor persisted audit/status diagnostics. Error overrides mean a sold purchase returns 400; unauthorized cancellation returns 400; some auction creation errors return 400/404. The client must preserve these actual semantics.

## Rules and integrity

Gold is int64 smallest units. Wallet availability = gold-reserved. SQL checks enforce gold>=0, 0<=reserved<=gold and nonnegative daily values. Spend/reserve enforce a positive daily limit; zero means unlimited. Release reduces daily_spent, floored at zero. Daily reset occurs on wallet mutations using UTC, not wallet reads. Multiple fixed-price listings per item are intentionally possible; purchase cancels other listings. Purchase locks item before order, transfers funds/ownership and audits atomically. Auction listing requires free legendary ownership; bids require non-seller, positive amount and ceil(5%) increment; no base-price floor exists for the first bid. Outbid funds release; same bidder reserves only the delta. Highest active bid cancellation does not reactivate old bids. Final-five-minute bids extend the existing deadline by five minutes. Unique partial indexes enforce one active auction/item and bid/auction. Settlement charges reserved funds, pays seller, transfers ownership and ends the auction atomically. Idempotency completion shares the financial transaction.

## Existing tests

Domain tests use in-memory mocks (their transaction mocks do not prove rollback). HTTP httptest covers routing, missing items, health, cancellation path IDs. Repository TestMain always creates a PostgreSQL 16 Testcontainer and applies ten migrations. Existing SQL tests cover repositories, idempotency records, competing purchases, conflicting bids and auction creation. Oracle tests cover valid HTTP response, fallback and refresh. Important gaps: HTTP-to-persisted purchase replay, rollback after a late failure, settlement contention, bounded operation sequences, malformed oracle responses and browser flows. Original exact execution results are recorded separately in baseline-test-report.md.

## Defects and review questions found by inspection

1. Order creation serializes only ID, emitting false empty/zero domain fields. Reproduce with a handler regression test before fixing.
2. Order listing documentation says common/rare, but service lacks a legendary-type guard. Reproduce before applying a minimal rule fix.
3. Wallet Release after a UTC day rollover can subtract an old reservation from today's spending, potentially bypassing today's limit. Requires policy clarification/data-model work; do not silently redefine daily spending.
4. minimumNextBid arithmetic can overflow near int64 maximum. Large values need a regression and bounded handling.
5. Opposite wallet-lock order across independent purchases/auctions can deadlock; SQL aborts preserve atomicity but no automatic retry contract exists. Test/report separately from successful concurrency.

## Integration decision and risks

Use optional React/TypeScript/Vite in web, plain CSS and hash navigation (refresh safe). Browser talks only HTTP through a loopback Vite /api proxy. Keep Go runnable without Node. Add an opt-in development read-only snapshot API in infrastructure/transport, using a read-only repeatable-read transaction, bounded pages and no arbitrary SQL. Do not expand domain mutation interfaces merely for discovery. Disable diagnostics by default; bind loopback and require explicit development mode. Label client observations separately from persisted snapshots and isolated harness results. Numeric JS safety must reject unsafe integers rather than silently round int64 gold. Polling snapshots is observation, never a second state machine. Controlled scenarios C/F/G use a separate local test-process harness with disposable Testcontainers, never fault/reset endpoints on the Go application. Frontend code contains no hidden evaluation tests/reference solutions.

Read README, CONTRIBUTING, go.mod, Compose, Dockerfile.oracle, server, domain/services/repos/tests, API handlers/tests, idempotency, oracle, gold, all upward migrations, seed, ADRs, CI and Postman collection. Applied migrations and historical commits must remain immutable.
