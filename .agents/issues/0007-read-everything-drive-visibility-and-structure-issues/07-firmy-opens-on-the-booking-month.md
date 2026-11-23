# 07 — *Firmy* opens on the booking month

Type: AFK
Status: ready-for-agent

## Parent

PRD 0007 — `.agents/prds/0007-read-everything-drive-visibility-and-structure-issues.md`

## What to build

In November the office books October, but *Firmy* opens on each company's open month (November).

- `/companies` without a month parameter shows the **booking month** (the previous calendar month on
  the office clock) for every row. Uses the booking-month function from issue 01; whichever issue
  lands first adds it.
- The month picker keeps every month, plus **Otvorené mesiace** (each company's own open month, today's
  default) as an explicit option with its own URL.
- A company row links to the month shown. A company without that month shows *mesiac chýba* (as a
  picked month does today).
- The open month (ADR 0005) keeps its meaning for closing and late arrivals.
- Amend ADR 0015 (2026-11-23).

## Acceptance criteria

- [ ] Opening *Firmy* on 2026-11-23 shows `2026_10` for every row, and the rows link to `/companies/<id>/2026_10`. On 2027-01-02 it shows `2026_12` (unit test of the default; e2e for the page).
- [ ] *Otvorené mesiace* in the picker shows each company's open month, as the old default did.
- [ ] A company without the booking month shows *mesiac chýba*.
- [ ] ADR 0015 amended.

## Blocked by

None - can start immediately
