# Independent human review checklist

Status: **PENDING_HUMAN_REVIEW**. Do not create an approved tag until review is complete. Automated tests are evidence, not proof.

- [ ] Review original SHA, branch, clean starting tree and original logs. Confirm no original commits were rewritten and no remote push occurred.
- [ ] Review each backend fix separately; inspect original failing regressions and rerun them against the original implementation in isolated checkouts.
- [ ] Resolve or explicitly exclude WAL-03 / KNOWN-01 from the experimental invariant set. Decide reservation-day spending semantics before approval. A green characterization test must not conceal this defect.
- [ ] Read every invariant, SQL constraint and mapped test; verify interpretation of multiple order listings, first bids, 5% rounding, UTC extension, cancellation and settlement.
- [ ] Independently run purchase competition, HTTP replay, rollback, settlement and mutation checks. Query PostgreSQL state after completion; compare ownership, balances, reservations, order/bid statuses and audits.
- [ ] Inspect generated sequence seed/bounds and failure messages. Assess missing interleavings, cross-day/cross-auction cases and crash/network cases.
- [ ] Check diagnostics are 404 without APP_ENV=development, read-only when enabled, loopback-only and bounded. Confirm production server image/process never starts the research harness.
- [ ] Check UI actions call existing APIs and preserve keys on exact replay. Confirm guild switching is visibly not authentication. Confirm no fake inventory, simulated success, SQL browser access or hidden evaluation material.
- [ ] Read snapshot/trace limits and absence of audit correlation. Confirm observations are not presented as proof of causality or exactly-once correctness.
- [ ] Reproduce setup from a clean Windows checkout and a clean Linux/macOS checkout with documented tools. Inspect Compose volume behavior; never reset shared data.
- [ ] Run browser suite with a fresh disposable DB; inspect desktop/mobile screenshots, keyboard focus, errors and UTC times. Check browser version and artifact retention.
- [ ] Observe actual remote CI results; configurations alone do not establish Linux or Go 1.25 execution.
- [ ] Resolve candidate implementation SHA from the metadata ledger, compare source/migration/lockfile hashes and record the exact reviewed commit externally.
- [ ] Approve or reject explicitly as a human. Freeze approved commit. Future experiments use isolated backend-only task snapshots derived from that fixed commit, excluding UI/research materials unless the experimental condition explicitly includes them.

Reviewer: __________ Date: __________ Decision: __________ External review record: __________
