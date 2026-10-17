# Original backend execution baseline

Original SHA: `ac599ff4da21b31171c277c96c7ae808dac012a5`; clean master; no source changes during execution. Date: 2026-10-17 UTC. Windows amd64, Go 1.26.0 (module 1.25.0), Node 24.18.0, npm 11.16.0, Docker engine 29.1.5 / Desktop 4.58.0, Compose 5.0.1. PostgreSQL image: postgres:16-alpine (Testcontainers). Exact server version will be recorded during final verification.

| Command | Outcome | Evidence |
|---|---|---|
| go build ./... | PASS, exit 0 | artifacts/baseline-build.log (empty on success) |
| go test ./... | PASS, exit 0, including PostgreSQL | artifacts/baseline-test.log |
| go vet ./... | PASS, exit 0 | artifacts/baseline-vet.log (empty on success) |
| go test -race ./... | PASS, exit 0 | artifacts/baseline-race.log |

No failing test names. Initial sandbox attempts were BLOCKED by Go-cache permissions. Docker was initially stopped; installed Docker Desktop was started and checks rerun with approved access. These are environment issues, not code failures. Above results are the actual reruns. Tests passing do not establish completeness or prove correctness. Original suite has no browser tests and does not cover several identified boundary cases.
