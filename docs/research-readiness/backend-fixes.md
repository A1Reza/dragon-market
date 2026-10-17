# Validated backend fixes

## FIX-01: order HTTP representation

Expected: newly created listing response reflects seller, listing status and price. Actual original: only ID was populated; empty status/owner and zero price were emitted. `TestOrderCreationReturnsPersistedFields` fails on original handler. Minimal mapping fix in internal/api/order_handler.go; no transaction change. The legacy unused name field remains empty for compatibility; use item.name from discovery.

## FIX-02: legendary fixed-price eligibility

Expected documented domain: common/rare use orders, legendary uses auctions. Actual original: a free legendary item can be listed at a fixed price. `TestListRejectsLegendaryWithoutMutatingItem` fails before the fix. Minimal type guard in internal/order/service.go returns existing ErrInvalidOrder before mutation. Existing common/rare and multiple-listing behavior retained. This is an intentional backend rule correction, independently reviewable, not a frontend accommodation.

Evidence: artifacts/regressions-before.log captures both semantic failures; artifacts/regressions-after.log captures rerun. Tests were added before production changes. Neither assertion nor intended rule was weakened. No historical commits or applied migrations rewritten.

## FIX-03: minimum bid overflow

Near int64 maximum, `(current+19)/20` and addition overflowed, permitting a less-than-5% increment. TestBidIncrementRejectsUnrepresentableNextBid reproduces acceptance of MaxInt64 over MaxInt64-1. Division/remainder computes ceil safely; a zero sentinel denotes no representable eligible next amount and rejects the bid before reserving. Existing ordinary bids retain their exact arithmetic. The error remains ErrBidTooLow; for the out-of-range case the message reports minimum 0 (sentinel), so the code is safe but the diagnostic is limited.

## FIX-04: malformed trailing oracle payload

HTTP oracle accepted a valid first JSON object followed by garbage or another object. TestHTTPOracleRejectsTrailingPayload reproduces both cases. An EOF check now rejects trailing input before any price is returned. No pricing policy or refresh cadence changed. Evidence: artifacts/boundaries-before.log and boundaries-after.log.

## SETUP-01: original Compose nested read-only mount conflict

Observed during actual one-command startup: runc could not create the 999_seed.sql mountpoint inside the read-only migrations directory. Compose now mounts each immutable original migration file and the seed individually; SQL contents are unchanged. Startup then succeeded on a dedicated workbench host DB port (15432), preserving the unrelated service already using 5432. Original backend-only Compose defaults to 5432; POSTGRES_PORT can override it. No database was wiped. This is a development setup correction, not a domain fix.

## Test/driver corrections during implementation

The first browser run passed purchase/auction SQL checks but failed mobile focus and Lab report presentation. The skip link covered the mobile menu while focused; its position/focus activation were corrected. go test -json splits long output lines, so the test runner now reassembles events before parsing reports (with a unit regression). JSONB canonically reorders response fields: bid replay tests compare JSON semantics, not byte ordering; no domain assertion was weakened. Initial browser failures and final rerun evidence are preserved separately.

A subsequent isolated-stack run found that pg_isready can succeed against PostgreSQL's temporary initialization socket before the target database exists. The E2E readiness check now executes SELECT 1 against the named database over TCP, which becomes available only after initialization. No fixed delay or skipped assertion was introduced. The failed startup log is preserved as e2e-readiness-failure.log. Root verification also discovers npm in standard Windows, Node tarball, and Debian install layouts; clean Linux execution still requires independent CI observation.
