# Final readiness report

Candidate implementation: `8f31a33ecb6c94c7d26a26a2a6f617772ba27816`. Human approval: **PENDING_HUMAN_REVIEW**. Recorded 2026-10-17T07:18:40.000Z.

**The application is working and local automated checks pass; it is not an approved or fully correct research baseline. WAL-03 fails across UTC rollover.** KNOWN-01 needs a reviewed reservation/day model before claiming daily-limit safety. Passing characterization tests confirm this defect, not its repair.

Original: ac599ff4da21b31171c277c96c7ae808dac012a5; full original build/test/race/vet PASS before changes. Candidate adds isolated React UI, opt-in read-only discovery, independently executed persisted-state tests, local scenario driver and reproducible evidence. Four validated domain/contract boundary fixes and one Compose setup correction are documented separately.

## Executed evidence

- PASS: `go build ./...` — artifacts/go-build.log
- PASS: `go vet ./...` — artifacts/go-vet.log
- PASS: `go test -count=1 ./...` — artifacts/go-tests.log
- PASS: `go test -race -count=1 ./...` — artifacts/go-race.log
- PASS: `npm run typecheck` — artifacts/frontend-typecheck.log
- PASS: `npm run lint` — artifacts/frontend-lint.log
- PASS: `npm run test` — artifacts/frontend-test.log
- PASS: `npm run build` — artifacts/frontend-build.log
- PASS: Playwright (7 expected, 0 unexpected, 0 skipped); installed Chrome 155.0.8059.80; artifacts/playwright-final.json.
- PASS: two deliberately defective temporary copies detected by persisted-effect assertions; artifacts/mutations.json.
- Local services: artifacts/local-smoke.json; database PostgreSQL 16.14, application URL http://127.0.0.1:5173.

Initial browser failures are retained (e2e-initial.log/playwright-initial.json); mobile focus and split Go JSON report parsing were corrected before rerun. Reproduction initially revealed nested read-only Compose mount failure and an unrelated owner of port 5432; individual migration mounts and dedicated workbench port 15432 resolved startup without deleting data.

## Acceptance status

| Category | Criterion | Status | Evidence / command |
|---|---|---|---|
| Backend | Existing API functions | PASS | Browser original routes + independent SQL |
| Backend | Production Go build | PASS | go build ./... |
| Backend | Existing rules preserved except documented corrections | PASS | Full original + new tests; backend-fixes.md; does not assert WAL-03 |
| Backend | Unit and HTTP tests | PASS | go test -count=1 ./... |
| Backend | PostgreSQL integration tests | PASS | Testcontainers; no skips |
| Backend | Race tests | PASS | go test -race -count=1 ./... |
| Backend | Static analysis | PASS | go vet ./... |
| Backend | Critical contention tests | PASS | Competing buyers/bids/auction starts/settlement + identical keys |
| Backend | Persisted idempotency effects | PASS | HTTP purchase/bid replay + SQL state; concurrent identical key |
| Backend | Late-failure rollback | PASS | TestResearchRollback compares committed state |
| Backend | Invariant inventory | PASS | Parsed catalog with machine manifest |
| Backend | Daily limit cannot be bypassed across UTC rollover | FAIL | Known-issue-rollover.log; policy/data-model issue unresolved |
| Frontend | UI launches | PASS | 7 real browser tests; direct SQL and screenshots |
| Frontend | API connects | PASS | 7 real browser tests; direct SQL and screenshots |
| Frontend | Guild switching | PASS | 7 real browser tests; direct SQL and screenshots |
| Frontend | Item creation | PASS | 7 real browser tests; direct SQL and screenshots |
| Frontend | Fixed-price listing | PASS | 7 real browser tests; direct SQL and screenshots |
| Frontend | Purchase | PASS | 7 real browser tests; direct SQL and screenshots |
| Frontend | Auction creation | PASS | 7 real browser tests; direct SQL and screenshots |
| Frontend | Bidding | PASS | 7 real browser tests; direct SQL and screenshots |
| Frontend | Eligible bid cancellation | PASS | 7 real browser tests; direct SQL and screenshots |
| Frontend | Wallet reflects real persisted state | PASS | 7 real browser tests; direct SQL and screenshots |
| Frontend | Understandable rejected request | PASS | 7 real browser tests; direct SQL and screenshots |
| Frontend | Research Lab A through G | PASS | 7 real browser tests; direct SQL and screenshots |
| Frontend | Desktop and mobile layout | PASS | 7 real browser tests; direct SQL and screenshots |
| Frontend | Keyboard and direct refresh | PASS | 7 real browser tests; direct SQL and screenshots |
| Frontend | Unit/component tests | PASS | 12 tests with mocked HTTP; not backend evidence |
| Frontend | Browser E2E | PASS | Playwright Chrome, real Go/PostgreSQL, zero skips |
| Frontend | Production build | PASS | npm --prefix web run build |
| Research | Starting SHA recorded | PASS | ac599ff4da21b31171c277c96c7ae808dac012a5 |
| Research | Backend changes documented | PASS | Required documents inspected by collector; backend-fixes.md |
| Research | Known issues documented | PASS | Known-issues.md + known defect characterization |
| Research | Critical invariants independently tested | PASS | Bounded SQL tests; WAL-03 fails and other gaps catalogued |
| Research | Local setup executed | PASS | workbench.mjs plus local-smoke.json |
| Research | Clean Linux/macOS reproduction | NOT RUN | Only Windows executed; workflow config is not execution evidence |
| Research | Remote CI execution | NOT RUN | No push authorized or performed |
| Research | Human checklist available | PASS | Required documentation validation |
| Research | Candidate SHA recorded | PASS | 8f31a33ecb6c94c7d26a26a2a6f617772ba27816 |
| Research | Human approval remains pending | PASS | Manifest exact PENDING_HUMAN_REVIEW; not approval |
| Research | Approved baseline tag | NOT APPLICABLE | User explicitly reserves final approval/tag |

## Practical limits and next review

Execution history includes environmental failures as well as passes: one Chrome run encountered `ERR_NO_BUFFER_SPACE` during parallel host load, and one race invocation timed out during Docker fixture readiness before PostgreSQL tests started. The unchanged checks passed when rerun separately. See artifacts/browser-host-buffer-failure.json, playwright-host-buffer-failure.json, race-docker-readiness-failure.log, and the `attempts` entry in final-verification.json. These failures have not been removed or reclassified as successful executions.

Read known-issues.md, invariant-catalog.md and human-review-checklist.md. Some bounded invariant tests pass, one confirmed financial-policy property fails, and remote CI/clean non-Windows execution remain unverified. No proof or universal exactly-once claim is made. E2E fixtures and Testcontainers were isolated; shared data was never reset. Frontend component tests use mocks and are labeled as such. Original migrations remain unchanged. No remote push, force-push, rewritten original history or approved tag.

The candidate SHA is the implementation commit before this evidence ledger. A Git commit cannot contain its own hash; the later documentation-only commit records this SHA and execution results without changing implementation. Future experiments should use reviewed backend-only snapshots derived from that exact SHA, with research/hidden evaluation materials controlled separately.
