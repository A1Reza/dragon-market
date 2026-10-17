# Wallet repair integrated into the default project

The 2026-10-18 integration merges `58913f2` into the current default branch, descended from deployment
merge `52a24b4`. This brings the actual wallet implementation, migration 11, UI policy wording and
regressions into the project. The previous `.baseline-review` Git link is removed from the index;
the existing local worktree is retained and ignored. A Git link alone did not change the running code.

The review initializer's old ten-migration requirement rejected the repaired schema. It now requires
eleven migrations and records twelve ledger entries including the seed. Integration regressions
verify fresh startup, accounting version 2, restart preservation, checksum enforcement, and refusal
of a populated legacy review schema without changing its balances, counters or ledger. A failing-before
execution is retained with this integration's verification evidence.

The hosted notice identifies the deployed commit and original repair commit, reports accounting as
repaired, and retains pending human approval. Render's blueprint now selects `master`; automatic
deployment remains off. Pushing code does not deploy or alter any existing database.

Accounting policy remains completed UTC-day spending plus all outstanding holds. Release does not
erase completed spending; settlement exchanges a hold for completed spending. Migration 11 is a
fresh-database boundary, not an established-data reconciliation. Existing volumes and review databases
are preserved; no database is cleared or converted automatically.

The original candidate ledger, before/after evidence and earlier readiness reports remain unchanged.
New wallet mutation checks write uniquely timestamped directories under `artifacts/daily-limit-mutations/`
instead of replacing the original mutation ledger. See integration evidence for actual commands and
outcomes. Automated checks do not constitute independent human review or approval for the main study.
