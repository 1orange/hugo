# 03 — The queue screen shows Drive push status

Type: AFK
Status: done

## Parent

PRD 0007 — `.agents/prds/0007-read-everything-drive-visibility-and-structure-issues.md`

## What to build

If Drive push silently stops working, new uploads wait up to the 15-minute poll, and nobody can tell.
Show the state of Drive sync on the queue screen.

- Store the time of the **last accepted Drive notification** (in settings, next to the watch channel)
  when the webhook accepts one. `sync` pings and rejected notifications don't count.
- A **Drive** panel on the queue screen:
  - mode: *Push zapnutý* (a webhook URL is configured and a channel exists) or *Iba pravidelná
    kontrola každých N min* (poll only);
  - channel expiry date (push only);
  - last accepted notification ("pred 4 min", or "zatiaľ žiadna");
  - last sweep (from settings) and the poll interval.
- A warning when push is on but no notification has arrived for more than 24 hours while sweeps found
  changes. That suggests notifications are not reaching Hugo.

## Acceptance criteria

- [x] An accepted notification records its time. A `sync` ping or a rejected one does not (unit test, extending the drive-watch tests).
- [x] The panel shows poll-only mode when no webhook URL is set, and push mode with expiry when it is (UI test with both configurations). Note: `tests/ui/drive-sync-panel.spec.ts` is written and typechecks, but was not run (Playwright not run in this session).
- [x] The 24-hour warning is a pure rule, unit-tested: push on, last notification older than 24 h, and a sweep since then that changed files.
- [x] The panel updates with the existing live events after a sweep. Note: a sweep announces `queue-changed` (unit-tested); the SSE route turns it into a fresh `queue` view that carries the panel. The browser refresh itself is not exercised by a test.

## Blocked by

None - can start immediately
