# 19 — SQLite backup and restore

Type: AFK
Status: BACKLOG
Resolves: PRD open question 8

## Parent

PRD 0001 — Accounting Reconciliation Dashboard (`.agents/prds/0001-accounting-reconciliation-dashboard.md`)

## What to build

Drive remains the legal 10-year record, so losing the database costs no compliance. What it costs
is every pairing decision she has made, every extraction, every correction she typed, and the
entire event history — months of judgment that cannot be re-derived automatically.

Back up the SQLite file to off-host storage in an EU region, with a documented and **actually
tested** restore. An untested restore is not a backup.

One tension to resolve deliberately: the encryption key for statement passwords lives in the
environment, not in the database. That is what makes a leaked backup harmless — and it also means a
restore onto a fresh host without that key produces a database whose passwords cannot be decrypted.
The key needs its own separate custody, and the restore procedure must state where it comes from.

Note that ADR 0003 removed the scheduler from this deployment, so this cannot assume a cron exists.
Either the backup is driven by something outside the app, or this issue reintroduces a timer for
this single purpose and says so explicitly.

## Acceptance criteria

- [ ] Backups run automatically to off-host storage in an EU region
- [ ] Backups are consistent — taken via SQLite's backup mechanism, not a naive file copy of a live database
- [ ] Retention policy decided and applied
- [ ] Restore procedure documented and executed at least once onto a clean host
- [ ] The restored instance is verified functional, not merely present
- [ ] Custody of the password-encryption key documented, separate from the backup itself
- [ ] Confirmed that a leaked backup alone does not expose statement passwords
- [ ] The scheduling mechanism is stated explicitly, including whether it reintroduces a timer contrary to ADR 0003
- [ ] PRD open question 8 updated

## Blocked by

- 01 — Walking skeleton, deployed
