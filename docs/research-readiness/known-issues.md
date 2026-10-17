# Known issues and limits

Human review is PENDING_HUMAN_REVIEW. Green CI does not override the following issue.

## KNOWN-01 — daily spending across UTC rollover (confirmed, unresolved)

Severity: material transactional policy defect. Expected candidate property: spending on a day cannot exceed a positive daily limit by releasing reservations originating on previous days. Actual: reserve 500 yesterday; spend 300 today (reset daily_spent to 300); release the old 500 (daily_spent becomes 0); spend 500 today. Gold decreases by 800 while limit=500 and recorded daily_spent=500. Reservation consistency remains valid, but the daily-limit property fails.

Reproduction: `go test -v ./internal/postgres -run TestKnownIssuePriorDayReleaseReducesTodaySpending -count=1`; raw evidence artifacts/known-issue-rollover.log. This **characterization test passes when the defect is observed**, not when daily limits are safe. It must not be cited as passing invariant WAL-03. The ordinary bounded sequence test covers one day only.

Safe fix investigation: Release currently receives only guild ID and amount; there is no reservation identity or originating day in its contract. Removing its daily_spent reduction would change tested same-day cancellation policy. Tracking only an aggregate daily reserve cannot reliably distinguish an old cancellation from a new reservation across different auctions. A sound repair requires a reviewed reservation/day allocation model and tests across multiple auctions, UTC midnight, cancellation and settlement. No broad financial-policy rewrite was included in this UI baseline. **Research readiness remains conditional / this invariant FAIL.**

## Other limitations requiring review

- Independent opposing financial operations can acquire guild locks in different orders. PostgreSQL deadlock victim rollback preserves atomicity, but there is no transparent retry policy. Cross-auction and cross-purchase deadlock stress is NOT RUN.
- Cancellation and settlement charge/release daily spending according to reservation-time semantics; crossing days needs an explicit policy decision.
- Diagnostic collections show a bounded page of 200 each. Counts and offsets are exposed; the UI currently displays the first page, not a complete export. Selected entities outside that page may be unavailable. Audit rows lack request identifiers; they cannot reliably be attributed to an individual client trace.
- Gold is int64 in Go; browser contracts reject values outside Number.MAX_SAFE_INTEGER. The UI cannot inspect every valid int64 account. Numeric overflow regression covers bid minimum only, not every int64 combination.
- Snapshots use repeatable-read, but before/after snapshots bracket other possible activity; comparisons are observational and not causality proofs.
- No production authentication. Loopback development services and origin checks are not a public deployment security model. Do not publish this workbench. APP_ENV=development must remain off in production.
- Oracle operational health is unsupported by the API; /healthz is process-only. A successful snapshot verifies database readability, not correctness. Backend build VCS revision can be unavailable for go run/local builds.
- Browser traces are memory-only and cleared on reload. They are not persisted database history. No hidden evaluation tests or benchmark reference solutions are distributed to the browser.
- Local testing uses Go 1.26 on Windows; the module/CI specify 1.25. Clean Linux CI execution must be checked by a human; configuration alone is not executed CI evidence.
- Browser package download was region-blocked locally. Installed Chrome is used via PLAYWRIGHT_CHANNEL=chrome; record its exact version in execution evidence. Chromium/Firefox/WebKit coverage is not implied.
- One expanded browser run failed with Chrome `net::ERR_NO_BUFFER_SPACE` while full race and mutation checks were executing concurrently. The saved network trace identifies the failed auction-creation request. Browser checks are rerun separately with unchanged assertions; the failed run is retained, not classified as a pass. Multi-request Lab preparation can leave its already-created unique guilds/items when a later request fails; it never resets shared data or silently retries non-idempotent writes.
- The original down-migration set is incomplete and contains two migration-5 alternatives. Full schema downgrade is not verified or used by the workbench; forward initialization of fresh disposable databases is the tested path.
- Compose retains the original implicit PostgreSQL data volume behavior. Use `docker compose stop` for routine shutdown; removing the container with `down` can orphan its anonymous-volume association on a later `up`, even without deleting that volume. No automatic conversion to a named volume or shared-data migration was attempted.
- A candidate race invocation was blocked by a Docker readiness/exec-inspection timeout before PostgreSQL tests started. The unchanged race command passed when rerun alone. Both attempts are retained in final-verification.json and race-docker-readiness-failure.log; this is environment fragility, not a reported Go data race. Original PowerShell raw logs may be UTF-16LE; Node-generated final verification logs are UTF-8.

Fixed defects and original failing regression evidence are in backend-fixes.md. No applied migration was edited.
