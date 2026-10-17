# Dragon Market — Transactional Correctness Baseline Review

Status: **candidate repair; independent human review and baseline approval pending**. The user selected the policy below in this session. Policy selection does not constitute approval of the implementation. The proposed implementation SHA and verification binding are in `candidate.json`, recorded in a later evidence-only commit. The research repository's target pin has not been changed.

## Baseline identity and preserved evidence

| Revision                                   | Meaning                                                     |
| ------------------------------------------ | ----------------------------------------------------------- |
| `ac599ff4da21b31171c277c96c7ae808dac012a5` | Original backend before the workbench                       |
| `8f31a33ecb6c94c7d26a26a2a6f617772ba27816` | Previously verified workbench implementation candidate      |
| `b88407e`                                  | Workbench evidence ledger, parent of the merge              |
| `162c5cab9fa886445dd102f4a99961027f90aebb` | Merged revision; starting point of this repair              |
| `candidate.json: proposed_pin`             | New implementation candidate, subject to independent review |

The repair is on `fix/transactional-correctness-baseline`, in a separate worktree. Existing deployment work in the original checkout is excluded. No previous commit, research pin, tag, report, migration 1–10, or archived workbench result has been rewritten. The original characterization test remains recoverable with `git show 162c5ca:internal/postgres/known_issue_test.go`; its new execution log is [original-characterization.log](evidence/original-characterization.log). The old `docs/research-readiness/` directory describes its original revisions; its FAIL status must not be silently converted into evidence for this repair. Its old evidence collector is historical and must not be used to regenerate this package.

## Selected policy and data model

For a guild on UTC day `d`, let `S(d)` be completed debits on that day, `R` all outstanding reserved gold regardless of age, and `L` the configured daily limit. For positive `L`, the rule is:

`S(d) + R <= L`

`daily_spent` now stores **completed** `Spend` and `Deduct` amounts for `daily_spent_on`. `reserved` stores outstanding holds. A zero daily limit means unlimited allowance within the integer accounting range. Earnings never refund spending allowance. Cancelling or losing a bid releases its hold and restores that capacity, without changing completed spending.

| Operation         | Completed spending | Reserved  | Gold      | Capacity effect                  |
| ----------------- | ------------------ | --------- | --------- | -------------------------------- |
| Reserve `a`       | unchanged          | `+a`      | unchanged | requires `S + R + a <= L`        |
| Release `a`       | unchanged          | `-a`      | unchanged | reduces usage by `a`             |
| Spend `a`         | `+a`               | unchanged | `-a`      | requires `S + R + a <= L`        |
| Deduct/settle `a` | `+a`               | `-a`      | `-a`      | usage stays constant             |
| Earn `a`          | unchanged          | unchanged | `+a`      | unchanged                        |
| UTC rollover      | resets to zero     | unchanged | unchanged | old holds still consume capacity |

Amounts must be positive; reserve/spend also require sufficient unreserved gold, and release/deduct require sufficient reserve. Addition and allowance checks reject overflow. Failed mutations and failed audit insertion roll back both accounting and day changes in the existing PostgreSQL transaction. Wallet rows remain locked with `FOR UPDATE`; nested auction/order operations reuse the outer transaction.

The original example is deliberately rejected earlier under this policy. Yesterday's 500-gold hold still uses all of today's 500 allowance, so the first attempted 300 purchase fails. Release the hold, then spend 300: a further 500 purchase fails. Only 300 is debited. There is no silent promise that the old first purchase remains permitted.

An accepted hold is already included in capacity, so settling it cannot itself breach the daily cap. This assumes valid service-created state, a stable configured limit, a trustworthy UTC clock, and no direct administrative wallet edits. No claim is made that settlement cannot fail for unrelated reasons such as a database outage. No limit-editing API is introduced.

Reservation identities/dates are unnecessary **for this selected policy**: every outstanding unit has the same effect irrespective of originating day or auction. Auction/bid ownership remains enforced by the existing locked auction operations. A policy that counts only today's reservations would require an identity/day allocation model and would be a different implementation.

Wallet API reads project completed spending for the current UTC day without writing or discarding persisted history. The developer inspector continues to expose raw persisted `daily_spent` together with `daily_spent_on`; interpret those fields together. The UI describes completed spending and explains that the limit also includes reservations.

## Accounting argument for review

