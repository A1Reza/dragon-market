# Changelog

## Unreleased

### Auction pricing

- Added a seller-selected auction `base_price`, stored separately from the item's oracle-updated base price.
- The Start auction form defaults to the item's exact current base price in integer smallest units. Sellers may keep it or choose any positive integer below or above it, including `1`.
- Every bid must meet the auction's base price, including the first bid and bids after cancellation of the highest active bid.
- Preserved the additional 5% minimum increment over the current active bid, rounded up in smallest units. For an auction starting at `500`, the first eligible bid is `500`; after that bid, the next minimum is `525`.
- Changing the auction price does not change the item's base price. Later oracle updates do not change the stored auction price.
- Auction cards now display the auction base price and the first-bid minimum. Bid inputs reject amounts below that auction price, and the form explains the pricing rules.

### API and persistence

- `POST /auctions` now requires a positive integer `base_price`. Missing, null, zero, negative, fractional, or out-of-range prices return HTTP 400.
- Auction creation, auction reads, and development inspection snapshots now include `base_price`; the frontend validates it as a positive amount.
- Bids below the applicable minimum return HTTP 409 with a message stating the minimum, without creating a bid, reserving funds, or adding a wallet audit entry. Zero bids return HTTP 400.
- Added `ErrInvalidBasePrice` and broadened the low-bid error wording to cover both the auction floor and the increment rule.
- Updated auction repository inserts and reads, API interfaces, test doubles, Research Lab fixtures, demo fixtures, and the Postman collection for the required field.

### Database compatibility

- Added migration `000012_auction_base_price` and its rollback. The new auction column is non-null and constrained to positive values; new rows have no implicit default.
- Existing auctions receive a base price of `1`, preserving their previous bidding contract and accepted bids.
- Fresh Docker Compose databases and test databases now include migration 12. The dedicated review initializer now expects 12 migrations, with its ledger and legacy-schema tests updated accordingly.
- Existing databases must apply migration 12 before running the updated backend. Existing migrations were not rewritten.

### Tests and documentation

- Expanded domain tests for auction prices below, equal to, and above the item's price, the minimum positive price, zero/negative rejection without state changes, oracle independence, cancellation, and bid increments.
- Added database-backed HTTP regressions for invalid auction inputs, price persistence in responses and snapshots, zero and below-floor bids, unchanged wallet state after rejection, and cancellation followed by a new bid.
- Added migration tests for the legacy minimum, required auction prices, and positive-value constraints. Expanded repository tests to verify persisted auction prices.
- Expanded fixed-price listing tests to verify that the existing zero/negative rejection leaves orders and item status unchanged.
- Expanded browser coverage for the exact unconverted item-price default, unchanged defaults, prices above and below the item's price, the minimum price of `1`, zero-price rejection for auctions and fixed-price listings, and below-floor bid rejection.
- Updated existing auction, concurrency, wallet, settlement, and review initialization tests for the new creation contract.
- Documented the pricing rules, API example, error responses, and migration compatibility in the README and auction form.
- Verification during this work passed: Go tests, Go race checks, `go vet`, frontend unit tests, frontend build and lint, and the expanded browser suite of 10 tests using disposable PostgreSQL databases.
