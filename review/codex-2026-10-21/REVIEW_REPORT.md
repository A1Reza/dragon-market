# Dragon Market — completed AI reviewer report

Decision: **REJECT / CHANGES REQUIRED within reviewed application scope**.

Reviewed commit: `f4ba21185d1ba7b4bbb56f5addcc27d1b75bdec7`.

Reviewer: **Codex (OpenAI AI coding assistant)**. Typed acknowledgement: `/s/ Codex (OpenAI AI coding assistant)` at 2026-10-21T14:56:36+00:00. This signature identifies AI authorship; no human, OpenAI corporate or baseline-owner sign-off is represented.

The existing automated Go, race, frontend, mutation and seven-test browser suites passed. Additional reviewer checks exposed three unresolved issues. Money conservation and rollback held in the deadlock test. No financial-invariant bypass was observed. The application may remain useful as a local demo; this review does not recommend freezing it as a fully approved research baseline until the findings are resolved or explicitly dispositioned by the owner.

## Review scope and actual execution

existing initially clean exact-SHA checkout as explicitly requested, not a newly cloned independent machine; Windows 11 build 26200, Go 1.26.0 windows/amd64, Node 24.18.0/npm 11.16.0, GCC 16.1.0, Docker Desktop 4.58.0/Engine 29.1.5/Compose 5.0.1, PostgreSQL 16.14 Linux container, Chrome 155.0.8059.85. Browser channel chrome selected instead of downloading Chromium, as README permits. Workbench frontend/backend exercised through the repository's disposable E2E stack at 5175/8085/8087; shared Compose stack at 5173 was not started. Testcontainers used separate fresh databases. No remote CI status was queried or inherited from old logs.

## Findings

### DM-REV-CODEX-001 — Wallet shows yesterday’s spending as “Spent today” (Medium)

**Tests:** UI-11 / WAL-11 display limitation (backend projection itself passes)

**Reproduction:** On the positively labelled disposable E2E DB only, set guild-buyer daily_spent=300 and daily_spent_on to UTC yesterday. Open /#wallet, select guild-buyer and reload. GET /api/guilds/guild-buyer/wallet independently.

**Expected:** Today’s visible completed spend is 0.00 G; raw inspector retains yesterday’s 300 with its date. Reading must not alter stored history.

**Actual:** Wallet visibly shows Spent today 3.00 G. GET wallet returns daily_spent=0; SQL retains 300 and yesterday’s date. Reproduced in both custom browser sessions and reviewer SQL test. No spending-limit bypass observed.

**Source:** web/src/components.tsx:83; web/src/App.tsx:133 and :919; internal/postgres/inspection.go:42; internal/guild/service.go:GetGuild

**Evidence:** E08 browser/finding-stale-spent-today.png, browser/observations.json (stale_counter); E09 independent-tests.log

**Action:** Use current-day wallet projection for Wallet/Overview, or project with the observation’s UTC day while keeping dated raw inspector data. Add a stale-day UI regression.

**Status:** Open; exact source unchanged.

### DM-REV-CODEX-002 — Reciprocal purchases acquire wallet locks in opposite order and deadlock (Medium)

**Tests:** TX-14

**Reproduction:** Run tools/run_independent.py against this exact checkout. The retained source copy adds only reviewer_independent_test.go. Create a rare listing owned by seller and another owned by buyer. Launch buyer buying seller’s item and seller buying buyer’s item concurrently. A test-only wallet wrapper waits after each real Spend has locked its buyer row; then lets both real Earn calls proceed. This deterministically schedules a naturally possible interleaving without changing application SQL or domain code.

**Expected:** Valid reciprocal operations complete through consistent multi-wallet lock order or a bounded transaction retry; failed attempts must roll back.

**Actual:** TestReviewerReciprocalPurchasesDoNotDeadlock fails: one service operation returns ERROR: deadlock detected (SQLSTATE 40P01), the other succeeds. SQL total gold=30000, audit rows=2, sold orders=1. Rollback/money conservation hold. HTTP 500 follows from handler mapping by source inspection; HTTP deadlock response was not separately executed.

**Source:** internal/order/service.go:132, :135; internal/postgres/guild_repo.go:60; internal/postgres/tx.go:37; internal/api/order_handler.go:188

