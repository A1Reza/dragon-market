# Temporary Render + Neon human review

2026-10-18 integration update: `master` now integrates the wallet repair and migration 11 into the
review deployment. Render's blueprint selects `master` with automatic deployment still disabled.
Fresh review databases apply all 11 migrations before seeding; populated legacy databases are refused
without modifying their data. The UI reports the repair status and deployed commit. Earlier candidate
identities and reports below are historical; independent human approval remains pending. See the
[integration report](../transactional-correctness-baseline/integration.md).

This is a separate deployment phase before AI-agent experiments. Approval remains **PENDING_HUMAN_REVIEW**. The implementation candidate is `8f31a33ecb6c94c7d26a26a2a6f617772ba27816`; deployment work is on `feat/human-review-deployment`, descended from evidence ledger `b88407ee3559c512fdcb832b6b31c25dc4858d3f`. Existing candidate manifests and evidence have not been rewritten. The site shows its actual Render deployment commit separately from that earlier implementation candidate.

## Architecture and boundaries

Render builds `Dockerfile.review`: React static assets and the original Go server binary, plus a separate `cmd/review` supervisor/gateway. Only the gateway listens publicly on `$PORT`. The original server listens on `127.0.0.1:8080` inside the container; its existing development snapshot retains its loopback restriction. Every UI asset and `/api/*` route requires a reviewer username/password. `/healthz` alone is public, returning process availability without database details. Render terminates public HTTPS. Never expose this HTTP gateway directly to the internet without HTTPS.

The reviewer password is an invitation gate, not guild authorization or individual reviewer attribution. All invited reviewers can use the development guild switcher and mutate shared review fixtures. Share credentials privately, rotate them if access changes, use no real data or money, and keep feedback attribution in review issues. HTTP Basic credentials can remain in the browser until its session is closed; there is no application logout. Do not put them in URLs or browser storage.

The gateway strips review credentials before proxying, denies cross-site requests, requires same-origin `Origin` on mutations, bounds request bodies, disables directory listing, and marks responses no-store/noindex. These controls are tested; they are not a production security certification. `APP_ENV=development` is set only for the private child process, behind the gate. Neither `cmd/server` nor any domain service was changed for hosting.

There is **no hosted test runner, reset endpoint, fault injection, Docker socket, arbitrary SQL endpoint or database reset**. Lab A/B/D/E use real application APIs and add unique fixtures. Lab C/F/G explicitly require local execution; the UI links recorded evidence and reproduction instructions without implying it ran those tests remotely. Oracle refresh is disabled in this deployment; its health remains unsupported. The original settlement worker runs while the instance is awake.

Neon holds a separate PostgreSQL 16 database named exactly `dragon_review_disposable`. Startup requires both that name and the explicit acknowledgement environment variable. It refuses an existing populated public schema without its review migration ledger, takes a transaction advisory lock, applies the original ten SQL migrations and existing development seed once, and verifies SHA-256 file checksums on restart. The ledger is review-only schema metadata, not a new domain migration. A changed file or failed initialization stops deployment; no automatic repair, drop or reset occurs. Migrate a genuinely new schema version only after designing and reviewing a migration path.

## Publish with your accounts

Account login and pushing this new branch require the repository owner's action/authorization; no cloud credentials are stored in this repository. Do not paste a Neon URL or reviewer password into a public issue or chat transcript.

