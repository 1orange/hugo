# 08 — The month she opens is read first

Type: AFK
Status: done

## What to build

Documents are prioritised only by kind (receipts before other documents). When an accountant opens a
month whose documents are still waiting, they should move ahead of the rest of the queue in both lanes
(02), so the month in front of her fills first. Others' turns keep their order. Once read, nothing
else changes.

Opening the month raises its waiting jobs' priority in the background (after the response, as the
month page already schedules reading). It never waits for Redis, and opening the same month again
does nothing new.

## Acceptance criteria

- [ ] With documents from two months waiting, opening one month makes its documents the next ones read (integration test on the queue).
- [ ] Receipts stay ahead of other documents within the raised month.
- [ ] Opening a month never delays the page, and works when Redis is down (the page still renders).

## Blocked by

- 02 — Documents that need no model don't wait for it