**Evidence:** E09 independent-tests.log; tools/independent_postgres_test.go.txt; E11 source-excerpts.txt

**Action:** Acquire all participating wallet locks in a deterministic order, or deliberately retry the entire transaction on 40P01/40001 with bounded attempts. Retain rollback/idempotency guarantees. Review cross-auction two-wallet paths too.

**Status:** Open; deterministic counterexample preserved; no production source patched.

### DM-REV-CODEX-003 — Mobile wallet audit region cannot receive keyboard focus (Medium)

**Tests:** UI-13

**Reproduction:** With wallet audit rows present, open /#wallet at 390×844 in Chrome. Run axe-core 4.11.1 WCAG2 A/AA and WCAG2.1 AA scan; inspect .table-wrap.

**Expected:** A horizontally scrollable audit table has an accessible keyboard scrolling path, with suitable region naming/focus behavior.

**Actual:** Repeated scans flag scrollable-region-focusable, impact serious, target .table-wrap. Audit table has overflow content with no focusable descendant/tabindex. Desktop scan has zero violations. Skip link, main focus, mobile page width, navigation and refresh checks pass. No screen-reader evaluation or complete WCAG certification performed.

**Source:** web/src/App.tsx:1181 (AuditTable wrapper); web/src/styles.css (.table-wrap)

**Evidence:** E10 browser/axe-wallet-mobile.json and browser/axe-wallet-desktop.json; browser/wallet-mobile.png; E08 browser/browser-trace.zip

**Action:** Provide a named keyboard-focusable scroll region and verify horizontal scrolling and focus visibility with keyboard and assistive technology.

**Status:** Open; reproduced twice; no fix applied.

## Section counts

| Section | Total | P | F | B | NR | N/A |
|---|---:|---:|---:|---:|---:|---:|
| AUTO | 8 | 8 | 0 | 0 | 0 | 0 |
| UI | 14 | 13 | 1 | 0 | 0 | 0 |
| WAL | 12 | 12 | 0 | 0 | 0 | 0 |
| TX | 14 | 13 | 1 | 0 | 0 | 0 |
| DB | 12 | 11 | 0 | 0 | 0 | 1 |
| TASK | 8 | 0 | 0 | 0 | 8 | 0 |

The failed UI rendering case is also recorded as DM-REV-CODEX-001; WAL-11 passes for the backend projection itself. The row counts above count form activities, not every subassertion or finding.

## Complete activity record