1. Create a **new dedicated Neon Free project** with PostgreSQL **16**, preferably in a region near Render Frankfurt. Create a database named `dragon_review_disposable`. Never select a database used by another app. Copy its **direct** connection URL from the Connect dialog, selecting that database. It must include `sslmode=require`. Prefer the direct endpoint for this single-instance review app; migrations use a transactional advisory lock. Keep the connection URL in Render's secret environment configuration only.
2. After authorizing a push, publish this branch: `git push -u origin feat/human-review-deployment`. This command was not executed automatically. No force push or approved tag is needed.
3. Sign in to [Render](https://dashboard.render.com/), choose **New → Blueprint**, connect `houtanrocky/dragon-market`, and select branch `feat/human-review-deployment`. Use the root `render.yaml`. Confirm the service is **Free**, with no Render PostgreSQL database or paid resource. The Blueprint sets automatic deployments **off** so review revisions change deliberately.
4. Enter `DATABASE_URL` (the dedicated Neon URL) and `REVIEW_USERNAME` (for example `reviewer`). Render generates `REVIEW_PASSWORD`; copy it privately from the service environment after creation. It must contain at least 24 bytes. `REVIEW_DISPOSABLE_DATABASE=dragon_review_disposable` is declared in the Blueprint. Render supplies `PORT` and `RENDER_GIT_COMMIT`; do not replace the commit with the earlier candidate SHA. For non-Render image tests, `REVIEW_COMMIT` is an explicit fallback.
5. Deploy. Startup initializes only the dedicated database, then starts the private backend and public gateway. Open the **actual HTTPS `onrender.com` URL returned by Render**; the browser should prompt for credentials. Do not assume a guessed hostname is live. Verify the checks below before inviting reviewers.

Use the dashboard for secrets; there is no need to commit a `.env` file. If connection setup fails, verify the database name, direct endpoint, TLS and migrations first. Do not disable database safeguards to make deployment start.

## Check the actual hosted service

- Unauthenticated `/`, `/api/dev/snapshot`, `/review/config` and assets must return 401. `/healthz` may return 200; it does not establish database correctness.
- After login, the banner must show the Render deployed SHA, earlier implementation candidate, pending approval and WAL-03 warning. System Status must identify the dedicated database. Never review an unidentified revision.
- Use Lab A/B to create unique fixtures, purchase and explicitly replay the same key. Inspect before/after observations. Independently verify important effects through the documented isolated tests; the shared online state can include other reviewers' activity.
- Use D/E for reservation/outbid/cancellation observations. C/F/G must show “Local harness required”; `/lab/run` must not execute tests.
- Check desktop/mobile, keyboard focus, errors, and page refresh. Capture sanitized screenshots and link them to the exact revision.
- Verify actual GitHub CI and the independently executed backend tests. The local Docker smoke result is not a Render/Neon deployment check.

## Review protocol and stopping rule

Invite reviewers with different roles: at least one Go/PostgreSQL reviewer for transactions and tests, plus usability/accessibility reviewers. Use [the finding template](../../.github/ISSUE_TEMPLATE/human-review.yml), which records deployed commit, reproduction, expected rule, observed evidence and uncertainty. GitHub must load the issue template from the default branch for the query link to select it; until this branch is merged, copy the template into a blank issue or a private review record. No issues are posted automatically.

Track findings against each invariant in the catalog and the human-review checklist. Prioritize KNOWN-01/WAL-03: the prior-day reservation release defect is unresolved and cannot be dismissed because the UI looks correct or its characterization test passes. Decide the spending policy, implement a separately reviewed regression and fix, then rerun relevant checks. If excluding this invariant from the study instead, document the scientific rationale and implications explicitly. Resolve other material findings and obtain an explicit human decision; reviewer count alone is not an approval criterion.

After accepted changes, create a new candidate commit and manifest, independently rerun backend/database/concurrency/rollback/idempotency/race/browser checks, and record human approval externally against the exact commit. Only the human may approve/freeze/tag the research baseline. Future AI-agent experiments use isolated checkouts and databases derived from that reviewed commit, with backend-only task snapshots and a predefined policy for access to research materials. Never use the shared review database as experiment input. Never silently change an approved baseline.

After the review window, stop/delete the Render service through its dashboard. Export sanitized review findings and evidence first. Delete the dedicated Neon project only after verifying its identity and explicitly choosing to discard its disposable data; this repository does not automate deletion. Keep the reviewed code/evidence and review decisions.

## Costs and operational limits

Render Free can spin down after inactivity and has monthly usage limits; waking can delay a reviewer request. Neon Free has storage/compute quotas and scale-to-zero. This application's settlement polling can keep the database awake while the app is running. Monitor both dashboards, stop the site outside the review window if needed, and do not enable paid upgrades or artificial keep-alive pings. Settlement deadlines still use backend UTC, but execution may be delayed by hosting sleep. This is unsuitable for timing/performance measurements or unattended settlement guarantees.

The deployment is designed for a small temporary review group. Free-tier availability, quotas and regional restrictions can change. See the current primary documentation: [Render Free](https://render.com/docs/free), [Blueprint specification](https://render.com/docs/blueprint-spec), [Neon plans](https://neon.com/pricing), [Neon connection configuration](https://neon.com/docs/connect/connect-from-any-app).

## Reproduce deployment verification locally

```text
docker build -f Dockerfile.review -t dragon-market-review:local .
node scripts/review-smoke.mjs
```

Requires Docker, `npm --prefix web ci`, and installed Chrome (or set `PLAYWRIGHT_CHANNEL` to an installed supported channel). The smoke script creates uniquely named, labelled containers/network and a temporary self-signed TLS certificate under ignored `artifacts/`. It checks only its own resources before cleanup. It verifies the real image, access gate, real API purchase/replay, independently queried PostgreSQL effects, hosted Lab restrictions, desktop/mobile rendering and persistence across restart. It never reads a configured `DATABASE_URL`. The report and screenshots stay under `artifacts/dragon-review-smoke-*/`. Temporary certificate files are not cloud credentials or baseline artifacts and are ignored.
