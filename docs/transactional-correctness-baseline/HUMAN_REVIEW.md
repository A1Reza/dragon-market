# Independent human review and baseline approval

Status: **PENDING_HUMAN_REVIEW**. No independent reviewer has signed off. Automated test authorship and SQL observations do not satisfy this checklist.

Proposed implementation SHA: copy `candidate.json: proposed_pin` here when beginning review. Record reviewer identity, UTC date, environment, findings and final decision. Review the exact SHA and record any follow-up implementation SHA explicitly; a change invalidates the old approval.

- [ ] Confirm the selected policy: completed UTC-day spending plus **all** outstanding holds; zero limit is unlimited. Confirm the earlier rejection in the original 500/300/500 example is intentional.
- [ ] Check reserve, release, purchase, settlement, earnings and rollover against the transition table and inductive argument. Independently reason through several old/new holds released or settled in different orders.
- [ ] Verify same-day cancellation restores reservation capacity without refunding completed spending. Check old settlement replaces a hold with spending and is counted exactly once.
- [ ] Inspect the original failure, the new failing-before safety log, and passing-after log. Confirm failed requests have no wallet or audit effect and that the before example uses `162c5ca`, not `ac599ff` or `8f31a33`.
- [ ] Independently inspect the mixed-hold expected values and run the three faulty copies. Confirm each fails the named business assertion with a compiling program and a working database.
- [ ] Review PostgreSQL row locks, nested transaction reuse, concurrent capacity checks, audit-error rollback and date rollback. Check the aggregate hold model remains consistent with locked active bids.
- [ ] Review positive amount validation, exact capacity, integer overflow and zero-limit behavior. Confirm the clock and fixed-limit assumptions are acceptable for the experiment.
- [ ] Check wallet read projection and raw inspector dates. Confirm the UI makes the reservation contribution to the cap clear.
- [ ] Review migration 11's fresh-data boundary and both refusal paths. Confirm old data and logs remain available. Do not approve populated-database migration without a separate reconciled conversion.
- [ ] Reproduce on an independently prepared environment; record OS, Go/PostgreSQL versions, commands, raw outputs and deviations. Mark platforms and remote CI actually observed.
- [ ] Check the proposed SHA, parent `162c5ca`, source hashes, retained historical evidence, and exclusions from the original dirty checkout.
- [ ] Resolve material findings; record a human baseline decision and its scope. Only then update the research target pin deliberately, recording old/new SHA and decision. Preserve the old baseline.

Reviewer: _pending_

UTC date and environment: _pending_

Findings/evidence links: _pending_

Independent correctness decision: _pending_

Human baseline approval: _pending_

Research pin update decision and old/new SHA: _pending_
