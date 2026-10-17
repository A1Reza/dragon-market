# Test coverage matrix

| Layer | Original evidence | Added evidence | Infrastructure / limits |
|---|---|---|---|
| Domain unit | Guild reserve/deduct/release/reset; order lifecycle; auction bid/cancel/settle | Legendary-order rejection; minimum-increment overflow | In-memory fakes; do not prove SQL rollback |
| HTTP contracts | Health, auction lookup, missing item, cancellation path | Truthful order response; diagnostic restrictions; real HTTP purchase/missing-key/replay/conflict | Handler fakes for mapping; real PostgreSQL for persisted HTTP purchase |
| PostgreSQL | Repository CRUD, idempotency claim/complete/rollback, concurrent buy/bid/auction creation | Repeatable-read discovery; page bounds; late-failure full rollback; exact replay wallet/audit/owner effects | Real postgres:16-alpine Testcontainers, no mocks |
| Concurrency | Shared start-channel purchase/bid/auction creation | HTTP competing buyers with SQL conservation; real worker/driver settlement contention | Synchronized start is contention opportunity, not exhaustive schedule exploration |
| Generated sequences | None | 120 bounded wallet operations, fixed seed 20261017; independently modeled results and audit count | One UTC day; not a universal property or model checker |
| Known defect characterization | None | Prior-day Release allows 800 spend with limit 500 | PASS of characterization means WAL-03 FAIL; never count as invariant success |
| Mutation examples | None | Missing audit and incorrect debit in temporary copies caught by persisted purchase test | Two valid killed mutants; no mutations in working implementation |
| Oracle | HTTP valid result, in-memory fallback, refresh | Trailing garbage and multiple-object rejection | Persisted restart/outage coverage insufficient |
| Frontend unit/component | None | 12 tests: HTTP mapping/errors/replay/no implicit retry/cancellation signal, money/integers/eligibility, loading/switch/errors | Mocked fetch; cannot establish backend correctness |
| Browser | None | Real item/list/buy/replay/ownership/wallet, auction/outbid/cancel/rejection, guild create, order cancel, refresh, mobile/keyboard, lab scenarios | Real local Go and isolated DB; direct SQL assertions. Installed Chrome locally; no other browser claim |
| CI | Formatting, vet, race (preserved) | Separate fast/integration/browser jobs and retained artifacts, container cleanup | Added configuration; remote execution NOT RUN until workflow is independently observed |

Exact latest command outcomes live in artifacts/final-verification.json and final-readiness-report.md. Raw logs accompany every claimed executed check. Test count is secondary to properties and failure diagnostics.
