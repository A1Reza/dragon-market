# Reproduction guide

Candidate only; independent review required. Read known-issues.md before treating any property as established.

## One-command development after dependency installation

Prerequisites: Git, Go 1.25+, Node 24/npm, Docker Engine/Desktop with Linux containers running. Windows needs CGO/C compiler support for Go's race detector; this host successfully ran it. Linux/macOS use their supported Go race toolchain. No Make is required.

From a clean checkout on the candidate branch:

```text
npm --prefix web ci
node scripts/workbench.mjs
```

Open http://127.0.0.1:5173. API is 127.0.0.1:8080, mock oracle 8090, optional isolated runner 8082, PostgreSQL 15432 (WORKBENCH_DB_PORT overrides). The script sets POSTGRES_PORT for Compose; standalone Compose still defaults to 5432. The script builds host binaries into ignored artifacts/ and uses explicit loopback development configuration. It starts only Compose PostgreSQL, then host processes for oracle/API/runner/UI. No browser opens automatically. If a port is occupied, stop and inspect that process rather than killing unrelated work. Ctrl+C stops owned host processes. `docker compose stop` retains data.

Seeded guilds: guild-seller, guild-buyer, guild-bidder; 10000 smallest units (=100.00 G), limit 5000 (=50.00 G). Existing guild values are retained by ON CONFLICT DO NOTHING. The original README's integer gold examples are smallest units, not whole display G.

For an additive visual collection, explicitly run `node scripts/demo-fixtures.mjs` after startup. Five real artifacts, two fixed-price listings and one legendary auction are created via HTTP. Already named artifacts are retained. There is no fake browser data or automatic wallet reset; the price oracle may update item base prices while listed prices stay fixed.

## Original backend-only workflow

```text
docker compose up -d postgres oracle
```

PowerShell (separate API terminal):

```powershell
$env:DATABASE_URL='postgres://market:market@127.0.0.1:5432/market?sslmode=disable'
$env:PRICE_ORACLE_URL='http://127.0.0.1:8090'
go run ./cmd/server
```

POSIX shell:

```sh
DATABASE_URL='postgres://market:market@127.0.0.1:5432/market?sslmode=disable' PRICE_ORACLE_URL='http://127.0.0.1:8090' go run ./cmd/server
```

The default backend does **not** expose diagnostics. For the UI add APP_ENV=development to the API environment, then run `npm --prefix web run dev` in another terminal. Vite proxies /api to 127.0.0.1:8080; API_TARGET is a server-side Vite setting and VITE_API_BASE is the browser prefix. `.env.example` and `web/.env.example` document settings, but the Go server does not automatically load .env. PowerShell assigns `$env:APP_ENV='development'`; POSIX prefixes `APP_ENV=development`. Backend HTTP_ADDR defaults to loopback; explicitly override only in a trusted environment. Diagnostics require a loopback peer regardless of forwarded headers.

web/go.mod is only a traversal boundary: it prevents root `go build/test ./...` from scanning incidental Go sources shipped inside npm dependencies. The frontend contains no Go application; Node is still unnecessary for the backend.

Optional harness: PowerShell `$env:RESEARCH_LAB='1'; go run ./cmd/research-lab`; POSIX `RESEARCH_LAB=1 go run ./cmd/research-lab`. Run from repository root so fixed test paths resolve. It only accepts three allowlisted scenario names, rejects remote origins/peers, and starts fresh test-process PostgreSQL containers. It does not accept an application DB target or reset command. The application server never starts it implicitly.

## Migrations, seed, existing volumes

PostgreSQL initialization executes the original ten upward SQL files in order and then dev/seed.sql **only for a fresh data directory**. Applied files are immutable and unchanged. There is no general migration-version runner in this repository; do not run these non-idempotent ALTER statements again against an already initialized schema. Review migrations and compare migration checksums in the manifest before migrating an old installation. Reapply the idempotent seed only with the README command when schema is current.

No script resets the Compose database. To obtain disposable state, use E2E/Testcontainers rather than removing development volumes. E2E cleanup is explicit and positively checks both a generated name and disposable label. Never substitute a shared container name. Crash recovery: inspect `artifacts/e2e-container.json`, then run `node scripts/e2e-cleanup.mjs`; it refuses unrelated names/labels. Ordinary `docker compose down` stops/removes services without requesting volume deletion; keep existing data backed up and understood. Destructive `down -v` is intentionally not part of startup or verification.

## Verification

```text
node scripts/verify.mjs --fast
node scripts/verify.mjs
node scripts/mutation-check.mjs
```

Full verification independently executes Go build, vet, uncached full tests, uncached race tests, frontend typecheck/lint/unit tests/build. Testcontainers failures are failures, not skips. Logs with exact start/end timestamps and command exits appear in artifacts/verification/results.json. Fast mode excludes the SQL package and race run; it is not full correctness verification.

Mutation checking copies only Go sources/migrations/module files into verified temporary directories, injects two deliberate defects there, requires a semantic test failure, then removes those temporary directories. Original checkout and database remain untouched.

Browser setup and run:

```text
npm --prefix web exec -- playwright install chromium
npm --prefix web run test:e2e
```

Linux CI additionally installs OS dependencies with `npx playwright install --with-deps chromium` inside web. Local browser download may be geographically unavailable; installed Chrome can be selected using PLAYWRIGHT_CHANNEL=chrome. Local observed version is in final execution evidence. The test driver creates a unique disposable PostgreSQL database on a randomly bound loopback port; it disables price refresh to keep fixture prices deterministic. It starts real Go binaries, a separate lab runner, and Vite at 5175. It never reuses an already running server. Tests use readiness conditions, not fixed sleep delays. UI actions, direct SQL assertions, mobile/keyboard, screenshots and all lab scenarios are exercised. Raw Playwright JSON is artifacts/playwright-results.json; HTML/traces/screenshots are under web/. Successful representative screenshots are retained with research artifacts.

## Evidence and clean experiments

Original provenance and tests are preserved separately from candidate runs. Re-run tools on the reviewed source SHA in an isolated checkout; dependency lock and migration hashes are recorded. Candidate implementation SHA is recorded in a later documentation-only ledger commit because a Git commit cannot embed its own hash. The ledger is not an approval or final tag. Use the exact implementation SHA for experiments; omit UI/diagnostic/test-runner/research materials from backend task snapshots unless that exposure is explicitly part of the protocol. Keep hidden evaluation tests outside distributed frontend code. Archive external review decisions and never silently modify an approved baseline.

References used for integration: [Vite guide](https://vite.dev/guide/) and [Playwright webServer documentation](https://playwright.dev/docs/test-webserver). Local execution evidence takes precedence over assumptions from documentation.
