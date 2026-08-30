# 05 — Month close, reopen and folder scaffolding

Type: AFK
User stories: 17, 18, 19, 20, 21, 22

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
cycle: collect → extract → decide → export → close.

> **Amended, 2026-08-30.** The cycle read `collect → extract → pair → tick → export → close`. The
> `pair` stage is gone with ADR 0013 and `tick` is renamed `decide`, because a document now reaches
> one of two terminal states rather than carrying a single tick. The `"pair"` member of
> `CompanyStage` is retired in slice 22.

## Status

Done, on the pre-ADR-0013 stage vocabulary. The scaffolding, close and reopen behaviour is
unaffected by the scope change.

## Acceptance criteria

- [ ] Closing a month writes `closedAt` and emits `MonthClosed`
- [ ] The open month is derived as the most recent month without `closedAt`, never guessed from folder contents or the calendar
- [ ] A closed month renders read-only — no decisions, editing or export
- [ ] Reopening clears `closedAt` and emits `MonthReopened`
- [ ] Closing month N creates month N+1's folders with canonical names
- [ ] Loading the dashboard creates the open month's folders if absent
- [ ] Folder creation is idempotent — an existing folder is not duplicated
- [ ] Month-root VAT output PDFs are never created, renamed, moved or deleted by any code path
- [ ] Company list shows each company's current stage and its awaiting-decision count
- [ ] Integration test: close, verify scaffolding and read-only state, reopen, verify the month is editable again

## Blocked by

- 03 — Drive sweep to company and month tree, read-only
- 04 — Unrecognised folder detection and rename repair

## Notes

Quarterly VAT payers need no special handling: folders are monthly regardless and the VAT period
is Omega's concern.