- **AUTO-01: P** — Exact target SHA; initially clean existing checkout. No clone/pull; requester-authorized deviation. Evidence: E01.
- **AUTO-02: P** — Original Go build and vet exit 0. Evidence: E03.
- **AUTO-03: P** — Uncached verbose suite exit 0; real PostgreSQL Testcontainers; no skipped tests observed. Evidence: E03.
- **AUTO-04: P** — Windows CGO race suite exit 0; GCC 16.1.0 available. Evidence: E03.
- **AUTO-05: P** — Full verifier exit 0: build/vet/tests/race plus frontend typecheck/lint/15 tests/build. Evidence: E04.
- **AUTO-06: P** — Focused daily-limit tests and final baseline verifier pass. First verifier attempt failed due to reviewer file packaging; preserved and corrected. Evidence: E05, E12.
- **AUTO-07: P** — All three daily-limit mutants rejected by named SQL-backed assertion; two purchase mutants also detected. Evidence: E06.
- **AUTO-08: P** — All 7 existing browser tests passed with installed Chrome and isolated disposable DB. Evidence: E07.
- **UI-01: P** — System Status shows development, exact SHA, PostgreSQL identity, successful read and HTTP health. Evidence: E08.
- **UI-02: P** — Switched all three seeded guilds; initial visible 100.00 G; explicitly not authentication. Evidence: E08.
- **UI-03: P** — Created uniquely named rare item; owner/type/700-unit price verified in real snapshot. Evidence: E08.
- **UI-04: P** — Listed for 700; zero price blocked by native range validation; invalid API price rejected. Evidence: E08.
- **UI-05: P** — Buyer 10000→9300, seller 10000→10700; owner transferred once; sold rebuy rejected. Evidence: E08.
- **UI-06: P** — Common-item listing cancelled to free; sold listing cancellation rejected (400). Evidence: E08.
- **UI-07: P** — Legendary 700-unit base item; active auction, backend deadline approximately 24 hours ahead. Evidence: E08.
- **UI-08: P** — 500 bid reserves 500; total gold unchanged; available gold decreases by hold. Evidence: E08.
- **UI-09: P** — Raise 500→525 uses delta 25; bidder 552 outbids; old hold released; highest cancellation succeeds; repeated cancellation 409. Evidence: E08.
- **UI-10: P** — Same-key replay: 204 plus replay header; unchanged ownership/balances; exactly 2 audit rows and 1 idempotency record. Evidence: E08.
- **UI-11: P** — Inspected raw persisted pre/post values and date; distinguished them from GET-wallet projection. DM-REV-CODEX-001 documents wrong Wallet display. Evidence: E08, E09, E11.
- **UI-12: P** — 526 rejected below required 552 with visible error; zero base price HTTP 400; no false success. Evidence: E08.
- **UI-13: F** — Mobile audit scroller lacks keyboard focus (axe serious). Desktop scan, skip link, route refresh and page-width checks passed. Evidence: E10; DM-REV-CODEX-003.
- **UI-14: P** — Local harness executes C/F/G in isolated DBs; hosted gateway tests reject harness/arbitrary debug routes. No live hosted site assessed. Evidence: E07, E08, E11.
- **WAL-01: P** — Supplied S(current UTC day)+all holds≤positive L is coherent under valid starting state, fixed limits and reliable UTC clock; L=0 unlimited. Human intent confirmation remains owner-owned. Evidence: E05, E11.
- **WAL-02: P** — Funds/capacity checks and row locks enforce reserve allowance; failed operations have no committed effect. Evidence: E03, E05.
- **WAL-03: P** — Old hold release reduces reserved only; mixed-age test and mutation rejection preserve completed spending. Evidence: E05, E06.
- **WAL-04: P** — 500 hold at 500 limit rejects 300 spend before release; Tehran midnight does not reset UTC allowance. Evidence: E05.
- **WAL-05: P** — After release, 300 debit persists; next 500 rejected; SQL gold=9700/reserved=0/completed=300/audits=2. Evidence: E05.
- **WAL-06: P** — Old settlement exchanges reserved for spending; SQL gold debited once; repeated settlement rejected. Evidence: E05.
- **WAL-07: P** — Cancellation/outbid restores reservation capacity while completed 700-unit purchase remains charged. Evidence: E05, E08.
- **WAL-08: P** — Independent SQL test: spend 500, earn 1000, next spend 1 rejected; gold=10500/spent=500/audits=2. Evidence: E09.
- **WAL-09: P** — Exact boundary accepted; over-cap rejected; zero-limit behavior and integer limits exercised. Evidence: E03, E05.
- **WAL-10: P** — Positive amounts, insufficient funds/reserve and int64 overflow checked in domain suites. Evidence: E03, E05.
- **WAL-11: P** — GET wallet projects prior-day counter to 0 without write; raw inspector retains 300 and prior date. UI defect separately reported. Evidence: E05, E09, E11.
- **WAL-12: P** — Independently queried PostgreSQL wallet/item/audit rows and debit totals; no reliance on UI responses alone. Evidence: E08, E09.
- **TX-01: P** — Concurrent-buy and Research Lab tests: single winner, intended owner and committed ledger effects. Evidence: E03, E07.
- **TX-02: P** — Controlled late failure after debit/earn/transfer rolls back every persisted effect and idempotency claim. Evidence: E03, E07.
- **TX-03: P** — Buy/bid replay suites inspect SQL; UI exact purchase replay produces no extra ledger entries. Evidence: E03, E08.
- **TX-04: P** — New-key attempt on sold order rejected; changed same-key payload covered by existing SQL-backed test. Evidence: E03, E08.
- **TX-05: P** — Concurrent auction starts yield one active auction; partial unique index and item transition reviewed. Evidence: E03.
- **TX-06: P** — ceil(current/20) minimum increment reviewed; 525→552 boundary and 526 rejection observed; overflow test passes. Evidence: E03, E08.
- **TX-07: P** — Outbid release and new hold within outer transaction; concurrent-bid SQL test leaves one active highest reservation. Evidence: E03, E08.
- **TX-08: P** — Same-bidder delta reserve confirmed: total reservation 525, not 1025. Evidence: E05, E08.
- **TX-09: P** — Only eligible active highest cancellation releases correct wallet; repeated invalid cancellation 409. Evidence: E03, E08.
- **TX-10: P** — Controlled-clock auction test verifies final-five-minute extension; default config is 5-minute window/extension. Evidence: E03, E11.
- **TX-11: P** — Worker plus concurrent settlement driver and repeat batch produce one debit/credit/ownership transfer. Evidence: E03, E05, E07.
- **TX-12: P** — 12 competing reserve/spend operations accept exactly 5×100 under limit 500; SQL usage=500. Evidence: E05.
- **TX-13: P** — Injected audit failure rolls back accounting and stored day; purchase late-failure test rolls back ownership. Evidence: E03, E05.
- **TX-14: F** — Nested transactions reuse outer transaction, but buyer-then-seller wallet locks deadlock reciprocal purchases (40P01); one rolls back. No automatic retry. Evidence: E09, E11; DM-REV-CODEX-002.
- **DB-01: P** — Fresh Testcontainers/E2E apply migrations 1–11 before seeding; v2 wallets and successful API startup observed. Evidence: E03, E07, E08.
- **DB-02: P** — Legacy initialization and focused migration tests reject populated v1 without changed balances/counters/ledger. Evidence: E03, E05.
- **DB-03: P** — Reviewer ran down migration on populated v2; explicit refusal; marker=2/gold=9877/spent=123 preserved. Evidence: E09.
- **DB-04: P** — Reviewer temp v1 schema: new wallet read rejects absent daily_accounting_version (42703); no silent fallback. Evidence: E09.
- **DB-05: P** — All 234 tracked files byte-identical at completion, including historical FAIL/PASS evidence; temporary verifier output separately captured and restored. Evidence: E01, E14.
- **DB-06: P** — Only positively identified disposable containers removed; no Compose launch/reset/down -v; zero running containers before and after. Evidence: E14.
- **DB-07: P** — Tehran midnight vs UTC midnight and persisted UTC day covered; carried reservations retained. Evidence: E03, E05.
- **DB-08: P** — Reviewer real HTTP oracle cases valid/zero/negative/malformed/503/timeout preserve cached 250; SQL base=250, fixed listing stays 100. Evidence: E13.
- **DB-09: P** — Go build/test commands run independently of frontend tooling. Frontend formats/validates/suggests bids; server remains monetary authority. Evidence: E03, E11.
- **DB-10: P** — OS/tool/browser/PostgreSQL versions, SHA, timestamps, argv, exits, source hashes and deviations recorded. Evidence: E01, E02, E08.
- **DB-11: N/A** — Hosted deployment not used. Local stack independently reports exact target SHA; no claims about Render/Neon/live CI. Evidence: E01, E08.
- **DB-12: P** — Local-only dev snapshot and harness restrictions plus gateway gate/origin/path tests reviewed. No production security certification. Evidence: E03, E11.
- **TASK-01: NR** — Separate research repository, exact task packages, reference patches and controlled hidden oracles not supplied/reviewed. No task/oracle/fairness/leakage approval claimed. Evidence: E11; scope exclusion.
- **TASK-02: NR** — Separate research repository, exact task packages, reference patches and controlled hidden oracles not supplied/reviewed. No task/oracle/fairness/leakage approval claimed. Evidence: E11; scope exclusion.
- **TASK-03: NR** — Separate research repository, exact task packages, reference patches and controlled hidden oracles not supplied/reviewed. No task/oracle/fairness/leakage approval claimed. Evidence: E11; scope exclusion.
- **TASK-04: NR** — Separate research repository, exact task packages, reference patches and controlled hidden oracles not supplied/reviewed. No task/oracle/fairness/leakage approval claimed. Evidence: E11; scope exclusion.
- **TASK-05: NR** — Separate research repository, exact task packages, reference patches and controlled hidden oracles not supplied/reviewed. No task/oracle/fairness/leakage approval claimed. Evidence: E11; scope exclusion.
- **TASK-06: NR** — Separate research repository, exact task packages, reference patches and controlled hidden oracles not supplied/reviewed. No task/oracle/fairness/leakage approval claimed. Evidence: E11; scope exclusion.
- **TASK-07: NR** — Separate research repository, exact task packages, reference patches and controlled hidden oracles not supplied/reviewed. No task/oracle/fairness/leakage approval claimed. Evidence: E11; scope exclusion.
- **TASK-08: NR** — Separate research repository, exact task packages, reference patches and controlled hidden oracles not supplied/reviewed. No task/oracle/fairness/leakage approval claimed. Evidence: E11; scope exclusion.

