# 05 — Month close, reopen and folder scaffolding

Type: AFK
User stories: 16, 17, 21, 22, 23, 24

## Parent

PRD 0001 — Accounting Reconciliation Dashboard (`.agents/prds/0001-accounting-reconciliation-dashboard.md`)

## What to build

The lifecycle anchor. Per ADR 0005 the month state is an explicit action, not a heuristic — the
heuristics were tested against real data and failed, since all seven sample months already contain
`Daňové priznanie DPH.pdf`.

She clicks *Close month* per company, which writes `closedAt`. The open month is the most recent
month without one. A closed month becomes read-only, rendered by the same component in a read-only
mode rather than a separate screen. Reopening is supported, because a misclick should not be
permanent.

Closing month N scaffolds the folders for month N+1 from the canonical template, using the write
machinery from slice 04. Dashboard load acts as a safety net: if the open month's folders are
missing, they are created. Nothing depends on a scheduler, per ADR 0003.

For this slice the template is the seeded canonical list; slice 14 adds per-company overrides.

The company list gains a stage indicator so she can see at a glance where each client sits in the
cycle: collect → extract → pair → tick → export → close.

## Acceptance criteria

- [ ] Closing a month writes `closedAt` and emits `MonthClosed`
- [ ] The open month is derived as the most recent month without `closedAt`, never guessed from folder contents or the calendar
- [ ] A closed month renders read-only — no ticking, pairing, editing or export
- [ ] Reopening clears `closedAt` and emits `MonthReopened`
- [ ] Closing month N creates month N+1's folders with canonical names
- [ ] Loading the dashboard creates the open month's folders if absent
- [ ] Folder creation is idempotent — an existing folder is not duplicated
- [ ] Month-root VAT output PDFs are never created, renamed, moved or deleted by any code path
- [ ] Company list shows each company's current stage and its unticked count
- [ ] Integration test: close, verify scaffolding and read-only state, reopen, verify the month is editable again

## Blocked by

- 03 — Drive sweep to company and month tree, read-only
- 04 — Unrecognised folder detection and rename repair

## Notes

Quarterly VAT payers need no special handling: folders are monthly regardless and the VAT period
is Omega's concern.
