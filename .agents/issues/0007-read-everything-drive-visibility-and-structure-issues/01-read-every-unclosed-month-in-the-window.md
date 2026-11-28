# 01 — Every unclosed month in the reading window is read after each sweep, in priority order

Type: AFK
Status: done

## Parent

PRD 0007 — `.agents/prds/0007-read-everything-drive-visibility-and-structure-issues.md`

## What to build

Today a sweep (Drive notification, the 15-minute poll, or a page's `after()`) queues only each
company's *open month*. In November that is `2026_11`, while clients upload October's documents into
`2026_10`, which waits until someone opens it. Make every sweep queue **every unread document of every
unclosed month in the reading window**, in a useful order.

- **Booking month.** A pure function gives the calendar month before the current one on the office
  clock (`Europe/Bratislava`). In January it is December of the previous year. Issue 07 uses it too:
  whichever issue lands first adds it.
- **Read planner (pure, deep).** Input: every company's months (key, closed), the current instant, the
  time zone, the reading-window start, and the month an open screen raised, if any. Output: the months
  to read, each with a tier:
  - *raised*: the opened month, as today;
  - *recent*: the booking month and the current month;
  - *backlog*: the other unclosed months in the window, newest first.
  A month is in the window when its key is ≥ the window start and ≤ the current month, and it is not
  closed.
- **Priorities.** Six queue priority levels, lower first: raised receipt, raised document, recent
  receipt, recent document, backlog receipt, backlog document. `raiseMonth` (opening a month) keeps
  working on the new levels. Backlog recency comes from queueing newest months first, not from extra
  levels.
- **One query.** The background pass finds the window's unread documents in a single store query:
  files in processed slots, not deleted, in a window month, whose document is missing or needs reading
  or re-reading. It does not call the per-month enqueue once per company and month. One job per Drive
  file stays the deduplication.
- **Setting *Čítať doklady od*** (`YYYY_MM`) in Settings, default January of the booking month's year.
  A month before it is read only when someone opens it, as today.
- **One-time backlog.** No special mode. The first sweep on a clean database queues the whole window,
  and later sweeps find only new or changed files. A pipeline version bump still re-reads open months
  only.
- Amend ADR 0020 (2026-11-23): what a sweep queues, the tiers, the setting.

## Acceptance criteria

- [x] Read planner unit tests (table-driven): window bounds; closed and future months excluded; booking month across the year boundary; tier order; the raised month first; window start setting honoured.
- [x] A file discovered in `2026_10` while the open month is `2026_11` is queued by the next sweep without the month being opened (PGlite + queue integration test).
- [x] A file in a closed month, or in a month before the window start, is not queued in the background; opening such an unclosed month still queues and raises it.
- [x] A file queued by a notification, the poll and a page is one job.
- [x] Priority order is observable: with jobs in all tiers waiting, raised ones are taken first, then recent, then backlog; receipts before documents in each tier (Redis test).
- [x] The background pass runs one query, not one per company and month. A test asserts it finds the same documents the per-month path would.
- [x] *Čítať doklady od* is editable in Settings, validated as `YYYY_MM`, and defaults as specified.
- [x] ADR 0020 amended.

## Blocked by

None - can start immediately
