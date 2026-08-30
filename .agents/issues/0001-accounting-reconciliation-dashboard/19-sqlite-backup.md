# 19 — SQLite backup and restore

Type: AFK
Status: BACKLOG
Resolves: PRD open question 8

## Parent

PRD 0001 — Accounting Reconciliation Dashboard (`.agents/prds/0001-accounting-reconciliation-dashboard.md`)

## What to build

Drive remains the legal 10-year record, so losing the database costs no compliance. What it costs
is every decision she has made, every extraction, every correction she typed, and the entire event
history — months of judgment that cannot be re-derived automatically.

Back up the SQLite file to off-host storage in an EU region, with a documented and **actually
tested** restore. An untested restore is not a backup.

> **Amended, 2026-08-30.** This slice used to carry a tension worth resolving: the encryption key
> for statement passwords lived in the environment rather than the database, which made a leaked
> backup harmless but meant a restore onto a fresh host without the key produced undecryptable
> passwords, so the key needed its own custody. That is all gone — the app stores no statement
> password and no other secret (ADR 0009 withdrawn, ADR 0004 amended). The backup contains client
> financial metadata and must still be treated as confidential and kept in the EU, but there is no
> key custody problem and nothing in it to decrypt.

Note that ADR 0003 removed the scheduler from this deployment, so this cannot assume a cron exists.
Either the backup is driven by something outside the app, or this issue reintroduces a timer for
this single purpose and says so explicitly.

## Acceptance criteria

- [ ] Backups run automatically to off-host storage in an EU region
- [ ] Backups are consistent — taken via SQLite's backup mechanism, not a naive file copy of a live database
- [ ] Retention policy decided and applied
- [ ] Restore procedure documented and executed at least once onto a clean host
- [ ] The restored instance is verified functional, not merely present
- [ ] Confirmed that the backup contains no secret — no statement password, no service-account key, no model API key
- [ ] The scheduling mechanism is stated explicitly, including whether it reintroduces a timer contrary to ADR 0003
- [ ] PRD open question 8 updated

## Blocked by

- 01 — Walking skeleton, deployed
