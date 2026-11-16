# 01 — The open month ignores pre-created future months

Type: AFK
Status: done
User stories: 59–61

## Parent

PRD 0004 — Team workflow, subject integrity and the pre-created Drive structure (`.agents/prds/0004-team-workflow-subject-integrity-and-drive-structure.md`)

## What to build

The office pre-creates all twelve month folders of the year, so "newest month without a close" makes
December the open month in November. Change the open-month rule as ADR 0005's 2026-11-11 amendment
states: the open month is the newest month without `closedAt` whose key is not after the current
calendar month in Europe/Bratislava. Months after the current month are *future months*: still swept
and stored, but hidden from the *Firmy* month picker, the month rail and every open-month decision
(late arrivals, dashboard stage, warming extraction) until their month starts.

A document a client uploads early into a future month is not moved or proposed for a move. It is shown
on the open month as an informational notice (*nahraté do budúceho mesiaca*) naming the month, and
appears normally in that month once it starts.

The rule is a pure function of the month list and "today", so it is tested without a clock.

## Acceptance criteria

- [ ] With `2026_01`…`2026_12` present and none closed, on 2026-11-11 the open month is `2026_11`.
- [ ] Closing months out of order still yields the newest unclosed non-future month.
- [ ] On the first day of a month (Europe/Bratislava, including the midnight edge in UTC) that month becomes eligible.
- [ ] Future months do not appear in the month picker or month rail, and the *Firmy* dashboard never selects one.
- [ ] Files in a future month are recorded by the sweep, never proposed as late arrivals, and listed as a notice on the open month.
- [ ] Existing month rows created by older scaffolding need no migration.
- [ ] Table-driven unit tests cover pre-created years, out-of-order closes, year boundaries and the time-zone edge; an integration test covers the dashboard with a pre-created year.

## Blocked by

None - can start immediately