## Evidence index

All paths below are relative to `evidence/` in this package. Every artifact is covered by SHA256SUMS.txt.

- **E01**: identity.json; source-hashes-before.json; source-integrity.json; source-hashes-after.json
- **E02**: executions.json; platform.json; *-version.log; go-cgo.log; gcc-version.log
- **E03**: go-build.log; go-vet.log; go-tests.log; go-race.log
- **E04**: full-verifier.log; full-verifier/results.json; full-verifier/frontend-*.log
- **E05**: wallet-regressions.log; baseline-verifier-retry.log; baseline-verifier-retry/verification.json
- **E06**: purchase-mutations.log; purchase-mutations/; wallet-mutations.log; wallet-mutations/
- **E07**: playwright.log; playwright-results.json; playwright-test-results/; playwright-report/
- **E08**: browser/observations.json; browser/purchase-example.json; browser/browser-trace.zip; browser/*.png
- **E09**: independent-tests.log; independent-tests.json; ../tools/independent_postgres_test.go.txt
- **E10**: browser/axe-wallet-desktop.json; browser/axe-wallet-mobile.json; browser/wallet-mobile.png
- **E11**: source-excerpts.txt; review-notes.md
- **E12**: reviewer-incident.json; baseline-verifier/; baseline-verifier.log; browser-first-attempt/
- **E13**: independent-tests-oracle.log; independent-tests-oracle.json
- **E14**: historical-evidence-restoration.json; source-integrity.json; docker-before.log; cleanup.json

## Full source reasoning, exceptions and chronology

Reviewer: Codex, an OpenAI AI coding assistant. This is a new AI-executed review, not an independent human review, institutional attestation or authority to freeze a research baseline. No source changes were made. Human independence from earlier AI-assisted authorship is not established.

The supplied positive-limit policy S(d)+R<=L is internally coherent. Reserve/spend check remaining capacity using guarded subtraction; nonnegative SQL constraints and funds checks bound additions. Release decreases only R. Deduct exchanges a hold for equal completed spending while decreasing gold. Earn changes gold only. UTC rollover drops nonnegative completed spending and preserves all holds. Thus each transition preserves the bound from valid service-created state with a fixed limit and reliable clock. L=0 still has int64 accounting bounds. This assessment accepts the supplied technical policy; it does not establish what a human researcher intends.

Wallet reads copy the row and project the day; diagnostic snapshots intentionally return raw values and dates. The UI incorrectly labels the raw historical counter as today's spending, independently reproduced. The inspector's visible comparison also omits the raw date; readers must use the recorded snapshot/date instead of assuming a current-day projection. The audit column says UTC time but prints offset-bearing raw timestamps (for example +03:30); this is an additional low-severity labeling observation, not a debit/accounting error.

Wallet UPDATE and audit insert share the context transaction. Order operations lock item then order; same-item competition serializes. Auction operations lock the auction and reuse that outer transaction. The wallet repository always uses FOR UPDATE; nested RunInTransaction calls reuse the transaction. There is no ordering across multiple distinct wallet rows and no 40P01 retry. Opposing purchases can deadlock despite same-listing contention tests passing. The reviewer barrier only schedules after real successful Spend calls and does not manufacture a lock type absent from production. The observed abort preserves atomicity; this is a liveness/error-handling finding rather than evidence of money duplication.

The price increment is current + ceil(current/20), with overflow rejected. The browser exercised a 525->552 minimum and a 526 rejection; existing controlled-clock tests cover extension and repeated/concurrent settlement. Reviewer oracle checks use a real local HTTP server and the real resilient oracle, then persist its result through the real repository to compare base and fixed-order prices. They do not claim a separate new updater-scheduling test; the existing updater test was also executed.

Migration 11's refusal is an intentional fresh-data boundary. The reviewer executed populated downgrade refusal and old-schema rejection in isolated tests. Existing legacy initialization checks compare surviving balances and ledger; no populated database was cleared or reinterpreted.

Test adequacy limits: ordinary passing suites did not cover reciprocal wallet-lock ordering, dated-wallet rendering or mobile audit keyboard scrolling. Broader cross-auction/cross-order interleavings, worker batch starvation after persistent failure, long transactions spanning UTC midnight, clock skew, a complete screen-reader audit, other browsers/OSs and live cloud deployment/CI were not independently exercised. Simulation uses injected UTC clocks; the review did not wait for real midnight. No load/performance or formal correctness proof is claimed.

Section 8: the separate research repository, exact T001/T002 packages, human references and controlled private evaluation oracles were not supplied in the reviewed application checkout and were not accessed. All eight task checks are NOT RUN. No statement about fairness, feature novelty, hidden-oracle adequacy or absence of leakage is made. No research pin, branch, tag, hosted database or deployment changed.

Environment: existing initially clean exact-SHA checkout as explicitly requested, not a newly cloned independent machine; Windows 11 build 26200, Go 1.26.0 windows/amd64, Node 24.18.0/npm 11.16.0, GCC 16.1.0, Docker Desktop 4.58.0/Engine 29.1.5/Compose 5.0.1, PostgreSQL 16.14 Linux container, Chrome 155.0.8059.85. Browser channel chrome selected instead of downloading Chromium, as README permits. Workbench frontend/backend exercised through the repository's disposable E2E stack at 5175/8085/8087; shared Compose stack at 5173 was not started. Testcontainers used separate fresh databases. No remote CI status was queried or inherited from old logs.

Reviewer setup installed python-docx/reportlab/pypdf for document work and isolated @axe-core/playwright 4.11.1 for accessibility scanning. npm ci installed the locked frontend dependencies; no lockfile change; npm audit reported zero vulnerabilities at execution (not a security certification). npm emitted an unknown user node-linker config warning, jsdom reported unimplemented scrollTo, and Playwright emitted color-environment warnings; these did not fail the relevant checks. Early document-text extraction failed under cp1252 and was rerun with Python UTF-8. Some read-only exploratory file searches used nonexistent paths or Windows wildcard forms and were corrected; none changed application state.

The first baseline-verifier invocation was contaminated by the review author's temporary .go file under review/tools, outside its intended postgres package. Build/vet then reported undefined helper symbols in that review-only package. This was a reviewer packaging mistake, not an application regression. The file was renamed .go.txt and only copied into a disposable source tree for the additional tests. A complete fresh baseline-verifier retry passed; both runs are retained. Original tracked historical evidence was byte-backed-up before each exact verifier invocation, copied separately for this review, then restored; source hashes confirm all originals unchanged.

The first custom browser script completed purchase/replay/auction/accessibility/stale-day observations but its final exact Research Lab locator omitted the DEV badge in the accessible name and timed out. This was a reviewer locator mistake. The entire first attempt was preserved; a complete second fresh-disposable-stack run used the documented #lab route and completed. Both browser sessions reproduced the same two UI findings; the concurrency counterexample was independently reproduced twice in SQL-backed Go tests. Existing seven-test Playwright suite passed independently before these custom sessions.

The combined final reviewer-authored SQL-backed suite executed all six additional checks: five passed and the reciprocal-purchase expectation failed again with 40P01. The initial five-test run and supplemental oracle run remain preserved. Optional Word COM PDF export did not complete; a complete reflowed PDF was instead rendered from the filled DOCX with ReportLab, with the rendering method disclosed on its first page. The stalled optional pymupdf download was stopped; pypdfium2 was installed for visual inspection. No application check result was changed by document rendering.

No implementation fixes were made, no messages/issues were posted externally, no repository was pulled/cloned, and no baseline owner decision was supplied. Review-scoped typed signature only; no certificate-backed or human signature is claimed.


## Signature and reserved owner fields

/s/ Codex (OpenAI AI coding assistant)

UTC: 2026-10-21T14:56:36+00:00

I acknowledge only the AI-executed observations, explicit code reasoning and exclusions recorded here. Final human approval remains pending; no approved SHA, pin update or owner signature is asserted. No private contact address is available for this AI reviewer.