New wallets start with `S=R=0`. A successful reserve or purchase checks the resulting capacity. Release only decreases `R`; settlement replaces `a` reserved units with `a` completed units. Neither can increase the sum. Earnings do not change it. At midnight, resetting nonnegative `S` to zero while retaining `R` cannot increase usage. These transitions preserve the rule by induction, provided the starting state satisfies it. The implementation uses subtraction with short-circuit guards rather than an overflowing sum. This argument is written by the implementing agent and remains subject to independent review.

## Existing data boundary

The old counter mixes spending and reservations and may already have lost spending through KNOWN-01. Reinterpreting it, subtracting aggregate holds, or guessing the originating day would not reliably repair existing data. Audit history can also be incomplete, and its old `NOW()` timestamp is the transaction start time, which need not be the wallet mutation's UTC day.

Migration 11 therefore explicitly refuses populated guild tables and marks a fresh schema with `daily_accounting_version=2`. Wallet creation/reads require this column; running the new wallet service against an unmigrated schema fails instead of applying the new semantics silently. The down migration also refuses populated wallets. This is a fresh experimental baseline, **not an existing-data conversion tool**. Keep old databases and evidence intact. Any populated database conversion needs a separate reviewed reconciliation, with independently established completed debits and holds; do not clear it to force this migration through.

Testcontainers and the browser harness apply migration 11 before seeding. Fresh Compose databases mount it before the seed as well. Existing Compose volumes are not auto-upgraded by PostgreSQL initialization scripts.

## Regression and automated verification

The original defect characterization is preserved separately from a true safety regression. [regression-before.log](evidence/regression-before.log) runs the new safety assertion on the original merged implementation and fails with 800 persisted debits and three audit rows. [regression-after.log](evidence/regression-after.log) runs that same assertion on the repair and passes with 300 debits, 9700 gold, zero remaining reserve, and two committed audit rows. Rejected spending has no persisted effect.

The additional tests cover local midnight versus UTC midnight, wallet read projection, mixed-age holds, same-bidder delta increases, outbid release, cancellation across two auctions, next-day settlement, repeat-settlement rejection without another debit, concurrent reserve/spend capacity, day/accounting rollback after an audit failure, legacy migration refusal, exact capacity, and integer boundaries. Existing purchase replay, auction replay, rollback, worker and bounded-sequence tests are also retained; former tests of combined-counter arithmetic are explicitly updated for completed-spending semantics.

The PostgreSQL checks inspect rows and aggregate actual debit audit records independently of the service's returned wallet. They are **not an independent author or human correctness review**. Three disposable faulty implementations remove carried-hold capacity, erase completed spending on release, or omit settlement spending. The mixed-age regression rejects all three with domain assertions, not compilation or infrastructure errors; see [mutations.json](evidence/mutations.json).

Machine-readable [verification.json](evidence/verification.json) records exact commands, timestamps, tool versions, exits and source hashes. `candidate.json` binds it to the proposed implementation SHA. Windows verification, frontend dependency reuse, browser results and any unverified platforms are reported explicitly there; previous Linux/CI claims are not inherited.

## Reproduce

Use a fresh checkout of the proposed SHA with Go, a working Docker Linux engine, and (for frontend checks) Node/npm:

```sh
go test -v -count=1 ./internal/guild ./internal/postgres -run '^TestDailyLimit'
node scripts/verify-transactional-baseline.mjs
node scripts/check-daily-limit-mutations.mjs
npm --prefix web ci
node scripts/verify-transactional-baseline.mjs --frontend
```

The verification script writes only this package's evidence directory; preserve an existing run before rerunning. Mutation checks retain isolated copies in ignored `artifacts/daily-limit-mutants/` for inspection. They do not modify the candidate source. For the optional browser check, install Playwright Chromium or select an installed Chrome with `PLAYWRIGHT_CHANNEL=chrome`, then add `--browser` to verification. The browser harness owns a disposable labeled database and refuses occupied service ports. Never point tests at a research or shared data database.

## Approval and study boundary

Complete the [human-review checklist](HUMAN_REVIEW.md) against the exact proposed SHA. Independent correctness review, human baseline approval, and a deliberate research-repository pin change remain pending. No approved tag or remote publication is created by this work.

Only after those decisions should the study construct two separately validated task packages, initially investigating retry-safe operations and auction changes. Exclude this repaired behavior from tasks until reviewed. Each later package needs its own starting SHA, human-verified reference, feature/invariant checks and rejected faulty variant. Keep externally held evaluation tests and reference solutions out of agent snapshots and public baseline materials. The main experiments and the PGS/LISA comparison are outside this repair package and remain outstanding.
