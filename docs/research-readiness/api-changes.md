# API additions and changes

## Existing writes

See backend-fixes.md for two separately committed corrections. POST /orders now truthfully populates existing owner_id/status/base_price fields. The unused name remains empty. Legendary fixed-price listing now returns 400. Cancellation response contracts and all financial routes otherwise retain original behavior.

## GET /dev/snapshot?offset=0

Purpose: discover persisted guilds/items/orders/auctions/bids and inspect wallet audit without inventing client history. Enabled only when APP_ENV=development at server startup; default router returns 404. Loopback TCP peers only, ignoring forwarded IP headers. Server default bind changed to 127.0.0.1:8080; HTTP_ADDR can explicitly override it. This remains educational unauthenticated software and must not be exposed publicly or proxied for untrusted clients.

Response: observed_at, environment (development), database name/address/server version, backend commit (or unavailable), limit=200, offset, total counts and arrays guilds, items, orders, auctions, bids, audit. Field contracts live in internal/inspection/snapshot.go and web/src/contracts.ts. Collections have deterministic ordering, 200-row pages and explicit counts. Offset 0..100000. Audit IDs are database identifiers, not operation correlation IDs. Missing records on a bounded page are not evidence of absence. Read failures return 503; invalid offset 400; non-GET 405; non-loopback 403.

Queries: six parameterized bounded SELECTs, six constant-table COUNTs, and a server-identity SELECT, all inside a read-only REPEATABLE READ transaction with a five-second HTTP deadline. No FOR UPDATE; no mutations, migration or domain-interface change. Database identity excludes credentials. No oracle health is claimed. X-Request-ID is generated for each development HTTP request; it is transport correlation only, not stored in wallet audits.

Tests: TestDevelopmentInspectionRestrictions checks loopback/method/offset and default exclusion; TestInspectionSnapshotIsBoundedAndConsistent checks real SQL mapping, pagination, metadata, available amounts and absence of audit writes. Research snapshots cannot establish all historical correctness; use independent tests.

## Separate local harness (not application API)

cmd/research-lab, enabled only with RESEARCH_LAB=1, binds 127.0.0.1:8082. GET /healthz and POST /run accept only allowlisted scenario names (competing-buyers, rollback, settlement); JSON only; Origin restricted to local Vite addresses, remote peers denied; one scenario at a time. It runs fixed go test commands against the existing Testcontainers fixture and returns command/output/result. No supplied database URL, SQL, shell text, arbitrary test selector or reset is accepted. Each test process creates its own disposable PostgreSQL. This runner is absent from the application Docker image. It is optional and not available in production frontend serving.
