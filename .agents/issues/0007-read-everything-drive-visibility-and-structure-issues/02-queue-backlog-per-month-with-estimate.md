# 02 — The queue screen shows waiting documents per company and month, with an estimated finish

Type: AFK
Status: ready-for-agent

## Parent

PRD 0007 — `.agents/prds/0007-read-everything-drive-visibility-and-structure-issues.md`

## What to build

With every unclosed month read in the background (issue 01), the first run and every month-start
burst leave a backlog. The queue screen shows it so an accountant knows what is not ready yet.

- A **Čaká na prečítanie** section: waiting documents grouped by company and month, with counts split
  into "reading lane" and "waiting for the model", ordered by the issue 01 tiers (raised, recent,
  backlog).
- An **estimate** of when the queue will be empty: waiting model documents × the median model time of
  the recent finished records (prompt + answer stages) ÷ model slots, plus the reading lane's share
  (median reading time × waiting reading documents ÷ reading concurrency). Shown as "približne 3 h
  20 min". "Neznámy" when there are not enough recent records (fewer than 5).
- Updates live through the existing queue events. No polling.
- Issue 11 later limits this section to the viewer's companies. Until then it shows all.

## Acceptance criteria

- [ ] The queue snapshot carries waiting counts per company and month and per lane. Unit tests on the snapshot builder.
- [ ] The estimate is a pure function of waiting counts, recent stage timings and concurrency. Table-driven tests, including too few records (→ unknown) and a model slot count of 2.
- [ ] The section renders grouped and ordered by tier, and updates when a `queue-changed` event arrives (UI test).
- [ ] With an empty queue the section says nothing is waiting.

## Blocked by

- 01 — Every unclosed month in the reading window is read after each sweep, in priority order
